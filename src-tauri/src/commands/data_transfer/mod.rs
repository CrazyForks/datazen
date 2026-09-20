//! Data Transfer IPC commands.

mod exec;
mod inspect;
mod jobs;
mod plans;
mod preview;
mod types;

#[cfg(test)]
mod tests;

use super::error::CommandError;
use super::AppState;
use crate::data_transfer::{
    classify_transfer_pair as classify_transfer_pair_impl, TableInspectResult,
    TransferExecutionResult, TransferJob, TransferMode, TransferPreview, TransferProfile,
    TransferRunRequest,
};
pub(crate) use exec::execute_data_transfer_impl;
pub(crate) use inspect::{inspect_data_transfer_impl, inspect_sql_file_transfer_impl};
pub(crate) use jobs::cancel_job;
pub(crate) use preview::preview_data_transfer_impl;
use tauri::{AppHandle, State};

#[tauri::command]
pub async fn get_transfer_profiles(
    state: State<'_, AppState>,
) -> Result<Vec<TransferProfile>, CommandError> {
    Ok(state.store.get_transfer_profiles().await)
}

#[tauri::command]
pub async fn save_transfer_profile(
    state: State<'_, AppState>,
    mut profile: TransferProfile,
) -> Result<(), CommandError> {
    profile.validate().map_err(CommandError::Validation)?;
    if state
        .store
        .get_connection(&profile.source_connection_id)
        .await
        .is_none()
    {
        return Err(CommandError::Validation(
            "transfer profile source connection no longer exists".into(),
        ));
    }
    if let Some(target) = profile.target_connection_id.as_deref() {
        if state.store.get_connection(target).await.is_none() {
            return Err(CommandError::Validation(
                "transfer profile target connection no longer exists".into(),
            ));
        }
    }
    profile.updated_at = chrono::Utc::now();
    state
        .store
        .save_transfer_profile(profile)
        .await
        .map_err(|error| CommandError::Internal(error.to_string()))
}

#[tauri::command]
pub async fn delete_transfer_profile(
    state: State<'_, AppState>,
    profile_id: String,
) -> Result<(), CommandError> {
    state
        .store
        .delete_transfer_profile(&profile_id)
        .await
        .map_err(|error| CommandError::Internal(error.to_string()))
}

#[tauri::command]
pub fn classify_transfer_pair(
    source_database_type: String,
    target_database_type: String,
) -> Result<crate::data_transfer::TransferPairingView, CommandError> {
    Ok(classify_transfer_pair_impl(
        &source_database_type,
        &target_database_type,
    ))
}

#[tauri::command]
pub async fn inspect_data_transfer(
    state: State<'_, AppState>,
    source_db_session_id: String,
    target_db_session_id: String,
    source_database: Option<String>,
    target_database: Option<String>,
    mode: TransferMode,
    tables: Option<Vec<crate::data_transfer::TableMapping>>,
) -> Result<Vec<TableInspectResult>, CommandError> {
    inspect_data_transfer_impl(
        &state,
        source_db_session_id,
        target_db_session_id,
        source_database,
        target_database,
        None,
        None,
        mode,
        &tables.unwrap_or_default(),
    )
    .await
}

/// Inspect source tables for a SQL-file destination. The file target has no
/// live database session, so this command deliberately receives only the
/// source session plus the optional output dialect.
#[tauri::command]
pub async fn inspect_sql_file_transfer(
    state: State<'_, AppState>,
    source_db_session_id: String,
    source_database: Option<String>,
    source_schema: Option<String>,
    target_database_type: Option<String>,
    mode: TransferMode,
    tables: Option<Vec<crate::data_transfer::TableMapping>>,
) -> Result<Vec<TableInspectResult>, CommandError> {
    inspect_sql_file_transfer_impl(
        &state,
        source_db_session_id,
        source_database,
        source_schema,
        mode,
        target_database_type,
        &tables.unwrap_or_default(),
    )
    .await
}

#[tauri::command]
pub async fn preview_data_transfer(
    state: State<'_, AppState>,
    job: TransferJob,
) -> Result<TransferPreview, CommandError> {
    preview_data_transfer_impl(&state, job).await
}

/// Pick a SQL destination through the native dialog. Only the opaque token is
/// returned to the webview; the selected path remains in the host registry.
#[tauri::command]
pub async fn pick_data_transfer_sql_file(
    app: AppHandle,
) -> Result<Option<crate::data_transfer::SqlFileTarget>, CommandError> {
    let picked = super::dialog::save_file(
        &app,
        ("SQL".into(), vec!["sql".into()]),
        "datazen-transfer.sql".into(),
    )
    .await?;
    let Some(path) = picked else {
        return Ok(None);
    };
    super::file::validate_extension(&path, &["sql"])?;
    let token = crate::data_transfer::sql_file::register_path(path).map_err(CommandError::from)?;
    Ok(Some(crate::data_transfer::SqlFileTarget {
        file_token: token,
        database_type: None,
        database: None,
        schema: None,
        encoding: None,
    }))
}

#[tauri::command]
pub async fn execute_data_transfer(
    state: State<'_, AppState>,
    request: TransferRunRequest,
) -> Result<TransferExecutionResult, CommandError> {
    execute_data_transfer_impl(&state, request).await
}

#[tauri::command]
pub async fn cancel_data_transfer(job_id: String) -> Result<bool, CommandError> {
    Ok(cancel_job(&job_id).await)
}
