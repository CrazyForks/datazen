//! Unit tests for Data Transfer IPC helpers.

use crate::data_transfer::mapping::auto_map_columns;
use crate::data_transfer::model::{
    Endpoint, SqlFileTarget, TransferOptions, TransferRunOptions, TransferRunSelection,
};
use crate::data_transfer::{
    classify_transfer_pair, TableMapping, TransferJob, TransferMode, TransferRunRequest, WriteMode,
};
use datazen_driver_api::{ColumnSchema, TableSchema};

fn plan_job(source_db_session_id: String, target_db_session_id: String) -> TransferJob {
    TransferJob {
        source: Endpoint {
            db_session_id: source_db_session_id,
            database: "app".into(),
            schema: None,
        },
        target: Some(Endpoint {
            db_session_id: target_db_session_id,
            database: "app".into(),
            schema: None,
        }),
        sql_file_target: None,
        mode: TransferMode::Data,
        write_mode: WriteMode::Insert,
        tables: vec![TableMapping::auto("users")],
        options: TransferOptions::default(),
    }
}

fn transfer_plan_test_options() -> crate::testing::mock_driver::MockDriverOptions {
    let mut options = crate::testing::app_state::rich_mock_options();
    options.columns =
        crate::testing::mock_driver::MockDriver::default_table_schema("users").columns;
    options.parameterized_writes = true;
    options.execute_rows_affected = 1;
    options
}

#[test]
fn pairing_classifies_ir_and_unsupported() {
    let ok = classify_transfer_pair("postgresql", "mysql");
    assert!(ok.supported);
    assert_eq!(ok.path, "ir");

    let bad = classify_transfer_pair("postgresql", "redis");
    assert!(!bad.supported);
}

#[test]
fn auto_map_columns_matches_names_only() {
    let src = TableSchema {
        table_name: "t".into(),
        columns: vec![
            ColumnSchema {
                name: "a".into(),
                data_type: "int".into(),
                nullable: true,
                default_value: None,
                comment: None,
                is_primary_key: false,
                is_auto_increment: false,
            },
            ColumnSchema {
                name: "b".into(),
                data_type: "text".into(),
                nullable: true,
                default_value: None,
                comment: None,
                is_primary_key: false,
                is_auto_increment: false,
            },
        ],
        primary_keys: vec![],
        indexes: vec![],
        foreign_keys: vec![],
    };
    let tgt = TableSchema {
        table_name: "t".into(),
        columns: vec![ColumnSchema {
            name: "a".into(),
            data_type: "integer".into(),
            nullable: true,
            default_value: None,
            comment: None,
            is_primary_key: false,
            is_auto_increment: false,
        }],
        primary_keys: vec![],
        indexes: vec![],
        foreign_keys: vec![],
    };
    let maps = auto_map_columns(&src, &tgt);
    assert_eq!(maps.len(), 1);
    assert_eq!(maps[0].source_column, "a");
}

#[test]
fn table_mapping_auto_sets_same_name() {
    let m = TableMapping::auto("users");
    assert_eq!(m.source_table, "users");
    assert_eq!(m.target_table, "users");
    assert!(m.enabled);
    assert!(!m.create_new);
}

#[tokio::test]
async fn test_tester_preview_execute_plan_is_opaque_and_one_shot() {
    use crate::testing::app_state::TestAppState;

    let test = TestAppState::with_options(transfer_plan_test_options()).await;
    let (_src_config, source) = test.save_and_connect("transfer-plan-src").await;
    let (_tgt_config, target) = test.save_and_connect("transfer-plan-tgt").await;

    let preview =
        super::preview_data_transfer_impl(&test.state, plan_job(source.clone(), target.clone()))
            .await
            .expect("preview should issue an executable plan");
    assert!(!preview.plan_id.is_empty());
    assert!(preview.can_execute);

    let result = super::execute_data_transfer_impl(
        &test.state,
        TransferRunRequest {
            plan_id: preview.plan_id.clone(),
            selection: TransferRunSelection::default(),
            options: TransferRunOptions::default(),
            job_id: None,
        },
    )
    .await
    .expect("the server-owned plan should execute");
    assert_eq!(result.rows_inserted, 1);

    let retry = super::execute_data_transfer_impl(
        &test.state,
        TransferRunRequest {
            plan_id: preview.plan_id,
            selection: TransferRunSelection::default(),
            options: TransferRunOptions::default(),
            job_id: None,
        },
    )
    .await
    .expect_err("a consumed plan must never be replayable");
    assert!(retry.to_string().contains("already consumed"), "{retry}");
}

#[tokio::test]
async fn sql_file_target_uses_opaque_path_and_publishes_atomic_output() {
    use crate::data_transfer::sql_file::register_path;
    use crate::testing::app_state::TestAppState;

    let test = TestAppState::with_options(transfer_plan_test_options()).await;
    let (_config, source) = test.save_and_connect("transfer-sql-file-src").await;
    let dir = tempfile::tempdir().expect("temporary SQL output directory");
    let destination = dir.path().join("transfer.sql");
    let token = register_path(destination.clone()).expect("register SQL destination");
    let job = TransferJob {
        source: Endpoint {
            db_session_id: source,
            database: "app".into(),
            schema: None,
        },
        target: None,
        sql_file_target: Some(SqlFileTarget { file_token: token }),
        mode: TransferMode::Data,
        write_mode: WriteMode::Insert,
        tables: vec![TableMapping::auto("users")],
        options: TransferOptions::default(),
    };

    let preview = super::preview_data_transfer_impl(&test.state, job)
        .await
        .expect("SQL-file preview should issue a plan");
    assert_eq!(preview.pairing_path, "sqlFile");
    assert!(preview.can_execute);
    let result = super::execute_data_transfer_impl(
        &test.state,
        TransferRunRequest {
            plan_id: preview.plan_id,
            selection: TransferRunSelection::default(),
            options: TransferRunOptions::default(),
            job_id: None,
        },
    )
    .await
    .expect("SQL-file plan should execute");
    assert_eq!(result.rows_inserted, 1);
    let output = std::fs::read_to_string(destination).expect("published SQL output");
    assert!(output.contains("INSERT INTO"));
    assert!(output.contains("COMMIT;"));
}

#[tokio::test]
async fn test_tester_disabled_existing_table_does_not_invalidate_plan() {
    use crate::db::{TableInfo, TableType};
    use crate::testing::app_state::TestAppState;

    let mut options = transfer_plan_test_options();
    options.tables.push(TableInfo {
        name: "archived".into(),
        schema: None,
        table_type: TableType::Table,
        row_count: Some(1),
    });
    let test = TestAppState::with_options(options).await;
    let (_src_config, source) = test.save_and_connect("transfer-plan-disabled-src").await;
    let (_tgt_config, target) = test.save_and_connect("transfer-plan-disabled-tgt").await;

    let mut job = plan_job(source, target);
    let mut disabled = TableMapping::auto("archived");
    disabled.enabled = false;
    job.tables.push(disabled);
    let preview = super::preview_data_transfer_impl(&test.state, job)
        .await
        .expect("preview should accept a disabled mapping beside an active one");
    assert!(preview.can_execute);

    let result = super::execute_data_transfer_impl(
        &test.state,
        TransferRunRequest {
            plan_id: preview.plan_id,
            selection: TransferRunSelection::default(),
            options: TransferRunOptions::default(),
            job_id: None,
        },
    )
    .await
    .expect("disabled mappings must not change the execution snapshot");
    assert_eq!(result.rows_inserted, 1);
}

#[tokio::test]
async fn test_tester_changed_driver_contract_fails_before_execution() {
    use crate::testing::app_state::TestAppState;
    use crate::testing::mock_driver::{MockDriver, MockDriverOptions};

    let test = TestAppState::with_options(transfer_plan_test_options()).await;
    let (_src_config, source) = test.save_and_connect("transfer-plan-driver-src").await;
    let (_tgt_config, target) = test.save_and_connect("transfer-plan-driver-tgt").await;
    let preview = super::preview_data_transfer_impl(&test.state, plan_job(source, target))
        .await
        .unwrap();

    let replacement = MockDriver::new(
        "postgres",
        MockDriverOptions {
            table_schema: Some(MockDriver::default_table_schema("users-v2")),
            parameterized_writes: true,
            ..Default::default()
        },
    );
    test.registry
        .register_test_driver("postgres", replacement.clone())
        .await;

    let err = super::execute_data_transfer_impl(
        &test.state,
        TransferRunRequest {
            plan_id: preview.plan_id,
            selection: TransferRunSelection::default(),
            options: TransferRunOptions::default(),
            job_id: None,
        },
    )
    .await
    .expect_err("a changed schema/driver contract must fail closed");
    assert!(err.to_string().contains("schema changed"), "{err}");
    assert_eq!(
        replacement.query_calls(),
        0,
        "no source scan or target write may start"
    );
}

#[tokio::test]
async fn test_tester_read_only_change_fails_before_target_write() {
    use crate::db::ConnectionHandle;
    use crate::testing::app_state::TestAppState;

    let test = TestAppState::with_options(transfer_plan_test_options()).await;
    let (_src_config, source) = test.save_and_connect("transfer-plan-ro-src").await;
    let (_tgt_config, target) = test.save_and_connect("transfer-plan-ro-tgt").await;
    let preview = super::preview_data_transfer_impl(&test.state, plan_job(source, target.clone()))
        .await
        .unwrap();
    let query_calls_before = test.mock.query_calls();

    test.state
        .connection_manager
        .disconnect(&target)
        .await
        .unwrap();
    let mut read_only_config = test
        .store
        .get_connection("transfer-plan-ro-tgt")
        .await
        .expect("target config");
    read_only_config.read_only = true;
    test.state
        .connection_manager
        .insert_test_session(
            &target,
            "transfer-plan-ro-tgt",
            read_only_config,
            ConnectionHandle {
                id: target.clone(),
                pool_id: "pool-transfer-plan-ro-tgt".into(),
            },
        )
        .await;

    let err = super::execute_data_transfer_impl(
        &test.state,
        TransferRunRequest {
            plan_id: preview.plan_id,
            selection: TransferRunSelection::default(),
            options: TransferRunOptions::default(),
            job_id: None,
        },
    )
    .await
    .expect_err("a target becoming read-only must fail closed");
    assert!(err.to_string().contains("read-only"), "{err}");
    assert_eq!(
        test.mock.query_calls(),
        query_calls_before,
        "no transfer scan or target write may start"
    );
}

#[tokio::test]
async fn test_tester_execution_failure_consumes_plan_and_rejects_retry() {
    use crate::testing::app_state::TestAppState;
    use crate::testing::mock_driver::MockDriver;

    let test = TestAppState::with_options(transfer_plan_test_options()).await;
    let (_src_config, source) = test.save_and_connect("transfer-plan-fail-src").await;
    let (_tgt_config, target) = test.save_and_connect("transfer-plan-fail-tgt").await;
    let preview = super::preview_data_transfer_impl(&test.state, plan_job(source, target))
        .await
        .unwrap();

    let mut failing_options = transfer_plan_test_options();
    failing_options.query_error = Some("injected source scan failure".into());
    let failing = MockDriver::new("postgres", failing_options);
    test.registry
        .register_test_driver("postgres", failing)
        .await;

    let request = TransferRunRequest {
        plan_id: preview.plan_id.clone(),
        selection: TransferRunSelection::default(),
        options: TransferRunOptions::default(),
        job_id: None,
    };
    let first = super::execute_data_transfer_impl(&test.state, request.clone())
        .await
        .expect("the failed table must be reported in the execution result");
    assert!(first.partial);
    assert_eq!(first.tables.len(), 1);
    assert!(first.tables[0]
        .error
        .as_deref()
        .is_some_and(|error| error.contains("source scan failure")));

    let retry = super::execute_data_transfer_impl(&test.state, request)
        .await
        .expect_err("a failed run must not be silently replayable");
    assert!(retry.to_string().contains("already consumed"), "{retry}");
}

#[tokio::test]
async fn test_tester_invalid_selection_and_unknown_plan_are_rejected() {
    use crate::testing::app_state::TestAppState;

    let test = TestAppState::with_options(transfer_plan_test_options()).await;
    let (_src_config, source) = test.save_and_connect("transfer-plan-selection-src").await;
    let (_tgt_config, target) = test.save_and_connect("transfer-plan-selection-tgt").await;
    let preview = super::preview_data_transfer_impl(&test.state, plan_job(source, target))
        .await
        .unwrap();

    let invalid = super::execute_data_transfer_impl(
        &test.state,
        TransferRunRequest {
            plan_id: preview.plan_id,
            selection: TransferRunSelection {
                source_tables: Some(vec!["not-in-preview".into()]),
            },
            options: TransferRunOptions::default(),
            job_id: None,
        },
    )
    .await
    .expect_err("the client cannot add an unplanned table");
    assert!(
        invalid.to_string().contains("not in the preview plan"),
        "{invalid}"
    );

    let unknown = super::execute_data_transfer_impl(
        &test.state,
        TransferRunRequest {
            plan_id: "unknown-plan-id".into(),
            selection: TransferRunSelection::default(),
            options: TransferRunOptions::default(),
            job_id: None,
        },
    )
    .await
    .expect_err("unknown plans must fail closed");
    assert!(
        unknown.to_string().contains("unknown or has expired"),
        "{unknown}"
    );
}
