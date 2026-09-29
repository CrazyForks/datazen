//! Cross-endpoint validation for structured Data Sync filters and key ranges.

use super::super::error::CommandError;
use crate::data_sync::{quote_ident_sql, DataSyncError, SyncSourceFilter};
use crate::db::TableSchema;
use datazen_driver_api::{DatabaseDriver, SyncKeyContract, SyncSourceAdapter};

pub(super) fn validate_filter_schemas(
    filter: &SyncSourceFilter,
    source_schema: &TableSchema,
    target_schema: &TableSchema,
    source_table: &str,
    target_table: &str,
) -> Result<(), CommandError> {
    filter
        .validate(source_schema)
        .map_err(|error| CommandError::Validation(error.to_string()))?;
    filter.validate(target_schema).map_err(|error| {
        CommandError::Validation(format!(
            "{source_table}: sync filter is not valid for target '{target_table}': {error}"
        ))
    })
}

pub(super) fn resolve_key_contracts(
    pk_columns: &[String],
    src_adapter: &dyn SyncSourceAdapter,
    tgt_adapter: &dyn SyncSourceAdapter,
    source_schema: &TableSchema,
    target_schema: &TableSchema,
    source_table: &str,
    target_table: &str,
) -> Result<(Vec<SyncKeyContract>, Vec<SyncKeyContract>), CommandError> {
    let mut src_contracts = Vec::with_capacity(pk_columns.len());
    let mut tgt_contracts = Vec::with_capacity(pk_columns.len());
    for pk in pk_columns {
        let source_column = source_schema
            .columns
            .iter()
            .find(|column| &column.name == pk)
            .ok_or_else(|| CommandError::Validation(format!("missing key column {pk}")))?;
        let target_column = target_schema
            .columns
            .iter()
            .find(|column| &column.name == pk)
            .ok_or_else(|| {
                CommandError::Validation(format!(
                    "target key column {pk} is missing; compare again"
                ))
            })?;
        let source_contract = src_adapter
            .sync_key_contract(source_column)
            .map_err(|reason| {
                CommandError::Validation(format!("{source_table}: source key '{pk}': {reason}"))
            })?;
        let target_contract = tgt_adapter
            .sync_key_contract(target_column)
            .map_err(|reason| {
                CommandError::Validation(format!("{target_table}: target key '{pk}': {reason}"))
            })?;
        if source_contract != target_contract {
            return Err(CommandError::Validation(format!(
                "{source_table}: key '{pk}' has incompatible source/target equality or ordering contract (source={source_contract:?}, target={target_contract:?})"
            )));
        }
        src_contracts.push(source_contract);
        tgt_contracts.push(target_contract);
    }
    Ok((src_contracts, tgt_contracts))
}

/// Ensure a bounded source filter has compatible key semantics, SQL ordering,
/// and parameter representations on both endpoints before plan construction.
pub(super) fn validate_filter_endpoints(
    filter: &SyncSourceFilter,
    pk_columns: &[String],
    src_driver: &dyn DatabaseDriver,
    tgt_driver: &dyn DatabaseDriver,
    src_adapter: &dyn SyncSourceAdapter,
    tgt_adapter: &dyn SyncSourceAdapter,
    source_schema: &TableSchema,
    target_schema: &TableSchema,
    src_contracts: &[SyncKeyContract],
    tgt_contracts: &[SyncKeyContract],
    source_table: &str,
) -> Result<(), CommandError> {
    let source_key_order_expressions = pk_columns
        .iter()
        .zip(src_contracts)
        .map(|(column, contract)| {
            src_adapter.sync_key_order_expression(
                &quote_ident_sql(column, src_driver.quote_char()),
                contract,
            )
        })
        .collect::<Vec<_>>();
    let target_key_order_expressions = pk_columns
        .iter()
        .zip(tgt_contracts)
        .map(|(column, contract)| {
            tgt_adapter.sync_key_order_expression(
                &quote_ident_sql(column, tgt_driver.quote_char()),
                contract,
            )
        })
        .collect::<Vec<_>>();
    if filter
        .has_tuple_range()
        .map_err(|error| CommandError::Validation(error.to_string()))?
        && source_key_order_expressions != target_key_order_expressions
    {
        return Err(CommandError::Validation(format!(
            "{source_table}: source and target drivers provide different SQL ordering expressions for the composite key; tuple range is unsupported"
        )));
    }
    for (driver, side, adapter, table_schema, contracts, key_order_expressions) in [
        (
            src_driver,
            "source",
            src_adapter,
            source_schema,
            src_contracts,
            &source_key_order_expressions,
        ),
        (
            tgt_driver,
            "target",
            tgt_adapter,
            target_schema,
            tgt_contracts,
            &target_key_order_expressions,
        ),
    ] {
        filter
            .validate_tuple_range_order(|column, value| {
                let index = pk_columns
                    .iter()
                    .position(|candidate| candidate == column)
                    .ok_or_else(|| format!("key '{column}' has no verified key contract"))?;
                adapter.normalize_sync_key(&Some(value.clone()), &contracts[index])
            })
            .map_err(|error| {
                CommandError::Validation(format!(
                    "{source_table}: {side} driver cannot order sync tuple range: {error}"
                ))
            })?;
        filter
            .build_where_typed_with_key_order(
                driver.quote_char(),
                1,
                (pk_columns.len() == 1).then(|| pk_columns[0].as_str()),
                Some((pk_columns, key_order_expressions)),
                |column, value| {
                    let index = pk_columns
                        .iter()
                        .position(|candidate| candidate == column)
                        .ok_or_else(|| {
                            DataSyncError::validation(format!(
                                "recordset key '{column}' has no verified key contract"
                            ))
                        })?;
                    adapter
                        .sync_key_seek_value(value, &contracts[index])
                        .map_err(DataSyncError::validation)
                },
                |column| {
                    table_schema
                        .columns
                        .iter()
                        .find(|candidate| candidate.name == column)
                        .map(|candidate| candidate.data_type.clone())
                },
                |index, data_type| {
                    driver
                        .parameter_placeholder(index, data_type)
                        .map_err(|error| DataSyncError::validation(error.to_string()))
                },
            )
            .map_err(|error| {
                CommandError::Validation(format!(
                    "{source_table}: {side} driver cannot execute sync filter: {error}"
                ))
            })?;
    }
    Ok(())
}
