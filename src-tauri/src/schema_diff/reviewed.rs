//! Short-lived, one-shot backend plans. Client SQL and risk labels never authorize writes.
use super::{objects::SchemaObjectSnapshot, types::SchemaDiffPlan};
use datazen_driver_api::{ConnectionConfig, ConnectionHandle, TableSchema};
use std::{
    collections::HashMap,
    sync::LazyLock,
    time::{Duration, Instant},
};
use tokio::sync::Mutex;

pub struct ReviewedPlan {
    pub plan: SchemaDiffPlan,
    pub target_session: String,
    pub target_pool: String,
    pub target_identity: serde_json::Value,
    pub target_database_scope: Option<String>,
    pub target_schema_scope: Option<String>,
    pub snapshots: Vec<(String, TableSchema)>,
    pub has_complete_target_dependency_catalog: bool,
    pub target_dependency_schema_scope: Option<String>,
    pub object_snapshots: Vec<SchemaObjectSnapshot>,
    created: Instant,
}

static PLANS: LazyLock<Mutex<HashMap<String, ReviewedPlan>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

pub fn identity(config: &ConnectionConfig) -> serde_json::Value {
    serde_json::json!({"driver":config.database_type,"host":config.host,"port":config.port,
        "database":config.database,"schema":config.schema,"user":config.username,
        "options":config.options,"tunnel":config.ssh_tunnel})
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PhysicalDatabaseScope {
    Same,
    Different,
    Unknown,
}

pub async fn freeze(
    plan: &mut SchemaDiffPlan,
    session: String,
    handle: &ConnectionHandle,
    config: &ConnectionConfig,
    snapshots: Vec<(String, TableSchema)>,
    target_database_scope: Option<String>,
    target_schema_scope: Option<String>,
) {
    freeze_internal(
        plan,
        session,
        handle,
        config,
        snapshots,
        Vec::new(),
        target_database_scope,
        target_schema_scope,
        false,
        None,
    )
    .await;
}

pub async fn freeze_with_dependency_catalog(
    plan: &mut SchemaDiffPlan,
    session: String,
    handle: &ConnectionHandle,
    config: &ConnectionConfig,
    snapshots: Vec<(String, TableSchema)>,
    target_database_scope: Option<String>,
    target_schema_scope: Option<String>,
    dependency_schema_scope: Option<String>,
) {
    freeze_internal(
        plan,
        session,
        handle,
        config,
        snapshots,
        Vec::new(),
        target_database_scope,
        target_schema_scope,
        true,
        dependency_schema_scope,
    )
    .await;
}

pub async fn freeze_with_objects(
    plan: &mut SchemaDiffPlan,
    session: String,
    handle: &ConnectionHandle,
    config: &ConnectionConfig,
    snapshots: Vec<(String, TableSchema)>,
    object_snapshots: Vec<SchemaObjectSnapshot>,
    target_database_scope: Option<String>,
    target_schema_scope: Option<String>,
) {
    freeze_internal(
        plan,
        session,
        handle,
        config,
        snapshots,
        object_snapshots,
        target_database_scope,
        target_schema_scope,
        false,
        None,
    )
    .await;
}

#[allow(clippy::too_many_arguments)]
async fn freeze_internal(
    plan: &mut SchemaDiffPlan,
    session: String,
    handle: &ConnectionHandle,
    config: &ConnectionConfig,
    snapshots: Vec<(String, TableSchema)>,
    object_snapshots: Vec<SchemaObjectSnapshot>,
    target_database_scope: Option<String>,
    target_schema_scope: Option<String>,
    has_complete_target_dependency_catalog: bool,
    target_dependency_schema_scope: Option<String>,
) {
    let id = uuid::Uuid::new_v4().to_string();
    plan.plan_id = Some(id.clone());
    let mut plans = PLANS.lock().await;
    plans.retain(|_, p| p.created.elapsed() < Duration::from_secs(1800));
    // Keep memory bounded even when a window repeatedly prepares a plan.
    if plans.len() >= 128 {
        if let Some(oldest) = plans
            .iter()
            .min_by_key(|(_, p)| p.created)
            .map(|(id, _)| id.clone())
        {
            plans.remove(&oldest);
        }
    }
    plans.insert(
        id,
        ReviewedPlan {
            plan: plan.clone(),
            target_session: session,
            target_pool: handle.pool_id.clone(),
            target_identity: identity(config),
            target_database_scope,
            target_schema_scope,
            snapshots,
            has_complete_target_dependency_catalog,
            target_dependency_schema_scope,
            object_snapshots,
            created: Instant::now(),
        },
    );
}

pub async fn consume(
    submitted: &SchemaDiffPlan,
    session: &str,
    handle: &ConnectionHandle,
    config: &ConnectionConfig,
    target_database_scope: Option<&str>,
    target_schema_scope: Option<&str>,
) -> Result<ReviewedPlan, String> {
    let id = submitted
        .plan_id
        .as_ref()
        .ok_or("Prepare and review a new plan before deploying")?;
    let mut plans = PLANS.lock().await;
    let frozen = plans
        .get(id)
        .ok_or("Plan expired or already executed; compare again")?;
    validate(
        frozen,
        submitted,
        session,
        handle,
        config,
        target_database_scope,
        target_schema_scope,
    )?;
    plans
        .remove(id)
        .ok_or_else(|| "Plan already executed".into())
}

fn validate(
    frozen: &ReviewedPlan,
    submitted: &SchemaDiffPlan,
    session: &str,
    handle: &ConnectionHandle,
    config: &ConnectionConfig,
    target_database_scope: Option<&str>,
    target_schema_scope: Option<&str>,
) -> Result<(), String> {
    if frozen.created.elapsed() >= Duration::from_secs(1800) {
        return Err("Plan expired; compare again".into());
    }
    if frozen.plan != *submitted {
        return Err("Reviewed plan was modified; prepare again".into());
    }
    if frozen.target_session != session
        || frozen.target_pool != handle.pool_id
        || frozen.target_identity != identity(config)
    {
        return Err("Target identity changed after review; compare again".into());
    }
    if config.read_only {
        return Err("Target connection is read-only".into());
    }
    if normalized_scope(target_database_scope)
        != normalized_scope(frozen.target_database_scope.as_deref())
        || normalized_scope(target_schema_scope)
            != normalized_scope(frozen.target_schema_scope.as_deref())
    {
        return Err("Target database or schema scope changed after review; compare again".into());
    }
    Ok(())
}

fn normalized_scope(value: Option<&str>) -> Option<&str> {
    value.map(str::trim).filter(|value| !value.is_empty())
}

/// Configuration identity is a conservative local check; driver-provided physical
/// identity is required to recognize aliases and distinct tunnels to one server.
pub fn same_endpoint(source: &ConnectionConfig, target: &ConnectionConfig) -> bool {
    let source_dialect = crate::schema_diff::types::normalize_dialect(&source.database_type);
    let target_dialect = crate::schema_diff::types::normalize_dialect(&target.database_type);
    if source_dialect != target_dialect {
        return false;
    }
    let mut a = identity(source);
    let mut b = identity(target);
    if let Some(v) = a.as_object_mut() {
        v.remove("user");
        v.insert("driver".into(), serde_json::Value::String(source_dialect));
    }
    if let Some(v) = b.as_object_mut() {
        v.remove("user");
        v.insert("driver".into(), serde_json::Value::String(target_dialect));
    }
    a == b
}

/// Detect aliases that reach the same database through different connection
/// settings. Database and schema names are only used as proof of distinct
/// scopes when PostgreSQL's namespace rules make that conclusion reliable;
/// MySQL database names may be case-folded and SQLite paths may be hard links.
pub fn physical_database_scope(
    source: &ConnectionConfig,
    target: &ConnectionConfig,
    source_identity: Option<&str>,
    target_identity: Option<&str>,
    source_schema_scope: Option<&str>,
    target_schema_scope: Option<&str>,
) -> PhysicalDatabaseScope {
    let source_dialect = crate::schema_diff::types::normalize_dialect(&source.database_type);
    let target_dialect = crate::schema_diff::types::normalize_dialect(&target.database_type);
    if source_dialect != target_dialect {
        return PhysicalDatabaseScope::Different;
    }

    let source_schema = source_schema_scope
        .and_then(|value| normalized_scope(Some(value)))
        .or_else(|| normalized_scope(source.schema.as_deref()));
    let target_schema = target_schema_scope
        .and_then(|value| normalized_scope(Some(value)))
        .or_else(|| normalized_scope(target.schema.as_deref()));

    if let (Some(left), Some(right)) = (source_identity, target_identity) {
        if left != right {
            return PhysicalDatabaseScope::Different;
        }
        if source_dialect == "postgresql"
            && matches!((source_schema, target_schema), (Some(left), Some(right)) if left != right)
        {
            return PhysicalDatabaseScope::Different;
        }
        return PhysicalDatabaseScope::Same;
    }

    // PostgreSQL database names are case-sensitive catalog identities, and
    // schemas are separate namespaces inside a database. These names can
    // prove distinct scopes even when the server does not expose an identity.
    if source_dialect == "postgresql" {
        if matches!(
            (normalized_scope(source.database.as_deref()), normalized_scope(target.database.as_deref())),
            (Some(left), Some(right)) if left != right
        ) || matches!((source_schema, target_schema), (Some(left), Some(right)) if left != right)
        {
            return PhysicalDatabaseScope::Different;
        }
    }

    // MySQL can fold database names according to lower_case_table_names,
    // while SQLite paths can be aliases (including hard links). If the
    // driver could not provide a physical identity, spelling alone is not a
    // safe reason to allow a migration.
    PhysicalDatabaseScope::Unknown
}

pub fn validate_snapshot(
    table: &str,
    reviewed: &TableSchema,
    current: &TableSchema,
) -> Result<(), String> {
    fn relation_presentation_matches(identity: &str, reported_name: &str) -> bool {
        let (identity_scope, identity_relation) = identity
            .rsplit_once('.')
            .map_or((None, identity), |(scope, relation)| {
                (Some(scope), relation)
            });
        let (reported_scope, reported_relation) = reported_name
            .rsplit_once('.')
            .map_or((None, reported_name), |(scope, relation)| {
                (Some(scope), relation)
            });

        identity_relation == reported_relation
            && match (identity_scope, reported_scope) {
                (Some(identity_scope), Some(reported_scope)) => identity_scope == reported_scope,
                // Drivers may report an unqualified name after a schema has
                // already been supplied as a separate argument. The frozen
                // snapshot key remains the authoritative scoped identity.
                (Some(_), None) | (None, None) => true,
                // An unqualified frozen identity cannot prove that a
                // newly-qualified driver name belongs to the same schema.
                (None, Some(_)) => false,
            }
    }

    if !relation_presentation_matches(table, &reviewed.table_name)
        || !relation_presentation_matches(table, &current.table_name)
    {
        return Err(format!("Target schema changed for {table}; compare again"));
    }

    let mut reviewed_value = serde_json::to_value(reviewed).map_err(|e| e.to_string())?;
    let mut current_value = serde_json::to_value(current).map_err(|e| e.to_string())?;
    if let Some(object) = reviewed_value.as_object_mut() {
        object.remove("tableName");
    }
    if let Some(object) = current_value.as_object_mut() {
        object.remove("tableName");
    }
    if reviewed_value != current_value {
        return Err(format!("Target schema changed for {table}; compare again"));
    }
    Ok(())
}

pub fn validate_object_snapshot(
    reviewed: &SchemaObjectSnapshot,
    current: &SchemaObjectSnapshot,
) -> Result<(), String> {
    if reviewed.kind != current.kind
        || reviewed.schema != current.schema
        || reviewed.name != current.name
        || reviewed.signature != current.signature
        || reviewed.target_schema != current.target_schema
        || reviewed.target_name != current.target_name
        || reviewed.definition.trim() != current.definition.trim()
    {
        return Err(format!(
            "Target object {} changed after review; compare again",
            reviewed.name
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn config() -> ConnectionConfig {
        serde_json::from_value(serde_json::json!({"id":"target","name":"target","databaseType":"postgresql","host":"localhost","port":5432,"database":"test","connectionTimeout":30,"maxPoolSize":3})).unwrap()
    }
    fn plan() -> SchemaDiffPlan {
        serde_json::from_value(serde_json::json!({"table":"t","tables":["t"],"sourceDialect":"postgresql","targetDialect":"postgresql","sameDialect":true,"statements":[],"warnings":[],"requirements":[],"rollbackCompleteness":{"complete":true,"missing":[]}})).unwrap()
    }
    #[tokio::test]
    async fn reviewed_plan_rejects_client_mutation_wrong_target_and_replay() {
        let mut plan = plan();
        let config = config();
        let handle = ConnectionHandle {
            id: "session".into(),
            pool_id: "pool".into(),
        };
        freeze(
            &mut plan,
            "session".into(),
            &handle,
            &config,
            vec![],
            config.database.clone(),
            Some("public".into()),
        )
        .await;
        let mut tampered = plan.clone();
        tampered.warnings.push("client modification".into());
        assert!(consume(
            &tampered,
            "session",
            &handle,
            &config,
            config.database.as_deref(),
            Some("public"),
        )
        .await
        .is_err());
        assert!(consume(
            &plan,
            "other",
            &handle,
            &config,
            config.database.as_deref(),
            Some("public"),
        )
        .await
        .is_err());
        let mut changed = config.clone();
        changed.database = Some("other_database".into());
        assert!(consume(
            &plan,
            "session",
            &handle,
            &changed,
            changed.database.as_deref(),
            Some("public"),
        )
        .await
        .is_err());
        changed = config.clone();
        changed.read_only = true;
        assert!(consume(
            &plan,
            "session",
            &handle,
            &changed,
            changed.database.as_deref(),
            Some("public"),
        )
        .await
        .is_err());
        assert!(consume(
            &plan,
            "session",
            &handle,
            &config,
            config.database.as_deref(),
            Some("public"),
        )
        .await
        .is_ok());
        assert!(consume(
            &plan,
            "session",
            &handle,
            &config,
            config.database.as_deref(),
            Some("archive"),
        )
        .await
        .is_err());
    }
    #[test]
    fn self_target_is_independent_of_user_and_persisted_connection_id() {
        let a = config();
        let mut b = a.clone();
        b.id = "other".into();
        b.username = Some("other_user".into());
        assert!(same_endpoint(&a, &b));
        b.database = Some("other_database".into());
        assert!(!same_endpoint(&a, &b));
    }

    #[test]
    fn physical_database_scope_detects_aliases_and_fails_closed_when_unknown() {
        use PhysicalDatabaseScope::{Different, Same, Unknown};
        let a = config();
        let mut alias = a.clone();
        alias.id = "alias".into();
        alias.host = Some("db-alias.example".into());
        assert_eq!(
            physical_database_scope(
                &a,
                &alias,
                Some("postgresql:cluster:app"),
                Some("postgresql:cluster:app"),
                None,
                None,
            ),
            Same
        );

        let mut pg_alias = a.clone();
        pg_alias.database_type = "postgres".into();
        assert!(same_endpoint(&pg_alias, &a));
        assert_eq!(
            physical_database_scope(
                &pg_alias,
                &a,
                Some("postgresql:cluster:app"),
                Some("postgresql:cluster:app"),
                None,
                None,
            ),
            Same
        );

        alias.schema = Some("archive".into());
        assert_eq!(
            physical_database_scope(
                &a,
                &alias,
                Some("postgresql:cluster:app"),
                Some("postgresql:cluster:app"),
                Some("public"),
                Some("archive"),
            ),
            Different
        );
        assert_eq!(
            physical_database_scope(
                &a,
                &alias,
                Some("postgresql:cluster:app"),
                Some("mysql:cluster:app"),
                None,
                None,
            ),
            Different
        );
        assert_eq!(
            physical_database_scope(
                &a,
                &a,
                Some("postgresql:cluster:app"),
                Some("postgresql:cluster:app"),
                Some("public"),
                Some("archive"),
            ),
            Different
        );
        assert_eq!(
            physical_database_scope(&a, &alias, None, None, None, None),
            Unknown
        );
    }

    #[test]
    fn physical_scope_uses_mysql_identity_before_case_foldable_names() {
        use PhysicalDatabaseScope::{Same, Unknown};
        let mut source = config();
        source.database_type = "mysql".into();
        source.database = Some("AppDb".into());
        let mut target = source.clone();
        target.database = Some("appdb".into());

        assert_eq!(
            physical_database_scope(
                &source,
                &target,
                Some("mysql:server:canonical-app-db"),
                Some("mysql:server:canonical-app-db"),
                None,
                None,
            ),
            Same
        );
        assert_eq!(
            physical_database_scope(&source, &target, None, None, None, None),
            Unknown
        );
    }

    #[test]
    fn postgres_names_can_prove_distinct_database_or_schema_without_identity() {
        use PhysicalDatabaseScope::Different;
        let source = config();
        let mut different_database = source.clone();
        different_database.database = Some("another_db".into());
        assert_eq!(
            physical_database_scope(&source, &different_database, None, None, None, None),
            Different
        );

        let target = source.clone();
        assert_eq!(
            physical_database_scope(
                &source,
                &target,
                None,
                None,
                Some("public"),
                Some("archive"),
            ),
            Different
        );
    }
    #[test]
    fn target_snapshot_detects_structure_changed_after_review() {
        let old = TableSchema {
            table_name: "t".into(),
            columns: vec![],
            primary_keys: vec![],
            indexes: vec![],
            foreign_keys: vec![],
            check_constraints: vec![],
            table_options: Default::default(),
        };
        assert!(validate_snapshot("t", &old, &old).is_ok());
        let mut current = old.clone();
        current.primary_keys.push("id".into());
        assert!(validate_snapshot("t", &old, &current).is_err());
        current = old.clone();
        current.indexes.push(datazen_driver_api::IndexInfo {
            name: "external".into(),
            columns: vec!["id".into()],
            is_unique: false,
            is_primary: false,
            index_type: "btree".into(),
        });
        assert!(validate_snapshot("t", &old, &current).is_err());
    }

    #[test]
    fn pg_target_snapshot_accepts_qualified_prepare_name_and_bare_deploy_name() {
        let empty_missing = TableSchema {
            table_name: "public.missing".into(),
            columns: vec![],
            primary_keys: vec![],
            indexes: vec![],
            foreign_keys: vec![],
            check_constraints: vec![],
            table_options: Default::default(),
        };
        let mut deployed_missing = empty_missing.clone();
        deployed_missing.table_name = "missing".into();
        assert!(validate_snapshot("public.missing", &empty_missing, &deployed_missing).is_ok());

        let existing = TableSchema {
            table_name: "public.child".into(),
            columns: vec![datazen_driver_api::ColumnSchema {
                name: "parent_id".into(),
                data_type: "integer".into(),
                nullable: false,
                default_value: None,
                comment: None,
                is_primary_key: false,
                is_auto_increment: false,
            }],
            primary_keys: vec![],
            indexes: vec![],
            foreign_keys: vec![],
            check_constraints: vec![],
            table_options: Default::default(),
        };
        let mut unchanged = existing.clone();
        unchanged.table_name = "child".into();
        assert!(validate_snapshot("public.child", &existing, &unchanged).is_ok());

        let mut changed = unchanged.clone();
        changed
            .foreign_keys
            .push(datazen_driver_api::ForeignKeyInfo {
                name: "fk_child_parent".into(),
                columns: vec!["parent_id".into()],
                referenced_table: "public.parent".into(),
                referenced_columns: vec!["id".into()],
                on_update: "NO ACTION".into(),
                on_delete: "NO ACTION".into(),
                deferrability: datazen_driver_api::ForeignKeyDeferrability::NotDeferrable,
            });
        assert!(validate_snapshot("public.child", &existing, &changed).is_err());

        let mut wrong_schema = unchanged.clone();
        wrong_schema.table_name = "archive.child".into();
        assert!(validate_snapshot("public.child", &existing, &wrong_schema).is_err());

        let mut wrong_table = unchanged;
        wrong_table.table_name = "other_child".into();
        assert!(validate_snapshot("public.child", &existing, &wrong_table).is_err());

        let mut unqualified_reviewed = existing.clone();
        unqualified_reviewed.table_name = "child".into();
        let unexpectedly_qualified = TableSchema {
            table_name: "archive.child".into(),
            columns: vec![],
            primary_keys: vec![],
            indexes: vec![],
            foreign_keys: vec![],
            check_constraints: vec![],
            table_options: Default::default(),
        };
        assert!(
            validate_snapshot("child", &unqualified_reviewed, &unexpectedly_qualified).is_err()
        );
    }

    #[test]
    fn test_tester_target_snapshot_detects_check_constraint_changed_after_review() {
        let old = TableSchema {
            table_name: "t".into(),
            columns: vec![],
            primary_keys: vec![],
            indexes: vec![],
            foreign_keys: vec![],
            check_constraints: vec![datazen_driver_api::CheckConstraint {
                name: "t_positive_id".into(),
                expression: "id > 0".into(),
            }],
            table_options: Default::default(),
        };
        assert!(validate_snapshot("t", &old, &old).is_ok());
        let mut current = old.clone();
        current.check_constraints[0].expression = "id >= 0".into();
        assert!(validate_snapshot("t", &old, &current).is_err());
    }

    #[test]
    fn target_only_snapshot_detects_table_disappearing_after_review() {
        let reviewed = TableSchema {
            table_name: "archive".into(),
            columns: vec![datazen_driver_api::ColumnSchema {
                name: "id".into(),
                data_type: "integer".into(),
                nullable: false,
                default_value: None,
                comment: None,
                is_primary_key: true,
                is_auto_increment: false,
            }],
            primary_keys: vec!["id".into()],
            indexes: vec![],
            foreign_keys: vec![],
            check_constraints: vec![],
            table_options: Default::default(),
        };
        let disappeared = TableSchema {
            table_name: "archive".into(),
            columns: vec![],
            primary_keys: vec![],
            indexes: vec![],
            foreign_keys: vec![],
            check_constraints: vec![],
            table_options: Default::default(),
        };

        assert!(validate_snapshot("archive", &reviewed, &reviewed).is_ok());
        let error = validate_snapshot("archive", &reviewed, &disappeared).unwrap_err();
        assert!(error.contains("Target schema changed for archive"));
    }

    #[test]
    fn target_object_snapshot_detects_definition_or_identity_changes() {
        let old =
            SchemaObjectSnapshot::view(Some("public"), "active_users", "SELECT id FROM users");
        assert!(validate_object_snapshot(&old, &old).is_ok());
        let mut changed = old.clone();
        changed.definition = "SELECT id, email FROM users".into();
        assert!(validate_object_snapshot(&old, &changed).is_err());
        changed = old.clone();
        changed.schema = Some("other".into());
        assert!(validate_object_snapshot(&old, &changed).is_err());
    }

    #[test]
    fn test_tester_sequence_snapshot_detects_catalog_ddl_and_identity_changes() {
        let reviewed = SchemaObjectSnapshot::sequence(
            Some("public"),
            "orders_id_seq",
            "CREATE SEQUENCE \"public\".\"orders_id_seq\" AS bigint INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1 NO CYCLE;",
        );
        assert!(validate_object_snapshot(&reviewed, &reviewed).is_ok());
        let changed = SchemaObjectSnapshot::sequence(
            Some("public"),
            "orders_id_seq",
            "CREATE SEQUENCE \"public\".\"orders_id_seq\" AS bigint INCREMENT BY 2 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1 NO CYCLE;",
        );
        assert!(validate_object_snapshot(&reviewed, &changed).is_err());
        let wrong_identity =
            SchemaObjectSnapshot::sequence(Some("other"), "orders_id_seq", &reviewed.definition);
        assert!(validate_object_snapshot(&reviewed, &wrong_identity).is_err());
    }
    #[tokio::test]
    async fn test_tester_concurrent_deploy_consumes_exactly_once() {
        let mut plan = plan();
        let cfg = config();
        let handle = ConnectionHandle {
            id: "concurrent".into(),
            pool_id: "concurrent_pool".into(),
        };
        freeze(
            &mut plan,
            "concurrent".into(),
            &handle,
            &cfg,
            vec![],
            cfg.database.clone(),
            cfg.schema.clone(),
        )
        .await;
        let (a, b) = tokio::join!(
            consume(
                &plan,
                "concurrent",
                &handle,
                &cfg,
                cfg.database.as_deref(),
                cfg.schema.as_deref()
            ),
            consume(
                &plan,
                "concurrent",
                &handle,
                &cfg,
                cfg.database.as_deref(),
                cfg.schema.as_deref()
            )
        );
        assert_ne!(a.is_ok(), b.is_ok());
    }
    #[tokio::test]
    async fn test_tester_pool_change_rejected_without_consuming_valid_plan() {
        let mut plan = plan();
        let cfg = config();
        let handle = ConnectionHandle {
            id: "pooltest".into(),
            pool_id: "original".into(),
        };
        freeze(
            &mut plan,
            "pooltest".into(),
            &handle,
            &cfg,
            vec![],
            cfg.database.clone(),
            cfg.schema.clone(),
        )
        .await;
        let changed = ConnectionHandle {
            id: "pooltest".into(),
            pool_id: "replacement".into(),
        };
        assert!(consume(
            &plan,
            "pooltest",
            &changed,
            &cfg,
            cfg.database.as_deref(),
            cfg.schema.as_deref()
        )
        .await
        .is_err());
        assert!(consume(
            &plan,
            "pooltest",
            &handle,
            &cfg,
            cfg.database.as_deref(),
            cfg.schema.as_deref()
        )
        .await
        .is_ok());
    }
}
