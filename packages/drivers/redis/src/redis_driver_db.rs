//! DatabaseDriver trait implementation for RedisDriver.

use async_trait::async_trait;
use datazen_driver_api::*;
use std::time::{Duration, Instant};

use crate::connect::{build_connection_plan, open_live_conn};
use crate::redis_driver::{RedisConn, RedisDriver, TEST_CONNECTION_TLS_GRACE};
use crate::redis_driver_on::{get_tables_on, info_server_on, query_cmd_on};
use crate::redis_value::{parse_redis_command_args, redis_value_to_rows, value_to_string};
use crate::with_redis_conn;

#[async_trait]
impl DatabaseDriver for RedisDriver {
    fn driver_type(&self) -> DatabaseType {
        "redis".to_string()
    }

    fn driver_category(&self) -> DriverCategory {
        DriverCategory::KeyValue
    }

    fn quote_char(&self) -> char {
        '\0' // Redis doesn't quote identifiers
    }

    fn quote_ident(&self, name: &str) -> String {
        name.to_string()
    }

    async fn test_connection(&self, config: &ConnectionConfig) -> Result<ServerInfo, DriverError> {
        let timeout = Duration::from_secs(config.connection_timeout.max(1) as u64)
            .saturating_add(TEST_CONNECTION_TLS_GRACE);
        tokio::time::timeout(timeout, self.test_connection_inner(config))
            .await
            .map_err(|_| {
                DriverError::ConnectionFailed(format!(
                    "Redis test connection timed out after {timeout:?}"
                ))
            })?
    }

    async fn connect(&self, config: &ConnectionConfig) -> Result<ConnectionHandle, DriverError> {
        let plan = build_connection_plan(config)?;
        let pool_id = format!("redis_{}", uuid::Uuid::new_v4());
        let live = open_live_conn(&plan).await?;

        let mut conns = self.connections.write().await;
        conns.insert(pool_id.clone(), RedisConn { plan, live });
        drop(conns);

        Ok(ConnectionHandle {
            id: pool_id,
            driver_type: "redis".to_string(),
        })
    }

    async fn disconnect(&self, handle: &ConnectionHandle) -> Result<(), DriverError> {
        let mut conns = self.connections.write().await;
        conns.remove(&handle.id);
        Ok(())
    }

    async fn get_databases(
        &self,
        handle: &ConnectionHandle,
    ) -> Result<Vec<DatabaseInfo>, DriverError> {
        with_redis_conn!(self, handle, |conn| {
            let info: String = redis::cmd("INFO").arg("keyspace").query_async(conn).await.map_err(|e| DriverError::QueryFailed(e.to_string()))?;
            // parse dbN:keys=... lines
            let mut dbs = Vec::new();
            for line in info.lines() {
                if line.starts_with("db") {
                    if let Some(idx) = line.find(':') {
                        let name = &line[..idx];
                        dbs.push(DatabaseInfo {
                            name: name.to_string(),
                            size: None,
                            tables: None,
                        });
                    }
                }
            }
            if dbs.is_empty() {
                dbs.push(DatabaseInfo {
                    name: "db0".to_string(),
                    size: None,
                    tables: None,
                });
            }
            Ok(dbs)
        })
    }

    async fn get_tables(
        &self,
        handle: &ConnectionHandle,
        database: Option<&str>,
    ) -> Result<Vec<TableInfo>, DriverError> {
        get_tables_on(self, handle, database).await
    }

    async fn get_columns(
        &self,
        _handle: &ConnectionHandle,
        _database: Option<&str>,
        _table: &str,
    ) -> Result<Vec<ColumnInfo>, DriverError> {
        Ok(vec![])
    }

    async fn get_indexes(
        &self,
        _handle: &ConnectionHandle,
        _database: Option<&str>,
        _table: &str,
    ) -> Result<Vec<IndexInfo>, DriverError> {
        Ok(vec![])
    }

    async fn get_foreign_keys(
        &self,
        _handle: &ConnectionHandle,
        _database: Option<&str>,
        _table: &str,
    ) -> Result<Vec<ForeignKeyInfo>, DriverError> {
        Ok(vec![])
    }

    async fn query(
        &self,
        handle: &ConnectionHandle,
        sql: &str,
        params: Option<&[QueryParam]>,
    ) -> Result<QueryResult, DriverError> {
        query_cmd_on(self, handle, sql, params).await
    }

    async fn execute(
        &self,
        handle: &ConnectionHandle,
        sql: &str,
        params: Option<&[QueryParam]>,
    ) -> Result<ExecuteResult, DriverError> {
        let result = query_cmd_on(self, handle, sql, params).await?;
        Ok(ExecuteResult {
            rows_affected: result.rows.len() as u64,
            last_insert_id: None,
        })
    }

    async fn begin_transaction(
        &self,
        handle: &ConnectionHandle,
    ) -> Result<TransactionHandle, DriverError> {
        with_redis_conn!(self, handle, |conn| {
            redis::cmd("MULTI").query_async::<_, ()>(conn).await.map_err(|e| DriverError::QueryFailed(e.to_string()))?;
            Ok(TransactionHandle {
                id: format!("tx_{}", uuid::Uuid::new_v4()),
                connection_id: handle.id.clone(),
            })
        })
    }

    async fn commit_transaction(
        &self,
        handle: &ConnectionHandle,
        _tx: &TransactionHandle,
    ) -> Result<(), DriverError> {
        with_redis_conn!(self, handle, |conn| {
            redis::cmd("EXEC").query_async::<_, ()>(conn).await.map_err(|e| DriverError::QueryFailed(e.to_string()))?;
            Ok(())
        })
    }

    async fn rollback_transaction(
        &self,
        handle: &ConnectionHandle,
        _tx: &TransactionHandle,
    ) -> Result<(), DriverError> {
        with_redis_conn!(self, handle, |conn| {
            redis::cmd("DISCARD").query_async::<_, ()>(conn).await.map_err(|e| DriverError::QueryFailed(e.to_string()))?;
            Ok(())
        })
    }

    async fn get_server_info(
        &self,
        handle: &ConnectionHandle,
    ) -> Result<ServerInfo, DriverError> {
        info_server_on(self, handle).await
    }

    async fn export_sql(
        &self,
        _handle: &ConnectionHandle,
        _options: &ExportOptions,
    ) -> Result<String, DriverError> {
        Err(DriverError::NotSupported(
            "Redis does not export SQL".into(),
        ))
    }

    async fn import_sql(
        &self,
        _handle: &ConnectionHandle,
        _sql: &str,
    ) -> Result<(), DriverError> {
        Err(DriverError::NotSupported(
            "Redis does not restore SQL files; import via driver commands".into(),
        ))
    }
}
