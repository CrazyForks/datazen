use super::*;
use datazen_driver_api::{ColumnSchema, IndexInfo, TableOptions};
use sha2::{Digest, Sha256};

fn source_schema(keys: &[&str]) -> TableSchema {
    TableSchema {
        table_name: "items".into(),
        columns: keys
            .iter()
            .map(|name| ColumnSchema {
                name: (*name).into(),
                data_type: "BIGINT".into(),
                nullable: false,
                default_value: None,
                comment: None,
                is_primary_key: true,
                is_auto_increment: false,
            })
            .collect(),
        primary_keys: keys.iter().map(|key| (*key).into()).collect(),
        indexes: vec![IndexInfo {
            name: "PRIMARY".into(),
            columns: keys.iter().map(|key| (*key).into()).collect(),
            is_unique: true,
            is_primary: true,
            index_type: "BTREE".into(),
        }],
        foreign_keys: Vec::new(),
        check_constraints: Vec::new(),
        table_options: TableOptions {
            supports_consistent_snapshot: Some(true),
            ..TableOptions::default()
        },
    }
}

#[test]
fn scalar_keyset_uses_bound_cursor_after_filter_and_hard_limit() {
    let (sql, params) = build_keyset_page(
        "SELECT \"id\", \"payload\" FROM \"items\"",
        Some("WHERE (\"kind\" = $1)"),
        &[Value::String("active".into())],
        &["id".into()],
        Some(&[Value::Integer(9)]),
        500,
        '"',
        |index, _| Ok(format!("${index}")),
        |_| Some("BIGINT".into()),
    )
    .unwrap();
    assert_eq!(params.len(), 2);
    assert!(matches!(&params[0], Value::String(value) if value == "active"));
    assert!(matches!(params[1], Value::Integer(9)));
    assert!(sql.contains("WHERE ((\"kind\" = $1)) AND \"id\" > $2"));
    assert!(sql.ends_with("ORDER BY \"id\" ASC LIMIT 500"));
    assert!(!sql.contains("OFFSET"));
}

#[test]
fn composite_keyset_uses_complete_pk_tuple_and_correct_parameter_positions() {
    let (sql, params) = build_keyset_page(
        "SELECT `tenant`, `id` FROM `items`",
        Some("WHERE (`kind` = ? AND `enabled` = ?)"),
        &[Value::String("active".into()), Value::Bool(true)],
        &["tenant".into(), "id".into()],
        Some(&[Value::String("west".into()), Value::Integer(11)]),
        25,
        '`',
        |_, _| Ok("?".into()),
        |_| Some("BIGINT".into()),
    )
    .unwrap();
    assert_eq!(params.len(), 4);
    assert!(sql.contains("(`tenant`, `id`) > (?, ?)"));
    assert!(sql.ends_with("ORDER BY `tenant` ASC, `id` ASC LIMIT 25"));
}

#[test]
fn keyset_page_refuses_unbounded_or_oversized_limits() {
    for limit in [0, MAX_TRANSFER_BATCH_SIZE + 1] {
        assert!(build_keyset_page(
            "SELECT `id` FROM `items`",
            None,
            &[],
            &["id".into()],
            None,
            limit,
            '`',
            |_, _| Ok("?".into()),
            |_| Some("BIGINT".into()),
        )
        .is_err());
    }
}

#[test]
fn only_exact_nonnullable_declared_primary_key_order_is_resumable() {
    let scalar = source_schema(&["id"]);
    assert_eq!(
        resumable_primary_key(&scalar, None, "postgresql").unwrap(),
        vec!["id"]
    );
    assert_eq!(
        resumable_primary_key(&source_schema(&["tenant", "id"]), None, "mysql").unwrap(),
        vec!["tenant", "id"]
    );
    assert!(resumable_primary_key(&scalar, None, "sqlite").is_err());
    let mut nullable = scalar.clone();
    nullable.columns[0].nullable = true;
    assert!(resumable_primary_key(&nullable, None, "postgresql").is_err());
}

#[test]
fn fingerprint_hashes_large_values_and_float_bits_with_type_tags() {
    let value_a = Value::String("9007199254740993.0000000000001".into());
    let value_b = Value::String("9007199254740993.0000000000002".into());
    let mut a = Sha256::new();
    let mut b = Sha256::new();
    hash_value(&mut a, Some(&value_a));
    hash_value(&mut b, Some(&value_b));
    assert_ne!(a.finalize(), b.finalize());

    let float_a = Value::Float(f64::from_bits(0x3ff0_0000_0000_0000));
    let float_b = Value::Float(f64::from_bits(0x3ff0_0000_0000_0001));
    let mut a = Sha256::new();
    let mut b = Sha256::new();
    hash_value(&mut a, Some(&float_a));
    hash_value(&mut b, Some(&float_b));
    assert_ne!(a.finalize(), b.finalize());
}

#[test]
fn acknowledged_chunk_with_checkpoint_advance_failure_reports_confirmed_target_state() {
    assert_eq!(
        confirmed_chunk_outcome(true),
        TableExecutionOutcome::Committed
    );
    assert_eq!(
        confirmed_chunk_outcome(false),
        TableExecutionOutcome::PartiallyApplied
    );
}

#[test]
fn batch_size_hard_limit_is_user_visible_api_validation() {
    let mut job = TransferJob {
        source: crate::data_transfer::model::Endpoint {
            db_session_id: "src".into(),
            database: "db".into(),
            schema: None,
        },
        target: Some(crate::data_transfer::model::Endpoint {
            db_session_id: "tgt".into(),
            database: "db".into(),
            schema: None,
        }),
        sql_file_target: None,
        mode: crate::data_transfer::model::TransferMode::Data,
        write_mode: crate::data_transfer::model::WriteMode::Insert,
        tables: Vec::new(),
        options: Default::default(),
    };
    job.options.batch_size = MAX_TRANSFER_BATCH_SIZE + 1;
    assert!(job.options.validate().is_err());
    assert_eq!(effective_chunk_size(500, 200).unwrap(), 300);
    assert_eq!(effective_chunk_size(500, 1_000).unwrap(), 60);
    assert!(remaining_page_limit(500, 5, Some(6)).is_some_and(|limit| limit == 1));
    assert!(remaining_page_limit(500, 6, Some(6)).is_none());
}
