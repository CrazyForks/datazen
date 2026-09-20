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

/// A bounded row range used by Data Sync.  The range is deliberately limited
/// to one source primary-key column in this wave: keyset paging still orders
/// by the complete primary-key tuple, so a non-key range would make a limit
/// ambiguous and could skip rows between pages.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SyncRecordsetBound {
    pub value: serde_json::Value,
    #[serde(default = "default_true")]
    pub inclusive: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SyncRecordset {
    /// Omitted only when the source has one effective primary-key column.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub order_by: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub start: Option<SyncRecordsetBound>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub end: Option<SyncRecordsetBound>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub limit: Option<u64>,
}

fn default_true() -> bool {
    true
}

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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    recordset: Option<SyncRecordset>,
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
        serde_json::to_value(SyncSyncSourceFilterPayloadOwned {
            filters,
            logic,
            recordset: None,
        })
        .map(Self)
        .map_err(|error| DataSyncError::validation(format!("invalid sync filter: {error}")))
    }

    fn payload(&self) -> Result<SyncSyncSourceFilterPayload, DataSyncError> {
        serde_json::from_value(self.0.clone())
            .map_err(|error| DataSyncError::validation(format!("invalid sync filter: {error}")))
    }

    pub fn validate(&self, schema: &TableSchema) -> Result<(), DataSyncError> {
        let payload = self.payload()?;
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
        if let Some(recordset) = payload.recordset.as_ref() {
            resolve_recordset(recordset, schema)?;
        }
        Ok(())
    }

    /// Return the validated recordset limit for the live keyset source.
    pub fn recordset_limit(&self, schema: &TableSchema) -> Result<Option<u64>, DataSyncError> {
        self.payload()?
            .recordset
            .as_ref()
            .map(|recordset| resolve_recordset(recordset, schema).map(|resolved| resolved.limit))
            .transpose()
            .map(|limit| limit.flatten())
    }

    pub fn is_empty(&self) -> Result<bool, DataSyncError> {
        let payload = self.payload()?;
        Ok(payload.filters.is_empty() && payload.recordset.is_none())
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
        placeholder: P,
    ) -> Result<(Option<String>, Vec<Value>), DataSyncError>
    where
        P: FnMut(usize, Option<&str>) -> Result<String, DataSyncError>,
        F: Fn(&str) -> Option<String>,
    {
        self.build_where_typed_with_default_order(
            quote,
            start_index,
            None,
            column_type,
            placeholder,
        )
    }

    /// Build the same predicate while allowing the live keyset source to
    /// supply the one effective primary-key column used by an omitted
    /// `recordset.orderBy`.
    pub fn build_where_typed_with_default_order<P, F>(
        &self,
        quote: char,
        start_index: usize,
        default_order: Option<&str>,
        column_type: F,
        mut placeholder: P,
    ) -> Result<(Option<String>, Vec<Value>), DataSyncError>
    where
        P: FnMut(usize, Option<&str>) -> Result<String, DataSyncError>,
        F: Fn(&str) -> Option<String>,
    {
        let payload = self.payload()?;
        if payload.filters.is_empty() && payload.recordset.is_none() {
            return Ok((None, Vec::new()));
        }
        let mut params = Vec::new();
        let mut parts = Vec::with_capacity(payload.filters.len() + 2);
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

        if let Some(recordset) = payload.recordset.as_ref() {
            let resolved =
                resolve_recordset_without_schema(recordset, default_order, &column_type)?;
            let order_type = column_type(&resolved.order_by);
            for (bound_name, bound) in [
                ("start", resolved.start.as_ref()),
                ("end", resolved.end.as_ref()),
            ] {
                let Some(bound) = bound else {
                    continue;
                };
                let marker = placeholder(next, order_type.as_deref())?;
                next += 1;
                let operator = match (bound_name, bound.inclusive) {
                    ("start", true) => ">=",
                    ("start", false) => ">",
                    ("end", true) => "<=",
                    ("end", false) => "<",
                    _ => unreachable!(),
                };
                parts.push(format!(
                    "({} {operator} {marker})",
                    quote_ident_sql(&resolved.order_by, quote)
                ));
                params.push(bound.value.clone());
            }
        }

        if parts.is_empty() {
            return Ok((None, params));
        }

        if payload.recordset.is_some() && !payload.filters.is_empty() {
            let filter_count = payload.filters.len();
            let filter_joiner = match payload.logic {
                SyncFilterLogic::And => " AND ",
                SyncFilterLogic::Or => " OR ",
            };
            let filter_sql = parts[..filter_count].join(filter_joiner);
            let recordset_sql = parts[filter_count..].join(" AND ");
            return Ok((
                Some(format!("WHERE ({filter_sql}) AND {recordset_sql}")),
                params,
            ));
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

#[derive(Debug, Clone)]
struct ResolvedSyncBound {
    value: Value,
    inclusive: bool,
    key: crate::data_transfer::recordset_bounds::BoundKey,
}

#[derive(Debug, Clone)]
struct ResolvedSyncRecordset {
    order_by: String,
    start: Option<ResolvedSyncBound>,
    end: Option<ResolvedSyncBound>,
    limit: Option<u64>,
}

fn resolve_recordset(
    recordset: &SyncRecordset,
    schema: &TableSchema,
) -> Result<ResolvedSyncRecordset, DataSyncError> {
    let primary_keys = schema.effective_primary_keys();
    let order_by = match recordset.order_by.as_deref().map(str::trim) {
        Some(column) if !column.is_empty() => column.to_string(),
        _ => match primary_keys.as_slice() {
            [column] => column.clone(),
            [] => {
                return Err(DataSyncError::validation(
                    "recordset requires an explicit orderBy because the source table has no primary key",
                ))
            }
            _ => {
                return Err(DataSyncError::validation(
                    "recordset requires an explicit single orderBy column because the source primary key is composite",
                ))
            }
        },
    };
    if !schema.columns.iter().any(|column| column.name == order_by) {
        return Err(DataSyncError::validation(format!(
            "recordset orderBy column '{}' is not present in the source table",
            order_by
        )));
    }
    if !primary_keys.iter().any(|column| column == &order_by) {
        return Err(DataSyncError::validation(
            "recordset orderBy must be a source primary-key column for stable sync paging",
        ));
    }
    let order_type = schema
        .columns
        .iter()
        .find(|column| column.name == order_by)
        .map(|column| column.data_type.as_str())
        .ok_or_else(|| DataSyncError::validation("recordset orderBy column is missing"))?;
    resolve_recordset_parts(recordset, order_by, order_type)
}

fn resolve_recordset_without_schema<F>(
    recordset: &SyncRecordset,
    default_order: Option<&str>,
    column_type: F,
) -> Result<ResolvedSyncRecordset, DataSyncError>
where
    F: Fn(&str) -> Option<String>,
{
    let order_by = recordset
        .order_by
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .or(default_order)
        .ok_or_else(|| {
            DataSyncError::validation(
                "recordset orderBy is required when building a predicate without source schema",
            )
        })?
        .to_string();
    let order_type = column_type(&order_by).ok_or_else(|| {
        DataSyncError::validation(format!(
            "recordset orderBy column '{}' is not present in the source table",
            order_by
        ))
    })?;
    resolve_recordset_parts(recordset, order_by, &order_type)
}

fn resolve_recordset_parts(
    recordset: &SyncRecordset,
    order_by: String,
    order_type: &str,
) -> Result<ResolvedSyncRecordset, DataSyncError> {
    let start = resolve_recordset_bound(recordset.start.as_ref(), "start", order_type)?;
    let end = resolve_recordset_bound(recordset.end.as_ref(), "end", order_type)?;
    if let (Some(start), Some(end)) = (&start, &end) {
        match crate::data_transfer::recordset_bounds::compare_bound_keys(&start.key, &end.key)
            .map_err(|error| DataSyncError::validation(error.to_string()))?
        {
            std::cmp::Ordering::Greater => {
                return Err(DataSyncError::validation(
                    "recordset start bound must not be greater than end bound",
                ));
            }
            std::cmp::Ordering::Equal if !(start.inclusive && end.inclusive) => {
                return Err(DataSyncError::validation(
                    "recordset range is empty when equal bounds are exclusive",
                ));
            }
            _ => {}
        }
    }
    if recordset.limit == Some(0) {
        return Err(DataSyncError::validation(
            "recordset limit must be greater than 0",
        ));
    }
    Ok(ResolvedSyncRecordset {
        order_by,
        start,
        end,
        limit: recordset.limit,
    })
}

fn resolve_recordset_bound(
    bound: Option<&SyncRecordsetBound>,
    name: &str,
    data_type: &str,
) -> Result<Option<ResolvedSyncBound>, DataSyncError> {
    let Some(bound) = bound else {
        return Ok(None);
    };
    let (value, key) = crate::data_transfer::recordset_bounds::canonical_bound_value(
        &bound.value,
        data_type,
        name,
    )
    .map_err(|error| DataSyncError::validation(error.to_string()))?;
    Ok(Some(ResolvedSyncBound {
        value,
        inclusive: bound.inclusive,
        key,
    }))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SyncSyncSourceFilterPayloadOwned {
    filters: Vec<SyncSyncSourceFilterCondition>,
    logic: SyncFilterLogic,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    recordset: Option<SyncRecordset>,
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

    #[test]
    fn recordset_only_scope_uses_default_primary_key_and_preserves_limit() {
        let filter: SyncSourceFilter = serde_json::from_value(serde_json::json!({
            "filters": [],
            "recordset": {
                "start": {"value": "2"},
                "end": {"value": "5", "inclusive": false},
                "limit": 10
            }
        }))
        .unwrap();
        assert!(!filter.is_empty().unwrap());
        filter.validate(&schema()).unwrap();
        assert_eq!(filter.recordset_limit(&schema()).unwrap(), Some(10));
        let (sql, params) = filter
            .build_where_typed_with_default_order(
                '"',
                1,
                Some("id"),
                |column| (column == "id").then_some("INTEGER".into()),
                |index, data_type| Ok(format!("${index}::{}", data_type.unwrap_or("none"))),
            )
            .unwrap();
        assert_eq!(
            sql.as_deref(),
            Some("WHERE (\"id\" >= $1::INTEGER) AND (\"id\" < $2::INTEGER)")
        );
        assert!(matches!(
            params.as_slice(),
            [Value::Integer(2), Value::Integer(5)]
        ));

        let limit_only: SyncSourceFilter = serde_json::from_value(serde_json::json!({
            "recordset": {"limit": 2}
        }))
        .unwrap();
        let (sql, params) = limit_only
            .build_where_typed_with_default_order(
                '"',
                1,
                Some("id"),
                |column| (column == "id").then_some("INTEGER".into()),
                |index, _| Ok(format!("${index}")),
            )
            .unwrap();
        assert!(sql.is_none());
        assert!(params.is_empty());
    }

    #[test]
    fn recordset_rejects_non_primary_key_and_reversed_or_overflow_bounds() {
        let non_key: SyncSourceFilter = serde_json::from_value(serde_json::json!({
            "recordset": {"orderBy": "status", "start": {"value": "a"}}
        }))
        .unwrap();
        assert!(non_key.validate(&schema()).is_err());

        let reversed: SyncSourceFilter = serde_json::from_value(serde_json::json!({
            "recordset": {
                "start": {"value": "20"},
                "end": {"value": "10"}
            }
        }))
        .unwrap();
        assert!(reversed.validate(&schema()).is_err());

        let overflow: SyncSourceFilter = serde_json::from_value(serde_json::json!({
            "recordset": {"start": {"value": "2147483648"}}
        }))
        .unwrap();
        assert!(overflow.validate(&schema()).is_err());
    }

    #[test]
    fn recordset_keeps_or_filter_grouped_before_range() {
        let filter: SyncSourceFilter = serde_json::from_value(serde_json::json!({
            "filters": [{"column": "status", "operator": "eq", "value": "active"}],
            "logic": "or",
            "recordset": {"start": {"value": "2"}}
        }))
        .unwrap();
        let (sql, _) = filter
            .build_where_typed_with_default_order(
                '"',
                1,
                Some("id"),
                |column| Some(if column == "id" { "INTEGER" } else { "TEXT" }.into()),
                |index, _| Ok(format!("${index}")),
            )
            .unwrap();
        assert_eq!(
            sql.as_deref(),
            Some("WHERE ((\"status\" = $1)) AND (\"id\" >= $2)")
        );
    }
}
