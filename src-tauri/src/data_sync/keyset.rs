//! Keyset (seek) pagination SQL for same-family Data Sync compare.

use datazen_driver_api::Value;

use super::error::DataSyncError;
use super::sql::quote_ident_sql;

/// Build a parameterized `SELECT … ORDER BY pk LIMIT n` for keyset paging.
///
/// First page omits `WHERE`; subsequent pages use tuple comparison
/// `(pk1, pk2, …) > (placeholder…)` matching the PK `ORDER BY`.
pub fn build_keyset_select_sql<P>(
    table: &str,
    database: Option<&str>,
    schema: Option<&str>,
    family: &str,
    columns: &[String],
    pk_columns: &[String],
    after_key: Option<&[Value]>,
    limit: u32,
    quote: char,
    placeholder: P,
) -> Result<(String, Vec<Value>), DataSyncError>
where
    P: Fn(usize) -> String,
{
    let key_idents = pk_columns
        .iter()
        .map(|c| quote_ident_sql(c, quote))
        .collect::<Vec<_>>();
    build_keyset_select_sql_with_order(
        table,
        database,
        schema,
        family,
        columns,
        pk_columns,
        &key_idents,
        after_key,
        limit,
        quote,
        placeholder,
    )
}

/// Build keyset SQL using driver-owned expressions for the key order.
///
/// The expressions are used in both the tuple seek predicate and `ORDER BY`.
/// This is what lets a driver make binary text ordering explicit when the
/// session's default collation is case-insensitive or otherwise unstable.
pub fn build_keyset_select_sql_with_order<P>(
    table: &str,
    database: Option<&str>,
    schema: Option<&str>,
    family: &str,
    columns: &[String],
    pk_columns: &[String],
    key_order_expressions: &[String],
    after_key: Option<&[Value]>,
    limit: u32,
    quote: char,
    placeholder: P,
) -> Result<(String, Vec<Value>), DataSyncError>
where
    P: Fn(usize) -> String,
{
    build_keyset_select_sql_with_order_and_filter(
        table,
        database,
        schema,
        family,
        columns,
        pk_columns,
        key_order_expressions,
        after_key,
        limit,
        quote,
        placeholder,
        None,
    )
}

/// Build a keyset page with an additional server-generated, parameterized
/// predicate. The filter placeholders must already use indexes after the
/// seek-key placeholders, and its parameters are appended after the seek key.
pub fn build_keyset_select_sql_with_order_and_filter<P>(
    table: &str,
    database: Option<&str>,
    schema: Option<&str>,
    family: &str,
    columns: &[String],
    pk_columns: &[String],
    key_order_expressions: &[String],
    after_key: Option<&[Value]>,
    limit: u32,
    quote: char,
    placeholder: P,
    filter: Option<(&str, &[Value])>,
) -> Result<(String, Vec<Value>), DataSyncError>
where
    P: Fn(usize) -> String,
{
    if pk_columns.is_empty() {
        return Err(DataSyncError::validation(
            "keyset paging requires at least one primary key column",
        ));
    }
    if columns.is_empty() {
        return Err(DataSyncError::validation(
            "keyset paging requires at least one selected column",
        ));
    }
    if key_order_expressions.len() != pk_columns.len() {
        return Err(DataSyncError::validation(
            "key order expression count does not match primary key columns",
        ));
    }
    if let Some(key) = after_key {
        if key.len() != pk_columns.len() {
            return Err(DataSyncError::validation(format!(
                "after_key length {} does not match pk column count {}",
                key.len(),
                pk_columns.len()
            )));
        }
    }

    let select_cols = columns
        .iter()
        .map(|c| quote_ident_sql(c, quote))
        .collect::<Vec<_>>()
        .join(", ");
    let order_cols = key_order_expressions
        .iter()
        .map(|c| format!("{c} ASC"))
        .collect::<Vec<_>>()
        .join(", ");

    let mut params = Vec::new();
    let mut where_clauses = Vec::new();
    if let Some(key) = after_key {
        let pk_idents = key_order_expressions.join(", ");
        let placeholders: Vec<String> = (1..=pk_columns.len()).map(|i| placeholder(i)).collect();
        params.extend_from_slice(key);
        where_clauses.push(format!("({pk_idents}) > ({})", placeholders.join(", ")));
    }
    if let Some((filter_sql, filter_params)) = filter {
        if filter_sql.trim().is_empty() {
            return Err(DataSyncError::validation("sync filter predicate is empty"));
        }
        let predicate = filter_sql
            .trim()
            .strip_prefix("WHERE ")
            .or_else(|| filter_sql.trim().strip_prefix("where "))
            .ok_or_else(|| {
                DataSyncError::validation("sync filter predicate must start with WHERE")
            })?;
        if predicate.trim().is_empty() {
            return Err(DataSyncError::validation("sync filter predicate is empty"));
        }
        where_clauses.push(format!("({predicate})"));
        params.extend_from_slice(filter_params);
    }
    let where_clause = if where_clauses.is_empty() {
        String::new()
    } else {
        format!(" WHERE {}", where_clauses.join(" AND "))
    };

    let qualified = super::sql::qualify_relation_sql(family, database, schema, table, quote);
    let sql = format!(
        "SELECT {select_cols} FROM {qualified}{where_clause} ORDER BY {order_cols} LIMIT {limit}",
        limit = limit.max(1),
    );
    Ok((sql, params))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::data_sync::{mysql_placeholder, postgres_placeholder};

    fn cols() -> Vec<String> {
        vec!["id".into(), "name".into(), "age".into()]
    }

    fn pk1() -> Vec<String> {
        vec!["id".into()]
    }

    fn pk2() -> Vec<String> {
        vec!["tenant".into(), "region".into()]
    }

    #[test]
    fn mysql_first_page_single_pk() {
        let (sql, params) = build_keyset_select_sql(
            "users",
            None,
            None,
            "mysql",
            &cols(),
            &pk1(),
            None,
            100,
            '`',
            mysql_placeholder,
        )
        .unwrap();
        assert!(params.is_empty());
        assert_eq!(
            sql,
            "SELECT `id`, `name`, `age` FROM `users` ORDER BY `id` ASC LIMIT 100"
        );
    }

    #[test]
    fn mysql_catalog_qualified_table() {
        let (sql, params) = build_keyset_select_sql(
            "users",
            Some("mydb"),
            None,
            "mysql",
            &cols(),
            &pk1(),
            None,
            100,
            '`',
            mysql_placeholder,
        )
        .unwrap();
        assert!(params.is_empty());
        assert_eq!(
            sql,
            "SELECT `id`, `name`, `age` FROM `mydb`.`users` ORDER BY `id` ASC LIMIT 100"
        );
    }

    #[test]
    fn mysql_next_page_single_pk() {
        let (sql, params) = build_keyset_select_sql(
            "users",
            None,
            None,
            "mysql",
            &cols(),
            &pk1(),
            Some(&[Value::Integer(42)]),
            50,
            '`',
            mysql_placeholder,
        )
        .unwrap();
        assert_eq!(params.len(), 1);
        assert!(matches!(params[0], Value::Integer(42)));
        assert_eq!(
            sql,
            "SELECT `id`, `name`, `age` FROM `users` WHERE (`id`) > (?) ORDER BY `id` ASC LIMIT 50"
        );
    }

    #[test]
    fn mysql_next_page_composite_pk() {
        let cols = vec!["tenant".into(), "region".into(), "n".into()];
        let (sql, params) = build_keyset_select_sql(
            "shards",
            None,
            None,
            "mysql",
            &cols,
            &pk2(),
            Some(&[Value::Integer(1), Value::String("east".into())]),
            10,
            '`',
            mysql_placeholder,
        )
        .unwrap();
        assert_eq!(params.len(), 2);
        assert!(matches!(params[0], Value::Integer(1)));
        assert!(matches!(params[1], Value::String(ref s) if s == "east"));
        assert_eq!(
            sql,
            "SELECT `tenant`, `region`, `n` FROM `shards` WHERE (`tenant`, `region`) > (?, ?) \
             ORDER BY `tenant` ASC, `region` ASC LIMIT 10"
        );
    }

    #[test]
    fn postgres_first_page_single_pk() {
        let (sql, params) = build_keyset_select_sql(
            "users",
            None,
            None,
            "postgresql",
            &cols(),
            &pk1(),
            None,
            25,
            '"',
            postgres_placeholder,
        )
        .unwrap();
        assert!(params.is_empty());
        assert_eq!(
            sql,
            "SELECT \"id\", \"name\", \"age\" FROM \"users\" ORDER BY \"id\" ASC LIMIT 25"
        );
    }

    #[test]
    fn postgres_next_page_composite_pk() {
        let cols = vec!["tenant".into(), "region".into(), "n".into()];
        let (sql, params) = build_keyset_select_sql(
            "shards",
            None,
            None,
            "postgresql",
            &cols,
            &pk2(),
            Some(&[Value::Integer(2), Value::String("west".into())]),
            5,
            '"',
            postgres_placeholder,
        )
        .unwrap();
        assert_eq!(params.len(), 2);
        assert!(matches!(params[0], Value::Integer(2)));
        assert!(matches!(params[1], Value::String(ref s) if s == "west"));
        assert_eq!(
            sql,
            "SELECT \"tenant\", \"region\", \"n\" FROM \"shards\" \
             WHERE (\"tenant\", \"region\") > ($1, $2) \
             ORDER BY \"tenant\" ASC, \"region\" ASC LIMIT 5"
        );
    }

    #[test]
    fn parameterized_filter_is_appended_after_seek_parameters() {
        let (sql, params) = build_keyset_select_sql_with_order_and_filter(
            "users",
            None,
            None,
            "postgresql",
            &cols(),
            &pk1(),
            &["\"id\"".into()],
            Some(&[Value::Integer(9)]),
            10,
            '"',
            postgres_placeholder,
            Some(("WHERE (\"name\" = $2)", &[Value::String("active".into())])),
        )
        .unwrap();
        assert!(matches!(
            params.as_slice(),
            [Value::Integer(9), Value::String(value)] if value == "active"
        ));
        assert_eq!(
            sql,
            "SELECT \"id\", \"name\", \"age\" FROM \"users\" WHERE (\"id\") > ($1) AND ((\"name\" = $2)) ORDER BY \"id\" ASC LIMIT 10"
        );
    }

    #[test]
    fn rejects_empty_pk() {
        let err = build_keyset_select_sql(
            "t",
            None,
            None,
            "postgresql",
            &cols(),
            &[],
            None,
            1,
            '"',
            postgres_placeholder,
        )
        .unwrap_err();
        assert!(err.to_string().contains("primary key"));
    }

    #[test]
    fn rejects_mismatched_after_key() {
        let err = build_keyset_select_sql(
            "t",
            None,
            None,
            "postgresql",
            &cols(),
            &pk2(),
            Some(&[Value::Integer(1)]),
            1,
            '"',
            postgres_placeholder,
        )
        .unwrap_err();
        assert!(err.to_string().contains("after_key length"));
    }

    #[test]
    fn postgres_schema_qualified_table() {
        let (sql, params) = build_keyset_select_sql(
            "users",
            None,
            Some("public"),
            "postgresql",
            &cols(),
            &pk1(),
            None,
            10,
            '"',
            postgres_placeholder,
        )
        .unwrap();
        assert!(params.is_empty());
        assert_eq!(
            sql,
            "SELECT \"id\", \"name\", \"age\" FROM \"public\".\"users\" ORDER BY \"id\" ASC LIMIT 10"
        );
    }

    #[test]
    fn driver_order_expression_is_used_for_seek_and_order() {
        let (sql, params) = build_keyset_select_sql_with_order(
            "users",
            None,
            None,
            "postgresql",
            &cols(),
            &pk1(),
            &[r#""id" COLLATE "C""#.into()],
            Some(&[Value::String("a".into())]),
            10,
            '"',
            postgres_placeholder,
        )
        .unwrap();
        assert_eq!(params.len(), 1);
        assert!(sql.contains(r#"WHERE ("id" COLLATE "C") > ($1)"#));
        assert!(sql.contains(r#"ORDER BY "id" COLLATE "C" ASC"#));
    }
}
