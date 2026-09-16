//! Regression probe for schema-qualified migration metadata.

use datazen_driver_api::*;
use datazen_driver_postgres::PostgresDriver;

fn config(database: String, schema: String) -> ConnectionConfig {
    ConnectionConfig {
        id: format!("migration-schema-{}", uuid::Uuid::new_v4()),
        name: "migration schema qualification".into(),
        database_type: "postgresql".into(),
        host: Some(std::env::var("MIGRATION_TEST_HOST").unwrap()),
        port: Some(
            std::env::var("MIGRATION_TEST_PORT")
                .unwrap()
                .parse()
                .unwrap(),
        ),
        database: Some(database),
        schema: Some(schema),
        username: Some(std::env::var("MIGRATION_TEST_USER").unwrap()),
        password: Some(std::env::var("MIGRATION_TEST_PASSWORD").unwrap_or_default()),
        ssl_mode: Default::default(),
        connection_timeout: 5,
        max_pool_size: 2,
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

#[tokio::test]
#[ignore = "requires isolated MIGRATION_TEST_DATABASE and explicit credentials"]
async fn test_tester_bare_table_metadata_respects_connection_schema() {
    let database = std::env::var("MIGRATION_TEST_DATABASE").expect("isolated database required");
    assert!(database.starts_with("dz_mig_"), "refuse shared fixture database");
    let suffix = uuid::Uuid::new_v4().simple().to_string();
    let selected_schema = format!("dt_selected_{suffix}");
    let other_schema = format!("dt_other_{suffix}");
    let table = format!("same_name_{suffix}");
    let driver = PostgresDriver::new();
    let handle = driver
        .connect(&config(database, selected_schema.clone()))
        .await
        .unwrap();

    for sql in [
        format!("CREATE SCHEMA {selected_schema}"),
        format!("CREATE SCHEMA {other_schema}"),
        format!("CREATE TABLE {selected_schema}.{table} (selected_id integer)"),
        format!("CREATE TABLE {other_schema}.{table} (other_payload text)"),
    ] {
        driver.execute(&handle, &sql).await.unwrap();
    }

    let schema = driver.get_table_schema(&handle, &table).await.unwrap();
    driver
        .execute(&handle, &format!("DROP SCHEMA {selected_schema} CASCADE"))
        .await
        .unwrap();
    driver
        .execute(&handle, &format!("DROP SCHEMA {other_schema} CASCADE"))
        .await
        .unwrap();
    driver.disconnect(handle).await.unwrap();

    let names = schema
        .columns
        .iter()
        .map(|column| column.name.as_str())
        .collect::<Vec<_>>();
    assert_eq!(names, vec!["selected_id"]);
}
