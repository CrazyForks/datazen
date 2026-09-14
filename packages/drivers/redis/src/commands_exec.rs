//! Redis command dispatch (`execute_redis_command`).

use datazen_driver_api::{
    execute_standard_sql_command, try_execute_schema_catalog_command, CommandResult,
    ConnectionHandle, DriverError,
};
use serde_json::Value as JsonValue;

use crate::ops::ZsetMember;
use crate::ops_io::RestoreKeyEntry;
use crate::RedisDriver;

fn req_str<'a>(input: &'a JsonValue, field: &str) -> Result<&'a str, DriverError> {
    input
        .get(field)
        .and_then(JsonValue::as_str)
        .ok_or_else(|| DriverError::InvalidConfig(format!("command input requires '{field}'")))
}

fn opt_str<'a>(input: &'a JsonValue, field: &str) -> Option<&'a str> {
    input
        .get(field)
        .and_then(JsonValue::as_str)
        .filter(|s| !s.is_empty())
}

fn req_i64(input: &JsonValue, field: &str) -> Result<i64, DriverError> {
    input.get(field).and_then(JsonValue::as_i64).ok_or_else(|| {
        DriverError::InvalidConfig(format!("command input requires integer '{field}'"))
    })
}

fn req_bool(input: &JsonValue, field: &str) -> Result<bool, DriverError> {
    input
        .get(field)
        .and_then(JsonValue::as_bool)
        .ok_or_else(|| {
            DriverError::InvalidConfig(format!("command input requires boolean '{field}'"))
        })
}

fn db_index(input: &JsonValue) -> u32 {
    input
        .get("dbIndex")
        .or_else(|| input.get("db_index"))
        .and_then(JsonValue::as_u64)
        .unwrap_or(0) as u32
}

fn opt_string_vec(input: &JsonValue, field: &str) -> Vec<String> {
    input
        .get(field)
        .and_then(JsonValue::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(JsonValue::as_str)
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default()
}

fn string_vec(input: &JsonValue, field: &str) -> Result<Vec<String>, DriverError> {
    input
        .get(field)
        .and_then(JsonValue::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(JsonValue::as_str)
                .map(str::to_string)
                .collect()
        })
        .ok_or_else(|| {
            DriverError::InvalidConfig(format!("command input requires string array '{field}'"))
        })
}

fn json_ok<T: serde::Serialize>(value: T) -> Result<CommandResult, DriverError> {
    serde_json::to_value(value)
        .map(CommandResult::new)
        .map_err(|e| DriverError::QueryFailed(e.to_string()))
}

fn ok() -> CommandResult {
    CommandResult::new(serde_json::json!({ "ok": true }))
}

pub async fn execute_redis_command(
    driver: &RedisDriver,
    handle: &ConnectionHandle,
    command: &str,
    input: JsonValue,
) -> Result<CommandResult, DriverError> {
    match execute_standard_sql_command(driver, handle, command, input.clone()).await {
        Err(DriverError::Unsupported(_)) => {}
        other => return other,
    }
    if let Some(result) =
        try_execute_schema_catalog_command(driver, handle, command, input.clone()).await?
    {
        return Ok(result);
    }

    let id = handle.pool_id.as_str();
    let db = db_index(&input);

    match command {
        "scan_keys" => {
            let pattern = opt_str(&input, "pattern").unwrap_or("*");
            let cursor = input.get("cursor").and_then(JsonValue::as_u64).unwrap_or(0);
            let count = input
                .get("count")
                .and_then(JsonValue::as_u64)
                .unwrap_or(100) as u32;
            let (next, keys, db_size) = driver
                .scan_keys_with_info(handle, db, pattern, cursor, count)
                .await?;
            json_ok(serde_json::json!({ "cursor": next, "keys": keys, "dbSize": db_size }))
        }
        "get_key" => json_ok(
            driver
                .get_key_detail(handle, db, req_str(&input, "key")?)
                .await?,
        ),
        "set_string" => {
            let keep_ttl = input
                .get("keepTtl")
                .or_else(|| input.get("keep_ttl"))
                .and_then(JsonValue::as_bool)
                .unwrap_or(false);
            driver
                .plugin_set_string(
                    id,
                    db,
                    req_str(&input, "key")?,
                    req_str(&input, "value")?,
                    keep_ttl,
                )
                .await?;
            Ok(ok())
        }
        "set_ttl" => {
            let key = req_str(&input, "key")?;
            let expire_at = input
                .get("expireAt")
                .or_else(|| input.get("expire_at"))
                .and_then(JsonValue::as_i64);
            if let Some(ts) = expire_at {
                driver.plugin_set_expire_at(id, db, key, ts).await?;
            } else {
                let ttl = input
                    .get("ttlSeconds")
                    .or_else(|| input.get("ttl_seconds"))
                    .and_then(JsonValue::as_i64)
                    .ok_or_else(|| {
                        DriverError::InvalidConfig(
                            "command input requires 'ttlSeconds' or 'expireAt'".into(),
                        )
                    })?;
                driver.plugin_set_ttl(id, db, key, ttl).await?;
            }
            Ok(ok())
        }
        other => Err(DriverError::Unsupported(format!(
            "redis command '{other}' — full dispatch in progress; set_string/set_ttl ready"
        ))),
    }
}
