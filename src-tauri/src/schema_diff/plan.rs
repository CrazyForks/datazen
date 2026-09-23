//! Build SchemaDiffPlan from table schema pairs.

use super::types::{
    normalize_dialect, resolve_table_for_dialect, ColumnSnapshot, PlanRequirement, PlanStatement,
    RollbackCompleteness, SchemaDiffPlan, StatementRisk, TypeSuggestion,
};
use crate::db::TableSchema;
use std::collections::{BTreeSet, HashMap, HashSet};

/// Optional mapper: (table, source_type_sql, column_name) → native type for target dialect.
pub type TypeMapper<'a> = dyn Fn(&str, &str, &str) -> Result<String, String> + 'a;

pub struct PlanOptions<'a> {
    pub allow_destructive: bool,
    pub include_indexes: bool,
    /// When set, used instead of raw `column.data_type` (cross-dialect / IR).
    pub type_mapper: Option<&'a TypeMapper<'a>>,
    /// Set automatically by build_schema_diff_plan when source ≠ target dialect.
    #[doc(hidden)]
    pub cross_dialect: bool,
}

/// A target-only table selected for deletion. `identity` is the exact metadata
/// identity used by foreign-key introspection; `table` is the identifier sent
/// to the target dialect's DDL renderer.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TargetOnlyTableDrop {
    pub table: String,
    pub identity: String,
}

/// One physical table in the complete target scope used to validate inbound
/// foreign-key dependencies before target-only drops are exposed.
#[derive(Debug, Clone)]
pub struct TargetTableDependencySnapshot {
    pub identity: String,
    pub name: String,
    pub schema: Option<String>,
    pub table_schema: TableSchema,
}

fn relation_leaf(identity: &str) -> &str {
    identity.rsplit('.').next().unwrap_or(identity)
}

/// Sort selected table drops child-before-parent and reject any parent whose
/// inbound foreign-key dependents are outside the selected drop set.
fn order_target_only_drops(
    selected: &[TargetOnlyTableDrop],
    target_snapshot: &[TargetTableDependencySnapshot],
    target_dialect: &str,
) -> (Vec<usize>, HashSet<usize>, Vec<PlanRequirement>) {
    let mut blocked = HashSet::new();
    let mut requirements = Vec::new();
    let mut by_identity = HashMap::new();

    for (index, drop) in selected.iter().enumerate() {
        if by_identity.insert(drop.identity.as_str(), index).is_some() {
            blocked.insert(index);
            requirements.push(PlanRequirement::Unsupported {
                operation: format!("drop-table:{}", drop.table),
                reason: format!(
                    "Target table identity `{}` was selected more than once",
                    drop.identity
                ),
            });
        }
        if !target_snapshot
            .iter()
            .any(|snapshot| snapshot.identity == drop.identity)
        {
            blocked.insert(index);
            requirements.push(PlanRequirement::Unsupported {
                operation: format!("drop-table:{}", drop.table),
                reason: format!(
                    "Cannot verify foreign-key dependencies because target table `{}` is absent from the complete target snapshot",
                    drop.identity
                ),
            });
        }
    }

    let mut outgoing = vec![HashSet::new(); selected.len()];
    let mut indegree = vec![0usize; selected.len()];
    let mut add_edge = |child: usize, parent: usize| {
        if outgoing[child].insert(parent) {
            indegree[parent] += 1;
        }
    };

    for child_snapshot in target_snapshot {
        for foreign_key in &child_snapshot.table_schema.foreign_keys {
            for (parent_index, parent) in selected.iter().enumerate() {
                if foreign_key.referenced_table == parent.identity {
                    if let Some(child_index) = by_identity.get(child_snapshot.identity.as_str()) {
                        add_edge(*child_index, parent_index);
                    } else {
                        blocked.insert(parent_index);
                        requirements.push(PlanRequirement::Unsupported {
                            operation: format!("drop-table:{}", parent.table),
                            reason: format!(
                                "Cannot drop `{}` while foreign key `{}` on `{}` still references it; include the dependent table in the target-only drop selection or remove the foreign key first",
                                parent.identity, foreign_key.name, child_snapshot.identity
                            ),
                        });
                    }
                } else if normalize_dialect(target_dialect) == "postgresql"
                    && relation_leaf(&foreign_key.referenced_table)
                        == relation_leaf(&parent.identity)
                    && (!foreign_key.referenced_table.contains('.')
                        || !parent.identity.contains('.'))
                {
                    // An unqualified PostgreSQL reference cannot safely be
                    // assigned to a same-named relation in one of several
                    // schemas. Never fall back to basename-only matching.
                    blocked.insert(parent_index);
                    requirements.push(PlanRequirement::Unsupported {
                        operation: format!("drop-table:{}", parent.table),
                        reason: format!(
                            "Cannot verify whether foreign key `{}` on `{}` references `{}` because the PostgreSQL relation identity is not schema-qualified",
                            foreign_key.name,
                            child_snapshot.identity,
                            parent.identity
                        ),
                    });
                }
            }
        }
    }

    let mut ready = BTreeSet::new();
    for (index, degree) in indegree.iter().enumerate() {
        if *degree == 0 {
            ready.insert(index);
        }
    }
    let mut ordered = Vec::with_capacity(selected.len());
    while let Some(index) = ready.pop_first() {
        ordered.push(index);
        for next in outgoing[index].iter().copied() {
            indegree[next] -= 1;
            if indegree[next] == 0 {
                ready.insert(next);
            }
        }
    }

    for (index, degree) in indegree.iter().enumerate() {
        if *degree > 0 {
            blocked.insert(index);
            requirements.push(PlanRequirement::Unsupported {
                operation: format!("drop-table:{}", selected[index].table),
                reason: format!(
                    "Cannot safely order target-only table drops because foreign-key dependencies form a cycle involving `{}`",
                    selected[index].identity
                ),
            });
        }
    }

    (ordered, blocked, requirements)
}

impl Default for PlanOptions<'_> {
    fn default() -> Self {
        Self {
            allow_destructive: false,
            include_indexes: true,
            type_mapper: None,
            cross_dialect: false,
        }
    }
}

fn is_postgres_character_type_cast(cast_type: &str) -> bool {
    let compact = cast_type
        .trim()
        .to_ascii_lowercase()
        .chars()
        .filter(|ch| !ch.is_whitespace())
        .collect::<String>();

    [
        "bpchar",
        "character",
        "char",
        "charactervarying",
        "varchar",
        "text",
    ]
    .iter()
    .any(|base| {
        if compact == *base {
            return true;
        }
        let Some(typmod) = compact
            .strip_prefix(base)
            .and_then(|suffix| suffix.strip_prefix('('))
            .and_then(|suffix| suffix.strip_suffix(')'))
        else {
            return false;
        };
        !typmod.is_empty() && typmod.chars().all(|ch| ch.is_ascii_digit())
    })
}

/// Returns the quoted SQL-standard string literal only when the expression is
/// exactly a PostgreSQL character-type cast. Backslashes are rejected because
/// PostgreSQL and MySQL can interpret them differently under their SQL modes.
fn postgres_character_literal_cast(default: &str) -> Option<&str> {
    let expression = default.trim();
    let bytes = expression.as_bytes();
    if bytes.first() != Some(&b'\'') {
        return None;
    }

    let mut cursor = 1;
    let mut literal_end = None;
    while cursor < bytes.len() {
        match bytes[cursor] {
            b'\\' => return None,
            b'\'' if bytes.get(cursor + 1) == Some(&b'\'') => cursor += 2,
            b'\'' => {
                literal_end = Some(cursor + 1);
                break;
            }
            _ => cursor += 1,
        }
    }

    let literal_end = literal_end?;
    let literal = &expression[..literal_end];
    let cast_type = expression[literal_end..].trim().strip_prefix("::")?.trim();
    is_postgres_character_type_cast(cast_type).then_some(literal)
}

/// Strips source-dialect-specific default expressions that would be invalid
/// in the target dialect (e.g. PostgreSQL `nextval()` in MySQL), while
/// preserving simple character defaults after removing a known catalog cast.
fn strip_dialect_specific_defaults(
    op: &mut super::operations::MigrationOperation,
    warnings: &mut Vec<String>,
    requirements: &mut Vec<PlanRequirement>,
) -> bool {
    use super::operations::MigrationOperation;

    let operation_key = op.key();
    let pg_patterns = ["nextval(", "::regclass", "::"];
    let has_dialect_syntax = |default: &str| {
        let lowered = default.to_ascii_lowercase();
        pg_patterns.iter().any(|pattern| lowered.contains(pattern))
    };
    let strip = |col: &mut super::types::ColumnSnapshot, table: &str, w: &mut Vec<String>| {
        if let Some(ref d) = col.default_value {
            if let Some(literal) = postgres_character_literal_cast(d) {
                w.push(format!(
                    "Mapped PostgreSQL character default cast for {}.{} to a portable string literal",
                    table, col.name
                ));
                col.default_value = Some(literal.to_string());
            } else if has_dialect_syntax(d) {
                w.push(format!(
                    "Stripped dialect-specific default for {}.{}: {}",
                    table, col.name, d
                ));
                col.default_value = None;
            }
        }
    };
    match op {
        MigrationOperation::AddColumn { table, column } => {
            strip(column, table, warnings);
            true
        }
        MigrationOperation::CreateTable { table, columns, .. } => {
            for c in columns {
                strip(c, table, warnings);
            }
            true
        }
        MigrationOperation::SetDefault {
            table,
            column,
            to: Some(default),
            ..
        } => {
            if let Some(literal) = postgres_character_literal_cast(default) {
                warnings.push(format!(
                    "Mapped PostgreSQL character default cast for {table}.{column} to a portable string literal"
                ));
                *default = literal.to_string();
                true
            } else if has_dialect_syntax(default) {
                warnings.push(format!(
                    "Stripped dialect-specific default for {table}.{column}: {default}"
                ));
                requirements.push(PlanRequirement::Unsupported {
                    operation: operation_key,
                    reason: format!(
                        "Cannot safely translate PostgreSQL default expression for MySQL column `{column}`"
                    ),
                });
                false
            } else {
                true
            }
        }
        _ => true,
    }
}

fn resolve_type(
    opts: &PlanOptions<'_>,
    table: &str,
    col_name: &str,
    source_type: &str,
) -> Result<String, String> {
    if let Some(mapper) = opts.type_mapper {
        mapper(table, source_type, col_name)
    } else {
        Ok(source_type.to_string())
    }
}

fn is_mysql_bit_boolean_type(data_type: &str) -> bool {
    let compact = data_type
        .trim()
        .to_ascii_lowercase()
        .chars()
        .filter(|ch| !ch.is_whitespace())
        .collect::<String>();
    matches!(compact.as_str(), "bit" | "bit(1)")
}

fn is_mysql_boolean_type(data_type: &str) -> bool {
    let compact = data_type
        .trim()
        .to_ascii_lowercase()
        .chars()
        .filter(|ch| !ch.is_whitespace())
        .collect::<String>();
    if is_mysql_bit_boolean_type(data_type) || matches!(compact.as_str(), "bool" | "boolean") {
        return true;
    }

    let Some(suffix) = compact.strip_prefix("tinyint(1)") else {
        return false;
    };
    matches!(
        suffix,
        "" | "unsigned" | "zerofill" | "unsignedzerofill" | "zerofillunsigned"
    )
}

fn is_postgres_boolean_type(data_type: &str) -> bool {
    matches!(
        data_type.trim().to_ascii_lowercase().as_str(),
        "bool" | "boolean"
    )
}

fn is_postgres_numeric_type(data_type: &str) -> bool {
    let compact = data_type
        .trim()
        .to_ascii_lowercase()
        .chars()
        .filter(|ch| !ch.is_whitespace())
        .collect::<String>();
    if compact.contains('[') {
        return false;
    }
    let base = compact.split('(').next().unwrap_or(compact.as_str());
    matches!(
        base,
        "smallint"
            | "int2"
            | "integer"
            | "int"
            | "int4"
            | "bigint"
            | "int8"
            | "smallserial"
            | "serial2"
            | "serial"
            | "serial4"
            | "bigserial"
            | "serial8"
            | "numeric"
            | "decimal"
            | "real"
            | "float4"
            | "float8"
            | "float"
            | "doubleprecision"
    )
}

fn normalized_mysql_type_base(data_type: &str) -> String {
    data_type
        .trim()
        .to_ascii_lowercase()
        .split('(')
        .next()
        .unwrap_or_default()
        .split_whitespace()
        .collect::<String>()
}

fn is_mysql_character_type(data_type: &str) -> bool {
    matches!(
        normalized_mysql_type_base(data_type).as_str(),
        "char" | "varchar" | "tinytext" | "text" | "mediumtext" | "longtext" | "enum" | "set"
    )
}

fn is_mysql_numeric_default_type(data_type: &str) -> bool {
    matches!(
        normalized_mysql_type_base(data_type).as_str(),
        "tinyint"
            | "smallint"
            | "mediumint"
            | "int"
            | "integer"
            | "bigint"
            | "decimal"
            | "numeric"
            | "float"
            | "double"
            | "real"
            | "year"
    )
}

fn is_postgres_temporal_type(data_type: &str) -> bool {
    let compact = data_type
        .trim()
        .to_ascii_lowercase()
        .chars()
        .filter(|ch| !ch.is_whitespace())
        .collect::<String>();
    matches!(
        compact.as_str(),
        "date"
            | "time"
            | "timewithtimezone"
            | "timewithouttimezone"
            | "timetz"
            | "timestamp"
            | "timestampwithtimezone"
            | "timestampwithouttimezone"
            | "timestamptz"
            | "interval"
    ) || compact.starts_with("timestamp(")
        || compact.starts_with("time(")
}

fn is_plain_numeric_literal(value: &str) -> bool {
    let value = value.trim();
    let bytes = value.as_bytes();
    if bytes.is_empty() {
        return false;
    }
    let mut index = usize::from(matches!(bytes.first(), Some(b'+' | b'-')));
    let mut digits = 0;
    while bytes.get(index).is_some_and(u8::is_ascii_digit) {
        digits += 1;
        index += 1;
    }
    if bytes.get(index) == Some(&b'.') {
        index += 1;
        while bytes.get(index).is_some_and(u8::is_ascii_digit) {
            digits += 1;
            index += 1;
        }
    }
    if digits == 0 {
        return false;
    }
    if matches!(bytes.get(index), Some(b'e' | b'E')) {
        index += 1;
        if matches!(bytes.get(index), Some(b'+' | b'-')) {
            index += 1;
        }
        let exponent_start = index;
        while bytes.get(index).is_some_and(u8::is_ascii_digit) {
            index += 1;
        }
        if exponent_start == index {
            return false;
        }
    }
    index == bytes.len()
}

fn is_plain_integer_literal(value: &str) -> bool {
    let value = value.trim();
    let digits = value
        .strip_prefix('+')
        .or_else(|| value.strip_prefix('-'))
        .unwrap_or(value);
    !digits.is_empty() && digits.bytes().all(|byte| byte.is_ascii_digit())
}

fn postgres_integer_range(data_type: &str) -> Option<(i128, i128)> {
    let compact = data_type
        .trim()
        .to_ascii_lowercase()
        .chars()
        .filter(|ch| !ch.is_whitespace())
        .collect::<String>();
    if compact.contains('[') {
        return None;
    }
    match compact.split('(').next().unwrap_or(compact.as_str()) {
        "smallint" | "int2" | "smallserial" | "serial2" => {
            Some((i16::MIN as i128, i16::MAX as i128))
        }
        "integer" | "int" | "int4" | "serial" | "serial4" => {
            Some((i32::MIN as i128, i32::MAX as i128))
        }
        "bigint" | "int8" | "bigserial" | "serial8" => Some((i64::MIN as i128, i64::MAX as i128)),
        _ => None,
    }
}

fn is_compatible_postgres_numeric_literal(target_type: &str, value: &str) -> bool {
    if let Some((min, max)) = postgres_integer_range(target_type) {
        return is_plain_integer_literal(value)
            && value
                .trim()
                .parse::<i128>()
                .map(|number| number >= min && number <= max)
                .unwrap_or(false);
    }

    is_postgres_numeric_type(target_type) && is_plain_numeric_literal(value)
}

fn is_unambiguous_timestamp_expression(value: &str) -> bool {
    let normalized = value.trim().to_ascii_lowercase();
    if matches!(
        normalized.as_str(),
        "current_timestamp"
            | "current_timestamp()"
            | "current_date"
            | "current_time"
            | "localtime"
            | "localtimestamp"
            | "now()"
    ) {
        return true;
    }

    ["current_timestamp(", "localtime(", "localtimestamp("]
        .iter()
        .any(|prefix| {
            normalized
                .strip_prefix(prefix)
                .and_then(|precision| precision.strip_suffix(')'))
                .and_then(|precision| precision.parse::<u8>().ok())
                .is_some_and(|precision| precision <= 6)
        })
}

fn is_plain_temporal_literal(value: &str) -> bool {
    let value = value.trim();
    !value.is_empty()
        && value.chars().any(|ch| ch.is_ascii_digit())
        && value
            .chars()
            .all(|ch| ch.is_ascii_digit() || matches!(ch, '-' | '+' | ':' | '.' | ' '))
        && !value.starts_with("0000")
}

/// MySQL exposes character defaults as decoded values (for example `PENDING`),
/// while PostgreSQL requires a string literal (`'PENDING'`). Quote only known
/// MySQL character columns and reject values that could be metadata for an SQL
/// expression; unknown types never get blindly quoted or passed through.
fn apply_mysql_string_default_mapping(
    column: &mut super::types::ColumnSnapshot,
    source_type: &str,
    target_type: &str,
    should_translate: bool,
) -> Result<(), String> {
    if !should_translate {
        return Ok(());
    }
    let Some(default) = column.default_value.as_deref() else {
        return Ok(());
    };

    if is_mysql_character_type(source_type) {
        // The boolean mapper has already handled strict 0/1 overrides to a
        // PostgreSQL boolean. Any remaining default on a boolean target has
        // already failed closed there.
        if is_postgres_boolean_type(target_type) {
            return Ok(());
        }
        if !is_postgres_character_type_cast(target_type) {
            return Err(format!(
                "Cannot safely translate MySQL string default `{default}` on column `{}` to PostgreSQL type `{target_type}`",
                column.name
            ));
        }
        let trimmed = default.trim();
        let lowered = trimmed.to_ascii_lowercase();
        let suspicious = trimmed.is_empty()
            || trimmed
                .chars()
                .any(|ch| ch.is_control() || ch == '\\' || matches!(ch, '(' | ')'))
            || matches!(
                lowered.as_str(),
                "current_timestamp"
                    | "current_timestamp()"
                    | "current_date"
                    | "current_time"
                    | "localtime"
                    | "localtimestamp"
                    | "now()"
            );
        if suspicious {
            return Err(format!(
                "Cannot safely translate MySQL default expression `{default}` on string column `{}`",
                column.name
            ));
        }
        column.default_value = Some(format!("'{}'", default.replace('\'', "''")));
        return Ok(());
    }

    if matches!(
        normalized_mysql_type_base(source_type).as_str(),
        "date" | "time" | "datetime" | "timestamp"
    ) {
        if !is_postgres_temporal_type(target_type) {
            return Err(format!(
                "Cannot safely translate MySQL temporal default `{default}` on column `{}` to PostgreSQL type `{target_type}`",
                column.name
            ));
        }
        if is_unambiguous_timestamp_expression(default) {
            return Ok(());
        }
        if is_plain_temporal_literal(default) {
            column.default_value = Some(format!("'{}'", default.replace('\'', "''")));
            return Ok(());
        }
        return Err(format!(
            "Cannot safely translate MySQL temporal default `{default}` on column `{}`",
            column.name
        ));
    }

    if is_mysql_numeric_default_type(source_type) {
        if is_compatible_postgres_numeric_literal(target_type, default)
            || (is_postgres_boolean_type(target_type)
                && matches!(
                    default.trim().to_ascii_lowercase().as_str(),
                    "true" | "false"
                ))
        {
            return Ok(());
        }
        return Err(format!(
            "Cannot safely translate MySQL numeric default expression `{default}` on column `{}`",
            column.name
        ));
    }

    // Explicitly preserve only defaults whose SQL meaning is unambiguous for
    // the mapped PostgreSQL type. Everything else requires human review.
    let safe_for_target = is_compatible_postgres_numeric_literal(target_type, default)
        || (is_postgres_boolean_type(target_type)
            && matches!(
                default.trim().to_ascii_lowercase().as_str(),
                "true" | "false"
            ))
        || (is_postgres_temporal_type(target_type) && is_unambiguous_timestamp_expression(default));
    if safe_for_target {
        Ok(())
    } else {
        Err(format!(
            "Cannot safely translate MySQL default `{default}` on column `{}` with unknown source type `{source_type}`",
            column.name
        ))
    }
}

fn translate_mysql_boolean_default(source_type: &str, default: &str) -> Option<&'static str> {
    if is_mysql_bit_boolean_type(source_type) {
        return match default.trim().to_ascii_lowercase().as_str() {
            "b'1'" | "0b1" => Some("TRUE"),
            "b'0'" | "0b0" => Some("FALSE"),
            _ => None,
        };
    }

    match default.trim().to_ascii_lowercase().as_str() {
        "1" | "true" => Some("TRUE"),
        "0" | "false" => Some("FALSE"),
        _ => None,
    }
}

fn mapped_mysql_boolean_default(
    source_type: &str,
    target_type: &str,
    default: &str,
    should_translate: bool,
) -> Result<Option<&'static str>, ()> {
    if !should_translate {
        return Ok(None);
    }

    let source_is_boolean = is_mysql_boolean_type(source_type);
    let source_is_bit_boolean = is_mysql_bit_boolean_type(source_type);
    let target_is_boolean = is_postgres_boolean_type(target_type);
    let target_is_numeric = is_postgres_numeric_type(target_type);

    if target_is_boolean {
        if source_is_bit_boolean || source_is_boolean {
            return translate_mysql_boolean_default(source_type, default)
                .map(Some)
                .ok_or(());
        }

        // An explicit type override can request a PostgreSQL boolean for a
        // non-boolean MySQL type. Only exact numeric boolean literals have a
        // safe, unambiguous mapping; expressions and other values fail closed.
        return match default.trim() {
            "1" => Ok(Some("TRUE")),
            "0" => Ok(Some("FALSE")),
            _ => Err(()),
        };
    }

    if source_is_boolean {
        if !target_is_numeric {
            return Err(());
        }

        if source_is_bit_boolean {
            return match default.trim().to_ascii_lowercase().as_str() {
                "b'1'" | "0b1" => Ok(Some("1")),
                "b'0'" | "0b0" => Ok(Some("0")),
                _ => Err(()),
            };
        }

        return match default.trim().to_ascii_lowercase().as_str() {
            "1" | "0" => Ok(None),
            "true" => Ok(Some("1")),
            "false" => Ok(Some("0")),
            _ => Err(()),
        };
    }

    Ok(None)
}

fn apply_mysql_boolean_default_mapping(
    column: &mut super::types::ColumnSnapshot,
    source_type: &str,
    target_type: &str,
    should_translate: bool,
) -> Result<(), String> {
    if should_translate {
        if let Some(default) = &column.default_value {
            match mapped_mysql_boolean_default(source_type, target_type, default, should_translate)
            {
                Ok(Some(translated)) => column.default_value = Some(translated.to_string()),
                Ok(None) => {}
                Err(()) => {
                    return Err(format!(
                    "Cannot safely translate MySQL default `{default}` on column `{}` for PostgreSQL type `{target_type}`",
                    column.name,
                ));
                }
            }
        }
    }
    apply_mysql_string_default_mapping(column, source_type, target_type, should_translate)
}

fn is_narrowing_nullability(src_nullable: bool, tgt_nullable: bool) -> bool {
    // Deploy makes target match source: going from nullable→NOT NULL is narrowing.
    !src_nullable && tgt_nullable
}

fn integer_rank(ty: &str) -> Option<u8> {
    let base = ty.split('(').next()?.trim();
    match base {
        "bigint" | "int8" => Some(4),
        "int" | "integer" | "int4" | "mediumint" => Some(3),
        "smallint" | "int2" => Some(2),
        "tinyint" | "int1" => Some(1),
        _ => None,
    }
}

fn apply_type_mapping(
    op: &mut super::operations::MigrationOperation,
    opts: &PlanOptions<'_>,
    table: &str,
    source_schema: &TableSchema,
    source_dialect: &str,
    target_dialect: &str,
    requirements: &mut Vec<PlanRequirement>,
) -> bool {
    let operation_key = op.key();
    let translate_mysql_boolean_defaults = opts.cross_dialect
        && normalize_dialect(source_dialect) == "mysql"
        && normalize_dialect(target_dialect) == "postgresql";
    match op {
        super::operations::MigrationOperation::AddColumn { column, .. } => {
            let source_type = column.data_type.clone();
            match resolve_type(opts, table, &column.name, &column.data_type) {
                Ok(ty) => {
                    if let Err(reason) = apply_mysql_boolean_default_mapping(
                        column,
                        &source_type,
                        &ty,
                        translate_mysql_boolean_defaults,
                    ) {
                        requirements.push(PlanRequirement::Unsupported {
                            operation: operation_key.clone(),
                            reason,
                        });
                        return false;
                    }
                    column.data_type = ty;
                }
                Err(reason) => {
                    requirements.push(PlanRequirement::Unsupported {
                        operation: operation_key.clone(),
                        reason,
                    });
                    return false;
                }
            }
        }
        super::operations::MigrationOperation::CreateTable { columns, .. } => {
            for column in columns {
                let source_type = column.data_type.clone();
                match resolve_type(opts, table, &column.name, &column.data_type) {
                    Ok(ty) => {
                        if let Err(reason) = apply_mysql_boolean_default_mapping(
                            column,
                            &source_type,
                            &ty,
                            translate_mysql_boolean_defaults,
                        ) {
                            requirements.push(PlanRequirement::Unsupported {
                                operation: operation_key.clone(),
                                reason,
                            });
                            return false;
                        }
                        column.data_type = ty;
                    }
                    Err(reason) => {
                        requirements.push(PlanRequirement::Unsupported {
                            operation: operation_key.clone(),
                            reason,
                        });
                        return false;
                    }
                }
            }
        }
        super::operations::MigrationOperation::AlterColumnType { column, to, .. } => {
            match resolve_type(opts, table, column, to) {
                Ok(ty) => *to = ty,
                Err(reason) => {
                    requirements.push(PlanRequirement::Unsupported {
                        operation: operation_key.clone(),
                        reason,
                    });
                    return false;
                }
            }
        }
        super::operations::MigrationOperation::SetDefault { column, to, .. }
            if translate_mysql_boolean_defaults && to.is_some() =>
        {
            if let Some(source_column) = source_schema
                .columns
                .iter()
                .find(|source_column| source_column.name == *column)
            {
                match resolve_type(opts, table, column, &source_column.data_type) {
                    Ok(target_type) => {
                        let source_type = source_column.data_type.clone();
                        let mut default_column = super::types::ColumnSnapshot {
                            name: source_column.name.clone(),
                            data_type: source_type.clone(),
                            nullable: source_column.nullable,
                            default_value: to.clone(),
                            comment: source_column.comment.clone(),
                            is_primary_key: source_column.is_primary_key,
                            is_auto_increment: source_column.is_auto_increment,
                        };
                        if let Err(reason) = apply_mysql_boolean_default_mapping(
                            &mut default_column,
                            &source_type,
                            &target_type,
                            translate_mysql_boolean_defaults,
                        ) {
                            requirements.push(PlanRequirement::Unsupported {
                                operation: operation_key.clone(),
                                reason,
                            });
                            return false;
                        }
                        *to = default_column.default_value;
                    }
                    Err(reason) => {
                        requirements.push(PlanRequirement::Unsupported {
                            operation: operation_key.clone(),
                            reason,
                        });
                        return false;
                    }
                }
            } else {
                requirements.push(PlanRequirement::Unsupported {
                    operation: operation_key.clone(),
                    reason: format!(
                        "Cannot safely translate MySQL default on column `{column}` because source metadata is missing"
                    ),
                });
                return false;
            }
        }
        _ => {}
    }
    true
}

/// PostgreSQL cannot always cast an existing default while changing a column
/// type. For MySQL→PostgreSQL boolean mappings, make the transition explicit:
/// drop the current default, change the type, then install the mapped source
/// default. This also normalizes defaults whose raw source/target text matches
/// (for example MySQL `1` versus PostgreSQL integer `1`).
fn stage_mysql_boolean_type_change_defaults(
    operations: &mut Vec<super::operations::MigrationOperation>,
    source_schema: &TableSchema,
    target_schema: &TableSchema,
    source_dialect: &str,
    target_dialect: &str,
    requirements: &mut Vec<PlanRequirement>,
) {
    use super::operations::MigrationOperation;

    if normalize_dialect(source_dialect) != "mysql"
        || normalize_dialect(target_dialect) != "postgresql"
    {
        return;
    }

    let type_changes = operations
        .iter()
        .filter_map(|op| match op {
            MigrationOperation::AlterColumnType {
                table, column, to, ..
            } if is_postgres_boolean_type(to) => Some((table.clone(), column.clone(), to.clone())),
            _ => None,
        })
        .collect::<Vec<_>>();
    if type_changes.is_empty() {
        return;
    }

    let mut staged = Vec::new();
    let mut staged_columns = HashSet::new();
    let mut unsupported_columns = HashSet::new();

    for (table, column, target_type) in type_changes {
        let operation_key = format!("column:{table}.{column}");
        if requirements.iter().any(|requirement| {
            matches!(requirement,
                PlanRequirement::Unsupported { operation, .. } if operation == &operation_key)
        }) {
            unsupported_columns.insert((table, column));
            continue;
        }

        let Some(source_column) = source_schema
            .columns
            .iter()
            .find(|source_column| source_column.name == column)
        else {
            requirements.push(PlanRequirement::Unsupported {
                operation: operation_key,
                reason: "Cannot safely map PostgreSQL boolean default because the source column metadata is missing".into(),
            });
            unsupported_columns.insert((table, column));
            continue;
        };
        let Some(target_column) = target_schema
            .columns
            .iter()
            .find(|target_column| target_column.name == column)
        else {
            requirements.push(PlanRequirement::Unsupported {
                operation: operation_key,
                reason: "Cannot safely stage PostgreSQL boolean type change because the target column metadata is missing".into(),
            });
            unsupported_columns.insert((table, column));
            continue;
        };

        let desired_default = match source_column.default_value.as_deref() {
            None => None,
            Some(default) => match mapped_mysql_boolean_default(
                &source_column.data_type,
                &target_type,
                default,
                true,
            ) {
                Ok(mapped) => Some(mapped.unwrap_or(default).to_string()),
                Err(()) => {
                    requirements.push(PlanRequirement::Unsupported {
                        operation: operation_key,
                        reason: format!(
                            "Cannot safely translate MySQL default `{default}` on column `{column}` for PostgreSQL type `{target_type}`"
                        ),
                    });
                    unsupported_columns.insert((table, column));
                    continue;
                }
            },
        };

        if let Some(current_default) = &target_column.default_value {
            staged.push(MigrationOperation::SetDefault {
                table: table.clone(),
                column: column.clone(),
                from: Some(current_default.clone()),
                to: None,
            });
        }
        if let Some(default) = desired_default {
            staged.push(MigrationOperation::SetDefault {
                table: table.clone(),
                column: column.clone(),
                from: None,
                to: Some(default),
            });
        }
        staged_columns.insert((table, column));
    }

    operations.retain(|op| match op {
        MigrationOperation::AlterColumnType { table, column, .. } => {
            !unsupported_columns.contains(&(table.clone(), column.clone()))
        }
        MigrationOperation::SetDefault { table, column, .. } => {
            !staged_columns.contains(&(table.clone(), column.clone()))
                && !unsupported_columns.contains(&(table.clone(), column.clone()))
        }
        _ => true,
    });
    operations.extend(staged);
}

fn effective_risk(
    op: &super::operations::MigrationOperation,
    destructive_narrowing: &HashSet<String>,
) -> StatementRisk {
    if destructive_narrowing.contains(&op.key()) {
        StatementRisk::Destructive
    } else {
        op.risk()
    }
}

fn plan_single_table(
    table: &str,
    src: &TableSchema,
    tgt: &TableSchema,
    source_dialect: &str,
    target_dialect: &str,
    opts: &PlanOptions<'_>,
    statements: &mut Vec<PlanStatement>,
    warnings: &mut Vec<String>,
    requirements: &mut Vec<super::types::PlanRequirement>,
) {
    let table = match datazen_driver_api::validate_migration_identifier(table) {
        Ok(value) => value,
        Err(reason) => {
            requirements.push(super::types::PlanRequirement::Unsupported {
                operation: table.to_string(),
                reason: format!("Invalid target table identifier: {reason}"),
            });
            return;
        }
    };

    let Some(driver) = datazen_driver_api::create_driver(target_dialect) else {
        requirements.push(super::types::PlanRequirement::Unsupported {
            operation: table.to_string(),
            reason: format!("No registered driver for target database: {target_dialect}"),
        });
        return;
    };

    let normalizer = if opts.cross_dialect {
        None
    } else {
        driver.type_normalizer()
    };
    let normalizer_ref = normalizer.as_deref();
    let mut operations = super::ir::diff_to_operations(table, src, tgt, normalizer_ref);

    // Type mapping belongs at the boundary between source snapshot and target driver.
    // The IR remains dialect-neutral; only replace types before rendering.
    if opts.type_mapper.is_some() {
        operations.retain_mut(|op| {
            apply_type_mapping(
                op,
                opts,
                table,
                src,
                source_dialect,
                target_dialect,
                requirements,
            )
        });
    }

    stage_mysql_boolean_type_change_defaults(
        &mut operations,
        src,
        tgt,
        source_dialect,
        target_dialect,
        requirements,
    );

    // Cross-dialect: strip source-dialect-specific defaults before rendering.
    if opts.cross_dialect {
        operations.retain_mut(|op| strip_dialect_specific_defaults(op, warnings, requirements));
        operations.retain(|op| {
            if matches!(
                op,
                super::operations::MigrationOperation::AddCheckConstraint { .. }
                    | super::operations::MigrationOperation::DropCheckConstraint { .. }
                    | super::operations::MigrationOperation::SetTableOptions { .. }
            ) {
                requirements.push(PlanRequirement::Unsupported {
                    operation: op.key(),
                    reason: if matches!(
                        op,
                        super::operations::MigrationOperation::SetTableOptions { .. }
                    ) {
                        "Table engine/charset/comment options are dialect-specific; compare and migrate them on the same database family".into()
                    } else {
                        "CHECK expressions are dialect-specific; compare and migrate them on the same database family".into()
                    },
                });
                false
            } else {
                true
            }
        });
    }

    let mut destructive_narrowing = HashSet::new();
    for op in &operations {
        match op {
            super::operations::MigrationOperation::AlterColumnType {
                table,
                column,
                from,
                to,
            } => {
                let desired = ColumnSnapshot {
                    name: column.clone(),
                    data_type: to.clone(),
                    nullable: true,
                    default_value: None,
                    comment: None,
                    is_primary_key: false,
                    is_auto_increment: false,
                };
                let current = ColumnSnapshot {
                    name: column.clone(),
                    data_type: from.clone(),
                    nullable: true,
                    default_value: None,
                    comment: None,
                    is_primary_key: false,
                    is_auto_increment: false,
                };
                if is_type_narrowing(&desired, &current) {
                    destructive_narrowing.insert(op.key());
                    warnings.push(format!(
                        "Type change on {table}.{column} from {from} to {to} may truncate existing data"
                    ));
                }
            }
            super::operations::MigrationOperation::SetNullable {
                table,
                column,
                nullable,
            } if is_narrowing_nullability(*nullable, !nullable) => {
                destructive_narrowing.insert(op.key());
                warnings.push(format!(
                    "Setting {table}.{column} to NOT NULL may fail if existing rows contain NULL"
                ));
            }
            _ => {}
        }
    }

    let all_operations = operations.clone();

    // Safety policy is domain-level: destructive operations require explicit approval.
    operations.retain(|op| {
        if !opts.allow_destructive
            && effective_risk(op, &destructive_narrowing) == StatementRisk::Destructive
        {
            warnings.push(format!("Skipped destructive operation {}", op.key()));
            false
        } else {
            true
        }
    });

    // Adding a NOT NULL column without a source default would fail for existing rows.
    // Do not invent a business value. Add it nullable and require explicit backfill.
    for op in &mut operations {
        if let super::operations::MigrationOperation::AddColumn { table, column } = op {
            if !column.nullable && column.default_value.is_none() {
                column.nullable = true;
                requirements.push(super::types::PlanRequirement::Backfill {
                    table: table.clone(),
                    column: column.name.clone(),
                    reason: "Populate existing rows before enforcing NOT NULL.".into(),
                });
            }
        }
    }

    if !opts.include_indexes {
        operations.retain(|op| {
            !matches!(
                op,
                super::operations::MigrationOperation::CreateIndex { .. }
                    | super::operations::MigrationOperation::DropIndex { .. }
            )
        });
    }

    if opts.cross_dialect {
        for op in &mut operations {
            match op {
                super::operations::MigrationOperation::AddForeignKey { foreign_key, .. }
                | super::operations::MigrationOperation::DropForeignKey { foreign_key, .. } => {
                    foreign_key.referenced_table =
                        resolve_table_for_dialect(target_dialect, &foreign_key.referenced_table);
                }
                _ => {}
            }
        }
    }

    if normalize_dialect(target_dialect) == "mysql" {
        adjust_mysql_index_columns(&mut operations, src, tgt, warnings);
    }

    let Some(capabilities) = driver.migration_capabilities() else {
        requirements.push(super::types::PlanRequirement::Unsupported {
            operation: table.to_string(),
            reason: format!(
                "Driver {} does not expose schema migration capabilities",
                target_dialect
            ),
        });
        return;
    };

    operations.retain(|op| {
        let driver_op = op.to_driver_api();
        if !capabilities.supports(&driver_op) {
            requirements.push(super::types::PlanRequirement::Unsupported {
                operation: op.key(),
                reason: format!("Operation is not supported by {}", target_dialect),
            });
            false
        } else {
            if capabilities.requires_table_rebuild(&driver_op) {
                warnings.push(format!(
                    "{} may require a table rewrite on {}",
                    op.key(),
                    target_dialect
                ));
            }
            true
        }
    });

    let selected_count = operations.len();
    super::dependencies::retain_dependency_closed(&all_operations, &mut operations);
    if selected_count != operations.len() {
        warnings.push(format!("Skipped {} dependent operations on {table}; their prerequisites or replacement partners were excluded", selected_count - operations.len()));
    }
    let count = operations.len();
    let operations = super::dependencies::resolve_dependencies(operations);
    if count != operations.len() {
        requirements.push(PlanRequirement::Unsupported {
            operation: table.into(),
            reason: "Operation dependency cycle requires staged migration".into(),
        });
        return;
    }
    let Some(renderer) = driver.migration_renderer() else {
        requirements.push(super::types::PlanRequirement::Unsupported {
            operation: table.to_string(),
            reason: format!(
                "Driver {} does not expose schema migration rendering",
                target_dialect
            ),
        });
        return;
    };

    for op in operations {
        let key = op.key();
        let driver_op = op.to_driver_api();
        match renderer.render(&driver_op) {
            Ok(stmt) => {
                let mut risk = match stmt.risk {
                    datazen_driver_api::MigrationRisk::Additive => StatementRisk::Additive,
                    datazen_driver_api::MigrationRisk::Rewrite => StatementRisk::Rewrite,
                    datazen_driver_api::MigrationRisk::Destructive => StatementRisk::Destructive,
                };
                if destructive_narrowing.contains(&key) {
                    risk = StatementRisk::Destructive;
                }
                statements.push(PlanStatement {
                    sql: stmt.sql,
                    risk,
                    rollback_sql: stmt.rollback_sql,
                    summary: stmt.summary,
                });
            }
            Err(reason) => requirements.push(PlanRequirement::Unsupported {
                operation: key,
                reason,
            }),
        }
    }
}

fn is_type_narrowing(desired: &ColumnSnapshot, current: &ColumnSnapshot) -> bool {
    let desired_l = desired.data_type.to_ascii_lowercase();
    let current_l = current.data_type.to_ascii_lowercase();
    if desired_l == current_l {
        return false;
    }
    // varchar(n) → varchar(m) with m < n
    if let (Some(dn), Some(cn)) = (extract_len(&desired_l), extract_len(&current_l)) {
        return dn < cn;
    }
    // Integer family narrowing (e.g. INT → SMALLINT).
    if let (Some(dr), Some(cr)) = (integer_rank(&desired_l), integer_rank(&current_l)) {
        return dr < cr;
    }
    false
}

fn extract_len(ty: &str) -> Option<usize> {
    let start = ty.find('(')?;
    let end = ty.find(')')?;
    ty[start + 1..end].parse().ok()
}

fn is_mysql_blob_or_text(ty: &str) -> bool {
    let lower = ty.trim().to_ascii_lowercase();
    let base = lower.split('(').next().unwrap_or("").trim();
    if matches!(
        base,
        "text"
            | "tinytext"
            | "mediumtext"
            | "longtext"
            | "blob"
            | "tinyblob"
            | "mediumblob"
            | "longblob"
    ) {
        return true;
    }
    if (base == "varchar" || base == "char") && extract_len(&lower).map_or(false, |len| len > 768) {
        return true;
    }
    false
}

fn adjust_mysql_index_columns(
    operations: &mut [super::operations::MigrationOperation],
    src: &TableSchema,
    tgt: &TableSchema,
    warnings: &mut Vec<String>,
) {
    let mut target_col_types: HashMap<String, String> = HashMap::new();

    for c in &tgt.columns {
        target_col_types.insert(c.name.to_ascii_lowercase(), c.data_type.clone());
    }

    for op in operations.iter() {
        match op {
            super::operations::MigrationOperation::CreateTable { columns, .. } => {
                for c in columns {
                    target_col_types.insert(c.name.to_ascii_lowercase(), c.data_type.clone());
                }
            }
            super::operations::MigrationOperation::AddColumn { column, .. } => {
                target_col_types.insert(column.name.to_ascii_lowercase(), column.data_type.clone());
            }
            super::operations::MigrationOperation::AlterColumnType { column, to, .. } => {
                target_col_types.insert(column.to_ascii_lowercase(), to.clone());
            }
            _ => {}
        }
    }

    for c in &src.columns {
        target_col_types
            .entry(c.name.to_ascii_lowercase())
            .or_insert_with(|| c.data_type.clone());
    }

    for op in operations.iter_mut() {
        if let super::operations::MigrationOperation::CreateIndex { table, index } = op {
            for col in &mut index.columns {
                if col.contains('(') {
                    continue;
                }
                let clean_name = col.trim().trim_matches('`').to_ascii_lowercase();
                if let Some(ty) = target_col_types.get(&clean_name) {
                    if is_mysql_blob_or_text(ty) {
                        warnings.push(format!(
                            "Added prefix length (255) for BLOB/TEXT column '{clean_name}' in index '{}' on table '{table}' for MySQL compatibility",
                            index.name
                        ));
                        *col = format!("{}(255)", col.trim().trim_matches('`'));
                    }
                }
            }
        }
    }
}

fn rollback_completeness(statements: &[super::types::PlanStatement]) -> RollbackCompleteness {
    let missing: Vec<String> = statements
        .iter()
        .filter(|s| s.rollback_sql.is_none())
        .map(|s| s.summary.clone())
        .collect();
    RollbackCompleteness {
        complete: missing.is_empty(),
        missing,
    }
}

fn reorder_foreign_key_statements(
    statements: Vec<super::types::PlanStatement>,
) -> Vec<super::types::PlanStatement> {
    let mut drops = Vec::new();
    let mut regular = Vec::new();
    let mut adds = Vec::new();
    for statement in statements {
        if statement.summary.starts_with("DROP FOREIGN KEY ") {
            drops.push(statement);
        } else if statement.summary.starts_with("ADD FOREIGN KEY ") {
            adds.push(statement);
        } else {
            regular.push(statement);
        }
    }
    drops.extend(regular);
    drops.extend(adds);
    drops
}

pub fn is_source_unbounded_text(data_type: &str) -> bool {
    let lower = data_type.trim().to_ascii_lowercase();
    let base = lower.split('(').next().unwrap_or("").trim();
    if matches!(
        base,
        "text" | "citext" | "tinytext" | "mediumtext" | "longtext"
    ) {
        return true;
    }
    if (base == "varchar" || base == "character varying" || base == "char" || base == "character")
        && !lower.contains('(')
    {
        return true;
    }
    false
}

fn detect_type_suggestions(
    pairs: &[(String, TableSchema, TableSchema)],
    source_dialect: &str,
    target_dialect: &str,
    opts: &PlanOptions<'_>,
) -> Vec<TypeSuggestion> {
    let src_d = normalize_dialect(source_dialect);
    let tgt_d = normalize_dialect(target_dialect);
    if tgt_d != "mysql" || src_d == tgt_d {
        return Vec::new();
    }

    let mut suggestions = Vec::new();
    for (table, src, _tgt) in pairs {
        for col in &src.columns {
            if is_source_unbounded_text(&col.data_type) {
                let is_pk = src
                    .primary_keys
                    .iter()
                    .any(|pk| pk.eq_ignore_ascii_case(&col.name))
                    || col.is_primary_key;
                let is_unique_indexed = src.indexes.iter().any(|i| {
                    i.is_unique
                        && i.columns.iter().any(|c| {
                            c.split('(')
                                .next()
                                .unwrap_or(c)
                                .trim()
                                .trim_matches('`')
                                .eq_ignore_ascii_case(&col.name)
                        })
                });
                let is_indexed = src.indexes.iter().any(|i| {
                    i.columns.iter().any(|c| {
                        c.split('(')
                            .next()
                            .unwrap_or(c)
                            .trim()
                            .trim_matches('`')
                            .eq_ignore_ascii_case(&col.name)
                    })
                });
                let has_default = col.default_value.is_some();

                let reason = if is_pk {
                    "Primary key column; MySQL requires explicit key length for keys".to_string()
                } else if is_unique_indexed {
                    "Unique index column; MySQL TEXT does not support direct unique index"
                        .to_string()
                } else if is_indexed {
                    "Indexed column; MySQL requires explicit key prefix length for TEXT".to_string()
                } else if has_default {
                    "Default value defined; MySQL restricts default values on BLOB/TEXT".to_string()
                } else {
                    "Unbounded text column; explicit length recommended for MySQL".to_string()
                };

                let current_type = resolve_type(opts, table, &col.name, &col.data_type)
                    .unwrap_or_else(|_| "VARCHAR(255)".into());

                suggestions.push(TypeSuggestion {
                    table: table.clone(),
                    column: col.name.clone(),
                    source_type: col.data_type.clone(),
                    suggested_type: "VARCHAR(255)".into(),
                    current_type,
                    reason,
                    is_key_or_indexed: is_pk || is_unique_indexed || is_indexed || has_default,
                });
            }
        }
    }
    suggestions
}

fn plan_target_only_table(
    table: &str,
    target_dialect: &str,
    allow_destructive: bool,
    statements: &mut Vec<PlanStatement>,
    warnings: &mut Vec<String>,
    requirements: &mut Vec<PlanRequirement>,
) {
    let table = match datazen_driver_api::validate_migration_identifier(table) {
        Ok(value) => value,
        Err(reason) => {
            requirements.push(PlanRequirement::Unsupported {
                operation: table.to_string(),
                reason: format!("Invalid target table identifier: {reason}"),
            });
            return;
        }
    };
    let Some(driver) = datazen_driver_api::create_driver(target_dialect) else {
        requirements.push(PlanRequirement::Unsupported {
            operation: table.to_string(),
            reason: format!("No registered driver for target database: {target_dialect}"),
        });
        return;
    };
    let operation = super::operations::MigrationOperation::DropTable {
        table: table.to_string(),
    };
    if !allow_destructive {
        warnings.push(format!("Skipped destructive operation {}", operation.key()));
        return;
    }
    let Some(capabilities) = driver.migration_capabilities() else {
        requirements.push(PlanRequirement::Unsupported {
            operation: operation.key(),
            reason: format!(
                "Driver {} does not expose schema migration capabilities",
                target_dialect
            ),
        });
        return;
    };
    let driver_operation = operation.to_driver_api();
    if !capabilities.supports(&driver_operation) {
        requirements.push(PlanRequirement::Unsupported {
            operation: operation.key(),
            reason: format!("Operation is not supported by {target_dialect}"),
        });
        return;
    }
    let Some(renderer) = driver.migration_renderer() else {
        requirements.push(PlanRequirement::Unsupported {
            operation: operation.key(),
            reason: format!(
                "Driver {} does not expose schema migration rendering",
                target_dialect
            ),
        });
        return;
    };
    match renderer.render(&driver_operation) {
        Ok(statement) => statements.push(PlanStatement {
            sql: statement.sql,
            risk: StatementRisk::Destructive,
            rollback_sql: statement.rollback_sql,
            summary: statement.summary,
        }),
        Err(reason) => requirements.push(PlanRequirement::Unsupported {
            operation: operation.key(),
            reason,
        }),
    }
}

/// Build a plan for source tables plus explicitly selected target-only tables.
/// `pairs` is (table_name, source_schema, target_schema). Target-only entries
/// are rendered as DropTable operations and never represented by an invented
/// empty source snapshot.
pub fn build_schema_diff_plan_with_target_only(
    pairs: &[(String, TableSchema, TableSchema)],
    target_only_tables: &[String],
    source_dialect: &str,
    target_dialect: &str,
    opts: PlanOptions<'_>,
) -> SchemaDiffPlan {
    let selected = target_only_tables
        .iter()
        .map(|table| TargetOnlyTableDrop {
            table: table.clone(),
            identity: table.clone(),
        })
        .collect::<Vec<_>>();
    build_schema_diff_plan_with_target_snapshot(
        pairs,
        &selected,
        &[],
        source_dialect,
        target_dialect,
        opts,
    )
}

/// Build a plan with target-only table drops after checking the complete
/// target snapshot for inbound foreign keys. Selected drops are sorted so
/// dependent tables are dropped before their referenced parents.
pub fn build_schema_diff_plan_with_target_snapshot(
    pairs: &[(String, TableSchema, TableSchema)],
    target_only_tables: &[TargetOnlyTableDrop],
    target_snapshot: &[TargetTableDependencySnapshot],
    source_dialect: &str,
    target_dialect: &str,
    opts: PlanOptions<'_>,
) -> SchemaDiffPlan {
    let mut statements = Vec::new();
    let mut warnings = Vec::new();
    let mut requirements = Vec::new();
    let src_d = normalize_dialect(source_dialect);
    let tgt_d = normalize_dialect(target_dialect);
    let same_dialect = src_d == tgt_d;

    if !same_dialect && opts.type_mapper.is_none() {
        warnings.push(
            "Cross-dialect plan without IR type mapper: using source native types as-is (may fail)"
                .into(),
        );
    }

    let opts = PlanOptions {
        cross_dialect: !same_dialect,
        ..opts
    };

    let mut tables = Vec::new();
    for (table, src, tgt) in pairs {
        tables.push(table.clone());
        let deploy_table = resolve_table_for_dialect(&tgt_d, table);
        plan_single_table(
            &deploy_table,
            src,
            tgt,
            &src_d,
            &tgt_d,
            &opts,
            &mut statements,
            &mut warnings,
            &mut requirements,
        );
    }

    let (ordered_target_only, blocked_target_only, dependency_requirements) =
        order_target_only_drops(target_only_tables, target_snapshot, &tgt_d);
    requirements.extend(dependency_requirements);
    tables.extend(
        target_only_tables
            .iter()
            .map(|drop| resolve_table_for_dialect(&tgt_d, &drop.table)),
    );
    for drop_index in ordered_target_only {
        let table = &target_only_tables[drop_index];
        let deploy_table = resolve_table_for_dialect(&tgt_d, &table.table);
        if blocked_target_only.contains(&drop_index) {
            continue;
        }
        plan_target_only_table(
            &deploy_table,
            &tgt_d,
            opts.allow_destructive,
            &mut statements,
            &mut warnings,
            &mut requirements,
        );
    }

    statements = reorder_foreign_key_statements(statements);
    let primary = tables.first().cloned().unwrap_or_default();
    let completeness = rollback_completeness(&statements);
    let type_suggestions = detect_type_suggestions(pairs, source_dialect, target_dialect, &opts);

    SchemaDiffPlan {
        plan_id: None,
        table: primary,
        tables,
        source_dialect: src_d,
        target_dialect: tgt_d,
        same_dialect,
        statements,
        warnings,
        rollback_completeness: completeness,
        requirements,
        type_suggestions,
    }
}

/// Build a plan for one or more source tables. `pairs` is
/// (table_name, source_schema, target_schema).
pub fn build_schema_diff_plan(
    pairs: &[(String, TableSchema, TableSchema)],
    source_dialect: &str,
    target_dialect: &str,
    opts: PlanOptions<'_>,
) -> SchemaDiffPlan {
    build_schema_diff_plan_with_target_only(pairs, &[], source_dialect, target_dialect, opts)
}

/// Convenience for single-table same-dialect plans (P1 tests).
pub fn build_column_plan(
    table: &str,
    src: &TableSchema,
    tgt: &TableSchema,
    dialect: &str,
) -> Result<SchemaDiffPlan, String> {
    Ok(build_schema_diff_plan(
        &[(table.to_string(), src.clone(), tgt.clone())],
        dialect,
        dialect,
        PlanOptions {
            allow_destructive: true,
            include_indexes: false,
            type_mapper: None,
            cross_dialect: false,
        },
    ))
}

#[cfg(test)]
#[path = "plan_tests.rs"]
mod tests;
