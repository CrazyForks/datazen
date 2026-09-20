use super::super::error::{CmdExt, CommandError};
use super::super::AppState;
use super::compare::count_rows;
use crate::store::SyncTask;

pub(crate) async fn get_sync_tasks_impl(state: &AppState) -> Result<Vec<SyncTask>, CommandError> {
    Ok(state.store.get_sync_tasks().await)
}

pub(crate) async fn save_sync_task_direct_impl(
    state: &AppState,
    task: SyncTask,
) -> Result<(), CommandError> {
    state
        .store
        .save_sync_task(task)
        .await
        .cmd_err("save_sync_task_direct")
}

struct ResolvedTaskEndpoint {
    db_session_id: String,
    dedicated: bool,
    driver: std::sync::Arc<dyn crate::db::DatabaseDriver>,
    handle: crate::db::ConnectionHandle,
    config: crate::db::ConnectionConfig,
}

async fn release_task_endpoint(state: &AppState, endpoint: &ResolvedTaskEndpoint) {
    if !endpoint.dedicated {
        return;
    }
    if let Err(error) = state
        .connection_manager
        .release(&endpoint.db_session_id)
        .await
    {
        tracing::warn!(
            db_session_id = %endpoint.db_session_id,
            %error,
            "Failed to release dedicated sync task session"
        );
    }
}

async fn release_task_session_if_dedicated(state: &AppState, db_session_id: &str, dedicated: bool) {
    if !dedicated {
        return;
    }
    if let Err(error) = state.connection_manager.release(db_session_id).await {
        tracing::warn!(
            db_session_id,
            %error,
            "Failed to release dedicated sync task session"
        );
    }
}

/// Resolve a persisted task endpoint from its stable connection id. A task's
/// runtime session ids are intentionally ignored: they are process-local and
/// may refer to a different database after restart. The connection manager
/// reuses a live session or safely establishes one from the stored config.
async fn resolve_task_endpoint(
    state: &AppState,
    connection_id: &str,
    database: Option<&str>,
    _schema: Option<&str>,
    label: &str,
) -> Result<ResolvedTaskEndpoint, CommandError> {
    let connection_id = connection_id.trim();
    if connection_id.is_empty() {
        return Err(CommandError::Validation(format!(
            "Sync task is missing its {label} connectionId; reopen the task and choose a connection"
        )));
    }

    let requested_database = database.filter(|value| !value.trim().is_empty());
    let (db_session_id, driver, handle, dedicated) = if let Some(database) = requested_database {
        // A persisted task may select a catalog other than the connection's
        // default. Reusing the connection's mutable session would leave
        // PostgreSQL attached to the wrong database, so always establish a
        // dedicated session with the saved override for this case.
        let db_session_id = state
            .connection_manager
            .connect_dedicated(connection_id, Some(database))
            .await
            .cmd_err("check_sync_conflicts")?;
        let (driver, handle) = match state
            .connection_manager
            .get_session(&db_session_id)
            .await
            .cmd_err("check_sync_conflicts")
        {
            Ok(session) => session,
            Err(error) => {
                release_task_session_if_dedicated(state, &db_session_id, true).await;
                return Err(error);
            }
        };
        (db_session_id, driver, handle, true)
    } else {
        let (db_session_id, driver, handle) = state
            .connection_manager
            .resolve_session_for_connection(connection_id)
            .await
            .cmd_err("check_sync_conflicts")?;
        (db_session_id, driver, handle, false)
    };
    let config = state
        .connection_manager
        .get_session_config(&db_session_id)
        .await
        .cmd_err("check_sync_conflicts");
    let config = match config {
        Ok(config) => config,
        Err(error) => {
            release_task_session_if_dedicated(state, &db_session_id, dedicated).await;
            return Err(error);
        }
    };

    // Keep database/schema explicit in the count and in the validation error.
    // A persisted task may outlive an edited connection config; silently
    // counting a different catalog would produce a false conflict result.
    if let Some(expected) = database.filter(|value| !value.trim().is_empty()) {
        if config.database.as_deref() != Some(expected) {
            let endpoint = ResolvedTaskEndpoint {
                db_session_id,
                dedicated,
                driver,
                handle,
                config,
            };
            release_task_endpoint(state, &endpoint).await;
            return Err(CommandError::Validation(format!(
                "Sync task {label} database '{}' is not active on connection '{}'; reopen the task and compare again",
                expected, connection_id
            )));
        }
    }
    // Schema is applied explicitly when qualifying the inspected relation,
    // so it may legitimately differ from the connection's mutable default
    // search schema. Keep the field in the task identity without requiring a
    // process-local search_path to match it.

    Ok(ResolvedTaskEndpoint {
        db_session_id,
        dedicated,
        driver,
        handle,
        config,
    })
}

pub(crate) async fn delete_sync_task_impl(
    state: &AppState,
    task_id: String,
) -> Result<(), CommandError> {
    state
        .store
        .delete_sync_task(&task_id)
        .await
        .cmd_err("delete_sync_task")
}

pub(crate) async fn check_sync_conflicts_impl(
    state: &AppState,
    task_id: String,
) -> Result<serde_json::Value, CommandError> {
    let tasks = state.store.get_sync_tasks().await;
    let task = tasks
        .iter()
        .find(|t| t.id == task_id)
        .ok_or_else(|| CommandError::NotFound("Sync task not found".into()))?;

    let source = resolve_task_endpoint(
        state,
        &task.source_connection_id,
        task.source_database.as_deref(),
        task.source_schema.as_deref(),
        "source",
    )
    .await?;
    // Resolve the target as well so a stale or deleted target cannot make the
    // task appear safe to resume. No target rows are read by this command.
    let target = match resolve_task_endpoint(
        state,
        &task.target_connection_id,
        task.target_database.as_deref(),
        task.target_schema.as_deref(),
        "target",
    )
    .await
    {
        Ok(target) => target,
        Err(error) => {
            release_task_endpoint(state, &source).await;
            return Err(error);
        }
    };

    let result = async {
        let mut conflicts = Vec::<serde_json::Value>::new();

        for table in &task.tables {
            if task.completed_tables.contains(table) {
                continue;
            }

            let original_count = task.source_row_counts.get(table).copied().unwrap_or(0);
            let current_count = count_rows(
                source.driver.as_ref(),
                &source.handle,
                &source.config.database_type,
                task.source_database
                    .as_deref()
                    .or(source.config.database.as_deref()),
                task.source_schema
                    .as_deref()
                    .or(source.config.schema.as_deref()),
                table,
            )
            .await?;

            if current_count != original_count {
                conflicts.push(serde_json::json!({
                    "table": table,
                    "originalRows": original_count,
                    "currentRows": current_count,
                }));
            }
        }

        Ok(serde_json::json!({
            "hasConflicts": !conflicts.is_empty(),
            "conflicts": conflicts,
        }))
    }
    .await;

    // Dedicated sessions are task-local resources. Release them on both the
    // successful result and every count_rows error path; ordinary reused UI
    // sessions remain owned by their existing callers.
    release_task_endpoint(state, &source).await;
    release_task_endpoint(state, &target).await;
    result
}
