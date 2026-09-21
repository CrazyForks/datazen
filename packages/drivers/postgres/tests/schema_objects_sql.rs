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
fn test_tester_routine_identity_filters_prokind_and_escapes_query_literals() {
    let function_list = list_objects_sql("postgresql", ObjectKind::Function).unwrap();
    assert!(function_list.contains("p.prokind = 'f'"));
    assert!(function_list.contains("pg_get_function_identity_arguments(p.oid) AS signature"));
    assert!(!function_list.contains("p.prokind = 'p'"));

    let procedure_list = list_objects_sql("postgresql", ObjectKind::Procedure).unwrap();
    assert!(procedure_list.contains("p.prokind = 'p'"));
    assert!(!procedure_list.contains("p.prokind = 'f'"));

    let function_ddl = object_ddl_sql_with_metadata(
        "postgresql",
        ObjectKind::Function,
        "lookup'name",
        Some("ops'schema"),
        Some("text, uuid'suffix"),
        None,
        None,
    )
    .unwrap();
    assert!(function_ddl.contains("p.proname = 'lookup''name'"));
    assert!(function_ddl.contains("n.nspname = 'ops''schema'"));
    assert!(function_ddl.contains("p.prokind = 'f'"));
    assert!(
        function_ddl.contains("pg_get_function_identity_arguments(p.oid) = 'text, uuid''suffix'")
    );

    let procedure_ddl = object_ddl_sql_with_metadata(
        "postgresql",
        ObjectKind::Procedure,
        "rebuild",
        Some("ops"),
        Some(""),
        None,
        None,
    )
    .unwrap();
    assert!(procedure_ddl.contains("p.prokind = 'p'"));
    assert!(procedure_ddl.contains("pg_get_function_identity_arguments(p.oid) = ''"));
}

#[test]
fn test_tester_trigger_identity_escapes_relation_literals() {
    let sql = object_ddl_sql_with_metadata(
        "postgresql",
        ObjectKind::Trigger,
        "audit'trigger",
        Some("app'schema"),
        None,
        Some("target'schema"),
        Some("orders'table"),
    )
    .unwrap();
    assert!(sql.contains("t.tgname = 'audit''trigger'"));
    assert!(sql.contains("n.nspname = 'app''schema'"));
    assert!(sql.contains("n.nspname = 'target''schema'"));
    assert!(sql.contains("c.relname = 'orders''table'"));
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
