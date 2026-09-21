use super::*;
use crate::db::{ColumnSchema, ForeignKeyInfo, IndexInfo};

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
fn cross_dialect_foreign_key_reference_uses_target_relation_name() {
    let mut source = schema(vec![col("user_id", "int")]);
    source.foreign_keys.push(ForeignKeyInfo {
        name: "orders_user_id_fk".into(),
        columns: vec!["user_id".into()],
        referenced_table: "public.users".into(),
        referenced_columns: vec!["id".into()],
        on_update: "NO ACTION".into(),
        on_delete: "NO ACTION".into(),
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
