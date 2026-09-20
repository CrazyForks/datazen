//! Owner-managed storage for reviewed Data Sync comparisons.
//!
//! A comparison is built in memory by the merge engine, then handed to this
//! store before it becomes part of an immutable plan. Small comparisons stay
//! inline for the common path. Larger comparisons are written to a private,
//! process-local directory containing a manifest and one indexed framed row
//! file per table. Page reads therefore seek directly to the requested table
//! and row range without deserializing the complete comparison.

use crate::data_sync::{ComparisonResult, RowChange, TableResult};
use serde::{Deserialize, Serialize};
use serde_json::Deserializer;
use std::fs::{self, File, OpenOptions};
use std::io::{self, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use uuid::Uuid;

#[cfg(test)]
use datazen_driver_api::Value;
#[cfg(test)]
use std::sync::atomic::{AtomicUsize, Ordering};

#[cfg(unix)]
use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt, PermissionsExt};

/// Comparisons at or below this serialized size remain inline.
pub(crate) const COMPARISON_MEMORY_LIMIT: usize = 8 * 1024 * 1024;

const DISK_FORMAT_VERSION: u32 = 1;
const MANIFEST_FILE: &str = "manifest.json";
const ROW_FILE_PREFIX: &str = "table-";
const ROW_FILE_SUFFIX: &str = ".rows";

#[derive(Debug)]
enum Storage {
    Inline(ComparisonResult),
    File {
        directory: PathBuf,
        manifest: PathBuf,
        bytes: u64,
    },
}

#[derive(Debug)]
struct Inner {
    storage: Storage,
    #[cfg(test)]
    full_load_calls: AtomicUsize,
}

impl Drop for Inner {
    fn drop(&mut self) {
        if let Storage::File { directory, .. } = &self.storage {
            if let Err(error) = fs::remove_dir_all(directory) {
                if error.kind() != io::ErrorKind::NotFound {
                    tracing::warn!(
                        path = %directory.display(),
                        error = %error,
                        "failed to remove Data Sync comparison store"
                    );
                }
            }
        }
    }
}

/// Metadata required to render summaries without loading any row payloads.
#[derive(Debug, Clone)]
pub(crate) struct ComparisonTableMetadata {
    pub(crate) table: TableResult,
    pub(crate) row_count: usize,
    pub(crate) unchanged_count: usize,
    pub(crate) insert_count: usize,
    pub(crate) update_count: usize,
    pub(crate) delete_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RowOffset {
    /// Offset of the JSON payload, immediately after the frame length prefix.
    offset: u64,
    length: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DiskTable {
    /// `rows` is deliberately empty in the manifest. Row payloads live in the
    /// framed file named by `rows_file`.
    table: TableResult,
    rows_file: String,
    row_count: usize,
    unchanged_count: usize,
    insert_count: usize,
    update_count: usize,
    delete_count: usize,
    offsets: Vec<RowOffset>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DiskManifest {
    format_version: u32,
    tables: Vec<DiskTable>,
}

/// Cloneable owner of a reviewed comparison. Clones share the temporary
/// directory owner and it is removed when the last plan/operation reference
/// drops.
#[derive(Clone, Debug)]
pub(crate) struct ComparisonStore {
    inner: Arc<Inner>,
}

impl ComparisonStore {
    pub(crate) fn from_comparison(comparison: ComparisonResult) -> Result<Self, String> {
        let mut probe = SizeProbe::new(COMPARISON_MEMORY_LIMIT);
        serde_json::to_writer(&mut probe, &comparison)
            .map_err(|error| format!("cannot serialize Data Sync comparison: {error}"))?;

        let storage = if probe.overflowed() {
            write_indexed_store(&comparison, probe.total())?
        } else {
            Storage::Inline(comparison)
        };
        Ok(Self {
            inner: Arc::new(Inner {
                storage,
                #[cfg(test)]
                full_load_calls: AtomicUsize::new(0),
            }),
        })
    }

    /// Reload the complete comparison for SQL generation and execution. This
    /// is intentionally separate from `load_table_page`, whose page contract
    /// never calls this method.
    pub(crate) fn load(&self) -> Result<ComparisonResult, String> {
        #[cfg(test)]
        self.inner.full_load_calls.fetch_add(1, Ordering::Relaxed);

        match &self.inner.storage {
            Storage::Inline(comparison) => Ok(comparison.clone()),
            Storage::File {
                directory,
                manifest,
                ..
            } => {
                let manifest = read_manifest(manifest, directory)?;
                let mut tables = Vec::with_capacity(manifest.tables.len());
                for table in &manifest.tables {
                    let mut restored = table.table.clone();
                    restored.rows = read_all_rows(directory, table)?;
                    if restored.rows.len() != table.row_count {
                        return Err(format!(
                            "Data Sync comparison store row count mismatch for {} -> {}",
                            restored.source_table, restored.target_table
                        ));
                    }
                    tables.push(restored);
                }
                Ok(ComparisonResult::new(tables))
            }
        }
    }

    /// Return table metadata and counts without deserializing row payloads.
    pub(crate) fn summaries(&self) -> Result<Vec<ComparisonTableMetadata>, String> {
        match &self.inner.storage {
            Storage::Inline(comparison) => {
                Ok(comparison.tables.iter().map(metadata_from_table).collect())
            }
            Storage::File {
                directory,
                manifest,
                ..
            } => {
                let manifest = read_manifest(manifest, directory)?;
                Ok(manifest
                    .tables
                    .iter()
                    .map(metadata_from_disk_table)
                    .collect())
            }
        }
    }

    /// Read only one table's requested row range. The file-backed path opens
    /// exactly the selected table file and seeks to each indexed row frame.
    pub(crate) fn load_table_page(
        &self,
        source_table: &str,
        target_table: &str,
        offset: usize,
        limit: usize,
    ) -> Result<Vec<RowChange>, String> {
        if limit == 0 {
            return Err("comparison page limit must be greater than zero".into());
        }
        match &self.inner.storage {
            Storage::Inline(comparison) => {
                let table = comparison
                    .tables
                    .iter()
                    .find(|table| {
                        table.source_table == source_table && table.target_table == target_table
                    })
                    .ok_or_else(|| "table does not belong to the comparison plan".to_string())?;
                if offset > table.rows.len() {
                    return Err("comparison page offset is outside the comparison result".into());
                }
                let end = offset.saturating_add(limit).min(table.rows.len());
                Ok(table.rows[offset..end].to_vec())
            }
            Storage::File {
                directory,
                manifest,
                ..
            } => {
                let manifest = read_manifest(manifest, directory)?;
                let table = manifest
                    .tables
                    .iter()
                    .find(|table| {
                        table.table.source_table == source_table
                            && table.table.target_table == target_table
                    })
                    .ok_or_else(|| "table does not belong to the comparison plan".to_string())?;
                if offset > table.row_count {
                    return Err("comparison page offset is outside the comparison result".into());
                }
                let end = offset.saturating_add(limit).min(table.row_count);
                read_rows(directory, table, offset, end)
            }
        }
    }

    #[cfg(test)]
    pub(crate) fn is_spilled(&self) -> bool {
        matches!(self.inner.storage, Storage::File { .. })
    }

    #[cfg(test)]
    pub(crate) fn path(&self) -> Option<PathBuf> {
        match &self.inner.storage {
            Storage::Inline(_) => None,
            Storage::File { manifest, .. } => Some(manifest.clone()),
        }
    }

    #[cfg(test)]
    pub(crate) fn directory(&self) -> Option<PathBuf> {
        match &self.inner.storage {
            Storage::Inline(_) => None,
            Storage::File { directory, .. } => Some(directory.clone()),
        }
    }

    #[cfg(test)]
    pub(crate) fn bytes(&self) -> usize {
        match &self.inner.storage {
            Storage::Inline(comparison) => serde_json::to_vec(comparison).unwrap().len(),
            Storage::File { bytes, .. } => *bytes as usize,
        }
    }

    #[cfg(test)]
    pub(crate) fn full_load_calls(&self) -> usize {
        self.inner.full_load_calls.load(Ordering::Relaxed)
    }
}

fn metadata_from_table(table: &TableResult) -> ComparisonTableMetadata {
    ComparisonTableMetadata {
        table: TableResult {
            rows: Vec::new(),
            ..table.clone()
        },
        row_count: table.rows.len(),
        unchanged_count: table.unchanged_row_count(),
        insert_count: table.insert_count(),
        update_count: table.update_count(),
        delete_count: table.delete_count(),
    }
}

fn metadata_from_disk_table(table: &DiskTable) -> ComparisonTableMetadata {
    ComparisonTableMetadata {
        table: table.table.clone(),
        row_count: table.row_count,
        unchanged_count: table.unchanged_count,
        insert_count: table.insert_count,
        update_count: table.update_count,
        delete_count: table.delete_count,
    }
}

fn disk_table_from_table(index: usize, table: &TableResult, offsets: Vec<RowOffset>) -> DiskTable {
    let metadata = metadata_from_table(table);
    let rows_file = format!("{ROW_FILE_PREFIX}{index}{ROW_FILE_SUFFIX}");
    DiskTable {
        table: metadata.table,
        rows_file,
        row_count: metadata.row_count,
        unchanged_count: metadata.unchanged_count,
        insert_count: metadata.insert_count,
        update_count: metadata.update_count,
        delete_count: metadata.delete_count,
        offsets,
    }
}

fn write_indexed_store(
    comparison: &ComparisonResult,
    serialized_size: usize,
) -> Result<Storage, String> {
    let directory = create_unique_directory()
        .map_err(|error| format!("cannot create Data Sync comparison store directory: {error}"))?;
    let result = (|| {
        let mut tables = Vec::with_capacity(comparison.tables.len());
        for (index, table) in comparison.tables.iter().enumerate() {
            let rows_file = format!("{ROW_FILE_PREFIX}{index}{ROW_FILE_SUFFIX}");
            let path = directory.join(&rows_file);
            let mut file = create_new_file(&path)
                .map_err(|error| format!("cannot create Data Sync comparison row file: {error}"))?;
            let mut offsets = Vec::with_capacity(table.rows.len());
            for row in &table.rows {
                let payload = serde_json::to_vec(row).map_err(|error| {
                    format!("cannot serialize Data Sync comparison row: {error}")
                })?;
                let length = u64::try_from(payload.len())
                    .map_err(|_| "Data Sync comparison row is too large".to_string())?;
                file.write_all(&length.to_le_bytes())
                    .map_err(|error| format!("cannot write Data Sync comparison row: {error}"))?;
                let offset = file
                    .stream_position()
                    .map_err(|error| format!("cannot index Data Sync comparison row: {error}"))?;
                file.write_all(&payload)
                    .map_err(|error| format!("cannot write Data Sync comparison row: {error}"))?;
                offsets.push(RowOffset { offset, length });
            }
            file.flush()
                .map_err(|error| format!("cannot flush Data Sync comparison row file: {error}"))?;
            tables.push(disk_table_from_table(index, table, offsets));
        }

        let manifest_path = directory.join(MANIFEST_FILE);
        let mut manifest_file = create_new_file(&manifest_path)
            .map_err(|error| format!("cannot create Data Sync comparison manifest: {error}"))?;
        let manifest = DiskManifest {
            format_version: DISK_FORMAT_VERSION,
            tables,
        };
        serde_json::to_writer(&mut manifest_file, &manifest)
            .map_err(|error| format!("cannot write Data Sync comparison manifest: {error}"))?;
        manifest_file
            .flush()
            .map_err(|error| format!("cannot flush Data Sync comparison manifest: {error}"))?;
        let bytes = directory_bytes(&directory)?;
        Ok(Storage::File {
            directory: directory.clone(),
            manifest: manifest_path,
            bytes: bytes.max(serialized_size as u64),
        })
    })();
    if result.is_err() {
        let _ = fs::remove_dir_all(&directory);
    }
    result
}

fn directory_bytes(directory: &Path) -> Result<u64, String> {
    let entries = fs::read_dir(directory)
        .map_err(|error| format!("cannot inspect Data Sync comparison store: {error}"))?;
    let mut total = 0u64;
    for entry in entries {
        let entry =
            entry.map_err(|error| format!("cannot inspect Data Sync comparison store: {error}"))?;
        let metadata = entry
            .metadata()
            .map_err(|error| format!("cannot inspect Data Sync comparison store: {error}"))?;
        total = total.saturating_add(metadata.len());
    }
    Ok(total)
}

fn read_manifest(path: &Path, directory: &Path) -> Result<DiskManifest, String> {
    let file = File::open(path)
        .map_err(|error| format!("cannot open Data Sync comparison store manifest: {error}"))?;
    let mut deserializer = Deserializer::from_reader(file);
    let manifest = DiskManifest::deserialize(&mut deserializer)
        .map_err(|error| format!("cannot decode Data Sync comparison store manifest: {error}"))?;
    deserializer.end().map_err(|error| {
        format!("Data Sync comparison store manifest contains trailing data: {error}")
    })?;
    validate_manifest(&manifest, directory)?;
    Ok(manifest)
}

fn validate_manifest(manifest: &DiskManifest, directory: &Path) -> Result<(), String> {
    if manifest.format_version != DISK_FORMAT_VERSION {
        return Err("unsupported Data Sync comparison store format".into());
    }
    let mut identities = std::collections::HashSet::new();
    for table in &manifest.tables {
        if !table.table.rows.is_empty() {
            return Err("Data Sync comparison manifest unexpectedly contains row payloads".into());
        }
        if !identities.insert((
            table.table.source_table.clone(),
            table.table.target_table.clone(),
        )) {
            return Err("Data Sync comparison manifest contains duplicate tables".into());
        }
        if table.row_count != table.offsets.len() {
            return Err("Data Sync comparison manifest row index is inconsistent".into());
        }
        let file_name = Path::new(&table.rows_file);
        if file_name.components().count() != 1
            || file_name.file_name().and_then(|name| name.to_str())
                != Some(table.rows_file.as_str())
            || !table.rows_file.starts_with(ROW_FILE_PREFIX)
            || !table.rows_file.ends_with(ROW_FILE_SUFFIX)
        {
            return Err("Data Sync comparison manifest contains an invalid row file path".into());
        }
        let path = directory.join(&table.rows_file);
        let file_len = fs::metadata(&path)
            .map_err(|error| format!("cannot inspect Data Sync comparison row file: {error}"))?
            .len();
        let mut expected_end = 0u64;
        for row in &table.offsets {
            if row.offset < 8 || row.offset < expected_end {
                return Err("Data Sync comparison manifest contains invalid row offsets".into());
            }
            let end = row
                .offset
                .checked_add(row.length)
                .ok_or_else(|| "Data Sync comparison row offset overflows".to_string())?;
            expected_end = end;
        }
        if file_len != expected_end {
            return Err("Data Sync comparison row file length does not match its index".into());
        }
    }
    Ok(())
}

fn read_all_rows(directory: &Path, table: &DiskTable) -> Result<Vec<RowChange>, String> {
    read_rows(directory, table, 0, table.row_count)
}

fn read_rows(
    directory: &Path,
    table: &DiskTable,
    start: usize,
    end: usize,
) -> Result<Vec<RowChange>, String> {
    if start > end || end > table.row_count {
        return Err("Data Sync comparison page range is outside the indexed table".into());
    }
    let path = directory.join(&table.rows_file);
    let mut file = File::open(&path)
        .map_err(|error| format!("cannot open Data Sync comparison row file: {error}"))?;
    let mut rows = Vec::with_capacity(end.saturating_sub(start));
    for index in start..end {
        let row = &table.offsets[index];
        let frame_prefix = row
            .offset
            .checked_sub(8)
            .ok_or_else(|| "Data Sync comparison row offset is invalid".to_string())?;
        file.seek(SeekFrom::Start(frame_prefix))
            .map_err(|error| format!("cannot seek Data Sync comparison row: {error}"))?;
        let mut length_bytes = [0u8; 8];
        file.read_exact(&mut length_bytes)
            .map_err(|error| format!("cannot read Data Sync comparison row frame: {error}"))?;
        let framed_length = u64::from_le_bytes(length_bytes);
        if framed_length != row.length {
            return Err("Data Sync comparison row frame length does not match its index".into());
        }
        let length = usize::try_from(row.length)
            .map_err(|_| "Data Sync comparison row is too large to read".to_string())?;
        let mut payload = vec![0u8; length];
        file.read_exact(&mut payload)
            .map_err(|error| format!("cannot read Data Sync comparison row: {error}"))?;
        let row = serde_json::from_slice(&payload)
            .map_err(|error| format!("cannot decode Data Sync comparison row: {error}"))?;
        rows.push(row);
    }
    Ok(rows)
}

struct SizeProbe {
    memory: Vec<u8>,
    limit: usize,
    total: usize,
}

impl SizeProbe {
    fn new(limit: usize) -> Self {
        Self {
            memory: Vec::new(),
            limit,
            total: 0,
        }
    }

    fn overflowed(&self) -> bool {
        self.total > self.limit
    }

    fn total(&self) -> usize {
        self.total
    }
}

impl Write for SizeProbe {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        self.total = self.total.saturating_add(bytes.len());
        if self.memory.len() < self.limit {
            let remaining = self.limit - self.memory.len();
            self.memory
                .extend_from_slice(&bytes[..bytes.len().min(remaining)]);
        }
        Ok(bytes.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

fn comparison_store_directory() -> PathBuf {
    std::env::temp_dir().join("datazen-sync-comparisons")
}

fn create_unique_directory() -> io::Result<PathBuf> {
    let root = comparison_store_directory();
    fs::create_dir_all(&root)?;
    #[cfg(unix)]
    fs::set_permissions(&root, fs::Permissions::from_mode(0o700))?;
    for _ in 0..8 {
        let directory = root.join(format!("comparison-{}", Uuid::new_v4()));
        let mut builder = fs::DirBuilder::new();
        builder.recursive(false);
        #[cfg(unix)]
        builder.mode(0o700);
        match builder.create(&directory) {
            Ok(()) => return Ok(directory),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error),
        }
    }
    Err(io::Error::new(
        io::ErrorKind::AlreadyExists,
        "could not allocate a unique Data Sync comparison store directory",
    ))
}

fn create_new_file(path: &Path) -> io::Result<File> {
    let mut options = OpenOptions::new();
    options.create_new(true).write(true).read(true);
    #[cfg(unix)]
    options.mode(0o600);
    options.open(path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::data_sync::{RowChange, SyncOptions, TableResult};

    fn comparison(payload_size: usize) -> ComparisonResult {
        let options = SyncOptions::default();
        ComparisonResult::new(vec![TableResult::matched(
            "users",
            "users",
            vec![RowChange::insert(
                vec![Value::Integer(1)],
                vec![Some(Value::String("x".repeat(payload_size)))],
                &options,
            )],
        )])
    }

    fn multi_table_comparison() -> ComparisonResult {
        let options = SyncOptions::default();
        let rows = |table: &str| {
            (0..4)
                .map(|value| {
                    RowChange::insert(
                        vec![Value::Integer(value)],
                        vec![Some(Value::String(format!(
                            "{table}-{value}-{}",
                            "x".repeat(32)
                        )))],
                        &options,
                    )
                })
                .collect()
        };
        ComparisonResult::new(vec![
            TableResult::matched("users", "users", rows("users")),
            TableResult::matched("orders", "orders", rows("orders")),
        ])
    }

    #[test]
    fn small_comparison_stays_inline_and_round_trips() {
        let store = ComparisonStore::from_comparison(comparison(8)).unwrap();
        assert!(!store.is_spilled());
        assert_eq!(store.load().unwrap().tables.len(), 1);
        assert_eq!(store.summaries().unwrap()[0].row_count, 1);
        assert_eq!(
            store.load_table_page("users", "users", 0, 1).unwrap().len(),
            1
        );
    }

    #[test]
    fn large_comparison_spills_to_private_indexed_store_and_round_trips() {
        let store =
            ComparisonStore::from_comparison(comparison(COMPARISON_MEMORY_LIMIT + 1)).unwrap();
        let path = store.path().unwrap();
        let directory = store.directory().unwrap();
        assert!(store.is_spilled());
        assert!(path.exists());
        assert!(directory.exists());
        #[cfg(unix)]
        {
            assert_eq!(
                fs::metadata(&directory).unwrap().permissions().mode() & 0o777,
                0o700
            );
            assert_eq!(
                fs::metadata(&path).unwrap().permissions().mode() & 0o777,
                0o600
            );
            assert_eq!(
                fs::metadata(directory.join("table-0.rows"))
                    .unwrap()
                    .permissions()
                    .mode()
                    & 0o777,
                0o600
            );
        }
        assert!(store.bytes() > COMPARISON_MEMORY_LIMIT);
        assert_eq!(store.load().unwrap().tables[0].rows.len(), 1);
        assert_eq!(store.summaries().unwrap()[0].row_count, 1);
        drop(store);
        assert!(!directory.exists());
    }

    #[test]
    fn indexed_page_reads_only_requested_table_and_rows_without_full_load() {
        let comparison = multi_table_comparison();
        let store = ComparisonStore::from_comparison(ComparisonResult::new(vec![
            TableResult::matched(
                "large-users",
                "large-users",
                vec![RowChange::insert(
                    vec![Value::Integer(1)],
                    vec![Some(Value::String("x".repeat(COMPARISON_MEMORY_LIMIT + 1)))],
                    &SyncOptions::default(),
                )],
            ),
            comparison.tables[1].clone(),
        ]))
        .unwrap();
        assert!(store.is_spilled());
        let before = store.full_load_calls();
        let page = store.load_table_page("orders", "orders", 1, 2).unwrap();
        assert_eq!(store.full_load_calls(), before);
        assert_eq!(page.len(), 2);
        assert!(matches!(page[0].key.as_slice(), [Value::Integer(1)]));
        assert!(matches!(page[1].key.as_slice(), [Value::Integer(2)]));
        assert!(store.load_table_page("missing", "orders", 0, 1).is_err());
        assert!(store.load_table_page("orders", "orders", 99, 1).is_err());
    }

    #[test]
    fn malformed_manifest_and_row_file_are_rejected_and_cleaned_on_drop() {
        let store =
            ComparisonStore::from_comparison(comparison(COMPARISON_MEMORY_LIMIT + 1)).unwrap();
        let manifest = store.path().unwrap();
        let directory = store.directory().unwrap();
        fs::write(&manifest, b"not-json").unwrap();
        assert!(store
            .summaries()
            .unwrap_err()
            .contains("cannot decode Data Sync comparison store"));
        drop(store);
        assert!(!directory.exists());

        let store =
            ComparisonStore::from_comparison(comparison(COMPARISON_MEMORY_LIMIT + 1)).unwrap();
        let directory = store.directory().unwrap();
        let row_path = directory.join("table-0.rows");
        fs::write(&row_path, b"broken").unwrap();
        let error = store.load().unwrap_err();
        assert!(error.contains("row file length does not match"));
        drop(store);
        assert!(!directory.exists());

        let store =
            ComparisonStore::from_comparison(comparison(COMPARISON_MEMORY_LIMIT + 1)).unwrap();
        let directory = store.directory().unwrap();
        let row_path = directory.join("table-0.rows");
        let mut bytes = fs::read(&row_path).unwrap();
        bytes[0] = bytes[0].wrapping_add(1);
        fs::write(&row_path, bytes).unwrap();
        let error = store.load_table_page("users", "users", 0, 1).unwrap_err();
        assert!(error.contains("frame length does not match"));
        drop(store);
        assert!(!directory.exists());
    }

    #[test]
    fn trailing_manifest_data_is_rejected() {
        let store =
            ComparisonStore::from_comparison(comparison(COMPARISON_MEMORY_LIMIT + 1)).unwrap();
        let path = store.path().unwrap();
        let mut bytes = fs::read(&path).unwrap();
        bytes.extend_from_slice(b" trailing");
        fs::write(&path, bytes).unwrap();
        assert!(store
            .load()
            .unwrap_err()
            .contains("store manifest contains trailing data"));
    }

    #[test]
    fn cloned_owner_delays_cleanup_until_last_reference() {
        let store =
            ComparisonStore::from_comparison(comparison(COMPARISON_MEMORY_LIMIT + 1)).unwrap();
        let directory = store.directory().unwrap();
        let clone = store.clone();
        drop(store);
        assert!(directory.exists());
        drop(clone);
        assert!(!directory.exists());
    }

    #[test]
    fn existing_path_is_rejected_instead_of_overwritten() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("collision.json");
        fs::write(&path, b"existing").unwrap();
        let error = create_new_file(&path).unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::AlreadyExists);
        assert_eq!(fs::read(&path).unwrap(), b"existing");
    }
}
