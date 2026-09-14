//! Real driver journey; run only against a disposable migration database.
use datazen_driver_api::*;
use datazen_driver_mysql::*;
#[tokio::test]
#[ignore = "requires isolated MIGRATION_TEST_DATABASE and explicit credentials"]
async fn bound_writes_preserve_bytes_decimal_and_transaction_counts() {
    let database = std::env::var("MIGRATION_TEST_DATABASE").expect("isolated database required");
    assert!(
        database.starts_with("dz_mig_"),
        "refuse shared fixture database"
    );
    let driver = MysqlDriver::new(false);
    let config = ConnectionConfig {
        id: format!("migration-bound-{}", uuid::Uuid::new_v4()),
        name: "migration test".into(),
        database_type: "mysql".into(),
        host: Some(std::env::var("MIGRATION_TEST_HOST").unwrap()),
        port: Some(
            std::env::var("MIGRATION_TEST_PORT")
                .unwrap()
                .parse()
                .unwrap(),
        ),
        database: Some(database),
        schema: None,
        username: Some(std::env::var("MIGRATION_TEST_USER").unwrap()),
        password: Some(std::env::var("MIGRATION_TEST_PASSWORD").unwrap_or_default()),
        ssl_mode: Default::default(),
        connection_timeout: 5,
        max_pool_size: 3,
        ssh_tunnel: None,
        color_tag: None,
        group: None,
        last_connected_at: None,
        server_version: None,
        options: None,
        read_only: false,
        pinned: false,
    };
    let handle = driver.connect(&config).await.unwrap();
    let table = driver.quote_ident(&format!("bound_{}", uuid::Uuid::new_v4().simple()));
    driver.execute(&handle, &format!("CREATE TABLE {table} (id INTEGER PRIMARY KEY, payload LONGBLOB, amount DECIMAL(65,30), label TEXT)")).await.unwrap();
    let placeholders = ["INTEGER", "LONGBLOB", "DECIMAL(65,30)", "TEXT"]
        .iter()
        .enumerate()
        .map(|(i, ty)| driver.parameter_placeholder(i + 1, Some(ty)).unwrap())
        .collect::<Vec<_>>()
        .join(", ");
    let sql = format!("INSERT INTO {table} VALUES ({placeholders})");
    let exact = "12345678901234567890123456789012345.123456789012345678901234567890";
    let bytes = (0..=255).collect::<Vec<u8>>();
    let label = "quotes' backslash\\ newline\n Unicode雪";
    let params = vec![
        Value::Integer(1),
        Value::Bytes(bytes.clone()),
        Value::String(exact.into()),
        Value::String(label.into()),
    ];
    let tx = driver.begin_transaction(&handle).await.unwrap();
    assert_eq!(
        driver
            .execute_with_params(&handle, &sql, &params)
            .await
            .unwrap(),
        1
    );
    driver.rollback(tx).await.unwrap();
    assert!(driver
        .query(&handle, &format!("SELECT id FROM {table}"))
        .await
        .unwrap()
        .rows
        .is_empty());
    let tx = driver.begin_transaction(&handle).await.unwrap();
    assert_eq!(
        driver
            .execute_with_params(&handle, &sql, &params)
            .await
            .unwrap(),
        1
    );
    driver.commit(tx).await.unwrap();
    let row = driver
        .query(
            &handle,
            &format!("SELECT payload, amount, label FROM {table}"),
        )
        .await
        .unwrap()
        .rows
        .remove(0);
    assert!(
        matches!(&row[0], Some(Value::Bytes(value)) if value == &bytes),
        "binary value changed"
    );
    assert!(
        matches!(&row[1], Some(Value::String(value)) if value == exact),
        "decimal value changed: {:?}",
        row[1]
    );
    assert!(
        matches!(&row[2], Some(Value::String(value)) if value == label),
        "text value changed"
    );
    let ph = driver.parameter_placeholder(1, Some("INTEGER")).unwrap();
    assert_eq!(
        driver
            .execute_with_params(
                &handle,
                &format!("DELETE FROM {table} WHERE id = {ph}"),
                &[Value::Integer(2)]
            )
            .await
            .unwrap(),
        0
    );
    driver
        .execute(&handle, &format!("DROP TABLE {table}"))
        .await
        .unwrap();
    driver.disconnect(handle).await.unwrap();
}
