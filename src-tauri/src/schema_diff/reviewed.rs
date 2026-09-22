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
    pub snapshots: Vec<(String, TableSchema)>,
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

pub async fn freeze(
    plan: &mut SchemaDiffPlan,
    session: String,
    handle: &ConnectionHandle,
    config: &ConnectionConfig,
    snapshots: Vec<(String, TableSchema)>,
) {
    freeze_with_objects(plan, session, handle, config, snapshots, Vec::new()).await;
}

pub async fn freeze_with_objects(
    plan: &mut SchemaDiffPlan,
    session: String,
    handle: &ConnectionHandle,
    config: &ConnectionConfig,
    snapshots: Vec<(String, TableSchema)>,
    object_snapshots: Vec<SchemaObjectSnapshot>,
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
            snapshots,
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
) -> Result<ReviewedPlan, String> {
    let id = submitted
        .plan_id
        .as_ref()
        .ok_or("Prepare and review a new plan before deploying")?;
    let mut plans = PLANS.lock().await;
    let frozen = plans
        .get(id)
        .ok_or("Plan expired or already executed; compare again")?;
    validate(frozen, submitted, session, handle, config)?;
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
    Ok(())
}

/// Configuration identity is a conservative local check; driver-provided physical
/// identity is required to recognize aliases and distinct tunnels to one server.
pub fn same_endpoint(source: &ConnectionConfig, target: &ConnectionConfig) -> bool {
    let mut a = identity(source);
    let mut b = identity(target);
    if let Some(v) = a.as_object_mut() {
        v.remove("user");
    }
    if let Some(v) = b.as_object_mut() {
        v.remove("user");
    }
    a == b
}

pub fn validate_snapshot(
    table: &str,
    reviewed: &TableSchema,
    current: &TableSchema,
) -> Result<(), String> {
    if serde_json::to_value(reviewed).map_err(|e| e.to_string())?
        != serde_json::to_value(current).map_err(|e| e.to_string())?
    {
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
        freeze(&mut plan, "session".into(), &handle, &config, vec![]).await;
        let mut tampered = plan.clone();
        tampered.warnings.push("client modification".into());
        assert!(consume(&tampered, "session", &handle, &config)
            .await
            .is_err());
        assert!(consume(&plan, "other", &handle, &config).await.is_err());
        let mut changed = config.clone();
        changed.database = Some("other_database".into());
        assert!(consume(&plan, "session", &handle, &changed).await.is_err());
        changed = config.clone();
        changed.read_only = true;
        assert!(consume(&plan, "session", &handle, &changed).await.is_err());
        assert!(consume(&plan, "session", &handle, &config).await.is_ok());
        assert!(consume(&plan, "session", &handle, &config).await.is_err());
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
    #[tokio::test]
    async fn test_tester_concurrent_deploy_consumes_exactly_once() {
        let mut plan = plan();
        let cfg = config();
        let handle = ConnectionHandle {
            id: "concurrent".into(),
            pool_id: "concurrent_pool".into(),
        };
        freeze(&mut plan, "concurrent".into(), &handle, &cfg, vec![]).await;
        let (a, b) = tokio::join!(
            consume(&plan, "concurrent", &handle, &cfg),
            consume(&plan, "concurrent", &handle, &cfg)
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
        freeze(&mut plan, "pooltest".into(), &handle, &cfg, vec![]).await;
        let changed = ConnectionHandle {
            id: "pooltest".into(),
            pool_id: "replacement".into(),
        };
        assert!(consume(&plan, "pooltest", &changed, &cfg).await.is_err());
        assert!(consume(&plan, "pooltest", &handle, &cfg).await.is_ok());
    }
}
