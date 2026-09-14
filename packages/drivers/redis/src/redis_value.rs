//! Redis value parsing and preview helpers shared by the driver and query UI.

use datazen_driver_api::{ColumnInfo, DriverError, Value};
use redis::FromRedisValue;

/// Safely extract a string from a redis::Value, handling non-UTF-8 bytes via lossy conversion.
pub(crate) fn value_to_string(v: &redis::Value) -> String {
    match v {
        redis::Value::BulkString(b) => String::from_utf8_lossy(b).to_string(),
        redis::Value::SimpleString(s) => s.clone(),
        redis::Value::VerbatimString { text, .. } => text.clone(),
        redis::Value::Int(i) => i.to_string(),
        redis::Value::Okay => "OK".into(),
        _ => format!("{:?}", v),
    }
}

/// Parse a SCAN result (Array of [cursor, Array of keys]) into (next_cursor, Vec<String>).
/// Tolerates non-UTF-8 keys by using lossy conversion.
pub(crate) fn parse_scan_result(v: &redis::Value) -> (u64, Vec<String>) {
    match v {
        redis::Value::Array(items) if items.len() >= 2 => {
            let next_cursor: u64 = match &items[0] {
                redis::Value::BulkString(b) => String::from_utf8_lossy(b).parse().unwrap_or(0),
                redis::Value::Int(i) => *i as u64,
                _ => 0,
            };
            let keys = match &items[1] {
                redis::Value::Array(arr) => arr.iter().map(|v| value_to_string(v)).collect(),
                _ => vec![],
            };
            (next_cursor, keys)
        }
        _ => (0, vec![]),
    }
}

pub(crate) fn value_to_type_string(v: &redis::Value) -> String {
    match v {
        redis::Value::BulkString(b) => String::from_utf8_lossy(b).to_lowercase(),
        redis::Value::VerbatimString { text, .. } => text.to_lowercase(),
        redis::Value::Int(i) => i.to_string(),
        redis::Value::SimpleString(s) => s.to_lowercase(),
        redis::Value::Okay => "ok".into(),
        _ => "unknown".into(),
    }
}

pub(crate) fn value_to_u64(v: &redis::Value) -> u64 {
    match v {
        redis::Value::Int(i) => *i as u64,
        redis::Value::BulkString(b) => String::from_utf8_lossy(b).parse().unwrap_or(0),
        _ => 0,
    }
}

pub(crate) fn preview_value_to_string(v: &redis::Value, key_type: &str) -> String {
    if key_type == "zset" {
        if let Ok(parts) = Vec::<String>::from_redis_value(v) {
            if !parts.is_empty() {
                let member = &parts[0];
                return if parts.len() >= 2 {
                    format!("{member} (score: {})", parts[1])
                } else {
                    member.clone()
                };
            }
        }
    }
    if key_type == "stream" {
        if let Some(s) = stream_preview_from_xrev(v) {
            return s;
        }
    }
    match v {
        redis::Value::Nil => String::new(),
        redis::Value::Array(a) if a.is_empty() => String::new(),
        redis::Value::BulkString(b) => String::from_utf8_lossy(b).to_string(),
        redis::Value::VerbatimString { text, .. } => text.clone(),
        redis::Value::Int(i) => i.to_string(),
        redis::Value::Map(pairs) if key_type == "hash" => {
            let n = 2.min(pairs.len());
            let mut s = "(".to_string();
            for (i, (fk, fv)) in pairs.iter().take(n).enumerate() {
                if i > 0 {
                    s.push_str(", ");
                }
                s.push_str(&value_field_for_preview(fk));
                s.push_str(": ");
                s.push_str(&value_field_for_preview(fv));
            }
            s.push(')');
            if pairs.len() > 2 {
                s.push_str(" …");
            }
            s
        }
        redis::Value::Array(items) if key_type == "hash" && items.len() == 2 => {
            let fields = match &items[1] {
                redis::Value::Array(inner) => inner,
                _ => return format!("{v:?}"),
            };
            if fields.is_empty() {
                return String::new();
            }
            let n = 4.min(fields.len());
            let mut s = "(".to_string();
            for i in (0..n).step_by(2) {
                if i + 1 < fields.len() {
                    let f = value_field_for_preview(&fields[i]);
                    let val = value_field_for_preview(&fields[i + 1]);
                    s.push_str(&f);
                    s.push_str(": ");
                    s.push_str(&val);
                    if i + 2 < n {
                        s.push_str(", ");
                    }
                }
            }
            s.push(')');
            if fields.len() > 4 {
                s.push_str(" …");
            }
            s
        }
        redis::Value::Array(items) if key_type == "hash" && !items.is_empty() => {
            let n = 4.min(items.len());
            let mut s = "(".to_string();
            for i in (0..n).step_by(2) {
                if i + 1 < items.len() {
                    let f = value_field_for_preview(&items[i]);
                    let val = value_field_for_preview(&items[i + 1]);
                    s.push_str(&f);
                    s.push_str(": ");
                    s.push_str(&val);
                    if i + 2 < n {
                        s.push_str(", ");
                    }
                }
            }
            s.push(')');
            if items.len() > 4 {
                s.push_str(" …");
            }
            s
        }
        redis::Value::Array(items) if !items.is_empty() => format!("{items:?}"),
        redis::Value::SimpleString(s) if s == "PONG" => String::new(),
        redis::Value::Okay => String::new(),
        _ => format!("{v:?}"),
    }
}

pub(crate) fn value_field_for_preview(v: &redis::Value) -> String {
    match v {
        redis::Value::BulkString(b) => String::from_utf8_lossy(b).to_string(),
        redis::Value::VerbatimString { text, .. } => text.clone(),
        redis::Value::Int(i) => i.to_string(),
        redis::Value::SimpleString(s) => s.clone(),
        redis::Value::Okay => "OK".into(),
        _ => format!("{v:?}"),
    }
}

pub(crate) fn redis_flat_pairs_to_map(v: &redis::Value) -> serde_json::Map<String, serde_json::Value> {
    let mut obj = serde_json::Map::new();
    match v {
        redis::Value::Array(items) => {
            for chunk in items.chunks(2) {
                if chunk.len() == 2 {
                    let k = value_to_string(&chunk[0]);
                    let val = value_to_string(&chunk[1]);
                    obj.insert(k, serde_json::Value::String(val));
                }
            }
        }
        redis::Value::Map(pairs) => {
            for (fk, fv) in pairs {
                let k = value_to_string(fk);
                let val = value_to_string(fv);
                obj.insert(k, serde_json::Value::String(val));
            }
        }
        _ => {}
    }
    obj
}

pub(crate) fn redis_array_to_json_strings(v: &redis::Value) -> Vec<serde_json::Value> {
    match v {
        redis::Value::Array(items) => items
            .iter()
            .map(|item| serde_json::Value::String(value_to_string(item)))
            .collect(),
        _ => vec![],
    }
}

pub(crate) fn redis_zset_to_json(v: &redis::Value) -> Vec<serde_json::Value> {
    let mut members = Vec::new();
    if let redis::Value::Array(items) = v {
        for chunk in items.chunks(2) {
            if chunk.len() == 2 {
                let mem = value_to_string(&chunk[0]);
                let sc: f64 = value_to_string(&chunk[1]).parse().unwrap_or(0.0);
                members.push(serde_json::json!({ "member": mem, "score": sc }));
            }
        }
    }
    members
}

pub(crate) fn stream_preview_from_xrev(v: &redis::Value) -> Option<String> {
    let a = match v {
        redis::Value::Array(x) => x,
        _ => return None,
    };
    if a.is_empty() {
        return Some(String::new());
    }
    let id = value_field_for_preview(&a[0]);
    if a.len() < 2 {
        return Some(id);
    }
    let rest = match &a[1] {
        redis::Value::Array(fields) if !fields.is_empty() => {
            let mut s = id + ": ";
            for f in fields.iter().take(2) {
                s.push_str(&value_field_for_preview(f));
            }
            s
        }
        other => format!("{id}: {other:?}"),
    };
    Some(rest)
}

pub(crate) fn stream_entry_to_json(v: &redis::Value) -> Result<serde_json::Value, ()> {
    let a = match v {
        redis::Value::Array(x) if !x.is_empty() => x,
        _ => return Err(()),
    };
    let id = value_field_for_preview(&a[0]);
    if a.len() < 2 {
        return Ok(serde_json::json!({ "id": id, "fields": {} }));
    }
    let mut map = serde_json::Map::new();
    if let redis::Value::Array(fields) = &a[1] {
        for pair in fields.chunks(2) {
            if pair.len() == 2 {
                let k = value_field_for_preview(&pair[0]);
                let val = value_field_for_preview(&pair[1]);
                map.insert(k, serde_json::Value::String(val));
            }
        }
    }
    Ok(serde_json::json!({ "id": id, "fields": serde_json::Value::Object(map) }))
}

pub(crate) fn truncate_preview(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        s.to_string()
    } else {
        s.chars().take(max).collect::<String>() + "…"
    }
}

pub(crate) fn parse_redis_command_args(s: &str) -> Result<Vec<String>, DriverError> {
    let s = s.trim();
    if s.is_empty() {
        return Err(DriverError::QueryFailed("Empty command".into()));
    }
    let bytes = s.as_bytes();
    let mut out = Vec::new();
    let mut i = 0usize;
    while i < bytes.len() {
        while i < bytes.len() && bytes[i].is_ascii_whitespace() {
            i += 1;
        }
        if i >= bytes.len() {
            break;
        }
        if bytes[i] == b'"' {
            i += 1;
            let mut cur = String::new();
            while i < bytes.len() {
                if bytes[i] == b'\\' && i + 1 < bytes.len() {
                    i += 1;
                    cur.push(bytes[i] as char);
                    i += 1;
                } else if bytes[i] == b'"' {
                    i += 1;
                    break;
                } else {
                    cur.push(bytes[i] as char);
                    i += 1;
                }
            }
            out.push(cur);
        } else {
            let start = i;
            while i < bytes.len() && !bytes[i].is_ascii_whitespace() {
                i += 1;
            }
            out.push(s[start..i].to_string());
        }
    }
    if out.is_empty() {
        return Err(DriverError::QueryFailed("Empty command".into()));
    }
    Ok(out)
}

pub(crate) fn redis_value_to_rows(value: &redis::Value) -> (Vec<ColumnInfo>, Vec<Vec<Option<Value>>>) {
    match value {
        redis::Value::Nil => (
            vec![ColumnInfo {
                name: "result".into(),
                data_type: "string".into(),
                nullable: true,
            }],
            vec![vec![Some(Value::Null)]],
        ),
        redis::Value::Int(n) => (
            vec![ColumnInfo {
                name: "result".into(),
                data_type: "integer".into(),
                nullable: false,
            }],
            vec![vec![Some(Value::Integer(*n))]],
        ),
        redis::Value::BulkString(bytes) => {
            let s = String::from_utf8_lossy(bytes).to_string();
            (
                vec![ColumnInfo {
                    name: "result".into(),
                    data_type: "string".into(),
                    nullable: false,
                }],
                vec![vec![Some(Value::String(s))]],
            )
        }
        redis::Value::VerbatimString { text, .. } => (
            vec![ColumnInfo {
                name: "result".into(),
                data_type: "string".into(),
                nullable: false,
            }],
            vec![vec![Some(Value::String(text.clone()))]],
        ),
        redis::Value::Array(items) => {
            if items.len() >= 2 && items.len() % 2 == 0 && looks_like_hash(items) {
                let columns = vec![
                    ColumnInfo {
                        name: "field".into(),
                        data_type: "string".into(),
                        nullable: false,
                    },
                    ColumnInfo {
                        name: "value".into(),
                        data_type: "string".into(),
                        nullable: true,
                    },
                ];
                let rows: Vec<Vec<Option<Value>>> = items
                    .chunks(2)
                    .map(|pair| {
                        vec![
                            Some(redis_to_value(&pair[0])),
                            Some(redis_to_value(&pair[1])),
                        ]
                    })
                    .collect();
                (columns, rows)
            } else {
                let columns = vec![
                    ColumnInfo {
                        name: "index".into(),
                        data_type: "integer".into(),
                        nullable: false,
                    },
                    ColumnInfo {
                        name: "value".into(),
                        data_type: "string".into(),
                        nullable: true,
                    },
                ];
                let rows: Vec<Vec<Option<Value>>> = items
                    .iter()
                    .enumerate()
                    .map(|(i, v)| vec![Some(Value::Integer(i as i64)), Some(redis_to_value(v))])
                    .collect();
                (columns, rows)
            }
        }
        redis::Value::SimpleString(s) => (
            vec![ColumnInfo {
                name: "result".into(),
                data_type: "string".into(),
                nullable: false,
            }],
            vec![vec![Some(Value::String(s.clone()))]],
        ),
        #[allow(deprecated)]
        redis::Value::Okay => (
            vec![ColumnInfo {
                name: "result".into(),
                data_type: "string".into(),
                nullable: false,
            }],
            vec![vec![Some(Value::String("OK".into()))]],
        ),
        _ => (
            vec![ColumnInfo {
                name: "result".into(),
                data_type: "string".into(),
                nullable: false,
            }],
            vec![vec![Some(Value::String(format!("{:?}", value)))]],
        ),
    }
}

pub(crate) fn redis_to_value(v: &redis::Value) -> Value {
    match v {
        redis::Value::Nil => Value::Null,
        redis::Value::Int(n) => Value::Integer(*n),
        redis::Value::BulkString(bytes) => {
            Value::String(String::from_utf8_lossy(bytes).to_string())
        }
        redis::Value::VerbatimString { text, .. } => Value::String(text.clone()),
        redis::Value::SimpleString(s) => Value::String(s.clone()),
        #[allow(deprecated)]
        redis::Value::Okay => Value::String("OK".into()),
        redis::Value::Array(items) => {
            let parts: Vec<String> = items.iter().map(|i| format!("{i:?}")).collect();
            Value::String(format!("[{}]", parts.join(", ")))
        }
        _ => Value::String(format!("{v:?}")),
    }
}

pub(crate) fn looks_like_hash(items: &[redis::Value]) -> bool {
    items.chunks(2).all(|pair| {
        matches!(
            &pair[0],
            redis::Value::BulkString(_) | redis::Value::SimpleString(_)
        )
    })
}
