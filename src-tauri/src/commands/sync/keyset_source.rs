//! Live driver-backed keyset page source for Data Sync compare.

use std::collections::HashMap;
use std::sync::Arc;

use async_trait::async_trait;
use datazen_driver_api::{SyncKeyContract, SyncKeyValue, SyncSourceAdapter, Value};

use crate::data_sync::{
    build_keyset_select_sql_with_order_and_filter, quote_ident_sql, DataSyncError, Row,
    RowPageSource, SyncSourceFilter,
};
use crate::db::{ConnectionHandle, DatabaseDriver};

pub struct DriverKeysetSource {
    driver: Arc<dyn DatabaseDriver>,
    handle: ConnectionHandle,
    table: String,
    database: Option<String>,
    schema: Option<String>,
    columns: Vec<String>,
    pk_columns: Vec<String>,
    quote: char,
    family: String,
    key_adapter: Arc<dyn SyncSourceAdapter>,
    key_contracts: Vec<SyncKeyContract>,
    key_order_expressions: Vec<String>,
    sync_filter: Option<SyncSourceFilter>,
    column_types: HashMap<String, String>,
}

impl DriverKeysetSource {
    pub fn new(
        driver: Arc<dyn DatabaseDriver>,
        handle: ConnectionHandle,
        table: String,
        database: Option<String>,
        schema: Option<String>,
        columns: Vec<String>,
        pk_columns: Vec<String>,
        quote: char,
        family: &str,
        key_adapter: Arc<dyn SyncSourceAdapter>,
        key_contracts: Vec<SyncKeyContract>,
        sync_filter: Option<SyncSourceFilter>,
        column_types: HashMap<String, String>,
    ) -> Result<Self, DataSyncError> {
        if key_contracts.len() != pk_columns.len() {
            return Err(DataSyncError::validation(
                "normalized key contract count does not match primary key columns",
            ));
        }
        let key_order_expressions = pk_columns
            .iter()
            .zip(&key_contracts)
            .map(|(column, contract)| {
                let quoted = quote_ident_sql(column, quote);
                key_adapter.sync_key_order_expression(&quoted, contract)
            })
            .collect();
        Ok(Self {
            driver,
            handle,
            table,
            database,
            schema,
            columns,
            pk_columns,
            quote,
            family: family.to_string(),
            key_adapter,
            key_contracts,
            key_order_expressions,
            sync_filter,
            column_types,
        })
    }
}

#[async_trait]
impl RowPageSource for DriverKeysetSource {
    async fn next_page(
        &mut self,
        after_key: Option<&[Value]>,
        limit: u32,
    ) -> Result<Vec<Row>, DataSyncError> {
        let family = self.family.clone();
        let quote = self.quote;
        let seek_key = after_key
            .map(|key| {
                if key.len() != self.key_contracts.len() {
                    return Err(DataSyncError::validation(
                        "key value count does not match normalized key contract",
                    ));
                }
                key.iter()
                    .zip(&self.key_contracts)
                    .map(|(value, contract)| {
                        self.key_adapter
                            .sync_key_seek_value(value, contract)
                            .map_err(DataSyncError::validation)
                    })
                    .collect::<Result<Vec<_>, _>>()
            })
            .transpose()?;
        let (filter_sql, filter_params) = match self.sync_filter.as_ref() {
            Some(filter) => filter
                .build_where_typed(
                    quote,
                    after_key.map_or(0, |key| key.len()) + 1,
                    |column| self.column_types.get(column).cloned(),
                    |index, data_type| {
                        self.driver
                            .parameter_placeholder(index, data_type)
                            .map_err(|error| DataSyncError::validation(error.to_string()))
                    },
                )
                .map_err(|error| DataSyncError::validation(error.to_string()))?,
            None => (None, Vec::new()),
        };
        let (sql, params) = build_keyset_select_sql_with_order_and_filter(
            &self.table,
            self.database.as_deref(),
            self.schema.as_deref(),
            &family,
            &self.columns,
            &self.pk_columns,
            &self.key_order_expressions,
            seek_key.as_deref(),
            limit,
            quote,
            |i| {
                self.driver
                    .parameter_placeholder(i, None)
                    .unwrap_or_else(|_| {
                        if family == "mysql" {
                            "?".into()
                        } else {
                            format!("${i}")
                        }
                    })
            },
            filter_sql
                .as_deref()
                .map(|sql| (sql, filter_params.as_slice())),
        )?;
        let result = self
            .driver
            .query_with_params(&self.handle, &sql, &params)
            .await
            .map_err(|e| DataSyncError::validation(e.to_string()))?;
        for row in &result.rows {
            for pk in &self.pk_columns {
                let idx = self
                    .columns
                    .iter()
                    .position(|c| c == pk)
                    .ok_or_else(|| DataSyncError::validation("key missing from projection"))?;
                let value = row
                    .get(idx)
                    .ok_or_else(|| DataSyncError::validation("key missing from row"))?;
                let key_index = self
                    .pk_columns
                    .iter()
                    .position(|column| column == pk)
                    .ok_or_else(|| DataSyncError::validation("key missing from projection"))?;
                self.key_adapter
                    .normalize_sync_key(value, &self.key_contracts[key_index])
                    .map_err(DataSyncError::validation)?;
            }
        }
        Ok(result.rows)
    }

    fn normalize_key(&self, key: &[Value]) -> Result<Vec<SyncKeyValue>, DataSyncError> {
        if key.len() != self.key_contracts.len() {
            return Err(DataSyncError::validation(
                "key value count does not match normalized key contract",
            ));
        }
        key.iter()
            .zip(&self.key_contracts)
            .map(|(value, contract)| {
                self.key_adapter
                    .normalize_sync_key(&Some(value.clone()), contract)
                    .map_err(DataSyncError::validation)
            })
            .collect()
    }
}
