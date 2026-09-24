//! Live regression for safe PostgreSQL trigger-function dependency proof and
//! exact user-defined table column types.
//!
//! Run only against an isolated migration database with explicit credentials:
//! MIGRATION_TEST_DATABASE=<database> cargo test -p datazen-driver-postgres --test schema_function_dependency_catalog -- --ignored --nocapture

use datazen_driver_api::{ConnectionConfig, DatabaseDriver};
use datazen_driver_postgres::PostgresDriver;
use serde_json::json;

fn config(database: String) -> ConnectionConfig {
    ConnectionConfig {
        id: format!("schema-function-catalog-{}", uuid::Uuid::new_v4()),
        name: "schema function catalog regression".into(),
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
async fn function_catalog_proves_only_exact_passthrough_and_table_snapshot_keeps_enum_identity() {
    let database = std::env::var("MIGRATION_TEST_DATABASE")
        .expect("MIGRATION_TEST_DATABASE must name a disposable database");
    assert!(
        database.starts_with("dz_mig_") || database == "datazen_sync_src",
        "refuse non-test database"
    );
    let suffix = uuid::Uuid::new_v4().simple().to_string();
    let enum_type = format!("dz_bug003_enum_{suffix}");
    let table = format!("dz_bug003_table_{suffix}");
    let safe_function = format!("dz_bug003_safe_fn_{suffix}");
    let hidden_function = format!("dz_bug003_hidden_fn_{suffix}");
    let driver = PostgresDriver::new();
    let handle = driver
        .connect(&config(database.clone()))
        .await
        .expect("connect to isolated PostgreSQL database");

    let lookup = async {
        for sql in [
            format!("CREATE TYPE public.{enum_type} AS ENUM ('active')"),
            format!("CREATE TABLE public.{table} (status public.{enum_type})"),
            format!(
                "CREATE FUNCTION public.{safe_function}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$"
            ),
            format!(
                "CREATE FUNCTION public.{hidden_function}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM status FROM public.{table}; RETURN NEW; END $$"
            ),
        ] {
            driver
                .execute(&handle, &sql)
                .await
                .map_err(|error| error.to_string())?;
        }

        let safe = driver
            .execute_command(
                &handle,
                "get_object_dependencies",
                json!({"kind":"function","schema":"public","name":safe_function,"signature":""}),
            )
            .await
            .map_err(|error| error.to_string())?
            .data;
        let hidden = driver
            .execute_command(
                &handle,
                "get_object_dependencies",
                json!({"kind":"function","schema":"public","name":hidden_function,"signature":""}),
            )
            .await
            .map_err(|error| error.to_string())?
            .data;
        let table_schema = driver
            .get_table_schema(&handle, &table, &database, Some("public"))
            .await
            .map_err(|error| error.to_string())?;
        let column_type = table_schema
            .columns
            .iter()
            .find(|column| column.name == "status")
            .map(|column| column.data_type.clone())
            .ok_or_else(|| "typed table status column was not returned".to_owned())?;
        Ok::<_, String>((safe, hidden, column_type))
    }
    .await;

    for sql in [
        format!("DROP FUNCTION IF EXISTS public.{hidden_function}()"),
        format!("DROP FUNCTION IF EXISTS public.{safe_function}()"),
        format!("DROP TABLE IF EXISTS public.{table} CASCADE"),
        format!("DROP TYPE IF EXISTS public.{enum_type}"),
    ] {
        driver
            .execute(&handle, &sql)
            .await
            .unwrap_or_else(|error| panic!("fixture cleanup failed for owned object: {error}"));
    }
    driver.disconnect(handle).await.expect("disconnect");

    let (safe, hidden, column_type) =
        lookup.unwrap_or_else(|error| panic!("catalog lookup: {error}"));
    assert_eq!(safe["complete"], true, "exact passthrough proof: {safe}");
    assert_eq!(safe["dependencies"], json!([]));
    assert_eq!(
        hidden["complete"], false,
        "a body with an untracked table reference must remain incomplete: {hidden}"
    );
    assert_eq!(column_type, format!("public.{enum_type}"));
}
