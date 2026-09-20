//! Validated, parameterized sync filters for Data Synchronization.
//!
//! Filters are represented as structured conditions.  The client never sends
//! a replacement SELECT or a raw WHERE fragment.  This module validates every
//! referenced column against the source schema and emits SQL plus bound
//! values for the driver's parameterized query API.

use crate::data_sync::sql::quote_ident_sql;
use crate::data_sync::DataSyncError;
use crate::db::{TableSchema, Value};
use crate::services::query_executor::{FilterCondition, FilterOperator};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use serde::{Deserialize, Serialize};

const MAX_CONDITIONS: usize = 32;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum SyncFilterLogic {
    #[default]
    And,
    Or,
}

/// JSON-backed to preserve the existing TransferJob equality contract while
/// keeping the public IPC shape `{ filters, logic }` easy for the UI to edit.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(transparent)]
pub struct SyncSourceFilter(pub serde_json::Value);

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SyncSyncSourceFilterPayload {
    #[serde(default)]
    filters: Vec<SyncSyncSourceFilterCondition>,
    #[serde(default)]
    logic: SyncFilterLogic,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SyncSyncSourceFilterCondition {
    column: String,
    operator: FilterOperator,
    #[serde(default)]
    value: serde_json::Value,
}

impl SyncSourceFilter {
    pub fn new(
        filters: Vec<FilterCondition>,
        logic: SyncFilterLogic,
    ) -> Result<Self, DataSyncError> {
        let filters = filters
            .into_iter()
            .map(|condition| {
                Ok(SyncSyncSourceFilterCondition {
                    column: condition.column,
                    operator: condition.operator,
                    value: value_to_json(&condition.value)?,
                })
            })
            .collect::<Result<Vec<_>, DataSyncError>>()?;
        serde_json::to_value(SyncSyncSourceFilterPayloadOwned { filters, logic })
            .map(Self)
            .map_err(|error| DataSyncError::validation(format!("invalid sync filter: {error}")))
    }

    fn payload(&self) -> Result<SyncSyncSourceFilterPayload, DataSyncError> {
        serde_json::from_value(self.0.clone())
            .map_err(|error| DataSyncError::validation(format!("invalid sync filter: {error}")))
    }

    pub fn validate(&self, schema: &TableSchema) -> Result<(), DataSyncError> {
        let payload = self.payload()?;
        if payload.filters.is_empty() {
            return Ok(());
        }
        if payload.filters.len() > MAX_CONDITIONS {
            return Err(DataSyncError::validation(format!(
                "sync filter supports at most {MAX_CONDITIONS} conditions"
            )));
        }
        for condition in &payload.filters {
            if condition.column.trim().is_empty() {
                return Err(DataSyncError::validation("sync filter column is required"));
            }
            if !schema
                .columns
                .iter()
                .any(|column| column.name == condition.column)
            {
                return Err(DataSyncError::validation(format!(
                    "sync filter column '{}' is not present in the source table",
                    condition.column
                )));
            }
            validate_condition(condition)?;
        }
        Ok(())
    }

    pub fn is_empty(&self) -> Result<bool, DataSyncError> {
        Ok(self.payload()?.filters.is_empty())
    }

    /// Build a `WHERE ...` fragment and the values bound to its placeholders.
    pub fn build_where<P>(
        &self,
        quote: char,
        start_index: usize,
        placeholder: P,
    ) -> Result<(Option<String>, Vec<Value>), DataSyncError>
    where
        P: FnMut(usize, Option<&str>) -> Result<String, DataSyncError>,
    {
        self.build_where_typed(quote, start_index, |_| None, placeholder)
    }

    /// Build a source predicate while passing the source column type to the
    /// driver's placeholder formatter. This lets PostgreSQL cast UI-entered
    /// text such as `2` to the inspected integer/numeric type without losing
    /// large-value precision in the browser.
    pub fn build_where_typed<P, F>(
        &self,
        quote: char,
        start_index: usize,
        column_type: F,
        mut placeholder: P,
    ) -> Result<(Option<String>, Vec<Value>), DataSyncError>
    where
        P: FnMut(usize, Option<&str>) -> Result<String, DataSyncError>,
        F: Fn(&str) -> Option<String>,
    {
        let payload = self.payload()?;
        if payload.filters.is_empty() {
            return Ok((None, Vec::new()));
        }
        let mut params = Vec::new();
        let mut parts = Vec::with_capacity(payload.filters.len());
        let mut next = start_index;
        for condition in &payload.filters {
            validate_condition(condition)?;
            let column = quote_ident_sql(&condition.column, quote);
            let data_type = column_type(&condition.column);
            let part = match condition.operator {
                FilterOperator::Eq
                | FilterOperator::Ne
                | FilterOperator::Gt
                | FilterOperator::Lt
                | FilterOperator::Gte
                | FilterOperator::Lte
                | FilterOperator::Like => {
                    let op = match condition.operator {
                        FilterOperator::Eq => "=",
                        FilterOperator::Ne => "!=",
                        FilterOperator::Gt => ">",
                        FilterOperator::Lt => "<",
                        FilterOperator::Gte => ">=",
                        FilterOperator::Lte => "<=",
                        FilterOperator::Like => "LIKE",
                        _ => unreachable!(),
                    };
                    let value = scalar_value(&condition.value)?;
                    let marker = placeholder(next, data_type.as_deref())?;
                    next += 1;
                    params.push(value);
                    format!("({column} {op} {marker})")
                }
                FilterOperator::In => {
                    let values = in_values(&condition.value)?;
                    let markers = values
                        .into_iter()
                        .map(|value| {
                            let marker = placeholder(next, data_type.as_deref())?;
                            next += 1;
                            params.push(value);
                            Ok(marker)
                        })
                        .collect::<Result<Vec<_>, DataSyncError>>()?;
                    format!("({column} IN ({}))", markers.join(", "))
                }
                FilterOperator::IsNull => format!("({column} IS NULL)"),
                FilterOperator::IsNotNull => format!("({column} IS NOT NULL)"),
            };
            parts.push(part);
        }
        let joiner = match payload.logic {
            SyncFilterLogic::And => " AND ",
            SyncFilterLogic::Or => " OR ",
        };
        Ok((Some(format!("WHERE {}", parts.join(joiner))), params))
    }

    /// Human-readable preview with anonymous placeholders. Values remain
    /// private to the server and are never interpolated into preview SQL.
    pub fn preview_where(&self, quote: char) -> Result<Option<String>, DataSyncError> {
        self.build_where(quote, 1, |_, _| Ok("?".into()))
            .map(|(sql, _)| sql)
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SyncSyncSourceFilterPayloadOwned {
    filters: Vec<SyncSyncSourceFilterCondition>,
    logic: SyncFilterLogic,
}

fn validate_condition(condition: &SyncSyncSourceFilterCondition) -> Result<(), DataSyncError> {
    match condition.operator {
        FilterOperator::IsNull | FilterOperator::IsNotNull => Ok(()),
        FilterOperator::In => {
            if in_values(&condition.value)?.is_empty() {
                Err(DataSyncError::validation(
                    "sync filter IN requires at least one value",
                ))
            } else {
                Ok(())
            }
        }
        _ => {
            if condition.value.is_null()
                || matches!(&condition.value, serde_json::Value::String(value) if value.is_empty())
            {
                return Err(DataSyncError::validation(
                    "sync filter condition requires a value",
                ));
            }
            Ok(())
        }
    }
}

fn scalar_value(value: &serde_json::Value) -> Result<Value, DataSyncError> {
    if value.is_array() {
        return Err(DataSyncError::validation(
            "sync filter comparison requires one scalar value",
        ));
    }
    json_to_value(value)
}

fn in_values(value: &serde_json::Value) -> Result<Vec<Value>, DataSyncError> {
    match value {
        serde_json::Value::Array(values) => values
            .iter()
            .map(json_to_value)
            .collect::<Result<Vec<_>, _>>(),
        serde_json::Value::String(value) => Ok(value
            .split(',')
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(|value| Value::String(value.to_string()))
            .collect()),
        _ => Err(DataSyncError::validation(
            "sync filter IN requires an array or comma-separated string",
        )),
    }
}

fn value_to_json(value: &Value) -> Result<serde_json::Value, DataSyncError> {
    Ok(match value {
        Value::Null => serde_json::Value::Null,
        Value::Bool(value) => serde_json::Value::Bool(*value),
        Value::Integer(value) => serde_json::Value::Number((*value).into()),
        Value::Float(value) => serde_json::Number::from_f64(*value)
            .map(serde_json::Value::Number)
            .ok_or_else(|| DataSyncError::validation("sync filter float is not finite"))?,
        Value::String(value) | Value::Timestamp(value) => serde_json::Value::String(value.clone()),
        Value::Bytes(value) => serde_json::json!({
            "$datazenType": "bytes",
            "encoding": "base64",
            "value": BASE64.encode(value),
        }),
        Value::Json(value) => value.clone(),
    })
}

fn json_to_value(value: &serde_json::Value) -> Result<Value, DataSyncError> {
    Ok(match value {
        serde_json::Value::Null => Value::Null,
        serde_json::Value::Bool(value) => Value::Bool(*value),
        serde_json::Value::Number(value) => value
            .as_i64()
            .map(Value::Integer)
            .or_else(|| value.as_f64().map(Value::Float))
            .ok_or_else(|| DataSyncError::validation("sync filter number is out of range"))?,
        serde_json::Value::String(value) => Value::String(value.clone()),
        serde_json::Value::Object(value)
            if value.get("$datazenType") == Some(&serde_json::Value::String("bytes".into()))
                && value.get("encoding") == Some(&serde_json::Value::String("base64".into())) =>
        {
            let encoded = value
                .get("value")
                .and_then(serde_json::Value::as_str)
                .ok_or_else(|| DataSyncError::validation("sync filter bytes value is required"))?;
            Value::Bytes(BASE64.decode(encoded).map_err(|_| {
                DataSyncError::validation("sync filter bytes value is invalid base64")
            })?)
        }
        _ => {
            return Err(DataSyncError::validation(
                "sync filter IN values must be scalar",
            ))
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::ColumnSchema;

    fn schema() -> TableSchema {
        TableSchema {
            table_name: "users".into(),
            columns: vec![
                ColumnSchema {
                    name: "id".into(),
                    data_type: "INTEGER".into(),
                    nullable: false,
                    default_value: None,
                    comment: None,
                    is_primary_key: true,
                    is_auto_increment: false,
                },
                ColumnSchema {
                    name: "status".into(),
                    data_type: "TEXT".into(),
                    nullable: false,
                    default_value: None,
                    comment: None,
                    is_primary_key: false,
                    is_auto_increment: false,
                },
            ],
            primary_keys: vec!["id".into()],
            indexes: vec![],
            foreign_keys: vec![],
        }
    }

    fn condition(column: &str, operator: FilterOperator, value: Value) -> FilterCondition {
        FilterCondition {
            column: column.into(),
            operator,
            value,
        }
    }

    #[test]
    fn builds_parameterized_and_filter_without_interpolating_values() {
        let filter = SyncSourceFilter::new(
            vec![
                condition(
                    "status",
                    FilterOperator::Eq,
                    Value::String("active'".into()),
                ),
                condition("id", FilterOperator::Gt, Value::Integer(2)),
            ],
            SyncFilterLogic::And,
        )
        .unwrap();
        filter.validate(&schema()).unwrap();
        let (where_sql, params) = filter
            .build_where('"', 1, |i, _| Ok(format!("${i}")))
            .unwrap();
        assert_eq!(
            where_sql.as_deref(),
            Some("WHERE (\"status\" = $1) AND (\"id\" > $2)")
        );
        assert_eq!(params.len(), 2);
        assert!(matches!(params[0], Value::String(ref value) if value == "active'"));
    }

    #[test]
    fn rejects_unknown_columns_and_empty_values() {
        let unknown = SyncSourceFilter::new(
            vec![condition("secret", FilterOperator::Eq, Value::Integer(1))],
            SyncFilterLogic::And,
        )
        .unwrap();
        assert!(unknown.validate(&schema()).is_err());
        let empty = SyncSourceFilter::new(
            vec![condition(
                "id",
                FilterOperator::Eq,
                Value::String(String::new()),
            )],
            SyncFilterLogic::And,
        )
        .unwrap();
        assert!(empty.validate(&schema()).is_err());
    }

    #[test]
    fn in_values_are_bounded_and_parameterized() {
        let filter = SyncSourceFilter::new(
            vec![condition(
                "id",
                FilterOperator::In,
                Value::Json(serde_json::json!([1, 2, 3])),
            )],
            SyncFilterLogic::Or,
        )
        .unwrap();
        let (where_sql, params) = filter
            .build_where('`', 3, |i, _| Ok(format!("?{i}")))
            .unwrap();
        assert_eq!(where_sql.as_deref(), Some("WHERE (`id` IN (?3, ?4, ?5))"));
        assert_eq!(params.len(), 3);
    }

    #[test]
    fn accepts_frontend_json_arrays_without_untagged_value_coercion() {
        let filter: SyncSourceFilter = serde_json::from_value(serde_json::json!({
            "filters": [{"column": "id", "operator": "in", "value": [1, 2, 3]}],
            "logic": "and"
        }))
        .unwrap();
        let (_, params) = filter
            .build_where('"', 1, |i, _| Ok(format!("${i}")))
            .unwrap();
        assert!(matches!(
            params.as_slice(),
            [Value::Integer(1), Value::Integer(2), Value::Integer(3)]
        ));
    }

    #[test]
    fn preserves_binary_filter_values_with_an_explicit_marker() {
        let filter = SyncSourceFilter::new(
            vec![condition(
                "status",
                FilterOperator::Eq,
                Value::Bytes(vec![0, 255]),
            )],
            SyncFilterLogic::And,
        )
        .unwrap();
        let (_, params) = filter
            .build_where('"', 1, |i, _| Ok(format!("${i}")))
            .unwrap();
        assert!(matches!(params.as_slice(), [Value::Bytes(value)] if value == &[0, 255]));
    }

    #[test]
    fn passes_source_type_to_placeholder_formatter() {
        let filter = SyncSourceFilter::new(
            vec![condition(
                "id",
                FilterOperator::Gt,
                Value::String("2".into()),
            )],
            SyncFilterLogic::And,
        )
        .unwrap();
        let (sql, params) = filter
            .build_where_typed(
                '"',
                1,
                |column| (column == "id").then_some("integer".into()),
                |index, data_type| Ok(format!("${index}::{}", data_type.unwrap_or("none"))),
            )
            .unwrap();
        assert_eq!(sql.as_deref(), Some("WHERE (\"id\" > $1::integer)"));
        assert!(matches!(params.as_slice(), [Value::String(value)] if value == "2"));
    }
}
