//! Execute Data Transfer (structure + data, same-family and IR).

use std::collections::HashMap;
use std::sync::atomic::Ordering;
use std::sync::Arc;

use super::super::error::{CmdExt, CommandError};
use super::super::AppState;
use super::inspect::inspect_data_transfer_impl;
use super::jobs;
use super::plans::{self, StoredTransferPlan};
use crate::data_transfer::model::TransferRunSelection;
use crate::data_transfer::{
    column_ir_types_by_source, create_target_tables, enforce_transfer_pairing,
    execute_transfer_data, is_same_family, source_schema_to_target_ir, DropCreateContext,
    TransferExecutionResult, TransferJob, TransferMode, TransferRunRequest, ValueFormatter,
};
use crate::transfer::adapter::{SyncSourceAdapter, SyncTargetAdapter};
use datazen_driver_api::TableType;

struct TransferAdapters {
    src_source: Arc<dyn SyncSourceAdapter>,
    tgt_target: Arc<dyn SyncTargetAdapter>,
}

async fn resolve_transfer_adapters(
    state: &AppState,
    src_db_type: &str,
    tgt_db_type: &str,
) -> Result<TransferAdapters, CommandError> {
    state
        .sync_adapters
        .ensure_pair(&src_db_type.to_string(), &tgt_db_type.to_string())
        .map_err(CommandError::Validation)?;
    let src_source = state
        .sync_adapters
        .get_source(&src_db_type.to_string())
        .ok_or_else(|| CommandError::Validation("missing source sync adapter".into()))?;
    let tgt_target = state
        .sync_adapters
        .get_target(&tgt_db_type.to_string())
        .ok_or_else(|| CommandError::Validation("missing target sync adapter".into()))?;
    Ok(TransferAdapters {
        src_source,
        tgt_target,
    })
}

struct ValidatedTransferContext {
    src_config: crate::db::ConnectionConfig,
    tgt_config: crate::db::ConnectionConfig,
    src_driver: Arc<dyn crate::db::DatabaseDriver>,
    src_handle: crate::db::ConnectionHandle,
    tgt_driver: Arc<dyn crate::db::DatabaseDriver>,
    tgt_handle: crate::db::ConnectionHandle,
}

async fn schema_fingerprint_for_side(
    endpoint: &crate::data_transfer::model::Endpoint,
    driver: &dyn crate::db::DatabaseDriver,
    handle: &crate::db::ConnectionHandle,
    job: &TransferJob,
    source: bool,
) -> Result<String, CommandError> {
    let mut entries = Vec::with_capacity(job.tables.len());
    for table in &job.tables {
        let relation = if source {
            &table.source_table
        } else {
            &table.target_table
        };
        let schema = if relation.trim().is_empty() {
            None
        } else {
            match crate::data_transfer::metadata::load_table_schema(
                driver, handle, endpoint, relation,
            )
            .await
            {
                Ok(schema) => Some(schema),
                // The preview snapshot records missing relations as `None`.
                // Reusing the same representation makes a newly created table,
                // a dropped table, or a permission failure change the hash and
                // fail closed before any target write.
                Err(_) => None,
            }
        };
        entries.push((relation.clone(), schema));
    }
    plans::fingerprint_schemas(entries).map_err(CommandError::from)
}

async fn validate_plan_context(
    state: &AppState,
    plan: &StoredTransferPlan,
) -> Result<ValidatedTransferContext, CommandError> {
    if plan.target_read_only_at_preview {
        return Err(CommandError::Validation(
            "target connection was read-only during preview; return to preview".into(),
        ));
    }
    if plan.filter.is_some() {
        return Err(CommandError::Validation(
            "this Transfer plan contains an unsupported filter; return to preview".into(),
        ));
    }
    let src_config = state
        .connection_manager
        .get_session_config(&plan.job.source.db_session_id)
        .await
        .cmd_err("execute_data_transfer")?;
    let tgt_config = state
        .connection_manager
        .get_session_config(&plan.job.target.db_session_id)
        .await
        .cmd_err("execute_data_transfer")?;

    if tgt_config.read_only {
        return Err(CommandError::Validation(
            "target connection is now read-only; return to preview".into(),
        ));
    }

    let (src_driver, src_handle) = state
        .connection_manager
        .get_session(&plan.job.source.db_session_id)
        .await
        .cmd_err("execute_data_transfer")?;
    let (tgt_driver, tgt_handle) = state
        .connection_manager
        .get_session(&plan.job.target.db_session_id)
        .await
        .cmd_err("execute_data_transfer")?;

    if src_driver.driver_type() != plan.source_driver_type
        || tgt_driver.driver_type() != plan.target_driver_type
        || plans::driver_protocol_version(src_driver.as_ref()) != plan.source_driver_protocol
        || plans::driver_protocol_version(tgt_driver.as_ref()) != plan.target_driver_protocol
    {
        return Err(CommandError::Validation(
            "driver contract changed since preview; return to preview".into(),
        ));
    }

    let src_fingerprint = schema_fingerprint_for_side(
        &plan.job.source,
        src_driver.as_ref(),
        &src_handle,
        &plan.job,
        true,
    )
    .await?;
    let tgt_fingerprint = schema_fingerprint_for_side(
        &plan.job.target,
        tgt_driver.as_ref(),
        &tgt_handle,
        &plan.job,
        false,
    )
    .await?;
    if src_fingerprint != plan.source_schema_fingerprint
        || tgt_fingerprint != plan.target_schema_fingerprint
    {
        return Err(CommandError::Validation(
            "source or target schema changed since preview; return to comparison".into(),
        ));
    }

    Ok(ValidatedTransferContext {
        src_config,
        tgt_config,
        src_driver,
        src_handle,
        tgt_driver,
        tgt_handle,
    })
}

fn validate_selection(
    job: &TransferJob,
    selection: &TransferRunSelection,
) -> Result<(), CommandError> {
    let Some(source_tables) = &selection.source_tables else {
        return Ok(());
    };
    let mut seen = std::collections::HashSet::new();
    for name in source_tables {
        if name.trim().is_empty() || !seen.insert(name) {
            return Err(CommandError::Validation(
                "transfer selection contains an empty or duplicate source table".into(),
            ));
        }
        let Some(table) = job.tables.iter().find(|table| table.source_table == *name) else {
            return Err(CommandError::Validation(
                "transfer selection contains a table that was not in the preview plan".into(),
            ));
        };
        if !table.enabled {
            return Err(CommandError::Validation(
                "transfer selection cannot enable a table disabled in the preview plan".into(),
            ));
        }
    }
    Ok(())
}

fn apply_selection(job: &mut TransferJob, selection: &TransferRunSelection) {
    let Some(source_tables) = &selection.source_tables else {
        return;
    };
    for table in &mut job.tables {
        table.enabled = source_tables
            .iter()
            .any(|source_table| source_table == &table.source_table);
    }
}

pub(crate) async fn execute_data_transfer_impl(
    state: &AppState,
    request: TransferRunRequest,
) -> Result<TransferExecutionResult, CommandError> {
    if request.plan_id.trim().is_empty() {
        return Err(CommandError::Validation(
            "execute_data_transfer requires a preview planId".into(),
        ));
    }
    let plan = plans::peek_plan(&request.plan_id).map_err(CommandError::from)?;
    if !plan.can_execute {
        return Err(CommandError::Validation(
            "transfer preview is blocked; return to comparison".into(),
        ));
    }
    validate_selection(&plan.job, &request.selection)?;
    if plan.job.write_mode.is_destructive()
        && !plan.job.options.confirmed_destructive
        && !request.options.confirmed_destructive
    {
        return Err(CommandError::Validation(
            "destructive write mode requires final confirmation".into(),
        ));
    }

    // Context validation happens before the atomic claim. A stale schema or
    // changed read-only policy sends the user back to comparison without
    // burning a still-valid plan; once claimed, retries are always refused.
    let context = validate_plan_context(state, &plan).await?;
    let claimed = plans::claim_plan(&request.plan_id).map_err(CommandError::from)?;
    let mut job = claimed.job;
    apply_selection(&mut job, &request.selection);
    let src_config = context.src_config;
    let tgt_config = context.tgt_config;
    let src_driver = context.src_driver;
    let src_handle = context.src_handle;
    let tgt_driver = context.tgt_driver;
    let tgt_handle = context.tgt_handle;
    let pairing = enforce_transfer_pairing(&src_config.database_type, &tgt_config.database_type)
        .map_err(CommandError::from)?;
    let job_id = request.job_id;

    let cancelled = match job_id.as_deref() {
        Some(id) => Some(jobs::ensure_job(id).await),
        None => None,
    };

    if let Some(flag) = &cancelled {
        if flag.load(Ordering::SeqCst) {
            return Err(CommandError::Validation(
                "transfer cancelled before start".into(),
            ));
        }
    }

    let mut inspected = inspect_data_transfer_impl(
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

    if matches!(
        job.mode,
        TransferMode::Data | TransferMode::StructureAndData
    ) {
        tgt_driver
            .parameter_placeholder(1, None)
            .map_err(|error| CommandError::Validation(error.to_string()))?;
        // Check the target data transaction path before any structure mutation.
        let probe = tgt_driver
            .begin_transaction(&tgt_handle)
            .await
            .cmd_err("execute_data_transfer")?;
        tgt_driver
            .rollback(probe)
            .await
            .cmd_err("execute_data_transfer")?;
    }

    let src_tables = src_driver
        .get_tables(&src_handle, &job.source.database)
        .await
        .cmd_err("execute_data_transfer")?;

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

    let needs_adapters = !is_same_family(&pairing)
        || matches!(
            job.mode,
            TransferMode::Structure | TransferMode::StructureAndData
        )
        || job.write_mode == crate::data_transfer::WriteMode::DropCreateInsert;

    let adapters = if needs_adapters {
        Some(
            resolve_transfer_adapters(state, &src_config.database_type, &tgt_config.database_type)
                .await?,
        )
    } else {
        None
    };

    if let Some(adapters) = &adapters {
        crate::data_transfer::structure::enrich_source_types(
            adapters.src_source.as_ref(),
            src_driver.as_ref(),
            &src_handle,
            &job.source,
            &mut source_schemas,
        )
        .await
        .map_err(CommandError::from)?;
    }

    let mut all_tables = Vec::new();
    let mut total_rows = 0u64;
    let mut cancelled_flag = false;
    let mut partial = false;

    if matches!(
        job.mode,
        TransferMode::Structure | TransferMode::StructureAndData
    ) {
        let (src_adapter, tgt_adapter) = match &adapters {
            Some(a) => (a.src_source.as_ref(), a.tgt_target.as_ref()),
            None => {
                return Err(CommandError::Validation(
                    "IR sync adapters are required for structure operations".into(),
                ));
            }
        };

        let structure_results = create_target_tables(
            src_adapter,
            tgt_adapter,
            src_driver.as_ref(),
            &src_handle,
            tgt_driver.as_ref(),
            &tgt_handle,
            &job,
            &inspected,
            &source_schemas,
            cancelled.clone(),
        )
        .await
        .map_err(CommandError::from)?;

        for r in &structure_results {
            if !r.success {
                partial = true;
                // Never write data into a table whose structure phase failed.
                for table in &mut inspected {
                    if table.source_table == r.source_table {
                        table.enabled = false;
                    }
                }
            }
        }
        all_tables.extend(structure_results);
        cancelled_flag = cancelled.as_ref().is_some_and(|c| c.load(Ordering::SeqCst));

        if cancelled_flag || (partial && job.options.stop_on_error) {
            if let Some(id) = job_id.as_deref() {
                jobs::remove_job(id).await;
            }
            return Ok(TransferExecutionResult {
                tables: all_tables,
                rows_inserted: 0,
                cancelled: cancelled_flag,
                partial: true,
            });
        }
    }

    if matches!(
        job.mode,
        TransferMode::Data | TransferMode::StructureAndData
    ) {
        let table_ir_types: HashMap<String, HashMap<String, crate::transfer::ir::IRType>> =
            if let Some(a) = &adapters {
                inspected
                    .iter()
                    .filter(|t| t.enabled)
                    .filter_map(|t| {
                        let schema = source_schemas.get(&t.source_table)?;
                        let ir = source_schema_to_target_ir(
                            a.src_source.as_ref(),
                            schema,
                            None,
                            &t.target_table,
                        );
                        Some((t.source_table.clone(), column_ir_types_by_source(&ir)))
                    })
                    .collect()
            } else {
                HashMap::new()
            };

        let formatter = if !is_same_family(&pairing) {
            let a = adapters.as_ref().ok_or_else(|| {
                CommandError::Validation("cross-family execute requires IR sync adapters".into())
            })?;
            ValueFormatter::Ir {
                tgt_adapter: a.tgt_target.as_ref(),
                source_column_ir_types: &table_ir_types,
            }
        } else {
            ValueFormatter::SameFamily
        };

        let drop_create = if job.write_mode == crate::data_transfer::WriteMode::DropCreateInsert {
            let a = adapters.as_ref().ok_or_else(|| {
                CommandError::Validation("drop+create requires IR sync adapters".into())
            })?;
            Some(DropCreateContext {
                src_adapter: a.src_source.as_ref(),
                tgt_adapter: a.tgt_target.as_ref(),
                src_driver: src_driver.as_ref(),
                src_handle: &src_handle,
                tgt_driver: tgt_driver.as_ref(),
                tgt_handle: &tgt_handle,
                source_schemas: &source_schemas,
            })
        } else {
            None
        };

        let data_result = execute_transfer_data(
            src_driver.as_ref(),
            &src_handle,
            tgt_driver.as_ref(),
            &tgt_handle,
            &job,
            &inspected,
            &source_schemas,
            &formatter,
            drop_create.as_ref(),
            tgt_config.read_only,
            cancelled.clone(),
        )
        .await
        .map_err(CommandError::from)?;

        total_rows = data_result.rows_inserted;
        cancelled_flag = data_result.cancelled;
        partial = partial || data_result.partial;
        all_tables.extend(data_result.tables);
    }

    if let Some(id) = job_id.as_deref() {
        jobs::remove_job(id).await;
    }

    Ok(TransferExecutionResult {
        tables: all_tables,
        rows_inserted: total_rows,
        cancelled: cancelled_flag,
        partial,
    })
}
