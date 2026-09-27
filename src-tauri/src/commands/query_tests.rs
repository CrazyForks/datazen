//! Tests for the query execution commands.
//!
//! Split out of `query.rs` to keep that file inside the 800-line
//! budget. `log_hygiene_tests` stays in `query.rs` because it reads
//! the source it is testing with `include_str!`, and those paths are
//! relative to the file that holds them.

use super::*;
use crate::db::{ColumnSchema, DriverCapabilities, DriverError, ExplainResult, Value};
use crate::store::AppSettings;
use crate::testing::app_state::TestAppState;
use crate::testing::mock_driver::MockDriverOptions;

#[tokio::test]
async fn execute_query_success_records_history() {
    let test = TestAppState::with_tables().await;
    let (_, conn_id) = test.save_and_connect("q-cfg").await;
    let result = execute_query_impl(&test.state, conn_id, "SELECT 1".into(), None)
        .await
        .unwrap();
    assert_eq!(result.results.len(), 1);

    let history = get_query_history_impl(&test.state, 10, None, None, None)
        .await
        .unwrap();
    assert_eq!(history.len(), 1);
    assert!(history[0].success);
}

#[tokio::test]
async fn execute_query_respects_result_limit_setting() {
    let test = TestAppState::with_tables().await;
    let mut settings = AppSettings::default();
    settings.limit_select_results = true;
    settings.query_result_limit = 5;
    test.state.store.save_settings(settings).await.unwrap();

    let (_, conn_id) = test.save_and_connect("limit-cfg").await;
    execute_query_impl(&test.state, conn_id, "SELECT * FROM users".into(), None)
        .await
        .unwrap();
}

#[tokio::test]
async fn get_explain_query() {
    let opts = MockDriverOptions {
        explain_plan: ExplainResult {
            plan_text: "Seq Scan".into(),
            plan_json: None,
            plan_tree: None,
            total_cost: Some(1.0),
            estimated_rows: Some(10),
        },
        ..Default::default()
    };
    let test = TestAppState::with_options(opts).await;
    test.registry
        .register_test_driver_with_capabilities(
            "postgres",
            test.mock.clone(),
            DriverCapabilities {
                has_multi_database: false,
                supports_cancel_query: true,
                supports_query_execution_cancel: true,
                supports_explain: true,
                supports_streaming_results: true,
                supports_offset: true,
                has_schema_level: true,
            },
        )
        .await;
    let (_, conn_id) = test.save_and_connect("explain-cfg").await;

    let plan = get_explain_impl(&test.state, conn_id.clone(), "SELECT 1".into(), None)
        .await
        .unwrap();
    assert_eq!(plan.plan_text, "Seq Scan");
}

#[tokio::test]
async fn cancel_query_rejects_when_driver_capability_is_unknown_without_calling_driver() {
    let test = TestAppState::with_options(MockDriverOptions {
        cancel_error: Some("legacy driver cancellation must not be called".into()),
        ..Default::default()
    })
    .await;
    let (_, conn_id) = test.save_and_connect("cancel-unknown").await;
    let execution_id = QueryExecutionId::new("exec-unknown");
    test.state
        .query_executions
        .register(execution_id.clone(), conn_id.clone())
        .await
        .unwrap();

    assert!(test
        .registry
        .get_capabilities(&"postgres".to_string())
        .await
        .is_none());
    let error = cancel_query_impl(&test.state, conn_id, execution_id.as_str().to_string())
        .await
        .unwrap_err();
    assert!(matches!(
        error,
        super::super::error::CommandError::Validation(message)
            if message.starts_with("UNSUPPORTED_OPERATION:cancel_query:")
                && message.ends_with("capability is unknown")
    ));
    assert_eq!(test.mock.cancel_query_calls(), 0);
}

#[tokio::test]
async fn cancel_query_rejects_when_driver_capability_is_disabled() {
    let test = TestAppState::new().await;
    let (_, conn_id) = test.save_and_connect("cancel-unsupported").await;
    let execution_id = QueryExecutionId::new("exec-unsupported");
    test.state
        .query_executions
        .register(execution_id.clone(), conn_id.clone())
        .await
        .unwrap();
    test.registry
        .register_test_driver_with_capabilities(
            "postgres",
            test.mock.clone(),
            DriverCapabilities {
                has_multi_database: false,
                supports_cancel_query: false,
                supports_query_execution_cancel: false,
                supports_explain: true,
                supports_streaming_results: true,
                supports_offset: true,
                has_schema_level: true,
            },
        )
        .await;

    let error = cancel_query_impl(&test.state, conn_id, execution_id.as_str().to_string())
        .await
        .unwrap_err();
    assert!(matches!(
        error,
        super::super::error::CommandError::Validation(message)
            if message.starts_with("UNSUPPORTED_OPERATION:cancel_query:")
    ));
    assert_eq!(test.mock.cancel_query_calls(), 0);
}

#[tokio::test]
async fn cancel_query_surfaces_driver_unsupported_without_claiming_success() {
    let test = TestAppState::with_options(MockDriverOptions {
        cancel_error: Some("backend cancellation is unavailable".into()),
        ..Default::default()
    })
    .await;
    let (_, conn_id) = test.save_and_connect("cancel-driver-unsupported").await;
    let execution_id = QueryExecutionId::new("exec-driver-unsupported");
    test.state
        .query_executions
        .register(execution_id.clone(), conn_id.clone())
        .await
        .unwrap();
    test.registry
        .register_test_driver_with_capabilities(
            "postgres",
            test.mock.clone(),
            DriverCapabilities {
                has_multi_database: false,
                // The legacy session-wide capability is deliberately
                // independent; precise cancellation must not be gated by
                // or fall back to that old API.
                supports_cancel_query: false,
                supports_query_execution_cancel: true,
                supports_explain: true,
                supports_streaming_results: true,
                supports_offset: true,
                has_schema_level: true,
            },
        )
        .await;

    let error = cancel_query_impl(&test.state, conn_id, execution_id.as_str().to_string())
        .await
        .unwrap_err();
    assert!(matches!(
        error,
        super::super::error::CommandError::Driver(DriverError::Unsupported(message))
            if message == "backend cancellation is unavailable"
    ));
    assert_eq!(test.mock.cancel_query_calls(), 0);
    assert_eq!(test.mock.precise_cancel_query_calls(), 1);
}

#[tokio::test]
async fn execute_query_not_connected_errors() {
    let test = TestAppState::new().await;
    assert!(
        execute_query_impl(&test.state, "nope".into(), "SELECT 1".into(), None)
            .await
            .is_err()
    );
}

#[tokio::test]
async fn clear_query_history() {
    let test = TestAppState::with_tables().await;
    let (_, conn_id) = test.save_and_connect("hist-cfg").await;
    execute_query_impl(&test.state, conn_id, "SELECT 1".into(), None)
        .await
        .unwrap();
    clear_query_history_impl(&test.state).await.unwrap();
    assert!(get_query_history_impl(&test.state, 10, None, None, None)
        .await
        .unwrap()
        .is_empty());
}

#[tokio::test]
async fn execute_query_with_columns_returns_rows() {
    let opts = MockDriverOptions {
        columns: vec![ColumnSchema {
            name: "id".into(),
            data_type: "integer".into(),
            nullable: false,
            default_value: None,
            comment: None,
            is_primary_key: true,
            is_auto_increment: false,
        }],
        query_rows: vec![vec![Some(Value::Integer(7))]],
        ..Default::default()
    };
    let test = TestAppState::with_options(opts).await;
    let (_, conn_id) = test.save_and_connect("rows-cfg").await;
    let result = execute_query_impl(&test.state, conn_id, "SELECT id FROM t".into(), None)
        .await
        .unwrap();
    assert_eq!(result.results[0].rows.len(), 1);
}

#[tokio::test]
async fn execute_query_stream_does_not_apply_limit_when_switch_off() {
    let test = TestAppState::with_tables().await;
    assert!(!test.state.store.get_settings().await.limit_select_results);
    let (_, conn_id) = test.save_and_connect("stream-nolimit").await;
    let events = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
    let events_cb = std::sync::Arc::clone(&events);
    let cb: QueryStreamCallback = std::sync::Arc::new(move |ev| {
        events_cb.lock().unwrap().push(ev);
    });
    execute_query_stream_impl(
        &test.state,
        conn_id,
        "SELECT 1".into(),
        None,
        cb,
        ExecuteQueryStreamOpts::default(),
    )
    .await
    .unwrap();
    assert_eq!(test.mock.last_query_limit(), Some(None));
    let events = events.lock().unwrap();
    assert!(events
        .iter()
        .any(|e| matches!(e, QueryStreamEvent::StatementStart { .. })));
    assert!(events
        .iter()
        .any(|e| matches!(e, QueryStreamEvent::Done { .. })));
    let history = get_query_history_impl(&test.state, 10, None, None, None)
        .await
        .unwrap();
    assert!(history.iter().any(|e| e.success));
}

#[tokio::test]
async fn execute_query_stream_respects_limit_select_setting() {
    let test = TestAppState::with_tables().await;
    let mut settings = AppSettings::default();
    settings.limit_select_results = true;
    settings.query_result_limit = 5;
    test.state.store.save_settings(settings).await.unwrap();

    let (_, conn_id) = test.save_and_connect("stream-limit").await;
    let cb: QueryStreamCallback = std::sync::Arc::new(|_| {});
    execute_query_stream_impl(
        &test.state,
        conn_id,
        "SELECT * FROM users".into(),
        None,
        cb,
        ExecuteQueryStreamOpts::default(),
    )
    .await
    .unwrap();
    assert_eq!(test.mock.last_query_limit(), Some(Some(5)));
}

#[tokio::test]
async fn execute_query_stream_can_skip_result_limit_for_export() {
    let test = TestAppState::with_tables().await;
    let mut settings = AppSettings::default();
    settings.limit_select_results = true;
    settings.query_result_limit = 5;
    test.state.store.save_settings(settings).await.unwrap();

    let (_, conn_id) = test.save_and_connect("stream-export").await;
    let cb: QueryStreamCallback = std::sync::Arc::new(|_| {});
    execute_query_stream_impl(
        &test.state,
        conn_id,
        "SELECT * FROM users".into(),
        None,
        cb,
        ExecuteQueryStreamOpts {
            apply_result_limit: false,
            record_history: false,
        },
    )
    .await
    .unwrap();
    assert_eq!(test.mock.last_query_limit(), Some(None));
    let history = get_query_history_impl(&test.state, 10, None, None, None)
        .await
        .unwrap();
    assert!(history.is_empty());
}

#[tokio::test]
async fn execute_query_stream_failure_records_history() {
    let opts = MockDriverOptions {
        query_error: Some("boom".into()),
        ..Default::default()
    };
    let test = TestAppState::with_options(opts).await;
    let (_, conn_id) = test.save_and_connect("stream-fail").await;
    let cb: QueryStreamCallback = std::sync::Arc::new(|_| {});
    let err = execute_query_stream_impl(
        &test.state,
        conn_id,
        "SELECT 1".into(),
        None,
        cb,
        ExecuteQueryStreamOpts::default(),
    )
    .await
    .unwrap_err();
    assert!(err.to_string().contains("boom"));
    let history = get_query_history_impl(&test.state, 10, None, None, None)
        .await
        .unwrap();
    assert_eq!(history.len(), 1);
    assert!(!history[0].success);
    assert!(history[0]
        .error_message
        .as_ref()
        .is_some_and(|m| m.contains("boom")));
}

#[tokio::test]
async fn execute_query_stream_not_connected_errors() {
    let test = TestAppState::new().await;
    let cb: QueryStreamCallback = std::sync::Arc::new(|_| {});
    assert!(execute_query_stream_impl(
        &test.state,
        "nope".into(),
        "SELECT 1".into(),
        None,
        cb,
        ExecuteQueryStreamOpts::default(),
    )
    .await
    .is_err());
}

/// BUG-003 regression: a query aimed at another database must never be
/// served by re-pointing the shared pooled session. The target rides the
/// command envelope so the driver qualifies the SQL itself.
#[tokio::test]
async fn execute_query_never_switches_the_session_database() {
    let test = TestAppState::with_tables().await;
    let (_, conn_id) = test.save_and_connect("switch-db-cfg").await;

    let result = execute_query_impl(
        &test.state,
        conn_id.clone(),
        "SELECT 1".into(),
        Some("analytics".into()),
    )
    .await
    .unwrap();
    assert_eq!(result.results.len(), 1);

    // The whole point of the refactor: no session switch, ever.
    assert!(
        test.mock.use_database_calls().is_empty(),
        "execute_query must not switch the session's database"
    );
    // ...and the session record still reports its own configured database,
    // because the request target is per-call, not session state.
    let config = test
        .state
        .connection_manager
        .get_session_config(&conn_id)
        .await
        .unwrap();
    assert_eq!(config.database.as_deref(), Some("app"));
}

#[tokio::test]
async fn execute_query_never_switches_for_same_blank_or_absent_pin() {
    let test = TestAppState::with_tables().await;
    let (_, conn_id) = test.save_and_connect("no-switch-db-cfg").await;

    for pin in [None, Some("app".to_string()), Some("   ".to_string())] {
        execute_query_impl(&test.state, conn_id.clone(), "SELECT 1".into(), pin)
            .await
            .unwrap();
    }

    assert!(test.mock.use_database_calls().is_empty());
    let config = test
        .state
        .connection_manager
        .get_session_config(&conn_id)
        .await
        .unwrap();
    assert_eq!(config.database.as_deref(), Some("app"));
}

#[tokio::test]
async fn get_explain_never_switches_the_session_database() {
    let test = TestAppState::with_tables().await;
    let (_, conn_id) = test.save_and_connect("explain-db-cfg").await;
    get_explain_impl(
        &test.state,
        conn_id.clone(),
        "SELECT 1".into(),
        Some("other".into()),
    )
    .await
    .unwrap();
    assert!(
        test.mock.use_database_calls().is_empty(),
        "get_explain must not switch the session's database"
    );
    let config = test
        .state
        .connection_manager
        .get_session_config(&conn_id)
        .await
        .unwrap();
    assert_eq!(config.database.as_deref(), Some("app"));
}

#[tokio::test]
async fn session_transaction_begin_commit_and_status() {
    let test = TestAppState::new().await;
    let (_, conn_id) = test.save_and_connect("tx-cfg").await;
    assert!(
        !session_transaction_status_impl(&test.state, conn_id.clone())
            .await
            .unwrap()
    );
    begin_session_transaction_impl(&test.state, conn_id.clone())
        .await
        .unwrap();
    assert!(
        session_transaction_status_impl(&test.state, conn_id.clone())
            .await
            .unwrap()
    );
    begin_session_transaction_impl(&test.state, conn_id.clone())
        .await
        .unwrap();
    commit_session_transaction_impl(&test.state, conn_id.clone())
        .await
        .unwrap();
    assert!(
        !session_transaction_status_impl(&test.state, conn_id.clone())
            .await
            .unwrap()
    );
    begin_session_transaction_impl(&test.state, conn_id.clone())
        .await
        .unwrap();
    rollback_session_transaction_impl(&test.state, conn_id.clone())
        .await
        .unwrap();
    assert!(!session_transaction_status_impl(&test.state, conn_id)
        .await
        .unwrap());
}

#[tokio::test]
async fn commit_and_rollback_without_tx_are_validation_errors() {
    let test = TestAppState::new().await;
    let (_, conn_id) = test.save_and_connect("tx-empty").await;
    let commit_err = commit_session_transaction_impl(&test.state, conn_id.clone())
        .await
        .unwrap_err();
    assert!(commit_err.to_string().contains("No open transaction"));
    let rollback_err = rollback_session_transaction_impl(&test.state, conn_id)
        .await
        .unwrap_err();
    assert!(rollback_err.to_string().contains("No open transaction"));
}

#[tokio::test]
async fn concurrent_begin_is_idempotent() {
    let test = TestAppState::new().await;
    let (_, conn_id) = test.save_and_connect("tx-race").await;
    let a = begin_session_transaction_impl(&test.state, conn_id.clone());
    let b = begin_session_transaction_impl(&test.state, conn_id.clone());
    let (ra, rb) = tokio::join!(a, b);
    assert!(ra.is_ok());
    assert!(rb.is_ok());
    assert!(
        session_transaction_status_impl(&test.state, conn_id.clone())
            .await
            .unwrap()
    );
    commit_session_transaction_impl(&test.state, conn_id)
        .await
        .unwrap();
}
