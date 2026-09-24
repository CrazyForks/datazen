use super::*;
use crate::types::ColumnInfo;

fn col(name: &str) -> ColumnInfo {
    ColumnInfo {
        name: name.into(),
        data_type: "text".into(),
        nullable: true,
    }
}

#[test]
fn command_definitions_include_schema_object_commands() {
    let defs = schema_object_command_definitions();
    let ids: Vec<&str> = defs.iter().map(|d| d.id.as_str()).collect();
    assert!(ids.contains(&"list_objects"));
    assert!(ids.contains(&"get_object_ddl"));
    assert!(ids.contains(&"get_object_dependencies"));
    assert!(ids.contains(&"list_privileges"));
    assert!(is_schema_object_command("get_object_dependencies"));
}

#[test]
fn parse_object_list_maps_name_and_schema() {
    let result = QueryResult {
        columns: vec![col("schema"), col("name")],
        rows: vec![vec![
            Some(Value::String("public".into())),
            Some(Value::String("fn_ok".into())),
        ]],
        rows_affected: None,
        execution_time_ms: 0,
    };
    let objects = parse_object_list(&result, "function").unwrap();
    assert_eq!(objects.len(), 1);
    assert_eq!(objects[0].name, "fn_ok");
    assert_eq!(objects[0].schema.as_deref(), Some("public"));
}

#[test]
fn parse_object_list_preserves_routine_and_trigger_identity() {
    let result = QueryResult {
        columns: vec![
            col("schema"),
            col("name"),
            col("signature"),
            col("target_schema"),
            col("target_name"),
        ],
        rows: vec![vec![
            Some(Value::String("public".into())),
            Some(Value::String("lookup".into())),
            Some(Value::String("integer".into())),
            Some(Value::String("public".into())),
            Some(Value::String("orders".into())),
        ]],
        rows_affected: None,
        execution_time_ms: 0,
    };
    let objects = parse_object_list(&result, "function").unwrap();
    assert_eq!(objects[0].signature.as_deref(), Some("integer"));
    assert_eq!(objects[0].target_schema.as_deref(), Some("public"));
    assert_eq!(objects[0].target_name.as_deref(), Some("orders"));
}

#[test]
fn parse_object_list_preserves_empty_zero_argument_signature() {
    let result = QueryResult {
        columns: vec![col("name"), col("signature")],
        rows: vec![vec![
            Some(Value::String("zero_arg".into())),
            Some(Value::String(String::new())),
        ]],
        rows_affected: None,
        execution_time_ms: 0,
    };
    let objects = parse_object_list(&result, "function").unwrap();
    assert_eq!(objects[0].signature.as_deref(), Some(""));
}

#[test]
fn parse_object_list_empty_when_no_columns() {
    let result = QueryResult {
        columns: vec![],
        rows: vec![],
        rows_affected: None,
        execution_time_ms: 0,
    };
    assert!(parse_object_list(&result, "function").unwrap().is_empty());
}

#[test]
fn parse_dependency_catalog_preserves_qualified_overloaded_identities() {
    let result = QueryResult {
        columns: vec![
            col("selected_count"),
            col("unsupported_count"),
            col("kind"),
            col("dependency_schema"),
            col("name"),
            col("signature"),
        ],
        rows: vec![vec![
            Some(Value::Integer(1)),
            Some(Value::Integer(0)),
            Some(Value::String("function".into())),
            Some(Value::String("sales".into())),
            Some(Value::String("normalize".into())),
            Some(Value::String("text, integer".into())),
        ]],
        rows_affected: None,
        execution_time_ms: 0,
    };
    let (selected, unsupported, dependencies, type_usages, type_usage_complete) =
        parse_object_dependency_catalog(&result, false).unwrap();
    assert_eq!(selected, Some(1));
    assert_eq!(unsupported, Some(0));
    assert_eq!(dependencies.len(), 1);
    assert_eq!(dependencies[0].kind, "function");
    assert_eq!(dependencies[0].schema.as_deref(), Some("sales"));
    assert_eq!(dependencies[0].name, "normalize");
    assert_eq!(dependencies[0].signature.as_deref(), Some("text, integer"));
    assert!(type_usages.is_empty());
    assert!(type_usage_complete);
}

#[test]
fn parse_dependency_catalog_exposes_declared_column_type_usage() {
    let result = QueryResult {
        columns: vec![
            col("selected_count"),
            col("unsupported_count"),
            col("kind"),
            col("dependency_schema"),
            col("name"),
            col("signature"),
            col("type_usage"),
            col("column_name"),
        ],
        rows: vec![vec![
            Some(Value::Integer(1)),
            Some(Value::Integer(0)),
            Some(Value::String("type".into())),
            Some(Value::String("public".into())),
            Some(Value::String("account_status".into())),
            None,
            Some(Value::String("column_type".into())),
            Some(Value::String("status".into())),
        ]],
        rows_affected: None,
        execution_time_ms: 0,
    };
    let (_, _, dependencies, usages, complete) =
        parse_object_dependency_catalog(&result, true).unwrap();
    assert!(complete);
    assert_eq!(dependencies.len(), 1);
    assert_eq!(usages.len(), 1);
    assert_eq!(usages[0].dependency.name, "account_status");
    assert_eq!(usages[0].usage, TypeDependencyUsageKind::ColumnType);
    assert_eq!(usages[0].column_name.as_deref(), Some("status"));
}

#[test]
fn parse_dependency_catalog_marks_unattributed_type_use_incomplete() {
    let result = QueryResult {
        columns: vec![
            col("selected_count"),
            col("unsupported_count"),
            col("kind"),
            col("dependency_schema"),
            col("name"),
            col("signature"),
            col("type_usage"),
            col("column_name"),
        ],
        rows: vec![vec![
            Some(Value::Integer(1)),
            Some(Value::Integer(0)),
            Some(Value::String("type".into())),
            Some(Value::String("public".into())),
            Some(Value::String("account_status".into())),
            None,
            None,
            None,
        ]],
        rows_affected: None,
        execution_time_ms: 0,
    };
    let (_, _, dependencies, usages, complete) =
        parse_object_dependency_catalog(&result, true).unwrap();
    assert_eq!(dependencies.len(), 1);
    assert!(usages.is_empty());
    assert!(!complete);
}

#[test]
fn dependency_catalog_rejects_unqualified_known_edges() {
    let result = QueryResult {
        columns: vec![
            col("selected_count"),
            col("unsupported_count"),
            col("kind"),
            col("dependency_schema"),
            col("name"),
            col("signature"),
        ],
        rows: vec![vec![
            Some(Value::Integer(1)),
            Some(Value::Integer(0)),
            Some(Value::String("table".into())),
            None,
            Some(Value::String("customers".into())),
            None,
        ]],
        rows_affected: None,
        execution_time_ms: 0,
    };
    assert!(parse_object_dependency_catalog(&result, true).is_err());
}

#[test]
fn extract_object_ddl_prefers_named_column() {
    let result = QueryResult {
        columns: vec![col("Function"), col("Create Function")],
        rows: vec![vec![
            Some(Value::String("fn_ok".into())),
            Some(Value::String("CREATE FUNCTION fn_ok() ...".into())),
        ]],
        rows_affected: None,
        execution_time_ms: 0,
    };
    let ddl = extract_object_ddl(&result);
    assert!(ddl.contains("CREATE FUNCTION"));
}

#[test]
fn checked_ddl_rejects_missing_and_ambiguous_results() {
    let empty = QueryResult {
        columns: vec![col("ddl")],
        rows: vec![],
        rows_affected: None,
        execution_time_ms: 0,
    };
    assert!(extract_object_ddl_checked(&empty).is_err());

    let ambiguous = QueryResult {
        columns: vec![col("ddl")],
        rows: vec![
            vec![Some(Value::String("CREATE FUNCTION a()".into()))],
            vec![Some(Value::String("CREATE FUNCTION a(integer)".into()))],
        ],
        rows_affected: None,
        execution_time_ms: 0,
    };
    assert!(extract_object_ddl_checked(&ambiguous).is_err());
}

#[test]
fn parse_privilege_list_skips_incomplete_rows() {
    let result = QueryResult {
        columns: vec![col("grantee"), col("schema"), col("name"), col("privilege")],
        rows: vec![
            vec![
                Some(Value::String("alice".into())),
                Some(Value::String("public".into())),
                Some(Value::String("users".into())),
                Some(Value::String("SELECT".into())),
            ],
            vec![None, None, None, None],
        ],
        rows_affected: None,
        execution_time_ms: 0,
    };
    let grants = parse_privilege_list(&result).unwrap();
    assert_eq!(grants.len(), 1);
    assert_eq!(grants[0].grantee, "alice");
}
