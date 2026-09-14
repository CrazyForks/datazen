//! Connection-scoped Redis operations (SELECT, SCAN, GET detail, tables).

use datazen_driver_api::*;
use redis::AsyncCommands;
use std::time::Instant;

use redis::FromRedisValue;

use crate::redis_value::{
    parse_scan_result, preview_value_to_string, redis_array_to_json_strings,
    redis_flat_pairs_to_map, redis_zset_to_json, stream_entry_to_json, truncate_preview,
    value_to_string, value_to_type_string, value_to_u64,
};

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
    command: &str,
    args: &[String],
) -> Result<redis::Value, String>
where
    C: AsyncCommands + redis::aio::ConnectionLike + Send,
{
    let mut cmd = redis::cmd(command);
    for a in args {
        cmd.arg(a);
    }
    cmd.query_async(conn).await.map_err(|e| e.to_string())
}

pub(crate) async fn get_tables_on<C>(
    conn: &mut C,
    db_index: u32,
    max_keys: usize,
) -> Result<Vec<TableInfo>, DriverError>
where
    C: AsyncCommands + redis::aio::ConnectionLike + Send,
{
    let keys = crate::ops::scan_keys(conn, None, Some(max_keys))
        .await
        .map_err(DriverError::QueryFailed)?;
    let mut tables = Vec::with_capacity(keys.len());
    for key in keys {
        tables.push(TableInfo {
            name: key,
            schema: Some(format!("db{db_index}")),
            table_type: None,
            estimated_rows: None,
            comment: None,
        });
    }
    Ok(tables)
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
    for key in &keys {
        let ty = type_of_key_on(conn, key)
            .await
            .unwrap_or_else(|_| "none".into());
        let ttl: i64 = redis::cmd("TTL")
            .arg(key)
            .query_async(conn)
            .await
            .unwrap_or(-2);
        let size = value_len_on(conn, key, &ty).await.unwrap_or(0);
        let preview = preview_on(conn, key, &ty).await.unwrap_or_default();
        entries.push(KeyEntry {
            key: key.clone(),
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

async fn type_of_key_on<C>(conn: &mut C, key: &str) -> Result<String, String>
where
    C: AsyncCommands + redis::aio::ConnectionLike + Send,
{
    let ty: String = redis::cmd("TYPE")
        .arg(key)
        .query_async(conn)
        .await
        .map_err(|e| e.to_string())?;
    Ok(ty)
}

async fn value_len_on<C>(conn: &mut C, key: &str, ty: &str) -> Result<usize, String>
where
    C: AsyncCommands + redis::aio::ConnectionLike + Send,
{
    let n: i64 = match ty {
        "string" => redis::cmd("STRLEN").arg(key).query_async(conn).await,
        "list" => redis::cmd("LLEN").arg(key).query_async(conn).await,
        "set" => redis::cmd("SCARD").arg(key).query_async(conn).await,
        "zset" => redis::cmd("ZCARD").arg(key).query_async(conn).await,
        "hash" => redis::cmd("HLEN").arg(key).query_async(conn).await,
        "stream" => redis::cmd("XLEN").arg(key).query_async(conn).await,
        _ => Ok(0),
    }
    .map_err(|e| e.to_string())?;
    Ok(n.max(0) as usize)
}

async fn preview_on<C>(conn: &mut C, key: &str, ty: &str) -> Result<String, String>
where
    C: AsyncCommands + redis::aio::ConnectionLike + Send,
{
    match ty {
        "string" => {
            let v: redis::Value = redis::cmd("GET")
                .arg(key)
                .query_async(conn)
                .await
                .map_err(|e| e.to_string())?;
            Ok(truncate_preview(&preview_value_to_string(&v)))
        }
        "list" => {
            let vals: Vec<String> = redis::cmd("LRANGE")
                .arg(key)
                .arg(0)
                .arg(2)
                .query_async(conn)
                .await
                .map_err(|e| e.to_string())?;
            Ok(truncate_preview(&format!("{vals:?}")))
        }
        "hash" => {
            let vals: Vec<String> = redis::cmd("HGETALL")
                .arg(key)
                .query_async(conn)
                .await
                .map_err(|e| e.to_string())?;
            Ok(truncate_preview(&format!("{vals:?}")))
        }
        "set" => {
            let vals: Vec<String> = redis::cmd("SRANDMEMBER")
                .arg(key)
                .arg(3)
                .query_async(conn)
                .await
                .unwrap_or_default();
            Ok(truncate_preview(&format!("{vals:?}")))
        }
        "zset" => {
            let vals: Vec<String> = redis::cmd("ZRANGE")
                .arg(key)
                .arg(0)
                .arg(2)
                .arg("WITHSCORES")
                .query_async(conn)
                .await
                .unwrap_or_default();
            Ok(truncate_preview(&format!("{vals:?}")))
        }
        "stream" => Ok("(stream)".into()),
        _ => Ok(String::new()),
    }
}

pub(crate) async fn get_key_detail_on<C>(conn: &mut C, key: &str) -> Result<KeyDetail, DriverError>
where
    C: AsyncCommands + redis::aio::ConnectionLike + Send,
{
    let ty = type_of_key_on(conn, key)
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
    let size = value_len_on(conn, key, &ty)
        .await
        .map_err(DriverError::QueryFailed)?;
    let value = key_value_json(conn, key, &ty)
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

async fn key_value_json<C>(conn: &mut C, key: &str, ty: &str) -> Result<serde_json::Value, String>
where
    C: AsyncCommands + redis::aio::ConnectionLike + Send,
{
    match ty {
        "string" => {
            let v: Option<String> = redis::cmd("GET")
                .arg(key)
                .query_async(conn)
                .await
                .map_err(|e| e.to_string())?;
            Ok(serde_json::json!({ "value": v.unwrap_or_default() }))
        }
        "hash" => {
            let pairs: Vec<String> = redis::cmd("HGETALL")
                .arg(key)
                .query_async(conn)
                .await
                .map_err(|e| e.to_string())?;
            Ok(serde_json::json!(redis_flat_pairs_to_map(&pairs)))
        }
        "list" => {
            let vals: Vec<String> = redis::cmd("LRANGE")
                .arg(key)
                .arg(0)
                .arg(-1)
                .query_async(conn)
                .await
                .map_err(|e| e.to_string())?;
            Ok(serde_json::json!(vals))
        }
        "set" => {
            let vals: Vec<String> = redis::cmd("SMEMBERS")
                .arg(key)
                .query_async(conn)
                .await
                .map_err(|e| e.to_string())?;
            Ok(serde_json::json!(vals))
        }
        "zset" => {
            let vals: Vec<String> = redis::cmd("ZRANGE")
                .arg(key)
                .arg(0)
                .arg(-1)
                .arg("WITHSCORES")
                .query_async(conn)
                .await
                .map_err(|e| e.to_string())?;
            Ok(serde_json::json!(redis_zset_to_json(&vals)))
        }
        "stream" => {
            let raw: redis::Value = redis::cmd("XRANGE")
                .arg(key)
                .arg("-")
                .arg("+")
                .arg("COUNT")
                .arg(100)
                .query_async(conn)
                .await
                .map_err(|e| e.to_string())?;
            Ok(stream_entry_to_json(&raw))
        }
        other => Ok(serde_json::json!({ "type": other })),
    }
}
