use super::*;
use crate::data_transfer::model::{
    Endpoint, TransferMode, TransferOptions, TransferRunRequest, WriteMode,
};

fn job() -> TransferJob {
    TransferJob {
        source: Endpoint {
            db_session_id: "src".into(),
            database: "source_db".into(),
            schema: Some("public".into()),
        },
        target: Some(Endpoint {
            db_session_id: "tgt".into(),
            database: "target_db".into(),
            schema: Some("public".into()),
        }),
        sql_file_target: None,
        mode: TransferMode::Data,
        write_mode: WriteMode::Insert,
        tables: vec![],
        options: TransferOptions::default(),
    }
}

#[test]
fn schema_fingerprint_is_order_independent_and_changes_with_schema() {
    let first = fingerprint_schemas(vec![("a".into(), None), ("b".into(), None)]).unwrap();
    let second = fingerprint_schemas(vec![("b".into(), None), ("a".into(), None)]).unwrap();
    assert_eq!(first, second);
    let changed = fingerprint_schemas(vec![
        ("a".into(), None),
        (
            "b".into(),
            Some(TableSchema {
                table_name: "b".into(),
                columns: vec![],
                primary_keys: vec![],
                indexes: vec![],
                foreign_keys: vec![],
                check_constraints: vec![],
                table_options: Default::default(),
            }),
        ),
    ])
    .unwrap();
    assert_ne!(first, changed);
}

#[test]
fn disabled_mappings_are_excluded_from_the_plan_fingerprint_scope() {
    let mut plan_job = job();
    plan_job
        .tables
        .push(crate::data_transfer::model::TableMapping::auto("users"));
    plan_job.tables.push({
        let mut mapping = crate::data_transfer::model::TableMapping::auto("archived");
        mapping.enabled = false;
        mapping
    });

    let users_schema = TableSchema {
        table_name: "users".into(),
        columns: vec![],
        primary_keys: vec![],
        indexes: vec![],
        foreign_keys: vec![],
        check_constraints: vec![],
        table_options: Default::default(),
    };
    let mut schemas: HashMap<String, TableSchema> = HashMap::new();
    schemas.insert("users".into(), users_schema.clone());
    schemas.insert(
        "archived".into(),
        TableSchema {
            table_name: "archived".into(),
            ..users_schema.clone()
        },
    );

    let scoped = fingerprint_schemas(participating_tables(&plan_job).map(|table| {
        (
            table.source_table.clone(),
            schemas.get(&table.source_table).cloned(),
        )
    }))
    .unwrap();
    let enabled_only = fingerprint_schemas(vec![("users".into(), Some(users_schema))]).unwrap();
    assert_eq!(scoped, enabled_only);

    // A schema change on a disabled relation cannot alter the immutable
    // snapshot, because that relation is outside the execution scope.
    schemas.insert(
        "archived".into(),
        TableSchema {
            table_name: "archived-v2".into(),
            ..TableSchema {
                table_name: "archived".into(),
                columns: vec![],
                primary_keys: vec![],
                indexes: vec![],
                foreign_keys: vec![],
                check_constraints: vec![],
                table_options: Default::default(),
            }
        },
    );
    let after_disabled_change = fingerprint_schemas(participating_tables(&plan_job).map(|table| {
        (
            table.source_table.clone(),
            schemas.get(&table.source_table).cloned(),
        )
    }))
    .unwrap();
    assert_eq!(scoped, after_disabled_change);
}

#[test]
fn expired_plan_is_rejected_and_consumed_plan_is_one_shot() {
    let store = TransferPlanStore::new();
    let driver = crate::testing::mock_driver::MockDriver::new("fixture", Default::default());
    let preview = TransferPreview {
        plan_id: String::new(),
        pairing_path: "direct".into(),
        mode: TransferMode::Data,
        write_mode: WriteMode::Insert,
        ddl: vec![],
        write_plans: vec![],
        warnings: vec![],
        can_execute: true,
        block_reason: None,
    };
    let source = HashMap::new();
    let target = HashMap::new();
    let id = store
        .issue_with_ttl(
            job(),
            &preview,
            driver.as_ref(),
            driver.as_ref(),
            &source,
            &target,
            false,
            Duration::from_secs(60),
        )
        .unwrap();
    let claimed = store.claim(&id).unwrap();
    assert_eq!(claimed.id, id);
    assert!(store.claim(&id).is_err());

    let expired = store
        .issue_with_ttl(
            job(),
            &preview,
            driver.as_ref(),
            driver.as_ref(),
            &source,
            &target,
            false,
            Duration::ZERO,
        )
        .unwrap();
    assert!(store.peek(&expired).is_err());
}

#[test]
fn run_request_rejects_client_replacement_payloads() {
    let request = serde_json::from_value::<TransferRunRequest>(serde_json::json!({
        "planId": "opaque-plan",
        "job": { "source": {}, "target": {}, "tables": [] },
    }));
    assert!(request.is_err());
}

#[test]
fn source_scope_fingerprint_changes_when_recordset_changes() {
    let mut first = job();
    first.tables.push({
        let mut mapping = crate::data_transfer::model::TableMapping::auto("users");
        mapping.recordset = Some(crate::data_transfer::model::TransferRecordset {
            order_by: Some("id".into()),
            start: None,
            end: None,
            tuple_range: None,
            limit: Some(10),
        });
        mapping
    });
    let first_fingerprint = filter_fingerprint(&first).unwrap();
    first.tables[0].recordset.as_mut().unwrap().limit = Some(20);
    assert_ne!(first_fingerprint, filter_fingerprint(&first).unwrap());
    first.tables[0].recordset.as_mut().unwrap().limit = Some(10);
    first.tables[0].recordset.as_mut().unwrap().start =
        Some(crate::data_transfer::model::TransferRecordsetBound {
            value: serde_json::json!(2),
            inclusive: true,
        });
    assert_ne!(first_fingerprint, filter_fingerprint(&first).unwrap());

    let recordset = first.tables[0].recordset.as_mut().unwrap();
    recordset.order_by = None;
    recordset.start = None;
    recordset.tuple_range = Some(crate::data_transfer::model::TransferRecordsetTupleRange {
        columns: vec!["tenant".into(), "sequence".into()],
        start: Some(crate::data_transfer::model::TransferRecordsetTupleBound {
            values: vec![serde_json::json!("a-雪"), serde_json::json!("-3")],
            inclusive: false,
        }),
        end: None,
    });
    let tuple_fingerprint = filter_fingerprint(&first).unwrap();
    first.tables[0]
        .recordset
        .as_mut()
        .unwrap()
        .tuple_range
        .as_mut()
        .unwrap()
        .start
        .as_mut()
        .unwrap()
        .values[1] = serde_json::json!("-2");
    assert_ne!(tuple_fingerprint, filter_fingerprint(&first).unwrap());
    first.tables[0]
        .recordset
        .as_mut()
        .unwrap()
        .tuple_range
        .as_mut()
        .unwrap()
        .start
        .as_mut()
        .unwrap()
        .values[1] = serde_json::json!("-3");
    first.tables[0]
        .recordset
        .as_mut()
        .unwrap()
        .tuple_range
        .as_mut()
        .unwrap()
        .columns = vec!["sequence".into(), "tenant".into()];
    assert_ne!(tuple_fingerprint, filter_fingerprint(&first).unwrap());
}

#[test]
fn sql_file_target_dialect_is_bound_to_the_immutable_plan() {
    let store = TransferPlanStore::new();
    let source = crate::testing::mock_driver::MockDriver::new("postgresql", Default::default());
    let target = crate::testing::mock_driver::MockDriver::new("mysql", Default::default());
    let preview = TransferPreview {
        plan_id: String::new(),
        pairing_path: "sqlFile".into(),
        mode: TransferMode::Data,
        write_mode: WriteMode::Insert,
        ddl: vec![DdlPreviewItem {
            source_table: "users".into(),
            target_table: "users".into(),
            ddl: "CREATE TABLE `users` (`id` INT)".into(),
            kind: crate::data_transfer::DdlPreviewKind::Table,
            depends_on: vec![],
        }],
        write_plans: vec![],
        warnings: vec!["mysql".into()],
        can_execute: true,
        block_reason: None,
    };
    let mut sql_job = job();
    sql_job.target = None;
    sql_job.sql_file_target = Some(crate::data_transfer::SqlFileTarget {
        file_token: "opaque-file".into(),
        database_type: Some("mysql".into()),
        database: None,
        schema: None,
        encoding: None,
        compression: None,
    });
    let id = store
        .issue_with_ttl(
            sql_job.clone(),
            &preview,
            source.as_ref(),
            target.as_ref(),
            &HashMap::new(),
            &HashMap::new(),
            false,
            Duration::from_secs(60),
        )
        .unwrap();
    sql_job.sql_file_target.as_mut().unwrap().database_type = Some("postgresql".into());
    let stored = store.peek(&id).unwrap();
    assert_eq!(stored.target_driver_type, "mysql");
    assert_eq!(
        stored
            .job
            .sql_file_target
            .as_ref()
            .and_then(|target| target.database_type.as_deref()),
        Some("mysql")
    );
    assert_eq!(
        stored
            .sql_file_structure
            .as_ref()
            .and_then(|statements| statements.first())
            .map(|statement| statement.ddl.as_str()),
        Some("CREATE TABLE `users` (`id` INT)")
    );
    assert_eq!(
        stored.target_scope_fingerprint.as_deref(),
        target_scope_fingerprint(&stored.job).unwrap().as_deref()
    );
    let mut changed_scope = stored.job.clone();
    changed_scope.sql_file_target.as_mut().unwrap().database = Some("other_catalog".into());
    assert_ne!(
        stored.target_scope_fingerprint,
        target_scope_fingerprint(&changed_scope).unwrap()
    );
    let mut changed_format = stored.job.clone();
    changed_format.sql_file_target.as_mut().unwrap().compression =
        Some(crate::data_transfer::SqlFileCompression::Gzip);
    assert_ne!(
        stored.target_scope_fingerprint,
        target_scope_fingerprint(&changed_format).unwrap()
    );
}

#[test]
fn test_tester_run_request_rejects_all_client_owned_execution_payloads() {
    for field in ["sql", "ddl", "mapping", "rows"] {
        let mut payload = serde_json::Map::new();
        payload.insert("planId".into(), serde_json::json!("opaque-plan"));
        payload.insert(field.into(), serde_json::json!([]));
        let request =
            serde_json::from_value::<TransferRunRequest>(serde_json::Value::Object(payload));
        assert!(request.is_err(), "client field {field} must be rejected");
    }
}

#[test]
fn resume_checkpoint_is_opaque_single_flight_and_consumed_on_success() {
    let store = TransferPlanStore::new();
    let driver = crate::testing::mock_driver::MockDriver::new("fixture", Default::default());
    let preview = TransferPreview {
        plan_id: String::new(),
        pairing_path: "direct".into(),
        mode: TransferMode::Data,
        write_mode: WriteMode::Insert,
        ddl: vec![],
        write_plans: vec![],
        warnings: vec![],
        can_execute: true,
        block_reason: None,
    };
    let id = store
        .issue_with_ttl(
            job(),
            &preview,
            driver.as_ref(),
            driver.as_ref(),
            &HashMap::new(),
            &HashMap::new(),
            false,
            Duration::from_secs(60),
        )
        .unwrap();
    store.claim(&id).unwrap();
    let token = store
        .create_checkpoint(&id, vec!["users".into()], Vec::new())
        .unwrap();
    assert_ne!(token, id);
    let (_, checkpoint) = store.peek_checkpoint(&token, &id).unwrap();
    assert_eq!(checkpoint.selected_tables, vec!["users"]);
    assert!(store.claim_checkpoint(&token, &id).is_ok());
    assert!(store.peek_checkpoint(&token, &id).is_err());
    store
        .update_checkpoint(&token, vec!["users".into()], false)
        .unwrap();
    let (_, checkpoint) = store.peek_checkpoint(&token, &id).unwrap();
    assert_eq!(checkpoint.completed_tables, vec!["users"]);
    store.claim_checkpoint(&token, &id).unwrap();
    store.update_checkpoint(&token, Vec::new(), true).unwrap();
    assert!(store.peek_checkpoint(&token, &id).is_err());
}

#[test]
fn chunk_checkpoint_binds_progress_and_claims_the_token_once() {
    let store = TransferPlanStore::new();
    let driver = crate::testing::mock_driver::MockDriver::new("fixture", Default::default());
    let preview = TransferPreview {
        plan_id: String::new(),
        pairing_path: "direct".into(),
        mode: TransferMode::Data,
        write_mode: WriteMode::Insert,
        ddl: vec![],
        write_plans: vec![],
        warnings: vec![],
        can_execute: true,
        block_reason: None,
    };
    let plan_id = store
        .issue_with_ttl(
            job(),
            &preview,
            driver.as_ref(),
            driver.as_ref(),
            &HashMap::new(),
            &HashMap::new(),
            false,
            Duration::from_secs(60),
        )
        .unwrap();
    store.claim(&plan_id).unwrap();
    let token = store
        .start_chunk_checkpoint(
            &plan_id,
            vec!["users".into(), "orders".into()],
            Vec::new(),
            ResumeTableProgress {
                source_table: "users".into(),
                target_table: "customer".into(),
                key_columns: vec!["tenant_id".into(), "id".into()],
                chunk_size: 250,
                source_fingerprint: "source-digest-users".into(),
                cursor: None,
                rows_seen: 0,
            },
        )
        .unwrap();
    assert!(store.plans.lock().unwrap()[&plan_id]
        .active_until
        .is_some_and(|until| until > Instant::now()));
    store
        .advance_checkpoint_table(
            &token,
            "users",
            vec![crate::db::Value::Integer(8), crate::db::Value::Integer(21)],
            250,
        )
        .unwrap();
    store
        .prepare_checkpoint_table(
            &token,
            ResumeTableProgress {
                source_table: "orders".into(),
                target_table: "orders_archive".into(),
                key_columns: vec!["order_id".into()],
                chunk_size: 250,
                source_fingerprint: "source-digest-orders".into(),
                cursor: None,
                rows_seen: 0,
            },
        )
        .unwrap();
    store
        .advance_checkpoint_table(&token, "orders", vec![crate::db::Value::Integer(44)], 3)
        .unwrap();
    store
        .update_checkpoint(&token, vec!["users".into()], false)
        .unwrap();

    let (_, checkpoint) = store.peek_checkpoint(&token, &plan_id).unwrap();
    assert_eq!(checkpoint.resume_tables.len(), 2);
    assert_eq!(checkpoint.resume_tables["users"].target_table, "customer");
    assert_eq!(
        checkpoint.resume_tables["users"].key_columns,
        vec!["tenant_id".to_string(), "id".to_string()]
    );
    assert_eq!(checkpoint.resume_tables["users"].chunk_size, 250);
    assert_eq!(checkpoint.resume_tables["users"].rows_seen, 250);
    assert!(matches!(
        checkpoint.resume_tables["users"]
            .cursor
            .as_ref()
            .and_then(|v| v.first()),
        Some(crate::db::Value::Integer(8))
    ));
    assert_eq!(checkpoint.resume_tables["orders"].rows_seen, 3);

    assert!(store.claim_checkpoint(&token, &plan_id).is_ok());
    assert!(store.claim_checkpoint(&token, &plan_id).is_err());
}

#[test]
fn changed_source_digest_rejects_resume_and_session_invalidates_token() {
    let driver = crate::testing::mock_driver::MockDriver::new("fixture", Default::default());
    let preview = TransferPreview {
        plan_id: String::new(),
        pairing_path: "direct".into(),
        mode: TransferMode::Data,
        write_mode: WriteMode::Insert,
        ddl: vec![],
        write_plans: vec![],
        warnings: vec![],
        can_execute: true,
        block_reason: None,
    };
    let plan_id = global_store()
        .issue(
            job(),
            &preview,
            driver.as_ref(),
            driver.as_ref(),
            &HashMap::new(),
            &HashMap::new(),
            false,
        )
        .unwrap();
    global_store().claim(&plan_id).unwrap();
    let mut first =
        TransferCheckpointSession::new(plan_id.clone(), vec!["users".into()], Vec::new(), None);
    first
        .prepare_table(
            "users",
            "users_copy",
            &["id".into()],
            100,
            "digest-before-change",
        )
        .unwrap();
    first
        .advance_table("users", vec![crate::db::Value::Integer(100)], 100)
        .unwrap();
    let token = first.token().unwrap();
    first.finish(Vec::new(), true).unwrap();

    global_store().claim_checkpoint(&token, &plan_id).unwrap();
    let mut resumed = TransferCheckpointSession::new(
        plan_id.clone(),
        vec!["users".into()],
        Vec::new(),
        Some(token.clone()),
    );
    assert!(resumed
        .prepare_table(
            "users",
            "users_copy",
            &["id".into()],
            100,
            "digest-after-source-mutation",
        )
        .is_err());
    assert!(resumed.is_invalidated());
    assert!(global_store().peek_checkpoint(&token, &plan_id).is_err());
    assert_eq!(resumed.finish(Vec::new(), true).unwrap(), None);
}

#[test]
fn checkpoint_ttl_is_independent_from_preview_expiry_and_expires_explicitly() {
    let store = TransferPlanStore::new();
    let driver = crate::testing::mock_driver::MockDriver::new("fixture", Default::default());
    let preview = TransferPreview {
        plan_id: String::new(),
        pairing_path: "direct".into(),
        mode: TransferMode::Data,
        write_mode: WriteMode::Insert,
        ddl: vec![],
        write_plans: vec![],
        warnings: vec![],
        can_execute: true,
        block_reason: None,
    };
    let plan_id = store
        .issue_with_ttl(
            job(),
            &preview,
            driver.as_ref(),
            driver.as_ref(),
            &HashMap::new(),
            &HashMap::new(),
            false,
            Duration::from_secs(60),
        )
        .unwrap();
    store.claim(&plan_id).unwrap();
    {
        let mut plans = store.plans.lock().unwrap();
        plans.get_mut(&plan_id).unwrap().expires_at = Instant::now() - Duration::from_secs(1);
    }
    let token = store
        .create_checkpoint(&plan_id, vec!["users".into()], Vec::new())
        .unwrap();
    let checkpoint = store.checkpoints.lock().unwrap()[&token].clone();
    assert!(checkpoint.expires_at > Instant::now());
    {
        let mut checkpoints = store.checkpoints.lock().unwrap();
        checkpoints.get_mut(&token).unwrap().expires_at = Instant::now() - Duration::from_secs(1);
    }
    assert!(store.peek_checkpoint(&token, &plan_id).is_err());

    let replacement = store
        .issue_with_ttl(
            job(),
            &preview,
            driver.as_ref(),
            driver.as_ref(),
            &HashMap::new(),
            &HashMap::new(),
            false,
            Duration::from_secs(60),
        )
        .unwrap();
    assert_ne!(replacement, plan_id);
    assert!(!store.checkpoints.lock().unwrap().contains_key(&token));
}

#[test]
fn run_request_accepts_only_opaque_resume_token_field() {
    let request = serde_json::from_value::<TransferRunRequest>(serde_json::json!({
        "planId": "opaque-plan",
        "resumeToken": "opaque-checkpoint",
    }))
    .unwrap();
    assert_eq!(request.resume_token.as_deref(), Some("opaque-checkpoint"));
}
