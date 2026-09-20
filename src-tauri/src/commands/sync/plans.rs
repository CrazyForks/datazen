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
use crate::data_sync::{
    ChangeOperation, ComparisonResult, ConflictPolicy, RowChange, SyncOptions, SyncSourceFilter,
    TableMappingStatus, TableResult,
};

pub(crate) const SYNC_PLAN_TTL: Duration = Duration::from_secs(15 * 60);
/// Bounds one page sent over the review IPC. The server still owns the full
/// comparison and execution always reloads it from `ComparisonStore`.
pub(crate) const SYNC_COMPARISON_PAGE_SIZE: u32 = 100;
pub(crate) const SYNC_COMPARISON_PAGE_MAX_LIMIT: u32 = 500;
pub(crate) const SYNC_COMPARISON_CONTRACT_VERSION: u32 = 1;

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
pub(crate) struct SyncComparisonTableSummary {
    pub source_table: String,
    pub target_table: String,
    pub status: TableMappingStatus,
    pub incompatible_reason: Option<String>,
    pub columns: Vec<String>,
    pub column_types: Vec<String>,
    pub primary_keys: Vec<String>,
    pub unchanged_count: usize,
    pub insert_count: usize,
    pub update_count: usize,
    pub delete_count: usize,
    pub row_count: usize,
    pub page_size: u32,
    pub first_cursor: Option<String>,
    pub has_more: bool,
    pub warnings: Vec<String>,
    pub source_filter: Option<SyncSourceFilter>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SyncComparisonPreview {
    pub contract_version: u32,
    pub plan_id: String,
    pub selection_revision: u64,
    pub page_size: u32,
    pub tables: Vec<SyncComparisonTableSummary>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SyncComparisonPage {
    pub contract_version: u32,
    pub plan_id: String,
    pub source_table: String,
    pub target_table: String,
    pub cursor: Option<String>,
    pub next_cursor: Option<String>,
    pub has_more: bool,
    pub page_size: u32,
    pub rows: Vec<RowChange>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct SyncComparisonPageRequest {
    pub plan_id: String,
    pub source_table: String,
    pub target_table: String,
    pub cursor: Option<String>,
    pub limit: Option<u32>,
}

fn cursor_digest(plan_id: &str, source_table: &str, target_table: &str, offset: usize) -> String {
    format!(
        "{:x}",
        Sha256::digest(format!("{plan_id}\0{source_table}\0{target_table}\0{offset}").as_bytes())
    )
}

fn make_cursor(plan_id: &str, source_table: &str, target_table: &str, offset: usize) -> String {
    format!(
        "v{SYNC_COMPARISON_CONTRACT_VERSION}.{offset}.{}",
        cursor_digest(plan_id, source_table, target_table, offset)
    )
}

fn parse_cursor(
    plan_id: &str,
    source_table: &str,
    target_table: &str,
    cursor: &str,
    row_count: usize,
) -> Result<usize, String> {
    let mut parts = cursor.split('.');
    let version = parts.next();
    let offset = parts.next();
    let digest = parts.next();
    if parts.next().is_some() || version != Some("v1") {
        return Err("comparison cursor is invalid or belongs to another contract".into());
    }
    let offset = offset
        .and_then(|value| value.parse::<usize>().ok())
        .ok_or_else(|| "comparison cursor is invalid".to_string())?;
    let expected = cursor_digest(plan_id, source_table, target_table, offset);
    if digest != Some(expected.as_str()) {
        return Err("comparison cursor is invalid or belongs to another table".into());
    }
    if offset >= row_count {
        return Err("comparison cursor is outside the comparison result".into());
    }
    Ok(offset)
}

fn summary_for_table(plan_id: &str, table: &TableResult) -> SyncComparisonTableSummary {
    let row_count = table.rows.len();
    SyncComparisonTableSummary {
        source_table: table.source_table.clone(),
        target_table: table.target_table.clone(),
        status: table.status,
        incompatible_reason: table.incompatible_reason.clone(),
        columns: table.columns.clone(),
        column_types: table.column_types.clone(),
        primary_keys: table.primary_keys.clone(),
        unchanged_count: table.unchanged_row_count(),
        insert_count: table.insert_count(),
        update_count: table.update_count(),
        delete_count: table.delete_count(),
        row_count,
        page_size: SYNC_COMPARISON_PAGE_SIZE,
        first_cursor: (row_count > 0)
            .then(|| make_cursor(plan_id, &table.source_table, &table.target_table, 0)),
        has_more: row_count > SYNC_COMPARISON_PAGE_SIZE as usize,
        warnings: table.warnings.clone(),
        source_filter: table.source_filter.clone(),
    }
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
        let preview_tables = comparison
            .tables
            .iter()
            .map(|table| summary_for_table(&id, table))
            .collect();
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
            contract_version: SYNC_COMPARISON_CONTRACT_VERSION,
            plan_id: id,
            selection_revision,
            tables: preview_tables,
            page_size: SYNC_COMPARISON_PAGE_SIZE,
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

/// Read one review page from the server-owned comparison. The temporary JSON
/// store currently has no row index, so `load()` deserializes the full
/// comparison before slicing. IPC and UI memory are page-bounded; a future
/// disk-backed index can remove this remaining server-side allocation.
pub(crate) fn get_comparison_page(
    request: SyncComparisonPageRequest,
) -> Result<SyncComparisonPage, String> {
    let plan = peek_plan(&request.plan_id)?;
    if request.limit == Some(0) {
        return Err("comparison page limit must be greater than zero".into());
    }
    if request
        .limit
        .is_some_and(|value| value > SYNC_COMPARISON_PAGE_MAX_LIMIT)
    {
        return Err(format!(
            "comparison page limit cannot exceed {SYNC_COMPARISON_PAGE_MAX_LIMIT}"
        ));
    }
    let limit = request
        .limit
        .unwrap_or(SYNC_COMPARISON_PAGE_SIZE)
        .min(SYNC_COMPARISON_PAGE_MAX_LIMIT) as usize;
    let comparison = load_comparison(&plan)?;
    let table = comparison
        .tables
        .iter()
        .find(|table| {
            table.source_table == request.source_table && table.target_table == request.target_table
        })
        .ok_or_else(|| "table does not belong to the comparison plan".to_string())?;
    let offset = match request.cursor.as_deref() {
        Some(cursor) => parse_cursor(
            &request.plan_id,
            &request.source_table,
            &request.target_table,
            cursor,
            table.rows.len(),
        )?,
        None => 0,
    };
    let end = offset.saturating_add(limit).min(table.rows.len());
    let next_cursor = (end < table.rows.len()).then(|| {
        make_cursor(
            &request.plan_id,
            &request.source_table,
            &request.target_table,
            end,
        )
    });
    Ok(SyncComparisonPage {
        contract_version: SYNC_COMPARISON_CONTRACT_VERSION,
        plan_id: request.plan_id,
        source_table: table.source_table.clone(),
        target_table: table.target_table.clone(),
        cursor: request.cursor,
        next_cursor,
        has_more: end < table.rows.len(),
        page_size: limit as u32,
        rows: table.rows[offset..end].to_vec(),
    })
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
    fn comparison_preview_is_summary_only_and_pages_are_cursor_bound() {
        let source = MockDriver::new("postgres", MockDriverOptions::default());
        let target = MockDriver::new("postgres", MockDriverOptions::default());
        let options = SyncOptions::default();
        let rows = (0..205)
            .map(|value| {
                RowChange::insert(
                    vec![Value::Integer(value)],
                    vec![Some(Value::Integer(value))],
                    &options,
                )
            })
            .collect();
        let preview = issue_plan(
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
            ComparisonResult::new(vec![TableResult::matched("users", "users", rows)]),
            options,
            false,
        )
        .unwrap();
        let summary = &preview.tables[0];
        assert_eq!(summary.insert_count, 205);
        assert_eq!(summary.row_count, 205);
        assert!(summary.first_cursor.is_some());

        let first = get_comparison_page(SyncComparisonPageRequest {
            plan_id: preview.plan_id.clone(),
            source_table: "users".into(),
            target_table: "users".into(),
            cursor: summary.first_cursor.clone(),
            limit: Some(2),
        })
        .unwrap();
        assert_eq!(first.rows.len(), 2);
        assert!(first.has_more);
        assert_ne!(first.next_cursor, first.cursor);
        let repeated = get_comparison_page(SyncComparisonPageRequest {
            plan_id: preview.plan_id.clone(),
            source_table: "users".into(),
            target_table: "users".into(),
            cursor: first.cursor.clone(),
            limit: Some(2),
        })
        .unwrap();
        assert_eq!(
            serde_json::to_string(&repeated.rows[0].key).unwrap(),
            serde_json::to_string(&first.rows[0].key).unwrap()
        );

        let forged = get_comparison_page(SyncComparisonPageRequest {
            plan_id: preview.plan_id.clone(),
            source_table: "users".into(),
            target_table: "users".into(),
            cursor: Some("v1.999.not-a-valid-signature".into()),
            limit: Some(2),
        });
        assert!(forged.is_err());
        assert!(get_comparison_page(SyncComparisonPageRequest {
            plan_id: preview.plan_id.clone(),
            source_table: "unknown".into(),
            target_table: "users".into(),
            cursor: None,
            limit: Some(2),
        })
        .is_err());
        assert!(get_comparison_page(SyncComparisonPageRequest {
            plan_id: preview.plan_id,
            source_table: "users".into(),
            target_table: "users".into(),
            cursor: None,
            limit: Some(0),
        })
        .is_err());
    }

    #[test]
    fn comparison_page_rejects_claimed_plan_and_overlarge_limit() {
        let source = MockDriver::new("postgres", MockDriverOptions::default());
        let target = MockDriver::new("postgres", MockDriverOptions::default());
        let preview = issue_plan(
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
            ComparisonResult::new(vec![comparison().tables[0].clone()]),
            SyncOptions::default(),
            false,
        )
        .unwrap();
        assert!(get_comparison_page(SyncComparisonPageRequest {
            plan_id: preview.plan_id.clone(),
            source_table: "users".into(),
            target_table: "users".into(),
            cursor: None,
            limit: Some(SYNC_COMPARISON_PAGE_MAX_LIMIT + 1),
        })
        .is_err());
        let claimed = claim_plan(&preview.plan_id).unwrap();
        drop(claimed);
        assert!(get_comparison_page(SyncComparisonPageRequest {
            plan_id: preview.plan_id,
            source_table: "users".into(),
            target_table: "users".into(),
            cursor: None,
            limit: Some(1),
        })
        .is_err());
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
