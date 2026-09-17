//! Preview Data Transfer plan (DDL + write summary).

use std::collections::HashMap;

use super::super::error::{CmdExt, CommandError};
use super::super::AppState;
use super::inspect::inspect_data_transfer_impl;
use crate::data_transfer::{
    build_preview, enforce_transfer_pairing, TransferJob, TransferPreview, TransferPreviewAdapters,
};
use datazen_driver_api::{TableSchema, TableType};

pub(crate) async fn preview_data_transfer_impl(
    state: &AppState,
    mut job: TransferJob,
) -> Result<TransferPreview, CommandError> {
    job.options.validate().map_err(CommandError::from)?;

    let src_config = state
        .connection_manager
        .get_session_config(&job.source.db_session_id)
        .await
        .cmd_err("preview_data_transfer")?;
    let tgt_config = state
        .connection_manager
        .get_session_config(&job.target.db_session_id)
        .await
        .cmd_err("preview_data_transfer")?;

    job.source.schema = job
        .source
        .normalized_schema()
        .map(str::to_string)
        .or_else(|| src_config.schema.clone());
    job.target.schema = job
        .target
        .normalized_schema()
        .map(str::to_string)
        .or_else(|| tgt_config.schema.clone());
    crate::data_transfer::metadata::metadata_relation_ref(&job.source, "")?;
    crate::data_transfer::metadata::metadata_relation_ref(&job.target, "")?;

    let pairing = enforce_transfer_pairing(&src_config.database_type, &tgt_config.database_type)
        .map_err(CommandError::from)?;

    let inspected = inspect_data_transfer_impl(
        state,
        job.source.db_session_id.clone(),
        job.target.db_session_id.clone(),
        Some(job.source.database.clone()),
        Some(job.target.database.clone()),
        job.source.normalized_schema(),
        job.target.normalized_schema(),
        job.mode,
        &job.tables,
    )
    .await?;

    let (src_driver, src_handle) = state
        .connection_manager
        .get_session(&job.source.db_session_id)
        .await
        .cmd_err("preview_data_transfer")?;
    let (target_driver, target_handle) = state
        .connection_manager
        .get_session(&job.target.db_session_id)
        .await
        .cmd_err("preview_data_transfer")?;

    let src_tables = src_driver
        .get_tables(&src_handle, &job.source.database)
        .await
        .cmd_err("preview_data_transfer")?;

    let src_tables: Vec<_> = src_tables
        .into_iter()
        .filter(|table| {
            crate::data_transfer::metadata::table_in_endpoint_schema(&job.source, table)
        })
        .collect();

    let mut source_schemas = HashMap::new();
    for table in src_tables
        .iter()
        .filter(|t| matches!(t.table_type, TableType::Table))
    {
        if let Ok(schema) = crate::data_transfer::metadata::load_table_schema(
            src_driver.as_ref(),
            &src_handle,
            &job.source,
            &table.name,
        )
        .await
        {
            source_schemas.insert(table.name.clone(), schema);
        }
    }

    // Capture target schemas for the immutable plan. A missing target table
    // is represented as `None` in the fingerprint and is expected only for a
    // CREATE NEW mapping; a table appearing before execution then invalidates
    // the plan instead of silently changing its operation.
    let mut target_schemas: HashMap<String, TableSchema> = HashMap::new();
    for table in inspected.iter().filter(|table| {
        table.enabled
            && !matches!(
                table.status,
                crate::data_transfer::model::TableMappingStatus::CreateNew
            )
            && !table.target_table.trim().is_empty()
    }) {
        if let Ok(schema) = crate::data_transfer::metadata::load_table_schema(
            target_driver.as_ref(),
            &target_handle,
            &job.target,
            &table.target_table,
        )
        .await
        {
            target_schemas.insert(table.target_table.clone(), schema);
        }
    }

    let target_read_only_ok = !tgt_config.read_only;

    let adapter_handles = if state
        .sync_adapters
        .ensure_pair(&src_config.database_type, &tgt_config.database_type)
        .is_ok()
    {
        match (
            state.sync_adapters.get_source(&src_config.database_type),
            state.sync_adapters.get_target(&tgt_config.database_type),
        ) {
            (Some(src), Some(tgt)) => Some((src, tgt)),
            _ => None,
        }
    } else {
        None
    };

    if let Some((source, _)) = &adapter_handles {
        crate::data_transfer::structure::enrich_source_types(
            source.as_ref(),
            src_driver.as_ref(),
            &src_handle,
            &job.source,
            &mut source_schemas,
        )
        .await
        .map_err(CommandError::from)?;
    }

    let adapters = adapter_handles
        .as_ref()
        .map(|(src, tgt)| TransferPreviewAdapters {
            src_adapter: src.as_ref(),
            tgt_adapter: tgt.as_ref(),
        });

    let mut preview = build_preview(
        &job,
        &inspected,
        &pairing,
        &source_schemas,
        target_read_only_ok,
        adapters,
    )
    .map_err(CommandError::from)?;

    if matches!(
        job.mode,
        crate::data_transfer::TransferMode::Data
            | crate::data_transfer::TransferMode::StructureAndData
    ) {
        if let Err(error) = target_driver.parameter_placeholder(1, None) {
            preview.can_execute = false;
            preview.block_reason = Some(error.to_string());
        }
    }

    if tgt_config.read_only {
        preview.can_execute = false;
        preview.block_reason =
            Some("target connection is read-only; Data Transfer cannot execute".into());
    }

    let plan_id = super::plans::issue_plan(
        job,
        &preview,
        src_driver.as_ref(),
        target_driver.as_ref(),
        &source_schemas,
        &target_schemas,
        tgt_config.read_only,
    )
    .map_err(CommandError::from)?;
    preview.plan_id = plan_id;

    Ok(preview)
}
