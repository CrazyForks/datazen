//! SQL-file structure object planning and dialect rendering.

use std::collections::HashMap;

use datazen_driver_api::{DatabaseDriver, IRForeignKey, IRIndex, IRTableObjects, TableSchema};

use super::error::TransferError;
use super::model::{DdlPreviewItem, DdlPreviewKind, TableInspectResult, TransferJob};
use super::sql_file::{create_table_sql, create_table_sql_with_target, target_table_ref};
use super::structure::table_mapping_for;
use crate::transfer::adapter::{SyncSourceAdapter, SyncTargetAdapter};

fn object_column_mapping<'a>(
    mapping: Option<&'a super::model::TableMapping>,
    source_column: &str,
) -> Result<String, TransferError> {
    let Some(mapping) = mapping else {
        return Ok(source_column.to_string());
    };
    if mapping.column_mappings.is_empty() {
        return Ok(source_column.to_string());
    }
    let Some(column) = mapping
        .column_mappings
        .iter()
        .find(|column| column.source_column == source_column)
    else {
        return Err(TransferError::validation(format!(
            "source constraint column '{}' is not mapped",
            source_column
        )));
    };
    if column.skip || column.target_column.trim().is_empty() {
        return Err(TransferError::validation(format!(
            "source constraint column '{}' is skipped or has no target name",
            source_column
        )));
    }
    Ok(column.target_column.clone())
}

fn map_index_columns(
    index: &IRIndex,
    mapping: Option<&super::model::TableMapping>,
) -> Result<IRIndex, TransferError> {
    Ok(IRIndex {
        name: index.name.clone(),
        columns: index
            .columns
            .iter()
            .map(|column| object_column_mapping(mapping, column))
            .collect::<Result<Vec<_>, _>>()?,
        is_unique: index.is_unique,
        is_primary: index.is_primary,
        index_type: index.index_type.clone(),
    })
}

fn map_foreign_key_columns(
    foreign_key: &IRForeignKey,
    source_mapping: Option<&super::model::TableMapping>,
    referenced_mapping: Option<&super::model::TableMapping>,
) -> Result<IRForeignKey, TransferError> {
    if foreign_key.columns.len() != foreign_key.referenced_columns.len() {
        return Err(TransferError::validation(format!(
            "foreign key '{}' has mismatched column lists",
            foreign_key.name
        )));
    }
    Ok(IRForeignKey {
        name: foreign_key.name.clone(),
        columns: foreign_key
            .columns
            .iter()
            .map(|column| object_column_mapping(source_mapping, column))
            .collect::<Result<Vec<_>, _>>()?,
        referenced_table: foreign_key.referenced_table.clone(),
        referenced_columns: foreign_key
            .referenced_columns
            .iter()
            .map(|column| object_column_mapping(referenced_mapping, column))
            .collect::<Result<Vec<_>, _>>()?,
        on_update: foreign_key.on_update.clone(),
        on_delete: foreign_key.on_delete.clone(),
    })
}

fn structure_table_order(
    inspected: &[TableInspectResult],
    schemas: &HashMap<String, TableSchema>,
    job: &TransferJob,
) -> Result<Vec<String>, TransferError> {
    use std::collections::{BTreeSet, HashMap as StdHashMap};

    let selected: BTreeSet<String> = inspected
        .iter()
        .filter(|table| table.enabled && schemas.contains_key(&table.source_table))
        .map(|table| table.source_table.clone())
        .collect();
    let mut target_names = StdHashMap::new();
    for source in &selected {
        let mapping = table_mapping_for(job, source).ok_or_else(|| {
            TransferError::validation(format!("missing table mapping for '{source}'"))
        })?;
        target_names.insert(source.clone(), mapping.target_table.clone());
    }

    // Edges point from a referenced parent to its child. Foreign keys are
    // emitted after all data, but this ordering still makes the artifact
    // deterministic and gives consumers a safe table creation sequence.
    let mut outgoing: StdHashMap<String, BTreeSet<String>> = StdHashMap::new();
    let mut indegree: StdHashMap<String, usize> =
        selected.iter().map(|table| (table.clone(), 0)).collect();
    for source in &selected {
        let schema = schemas.get(source).ok_or_else(|| {
            TransferError::validation(format!("source schema is unavailable for '{source}'"))
        })?;
        for foreign_key in &schema.foreign_keys {
            if foreign_key.referenced_table == *source {
                continue;
            }
            if !selected.contains(&foreign_key.referenced_table) {
                return Err(TransferError::validation(format!(
                    "foreign key '{}' on '{}' references unselected table '{}'",
                    foreign_key.name, source, foreign_key.referenced_table
                )));
            }
            let children = outgoing
                .entry(foreign_key.referenced_table.clone())
                .or_default();
            if children.insert(source.clone()) {
                *indegree.entry(source.clone()).or_default() += 1;
            }
        }
    }

    let mut ready: BTreeSet<(String, String)> = indegree
        .iter()
        .filter(|(_, degree)| **degree == 0)
        .map(|(source, _)| {
            (
                target_names.get(source).cloned().unwrap_or_default(),
                source.clone(),
            )
        })
        .collect();
    let mut order = Vec::with_capacity(selected.len());
    while let Some((_, source)) = ready.pop_first() {
        order.push(source.clone());
        if let Some(children) = outgoing.get(&source) {
            for child in children {
                let degree = indegree
                    .get_mut(child)
                    .ok_or_else(|| TransferError::validation("invalid FK dependency graph"))?;
                *degree -= 1;
                if *degree == 0 {
                    ready.insert((
                        target_names.get(child).cloned().unwrap_or_default(),
                        child.clone(),
                    ));
                }
            }
        }
    }
    if order.len() != selected.len() {
        // Cycles are valid when constraints are deferred until after data.
        // Keep the cyclic remainder stable rather than emitting source order.
        let emitted: BTreeSet<_> = order.iter().cloned().collect();
        order.extend(
            selected
                .iter()
                .filter(|source| !emitted.contains(*source))
                .cloned(),
        );
    }
    Ok(order)
}

/// Render every SQL-file structure object in a deterministic, dependency-aware
/// sequence. The returned vector is copied into the immutable transfer plan by
/// the command layer and consumed verbatim at execution time.
pub(crate) fn build_structure_plan(
    source_adapter: Option<&dyn SyncSourceAdapter>,
    target_adapter: Option<&dyn SyncTargetAdapter>,
    target_driver: &dyn DatabaseDriver,
    job: &TransferJob,
    inspected: &[TableInspectResult],
    source_schemas: &HashMap<String, TableSchema>,
) -> Result<Vec<DdlPreviewItem>, TransferError> {
    let order = structure_table_order(inspected, source_schemas, job)?;
    let mut statements = Vec::new();
    let mut object_sets: Vec<(String, String, IRTableObjects)> = Vec::new();

    for source_table in &order {
        let table = inspected
            .iter()
            .find(|table| table.enabled && table.source_table == *source_table)
            .ok_or_else(|| TransferError::validation("structure table disappeared"))?;
        let schema = source_schemas.get(source_table).ok_or_else(|| {
            TransferError::validation(format!("source schema is unavailable for '{source_table}'"))
        })?;
        let mapping = table_mapping_for(job, source_table);
        let ddl_override = mapping
            .and_then(|mapping| mapping.ddl_override.as_deref())
            .map(str::trim)
            .filter(|ddl| !ddl.is_empty());
        let ddl = match ddl_override {
            Some(ddl) => ddl.to_string(),
            None => match (source_adapter, target_adapter) {
                (Some(source_adapter), Some(target_adapter)) => create_table_sql_with_target(
                    source_adapter,
                    target_adapter,
                    target_driver,
                    job,
                    table,
                    schema,
                )?,
                _ => create_table_sql(target_driver, job, table, schema)?,
            },
        };
        statements.push(DdlPreviewItem {
            source_table: source_table.clone(),
            target_table: table.target_table.clone(),
            ddl,
            kind: DdlPreviewKind::Table,
            depends_on: Vec::new(),
        });

        if ddl_override.is_some() {
            continue;
        }
        let (Some(source_adapter), Some(_)) = (source_adapter, target_adapter) else {
            if !schema.indexes.is_empty() || !schema.foreign_keys.is_empty() {
                return Err(TransferError::unsupported(format!(
                    "SQL-file structure objects on '{}' require a registered source IR adapter",
                    source_table
                )));
            }
            continue;
        };
        object_sets.push((
            source_table.clone(),
            table.target_table.clone(),
            source_adapter.table_objects_to_ir(schema),
        ));
    }

    let mut indexes = Vec::new();
    let mut foreign_keys = Vec::new();
    let Some(target_adapter) = target_adapter else {
        if object_sets.is_empty() {
            return Ok(statements);
        }
        return Err(TransferError::unsupported(
            "SQL-file structure objects require a target IR adapter",
        ));
    };
    for (source_table, target_table, objects) in object_sets {
        let mapping = table_mapping_for(job, &source_table);
        for index in objects.indexes.iter().filter(|index| !index.is_primary) {
            let mapped = map_index_columns(index, mapping)?;
            let table_ref = target_table_ref(target_driver, job, &target_table);
            let rendered = target_adapter
                .render_index_ddl(&table_ref, &mapped)
                .map_err(|error| {
                    TransferError::unsupported(format!(
                        "cannot render index '{}' on '{}': {error}",
                        index.name, source_table
                    ))
                })?;
            if let Some(ddl) = rendered {
                indexes.push(DdlPreviewItem {
                    source_table: source_table.clone(),
                    target_table: target_table.clone(),
                    ddl,
                    kind: DdlPreviewKind::Index,
                    depends_on: vec![source_table.clone()],
                });
            }
        }
        for foreign_key in objects.foreign_keys {
            let referenced_mapping = table_mapping_for(job, &foreign_key.referenced_table);
            let referenced_target = referenced_mapping.ok_or_else(|| {
                TransferError::validation(format!(
                    "foreign key '{}' references unselected table '{}'",
                    foreign_key.name, foreign_key.referenced_table
                ))
            })?;
            let mapped = map_foreign_key_columns(&foreign_key, mapping, Some(referenced_target))?;
            let child_ref = target_table_ref(target_driver, job, &target_table);
            let parent_ref = target_table_ref(target_driver, job, &referenced_target.target_table);
            let ddl = target_adapter
                .render_foreign_key_ddl(&child_ref, &mapped, &parent_ref)
                .map_err(|error| {
                    TransferError::unsupported(format!(
                        "cannot render foreign key '{}' on '{}': {error}",
                        foreign_key.name, source_table
                    ))
                })?;
            foreign_keys.push(DdlPreviewItem {
                source_table: source_table.clone(),
                target_table: target_table.clone(),
                ddl,
                kind: DdlPreviewKind::ForeignKey,
                depends_on: vec![foreign_key.referenced_table.clone()],
            });
        }
    }
    indexes.sort_by(|left, right| {
        left.target_table
            .cmp(&right.target_table)
            .then(left.ddl.cmp(&right.ddl))
    });
    foreign_keys.sort_by(|left, right| {
        left.target_table
            .cmp(&right.target_table)
            .then(left.ddl.cmp(&right.ddl))
    });
    statements.extend(indexes);
    statements.extend(foreign_keys);
    Ok(statements)
}
