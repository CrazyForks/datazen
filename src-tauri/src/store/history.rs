use std::sync::Arc;

use super::favorites::NewFavorite;
use super::models::{FavoriteQuery, QueryHistoryEntry};
use super::{Store, StoreError};

impl Store {
    pub async fn add_query_history(&self, entry: QueryHistoryEntry) -> Result<(), StoreError> {
        self.history_db
            .add_query_history(entry)
            .map_err(|e| StoreError::WriteError(e.to_string()))
    }

    pub async fn get_query_history(
        &self,
        limit: usize,
        connection_id: Option<&str>,
        database: Option<&str>,
        schema: Option<&str>,
    ) -> Vec<QueryHistoryEntry> {
        self.history_db
            .get_query_history(limit, connection_id, database, schema)
            .unwrap_or_else(|e| {
                tracing::warn!(error = %e, "Failed to read query history from SQLite");
                Vec::new()
            })
    }

    pub async fn clear_query_history(&self) -> Result<(), StoreError> {
        self.purge_history(super::HistoryScope::Query, None).await?;
        Ok(())
    }

    /// Paged history read carrying the untruncated match count.
    pub async fn get_query_history_page(
        &self,
        filter: &super::history_db::QueryHistoryFilter<'_>,
    ) -> Result<super::history_db::QueryHistoryPage, StoreError> {
        self.history_db
            .query_history_page(filter)
            .map_err(|e| StoreError::WriteError(e.to_string()))
    }

    /// Delete one history row. `Ok(0)` means the id was already gone.
    pub async fn delete_query_history(&self, id: &str) -> Result<u64, StoreError> {
        self.history_db
            .delete_query_history(id)
            .map_err(|e| StoreError::WriteError(e.to_string()))
    }

    pub async fn purge_history(
        &self,
        scope: super::HistoryScope,
        retain_days: Option<u32>,
    ) -> Result<u64, StoreError> {
        self.history_db
            .purge(scope, retain_days)
            .map_err(|e| StoreError::WriteError(e.to_string()))
    }

    // ── Favorites (file-backed, see `store::favorites`) ───────────────────

    /// Directory the favorites are read from. Surfaced in the UI so the user
    /// knows which folder to point at a sync service (plan §2.6.3).
    pub fn favorites_root(&self) -> std::path::PathBuf {
        self.favorites.root()
    }

    /// Repoint the favorites at a new directory (a settings change).
    pub async fn set_favorites_root(&self, root: &str) -> Result<(), StoreError> {
        let root = root.trim();
        if root.is_empty() {
            return Err(StoreError::InitError(
                "Favorites directory must not be empty".into(),
            ));
        }
        self.favorites
            .set_root(std::path::Path::new(root))
            .map_err(|e| StoreError::InitError(e.to_string()))
    }

    /// List favorites for one connection (`None` = every connection).
    ///
    /// Disk I/O runs on the blocking pool: a cold start reads every `.sql` file
    /// under the root, and doing that on a runtime worker would stall command
    /// dispatch for the duration.
    pub async fn get_favorite_queries(
        &self,
        connection_id: Option<String>,
    ) -> Result<Vec<FavoriteQuery>, StoreError> {
        let favorites = Arc::clone(&self.favorites);
        let filter = connection_id.clone();
        tokio::task::spawn_blocking(move || favorites.list(filter.as_deref()))
            .await
            .map_err(|e| StoreError::ReadError(format!("Favorites task failed: {e}")))
    }

    /// Save a new favorite as its own `.sql` file.
    pub async fn add_favorite_query(
        &self,
        draft: NewFavorite,
    ) -> Result<FavoriteQuery, StoreError> {
        let favorites = Arc::clone(&self.favorites);
        tokio::task::spawn_blocking(move || favorites.add(draft))
            .await
            .map_err(|e| StoreError::ReadError(format!("Favorites task failed: {e}")))?
            .map_err(|e| StoreError::WriteError(e.to_string()))
    }

    /// Move a favorite into `.trash/`.
    pub async fn delete_favorite_query(&self, id: &str) -> Result<(), StoreError> {
        let favorites = Arc::clone(&self.favorites);
        let id = id.to_string();
        tokio::task::spawn_blocking(move || favorites.delete(&id))
            .await
            .map_err(|e| StoreError::ReadError(format!("Favorites task failed: {e}")))?
            .map_err(|e| StoreError::WriteError(e.to_string()))
    }

    /// Re-read the favorites directory and return the fresh listing.
    ///
    /// The in-memory cache is only invalidated by app-side writes, so a folder
    /// delivered by iCloud/Dropbox/git stays invisible until this runs. The UI
    /// calls it when the panel is shown and when the window regains focus —
    /// those are exactly the moments a file can have arrived behind our back.
    pub async fn refresh_favorites(
        &self,
        connection_id: Option<String>,
    ) -> Result<Vec<FavoriteQuery>, StoreError> {
        self.favorites.invalidate_cache();
        self.get_favorite_queries(connection_id).await
    }
}
