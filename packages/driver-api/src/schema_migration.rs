//! Dialect-neutral schema migration contracts exposed by the driver API.

use crate::schema_objects::ObjectKind;
use crate::{CheckConstraint, ColumnSchema, ForeignKeyInfo, IndexInfo, TableOptions};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MigrationColumn {
    pub name: String,
    pub data_type: String,
    pub nullable: bool,
    pub default_value: Option<String>,
    pub comment: Option<String>,
    pub is_auto_increment: bool,
}

/// A view definition captured from a source database.
///
/// `definition` is the query body returned by the driver's object metadata
/// API. It excludes the `CREATE VIEW ... AS` wrapper so the target renderer
/// can quote the target identifier and choose dialect syntax.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MigrationView {
    pub schema: Option<String>,
    pub name: String,
    pub definition: String,
}

/// A routine definition captured from the source database. `definition` is
/// driver-owned DDL (for example `pg_get_functiondef` or SHOW CREATE) and is
/// never synthesized by the host.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MigrationRoutine {
    pub kind: ObjectKind,
    pub schema: Option<String>,
    pub name: String,
    pub signature: Option<String>,
    pub definition: String,
}

/// A trigger definition plus the relation it is attached to. Trigger names
/// are not globally unique on every supported engine, so the target relation
/// is part of the reviewed identity.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MigrationTrigger {
    pub schema: Option<String>,
    pub name: String,
    pub target_schema: Option<String>,
    pub target_name: String,
    pub definition: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MigrationOperation {
    CreateTable {
        table: String,
        columns: Vec<MigrationColumn>,
        primary_keys: Vec<String>,
    },
    /// Remove a table without a cascade clause.
    ///
    /// A table drop is intentionally a first-class reviewed operation. The
    /// host marks it destructive and does not synthesize rollback SQL because
    /// recreating a table cannot restore its rows, indexes, or constraints.
    DropTable {
        table: String,
    },
    AddColumn {
        table: String,
        column: MigrationColumn,
    },
    DropColumn {
        table: String,
        column: MigrationColumn,
    },
    AlterColumnType {
        table: String,
        column: String,
        from: String,
        to: String,
    },
    SetNullable {
        table: String,
        column: String,
        nullable: bool,
    },
    SetDefault {
        table: String,
        column: String,
        from: Option<String>,
        to: Option<String>,
    },
    SetComment {
        table: String,
        column: String,
        from: Option<String>,
        to: Option<String>,
    },
    /// Change table-level metadata that the driver can represent without
    /// inventing a dialect translation. MySQL currently supports the
    /// comment, storage engine, and default character set fields.
    SetTableOptions {
        table: String,
        from: TableOptions,
        to: TableOptions,
    },
    SetAutoIncrement {
        table: String,
        column: String,
        from: bool,
        to: bool,
    },
    AddPrimaryKey {
        table: String,
        columns: Vec<String>,
    },
    DropPrimaryKey {
        table: String,
        columns: Vec<String>,
    },
    CreateIndex {
        table: String,
        index: IndexInfo,
    },
    DropIndex {
        table: String,
        index: IndexInfo,
    },
    AddForeignKey {
        table: String,
        foreign_key: ForeignKeyInfo,
    },
    DropForeignKey {
        table: String,
        foreign_key: ForeignKeyInfo,
    },
    AddCheckConstraint {
        table: String,
        constraint: CheckConstraint,
    },
    DropCheckConstraint {
        table: String,
        constraint: CheckConstraint,
    },
    CreateView {
        view: MigrationView,
    },
    ReplaceView {
        current: MigrationView,
        desired: MigrationView,
    },
    DropView {
        view: MigrationView,
    },
    CreateRoutine {
        routine: MigrationRoutine,
    },
    ReplaceRoutine {
        current: MigrationRoutine,
        desired: MigrationRoutine,
    },
    DropRoutine {
        routine: MigrationRoutine,
    },
    CreateTrigger {
        trigger: MigrationTrigger,
    },
    ReplaceTrigger {
        current: MigrationTrigger,
        desired: MigrationTrigger,
    },
    DropTrigger {
        trigger: MigrationTrigger,
    },
}

/// Validate and trim a relation identifier used by a reviewed migration
/// statement. A qualified relation may contain dots between non-empty
/// segments, but whitespace around a segment or control characters would make
/// the target relation ambiguous and must fail closed.
pub fn validate_migration_identifier(raw: &str) -> Result<&str, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("migration identifier must not be empty".into());
    }
    if trimmed.chars().any(char::is_control) {
        return Err("migration identifier contains control characters".into());
    }
    if trimmed
        .split('.')
        .any(|segment| segment.is_empty() || segment != segment.trim())
    {
        return Err("migration identifier contains an empty or whitespace-padded segment".into());
    }
    Ok(trimmed)
}

/// Validate a query body before it is embedded into one reviewed DDL
/// statement. Definitions containing a semicolon are rejected so a source
/// object cannot turn a single plan statement into an arbitrary script.
pub fn validate_view_definition(definition: &str) -> Result<(), String> {
    let trimmed = definition.trim();
    if trimmed.is_empty() {
        return Err("view definition must not be empty".into());
    }
    if trimmed.contains(';') {
        return Err("view definition must contain one query without semicolons".into());
    }
    if trimmed
        .chars()
        .any(|ch| ch == '\0' || (ch.is_control() && !matches!(ch, '\n' | '\r' | '\t')))
    {
        return Err("view definition contains control characters".into());
    }
    Ok(())
}

/// Validate a complete routine/trigger DDL payload returned by a driver.
/// Routine bodies may legitimately contain semicolons, so this deliberately
/// validates the object envelope and control characters rather than trying to
/// parse dialect-specific procedural SQL in the host.
pub fn validate_object_definition(
    definition: &str,
    kind: ObjectKind,
    name: &str,
) -> Result<(), String> {
    let trimmed = definition.trim();
    if trimmed.is_empty() {
        return Err("schema object definition must not be empty".into());
    }
    if trimmed
        .chars()
        .any(|ch| ch == '\0' || (ch.is_control() && !matches!(ch, '\n' | '\r' | '\t')))
    {
        return Err("schema object definition contains control characters".into());
    }
    let kind_token = match kind {
        ObjectKind::Function => "FUNCTION",
        ObjectKind::Procedure => "PROCEDURE",
        ObjectKind::Trigger => "TRIGGER",
        _ => return Err("schema object kind is not a routine or trigger".into()),
    };
    if object_declaration_kind(trimmed) != Some(kind) {
        return Err(format!(
            "schema object definition must declare CREATE {kind_token}"
        ));
    }
    if name.trim().is_empty() {
        return Err("schema object name must not be empty".into());
    }
    // A driver query is expected to return the requested object. Require the
    // identity to occur in the DDL after normalizing common quote styles.
    let normalized_definition = trimmed
        .to_ascii_uppercase()
        .replace(['`', '"', '[', ']'], "");
    let normalized_name = name.to_ascii_uppercase().replace(['`', '"', '[', ']'], "");
    if !normalized_definition
        .split(|ch: char| !ch.is_ascii_alphanumeric() && ch != '_')
        .any(|token| token == normalized_name)
    {
        return Err(format!(
            "schema object definition does not contain object name `{name}`"
        ));
    }
    Ok(())
}

/// Return the object kind from the executable CREATE declaration header.
///
/// The catalog DDL for MySQL may contain a `DEFINER=...` clause between
/// `CREATE` and the object kind, while PostgreSQL commonly uses
/// `CREATE OR REPLACE`. Tokens inside quoted strings and SQL comments are
/// discarded before inspecting the header, so a body or comment cannot make a
/// wrong object type appear valid.
fn object_declaration_kind(definition: &str) -> Option<ObjectKind> {
    let tokens = executable_sql_words(definition);
    if tokens.first().map(String::as_str) != Some("CREATE") {
        return None;
    }
    let mut index = 1;
    if tokens.get(index).map(String::as_str) == Some("OR")
        && tokens.get(index + 1).map(String::as_str) == Some("REPLACE")
    {
        index += 2;
    }
    while let Some(token) = tokens.get(index).map(String::as_str) {
        match token {
            "FUNCTION" => return Some(ObjectKind::Function),
            "PROCEDURE" => return Some(ObjectKind::Procedure),
            "TRIGGER" => return Some(ObjectKind::Trigger),
            // Once the declaration has reached a relation/view body, a later
            // routine word belongs to SQL text rather than the object header.
            "AS" | "BEGIN" | "VIEW" | "TABLE" | "SCHEMA" | "EVENT" => return None,
            _ => index += 1,
        }
    }
    None
}

fn executable_sql_words(sql: &str) -> Vec<String> {
    let chars = sql.chars().collect::<Vec<_>>();
    let mut words = Vec::new();
    let mut index = 0;
    while index < chars.len() {
        let ch = chars[index];
        if ch == '-' && chars.get(index + 1) == Some(&'-') {
            index += 2;
            while index < chars.len() && chars[index] != '\n' {
                index += 1;
            }
            continue;
        }
        if ch == '#' {
            index += 1;
            while index < chars.len() && chars[index] != '\n' {
                index += 1;
            }
            continue;
        }
        if ch == '/' && chars.get(index + 1) == Some(&'*') {
            index += 2;
            while index + 1 < chars.len() && !(chars[index] == '*' && chars[index + 1] == '/') {
                index += 1;
            }
            index = (index + 2).min(chars.len());
            continue;
        }
        if matches!(ch, '\'' | '"' | '`') {
            let quote = ch;
            index += 1;
            while index < chars.len() {
                if chars[index] == '\\' {
                    index = (index + 2).min(chars.len());
                    continue;
                }
                if chars[index] == quote {
                    if chars.get(index + 1) == Some(&quote) {
                        index += 2;
                        continue;
                    }
                    index += 1;
                    break;
                }
                index += 1;
            }
            continue;
        }
        if ch.is_ascii_alphanumeric() || matches!(ch, '_' | '$') {
            let start = index;
            index += 1;
            while index < chars.len()
                && (chars[index].is_ascii_alphanumeric() || matches!(chars[index], '_' | '$'))
            {
                index += 1;
            }
            words.push(
                chars[start..index]
                    .iter()
                    .collect::<String>()
                    .to_ascii_uppercase(),
            );
            continue;
        }
        index += 1;
    }
    words
}

/// Validate a CHECK predicate before it is embedded into a reviewed DDL
/// statement.  The predicate is intentionally kept as SQL because only the
/// target driver can render its dialect, but it must remain one expression
/// and cannot terminate the reviewed statement.
pub fn validate_check_expression(expression: &str) -> Result<(), String> {
    let trimmed = expression.trim();
    if trimmed.is_empty() {
        return Err("check constraint expression must not be empty".into());
    }
    if trimmed.contains(';') {
        return Err("check constraint expression must not contain semicolons".into());
    }
    if trimmed
        .chars()
        .any(|ch| ch == '\0' || (ch.is_control() && !matches!(ch, '\n' | '\r' | '\t')))
    {
        return Err("check constraint expression contains control characters".into());
    }
    Ok(())
}

pub fn migration_object_kind() -> ObjectKind {
    ObjectKind::View
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MigrationRisk {
    Additive,
    Rewrite,
    Destructive,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MigrationRequirement {
    Backfill {
        table: String,
        column: String,
        reason: String,
    },
    Unsupported {
        operation: String,
        reason: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MigrationStatement {
    pub sql: String,
    pub risk: MigrationRisk,
    pub rollback_sql: Option<String>,
    pub summary: String,
}

pub trait MigrationRenderer: Send + Sync {
    fn render(&self, operation: &MigrationOperation) -> Result<MigrationStatement, String>;
}

pub trait MigrationCapabilities: Send + Sync {
    fn supports(&self, operation: &MigrationOperation) -> bool;
    fn requires_table_rebuild(&self, _operation: &MigrationOperation) -> bool {
        false
    }
    fn transactional_ddl(&self) -> bool {
        true
    }
}

pub fn migration_column(column: &ColumnSchema) -> MigrationColumn {
    MigrationColumn {
        name: column.name.clone(),
        data_type: column.data_type.clone(),
        nullable: column.nullable,
        default_value: column.default_value.clone(),
        comment: column.comment.clone(),
        is_auto_increment: column.is_auto_increment,
    }
}

/// Normalize a column type string for comparison purposes.
pub trait TypeNormalizer: Send + Sync {
    fn normalize_type(&self, data_type: &str) -> String;
}

/// Parse a type string into (base, args, suffix) components.
/// Example: `"VARCHAR(255) UNSIGNED"` → `("VARCHAR", Some("255"), "UNSIGNED")`
pub fn parse_type_parts(raw: &str) -> (String, Option<String>, String) {
    let trimmed = collapse_ws(raw);
    let (core, suffix) = peel_suffixes(&trimmed);
    match (core.find('('), core.rfind(')')) {
        (Some(open), Some(close)) if close > open => {
            let base = core[..open].trim().to_string();
            let args = Some(core[open + 1..close].trim().to_string());
            let remainder = core[close + 1..].trim();
            let combined_suffix = match (remainder.is_empty(), suffix.is_empty()) {
                (true, true) => String::new(),
                (false, true) => remainder.to_string(),
                (true, false) => suffix,
                (false, false) => format!("{remainder} {suffix}"),
            };
            (base, args, combined_suffix)
        }
        _ => (core, None, suffix),
    }
}

pub fn format_type(base: &str, args: Option<&str>, suffix: &str) -> String {
    let mut out = base.to_string();
    if let Some(a) = args {
        if !a.is_empty() {
            out.push('(');
            out.push_str(a);
            out.push(')');
        }
    }
    if !suffix.is_empty() {
        out.push(' ');
        out.push_str(suffix);
    }
    out
}

fn peel_suffixes(raw: &str) -> (String, String) {
    let mut parts: Vec<&str> = raw.split_whitespace().collect();
    let mut suffix = Vec::new();
    while let Some(last) = parts.last().copied() {
        if matches!(last, "UNSIGNED" | "ZEROFILL" | "BINARY") {
            suffix.push(parts.pop().expect("last token"));
        } else {
            break;
        }
    }
    suffix.reverse();
    (parts.join(" "), suffix.join(" "))
}

fn collapse_ws(raw: &str) -> String {
    raw.split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_ascii_uppercase()
}

#[cfg(test)]
mod type_parts_tests {
    use super::*;

    #[test]
    fn parse_varchar_with_unsigned_suffix() {
        let (base, args, suffix) = parse_type_parts("VARCHAR(255) UNSIGNED");
        assert_eq!(base, "VARCHAR");
        assert_eq!(args.as_deref(), Some("255"));
        assert_eq!(suffix, "UNSIGNED");
        assert_eq!(
            format_type(&base, args.as_deref(), &suffix),
            "VARCHAR(255) UNSIGNED"
        );
    }

    #[test]
    fn parse_multi_word_base() {
        let (base, args, suffix) = parse_type_parts("double precision");
        assert_eq!(base, "DOUBLE PRECISION");
        assert!(args.is_none());
        assert!(suffix.is_empty());
    }

    #[test]
    fn empty_input_yields_empty_base() {
        let (base, args, suffix) = parse_type_parts("  ");
        assert!(base.is_empty());
        assert!(args.is_none());
        assert!(suffix.is_empty());
    }

    #[test]
    fn parse_array_types_preserves_brackets() {
        let (base, args, suffix) = parse_type_parts("VARCHAR(255)[]");
        assert_eq!(base, "VARCHAR");
        assert_eq!(args.as_deref(), Some("255"));
        assert_eq!(suffix, "[]");
        assert_eq!(
            format_type(&base, args.as_deref(), &suffix),
            "VARCHAR(255) []"
        );
    }

    #[test]
    fn parse_timestamp_with_time_zone_preserves_suffix() {
        let (base, args, suffix) = parse_type_parts("TIMESTAMP(6) WITH TIME ZONE");
        assert_eq!(base, "TIMESTAMP");
        assert_eq!(args.as_deref(), Some("6"));
        assert_eq!(suffix, "WITH TIME ZONE");
        assert_eq!(
            format_type(&base, args.as_deref(), &suffix),
            "TIMESTAMP(6) WITH TIME ZONE"
        );
    }

    #[test]
    fn view_definition_validation_rejects_empty_scripts_and_controls() {
        assert!(validate_view_definition("SELECT 1").is_ok());
        assert!(validate_view_definition("  ").is_err());
        assert!(validate_view_definition("SELECT 1; DROP TABLE users").is_err());
        assert!(validate_view_definition("SELECT '\0'").is_err());
    }

    #[test]
    fn migration_identifier_validation_rejects_blank_controls_and_bad_segments() {
        assert_eq!(
            validate_migration_identifier("  audit.events  ").unwrap(),
            "audit.events"
        );
        for value in [
            "",
            " \t ",
            "audit\nevents",
            "audit..events",
            "audit. events",
        ] {
            assert!(validate_migration_identifier(value).is_err(), "{value:?}");
        }
    }

    #[test]
    fn object_definition_validation_allows_routine_bodies_but_rejects_missing_or_wrong_ddl() {
        assert!(validate_object_definition(
            "CREATE FUNCTION calculate_total(integer) RETURNS integer AS $$ BEGIN SELECT 1; END $$",
            ObjectKind::Function,
            "calculate_total"
        )
        .is_ok());
        assert!(validate_object_definition(
            "CREATE TRIGGER audit_insert AFTER INSERT ON orders BEGIN SELECT 1; END",
            ObjectKind::Trigger,
            "audit_insert"
        )
        .is_ok());
        for definition in [
            "",
            "SELECT 1",
            "CREATE VIEW v AS SELECT 1",
            "CREATE FUNCTION x()\0",
        ] {
            assert!(validate_object_definition(definition, ObjectKind::Function, "x").is_err());
        }
    }

    #[test]
    fn test_tester_object_definition_requires_kind_in_create_header() {
        // A routine/trigger token in a literal must not make a CREATE VIEW
        // eligible for routine or trigger migration.
        assert!(validate_object_definition(
            "CREATE VIEW calculate_total AS SELECT 'FUNCTION' AS marker",
            ObjectKind::Function,
            "calculate_total",
        )
        .is_err());
        assert!(validate_object_definition(
            "CREATE VIEW audit_insert AS SELECT 'TRIGGER' AS marker",
            ObjectKind::Trigger,
            "audit_insert",
        )
        .is_err());
        assert!(validate_object_definition(
            "/* FUNCTION */ CREATE VIEW calculate_total AS SELECT 1",
            ObjectKind::Function,
            "calculate_total",
        )
        .is_err());
        assert!(validate_object_definition(
            "CREATE VIEW audit_insert AS SELECT 1 -- TRIGGER",
            ObjectKind::Trigger,
            "audit_insert",
        )
        .is_err());
    }
}
