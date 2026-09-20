//! Inspect Data Sync table mappings and hard gates (no row compare).

use std::collections::HashMap;

use super::super::error::{CmdExt, CommandError};
use super::super::AppState;
use super::types::{filter_tables_by_schema, is_self_sync, resolve_db_name};
use crate::data_sync::{classify_tables, require_data_sync_family, TableMapping, TableResult};

pub(crate) async fn inspect_data_sync_impl(
    state: &AppState,
    source_db_session_id: String,
    target_db_session_id: String,
    source_database: Option<String>,
    target_database: Option<String>,
    source_schema: Option<String>,
    target_schema: Option<String>,
    mappings: &[TableMapping],
) -> Result<Vec<TableResult>, CommandError> {
    let src_config = state
        .connection_manager
        .get_session_config(&source_db_session_id)
        .await
        .cmd_err("inspect_data_sync")?;
    let tgt_config = state
        .connection_manager
        .get_session_config(&target_db_session_id)
        .await
        .cmd_err("inspect_data_sync")?;

    require_data_sync_family(&src_config.database_type, &tgt_config.database_type)?;

    let src_db = resolve_db_name(source_database.as_deref(), src_config.database.as_deref());
    let tgt_db = resolve_db_name(target_database.as_deref(), tgt_config.database.as_deref());

    if is_self_sync(
        &source_db_session_id,
        &target_db_session_id,
        &src_db,
        &tgt_db,
        source_schema.as_deref(),
        target_schema.as_deref(),
    ) {
        return Err(CommandError::Validation(
            "self-sync of the same database is not allowed".into(),
        ));
    }

    let (src_driver, src_handle) = state
        .connection_manager
        .get_session(&source_db_session_id)
        .await
        .cmd_err("inspect_data_sync")?;
    let (tgt_driver, tgt_handle) = state
        .connection_manager
        .get_session(&target_db_session_id)
        .await
        .cmd_err("inspect_data_sync")?;

    let src_tables = filter_tables_by_schema(
        src_driver
            .get_tables(&src_handle, &src_db)
            .await
            .cmd_err("inspect_data_sync")?,
        source_schema.as_deref(),
    );
    let tgt_tables = filter_tables_by_schema(
        tgt_driver
            .get_tables(&tgt_handle, &tgt_db)
            .await
            .cmd_err("inspect_data_sync")?,
        target_schema.as_deref(),
    );

    let mut source_schemas = HashMap::new();
    for table in src_tables
        .iter()
        .filter(|t| matches!(t.table_type, crate::db::TableType::Table))
    {
        if let Ok(schema) = src_driver.get_table_schema(&src_handle, &table.name).await {
            source_schemas.insert(table.name.clone(), schema);
        }
    }
    let mut target_schemas = HashMap::new();
    for table in tgt_tables
        .iter()
        .filter(|t| matches!(t.table_type, crate::db::TableType::Table))
    {
        if let Ok(schema) = tgt_driver.get_table_schema(&tgt_handle, &table.name).await {
            target_schemas.insert(table.name.clone(), schema);
        }
    }

    let family = crate::data_sync::require_data_sync_family(
        &src_config.database_type,
        &tgt_config.database_type,
    )?;
    let mut results = classify_tables(
        &family,
        &src_tables,
        &tgt_tables,
        mappings,
        &source_schemas,
        &target_schemas,
    );
    for result in &mut results {
        if result.status != crate::data_sync::TableMappingStatus::Matched {
            continue;
        }
        if let Some(schema) = source_schemas.get(&result.source_table) {
            result.columns = schema
                .columns
                .iter()
                .map(|column| column.name.clone())
                .collect();
            result.column_types = schema
                .columns
                .iter()
                .map(|column| column.data_type.clone())
                .collect();
            result.primary_keys = schema.effective_primary_keys();
        }
        result.source_filter = mappings
            .iter()
            .find(|mapping| mapping.source_table == result.source_table)
            .and_then(|mapping| mapping.source_filter.clone());
    }
    Ok(results)
}
