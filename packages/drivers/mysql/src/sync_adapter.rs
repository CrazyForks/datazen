//! MySQL / MariaDB sync adapter.

use datazen_driver_api::{
    BoxedSyncAdapter, ColumnSchema, IRColumn, IRDefault, IRType, SyncAdapterFactory,
    SyncSourceAdapter, SyncTargetAdapter, Value,
};

pub struct MysqlSyncAdapter {
    pub is_mariadb: bool,
}

fn create_mysql() -> BoxedSyncAdapter {
    BoxedSyncAdapter::both(MysqlSyncAdapter { is_mariadb: false })
}

fn create_mariadb() -> BoxedSyncAdapter {
    BoxedSyncAdapter::both(MysqlSyncAdapter { is_mariadb: true })
}

datazen_driver_api::inventory::submit! {
    SyncAdapterFactory {
        // doris / starrocks / manticore / ob_oracle: MySQL wire + information_schema
        db_types: &["mysql", "doris", "starrocks", "manticore", "ob_oracle"],
        create: create_mysql,
    }
}

datazen_driver_api::inventory::submit! {
    SyncAdapterFactory {
        db_types: &["mariadb"],
        create: create_mariadb,
    }
}

// ── helpers ────────────────────────────────────────────────────────

fn strip_modifiers(s: &str) -> String {
    s.to_lowercase()
        .replace(" unsigned", "")
        .replace(" zerofill", "")
}

fn parse_length(s: &str, prefix: &str) -> Option<u32> {
    s.strip_prefix(prefix)
        .and_then(|r| r.trim().strip_prefix('('))
        .and_then(|r| r.strip_suffix(')'))
        .and_then(|n| n.trim().parse().ok())
}

fn parse_precision(s: &str, prefix: &str) -> (u8, u8) {
    if let Some(rest) = s.strip_prefix(prefix) {
        let rest = rest.trim();
        if let Some(inner) = rest.strip_prefix('(').and_then(|r| r.strip_suffix(')')) {
            let parts: Vec<&str> = inner.split(',').collect();
            let p = parts
                .first()
                .and_then(|v| v.trim().parse().ok())
                .unwrap_or(0);
            let s = parts
                .get(1)
                .and_then(|v| v.trim().parse().ok())
                .unwrap_or(0);
            return (p, s);
        }
    }
    (0, 0)
}

fn parse_mysql_default(raw: &str) -> Option<IRDefault> {
    let d = raw.trim();
    if d.is_empty() {
        return None;
    }
    if d == "CURRENT_TIMESTAMP" || d == "current_timestamp()" {
        return Some(IRDefault::CurrentTimestamp);
    }
    if d.parse::<i64>().is_ok()
        || d.parse::<f64>().is_ok()
        || matches!(d.to_ascii_lowercase().as_str(), "true" | "false" | "null")
        || (d.starts_with('\'') && d.ends_with('\''))
    {
        return Some(IRDefault::Literal(d.to_string()));
    }
    if d.contains('(')
        || d.contains(')')
        || d.contains("::")
        || d.contains('+')
        || d.contains('*')
        || d.contains('/')
        || d.contains('`')
    {
        return Some(IRDefault::RawExpression(d.to_string()));
    }
    Some(IRDefault::Literal(format!("'{}'", d.replace('\'', "''"))))
}

// ── SyncSourceAdapter ──────────────────────────────────────────────

impl SyncSourceAdapter for MysqlSyncAdapter {
    fn sync_key_order_expression(
        &self,
        quoted_column: &str,
        contract: &datazen_driver_api::SyncKeyContract,
    ) -> String {
        match &contract.kind {
            datazen_driver_api::SyncKeyKind::Text {
                collation: datazen_driver_api::SyncKeyCollation::Binary,
            } => format!("BINARY {quoted_column}"),
            _ => quoted_column.to_string(),
        }
    }

    fn column_to_ir(&self, column: &ColumnSchema, _native_full_type: Option<&str>) -> IRColumn {
        let base = strip_modifiers(&column.data_type);

        let ir_type = if base.starts_with("tinyint(1)") {
            IRType::Bool
        } else if base.starts_with("tinyint") {
            IRType::Int8
        } else if base.starts_with("smallint") {
            IRType::Int16
        } else if base.starts_with("mediumint") {
            IRType::Int32
        } else if base.starts_with("bigint") {
            IRType::Int64
        } else if base.starts_with("int(") || base == "int" || base == "integer" {
            IRType::Int32
        } else if base.starts_with("varchar") {
            let len = parse_length(&base, "varchar");
            IRType::Varchar { length: len }
        } else if base.starts_with("char(") {
            let len = parse_length(&base, "char").unwrap_or(1);
            IRType::Char { length: len }
        } else if base.starts_with("decimal") {
            let (p, s) = parse_precision(&base, "decimal");
            IRType::Decimal {
                precision: p,
                scale: s,
            }
        } else if base.starts_with("enum(")
            || base.starts_with("set(")
            || base == "enum"
            || base == "set"
        {
            IRType::Text
        } else if base.starts_with("varbinary") {
            let len = parse_length(&base, "varbinary");
            IRType::Binary { length: len }
        } else if base.starts_with("binary") {
            let len = parse_length(&base, "binary");
            IRType::Binary { length: len }
        } else if base.starts_with("bit(") || base == "bit" {
            if base == "bit(1)" || base == "bit" {
                IRType::Bool
            } else {
                let len = parse_length(&base, "bit").unwrap_or(1);
                IRType::Bit { length: len }
            }
        } else {
            match base.as_str() {
                "float" => IRType::Float32,
                "double" => IRType::Float64,
                "datetime" | "timestamp" => IRType::Timestamp {
                    with_timezone: false,
                },
                "date" => IRType::Date,
                "time" => IRType::Time {
                    with_timezone: false,
                },
                "year" => IRType::Int16,
                "text" | "longtext" | "mediumtext" | "tinytext" => IRType::Text,
                "blob" | "longblob" | "mediumblob" | "tinyblob" => IRType::Blob,
                "json" => IRType::Json,
                _ => IRType::Other(column.data_type.clone()),
            }
        };

        IRColumn {
            name: column.name.clone(),
            ir_type,
            nullable: column.nullable,
            default_expr: column
                .default_value
                .as_deref()
                .and_then(parse_mysql_default),
            is_primary_key: column.is_primary_key,
            is_auto_increment: column.is_auto_increment,
            comment: column.comment.clone(),
        }
    }

    fn unsupported_transfer_structure_query(
        &self,
        database: &str,
        schema: Option<&str>,
        table: &str,
    ) -> Option<String> {
        // Hex + explicit UTF-8 conversion is independent of SQL mode, unlike
        // backslash escaping which changes under NO_BACKSLASH_ESCAPES.
        let catalog = if database.trim().is_empty() {
            schema.filter(|value| !value.trim().is_empty())
        } else {
            Some(database)
        };
        let schema_expr = catalog
            .map(mysql_utf8_hex_expression)
            .unwrap_or_else(|| "DATABASE()".into());
        let name_expr = mysql_utf8_hex_expression(table);
        Some(format!(
            "SELECT CONCAT('generated column ', COLUMN_NAME) AS unsupported_object \
             FROM information_schema.COLUMNS \
             WHERE TABLE_SCHEMA = {schema_expr} AND TABLE_NAME = {name_expr} \
               AND EXTRA LIKE '%GENERATED%' \
             UNION ALL \
             SELECT CONCAT('index ', INDEX_NAME, ' (prefix, functional, or descending column)') \
             FROM information_schema.STATISTICS \
             WHERE TABLE_SCHEMA = {schema_expr} AND TABLE_NAME = {name_expr} \
               AND (SUB_PART IS NOT NULL OR COLUMN_NAME IS NULL OR COLLATION = 'D') \
             UNION ALL \
             SELECT CONCAT('column ', c.COLUMN_NAME, ' (column-specific collation ', c.COLLATION_NAME, ')') \
             FROM information_schema.COLUMNS c \
             JOIN information_schema.TABLES t \
               ON t.TABLE_SCHEMA = c.TABLE_SCHEMA AND t.TABLE_NAME = c.TABLE_NAME \
             WHERE c.TABLE_SCHEMA = {schema_expr} AND c.TABLE_NAME = {name_expr} \
               AND c.COLLATION_NAME IS NOT NULL AND t.TABLE_COLLATION IS NOT NULL \
               AND c.COLLATION_NAME <> t.TABLE_COLLATION \
             UNION ALL \
             SELECT CONCAT('table collation ', t.TABLE_COLLATION, ' (not the database default)') \
             FROM information_schema.TABLES t \
             JOIN information_schema.SCHEMATA s ON s.SCHEMA_NAME = t.TABLE_SCHEMA \
             WHERE t.TABLE_SCHEMA = {schema_expr} AND t.TABLE_NAME = {name_expr} \
               AND s.DEFAULT_COLLATION_NAME IS NOT NULL \
               AND t.TABLE_COLLATION <> s.DEFAULT_COLLATION_NAME"
        ))
    }
}

// ── SyncTargetAdapter ──────────────────────────────────────────────

impl SyncTargetAdapter for MysqlSyncAdapter {
    fn ir_type_to_native(&self, ir_type: &IRType) -> String {
        match ir_type {
            IRType::Bool => "TINYINT(1)".into(),
            IRType::Int8 => "TINYINT".into(),
            IRType::Int16 => "SMALLINT".into(),
            IRType::Int32 => "INT".into(),
            IRType::Int64 => "BIGINT".into(),
            IRType::Float32 => "FLOAT".into(),
            IRType::Float64 => "DOUBLE".into(),
            IRType::Decimal { precision: 0, .. } => "DECIMAL(65,30)".into(),
            IRType::Decimal { precision, scale } => format!("DECIMAL({precision},{scale})"),
            IRType::Char { length } => format!("CHAR({length})"),
            IRType::Varchar { length: Some(n) } => format!("VARCHAR({n})"),
            IRType::Varchar { length: None } => "VARCHAR(255)".into(),
            IRType::Text => "TEXT".into(),
            IRType::Binary { length: Some(n) } => format!("VARBINARY({n})"),
            IRType::Binary { length: None } | IRType::Blob => "LONGBLOB".into(),
            IRType::Date => "DATE".into(),
            IRType::Time { .. } => "TIME".into(),
            IRType::Timestamp { .. } => "DATETIME".into(),
            IRType::Json => "JSON".into(),
            IRType::Uuid => "CHAR(36)".into(),
            IRType::Bit { length } => format!("BIT({length})"),
            IRType::Other(native) => native.clone(),
        }
    }

    fn format_default(&self, default: &IRDefault) -> Option<String> {
        match default {
            IRDefault::CurrentTimestamp => Some("CURRENT_TIMESTAMP".into()),
            IRDefault::Literal(s) => Some(s.clone()),
            IRDefault::RawExpression(_) => None,
        }
    }

    fn allows_column_default(&self, ir_type: &IRType) -> bool {
        !matches!(
            ir_type,
            IRType::Text
                | IRType::Blob
                | IRType::Json
                | IRType::Binary { length: None }
                | IRType::Other(_)
        )
    }

    fn default_capable_type_for(&self, ir_type: &IRType) -> Option<IRType> {
        match ir_type {
            IRType::Text | IRType::Other(_) => Some(IRType::Varchar {
                // utf8mb4 row-limit friendly max; PG text longer than this may truncate.
                length: Some(16_383),
            }),
            _ => None,
        }
    }

    fn format_literal(&self, value: &Option<Value>, _ir_type: &IRType) -> String {
        match value {
            None | Some(Value::Null) => "NULL".into(),
            Some(Value::Bool(b)) => if *b { "1" } else { "0" }.into(),
            Some(Value::Integer(n)) => n.to_string(),
            Some(Value::Float(f)) => f.to_string(),
            Some(Value::String(s)) => format!("'{}'", s.replace('\'', "''")),
            Some(Value::Timestamp(s)) => format!("'{}'", s),
            Some(Value::Json(j)) => format!("'{}'", j.to_string().replace('\'', "''")),
            Some(Value::Bytes(b)) => {
                format!(
                    "X'{}'",
                    b.iter()
                        .map(|byte| format!("{:02x}", byte))
                        .collect::<String>()
                )
            }
        }
    }

    fn quote_char(&self) -> char {
        '`'
    }

    fn qualify_relation(&self, database: &str, schema: Option<&str>, table: &str) -> String {
        let catalog = if database.trim().is_empty() {
            schema.filter(|value| !value.trim().is_empty())
        } else {
            Some(database)
        };
        match catalog {
            Some(catalog) => format!("{}.{}", self.quote_ident(catalog), self.quote_ident(table)),
            None => self.quote_ident(table),
        }
    }

    fn auto_increment_keyword(&self) -> Option<&str> {
        Some("AUTO_INCREMENT")
    }

    fn supports_explicit_identity_values(&self) -> bool {
        true
    }

    fn index_names_are_table_scoped(&self) -> bool {
        true
    }

    fn render_source_table_options(
        &self,
        options: &datazen_driver_api::TableOptions,
    ) -> Result<Option<String>, String> {
        let mut parts = Vec::new();
        if let Some(engine) = options.engine.as_deref() {
            if !engine.eq_ignore_ascii_case("innodb") {
                return Err(format!("source table engine '{engine}' is unsupported"));
            }
            parts.push("ENGINE=InnoDB".to_string());
        }
        if let Some(charset) = options.charset.as_deref() {
            if charset.is_empty()
                || !charset
                    .chars()
                    .all(|ch| ch.is_ascii_alphanumeric() || ch == '_')
            {
                return Err("source table character set is not a safe identifier".into());
            }
            parts.push(format!("DEFAULT CHARACTER SET={charset}"));
        }
        if let Some(comment) = options.comment.as_deref() {
            parts.push(format!("COMMENT='{}'", comment.replace('\'', "''")));
        }
        Ok((!parts.is_empty()).then(|| parts.join(" ")))
    }
}

fn mysql_utf8_hex_expression(value: &str) -> String {
    let hex = value
        .as_bytes()
        .iter()
        .map(|byte| format!("{byte:02X}"))
        .collect::<String>();
    format!("CONVERT(X'{hex}' USING utf8mb4)")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn col(name: &str, data_type: &str) -> ColumnSchema {
        ColumnSchema {
            name: name.into(),
            data_type: data_type.into(),
            nullable: true,
            default_value: None,
            comment: None,
            is_primary_key: false,
            is_auto_increment: false,
        }
    }

    fn adapter() -> MysqlSyncAdapter {
        MysqlSyncAdapter { is_mariadb: false }
    }

    #[test]
    fn mysql_tinyint1_is_bool() {
        let ir = adapter().column_to_ir(&col("active", "tinyint(1)"), None);
        assert_eq!(ir.ir_type, IRType::Bool);
    }

    #[test]
    fn mysql_varchar_to_ir() {
        let ir = adapter().column_to_ir(&col("name", "varchar(100)"), None);
        assert_eq!(ir.ir_type, IRType::Varchar { length: Some(100) });
    }

    #[test]
    fn mysql_unsigned_int() {
        let ir = adapter().column_to_ir(&col("age", "int unsigned"), None);
        assert_eq!(ir.ir_type, IRType::Int32);
    }

    #[test]
    fn mysql_enum_to_text() {
        let ir = adapter().column_to_ir(&col("status", "enum('a','b','c')"), None);
        assert_eq!(ir.ir_type, IRType::Text);
    }

    #[test]
    fn mysql_json() {
        let ir = adapter().column_to_ir(&col("data", "json"), None);
        assert_eq!(ir.ir_type, IRType::Json);
    }

    #[test]
    fn mysql_target_types() {
        let a = adapter();
        assert_eq!(a.ir_type_to_native(&IRType::Bool), "TINYINT(1)");
        assert_eq!(a.ir_type_to_native(&IRType::Int32), "INT");
        assert_eq!(a.ir_type_to_native(&IRType::Uuid), "CHAR(36)");
        assert_eq!(a.ir_type_to_native(&IRType::Json), "JSON");
        assert_eq!(a.ir_type_to_native(&IRType::Blob), "LONGBLOB");
        assert_eq!(
            a.ir_type_to_native(&IRType::Varchar { length: Some(255) }),
            "VARCHAR(255)"
        );
    }

    #[test]
    fn mysql_format_bool_literal() {
        let a = adapter();
        assert_eq!(
            a.format_literal(&Some(Value::Bool(true)), &IRType::Bool),
            "1"
        );
        assert_eq!(
            a.format_literal(&Some(Value::Bool(false)), &IRType::Bool),
            "0"
        );
    }

    #[test]
    fn mysql_mediumint_set_varbinary_bit() {
        let ir = adapter().column_to_ir(&col("n", "mediumint"), None);
        assert_eq!(ir.ir_type, IRType::Int32);
        let ir = adapter().column_to_ir(&col("s", "set('a','b')"), None);
        assert_eq!(ir.ir_type, IRType::Text);
        let ir = adapter().column_to_ir(&col("b", "varbinary(255)"), None);
        assert_eq!(ir.ir_type, IRType::Binary { length: Some(255) });
        let ir = adapter().column_to_ir(&col("f", "bit(8)"), None);
        assert_eq!(ir.ir_type, IRType::Bit { length: 8 });
    }

    #[test]
    fn mysql_default_and_other_type() {
        let mut c = col("ts", "timestamp");
        c.default_value = Some("current_timestamp()".into());
        let ir = adapter().column_to_ir(&c, None);
        assert_eq!(ir.default_expr, Some(IRDefault::CurrentTimestamp));

        let ir = adapter().column_to_ir(&col("x", "geometry"), None);
        assert_eq!(ir.ir_type, IRType::Other("geometry".into()));
    }

    #[test]
    fn mysql_text_with_default_maps_to_varchar() {
        let a = adapter();
        assert_eq!(
            a.default_capable_type_for(&IRType::Text),
            Some(IRType::Varchar {
                length: Some(16_383)
            })
        );
    }

    #[test]
    fn mysql_text_column_default_not_allowed() {
        let a = adapter();
        assert!(!a.allows_column_default(&IRType::Text));
        assert!(!a.allows_column_default(&IRType::Blob));
        assert!(!a.allows_column_default(&IRType::Json));
        assert!(a.allows_column_default(&IRType::Varchar { length: Some(100) }));
    }

    #[test]
    fn mysql_target_and_format_helpers() {
        let a = adapter();
        assert_eq!(a.ir_type_to_native(&IRType::Int8), "TINYINT");
        assert_eq!(
            a.ir_type_to_native(&IRType::Decimal {
                precision: 0,
                scale: 0
            }),
            "DECIMAL(65,30)"
        );
        assert_eq!(
            a.ir_type_to_native(&IRType::Varchar { length: None }),
            "VARCHAR(255)"
        );
        assert_eq!(
            a.ir_type_to_native(&IRType::Binary { length: Some(16) }),
            "VARBINARY(16)"
        );
        assert_eq!(a.ir_type_to_native(&IRType::Bit { length: 4 }), "BIT(4)");
        assert_eq!(
            a.format_default(&IRDefault::Literal("0".into())),
            Some("0".into())
        );
        assert!(a
            .format_default(&IRDefault::RawExpression("x".into()))
            .is_none());
        assert_eq!(a.quote_char(), '`');
        assert_eq!(a.auto_increment_keyword(), Some("AUTO_INCREMENT"));
        assert_eq!(a.format_literal(&None, &IRType::Int32), "NULL");
        assert_eq!(
            a.format_literal(&Some(Value::Bytes(vec![0xFF])), &IRType::Blob),
            "X'ff'"
        );
        assert!(a.index_names_are_table_scoped());
        assert!(!a.foreign_key_names_are_table_scoped());
    }

    #[test]
    fn mysql_structure_preflight_literals_are_sql_mode_independent() {
        let query = adapter()
            .unsupported_transfer_structure_query("données", None, "tbl'\\x")
            .expect("MySQL preflight query");
        assert!(query.contains(&mysql_utf8_hex_expression("données")));
        assert!(query.contains(&mysql_utf8_hex_expression("tbl'\\x")));
        assert!(!query.contains("tbl'\\x"));
        assert!(query.contains("COLLATION = 'D'"));
        assert!(query.contains("column-specific collation"));
        assert!(query.contains("not the database default"));
    }

    #[test]
    fn mysql_transfer_renders_captured_table_options_and_rejects_unknown_engine() {
        let a = adapter();
        let options = datazen_driver_api::TableOptions {
            engine: Some("InnoDB".into()),
            charset: Some("utf8mb4".into()),
            comment: Some("orders' archive".into()),
            ..Default::default()
        };
        assert_eq!(
            a.render_source_table_options(&options).unwrap().as_deref(),
            Some("ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COMMENT='orders'' archive'")
        );

        let unsupported = datazen_driver_api::TableOptions {
            engine: Some("MyISAM".into()),
            ..Default::default()
        };
        assert!(a.render_source_table_options(&unsupported).is_err());
    }

    #[test]
    fn mysql_sync_key_contract_is_binary_and_exact() {
        let a = adapter();
        let text = a.sync_key_contract(&col("name", "varchar(100)")).unwrap();
        assert_eq!(
            a.sync_key_order_expression("`name`", &text),
            "BINARY `name`"
        );
        let decimal = a
            .sync_key_contract(&col("amount", "decimal(18,4)"))
            .unwrap();
        let left = a
            .normalize_sync_key(&Some(Value::String("1.20".into())), &decimal)
            .unwrap();
        let right = a
            .normalize_sync_key(&Some(Value::String("1.2".into())), &decimal)
            .unwrap();
        assert_eq!(left, right);
        let unsupported = a.sync_key_contract(&col("id", "float")).unwrap_err();
        assert!(unsupported.contains("normalized"));
    }
}
