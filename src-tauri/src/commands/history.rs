use super::error::{CmdExt, CommandError};
use super::AppState;
use crate::store::MigrationProfileRef;
use crate::store::{HistoryScope, MigrationRunFilter, MigrationRunPage, MigrationRunRecord};
use chrono::Utc;
use tauri::State;
use uuid::Uuid;

pub(crate) async fn start_migration_run(
    state: &AppState,
    operation: &str,
    profile: Option<&MigrationProfileRef>,
) -> MigrationRunRecord {
    let run = MigrationRunRecord {
        id: Uuid::new_v4().to_string(),
        operation: operation.into(),
        status: "running".into(),
        outcome: "pending".into(),
        phase: "execute".into(),
        profile_id: profile.map(|value| value.id.clone()),
        profile_revision: profile.map(|value| value.revision.clone()),
        source_connection_id: None,
        target_connection_id: None,
        started_at: Utc::now().to_rfc3339(),
        finished_at: None,
        selected_count: 0,
        committed_count: 0,
        failed_count: 0,
        conflict_count: 0,
        cancelled: false,
        rollback_outcome: "notRequired".into(),
        error_summary: None,
    };
    if let Err(error) = state.store.save_migration_run(&run).await {
        tracing::warn!(%error, operation, "failed to persist migration run start");
    }
    run
}

pub(crate) async fn finish_migration_run(
    state: &AppState,
    mut run: MigrationRunRecord,
    success: bool,
    cancelled: bool,
    committed: u64,
    failed: u64,
    conflicts: u64,
    rollback_outcome: &str,
) {
    run.status = if cancelled {
        "cancelled"
    } else if success {
        "completed"
    } else {
        "failed"
    }
    .into();
    run.outcome = if success {
        "success"
    } else if cancelled {
        "cancelled"
    } else {
        "failed"
    }
    .into();
    run.phase = "finished".into();
    run.finished_at = Some(Utc::now().to_rfc3339());
    run.committed_count = committed;
    run.failed_count = failed;
    run.conflict_count = conflicts;
    run.cancelled = cancelled;
    run.rollback_outcome = rollback_outcome.into();
    if !success && !cancelled {
        run.error_summary =
            Some("Execution failed; details are available in the application log".into());
    }
    if let Err(error) = state.store.save_migration_run(&run).await {
        tracing::warn!(%error, "failed to persist migration run completion");
    }
}

pub(crate) async fn purge_history_impl(
    state: &AppState,
    scope: String,
    retain_days: Option<u32>,
) -> Result<u64, CommandError> {
    let scope = HistoryScope::parse(&scope)
        .ok_or_else(|| CommandError::Validation(format!("Invalid history scope: {scope}")))?;
    tracing::info!(?scope, ?retain_days, "purge_history");
    state
        .store
        .purge_history(scope, retain_days)
        .await
        .cmd_err("purge_history")
}

#[tauri::command]
pub async fn purge_history(
    state: State<'_, AppState>,
    scope: String,
    retain_days: Option<u32>,
) -> Result<u64, CommandError> {
    purge_history_impl(&state, scope, retain_days).await
}

#[tauri::command]
pub async fn list_migration_runs(
    state: State<'_, AppState>,
    filter: Option<MigrationRunFilter>,
    offset: Option<u64>,
    limit: Option<u64>,
) -> Result<MigrationRunPage, CommandError> {
    state
        .store
        .list_migration_runs(
            &filter.unwrap_or_default(),
            offset.unwrap_or(0),
            limit.unwrap_or(25),
        )
        .await
        .cmd_err("list_migration_runs")
}

#[tauri::command]
pub async fn get_migration_run(
    state: State<'_, AppState>,
    run_id: String,
) -> Result<MigrationRunRecord, CommandError> {
    state
        .store
        .get_migration_run(&run_id)
        .await
        .cmd_err("get_migration_run")?
        .ok_or_else(|| CommandError::Validation("Migration run was not found".into()))
}

pub(crate) async fn validate_migration_profile_ref(
    state: &AppState,
    operation: &str,
    reference: Option<&MigrationProfileRef>,
) -> Result<(), CommandError> {
    let Some(reference) = reference else {
        return Ok(());
    };
    let actual = match operation {
        "dataSync" => state
            .store
            .get_sync_profiles()
            .await
            .into_iter()
            .find(|profile| profile.id == reference.id)
            .map(|profile| profile.updated_at.to_rfc3339()),
        "dataTransfer" => state
            .store
            .get_transfer_profiles()
            .await
            .into_iter()
            .find(|profile| profile.id == reference.id)
            .map(|profile| profile.updated_at.to_rfc3339()),
        "schemaDiff" => state
            .store
            .get_schema_diff_profiles()
            .await
            .into_iter()
            .find(|profile| profile.id == reference.id)
            .map(|profile| profile.updated_at.to_rfc3339()),
        _ => None,
    };
    let revisions_match = |actual: &str, expected: &str| {
        chrono::DateTime::parse_from_rfc3339(actual).ok()
            == chrono::DateTime::parse_from_rfc3339(expected).ok()
    };
    match actual {
        Some(actual) if revisions_match(&actual, &reference.revision) => Ok(()),
        Some(_) => Err(CommandError::Validation(
            "Migration profile changed; review and prepare the plan again".into(),
        )),
        None => Err(CommandError::Validation(
            "Migration profile is missing; execution was blocked".into(),
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::QueryHistoryEntry;
    use crate::testing::app_state::TestAppState;
    use chrono::Utc;
    use uuid::Uuid;

    fn sample_entry(sql: &str) -> QueryHistoryEntry {
        QueryHistoryEntry {
            id: Uuid::new_v4().to_string(),
            connection_id: "cfg1".into(),
            database: "app".into(),
            schema: None,
            sql: sql.into(),
            executed_at: Utc::now(),
            execution_time_ms: 1,
            rows_affected: None,
            success: true,
            error_message: None,
        }
    }

    #[tokio::test]
    async fn purge_history_clear_all_query_scope() {
        let test = TestAppState::new().await;
        test.store
            .add_query_history(sample_entry("SELECT 1"))
            .await
            .unwrap();

        let deleted = purge_history_impl(&test.state, "query".into(), None)
            .await
            .unwrap();
        assert_eq!(deleted, 1);
        assert!(test
            .store
            .get_query_history(10, None, None, None)
            .await
            .is_empty());
    }

    #[tokio::test]
    async fn purge_history_rejects_invalid_scope() {
        let test = TestAppState::new().await;
        let err = purge_history_impl(&test.state, "invalid".into(), Some(7))
            .await
            .unwrap_err();
        assert!(matches!(err, CommandError::Validation(_)));
    }

    #[tokio::test]
    async fn profile_reference_fails_closed_when_profile_is_missing() {
        let test = TestAppState::new().await;
        let reference = MigrationProfileRef {
            id: "removed-profile".into(),
            revision: Utc::now().to_rfc3339(),
        };
        let error = validate_migration_profile_ref(&test.state, "dataSync", Some(&reference))
            .await
            .unwrap_err();
        assert!(matches!(error, CommandError::Validation(_)));
    }
}
