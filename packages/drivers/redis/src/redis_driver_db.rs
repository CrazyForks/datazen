//! DatabaseDriver trait implementation for RedisDriver.

use async_trait::async_trait;
use datazen_driver_api::*;
use std::time::Duration;

use crate::connect::{build_connection_plan, open_live_conn};
use crate::redis_driver::{RedisConn, RedisDriver, TEST_CONNECTION_TLS_GRACE};
use crate::redis_driver_on::{get_tables_on, info_server_on, query_cmd_on};
use crate::with_redis_conn;

fn value_to_string(v: &redis::Value) -> String {
    match v {
        redis::Value::BulkString(b) => String::from_utf8_lossy(b).into_owned(),
        redis::Value::SimpleString(s) => s.clone(),
        redis::Value::Int(i) => i.to_string(),
        redis::Value::Array(items) => items
            .iter()
            .map(value_to_string)
            .collect::<Vec<_>>()
            .join("\n"),
        _ => String::new(),
    }
}

#[async_trait]
impl DatabaseDriver for RedisDriver {
    fn driver_type(&self) -> DatabaseType {
        "redis".to_string()
    }

    fn driver_category(&self) -> DriverCategory {
        DriverCategory::KeyValue
    }

    fn quote_char(&self) -> char {
        '\0'
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
            id: pool_id.clone(),
            pool_id,
        })
    }

    async fn disconnect(&self, handle: ConnectionHandle) -> Result<(), DriverError> {
        let mut conns = self.connections.write().await;
        conns.remove(&handle.pool_id);
        Ok(())
    }

    async fn get_databases(&self, handle: &ConnectionHandle) -> Result<Vec<String>, DriverError> {
        let mut conns = self.connections.write().await;
        let rc = Self::get_conn(&mut conns, handle)?;

        let db_count: u32 = match with_redis_conn!(&mut rc.live, |conn| {
            redis::cmd("CONFIG")
                .arg("GET")
                .arg("databases")
                .query_async::<redis::Value>(conn)
                .await
        }) {
            Ok(val) => value_to_string(&val)
                .lines()
                .filter_map(|l| l.trim().parse::<u32>().ok())
                .next()
                .unwrap_or(16),
            Err(_) => 16,
        };

        Ok((0..db_count).map(|i| format!("db{i}")).collect())
    }

    async fn get_tables(
        &self,
        handle: &ConnectionHandle,
        database: Option<&str>,
    ) -> Result<Vec<TableInfo>, DriverError> {
        get_tables_on(self, handle, database).await
    }

    async fn get_table_schema(
        &self,
        _handle: &ConnectionHandle,
        _database: Option<&str>,
        _table: &str,
    ) -> Result<TableSchema, DriverError> {
        Ok(TableSchema {
            columns: vec![],
            indexes: vec![],
            foreign_keys: vec![],
            primary_key: None,
        })
    }

    async fn query(
        &self,
        handle: &ConnectionHandle,
        sql: &str,
    ) -> Result<QueryResult, DriverError> {
        query_cmd_on(self, handle, sql, None).await
    }

    async fn query_multi(
        &self,
        handle: &ConnectionHandle,
        sql: &str,
    ) -> Result<Vec<QueryResult>, DriverError> {
        let one = query_cmd_on(self, handle, sql, None).await?;
        Ok(vec![one])
    }

    async fn query_stream(
        &self,
        handle: &ConnectionHandle,
        sql: &str,
        _on_batch: &mut (dyn FnMut(QueryResult) -> bool + Send),
    ) -> Result<(), DriverError> {
        let _ = query_cmd_on(self, handle, sql, None).await?;
        Ok(())
    }

    async fn query_with_params(
        &self,
        handle: &ConnectionHandle,
        sql: &str,
        params: &[QueryParam],
    ) -> Result<QueryResult, DriverError> {
        query_cmd_on(self, handle, sql, Some(params)).await
    }

    async fn execute(&self, handle: &ConnectionHandle, sql: &str) -> Result<u64, DriverError> {
        let result = query_cmd_on(self, handle, sql, None).await?;
        Ok(result.rows.len() as u64)
    }

    fn command_definitions(&self) -> Vec<datazen_driver_api::DriverCommandDefinition> {
        crate::commands::command_definitions()
    }

    async fn execute_command(
        &self,
        handle: &ConnectionHandle,
        command_id: &str,
        input: serde_json::Value,
    ) -> Result<CommandResult, DriverError> {
        crate::commands_exec::execute_redis_command(self, handle, command_id, input).await
    }

    async fn cancel_query(&self, _handle: &ConnectionHandle) -> Result<(), DriverError> {
        Ok(())
    }

    async fn get_server_info(&self, handle: &ConnectionHandle) -> Result<ServerInfo, DriverError> {
        info_server_on(self, handle).await
    }

    async fn dump_database_with_progress(
        &self,
        _handle: &ConnectionHandle,
        _opts: Option<&BackupRestoreOptions>,
        _on_progress: &mut (dyn FnMut(DumpProgress) + Send),
    ) -> Result<String, DriverError> {
        Err(DriverError::NotSupported(
            "Redis does not use SQL dump; export keys via driver commands".into(),
        ))
    }

    async fn restore_sql_with_progress(
        &self,
        _handle: &ConnectionHandle,
        _sql: &str,
        _opts: Option<&BackupRestoreOptions>,
        _on_progress: &mut (dyn FnMut(DumpProgress) + Send),
    ) -> Result<(), DriverError> {
        Err(DriverError::NotSupported(
            "Redis does not restore SQL files; import via driver commands".into(),
        ))
    }
}
