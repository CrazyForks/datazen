//! Driver-level regression for PostgreSQL FK metadata used by Schema Diff.
//!
//! Run against a disposable migration database, or the dedicated DataZen sync
//! test database using only unique `dz_mig_fk_*` fixture names:
//! `MIGRATION_TEST_DATABASE=<database> cargo test -p datazen-driver-postgres --test schema_foreign_key_introspection -- --ignored --nocapture`

use datazen_driver_api::{ConnectionConfig, DatabaseDriver};
use datazen_driver_postgres::PostgresDriver;

fn config(database: String) -> ConnectionConfig {
    ConnectionConfig {
        id: format!("schema-fk-{}", uuid::Uuid::new_v4()),
        name: "schema FK introspection regression".into(),
        database_type: "postgresql".into(),
        host: Some(std::env::var("MIGRATION_TEST_HOST").expect("MIGRATION_TEST_HOST")),
        port: Some(
            std::env::var("MIGRATION_TEST_PORT")
                .expect("MIGRATION_TEST_PORT")
                .parse()
                .expect("valid MIGRATION_TEST_PORT"),
        ),
        database: Some(database),
        schema: Some("public".into()),
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
async fn selected_table_schema_preserves_foreign_key_metadata() {
    let database = std::env::var("MIGRATION_TEST_DATABASE")
        .expect("MIGRATION_TEST_DATABASE must name a disposable database");
    assert!(
        database.starts_with("dz_mig_") || database == "datazen_sync_src",
        "refuse non-test database"
    );
    let suffix = uuid::Uuid::new_v4().simple().to_string();
    let parent = format!("dz_mig_fk_parent_{suffix}");
    let source_child = format!("dz_mig_fk_source_child_{suffix}");
    let target_child = format!("dz_mig_fk_target_child_{suffix}");
    let constraint = format!("dz_mig_fk_constraint_{suffix}");
    let driver = PostgresDriver::new();
    let handle = driver
        .connect(&config(database.clone()))
        .await
        .expect("connect to isolated PostgreSQL database");

    let schemas = async {
        driver
            .execute(
                &handle,
                &format!("CREATE TABLE public.{parent} (id INTEGER PRIMARY KEY)"),
            )
            .await
            .map_err(|error| error.to_string())?;
        driver
            .execute(
                &handle,
                &format!(
                    "CREATE TABLE public.{source_child} (id INTEGER PRIMARY KEY, parent_id INTEGER NOT NULL, CONSTRAINT {constraint} FOREIGN KEY (parent_id) REFERENCES public.{parent}(id))"
                ),
            )
            .await
            .map_err(|error| error.to_string())?;
        driver
            .execute(
                &handle,
                &format!(
                    "CREATE TABLE public.{target_child} (id INTEGER PRIMARY KEY, parent_id INTEGER NOT NULL)"
                ),
            )
            .await
            .map_err(|error| error.to_string())?;
        let source_schema = driver
            .get_table_schema(&handle, &source_child, &database, Some("public"))
            .await
            .map_err(|error| error.to_string())?;
        let target_schema = driver
            .get_table_schema(&handle, &target_child, &database, Some("public"))
            .await
            .map_err(|error| error.to_string())?;
        Ok::<_, String>((source_schema, target_schema))
    }
    .await;

    for table in [&source_child, &target_child, &parent] {
        driver
            .execute(&handle, &format!("DROP TABLE IF EXISTS public.{table}"))
            .await
            .expect("remove unique-prefix fixture table");
    }
    driver.disconnect(handle).await.expect("disconnect");
    let (source_schema, target_schema) = schemas.expect("create and read FK fixtures");

    assert_eq!(source_schema.foreign_keys.len(), 1);
    assert_eq!(source_schema.foreign_keys[0].name, constraint);
    assert_eq!(
        source_schema.foreign_keys[0].columns,
        vec!["parent_id".to_string()]
    );
    assert_eq!(source_schema.foreign_keys[0].referenced_table, parent);
    assert_eq!(
        source_schema.foreign_keys[0].referenced_columns,
        vec!["id".to_string()]
    );
    assert!(target_schema.foreign_keys.is_empty());
}
