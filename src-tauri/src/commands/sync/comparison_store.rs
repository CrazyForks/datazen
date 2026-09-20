//! Owner-managed storage for reviewed Data Sync comparisons.
//!
//! A comparison is built in memory by the merge engine, then handed to this
//! store before it becomes part of an immutable plan. Small comparisons stay
//! inline for the common path. Larger comparisons are serialized into a
//! private, uniquely-created temporary file so an available plan does not keep
//! all row values resident in the process for its full TTL.

use crate::data_sync::ComparisonResult;
use serde::Deserialize;
use serde_json::Deserializer;
use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use uuid::Uuid;

#[cfg(unix)]
use std::os::unix::fs::OpenOptionsExt;

/// Comparisons above this serialized size are kept in a temporary file.
///
/// This is deliberately below the old 64 MiB plan limit. The IPC preview is
/// still compatible and can be large, but the server-owned plan no longer
/// pins the complete row payload in the plan registry.
pub(crate) const COMPARISON_MEMORY_LIMIT: usize = 8 * 1024 * 1024;

#[derive(Debug)]
enum Storage {
    Inline(ComparisonResult),
    File { path: PathBuf, bytes: u64 },
}

#[derive(Debug)]
struct Inner {
    storage: Storage,
}

impl Drop for Inner {
    fn drop(&mut self) {
        if let Storage::File { path, .. } = &self.storage {
            if let Err(error) = fs::remove_file(path) {
                if error.kind() != io::ErrorKind::NotFound {
                    tracing::warn!(path = %path.display(), error = %error, "failed to remove Data Sync comparison store");
                }
            }
        }
    }
}

/// Cloneable owner of a reviewed comparison. Clones share the temporary file
/// owner and the file is removed when the last plan/operation reference drops.
#[derive(Clone, Debug)]
pub(crate) struct ComparisonStore {
    inner: Arc<Inner>,
}

impl ComparisonStore {
    pub(crate) fn from_comparison(comparison: ComparisonResult) -> Result<Self, String> {
        let mut writer = SpillWriter::new();
        if let Err(error) = serde_json::to_writer(&mut writer, &comparison) {
            writer.cleanup();
            return Err(format!("cannot serialize Data Sync comparison: {error}"));
        }
        let storage = writer.finish(comparison)?;
        Ok(Self {
            inner: Arc::new(Inner { storage }),
        })
    }

    pub(crate) fn load(&self) -> Result<ComparisonResult, String> {
        match &self.inner.storage {
            Storage::Inline(comparison) => Ok(comparison.clone()),
            Storage::File { path, .. } => {
                let file = File::open(path)
                    .map_err(|error| format!("cannot open Data Sync comparison store: {error}"))?;
                let mut deserializer = Deserializer::from_reader(file);
                let comparison =
                    ComparisonResult::deserialize(&mut deserializer).map_err(|error| {
                        format!("cannot decode Data Sync comparison store: {error}")
                    })?;
                deserializer.end().map_err(|error| {
                    format!("Data Sync comparison store contains trailing data: {error}")
                })?;
                Ok(comparison)
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
            Storage::File { path, .. } => Some(path.clone()),
        }
    }

    #[cfg(test)]
    pub(crate) fn bytes(&self) -> usize {
        match &self.inner.storage {
            Storage::Inline(comparison) => serde_json::to_vec(comparison).unwrap().len(),
            Storage::File { bytes, .. } => *bytes as usize,
        }
    }
}

struct SpillWriter {
    memory: Vec<u8>,
    file: Option<(File, PathBuf, u64)>,
}

impl SpillWriter {
    fn new() -> Self {
        Self {
            memory: Vec::new(),
            file: None,
        }
    }

    fn spill(&mut self) -> io::Result<()> {
        if self.file.is_some() {
            return Ok(());
        }
        let directory = comparison_store_directory();
        fs::create_dir_all(&directory)?;
        let (file, path) = create_unique_file(&directory)?;
        let mut file = file;
        file.write_all(&self.memory)?;
        let bytes = self.memory.len() as u64;
        self.memory.clear();
        self.file = Some((file, path, bytes));
        Ok(())
    }

    fn finish(mut self, comparison: ComparisonResult) -> Result<Storage, String> {
        if let Some((mut file, path, bytes)) = self.file.take() {
            file.flush()
                .map_err(|error| format!("cannot flush Data Sync comparison store: {error}"))?;
            return Ok(Storage::File { path, bytes });
        }
        Ok(Storage::Inline(comparison))
    }

    fn cleanup(&mut self) {
        if let Some((_, path, _)) = self.file.take() {
            let _ = fs::remove_file(path);
        }
    }
}

impl Write for SpillWriter {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        if self.file.is_none()
            && self.memory.len().saturating_add(bytes.len()) <= COMPARISON_MEMORY_LIMIT
        {
            self.memory.extend_from_slice(bytes);
            return Ok(bytes.len());
        }
        if self.file.is_none() {
            self.spill()?;
        }
        let Some((file, _, total)) = self.file.as_mut() else {
            return Err(io::Error::other(
                "comparison store spill file was not initialized",
            ));
        };
        file.write_all(bytes)?;
        *total = total.saturating_add(bytes.len() as u64);
        Ok(bytes.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        if let Some((file, _, _)) = self.file.as_mut() {
            file.flush()
        } else {
            Ok(())
        }
    }
}

fn comparison_store_directory() -> PathBuf {
    std::env::temp_dir().join("datazen-sync-comparisons")
}

fn create_unique_file(directory: &PathBuf) -> io::Result<(File, PathBuf)> {
    for _ in 0..8 {
        let path = directory.join(format!("comparison-{}.json", Uuid::new_v4()));
        match create_new_file(&path) {
            Ok(file) => return Ok((file, path)),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error),
        }
    }
    Err(io::Error::new(
        io::ErrorKind::AlreadyExists,
        "could not allocate a unique Data Sync comparison store file",
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
    use datazen_driver_api::Value;

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

    #[test]
    fn small_comparison_stays_inline_and_round_trips() {
        let store = ComparisonStore::from_comparison(comparison(8)).unwrap();
        assert!(!store.is_spilled());
        assert_eq!(store.load().unwrap().tables.len(), 1);
    }

    #[test]
    fn large_comparison_spills_and_round_trips() {
        let store =
            ComparisonStore::from_comparison(comparison(COMPARISON_MEMORY_LIMIT + 1)).unwrap();
        let path = store.path().unwrap();
        assert!(store.is_spilled());
        assert!(path.exists());
        assert!(store.bytes() as usize > COMPARISON_MEMORY_LIMIT);
        assert_eq!(store.load().unwrap().tables[0].rows.len(), 1);
        drop(store);
        assert!(!path.exists());
    }

    #[test]
    fn malformed_store_is_rejected_and_cleaned_on_drop() {
        let store =
            ComparisonStore::from_comparison(comparison(COMPARISON_MEMORY_LIMIT + 1)).unwrap();
        let path = store.path().unwrap();
        fs::write(&path, b"not-json").unwrap();
        let error = store.load().unwrap_err();
        assert!(error.contains("cannot decode Data Sync comparison store"));
        drop(store);
        assert!(!path.exists());
    }

    #[test]
    fn cloned_owner_delays_cleanup_until_last_reference() {
        let store =
            ComparisonStore::from_comparison(comparison(COMPARISON_MEMORY_LIMIT + 1)).unwrap();
        let path = store.path().unwrap();
        let clone = store.clone();
        drop(store);
        assert!(path.exists());
        drop(clone);
        assert!(!path.exists());
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
