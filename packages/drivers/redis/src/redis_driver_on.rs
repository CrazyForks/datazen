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

pub(crate) async fn scan_keys_with_info_on<C>(
    conn: &mut C,
    db_index: u32,
    pattern: &str,
    cursor: u64,
    count: u32,
    t0: Instant,
) -> Result<(u64, Vec<KeyEntry>, u64), DriverError>
where
    C: AsyncCommands + redis::aio::ConnectionLike + Send,
{
    let db_size: u64 = redis::cmd("DBSIZE")
        .query_async(conn)
        .await
        .map_err(|e| DriverError::QueryFailed(e.to_string()))?;
    tracing::info!(
        db_index,
        db_size,
        ms = t0.elapsed().as_millis() as u64,
        "redis scan_keys_with_info: SELECT+DBSIZE done"
    );

    let scan_raw: redis::Value = redis::cmd("SCAN")
        .arg(cursor)
        .arg("MATCH")
        .arg(pattern)
        .arg("COUNT")
        .arg(count.max(1))
        .query_async(conn)
        .await
        .map_err(|e| DriverError::QueryFailed(e.to_string()))?;
    let (next_cursor, key_names) = parse_scan_result(&scan_raw);

    if key_names.is_empty() {
        return Ok((next_cursor, vec![], db_size));
    }

    let mut pipe1 = redis::pipe();
    for k in &key_names {
        pipe1.cmd("TYPE").arg(k);
        pipe1.cmd("TTL").arg(k);
    }
    let r1: Vec<redis::Value> = pipe1
        .query_async(conn)
        .await
        .map_err(|e| DriverError::QueryFailed(e.to_string()))?;

    let mut types: Vec<String> = Vec::with_capacity(key_names.len());
    let mut ttls: Vec<i64> = Vec::with_capacity(key_names.len());
    for i in 0..key_names.len() {
        let tval = r1
            .get(2 * i)
            .ok_or_else(|| DriverError::QueryFailed("TYPE pipeline: missing value".into()))?;
        let ttlval = r1
            .get(2 * i + 1)
            .ok_or_else(|| DriverError::QueryFailed("TTL pipeline: missing value".into()))?;
        types.push(value_to_type_string(tval));
        ttls.push(
            i64::from_redis_value(ttlval)
                .map_err(|e| DriverError::QueryFailed(format!("TTL: {e}")))?,
        );
    }

    let mut pipe2 = redis::pipe();
    for (k, tk) in key_names.iter().zip(&types) {
        match tk.as_str() {
            "string" => {
                pipe2.cmd("STRLEN").arg(k);
            }
            "hash" => {
                pipe2.cmd("HLEN").arg(k);
            }
            "list" => {
                pipe2.cmd("LLEN").arg(k);
            }
            "set" => {
                pipe2.cmd("SCARD").arg(k);
            }
            "zset" => {
                pipe2.cmd("ZCARD").arg(k);
            }
            "stream" => {
                pipe2.cmd("XLEN").arg(k);
            }
            _ => {
                pipe2.cmd("PING");
            }
        }
    }
    let r2: Vec<redis::Value> = pipe2
        .query_async(conn)
        .await
        .map_err(|e| DriverError::QueryFailed(e.to_string()))?;

    let mut pipe3 = redis::pipe();
    for (k, tk) in key_names.iter().zip(&types) {
        match tk.as_str() {
            "string" => {
                pipe3.cmd("GETRANGE").arg(k).arg(0i64).arg(255i64);
            }
            "hash" => {
                pipe3.cmd("HSCAN").arg(k).arg(0i64).arg("COUNT").arg(3i64);
            }
            "list" => {
                pipe3.cmd("LINDEX").arg(k).arg(0i64);
            }
            "set" => {
                pipe3.cmd("SRANDMEMBER").arg(k);
            }
            "zset" => {
                pipe3
                    .cmd("ZRANGE")
                    .arg(k)
                    .arg(0i64)
                    .arg(0i64)
                    .arg("WITHSCORES");
            }
            "stream" => {
                pipe3
                    .cmd("XREVRANGE")
                    .arg(k)
                    .arg("+")
                    .arg("-")
                    .arg("COUNT")
                    .arg(1i64);
            }
            _ => {
                pipe3.cmd("PING");
            }
        }
    }
    let r3: Vec<redis::Value> = pipe3
        .query_async(conn)
        .await
        .map_err(|e| DriverError::QueryFailed(e.to_string()))?;

    let mut keys = Vec::with_capacity(key_names.len());
    for i in 0..key_names.len() {
        let tk = &types[i];
        let size = if matches!(tk.as_str(), "none") {
            0u64
        } else {
            value_to_u64(
                r2.get(i)
                    .ok_or_else(|| DriverError::QueryFailed("size pipeline".into()))?,
            )
        };
        let preview = if tk == "none" {
            String::new()
        } else {
            preview_value_to_string(
                r3.get(i)
                    .ok_or_else(|| DriverError::QueryFailed("preview pipeline".into()))?,
                tk,
            )
        };
        keys.push(KeyEntry {
            key: key_names[i].clone(),
            key_type: tk.clone(),
            ttl: ttls[i],
            size,
            preview: truncate_preview(&preview, 512),
        });
    }

    Ok((next_cursor, keys, db_size))
}

pub(crate) async fn get_key_detail_on<C>(conn: &mut C, key: &str) -> Result<KeyDetail, DriverError>
where
    C: AsyncCommands + redis::aio::ConnectionLike + Send,
{
    let key_type: String = conn
        .key_type(key)
        .await
        .map_err(|e| DriverError::QueryFailed(e.to_string()))?;
    let ttl: i64 = conn
        .ttl(key)
        .await
        .map_err(|e| DriverError::QueryFailed(e.to_string()))?;
    if key_type == "none" {
        return Err(DriverError::QueryFailed("Key does not exist".into()));
    }

    let value = match key_type.as_str() {
        "string" => {
            let raw: redis::Value = redis::cmd("GET")
                .arg(key)
                .query_async(conn)
                .await
                .map_err(|e| DriverError::QueryFailed(e.to_string()))?;
            serde_json::json!({ "value": value_to_string(&raw) })
        }
        "hash" => {
            let raw: redis::Value = redis::cmd("HGETALL")
                .arg(key)
                .query_async(conn)
                .await
                .map_err(|e| DriverError::QueryFailed(e.to_string()))?;
            serde_json::json!({ "fields": serde_json::Value::Object(redis_flat_pairs_to_map(&raw)) })
        }
        "list" => {
            let raw: redis::Value = redis::cmd("LRANGE")
                .arg(key)
                .arg(0i64)
                .arg(-1i64)
                .query_async(conn)
                .await
                .map_err(|e| DriverError::QueryFailed(e.to_string()))?;
            serde_json::json!({ "items": redis_array_to_json_strings(&raw) })
        }
        "set" => {
            let raw: redis::Value = redis::cmd("SMEMBERS")
                .arg(key)
                .query_async(conn)
                .await
                .map_err(|e| DriverError::QueryFailed(e.to_string()))?;
            serde_json::json!({ "members": redis_array_to_json_strings(&raw) })
        }
        "zset" => {
            let raw: redis::Value = redis::cmd("ZRANGE")
                .arg(key)
                .arg(0i64)
                .arg(-1i64)
                .arg("WITHSCORES")
                .query_async(conn)
                .await
                .map_err(|e| DriverError::QueryFailed(e.to_string()))?;
            serde_json::json!({ "members": redis_zset_to_json(&raw) })
        }
        "stream" => {
            let len: u64 = redis::cmd("XLEN")
                .arg(key)
                .query_async(conn)
                .await
                .map_err(|e| DriverError::QueryFailed(e.to_string()))?;
            let raw: Vec<redis::Value> = redis::cmd("XRANGE")
                .arg(key)
                .arg("-")
                .arg("+")
                .arg("COUNT")
                .arg(10_000i64)
                .query_async(conn)
                .await
                .map_err(|e| DriverError::QueryFailed(e.to_string()))?;
            let entries: Vec<serde_json::Value> = raw
                .iter()
                .filter_map(|v| stream_entry_to_json(v).ok())
                .collect();
            serde_json::json!({ "length": len, "entries": entries })
        }
        _ => {
            let u: String = conn
                .key_type(key)
                .await
                .map_err(|e| DriverError::QueryFailed(e.to_string()))?;
            serde_json::json!({ "raw": format!("(unsupported or module type) {u}") })
        }
    };

    Ok(KeyDetail {
        key: key.to_string(),
        key_type,
        ttl,
        value,
    })
}
