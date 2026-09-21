use super::models::{FavoriteQuery, QueryHistoryEntry};
use super::{MigrationRunFilter, MigrationRunPage, MigrationRunRecord, Store, StoreError};

impl Store {
    pub async fn save_migration_run(&self, run: &MigrationRunRecord) -> Result<(), StoreError> {
        self.history_db
            .save_migration_run(run)
            .map_err(|error| StoreError::WriteError(error.to_string()))
    }

    pub async fn get_migration_run(
        &self,
        id: &str,
    ) -> Result<Option<MigrationRunRecord>, StoreError> {
        self.history_db
            .get_migration_run(id)
            .map_err(|error| StoreError::ReadError(error.to_string()))
    }

    pub async fn list_migration_runs(
        &self,
        filter: &MigrationRunFilter,
        offset: u64,
        limit: u64,
    ) -> Result<MigrationRunPage, StoreError> {
        self.history_db
            .list_migration_runs(filter, offset, limit)
            .map_err(|error| StoreError::ReadError(error.to_string()))
    }
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

    pub async fn purge_history(
        &self,
        scope: super::HistoryScope,
        retain_days: Option<u32>,
    ) -> Result<u64, StoreError> {
        self.history_db
            .purge(scope, retain_days)
            .map_err(|e| StoreError::WriteError(e.to_string()))
    }

    pub async fn get_favorite_queries(&self, connection_id: Option<&str>) -> Vec<FavoriteQuery> {
        self.history_db
            .get_favorite_queries(connection_id)
            .unwrap_or_else(|e| {
                tracing::warn!(error = %e, "Failed to read favorite queries from SQLite");
                Vec::new()
            })
    }

    pub async fn add_favorite_query(&self, fav: FavoriteQuery) -> Result<(), StoreError> {
        self.history_db
            .add_favorite_query(fav)
            .map_err(|e| StoreError::WriteError(e.to_string()))
    }

    pub async fn delete_favorite_query(&self, id: &str) -> Result<(), StoreError> {
        self.history_db
            .delete_favorite_query(id)
            .map_err(|e| StoreError::WriteError(e.to_string()))
    }
}
