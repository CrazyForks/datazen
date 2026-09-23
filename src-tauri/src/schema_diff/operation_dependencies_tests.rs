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
    let sorted = resolve_dependencies(ops.clone());
    let add = sorted
        .iter()
        .position(|operation| matches!(operation, MigrationOperation::AddColumn { .. }))
        .unwrap();
    let index = sorted
        .iter()
        .position(|operation| matches!(operation, MigrationOperation::CreateIndex { .. }))
        .unwrap();
    assert!(add < index);
    assert_eq!(
        sorted,
        resolve_dependencies(ops.into_iter().rev().collect())
    );
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

#[test]
fn sequence_operations_have_deterministic_create_replace_drop_order() {
    let make = |name: &str| {
        datazen_driver_api::MigrationSequence {
            schema: Some("public".into()),
            name: name.into(),
            definition: format!(
                "CREATE SEQUENCE \"public\".\"{name}\" AS bigint INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1 NO CYCLE;"
            ),
        }
    };
    let create = MigrationOperation::CreateSequence {
        sequence: make("s"),
    };
    let replace = MigrationOperation::ReplaceSequence {
        current: make("s"),
        desired: make("s"),
    };
    let drop = MigrationOperation::DropSequence {
        sequence: make("s"),
    };
    let sorted = resolve_dependencies(vec![drop.clone(), create.clone(), replace.clone()]);
    assert_eq!(sorted, vec![create, replace, drop]);
}
