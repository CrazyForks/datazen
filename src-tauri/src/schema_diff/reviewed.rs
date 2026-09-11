//! Short-lived, one-shot backend plans. Client SQL and risk labels never authorize writes.
use super::types::SchemaDiffPlan;
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
}
