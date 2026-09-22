//! Inspect Data Transfer table mappings (no execute).

use std::collections::HashMap;

use super::super::error::{CmdExt, CommandError};
use super::super::AppState;
use super::types::{is_self_database, resolve_db_name};
use crate::commands::sync::compare::count_rows;
use crate::data_transfer::{
    enforce_transfer_pairing, inspect_tables, structure::enrich_create_new_target_types,
    TableInspectResult, TableMapping, TransferMode,
};
use datazen_driver_api::TableType;

pub(crate) async fn inspect_data_transfer_impl(
    state: &AppState,
    source_db_session_id: String,
    target_db_session_id: String,
    source_database: Option<String>,
    target_database: Option<String>,
    source_schema: Option<&str>,
    target_schema: Option<&str>,
    mode: TransferMode,
    mappings: &[TableMapping],
) -> Result<Vec<TableInspectResult>, CommandError> {
    let src_config = state
        .connection_manager
        .get_session_config(&source_db_session_id)
        .await
        .cmd_err("inspect_data_transfer")?;
    let tgt_config = state
        .connection_manager
        .get_session_config(&target_db_session_id)
        .await
        .cmd_err("inspect_data_transfer")?;

    enforce_transfer_pairing(&src_config.database_type, &tgt_config.database_type)
        .map_err(CommandError::from)?;

    let src_db = resolve_db_name(source_database.as_deref(), src_config.database.as_deref());
    let tgt_db = resolve_db_name(target_database.as_deref(), tgt_config.database.as_deref());

    let source = crate::data_transfer::model::Endpoint {
        db_session_id: source_db_session_id.clone(),
        database: src_db.clone(),
        schema: source_schema
            .map(str::to_string)
            .or(src_config.schema.clone()),
    };
    let target = crate::data_transfer::model::Endpoint {
        db_session_id: target_db_session_id.clone(),
        database: tgt_db.clone(),
        schema: target_schema
            .map(str::to_string)
            .or(tgt_config.schema.clone()),
    };
    crate::data_transfer::metadata::metadata_relation_ref(&source, "")?;
    crate::data_transfer::metadata::metadata_relation_ref(&target, "")?;

    if is_self_database(
        &source_db_session_id,
        &target_db_session_id,
        &src_db,
        &tgt_db,
        source.normalized_schema(),
        target.normalized_schema(),
    ) {
        return Err(CommandError::Validation(
            "source and target are the same database; pick different databases or connections"
                .into(),
        ));
    }

    let (src_driver, src_handle) = state
        .connection_manager
        .get_session(&source_db_session_id)
        .await
        .cmd_err("inspect_data_transfer")?;
    let (tgt_driver, tgt_handle) = state
        .connection_manager
        .get_session(&target_db_session_id)
        .await
        .cmd_err("inspect_data_transfer")?;

    let src_tables = src_driver
        .get_tables(&src_handle, &src_db)
        .await
        .cmd_err("inspect_data_transfer")?;
    let tgt_tables = tgt_driver
        .get_tables(&tgt_handle, &tgt_db)
        .await
        .cmd_err("inspect_data_transfer")?;

    let src_tables: Vec<_> = src_tables
        .into_iter()
        .filter(|table| crate::data_transfer::metadata::table_in_endpoint_schema(&source, table))
        .collect();
    let tgt_tables: Vec<_> = tgt_tables
        .into_iter()
        .filter(|table| crate::data_transfer::metadata::table_in_endpoint_schema(&target, table))
        .collect();

    let mut source_schemas = HashMap::new();
    for table in src_tables
        .iter()
        .filter(|t| matches!(t.table_type, TableType::Table))
    {
        if let Ok(schema) = crate::data_transfer::metadata::load_table_schema(
            src_driver.as_ref(),
            &src_handle,
            &source,
            &table.name,
        )
        .await
        {
            source_schemas.insert(table.name.clone(), schema);
        }
    }
    let mut target_schemas = HashMap::new();
    for table in tgt_tables
        .iter()
        .filter(|t| matches!(t.table_type, TableType::Table))
    {
        if let Ok(schema) = crate::data_transfer::metadata::load_table_schema(
            tgt_driver.as_ref(),
            &tgt_handle,
            &target,
            &table.name,
        )
        .await
        {
            target_schemas.insert(table.name.clone(), schema);
        }
    }

    let mut source_row_counts = HashMap::new();
    for table in src_tables
        .iter()
        .filter(|t| matches!(t.table_type, TableType::Table))
    {
        if let Ok(n) = count_rows(
            src_driver.as_ref(),
            &src_handle,
            &src_config.database_type,
            Some(&src_db),
            source.normalized_schema(),
            &table.name,
        )
        .await
        {
            source_row_counts.insert(table.name.clone(), n);
        }
    }

    let mut results = inspect_tables(
        &src_tables,
        &tgt_tables,
        mappings,
        &source_schemas,
        &target_schemas,
        mode,
        &source_row_counts,
    );

    if state
        .sync_adapters
        .ensure_pair(&src_config.database_type, &tgt_config.database_type)
        .is_ok()
    {
        if let (Some(src), Some(tgt)) = (
            state.sync_adapters.get_source(&src_config.database_type),
            state.sync_adapters.get_target(&tgt_config.database_type),
        ) {
            enrich_create_new_target_types(
                &mut results,
                &source_schemas,
                src.as_ref(),
                tgt.as_ref(),
            );
        }
    }

    Ok(results)
}

/// Inspect a SQL-file transfer using only the source session.
///
/// A file destination has no live target catalog to compare against.  The
/// source schema is still inspected through the same mapping engine so the
/// mapping UI can let the user select tables, rename targets, skip columns,
/// and review the target-native type chosen for an explicit output dialect.
pub(crate) async fn inspect_sql_file_transfer_impl(
    state: &AppState,
    source_db_session_id: String,
    source_database: Option<String>,
    source_schema: Option<String>,
    mode: TransferMode,
    target_database_type: Option<String>,
    mappings: &[TableMapping],
) -> Result<Vec<TableInspectResult>, CommandError> {
    let src_config = state
        .connection_manager
        .get_session_config(&source_db_session_id)
        .await
        .cmd_err("inspect_sql_file_transfer")?;
    let src_db = resolve_db_name(source_database.as_deref(), src_config.database.as_deref());
    let source = crate::data_transfer::model::Endpoint {
        db_session_id: source_db_session_id.clone(),
        database: src_db.clone(),
        schema: source_schema.or(src_config.schema.clone()),
    };
    crate::data_transfer::metadata::metadata_relation_ref(&source, "")?;

    let (src_driver, src_handle) = state
        .connection_manager
        .get_session(&source_db_session_id)
        .await
        .cmd_err("inspect_sql_file_transfer")?;
    let source_tables = src_driver
        .get_tables(&src_handle, &src_db)
        .await
        .cmd_err("inspect_sql_file_transfer")?;
    let source_tables: Vec<_> = source_tables
        .into_iter()
        .filter(|table| crate::data_transfer::metadata::table_in_endpoint_schema(&source, table))
        .collect();

    let mut source_schemas = HashMap::new();
    for table in source_tables
        .iter()
        .filter(|t| matches!(t.table_type, TableType::Table))
    {
        if let Ok(schema) = crate::data_transfer::metadata::load_table_schema(
            src_driver.as_ref(),
            &src_handle,
            &source,
            &table.name,
        )
        .await
        {
            source_schemas.insert(table.name.clone(), schema);
        }
    }

    let mut source_row_counts = HashMap::new();
    for table in source_tables
        .iter()
        .filter(|t| matches!(t.table_type, TableType::Table))
    {
        if let Ok(n) = count_rows(
            src_driver.as_ref(),
            &src_handle,
            &src_config.database_type,
            Some(&src_db),
            source.normalized_schema(),
            &table.name,
        )
        .await
        {
            source_row_counts.insert(table.name.clone(), n);
        }
    }

    if let Some(target_type) = target_database_type
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        let target = crate::data_transfer::SqlFileTarget {
            file_token: "inspect-only".into(),
            database_type: Some(target_type.to_string()),
            database: None,
            schema: None,
            encoding: None,
            compression: None,
        };
        let _driver =
            crate::data_transfer::sql_file::resolve_target_driver(src_driver.clone(), &target)
                .map_err(CommandError::from)?;
        state
            .sync_adapters
            .ensure_pair(&src_config.database_type, &target_type.to_string())
            .map_err(CommandError::Validation)?;
    }

    let adapters = if let Some(target_type) = target_database_type
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        let source_adapter = state
            .sync_adapters
            .get_source(&src_config.database_type)
            .ok_or_else(|| CommandError::Validation("missing source sync adapter".into()))?;
        let target_adapter = state
            .sync_adapters
            .get_target(&target_type.to_string())
            .ok_or_else(|| CommandError::Validation("missing target sync adapter".into()))?;
        crate::data_transfer::structure::enrich_source_types(
            source_adapter.as_ref(),
            src_driver.as_ref(),
            &src_handle,
            &source,
            &mut source_schemas,
        )
        .await
        .map_err(CommandError::from)?;
        Some((source_adapter, target_adapter))
    } else {
        None
    };

    let effective_mappings = if mappings.is_empty() {
        source_tables
            .iter()
            .filter(|table| matches!(table.table_type, TableType::Table))
            .map(|table| {
                let mut mapping = TableMapping::auto(&table.name);
                mapping.create_new = true;
                mapping
            })
            .collect::<Vec<_>>()
    } else {
        mappings
            .iter()
            .cloned()
            .map(|mut mapping| {
                // SQL-file output always creates into the selected artifact;
                // accepting false here would turn a renamed mapping into an
                // implicit target lookup at preview time.
                mapping.create_new = true;
                mapping
            })
            .collect::<Vec<_>>()
    };
    let mut results = inspect_tables(
        &source_tables,
        &[],
        &effective_mappings,
        &source_schemas,
        &HashMap::new(),
        mode,
        &source_row_counts,
    );
    if let Some((source_adapter, target_adapter)) = adapters {
        enrich_create_new_target_types(
            &mut results,
            &source_schemas,
            source_adapter.as_ref(),
            target_adapter.as_ref(),
        );
    }
    Ok(results)
}
