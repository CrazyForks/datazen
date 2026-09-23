use super::*;
use crate::db::{ColumnSchema, ForeignKeyDeferrability, ForeignKeyInfo, IndexInfo};

fn col(name: &str, ty: &str) -> ColumnSchema {
    ColumnSchema {
        name: name.into(),
        data_type: ty.into(),
        nullable: true,
        default_value: None,
        comment: None,
        is_primary_key: false,
        is_auto_increment: false,
    }
}

fn schema(cols: Vec<ColumnSchema>) -> TableSchema {
    TableSchema {
        table_name: "users".into(),
        columns: cols,
        primary_keys: vec![],
        indexes: vec![],
        foreign_keys: vec![],
        check_constraints: vec![],
        table_options: Default::default(),
    }
}

#[test]
fn pg_to_mysql_strips_schema_prefix_in_ddl() {
    let src = schema(vec![col("id", "int"), col("email", "text")]);
    let tgt = schema(vec![col("id", "int")]);
    let plan = build_schema_diff_plan(
        &[("public.users".into(), src, tgt)],
        "postgresql",
        "mysql",
        PlanOptions {
            allow_destructive: false,
            include_indexes: false,
            type_mapper: None,
            cross_dialect: false,
        },
    );
    let add = plan
        .statements
        .iter()
        .find(|s| s.sql.contains("email"))
        .expect("ADD COLUMN for email");
    assert!(add.sql.contains("`users`"));
    assert!(!add.sql.contains("public."));
}

#[test]
fn cross_dialect_check_constraints_are_blocked_without_expression_translation() {
    let mut src = schema(vec![col("age", "integer")]);
    src.check_constraints.push(crate::db::CheckConstraint {
        name: "users_age_check".into(),
        expression: "age >= 0".into(),
    });
    let tgt = schema(vec![col("age", "integer")]);
    let plan = build_schema_diff_plan(
        &[("users".into(), src, tgt)],
        "postgresql",
        "mysql",
        PlanOptions {
            allow_destructive: true,
            include_indexes: true,
            type_mapper: None,
            cross_dialect: false,
        },
    );
    assert!(plan.statements.is_empty());
    assert!(plan.requirements.iter().any(|requirement| matches!(
        requirement,
        PlanRequirement::Unsupported { operation, reason }
            if operation.contains("users_age_check") && reason.contains("dialect-specific")
    )));
}

#[test]
fn missing_target_table_plans_create_not_add_column() {
    let mut src = schema(vec![col("id", "int"), col("email", "varchar(255)")]);
    src.primary_keys = vec!["id".into()];
    let tgt = schema(vec![]);
    let plan = build_column_plan("public.users", &src, &tgt, "postgresql").unwrap();
    assert!(plan
        .statements
        .iter()
        .any(|s| s.sql.contains("CREATE TABLE") && s.sql.contains("email")));
    assert!(!plan.statements.iter().any(|s| s.sql.contains("ADD COLUMN")));
    assert!(!plan
        .statements
        .iter()
        .any(|s| s.sql.contains("ADD PRIMARY KEY")));

    let mysql_plan = build_column_plan("users", &src, &tgt, "mysql").unwrap();
    assert!(mysql_plan
        .statements
        .iter()
        .any(|s| s.sql.contains("CREATE TABLE") && s.sql.contains("PRIMARY KEY (`id`)")));
    assert!(!mysql_plan
        .statements
        .iter()
        .any(|s| s.sql.contains("ADD PRIMARY KEY")));
}

#[test]
fn target_only_table_is_blocked_without_destructive_approval() {
    let src = schema(vec![]);
    let tgt = schema(vec![col("id", "integer")]);
    let plan = build_schema_diff_plan(
        &[("archive".into(), src, tgt)],
        "postgresql",
        "postgresql",
        PlanOptions {
            allow_destructive: false,
            include_indexes: true,
            type_mapper: None,
            cross_dialect: false,
        },
    );

    assert!(plan.statements.is_empty());
    assert!(plan
        .warnings
        .iter()
        .any(|warning| warning.contains("table:archive")));
}

#[test]
fn approved_target_only_table_has_no_rollback_and_requires_review() {
    let src = schema(vec![]);
    let tgt = schema(vec![col("id", "integer")]);
    let plan = build_schema_diff_plan(
        &[("audit.events".into(), src, tgt)],
        "postgresql",
        "postgresql",
        PlanOptions {
            allow_destructive: true,
            include_indexes: true,
            type_mapper: None,
            cross_dialect: false,
        },
    );

    assert_eq!(plan.statements.len(), 1);
    let statement = &plan.statements[0];
    assert_eq!(statement.sql, "DROP TABLE \"audit\".\"events\"");
    assert_eq!(statement.risk, StatementRisk::Destructive);
    assert!(statement.rollback_sql.is_none());
    assert!(!plan.rollback_completeness.complete);
    assert!(plan.rollback_completeness.missing[0].contains("DROP TABLE"));
}

#[test]
fn test_tester_target_only_empty_identifier_is_not_executable() {
    let src = schema(vec![]);
    let tgt = schema(vec![col("id", "integer")]);
    let plan = build_schema_diff_plan(
        &[(String::new(), src, tgt)],
        "postgresql",
        "postgresql",
        PlanOptions {
            allow_destructive: true,
            include_indexes: true,
            type_mapper: None,
            cross_dialect: false,
        },
    );

    assert!(plan.statements.is_empty());
    assert!(plan.requirements.iter().any(|requirement| {
        matches!(
            requirement,
            super::super::types::PlanRequirement::Unsupported { .. }
        )
    }));
}

#[test]
fn target_only_blank_control_or_invalid_identifier_is_not_executable() {
    let src = schema(vec![]);
    let tgt = schema(vec![col("id", "integer")]);
    for table in [" ", "audit\nevents", "audit..events", "audit. events"] {
        let plan = build_schema_diff_plan(
            &[(table.into(), src.clone(), tgt.clone())],
            "postgresql",
            "postgresql",
            PlanOptions {
                allow_destructive: true,
                include_indexes: true,
                type_mapper: None,
                cross_dialect: false,
            },
        );

        assert!(plan.statements.is_empty(), "{table:?}");
        assert!(
            plan.requirements.iter().any(|requirement| {
                matches!(
                    requirement,
                    super::super::types::PlanRequirement::Unsupported { .. }
                )
            }),
            "{table:?}"
        );
    }
}

#[test]
fn explicit_target_only_picker_does_not_invent_source_snapshot() {
    let source = schema(vec![col("id", "integer")]);
    let target = schema(vec![col("id", "integer")]);
    let plan = build_schema_diff_plan_with_target_only(
        &[("users".into(), source, target)],
        &["archive".into()],
        "postgresql",
        "postgresql",
        PlanOptions {
            allow_destructive: true,
            include_indexes: true,
            type_mapper: None,
            cross_dialect: false,
        },
    );

    assert_eq!(plan.tables, vec!["users", "archive"]);
    assert!(plan
        .statements
        .iter()
        .any(|statement| statement.sql == "DROP TABLE \"archive\""));
    assert!(!plan
        .statements
        .iter()
        .any(|statement| statement.sql.contains("DROP TABLE \"users\"")));
}

#[test]
fn explicit_target_only_picker_keeps_drop_rejected_by_default() {
    let plan = build_schema_diff_plan_with_target_only(
        &[],
        &["archive".into()],
        "postgresql",
        "postgresql",
        PlanOptions {
            allow_destructive: false,
            include_indexes: true,
            type_mapper: None,
            cross_dialect: false,
        },
    );

    assert!(plan.statements.is_empty());
    assert!(plan
        .warnings
        .iter()
        .any(|warning| warning.contains("table:archive")));
}

#[test]
fn test_tester_target_only_unknown_driver_is_not_executable() {
    let src = schema(vec![]);
    let tgt = schema(vec![col("id", "integer")]);
    let plan = build_schema_diff_plan(
        &[("archive".into(), src, tgt)],
        "postgresql",
        "unknown-driver",
        PlanOptions {
            allow_destructive: true,
            include_indexes: true,
            type_mapper: None,
            cross_dialect: false,
        },
    );

    assert!(plan.statements.is_empty());
    assert!(plan.requirements.iter().any(|requirement| {
        matches!(
            requirement,
            super::super::types::PlanRequirement::Unsupported { reason, .. }
            if reason.contains("No registered driver")
        )
    }));
}

#[test]
fn postgres_add_varchar_column() {
    let src = schema(vec![col("id", "int"), col("email", "varchar(255)")]);
    let tgt = schema(vec![col("id", "int")]);
    let plan = build_column_plan("users", &src, &tgt, "postgresql").unwrap();
    assert!(plan
        .statements
        .iter()
        .any(|s| { s.sql.contains("ADD COLUMN") && s.sql.contains("email") }));
}

#[test]
fn mysql_drop_requires_destructive_flag_in_metadata() {
    let src = schema(vec![col("id", "int")]);
    let tgt = schema(vec![col("id", "int"), col("legacy", "text")]);
    let plan = build_column_plan("users", &src, &tgt, "mysql").unwrap();
    let drop = plan
        .statements
        .iter()
        .find(|s| s.sql.contains("DROP COLUMN"))
        .unwrap();
    assert_eq!(drop.risk, StatementRisk::Destructive);
}

#[test]
fn additive_default_skips_drop() {
    let src = schema(vec![col("id", "int")]);
    let tgt = schema(vec![col("id", "int"), col("legacy", "text")]);
    let plan = build_schema_diff_plan(
        &[("users".into(), src, tgt)],
        "postgresql",
        "postgresql",
        PlanOptions {
            allow_destructive: false,
            include_indexes: false,
            type_mapper: None,
            cross_dialect: false,
        },
    );
    assert!(plan.statements.is_empty());
    assert!(plan
        .warnings
        .iter()
        .any(|w| w.contains("Skipped destructive")));
}

#[test]
fn multi_table_concatenates() {
    let src_a = schema(vec![col("id", "int"), col("a", "text")]);
    let tgt_a = schema(vec![col("id", "int")]);
    let src_b = schema(vec![col("id", "int"), col("b", "text")]);
    let tgt_b = schema(vec![col("id", "int")]);
    let plan = build_schema_diff_plan(
        &[("t_a".into(), src_a, tgt_a), ("t_b".into(), src_b, tgt_b)],
        "postgresql",
        "postgresql",
        PlanOptions::default(),
    );
    assert_eq!(plan.tables.len(), 2);
    assert!(plan.statements.len() >= 2);
}

#[test]
fn foreign_keys_are_emitted_after_all_table_definitions() {
    let mut orders = schema(vec![col("id", "int"), col("user_id", "int")]);
    orders.foreign_keys.push(ForeignKeyInfo {
        name: "orders_user_id_fk".into(),
        columns: vec!["user_id".into()],
        referenced_table: "users".into(),
        referenced_columns: vec!["id".into()],
        on_update: "CASCADE".into(),
        on_delete: "RESTRICT".into(),
        deferrability: ForeignKeyDeferrability::NotDeferrable,
    });
    let users = schema(vec![col("id", "int")]);
    let plan = build_schema_diff_plan(
        &[
            ("orders".into(), orders, schema(vec![])),
            ("users".into(), users, schema(vec![])),
        ],
        "postgresql",
        "postgresql",
        PlanOptions::default(),
    );
    let fk = plan
        .statements
        .iter()
        .position(|statement| statement.summary.starts_with("ADD FOREIGN KEY"))
        .expect("foreign key statement");
    assert!(
        plan.statements[..fk]
            .iter()
            .filter(|statement| statement.sql.starts_with("CREATE TABLE"))
            .count()
            >= 2
    );
}

#[test]
fn missing_tables_keep_source_foreign_keys_in_the_reviewed_plan() {
    let mut child = schema(vec![col("id", "int"), col("parent_id", "int")]);
    child.foreign_keys.push(ForeignKeyInfo {
        name: "fk_child_parent".into(),
        columns: vec!["parent_id".into()],
        referenced_table: "parent".into(),
        referenced_columns: vec!["id".into()],
        on_update: "NO ACTION".into(),
        on_delete: "NO ACTION".into(),
        deferrability: ForeignKeyDeferrability::NotDeferrable,
    });
    let plan = build_schema_diff_plan(
        &[
            (
                "a_parent".into(),
                schema(vec![col("id", "int")]),
                schema(vec![]),
            ),
            ("z_child".into(), child, schema(vec![])),
        ],
        "postgresql",
        "postgresql",
        PlanOptions::default(),
    );

    let fk = plan
        .statements
        .iter()
        .position(|statement| statement.summary.starts_with("ADD FOREIGN KEY"))
        .expect("source FK must remain in the reviewed plan");
    let parent = plan
        .statements
        .iter()
        .position(|statement| {
            statement.sql.contains("CREATE TABLE") && statement.sql.contains("a_parent")
        })
        .expect("parent table create");
    let child = plan
        .statements
        .iter()
        .position(|statement| {
            statement.sql.contains("CREATE TABLE") && statement.sql.contains("z_child")
        })
        .expect("child table create");
    assert!(parent < fk && child < fk);
}

#[test]
fn existing_table_foreign_key_difference_creates_an_add_operation() {
    let mut source = schema(vec![col("id", "int"), col("parent_id", "int")]);
    source.foreign_keys.push(ForeignKeyInfo {
        name: "fk_child_parent".into(),
        columns: vec!["parent_id".into()],
        referenced_table: "parent".into(),
        referenced_columns: vec!["id".into()],
        on_update: "NO ACTION".into(),
        on_delete: "NO ACTION".into(),
        deferrability: ForeignKeyDeferrability::NotDeferrable,
    });
    let target = schema(vec![col("id", "int"), col("parent_id", "int")]);
    let plan = build_schema_diff_plan(
        &[("child".into(), source, target)],
        "postgresql",
        "postgresql",
        PlanOptions::default(),
    );

    let fk = plan
        .statements
        .iter()
        .find(|statement| statement.summary.starts_with("ADD FOREIGN KEY"))
        .expect("missing source FK must produce an ADD operation");
    assert!(fk.sql.contains("fk_child_parent"));
    assert!(plan.requirements.is_empty(), "{:?}", plan.requirements);
}

#[test]
fn target_only_tables_drop_child_before_selected_parent_on_both_dialects() {
    let tables = vec!["a_parent".into(), "z_child".into()];
    let parent_schema = schema(vec![col("id", "int")]);
    let mut child_schema = schema(vec![col("id", "int"), col("parent_id", "int")]);
    child_schema.foreign_keys.push(ForeignKeyInfo {
        name: "fk_child_parent".into(),
        columns: vec!["parent_id".into()],
        referenced_table: "a_parent".into(),
        referenced_columns: vec!["id".into()],
        on_update: "NO ACTION".into(),
        on_delete: "NO ACTION".into(),
        deferrability: ForeignKeyDeferrability::NotDeferrable,
    });
    let target_schemas = vec![
        ("a_parent".into(), parent_schema),
        ("z_child".into(), child_schema),
    ];

    for dialect in ["postgresql", "mysql"] {
        let plan = build_schema_diff_plan_with_target_only_schemas(
            &[],
            &tables,
            &target_schemas,
            dialect,
            dialect,
            PlanOptions {
                allow_destructive: true,
                ..PlanOptions::default()
            },
        );
        let child_drop = plan
            .statements
            .iter()
            .position(|statement| statement.summary.ends_with("z_child"))
            .expect("child DROP TABLE");
        let parent_drop = plan
            .statements
            .iter()
            .position(|statement| statement.summary.ends_with("a_parent"))
            .expect("parent DROP TABLE");
        assert!(child_drop < parent_drop, "{dialect}: {:?}", plan.statements);
        assert!(
            plan.requirements.is_empty(),
            "{dialect}: {:?}",
            plan.requirements
        );
    }
}

#[test]
fn target_only_drop_refuses_basename_only_foreign_key_identity() {
    let tables = vec![
        "public.a_parent".into(),
        "other.a_parent".into(),
        "z_child".into(),
    ];
    let mut child_schema = schema(vec![col("id", "int"), col("parent_id", "int")]);
    child_schema.foreign_keys.push(ForeignKeyInfo {
        name: "fk_child_parent".into(),
        columns: vec!["parent_id".into()],
        referenced_table: "a_parent".into(),
        referenced_columns: vec!["id".into()],
        on_update: "NO ACTION".into(),
        on_delete: "NO ACTION".into(),
        deferrability: ForeignKeyDeferrability::NotDeferrable,
    });
    let target_schemas = vec![("z_child".into(), child_schema)];
    let plan = build_schema_diff_plan_with_target_only_schemas(
        &[],
        &tables,
        &target_schemas,
        "postgresql",
        "postgresql",
        PlanOptions {
            allow_destructive: true,
            ..PlanOptions::default()
        },
    );

    assert!(plan.statements.is_empty());
    assert!(plan.requirements.iter().any(|requirement| matches!(
        requirement,
        PlanRequirement::Unsupported { operation, reason }
            if operation == "target-only-table-drop-order" && reason.contains("basename")
    )));
}

#[test]
fn cross_dialect_foreign_key_reference_uses_target_relation_name() {
    let mut source = schema(vec![col("user_id", "int")]);
    source.foreign_keys.push(ForeignKeyInfo {
        name: "orders_user_id_fk".into(),
        columns: vec!["user_id".into()],
        referenced_table: "public.users".into(),
        referenced_columns: vec!["id".into()],
        on_update: "NO ACTION".into(),
        on_delete: "NO ACTION".into(),
        deferrability: ForeignKeyDeferrability::NotDeferrable,
    });
    let plan = build_schema_diff_plan(
        &[("public.orders".into(), source, schema(vec![]))],
        "postgresql",
        "mysql",
        PlanOptions::default(),
    );
    let fk = plan
        .statements
        .iter()
        .find(|statement| statement.summary.starts_with("ADD FOREIGN KEY"))
        .expect("foreign key statement");
    assert!(fk.sql.contains("REFERENCES `users`"), "{}", fk.sql);
    assert!(!fk.sql.contains("public"), "{}", fk.sql);
}

#[test]
fn index_create_planned() {
    let mut src = schema(vec![col("id", "int"), col("email", "text")]);
    src.indexes.push(IndexInfo {
        name: "idx_email".into(),
        columns: vec!["email".into()],
        is_unique: true,
        is_primary: false,
        index_type: "btree".into(),
    });
    let tgt = schema(vec![col("id", "int"), col("email", "text")]);
    let plan = build_schema_diff_plan(
        &[("users".into(), src, tgt)],
        "postgresql",
        "postgresql",
        PlanOptions {
            allow_destructive: false,
            include_indexes: true,
            type_mapper: None,
            cross_dialect: false,
        },
    );
    assert!(plan
        .statements
        .iter()
        .any(|s| s.sql.contains("CREATE") && s.sql.contains("idx_email")));
}

#[test]
fn cross_dialect_type_mapper() {
    let src = schema(vec![col("id", "int4"), col("email", "character varying")]);
    let tgt = schema(vec![col("id", "int")]);
    let mapper = |_table: &str, ty: &str, _name: &str| -> Result<String, String> {
        if ty.contains("varying") || ty == "text" {
            Ok("VARCHAR(255)".into())
        } else if ty.starts_with("int") {
            Ok("INT".into())
        } else {
            Err(format!("unsupported type {ty}"))
        }
    };
    let plan = build_schema_diff_plan(
        &[("users".into(), src, tgt)],
        "postgresql",
        "mysql",
        PlanOptions {
            allow_destructive: false,
            include_indexes: false,
            type_mapper: Some(&mapper),
            cross_dialect: false,
        },
    );
    assert!(!plan.same_dialect);
    let add = plan
        .statements
        .iter()
        .find(|s| s.sql.contains("email"))
        .unwrap();
    assert!(add.sql.contains("VARCHAR(255)"));
}

#[test]
fn changed_default_generates_target_dialect_ddl() {
    let mut src_c = col("status", "int");
    src_c.default_value = Some("0".into());
    let mut tgt_c = col("status", "int");
    tgt_c.default_value = Some("1".into());
    let src = schema(vec![src_c]);
    let tgt = schema(vec![tgt_c]);
    let plan = build_column_plan("users", &src, &tgt, "mysql").unwrap();
    let stmt = plan
        .statements
        .iter()
        .find(|s| s.summary.starts_with("ALTER DEFAULT"))
        .unwrap();
    assert!(stmt.sql.contains("SET DEFAULT 0"));
    assert!(stmt
        .rollback_sql
        .as_deref()
        .unwrap()
        .contains("SET DEFAULT 1"));
}

#[test]
fn mysql_primary_key_change_generates_drop_and_add() {
    let mut src = schema(vec![col("id", "int"), col("user_id", "int")]);
    src.primary_keys = vec!["user_id".into()];
    let mut tgt = schema(vec![col("id", "int"), col("user_id", "int")]);
    tgt.primary_keys = vec!["id".into()];
    let plan = build_column_plan("users", &src, &tgt, "mysql").unwrap();
    assert!(plan
        .statements
        .iter()
        .any(|s| s.sql.contains("DROP PRIMARY KEY")));
    assert!(plan
        .statements
        .iter()
        .any(|s| s.sql.contains("ADD PRIMARY KEY")));
}

#[test]
fn rollback_completeness_false_when_drop_index() {
    let src = schema(vec![col("id", "int")]);
    let mut tgt = schema(vec![col("id", "int")]);
    tgt.indexes.push(IndexInfo {
        name: "idx_old".into(),
        columns: vec!["id".into()],
        is_unique: false,
        is_primary: false,
        index_type: "btree".into(),
    });
    let plan = build_schema_diff_plan(
        &[("users".into(), src, tgt)],
        "postgresql",
        "postgresql",
        PlanOptions {
            allow_destructive: true,
            include_indexes: true,
            type_mapper: None,
            cross_dialect: false,
        },
    );
    assert!(!plan.rollback_completeness.complete);
    assert!(!plan.rollback_completeness.missing.is_empty());
}

#[test]
fn add_not_null_column_without_default_requires_backfill() {
    let mut c = col("status", "int");
    c.nullable = false;
    let src = schema(vec![col("id", "int"), c]);
    let tgt = schema(vec![col("id", "int")]);
    let plan = build_column_plan("users", &src, &tgt, "postgresql").unwrap();
    let add = plan
        .statements
        .iter()
        .find(|s| s.summary.starts_with("ADD COLUMN"))
        .unwrap();
    assert!(add.sql.contains("status"));
    assert!(!add.sql.contains("NOT NULL"));
    assert!(plan.requirements.iter().any(|r| matches!(r, super::super::types::PlanRequirement::Backfill { column, .. } if column == "status")));
}

#[test]
fn add_not_null_column_with_default_preserves_default() {
    let mut c = col("status", "int");
    c.nullable = false;
    c.default_value = Some("0".into());
    let src = schema(vec![col("id", "int"), c]);
    let tgt = schema(vec![col("id", "int")]);
    let plan = build_column_plan("users", &src, &tgt, "postgresql").unwrap();
    let add = plan
        .statements
        .iter()
        .find(|s| s.summary.starts_with("ADD COLUMN"))
        .unwrap();
    assert!(add.sql.contains("NOT NULL"));
    assert!(!plan
        .statements
        .iter()
        .any(|s| s.summary.starts_with("DROP DEFAULT")));
}

#[test]
fn cross_dialect_pg_to_mysql_does_not_translate_nextval() {
    let mut id_col = col("id", "integer");
    id_col.nullable = false;
    id_col.default_value = Some("nextval('orders_id_seq'::regclass)".into());
    let src = schema(vec![id_col, col("name", "text")]);
    let tgt = schema(vec![col("name", "text")]);
    let plan = build_schema_diff_plan(
        &[("orders".into(), src, tgt)],
        "postgresql",
        "mysql",
        PlanOptions::default(),
    );
    assert!(!plan.statements.iter().any(|s| s.sql.contains("nextval")));
    assert!(plan
        .warnings
        .iter()
        .any(|w| w.contains("Cross-dialect plan without IR type mapper")));
    assert!(plan.requirements.iter().any(|requirement| matches!(
        requirement,
        PlanRequirement::Backfill { column, .. } if column == "id"
    )));
}

#[test]
fn cross_dialect_pg_character_literal_casts_keep_portable_quoted_defaults() {
    let mut code = col("code", "character varying(16)");
    code.nullable = false;
    code.default_value = Some("'CODE0001'::bpchar".into());
    let mut label = col("label", "varchar(32)");
    label.nullable = false;
    label.default_value = Some("'unnamed'::character varying".into());
    let mut owner = col("owner", "char(32)");
    owner.nullable = false;
    owner.default_value = Some("'owner''s'::varchar(32)".into());
    let src = schema(vec![col("id", "integer"), code, label, owner]);
    let tgt = schema(vec![col("id", "integer")]);
    let mapper = |_table: &str, ty: &str, _name: &str| -> Result<String, String> {
        if ty.to_ascii_lowercase().contains("char") {
            Ok("VARCHAR(64)".into())
        } else {
            Ok("BIGINT".into())
        }
    };
    let plan = build_schema_diff_plan(
        &[("users".into(), src, tgt)],
        "postgresql",
        "mysql",
        PlanOptions {
            type_mapper: Some(&mapper),
            ..Default::default()
        },
    );

    assert!(plan.requirements.is_empty(), "{:?}", plan.requirements);
    assert!(plan.statements.iter().any(|statement| statement
        .sql
        .contains("`code` VARCHAR(64) NOT NULL DEFAULT 'CODE0001'")));
    assert!(plan.statements.iter().any(|statement| statement
        .sql
        .contains("`label` VARCHAR(64) NOT NULL DEFAULT 'unnamed'")));
    assert!(plan.statements.iter().any(|statement| statement
        .sql
        .contains("`owner` VARCHAR(64) NOT NULL DEFAULT 'owner''s'")));
    assert!(!plan
        .statements
        .iter()
        .any(|statement| statement.sql.contains("::")));
}

#[test]
fn cross_dialect_pg_unknown_cast_expressions_are_stripped_and_require_backfill() {
    let mut function_default = col("function_default", "varchar(32)");
    function_default.nullable = false;
    function_default.default_value = Some("lower('NAME')::character varying".into());
    let mut unknown_cast = col("unknown_cast", "varchar(32)");
    unknown_cast.nullable = false;
    unknown_cast.default_value = Some("'CODE0001'::custom_string_type".into());
    let mut malformed_literal = col("malformed_literal", "varchar(32)");
    malformed_literal.nullable = false;
    malformed_literal.default_value = Some("'CODE0001::character varying".into());
    let mut sequence_default = col("sequence_default", "bigint");
    sequence_default.nullable = false;
    sequence_default.default_value = Some("nextval('users_seq'::regclass)".into());
    let src = schema(vec![
        col("id", "integer"),
        function_default,
        unknown_cast,
        malformed_literal,
        sequence_default,
    ]);
    let tgt = schema(vec![col("id", "integer")]);
    let mapper = |_table: &str, ty: &str, _name: &str| -> Result<String, String> {
        if ty.to_ascii_lowercase().contains("char") {
            Ok("VARCHAR(64)".into())
        } else {
            Ok("BIGINT".into())
        }
    };
    let plan = build_schema_diff_plan(
        &[("users".into(), src, tgt)],
        "postgresql",
        "mysql",
        PlanOptions {
            type_mapper: Some(&mapper),
            ..Default::default()
        },
    );

    for column in [
        "function_default",
        "unknown_cast",
        "malformed_literal",
        "sequence_default",
    ] {
        assert!(
            plan.requirements.iter().any(|requirement| matches!(
                requirement,
                PlanRequirement::Backfill { column: required, .. } if required == column
            )),
            "missing Backfill requirement for {column}: {:?}",
            plan.requirements
        );
    }
    assert!(!plan.statements.iter().any(|statement| {
        statement.sql.contains("lower('NAME')")
            || statement.sql.contains("custom_string_type")
            || statement.sql.contains("nextval")
            || statement.sql.contains("::regclass")
    }));
}

#[test]
fn cross_dialect_pg_set_default_maps_known_string_cast_and_blocks_unknown_expression() {
    let mut source = col("label", "character varying(32)");
    source.default_value = Some("'fresh'' label'::character varying".into());
    let mut target = col("label", "VARCHAR(64)");
    target.default_value = Some("'old label'".into());
    let mapper = |_table: &str, ty: &str, _name: &str| -> Result<String, String> {
        if ty.to_ascii_lowercase().contains("char") {
            Ok("VARCHAR(64)".into())
        } else {
            Ok(ty.into())
        }
    };
    let plan = build_schema_diff_plan(
        &[(
            "users".into(),
            schema(vec![source.clone()]),
            schema(vec![target.clone()]),
        )],
        "postgresql",
        "mysql",
        PlanOptions {
            type_mapper: Some(&mapper),
            ..Default::default()
        },
    );
    assert!(plan.requirements.is_empty(), "{:?}", plan.requirements);
    assert!(plan
        .statements
        .iter()
        .any(|statement| statement.sql.contains("SET DEFAULT 'fresh'' label'")));
    assert!(!plan
        .statements
        .iter()
        .any(|statement| statement.sql.contains("::")));

    source.default_value = Some("lower('fresh')::character varying".into());
    target.default_value = Some("'old label'".into());
    let unknown_plan = build_schema_diff_plan(
        &[("users".into(), schema(vec![source]), schema(vec![target]))],
        "postgresql",
        "mysql",
        PlanOptions {
            type_mapper: Some(&mapper),
            ..Default::default()
        },
    );
    assert!(unknown_plan.requirements.iter().any(|requirement| matches!(
        requirement,
        PlanRequirement::Unsupported { reason, .. }
            if reason.contains("PostgreSQL default expression")
    )));
    assert!(!unknown_plan
        .statements
        .iter()
        .any(|statement| statement.sql.contains("lower('fresh')")));
}

#[test]
fn type_mapper_failure_becomes_unsupported_not_executable() {
    let src = schema(vec![col("id", "int"), col("payload", "jsonb")]);
    let tgt = schema(vec![col("id", "int")]);
    let mapper = |_table: &str, _ty: &str, name: &str| -> Result<String, String> {
        if name == "payload" {
            Err("no mysql equivalent for jsonb".into())
        } else {
            Ok("INT".into())
        }
    };
    let plan = build_schema_diff_plan(
        &[("users".into(), src, tgt)],
        "postgresql",
        "mysql",
        PlanOptions {
            allow_destructive: true,
            include_indexes: false,
            type_mapper: Some(&mapper),
            cross_dialect: false,
        },
    );
    assert!(plan.statements.is_empty());
    assert!(plan.requirements.iter().any(|r| {
        matches!(
            r,
            super::super::types::PlanRequirement::Unsupported { operation, reason }
            if operation.contains("payload") && reason.contains("jsonb")
        )
    }));
}

#[test]
fn create_table_type_mapper_failure_becomes_unsupported() {
    let src = schema(vec![col("id", "int"), col("meta", "hstore")]);
    let tgt = schema(vec![]);
    let mapper = |_table: &str, _ty: &str, name: &str| -> Result<String, String> {
        if name == "meta" {
            Err("unsupported hstore".into())
        } else {
            Ok("INT".into())
        }
    };
    let plan = build_schema_diff_plan(
        &[("items".into(), src, tgt)],
        "postgresql",
        "mysql",
        PlanOptions {
            allow_destructive: true,
            include_indexes: false,
            type_mapper: Some(&mapper),
            cross_dialect: false,
        },
    );
    assert!(!plan
        .statements
        .iter()
        .any(|s| s.sql.contains("CREATE TABLE")));
    assert!(plan.requirements.iter().any(|r| {
        matches!(
            r,
            super::super::types::PlanRequirement::Unsupported { reason, .. }
            if reason.contains("hstore")
        )
    }));
}

#[test]
fn varchar_narrowing_marks_destructive_risk() {
    let src = schema(vec![col("id", "int"), col("code", "varchar(100)")]);
    let tgt = schema(vec![col("id", "int"), col("code", "varchar(255)")]);
    let plan = build_column_plan("users", &src, &tgt, "postgresql").unwrap();
    let alter = plan
        .statements
        .iter()
        .find(|s| s.summary.contains("ALTER TYPE") || s.sql.contains("TYPE"))
        .expect("ALTER TYPE statement");
    assert_eq!(alter.risk, StatementRisk::Destructive);
    assert!(plan.warnings.iter().any(|w| w.contains("truncate")));
}

#[test]
fn int_to_smallint_narrowing_marks_destructive_risk() {
    let src = schema(vec![col("id", "int"), col("qty", "smallint")]);
    let tgt = schema(vec![col("id", "int"), col("qty", "int")]);
    let plan = build_column_plan("users", &src, &tgt, "postgresql").unwrap();
    let alter = plan
        .statements
        .iter()
        .find(|s| s.summary.contains("ALTER TYPE") || s.sql.contains("TYPE"))
        .expect("ALTER TYPE statement");
    assert_eq!(alter.risk, StatementRisk::Destructive);
}

#[test]
fn unknown_type_change_without_length_is_not_narrowing() {
    let src = schema(vec![col("id", "int"), col("payload", "json")]);
    let tgt = schema(vec![col("id", "int"), col("payload", "text")]);
    let plan = build_column_plan("users", &src, &tgt, "postgresql").unwrap();
    let alter = plan
        .statements
        .iter()
        .find(|s| s.summary.contains("ALTER TYPE"))
        .expect("ALTER TYPE statement");
    assert_eq!(alter.risk, StatementRisk::Rewrite);
    assert!(!plan.warnings.iter().any(|w| w.contains("truncate")));
}

#[test]
fn set_not_null_narrowing_requires_destructive_flag() {
    let mut src_c = col("status", "int");
    src_c.nullable = false;
    let mut tgt_c = col("status", "int");
    tgt_c.nullable = true;
    let src = schema(vec![col("id", "int"), src_c]);
    let tgt = schema(vec![col("id", "int"), tgt_c]);
    let plan = build_schema_diff_plan(
        &[("users".into(), src, tgt)],
        "postgresql",
        "postgresql",
        PlanOptions {
            allow_destructive: false,
            include_indexes: false,
            type_mapper: None,
            cross_dialect: false,
        },
    );
    assert!(plan.statements.is_empty());
    assert!(plan.warnings.iter().any(|w| w.contains("NOT NULL")));
}

#[test]
fn is_type_narrowing_unit_cases() {
    let snap = |ty: &str| ColumnSnapshot {
        name: "c".into(),
        data_type: ty.into(),
        nullable: true,
        default_value: None,
        comment: None,
        is_primary_key: false,
        is_auto_increment: false,
    };
    assert!(is_type_narrowing(
        &snap("varchar(100)"),
        &snap("varchar(255)")
    ));
    assert!(!is_type_narrowing(
        &snap("varchar(255)"),
        &snap("varchar(100)")
    ));
    assert!(is_type_narrowing(&snap("smallint"), &snap("int")));
    assert!(!is_type_narrowing(&snap("int"), &snap("smallint")));
    assert!(!is_type_narrowing(&snap("json"), &snap("text")));
    assert!(!is_type_narrowing(
        &snap("varchar(100)"),
        &snap("varchar(255x)")
    ));
}

#[test]
fn unsupported_driver_operation_becomes_requirement() {
    let mut src = schema(vec![col("id", "int")]);
    src.columns[0].is_auto_increment = true;
    let tgt = schema(vec![col("id", "int")]);
    let plan = build_schema_diff_plan(
        &[("users".into(), src, tgt)],
        "postgresql",
        "postgresql",
        PlanOptions::default(),
    );
    assert!(plan
        .requirements
        .iter()
        .any(|r| matches!(r, super::super::types::PlanRequirement::Unsupported { .. })));
}

#[test]
fn sqlite_alter_type_becomes_unsupported() {
    let src = schema(vec![col("id", "int")]);
    let mut target = src.clone();
    target.columns[0].data_type = "text".into();
    let plan = build_schema_diff_plan(
        &[("users".into(), src, target)],
        "sqlite",
        "sqlite",
        PlanOptions::default(),
    );
    assert!(plan
        .requirements
        .iter()
        .any(|r| matches!(r, super::super::types::PlanRequirement::Unsupported { .. })));
}

#[test]
fn mysql_indexes_on_blob_text_columns_receive_prefix_length() {
    let mut src = schema(vec![
        col("id", "int"),
        col("name", "text"),
        col("region", "text"),
    ]);
    src.indexes.push(IndexInfo {
        name: "idx_demo_customers_region".into(),
        columns: vec!["region".into()],
        is_unique: false,
        is_primary: false,
        index_type: "BTREE".into(),
    });
    src.indexes.push(IndexInfo {
        name: "uq_demo_customers_name".into(),
        columns: vec!["name".into()],
        is_unique: true,
        is_primary: false,
        index_type: "BTREE".into(),
    });
    let tgt = schema(vec![]);

    // MySQL target
    let mysql_plan = build_schema_diff_plan(
        &[("demo_customers".into(), src.clone(), tgt.clone())],
        "postgresql",
        "mysql",
        PlanOptions::default(),
    );
    let region_stmt = mysql_plan
        .statements
        .iter()
        .find(|s| s.sql.contains("idx_demo_customers_region"))
        .expect("should have region index statement");
    assert!(
        region_stmt.sql.contains("`region`(255)"),
        "MySQL index should have prefix length: {}",
        region_stmt.sql
    );
    let name_stmt = mysql_plan
        .statements
        .iter()
        .find(|s| s.sql.contains("uq_demo_customers_name"))
        .expect("should have name unique index statement");
    assert!(
        name_stmt.sql.contains("`name`(255)"),
        "MySQL unique index should have prefix length: {}",
        name_stmt.sql
    );
    assert!(mysql_plan
        .warnings
        .iter()
        .any(|w| w.contains("prefix length (255)")));

    // PostgreSQL target: no prefix length should be added
    let pg_plan = build_schema_diff_plan(
        &[("demo_customers".into(), src, tgt)],
        "mysql",
        "postgresql",
        PlanOptions::default(),
    );
    let pg_region_stmt = pg_plan
        .statements
        .iter()
        .find(|s| s.sql.contains("idx_demo_customers_region"))
        .expect("should have pg region index statement");
    assert!(
        pg_region_stmt.sql.contains("\"region\""),
        "PostgreSQL index should keep bare column: {}",
        pg_region_stmt.sql
    );
    assert!(!pg_region_stmt.sql.contains("255"));
}

#[test]
fn mysql_boolean_defaults_are_translated_for_postgres_add_columns() {
    let mut enabled = col("enabled", "tinyint(1)");
    enabled.default_value = Some("1".into());
    let mut disabled = col("disabled", "BOOLEAN");
    disabled.default_value = Some("0".into());
    let mut explicit_true = col("explicit_true", "bool");
    explicit_true.default_value = Some("TRUE".into());
    let src = schema(vec![col("id", "int"), enabled, disabled, explicit_true]);
    let tgt = schema(vec![col("id", "int")]);
    let mapper = |_table: &str, ty: &str, _name: &str| -> Result<String, String> {
        if ty.to_ascii_lowercase().starts_with("tinyint(1)")
            || matches!(ty.to_ascii_lowercase().as_str(), "bool" | "boolean")
        {
            Ok("boolean".into())
        } else {
            Ok(ty.into())
        }
    };

    let plan = build_schema_diff_plan(
        &[("users".into(), src, tgt)],
        "mysql",
        "postgresql",
        PlanOptions {
            type_mapper: Some(&mapper),
            ..Default::default()
        },
    );

    assert!(plan.requirements.is_empty(), "{:?}", plan.requirements);
    assert!(plan
        .statements
        .iter()
        .any(|statement| { statement.sql.contains("\"enabled\" boolean DEFAULT TRUE") }));
    assert!(plan
        .statements
        .iter()
        .any(|statement| { statement.sql.contains("\"disabled\" boolean DEFAULT FALSE") }));
    assert!(plan.statements.iter().any(|statement| {
        statement
            .sql
            .contains("\"explicit_true\" boolean DEFAULT TRUE")
    }));
}

#[test]
fn mysql_boolean_defaults_are_translated_for_postgres_create_table() {
    let mut enabled = col("enabled", "tinyint(1) unsigned");
    enabled.default_value = Some("1".into());
    let mut disabled = col("disabled", "tinyint(1)");
    disabled.default_value = Some("false".into());
    let src = schema(vec![col("id", "int"), enabled, disabled]);
    let tgt = schema(vec![]);
    let mapper = |_table: &str, ty: &str, _name: &str| -> Result<String, String> {
        if ty.to_ascii_lowercase().starts_with("tinyint(1)") {
            Ok("boolean".into())
        } else {
            Ok(ty.into())
        }
    };

    let plan = build_schema_diff_plan(
        &[("users".into(), src, tgt)],
        "mysql",
        "postgresql",
        PlanOptions {
            type_mapper: Some(&mapper),
            ..Default::default()
        },
    );

    assert!(plan.requirements.is_empty(), "{:?}", plan.requirements);
    let create = plan
        .statements
        .iter()
        .find(|statement| statement.sql.starts_with("CREATE TABLE"))
        .expect("CREATE TABLE statement");
    assert!(create.sql.contains("\"enabled\" boolean DEFAULT TRUE"));
    assert!(create.sql.contains("\"disabled\" boolean DEFAULT FALSE"));
}

#[test]
fn mysql_string_defaults_are_quoted_for_postgres_add_create_and_set_default() {
    let mut code = col("code", "char(8)");
    code.default_value = Some("CODE0001".into());
    let mut label = col("label", "varchar(32)");
    label.default_value = Some("  fresh' label  ".into());
    let mut amount = col("amount", "decimal(10,2)");
    amount.default_value = Some("0.00".into());
    let mut created_at = col("created_at", "datetime");
    created_at.default_value = Some("CURRENT_TIMESTAMP(6)".into());
    let mut event_date = col("event_date", "date");
    event_date.default_value = Some("2026-09-23".into());
    let source = schema(vec![
        col("id", "int"),
        code.clone(),
        label.clone(),
        amount.clone(),
        created_at.clone(),
        event_date.clone(),
    ]);
    let mapper = |_table: &str, ty: &str, _name: &str| -> Result<String, String> {
        let lower = ty.to_ascii_lowercase();
        if lower.starts_with("char") || lower.starts_with("varchar") {
            Ok("character varying(128)".into())
        } else if lower.starts_with("decimal") {
            Ok("numeric(10,2)".into())
        } else if lower == "datetime" {
            Ok("timestamp without time zone".into())
        } else {
            Ok(ty.into())
        }
    };
    let add_plan = build_schema_diff_plan(
        &[(
            "users".into(),
            source.clone(),
            schema(vec![col("id", "int")]),
        )],
        "mysql",
        "postgresql",
        PlanOptions {
            type_mapper: Some(&mapper),
            ..Default::default()
        },
    );
    assert!(
        add_plan.requirements.is_empty(),
        "{:?}",
        add_plan.requirements
    );
    let add_sql = add_plan
        .statements
        .iter()
        .map(|statement| statement.sql.as_str())
        .collect::<Vec<_>>()
        .join("\n");
    assert!(add_sql.contains("\"code\" character varying(128) DEFAULT 'CODE0001'"));
    assert!(add_sql.contains("\"label\" character varying(128) DEFAULT '  fresh'' label  '"));
    assert!(add_sql.contains("\"amount\" numeric(10,2) DEFAULT 0.00"));
    assert!(
        add_sql.contains("\"created_at\" timestamp without time zone DEFAULT CURRENT_TIMESTAMP(6)")
    );
    assert!(add_sql.contains("\"event_date\" date DEFAULT '2026-09-23'"));

    let create_plan = build_schema_diff_plan(
        &[("users".into(), source.clone(), schema(vec![]))],
        "mysql",
        "postgresql",
        PlanOptions {
            type_mapper: Some(&mapper),
            ..Default::default()
        },
    );
    assert!(
        create_plan.requirements.is_empty(),
        "{:?}",
        create_plan.requirements
    );
    let create_sql = create_plan
        .statements
        .iter()
        .find(|statement| statement.sql.starts_with("CREATE TABLE"))
        .expect("CREATE TABLE statement")
        .sql
        .as_str();
    assert!(create_sql.contains("\"code\" character varying(128) DEFAULT 'CODE0001'"));
    assert!(create_sql.contains("\"label\" character varying(128) DEFAULT '  fresh'' label  '"));
    assert!(create_sql
        .contains("\"created_at\" timestamp without time zone DEFAULT CURRENT_TIMESTAMP(6)"));

    let mut changed_label = label;
    changed_label.default_value = Some("PENDING".into());
    let mut target_label = col("label", "character varying(64)");
    target_label.default_value = Some("'OLD'::character varying".into());
    let set_plan = build_schema_diff_plan(
        &[(
            "users".into(),
            schema(vec![changed_label]),
            schema(vec![target_label]),
        )],
        "mysql",
        "postgresql",
        PlanOptions {
            type_mapper: Some(&mapper),
            ..Default::default()
        },
    );
    assert!(
        set_plan.requirements.is_empty(),
        "{:?}",
        set_plan.requirements
    );
    assert!(set_plan
        .statements
        .iter()
        .any(|statement| statement.sql.contains("SET DEFAULT 'PENDING'")));
}

#[test]
fn test_tester_mysql_numeric_expression_default_fails_closed_for_postgres() {
    let mut value = col("value", "int");
    value.default_value = Some("IFNULL(1, 2)".into());
    let mapper =
        |_table: &str, _ty: &str, _name: &str| -> Result<String, String> { Ok("integer".into()) };
    let plan = build_schema_diff_plan(
        &[(
            "users".into(),
            schema(vec![col("id", "int"), value]),
            schema(vec![col("id", "integer")]),
        )],
        "mysql",
        "postgresql",
        PlanOptions {
            type_mapper: Some(&mapper),
            ..Default::default()
        },
    );

    assert!(
        plan.requirements.iter().any(|requirement| matches!(
            requirement,
            PlanRequirement::Unsupported { reason, .. }
                if reason.contains("default") || reason.contains("Default")
        )),
        "numeric MySQL expression should block the plan: {plan:?}"
    );
    assert!(!plan
        .statements
        .iter()
        .any(|statement| statement.sql.contains("IFNULL(1, 2)")));
}

#[test]
fn mysql_numeric_literal_defaults_are_preserved_for_postgres() {
    let mapper =
        |_table: &str, _ty: &str, _name: &str| -> Result<String, String> { Ok("numeric".into()) };

    for default in ["0", "+1", "-1.25", ".5", "1.", "1e-3", "1E+3"] {
        let mut value = col("value", "decimal(12,3)");
        value.default_value = Some(default.into());
        let plan = build_schema_diff_plan(
            &[(
                "users".into(),
                schema(vec![col("id", "int"), value]),
                schema(vec![col("id", "integer")]),
            )],
            "mysql",
            "postgresql",
            PlanOptions {
                type_mapper: Some(&mapper),
                ..Default::default()
            },
        );

        assert!(
            plan.requirements.is_empty(),
            "portable numeric literal `{default}` should be preserved: {:?}",
            plan.requirements
        );
        assert!(
            plan.statements
                .iter()
                .any(|statement| statement.sql.contains(&format!("DEFAULT {default}"))),
            "expected numeric literal `{default}` in target DDL: {:?}",
            plan.statements
        );
    }
}

#[test]
fn mysql_integer_literals_are_accepted_but_fractional_forms_fail_for_postgres_integer_targets() {
    let mapper =
        |_table: &str, _ty: &str, _name: &str| -> Result<String, String> { Ok("integer".into()) };

    for default in ["0", "+1", "-42", "-2147483648", "2147483647"] {
        let mut value = col("value", "int");
        value.default_value = Some(default.into());
        let plan = build_schema_diff_plan(
            &[(
                "users".into(),
                schema(vec![col("id", "int"), value]),
                schema(vec![col("id", "integer")]),
            )],
            "mysql",
            "postgresql",
            PlanOptions {
                type_mapper: Some(&mapper),
                ..Default::default()
            },
        );

        assert!(
            plan.requirements.is_empty(),
            "integer literal `{default}` should remain valid: {:?}",
            plan.requirements
        );
        assert!(plan
            .statements
            .iter()
            .any(|statement| statement.sql.contains(&format!("DEFAULT {default}"))));
    }

    for (source_type, default) in [
        ("int", "1.0"),
        ("int", ".5"),
        ("int", "1e3"),
        ("int", "2147483648"),
        ("int", "-2147483649"),
        ("int unsigned", "1.0"),
        ("int unsigned", "4294967295"),
    ] {
        let mut value = col("value", source_type);
        value.default_value = Some(default.into());
        let plan = build_schema_diff_plan(
            &[(
                "users".into(),
                schema(vec![col("id", "int"), value]),
                schema(vec![col("id", "integer")]),
            )],
            "mysql",
            "postgresql",
            PlanOptions {
                type_mapper: Some(&mapper),
                ..Default::default()
            },
        );

        assert!(
            plan.requirements.iter().any(|requirement| matches!(
                requirement,
                PlanRequirement::Unsupported { reason, .. }
                    if reason.contains(default)
            )),
            "fractional numeric form `{default}` must not target PostgreSQL integer: {:?}",
            plan.requirements
        );
        assert!(plan
            .statements
            .iter()
            .all(|statement| !statement.sql.contains(default)));
    }
}

#[test]
fn test_tester_mysql_integer_defaults_follow_postgres_target_widths() {
    let defaults = [
        ("small_min", "smallint", "-32768", true),
        ("small_max", "smallint", "32767", true),
        ("small_overflow", "smallint", "32768", false),
        ("big_min", "bigint", "-9223372036854775808", true),
        ("big_max", "bigint", "9223372036854775807", true),
        ("big_overflow", "bigint", "9223372036854775808", false),
        ("array_target", "integer[]", "1", false),
        ("empty_numeric", "numeric", "", false),
    ];
    let mut source_columns = vec![col("id", "int")];
    let mut target_types = std::collections::HashMap::new();
    for (name, target_type, default, _) in defaults {
        let mut value = col(name, "int");
        value.default_value = Some(default.into());
        source_columns.push(value);
        target_types.insert(name, target_type);
    }

    let mapper = |_table: &str, _ty: &str, name: &str| -> Result<String, String> {
        Ok(target_types.get(name).copied().unwrap_or("integer").into())
    };
    let plan = build_schema_diff_plan(
        &[(
            "users".into(),
            schema(source_columns),
            schema(vec![col("id", "integer")]),
        )],
        "mysql",
        "postgresql",
        PlanOptions {
            type_mapper: Some(&mapper),
            ..Default::default()
        },
    );

    for (name, target_type, default, should_pass) in defaults {
        let sql = plan
            .statements
            .iter()
            .find(|statement| statement.sql.contains(&format!("\"{name}\"")));
        let has_unsupported = plan.requirements.iter().any(|requirement| {
            matches!(
                requirement,
                PlanRequirement::Unsupported { operation, reason }
                    if operation.contains(name) || reason.contains(name)
            )
        });

        if should_pass {
            assert!(
                !has_unsupported,
                "{name} ({target_type} DEFAULT {default}) unexpectedly failed: {:?}",
                plan.requirements
            );
            assert!(
                sql.is_some_and(|statement| statement.sql.contains(&format!("DEFAULT {default}"))),
                "{name} ({target_type} DEFAULT {default}) was not retained: {:?}",
                plan.statements
            );
        } else {
            assert!(
                has_unsupported,
                "{name} ({target_type} DEFAULT {default}) must fail closed: {:?}",
                plan.requirements
            );
            assert!(
                sql.is_none_or(|statement| !statement.sql.contains(&format!("DEFAULT {default}"))),
                "unsupported {name} default leaked into target SQL: {:?}",
                plan.statements
            );
        }
    }
}

#[test]
fn mysql_numeric_literal_defaults_are_preserved_for_postgres_create_and_set_default() {
    let mapper =
        |_table: &str, _ty: &str, _name: &str| -> Result<String, String> { Ok("numeric".into()) };
    let mut created_value = col("value", "decimal(12,3)");
    created_value.default_value = Some("-1.25".into());
    let create_plan = build_schema_diff_plan(
        &[(
            "users".into(),
            schema(vec![col("id", "int"), created_value]),
            schema(vec![]),
        )],
        "mysql",
        "postgresql",
        PlanOptions {
            type_mapper: Some(&mapper),
            ..Default::default()
        },
    );
    assert!(
        create_plan.requirements.is_empty(),
        "{:?}",
        create_plan.requirements
    );
    assert!(create_plan
        .statements
        .iter()
        .any(|statement| statement.sql.contains("DEFAULT -1.25")));

    let mut changed_value = col("value", "decimal(12,3)");
    changed_value.default_value = Some("1e-3".into());
    let mut target_value = col("value", "numeric");
    target_value.default_value = Some("0".into());
    let set_default_plan = build_schema_diff_plan(
        &[(
            "users".into(),
            schema(vec![changed_value]),
            schema(vec![target_value]),
        )],
        "mysql",
        "postgresql",
        PlanOptions {
            type_mapper: Some(&mapper),
            ..Default::default()
        },
    );
    assert!(
        set_default_plan.requirements.is_empty(),
        "{:?}",
        set_default_plan.requirements
    );
    assert!(set_default_plan
        .statements
        .iter()
        .any(|statement| statement.sql.contains("SET DEFAULT 1e-3")));
}

#[test]
fn mysql_numeric_expressions_and_source_specific_literals_fail_closed_for_postgres() {
    let mapper =
        |_table: &str, _ty: &str, _name: &str| -> Result<String, String> { Ok("numeric".into()) };

    for default in [
        "IFNULL(1, 2)",
        "COALESCE(1, 2)",
        "1 + 2",
        "(1)",
        "0x2a",
        "b'101'",
        "1e",
    ] {
        let mut value = col("value", "int");
        value.default_value = Some(default.into());
        let plan = build_schema_diff_plan(
            &[(
                "users".into(),
                schema(vec![col("id", "int"), value]),
                schema(vec![col("id", "integer")]),
            )],
            "mysql",
            "postgresql",
            PlanOptions {
                type_mapper: Some(&mapper),
                ..Default::default()
            },
        );

        assert!(
            plan.requirements.iter().any(|requirement| matches!(
                requirement,
                PlanRequirement::Unsupported { reason, .. }
                    if reason.contains("numeric default expression")
            )),
            "expected Unsupported for MySQL default `{default}`: {:?}",
            plan.requirements
        );
        assert!(
            plan.statements
                .iter()
                .all(|statement| !statement.sql.contains(default)),
            "unsafe default `{default}` leaked into target DDL: {:?}",
            plan.statements
        );
    }
}

#[test]
fn mysql_numeric_default_expressions_fail_closed_for_postgres_create_and_set_default() {
    let mapper =
        |_table: &str, _ty: &str, _name: &str| -> Result<String, String> { Ok("numeric".into()) };
    let mut value = col("value", "int");
    value.default_value = Some("IFNULL(1, 2)".into());

    let create_plan = build_schema_diff_plan(
        &[(
            "users".into(),
            schema(vec![col("id", "int"), value.clone()]),
            schema(vec![]),
        )],
        "mysql",
        "postgresql",
        PlanOptions {
            type_mapper: Some(&mapper),
            ..Default::default()
        },
    );
    assert!(create_plan.requirements.iter().any(|requirement| matches!(
        requirement,
        PlanRequirement::Unsupported { reason, .. }
            if reason.contains("numeric default expression")
    )));
    assert!(create_plan
        .statements
        .iter()
        .all(|statement| !statement.sql.contains("IFNULL(1, 2)")));

    let mut target_value = col("value", "numeric");
    target_value.default_value = Some("0".into());
    let set_default_plan = build_schema_diff_plan(
        &[(
            "users".into(),
            schema(vec![value]),
            schema(vec![target_value]),
        )],
        "mysql",
        "postgresql",
        PlanOptions {
            type_mapper: Some(&mapper),
            ..Default::default()
        },
    );
    assert!(set_default_plan.requirements.iter().any(
        |requirement| matches!(requirement, PlanRequirement::Unsupported { reason, .. }
            if reason.contains("numeric default expression"))
    ));
    assert!(set_default_plan
        .statements
        .iter()
        .all(|statement| !statement.sql.contains("IFNULL(1, 2)")));
}

#[test]
fn unsafe_mysql_string_defaults_fail_closed_for_postgres() {
    for (source_type, default, target_type) in [
        ("varchar(32)", "uuid()", "character varying(32)"),
        ("geometry", "PENDING", "text"),
        ("varchar(32)", "PENDING", "jsonb"),
    ] {
        let mut value = col("value", source_type);
        value.default_value = Some(default.into());
        let mapper = |_table: &str, _ty: &str, _name: &str| -> Result<String, String> {
            Ok(target_type.into())
        };
        let plan = build_schema_diff_plan(
            &[(
                "users".into(),
                schema(vec![col("id", "int"), value]),
                schema(vec![col("id", "int")]),
            )],
            "mysql",
            "postgresql",
            PlanOptions {
                type_mapper: Some(&mapper),
                ..Default::default()
            },
        );
        assert!(
            plan.requirements.iter().any(|requirement| matches!(
                requirement,
                PlanRequirement::Unsupported { reason, .. }
                    if reason.contains("default") || reason.contains("Default")
            )),
            "expected Unsupported for {source_type} default {default}: {:?}",
            plan.requirements
        );
        assert!(!plan
            .statements
            .iter()
            .any(|statement| statement.sql.contains(default)));
    }
}

#[test]
fn mysql_bit_boolean_literals_are_translated_for_postgres() {
    let mut enabled = col("enabled", "bit(1)");
    enabled.default_value = Some("b'1'".into());
    let mut disabled = col("disabled", "BIT");
    disabled.default_value = Some("0b0".into());
    let src = schema(vec![col("id", "int"), enabled, disabled]);
    let mapper = |_table: &str, ty: &str, _name: &str| -> Result<String, String> {
        if ty.trim().to_ascii_lowercase().starts_with("bit") {
            Ok("boolean".into())
        } else {
            Ok(ty.into())
        }
    };

    let add_plan = build_schema_diff_plan(
        &[("users".into(), src.clone(), schema(vec![col("id", "int")]))],
        "mysql",
        "postgresql",
        PlanOptions {
            type_mapper: Some(&mapper),
            ..Default::default()
        },
    );
    assert!(
        add_plan.requirements.is_empty(),
        "{:?}",
        add_plan.requirements
    );
    assert!(add_plan
        .statements
        .iter()
        .any(|statement| statement.sql.contains("\"enabled\" boolean DEFAULT TRUE")));
    assert!(add_plan
        .statements
        .iter()
        .any(|statement| statement.sql.contains("\"disabled\" boolean DEFAULT FALSE")));

    let create_plan = build_schema_diff_plan(
        &[("users".into(), src, schema(vec![]))],
        "mysql",
        "postgresql",
        PlanOptions {
            type_mapper: Some(&mapper),
            ..Default::default()
        },
    );
    let create = create_plan
        .statements
        .iter()
        .find(|statement| statement.sql.starts_with("CREATE TABLE"))
        .expect("CREATE TABLE statement");
    assert!(create.sql.contains("\"enabled\" boolean DEFAULT TRUE"));
    assert!(create.sql.contains("\"disabled\" boolean DEFAULT FALSE"));
}

#[test]
fn unknown_mysql_bit_boolean_default_blocks_postgres_ddl() {
    let mut active = col("active", "bit(1)");
    active.default_value = Some("1".into());
    let src = schema(vec![col("id", "int"), active]);
    let tgt = schema(vec![col("id", "int")]);
    let mapper = |_table: &str, ty: &str, _name: &str| -> Result<String, String> {
        if ty.trim().to_ascii_lowercase().starts_with("bit") {
            Ok("boolean".into())
        } else {
            Ok(ty.into())
        }
    };

    let plan = build_schema_diff_plan(
        &[("users".into(), src, tgt)],
        "mysql",
        "postgresql",
        PlanOptions {
            type_mapper: Some(&mapper),
            ..Default::default()
        },
    );

    assert!(plan.statements.is_empty());
    assert!(plan.requirements.iter().any(|requirement| matches!(
        requirement,
        PlanRequirement::Unsupported { operation, reason }
            if operation.contains("active") && reason.contains("`1`")
    )));
}

#[test]
fn unknown_mysql_boolean_default_blocks_postgres_ddl() {
    let mut active = col("active", "tinyint(1)");
    active.default_value = Some("2".into());
    let src = schema(vec![col("id", "int"), active]);
    let tgt = schema(vec![col("id", "int")]);
    let mapper = |_table: &str, ty: &str, _name: &str| -> Result<String, String> {
        if ty.to_ascii_lowercase().starts_with("tinyint(1)") {
            Ok("boolean".into())
        } else {
            Ok(ty.into())
        }
    };

    let plan = build_schema_diff_plan(
        &[("users".into(), src.clone(), tgt)],
        "mysql",
        "postgresql",
        PlanOptions {
            type_mapper: Some(&mapper),
            ..Default::default()
        },
    );

    assert!(plan.statements.is_empty());
    assert!(plan.requirements.iter().any(|requirement| matches!(
        requirement,
        PlanRequirement::Unsupported { operation, reason }
            if operation.contains("active") && reason.contains("`2`")
    )));

    let create_plan = build_schema_diff_plan(
        &[("users".into(), src, schema(vec![]))],
        "mysql",
        "postgresql",
        PlanOptions {
            type_mapper: Some(&mapper),
            ..Default::default()
        },
    );
    assert!(create_plan.statements.is_empty());
    assert!(create_plan.requirements.iter().any(|requirement| matches!(
        requirement,
        PlanRequirement::Unsupported { reason, .. } if reason.contains("`2`")
    )));
}

#[test]
fn changed_mysql_boolean_default_is_translated_for_postgres() {
    let mut source_active = col("active", "tinyint(1)");
    source_active.default_value = Some("0".into());
    let source = schema(vec![source_active]);
    let mut target_active = col("active", "boolean");
    target_active.default_value = Some("TRUE".into());
    let target = schema(vec![target_active]);
    let mapper = |_table: &str, ty: &str, _name: &str| -> Result<String, String> {
        if ty.to_ascii_lowercase().starts_with("tinyint(1)") {
            Ok("boolean".into())
        } else {
            Ok(ty.into())
        }
    };

    let plan = build_schema_diff_plan(
        &[("users".into(), source, target)],
        "mysql",
        "postgresql",
        PlanOptions {
            type_mapper: Some(&mapper),
            ..Default::default()
        },
    );

    let set_default = plan
        .statements
        .iter()
        .find(|statement| statement.sql.contains("SET DEFAULT FALSE"))
        .expect("mapped ALTER DEFAULT statement");
    assert!(set_default.sql.contains("SET DEFAULT FALSE"));
    assert!(!set_default.sql.contains("SET DEFAULT 0"));
}

#[test]
fn unknown_changed_mysql_boolean_default_blocks_postgres_default_ddl() {
    let mut source_active = col("active", "tinyint(1)");
    source_active.default_value = Some("2".into());
    let source = schema(vec![source_active]);
    let mut target_active = col("active", "boolean");
    target_active.default_value = Some("TRUE".into());
    let target = schema(vec![target_active]);
    let mapper = |_table: &str, ty: &str, _name: &str| -> Result<String, String> {
        if ty.to_ascii_lowercase().starts_with("tinyint(1)") {
            Ok("boolean".into())
        } else {
            Ok(ty.into())
        }
    };

    let plan = build_schema_diff_plan(
        &[("users".into(), source, target)],
        "mysql",
        "postgresql",
        PlanOptions {
            type_mapper: Some(&mapper),
            ..Default::default()
        },
    );

    assert!(plan.requirements.iter().any(|requirement| matches!(
        requirement,
        PlanRequirement::Unsupported { operation, reason }
            if operation.contains("active") && reason.contains("`2`")
    )));
    assert!(!plan
        .statements
        .iter()
        .any(|statement| statement.sql.contains("SET DEFAULT 2")));
}

#[test]
fn explicit_non_boolean_mysql_type_override_keeps_numeric_default() {
    let mut active = col("active", "tinyint(1)");
    active.default_value = Some("1".into());
    let src = schema(vec![col("id", "int"), active]);
    let tgt = schema(vec![col("id", "int")]);
    let mapper = |_table: &str, ty: &str, name: &str| -> Result<String, String> {
        if name == "active" {
            Ok("smallint".into())
        } else {
            Ok(ty.into())
        }
    };

    let plan = build_schema_diff_plan(
        &[("users".into(), src, tgt)],
        "mysql",
        "postgresql",
        PlanOptions {
            type_mapper: Some(&mapper),
            ..Default::default()
        },
    );

    assert!(plan.requirements.is_empty(), "{:?}", plan.requirements);
    assert!(plan
        .statements
        .iter()
        .any(|statement| { statement.sql.contains("\"active\" smallint DEFAULT 1") }));
    assert!(!plan
        .statements
        .iter()
        .any(|statement| statement.sql.contains("DEFAULT TRUE")));
}

#[test]
fn mysql_boolean_type_change_stages_defaults_around_postgres_alter_type() {
    let mapper = |_table: &str, ty: &str, _name: &str| -> Result<String, String> {
        if ty.to_ascii_lowercase().starts_with("tinyint(1)") {
            Ok("boolean".into())
        } else {
            Ok(ty.into())
        }
    };

    // Raw defaults match, but their meaning changes with the mapped type.
    let mut source_active = col("active", "tinyint(1)");
    source_active.default_value = Some("1".into());
    let mut target_active = col("active", "integer");
    target_active.default_value = Some("1".into());
    let plan = build_schema_diff_plan(
        &[(
            "users".into(),
            schema(vec![source_active.clone()]),
            schema(vec![target_active]),
        )],
        "mysql",
        "postgresql",
        PlanOptions {
            type_mapper: Some(&mapper),
            ..Default::default()
        },
    );

    assert!(plan.requirements.is_empty(), "{:?}", plan.requirements);
    let drop_default = plan
        .statements
        .iter()
        .position(|statement| statement.sql.contains("DROP DEFAULT"))
        .expect("old integer default is dropped");
    let alter_type = plan
        .statements
        .iter()
        .position(|statement| statement.sql.contains("TYPE boolean"))
        .expect("column is changed to boolean");
    let set_default = plan
        .statements
        .iter()
        .position(|statement| statement.sql.contains("SET DEFAULT TRUE"))
        .expect("mapped boolean default is installed");
    assert!(drop_default < alter_type && alter_type < set_default);

    // If the target has no default, there is nothing to drop, but the desired
    // source default still follows the type change.
    let plan_without_old_default = build_schema_diff_plan(
        &[(
            "users".into(),
            schema(vec![source_active]),
            schema(vec![col("active", "integer")]),
        )],
        "mysql",
        "postgresql",
        PlanOptions {
            type_mapper: Some(&mapper),
            ..Default::default()
        },
    );
    assert!(
        plan_without_old_default.requirements.is_empty(),
        "{:?}",
        plan_without_old_default.requirements
    );
    let alter_type = plan_without_old_default
        .statements
        .iter()
        .position(|statement| statement.sql.contains("TYPE boolean"))
        .expect("column is changed to boolean");
    let set_default = plan_without_old_default
        .statements
        .iter()
        .position(|statement| statement.sql.contains("SET DEFAULT TRUE"))
        .expect("mapped boolean default is installed");
    assert!(alter_type < set_default);
    assert!(!plan_without_old_default
        .statements
        .iter()
        .any(|statement| statement.sql.contains("DROP DEFAULT")));
}

#[test]
fn mysql_boolean_type_change_removes_old_default_before_alter_when_source_has_none() {
    let mut target_active = col("active", "integer");
    target_active.default_value = Some("1".into());
    let mapper = |_table: &str, ty: &str, _name: &str| -> Result<String, String> {
        if ty.to_ascii_lowercase().starts_with("tinyint(1)") {
            Ok("boolean".into())
        } else {
            Ok(ty.into())
        }
    };
    let plan = build_schema_diff_plan(
        &[(
            "users".into(),
            schema(vec![col("active", "tinyint(1)")]),
            schema(vec![target_active]),
        )],
        "mysql",
        "postgresql",
        PlanOptions {
            type_mapper: Some(&mapper),
            ..Default::default()
        },
    );

    assert!(plan.requirements.is_empty(), "{:?}", plan.requirements);
    let drop_default = plan
        .statements
        .iter()
        .position(|statement| statement.sql.contains("DROP DEFAULT"))
        .expect("old integer default is removed");
    let alter_type = plan
        .statements
        .iter()
        .position(|statement| statement.sql.contains("TYPE boolean"))
        .expect("column is changed to boolean");
    assert!(drop_default < alter_type);
    assert!(!plan
        .statements
        .iter()
        .any(|statement| statement.sql.contains("SET DEFAULT")));
}

#[test]
fn explicit_non_boolean_mysql_override_to_postgres_boolean_maps_only_zero_and_one() {
    let mut enabled = col("enabled", "int");
    enabled.default_value = Some("1".into());
    let mut disabled = col("disabled", "int");
    disabled.default_value = Some("0".into());
    let src = schema(vec![col("id", "int"), enabled, disabled]);
    let tgt = schema(vec![col("id", "int")]);
    let mapper = |_table: &str, ty: &str, name: &str| -> Result<String, String> {
        if matches!(name, "active" | "enabled" | "disabled") {
            Ok("boolean".into())
        } else {
            Ok(ty.into())
        }
    };
    let plan = build_schema_diff_plan(
        &[("users".into(), src, tgt)],
        "mysql",
        "postgresql",
        PlanOptions {
            type_mapper: Some(&mapper),
            ..Default::default()
        },
    );

    assert!(plan.requirements.is_empty(), "{:?}", plan.requirements);
    assert!(plan
        .statements
        .iter()
        .any(|statement| statement.sql.contains("\"enabled\" boolean DEFAULT TRUE")));
    assert!(plan
        .statements
        .iter()
        .any(|statement| statement.sql.contains("\"disabled\" boolean DEFAULT FALSE")));

    let mut source_existing = col("active", "int");
    source_existing.default_value = Some("1".into());
    let mut target_existing = col("active", "boolean");
    target_existing.default_value = Some("FALSE".into());
    let existing_column_plan = build_schema_diff_plan(
        &[(
            "users".into(),
            schema(vec![source_existing]),
            schema(vec![target_existing]),
        )],
        "mysql",
        "postgresql",
        PlanOptions {
            type_mapper: Some(&mapper),
            ..Default::default()
        },
    );
    assert!(
        existing_column_plan.requirements.is_empty(),
        "{:?}",
        existing_column_plan.requirements
    );
    let default_statements = existing_column_plan
        .statements
        .iter()
        .filter(|statement| statement.sql.contains("DEFAULT"))
        .collect::<Vec<_>>();
    assert_eq!(
        default_statements.len(),
        2,
        "{:?}",
        existing_column_plan.statements
    );
    assert!(default_statements[0].sql.contains("DROP DEFAULT"));
    assert!(default_statements[1].sql.contains("SET DEFAULT TRUE"));

    let mut invalid = col("active", "int");
    invalid.default_value = Some("2".into());
    let invalid_mapper =
        |_table: &str, _ty: &str, _name: &str| -> Result<String, String> { Ok("boolean".into()) };
    let invalid_plan = build_schema_diff_plan(
        &[("users".into(), schema(vec![invalid]), schema(vec![]))],
        "mysql",
        "postgresql",
        PlanOptions {
            type_mapper: Some(&invalid_mapper),
            ..Default::default()
        },
    );
    assert!(invalid_plan.statements.is_empty());
    assert!(invalid_plan.requirements.iter().any(|requirement| matches!(
        requirement,
        PlanRequirement::Unsupported { reason, .. } if reason.contains("`2`")
    )));

    let mut invalid_source = col("active", "int");
    invalid_source.default_value = Some("2".into());
    let mut current_target = col("active", "boolean");
    current_target.default_value = Some("FALSE".into());
    let invalid_default_change = build_schema_diff_plan(
        &[(
            "users".into(),
            schema(vec![invalid_source]),
            schema(vec![current_target]),
        )],
        "mysql",
        "postgresql",
        PlanOptions {
            type_mapper: Some(&mapper),
            ..Default::default()
        },
    );
    assert!(invalid_default_change.statements.is_empty());
    assert!(invalid_default_change
        .requirements
        .iter()
        .any(|requirement| matches!(
            requirement,
            PlanRequirement::Unsupported { reason, .. } if reason.contains("`2`")
        )));
}

#[test]
fn mysql_bit_boolean_defaults_map_to_numeric_override_or_fail_closed() {
    let mut enabled = col("enabled", "bit(1)");
    enabled.default_value = Some("b'1'".into());
    let mut disabled = col("disabled", "BIT");
    disabled.default_value = Some("0b0".into());
    let src = schema(vec![col("id", "int"), enabled, disabled]);
    let tgt = schema(vec![col("id", "int")]);
    let mapper =
        |_table: &str, _ty: &str, _name: &str| -> Result<String, String> { Ok("smallint".into()) };
    let plan = build_schema_diff_plan(
        &[("users".into(), src.clone(), tgt)],
        "mysql",
        "postgresql",
        PlanOptions {
            type_mapper: Some(&mapper),
            ..Default::default()
        },
    );

    assert!(plan.requirements.is_empty(), "{:?}", plan.requirements);
    assert!(plan
        .statements
        .iter()
        .any(|statement| statement.sql.contains("\"enabled\" smallint DEFAULT 1")));
    assert!(plan
        .statements
        .iter()
        .any(|statement| statement.sql.contains("\"disabled\" smallint DEFAULT 0")));

    let create_plan = build_schema_diff_plan(
        &[("users".into(), src.clone(), schema(vec![]))],
        "mysql",
        "postgresql",
        PlanOptions {
            type_mapper: Some(&mapper),
            ..Default::default()
        },
    );
    assert!(
        create_plan.requirements.is_empty(),
        "{:?}",
        create_plan.requirements
    );
    let create = create_plan
        .statements
        .iter()
        .find(|statement| statement.sql.starts_with("CREATE TABLE"))
        .expect("CREATE TABLE statement");
    assert!(create.sql.contains("\"enabled\" smallint DEFAULT 1"));
    assert!(create.sql.contains("\"disabled\" smallint DEFAULT 0"));

    let mut source_active = col("active", "bit(1)");
    source_active.default_value = Some("b'1'".into());
    let mut target_active = col("active", "smallint");
    target_active.default_value = Some("0".into());
    let default_change_plan = build_schema_diff_plan(
        &[(
            "users".into(),
            schema(vec![source_active]),
            schema(vec![target_active]),
        )],
        "mysql",
        "postgresql",
        PlanOptions {
            type_mapper: Some(&mapper),
            ..Default::default()
        },
    );
    assert!(
        default_change_plan.requirements.is_empty(),
        "{:?}",
        default_change_plan.requirements
    );
    assert!(default_change_plan
        .statements
        .iter()
        .any(|statement| statement.sql.contains("SET DEFAULT 1")));

    let mut invalid = col("active", "bit(1)");
    invalid.default_value = Some("b'10'".into());
    let invalid_plan = build_schema_diff_plan(
        &[("users".into(), schema(vec![invalid]), schema(vec![]))],
        "mysql",
        "postgresql",
        PlanOptions {
            type_mapper: Some(&mapper),
            ..Default::default()
        },
    );
    assert!(invalid_plan.statements.is_empty());
    assert!(invalid_plan.requirements.iter().any(|requirement| matches!(
        requirement,
        PlanRequirement::Unsupported { reason, .. } if reason.contains("b'10'")
    )));
}

#[test]
fn cross_dialect_mysql_detects_unbounded_text_type_suggestions() {
    let mut src = schema(vec![
        col("id", "int"),
        col("name", "text"),
        col("region", "text"),
        col("notes", "text"),
    ]);
    src.indexes.push(IndexInfo {
        name: "uq_demo_customers_name".into(),
        columns: vec!["name".into()],
        is_unique: true,
        is_primary: false,
        index_type: "BTREE".into(),
    });
    src.indexes.push(IndexInfo {
        name: "idx_demo_customers_region".into(),
        columns: vec!["region".into()],
        is_unique: false,
        is_primary: false,
        index_type: "BTREE".into(),
    });
    let tgt = schema(vec![]);

    let plan = build_schema_diff_plan(
        &[("demo_customers".into(), src, tgt)],
        "postgresql",
        "mysql",
        PlanOptions::default(),
    );

    assert_eq!(plan.type_suggestions.len(), 3);
    let name_sug = plan
        .type_suggestions
        .iter()
        .find(|s| s.column == "name")
        .expect("should have name suggestion");
    assert_eq!(name_sug.suggested_type, "VARCHAR(255)");
    assert!(name_sug.is_key_or_indexed);
    assert!(name_sug.reason.contains("Unique index"));

    let region_sug = plan
        .type_suggestions
        .iter()
        .find(|s| s.column == "region")
        .expect("should have region suggestion");
    assert_eq!(region_sug.suggested_type, "VARCHAR(255)");
    assert!(region_sug.is_key_or_indexed);
    assert!(region_sug.reason.contains("Indexed column"));

    let notes_sug = plan
        .type_suggestions
        .iter()
        .find(|s| s.column == "notes")
        .expect("should have notes suggestion");
    assert_eq!(notes_sug.suggested_type, "VARCHAR(255)");
    assert!(!notes_sug.is_key_or_indexed);
}

#[test]
fn type_mapping_uses_current_table_even_when_columns_and_source_types_match() {
    let mapper = |table: &str, _ty: &str, _column: &str| -> Result<String, String> {
        Ok(if table == "a" {
            "VARCHAR(128)"
        } else {
            "VARCHAR(512)"
        }
        .into())
    };
    for names in [["a", "b"], ["b", "a"]] {
        let pairs: Vec<_> = names
            .iter()
            .map(|name| {
                (
                    name.to_string(),
                    schema(vec![col("payload", "text")]),
                    schema(vec![]),
                )
            })
            .collect();
        let plan = build_schema_diff_plan(
            &pairs,
            "postgresql",
            "mysql",
            PlanOptions {
                type_mapper: Some(&mapper),
                ..Default::default()
            },
        );
        assert!(plan
            .statements
            .iter()
            .any(|s| s.sql.contains("`a`") && s.sql.contains("VARCHAR(128)")));
        assert!(plan
            .statements
            .iter()
            .any(|s| s.sql.contains("`b`") && s.sql.contains("VARCHAR(512)")));
    }
}

#[test]
fn unapproved_primary_key_replacement_produces_no_half_plan() {
    let mut source = schema(vec![col("id", "int"), col("new_id", "int")]);
    source.primary_keys = vec!["new_id".into()];
    let mut target = source.clone();
    target.primary_keys = vec!["id".into()];
    let plan = build_schema_diff_plan(
        &[("t".into(), source, target)],
        "postgresql",
        "postgresql",
        PlanOptions::default(),
    );
    assert!(plan.statements.is_empty());
    assert!(plan.warnings.iter().any(|w| w.contains("dependent")));
}

#[test]
fn test_tester_primary_key_removal_precedes_nullable_relaxation() {
    let source = schema(vec![col("id", "integer")]);
    let mut target = source.clone();
    target.columns[0].nullable = false;
    target.columns[0].is_primary_key = true;
    target.primary_keys = vec!["id".into()];
    let plan = build_schema_diff_plan(
        &[("users".into(), source, target)],
        "postgresql",
        "postgresql",
        PlanOptions {
            allow_destructive: true,
            include_indexes: true,
            ..PlanOptions::default()
        },
    );
    let drop_pk = plan
        .statements
        .iter()
        .position(|s| s.sql.contains("DROP CONSTRAINT"))
        .expect("PK drop");
    let nullable = plan
        .statements
        .iter()
        .position(|s| s.sql.contains("DROP NOT NULL"))
        .expect("nullable change");
    assert!(
        drop_pk < nullable,
        "PK must be removed before its column can become nullable: {:?}",
        plan.statements
    );
}

#[test]
fn test_tester_excluding_pk_drop_excludes_dependent_nullable_change() {
    let source = schema(vec![col("id", "integer"), col("extra", "text")]);
    let mut target = schema(vec![col("id", "integer")]);
    target.columns[0].nullable = false;
    target.columns[0].is_primary_key = true;
    target.primary_keys = vec!["id".into()];
    let plan = build_schema_diff_plan(
        &[("users".into(), source, target)],
        "postgresql",
        "postgresql",
        PlanOptions::default(),
    );
    assert!(
        !plan
            .statements
            .iter()
            .any(|s| s.sql.contains("DROP NOT NULL")),
        "Cannot relax nullability while retaining primary key"
    );
    assert!(
        plan.statements
            .iter()
            .any(|s| s.sql.contains("ADD COLUMN") && s.sql.contains("extra")),
        "unrelated additive operation must remain"
    );
}
