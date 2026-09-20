//! Validated, parameterized source recordset selection for Data Transfer.
//!
//! A recordset is a user-selected range over one deterministic source column.
//! It is deliberately separate from checkpointing: the transfer still scans
//! one statement into the existing private spool and never saves an OFFSET for
//! restart.

use datazen_driver_api::TableSchema;

use crate::data_sync::sql::quote_ident_sql;
use crate::db::Value;

use super::error::TransferError;
use super::filter::SourceFilter;
use super::model::{TransferRecordset, TransferRecordsetBound};
use super::recordset_bounds::{canonical_bound_value, compare_bound_keys, BoundKey};

#[derive(Debug, Clone)]
pub struct ResolvedRecordset {
    pub order_by: String,
    pub start: Option<ResolvedBound>,
    pub end: Option<ResolvedBound>,
    pub limit: Option<i64>,
}

#[derive(Debug, Clone)]
pub struct ResolvedBound {
    pub value: Value,
    pub inclusive: bool,
    key: BoundKey,
}

#[derive(Debug, Clone)]
pub struct SourceScope {
    pub where_sql: Option<String>,
    pub recordset_sql: Option<String>,
    pub params: Vec<Value>,
}

impl SourceScope {
    pub fn append_to(&self, sql: &mut String) {
        if let Some(where_sql) = &self.where_sql {
            sql.push(' ');
            sql.push_str(where_sql);
        }
        if let Some(recordset_sql) = &self.recordset_sql {
            sql.push(' ');
            sql.push_str(recordset_sql);
        }
    }
}

pub fn resolve_recordset(
    recordset: &TransferRecordset,
    schema: &TableSchema,
) -> Result<ResolvedRecordset, TransferError> {
    let order_by = match recordset.order_by.as_deref().map(str::trim) {
        Some(column) if !column.is_empty() => column.to_string(),
        _ => {
            let primary_keys = schema.effective_primary_keys();
            match primary_keys.as_slice() {
                [column] => column.clone(),
                [] => {
                    return Err(TransferError::validation(
                        "recordset requires an explicit orderBy because the source table has no primary key",
                    ))
                }
                _ => {
                    return Err(TransferError::validation(
                        "recordset requires an explicit single orderBy column because the source primary key is composite",
                    ))
                }
            }
        }
    };
    if !schema.columns.iter().any(|column| column.name == order_by) {
        return Err(TransferError::validation(format!(
            "recordset orderBy column '{}' is not present in the source table",
            order_by
        )));
    }
    if recordset
        .order_by
        .as_deref()
        .is_some_and(|value| value.trim().is_empty())
    {
        return Err(TransferError::validation(
            "recordset orderBy must name one source column",
        ));
    }

    let order_type = schema
        .columns
        .iter()
        .find(|column| column.name == order_by)
        .map(|column| column.data_type.as_str())
        .ok_or_else(|| {
            TransferError::validation(format!(
                "recordset orderBy column '{}' is not present in the source table",
                order_by
            ))
        })?;
    let start = resolve_bound(recordset.start.as_ref(), "start", order_type)?;
    let end = resolve_bound(recordset.end.as_ref(), "end", order_type)?;
    if let (Some(start), Some(end)) = (&start, &end) {
        match compare_bound_keys(&start.key, &end.key)? {
            std::cmp::Ordering::Greater => {
                return Err(TransferError::validation(
                    "recordset start bound must not be greater than end bound",
                ));
            }
            std::cmp::Ordering::Equal if !(start.inclusive && end.inclusive) => {
                return Err(TransferError::validation(
                    "recordset range is empty when equal bounds are exclusive",
                ));
            }
            _ => {}
        }
    }
    let limit = recordset
        .limit
        .map(|value| {
            if value == 0 {
                return Err(TransferError::validation(
                    "recordset limit must be greater than 0",
                ));
            }
            i64::try_from(value).map_err(|_| {
                TransferError::validation("recordset limit is too large for the source driver")
            })
        })
        .transpose()?;

    Ok(ResolvedRecordset {
        order_by,
        start,
        end,
        limit,
    })
}

fn resolve_bound(
    bound: Option<&TransferRecordsetBound>,
    name: &str,
    data_type: &str,
) -> Result<Option<ResolvedBound>, TransferError> {
    let Some(bound) = bound else {
        return Ok(None);
    };
    let (value, key) = canonical_bound_value(&bound.value, data_type, name)?;
    Ok(Some(ResolvedBound {
        value,
        inclusive: bound.inclusive,
        key,
    }))
}

/// Build the exact source scope used by both preview and execution.
pub fn build_source_scope<P, F>(
    schema: &TableSchema,
    source_filter: Option<&SourceFilter>,
    recordset: Option<&TransferRecordset>,
    quote: char,
    mut placeholder: P,
    column_type: F,
) -> Result<SourceScope, TransferError>
where
    P: FnMut(usize, Option<&str>) -> Result<String, TransferError>,
    F: Fn(&str) -> Option<String>,
{
    let mut params = Vec::new();
    let mut where_parts = Vec::new();
    if let Some(source_filter) = source_filter {
        source_filter.validate(schema)?;
        let (where_sql, filter_params) =
            source_filter.build_where_typed(quote, 1, &column_type, |index, data_type| {
                placeholder(index, data_type)
            })?;
        if let Some(where_sql) = where_sql {
            where_parts.push(where_sql.trim_start_matches("WHERE ").to_string());
        }
        params.extend(filter_params);
    }

    let mut recordset_sql = None;
    if let Some(recordset) = recordset {
        let resolved = resolve_recordset(recordset, schema)?;
        let order_type = column_type(&resolved.order_by);
        let mut range_parts = Vec::new();
        for (bound_name, bound) in [("start", resolved.start), ("end", resolved.end)] {
            let Some(bound) = bound else {
                continue;
            };
            let index = params.len() + 1;
            let marker = placeholder(index, order_type.as_deref())?;
            let operator = match (bound_name, bound.inclusive) {
                ("start", true) => ">=",
                ("start", false) => ">",
                ("end", true) => "<=",
                ("end", false) => "<",
                _ => unreachable!(),
            };
            range_parts.push(format!(
                "({} {operator} {marker})",
                quote_ident_sql(&resolved.order_by, quote)
            ));
            params.push(bound.value);
        }
        where_parts.extend(range_parts);
        let mut tail = format!(
            "ORDER BY {} ASC",
            quote_ident_sql(&resolved.order_by, quote)
        );
        if let Some(limit) = resolved.limit {
            let marker = placeholder(params.len() + 1, None)?;
            tail.push_str(" LIMIT ");
            tail.push_str(&marker);
            params.push(Value::Integer(limit));
        }
        recordset_sql = Some(tail);
    }

    Ok(SourceScope {
        where_sql: (!where_parts.is_empty())
            .then(|| format!("WHERE {}", where_parts.join(" AND "))),
        recordset_sql,
        params,
    })
}

pub fn preview_summary(
    schema: &TableSchema,
    recordset: &TransferRecordset,
    quote: char,
) -> Result<String, TransferError> {
    let scope = build_source_scope(
        schema,
        None,
        Some(recordset),
        quote,
        |_, _| Ok("?".to_string()),
        |column| {
            schema
                .columns
                .iter()
                .find(|candidate| candidate.name == column)
                .map(|candidate| candidate.data_type.clone())
        },
    )?;
    Ok(scope.recordset_sql.unwrap_or_default())
}

#[cfg(test)]
mod tests {
    use super::*;
    use datazen_driver_api::ColumnSchema;

    fn schema(primary_keys: &[&str]) -> TableSchema {
        TableSchema {
            table_name: "users".into(),
            columns: vec![
                ColumnSchema {
                    name: "id".into(),
                    data_type: "INTEGER".into(),
                    nullable: false,
                    default_value: None,
                    comment: None,
                    is_primary_key: primary_keys.contains(&"id"),
                    is_auto_increment: false,
                },
                ColumnSchema {
                    name: "name".into(),
                    data_type: "TEXT".into(),
                    nullable: false,
                    default_value: None,
                    comment: None,
                    is_primary_key: primary_keys.contains(&"name"),
                    is_auto_increment: false,
                },
            ],
            primary_keys: primary_keys.iter().map(|v| (*v).into()).collect(),
            indexes: vec![],
            foreign_keys: vec![],
        }
    }

    fn rs(order_by: Option<&str>) -> TransferRecordset {
        TransferRecordset {
            order_by: order_by.map(str::to_string),
            start: Some(TransferRecordsetBound {
                value: serde_json::json!(2),
                inclusive: true,
            }),
            end: Some(TransferRecordsetBound {
                value: serde_json::json!(5),
                inclusive: false,
            }),
            limit: Some(10),
        }
    }

    #[test]
    fn defaults_to_single_effective_primary_key_and_parameterizes_scope() {
        let schema = schema(&["id"]);
        let scope = build_source_scope(
            &schema,
            None,
            Some(&rs(None)),
            '"',
            |index, data_type| Ok(format!("${index}::{}", data_type.unwrap_or("none"))),
            |column| {
                Some(
                    schema
                        .columns
                        .iter()
                        .find(|c| c.name == column)?
                        .data_type
                        .clone(),
                )
            },
        )
        .unwrap();
        assert_eq!(
            scope.where_sql.as_deref(),
            Some(r#"WHERE ("id" >= $1::INTEGER) AND ("id" < $2::INTEGER)"#)
        );
        assert_eq!(
            scope.recordset_sql.as_deref(),
            Some(r#"ORDER BY "id" ASC LIMIT $3::none"#)
        );
        assert!(matches!(
            scope.params.as_slice(),
            [Value::Integer(2), Value::Integer(5), Value::Integer(10)]
        ));
    }

    #[test]
    fn rejects_missing_primary_key_without_explicit_order_and_composite_default() {
        let no_pk = schema(&[]);
        assert!(resolve_recordset(&rs(None), &no_pk)
            .unwrap_err()
            .to_string()
            .contains("no primary key"));
        let composite = schema(&["id", "name"]);
        assert!(resolve_recordset(&rs(None), &composite)
            .unwrap_err()
            .to_string()
            .contains("composite"));
    }

    #[test]
    fn rejects_invalid_bounds_limits_and_identifiers() {
        let schema = schema(&["id"]);
        let mut invalid = rs(Some("missing"));
        assert!(resolve_recordset(&invalid, &schema).is_err());
        invalid.order_by = Some("id".into());
        invalid.start = Some(TransferRecordsetBound {
            value: serde_json::Value::Null,
            inclusive: true,
        });
        assert!(resolve_recordset(&invalid, &schema).is_err());
        invalid.start = None;
        invalid.limit = Some(0);
        assert!(resolve_recordset(&invalid, &schema).is_err());
        invalid.limit = Some(i64::MAX as u64 + 1);
        assert!(resolve_recordset(&invalid, &schema).is_err());
    }

    #[test]
    fn strict_recordset_serde_rejects_unknown_fields() {
        let result = serde_json::from_value::<TransferRecordset>(serde_json::json!({
            "orderBy": "id",
            "unknown": true
        }));
        assert!(result.is_err());
    }

    #[test]
    fn test_tester_rejects_reversed_bounds_before_query() {
        let schema = schema(&["id"]);
        let mut recordset = rs(Some("id"));
        recordset.start.as_mut().unwrap().value = serde_json::json!("20");
        recordset.end.as_mut().unwrap().value = serde_json::json!("10");

        let result = build_source_scope(
            &schema,
            None,
            Some(&recordset),
            '"',
            |_, _| Ok("?".to_string()),
            |column| {
                schema
                    .columns
                    .iter()
                    .find(|candidate| candidate.name == column)
                    .map(|candidate| candidate.data_type.clone())
            },
        );
        assert!(result.is_err(), "start > end must fail closed before query");
    }

    #[test]
    fn test_tester_rejects_integer_bound_overflow_from_frontend_text() {
        let schema = schema(&["id"]);
        let recordset = TransferRecordset {
            order_by: Some("id".into()),
            start: Some(TransferRecordsetBound {
                value: serde_json::json!("2147483648"),
                inclusive: true,
            }),
            end: None,
            limit: None,
        };

        let result = build_source_scope(
            &schema,
            None,
            Some(&recordset),
            '"',
            |_, _| Ok("?".to_string()),
            |column| {
                schema
                    .columns
                    .iter()
                    .find(|candidate| candidate.name == column)
                    .map(|candidate| candidate.data_type.clone())
            },
        );
        assert!(result.is_err(), "integer bound overflow must fail closed");
    }

    #[test]
    fn equal_bounds_require_both_endpoints_to_be_inclusive() {
        let schema = schema(&["id"]);
        let mut recordset = rs(Some("id"));
        recordset.start.as_mut().unwrap().value = serde_json::json!("10");
        recordset.end.as_mut().unwrap().value = serde_json::json!("10");
        recordset.end.as_mut().unwrap().inclusive = true;
        assert!(resolve_recordset(&recordset, &schema).is_ok());

        recordset.end.as_mut().unwrap().inclusive = false;
        assert!(resolve_recordset(&recordset, &schema).is_err());
    }

    #[test]
    fn typed_bounds_cover_signed_unsigned_and_malformed_integer_text() {
        let mut schema = schema(&["id"]);
        schema.columns[0].data_type = "BIGINT UNSIGNED".into();
        let mut recordset = rs(Some("id"));
        recordset.start.as_mut().unwrap().value = serde_json::json!("18446744073709551615");
        recordset.end = None;
        assert!(resolve_recordset(&recordset, &schema).is_ok());

        recordset.start.as_mut().unwrap().value = serde_json::json!("-1");
        assert!(resolve_recordset(&recordset, &schema).is_err());
        recordset.start.as_mut().unwrap().value = serde_json::json!("not-an-integer");
        assert!(resolve_recordset(&recordset, &schema).is_err());

        schema.columns[0].data_type = "SMALLINT".into();
        recordset.start.as_mut().unwrap().value = serde_json::json!("32768");
        assert!(resolve_recordset(&recordset, &schema).is_err());
    }

    #[test]
    fn decimal_and_float_bounds_are_validated_before_comparison() {
        let mut schema = schema(&["id"]);
        schema.columns[0].data_type = "NUMERIC(12,4)".into();
        let mut recordset = rs(Some("id"));
        recordset.start.as_mut().unwrap().value = serde_json::json!("1.20");
        recordset.end.as_mut().unwrap().value = serde_json::json!("1.2");
        recordset.end.as_mut().unwrap().inclusive = true;
        assert!(resolve_recordset(&recordset, &schema).is_ok());
        recordset.end.as_mut().unwrap().value = serde_json::json!("1.19");
        assert!(resolve_recordset(&recordset, &schema).is_err());
        recordset.start.as_mut().unwrap().value = serde_json::json!("not-a-decimal");
        assert!(resolve_recordset(&recordset, &schema).is_err());

        schema.columns[0].data_type = "DOUBLE PRECISION".into();
        recordset.start.as_mut().unwrap().value = serde_json::json!("1.0");
        recordset.end.as_mut().unwrap().value = serde_json::json!("2.0");
        assert!(resolve_recordset(&recordset, &schema).is_ok());
        recordset.end.as_mut().unwrap().value = serde_json::json!("NaN");
        assert!(resolve_recordset(&recordset, &schema).is_err());
    }

    #[test]
    fn text_bounds_remain_strings_and_use_lexical_order() {
        let mut schema = schema(&["id"]);
        schema.columns[0].data_type = "VARCHAR(32)".into();
        let mut recordset = rs(Some("id"));
        recordset.start.as_mut().unwrap().value = serde_json::json!("b");
        recordset.end.as_mut().unwrap().value = serde_json::json!("a");
        assert!(resolve_recordset(&recordset, &schema).is_err());
        recordset.end.as_mut().unwrap().value = serde_json::json!("z");
        let resolved = resolve_recordset(&recordset, &schema).unwrap();
        assert!(matches!(resolved.start.unwrap().value, Value::String(value) if value == "b"));
    }

    #[test]
    fn boolean_and_non_finite_bounds_fail_closed() {
        let mut schema = schema(&["id"]);
        schema.columns[0].data_type = "BOOLEAN".into();
        let mut recordset = rs(Some("id"));
        recordset.start.as_mut().unwrap().value = serde_json::json!("true");
        recordset.end.as_mut().unwrap().value = serde_json::json!("false");
        assert!(resolve_recordset(&recordset, &schema).is_err());

        recordset.start.as_mut().unwrap().value = serde_json::json!("false");
        recordset.end.as_mut().unwrap().value = serde_json::json!("true");
        let resolved = resolve_recordset(&recordset, &schema).unwrap();
        assert!(matches!(resolved.start.unwrap().value, Value::Bool(false)));

        schema.columns[0].data_type = "DOUBLE PRECISION".into();
        recordset.start.as_mut().unwrap().value = serde_json::json!("Infinity");
        recordset.end.as_mut().unwrap().value = serde_json::json!("Infinity");
        assert!(resolve_recordset(&recordset, &schema).is_err());
        recordset.start.as_mut().unwrap().value = serde_json::Value::Null;
        assert!(resolve_recordset(&recordset, &schema).is_err());
    }

    #[test]
    fn legacy_table_mapping_without_recordset_deserializes() {
        let mapping: super::super::model::TableMapping =
            serde_json::from_value(serde_json::json!({
                "sourceTable": "users",
                "targetTable": "users",
                "enabled": true,
                "columnMappings": []
            }))
            .unwrap();
        assert!(mapping.recordset.is_none());
    }
}
