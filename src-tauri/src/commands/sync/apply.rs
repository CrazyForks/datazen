//! Compare selected tables, generate ChangeSet SQL, and apply.

use super::super::error::{CmdExt, CommandError};
use super::super::AppState;
use super::comparison_store::StreamingComparisonStoreWriter;
use super::inspect::inspect_data_sync_impl;
use super::keyset_source::DriverKeysetSource;
use super::plans;
use crate::data_sync::{
    compare_table_pages_to_sink, generate_table_sql_with_preview_formatter_and_policy,
    mysql_placeholder, postgres_typed_placeholder, quote_ident_sql, ChangeSet, ComparisonResult,
    DataSyncError, SyncOptions, SyncSourceFilter, TableMapping, TableMappingStatus, TableResult,
};
use std::collections::HashMap;

fn ident_quote(family: &str) -> char {
    if family == "mysql" {
        '`'
    } else {
        '"'
    }
}

pub(crate) async fn compare_data_sync_impl(
    state: &AppState,
    source_db_session_id: String,
    target_db_session_id: String,
    tables: Vec<String>,
    job_id: Option<String>,
    source_database: Option<String>,
    target_database: Option<String>,
    source_schema: Option<String>,
    target_schema: Option<String>,
    options: SyncOptions,
    mappings: &[TableMapping],
    source_filters: &HashMap<String, SyncSourceFilter>,
) -> Result<plans::SyncComparisonPreview, CommandError> {
    let (src_driver, src_handle) = state
        .connection_manager
        .get_session(&source_db_session_id)
        .await
        .cmd_err("compare_data_sync")?;
    let (tgt_driver, tgt_handle) = state
        .connection_manager
        .get_session(&target_db_session_id)
        .await
        .cmd_err("compare_data_sync")?;

    let source_snapshot = src_driver
        .begin_read_snapshot(&src_handle)
        .await
        .cmd_err("compare_data_sync")?;
    let target_snapshot = match tgt_driver.begin_read_snapshot(&tgt_handle).await {
        Ok(snapshot) => snapshot,
        Err(error) => {
            if let Err(cleanup_error) = src_driver.rollback(source_snapshot).await {
                tracing::warn!(
                    error = %cleanup_error,
                    "failed to roll back source Data Sync read snapshot after target setup failed"
                );
            }
            return Err(error.into());
        }
    };

    let result = compare_data_sync_impl_inner(
        state,
        source_db_session_id,
        target_db_session_id,
        tables,
        job_id,
        source_database,
        target_database,
        source_schema,
        target_schema,
        options,
        mappings,
        source_filters,
    )
    .await;

    let source_cleanup = src_driver.rollback(source_snapshot).await;
    let target_cleanup = tgt_driver.rollback(target_snapshot).await;
    if let Err(error) = &source_cleanup {
        tracing::warn!(
            error = %error,
            "failed to roll back source Data Sync read snapshot"
        );
    }
    if let Err(error) = &target_cleanup {
        tracing::warn!(
            error = %error,
            "failed to roll back target Data Sync read snapshot"
        );
    }

    match result {
        Err(error) => Err(error),
        Ok(preview) => {
            source_cleanup.map_err(CommandError::from)?;
            target_cleanup.map_err(CommandError::from)?;
            Ok(preview)
        }
    }
}

async fn compare_data_sync_impl_inner(
    state: &AppState,
    source_db_session_id: String,
    target_db_session_id: String,
    tables: Vec<String>,
    job_id: Option<String>,
    source_database: Option<String>,
    target_database: Option<String>,
    source_schema: Option<String>,
    target_schema: Option<String>,
    options: SyncOptions,
    mappings: &[TableMapping],
    source_filters: &HashMap<String, SyncSourceFilter>,
) -> Result<plans::SyncComparisonPreview, CommandError> {
    let cancelled = match job_id.as_deref() {
        Some(id) => Some(super::jobs::ensure_job(id).await),
        None => None,
    };
    let inspected = inspect_data_sync_impl(
        state,
        source_db_session_id.clone(),
        target_db_session_id.clone(),
        source_database.clone(),
        target_database.clone(),
        source_schema.clone(),
        target_schema.clone(),
        mappings,
    )
    .await?;
    let wanted: std::collections::HashSet<String> = tables.into_iter().collect();
    let src_config = state
        .connection_manager
        .get_session_config(&source_db_session_id)
        .await
        .cmd_err("compare_data_sync")?;
    let tgt_config = state
        .connection_manager
        .get_session_config(&target_db_session_id)
        .await
        .cmd_err("compare_data_sync")?;
    let family = crate::data_sync::require_data_sync_family(
        &src_config.database_type,
        &tgt_config.database_type,
    )?;
    let quote = ident_quote(&family);
    let (src_driver, src_handle) = state
        .connection_manager
        .get_session(&source_db_session_id)
        .await
        .cmd_err("compare_data_sync")?;
    let (tgt_driver, tgt_handle) = state
        .connection_manager
        .get_session(&target_db_session_id)
        .await
        .cmd_err("compare_data_sync")?;
    state
        .sync_adapters
        .ensure_pair(&src_config.database_type, &tgt_config.database_type)
        .map_err(CommandError::Validation)?;
    let src_key_adapter = state
        .sync_adapters
        .get_source(&src_config.database_type)
        .ok_or_else(|| {
            CommandError::Validation("source driver has no Data Sync key contract".into())
        })?;
    let tgt_key_adapter = state
        .sync_adapters
        .get_source(&tgt_config.database_type)
        .ok_or_else(|| {
            CommandError::Validation("target driver has no Data Sync key contract".into())
        })?;

    options.validate().map_err(CommandError::from)?;
    let mut comparison_writer =
        StreamingComparisonStoreWriter::new().map_err(CommandError::Validation)?;
    for mapping in inspected {
        if mapping.status != TableMappingStatus::Matched
            || (!wanted.is_empty() && !wanted.contains(&mapping.source_table))
        {
            comparison_writer
                .add_table(mapping)
                .map_err(CommandError::Validation)?;
            continue;
        }
        if cancelled
            .as_ref()
            .is_some_and(|c| c.load(std::sync::atomic::Ordering::SeqCst))
        {
            return Err(CommandError::from(
                crate::data_sync::DataSyncError::cancelled("compare cancelled"),
            ));
        }
        let schema = src_driver
            .get_table_schema(
                &src_handle,
                &mapping.source_table,
                src_config.database.as_deref().unwrap_or_default(),
                src_config.schema.as_deref(),
            )
            .await
            .cmd_err("compare_data_sync")?;
        let target_table_schema = tgt_driver
            .get_table_schema(
                &tgt_handle,
                &mapping.target_table,
                tgt_config.database.as_deref().unwrap_or_default(),
                tgt_config.schema.as_deref(),
            )
            .await
            .cmd_err("compare_data_sync")?;
        let pk_columns = schema.effective_primary_keys();
        let sync_filter = source_filters.get(&mapping.source_table).cloned();
        if let Some(filter) = sync_filter.as_ref() {
            filter
                .validate(&schema)
                .map_err(|error| CommandError::Validation(error.to_string()))?;
            filter.validate(&target_table_schema).map_err(|error| {
                CommandError::Validation(format!(
                    "{}: sync filter is not valid for target '{}': {error}",
                    mapping.source_table, mapping.target_table
                ))
            })?;
            for (driver, side, table_schema) in [
                (src_driver.as_ref(), "source", &schema),
                (tgt_driver.as_ref(), "target", &target_table_schema),
            ] {
                filter
                    .build_where_typed_with_default_order(
                        driver.quote_char(),
                        1,
                        (pk_columns.len() == 1).then(|| pk_columns[0].as_str()),
                        |column| {
                            table_schema
                                .columns
                                .iter()
                                .find(|candidate| candidate.name == column)
                                .map(|candidate| candidate.data_type.clone())
                        },
                        |index, data_type| {
                            driver
                                .parameter_placeholder(index, data_type)
                                .map_err(|error| DataSyncError::validation(error.to_string()))
                        },
                    )
                    .map_err(|error| {
                        CommandError::Validation(format!(
                            "{}: {side} driver cannot execute sync filter: {error}",
                            mapping.source_table
                        ))
                    })?;
            }
        }
        let column_names: Vec<String> = schema.columns.iter().map(|c| c.name.clone()).collect();
        let source_column_types: HashMap<String, String> = schema
            .columns
            .iter()
            .map(|column| (column.name.clone(), column.data_type.clone()))
            .collect();
        let target_column_types: HashMap<String, String> = target_table_schema
            .columns
            .iter()
            .map(|column| (column.name.clone(), column.data_type.clone()))
            .collect();
        let source_recordset_limit = sync_filter
            .as_ref()
            .map(|filter| filter.recordset_limit(&schema))
            .transpose()
            .map_err(|error| CommandError::Validation(error.to_string()))?
            .flatten();
        let target_recordset_limit = sync_filter
            .as_ref()
            .map(|filter| filter.recordset_limit(&target_table_schema))
            .transpose()
            .map_err(|error| CommandError::Validation(error.to_string()))?
            .flatten();
        let mut src_contracts = Vec::with_capacity(pk_columns.len());
        let mut tgt_contracts = Vec::with_capacity(pk_columns.len());
        for pk in &pk_columns {
            let source_column = schema
                .columns
                .iter()
                .find(|c| &c.name == pk)
                .ok_or_else(|| CommandError::Validation(format!("missing key column {pk}")))?;
            let target_column = target_table_schema
                .columns
                .iter()
                .find(|c| &c.name == pk)
                .ok_or_else(|| {
                    CommandError::Validation(format!(
                        "target key column {pk} is missing; compare again"
                    ))
                })?;
            let source_contract =
                src_key_adapter
                    .sync_key_contract(source_column)
                    .map_err(|reason| {
                        CommandError::Validation(format!(
                            "{}: source key '{}': {reason}",
                            mapping.source_table, pk
                        ))
                    })?;
            let target_contract =
                tgt_key_adapter
                    .sync_key_contract(target_column)
                    .map_err(|reason| {
                        CommandError::Validation(format!(
                            "{}: target key '{}': {reason}",
                            mapping.target_table, pk
                        ))
                    })?;
            if source_contract != target_contract {
                return Err(CommandError::Validation(format!(
                    "{}: key '{}' has incompatible source/target equality or ordering contract (source={source_contract:?}, target={target_contract:?})",
                    mapping.source_table, pk
                )));
            }
            src_contracts.push(source_contract);
            tgt_contracts.push(target_contract);
        }
        let pk_indexes: Vec<usize> = pk_columns
            .iter()
            .filter_map(|pk| column_names.iter().position(|c| c == pk))
            .collect();
        let mut src_source = DriverKeysetSource::new(
            src_driver.clone(),
            src_handle.clone(),
            mapping.source_table.clone(),
            source_database.clone(),
            source_schema.clone(),
            column_names.clone(),
            pk_columns.clone(),
            quote,
            &family,
            src_key_adapter.clone(),
            src_contracts,
            sync_filter.clone(),
            source_column_types,
            source_recordset_limit,
        )?;
        let mut tgt_source = DriverKeysetSource::new(
            tgt_driver.clone(),
            tgt_handle.clone(),
            mapping.target_table.clone(),
            target_database.clone(),
            target_schema.clone(),
            column_names.clone(),
            pk_columns.clone(),
            quote,
            &family,
            tgt_key_adapter.clone(),
            tgt_contracts,
            sync_filter.clone(),
            target_column_types,
            target_recordset_limit,
        )?;
        let mut table_metadata = TableResult::matched(
            mapping.source_table.clone(),
            mapping.target_table.clone(),
            Vec::new(),
        );
        table_metadata.columns = column_names.clone();
        table_metadata.primary_keys = pk_columns.clone();
        table_metadata.column_types = schema.columns.iter().map(|c| c.data_type.clone()).collect();
        table_metadata.source_filter = sync_filter.clone();
        comparison_writer
            .begin_table(table_metadata)
            .map_err(CommandError::Validation)?;
        let table_result = compare_table_pages_to_sink(
            &mapping.source_table,
            &mapping.target_table,
            &pk_indexes,
            &column_names,
            &options,
            &mut src_source,
            &mut tgt_source,
            cancelled.clone(),
            &mut comparison_writer,
        )
        .await
        .map_err(CommandError::from)?;
        comparison_writer
            .finish_table(table_result.unchanged_count)
            .map_err(CommandError::Validation)?;
    }
    let comparison = comparison_writer
        .finish()
        .map_err(CommandError::Validation)?;
    let source_database_name =
        super::types::resolve_db_name(source_database.as_deref(), src_config.database.as_deref());
    let target_database_name =
        super::types::resolve_db_name(target_database.as_deref(), tgt_config.database.as_deref());
    let source_schema_name = source_schema
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .or_else(|| src_config.schema.clone());
    let target_schema_name = target_schema
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .or_else(|| tgt_config.schema.clone());
    let mut source_entries = Vec::new();
    let mut target_entries = Vec::new();
    for table in comparison
        .summaries()
        .map_err(CommandError::Validation)?
        .into_iter()
        .filter(|table| table.table.status == TableMappingStatus::Matched)
    {
        let source_schema_snapshot = src_driver
            .get_table_schema(
                &src_handle,
                &table.table.source_table,
                src_config.database.as_deref().unwrap_or_default(),
                src_config.schema.as_deref(),
            )
            .await
            .cmd_err("compare_data_sync")?;
        let target_schema_snapshot = tgt_driver
            .get_table_schema(
                &tgt_handle,
                &table.table.target_table,
                tgt_config.database.as_deref().unwrap_or_default(),
                tgt_config.schema.as_deref(),
            )
            .await
            .cmd_err("compare_data_sync")?;
        source_entries.push((
            table.table.source_table.clone(),
            Some(source_schema_snapshot),
            table.table.source_filter.clone(),
        ));
        target_entries.push((
            table.table.target_table.clone(),
            Some(target_schema_snapshot),
            table.table.source_filter.clone(),
        ));
    }
    let source_schema_fingerprint = plans::fingerprint_relations_with_filters(
        &source_database_name,
        source_schema_name.as_deref(),
        source_entries,
    )
    .map_err(CommandError::Validation)?;
    let target_schema_fingerprint = plans::fingerprint_relations_with_filters(
        &target_database_name,
        target_schema_name.as_deref(),
        target_entries,
    )
    .map_err(CommandError::Validation)?;
    plans::issue_plan_with_store(
        source_db_session_id,
        target_db_session_id,
        source_database_name,
        target_database_name,
        source_schema_name,
        target_schema_name,
        src_driver.as_ref(),
        tgt_driver.as_ref(),
        source_schema_fingerprint,
        target_schema_fingerprint,
        comparison,
        options,
        tgt_config.read_only,
    )
    .map_err(CommandError::Validation)
}

fn resolve_projection_types(
    projection: &TableResult,
    schema: &datazen_driver_api::TableSchema,
    family: &str,
) -> Result<Vec<String>, CommandError> {
    let columns = &projection.columns;
    let unique: std::collections::HashSet<_> = columns.iter().collect();
    if columns.is_empty()
        || unique.len() != columns.len()
        || columns.len() != schema.columns.len()
        || projection.column_types.len() != columns.len()
        || projection.primary_keys != schema.effective_primary_keys()
    {
        return Err(CommandError::Validation(
            "comparison projection is stale or missing; compare again".into(),
        ));
    }
    columns
        .iter()
        .enumerate()
        .map(|(index, name)| {
            let column = schema
                .columns
                .iter()
                .find(|c| &c.name == name)
                .ok_or_else(|| {
                    CommandError::Validation(format!("target column {name} changed; compare again"))
                })?;
            if !crate::data_sync::types_eq::types_equivalent(
                family,
                &projection.column_types[index],
                &column.data_type,
            ) {
                return Err(CommandError::Validation(format!(
                    "target type for {name} changed; compare again"
                )));
            }
            Ok(column.data_type.clone())
        })
        .collect()
}

pub(crate) async fn generate_data_sync_sql_impl(
    state: &AppState,
    target_db_session_id: String,
    tables: Vec<TableResult>,
    options: SyncOptions,
    target_database: Option<String>,
    target_schema: Option<String>,
) -> Result<Vec<crate::data_sync::SqlStatement>, CommandError> {
    options.validate().map_err(CommandError::from)?;
    let comparison = ComparisonResult::new(tables);
    let set = ChangeSet::from_comparison("ui-preview", &comparison, &options);
    set.validate_executable().map_err(CommandError::from)?;

    let tgt_config = state
        .connection_manager
        .get_session_config(&target_db_session_id)
        .await
        .cmd_err("generate_data_sync_sql")?;
    let family = crate::data_sync::require_data_sync_family(
        &tgt_config.database_type,
        &tgt_config.database_type,
    )?;
    let quote = ident_quote(&family);
    let (tgt_driver, tgt_handle) = state
        .connection_manager
        .get_session(&target_db_session_id)
        .await
        .cmd_err("generate_data_sync_sql")?;
    state
        .sync_adapters
        .ensure_type(&tgt_config.database_type)
        .map_err(CommandError::Validation)?;
    let preview_source = state
        .sync_adapters
        .get_source(&tgt_config.database_type)
        .ok_or_else(|| {
            CommandError::Validation("target driver has no SQL preview type adapter".into())
        })?;
    let preview_target = state
        .sync_adapters
        .get_target(&tgt_config.database_type)
        .ok_or_else(|| {
            CommandError::Validation("target driver has no SQL preview literal renderer".into())
        })?;

    let mut statements = Vec::new();
    for table in &set.tables {
        let schema = tgt_driver
            .get_table_schema(
                &tgt_handle,
                &table.target_table,
                tgt_config.database.as_deref().unwrap_or_default(),
                tgt_config.schema.as_deref(),
            )
            .await
            .cmd_err("generate_data_sync_sql")?;
        let projection = comparison
            .tables
            .iter()
            .find(|t| t.source_table == table.source_table && t.target_table == table.target_table)
            .ok_or_else(|| {
                CommandError::Validation("comparison projection missing; compare again".into())
            })?;
        let column_names = &projection.columns;
        let column_types = resolve_projection_types(projection, &schema, &family)?;
        let pk = &projection.primary_keys;
        let preview_types = schema
            .columns
            .iter()
            .map(|column| {
                let ir = preview_source.column_to_ir(column, Some(&column.data_type));
                (column.name.clone(), ir.ir_type)
            })
            .collect::<std::collections::HashMap<_, _>>();
        let preview_literal = |column: &str,
                               value: &Option<datazen_driver_api::Value>,
                               _data_type: Option<&str>|
         -> Result<String, DataSyncError> {
            let ir_type = preview_types.get(column).ok_or_else(|| {
                DataSyncError::validation(format!(
                    "target preview metadata for column '{column}' is missing; compare again"
                ))
            })?;
            Ok(preview_target.format_literal(value, ir_type))
        };
        let stmts = if family == "mysql" {
            generate_table_sql_with_preview_formatter_and_policy(
                table,
                target_database.as_deref(),
                &pk,
                &column_names,
                &column_types,
                |n| quote_ident_sql(n, quote),
                |idx, _| mysql_placeholder(idx),
                options.conflict_policy,
                preview_literal,
            )
        } else {
            generate_table_sql_with_preview_formatter_and_policy(
                table,
                target_schema.as_deref(),
                &pk,
                &column_names,
                &column_types,
                |n| quote_ident_sql(n, quote),
                postgres_typed_placeholder,
                options.conflict_policy,
                preview_literal,
            )
        }
        .map_err(CommandError::from)?;
        statements.extend(stmts);
    }
    Ok(statements)
}

pub(crate) async fn apply_data_sync_impl(
    state: &AppState,
    source_db_session_id: String,
    target_db_session_id: String,
    tables: Vec<String>,
    job_id: Option<String>,
    source_database: Option<String>,
    target_database: Option<String>,
    source_schema: Option<String>,
    target_schema: Option<String>,
    options: SyncOptions,
) -> Result<crate::data_sync::ExecutionResult, CommandError> {
    let _ = (
        state,
        source_db_session_id,
        target_db_session_id,
        tables,
        job_id,
        source_database,
        target_database,
        source_schema,
        target_schema,
        options,
    );
    Err(CommandError::Validation("legacy apply cannot preserve reviewed row selection; compare, generate selected SQL, then execute that plan".into()))
}

/// Re-run inspect gates for selected tables; returns stale table names when structure/PK drifted.
pub(crate) async fn revalidate_data_sync_impl(
    state: &AppState,
    source_db_session_id: String,
    target_db_session_id: String,
    tables: Vec<String>,
    source_database: Option<String>,
    target_database: Option<String>,
    source_schema: Option<String>,
    target_schema: Option<String>,
) -> Result<serde_json::Value, CommandError> {
    let inspected = inspect_data_sync_impl(
        state,
        source_db_session_id,
        target_db_session_id,
        source_database,
        target_database,
        source_schema,
        target_schema,
        &[],
    )
    .await?;
    let wanted: std::collections::HashSet<String> = tables.into_iter().collect();
    let mut stale = Vec::new();
    for row in inspected {
        if !wanted.is_empty()
            && !wanted.contains(&row.source_table)
            && !wanted.contains(&row.target_table)
        {
            continue;
        }
        if row.status != TableMappingStatus::Matched {
            stale.push(serde_json::json!({
                "sourceTable": row.source_table,
                "targetTable": row.target_table,
                "status": row.status,
                "reason": row.incompatible_reason,
            }));
        }
    }
    Ok(serde_json::json!({
        "ok": stale.is_empty(),
        "staleTables": stale,
    }))
}

#[cfg(test)]
mod tests {
    use super::ident_quote;
    use crate::commands::sync::types::{resolve_options, SyncOptionsInput};

    #[test]
    fn mysql_uses_backticks_postgres_uses_double_quotes() {
        assert_eq!(ident_quote("mysql"), '`');
        assert_eq!(ident_quote("postgresql"), '"');
    }

    #[test]
    fn sync_options_input_overrides_defaults() {
        let input = SyncOptionsInput {
            insert: Some(false),
            update: Some(true),
            delete: Some(true),
            matching_strategy: None,
            batch_size: Some(50),
            large_value_mode: None,
            conflict_policy: None,
        };
        let opts = resolve_options(Some(input));
        assert!(!opts.insert);
        assert!(opts.update);
        assert!(opts.delete);
        assert_eq!(opts.batch_size, 50);
    }
    #[test]
    fn reordered_target_columns_keep_canonical_values_and_reject_drift() {
        use crate::data_sync::{
            generate_table_sql, ChangeSet, ComparisonResult, RowChange, SyncOptions, TableResult,
        };
        use datazen_driver_api::{ColumnSchema, TableSchema, Value};
        let opts = SyncOptions::default();
        let mut result = TableResult::matched(
            "source",
            "target",
            vec![RowChange::update(
                vec![Value::Integer(1)],
                vec![
                    Some(Value::Integer(1)),
                    Some(Value::Integer(10)),
                    Some(Value::Integer(20)),
                ],
                vec![
                    Some(Value::Integer(1)),
                    Some(Value::Integer(9)),
                    Some(Value::Integer(20)),
                ],
                vec!["a".into()],
                &opts,
            )],
        );
        result.columns = vec!["id".into(), "a".into(), "b".into()];
        result.column_types = vec!["INT".into(); 3];
        result.primary_keys = vec!["id".into()];
        let mut schema = TableSchema {
            table_name: "target".into(),
            columns: ["id", "b", "a"]
                .iter()
                .map(|name| ColumnSchema {
                    name: (*name).into(),
                    data_type: "INT".into(),
                    nullable: false,
                    default_value: None,
                    comment: None,
                    is_primary_key: *name == "id",
                    is_auto_increment: false,
                })
                .collect(),
            primary_keys: vec!["id".into()],
            indexes: vec![],
            foreign_keys: vec![],
            check_constraints: vec![],
            table_options: Default::default(),
        };
        let types = super::resolve_projection_types(&result, &schema, "mysql").unwrap();
        let set =
            ChangeSet::from_comparison("t", &ComparisonResult::new(vec![result.clone()]), &opts);
        let statements = generate_table_sql(
            &set.tables[0],
            None,
            &result.primary_keys,
            &result.columns,
            &types,
            |name| format!("`{name}`"),
            |_, _| "?".into(),
        )
        .unwrap();
        assert!(matches!(statements[0].parameters[0], Value::Integer(10)));
        assert_eq!(
            statements[0].sql,
            "UPDATE `target` SET `a` = ? WHERE `id` = ? AND (`a` = ? OR (`a` IS NULL AND ? IS NULL)) AND (`b` = ? OR (`b` IS NULL AND ? IS NULL))"
        );
        schema.primary_keys = vec!["b".into()];
        assert!(super::resolve_projection_types(&result, &schema, "mysql").is_err());
        schema.primary_keys = vec!["id".into()];
        schema.columns[2].data_type = "TEXT".into();
        assert!(super::resolve_projection_types(&result, &schema, "mysql").is_err());
        result.columns.clear();
        assert!(super::resolve_projection_types(&result, &schema, "mysql").is_err());
    }
}
