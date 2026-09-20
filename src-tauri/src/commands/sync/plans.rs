//! Server-owned immutable Data Synchronization comparison plans.
//!
//! The comparison response is useful for review, but it is not an execution
//! authority.  The complete reviewed comparison remains in this registry and
//! later commands receive only an opaque plan id plus a validated selection.

use std::collections::{HashMap, HashSet};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use datazen_driver_api::{iter_driver_factories, DatabaseDriver, TableSchema, PROTOCOL_VERSION};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use super::comparison_store::ComparisonStore;
#[cfg(test)]
use crate::data_sync::RowChange;
use crate::data_sync::{
    ChangeOperation, ComparisonResult, ConflictPolicy, SyncOptions, SyncSourceFilter,
    TableMappingStatus, TableResult,
};

pub(crate) const SYNC_PLAN_TTL: Duration = Duration::from_secs(15 * 60);

#[derive(Debug, Clone, Serialize)]
struct RelationFingerprintEntry {
    database: String,
    schema: Option<String>,
    relation: String,
    table_schema: Option<TableSchema>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    source_filter: Option<SyncSourceFilter>,
}

/// A deterministic identity for the qualified objects participating in a
/// reviewed comparison.  Endpoint identity is included in the hash so a
/// client cannot redirect an old plan to another database by changing UI
/// fields after review.
pub(crate) fn fingerprint_relations(
    database: &str,
    schema: Option<&str>,
    entries: impl IntoIterator<Item = (String, Option<TableSchema>)>,
) -> Result<String, String> {
    fingerprint_relations_with_filters(
        database,
        schema,
        entries
            .into_iter()
            .map(|(relation, table_schema)| (relation, table_schema, None)),
    )
}

/// Fingerprint the qualified schema plus the structured predicates that were
/// used for the reviewed comparison. Filter values are part of the plan
/// identity, so execution cannot silently reuse a plan for another scope.
pub(crate) fn fingerprint_relations_with_filters(
    database: &str,
    schema: Option<&str>,
    entries: impl IntoIterator<Item = (String, Option<TableSchema>, Option<SyncSourceFilter>)>,
) -> Result<String, String> {
    let mut entries: Vec<RelationFingerprintEntry> = entries
        .into_iter()
        .map(
            |(relation, table_schema, source_filter)| RelationFingerprintEntry {
                database: database.to_string(),
                schema: schema.map(str::to_string),
                relation,
                table_schema,
                source_filter,
            },
        )
        .collect();
    entries.sort_by(|left, right| {
        (&left.database, &left.schema, &left.relation).cmp(&(
            &right.database,
            &right.schema,
            &right.relation,
        ))
    });
    let bytes = serde_json::to_vec(&entries)
        .map_err(|error| format!("cannot fingerprint sync schema: {error}"))?;
    Ok(format!("{:x}", Sha256::digest(bytes)))
}

pub(crate) fn driver_protocol_version(driver: &dyn DatabaseDriver) -> u32 {
    let driver_type = driver.driver_type();
    iter_driver_factories()
        .into_iter()
        .find(|factory| factory.driver_id() == driver_type)
        .map(|factory| factory.protocol_version())
        .unwrap_or(PROTOCOL_VERSION)
}

pub(crate) fn fingerprint_conflict_policy(policy: ConflictPolicy) -> String {
    format!("{:x}", Sha256::digest(policy_name(policy).as_bytes()))
}

fn policy_name(policy: ConflictPolicy) -> &'static str {
    match policy {
        ConflictPolicy::Abort => "abort",
        ConflictPolicy::Skip => "skip",
        ConflictPolicy::Force => "force",
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct SyncSelectedRow {
    pub source_table: String,
    pub target_table: String,
    pub operation: ChangeOperation,
    pub key: Vec<datazen_driver_api::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct SyncRunSelection {
    pub revision: u64,
    #[serde(default)]
    pub rows: Vec<SyncSelectedRow>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct SyncRunRequest {
    pub plan_id: String,
    pub selection: SyncRunSelection,
    pub options: SyncOptions,
    pub job_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SyncComparisonPreview {
    pub plan_id: String,
    pub selection_revision: u64,
    pub tables: Vec<TableResult>,
}

#[derive(Debug, Clone)]
pub(crate) struct StoredSyncPlan {
    pub(crate) source_db_session_id: String,
    pub(crate) target_db_session_id: String,
    pub(crate) source_database: String,
    pub(crate) target_database: String,
    pub(crate) source_schema: Option<String>,
    pub(crate) target_schema: Option<String>,
    pub(crate) source_driver_type: String,
    pub(crate) target_driver_type: String,
    pub(crate) source_driver_protocol: u32,
    pub(crate) target_driver_protocol: u32,
    pub(crate) source_schema_fingerprint: String,
    pub(crate) target_schema_fingerprint: String,
    pub(crate) comparison: ComparisonStore,
    pub(crate) options: SyncOptions,
    pub(crate) conflict_policy_fingerprint: String,
    pub(crate) selection_revision: u64,
    pub(crate) target_read_only_at_preview: bool,
    expires_at: Instant,
}

pub(crate) struct SyncPlanStore {
    plans: Mutex<HashMap<String, StoredSyncPlan>>,
}

impl SyncPlanStore {
    pub(crate) fn new() -> Self {
        Self {
            plans: Mutex::new(HashMap::new()),
        }
    }

    #[allow(clippy::too_many_arguments)]
    pub(crate) fn issue(
        &self,
        source_db_session_id: String,
        target_db_session_id: String,
        source_database: String,
        target_database: String,
        source_schema: Option<String>,
        target_schema: Option<String>,
        source_driver: &dyn DatabaseDriver,
        target_driver: &dyn DatabaseDriver,
        source_schema_fingerprint: String,
        target_schema_fingerprint: String,
        comparison: ComparisonResult,
        options: SyncOptions,
        target_read_only_at_preview: bool,
    ) -> Result<SyncComparisonPreview, String> {
        let id = Uuid::new_v4().to_string();
        let selection_revision = 1;
        let preview_tables = comparison.tables.clone();
        let comparison = ComparisonStore::from_comparison(comparison)?;
        let conflict_policy_fingerprint = fingerprint_conflict_policy(options.conflict_policy);
        let plan = StoredSyncPlan {
            source_db_session_id,
            target_db_session_id,
            source_database,
            target_database,
            source_schema,
            target_schema,
            source_driver_type: source_driver.driver_type(),
            target_driver_type: target_driver.driver_type(),
            source_driver_protocol: driver_protocol_version(source_driver),
            target_driver_protocol: driver_protocol_version(target_driver),
            source_schema_fingerprint,
            target_schema_fingerprint,
            comparison,
            options,
            conflict_policy_fingerprint,
            selection_revision,
            target_read_only_at_preview,
            expires_at: Instant::now() + SYNC_PLAN_TTL,
        };
        let mut plans = self
            .plans
            .lock()
            .map_err(|_| "sync plan registry is unavailable".to_string())?;
        let now = Instant::now();
        plans.retain(|_, existing| existing.expires_at > now);
        plans.insert(id.clone(), plan);
        Ok(SyncComparisonPreview {
            plan_id: id,
            selection_revision,
            tables: preview_tables,
        })
    }

    pub(crate) fn peek(&self, id: &str) -> Result<StoredSyncPlan, String> {
        let mut plans = self
            .plans
            .lock()
            .map_err(|_| "sync plan registry is unavailable".to_string())?;
        let Some(plan) = plans.get(id) else {
            return Err("sync plan is unknown or has expired; return to comparison".into());
        };
        if plan.expires_at <= Instant::now() {
            plans.remove(id);
            return Err("sync plan has expired; return to comparison".into());
        }
        Ok(plan.clone())
    }

    /// Claim before a write starts.  A claimed plan remains consumed even if
    /// the transaction result is unknown, so the UI can never retry blindly.
    pub(crate) fn claim(&self, id: &str) -> Result<StoredSyncPlan, String> {
        let mut plans = self
            .plans
            .lock()
            .map_err(|_| "sync plan registry is unavailable".to_string())?;
        let Some(plan) = plans.remove(id) else {
            return Err("sync plan is unknown or has expired; return to comparison".into());
        };
        if plan.expires_at <= Instant::now() {
            return Err("sync plan has expired; return to comparison".into());
        }
        Ok(plan)
    }
}

impl Default for SyncPlanStore {
    fn default() -> Self {
        Self::new()
    }
}

fn global_store() -> &'static SyncPlanStore {
    static STORE: OnceLock<SyncPlanStore> = OnceLock::new();
    STORE.get_or_init(SyncPlanStore::new)
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn issue_plan(
    source_db_session_id: String,
    target_db_session_id: String,
    source_database: String,
    target_database: String,
    source_schema: Option<String>,
    target_schema: Option<String>,
    source_driver: &dyn DatabaseDriver,
    target_driver: &dyn DatabaseDriver,
    source_schema_fingerprint: String,
    target_schema_fingerprint: String,
    comparison: ComparisonResult,
    options: SyncOptions,
    target_read_only_at_preview: bool,
) -> Result<SyncComparisonPreview, String> {
    global_store().issue(
        source_db_session_id,
        target_db_session_id,
        source_database,
        target_database,
        source_schema,
        target_schema,
        source_driver,
        target_driver,
        source_schema_fingerprint,
        target_schema_fingerprint,
        comparison,
        options,
        target_read_only_at_preview,
    )
}

pub(crate) fn peek_plan(id: &str) -> Result<StoredSyncPlan, String> {
    global_store().peek(id)
}

pub(crate) fn claim_plan(id: &str) -> Result<StoredSyncPlan, String> {
    global_store().claim(id)
}

pub(crate) fn load_comparison(plan: &StoredSyncPlan) -> Result<ComparisonResult, String> {
    plan.comparison.load()
}

pub(crate) fn apply_selection(
    comparison: &ComparisonResult,
    selection: &SyncRunSelection,
    options: &SyncOptions,
) -> Result<ComparisonResult, String> {
    let mut seen = HashSet::new();
    let mut selected = HashSet::new();
    for row in &selection.rows {
        let token = selection_token(
            &row.source_table,
            &row.target_table,
            row.operation,
            &row.key,
        )?;
        if !seen.insert(token.clone()) {
            return Err("selection contains a duplicate row".into());
        }
        if !options.allows(row.operation) {
            return Err("selection contains an operation disabled by the requested options".into());
        }
        selected.insert(token);
    }

    let mut result = comparison.clone();
    for table in &mut result.tables {
        for change in &mut table.rows {
            change.selected = selected.contains(&selection_token(
                table.source_table.clone(),
                table.target_table.clone(),
                change.operation,
                &change.key,
            )?);
        }
    }
    Ok(result)
}

pub(crate) fn validate_selection(
    comparison: &ComparisonResult,
    selection: &SyncRunSelection,
    options: &SyncOptions,
) -> Result<(), String> {
    if selection.revision == 0 {
        return Err("selection revision is required".into());
    }
    let mut allowed = HashSet::new();
    for table in &comparison.tables {
        if table.status != TableMappingStatus::Matched {
            continue;
        }
        for change in &table.rows {
            allowed.insert(selection_token(
                &table.source_table,
                &table.target_table,
                change.operation,
                &change.key,
            )?);
        }
    }
    for row in &selection.rows {
        if !allowed.contains(&selection_token(
            &row.source_table,
            &row.target_table,
            row.operation,
            &row.key,
        )?) {
            return Err("selection contains a row that was not in the comparison plan".into());
        }
        if !options.allows(row.operation) {
            return Err("selection contains an operation disabled by the requested options".into());
        }
    }
    Ok(())
}

fn selection_token(
    source_table: impl AsRef<str>,
    target_table: impl AsRef<str>,
    operation: ChangeOperation,
    key: &[datazen_driver_api::Value],
) -> Result<String, String> {
    serde_json::to_string(&(source_table.as_ref(), target_table.as_ref(), operation, key))
        .map_err(|error| format!("cannot validate sync selection: {error}"))
}

#[cfg(test)]
pub(crate) fn selected_rows(
    comparison: &ComparisonResult,
    options: &SyncOptions,
) -> Vec<SyncSelectedRow> {
    comparison
        .tables
        .iter()
        .filter(|table| table.status == TableMappingStatus::Matched)
        .flat_map(|table| {
            table.rows.iter().filter_map(|change: &RowChange| {
                if change.selected && change.eligible_for_changeset(options) {
                    Some(SyncSelectedRow {
                        source_table: table.source_table.clone(),
                        target_table: table.target_table.clone(),
                        operation: change.operation,
                        key: change.key.clone(),
                    })
                } else {
                    None
                }
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::data_sync::{RowChange, TableResult};
    use crate::testing::mock_driver::{MockDriver, MockDriverOptions};
    use datazen_driver_api::Value;

    fn comparison() -> ComparisonResult {
        let options = SyncOptions::default();
        ComparisonResult::new(vec![TableResult::matched(
            "users",
            "users",
            vec![RowChange::insert(
                vec![Value::Integer(1)],
                vec![Some(Value::Integer(1))],
                &options,
            )],
        )])
    }

    #[test]
    fn selection_accepts_only_rows_from_the_server_comparison() {
        let selection = SyncRunSelection {
            revision: 1,
            rows: vec![SyncSelectedRow {
                source_table: "users".into(),
                target_table: "users".into(),
                operation: ChangeOperation::Insert,
                key: vec![Value::Integer(1)],
            }],
        };
        validate_selection(&comparison(), &selection, &SyncOptions::default()).unwrap();
        let bad = SyncRunSelection {
            rows: vec![SyncSelectedRow {
                key: vec![Value::Integer(2)],
                ..selection.rows[0].clone()
            }],
            ..selection
        };
        assert!(validate_selection(&comparison(), &bad, &SyncOptions::default()).is_err());
    }

    #[test]
    fn selected_rows_have_no_source_values_or_sql() {
        let rows = selected_rows(&comparison(), &SyncOptions::default());
        assert_eq!(rows.len(), 1);
        assert!(matches!(rows[0].key.as_slice(), [Value::Integer(1)]));
    }

    #[test]
    fn filter_values_are_part_of_relation_fingerprint() {
        let schema = datazen_driver_api::TableSchema {
            table_name: "users".into(),
            columns: vec![],
            primary_keys: vec![],
            indexes: vec![],
            foreign_keys: vec![],
        };
        let active: SyncSourceFilter = serde_json::from_value(serde_json::json!({
            "filters": [{"column": "status", "operator": "eq", "value": "active"}],
            "logic": "and"
        }))
        .unwrap();
        let archived: SyncSourceFilter = serde_json::from_value(serde_json::json!({
            "filters": [{"column": "status", "operator": "eq", "value": "archived"}],
            "logic": "and"
        }))
        .unwrap();
        let first = fingerprint_relations_with_filters(
            "db",
            Some("public"),
            vec![("users".into(), Some(schema.clone()), Some(active))],
        )
        .unwrap();
        let second = fingerprint_relations_with_filters(
            "db",
            Some("public"),
            vec![("users".into(), Some(schema), Some(archived))],
        )
        .unwrap();
        assert_ne!(first, second);
    }

    #[test]
    fn conflict_policy_has_a_distinct_plan_fingerprint() {
        assert_ne!(
            fingerprint_conflict_policy(ConflictPolicy::Abort),
            fingerprint_conflict_policy(ConflictPolicy::Skip)
        );
        assert_ne!(
            fingerprint_conflict_policy(ConflictPolicy::Skip),
            fingerprint_conflict_policy(ConflictPolicy::Force)
        );
    }

    #[test]
    fn run_request_rejects_client_replacement_sql_rows_or_mapping() {
        for field in [
            "statements",
            "tables",
            "mapping",
            "rows",
            "sourceDbSessionId",
        ] {
            let payload = serde_json::json!({
                "planId": "opaque-plan",
                "selection": { "revision": 1, "rows": [] },
                "options": SyncOptions::default(),
                "jobId": null,
                field: []
            });
            assert!(
                serde_json::from_value::<SyncRunRequest>(payload).is_err(),
                "client field {field} must be rejected"
            );
        }
    }

    #[test]
    fn expired_plan_drops_spilled_comparison_store() {
        let source = MockDriver::new("postgres", MockDriverOptions::default());
        let target = MockDriver::new("postgres", MockDriverOptions::default());
        let large = ComparisonResult::new(vec![TableResult::matched(
            "users",
            "users",
            vec![RowChange::insert(
                vec![Value::Integer(1)],
                vec![Some(Value::String("x".repeat(
                    super::super::comparison_store::COMPARISON_MEMORY_LIMIT + 1,
                )))],
                &SyncOptions::default(),
            )],
        )]);
        let store = SyncPlanStore::new();
        let preview = store
            .issue(
                "source-session".into(),
                "target-session".into(),
                "source-db".into(),
                "target-db".into(),
                None,
                None,
                source.as_ref(),
                target.as_ref(),
                "source-fingerprint".into(),
                "target-fingerprint".into(),
                large,
                SyncOptions::default(),
                false,
            )
            .unwrap();
        let path = {
            let plan = store.peek(&preview.plan_id).unwrap();
            plan.comparison.path().unwrap()
        };
        assert!(path.exists());
        store
            .plans
            .lock()
            .unwrap()
            .get_mut(&preview.plan_id)
            .unwrap()
            .expires_at = Instant::now() - Duration::from_secs(1);
        assert!(store.peek(&preview.plan_id).is_err());
        assert!(!path.exists());
    }

    #[test]
    fn claiming_plan_removes_owner_and_cleans_file_after_claimed_handle_drops() {
        let source = MockDriver::new("postgres", MockDriverOptions::default());
        let target = MockDriver::new("postgres", MockDriverOptions::default());
        let large = ComparisonResult::new(vec![TableResult::matched(
            "users",
            "users",
            vec![RowChange::insert(
                vec![Value::Integer(1)],
                vec![Some(Value::String("x".repeat(
                    super::super::comparison_store::COMPARISON_MEMORY_LIMIT + 1,
                )))],
                &SyncOptions::default(),
            )],
        )]);
        let store = SyncPlanStore::new();
        let preview = store
            .issue(
                "source-session".into(),
                "target-session".into(),
                "source-db".into(),
                "target-db".into(),
                None,
                None,
                source.as_ref(),
                target.as_ref(),
                "source-fingerprint".into(),
                "target-fingerprint".into(),
                large,
                SyncOptions::default(),
                false,
            )
            .unwrap();
        let claimed = store.claim(&preview.plan_id).unwrap();
        let path = claimed.comparison.path().unwrap();
        assert!(store.peek(&preview.plan_id).is_err());
        assert!(path.exists());
        drop(claimed);
        assert!(!path.exists());
    }
}
