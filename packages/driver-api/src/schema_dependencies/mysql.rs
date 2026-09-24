/// MySQL's information-schema dependency rows are privilege-filtered. This
/// proof query is necessary before those rows can be marked complete.
pub const MYSQL_DEPENDENCY_GRANTS_SQL: &str = "SHOW GRANTS FOR CURRENT_USER()";

/// MySQL omits loadable UDFs from VIEW_ROUTINE_USAGE. If any are installed,
/// the view dependency list cannot prove that no such function is referenced.
pub const MYSQL_UDF_CATALOG_SQL: &str = "SELECT COUNT(*) AS udf_count FROM mysql.func";

/// Conservatively prove global visibility for view dependencies.
///
/// A direct global SELECT grant covers view and table/view usage rows, and a
/// direct global EXECUTE grant covers stored functions. ALL PRIVILEGES covers
/// both. Any partial revoke invalidates the proof.
pub fn mysql_dependency_grants_are_complete(grants: &[String]) -> bool {
    let mut global_select = false;
    let mut global_execute = false;
    let mut revoked = false;

    for grant in grants {
        let normalized = grant.trim().to_ascii_uppercase();
        if normalized.starts_with("REVOKE ") {
            revoked = true;
            continue;
        }
        if !normalized.starts_with("GRANT ") {
            continue;
        }
        let Some(grant_end) = normalized.find(" ON *.* TO ") else {
            continue;
        };
        for privilege in normalized[6..grant_end].split(',').map(str::trim) {
            match privilege {
                "ALL" | "ALL PRIVILEGES" => {
                    global_select = true;
                    global_execute = true;
                }
                "SELECT" => global_select = true,
                "EXECUTE" => global_execute = true,
                _ => {}
            }
        }
    }

    global_select && global_execute && !revoked
}

pub(super) fn mysql_view_dependencies_sql(name: &str, schema_filter: &str) -> String {
    format!(
        r#"
        WITH selected_views AS (
            SELECT TABLE_SCHEMA AS schema_name, TABLE_NAME AS object_name
            FROM information_schema.VIEWS
            WHERE TABLE_NAME = {name}{schema_filter}
        ),
        catalog_dependencies AS (
            SELECT selected.schema_name AS view_schema, selected.object_name AS view_name,
                CASE referenced.TABLE_TYPE WHEN 'VIEW' THEN 'view' ELSE 'table' END AS kind,
                view_usage.TABLE_SCHEMA AS dependency_schema, view_usage.TABLE_NAME AS name,
                NULL AS signature
            FROM selected_views AS selected
            JOIN information_schema.VIEW_TABLE_USAGE AS view_usage
              ON view_usage.VIEW_SCHEMA = selected.schema_name AND view_usage.VIEW_NAME = selected.object_name
            LEFT JOIN information_schema.TABLES AS referenced
              ON referenced.TABLE_SCHEMA = view_usage.TABLE_SCHEMA AND referenced.TABLE_NAME = view_usage.TABLE_NAME

            UNION

            SELECT selected.schema_name AS view_schema, selected.object_name AS view_name,
                'function' AS kind, routine.ROUTINE_SCHEMA AS dependency_schema,
                routine.ROUTINE_NAME AS name, NULL AS signature
            FROM selected_views AS selected
            JOIN information_schema.VIEW_ROUTINE_USAGE AS view_usage
              ON view_usage.TABLE_SCHEMA = selected.schema_name AND view_usage.TABLE_NAME = selected.object_name
            JOIN information_schema.ROUTINES AS routine
              ON routine.ROUTINE_SCHEMA = view_usage.SPECIFIC_SCHEMA
             AND routine.SPECIFIC_NAME = view_usage.SPECIFIC_NAME
             AND routine.ROUTINE_TYPE = 'FUNCTION'
        )
        SELECT (SELECT count(*) FROM selected_views) AS selected_count,
               0 AS unsupported_count,
               dependencies.kind, dependencies.dependency_schema, dependencies.name, dependencies.signature
        FROM (SELECT 1) AS seed
        LEFT JOIN catalog_dependencies AS dependencies ON TRUE
        ORDER BY dependencies.kind, dependencies.dependency_schema, dependencies.name
        "#
    )
}
