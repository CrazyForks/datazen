//! Compare selected tables, generate ChangeSet SQL, and apply.

use super::super::error::{CmdExt, CommandError};
use super::super::AppState;
use super::inspect::inspect_data_sync_impl;
use super::keyset_source::DriverKeysetSource;
use crate::data_sync::{
    compare_table_pages, generate_table_sql_with_preview_formatter, mysql_placeholder,
    postgres_typed_placeholder, quote_ident_sql, ChangeSet, ComparisonResult, DataSyncError,
    SyncOptions, TableMapping, TableMappingStatus, TableResult,
};

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
) -> Result<Vec<TableResult>, CommandError> {
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

    options.validate().map_err(CommandError::from)?;
    let mut total_bytes = 0;
    let mut out = Vec::new();
    for mapping in inspected {
        if mapping.status != TableMappingStatus::Matched
            || (!wanted.is_empty() && !wanted.contains(&mapping.source_table))
        {
            out.push(mapping);
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
            .get_table_schema(&src_handle, &mapping.source_table)
            .await
            .cmd_err("compare_data_sync")?;
        let column_names: Vec<String> = schema.columns.iter().map(|c| c.name.clone()).collect();
        let pk_columns = schema.effective_primary_keys();
        for pk in &pk_columns {
            let column = schema
                .columns
                .iter()
                .find(|c| &c.name == pk)
                .ok_or_else(|| CommandError::Validation(format!("missing key column {pk}")))?;
            let kind = column.data_type.to_ascii_lowercase();
            let base = kind.split(['(', ' ']).next().unwrap_or("");
            if !matches!(
                base,
                "tinyint"
                    | "smallint"
                    | "mediumint"
                    | "int"
                    | "integer"
                    | "bigint"
                    | "int2"
                    | "int4"
                    | "int8"
                    | "serial"
                    | "bigserial"
                    | "smallserial"
            ) {
                return Err(CommandError::Validation(format!("{}: key '{}' ({}) has no verified cross-endpoint ordering; use an integer primary key or Data Transfer until the driver supports normalized comparison keys", mapping.source_table, pk, column.data_type)));
            }
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
        );
        let mut tgt_source = DriverKeysetSource::new(
            tgt_driver.clone(),
            tgt_handle.clone(),
            mapping.target_table.clone(),
            target_database.clone(),
            target_schema.clone(),
            column_names.clone(),
            pk_columns,
            quote,
            &family,
        );
        let mut table_result = compare_table_pages(
            &mapping.source_table,
            &mapping.target_table,
            &pk_indexes,
            &column_names,
            &options,
            &mut src_source,
            &mut tgt_source,
            cancelled.clone(),
        )
        .await
        .map_err(CommandError::from)?;
        table_result.column_types = schema.columns.iter().map(|c| c.data_type.clone()).collect();
        total_bytes += serde_json::to_vec(&table_result)
            .map_err(|e| CommandError::Validation(e.to_string()))?
            .len();
        if total_bytes > 64 * 1024 * 1024 {
            return Err(CommandError::Validation(
                "comparison exceeds 64 MiB total review limit; compare fewer tables".into(),
            ));
        }
        out.push(table_result);
    }
    Ok(out)
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
            .get_table_schema(&tgt_handle, &table.target_table)
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
            generate_table_sql_with_preview_formatter(
                table,
                target_database.as_deref(),
                &pk,
                &column_names,
                &column_types,
                |n| quote_ident_sql(n, quote),
                |idx, _| mysql_placeholder(idx),
                preview_literal,
            )
        } else {
            generate_table_sql_with_preview_formatter(
                table,
                target_schema.as_deref(),
                &pk,
                &column_names,
                &column_types,
                |n| quote_ident_sql(n, quote),
                postgres_typed_placeholder,
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
            "UPDATE `target` SET `a` = ? WHERE `id` = ?"
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
