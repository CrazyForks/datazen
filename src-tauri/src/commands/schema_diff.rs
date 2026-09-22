//! Schema Diff Deploy IPC commands.

use super::error::{CmdExt, CommandError};
use super::sync::compare::diff_table_schemas_ir;
use super::AppState;
use crate::schema_diff::deploy::{
    execute_schema_diff_deploy as run_schema_diff_deploy, plan_has_destructive, DeployOptions,
    DESTRUCTIVE_CONFIRM_TOKEN,
};
use crate::schema_diff::diff_table_schemas;
use crate::schema_diff::objects::{
    build_routine_trigger_migration_plan_with_components,
    build_sequence_migration_plan_with_components, build_view_migration_plan_with_components,
    SchemaObjectSnapshot,
};
use crate::schema_diff::plan::{is_source_unbounded_text, PlanOptions};
use crate::schema_diff::types::TableColumnDiff;
use crate::schema_diff::types::{
    normalize_dialect, resolve_table_for_dialect, ColumnTypeOverride, SchemaDiffDeployResult,
    SchemaDiffPlan,
};
use crate::schema_diff::SchemaDiffProfile;
use crate::services::job_registry::{cancel_job, ensure_job, remove_job};
use crate::transfer::adapter::{SyncSourceAdapter, SyncTargetAdapter};
use crate::transfer::ddl::build_create_table_ddl;
use crate::transfer::full_types::fetch_full_column_types;
use std::{collections::HashSet, sync::Arc};
use tauri::State;

async fn list_schema_views(
    driver: &dyn datazen_driver_api::DatabaseDriver,
    handle: &datazen_driver_api::ConnectionHandle,
) -> Result<Vec<datazen_driver_api::DatabaseObject>, CommandError> {
    let result = datazen_driver_api::execute_schema_object_command(
        driver,
        &driver.driver_type(),
        handle,
        "list_objects",
        serde_json::json!({ "kind": "view" }),
    )
    .await
    .map_err(CommandError::Driver)?;
    result
        .data
        .get("objects")
        .cloned()
        .map(serde_json::from_value)
        .transpose()
        .map_err(|error| CommandError::Internal(format!("invalid view metadata: {error}")))
        .map(|objects| objects.unwrap_or_default())
}

async fn fetch_schema_view(
    driver: &dyn datazen_driver_api::DatabaseDriver,
    handle: &datazen_driver_api::ConnectionHandle,
    object: &datazen_driver_api::DatabaseObject,
) -> Result<SchemaObjectSnapshot, CommandError> {
    let result = datazen_driver_api::execute_schema_object_command(
        driver,
        &driver.driver_type(),
        handle,
        "get_object_ddl",
        serde_json::json!({
            "kind": "view",
            "name": object.name,
            "schema": object.schema,
        }),
    )
    .await
    .map_err(CommandError::Driver)?;
    let definition = result
        .data
        .get("ddl")
        .and_then(serde_json::Value::as_str)
        .unwrap_or_default()
        .trim()
        .to_owned();
    if definition.is_empty() {
        return Err(CommandError::Validation(format!(
            "View {} disappeared while it was being inspected",
            object.name
        )));
    }
    Ok(SchemaObjectSnapshot::view(
        object.schema.as_deref(),
        &object.name,
        &definition,
    ))
}

async fn list_schema_objects(
    driver: &dyn datazen_driver_api::DatabaseDriver,
    handle: &datazen_driver_api::ConnectionHandle,
    kind: datazen_driver_api::ObjectKind,
) -> Result<Vec<datazen_driver_api::DatabaseObject>, CommandError> {
    let result = datazen_driver_api::execute_schema_object_command(
        driver,
        &driver.driver_type(),
        handle,
        "list_objects",
        serde_json::json!({ "kind": kind.as_str() }),
    )
    .await
    .map_err(CommandError::Driver)?;
    result
        .data
        .get("objects")
        .cloned()
        .map(serde_json::from_value)
        .transpose()
        .map_err(|error| {
            CommandError::Internal(format!("invalid {} metadata: {error}", kind.as_str()))
        })
        .map(|objects| objects.unwrap_or_default())
}

async fn fetch_schema_object(
    driver: &dyn datazen_driver_api::DatabaseDriver,
    handle: &datazen_driver_api::ConnectionHandle,
    object: &datazen_driver_api::DatabaseObject,
) -> Result<SchemaObjectSnapshot, CommandError> {
    let kind = datazen_driver_api::ObjectKind::parse(&object.kind).ok_or_else(|| {
        CommandError::Validation(format!("Unsupported schema object kind `{}`", object.kind))
    })?;
    let result = datazen_driver_api::execute_schema_object_command(
        driver,
        &driver.driver_type(),
        handle,
        "get_object_ddl",
        serde_json::json!({
            "kind": kind.as_str(),
            "name": object.name,
            "schema": object.schema,
            "signature": object.signature,
            "targetSchema": object.target_schema,
            "targetName": object.target_name,
        }),
    )
    .await
    .map_err(CommandError::Driver)?;
    let definition = result
        .data
        .get("ddl")
        .and_then(serde_json::Value::as_str)
        .unwrap_or_default()
        .trim()
        .to_owned();
    if definition.is_empty() {
        return Err(CommandError::Validation(format!(
            "{} {} disappeared while it was being inspected",
            kind.as_str(),
            object.name
        )));
    }
    Ok(match kind {
        datazen_driver_api::ObjectKind::View => {
            SchemaObjectSnapshot::view(object.schema.as_deref(), &object.name, &definition)
        }
        datazen_driver_api::ObjectKind::Function | datazen_driver_api::ObjectKind::Procedure => {
            SchemaObjectSnapshot::routine(
                kind,
                object.schema.as_deref(),
                &object.name,
                object.signature.as_deref(),
                &definition,
            )
        }
        datazen_driver_api::ObjectKind::Trigger => SchemaObjectSnapshot::trigger(
            object.schema.as_deref(),
            &object.name,
            object.target_schema.as_deref(),
            object.target_name.as_deref().ok_or_else(|| {
                CommandError::Validation(format!("Trigger {} has no target relation", object.name))
            })?,
            &definition,
        ),
        datazen_driver_api::ObjectKind::Sequence => {
            SchemaObjectSnapshot::sequence(object.schema.as_deref(), &object.name, &definition)
        }
        _ => {
            return Err(CommandError::Validation(format!(
                "{} migration is not supported",
                kind.as_str()
            )))
        }
    })
}

fn object_selector(object: &datazen_driver_api::DatabaseObject) -> String {
    object
        .schema
        .as_deref()
        .map(|schema| format!("{schema}.{}", object.name))
        .unwrap_or_else(|| object.name.clone())
}

fn object_selector_with_metadata(object: &datazen_driver_api::DatabaseObject) -> String {
    let base = object_selector(object);
    match datazen_driver_api::ObjectKind::parse(&object.kind) {
        Some(datazen_driver_api::ObjectKind::Function)
        | Some(datazen_driver_api::ObjectKind::Procedure) => object
            .signature
            .as_deref()
            .map(|signature| format!("{base}({signature})"))
            .unwrap_or(base),
        Some(datazen_driver_api::ObjectKind::Trigger) => object
            .target_name
            .as_deref()
            .map(|target| {
                let target = object
                    .target_schema
                    .as_deref()
                    .map(|schema| format!("{schema}.{target}"))
                    .unwrap_or_else(|| target.to_owned());
                format!("{base} ON {target}")
            })
            .unwrap_or(base),
        _ => base,
    }
}

fn select_schema_object_pair(
    source: &[datazen_driver_api::DatabaseObject],
    target: &[datazen_driver_api::DatabaseObject],
    requested: &[String],
) -> Result<
    (
        Vec<datazen_driver_api::DatabaseObject>,
        Vec<datazen_driver_api::DatabaseObject>,
    ),
    CommandError,
> {
    let mut source_selected = Vec::new();
    let mut target_selected = Vec::new();
    for raw in requested {
        let name = raw.trim();
        let source_matches = source
            .iter()
            .filter(|object| {
                object.name == name
                    || object_selector(object) == name
                    || object_selector_with_metadata(object) == name
            })
            .collect::<Vec<_>>();
        let target_matches = target
            .iter()
            .filter(|object| {
                object.name == name
                    || object_selector(object) == name
                    || object_selector_with_metadata(object) == name
            })
            .collect::<Vec<_>>();
        if source_matches.len() > 1
            || target_matches.len() > 1
            || (source_matches.is_empty() && target_matches.is_empty())
        {
            return Err(CommandError::Validation(format!(
                "Schema object selector `{name}` must identify exactly one available object"
            )));
        }
        if let Some(object) = source_matches.first() {
            source_selected.push((*object).clone());
        }
        if let Some(object) = target_matches.first() {
            target_selected.push((*object).clone());
        }
    }
    Ok((source_selected, target_selected))
}

#[tauri::command]
pub async fn get_schema_diff_profiles(
    state: State<'_, AppState>,
) -> Result<Vec<SchemaDiffProfile>, CommandError> {
    Ok(state.store.get_schema_diff_profiles().await)
}

#[tauri::command]
pub async fn save_schema_diff_profile(
    state: State<'_, AppState>,
    mut profile: SchemaDiffProfile,
) -> Result<(), CommandError> {
    profile.validate().map_err(CommandError::Validation)?;
    validate_schema_diff_profile_connections(&state, &profile).await?;
    profile.updated_at = chrono::Utc::now();
    state
        .store
        .save_schema_diff_profile(profile)
        .await
        .map_err(|error| CommandError::Internal(error.to_string()))
}

async fn validate_schema_diff_profile_connections(
    state: &AppState,
    profile: &SchemaDiffProfile,
) -> Result<(), CommandError> {
    if state
        .store
        .get_connection(&profile.source_connection_id)
        .await
        .is_none()
    {
        return Err(CommandError::Validation(
            "schema diff profile source connection no longer exists".into(),
        ));
    }
    if state
        .store
        .get_connection(&profile.target_connection_id)
        .await
        .is_none()
    {
        return Err(CommandError::Validation(
            "schema diff profile target connection no longer exists".into(),
        ));
    }
    Ok(())
}

#[tauri::command]
pub async fn delete_schema_diff_profile(
    state: State<'_, AppState>,
    profile_id: String,
) -> Result<(), CommandError> {
    state
        .store
        .delete_schema_diff_profile(&profile_id)
        .await
        .map_err(|error| CommandError::Internal(error.to_string()))
}

fn is_table_missing_error(msg: &str) -> bool {
    let lower = msg.to_ascii_lowercase();
    lower.contains("1146")
        || lower.contains("doesn't exist")
        || lower.contains("does not exist")
        || lower.contains("not found")
}

async fn fetch_target_table_schema(
    driver: &dyn datazen_driver_api::DatabaseDriver,
    handle: &datazen_driver_api::ConnectionHandle,
    table: &str,
    database: &str,
    schema: Option<&str>,
) -> Result<crate::db::TableSchema, CommandError> {
    match driver
        .get_table_schema(handle, table, database, schema)
        .await
    {
        Ok(schema) => Ok(schema),
        Err(e) => {
            let msg = e.to_string();
            if is_table_missing_error(&msg) {
                tracing::info!(%table, "target table does not exist, treating as empty schema");
                Ok(crate::db::TableSchema {
                    table_name: table.to_string(),
                    columns: Vec::new(),
                    primary_keys: Vec::new(),
                    indexes: Vec::new(),
                    foreign_keys: Vec::new(),
                    check_constraints: Vec::new(),
                    table_options: datazen_driver_api::TableOptions::default(),
                })
            } else {
                Err(CommandError::Driver(e))
            }
        }
    }
}

fn resolve_profile_table(dialect: &str, table: &str, schema: Option<&str>) -> String {
    let Some(schema) = schema.map(str::trim).filter(|value| !value.is_empty()) else {
        return resolve_table_for_dialect(dialect, table);
    };
    let relation = table
        .trim()
        .rsplit_once('.')
        .map(|(_, name)| name)
        .unwrap_or_else(|| table.trim());
    format!("{schema}.{relation}")
}

/// Prepare a DDL deploy plan (source = desired → target).
#[tauri::command]
pub async fn prepare_schema_diff_plan(
    state: State<'_, AppState>,
    source_db_session_id: String,
    target_db_session_id: String,
    table_names: Vec<String>,
    target_only_table_names: Option<Vec<String>>,
    allow_destructive: bool,
    include_indexes: Option<bool>,
    type_overrides: Option<Vec<ColumnTypeOverride>>,
) -> Result<SchemaDiffPlan, CommandError> {
    prepare_schema_diff_plan_impl(
        &state,
        source_db_session_id,
        target_db_session_id,
        table_names,
        target_only_table_names.unwrap_or_default(),
        allow_destructive,
        include_indexes,
        type_overrides,
    )
    .await
}

pub(crate) async fn prepare_schema_diff_plan_impl(
    state: &AppState,
    source_db_session_id: String,
    target_db_session_id: String,
    table_names: Vec<String>,
    target_only_table_names: Vec<String>,
    allow_destructive: bool,
    include_indexes: Option<bool>,
    type_overrides: Option<Vec<ColumnTypeOverride>>,
) -> Result<SchemaDiffPlan, CommandError> {
    prepare_schema_diff_plan_with_schemas_impl(
        state,
        source_db_session_id,
        target_db_session_id,
        table_names,
        target_only_table_names,
        allow_destructive,
        include_indexes,
        type_overrides,
        None,
        None,
    )
    .await
}

/// Prepare a plan using schema overrides stored in a migration profile.
///
/// Interactive callers inherit the live connection schema. Persisted profiles
/// carry both source and target schema, so their runner must keep those scopes
/// explicit when it creates the reviewed immutable plan.
pub(crate) async fn prepare_schema_diff_profile_plan_impl(
    state: &AppState,
    source_db_session_id: String,
    target_db_session_id: String,
    table_names: Vec<String>,
    target_only_table_names: Vec<String>,
    allow_destructive: bool,
    include_indexes: Option<bool>,
    type_overrides: Option<Vec<ColumnTypeOverride>>,
    source_schema: Option<String>,
    target_schema: Option<String>,
) -> Result<SchemaDiffPlan, CommandError> {
    prepare_schema_diff_plan_with_schemas_impl(
        state,
        source_db_session_id,
        target_db_session_id,
        table_names,
        target_only_table_names,
        allow_destructive,
        include_indexes,
        type_overrides,
        source_schema,
        target_schema,
    )
    .await
}

async fn prepare_schema_diff_plan_with_schemas_impl(
    state: &AppState,
    source_db_session_id: String,
    target_db_session_id: String,
    table_names: Vec<String>,
    target_only_table_names: Vec<String>,
    allow_destructive: bool,
    include_indexes: Option<bool>,
    type_overrides: Option<Vec<ColumnTypeOverride>>,
    source_schema_override: Option<String>,
    target_schema_override: Option<String>,
) -> Result<SchemaDiffPlan, CommandError> {
    tracing::info!(
        %source_db_session_id,
        %target_db_session_id,
        tables = table_names.len(),
        allow_destructive,
        "prepare_schema_diff_plan"
    );

    if table_names.is_empty() && target_only_table_names.is_empty() {
        return Err(CommandError::Validation(
            "table_names and target_only_table_names must not both be empty".into(),
        ));
    }

    let src_config = state
        .connection_manager
        .get_session_config(&source_db_session_id)
        .await
        .cmd_err("prepare_schema_diff_plan")?;
    let tgt_config = state
        .connection_manager
        .get_session_config(&target_db_session_id)
        .await
        .cmd_err("prepare_schema_diff_plan")?;

    if tgt_config.read_only {
        return Err(CommandError::Validation(
            "Target connection is read-only".into(),
        ));
    }
    if crate::schema_diff::reviewed::same_endpoint(&src_config, &tgt_config) {
        return Err(CommandError::Validation(
            "Source and target must identify different database scopes".into(),
        ));
    }

    let (src_driver, src_handle) = state
        .connection_manager
        .get_session(&source_db_session_id)
        .await
        .cmd_err("prepare_schema_diff_plan")?;
    let (tgt_driver, tgt_handle) = state
        .connection_manager
        .get_session(&target_db_session_id)
        .await
        .cmd_err("prepare_schema_diff_plan")?;

    let mut pairs = Vec::new();
    for table in &table_names {
        let src_table = resolve_profile_table(
            &src_config.database_type,
            table,
            source_schema_override.as_deref(),
        );
        let tgt_table = resolve_profile_table(
            &tgt_config.database_type,
            table,
            target_schema_override.as_deref(),
        );
        let src_schema = src_driver
            .get_table_schema(
                &src_handle,
                &src_table,
                src_config.database.as_deref().unwrap_or_default(),
                source_schema_override
                    .as_deref()
                    .or(src_config.schema.as_deref()),
            )
            .await
            .cmd_err("prepare_schema_diff_plan")?;
        let tgt_schema = fetch_target_table_schema(
            tgt_driver.as_ref(),
            &tgt_handle,
            &tgt_table,
            tgt_config.database.as_deref().unwrap_or_default(),
            target_schema_override
                .as_deref()
                .or(tgt_config.schema.as_deref()),
        )
        .await
        .cmd_err("prepare_schema_diff_plan")?;
        // DDL in the plan targets the target dialect, so the pair's table identifier must be
        // target-resolved. Using `table` here leaks the source's schema qualification into the
        // target DDL (e.g. `public.table` on MySQL) and breaks deploy.
        pairs.push((tgt_table, src_schema, tgt_schema));
    }

    let mut target_only_snapshots = Vec::new();
    let mut target_only_tables = Vec::new();
    let source_target_tables = pairs
        .iter()
        .map(|(table, _, _)| table.as_str())
        .collect::<HashSet<_>>();
    let mut seen_target_only_tables = HashSet::new();
    for table in &target_only_table_names {
        let tgt_table = resolve_profile_table(
            &tgt_config.database_type,
            table,
            target_schema_override.as_deref(),
        );
        // Target-only selection is an explicit destructive request. Read the
        // real target schema and fail closed if the selected table disappeared;
        // do not turn it into an empty source schema sentinel.
        let tgt_schema = tgt_driver
            .get_table_schema(
                &tgt_handle,
                &tgt_table,
                tgt_config.database.as_deref().unwrap_or_default(),
                target_schema_override
                    .as_deref()
                    .or(tgt_config.schema.as_deref()),
            )
            .await
            .cmd_err("prepare_schema_diff_plan")?;
        if source_target_tables.contains(tgt_table.as_str()) {
            return Err(CommandError::Validation(format!(
                "Table `{tgt_table}` cannot be selected as both a source table and target-only table"
            )));
        }
        if !seen_target_only_tables.insert(tgt_table.clone()) {
            return Err(CommandError::Validation(format!(
                "Target-only table `{tgt_table}` was selected more than once"
            )));
        }
        target_only_tables.push(tgt_table.clone());
        target_only_snapshots.push((tgt_table, tgt_schema));
    }

    let src_d = normalize_dialect(&src_config.database_type);
    let tgt_d = normalize_dialect(&tgt_config.database_type);
    let include_indexes = include_indexes.unwrap_or(true);

    let mut plan = if src_d != tgt_d {
        state
            .sync_adapters
            .ensure_pair(&src_config.database_type, &tgt_config.database_type)
            .map_err(CommandError::Validation)?;
        let src_adapter: Arc<dyn SyncSourceAdapter> = state
            .sync_adapters
            .get_source(&src_config.database_type)
            .ok_or_else(|| CommandError::Validation("missing source sync adapter".into()))?;
        let tgt_adapter: Arc<dyn SyncTargetAdapter> = state
            .sync_adapters
            .get_target(&tgt_config.database_type)
            .ok_or_else(|| CommandError::Validation("missing target sync adapter".into()))?;

        let tgt_is_mysql = tgt_d == "mysql";
        let mapper = |table: &str, source_type: &str, col_name: &str| -> Result<String, String> {
            for (tgt_tbl, src, _) in pairs.iter().filter(|(t, _, _)| t == table) {
                let matching_col = src
                    .columns
                    .iter()
                    .find(|c| c.name == col_name && c.data_type == source_type)
                    .or_else(|| src.columns.iter().find(|c| c.name == col_name));
                if let Some(col) = matching_col {
                    // 1. User explicit column type overrides take highest priority
                    if let Some(ref overrides) = type_overrides {
                        if let Some(ov) = overrides.iter().find(|o| {
                            resolve_profile_table(
                                &tgt_config.database_type,
                                &o.table,
                                target_schema_override.as_deref(),
                            ) == *tgt_tbl
                                && o.column == col_name
                        }) {
                            return Ok(ov.target_type.clone());
                        }
                    }

                    // 2. MySQL target: unbounded text columns default to pre-filled suggested VARCHAR(255)
                    if tgt_is_mysql && is_source_unbounded_text(&col.data_type) {
                        return Ok("VARCHAR(255)".into());
                    }

                    let ir = src_adapter.column_to_ir(col, Some(source_type));
                    if col.default_value.is_some()
                        && !tgt_adapter.allows_column_default(&ir.ir_type)
                    {
                        if let Some(fallback) = tgt_adapter.default_capable_type_for(&ir.ir_type) {
                            return Ok(tgt_adapter.ir_type_to_native(&fallback));
                        }
                    }
                    return Ok(tgt_adapter.ir_type_to_native(&ir.ir_type));
                }
            }
            Err(format!(
                "cannot map type `{source_type}` for column `{col_name}`"
            ))
        };

        crate::schema_diff::plan::build_schema_diff_plan_with_target_only(
            &pairs,
            &target_only_tables,
            &src_d,
            &tgt_d,
            PlanOptions {
                allow_destructive,
                include_indexes,
                type_mapper: Some(&mapper),
                cross_dialect: true,
            },
        )
    } else {
        crate::schema_diff::plan::build_schema_diff_plan_with_target_only(
            &pairs,
            &target_only_tables,
            &src_d,
            &tgt_d,
            PlanOptions {
                allow_destructive,
                include_indexes,
                type_mapper: None,
                cross_dialect: false,
            },
        )
    };

    crate::schema_diff::reviewed::freeze(
        &mut plan,
        target_db_session_id,
        &tgt_handle,
        &tgt_config,
        pairs
            .iter()
            .map(|(table, _, target)| (table.clone(), target.clone()))
            .chain(target_only_snapshots)
            .collect(),
    )
    .await;

    tracing::info!(
        statements = plan.statements.len(),
        warnings = plan.warnings.len(),
        "prepare_schema_diff_plan OK"
    );
    Ok(plan)
}

/// Prepare a reviewed migration plan for selected views.
///
/// The source and target definitions are read by the backend from live object
/// metadata. The client supplies only qualified object selectors; it never
/// supplies replacement SQL. The returned plan can be deployed through the
/// existing `execute_schema_diff_deploy` command and is guarded by the same
/// one-shot identity and target-snapshot checks as table plans.
#[tauri::command]
pub async fn prepare_schema_view_plan(
    state: State<'_, AppState>,
    source_db_session_id: String,
    target_db_session_id: String,
    object_names: Vec<String>,
    allow_destructive: bool,
) -> Result<SchemaDiffPlan, CommandError> {
    if object_names.is_empty() {
        return Err(CommandError::Validation(
            "object_names must not be empty".into(),
        ));
    }
    let src_config = state
        .connection_manager
        .get_session_config(&source_db_session_id)
        .await
        .cmd_err("prepare_schema_view_plan")?;
    let tgt_config = state
        .connection_manager
        .get_session_config(&target_db_session_id)
        .await
        .cmd_err("prepare_schema_view_plan")?;
    if tgt_config.read_only {
        return Err(CommandError::Validation(
            "Target connection is read-only".into(),
        ));
    }
    if crate::schema_diff::reviewed::same_endpoint(&src_config, &tgt_config) {
        return Err(CommandError::Validation(
            "Source and target must identify different database scopes".into(),
        ));
    }
    let (src_driver, src_handle) = state
        .connection_manager
        .get_session(&source_db_session_id)
        .await
        .cmd_err("prepare_schema_view_plan")?;
    let (tgt_driver, tgt_handle) = state
        .connection_manager
        .get_session(&target_db_session_id)
        .await
        .cmd_err("prepare_schema_view_plan")?;
    let source_available = list_schema_views(src_driver.as_ref(), &src_handle).await?;
    let target_available = list_schema_views(tgt_driver.as_ref(), &tgt_handle).await?;
    let (source_selected, target_selected) =
        select_schema_object_pair(&source_available, &target_available, &object_names)?;

    let mut source_snapshots = Vec::with_capacity(source_selected.len());
    for object in &source_selected {
        source_snapshots.push(fetch_schema_view(src_driver.as_ref(), &src_handle, object).await?);
    }
    let mut target_snapshots = Vec::with_capacity(target_selected.len());
    for object in &target_selected {
        target_snapshots.push(fetch_schema_view(tgt_driver.as_ref(), &tgt_handle, object).await?);
    }
    let src_dialect = normalize_dialect(&src_config.database_type);
    let tgt_dialect = normalize_dialect(&tgt_config.database_type);
    let Some(renderer) = tgt_driver.migration_renderer() else {
        return Err(CommandError::Validation(format!(
            "Driver {} does not expose schema migration rendering",
            tgt_config.database_type
        )));
    };
    let Some(capabilities) = tgt_driver.migration_capabilities() else {
        return Err(CommandError::Validation(format!(
            "Driver {} does not expose schema migration capabilities",
            tgt_config.database_type
        )));
    };
    let mut plan = build_view_migration_plan_with_components(
        &source_snapshots,
        &target_snapshots,
        &src_dialect,
        &tgt_dialect,
        allow_destructive,
        renderer.as_ref(),
        capabilities.as_ref(),
    );
    crate::schema_diff::reviewed::freeze_with_objects(
        &mut plan,
        target_db_session_id,
        &tgt_handle,
        &tgt_config,
        Vec::new(),
        target_snapshots,
    )
    .await;
    Ok(plan)
}

/// Prepare a reviewed same-dialect plan for PostgreSQL/MySQL functions,
/// procedures, or triggers. The backend owns object DDL retrieval so callers
/// cannot inject replacement SQL into the migration plan.
#[tauri::command]
pub async fn prepare_schema_routine_trigger_plan(
    state: State<'_, AppState>,
    source_db_session_id: String,
    target_db_session_id: String,
    kind: String,
    object_names: Vec<String>,
    allow_destructive: bool,
) -> Result<SchemaDiffPlan, CommandError> {
    let kind = datazen_driver_api::ObjectKind::parse(&kind).ok_or_else(|| {
        CommandError::Validation("kind must be function, procedure, or trigger".into())
    })?;
    if !matches!(
        kind,
        datazen_driver_api::ObjectKind::Function
            | datazen_driver_api::ObjectKind::Procedure
            | datazen_driver_api::ObjectKind::Trigger
    ) {
        return Err(CommandError::Validation(
            "kind must be function, procedure, or trigger".into(),
        ));
    }
    if object_names.is_empty() {
        return Err(CommandError::Validation(
            "object_names must not be empty".into(),
        ));
    }
    let src_config = state
        .connection_manager
        .get_session_config(&source_db_session_id)
        .await
        .cmd_err("prepare_schema_routine_trigger_plan")?;
    let tgt_config = state
        .connection_manager
        .get_session_config(&target_db_session_id)
        .await
        .cmd_err("prepare_schema_routine_trigger_plan")?;
    if tgt_config.read_only {
        return Err(CommandError::Validation(
            "Target connection is read-only".into(),
        ));
    }
    if crate::schema_diff::reviewed::same_endpoint(&src_config, &tgt_config) {
        return Err(CommandError::Validation(
            "Source and target must identify different database scopes".into(),
        ));
    }
    let (src_driver, src_handle) = state
        .connection_manager
        .get_session(&source_db_session_id)
        .await
        .cmd_err("prepare_schema_routine_trigger_plan")?;
    let (tgt_driver, tgt_handle) = state
        .connection_manager
        .get_session(&target_db_session_id)
        .await
        .cmd_err("prepare_schema_routine_trigger_plan")?;
    let source_available = list_schema_objects(src_driver.as_ref(), &src_handle, kind).await?;
    let target_available = list_schema_objects(tgt_driver.as_ref(), &tgt_handle, kind).await?;
    let (source_selected, target_selected) =
        select_schema_object_pair(&source_available, &target_available, &object_names)?;
    let mut source_snapshots = Vec::with_capacity(source_selected.len());
    for object in &source_selected {
        source_snapshots.push(fetch_schema_object(src_driver.as_ref(), &src_handle, object).await?);
    }
    let mut target_snapshots = Vec::with_capacity(target_selected.len());
    for object in &target_selected {
        target_snapshots.push(fetch_schema_object(tgt_driver.as_ref(), &tgt_handle, object).await?);
    }
    let src_dialect = normalize_dialect(&src_config.database_type);
    let tgt_dialect = normalize_dialect(&tgt_config.database_type);
    let Some(renderer) = tgt_driver.migration_renderer() else {
        return Err(CommandError::Validation(format!(
            "Driver {} does not expose schema migration rendering",
            tgt_config.database_type
        )));
    };
    let Some(capabilities) = tgt_driver.migration_capabilities() else {
        return Err(CommandError::Validation(format!(
            "Driver {} does not expose schema migration capabilities",
            tgt_config.database_type
        )));
    };
    let mut plan = build_routine_trigger_migration_plan_with_components(
        &source_snapshots,
        &target_snapshots,
        &src_dialect,
        &tgt_dialect,
        allow_destructive,
        renderer.as_ref(),
        capabilities.as_ref(),
    );
    crate::schema_diff::reviewed::freeze_with_objects(
        &mut plan,
        target_db_session_id,
        &tgt_handle,
        &tgt_config,
        Vec::new(),
        target_snapshots,
    )
    .await;
    Ok(plan)
}

/// Prepare a reviewed same-dialect plan for PostgreSQL sequences. The client
/// supplies only qualified selectors; both source and target DDL are read
/// from the live driver catalog and frozen for the one-shot deploy gate.
#[tauri::command]
pub async fn prepare_schema_sequence_plan(
    state: State<'_, AppState>,
    source_db_session_id: String,
    target_db_session_id: String,
    object_names: Vec<String>,
    allow_destructive: bool,
) -> Result<SchemaDiffPlan, CommandError> {
    if object_names.is_empty() {
        return Err(CommandError::Validation(
            "object_names must not be empty".into(),
        ));
    }
    let src_config = state
        .connection_manager
        .get_session_config(&source_db_session_id)
        .await
        .cmd_err("prepare_schema_sequence_plan")?;
    let tgt_config = state
        .connection_manager
        .get_session_config(&target_db_session_id)
        .await
        .cmd_err("prepare_schema_sequence_plan")?;
    if tgt_config.read_only {
        return Err(CommandError::Validation(
            "Target connection is read-only".into(),
        ));
    }
    if crate::schema_diff::reviewed::same_endpoint(&src_config, &tgt_config) {
        return Err(CommandError::Validation(
            "Source and target must identify different database scopes".into(),
        ));
    }
    let (src_driver, src_handle) = state
        .connection_manager
        .get_session(&source_db_session_id)
        .await
        .cmd_err("prepare_schema_sequence_plan")?;
    let (tgt_driver, tgt_handle) = state
        .connection_manager
        .get_session(&target_db_session_id)
        .await
        .cmd_err("prepare_schema_sequence_plan")?;
    let source_available = list_schema_objects(
        src_driver.as_ref(),
        &src_handle,
        datazen_driver_api::ObjectKind::Sequence,
    )
    .await?;
    let target_available = list_schema_objects(
        tgt_driver.as_ref(),
        &tgt_handle,
        datazen_driver_api::ObjectKind::Sequence,
    )
    .await?;
    let (source_selected, target_selected) =
        select_schema_object_pair(&source_available, &target_available, &object_names)?;
    let mut source_snapshots = Vec::with_capacity(source_selected.len());
    for object in &source_selected {
        source_snapshots.push(fetch_schema_object(src_driver.as_ref(), &src_handle, object).await?);
    }
    let mut target_snapshots = Vec::with_capacity(target_selected.len());
    for object in &target_selected {
        target_snapshots.push(fetch_schema_object(tgt_driver.as_ref(), &tgt_handle, object).await?);
    }
    let src_dialect = normalize_dialect(&src_config.database_type);
    let tgt_dialect = normalize_dialect(&tgt_config.database_type);
    let Some(renderer) = tgt_driver.migration_renderer() else {
        return Err(CommandError::Validation(format!(
            "Driver {} does not expose schema migration rendering",
            tgt_config.database_type
        )));
    };
    let Some(capabilities) = tgt_driver.migration_capabilities() else {
        return Err(CommandError::Validation(format!(
            "Driver {} does not expose schema migration capabilities",
            tgt_config.database_type
        )));
    };
    let mut plan = build_sequence_migration_plan_with_components(
        &source_snapshots,
        &target_snapshots,
        &src_dialect,
        &tgt_dialect,
        allow_destructive,
        renderer.as_ref(),
        capabilities.as_ref(),
    );
    crate::schema_diff::reviewed::freeze_with_objects(
        &mut plan,
        target_db_session_id,
        &tgt_handle,
        &tgt_config,
        Vec::new(),
        target_snapshots,
    )
    .await;
    Ok(plan)
}

/// Execute a reviewed schema diff plan on the target connection.
async fn fail_schema_diff_deploy<T>(
    state: &AppState,
    run: crate::store::MigrationRunRecord,
    error: CommandError,
) -> Result<T, CommandError> {
    crate::commands::history::finish_migration_run(state, run, false, false, 0, 1, 0, "unknown")
        .await;
    Err(error)
}

#[tauri::command]
pub async fn execute_schema_diff_deploy(
    state: State<'_, AppState>,
    target_db_session_id: String,
    plan: SchemaDiffPlan,
    use_transaction: Option<bool>,
    require_rollback: Option<bool>,
    confirm_destructive: Option<String>,
    job_id: Option<String>,
    profile: Option<crate::store::MigrationProfileRef>,
) -> Result<SchemaDiffDeployResult, CommandError> {
    execute_schema_diff_deploy_impl(
        &state,
        target_db_session_id,
        plan,
        use_transaction,
        require_rollback,
        confirm_destructive,
        job_id,
        profile,
    )
    .await
}

pub(crate) async fn execute_schema_diff_deploy_impl(
    state: &AppState,
    target_db_session_id: String,
    plan: SchemaDiffPlan,
    use_transaction: Option<bool>,
    require_rollback: Option<bool>,
    confirm_destructive: Option<String>,
    job_id: Option<String>,
    profile: Option<crate::store::MigrationProfileRef>,
) -> Result<SchemaDiffDeployResult, CommandError> {
    crate::commands::history::validate_migration_profile_ref(
        &state,
        "schemaDiff",
        profile.as_ref(),
    )
    .await?;
    let mut history_run =
        crate::commands::history::start_migration_run(&state, "schemaDiff", profile.as_ref()).await;
    history_run.selected_count = plan.statements.len() as u64;
    tracing::info!(
        %target_db_session_id,
        statements = plan.statements.len(),
        ?job_id,
        "execute_schema_diff_deploy"
    );

    let (driver, handle) = match state
        .connection_manager
        .get_session(&target_db_session_id)
        .await
        .cmd_err("execute_schema_diff_deploy")
    {
        Ok(value) => value,
        Err(error) => {
            return fail_schema_diff_deploy(&state, history_run, error).await;
        }
    };
    let config = state
        .connection_manager
        .get_session_config(&target_db_session_id)
        .await
        .cmd_err("execute_schema_diff_deploy");
    let config = match config {
        Ok(value) => value,
        Err(error) => {
            return fail_schema_diff_deploy(&state, history_run, error).await;
        }
    };
    let owner = match state
        .connection_manager
        .owner_connection_id(&target_db_session_id)
        .await
    {
        Some(value) => value,
        None => {
            return fail_schema_diff_deploy(
                &state,
                history_run,
                CommandError::Validation("Target connection owner is unavailable".into()),
            )
            .await;
        }
    };
    history_run.target_connection_id = Some(owner.clone());
    let persisted = match state.store.get_connection(&owner).await {
        Some(value) => value,
        None => {
            return fail_schema_diff_deploy(
                &state,
                history_run,
                CommandError::Validation("Target connection was removed".into()),
            )
            .await;
        }
    };
    if config.read_only || persisted.read_only {
        return fail_schema_diff_deploy(
            &state,
            history_run,
            CommandError::Validation("Target connection is read-only".into()),
        )
        .await;
    }
    if require_rollback.unwrap_or(false)
        && (!plan.rollback_completeness.complete
            || !use_transaction.unwrap_or(true)
            || !matches!(
                driver.ddl_atomicity(),
                crate::db::DdlAtomicity::Transactional
            ))
    {
        return fail_schema_diff_deploy(
            &state,
            history_run,
            CommandError::Validation(
                "Complete rollback requires transactional DDL and a complete rollback plan".into(),
            ),
        )
        .await;
    }
    if !plan.requirements.is_empty() {
        return fail_schema_diff_deploy(
            &state,
            history_run,
            CommandError::Validation(
                "Resolve plan requirements and prepare again before deploying".into(),
            ),
        )
        .await;
    }
    if plan_has_destructive(&plan) {
        let token = confirm_destructive.as_deref().unwrap_or("");
        if token != DESTRUCTIVE_CONFIRM_TOKEN {
            return fail_schema_diff_deploy(
                &state,
                history_run,
                CommandError::Validation(format!(
                    "destructive plan requires confirm_destructive = \"{DESTRUCTIVE_CONFIRM_TOKEN}\""
                )),
            )
            .await;
        }
    }

    let reviewed =
        match crate::schema_diff::reviewed::consume(&plan, &target_db_session_id, &handle, &config)
            .await
        {
            Ok(value) => value,
            Err(error) => {
                return fail_schema_diff_deploy(
                    &state,
                    history_run,
                    CommandError::Validation(error),
                )
                .await;
            }
        };
    for (table, snapshot) in &reviewed.snapshots {
        let current = match fetch_target_table_schema(
            driver.as_ref(),
            &handle,
            table,
            config.database.as_deref().unwrap_or_default(),
            config.schema.as_deref(),
        )
        .await
        {
            Ok(value) => value,
            Err(error) => return fail_schema_diff_deploy(&state, history_run, error).await,
        };
        if let Err(error) =
            crate::schema_diff::reviewed::validate_snapshot(table, snapshot, &current)
        {
            return fail_schema_diff_deploy(&state, history_run, CommandError::Validation(error))
                .await;
        }
    }
    for snapshot in &reviewed.object_snapshots {
        let object = datazen_driver_api::DatabaseObject {
            kind: snapshot.kind.as_str().into(),
            schema: snapshot.schema.clone(),
            name: snapshot.name.clone(),
            signature: snapshot.signature.clone(),
            target_schema: snapshot.target_schema.clone(),
            target_name: snapshot.target_name.clone(),
        };
        let current = match fetch_schema_object(driver.as_ref(), &handle, &object).await {
            Ok(value) => value,
            Err(error) => return fail_schema_diff_deploy(&state, history_run, error).await,
        };
        if let Err(error) =
            crate::schema_diff::reviewed::validate_object_snapshot(snapshot, &current)
        {
            return fail_schema_diff_deploy(&state, history_run, CommandError::Validation(error))
                .await;
        }
    }
    let plan = reviewed.plan;
    let cancelled = match job_id.as_deref() {
        Some(id) => Some(ensure_job(id).await),
        None => None,
    };

    let opts = DeployOptions {
        use_transaction: use_transaction.unwrap_or(true),
        stop_on_error: true,
    };

    let result = run_schema_diff_deploy(driver.as_ref(), &handle, &plan, opts, cancelled).await;

    if let Some(id) = job_id.as_deref() {
        remove_job(id).await;
    }

    tracing::info!(
        ?result.status,
        executed = result.executed_count,
        "execute_schema_diff_deploy OK"
    );
    let cancelled_outcome = matches!(result.status, crate::schema_diff::DeployStatus::Cancelled);
    let success_outcome = matches!(result.status, crate::schema_diff::DeployStatus::Committed);
    let rollback_outcome = match result.status {
        crate::schema_diff::DeployStatus::RolledBack => "completed",
        crate::schema_diff::DeployStatus::Unknown | crate::schema_diff::DeployStatus::Mixed => {
            "unknown"
        }
        _ => "notRequired",
    };
    crate::commands::history::finish_migration_run(
        &state,
        history_run,
        success_outcome,
        cancelled_outcome,
        result.executed_count as u64,
        result.errors.len() as u64,
        0,
        rollback_outcome,
    )
    .await;
    Ok(result)
}

/// Cancel an in-progress schema diff deploy job.
#[tauri::command]
pub async fn cancel_schema_diff_deploy(job_id: String) -> Result<bool, CommandError> {
    Ok(cancel_job(&job_id).await)
}

/// Compare column-level schema differences for a single table.
pub(crate) async fn compare_table_schemas_impl(
    state: &AppState,
    source_db_session_id: String,
    target_db_session_id: String,
    table_name: String,
) -> Result<serde_json::Value, CommandError> {
    tracing::info!(%source_db_session_id, %target_db_session_id, %table_name, "compare_table_schemas");

    let src_config = state
        .connection_manager
        .get_session_config(&source_db_session_id)
        .await
        .cmd_err("compare_table_schemas")?;
    let tgt_config = state
        .connection_manager
        .get_session_config(&target_db_session_id)
        .await
        .cmd_err("compare_table_schemas")?;

    let (src_driver, src_handle) = state
        .connection_manager
        .get_session(&source_db_session_id)
        .await
        .cmd_err("compare_table_schemas")?;
    let (tgt_driver, tgt_handle) = state
        .connection_manager
        .get_session(&target_db_session_id)
        .await
        .cmd_err("compare_table_schemas")?;

    let src_table = resolve_table_for_dialect(&src_config.database_type, &table_name);
    let tgt_table = resolve_table_for_dialect(&tgt_config.database_type, &table_name);

    let src_schema = src_driver
        .get_table_schema(
            &src_handle,
            &src_table,
            src_config.database.as_deref().unwrap_or_default(),
            src_config.schema.as_deref(),
        )
        .await
        .cmd_err("compare_table_schemas")?;
    let tgt_schema = fetch_target_table_schema(
        tgt_driver.as_ref(),
        &tgt_handle,
        &tgt_table,
        tgt_config.database.as_deref().unwrap_or_default(),
        tgt_config.schema.as_deref(),
    )
    .await
    .cmd_err("compare_table_schemas")?;

    // Source = desired: missingOnTarget → ADD, extraOnTarget → DROP.
    // `added`/`removed` kept as aliases for one release.
    let mut source_ddl: Option<String> = None;
    let mut target_ddl: Option<String> = None;
    let mut ir_diff: Option<TableColumnDiff> = None;

    if state
        .sync_adapters
        .ensure_pair(&src_config.database_type, &tgt_config.database_type)
        .is_ok()
    {
        let src_source = state.sync_adapters.get_source(&src_config.database_type);
        let tgt_source = state.sync_adapters.get_source(&tgt_config.database_type);
        let src_target = state.sync_adapters.get_target(&src_config.database_type);
        let tgt_target = state.sync_adapters.get_target(&tgt_config.database_type);

        if let (
            Some(src_adapter),
            Some(tgt_src_adapter),
            Some(src_tgt_adapter),
            Some(tgt_adapter),
        ) = (src_source, tgt_source, src_target, tgt_target)
        {
            let src_full_types = fetch_full_column_types(
                src_adapter.as_ref(),
                src_driver.as_ref(),
                &src_handle,
                &src_table,
            )
            .await
            .ok();
            let tgt_full_types = if tgt_schema.columns.is_empty() {
                None
            } else {
                fetch_full_column_types(
                    tgt_src_adapter.as_ref(),
                    tgt_driver.as_ref(),
                    &tgt_handle,
                    &tgt_table,
                )
                .await
                .ok()
            };

            let src_ir = src_adapter.table_to_ir(&src_schema, src_full_types.as_ref());
            let tgt_ir = tgt_src_adapter.table_to_ir(&tgt_schema, tgt_full_types.as_ref());
            ir_diff = Some(diff_table_schemas_ir(&table_name, &src_ir, &tgt_ir));
            source_ddl = Some(build_create_table_ddl(&src_ir, src_tgt_adapter.as_ref()));
            target_ddl = if tgt_ir.columns.is_empty() {
                None
            } else {
                Some(build_create_table_ddl(&tgt_ir, tgt_adapter.as_ref()))
            };
        }
    }

    let src_d = normalize_dialect(&src_config.database_type);
    let tgt_d = normalize_dialect(&tgt_config.database_type);
    let normalizer_holder = if src_d == tgt_d {
        datazen_driver_api::create_driver(&tgt_d).and_then(|d| d.type_normalizer())
    } else {
        None
    };
    let normalizer = normalizer_holder.as_deref();

    let diff = ir_diff
        .unwrap_or_else(|| diff_table_schemas(&table_name, &src_schema, &tgt_schema, normalizer));

    let mut result = serde_json::json!({
        "table": table_name,
        "missingOnTarget": diff.missing_on_target,
        "extraOnTarget": diff.extra_on_target,
        "added": diff.added,
        "removed": diff.removed,
        "changed": diff.changed,
    });
    if let Some(ddl) = source_ddl {
        result["sourceDdl"] = serde_json::Value::String(ddl);
    }
    if let Some(ddl) = target_ddl {
        result["targetDdl"] = serde_json::Value::String(ddl);
    }

    tracing::info!(%table_name, "compare_table_schemas OK");
    Ok(result)
}

#[tauri::command]
pub async fn compare_table_schemas(
    state: State<'_, AppState>,
    source_db_session_id: String,
    target_db_session_id: String,
    table_name: String,
) -> Result<serde_json::Value, CommandError> {
    compare_table_schemas_impl(
        &state,
        source_db_session_id,
        target_db_session_id,
        table_name,
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_profile() -> SchemaDiffProfile {
        let now = chrono::Utc::now();
        SchemaDiffProfile {
            version: SchemaDiffProfile::CURRENT_VERSION,
            id: "profile-1".into(),
            name: "profile".into(),
            source_connection_id: "source".into(),
            target_connection_id: "target".into(),
            source_database: "app".into(),
            target_database: "app".into(),
            source_schema: None,
            target_schema: None,
            target_only_tables: vec![],
            tables: vec!["users".into()],
            allow_destructive: false,
            include_indexes: true,
            require_rollback: false,
            type_overrides: vec![],
            created_at: now,
            updated_at: now,
        }
    }

    #[test]
    fn is_table_missing_error_detects_various_patterns() {
        assert!(is_table_missing_error(
            "Query failed: error returned from database: 1146 (42S02): Table 'datazen_demo.demo_customers' doesn't exist"
        ));
        assert!(is_table_missing_error(
            "relation \"public.demo_customers\" does not exist"
        ));
        assert!(is_table_missing_error("Table 'users' doesn't exist"));
        assert!(is_table_missing_error("Table not found: users"));
        assert!(!is_table_missing_error("Connection refused"));
        assert!(!is_table_missing_error("Syntax error in SQL statement"));
    }

    #[test]
    fn test_tester_schema_object_selectors_require_unambiguous_identity_and_allow_target_only_drop()
    {
        let source = vec![datazen_driver_api::DatabaseObject {
            kind: "view".into(),
            schema: Some("public".into()),
            name: "active_users".into(),
            signature: None,
            target_schema: None,
            target_name: None,
        }];
        let target = vec![datazen_driver_api::DatabaseObject {
            kind: "view".into(),
            schema: Some("public".into()),
            name: "legacy_users".into(),
            signature: None,
            target_schema: None,
            target_name: None,
        }];
        let (source_selected, target_selected) =
            select_schema_object_pair(&source, &target, &["public.active_users".into()]).unwrap();
        assert_eq!(source_selected.len(), 1);
        assert!(target_selected.is_empty());
        let (source_selected, target_selected) =
            select_schema_object_pair(&source, &target, &["public.legacy_users".into()]).unwrap();
        assert!(source_selected.is_empty());
        assert_eq!(target_selected.len(), 1);

        let ambiguous = vec![
            datazen_driver_api::DatabaseObject {
                kind: "view".into(),
                schema: Some("one".into()),
                name: "same".into(),
                signature: None,
                target_schema: None,
                target_name: None,
            },
            datazen_driver_api::DatabaseObject {
                kind: "view".into(),
                schema: Some("two".into()),
                name: "same".into(),
                signature: None,
                target_schema: None,
                target_name: None,
            },
        ];
        assert!(select_schema_object_pair(&ambiguous, &[], &["same".into()]).is_err());
    }

    #[test]
    fn test_tester_schema_object_selectors_preserve_overloads_and_trigger_relations() {
        let functions = vec![
            datazen_driver_api::DatabaseObject {
                kind: "function".into(),
                schema: Some("public".into()),
                name: "lookup".into(),
                signature: Some("integer".into()),
                target_schema: None,
                target_name: None,
            },
            datazen_driver_api::DatabaseObject {
                kind: "function".into(),
                schema: Some("public".into()),
                name: "lookup".into(),
                signature: Some("text".into()),
                target_schema: None,
                target_name: None,
            },
        ];
        let (source, target) =
            select_schema_object_pair(&functions, &functions, &["public.lookup(integer)".into()])
                .unwrap();
        assert_eq!(source.len(), 1);
        assert_eq!(target.len(), 1);
        assert_eq!(source[0].signature.as_deref(), Some("integer"));
        assert!(select_schema_object_pair(&functions, &functions, &["lookup".into()]).is_err());

        let triggers = vec![
            datazen_driver_api::DatabaseObject {
                kind: "trigger".into(),
                schema: Some("public".into()),
                name: "audit".into(),
                signature: None,
                target_schema: Some("public".into()),
                target_name: Some("orders".into()),
            },
            datazen_driver_api::DatabaseObject {
                kind: "trigger".into(),
                schema: Some("public".into()),
                name: "audit".into(),
                signature: None,
                target_schema: Some("public".into()),
                target_name: Some("invoices".into()),
            },
        ];
        let (source, target) = select_schema_object_pair(
            &triggers,
            &triggers,
            &["public.audit ON public.orders".into()],
        )
        .unwrap();
        assert_eq!(source.len(), 1);
        assert_eq!(target.len(), 1);
        assert_eq!(source[0].target_name.as_deref(), Some("orders"));
        assert!(select_schema_object_pair(&triggers, &triggers, &["audit".into()]).is_err());
    }

    #[tokio::test]
    async fn schema_diff_profile_save_requires_existing_connections() {
        let test = crate::testing::app_state::TestAppState::new().await;
        test.save_connection("source").await;
        let profile = test_profile();
        let error = validate_schema_diff_profile_connections(&test.state, &profile)
            .await
            .expect_err("missing target should be rejected");
        assert!(error.to_string().contains("target connection"));

        test.save_connection("target").await;
        assert!(
            validate_schema_diff_profile_connections(&test.state, &profile)
                .await
                .is_ok()
        );
    }
}
