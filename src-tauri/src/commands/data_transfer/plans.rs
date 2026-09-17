//! Server-owned immutable Data Transfer plans.
//!
//! A preview is the authority for a later run. The client receives only the
//! opaque id and may choose a subset of already planned tables plus the final
//! destructive confirmation. Endpoints, mappings, DDL and schema snapshots
//! remain private to this registry.

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use datazen_driver_api::{iter_driver_factories, DatabaseDriver, TableSchema, PROTOCOL_VERSION};
use serde::Serialize;
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::data_transfer::{TransferError, TransferJob, TransferPreview};

pub(crate) const TRANSFER_PLAN_TTL: Duration = Duration::from_secs(15 * 60);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PlanState {
    Available,
    Consumed,
}

/// Data needed to reproduce and validate the server-side execution plan.
/// This type is deliberately not serialized into the IPC response.
#[derive(Debug, Clone)]
pub(crate) struct StoredTransferPlan {
    pub(crate) id: String,
    pub(crate) job: TransferJob,
    pub(crate) can_execute: bool,
    pub(crate) source_driver_type: String,
    pub(crate) target_driver_type: String,
    pub(crate) source_driver_protocol: u32,
    pub(crate) target_driver_protocol: u32,
    pub(crate) source_schema_fingerprint: String,
    pub(crate) target_schema_fingerprint: String,
    /// Reserved for the filter contract. Until parameterized filters are
    /// supported by Transfer, all plans explicitly bind `None` here.
    pub(crate) filter: Option<String>,
    pub(crate) target_read_only_at_preview: bool,
    expires_at: Instant,
    state: PlanState,
}

#[derive(Debug, Serialize)]
struct SchemaFingerprintEntry {
    relation: String,
    schema: Option<TableSchema>,
}

/// Deterministic, lossless fingerprint of the schemas used by one plan.
/// Missing target schemas are included as `null`, so a table appearing after
/// preview invalidates a create-new plan as well.
pub(crate) fn fingerprint_schemas(
    entries: impl IntoIterator<Item = (String, Option<TableSchema>)>,
) -> Result<String, TransferError> {
    let mut entries: Vec<SchemaFingerprintEntry> = entries
        .into_iter()
        .map(|(relation, schema)| SchemaFingerprintEntry { relation, schema })
        .collect();
    entries.sort_by(|a, b| a.relation.cmp(&b.relation));
    let bytes = serde_json::to_vec(&entries).map_err(|error| {
        TransferError::validation(format!("cannot fingerprint schema: {error}"))
    })?;
    Ok(format!("{:x}", Sha256::digest(bytes)))
}

/// Return the relations that are part of the immutable execution snapshot.
///
/// Disabled mappings are a UI choice that the preview deliberately does not
/// inspect or execute. Keeping this scope in one helper is important: both
/// plan issuance and the preflight revalidation must hash the same relation
/// set, otherwise an existing disabled target can make an unchanged plan
/// stale merely because it was readable during execution.
pub(crate) fn participating_tables(
    job: &TransferJob,
) -> impl Iterator<Item = &crate::data_transfer::model::TableMapping> {
    job.tables.iter().filter(|table| table.enabled)
}

pub(crate) fn driver_protocol_version(driver: &dyn DatabaseDriver) -> u32 {
    let driver_type = driver.driver_type();
    iter_driver_factories()
        .into_iter()
        .find(|factory| factory.driver_id() == driver_type)
        .map(|factory| factory.protocol_version())
        .unwrap_or(PROTOCOL_VERSION)
}

pub(crate) struct TransferPlanStore {
    plans: Mutex<HashMap<String, StoredTransferPlan>>,
}

impl TransferPlanStore {
    pub(crate) fn new() -> Self {
        Self {
            plans: Mutex::new(HashMap::new()),
        }
    }

    pub(crate) fn issue(
        &self,
        job: TransferJob,
        preview: &TransferPreview,
        source_driver: &dyn DatabaseDriver,
        target_driver: &dyn DatabaseDriver,
        source_schemas: &HashMap<String, TableSchema>,
        target_schemas: &HashMap<String, TableSchema>,
        target_read_only: bool,
    ) -> Result<String, TransferError> {
        self.issue_with_ttl(
            job,
            preview,
            source_driver,
            target_driver,
            source_schemas,
            target_schemas,
            target_read_only,
            TRANSFER_PLAN_TTL,
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub(crate) fn issue_with_ttl(
        &self,
        job: TransferJob,
        preview: &TransferPreview,
        source_driver: &dyn DatabaseDriver,
        target_driver: &dyn DatabaseDriver,
        source_schemas: &HashMap<String, TableSchema>,
        target_schemas: &HashMap<String, TableSchema>,
        target_read_only: bool,
        ttl: Duration,
    ) -> Result<String, TransferError> {
        let source_entries = participating_tables(&job).map(|table| {
            (
                table.source_table.clone(),
                source_schemas.get(&table.source_table).cloned(),
            )
        });
        let target_entries = participating_tables(&job).map(|table| {
            (
                table.target_table.clone(),
                target_schemas.get(&table.target_table).cloned(),
            )
        });
        let source_schema_fingerprint = fingerprint_schemas(source_entries)?;
        let target_schema_fingerprint = fingerprint_schemas(target_entries)?;
        let id = Uuid::new_v4().to_string();
        let plan = StoredTransferPlan {
            id: id.clone(),
            job,
            can_execute: preview.can_execute,
            source_driver_type: source_driver.driver_type(),
            target_driver_type: target_driver.driver_type(),
            source_driver_protocol: driver_protocol_version(source_driver),
            target_driver_protocol: driver_protocol_version(target_driver),
            source_schema_fingerprint,
            target_schema_fingerprint,
            filter: None,
            target_read_only_at_preview: target_read_only,
            expires_at: Instant::now() + ttl,
            state: PlanState::Available,
        };
        let mut plans = self
            .plans
            .lock()
            .map_err(|_| TransferError::validation("transfer plan registry is unavailable"))?;
        let now = Instant::now();
        plans.retain(|_, existing| existing.expires_at > now);
        plans.insert(id.clone(), plan);
        Ok(id)
    }

    pub(crate) fn peek(&self, id: &str) -> Result<StoredTransferPlan, TransferError> {
        let mut plans = self
            .plans
            .lock()
            .map_err(|_| TransferError::validation("transfer plan registry is unavailable"))?;
        let Some(plan) = plans.get(id) else {
            return Err(TransferError::validation(
                "transfer plan is unknown or has expired; return to preview",
            ));
        };
        if plan.expires_at <= Instant::now() {
            plans.remove(id);
            return Err(TransferError::validation(
                "transfer plan has expired; return to preview",
            ));
        }
        if plan.state != PlanState::Available {
            return Err(TransferError::validation(
                "transfer plan was already consumed; return to preview",
            ));
        }
        Ok(plan.clone())
    }

    /// Atomically consume a plan. A consumed plan is never claimable again,
    /// including after an unknown commit/rollback outcome.
    pub(crate) fn claim(&self, id: &str) -> Result<StoredTransferPlan, TransferError> {
        let mut plans = self
            .plans
            .lock()
            .map_err(|_| TransferError::validation("transfer plan registry is unavailable"))?;
        let Some(plan) = plans.get_mut(id) else {
            return Err(TransferError::validation(
                "transfer plan is unknown or has expired; return to preview",
            ));
        };
        if plan.expires_at <= Instant::now() {
            plans.remove(id);
            return Err(TransferError::validation(
                "transfer plan has expired; return to preview",
            ));
        }
        if plan.state != PlanState::Available {
            return Err(TransferError::validation(
                "transfer plan was already consumed; return to preview",
            ));
        }
        plan.state = PlanState::Consumed;
        Ok(plan.clone())
    }
}

impl Default for TransferPlanStore {
    fn default() -> Self {
        Self::new()
    }
}

fn global_store() -> &'static TransferPlanStore {
    static STORE: OnceLock<TransferPlanStore> = OnceLock::new();
    STORE.get_or_init(TransferPlanStore::new)
}

pub(crate) fn issue_plan(
    job: TransferJob,
    preview: &TransferPreview,
    source_driver: &dyn DatabaseDriver,
    target_driver: &dyn DatabaseDriver,
    source_schemas: &HashMap<String, TableSchema>,
    target_schemas: &HashMap<String, TableSchema>,
    target_read_only: bool,
) -> Result<String, TransferError> {
    global_store().issue(
        job,
        preview,
        source_driver,
        target_driver,
        source_schemas,
        target_schemas,
        target_read_only,
    )
}

pub(crate) fn peek_plan(id: &str) -> Result<StoredTransferPlan, TransferError> {
    global_store().peek(id)
}

pub(crate) fn claim_plan(id: &str) -> Result<StoredTransferPlan, TransferError> {
    global_store().claim(id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::data_transfer::model::{
        Endpoint, TransferMode, TransferOptions, TransferRunRequest, WriteMode,
    };

    fn job() -> TransferJob {
        TransferJob {
            source: Endpoint {
                db_session_id: "src".into(),
                database: "source_db".into(),
                schema: Some("public".into()),
            },
            target: Endpoint {
                db_session_id: "tgt".into(),
                database: "target_db".into(),
                schema: Some("public".into()),
            },
            mode: TransferMode::Data,
            write_mode: WriteMode::Insert,
            tables: vec![],
            options: TransferOptions::default(),
        }
    }

    #[test]
    fn schema_fingerprint_is_order_independent_and_changes_with_schema() {
        let first = fingerprint_schemas(vec![("a".into(), None), ("b".into(), None)]).unwrap();
        let second = fingerprint_schemas(vec![("b".into(), None), ("a".into(), None)]).unwrap();
        assert_eq!(first, second);
        let changed = fingerprint_schemas(vec![
            ("a".into(), None),
            (
                "b".into(),
                Some(TableSchema {
                    table_name: "b".into(),
                    columns: vec![],
                    primary_keys: vec![],
                    indexes: vec![],
                    foreign_keys: vec![],
                }),
            ),
        ])
        .unwrap();
        assert_ne!(first, changed);
    }

    #[test]
    fn disabled_mappings_are_excluded_from_the_plan_fingerprint_scope() {
        let mut plan_job = job();
        plan_job
            .tables
            .push(crate::data_transfer::model::TableMapping::auto("users"));
        plan_job.tables.push({
            let mut mapping = crate::data_transfer::model::TableMapping::auto("archived");
            mapping.enabled = false;
            mapping
        });

        let users_schema = TableSchema {
            table_name: "users".into(),
            columns: vec![],
            primary_keys: vec![],
            indexes: vec![],
            foreign_keys: vec![],
        };
        let mut schemas: HashMap<String, TableSchema> = HashMap::new();
        schemas.insert("users".into(), users_schema.clone());
        schemas.insert(
            "archived".into(),
            TableSchema {
                table_name: "archived".into(),
                ..users_schema.clone()
            },
        );

        let scoped = fingerprint_schemas(participating_tables(&plan_job).map(|table| {
            (
                table.source_table.clone(),
                schemas.get(&table.source_table).cloned(),
            )
        }))
        .unwrap();
        let enabled_only = fingerprint_schemas(vec![("users".into(), Some(users_schema))]).unwrap();
        assert_eq!(scoped, enabled_only);

        // A schema change on a disabled relation cannot alter the immutable
        // snapshot, because that relation is outside the execution scope.
        schemas.insert(
            "archived".into(),
            TableSchema {
                table_name: "archived-v2".into(),
                ..TableSchema {
                    table_name: "archived".into(),
                    columns: vec![],
                    primary_keys: vec![],
                    indexes: vec![],
                    foreign_keys: vec![],
                }
            },
        );
        let after_disabled_change =
            fingerprint_schemas(participating_tables(&plan_job).map(|table| {
                (
                    table.source_table.clone(),
                    schemas.get(&table.source_table).cloned(),
                )
            }))
            .unwrap();
        assert_eq!(scoped, after_disabled_change);
    }

    #[test]
    fn expired_plan_is_rejected_and_consumed_plan_is_one_shot() {
        let store = TransferPlanStore::new();
        let driver = crate::testing::mock_driver::MockDriver::new("fixture", Default::default());
        let preview = TransferPreview {
            plan_id: String::new(),
            pairing_path: "direct".into(),
            mode: TransferMode::Data,
            write_mode: WriteMode::Insert,
            ddl: vec![],
            write_plans: vec![],
            warnings: vec![],
            can_execute: true,
            block_reason: None,
        };
        let source = HashMap::new();
        let target = HashMap::new();
        let id = store
            .issue_with_ttl(
                job(),
                &preview,
                driver.as_ref(),
                driver.as_ref(),
                &source,
                &target,
                false,
                Duration::from_secs(60),
            )
            .unwrap();
        let claimed = store.claim(&id).unwrap();
        assert_eq!(claimed.id, id);
        assert!(store.claim(&id).is_err());

        let expired = store
            .issue_with_ttl(
                job(),
                &preview,
                driver.as_ref(),
                driver.as_ref(),
                &source,
                &target,
                false,
                Duration::ZERO,
            )
            .unwrap();
        assert!(store.peek(&expired).is_err());
    }

    #[test]
    fn run_request_rejects_client_replacement_payloads() {
        let request = serde_json::from_value::<TransferRunRequest>(serde_json::json!({
            "planId": "opaque-plan",
            "job": { "source": {}, "target": {}, "tables": [] },
        }));
        assert!(request.is_err());
    }
}
