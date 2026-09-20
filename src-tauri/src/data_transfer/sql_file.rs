//! Server-owned SQL-file output for Data Transfer.
//!
//! The native save dialog registers a destination path and returns only an
//! opaque token to the webview. Execution writes a sibling temporary file and
//! publishes it with a single rename after every selected table has rendered
//! successfully. A failed or cancelled transfer therefore never leaves a
//! partially written SQL file at the requested destination.

use std::collections::HashMap;
use std::fs::{self, File, OpenOptions};
use std::io::{BufWriter, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::sync::{LazyLock, Mutex};

use datazen_driver_api::{DatabaseDriver, TableSchema};
use uuid::Uuid;

use super::error::TransferError;
use super::execute::active_column_mappings;
use super::model::{
    ColumnMapping, TableExecutionResult, TableInspectResult, TransferExecutionResult, TransferJob,
    TransferMode, WriteMode,
};
use crate::data_sync::sql::{qualify_relation_sql, quote_ident_sql};
use crate::db::{ConnectionHandle, Value};

static PATHS: LazyLock<Mutex<HashMap<String, PathBuf>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// Register a native-dialog-selected SQL path and return its opaque handle.
pub fn register_path(path: PathBuf) -> Result<String, TransferError> {
    validate_path(&path)?;
    let token = Uuid::new_v4().to_string();
    PATHS
        .lock()
        .map_err(|_| TransferError::validation("SQL file destination registry is unavailable"))?
        .insert(token.clone(), path);
    Ok(token)
}

pub fn resolve_path(token: &str) -> Result<PathBuf, TransferError> {
    if token.trim().is_empty() {
        return Err(TransferError::validation(
            "SQL file destination token is empty",
        ));
    }
    let path = PATHS
        .lock()
        .map_err(|_| TransferError::validation("SQL file destination registry is unavailable"))?
        .get(token)
        .cloned()
        .ok_or_else(|| TransferError::validation("SQL file destination is unknown or expired"))?;
    validate_path(&path)?;
    Ok(path)
}

fn validate_path(path: &Path) -> Result<(), TransferError> {
    if !path.is_absolute() {
        return Err(TransferError::validation(
            "SQL file destination must be an absolute path",
        ));
    }
    let ext = path
        .extension()
        .and_then(|v| v.to_str())
        .unwrap_or_default();
    if !ext.eq_ignore_ascii_case("sql") {
        return Err(TransferError::validation(
            "SQL file destination must use the .sql extension",
        ));
    }
    let parent = path
        .parent()
        .ok_or_else(|| TransferError::validation("SQL file destination has no parent directory"))?;
    let metadata = fs::metadata(parent).map_err(|error| {
        TransferError::validation(format!(
            "SQL file destination directory is unavailable: {error}"
        ))
    })?;
    if !metadata.is_dir() {
        return Err(TransferError::validation(
            "SQL file destination parent is not a directory",
        ));
    }
    if path.file_name().is_none() {
        return Err(TransferError::validation(
            "SQL file destination has no file name",
        ));
    }
    Ok(())
}

struct AtomicSqlFile {
    destination: PathBuf,
    temporary: PathBuf,
    writer: BufWriter<File>,
}

impl AtomicSqlFile {
    fn create(destination: PathBuf) -> Result<Self, TransferError> {
        validate_path(&destination)?;
        let parent = destination
            .parent()
            .ok_or_else(|| TransferError::validation("SQL file destination has no parent"))?;
        for _ in 0..8 {
            let temporary = parent.join(format!(
                ".{}.{}.tmp",
                destination
                    .file_name()
                    .and_then(|v| v.to_str())
                    .unwrap_or("datazen"),
                Uuid::new_v4()
            ));
            let mut options = OpenOptions::new();
            options.write(true).create_new(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                options.mode(0o600);
            }
            match options.open(&temporary) {
                Ok(file) => {
                    return Ok(Self {
                        destination,
                        temporary,
                        writer: BufWriter::new(file),
                    });
                }
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(error) => {
                    return Err(TransferError::validation(format!(
                        "cannot create SQL file staging file: {error}"
                    )))
                }
            }
        }
        Err(TransferError::validation(
            "cannot allocate SQL file staging path",
        ))
    }

    fn line(&mut self, text: &str) -> Result<(), TransferError> {
        self.writer
            .write_all(text.as_bytes())
            .and_then(|_| self.writer.write_all(b"\n"))
            .map_err(|error| TransferError::validation(format!("cannot write SQL file: {error}")))
    }

    fn finish(mut self) -> Result<(), TransferError> {
        self.writer.flush().map_err(|error| {
            TransferError::validation(format!("cannot flush SQL file: {error}"))
        })?;
        self.writer
            .get_ref()
            .sync_all()
            .map_err(|error| TransferError::validation(format!("cannot sync SQL file: {error}")))?;
        fs::rename(&self.temporary, &self.destination)
            .map_err(|error| TransferError::validation(format!("cannot publish SQL file: {error}")))
    }
}

impl Drop for AtomicSqlFile {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.temporary);
    }
}

fn table_ref(driver: &dyn DatabaseDriver, job: &TransferJob, table: &str) -> String {
    qualify_relation_sql(
        &driver.driver_type(),
        None,
        job.source.schema.as_deref(),
        table,
        driver.quote_char(),
    )
}

fn source_table_ref(driver: &dyn DatabaseDriver, job: &TransferJob, table: &str) -> String {
    qualify_relation_sql(
        &driver.driver_type(),
        Some(&job.source.database),
        job.source.schema.as_deref(),
        table,
        driver.quote_char(),
    )
}

pub(crate) fn create_table_sql(
    driver: &dyn DatabaseDriver,
    job: &TransferJob,
    table: &TableInspectResult,
    schema: &TableSchema,
) -> Result<String, TransferError> {
    let mappings = active_column_mappings(&table.column_mappings);
    if mappings.is_empty() {
        return Err(TransferError::validation(format!(
            "table '{}' has no active column mappings",
            table.source_table
        )));
    }
    let columns = mappings
        .iter()
        .map(|mapping| {
            let source = schema
                .columns
                .iter()
                .find(|column| column.name == mapping.source_column)
                .ok_or_else(|| {
                    TransferError::validation(format!(
                        "source column '{}' not found",
                        mapping.source_column
                    ))
                })?;
            let mut ddl = format!(
                "{} {}",
                quote_ident_sql(&mapping.target_column, driver.quote_char()),
                mapping
                    .target_native_type
                    .as_deref()
                    .unwrap_or(&source.data_type)
            );
            if !source.nullable {
                ddl.push_str(" NOT NULL");
            }
            if let Some(default) = source.default_value.as_deref() {
                if !default.trim().is_empty() {
                    ddl.push_str(" DEFAULT ");
                    ddl.push_str(default);
                }
            }
            Ok(ddl)
        })
        .collect::<Result<Vec<_>, TransferError>>()?;
    let mut parts = columns;
    let mapped_primary_keys: Vec<String> = schema
        .effective_primary_keys()
        .into_iter()
        .filter_map(|key| mappings.iter().find(|mapping| mapping.source_column == key))
        .map(|mapping| quote_ident_sql(&mapping.target_column, driver.quote_char()))
        .collect();
    if !mapped_primary_keys.is_empty() {
        parts.push(format!("PRIMARY KEY ({})", mapped_primary_keys.join(", ")));
    }
    Ok(format!(
        "CREATE TABLE IF NOT EXISTS {} ({})",
        table_ref(driver, job, &table.target_table),
        parts.join(", ")
    ))
}

fn insert_sql(
    driver: &dyn DatabaseDriver,
    job: &TransferJob,
    table: &TableInspectResult,
    mappings: &[&ColumnMapping],
    row: &[Option<Value>],
) -> Result<String, TransferError> {
    if mappings.len() != row.len() {
        return Err(TransferError::validation(format!(
            "projected row has {} values, expected {}",
            row.len(),
            mappings.len()
        )));
    }
    let columns = mappings
        .iter()
        .map(|mapping| quote_ident_sql(&mapping.target_column, driver.quote_char()))
        .collect::<Vec<_>>();
    let values = row
        .iter()
        .map(|value| driver.format_sql_literal(value))
        .collect::<Vec<_>>();
    Ok(format!(
        "INSERT INTO {} ({}) VALUES ({})",
        table_ref(driver, job, &table.target_table),
        columns.join(", "),
        values.join(", ")
    ))
}

/// Execute a transfer into one atomically published SQL file using the source
/// dialect for identifiers, DDL, and literal formatting.
pub async fn execute(
    driver: &dyn DatabaseDriver,
    handle: &ConnectionHandle,
    job: &TransferJob,
    inspected: &[TableInspectResult],
    source_schemas: &HashMap<String, TableSchema>,
    destination: PathBuf,
    cancelled: Option<Arc<AtomicBool>>,
) -> Result<TransferExecutionResult, TransferError> {
    job.options.validate()?;
    let mut output = AtomicSqlFile::create(destination)?;
    output.line("-- DataZen Data Transfer SQL export")?;
    output.line("BEGIN;")?;
    let mut results = Vec::new();
    let mut total = 0u64;
    let mut partial = false;

    for table in inspected
        .iter()
        .filter(|table| table.enabled && !table.source_table.is_empty())
    {
        if cancelled
            .as_ref()
            .is_some_and(|flag| flag.load(Ordering::SeqCst))
        {
            partial = true;
            break;
        }
        let mappings = active_column_mappings(&table.column_mappings);
        let Some(schema) = source_schemas.get(&table.source_table) else {
            partial = true;
            results.push(TableExecutionResult {
                source_table: table.source_table.clone(),
                target_table: table.target_table.clone(),
                rows_inserted: 0,
                success: false,
                error: Some("source schema not loaded".into()),
            });
            if job.options.stop_on_error {
                break;
            }
            continue;
        };
        let mapping = job
            .tables
            .iter()
            .find(|mapping| mapping.source_table == table.source_table);
        let target_ref = table_ref(driver, job, &table.target_table);
        if matches!(job.write_mode, WriteMode::DropCreateInsert) {
            output.line(&format!("DROP TABLE IF EXISTS {target_ref};"))?;
        } else if matches!(job.write_mode, WriteMode::TruncateInsert) {
            output.line(&format!("TRUNCATE TABLE {target_ref};"))?;
        }
        if matches!(
            job.mode,
            TransferMode::Structure | TransferMode::StructureAndData
        ) {
            let ddl = match mapping
                .and_then(|mapping| mapping.ddl_override.as_deref())
                .map(str::trim)
                .filter(|ddl| !ddl.is_empty())
            {
                Some(ddl) => ddl.to_string(),
                None => create_table_sql(driver, job, table, schema)?,
            };
            output.line(&format!("{ddl};"))?;
        }
        if !matches!(
            job.mode,
            TransferMode::Data | TransferMode::StructureAndData
        ) {
            results.push(TableExecutionResult {
                source_table: table.source_table.clone(),
                target_table: table.target_table.clone(),
                rows_inserted: 0,
                success: true,
                error: None,
            });
            continue;
        }
        if mappings.is_empty() {
            partial = true;
            results.push(TableExecutionResult {
                source_table: table.source_table.clone(),
                target_table: table.target_table.clone(),
                rows_inserted: 0,
                success: false,
                error: Some("no column mappings".into()),
            });
            if job.options.stop_on_error {
                break;
            }
            continue;
        }
        let mut query = format!(
            "SELECT {} FROM {}",
            mappings
                .iter()
                .map(|mapping| quote_ident_sql(&mapping.source_column, driver.quote_char()))
                .collect::<Vec<_>>()
                .join(", "),
            source_table_ref(driver, job, &table.source_table)
        );
        let scope = super::recordset::build_source_scope(
            schema,
            mapping.and_then(|mapping| mapping.source_filter.as_ref()),
            mapping.and_then(|mapping| mapping.recordset.as_ref()),
            driver.quote_char(),
            |index, data_type| {
                driver
                    .parameter_placeholder(index, data_type)
                    .map_err(|error| TransferError::unsupported(error.to_string()))
            },
            |column| {
                schema
                    .columns
                    .iter()
                    .find(|candidate| candidate.name == column)
                    .map(|column| column.data_type.clone())
            },
        )?;
        scope.append_to(&mut query);
        let mut scan = super::scan::scan_rows_with_params(
            driver,
            handle,
            &query,
            &scope.params,
            mappings
                .iter()
                .map(|mapping| mapping.source_column.clone())
                .collect(),
            cancelled.clone(),
        )
        .await?;
        let mut rows = 0u64;
        let mut error = None;
        loop {
            if cancelled
                .as_ref()
                .is_some_and(|flag| flag.load(Ordering::SeqCst))
            {
                error = Some("transfer cancelled; SQL file was not published".into());
                break;
            }
            let batch = scan.next_batch(job.options.batch_size as usize)?;
            if batch.is_empty() {
                break;
            }
            for row in batch {
                match insert_sql(driver, job, table, &mappings, &row) {
                    Ok(sql) => {
                        output.line(&format!("{sql};"))?;
                        rows += 1;
                    }
                    Err(err) => {
                        error = Some(err.to_string());
                        break;
                    }
                }
            }
            if error.is_some() {
                break;
            }
        }
        if let Some(err) = error {
            partial = true;
            results.push(TableExecutionResult {
                source_table: table.source_table.clone(),
                target_table: table.target_table.clone(),
                rows_inserted: 0,
                success: false,
                error: Some(err),
            });
            if job.options.stop_on_error {
                break;
            }
        } else {
            total += rows;
            results.push(TableExecutionResult {
                source_table: table.source_table.clone(),
                target_table: table.target_table.clone(),
                rows_inserted: rows,
                success: true,
                error: None,
            });
        }
    }
    if !partial
        && !cancelled
            .as_ref()
            .is_some_and(|flag| flag.load(Ordering::SeqCst))
    {
        output.line("COMMIT;")?;
        output.finish()?;
        Ok(TransferExecutionResult {
            tables: results,
            rows_inserted: total,
            cancelled: false,
            partial: false,
        })
    } else {
        Ok(TransferExecutionResult {
            tables: results,
            rows_inserted: 0,
            cancelled: cancelled
                .as_ref()
                .is_some_and(|flag| flag.load(Ordering::SeqCst)),
            partial: true,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testing::mock_driver::MockDriver;

    #[test]
    fn path_registry_rejects_non_sql_and_resolves_opaque_token() {
        let dir = tempfile::tempdir().unwrap();
        assert!(register_path(dir.path().join("out.txt")).is_err());
        let token = register_path(dir.path().join("out.sql")).unwrap();
        assert_eq!(resolve_path(&token).unwrap(), dir.path().join("out.sql"));
        assert!(resolve_path("/absolute-path-is-not-a-token").is_err());
    }

    #[test]
    fn generated_insert_uses_driver_literals_and_mapped_columns() {
        let driver = MockDriver::new("postgres", Default::default());
        let job = TransferJob {
            source: super::super::model::Endpoint {
                db_session_id: "s".into(),
                database: "db".into(),
                schema: Some("public".into()),
            },
            target: None,
            sql_file_target: Some(super::super::model::SqlFileTarget {
                file_token: "token".into(),
            }),
            mode: TransferMode::Data,
            write_mode: WriteMode::Insert,
            tables: vec![],
            options: Default::default(),
        };
        let table = TableInspectResult {
            source_table: "users".into(),
            target_table: "people".into(),
            status: super::super::model::TableMappingStatus::CreateNew,
            create_new: true,
            enabled: true,
            column_mappings: vec![ColumnMapping {
                source_column: "name".into(),
                target_column: "display_name".into(),
                skip: false,
                target_native_type: None,
            }],
            source_columns: vec!["name".into()],
            source_primary_keys: vec![],
            target_columns: vec![],
            source_column_types: HashMap::new(),
            incompatible_reason: None,
            source_row_count: None,
            recordset: None,
        };
        let mappings = active_column_mappings(&table.column_mappings);
        let sql = insert_sql(
            driver.as_ref(),
            &job,
            &table,
            &mappings,
            &[Some(Value::String("O'Reilly".into()))],
        )
        .unwrap();
        assert!(sql.contains("\"display_name\""));
        assert!(sql.contains("'O''Reilly'"));
    }

    #[test]
    fn atomic_writer_keeps_destination_unchanged_until_publish() {
        let dir = tempfile::tempdir().unwrap();
        let destination = dir.path().join("out.sql");
        fs::write(&destination, "old").unwrap();
        let mut output = AtomicSqlFile::create(destination.clone()).unwrap();
        output.line("new").unwrap();
        assert_eq!(fs::read_to_string(&destination).unwrap(), "old");
        output.finish().unwrap();
        assert_eq!(fs::read_to_string(destination).unwrap(), "new\n");
    }
}
