//! Batch INSERT execute path (same-family and IR).

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use datazen_driver_api::TableSchema;

use crate::data_sync::sql::{qualify_relation_sql, quote_ident_sql};
use crate::db::{ConnectionHandle, DatabaseDriver, Value};
use crate::transfer::adapter::SyncTargetAdapter;
use crate::transfer::ir::IRType;

use super::error::TransferError;
use super::model::{
    ColumnMapping, TableExecutionResult, TableInspectResult, TransferExecutionResult, TransferJob,
    TransferMode, WriteMode,
};
use super::structure::{drop_and_recreate_table, table_eligible_for_data};

pub struct DropCreateContext<'a> {
    pub src_adapter: &'a dyn crate::transfer::adapter::SyncSourceAdapter,
    pub tgt_adapter: &'a dyn SyncTargetAdapter,
    pub src_driver: &'a dyn DatabaseDriver,
    pub src_handle: &'a ConnectionHandle,
    pub tgt_driver: &'a dyn DatabaseDriver,
    pub tgt_handle: &'a ConnectionHandle,
    pub source_schemas: &'a HashMap<String, TableSchema>,
}

pub enum ValueFormatter<'a> {
    SameFamily,
    Ir {
        tgt_adapter: &'a dyn SyncTargetAdapter,
        source_column_ir_types: &'a HashMap<String, HashMap<String, IRType>>,
    },
}

/// Logical relation identity keeps catalog/database and schema separate. Schema
/// defaults are resolved at the command boundary before execution reaches here.
pub fn is_self_table_overwrite(
    source: &super::model::Endpoint,
    target: &super::model::Endpoint,
    source_table: &str,
    target_table: &str,
) -> bool {
    source.db_session_id == target.db_session_id
        && source.database == target.database
        && source.normalized_schema() == target.normalized_schema()
        && source_table == target_table
}

pub fn active_column_mappings(mappings: &[ColumnMapping]) -> Vec<&ColumnMapping> {
    mappings.iter().filter(|m| !m.skip).collect()
}

#[allow(dead_code)] // tested; thin wrapper over build_truncate_sql_ref
pub fn build_truncate_sql(table: &str, quote: char) -> String {
    build_truncate_sql_ref(&quote_ident_sql(table, quote))
}

pub fn build_truncate_sql_ref(table_ref: &str) -> String {
    format!("TRUNCATE TABLE {table_ref}")
}

pub fn map_row_values(
    source_row: &[Option<Value>],
    source_schema: &TableSchema,
    columns: &[&ColumnMapping],
) -> Result<Vec<Option<Value>>, TransferError> {
    if source_row.len() != columns.len() {
        return Err(TransferError::validation(format!(
            "projected row has {} values, expected {}",
            source_row.len(),
            columns.len()
        )));
    }
    for col in columns {
        if !source_schema
            .columns
            .iter()
            .any(|c| c.name == col.source_column)
        {
            return Err(TransferError::validation(format!(
                "source column '{}' not found",
                col.source_column
            )));
        }
    }
    // SELECT already follows active mappings, including reordered/subset columns.
    Ok(source_row.to_vec())
}

pub async fn execute_transfer_data(
    src_driver: &dyn DatabaseDriver,
    src_handle: &ConnectionHandle,
    tgt_driver: &dyn DatabaseDriver,
    tgt_handle: &ConnectionHandle,
    job: &TransferJob,
    inspected: &[TableInspectResult],
    source_schemas: &HashMap<String, TableSchema>,
    formatter: &ValueFormatter<'_>,
    drop_create: Option<&DropCreateContext<'_>>,
    target_read_only: bool,
    cancelled: Option<Arc<AtomicBool>>,
) -> Result<TransferExecutionResult, TransferError> {
    if target_read_only {
        return Err(TransferError::validation(
            "target connection is read-only; Data Transfer cannot execute",
        ));
    }

    if !matches!(
        job.mode,
        TransferMode::Data | TransferMode::StructureAndData
    ) {
        return Ok(TransferExecutionResult {
            tables: Vec::new(),
            rows_inserted: 0,
            cancelled: false,
            partial: false,
        });
    }

    if job.write_mode.is_destructive() && !job.options.confirmed_destructive {
        return Err(TransferError::validation(
            "destructive write mode requires confirmedDestructive",
        ));
    }

    job.options.validate()?;

    let src_quote = src_driver.quote_char();
    let tgt_quote = tgt_driver.quote_char();
    let src_family = src_driver.driver_type();
    let tgt_family = tgt_driver.driver_type();
    let batch = job.options.batch_size as usize;
    let mut tables_out = Vec::new();
    let mut total_rows = 0u64;
    let mut partial = false;

    for table in inspected.iter().filter(|t| table_eligible_for_data(t, job)) {
        if let Some(flag) = &cancelled {
            if flag.load(Ordering::SeqCst) {
                return Ok(TransferExecutionResult {
                    tables: tables_out,
                    rows_inserted: total_rows,
                    cancelled: true,
                    partial: true,
                });
            }
        }

        if is_self_table_overwrite(
            &job.source,
            &job.target,
            &table.source_table,
            &table.target_table,
        ) {
            return Err(TransferError::validation(format!(
                "self-overwrite of table '{}' is not allowed",
                table.source_table
            )));
        }

        let columns = active_column_mappings(&table.column_mappings);
        if columns.is_empty() {
            tables_out.push(TableExecutionResult {
                source_table: table.source_table.clone(),
                target_table: table.target_table.clone(),
                rows_inserted: 0,
                success: false,
                error: Some("no column mappings".into()),
            });
            partial = true;
            if job.options.stop_on_error {
                break;
            }
            continue;
        }

        let Some(src_schema) = source_schemas.get(&table.source_table) else {
            tables_out.push(TableExecutionResult {
                source_table: table.source_table.clone(),
                target_table: table.target_table.clone(),
                rows_inserted: 0,
                success: false,
                error: Some("source schema not loaded".into()),
            });
            partial = true;
            if job.options.stop_on_error {
                break;
            }
            continue;
        };

        let src_table_ref = qualify_relation_sql(
            &src_family,
            Some(&job.source.database),
            job.source.schema.as_deref(),
            &table.source_table,
            src_quote,
        );
        let tgt_table_ref = qualify_relation_sql(
            &tgt_family,
            Some(&job.target.database),
            job.target.schema.as_deref(),
            &table.target_table,
            tgt_quote,
        );

        let select_cols: Vec<String> = columns
            .iter()
            .map(|c| quote_ident_sql(&c.source_column, src_quote))
            .collect();
        let mut base_sql = format!("SELECT {} FROM {}", select_cols.join(", "), src_table_ref);
        let mut source_filter_params = Vec::new();
        if let Some(source_filter) = job
            .tables
            .iter()
            .find(|mapping| mapping.source_table == table.source_table)
            .and_then(|mapping| mapping.source_filter.as_ref())
        {
            source_filter
                .validate(src_schema)
                .map_err(|error| TransferError::validation(error.to_string()))?;
            let (where_sql, params) = source_filter.build_where(
                src_quote,
                1,
                |index| {
                    src_driver
                        .parameter_placeholder(index, None)
                        .map_err(|error| TransferError::unsupported(error.to_string()))
                },
            )?;
            if let Some(where_sql) = where_sql {
                base_sql.push(' ');
                base_sql.push_str(&where_sql);
            }
            source_filter_params = params;
            if !source_filter_params.is_empty() {
                src_driver
                    .parameter_placeholder(1, None)
                    .map_err(|error| TransferError::unsupported(error.to_string()))?;
            }
        }

        // Resolve capability and scan once before any destructive target operation.
        tgt_driver
            .parameter_placeholder(1, None)
            .map_err(|e| TransferError::validation(e.to_string()))?;
        let mut scan = match super::scan::scan_rows_with_params(
            src_driver,
            src_handle,
            &base_sql,
            &source_filter_params,
            columns.iter().map(|c| c.source_column.clone()).collect(),
            cancelled.clone(),
        )
        .await
        {
            Ok(scan) => scan,
            Err(error) => {
                tables_out.push(TableExecutionResult {
                    source_table: table.source_table.clone(),
                    target_table: table.target_table.clone(),
                    rows_inserted: 0,
                    success: false,
                    error: Some(error.to_string()),
                });
                partial = true;
                if cancelled.as_ref().is_some_and(|c| c.load(Ordering::SeqCst)) {
                    return Ok(TransferExecutionResult {
                        tables: tables_out,
                        rows_inserted: total_rows,
                        cancelled: true,
                        partial,
                    });
                }
                if job.options.stop_on_error {
                    break;
                }
                continue;
            }
        };

        if job.write_mode == WriteMode::DropCreateInsert {
            let Some(ctx) = drop_create else {
                return Err(TransferError::validation(
                    "drop+create requires IR adapters",
                ));
            };
            if let Err(e) = drop_and_recreate_table(
                ctx.src_adapter,
                ctx.tgt_adapter,
                ctx.src_driver,
                ctx.src_handle,
                ctx.tgt_driver,
                ctx.tgt_handle,
                table,
                job,
                ctx.source_schemas,
            )
            .await
            {
                tables_out.push(TableExecutionResult {
                    source_table: table.source_table.clone(),
                    target_table: table.target_table.clone(),
                    rows_inserted: 0,
                    success: false,
                    error: Some(e.to_string()),
                });
                partial = true;
                if job.options.stop_on_error {
                    break;
                }
                continue;
            }
        } else if job.write_mode == WriteMode::TruncateInsert {
            let tgt_table_ref = qualify_relation_sql(
                &tgt_family,
                Some(&job.target.database),
                job.target.schema.as_deref(),
                &table.target_table,
                tgt_quote,
            );
            let truncate_sql = build_truncate_sql_ref(&tgt_table_ref);
            if let Err(e) = tgt_driver
                .execute(tgt_handle, &truncate_sql)
                .await
                .map_err(|e| TransferError::validation(e.to_string()))
            {
                tables_out.push(TableExecutionResult {
                    source_table: table.source_table.clone(),
                    target_table: table.target_table.clone(),
                    rows_inserted: 0,
                    success: false,
                    error: Some(format!("truncate failed: {e}")),
                });
                partial = true;
                if job.options.stop_on_error {
                    break;
                }
                continue;
            }
        }

        let target_schema = match super::metadata::load_table_schema(
            tgt_driver,
            tgt_handle,
            &job.target,
            &table.target_table,
        )
        .await
        {
            Ok(schema) => schema,
            Err(error) => {
                tables_out.push(TableExecutionResult {
                    source_table: table.source_table.clone(),
                    target_table: table.target_table.clone(),
                    rows_inserted: 0,
                    success: false,
                    error: Some(error.to_string()),
                });
                partial = true;
                if job.options.stop_on_error {
                    break;
                }
                continue;
            }
        };
        let tx = match tgt_driver.begin_transaction(tgt_handle).await {
            Ok(tx) => tx,
            Err(error) => {
                tables_out.push(TableExecutionResult {
                    source_table: table.source_table.clone(),
                    target_table: table.target_table.clone(),
                    rows_inserted: 0,
                    success: false,
                    error: Some(format!("cannot start data transaction: {error}")),
                });
                partial = true;
                if job.options.stop_on_error {
                    break;
                }
                continue;
            }
        };
        let mut table_rows = 0u64;
        let mut table_error: Option<String> = None;
        let mut was_cancelled = false;
        'batches: loop {
            if cancelled.as_ref().is_some_and(|c| c.load(Ordering::SeqCst)) {
                was_cancelled = true;
                table_error =
                    Some("transfer cancelled; current data transaction rolled back".into());
                break;
            }
            let rows = match scan.next_batch(batch) {
                Ok(rows) => rows,
                Err(error) => {
                    table_error = Some(error.to_string());
                    break;
                }
            };
            if rows.is_empty() {
                break;
            }
            let projected_rows = rows
                .iter()
                .map(|row| map_row_values(row, src_schema, &columns))
                .collect::<Result<Vec<_>, _>>();
            let projected_rows = match projected_rows {
                Ok(rows) => rows,
                Err(error) => {
                    table_error = Some(error.to_string());
                    break 'batches;
                }
            };
            if cancelled.as_ref().is_some_and(|c| c.load(Ordering::SeqCst)) {
                was_cancelled = true;
                table_error =
                    Some("transfer cancelled; current data transaction rolled back".into());
                break 'batches;
            }
            let statement = super::writer::bound_insert_batch(
                tgt_driver,
                &table.source_table,
                &tgt_table_ref,
                &columns,
                &target_schema,
                &projected_rows,
                formatter,
            );
            let (sql, parameters) = match statement {
                Ok(statement) => statement,
                Err(error) => {
                    table_error = Some(error.to_string());
                    break 'batches;
                }
            };
            match tgt_driver
                .execute_with_params(tgt_handle, &sql, &parameters)
                .await
            {
                Ok(affected) => {
                    table_rows += affected;
                }
                Err(error) => {
                    table_error = Some(error.to_string());
                    break 'batches;
                }
            }
        }
        if table_error.is_none() && cancelled.as_ref().is_some_and(|c| c.load(Ordering::SeqCst)) {
            was_cancelled = true;
            table_error = Some("transfer cancelled; current data transaction rolled back".into());
        }
        if table_error.is_some() {
            if let Err(error) = tgt_driver.rollback(tx).await {
                table_error = Some(format!(
                    "{}; rollback failed, outcome UNKNOWN: {error}",
                    table_error.as_deref().unwrap_or("write failed")
                ));
            }
            table_rows = 0;
            partial = true;
        } else if let Err(error) = tgt_driver.commit(tx).await {
            table_error = Some(format!("commit failed, outcome UNKNOWN: {error}"));
            table_rows = 0;
            partial = true;
        }
        total_rows += table_rows;

        tables_out.push(TableExecutionResult {
            source_table: table.source_table.clone(),
            target_table: table.target_table.clone(),
            rows_inserted: table_rows,
            success: table_error.is_none(),
            error: table_error,
        });

        if was_cancelled {
            return Ok(TransferExecutionResult {
                tables: tables_out,
                rows_inserted: total_rows,
                cancelled: true,
                partial: true,
            });
        }
        if partial && job.options.stop_on_error {
            break;
        }
    }

    Ok(TransferExecutionResult {
        tables: tables_out,
        rows_inserted: total_rows,
        cancelled: false,
        partial,
    })
}

/// Same-family convenience wrapper (kept for tests and backward compatibility).
#[allow(dead_code)]
pub async fn execute_same_family_data(
    src_driver: &dyn DatabaseDriver,
    src_handle: &ConnectionHandle,
    tgt_driver: &dyn DatabaseDriver,
    tgt_handle: &ConnectionHandle,
    job: &TransferJob,
    inspected: &[TableInspectResult],
    source_schemas: &HashMap<String, TableSchema>,
    target_read_only: bool,
    cancelled: Option<Arc<AtomicBool>>,
) -> Result<TransferExecutionResult, TransferError> {
    let formatter = ValueFormatter::SameFamily;
    execute_transfer_data(
        src_driver,
        src_handle,
        tgt_driver,
        tgt_handle,
        job,
        inspected,
        source_schemas,
        &formatter,
        None,
        target_read_only,
        cancelled,
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn self_overwrite_detected_by_complete_logical_relation() {
        let mut source = super::super::model::Endpoint {
            db_session_id: "session".into(),
            database: "catalog".into(),
            schema: None,
        };
        let mut target = source.clone();
        assert!(is_self_table_overwrite(&source, &target, "users", "users"));
        assert!(!is_self_table_overwrite(
            &source, &target, "users", "clients"
        ));
        target.schema = Some("  ".into());
        assert!(is_self_table_overwrite(&source, &target, "users", "users"));
        source.schema = Some(" selected ".into());
        target.schema = Some("selected".into());
        assert!(is_self_table_overwrite(&source, &target, "users", "users"));
        target.schema = Some("other".into());
        assert!(!is_self_table_overwrite(&source, &target, "users", "users"));
        target.schema = source.schema.clone();
        target.database = "other_catalog".into();
        assert!(!is_self_table_overwrite(&source, &target, "users", "users"));
        target.database = source.database.clone();
        target.db_session_id = "other_session".into();
        assert!(!is_self_table_overwrite(&source, &target, "users", "users"));
    }

    #[test]
    fn truncate_sql_quotes_table() {
        let sql = build_truncate_sql("users", '"');
        assert_eq!(sql, r#"TRUNCATE TABLE "users""#);
    }

    #[test]
    fn cross_family_source_select_uses_postgres_double_quotes() {
        let cols = vec![ColumnMapping {
            source_column: "id".into(),
            target_column: "id".into(),
            skip: false,
            target_native_type: None,
        }];
        let refs: Vec<&ColumnMapping> = cols.iter().collect();
        let src_quote = '"';
        let select_cols: Vec<String> = refs
            .iter()
            .map(|c| quote_ident_sql(&c.source_column, src_quote))
            .collect();
        let src_table_ref =
            qualify_relation_sql("postgresql", Some("goecoride"), None, "users", src_quote);
        let sql = format!("SELECT {} FROM {}", select_cols.join(", "), src_table_ref);
        assert_eq!(sql, r#"SELECT "id" FROM "users""#);
    }

    #[test]
    fn mysql_transfer_uses_catalog_qualified_table_refs() {
        let src_ref = qualify_relation_sql("mysql", Some("srcdb"), None, "users", '`');
        let tgt_ref = qualify_relation_sql("mysql", Some("tgtdb"), None, "users", '`');
        assert_eq!(src_ref, "`srcdb`.`users`");
        assert_eq!(tgt_ref, "`tgtdb`.`users`");
        assert_eq!(
            build_truncate_sql_ref(&tgt_ref),
            "TRUNCATE TABLE `tgtdb`.`users`"
        );
    }
}
