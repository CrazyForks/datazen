//! SQLite dialect SQL for schema object browser queries.

use datazen_driver_api::schema_objects::{
    list_objects_sql, list_privileges_sql, object_ddl_sql, ObjectKind,
};

#[test]
fn has_triggers_only() {
    assert!(list_objects_sql("sqlite", ObjectKind::Trigger).is_some());
    assert!(list_objects_sql("sqlite", ObjectKind::Function).is_none());
    assert!(list_privileges_sql("sqlite").is_none());
}

#[test]
fn trigger_ddl_reads_sqlite_master() {
    let sqlite = object_ddl_sql("sqlite", ObjectKind::Trigger, "trg'x", None).unwrap();
    assert!(sqlite.contains("sqlite_master"));
    assert!(sqlite.contains("trg''x"));
    assert!(object_ddl_sql("sqlite", ObjectKind::Function, "f", None).is_none());
}

#[test]
fn view_queries_return_query_body_from_sqlite_master() {
    let list = list_objects_sql("sqlite", ObjectKind::View).unwrap();
    assert!(list.contains("type = 'view'"));
    let ddl = object_ddl_sql("sqlite", ObjectKind::View, "active_users", None).unwrap();
    assert!(ddl.contains("substr(sql"));
    assert!(ddl.contains("name = 'active_users'"));
}

#[test]
fn function_list_returns_none_so_host_skips_query() {
    // Host IPC returns empty when list_objects_sql is None; assert dialect contract here.
    assert!(list_objects_sql("sqlite", ObjectKind::Function).is_none());
    assert!(list_privileges_sql("sqlite").is_none());
}

#[test]
fn trigger_catalog_exposes_target_table_and_sequences_are_unsupported() {
    let trigger_list = list_objects_sql("sqlite", ObjectKind::Trigger).unwrap();
    assert!(trigger_list.contains("tbl_name AS target_name"));
    assert!(list_objects_sql("sqlite", ObjectKind::Sequence).is_none());
    assert!(object_ddl_sql("sqlite", ObjectKind::Sequence, "seq", None).is_none());
}
