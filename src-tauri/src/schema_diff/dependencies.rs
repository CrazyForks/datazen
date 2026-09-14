//! Dependency ordering for migration operations.

use super::operations::MigrationOperation;

fn op_table(op: &MigrationOperation) -> &str {
    match op {
        MigrationOperation::CreateTable { table, .. }
        | MigrationOperation::AddColumn { table, .. }
        | MigrationOperation::DropColumn { table, .. }
        | MigrationOperation::AlterColumnType { table, .. }
        | MigrationOperation::SetNullable { table, .. }
        | MigrationOperation::SetDefault { table, .. }
        | MigrationOperation::SetComment { table, .. }
        | MigrationOperation::SetAutoIncrement { table, .. }
        | MigrationOperation::AddPrimaryKey { table, .. }
        | MigrationOperation::DropPrimaryKey { table, .. }
        | MigrationOperation::CreateIndex { table, .. }
        | MigrationOperation::DropIndex { table, .. } => table,
    }
}

/// A directed edge means `before` must complete before `after`.
fn precedes(before: &MigrationOperation, after: &MigrationOperation) -> bool {
    use MigrationOperation::*;
    if op_table(before) != op_table(after) {
        return false;
    }
    match (before, after) {
        (CreateTable { .. }, _) => true,
        (DropPrimaryKey { .. }, AddPrimaryKey { .. }) => true,
        (DropPrimaryKey { columns, .. }, SetNullable { column, nullable: true, .. }) => {
            columns.contains(column)
        }
        (DropIndex { index: old, .. }, CreateIndex { index: new, .. }) => old.name == new.name,
        (DropPrimaryKey { columns, .. }, DropColumn { .. } | AlterColumnType { .. }) => match after
        {
            DropColumn { column, .. } => columns.contains(&column.name),
            AlterColumnType { column, .. } => columns.contains(column),
            _ => false,
        },
        (DropIndex { index, .. }, DropColumn { column, .. }) => {
            index.columns.contains(&column.name)
        }
        (DropIndex { index, .. }, AlterColumnType { column, .. }) => index.columns.contains(column),
        (AddColumn { column, .. }, AddPrimaryKey { columns, .. }) => columns.contains(&column.name),
        (AddColumn { column, .. }, CreateIndex { index, .. }) => {
            index.columns.contains(&column.name)
        }
        (
            AlterColumnType { column, .. } | SetNullable { column, .. },
            AddPrimaryKey { columns, .. },
        ) => columns.contains(column),
        (AlterColumnType { column, .. }, CreateIndex { index, .. }) => {
            index.columns.contains(column)
        }
        _ => false,
    }
}

/// Removing a prerequisite also removes its dependents. Replacements are indivisible
/// for selection, while their execution edges remain directional.
pub fn retain_dependency_closed(
    all: &[MigrationOperation],
    selected: &mut Vec<MigrationOperation>,
) {
    loop {
        let previous = selected.clone();
        selected.retain(|op| all.iter().all(|dependency| {
            let replacement = matches!((op, dependency),
                (MigrationOperation::DropPrimaryKey { .. }, MigrationOperation::AddPrimaryKey { .. }))
                && op_table(op) == op_table(dependency)
                || matches!((op, dependency),
                    (MigrationOperation::DropIndex { index: a, .. }, MigrationOperation::CreateIndex { index: b, .. }) if a.name == b.name && op_table(op) == op_table(dependency));
            !(precedes(dependency, op) || replacement) || previous.iter().any(|present| std::mem::discriminant(present) == std::mem::discriminant(dependency) && present.key() == dependency.key())
        }));
        if selected.len() == previous.len() {
            break;
        }
    }
}

pub fn resolve_dependencies(mut ops: Vec<MigrationOperation>) -> Vec<MigrationOperation> {
    let mut ordered = Vec::with_capacity(ops.len());
    while !ops.is_empty() {
        let candidate = (0..ops.len())
            .filter(|&i| !(0..ops.len()).any(|j| j != i && precedes(&ops[j], &ops[i])))
            .min_by_key(|&i| {
                (
                    op_table(&ops[i]).to_owned(),
                    priority(&ops[i]),
                    ops[i].key(),
                )
            });
        let Some(index) = candidate else {
            return Vec::new();
        }; // Fail closed on a cyclic graph.
        ordered.push(ops.remove(index));
    }
    ordered
}

fn priority(op: &MigrationOperation) -> u8 {
    use MigrationOperation::*;
    match op {
        CreateTable { .. } => 0,
        AddColumn { .. } | AddPrimaryKey { .. } => 1,
        CreateIndex { .. } => 3,
        DropColumn { .. } | DropIndex { .. } | DropPrimaryKey { .. } => 4,
        _ => 2,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::schema_diff::operations::MigrationOperation;

    #[test]
    fn ordering_places_create_before_index_and_drop() {
        let ops = vec![
            MigrationOperation::DropColumn {
                table: "t".into(),
                column: crate::schema_diff::types::ColumnSnapshot {
                    name: "old".into(),
                    data_type: "int".into(),
                    nullable: true,
                    default_value: None,
                    comment: None,
                    is_primary_key: false,
                    is_auto_increment: false,
                },
            },
            MigrationOperation::CreateIndex {
                table: "t".into(),
                index: crate::db::IndexInfo {
                    name: "idx".into(),
                    columns: vec!["id".into()],
                    is_unique: false,
                    is_primary: false,
                    index_type: "btree".into(),
                },
            },
            MigrationOperation::AddColumn {
                table: "t".into(),
                column: crate::schema_diff::types::ColumnSnapshot {
                    name: "new".into(),
                    data_type: "int".into(),
                    nullable: true,
                    default_value: None,
                    comment: None,
                    is_primary_key: false,
                    is_auto_increment: false,
                },
            },
        ];
        let sorted = resolve_dependencies(ops);
        assert!(matches!(sorted[0], MigrationOperation::AddColumn { .. }));
        assert!(matches!(sorted[1], MigrationOperation::CreateIndex { .. }));
        assert!(matches!(sorted[2], MigrationOperation::DropColumn { .. }));
    }

    pub(super) fn snap(name: &str) -> crate::schema_diff::types::ColumnSnapshot {
        crate::schema_diff::types::ColumnSnapshot {
            name: name.into(),
            data_type: "int".into(),
            nullable: true,
            default_value: None,
            comment: None,
            is_primary_key: false,
            is_auto_increment: false,
        }
    }

    #[test]
    fn same_bucket_ops_are_sorted_by_table_and_key() {
        let ops = vec![
            MigrationOperation::SetDefault {
                table: "b".into(),
                column: "z".into(),
                from: None,
                to: Some("1".into()),
            },
            MigrationOperation::SetDefault {
                table: "a".into(),
                column: "y".into(),
                from: None,
                to: Some("0".into()),
            },
            MigrationOperation::SetDefault {
                table: "a".into(),
                column: "x".into(),
                from: None,
                to: Some("0".into()),
            },
        ];
        let sorted = resolve_dependencies(ops.clone());
        let again = resolve_dependencies(ops);
        assert_eq!(sorted, again);
        assert!(
            matches!(&sorted[0], MigrationOperation::SetDefault { table, column, .. } if table == "a" && column == "x")
        );
        assert!(
            matches!(&sorted[1], MigrationOperation::SetDefault { table, column, .. } if table == "a" && column == "y")
        );
        assert!(
            matches!(&sorted[2], MigrationOperation::SetDefault { table, column, .. } if table == "b" && column == "z")
        );
    }

    #[test]
    fn drop_bucket_sorts_deterministically() {
        let ops = vec![
            MigrationOperation::DropColumn {
                table: "t".into(),
                column: snap("z"),
            },
            MigrationOperation::DropColumn {
                table: "t".into(),
                column: snap("a"),
            },
        ];
        let sorted = resolve_dependencies(ops);
        assert!(
            matches!(&sorted[0], MigrationOperation::DropColumn { column, .. } if column.name == "a")
        );
        assert!(
            matches!(&sorted[1], MigrationOperation::DropColumn { column, .. } if column.name == "z")
        );
    }
}

#[cfg(test)]
mod replacement_tests {
    use super::*;
    use crate::db::IndexInfo;
    fn pk(add: bool) -> MigrationOperation {
        if add {
            MigrationOperation::AddPrimaryKey {
                table: "t".into(),
                columns: vec!["new".into()],
            }
        } else {
            MigrationOperation::DropPrimaryKey {
                table: "t".into(),
                columns: vec!["old".into()],
            }
        }
    }
    fn idx(create: bool) -> MigrationOperation {
        let index = IndexInfo {
            name: "same_name".into(),
            columns: vec![if create { "new".into() } else { "old".into() }],
            is_unique: create,
            is_primary: false,
            index_type: "btree".into(),
        };
        if create {
            MigrationOperation::CreateIndex {
                table: "t".into(),
                index,
            }
        } else {
            MigrationOperation::DropIndex {
                table: "t".into(),
                index,
            }
        }
    }
    #[test]
    fn replacement_order_is_drop_before_create_regardless_of_input() {
        for (add, drop) in [(pk(true), pk(false)), (idx(true), idx(false))] {
            assert_eq!(
                resolve_dependencies(vec![add.clone(), drop.clone()]),
                vec![drop.clone(), add.clone()]
            );
            assert_eq!(
                resolve_dependencies(vec![drop.clone(), add.clone()]),
                vec![drop, add]
            );
        }
    }
    #[test]
    fn replacing_key_relaxes_old_column_and_tightens_new_without_cycles() {
        let relax = MigrationOperation::SetNullable {
            table: "t".into(), column: "old".into(), nullable: true,
        };
        let tighten = MigrationOperation::SetNullable {
            table: "t".into(), column: "new".into(), nullable: false,
        };
        let unrelated = MigrationOperation::SetNullable {
            table: "t".into(), column: "other".into(), nullable: true,
        };
        let all = vec![pk(true), relax.clone(), tighten.clone(), unrelated.clone(), pk(false)];
        let sorted = resolve_dependencies(all.clone());
        assert_eq!(sorted.len(), all.len());
        let position = |op: &MigrationOperation| sorted.iter().position(|item| item == op).unwrap();
        assert!(position(&pk(false)) < position(&relax));
        assert!(position(&pk(false)) < position(&pk(true)));
        assert!(position(&tighten) < position(&pk(true)));
        let mut selected = vec![relax, tighten.clone(), unrelated.clone(), pk(true)];
        retain_dependency_closed(&all, &mut selected);
        assert_eq!(selected, vec![tighten, unrelated]);
    }

    #[test]
    fn filtering_either_half_removes_the_entire_replacement() {
        for all in [vec![pk(true), pk(false)], vec![idx(true), idx(false)]] {
            for half in &all {
                let mut selected = vec![half.clone()];
                retain_dependency_closed(&all, &mut selected);
                assert!(selected.is_empty());
            }
        }
    }
    #[test]
    fn column_drop_requires_removing_its_index_and_key() {
        let column = super::tests::snap("old");
        let drop = MigrationOperation::DropColumn {
            table: "t".into(),
            column,
        };
        let all = vec![drop.clone(), pk(false), idx(false)];
        let sorted = resolve_dependencies(all.clone());
        assert_eq!(sorted.last(), Some(&drop));
        let mut selected = vec![drop];
        retain_dependency_closed(&all, &mut selected);
        assert!(selected.is_empty());
    }
}
