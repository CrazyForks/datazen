//! Dedicated Data Sync execute IPC (bypasses sql_guard / execute_query).

use super::super::error::{CmdExt, CommandError};
use super::super::AppState;
use super::apply::generate_data_sync_sql_impl;
use super::plans::{self, StoredSyncPlan, SyncRunRequest, SyncRunSelection};
use crate::data_sync::{execute_statements, ExecutionResult, StatementExecutor, SyncOptions};
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
    let comparison = plans::load_comparison(plan).map_err(CommandError::Validation)?;
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
    comparison: &crate::data_sync::ComparisonResult,
    source: bool,
) -> Result<String, CommandError> {
    let mut entries = Vec::new();
    for table in comparison
        .tables
        .iter()
        .filter(|table| table.status == crate::data_sync::TableMappingStatus::Matched)
    {
        let relation = if source {
            &table.source_table
        } else {
            &table.target_table
        };
        let schema_snapshot = driver.get_table_schema(handle, relation).await.ok();
        entries.push((
            relation.clone(),
            schema_snapshot,
            table.source_filter.clone(),
        ));
    }
    plans::fingerprint_relations_with_filters(database, schema, entries)
        .map_err(CommandError::Validation)
}

fn validate_requested_options(
    plan: &StoredSyncPlan,
    options: &SyncOptions,
) -> Result<(), CommandError> {
    options.validate().map_err(CommandError::from)?;
    if options.matching_strategy != plan.options.matching_strategy
        || options.large_value_mode != plan.options.large_value_mode
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
    let comparison = plans::load_comparison(&plan).map_err(CommandError::Validation)?;
    if selection.revision != plan.selection_revision {
        return Err(CommandError::Validation(
            "selection revision is stale; return to comparison".into(),
        ));
    }
    validate_requested_options(&plan, &options)?;
    plans::validate_selection(&comparison, &selection, &options)
        .map_err(CommandError::Validation)?;
    let _context = validate_plan_context(state, &plan).await?;
    let comparison = plans::apply_selection(&comparison, &selection, &options)
        .map_err(CommandError::Validation)?;
    generate_data_sync_sql_impl(
        state,
        plan.target_db_session_id,
        comparison.tables,
        options,
        Some(plan.target_database),
        plan.target_schema,
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
    let comparison = plans::load_comparison(&plan).map_err(CommandError::Validation)?;
    if request.selection.revision != plan.selection_revision {
        return Err(CommandError::Validation(
            "selection revision is stale; return to comparison".into(),
        ));
    }
    validate_requested_options(&plan, &request.options)?;
    plans::validate_selection(&comparison, &request.selection, &request.options)
        .map_err(CommandError::Validation)?;
    let context = validate_plan_context(state, &plan).await?;
    let comparison = plans::apply_selection(&comparison, &request.selection, &request.options)
        .map_err(CommandError::Validation)?;
    let statements = generate_data_sync_sql_impl(
        state,
        plan.target_db_session_id.clone(),
        comparison.tables,
        request.options,
        Some(plan.target_database),
        plan.target_schema,
    )
    .await?;
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
    let result = execute_statements(&statements, &mut executor, cancelled)
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
