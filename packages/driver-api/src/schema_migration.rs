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
/// Routine bodies may legitimately contain semicolons, so this validates only
/// the executable CREATE envelope rather than trying to parse procedural SQL.
pub fn validate_object_definition(
    definition: &str,
    kind: ObjectKind,
    name: &str,
) -> Result<(), String> {
    validate_object_definition_with_identity(definition, kind, name, None)
}

/// Validate an object definition and, when supplied, its routine identity
/// arguments. A routine's name/signature are extracted from the declaration
/// header; body text and comments are never considered identity evidence.
pub fn validate_object_definition_with_identity(
    definition: &str,
    kind: ObjectKind,
    name: &str,
    signature: Option<&str>,
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
    let Some((declared_kind, declared_name, declared_signature)) =
        object_declaration_identity(trimmed)
    else {
        return Err(format!(
            "schema object definition must declare CREATE {kind_token}"
        ));
    };
    if declared_kind != kind {
        return Err(format!(
            "schema object definition must declare CREATE {kind_token}"
        ));
    }
    if name.trim().is_empty() {
        return Err("schema object name must not be empty".into());
    }
    if normalize_identifier(&declared_name) != normalize_identifier(name) {
        return Err(format!(
            "schema object definition declares `{declared_name}` instead of `{name}`"
        ));
    }
    if let Some(signature) = signature {
        if !matches!(kind, ObjectKind::Function | ObjectKind::Procedure) {
            return Err("routine signature supplied for a non-routine object".into());
        }
        let Some(declared_signature) = declared_signature else {
            return Err("routine declaration arguments could not be verified".into());
        };
        if !routine_signatures_match(&declared_signature, signature) {
            return Err(format!(
                "routine declaration signature `{declared_signature}` does not match requested signature `{signature}`"
            ));
        }
    }
    Ok(())
}

fn normalize_identifier(value: &str) -> String {
    value
        .trim()
        .trim_matches(['`', '"', '[', ']'])
        .to_ascii_uppercase()
}

/// Return the object kind, terminal identifier, and optional routine
/// declaration arguments from the executable CREATE declaration header.
///
/// The catalog DDL for MySQL may contain a `DEFINER=...` clause between
/// `CREATE` and the object kind, while PostgreSQL commonly uses
/// `CREATE OR REPLACE`. Tokens inside quoted strings and SQL comments are
/// discarded before inspecting the header, so a body or comment cannot make a
/// wrong object type appear valid.
fn object_declaration_identity(definition: &str) -> Option<(ObjectKind, String, Option<String>)> {
    let tokens = executable_sql_tokens(definition);
    if tokens.first().and_then(ExecutableSqlToken::as_word) != Some("CREATE") {
        return None;
    }
    let mut index = 1;
    if tokens.get(index).and_then(ExecutableSqlToken::as_word) == Some("OR")
        && tokens.get(index + 1).and_then(ExecutableSqlToken::as_word) == Some("REPLACE")
    {
        index += 2;
    }
    if tokens.get(index).and_then(ExecutableSqlToken::as_word) == Some("DEFINER") {
        index += 1;
        if tokens.get(index) != Some(&ExecutableSqlToken::Symbol('=')) {
            return None;
        }
        index += 1;
        let mut has_definer_value = false;
        while let Some(token) = tokens.get(index) {
            match token {
                ExecutableSqlToken::Word(value)
                    if matches!(value.as_str(), "FUNCTION" | "PROCEDURE" | "TRIGGER") =>
                {
                    if !has_definer_value {
                        return None;
                    }
                    break;
                }
                ExecutableSqlToken::Word(value)
                    if matches!(
                        value.as_str(),
                        "AS" | "BEGIN" | "VIEW" | "TABLE" | "SCHEMA" | "EVENT"
                    ) =>
                {
                    return None;
                }
                _ => {
                    has_definer_value = true;
                    index += 1;
                }
            }
        }
    }
    let kind = loop {
        match tokens.get(index) {
            Some(ExecutableSqlToken::Word(token)) => match token.as_str() {
                "FUNCTION" => break ObjectKind::Function,
                "PROCEDURE" => break ObjectKind::Procedure,
                "TRIGGER" => break ObjectKind::Trigger,
                // Once the declaration has reached a relation/view body, a later
                // routine word belongs to SQL text rather than the object header.
                "AS" | "BEGIN" | "VIEW" | "TABLE" | "SCHEMA" | "EVENT" => return None,
                _ => index += 1,
            },
            Some(_) => index += 1,
            None => return None,
        }
    };
    index += 1;
    let mut declared_name = match tokens.get(index) {
        Some(ExecutableSqlToken::Word(name)) | Some(ExecutableSqlToken::Identifier(name)) => {
            name.clone()
        }
        _ => return None,
    };
    index += 1;
    while tokens.get(index) == Some(&ExecutableSqlToken::Symbol('.')) {
        index += 1;
        match tokens.get(index) {
            Some(ExecutableSqlToken::Word(name)) | Some(ExecutableSqlToken::Identifier(name)) => {
                declared_name = name.clone();
                index += 1;
            }
            _ => return None,
        }
    }
    let declared_signature = if matches!(kind, ObjectKind::Function | ObjectKind::Procedure) {
        if tokens.get(index) != Some(&ExecutableSqlToken::Symbol('(')) {
            return None;
        }
        let mut depth = 0usize;
        let mut parameters = Vec::new();
        let mut current = Vec::new();
        let mut closed = false;
        for token in tokens.iter().skip(index + 1) {
            match token {
                ExecutableSqlToken::Symbol('(') => {
                    depth += 1;
                    current.push(token.clone());
                }
                ExecutableSqlToken::Symbol(')') if depth > 0 => {
                    depth -= 1;
                    current.push(token.clone());
                }
                ExecutableSqlToken::Symbol(')') => {
                    if !current.is_empty() {
                        parameters.push(normalize_sql_tokens(&current));
                    }
                    closed = true;
                    break;
                }
                ExecutableSqlToken::Symbol(',') if depth == 0 => {
                    parameters.push(normalize_sql_tokens(&current));
                    current.clear();
                }
                _ => current.push(token.clone()),
            }
        }
        if !closed {
            return None;
        }
        Some(parameters.join(", "))
    } else {
        None
    };
    Some((kind, declared_name, declared_signature))
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum ExecutableSqlToken {
    Word(String),
    Identifier(String),
    Symbol(char),
}

impl ExecutableSqlToken {
    fn as_word(&self) -> Option<&str> {
        match self {
            Self::Word(value) => Some(value.as_str()),
            _ => None,
        }
    }
}

fn normalize_sql_tokens(tokens: &[ExecutableSqlToken]) -> String {
    tokens
        .iter()
        .map(|token| match token {
            ExecutableSqlToken::Word(value) | ExecutableSqlToken::Identifier(value) => {
                value.to_ascii_uppercase()
            }
            ExecutableSqlToken::Symbol(value) => value.to_string(),
        })
        .collect::<Vec<_>>()
        .join(" ")
        .replace(" ( ", "(")
        .replace(" )", ")")
        .replace(" ,", ",")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn normalize_signature_part(value: &str) -> String {
    let upper = value
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_ascii_uppercase();
    let upper = upper
        .split_once(" DEFAULT ")
        .map(|(value, _)| value)
        .or_else(|| upper.split_once("=").map(|(value, _)| value))
        .unwrap_or(&upper)
        .trim();
    let mut words = upper.split_whitespace().collect::<Vec<_>>();
    if matches!(
        words.first().copied(),
        Some("IN" | "OUT" | "INOUT" | "VARIADIC")
    ) {
        words.remove(0);
    }
    words.join(" ")
}

fn signature_parts(value: &str) -> Vec<String> {
    let mut parts = Vec::new();
    let mut depth = 0usize;
    let mut start = 0usize;
    for (index, ch) in value.char_indices() {
        match ch {
            '(' => depth += 1,
            ')' => depth = depth.saturating_sub(1),
            ',' if depth == 0 => {
                parts.push(normalize_signature_part(&value[start..index]));
                start = index + ch.len_utf8();
            }
            _ => {}
        }
    }
    let tail = normalize_signature_part(&value[start..]);
    if !tail.is_empty() {
        parts.push(tail);
    }
    parts
}

fn routine_signatures_match(declared: &str, requested: &str) -> bool {
    let declared_parts = signature_parts(declared);
    let requested_parts = signature_parts(requested);
    if declared_parts.len() != requested_parts.len() {
        return false;
    }
    declared_parts
        .iter()
        .zip(requested_parts.iter())
        .all(|(declared, requested)| {
            declared == requested
                || declared
                    .split_whitespace()
                    .enumerate()
                    .skip(1)
                    .any(|(index, _)| {
                        declared
                            .split_whitespace()
                            .skip(index)
                            .collect::<Vec<_>>()
                            .join(" ")
                            == *requested
                    })
        })
}

fn executable_sql_tokens(sql: &str) -> Vec<ExecutableSqlToken> {
    let chars = sql.chars().collect::<Vec<_>>();
    let mut tokens = Vec::new();
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
        if ch == '\'' {
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
        if matches!(ch, '"' | '`' | '[') {
            let (quote, closing) = if ch == '[' { (ch, ']') } else { (ch, ch) };
            index += 1;
            let start = index;
            while index < chars.len() {
                if chars[index] == closing {
                    let value = chars[start..index].iter().collect::<String>();
                    tokens.push(ExecutableSqlToken::Identifier(value));
                    index += 1;
                    break;
                }
                if chars[index] == quote && chars.get(index + 1) == Some(&quote) {
                    index += 2;
                    continue;
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
            tokens.push(ExecutableSqlToken::Word(
                chars[start..index]
                    .iter()
                    .collect::<String>()
                    .to_ascii_uppercase(),
            ));
            continue;
        }
        if matches!(ch, '.' | '(' | ')' | ',' | '=' | '@') {
            tokens.push(ExecutableSqlToken::Symbol(ch));
        }
        index += 1;
    }
    tokens
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

    #[test]
    fn test_tester_object_definition_ignores_quoted_kind_tokens_outside_header() {
        // Quoted identifiers remain identifiers, rather than declaration-kind
        // tokens. A view body/header containing one must never be accepted as
        // a routine or trigger definition.
        for (definition, kind, name) in [
            (
                "CREATE VIEW report AS SELECT `FUNCTION` FROM metadata",
                ObjectKind::Function,
                "report",
            ),
            (
                "CREATE VIEW `FUNCTION` AS SELECT 1",
                ObjectKind::Function,
                "FUNCTION",
            ),
            (
                "CREATE VIEW report AS SELECT \"TRIGGER\" FROM metadata",
                ObjectKind::Trigger,
                "report",
            ),
            (
                "CREATE VIEW [TRIGGER] AS SELECT 1",
                ObjectKind::Trigger,
                "TRIGGER",
            ),
        ] {
            assert!(
                validate_object_definition(definition, kind, name).is_err(),
                "{definition}"
            );
        }
    }

    #[test]
    fn test_tester_object_definition_requires_requested_name_in_declaration() {
        // The driver contract must not accept an unrelated routine merely
        // because the requested identity occurs in a body literal or comment.
        // Conversely, supported PostgreSQL and MySQL declaration envelopes
        // remain valid when their declared name is the requested identity.
        for definition in [
            "CREATE OR REPLACE FUNCTION other_name() RETURNS integer AS $$ SELECT 'wanted_name' $$ LANGUAGE sql",
            "CREATE FUNCTION other_name() RETURNS integer AS $$ SELECT 1 $$ LANGUAGE sql -- wanted_name",
        ] {
            assert!(
                validate_object_definition(definition, ObjectKind::Function, "wanted_name").is_err(),
                "{definition}"
            );
        }

        assert!(validate_object_definition(
            "CREATE OR REPLACE FUNCTION wanted_name() RETURNS integer AS $$ SELECT 1 $$ LANGUAGE sql",
            ObjectKind::Function,
            "wanted_name",
        )
        .is_ok());
        assert!(validate_object_definition(
            "CREATE DEFINER=`root`@`%` PROCEDURE wanted_name() SELECT 1",
            ObjectKind::Procedure,
            "wanted_name",
        )
        .is_ok());
        assert!(validate_object_definition(
            "CREATE DEFINER=`root`@`%` TRIGGER wanted_name BEFORE INSERT ON orders FOR EACH ROW SET NEW.id = NEW.id",
            ObjectKind::Trigger,
            "wanted_name",
        )
        .is_ok());
    }
}
