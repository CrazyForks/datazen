//! Structured schema-object dependency catalog contracts and dialect SQL.
//!
//! Results distinguish complete catalogs from dependencies that could be
//! observed. Callers must block an object when complete is false; an empty
//! partial result is never proof of no edges.

mod mysql;
mod postgres;

use crate::schema_objects::{dialect_family, DatabaseObject};

pub use mysql::{
    mysql_dependency_grants_are_complete, MYSQL_DEPENDENCY_GRANTS_SQL, MYSQL_UDF_CATALOG_SQL,
};
pub use postgres::{
    postgres_sequence_dependencies_sql, postgres_table_dependencies_sql,
    postgres_trigger_dependencies_sql, postgres_type_dependencies_sql,
};

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SchemaObjectDependencies {
    pub complete: bool,
    pub dependencies: Vec<DatabaseObject>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub type_dependency_usages: Vec<TypeDependencyUsage>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TypeDependencyUsage {
    pub dependency: DatabaseObject,
    pub usage: TypeDependencyUsageKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub column_name: Option<String>,
}

#[derive(Debug, Clone, Copy, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TypeDependencyUsageKind {
    ColumnType,
    Expression,
    Constraint,
}

impl SchemaObjectDependencies {
    pub fn incomplete() -> Self {
        Self {
            complete: false,
            dependencies: Vec::new(),
            type_dependency_usages: Vec::new(),
        }
    }
}

pub fn view_dependencies_sql(db_type: &str, name: &str, schema: Option<&str>) -> Option<String> {
    let family = dialect_family(db_type);
    let name = sql_string(name);

    match family {
        "postgresql" => {
            let schema_filter = schema
                .map(|schema| format!(" AND view_ns.nspname = {}", sql_string(schema)))
                .unwrap_or_default();
            Some(postgres::postgres_view_dependencies_sql(
                &name,
                &schema_filter,
            ))
        }
        "mysql" => {
            let schema_filter = match schema {
                Some(schema) => format!(" AND TABLE_SCHEMA = {}", sql_string(schema)),
                None => " AND TABLE_SCHEMA = DATABASE()".into(),
            };
            Some(mysql::mysql_view_dependencies_sql(&name, &schema_filter))
        }
        _ => None,
    }
}

pub(super) fn sql_string(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn postgres_dependency_sql_uses_full_catalog_and_exact_routine_identity() {
        let sql = view_dependencies_sql("postgresql", "view'name", Some("sales"))
            .expect("PostgreSQL views have a dependency catalog");
        assert!(sql.contains("pg_catalog.pg_depend"));
        assert!(sql.contains("information_schema.view_table_usage"));
        assert!(sql.contains("information_schema.view_routine_usage"));
        assert!(sql.contains("pg_catalog.nameconcatoid(procedure.proname, procedure.oid)"));
        assert!(sql.contains("pg_catalog.pg_get_function_identity_arguments(procedure.oid)"));
        assert_eq!(
            sql.matches("referenced.oid <> selected.oid").count(),
            2,
            "both pg_depend and view_table_usage edges must exclude the selected view by OID"
        );
        assert!(sql.contains("view_rel.relname = 'view''name'"));
        assert!(sql.contains("view_ns.nspname = 'sales'"));
        assert!(sql.contains("unsupported_count"));
    }

    #[test]
    fn mysql_view_sql_uses_standard_dependency_catalogs_and_scope() {
        let sql = view_dependencies_sql("mysql", "active_view", Some("app"))
            .expect("MySQL views have an information-schema dependency catalog");
        assert!(sql.contains("information_schema.VIEW_TABLE_USAGE"));
        assert!(sql.contains("information_schema.VIEW_ROUTINE_USAGE"));
        assert!(sql.contains("routine.SPECIFIC_NAME = view_usage.SPECIFIC_NAME"));
        assert!(sql.contains("TABLE_SCHEMA = 'app'"));
        assert!(sql.contains("TABLE_NAME = 'active_view'"));
    }

    #[test]
    fn postgres_trigger_sql_returns_structured_relation_and_function_edges() {
        let sql = postgres_trigger_dependencies_sql(
            "audit'trigger",
            Some("app"),
            Some("app"),
            Some("orders"),
        );
        assert!(sql.contains("pg_catalog.pg_trigger"));
        assert!(sql.contains("trigger.tgrelid AS target_oid"));
        assert!(sql.contains("trigger.tgfoid AS function_oid"));
        assert!(sql.contains("pg_catalog.pg_get_function_identity_arguments(procedure.oid)"));
        assert!(sql.contains("trigger.tgname = 'audit''trigger'"));
        assert!(sql.contains("target_ns.nspname = 'app'"));
        assert!(sql.contains("target_rel.relname = 'orders'"));
        assert!(sql.contains("unsupported_count"));
        assert!(sql.contains("selected.constraint_oid <> 0"));
    }

    #[test]
    fn postgres_type_catalog_tracks_dependencies_for_supported_user_types() {
        let sql = postgres_type_dependencies_sql("account_status", Some("public"));
        assert!(sql.contains("user_type.typtype IN ('e', 'd', 'r')"));
        assert!(sql.contains("domain_check.contypid = selected.oid"));
        assert!(sql.contains("pg_catalog.pg_depend"));
        assert!(sql.contains("pg_get_function_identity_arguments(procedure.oid)"));
        assert!(sql.contains("type_ns.nspname = 'public'"));
        assert!(sql.contains("unsupported_count"));
    }

    #[test]
    fn postgres_sequence_and_table_catalogs_return_structured_owned_and_type_edges() {
        let sequence_sql = postgres_sequence_dependencies_sql("orders_id_seq", Some("sales"));
        assert!(sequence_sql.contains("sequence.relkind = 'S'"));
        assert!(sequence_sql.contains("dependency.deptype IN ('a', 'i')"));
        assert!(sequence_sql.contains("owner_rel.relname AS name"));

        let table_sql = postgres_table_dependencies_sql("orders", Some("sales"));
        assert!(table_sql.contains("referenced_type.typtype IN ('e', 'd', 'r', 'c')"));
        assert!(table_sql.contains("constraint_row.conrelid = selected.oid"));
        assert!(table_sql.contains("pg_catalog.pg_attrdef"));
        assert!(table_sql.contains("pg_catalog.pg_depend"));
        assert!(table_sql.contains("AS type_usage"));
        assert!(table_sql.contains("dependency_column.attname"));
        assert!(table_sql.contains("type_constraint.contype = 'c'"));
    }

    #[test]
    fn unknown_catalog_has_no_dependency_sql() {
        assert!(view_dependencies_sql("sqlite", "view", None).is_none());
    }

    #[test]
    fn mysql_visibility_requires_direct_select_execute_and_no_revokes() {
        let grants = vec!["GRANT SELECT, EXECUTE ON *.* TO 'reader'@'localhost'".into()];
        assert!(mysql_dependency_grants_are_complete(&grants));
        assert!(mysql_dependency_grants_are_complete(&[
            "GRANT ALL PRIVILEGES ON *.* TO 'reader'@'localhost' WITH GRANT OPTION".into()
        ]));
        assert!(!mysql_dependency_grants_are_complete(&[
            "GRANT SELECT ON *.* TO 'reader'@'localhost'".into(),
            "GRANT EXECUTE ON app.* TO 'reader'@'localhost'".into(),
        ]));
        assert!(!mysql_dependency_grants_are_complete(&[
            "GRANT SELECT, EXECUTE ON *.* TO 'reader'@'localhost'".into(),
            "REVOKE EXECUTE ON `private`.* FROM 'reader'@'localhost'".into(),
        ]));
    }
}
