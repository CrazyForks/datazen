//! Driver metadata names are logical identifiers, not SQL-quoted expressions.
use super::{error::TransferError, model::Endpoint};
use crate::db::{ConnectionHandle, DatabaseDriver};
use datazen_driver_api::TableSchema;

pub fn metadata_relation_ref(endpoint: &Endpoint, table: &str) -> Result<String, TransferError> {
    match endpoint.normalized_schema() {
        Some(schema) => {
            // The current string contract splits once on a dot. A dot inside
            // the schema cannot be represented without changing that contract.
            if schema.contains('.') {
                return Err(TransferError::validation(
                    "metadata schema names containing '.' require structured relation support",
                ));
            }
            Ok(format!("{schema}.{table}"))
        }
        None => Ok(table.to_string()), // database/catalog is not a schema
    }
}

pub fn table_in_endpoint_schema(
    endpoint: &Endpoint,
    table: &datazen_driver_api::TableInfo,
) -> bool {
    match (endpoint.normalized_schema(), table.schema.as_deref()) {
        (Some(expected), Some(actual)) => expected == actual,
        _ => true,
    }
}

pub async fn load_table_schema(
    driver: &dyn DatabaseDriver,
    handle: &ConnectionHandle,
    endpoint: &Endpoint,
    table: &str,
) -> Result<TableSchema, TransferError> {
    metadata_relation_ref(endpoint, table)?;
    driver
        .get_table_schema(
            handle,
            table,
            &endpoint.database,
            endpoint.normalized_schema(),
        )
        .await
        .map_err(|error| TransferError::validation(error.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn schema_is_explicit_and_catalog_and_literal_names_remain_unchanged() {
        let mut endpoint = Endpoint {
            db_session_id: "session".into(),
            database: "catalog".into(),
            schema: None,
        };
        assert_eq!(
            metadata_relation_ref(&endpoint, "literal.table").unwrap(),
            "literal.table"
        );
        endpoint.schema = Some(" \t".into());
        assert_eq!(metadata_relation_ref(&endpoint, "table").unwrap(), "table");
        endpoint.schema = Some(" Selected ".into());
        assert_eq!(
            metadata_relation_ref(&endpoint, "literal.table").unwrap(),
            "Selected.literal.table"
        );
        assert_eq!(
            metadata_relation_ref(&endpoint, "quoted\"name").unwrap(),
            "Selected.quoted\"name"
        );
        endpoint.schema = Some("ambiguous.schema".into());
        assert!(metadata_relation_ref(&endpoint, "table").is_err());
    }
    #[test]
    fn table_listing_scope_does_not_treat_catalog_as_schema() {
        let mut endpoint = Endpoint {
            db_session_id: "s".into(),
            database: "mysql_catalog".into(),
            schema: None,
        };
        let table = datazen_driver_api::TableInfo {
            name: "t".into(),
            schema: Some("mysql_catalog".into()),
            table_type: datazen_driver_api::TableType::Table,
            row_count: None,
        };
        assert!(table_in_endpoint_schema(&endpoint, &table));
        endpoint.schema = Some("selected".into());
        assert!(!table_in_endpoint_schema(&endpoint, &table));
        let selected = datazen_driver_api::TableInfo {
            schema: Some("selected".into()),
            ..table
        };
        assert!(table_in_endpoint_schema(&endpoint, &selected));
    }
}
