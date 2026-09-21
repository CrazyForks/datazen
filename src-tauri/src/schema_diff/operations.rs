//! Dialect-neutral schema migration operations.

use super::types::{ColumnSnapshot, StatementRisk};
use crate::db::{CheckConstraint, ForeignKeyInfo, IndexInfo};
use datazen_driver_api::MigrationView;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MigrationOperation {
    CreateTable {
        table: String,
        columns: Vec<ColumnSnapshot>,
        primary_keys: Vec<String>,
    },
    /// Drop a target table as an explicit destructive operation. The deploy
    /// gate requires destructive approval and can never claim complete
    /// rollback because table data and dependent metadata are not recoverable
    /// from DDL alone.
    DropTable {
        table: String,
    },
    AddColumn {
        table: String,
        column: ColumnSnapshot,
    },
    DropColumn {
        table: String,
        column: ColumnSnapshot,
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
}

impl MigrationOperation {
    pub fn risk(&self) -> StatementRisk {
        match self {
            Self::DropTable { .. }
            | Self::DropColumn { .. }
            | Self::DropPrimaryKey { .. }
            | Self::DropIndex { .. }
            | Self::DropForeignKey { .. }
            | Self::DropCheckConstraint { .. }
            | Self::DropView { .. } => StatementRisk::Destructive,
            Self::AlterColumnType { .. }
            | Self::SetNullable {
                nullable: false, ..
            }
            | Self::SetAutoIncrement { .. }
            | Self::ReplaceView { .. } => StatementRisk::Rewrite,
            _ => StatementRisk::Additive,
        }
    }

    pub fn key(&self) -> String {
        match self {
            Self::CreateTable { table, .. }
            | Self::DropTable { table }
            | Self::AddPrimaryKey { table, .. }
            | Self::DropPrimaryKey { table, .. } => format!("table:{table}"),
            Self::AddColumn { table, column } | Self::DropColumn { table, column } => {
                format!("column:{table}.{}", column.name)
            }
            Self::AlterColumnType { table, column, .. }
            | Self::SetNullable { table, column, .. }
            | Self::SetDefault { table, column, .. }
            | Self::SetComment { table, column, .. }
            | Self::SetAutoIncrement { table, column, .. } => format!("column:{table}.{column}"),
            Self::CreateIndex { table, index } | Self::DropIndex { table, index } => {
                format!("index:{table}.{}", index.name)
            }
            Self::AddForeignKey { table, foreign_key }
            | Self::DropForeignKey { table, foreign_key } => {
                format!("foreign-key:{table}.{}", foreign_key.name)
            }
            Self::AddCheckConstraint { table, constraint }
            | Self::DropCheckConstraint { table, constraint } => {
                format!("check:{table}.{}", constraint.name)
            }
            Self::CreateView { view }
            | Self::ReplaceView { desired: view, .. }
            | Self::DropView { view } => view
                .schema
                .as_deref()
                .filter(|schema| !schema.is_empty())
                .map(|schema| format!("view:{schema}.{}", view.name))
                .unwrap_or_else(|| format!("view:{}", view.name)),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::IndexInfo;

    fn index(name: &str) -> IndexInfo {
        IndexInfo {
            name: name.into(),
            columns: vec!["id".into()],
            is_unique: false,
            is_primary: false,
            index_type: "btree".into(),
        }
    }

    #[test]
    fn destructive_operations_are_marked_destructive() {
        assert_eq!(
            MigrationOperation::DropTable {
                table: "archive".into(),
            }
            .risk(),
            StatementRisk::Destructive
        );
        assert_eq!(
            MigrationOperation::DropColumn {
                table: "t".into(),
                column: crate::schema_diff::types::ColumnSnapshot {
                    name: "x".into(),
                    data_type: "int".into(),
                    nullable: true,
                    default_value: None,
                    comment: None,
                    is_primary_key: false,
                    is_auto_increment: false
                }
            }
            .risk(),
            StatementRisk::Destructive
        );
        assert_eq!(
            MigrationOperation::DropIndex {
                table: "t".into(),
                index: index("old")
            }
            .risk(),
            StatementRisk::Destructive
        );
    }

    #[test]
    fn operation_key_is_stable() {
        let op = MigrationOperation::SetDefault {
            table: "t".into(),
            column: "status".into(),
            from: Some("1".into()),
            to: Some("0".into()),
        };
        assert_eq!(op.key(), "column:t.status");
        assert_eq!(
            MigrationOperation::DropTable {
                table: "audit.events".into(),
            }
            .key(),
            "table:audit.events"
        );
    }
}

impl MigrationOperation {
    pub fn to_driver_api(&self) -> datazen_driver_api::MigrationOperation {
        use datazen_driver_api::{MigrationColumn, MigrationOperation as O};
        let col = |c: &ColumnSnapshot| MigrationColumn {
            name: c.name.clone(),
            data_type: c.data_type.clone(),
            nullable: c.nullable,
            default_value: c.default_value.clone(),
            comment: c.comment.clone(),
            is_auto_increment: c.is_auto_increment,
        };
        match self {
            Self::DropTable { table } => O::DropTable {
                table: table.clone(),
            },
            Self::AddColumn { table, column } => O::AddColumn {
                table: table.clone(),
                column: col(column),
            },
            Self::DropColumn { table, column } => O::DropColumn {
                table: table.clone(),
                column: col(column),
            },
            Self::AlterColumnType {
                table,
                column,
                from,
                to,
            } => O::AlterColumnType {
                table: table.clone(),
                column: column.clone(),
                from: from.clone(),
                to: to.clone(),
            },
            Self::SetNullable {
                table,
                column,
                nullable,
            } => O::SetNullable {
                table: table.clone(),
                column: column.clone(),
                nullable: *nullable,
            },
            Self::SetDefault {
                table,
                column,
                from,
                to,
            } => O::SetDefault {
                table: table.clone(),
                column: column.clone(),
                from: from.clone(),
                to: to.clone(),
            },
            Self::SetComment {
                table,
                column,
                from,
                to,
            } => O::SetComment {
                table: table.clone(),
                column: column.clone(),
                from: from.clone(),
                to: to.clone(),
            },
            Self::SetAutoIncrement {
                table,
                column,
                from,
                to,
            } => O::SetAutoIncrement {
                table: table.clone(),
                column: column.clone(),
                from: *from,
                to: *to,
            },
            Self::AddPrimaryKey { table, columns } => O::AddPrimaryKey {
                table: table.clone(),
                columns: columns.clone(),
            },
            Self::DropPrimaryKey { table, columns } => O::DropPrimaryKey {
                table: table.clone(),
                columns: columns.clone(),
            },
            Self::CreateIndex { table, index } => O::CreateIndex {
                table: table.clone(),
                index: index.clone(),
            },
            Self::DropIndex { table, index } => O::DropIndex {
                table: table.clone(),
                index: index.clone(),
            },
            Self::AddForeignKey { table, foreign_key } => O::AddForeignKey {
                table: table.clone(),
                foreign_key: foreign_key.clone(),
            },
            Self::DropForeignKey { table, foreign_key } => O::DropForeignKey {
                table: table.clone(),
                foreign_key: foreign_key.clone(),
            },
            Self::AddCheckConstraint { table, constraint } => O::AddCheckConstraint {
                table: table.clone(),
                constraint: constraint.clone(),
            },
            Self::DropCheckConstraint { table, constraint } => O::DropCheckConstraint {
                table: table.clone(),
                constraint: constraint.clone(),
            },
            Self::CreateView { view } => O::CreateView { view: view.clone() },
            Self::ReplaceView { current, desired } => O::ReplaceView {
                current: current.clone(),
                desired: desired.clone(),
            },
            Self::DropView { view } => O::DropView { view: view.clone() },
            Self::CreateTable {
                table,
                columns,
                primary_keys,
            } => O::CreateTable {
                table: table.clone(),
                columns: columns.iter().map(col).collect(),
                primary_keys: primary_keys.clone(),
            },
        }
    }
}
