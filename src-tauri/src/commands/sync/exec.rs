//! Dedicated Data Sync execute IPC (bypasses sql_guard / execute_query).

use super::super::error::{CmdExt, CommandError};
use super::super::AppState;
use super::apply::generate_data_sync_sql_impl;
use super::comparison_store::{ComparisonStore, ComparisonTableMetadata};
use super::plans::{self, SelectionMatcher, StoredSyncPlan, SyncRunRequest, SyncRunSelection};
use crate::data_sync::{
    execute_statements, execute_statements_with_policy, ExecutionResult, StatementExecutor,
    SyncOptions,
};
use crate::db::{ConnectionHandle, DatabaseDriver, TransactionHandle, Value};
use async_trait::async_trait;
use std::sync::Arc;

struct LiveExecutor {
    driver: Arc<dyn DatabaseDriver>,
    handle: ConnectionHandle,
    read_only: bool,
    tx: Option<TransactionHandle>,
}

#[async_trait]
impl StatementExecutor for LiveExecutor {
    fn is_read_only(&self) -> bool {
        self.read_only
    }

    async fn begin(&mut self) -> Result<(), crate::data_sync::DataSyncError> {
        let tx = self
            .driver
            .begin_transaction(&self.handle)
            .await
            .map_err(|e| crate::data_sync::DataSyncError::validation(e.to_string()))?;
        self.tx = Some(tx);
        Ok(())
    }

    async fn execute(
        &mut self,
        sql: &str,
        params: &[Value],
    ) -> Result<u64, crate::data_sync::DataSyncError> {
        self.driver
            .execute_with_params(&self.handle, sql, params)
            .await
            .map_err(|e| crate::data_sync::DataSyncError::validation(e.to_string()))
    }

    async fn commit(&mut self) -> Result<(), crate::data_sync::DataSyncError> {
        if let Some(tx) = self.tx.take() {
            self.driver
                .commit(tx)
                .await
                .map_err(|e| crate::data_sync::DataSyncError::validation(e.to_string()))?;
        }
        Ok(())
    }

    async fn rollback(&mut self) -> Result<(), crate::data_sync::DataSyncError> {
        if let Some(tx) = self.tx.take() {
            self.driver
                .rollback(tx)
                .await
                .map_err(|e| crate::data_sync::DataSyncError::validation(e.to_string()))?;
        }
        Ok(())
    }
}

struct ValidatedSyncContext {
    target_driver: Arc<dyn DatabaseDriver>,
    target_handle: ConnectionHandle,
}

async fn validate_plan_context(
    state: &AppState,
    plan: &StoredSyncPlan,
) -> Result<ValidatedSyncContext, CommandError> {
    let comparison = plan
        .comparison
        .summaries()
        .map_err(CommandError::Validation)?;
    if plan.target_read_only_at_preview {
        return Err(CommandError::Validation(
            "target connection was read-only during comparison; return to comparison".into(),
        ));
    }
    let source_config = state
        .connection_manager
        .get_session_config(&plan.source_db_session_id)
        .await
        .cmd_err("validate_data_sync_plan")?;
    let target_config = state
        .connection_manager
        .get_session_config(&plan.target_db_session_id)
        .await
        .cmd_err("validate_data_sync_plan")?;
    if target_config.read_only {
        return Err(CommandError::Validation(
            "target connection is now read-only; return to comparison".into(),
        ));
    }
    validate_active_database(
        source_config.database.as_deref(),
        &plan.source_database,
        "source",
    )?;
    validate_active_database(
        target_config.database.as_deref(),
        &plan.target_database,
        "target",
    )?;
    let (source_driver, source_handle) = state
        .connection_manager
        .get_session(&plan.source_db_session_id)
        .await
        .cmd_err("validate_data_sync_plan")?;
    let (target_driver, target_handle) = state
        .connection_manager
        .get_session(&plan.target_db_session_id)
        .await
        .cmd_err("validate_data_sync_plan")?;
    if source_driver.driver_type() != plan.source_driver_type
        || target_driver.driver_type() != plan.target_driver_type
        || plans::driver_protocol_version(source_driver.as_ref()) != plan.source_driver_protocol
        || plans::driver_protocol_version(target_driver.as_ref()) != plan.target_driver_protocol
    {
        return Err(CommandError::Validation(
            "driver contract changed since comparison; return to comparison".into(),
        ));
    }
    let source_fingerprint = current_schema_fingerprint(
        source_driver.as_ref(),
        &source_handle,
        &plan.source_db_session_id,
        &plan.source_database,
        plan.source_schema.as_deref(),
        &comparison,
        true,
    )
    .await?;
    let target_fingerprint = current_schema_fingerprint(
        target_driver.as_ref(),
        &target_handle,
        &plan.target_db_session_id,
        &plan.target_database,
        plan.target_schema.as_deref(),
        &comparison,
        false,
    )
    .await?;
    if source_fingerprint != plan.source_schema_fingerprint
        || target_fingerprint != plan.target_schema_fingerprint
    {
        return Err(CommandError::Validation(
            "source or target schema/key changed since comparison; return to comparison".into(),
        ));
    }
    Ok(ValidatedSyncContext {
        target_driver,
        target_handle,
    })
}

fn validate_active_database(
    active_database: Option<&str>,
    planned_database: &str,
    side: &str,
) -> Result<(), CommandError> {
    let active = active_database
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let planned = planned_database.trim();
    if planned.is_empty() || active != Some(planned) {
        return Err(CommandError::Validation(format!(
            "{side} session active database changed or cannot be confirmed; return to comparison"
        )));
    }
    Ok(())
}

async fn current_schema_fingerprint(
    driver: &dyn DatabaseDriver,
    handle: &ConnectionHandle,
    _session_id: &str,
    database: &str,
    schema: Option<&str>,
    comparison: &[ComparisonTableMetadata],
    source: bool,
) -> Result<String, CommandError> {
    let mut entries = Vec::new();
    for table in comparison
        .iter()
        .filter(|table| table.table.status == crate::data_sync::TableMappingStatus::Matched)
    {
        let relation = if source {
            &table.table.source_table
        } else {
            &table.table.target_table
        };
        let schema_snapshot = driver
            .get_table_schema(handle, relation, database, schema)
            .await
            .ok();
        entries.push((
            relation.clone(),
            schema_snapshot,
            table.table.source_filter.clone(),
        ));
    }
    plans::fingerprint_relations_with_filters(database, schema, entries)
        .map_err(CommandError::Validation)
}

/// Generate SQL from a persisted comparison without reconstructing the
/// complete ComparisonResult. Each selected page is released after SQL for
/// that page has been produced; the returned SQL remains the public preview
/// contract and is therefore allowed to grow with the requested preview.
async fn generate_data_sync_sql_from_store_pages(
    state: &AppState,
    target_db_session_id: &str,
    comparison: &ComparisonStore,
    matcher: &SelectionMatcher,
    options: &SyncOptions,
    target_database: Option<&str>,
    target_schema: Option<&str>,
) -> Result<Vec<crate::data_sync::SqlStatement>, CommandError> {
    let summaries = comparison.summaries().map_err(CommandError::Validation)?;
    let mut statements = Vec::new();
    for table in summaries
        .iter()
        .filter(|table| table.table.status == crate::data_sync::TableMappingStatus::Matched)
    {
        let mut offset = 0usize;
        while offset < table.row_count {
            let rows = comparison
                .load_table_page(
                    &table.table.source_table,
                    &table.table.target_table,
                    offset,
                    plans::SYNC_COMPARISON_STREAM_PAGE_SIZE,
                )
                .map_err(CommandError::Validation)?;
            if rows.is_empty() {
                return Err(CommandError::Validation(
                    "comparison page did not advance while generating SQL".into(),
                ));
            }
            offset = offset.saturating_add(rows.len());
            let Some(table_page) = plans::selected_table_page(table, rows, matcher, options)
                .map_err(CommandError::Validation)?
            else {
                continue;
            };
            statements.extend(
                generate_data_sync_sql_impl(
                    state,
                    target_db_session_id.to_string(),
                    vec![table_page],
                    options.clone(),
                    target_database.map(str::to_string),
                    target_schema.map(str::to_string),
                )
                .await?,
            );
        }
    }
    Ok(statements)
}

fn validate_requested_options(
    plan: &StoredSyncPlan,
    options: &SyncOptions,
) -> Result<(), CommandError> {
    options.validate().map_err(CommandError::from)?;
    if options.matching_strategy != plan.options.matching_strategy
        || options.large_value_mode != plan.options.large_value_mode
        || options.conflict_policy != plan.options.conflict_policy
        || plans::fingerprint_conflict_policy(options.conflict_policy)
            != plan.conflict_policy_fingerprint
    {
        return Err(CommandError::Validation(
            "comparison options changed; return to comparison".into(),
        ));
    }
    Ok(())
}

pub(crate) async fn generate_data_sync_sql_for_plan_impl(
    state: &AppState,
    plan_id: String,
    selection: SyncRunSelection,
    options: SyncOptions,
) -> Result<Vec<crate::data_sync::SqlStatement>, CommandError> {
    let plan = plans::peek_plan(&plan_id).map_err(CommandError::Validation)?;
    if selection.revision != plan.selection_revision {
        return Err(CommandError::Validation(
            "selection revision is stale; return to comparison".into(),
        ));
    }
    validate_requested_options(&plan, &options)?;
    let matcher = plans::validate_selection_streaming(&plan.comparison, &selection, &options)
        .map_err(CommandError::Validation)?;
    let _context = validate_plan_context(state, &plan).await?;
    generate_data_sync_sql_from_store_pages(
        state,
        &plan.target_db_session_id,
        &plan.comparison,
        &matcher,
        &options,
        Some(&plan.target_database),
        plan.target_schema.as_deref(),
    )
    .await
}

pub(crate) async fn execute_data_sync_plan_impl(
    state: &AppState,
    request: SyncRunRequest,
) -> Result<ExecutionResult, CommandError> {
    if request.plan_id.trim().is_empty() {
        return Err(CommandError::Validation(
            "execute_data_sync requires a comparison planId".into(),
        ));
    }
    let plan = plans::peek_plan(&request.plan_id).map_err(CommandError::Validation)?;
    if request.selection.revision != plan.selection_revision {
        return Err(CommandError::Validation(
            "selection revision is stale; return to comparison".into(),
        ));
    }
    validate_requested_options(&plan, &request.options)?;
    let matcher =
        plans::validate_selection_streaming(&plan.comparison, &request.selection, &request.options)
            .map_err(CommandError::Validation)?;
    let context = validate_plan_context(state, &plan).await?;
    let conflict_policy = request.options.conflict_policy;
    let statements = generate_data_sync_sql_from_store_pages(
        state,
        &plan.target_db_session_id,
        &plan.comparison,
        &matcher,
        &request.options,
        Some(&plan.target_database),
        plan.target_schema.as_deref(),
    )
    .await?;
    if statements.is_empty() {
        return Err(CommandError::Validation(
            "change set is empty; nothing to execute".into(),
        ));
    }
    // Claim immediately before the first transaction side effect. A failed
    // preflight leaves a valid plan available for a corrected comparison;
    // once claimed, an unknown result is never silently retried.
    let _claimed = plans::claim_plan(&request.plan_id).map_err(CommandError::Validation)?;
    let config = state
        .connection_manager
        .get_session_config(&plan.target_db_session_id)
        .await
        .cmd_err("execute_data_sync")?;
    let mut executor = LiveExecutor {
        driver: context.target_driver,
        handle: context.target_handle,
        read_only: config.read_only,
        tx: None,
    };
    let cancelled = match request.job_id.as_deref() {
        Some(id) => Some(super::jobs::ensure_job(id).await),
        None => None,
    };
    let result =
        execute_statements_with_policy(&statements, &mut executor, cancelled, conflict_policy)
            .await
            .map_err(CommandError::from);
    if let Some(id) = request.job_id.as_deref() {
        super::jobs::remove_job(id).await;
    }
    result
}

// Kept only for the existing Rust command-path unit tests.  This helper is
// cfg(test) and is not registered as an IPC command; production execution can
// only enter through `execute_data_sync_plan_impl`.
#[cfg(test)]
pub(crate) async fn execute_data_sync_impl(
    state: &AppState,
    target_db_session_id: String,
    statements: Vec<crate::data_sync::SqlStatement>,
    job_id: Option<String>,
    _target_database: Option<String>,
) -> Result<ExecutionResult, CommandError> {
    let config = state
        .connection_manager
        .get_session_config(&target_db_session_id)
        .await
        .cmd_err("execute_data_sync")?;
    let (driver, handle) = state
        .connection_manager
        .get_session(&target_db_session_id)
        .await
        .cmd_err("execute_data_sync")?;
    let mut executor = LiveExecutor {
        driver,
        handle,
        read_only: config.read_only,
        tx: None,
    };
    let cancelled = match job_id.as_deref() {
        Some(id) => Some(super::jobs::ensure_job(id).await),
        None => None,
    };
    let result = execute_statements(&statements, &mut executor, cancelled)
        .await
        .map_err(CommandError::from);
    if let Some(id) = job_id.as_deref() {
        super::jobs::remove_job(id).await;
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::sync::plans::{
        SelectionMatcher, SyncRunSelection, SyncSelectionMode, SyncTableSelection,
    };
    use crate::data_sync::{
        ChangeOperation, ComparisonResult, ConflictPolicy, RowChange, TableResult,
    };
    use crate::testing::app_state::TestAppState;

    #[tokio::test]
    async fn test_tester_streaming_sql_generation_preserves_cross_page_order_and_policy() {
        let test = TestAppState::with_tables().await;
        test.save_and_connect("sync-stream-target").await;
        let target_db_session_id = test.connect_config("sync-stream-target").await;

        let mut options = SyncOptions::default();
        options.conflict_policy = ConflictPolicy::Force;
        let mut rows = Vec::with_capacity(plans::SYNC_COMPARISON_STREAM_PAGE_SIZE + 1);
        rows.push(RowChange::insert(
            vec![Value::Integer(0)],
            vec![
                Some(Value::Integer(0)),
                Some(Value::String("x".repeat(
                    super::super::comparison_store::COMPARISON_MEMORY_LIMIT + 1,
                ))),
            ],
            &options,
        ));
        rows.extend((1..plans::SYNC_COMPARISON_STREAM_PAGE_SIZE).map(|key| {
            RowChange::insert(
                vec![Value::Integer(key as i64)],
                vec![
                    Some(Value::Integer(key as i64)),
                    Some(Value::String(format!("name-{key}"))),
                ],
                &options,
            )
        }));
        rows.push(RowChange::update(
            vec![Value::Integer(
                plans::SYNC_COMPARISON_STREAM_PAGE_SIZE as i64,
            )],
            vec![
                Some(Value::Integer(
                    plans::SYNC_COMPARISON_STREAM_PAGE_SIZE as i64,
                )),
                Some(Value::String("new-name".into())),
            ],
            vec![
                Some(Value::Integer(
                    plans::SYNC_COMPARISON_STREAM_PAGE_SIZE as i64,
                )),
                Some(Value::String("old-name".into())),
            ],
            vec!["name".into()],
            &options,
        ));
        let mut table = TableResult::matched("users", "users", rows);
        table.columns = vec!["id".into(), "name".into()];
        table.column_types = vec!["integer".into(), "text".into()];
        table.primary_keys = vec!["id".into()];
        let comparison = ComparisonStore::from_comparison(ComparisonResult::new(vec![table]))
            .expect("comparison should persist");
        assert!(comparison.is_spilled());

        let selection = SyncRunSelection {
            revision: 1,
            rows: Vec::new(),
            scopes: vec![SyncTableSelection {
                source_table: "users".into(),
                target_table: "users".into(),
                selection_mode: SyncSelectionMode::All,
                operations: vec![ChangeOperation::Insert, ChangeOperation::Update],
                excluded_rows: Vec::new(),
            }],
        };
        let matcher = SelectionMatcher::new(&selection, &options).expect("selection should match");
        let statements = generate_data_sync_sql_from_store_pages(
            &test.state,
            &target_db_session_id,
            &comparison,
            &matcher,
            &options,
            Some("app"),
            None,
        )
        .await
        .expect("streamed SQL should generate");

        assert_eq!(
            statements.len(),
            plans::SYNC_COMPARISON_STREAM_PAGE_SIZE + 1
        );
        assert!(matches!(
            statements
                .first()
                .map(|statement| statement.row_key.as_slice()),
            Some([Value::Integer(0)])
        ));
        assert!(matches!(
            statements.last().map(|statement| statement.operation),
            Some(ChangeOperation::Update)
        ));
        assert!(matches!(
            statements.last().map(|statement| statement.row_key.as_slice()),
            Some([Value::Integer(key)])
                if *key == plans::SYNC_COMPARISON_STREAM_PAGE_SIZE as i64
        ));
        assert_eq!(
            statements
                .last()
                .map(|statement| statement.parameters.len()),
            Some(2),
            "force policy must omit optimistic target-row predicates"
        );
        assert_eq!(comparison.full_load_calls(), 0);
        assert_eq!(
            test.mock.get_schema_calls(),
            2,
            "501 rows must be generated as two independently bounded pages"
        );
    }
}
