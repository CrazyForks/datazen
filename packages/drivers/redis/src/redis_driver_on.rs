//! Connection-scoped Redis operations (SELECT, SCAN, GET detail, tables).

use datazen_driver_api::*;
use redis::AsyncCommands;
use std::time::Instant;

use crate::redis_value::{
    preview_value_to_string, redis_array_to_json_strings, redis_flat_pairs_to_map,
    redis_zset_to_json, stream_entry_to_json, value_to_string,
};
use crate::redis_value::parse_scan_result;

pub(crate) async fn select_db_on<C>(conn: &mut C, db_index: u32) -> Result<(), String>
where
    C: AsyncCommands + redis::aio::ConnectionLike + Send,
{
    redis::cmd("SELECT")
        .arg(db_index)
        .query_async(conn)
        .await
        .map_err(|e| e.to_string())
}

pub(crate) async fn info_server_on<C>(conn: &mut C) -> Result<String, String>
where
    C: AsyncCommands + redis::aio::ConnectionLike + Send,
{
    redis::cmd("INFO")
        .arg("server")
        .query_async(conn)
        .await
        .map_err(|e| e.to_string())
}

pub(crate) async fn query_cmd_on<C>(
    conn: &mut C,
    cmd_name: &str,
    cmd_args: &[String],
) -> Result<redis::Value, DriverError>
where
    C: AsyncCommands + redis::aio::ConnectionLike + Send,
{
    let mut cmd = redis::cmd(cmd_name);
    for part in cmd_args {
        cmd.arg(part.as_str());
    }
    cmd.query_async(conn)
        .await
        .map_err(|e| DriverError::QueryFailed(e.to_string()))
}

pub(crate) async fn get_tables_on<C>(
    conn: &mut C,
    database: &str,
    t0: Instant,
) -> Result<Vec<TableInfo>, DriverError>
where
    C: AsyncCommands + redis::aio::ConnectionLike + Send,
{
    const MAX_KEYS: usize = 10_000;
    let mut keys = crate::ops::scan_keys(conn, None, Some(MAX_KEYS))
        .await
        .map_err(DriverError::QueryFailed)?;
    tracing::info!(%database, key_count = keys.len(), ms = t0.elapsed().as_millis() as u64, "redis get_tables: scan done");
    keys.sort();
    Ok(keys
        .into_iter()
        .map(|key| TableInfo {
            name: key,
            schema: None,
            table_type: TableType::Table,
            row_count: None,
        })
        .collect())
}

// NOTE: full scan_keys_with_info_on + get_key_detail_on bodies follow in next commit if truncated
