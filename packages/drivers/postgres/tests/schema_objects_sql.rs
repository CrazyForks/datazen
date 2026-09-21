//! PostgreSQL dialect SQL for schema object browser queries (list / DDL / privileges).

use datazen_driver_api::schema_objects::{
    list_objects_sql, list_privileges_sql, object_ddl_sql, object_ddl_sql_with_metadata, ObjectKind,
};

#[test]
fn function_list_sql_excludes_catalog() {
    let sql = list_objects_sql("postgresql", ObjectKind::Function).unwrap();
    assert!(sql.contains("pg_proc"));
    assert!(sql.contains("pg_catalog"));
}

#[test]
fn view_queries_return_schema_and_query_body_metadata() {
    let list = list_objects_sql("postgresql", ObjectKind::View).unwrap();
    assert!(list.contains("pg_views"));
    assert!(list.contains("viewname AS name"));
    let ddl = object_ddl_sql(
        "postgresql",
        ObjectKind::View,
        "active_users",
        Some("public"),
    )
    .unwrap();
    assert!(ddl.contains("pg_get_viewdef"));
    assert!(ddl.contains("'public'"));
}

#[test]
fn trigger_ddl_uses_pg_get_triggerdef() {
    let sql = object_ddl_sql("postgresql", ObjectKind::Trigger, "trg", Some("public")).unwrap();
    assert!(sql.contains("pg_get_triggerdef"));
}

#[test]
fn routine_catalog_and_ddl_use_overload_signature() {
    let list = list_objects_sql("postgresql", ObjectKind::Procedure).unwrap();
    assert!(list.contains("pg_get_function_identity_arguments"));
    assert!(list.contains("p.prokind = 'p'"));
    let ddl = object_ddl_sql_with_metadata(
        "postgresql",
        ObjectKind::Procedure,
        "rebuild",
        Some("ops"),
        Some("uuid, text"),
        None,
        None,
    )
    .unwrap();
    assert!(ddl.contains("'uuid, text'"));
    assert!(ddl.contains("p.prokind = 'p'"));
}

#[test]
fn trigger_ddl_can_filter_attached_relation() {
    let sql = object_ddl_sql_with_metadata(
        "postgresql",
        ObjectKind::Trigger,
        "audit_trigger",
        Some("app"),
        None,
        Some("app"),
        Some("orders"),
    )
    .unwrap();
    assert!(sql.contains("c.relname = 'orders'"));
}

#[test]
fn function_ddl_defaults_public_schema() {
    let sql = object_ddl_sql("postgres", ObjectKind::Function, "fn", None).unwrap();
    assert!(sql.contains("'public'"));
    assert_eq!(ObjectKind::Function.as_str(), "function");
    assert_eq!(ObjectKind::Procedure.as_str(), "procedure");
    assert_eq!(ObjectKind::Trigger.as_str(), "trigger");
}

#[test]
fn function_ddl_escapes_quotes_in_name() {
    let sql = object_ddl_sql("postgresql", ObjectKind::Function, "f\"n", Some("s")).unwrap();
    assert!(sql.contains("pg_get_functiondef"));
    assert!(sql.contains("'f\"n'") || sql.contains("f\"n"));
}

#[test]
fn privilege_sql_includes_roles_and_table_grants() {
    let pg = list_privileges_sql("postgres").unwrap();
    assert!(pg.contains("role_table_grants"));
    assert!(
        pg.contains("pg_roles"),
        "PG should include role-level privileges"
    );
}
