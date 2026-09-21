use datazen_driver_api::*;

fn format_mysql_column_def(c: &MigrationColumn, qi: &impl Fn(&str) -> String) -> String {
    let mut def = format!(
        "{} {}{}",
        qi(&c.name),
        c.data_type,
        if c.nullable { "" } else { " NOT NULL" }
    );
    if let Some(default) = &c.default_value {
        def.push_str(&format!(" DEFAULT {default}"));
    }
    if c.is_auto_increment {
        def.push_str(" AUTO_INCREMENT");
    }
    if let Some(comment) = &c.comment {
        if !comment.is_empty() {
            def.push_str(&format!(" COMMENT '{}'", comment.replace('\'', "''")));
        }
    }
    def
}

fn format_mysql_index_col(s: &str, qi: &impl Fn(&str) -> String) -> String {
    let trimmed = s.trim();
    if let Some(paren_pos) = trimmed.find('(') {
        if trimmed.ends_with(')') {
            let col = trimmed[..paren_pos].trim().trim_matches('`');
            let len_part = &trimmed[paren_pos..];
            return format!("{}{}", qi(col), len_part);
        }
    }
    qi(trimmed)
}

fn mysql_fk_action(raw: &str, clause: &str) -> Result<String, String> {
    let action = raw.trim().to_ascii_uppercase();
    if action.is_empty() || action == "NO ACTION" {
        return Ok(String::new());
    }
    if matches!(
        action.as_str(),
        "CASCADE" | "RESTRICT" | "SET NULL" | "SET DEFAULT"
    ) {
        return Ok(format!(" {clause} {action}"));
    }
    Err(format!("MySQL cannot represent foreign-key action '{raw}'"))
}

fn mysql_view_ident(view: &MigrationView) -> String {
    let quote = |value: &str| format!("`{}`", value.replace('`', "``"));
    match view.schema.as_deref().filter(|schema| !schema.is_empty()) {
        Some(schema) => format!("{}.{}", quote(schema), quote(&view.name)),
        None => quote(&view.name),
    }
}

pub struct MysqlMigrationRenderer;

impl MigrationRenderer for MysqlMigrationRenderer {
    fn render(&self, op: &MigrationOperation) -> Result<MigrationStatement, String> {
        let qi = |s: &str| {
            if s.contains('.') {
                s.split('.')
                    .map(|part| format!("`{}`", part.replace('`', "``")))
                    .collect::<Vec<_>>()
                    .join(".")
            } else {
                format!("`{}`", s.replace('`', "``"))
            }
        };
        match op {
            MigrationOperation::CreateTable {
                table,
                columns,
                primary_keys,
            } => {
                let cols = columns
                    .iter()
                    .map(|c| format_mysql_column_def(c, &qi))
                    .collect::<Vec<_>>();
                let pk = if primary_keys.is_empty() {
                    String::new()
                } else {
                    format!(
                        ", PRIMARY KEY ({})",
                        primary_keys
                            .iter()
                            .map(|c| qi(c))
                            .collect::<Vec<_>>()
                            .join(", ")
                    )
                };
                Ok(MigrationStatement {
                    sql: format!("CREATE TABLE {} ({}{})", qi(table), cols.join(", "), pk),
                    risk: MigrationRisk::Additive,
                    rollback_sql: Some(format!("DROP TABLE {}", qi(table))),
                    summary: format!("CREATE TABLE {}", table),
                })
            }
            MigrationOperation::DropTable { table } => Ok(MigrationStatement {
                sql: format!("DROP TABLE {}", qi(table)),
                risk: MigrationRisk::Destructive,
                rollback_sql: None,
                summary: format!("DROP TABLE {}", table),
            }),

            MigrationOperation::AddColumn { table, column } => Ok(MigrationStatement {
                sql: format!(
                    "ALTER TABLE {} ADD COLUMN {}",
                    qi(table),
                    format_mysql_column_def(column, &qi)
                ),
                risk: MigrationRisk::Additive,
                rollback_sql: Some(format!(
                    "ALTER TABLE {} DROP COLUMN {}",
                    qi(table),
                    qi(&column.name)
                )),
                summary: format!("ADD COLUMN {}.{}", table, column.name),
            }),
            MigrationOperation::DropColumn { table, column } => Ok(MigrationStatement {
                sql: format!("ALTER TABLE {} DROP COLUMN {}", qi(table), qi(&column.name)),
                risk: MigrationRisk::Destructive,
                rollback_sql: None,
                summary: format!("DROP COLUMN {}.{}", table, column.name),
            }),
            MigrationOperation::SetDefault {
                table,
                column,
                from,
                to,
            } => {
                let sql = match to {
                    Some(v) => format!(
                        "ALTER TABLE {} ALTER COLUMN {} SET DEFAULT {}",
                        qi(table),
                        qi(column),
                        v
                    ),
                    None => format!(
                        "ALTER TABLE {} ALTER COLUMN {} DROP DEFAULT",
                        qi(table),
                        qi(column)
                    ),
                };
                let rollback_sql = match from {
                    Some(v) => Some(format!(
                        "ALTER TABLE {} ALTER COLUMN {} SET DEFAULT {}",
                        qi(table),
                        qi(column),
                        v
                    )),
                    None => Some(format!(
                        "ALTER TABLE {} ALTER COLUMN {} DROP DEFAULT",
                        qi(table),
                        qi(column)
                    )),
                };
                Ok(MigrationStatement {
                    sql,
                    risk: MigrationRisk::Additive,
                    rollback_sql,
                    summary: format!("ALTER DEFAULT {}.{}", table, column),
                })
            }
            MigrationOperation::CreateIndex { table, index } => Ok(MigrationStatement {
                sql: format!(
                    "CREATE {}INDEX {} ON {} ({})",
                    if index.is_unique { "UNIQUE " } else { "" },
                    qi(&index.name),
                    qi(table),
                    index
                        .columns
                        .iter()
                        .map(|c| format_mysql_index_col(c, &qi))
                        .collect::<Vec<_>>()
                        .join(", ")
                ),
                risk: MigrationRisk::Additive,
                rollback_sql: Some(format!("DROP INDEX {} ON {}", qi(&index.name), qi(table))),
                summary: format!("CREATE INDEX {}.{}", table, index.name),
            }),
            MigrationOperation::DropIndex { table, index } => Ok(MigrationStatement {
                sql: format!("DROP INDEX {} ON {}", qi(&index.name), qi(table)),
                risk: MigrationRisk::Destructive,
                rollback_sql: None,
                summary: format!("DROP INDEX {}.{}", table, index.name),
            }),
            MigrationOperation::AlterColumnType {
                table, column, to, ..
            } => Ok(MigrationStatement {
                sql: format!(
                    "ALTER TABLE {} MODIFY COLUMN {} {}",
                    qi(table),
                    qi(column),
                    to
                ),
                risk: MigrationRisk::Rewrite,
                rollback_sql: None,
                summary: format!("ALTER TYPE {}.{}", table, column),
            }),
            MigrationOperation::SetNullable { .. } => Err(
                "MySQL nullability change requires the complete original column definition".into(),
            ),
            MigrationOperation::SetComment {
                table, column, to, ..
            } => Ok(MigrationStatement {
                sql: format!(
                    "ALTER TABLE {} MODIFY COLUMN {} COMMENT {}",
                    qi(table),
                    qi(column),
                    to.as_deref()
                        .map(|v| format!("'{}'", v.replace('\'', "''")))
                        .unwrap_or_else(|| "''".into())
                ),
                risk: MigrationRisk::Rewrite,
                rollback_sql: None,
                summary: format!("ALTER COMMENT {}.{}", table, column),
            }),
            MigrationOperation::SetAutoIncrement {
                table, column, to, ..
            } => Ok(MigrationStatement {
                sql: if *to {
                    format!(
                        "ALTER TABLE {} MODIFY COLUMN {} INT AUTO_INCREMENT",
                        qi(table),
                        qi(column)
                    )
                } else {
                    return Err(
                        "MySQL auto-increment removal requires original column definition".into(),
                    );
                },
                risk: MigrationRisk::Rewrite,
                rollback_sql: None,
                summary: format!("ALTER AUTO_INCREMENT {}.{}", table, column),
            }),
            MigrationOperation::AddPrimaryKey { table, columns } => Ok(MigrationStatement {
                sql: format!(
                    "ALTER TABLE {} ADD PRIMARY KEY ({})",
                    qi(table),
                    columns.iter().map(|c| qi(c)).collect::<Vec<_>>().join(", ")
                ),
                risk: MigrationRisk::Additive,
                rollback_sql: Some(format!("ALTER TABLE {} DROP PRIMARY KEY", qi(table))),
                summary: format!("ADD PRIMARY KEY {}", table),
            }),
            MigrationOperation::DropPrimaryKey { table, .. } => Ok(MigrationStatement {
                sql: format!("ALTER TABLE {} DROP PRIMARY KEY", qi(table)),
                risk: MigrationRisk::Destructive,
                rollback_sql: None,
                summary: format!("DROP PRIMARY KEY {}", table),
            }),
            MigrationOperation::AddForeignKey { table, foreign_key } => {
                if foreign_key.name.trim().is_empty()
                    || foreign_key.columns.is_empty()
                    || foreign_key.columns.len() != foreign_key.referenced_columns.len()
                {
                    return Err("foreign key must have a name and matching column lists".into());
                }
                let on_update = mysql_fk_action(&foreign_key.on_update, "ON UPDATE")?;
                let on_delete = mysql_fk_action(&foreign_key.on_delete, "ON DELETE")?;
                Ok(MigrationStatement {
                    sql: format!(
                        "ALTER TABLE {} ADD CONSTRAINT {} FOREIGN KEY ({}) REFERENCES {} ({}){}{}",
                        qi(table),
                        qi(&foreign_key.name),
                        foreign_key
                            .columns
                            .iter()
                            .map(|column| qi(column))
                            .collect::<Vec<_>>()
                            .join(", "),
                        qi(&foreign_key.referenced_table),
                        foreign_key
                            .referenced_columns
                            .iter()
                            .map(|column| qi(column))
                            .collect::<Vec<_>>()
                            .join(", "),
                        on_update,
                        on_delete,
                    ),
                    risk: MigrationRisk::Additive,
                    rollback_sql: Some(format!(
                        "ALTER TABLE {} DROP FOREIGN KEY {}",
                        qi(table),
                        qi(&foreign_key.name)
                    )),
                    summary: format!("ADD FOREIGN KEY {}.{}", table, foreign_key.name),
                })
            }
            MigrationOperation::DropForeignKey { table, foreign_key } => Ok(MigrationStatement {
                sql: format!(
                    "ALTER TABLE {} DROP FOREIGN KEY {}",
                    qi(table),
                    qi(&foreign_key.name)
                ),
                risk: MigrationRisk::Destructive,
                rollback_sql: None,
                summary: format!("DROP FOREIGN KEY {}.{}", table, foreign_key.name),
            }),
            MigrationOperation::CreateView { view } => {
                validate_view_definition(&view.definition)?;
                let ident = mysql_view_ident(view);
                Ok(MigrationStatement {
                    sql: format!("CREATE VIEW {ident} AS {}", view.definition.trim()),
                    risk: MigrationRisk::Additive,
                    rollback_sql: Some(format!("DROP VIEW {ident}")),
                    summary: format!("CREATE VIEW {}", view.name),
                })
            }
            MigrationOperation::ReplaceView { current, desired } => {
                validate_view_definition(&desired.definition)?;
                validate_view_definition(&current.definition)?;
                let ident = mysql_view_ident(desired);
                Ok(MigrationStatement {
                    sql: format!(
                        "CREATE OR REPLACE VIEW {ident} AS {}",
                        desired.definition.trim()
                    ),
                    risk: MigrationRisk::Rewrite,
                    rollback_sql: Some(format!(
                        "CREATE OR REPLACE VIEW {ident} AS {}",
                        current.definition.trim()
                    )),
                    summary: format!("REPLACE VIEW {}", desired.name),
                })
            }
            MigrationOperation::DropView { view } => {
                validate_view_definition(&view.definition)?;
                let ident = mysql_view_ident(view);
                Ok(MigrationStatement {
                    sql: format!("DROP VIEW {ident}"),
                    risk: MigrationRisk::Destructive,
                    rollback_sql: Some(format!(
                        "CREATE VIEW {ident} AS {}",
                        view.definition.trim()
                    )),
                    summary: format!("DROP VIEW {}", view.name),
                })
            }
        }
    }
}

pub struct MysqlMigrationCapabilities;
impl MigrationCapabilities for MysqlMigrationCapabilities {
    fn supports(&self, operation: &MigrationOperation) -> bool {
        match operation {
            MigrationOperation::SetNullable { .. } => false,
            MigrationOperation::SetAutoIncrement { to, .. } if !*to => false,
            MigrationOperation::CreateTable { .. }
            | MigrationOperation::DropTable { .. }
            | MigrationOperation::AddColumn { .. }
            | MigrationOperation::DropColumn { .. }
            | MigrationOperation::AlterColumnType { .. }
            | MigrationOperation::SetDefault { .. }
            | MigrationOperation::SetComment { .. }
            | MigrationOperation::SetAutoIncrement { .. }
            | MigrationOperation::AddPrimaryKey { .. }
            | MigrationOperation::DropPrimaryKey { .. }
            | MigrationOperation::CreateIndex { .. }
            | MigrationOperation::DropIndex { .. }
            | MigrationOperation::AddForeignKey { .. }
            | MigrationOperation::DropForeignKey { .. }
            | MigrationOperation::CreateView { .. }
            | MigrationOperation::ReplaceView { .. }
            | MigrationOperation::DropView { .. } => true,
        }
    }
    fn requires_table_rebuild(&self, operation: &MigrationOperation) -> bool {
        matches!(
            operation,
            MigrationOperation::SetAutoIncrement { .. }
                | MigrationOperation::AlterColumnType { .. }
                | MigrationOperation::SetComment { .. }
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn col(name: &str, ty: &str) -> MigrationColumn {
        MigrationColumn {
            name: name.into(),
            data_type: ty.into(),
            nullable: true,
            default_value: None,
            comment: None,
            is_auto_increment: false,
        }
    }

    #[test]
    fn renderer_quotes_identifiers() {
        let s = MysqlMigrationRenderer
            .render(&MigrationOperation::AddColumn {
                table: "user`s".into(),
                column: col("na`me", "VARCHAR(32)"),
            })
            .unwrap();
        assert!(s.sql.contains("`user``s`"));
        assert!(s.sql.contains("`na``me`"));
    }

    #[test]
    fn renderer_rejects_unsafe_nullable_change() {
        let op = MigrationOperation::SetNullable {
            table: "users".into(),
            column: "name".into(),
            nullable: false,
        };
        assert!(!MysqlMigrationCapabilities.supports(&op));
        assert!(MysqlMigrationRenderer.render(&op).is_err());
    }

    #[test]
    fn create_table_renders_default_comment_and_auto_increment() {
        let op = MigrationOperation::CreateTable {
            table: "users".into(),
            columns: vec![MigrationColumn {
                name: "id".into(),
                data_type: "INT".into(),
                nullable: false,
                default_value: None,
                comment: Some("primary id".into()),
                is_auto_increment: true,
            }],
            primary_keys: vec!["id".into()],
        };
        let stmt = MysqlMigrationRenderer.render(&op).unwrap();
        assert!(stmt.sql.contains("AUTO_INCREMENT"));
        assert!(stmt.sql.contains("COMMENT 'primary id'"));
    }

    #[test]
    fn add_column_renders_metadata() {
        let op = MigrationOperation::AddColumn {
            table: "users".into(),
            column: MigrationColumn {
                name: "score".into(),
                data_type: "INT".into(),
                nullable: false,
                default_value: Some("0".into()),
                comment: Some("score".into()),
                is_auto_increment: false,
            },
        };
        let stmt = MysqlMigrationRenderer.render(&op).unwrap();
        assert!(stmt.sql.contains("DEFAULT 0"));
        assert!(stmt.sql.contains("COMMENT 'score'"));
    }

    #[test]
    fn add_primary_key_provides_rollback() {
        let op = MigrationOperation::AddPrimaryKey {
            table: "users".into(),
            columns: vec!["id".into()],
        };
        let stmt = MysqlMigrationRenderer.render(&op).unwrap();
        assert_eq!(
            stmt.rollback_sql.as_deref(),
            Some("ALTER TABLE `users` DROP PRIMARY KEY")
        );
    }

    #[test]
    fn drop_primary_key_renders() {
        let op = MigrationOperation::DropPrimaryKey {
            table: "users".into(),
            columns: vec!["id".into()],
        };
        let stmt = MysqlMigrationRenderer.render(&op).unwrap();
        assert_eq!(stmt.sql, "ALTER TABLE `users` DROP PRIMARY KEY");
        assert!(MysqlMigrationCapabilities.supports(&op));
    }

    #[test]
    fn drop_table_is_quoted_destructive_and_has_no_rollback() {
        let stmt = MysqlMigrationRenderer
            .render(&MigrationOperation::DropTable {
                table: "archive.events".into(),
            })
            .unwrap();
        assert_eq!(stmt.sql, "DROP TABLE `archive`.`events`");
        assert_eq!(stmt.risk, MigrationRisk::Destructive);
        assert!(stmt.rollback_sql.is_none());
        assert!(
            MysqlMigrationCapabilities.supports(&MigrationOperation::DropTable {
                table: "archive.events".into(),
            })
        );
        assert!(!stmt.sql.contains("CASCADE"));
    }

    #[test]
    fn capabilities_mark_type_change_as_rewrite() {
        let op = MigrationOperation::AlterColumnType {
            table: "users".into(),
            column: "id".into(),
            from: "INT".into(),
            to: "BIGINT".into(),
        };
        assert!(MysqlMigrationCapabilities.supports(&op));
        assert!(MysqlMigrationCapabilities.requires_table_rebuild(&op));
    }

    #[test]
    fn create_index_renders_prefix_length_properly() {
        let op = MigrationOperation::CreateIndex {
            table: "demo_customers".into(),
            index: IndexInfo {
                name: "idx_demo_customers_region".into(),
                columns: vec!["region(255)".into()],
                is_unique: false,
                is_primary: false,
                index_type: "BTREE".into(),
            },
        };
        let stmt = MysqlMigrationRenderer.render(&op).unwrap();
        assert_eq!(
            stmt.sql,
            "CREATE INDEX `idx_demo_customers_region` ON `demo_customers` (`region`(255))"
        );

        let unique_op = MigrationOperation::CreateIndex {
            table: "demo_customers".into(),
            index: IndexInfo {
                name: "uq_demo_customers_name".into(),
                columns: vec!["name(255)".into()],
                is_unique: true,
                is_primary: false,
                index_type: "BTREE".into(),
            },
        };
        let unique_stmt = MysqlMigrationRenderer.render(&unique_op).unwrap();
        assert_eq!(
            unique_stmt.sql,
            "CREATE UNIQUE INDEX `uq_demo_customers_name` ON `demo_customers` (`name`(255))"
        );
    }

    #[test]
    fn renders_foreign_key_with_actions_and_rollback() {
        let op = MigrationOperation::AddForeignKey {
            table: "orders".into(),
            foreign_key: ForeignKeyInfo {
                name: "orders_user_id_fk".into(),
                columns: vec!["user_id".into()],
                referenced_table: "users".into(),
                referenced_columns: vec!["id".into()],
                on_update: "CASCADE".into(),
                on_delete: "RESTRICT".into(),
            },
        };
        let stmt = MysqlMigrationRenderer.render(&op).unwrap();
        assert_eq!(
            stmt.sql,
            "ALTER TABLE `orders` ADD CONSTRAINT `orders_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON UPDATE CASCADE ON DELETE RESTRICT"
        );
        assert_eq!(
            stmt.rollback_sql.as_deref(),
            Some("ALTER TABLE `orders` DROP FOREIGN KEY `orders_user_id_fk`")
        );
        assert!(MysqlMigrationCapabilities.supports(&op));
    }

    #[test]
    fn renders_qualified_view_with_mysql_identifier_quoting() {
        let view = MigrationView {
            schema: Some("reporting`archive".into()),
            name: "active`users".into(),
            definition: "SELECT id FROM users".into(),
        };
        let stmt = MysqlMigrationRenderer
            .render(&MigrationOperation::CreateView { view: view.clone() })
            .unwrap();
        assert_eq!(
            stmt.sql,
            "CREATE VIEW `reporting``archive`.`active``users` AS SELECT id FROM users"
        );
        assert_eq!(
            stmt.rollback_sql.as_deref(),
            Some("DROP VIEW `reporting``archive`.`active``users`")
        );
        let replacement = MysqlMigrationRenderer
            .render(&MigrationOperation::ReplaceView {
                current: view.clone(),
                desired: MigrationView {
                    definition: "SELECT id, email FROM users".into(),
                    ..view
                },
            })
            .unwrap();
        assert!(replacement.sql.starts_with("CREATE OR REPLACE VIEW"));
        assert!(replacement.rollback_sql.is_some());
    }
}
