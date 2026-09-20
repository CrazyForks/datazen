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
use crate::transfer::adapter::{SyncSourceAdapter, SyncTargetAdapter};
use crate::transfer::ir::IRType;

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

/// Resolve a SQL-file rendering dialect from the registered driver factories.
/// A missing selection deliberately returns the live source driver so older
/// plans keep their source-dialect behavior.
pub fn resolve_target_driver(
    source_driver: Arc<dyn DatabaseDriver>,
    target: &super::model::SqlFileTarget,
) -> Result<Arc<dyn DatabaseDriver>, TransferError> {
    let Some(database_type) = target.normalized_database_type() else {
        return Ok(source_driver);
    };
    let driver = datazen_driver_api::create_driver(database_type).ok_or_else(|| {
        TransferError::validation(format!(
            "SQL file target dialect '{database_type}' is not registered in this build"
        ))
    })?;
    if !matches!(
        driver.driver_category(),
        datazen_driver_api::DriverCategory::Sql
    ) {
        return Err(TransferError::validation(format!(
            "SQL file target dialect '{database_type}' is not a SQL driver"
        )));
    }
    if driver.driver_type() != database_type {
        return Err(TransferError::validation(format!(
            "SQL file target dialect '{database_type}' resolved to '{}', which is not a stable driver id",
            driver.driver_type()
        )));
    }
    Ok(driver)
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

#[cfg(not(windows))]
fn publish_staged_file(temporary: &Path, destination: &Path) -> std::io::Result<()> {
    // POSIX rename replaces an existing destination as one atomic operation.
    fs::rename(temporary, destination)
}

#[cfg(windows)]
fn publish_staged_file(temporary: &Path, destination: &Path) -> std::io::Result<()> {
    // Windows' std::fs::rename does not replace an existing file. MoveFileExW
    // with REPLACE_EXISTING keeps the sibling staging file and destination on
    // the same volume while providing the corresponding atomic replacement.
    use std::iter::once;
    use std::os::windows::ffi::OsStrExt;

    #[link(name = "kernel32")]
    extern "system" {
        fn MoveFileExW(
            existing_file_name: *const u16,
            new_file_name: *const u16,
            flags: u32,
        ) -> i32;
    }

    const MOVEFILE_REPLACE_EXISTING: u32 = 0x1;
    const MOVEFILE_WRITE_THROUGH: u32 = 0x8;
    let temporary: Vec<u16> = temporary.as_os_str().encode_wide().chain(once(0)).collect();
    let destination: Vec<u16> = destination
        .as_os_str()
        .encode_wide()
        .chain(once(0))
        .collect();
    let replaced = unsafe {
        MoveFileExW(
            temporary.as_ptr(),
            destination.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if replaced == 0 {
        Err(std::io::Error::last_os_error())
    } else {
        Ok(())
    }
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
        publish_staged_file(&self.temporary, &self.destination)
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

fn target_table_ref(driver: &dyn DatabaseDriver, job: &TransferJob, table: &str) -> String {
    qualify_relation_sql(
        &driver.driver_type(),
        None,
        job.source.schema.as_deref(),
        table,
        driver.quote_char(),
    )
}

/// A custom DDL string is an opaque dialect-specific escape hatch. It cannot
/// be safely re-rendered when the SQL-file target dialect differs from the
/// source, so reject it before preview and execution instead of emitting a
/// source-dialect statement into a target-dialect artifact.
pub(crate) fn validate_target_dialect_job(job: &TransferJob) -> Result<(), TransferError> {
    let Some(target) = job.sql_file_target.as_ref() else {
        return Ok(());
    };
    if target.normalized_database_type().is_none() {
        return Ok(());
    }
    if job.tables.iter().any(|mapping| {
        mapping.enabled
            && mapping
                .ddl_override
                .as_deref()
                .map(str::trim)
                .is_some_and(|ddl| !ddl.is_empty())
    }) {
        return Err(TransferError::validation(
            "custom SQL-file DDL is unavailable with an explicit target dialect; clear the DDL override and preview again",
        ));
    }
    Ok(())
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

/// Render a CREATE statement through the target dialect's IR adapter. Source
/// metadata and defaults are interpreted by the source adapter; identifiers,
/// native types, defaults, and constraints are emitted by the target adapter.
pub(crate) fn create_table_sql_with_target(
    source_adapter: &dyn SyncSourceAdapter,
    target_adapter: &dyn SyncTargetAdapter,
    target_driver: &dyn DatabaseDriver,
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
    let mapping = job
        .tables
        .iter()
        .find(|mapping| mapping.source_table == table.source_table);
    let mut ir = source_adapter.table_to_ir(schema, None);
    ir.name = table.target_table.clone();
    if let Some(mapping) = mapping {
        super::structure::apply_column_type_overrides(&mut ir, mapping, target_adapter)?;
    }
    Ok(crate::transfer::ddl::build_create_table_ddl_ref(
        &ir,
        target_adapter,
        &target_table_ref(target_driver, job, &table.target_table),
    ))
}

/// Reject source native types for which the registered IR bridge has no safe
/// cross-dialect representation. Falling back to the source type would emit
/// SQL that looks valid while changing the target schema semantics.
pub(crate) fn validate_target_ir(
    source_adapter: &dyn SyncSourceAdapter,
    source_driver: &dyn DatabaseDriver,
    target_driver: &dyn DatabaseDriver,
    schemas: &HashMap<String, TableSchema>,
) -> Result<(), TransferError> {
    if source_driver.sync_family() == target_driver.sync_family() {
        return Ok(());
    }
    for (table, schema) in schemas {
        for column in &source_adapter.table_to_ir(schema, None).columns {
            if let IRType::Other(native) = &column.ir_type {
                return Err(TransferError::unsupported(format!(
                    "target dialect '{}' has no safe IR mapping for {}.{} ({native})",
                    target_driver.driver_type(),
                    table,
                    column.name
                )));
            }
        }
    }
    Ok(())
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

fn insert_sql_with_target(
    target_driver: &dyn DatabaseDriver,
    target_adapter: &dyn SyncTargetAdapter,
    source_column_ir_types: &HashMap<String, IRType>,
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
        .map(|mapping| target_adapter.quote_ident(&mapping.target_column))
        .collect::<Vec<_>>();
    let values = mappings
        .iter()
        .zip(row.iter())
        .map(|(mapping, value)| {
            let ir_type = source_column_ir_types
                .get(&mapping.source_column)
                .ok_or_else(|| {
                    TransferError::validation(format!(
                        "missing IR type for {}.{}",
                        table.source_table, mapping.source_column
                    ))
                })?;
            let transformed = target_adapter.transform_value(value, ir_type);
            if value.is_some() && transformed.is_none() {
                return Err(TransferError::validation(format!(
                    "target dialect '{}' cannot represent {}.{}",
                    target_driver.driver_type(),
                    table.source_table,
                    mapping.source_column
                )));
            }
            Ok(target_adapter.format_literal(&transformed, ir_type))
        })
        .collect::<Result<Vec<_>, TransferError>>()?;
    Ok(format!(
        "INSERT INTO {} ({}) VALUES ({})",
        target_table_ref(target_driver, job, &table.target_table),
        columns.join(", "),
        values.join(", ")
    ))
}

/// Execute a transfer into one atomically published SQL file using the source
/// dialect for identifiers, DDL, and literal formatting. This wrapper keeps
/// the original source-dialect contract for old callers and plans.
pub async fn execute(
    driver: &dyn DatabaseDriver,
    handle: &ConnectionHandle,
    job: &TransferJob,
    inspected: &[TableInspectResult],
    source_schemas: &HashMap<String, TableSchema>,
    destination: PathBuf,
    cancelled: Option<Arc<AtomicBool>>,
) -> Result<TransferExecutionResult, TransferError> {
    execute_with_target(
        driver,
        driver,
        None,
        None,
        handle,
        job,
        inspected,
        source_schemas,
        destination,
        cancelled,
    )
    .await
}

/// Execute a SQL-file transfer with independent source and target dialects.
/// Source scanning remains owned by `source_driver`; the target driver and IR
/// adapters own every emitted identifier, type, default, and literal.
pub async fn execute_with_target(
    source_driver: &dyn DatabaseDriver,
    target_driver: &dyn DatabaseDriver,
    source_adapter: Option<&dyn SyncSourceAdapter>,
    target_adapter: Option<&dyn SyncTargetAdapter>,
    handle: &ConnectionHandle,
    job: &TransferJob,
    inspected: &[TableInspectResult],
    source_schemas: &HashMap<String, TableSchema>,
    destination: PathBuf,
    cancelled: Option<Arc<AtomicBool>>,
) -> Result<TransferExecutionResult, TransferError> {
    let ir_rendering = source_adapter.zip(target_adapter);
    if (source_adapter.is_some()) != (target_adapter.is_some()) {
        return Err(TransferError::validation(
            "SQL file target requires both source and target IR adapters",
        ));
    }
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
        let target_ref = target_table_ref(target_driver, job, &table.target_table);
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
                None => match ir_rendering {
                    Some((src_adapter, tgt_adapter)) => create_table_sql_with_target(
                        src_adapter,
                        tgt_adapter,
                        target_driver,
                        job,
                        table,
                        schema,
                    )?,
                    None => create_table_sql(target_driver, job, table, schema)?,
                },
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
                .map(|mapping| quote_ident_sql(&mapping.source_column, source_driver.quote_char()))
                .collect::<Vec<_>>()
                .join(", "),
            source_table_ref(source_driver, job, &table.source_table)
        );
        let scope = super::recordset::build_source_scope(
            schema,
            mapping.and_then(|mapping| mapping.source_filter.as_ref()),
            mapping.and_then(|mapping| mapping.recordset.as_ref()),
            source_driver.quote_char(),
            |index, data_type| {
                source_driver
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
        let ir_types = match ir_rendering {
            Some((src_adapter, _)) => Some(
                src_adapter
                    .table_to_ir(schema, None)
                    .columns
                    .into_iter()
                    .map(|column| (column.name, column.ir_type))
                    .collect::<HashMap<_, _>>(),
            ),
            None => None,
        };
        let mut scan = super::scan::scan_rows_with_params(
            source_driver,
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
                let rendered = match ir_rendering {
                    Some((_src_adapter, tgt_adapter)) => {
                        let Some(ir_types) = ir_types.as_ref() else {
                            return Err(TransferError::validation(
                                "source IR adapter is unavailable",
                            ));
                        };
                        insert_sql_with_target(
                            target_driver,
                            tgt_adapter,
                            &ir_types,
                            job,
                            table,
                            &mappings,
                            &row,
                        )
                    }
                    None => insert_sql(target_driver, job, table, &mappings, &row),
                };
                match rendered {
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
    use crate::data_transfer::model::TableMapping;
    use crate::testing::mock_driver::MockDriver;
    use crate::transfer::adapter::SyncSourceAdapter;
    use datazen_driver_api::{ColumnSchema, TableSchema};
    use datazen_driver_mysql::MysqlSyncAdapter;
    use datazen_driver_postgres::PgSyncAdapter;

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
                database_type: None,
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
    fn explicit_mysql_target_changes_identifiers_literals_and_ddl() {
        let target_driver = datazen_driver_mysql::MysqlDriver::new(false);
        let source_adapter = PgSyncAdapter;
        let target_adapter = MysqlSyncAdapter { is_mariadb: false };
        let job = TransferJob {
            source: super::super::model::Endpoint {
                db_session_id: "s".into(),
                database: "db".into(),
                schema: Some("public".into()),
            },
            target: None,
            sql_file_target: Some(super::super::model::SqlFileTarget {
                file_token: "token".into(),
                database_type: Some("mysql".into()),
            }),
            mode: TransferMode::Structure,
            write_mode: WriteMode::Insert,
            tables: vec![TableMapping {
                source_table: "users".into(),
                target_table: "users".into(),
                create_new: true,
                enabled: true,
                column_mappings: vec![
                    ColumnMapping {
                        source_column: "id".into(),
                        target_column: "id".into(),
                        skip: false,
                        target_native_type: None,
                    },
                    ColumnMapping {
                        source_column: "enabled".into(),
                        target_column: "is_enabled".into(),
                        skip: false,
                        target_native_type: None,
                    },
                ],
                ddl_override: None,
                source_filter: None,
                recordset: None,
            }],
            options: Default::default(),
        };
        let schema = TableSchema {
            table_name: "users".into(),
            columns: vec![
                ColumnSchema {
                    name: "id".into(),
                    data_type: "integer".into(),
                    nullable: false,
                    default_value: None,
                    comment: None,
                    is_primary_key: true,
                    is_auto_increment: false,
                },
                ColumnSchema {
                    name: "enabled".into(),
                    data_type: "boolean".into(),
                    nullable: false,
                    default_value: None,
                    comment: None,
                    is_primary_key: false,
                    is_auto_increment: false,
                },
            ],
            primary_keys: vec!["id".into()],
            indexes: vec![],
            foreign_keys: vec![],
        };
        let table = TableInspectResult {
            source_table: "users".into(),
            target_table: "users".into(),
            status: super::super::model::TableMappingStatus::CreateNew,
            create_new: true,
            enabled: true,
            column_mappings: vec![
                ColumnMapping {
                    source_column: "id".into(),
                    target_column: "id".into(),
                    skip: false,
                    target_native_type: None,
                },
                ColumnMapping {
                    source_column: "enabled".into(),
                    target_column: "is_enabled".into(),
                    skip: false,
                    target_native_type: None,
                },
            ],
            source_columns: vec!["id".into(), "enabled".into()],
            source_primary_keys: vec!["id".into()],
            target_columns: vec![],
            source_column_types: HashMap::new(),
            incompatible_reason: None,
            source_row_count: None,
            recordset: None,
        };
        let ddl = create_table_sql_with_target(
            &source_adapter,
            &target_adapter,
            &target_driver,
            &job,
            &table,
            &schema,
        )
        .unwrap();
        assert!(ddl.contains("CREATE TABLE `users`"), "{ddl}");
        assert!(ddl.contains("`id` INT NOT NULL"), "{ddl}");
        assert!(ddl.contains("`is_enabled` TINYINT(1) NOT NULL"), "{ddl}");
        assert!(ddl.contains("PRIMARY KEY (`id`)"), "{ddl}");

        let ir_types = source_adapter
            .table_to_ir(&schema, None)
            .columns
            .into_iter()
            .map(|column| (column.name, column.ir_type))
            .collect::<HashMap<_, _>>();
        let mappings = active_column_mappings(&table.column_mappings);
        let sql = insert_sql_with_target(
            &target_driver,
            &target_adapter,
            &ir_types,
            &job,
            &table,
            &mappings,
            &[Some(Value::Integer(7)), Some(Value::Bool(true))],
        )
        .unwrap();
        assert!(
            sql.contains("INSERT INTO `users` (`id`, `is_enabled`) VALUES (7, 1)"),
            "{sql}"
        );
    }

    #[test]
    fn unregistered_sql_file_dialect_is_rejected() {
        let source: std::sync::Arc<dyn DatabaseDriver> =
            MockDriver::new("postgresql", Default::default());
        let target = super::super::model::SqlFileTarget {
            file_token: "token".into(),
            database_type: Some("not-a-registered-driver".into()),
        };
        let result = resolve_target_driver(source, &target);
        assert!(result.is_err(), "unknown dialect must fail");
        let error = result
            .err()
            .map(|error| error.to_string())
            .unwrap_or_default();
        assert!(error.contains("not registered"));
    }

    #[test]
    fn atomic_writer_replaces_existing_destination_on_supported_platforms() {
        let dir = tempfile::tempdir().unwrap();
        let destination = dir.path().join("out.sql");
        fs::write(&destination, "old").unwrap();
        let mut output = AtomicSqlFile::create(destination.clone()).unwrap();
        output.line("new").unwrap();
        assert_eq!(fs::read_to_string(&destination).unwrap(), "old");
        output.finish().unwrap();
        assert_eq!(fs::read_to_string(destination).unwrap(), "new\n");
    }

    #[test]
    fn atomic_writer_drops_staging_without_touching_existing_destination() {
        let dir = tempfile::tempdir().unwrap();
        let destination = dir.path().join("out.sql");
        fs::write(&destination, "old").unwrap();
        let mut output = AtomicSqlFile::create(destination.clone()).unwrap();
        output.line("partial").unwrap();
        drop(output);
        assert_eq!(fs::read_to_string(destination).unwrap(), "old");
    }
}
