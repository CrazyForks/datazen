use crate::schema_object_commands::execute_schema_object_command;
use crate::{
    async_trait, ConnectionConfig, ConnectionHandle, DatabaseDriver, DatabaseType, DriverError,
    MultiQueryResult, QueryResult, ServerInfo, TableInfo, TableSchema, Value,
};
use serde_json::{json, Value as JsonValue};
use std::collections::VecDeque;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;

enum QueryReply {
    Error,
    MalformedCatalog,
    TableCatalog,
    Grants(Vec<String>),
}

struct TrackingDriver {
    queries: AtomicUsize,
    queried_sql: Mutex<Vec<String>>,
    replies: Mutex<VecDeque<QueryReply>>,
}

impl TrackingDriver {
    fn new(reply: QueryReply) -> Self {
        Self {
            queries: AtomicUsize::new(0),
            queried_sql: Mutex::new(Vec::new()),
            replies: Mutex::new(VecDeque::from([reply])),
        }
    }

    fn scripted(replies: impl IntoIterator<Item = QueryReply>) -> Self {
        Self {
            queries: AtomicUsize::new(0),
            queried_sql: Mutex::new(Vec::new()),
            replies: Mutex::new(replies.into_iter().collect()),
        }
    }

    fn query_count(&self) -> usize {
        self.queries.load(Ordering::SeqCst)
    }

    fn queried_sql(&self) -> Vec<String> {
        self.queried_sql.lock().unwrap().clone()
    }
}

#[async_trait]
impl DatabaseDriver for TrackingDriver {
    fn driver_type(&self) -> DatabaseType {
        "mysql".into()
    }

    async fn connect(&self, _: &ConnectionConfig) -> Result<ConnectionHandle, DriverError> {
        Ok(handle())
    }

    async fn test_connection(&self, _: &ConnectionConfig) -> Result<ServerInfo, DriverError> {
        Ok(ServerInfo {
            server_version: String::new(),
            server_type: self.driver_type(),
        })
    }

    async fn disconnect(&self, _: ConnectionHandle) -> Result<(), DriverError> {
        Ok(())
    }

    async fn get_databases(&self, _: &ConnectionHandle) -> Result<Vec<String>, DriverError> {
        Ok(Vec::new())
    }

    async fn get_tables(
        &self,
        _: &ConnectionHandle,
        _: &str,
        _: Option<&str>,
    ) -> Result<Vec<TableInfo>, DriverError> {
        Ok(Vec::new())
    }

    async fn get_table_schema(
        &self,
        _: &ConnectionHandle,
        _: &str,
        _: &str,
        _: Option<&str>,
    ) -> Result<TableSchema, DriverError> {
        Ok(TableSchema {
            table_name: String::new(),
            columns: Vec::new(),
            primary_keys: Vec::new(),
            indexes: Vec::new(),
            foreign_keys: Vec::new(),
            check_constraints: Vec::new(),
            table_options: Default::default(),
        })
    }

    async fn query(&self, _: &ConnectionHandle, sql: &str) -> Result<QueryResult, DriverError> {
        self.queries.fetch_add(1, Ordering::SeqCst);
        self.queried_sql.lock().unwrap().push(sql.to_string());
        let reply = self.replies.lock().unwrap().pop_front();
        match reply {
            Some(QueryReply::Error) => Err(DriverError::QueryFailed("catalog unavailable".into())),
            Some(QueryReply::MalformedCatalog) => Ok(QueryResult {
                columns: Vec::new(),
                rows: Vec::new(),
                rows_affected: None,
                execution_time_ms: 0,
            }),
            Some(QueryReply::TableCatalog) => Ok(QueryResult {
                columns: [
                    "selected_count",
                    "unsupported_count",
                    "kind",
                    "dependency_schema",
                    "name",
                    "signature",
                ]
                .into_iter()
                .map(super::col)
                .collect(),
                rows: vec![vec![
                    Some(Value::Integer(1)),
                    Some(Value::Integer(0)),
                    Some(Value::String("table".into())),
                    Some(Value::String("parent_db".into())),
                    Some(Value::String("parent".into())),
                    None,
                ]],
                rows_affected: None,
                execution_time_ms: 0,
            }),
            Some(QueryReply::Grants(grants)) => Ok(QueryResult {
                columns: vec![super::col("Grants for dependency-test")],
                rows: grants
                    .into_iter()
                    .map(|grant| vec![Some(Value::String(grant))])
                    .collect(),
                rows_affected: None,
                execution_time_ms: 0,
            }),
            None => Err(DriverError::QueryFailed(
                "unexpected query without a scripted response".into(),
            )),
        }
    }

    async fn query_multi(
        &self,
        _: &ConnectionHandle,
        _: &str,
        _: Option<u32>,
    ) -> Result<MultiQueryResult, DriverError> {
        Ok(MultiQueryResult {
            results: Vec::new(),
            total_time_ms: 0,
        })
    }

    async fn query_with_params(
        &self,
        _: &ConnectionHandle,
        _: &str,
        _: &[Value],
    ) -> Result<QueryResult, DriverError> {
        Ok(QueryResult {
            columns: Vec::new(),
            rows: Vec::new(),
            rows_affected: None,
            execution_time_ms: 0,
        })
    }

    async fn execute(&self, _: &ConnectionHandle, _: &str) -> Result<u64, DriverError> {
        Ok(0)
    }

    async fn cancel_query(&self, _: &ConnectionHandle) -> Result<(), DriverError> {
        Ok(())
    }
}

fn handle() -> ConnectionHandle {
    ConnectionHandle {
        id: "dependency-test".into(),
        pool_id: "dependency-test-pool".into(),
    }
}

async fn run_dependency_command(driver: &TrackingDriver, input: JsonValue) -> JsonValue {
    execute_schema_object_command(driver, "mysql", &handle(), "get_object_dependencies", input)
        .await
        .expect("dependency command returns an incomplete result rather than failing open")
        .data
}

fn assert_incomplete_without_edges(result: &JsonValue) {
    assert_eq!(
        result["complete"], false,
        "catalog must fail closed: {result}"
    );
    assert_eq!(result["dependencies"], json!([]));
}

#[tokio::test]
async fn unsupported_and_invalid_dependency_inputs_return_incomplete_without_querying() {
    let driver = TrackingDriver::new(QueryReply::MalformedCatalog);
    for input in [
        json!({"kind":"trigger","name":"before_insert"}),
        json!({"kind":"not-a-kind","name":"object"}),
        json!({"name":"object"}),
        json!({"kind":"table"}),
        json!({"kind":"table","name":""}),
        json!({"kind":"table","name":"  \t  "}),
    ] {
        let result = run_dependency_command(&driver, input).await;
        assert_incomplete_without_edges(&result);
    }
    assert_eq!(
        driver.query_count(),
        0,
        "early blockers must not query the database"
    );
}

#[tokio::test]
async fn dependency_catalog_query_error_returns_incomplete_without_edges() {
    let driver = TrackingDriver::new(QueryReply::Error);
    let result = run_dependency_command(&driver, json!({"kind":"table","name":"child"})).await;

    assert_incomplete_without_edges(&result);
    assert_eq!(driver.query_count(), 1);
}

#[tokio::test]
async fn malformed_dependency_catalog_returns_incomplete_without_edges() {
    let driver = TrackingDriver::new(QueryReply::MalformedCatalog);
    let result = run_dependency_command(&driver, json!({"kind":"table","name":"child"})).await;

    assert_incomplete_without_edges(&result);
    assert_eq!(driver.query_count(), 1);
}

#[tokio::test]
async fn mysql_table_catalog_and_global_select_grant_return_exact_parent_edge() {
    let driver = TrackingDriver::scripted([
        QueryReply::TableCatalog,
        QueryReply::Grants(vec!["GRANT SELECT ON *.* TO 'migration'@'%'".into()]),
    ]);
    let result = run_dependency_command(
        &driver,
        json!({"kind":"table","schema":"child_db","name":"child"}),
    )
    .await;

    assert_eq!(
        result["complete"], true,
        "complete visible catalog: {result}"
    );
    assert_eq!(
        result["dependencies"],
        json!([{"kind":"table","schema":"parent_db","name":"parent"}])
    );
    let sql = driver.queried_sql();
    assert_eq!(sql.len(), 2);
    assert!(sql[0].contains("information_schema.TABLE_CONSTRAINTS"));
    assert_eq!(sql[1], "SHOW GRANTS FOR CURRENT_USER()");
    assert_eq!(driver.query_count(), 2);
}

#[tokio::test]
async fn mysql_table_partial_revoke_keeps_catalog_incomplete() {
    let driver = TrackingDriver::scripted([
        QueryReply::TableCatalog,
        QueryReply::Grants(vec![
            "GRANT SELECT ON *.* TO 'migration'@'%'".into(),
            "REVOKE SELECT ON hidden_db.* FROM 'migration'@'%'".into(),
        ]),
    ]);
    let result = run_dependency_command(
        &driver,
        json!({"kind":"table","schema":"child_db","name":"child"}),
    )
    .await;

    assert_eq!(
        result["complete"], false,
        "partial revoke blocks proof: {result}"
    );
    assert_eq!(
        result["dependencies"],
        json!([{"kind":"table","schema":"parent_db","name":"parent"}]),
        "observed edges remain visible even though the catalog is incomplete"
    );
    assert_eq!(driver.query_count(), 2);
}
