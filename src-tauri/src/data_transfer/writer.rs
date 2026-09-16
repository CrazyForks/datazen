//! Bound DML. Identifiers come from inspected metadata; values never enter SQL.
use super::{error::TransferError, execute::ValueFormatter, model::ColumnMapping};
use crate::db::{DatabaseDriver, Value};
use datazen_driver_api::TableSchema;

pub fn bound_insert(
    driver: &dyn DatabaseDriver,
    source_table: &str,
    target_ref: &str,
    columns: &[&ColumnMapping],
    target_schema: &TableSchema,
    row: &[Option<Value>],
    formatter: &ValueFormatter<'_>,
) -> Result<(String, Vec<Value>), TransferError> {
    if row.len() != columns.len() || columns.is_empty() {
        return Err(TransferError::validation(
            "INSERT row does not match active projection",
        ));
    }
    let mut names = std::collections::HashSet::new();
    let mut placeholders = Vec::new();
    let mut parameters = Vec::new();
    for (index, (binding, value)) in columns.iter().zip(row).enumerate() {
        if !names.insert(binding.target_column.as_str()) {
            return Err(TransferError::validation("duplicate target column"));
        }
        let target = target_schema
            .columns
            .iter()
            .find(|c| c.name == binding.target_column)
            .ok_or_else(|| {
                TransferError::validation(format!(
                    "target column '{}' not found",
                    binding.target_column
                ))
            })?;
        placeholders.push(
            driver
                .parameter_placeholder(index + 1, Some(&target.data_type))
                .map_err(|e| TransferError::validation(e.to_string()))?,
        );
        let value = match formatter {
            ValueFormatter::SameFamily => value.clone(),
            ValueFormatter::Ir {
                tgt_adapter,
                source_column_ir_types,
            } => {
                let ir_type = source_column_ir_types
                    .get(source_table)
                    .and_then(|types| types.get(&binding.source_column))
                    .ok_or_else(|| {
                        TransferError::validation(format!(
                            "missing IR type for {source_table}.{}",
                            binding.source_column
                        ))
                    })?;
                let transformed = tgt_adapter.transform_value(value, ir_type);
                if value.is_some() && transformed.is_none() {
                    return Err(TransferError::validation(
                        "conversion discarded a non-null source value",
                    ));
                }
                transformed
            }
        };
        parameters.push(value.unwrap_or(Value::Null));
    }
    let column_sql = columns
        .iter()
        .map(|c| driver.quote_ident(&c.target_column))
        .collect::<Vec<_>>()
        .join(", ");
    Ok((
        format!(
            "INSERT INTO {target_ref} ({column_sql}) VALUES ({})",
            placeholders.join(", ")
        ),
        parameters,
    ))
}
