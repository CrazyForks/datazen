//! Independent driver-level transfer journey for the generic migration contract.

use std::sync::{Arc, Mutex};

use datazen_driver_api::*;
use datazen_driver_sqlite::SqliteDriver;

fn config(path: &str) -> ConnectionConfig {
    ConnectionConfig {
        id: format!("tester-transfer-{}", uuid::Uuid::new_v4()),
        name: "tester transfer".into(),
        database_type: "sqlite".into(),
        host: None,
        port: None,
        database: Some(path.into()),
        schema: None,
        username: None,
        password: None,
        ssl_mode: Default::default(),
        connection_timeout: 5,
        max_pool_size: 1,
        ssh_tunnel: None,
        color_tag: None,
        group: None,
        last_connected_at: None,
        server_version: None,
        options: None,
        read_only: false,
        pinned: false,
    }
}

async fn collect_rows(
    driver: &SqliteDriver,
    handle: &ConnectionHandle,
    sql: &str,
) -> Vec<Vec<Option<Value>>> {
    let rows = Arc::new(Mutex::new(Vec::new()));
    let sink = Arc::clone(&rows);
    driver
        .query_stream(
            handle,
            sql,
            None,
            Arc::new(move |event| {
                if let QueryStreamEvent::Rows { rows, .. } = event {
                    sink.lock().unwrap().extend(rows);
                }
            }),
        )
        .await
        .unwrap();
    Arc::try_unwrap(rows).unwrap().into_inner().unwrap()
}

#[tokio::test]
async fn test_tester_projected_bound_transfer_preserves_values_and_rolls_back_failed_table() {
    let directory = std::env::temp_dir().join(format!(
        "datazen-tester-transfer-{}",
        uuid::Uuid::new_v4()
    ));
    std::fs::create_dir_all(&directory).unwrap();
    let source_path = directory.join("source.db");
    let target_path = directory.join("target.db");
    std::fs::File::create(&source_path).unwrap();
    std::fs::File::create(&target_path).unwrap();

    let source = SqliteDriver::new();
    let target = SqliteDriver::new();
    let source_handle = source
        .connect(&config(source_path.to_str().unwrap()))
        .await
        .unwrap();
    let target_handle = target
        .connect(&config(target_path.to_str().unwrap()))
        .await
        .unwrap();

    source
        .execute(
            &source_handle,
            "CREATE TABLE source_rows (skipped TEXT, payload BLOB, amount TEXT, label TEXT)",
        )
        .await
        .unwrap();
    let source_insert = "INSERT INTO source_rows VALUES (?, ?, ?, ?)";
    let bytes = (0..=255).collect::<Vec<u8>>();
    let exact = "12345678901234567890123456789012345.123456789012345678901234567890";
    for label in ["first ' \\ \n 雪", "second"] {
        source
            .execute_with_params(
                &source_handle,
                source_insert,
                &[
                    Value::String("ignored".into()),
                    Value::Bytes(bytes.clone()),
                    Value::String(exact.into()),
                    Value::String(label.into()),
                ],
            )
            .await
            .unwrap();
    }

    // Explicit SELECT order models a reordered/subset transfer projection.
    let rows = collect_rows(
        &source,
        &source_handle,
        "SELECT label, payload, amount FROM source_rows ORDER BY rowid",
    )
    .await;
    assert_eq!(rows.len(), 2);
    assert!(matches!(&rows[0][0], Some(Value::String(value)) if value.starts_with("first")));
    assert!(matches!(&rows[0][1], Some(Value::Bytes(value)) if value == &bytes));
    assert!(matches!(&rows[0][2], Some(Value::String(value)) if value == exact));

    target
        .execute(
            &target_handle,
            "CREATE TABLE target_rows (label TEXT UNIQUE, payload BLOB, amount TEXT)",
        )
        .await
        .unwrap();
    target
        .execute(&target_handle, "INSERT INTO target_rows VALUES ('kept', X'01', '1')")
        .await
        .unwrap();

    // A failure after the first bound write must preserve the pre-existing target.
    let tx = target.begin_transaction(&target_handle).await.unwrap();
    target
        .execute_with_params(
            &target_handle,
            "INSERT INTO target_rows VALUES (?, ?, ?)",
            &rows[0].iter().cloned().map(Option::unwrap).collect::<Vec<_>>(),
        )
        .await
        .unwrap();
    let duplicate = vec![
        rows[0][0].clone().unwrap(),
        rows[1][1].clone().unwrap(),
        rows[1][2].clone().unwrap(),
    ];
    assert!(target
        .execute_with_params(
            &target_handle,
            "INSERT INTO target_rows VALUES (?, ?, ?)",
            &duplicate,
        )
        .await
        .is_err());
    target.rollback(tx).await.unwrap();

    let after_rollback = target
        .query(
            &target_handle,
            "SELECT label, hex(payload), amount FROM target_rows ORDER BY label",
        )
        .await
        .unwrap();
    assert_eq!(after_rollback.rows.len(), 1);
    assert!(matches!(&after_rollback.rows[0][0], Some(Value::String(value)) if value == "kept"));

    let tx = target.begin_transaction(&target_handle).await.unwrap();
    for row in &rows {
        let params = row.iter().cloned().map(Option::unwrap).collect::<Vec<_>>();
        assert_eq!(
            target
                .execute_with_params(
                    &target_handle,
                    "INSERT INTO target_rows VALUES (?, ?, ?)",
                    &params,
                )
                .await
                .unwrap(),
            1
        );
    }
    target.commit(tx).await.unwrap();

    let copied = target
        .query(
            &target_handle,
            "SELECT label, payload, amount FROM target_rows WHERE label <> 'kept' ORDER BY label",
        )
        .await
        .unwrap();
    assert_eq!(copied.rows.len(), 2);
    assert!(matches!(&copied.rows[0][1], Some(Value::Bytes(value)) if value == &bytes));
    assert!(copied.rows.iter().all(
        |row| matches!(&row[2], Some(Value::String(value)) if value == exact)
    ));

    source.disconnect(source_handle).await.unwrap();
    target.disconnect(target_handle).await.unwrap();
    std::fs::remove_dir_all(directory).unwrap();
}
