//! Generic execution journeys: bound values, projection, rollback and cancellation.
use super::execute::{execute_same_family_data, map_row_values};
use super::filter::SourceFilter;
use super::model::*;
use async_trait::async_trait;
use datazen_driver_api::*;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

type Rows = Vec<Vec<Option<Value>>>;
#[derive(Default)]
struct State {
    committed: Vec<Vec<Value>>,
    pending: Vec<Vec<Value>>,
    calls: usize,
    rollback: usize,
    metadata_refs: Vec<String>,
    source_queries: Vec<(String, Vec<Value>)>,
}
struct Driver {
    rows: Rows,
    schema: TableSchema,
    state: Mutex<State>,
    fail_at: Option<usize>,
    stream_mode: u8,
    cancel: Option<Arc<AtomicBool>>,
}
fn unsupported<T>() -> Result<T, DriverError> {
    Err(DriverError::Unsupported("unused in test".into()))
}
#[async_trait]
impl DatabaseDriver for Driver {
    async fn cancel_query(&self, _: &ConnectionHandle) -> Result<(), DriverError> {
        Ok(())
    }
    fn driver_type(&self) -> String {
        "fixture".into()
    }
    fn parameter_placeholder(&self, _: usize, _: Option<&str>) -> Result<String, DriverError> {
        Ok("?".into())
    }
    async fn connect(&self, _: &ConnectionConfig) -> Result<ConnectionHandle, DriverError> {
        unsupported()
    }
    async fn disconnect(&self, _: ConnectionHandle) -> Result<(), DriverError> {
        Ok(())
    }
    async fn test_connection(&self, _: &ConnectionConfig) -> Result<ServerInfo, DriverError> {
        unsupported()
    }
    async fn get_databases(&self, _: &ConnectionHandle) -> Result<Vec<String>, DriverError> {
        unsupported()
    }
    async fn get_tables(
        &self,
        _: &ConnectionHandle,
        _: &str,
        _: Option<&str>,
    ) -> Result<Vec<TableInfo>, DriverError> {
        unsupported()
    }
    async fn get_table_schema(
        &self,
        _: &ConnectionHandle,
        relation: &str,
        _: &str,
        schema: Option<&str>,
    ) -> Result<TableSchema, DriverError> {
        self.state.lock().unwrap().metadata_refs.push(match schema {
            Some(schema) => format!("{schema}.{relation}"),
            None => relation.to_string(),
        });
        Ok(self.schema.clone())
    }
    async fn query(&self, _: &ConnectionHandle, _: &str) -> Result<QueryResult, DriverError> {
        unsupported()
    }
    async fn query_multi(
        &self,
        _: &ConnectionHandle,
        _: &str,
        _: Option<u32>,
    ) -> Result<MultiQueryResult, DriverError> {
        unsupported()
    }
    async fn query_with_params(
        &self,
        _: &ConnectionHandle,
        _: &str,
        _: &[Value],
    ) -> Result<QueryResult, DriverError> {
        unsupported()
    }
    async fn execute(&self, _: &ConnectionHandle, _: &str) -> Result<u64, DriverError> {
        Ok(0)
    }
    async fn query_stream(
        &self,
        _: &ConnectionHandle,
        sql: &str,
        limit: Option<u32>,
        callback: QueryStreamCallback,
    ) -> Result<(), DriverError> {
        assert!(!sql.contains("OFFSET"));
        assert_eq!(limit, None);
        let projection = sql
            .strip_prefix("SELECT ")
            .unwrap()
            .split(" FROM ")
            .next()
            .unwrap();
        let mut columns: Vec<ColumnInfo> = projection
            .split(", ")
            .map(|name| ColumnInfo {
                name: name.trim_matches('"').into(),
                data_type: "TEXT".into(),
                nullable: true,
            })
            .collect();
        if self.stream_mode == 1 {
            columns[0].name = "unexpected_column".into();
        }
        callback(QueryStreamEvent::StatementStart {
            index: 0,
            sql: sql.into(),
            columns,
        });
        let mut rows = self.rows.clone();
        if self.stream_mode == 4 {
            rows[0].push(None);
        }
        callback(QueryStreamEvent::Rows { index: 0, rows });
        if self.stream_mode == 2 {
            return Ok(());
        }
        callback(QueryStreamEvent::StatementEnd {
            index: 0,
            rows_affected: None,
            execution_time_ms: 0,
            truncated: self.stream_mode == 3,
        });
        if self.stream_mode == 5 {
            callback(QueryStreamEvent::StatementEnd {
                index: 0,
                rows_affected: None,
                execution_time_ms: 0,
                truncated: false,
            });
        }
        Ok(())
    }
    async fn query_stream_with_params(
        &self,
        handle: &ConnectionHandle,
        sql: &str,
        params: &[Value],
        limit: Option<u32>,
        callback: QueryStreamCallback,
    ) -> Result<(), DriverError> {
        self.state
            .lock()
            .unwrap()
            .source_queries
            .push((sql.to_string(), params.to_vec()));
        self.query_stream(handle, sql, limit, callback).await
    }
    async fn begin_transaction(
        &self,
        _: &ConnectionHandle,
    ) -> Result<TransactionHandle, DriverError> {
        Ok(TransactionHandle {
            id: "tx".into(),
            connection_id: "target".into(),
        })
    }
    async fn execute_with_params(
        &self,
        _: &ConnectionHandle,
        sql: &str,
        params: &[Value],
    ) -> Result<u64, DriverError> {
        assert!(sql.contains("VALUES (?"));
        let mut state = self.state.lock().unwrap();
        state.calls += 1;
        if self.fail_at == Some(state.calls) {
            return Err(DriverError::QueryFailed("injected write failure".into()));
        }
        state.pending.push(params.to_vec());
        if let Some(flag) = &self.cancel {
            flag.store(true, Ordering::SeqCst);
        }
        let affected = sql
            .split_once("VALUES ")
            .map(|(_, values)| values.matches('(').count() as u64)
            .unwrap_or(1);
        Ok(affected)
    }
    async fn commit(&self, _: TransactionHandle) -> Result<(), DriverError> {
        let mut state = self.state.lock().unwrap();
        let pending = std::mem::take(&mut state.pending);
        state.committed.extend(pending);
        Ok(())
    }
    async fn rollback(&self, _: TransactionHandle) -> Result<(), DriverError> {
        let mut state = self.state.lock().unwrap();
        state.pending.clear();
        state.rollback += 1;
        Ok(())
    }
}
fn schema(names: &[&str]) -> TableSchema {
    TableSchema {
        table_name: "t".into(),
        columns: names
            .iter()
            .map(|name| ColumnSchema {
                name: (*name).into(),
                data_type: "TEXT".into(),
                nullable: true,
                default_value: None,
                comment: None,
                is_primary_key: false,
                is_auto_increment: false,
            })
            .collect(),
        primary_keys: vec![],
        indexes: vec![],
        foreign_keys: vec![],
        check_constraints: vec![],
        table_options: Default::default(),
    }
}
fn mapping(source: &str, target: &str) -> ColumnMapping {
    ColumnMapping {
        source_column: source.into(),
        target_column: target.into(),
        skip: false,
        target_native_type: None,
    }
}
fn driver(rows: Rows, schema: TableSchema) -> Driver {
    Driver {
        rows,
        schema,
        state: Mutex::new(State::default()),
        fail_at: None,
        stream_mode: 0,
        cancel: None,
    }
}
fn job() -> TransferJob {
    job_with_batch_size(1)
}
fn job_with_batch_size(batch_size: u32) -> TransferJob {
    TransferJob {
        source: Endpoint {
            db_session_id: "source".into(),
            database: "s".into(),
            schema: None,
        },
        target: Some(Endpoint {
            db_session_id: "target".into(),
            database: "t".into(),
            schema: None,
        }),
        sql_file_target: None,
        mode: TransferMode::Data,
        write_mode: WriteMode::Insert,
        tables: vec![],
        options: TransferOptions {
            batch_size,
            stop_on_error: false,
            confirmed_destructive: false,
        },
    }
}
fn inspected(name: &str, mappings: Vec<ColumnMapping>) -> TableInspectResult {
    TableInspectResult {
        source_table: name.into(),
        target_table: name.into(),
        status: TableMappingStatus::Matched,
        create_new: false,
        enabled: true,
        column_mappings: mappings,
        source_primary_keys: vec![],
        source_columns: vec![],
        target_columns: vec![],
        source_column_types: HashMap::new(),
        incompatible_reason: None,
        source_row_count: None,
        recordset: None,
    }
}
async fn run(
    source: &Driver,
    target: &Driver,
    tables: &[TableInspectResult],
    cancel: Option<Arc<AtomicBool>>,
) -> TransferExecutionResult {
    run_with_batch_size(source, target, tables, cancel, 1).await
}
async fn run_with_batch_size(
    source: &Driver,
    target: &Driver,
    tables: &[TableInspectResult],
    cancel: Option<Arc<AtomicBool>>,
    batch_size: u32,
) -> TransferExecutionResult {
    let schemas = tables
        .iter()
        .map(|table| (table.source_table.clone(), source.schema.clone()))
        .collect();
    execute_same_family_data(
        source,
        &ConnectionHandle {
            id: "source".into(),
            pool_id: "source".into(),
        },
        target,
        &ConnectionHandle {
            id: "target".into(),
            pool_id: "target".into(),
        },
        &job_with_batch_size(batch_size),
        tables,
        &schemas,
        false,
        cancel,
    )
    .await
    .unwrap()
}

#[tokio::test]
async fn batched_insert_reports_all_affected_rows_with_one_target_call() {
    let source = driver(
        vec![vec![Some(Value::Integer(1))], vec![Some(Value::Integer(2))]],
        schema(&["id"]),
    );
    let target = driver(vec![], schema(&["id"]));
    let result = run_with_batch_size(
        &source,
        &target,
        &[inspected("a", vec![mapping("id", "id")])],
        None,
        500,
    )
    .await;

    assert!(!result.partial);
    assert_eq!(result.rows_inserted, 2);
    let state = target.state.lock().unwrap();
    assert_eq!(state.calls, 1);
    assert_eq!(state.committed.len(), 1);
    assert_eq!(state.committed[0].len(), 2);
}

#[test]
fn projected_rows_keep_skips_reorder_and_subsets() {
    let schema = schema(&["id", "name", "age"]);
    for selected in [
        vec!["name", "age"],
        vec!["id", "age"],
        vec!["id", "name"],
        vec!["age", "name"],
        vec!["name"],
    ] {
        let mappings: Vec<_> = selected.iter().map(|name| mapping(name, name)).collect();
        let refs = mappings.iter().collect::<Vec<_>>();
        let row = selected
            .iter()
            .map(|name| Some(Value::String((*name).into())))
            .collect::<Vec<_>>();
        assert_eq!(
            serde_json::to_value(map_row_values(&row, &schema, &refs).unwrap()).unwrap(),
            serde_json::to_value(&row).unwrap()
        );
        assert!(map_row_values(&[], &schema, &refs).is_err());
    }
}
#[tokio::test]
async fn bytes_and_strings_survive_bound_projection_and_commit() {
    let row = vec![
        Some(Value::Bytes((0..=255).collect())),
        Some(Value::String("'\\\n\0unicode雪".into())),
    ];
    let source = driver(vec![row.clone()], schema(&["skipped", "blob", "text"]));
    let target = driver(vec![], schema(&["payload", "label"]));
    let result = run(
        &source,
        &target,
        &[inspected(
            "a",
            vec![mapping("blob", "payload"), mapping("text", "label")],
        )],
        None,
    )
    .await;
    assert_eq!(result.rows_inserted, 1);
    assert!(!result.partial);
    assert_eq!(
        serde_json::to_value(&target.state.lock().unwrap().committed[0]).unwrap(),
        serde_json::to_value(row.into_iter().map(Option::unwrap).collect::<Vec<_>>()).unwrap()
    );
}

#[tokio::test]
async fn recordset_scope_shares_filter_order_and_bound_parameter_order() {
    let source = driver(
        vec![vec![Some(Value::Integer(2))]],
        schema(&["id", "status"]),
    );
    let target = driver(vec![], schema(&["id"]));
    let mut job = job();
    job.tables = vec![TableMapping {
        source_table: "a".into(),
        target_table: "a".into(),
        create_new: false,
        enabled: true,
        column_mappings: vec![mapping("id", "id")],
        ddl_override: None,
        source_filter: Some(SourceFilter(serde_json::json!({
            "filters": [{"column": "status", "operator": "eq", "value": "active"}],
            "logic": "and"
        }))),
        recordset: Some(TransferRecordset {
            order_by: Some("id".into()),
            start: Some(TransferRecordsetBound {
                value: serde_json::json!(2),
                inclusive: true,
            }),
            end: Some(TransferRecordsetBound {
                value: serde_json::json!(5),
                inclusive: false,
            }),
            limit: Some(2),
        }),
    }];
    let tables = vec![inspected("a", vec![mapping("id", "id")])];
    let schemas = HashMap::from([("a".into(), source.schema.clone())]);
    let result = execute_same_family_data(
        &source,
        &ConnectionHandle {
            id: "source".into(),
            pool_id: "source".into(),
        },
        &target,
        &ConnectionHandle {
            id: "target".into(),
            pool_id: "target".into(),
        },
        &job,
        &tables,
        &schemas,
        false,
        None,
    )
    .await
    .unwrap();
    assert_eq!(result.rows_inserted, 1);
    let state = source.state.lock().unwrap();
    let (sql, params) = &state.source_queries[0];
    assert!(sql.contains(r#"WHERE ("status" = ?) AND ("id" >= ?) AND ("id" < ?)"#));
    assert!(sql.contains(r#"ORDER BY "id" ASC LIMIT ?"#));
    assert!(matches!(params.as_slice(), [
        Value::String(status),
        Value::Integer(2),
        Value::Integer(5),
        Value::Integer(2)
    ] if status == "active"));
}
#[tokio::test]
async fn second_batch_failure_rolls_back_and_continues_next_table() {
    let source = driver(
        vec![vec![Some(Value::Integer(1))], vec![Some(Value::Integer(2))]],
        schema(&["id"]),
    );
    let mut target = driver(vec![], schema(&["id"]));
    target.fail_at = Some(2);
    let result = run(
        &source,
        &target,
        &[
            inspected("a", vec![mapping("id", "id")]),
            inspected("b", vec![mapping("id", "id")]),
        ],
        None,
    )
    .await;
    assert!(result.partial);
    assert_eq!(result.tables.len(), 2);
    assert!(!result.tables[0].success);
    assert_eq!(result.tables[0].rows_inserted, 0);
    assert!(result.tables[1].success);
    assert_eq!(result.rows_inserted, 2);
    let state = target.state.lock().unwrap();
    assert_eq!(state.rollback, 1);
    assert_eq!(state.committed.len(), 2);
}
#[tokio::test]
async fn cancel_after_write_reports_current_table_and_rolls_back() {
    let flag = Arc::new(AtomicBool::new(false));
    let source = driver(
        vec![vec![Some(Value::Integer(1))], vec![Some(Value::Integer(2))]],
        schema(&["id"]),
    );
    let mut target = driver(vec![], schema(&["id"]));
    target.cancel = Some(Arc::clone(&flag));
    let result = run(
        &source,
        &target,
        &[inspected("a", vec![mapping("id", "id")])],
        Some(flag),
    )
    .await;
    assert!(result.cancelled);
    assert!(result.partial);
    assert_eq!(result.tables.len(), 1);
    assert_eq!(result.rows_inserted, 0);
    let state = target.state.lock().unwrap();
    assert_eq!(state.rollback, 1);
    assert!(state.committed.is_empty());
}

#[test]
fn same_named_columns_use_their_own_table_ir_and_missing_types_fail() {
    use crate::transfer::{
        adapter::SyncTargetAdapter,
        ir::{IRDefault, IRType},
    };
    struct Adapter;
    impl SyncTargetAdapter for Adapter {
        fn ir_type_to_native(&self, _: &IRType) -> String {
            "TEXT".into()
        }
        fn format_default(&self, _: &IRDefault) -> Option<String> {
            None
        }
        fn format_literal(&self, _: &Option<Value>, _: &IRType) -> String {
            panic!("bound writer must not format literals")
        }
        fn transform_value(&self, _: &Option<Value>, kind: &IRType) -> Option<Value> {
            Some(Value::String(format!("{kind:?}")))
        }
    }
    let driver = driver(vec![], schema(&["value"]));
    let types = HashMap::from([
        ("a".into(), HashMap::from([("value".into(), IRType::Int32)])),
        ("b".into(), HashMap::from([("value".into(), IRType::Text)])),
    ]);
    let formatter = super::execute::ValueFormatter::Ir {
        tgt_adapter: &Adapter,
        source_column_ir_types: &types,
    };
    let binding = mapping("value", "value");
    let row = [Some(Value::Integer(1))];
    for (table, expected) in [("a", "Int32"), ("b", "Text")] {
        let (_, params) = super::writer::bound_insert(
            &driver,
            table,
            "target",
            &[&binding],
            &driver.schema,
            &row,
            &formatter,
        )
        .unwrap();
        assert!(matches!(&params[0], Value::String(value) if value == expected));
    }
    assert!(super::writer::bound_insert(
        &driver,
        "missing",
        "target",
        &[&binding],
        &driver.schema,
        &row,
        &formatter
    )
    .is_err());
}

#[tokio::test]
async fn invalid_or_truncated_stream_never_reaches_target_writes() {
    for mode in [1, 2, 3, 4, 5] {
        let mut source = driver(vec![vec![Some(Value::Integer(1))]], schema(&["id"]));
        source.stream_mode = mode;
        let target = driver(vec![], schema(&["id"]));
        let result = run(
            &source,
            &target,
            &[inspected("a", vec![mapping("id", "id")])],
            None,
        )
        .await;
        assert!(result.partial);
        assert!(!result.tables[0].success);
        assert_eq!(target.state.lock().unwrap().calls, 0);
    }
}

#[tokio::test]
async fn source_metadata_and_bound_writer_target_use_endpoint_schema() {
    let source = driver(vec![vec![Some(Value::Integer(1))]], schema(&["id"]));
    let target = driver(vec![], schema(&["id"]));
    let mut job = job();
    job.source.schema = Some("source_scope".into());
    job.target.as_mut().unwrap().schema = Some("target_scope".into());
    let source_handle = ConnectionHandle {
        id: "source".into(),
        pool_id: "source".into(),
    };
    let target_handle = ConnectionHandle {
        id: "target".into(),
        pool_id: "target".into(),
    };
    let loaded =
        super::metadata::load_table_schema(&source, &source_handle, &job.source, "same_table")
            .await
            .unwrap();
    let tables = vec![inspected("same_table", vec![mapping("id", "id")])];
    let schemas = HashMap::from([("same_table".into(), loaded)]);
    let result = execute_same_family_data(
        &source,
        &source_handle,
        &target,
        &target_handle,
        &job,
        &tables,
        &schemas,
        false,
        None,
    )
    .await
    .unwrap();
    assert!(!result.partial);
    assert_eq!(
        source.state.lock().unwrap().metadata_refs,
        vec!["source_scope.same_table"]
    );
    assert_eq!(
        target.state.lock().unwrap().metadata_refs,
        vec!["target_scope.same_table"]
    );
}

#[tokio::test]
async fn test_tester_dotted_target_schema_fails_before_any_bound_write() {
    let source = driver(vec![vec![Some(Value::Integer(1))]], schema(&["id"]));
    let target = driver(vec![], schema(&["id"]));
    let mut transfer = job();
    transfer.target.as_mut().unwrap().schema = Some("ambiguous.schema".into());
    let tables = vec![inspected("same_table", vec![mapping("id", "id")])];
    let source_schemas = HashMap::from([("same_table".into(), source.schema.clone())]);

    let result = execute_same_family_data(
        &source,
        &ConnectionHandle {
            id: "source".into(),
            pool_id: "source".into(),
        },
        &target,
        &ConnectionHandle {
            id: "target".into(),
            pool_id: "target".into(),
        },
        &transfer,
        &tables,
        &source_schemas,
        false,
        None,
    )
    .await
    .unwrap();

    assert!(result.partial);
    assert_eq!(result.rows_inserted, 0);
    assert!(result.tables[0]
        .error
        .as_deref()
        .is_some_and(|message| message.contains("structured relation support")));
    let target_state = target.state.lock().unwrap();
    assert_eq!(target_state.calls, 0);
    assert!(target_state.metadata_refs.is_empty());
}

#[tokio::test]
async fn test_tester_same_session_same_catalog_different_schemas_can_transfer_same_table_name() {
    let source = driver(vec![vec![Some(Value::Integer(1))]], schema(&["id"]));
    let target = driver(vec![], schema(&["id"]));
    let mut transfer = job();
    transfer.source.db_session_id = "shared".into();
    transfer.target.as_mut().unwrap().db_session_id = "shared".into();
    transfer.source.database = "catalog".into();
    transfer.target.as_mut().unwrap().database = "catalog".into();
    transfer.source.schema = Some("source_schema".into());
    transfer.target.as_mut().unwrap().schema = Some("target_schema".into());
    let tables = vec![inspected("same_table", vec![mapping("id", "id")])];
    let source_schemas = HashMap::from([("same_table".into(), source.schema.clone())]);

    let result = execute_same_family_data(
        &source,
        &ConnectionHandle {
            id: "shared".into(),
            pool_id: "shared".into(),
        },
        &target,
        &ConnectionHandle {
            id: "shared".into(),
            pool_id: "shared".into(),
        },
        &transfer,
        &tables,
        &source_schemas,
        false,
        None,
    )
    .await
    .expect("different schemas are distinct relations and must not be rejected as self-overwrite");

    assert!(!result.partial);
    assert_eq!(result.rows_inserted, 1);
    assert_eq!(target.state.lock().unwrap().committed.len(), 1);
}

#[tokio::test]
async fn same_session_catalog_and_normalized_schema_rejects_before_any_write() {
    let source = driver(vec![vec![Some(Value::Integer(1))]], schema(&["id"]));
    let target = driver(vec![], schema(&["id"]));
    let mut transfer = job();
    transfer.target = Some(transfer.source.clone());
    transfer.source.schema = Some(" selected ".into());
    transfer.target.as_mut().unwrap().schema = Some("selected".into());
    let handle = ConnectionHandle {
        id: "shared".into(),
        pool_id: "shared".into(),
    };
    let tables = [inspected("same_table", vec![mapping("id", "id")])];
    let schemas = HashMap::from([("same_table".into(), source.schema.clone())]);
    let result = execute_same_family_data(
        &source, &handle, &target, &handle, &transfer, &tables, &schemas, false, None,
    )
    .await;
    assert!(
        matches!(result, Err(super::TransferError::Validation(message)) if message.contains("self-overwrite"))
    );
    let state = target.state.lock().unwrap();
    assert_eq!(state.calls, 0);
    assert!(state.metadata_refs.is_empty());
    assert!(state.committed.is_empty());
}
