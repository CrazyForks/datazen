//! Live regression for MySQL structured view dependencies.
//!
//! Run against an existing test database with unique fixtures:
//! MIGRATION_TEST_DATABASE=datazen_test MIGRATION_TEST_USER=root MIGRATION_TEST_PASSWORD= cargo test -p datazen-driver-mysql --test schema_dependency_catalog -- --ignored --nocapture

use datazen_driver_api::{ConnectionConfig, DatabaseDriver};
use datazen_driver_mysql::MysqlDriver;
use serde_json::{json, Value};

fn config(database: String) -> ConnectionConfig {
    ConnectionConfig {
        id: format!("schema-dependency-{}", uuid::Uuid::new_v4()),
        name: "schema dependency catalog regression".into(),
        database_type: "mysql".into(),
        host: Some(std::env::var("MIGRATION_TEST_HOST").expect("MIGRATION_TEST_HOST")),
        port: Some(
            std::env::var("MIGRATION_TEST_PORT")
                .expect("MIGRATION_TEST_PORT")
                .parse()
                .expect("valid MIGRATION_TEST_PORT"),
        ),
        database: Some(database),
        schema: None,
        username: Some(std::env::var("MIGRATION_TEST_USER").expect("MIGRATION_TEST_USER")),
        password: Some(std::env::var("MIGRATION_TEST_PASSWORD").unwrap_or_default()),
        ssl_mode: Default::default(),
        connection_timeout: 5,
        max_pool_size: 2,
        ssh_tunnel: None,
        tunnel_kind: None,
        tunnel_id: None,
        http_proxy_tunnel: None,
        websocket_tunnel: None,
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
#[ignore = "requires an isolated MIGRATION_TEST_DATABASE and explicit credentials"]
async fn view_dependency_catalog_returns_exact_table_and_routine_edges_when_visible() {
    let database = std::env::var("MIGRATION_TEST_DATABASE")
        .expect("MIGRATION_TEST_DATABASE must name a test database");
    assert!(
        database == "datazen_test" || database.starts_with("dz_mig_"),
        "refuse non-test database"
    );
    let suffix = uuid::Uuid::new_v4().simple().to_string();
    let table_name = format!("dz_mig_dep_base_{suffix}");
    let view_name = format!("dz_mig_dep_view_{suffix}");
    let routine_name = format!("dz_mig_dep_fn_{suffix}");

    let driver = MysqlDriver::new(false);
    let handle = driver
        .connect(&config(database.clone()))
        .await
        .expect("connect to isolated MySQL test database");

    let lookup = async {
        driver
            .execute(
                &handle,
                &format!("CREATE TABLE {database}.{table_name} (id INT NOT NULL)"),
            )
            .await
            .map_err(|error| error.to_string())?;
        driver
            .execute(
                &handle,
                &format!(
                    "CREATE FUNCTION {database}.{routine_name}(x INT) RETURNS INT DETERMINISTIC RETURN x"
                ),
            )
            .await
            .map_err(|error| error.to_string())?;
        driver
            .execute(
                &handle,
                &format!(
                    "CREATE VIEW {database}.{view_name} AS SELECT {database}.{routine_name}(id) AS id FROM {database}.{table_name}"
                ),
            )
            .await
            .map_err(|error| error.to_string())?;
        let sql = datazen_driver_api::schema_dependencies::view_dependencies_sql(
            "mysql",
            &view_name,
            Some(&database),
        )
        .expect("MySQL view catalog query");
        let raw_result = driver
            .query(&handle, &sql)
            .await
            .map_err(|error| format!("raw MySQL dependency catalog query failed: {error}"))?;
        let raw_rows = raw_result.rows;
        let result = driver
            .execute_command(
                &handle,
                "get_object_dependencies",
                json!({"kind":"view","schema":database,"name":view_name}),
            )
            .await
            .map_err(|error| error.to_string())?
            .data;
        Ok::<_, String>((result, raw_rows))
    }
    .await;

    // Only these generated, unique objects are owned by this test.
    for sql in [
        format!("DROP VIEW IF EXISTS {database}.{view_name}"),
        format!("DROP FUNCTION IF EXISTS {database}.{routine_name}"),
        format!("DROP TABLE IF EXISTS {database}.{table_name}"),
    ] {
        driver
            .execute(&handle, &sql)
            .await
            .unwrap_or_else(|error| panic!("fixture cleanup failed for owned object: {error}"));
    }
    driver.disconnect(handle).await.expect("disconnect");
    let (result, raw_rows) = lookup.expect("create fixtures and query dependency catalog");

    assert_eq!(
        result["complete"], true,
        "view catalog is complete: {result}"
    );
    assert_eq!(
        raw_rows.len(),
        2,
        "raw query returns table and routine edges"
    );
    assert_has_dependency(&result, "table", &database, &table_name);
    assert_has_dependency(&result, "function", &database, &routine_name);
}

fn assert_has_dependency(data: &Value, kind: &str, schema: &str, name: &str) {
    let dependencies = data["dependencies"]
        .as_array()
        .expect("dependencies array in driver command result");
    assert!(
        dependencies.iter().any(|dependency| {
            dependency["kind"] == kind
                && dependency["schema"] == schema
                && dependency["name"] == name
        }),
        "missing exact dependency {kind} {schema}.{name} in {data}"
    );
}
