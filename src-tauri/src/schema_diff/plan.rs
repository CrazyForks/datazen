//! Build SchemaDiffPlan from table schema pairs.

use super::types::{
    normalize_dialect, resolve_table_for_dialect, ColumnSnapshot, PlanRequirement, PlanStatement,
    RollbackCompleteness, SchemaDiffPlan, StatementRisk, TypeSuggestion,
};
use crate::db::TableSchema;
use std::collections::{HashMap, HashSet};

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

/// Strips source-dialect-specific default expressions that would be invalid
/// in the target dialect (e.g. PostgreSQL `nextval()` in MySQL).
fn strip_dialect_specific_defaults(
    op: &mut super::operations::MigrationOperation,
    warnings: &mut Vec<String>,
) {
    let pg_patterns = ["nextval(", "::regclass", "::"];
    let strip = |col: &mut super::types::ColumnSnapshot, table: &str, w: &mut Vec<String>| {
        if let Some(ref d) = col.default_value {
            if pg_patterns.iter().any(|p| d.contains(p)) {
                w.push(format!(
                    "Stripped dialect-specific default for {}.{}: {}",
                    table, col.name, d
                ));
                col.default_value = None;
            }
        }
    };
    match op {
        super::operations::MigrationOperation::AddColumn { table, column } => {
            strip(column, table, warnings)
        }
        super::operations::MigrationOperation::CreateTable { table, columns, .. } => {
            for c in columns {
                strip(c, table, warnings);
            }
        }
        _ => {}
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
    requirements: &mut Vec<PlanRequirement>,
) -> bool {
    match op {
        super::operations::MigrationOperation::AddColumn { column, .. } => {
            match resolve_type(opts, table, &column.name, &column.data_type) {
                Ok(ty) => column.data_type = ty,
                Err(reason) => {
                    requirements.push(PlanRequirement::Unsupported {
                        operation: op.key(),
                        reason,
                    });
                    return false;
                }
            }
        }
        super::operations::MigrationOperation::CreateTable { columns, .. } => {
            for column in columns {
                match resolve_type(opts, table, &column.name, &column.data_type) {
                    Ok(ty) => column.data_type = ty,
                    Err(reason) => {
                        requirements.push(PlanRequirement::Unsupported {
                            operation: op.key(),
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
                        operation: op.key(),
                        reason,
                    });
                    return false;
                }
            }
        }
        _ => {}
    }
    true
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
    target_dialect: &str,
    opts: &PlanOptions<'_>,
    statements: &mut Vec<PlanStatement>,
    warnings: &mut Vec<String>,
    requirements: &mut Vec<super::types::PlanRequirement>,
) {
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
        operations.retain_mut(|op| apply_type_mapping(op, opts, table, requirements));
    }

    // Cross-dialect: strip source-dialect-specific defaults before rendering.
    if opts.cross_dialect {
        for op in &mut operations {
            strip_dialect_specific_defaults(op, warnings);
        }
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

/// Build a plan for one or more tables. `pairs` is (table_name, source_schema, target_schema).
pub fn build_schema_diff_plan(
    pairs: &[(String, TableSchema, TableSchema)],
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
            &tgt_d,
            &opts,
            &mut statements,
            &mut warnings,
            &mut requirements,
        );
    }

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
