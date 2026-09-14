//! Connection-scoped Redis operations (SELECT, SCAN, GET detail, tables).

use datazen_driver_api::*;
use redis::AsyncCommands;
use std::time::Instant;

use crate::redis_driver::parse_scan_result;
use crate::redis_value::{preview_redis_value, redis_value_to_rows, type_of_key, value_len};

pub(crate) async fn select_db_on<C>(conn: &mut C, db_index: u32) -> Result<(), String>
where
    C: AsyncCommands + redis::aio::ConnectionLike + Send,
{
    redis::cmd("SELECT")
        .arg(db_index)
        .query_async::<()>(conn)
        .await
        .map_err(|e| e.to_string())
}

pub(crate) async fn info_server_on<C>(conn: &mut C) -> Result<String, String>
where
    C: AsyncCommands + redis::aio::ConnectionLike + Send,
{
    redis::cmd("INFO")
        .arg("server")
        .query_async::<String>(conn)
        .await
        .map_err(|e| e.to_string())
}

pub(crate) async fn scan_keys_with_info_on<C>(
    conn: &mut C,
    _db_index: u32,
    pattern: &str,
    cursor: u64,
    count: u32,
    t0: Instant,
) -> Result<(u64, Vec<KeyEntry>, u64), DriverError>
where
    C: AsyncCommands + redis::aio::ConnectionLike + Send,
{
    let mut cmd = redis::cmd("SCAN");
    cmd.arg(cursor).arg("COUNT").arg(count.max(1));
    if !pattern.is_empty() && pattern != "*" {
        cmd.arg("MATCH").arg(pattern);
    }
    let raw: redis::Value = cmd
        .query_async(conn)
        .await
        .map_err(|e| DriverError::QueryFailed(e.to_string()))?;
    let (next, keys) = parse_scan_result(&raw);
    let mut entries = Vec::with_capacity(keys.len());
    for key in keys {
        let ty = type_of_key(conn, &key)
            .await
            .unwrap_or_else(|_| "none".into());
        let ttl: i64 = redis::cmd("TTL")
            .arg(&key)
            .query_async(conn)
            .await
            .unwrap_or(-2);
        let size = value_len(conn, &key, &ty).await.unwrap_or(0);
        let preview = preview_redis_value(conn, &key, &ty)
            .await
            .unwrap_or_default();
        entries.push(KeyEntry {
            key,
            key_type: ty,
            ttl,
            size: Some(size as u64),
            preview: Some(preview),
        });
    }
    let db_size: i64 = redis::cmd("DBSIZE")
        .query_async(conn)
        .await
        .unwrap_or(0);
    tracing::info!(
        elapsed_ms = t0.elapsed().as_millis() as u64,
        keys = entries.len(),
        "redis scan_keys_with_info_on done"
    );
    Ok((next, entries, db_size.max(0) as u64))
}

pub(crate) async fn get_key_detail_on<C>(conn: &mut C, key: &str) -> Result<KeyDetail, DriverError>
where
    C: AsyncCommands + redis::aio::ConnectionLike + Send,
{
    let ty = type_of_key(conn, key)
        .await
        .map_err(DriverError::QueryFailed)?;
    if ty == "none" {
        return Err(DriverError::QueryFailed(format!("key not found: {key}")));
    }
    let ttl: i64 = redis::cmd("TTL")
        .arg(key)
        .query_async(conn)
        .await
        .map_err(|e| DriverError::QueryFailed(e.to_string()))?;
    let size = value_len(conn, key, &ty)
        .await
        .map_err(DriverError::QueryFailed)?;
    let value = redis_value_to_rows(conn, key, &ty)
        .await
        .map_err(DriverError::QueryFailed)?;
    Ok(KeyDetail {
        key: key.to_string(),
        key_type: ty,
        ttl,
        size: Some(size as u64),
        value,
    })
}
