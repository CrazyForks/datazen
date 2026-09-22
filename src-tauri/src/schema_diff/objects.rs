//! Schema object migration planning.
//!
//! Schema object migration planning. Definitions remain driver-owned DDL; the
//! host only compares identities, applies safety gates, and asks the target
//! renderer for statements.

use super::operations::MigrationOperation;
use super::types::{
    normalize_dialect, PlanRequirement, PlanStatement, RollbackCompleteness, SchemaDiffPlan,
    StatementRisk,
};
use datazen_driver_api::{
    validate_object_definition_with_identity, validate_view_definition, MigrationCapabilities,
    MigrationRenderer, MigrationRoutine, MigrationTrigger, MigrationView, ObjectKind,
};
use std::collections::{BTreeSet, HashMap};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SchemaObjectSnapshot {
    pub kind: ObjectKind,
    pub schema: Option<String>,
    pub name: String,
    pub signature: Option<String>,
    pub target_schema: Option<String>,
    pub target_name: Option<String>,
    /// Query body without the `CREATE VIEW ... AS` wrapper.
    pub definition: String,
}

impl SchemaObjectSnapshot {
    pub fn view(schema: Option<&str>, name: &str, definition: &str) -> Self {
        Self {
            kind: ObjectKind::View,
            schema: schema.map(str::to_owned),
            name: name.to_owned(),
            signature: None,
            target_schema: None,
            target_name: None,
            definition: definition.to_owned(),
        }
    }

    pub fn routine(
        kind: ObjectKind,
        schema: Option<&str>,
        name: &str,
        signature: Option<&str>,
        definition: &str,
    ) -> Self {
        Self {
            kind,
            schema: schema.map(str::to_owned),
            name: name.to_owned(),
            signature: signature.map(str::to_owned),
            target_schema: None,
            target_name: None,
            definition: definition.to_owned(),
        }
    }

    pub fn trigger(
        schema: Option<&str>,
        name: &str,
        target_schema: Option<&str>,
        target_name: &str,
        definition: &str,
    ) -> Self {
        Self {
            kind: ObjectKind::Trigger,
            schema: schema.map(str::to_owned),
            name: name.to_owned(),
            signature: None,
            target_schema: target_schema.map(str::to_owned),
            target_name: Some(target_name.to_owned()),
            definition: definition.to_owned(),
        }
    }

    fn key(
        &self,
    ) -> (
        Option<String>,
        String,
        Option<String>,
        Option<String>,
        Option<String>,
        ObjectKind,
    ) {
        (
            self.schema.clone(),
            self.name.clone(),
            self.signature.clone(),
            self.target_schema.clone(),
            self.target_name.clone(),
            self.kind,
        )
    }

    fn as_migration_view(&self) -> MigrationView {
        MigrationView {
            schema: self.schema.clone(),
            name: self.name.clone(),
            definition: self.definition.clone(),
        }
    }

    fn as_migration_routine(&self) -> Result<MigrationRoutine, String> {
        if !matches!(self.kind, ObjectKind::Function | ObjectKind::Procedure) {
            return Err("schema object is not a routine".into());
        }
        Ok(MigrationRoutine {
            kind: self.kind,
            schema: self.schema.clone(),
            name: self.name.clone(),
            signature: self.signature.clone(),
            definition: self.definition.clone(),
        })
    }

    fn as_migration_trigger(&self) -> Result<MigrationTrigger, String> {
        if self.kind != ObjectKind::Trigger {
            return Err("schema object is not a trigger".into());
        }
        Ok(MigrationTrigger {
            schema: self.schema.clone(),
            name: self.name.clone(),
            target_schema: self.target_schema.clone(),
            target_name: self
                .target_name
                .clone()
                .ok_or("trigger target relation is missing")?,
            definition: self.definition.clone(),
        })
    }
}

fn unsupported_plan(
    source_dialect: &str,
    target_dialect: &str,
    tables: Vec<String>,
    operation: impl Into<String>,
    reason: impl Into<String>,
) -> SchemaDiffPlan {
    SchemaDiffPlan {
        plan_id: None,
        table: tables.first().cloned().unwrap_or_else(|| "view".into()),
        tables,
        source_dialect: normalize_dialect(source_dialect),
        target_dialect: normalize_dialect(target_dialect),
        same_dialect: normalize_dialect(source_dialect) == normalize_dialect(target_dialect),
        statements: Vec::new(),
        warnings: Vec::new(),
        requirements: vec![PlanRequirement::Unsupported {
            operation: operation.into(),
            reason: reason.into(),
        }],
        rollback_completeness: RollbackCompleteness {
            complete: true,
            missing: Vec::new(),
        },
        type_suggestions: Vec::new(),
    }
}

/// Build a reviewed-plan-compatible migration plan for selected views.
///
/// Source and target must be the same normalized dialect. The source DDL is
/// metadata, but cross-family SQL cannot be translated safely without a
/// driver-owned view dependency/type contract, so this function fails closed.
pub fn build_view_migration_plan(
    source: &[SchemaObjectSnapshot],
    target: &[SchemaObjectSnapshot],
    source_dialect: &str,
    target_dialect: &str,
    allow_destructive: bool,
) -> SchemaDiffPlan {
    let target_dialect = normalize_dialect(target_dialect);
    let Some(driver) = datazen_driver_api::create_driver(&target_dialect) else {
        return unsupported_plan(
            source_dialect,
            &target_dialect,
            Vec::new(),
            "view",
            format!("No registered driver for target database: {target_dialect}"),
        );
    };
    let Some(renderer) = driver.migration_renderer() else {
        return unsupported_plan(
            source_dialect,
            &target_dialect,
            Vec::new(),
            "view",
            format!("Driver {target_dialect} does not expose schema migration rendering"),
        );
    };
    let Some(capabilities) = driver.migration_capabilities() else {
        return unsupported_plan(
            source_dialect,
            &target_dialect,
            Vec::new(),
            "view",
            format!("Driver {target_dialect} does not expose schema migration capabilities"),
        );
    };
    build_view_migration_plan_with_components(
        source,
        target,
        source_dialect,
        &target_dialect,
        allow_destructive,
        renderer.as_ref(),
        capabilities.as_ref(),
    )
}

/// Component form used by host tests and driver-specific acceptance tests.
pub fn build_view_migration_plan_with_components(
    source: &[SchemaObjectSnapshot],
    target: &[SchemaObjectSnapshot],
    source_dialect: &str,
    target_dialect: &str,
    allow_destructive: bool,
    renderer: &dyn MigrationRenderer,
    capabilities: &dyn MigrationCapabilities,
) -> SchemaDiffPlan {
    let source_dialect = normalize_dialect(source_dialect);
    let target_dialect = normalize_dialect(target_dialect);
    let mut tables = BTreeSet::new();
    let mut requirements = Vec::new();
    let mut warnings = Vec::new();

    if source_dialect != target_dialect {
        return unsupported_plan(
            &source_dialect,
            &target_dialect,
            Vec::new(),
            "view",
            "View migration requires matching source and target dialects",
        );
    }

    let mut source_by_key = HashMap::new();
    for object in source {
        if object.kind != ObjectKind::View {
            requirements.push(PlanRequirement::Unsupported {
                operation: object.name.clone(),
                reason: "Only view objects are supported by this migration slice".into(),
            });
            continue;
        }
        if object.name.trim().is_empty() {
            requirements.push(PlanRequirement::Unsupported {
                operation: "view".into(),
                reason: "View name must not be empty".into(),
            });
            continue;
        }
        let key = (object.schema.clone(), object.name.clone());
        if source_by_key.insert(key, object).is_some() {
            requirements.push(PlanRequirement::Unsupported {
                operation: object.name.clone(),
                reason: "Source contains duplicate view identities".into(),
            });
        }
    }

    let mut target_by_key = HashMap::new();
    for object in target {
        if object.kind != ObjectKind::View {
            requirements.push(PlanRequirement::Unsupported {
                operation: object.name.clone(),
                reason: "Only view objects are supported by this migration slice".into(),
            });
            continue;
        }
        if object.name.trim().is_empty() {
            requirements.push(PlanRequirement::Unsupported {
                operation: "view".into(),
                reason: "View name must not be empty".into(),
            });
            continue;
        }
        let key = (object.schema.clone(), object.name.clone());
        if target_by_key.insert(key, object).is_some() {
            requirements.push(PlanRequirement::Unsupported {
                operation: object.name.clone(),
                reason: "Target contains duplicate view identities".into(),
            });
        }
    }

    let mut operations = Vec::new();
    let mut keys = BTreeSet::new();
    keys.extend(source_by_key.keys().cloned());
    keys.extend(target_by_key.keys().cloned());
    for (schema, name) in keys {
        let display = schema
            .as_deref()
            .map(|schema| format!("{schema}.{name}"))
            .unwrap_or_else(|| name.clone());
        tables.insert(display);
        match (
            source_by_key.get(&(schema.clone(), name.clone())),
            target_by_key.get(&(schema, name)),
        ) {
            (Some(desired), None) => operations.push(MigrationOperation::CreateView {
                view: desired.as_migration_view(),
            }),
            (Some(desired), Some(current))
                if desired.definition.trim() != current.definition.trim() =>
            {
                operations.push(MigrationOperation::ReplaceView {
                    current: current.as_migration_view(),
                    desired: desired.as_migration_view(),
                });
            }
            (None, Some(current)) => {
                let operation = MigrationOperation::DropView {
                    view: current.as_migration_view(),
                };
                if allow_destructive {
                    operations.push(operation);
                } else {
                    warnings.push(format!("Skipped destructive operation {}", operation.key()));
                }
            }
            _ => {}
        }
    }

    let mut statements = Vec::new();
    for operation in operations {
        let key = operation.key();
        let definition_validation = match &operation {
            MigrationOperation::CreateView { view } | MigrationOperation::DropView { view } => {
                validate_view_definition(&view.definition)
            }
            MigrationOperation::ReplaceView { current, desired } => {
                validate_view_definition(&current.definition)
                    .and(validate_view_definition(&desired.definition))
            }
            _ => Ok(()),
        };
        if let Err(reason) = definition_validation {
            requirements.push(PlanRequirement::Unsupported {
                operation: key,
                reason,
            });
            continue;
        }
        if !capabilities.supports(&operation.to_driver_api()) {
            requirements.push(PlanRequirement::Unsupported {
                operation: key,
                reason: format!("Operation is not supported by {target_dialect}"),
            });
            continue;
        }
        let driver_operation = operation.to_driver_api();
        match renderer.render(&driver_operation) {
            Ok(statement) => {
                let risk = match statement.risk {
                    datazen_driver_api::MigrationRisk::Additive => StatementRisk::Additive,
                    datazen_driver_api::MigrationRisk::Rewrite => StatementRisk::Rewrite,
                    datazen_driver_api::MigrationRisk::Destructive => StatementRisk::Destructive,
                };
                statements.push(PlanStatement {
                    sql: statement.sql,
                    risk,
                    rollback_sql: statement.rollback_sql,
                    summary: statement.summary,
                });
            }
            Err(reason) => requirements.push(PlanRequirement::Unsupported {
                operation: key,
                reason,
            }),
        }
    }

    // Validate all source/target definitions even when no operation is emitted
    // (for example an unchanged view). Invalid metadata must not silently
    // become a successful migration plan.
    for object in source.iter().chain(target.iter()) {
        if object.kind == ObjectKind::View {
            if let Err(reason) = validate_view_definition(&object.definition) {
                requirements.push(PlanRequirement::Unsupported {
                    operation: object.name.clone(),
                    reason,
                });
            }
        }
    }

    let missing = statements
        .iter()
        .filter(|statement| statement.rollback_sql.is_none())
        .map(|statement| statement.summary.clone())
        .collect::<Vec<_>>();
    SchemaDiffPlan {
        plan_id: None,
        table: tables.first().cloned().unwrap_or_else(|| "view".into()),
        tables: tables.into_iter().collect(),
        source_dialect,
        target_dialect,
        same_dialect: true,
        statements,
        warnings,
        requirements,
        rollback_completeness: RollbackCompleteness {
            complete: missing.is_empty(),
            missing,
        },
        type_suggestions: Vec::new(),
    }
}

/// Build a reviewed migration plan for PostgreSQL/MySQL routines and
/// triggers. The operation is intentionally same-dialect only: the source
/// DDL is opaque procedural SQL and the host cannot translate it safely.
pub fn build_routine_trigger_migration_plan(
    source: &[SchemaObjectSnapshot],
    target: &[SchemaObjectSnapshot],
    source_dialect: &str,
    target_dialect: &str,
    allow_destructive: bool,
) -> SchemaDiffPlan {
    let target_dialect = normalize_dialect(target_dialect);
    let Some(driver) = datazen_driver_api::create_driver(&target_dialect) else {
        return unsupported_plan(
            source_dialect,
            &target_dialect,
            Vec::new(),
            "routine/trigger",
            format!("No registered driver for target database: {target_dialect}"),
        );
    };
    let Some(renderer) = driver.migration_renderer() else {
        return unsupported_plan(
            source_dialect,
            &target_dialect,
            Vec::new(),
            "routine/trigger",
            format!("Driver {target_dialect} does not expose schema migration rendering"),
        );
    };
    let Some(capabilities) = driver.migration_capabilities() else {
        return unsupported_plan(
            source_dialect,
            &target_dialect,
            Vec::new(),
            "routine/trigger",
            format!("Driver {target_dialect} does not expose schema migration capabilities"),
        );
    };
    build_routine_trigger_migration_plan_with_components(
        source,
        target,
        source_dialect,
        &target_dialect,
        allow_destructive,
        renderer.as_ref(),
        capabilities.as_ref(),
    )
}

pub fn build_routine_trigger_migration_plan_with_components(
    source: &[SchemaObjectSnapshot],
    target: &[SchemaObjectSnapshot],
    source_dialect: &str,
    target_dialect: &str,
    allow_destructive: bool,
    renderer: &dyn MigrationRenderer,
    capabilities: &dyn MigrationCapabilities,
) -> SchemaDiffPlan {
    let source_dialect = normalize_dialect(source_dialect);
    let target_dialect = normalize_dialect(target_dialect);
    if source_dialect != target_dialect {
        return unsupported_plan(
            &source_dialect,
            &target_dialect,
            Vec::new(),
            "routine/trigger",
            "Routine and trigger migration requires matching source and target dialects",
        );
    }

    let mut requirements = Vec::new();
    let mut warnings = Vec::new();
    let mut source_by_key = HashMap::new();
    let mut target_by_key = HashMap::new();
    let valid_kind = |kind: ObjectKind| {
        matches!(
            kind,
            ObjectKind::Function | ObjectKind::Procedure | ObjectKind::Trigger
        )
    };
    let validate = |object: &SchemaObjectSnapshot, requirements: &mut Vec<PlanRequirement>| {
        if !valid_kind(object.kind) {
            requirements.push(PlanRequirement::Unsupported {
                operation: object.name.clone(),
                reason: "Only functions, procedures, and triggers are supported".into(),
            });
            return false;
        }
        if object.name.trim().is_empty() {
            requirements.push(PlanRequirement::Unsupported {
                operation: object.name.clone(),
                reason: "Schema object name must not be empty".into(),
            });
            return false;
        }
        if object.kind == ObjectKind::Trigger
            && object
                .target_name
                .as_deref()
                .unwrap_or("")
                .trim()
                .is_empty()
        {
            requirements.push(PlanRequirement::Unsupported {
                operation: object.name.clone(),
                reason: "Trigger target relation is required".into(),
            });
            return false;
        }
        let signature = if matches!(object.kind, ObjectKind::Function | ObjectKind::Procedure) {
            object.signature.as_deref()
        } else {
            None
        };
        if let Err(reason) = validate_object_definition_with_identity(
            &object.definition,
            object.kind,
            &object.name,
            signature,
        ) {
            requirements.push(PlanRequirement::Unsupported {
                operation: object.name.clone(),
                reason,
            });
            return false;
        }
        true
    };

    for object in source {
        if validate(object, &mut requirements) {
            if source_by_key.insert(object.key(), object).is_some() {
                requirements.push(PlanRequirement::Unsupported {
                    operation: object.name.clone(),
                    reason: "Source contains duplicate routine/trigger identities".into(),
                });
            }
        }
    }
    for object in target {
        if validate(object, &mut requirements) {
            if target_by_key.insert(object.key(), object).is_some() {
                requirements.push(PlanRequirement::Unsupported {
                    operation: object.name.clone(),
                    reason: "Target contains duplicate routine/trigger identities".into(),
                });
            }
        }
    }

    let mut keys = BTreeSet::new();
    keys.extend(source_by_key.keys().cloned());
    keys.extend(target_by_key.keys().cloned());
    let mut tables = Vec::new();
    let mut operations = Vec::new();
    for key in keys {
        let source_object = source_by_key.get(&key).copied();
        let target_object = target_by_key.get(&key).copied();
        let Some(object) = source_object.or(target_object) else {
            continue;
        };
        let label = object_label(object);
        tables.push(label);
        match (source_object, target_object) {
            (Some(desired), None) => match desired.kind {
                ObjectKind::Trigger => match desired.as_migration_trigger() {
                    Ok(trigger) => operations.push(MigrationOperation::CreateTrigger { trigger }),
                    Err(reason) => requirements.push(PlanRequirement::Unsupported {
                        operation: desired.name.clone(),
                        reason,
                    }),
                },
                ObjectKind::Function | ObjectKind::Procedure => {
                    match desired.as_migration_routine() {
                        Ok(routine) => {
                            operations.push(MigrationOperation::CreateRoutine { routine })
                        }
                        Err(reason) => requirements.push(PlanRequirement::Unsupported {
                            operation: desired.name.clone(),
                            reason,
                        }),
                    }
                }
                _ => requirements.push(PlanRequirement::Unsupported {
                    operation: desired.name.clone(),
                    reason: "Only functions, procedures, and triggers are supported".into(),
                }),
            },
            (Some(desired), Some(current))
                if desired.definition.trim() != current.definition.trim() =>
            {
                match desired.kind {
                    ObjectKind::Trigger => match (
                        current.as_migration_trigger(),
                        desired.as_migration_trigger(),
                    ) {
                        (Ok(current), Ok(desired)) => {
                            operations.push(MigrationOperation::ReplaceTrigger { current, desired })
                        }
                        (Err(reason), _) | (_, Err(reason)) => {
                            requirements.push(PlanRequirement::Unsupported {
                                operation: desired.name.clone(),
                                reason,
                            })
                        }
                    },
                    ObjectKind::Function | ObjectKind::Procedure => match (
                        current.as_migration_routine(),
                        desired.as_migration_routine(),
                    ) {
                        (Ok(current), Ok(desired)) => {
                            operations.push(MigrationOperation::ReplaceRoutine { current, desired })
                        }
                        (Err(reason), _) | (_, Err(reason)) => {
                            requirements.push(PlanRequirement::Unsupported {
                                operation: desired.name.clone(),
                                reason,
                            })
                        }
                    },
                    _ => requirements.push(PlanRequirement::Unsupported {
                        operation: desired.name.clone(),
                        reason: "Only functions, procedures, and triggers are supported".into(),
                    }),
                }
            }
            (None, Some(current)) => {
                let operation = match current.kind {
                    ObjectKind::Trigger => current
                        .as_migration_trigger()
                        .map(|trigger| MigrationOperation::DropTrigger { trigger }),
                    ObjectKind::Function | ObjectKind::Procedure => current
                        .as_migration_routine()
                        .map(|routine| MigrationOperation::DropRoutine { routine }),
                    _ => Err("Only functions, procedures, and triggers are supported".into()),
                };
                match operation {
                    Ok(operation) if allow_destructive => operations.push(operation),
                    Ok(operation) => {
                        warnings.push(format!("Skipped destructive operation {}", operation.key()))
                    }
                    Err(reason) => requirements.push(PlanRequirement::Unsupported {
                        operation: current.name.clone(),
                        reason,
                    }),
                }
            }
            _ => {}
        }
    }

    operations.sort_by_key(|operation| {
        let priority = match operation {
            MigrationOperation::CreateRoutine { .. } => 0,
            MigrationOperation::ReplaceRoutine { .. } => 1,
            MigrationOperation::CreateTrigger { .. } => 2,
            MigrationOperation::ReplaceTrigger { .. } => 3,
            MigrationOperation::DropTrigger { .. } => 4,
            MigrationOperation::DropRoutine { .. } => 5,
            _ => 6,
        };
        (priority, operation.key())
    });
    let mut statements = Vec::new();
    for operation in operations {
        let key = operation.key();
        let driver_operation = operation.to_driver_api();
        if !capabilities.supports(&driver_operation) {
            requirements.push(PlanRequirement::Unsupported {
                operation: key,
                reason: format!("Operation is not supported by {target_dialect}"),
            });
            continue;
        }
        match renderer.render(&driver_operation) {
            Ok(statement) => {
                let risk = match statement.risk {
                    datazen_driver_api::MigrationRisk::Additive => StatementRisk::Additive,
                    datazen_driver_api::MigrationRisk::Rewrite => StatementRisk::Rewrite,
                    datazen_driver_api::MigrationRisk::Destructive => StatementRisk::Destructive,
                };
                statements.push(PlanStatement {
                    sql: statement.sql,
                    risk,
                    rollback_sql: statement.rollback_sql,
                    summary: statement.summary,
                });
            }
            Err(reason) => requirements.push(PlanRequirement::Unsupported {
                operation: key,
                reason,
            }),
        }
    }
    let missing = statements
        .iter()
        .filter(|statement| statement.rollback_sql.is_none())
        .map(|statement| statement.summary.clone())
        .collect::<Vec<_>>();
    SchemaDiffPlan {
        plan_id: None,
        table: tables
            .first()
            .cloned()
            .unwrap_or_else(|| "routine/trigger".into()),
        tables,
        source_dialect,
        target_dialect,
        same_dialect: true,
        statements,
        warnings,
        requirements,
        rollback_completeness: RollbackCompleteness {
            complete: missing.is_empty(),
            missing,
        },
        type_suggestions: Vec::new(),
    }
}

fn object_label(object: &SchemaObjectSnapshot) -> String {
    let schema = object.schema.as_deref().filter(|value| !value.is_empty());
    match object.kind {
        ObjectKind::Function | ObjectKind::Procedure => format!(
            "{}:{}:{}:{}",
            object.kind.as_str(),
            schema.unwrap_or_default(),
            object.name,
            object.signature.as_deref().unwrap_or_default()
        ),
        ObjectKind::Trigger => format!(
            "trigger:{}:{}:{}:{}",
            schema.unwrap_or_default(),
            object.name,
            object.target_schema.as_deref().unwrap_or_default(),
            object.target_name.as_deref().unwrap_or_default()
        ),
        _ => object.name.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use datazen_driver_api::{
        MigrationOperation as DriverOperation, MigrationRisk, MigrationStatement,
    };

    struct TestRenderer;
    impl MigrationRenderer for TestRenderer {
        fn render(&self, operation: &DriverOperation) -> Result<MigrationStatement, String> {
            match operation {
                DriverOperation::CreateView { view } => Ok(MigrationStatement {
                    sql: format!("CREATE VIEW {} AS {}", view.name, view.definition),
                    risk: MigrationRisk::Additive,
                    rollback_sql: Some(format!("DROP VIEW {}", view.name)),
                    summary: format!("CREATE VIEW {}", view.name),
                }),
                DriverOperation::ReplaceView { current, desired } => Ok(MigrationStatement {
                    sql: format!("REPLACE VIEW {} AS {}", desired.name, desired.definition),
                    risk: MigrationRisk::Rewrite,
                    rollback_sql: Some(format!(
                        "REPLACE VIEW {} AS {}",
                        current.name, current.definition
                    )),
                    summary: format!("REPLACE VIEW {}", desired.name),
                }),
                DriverOperation::DropView { view } => Ok(MigrationStatement {
                    sql: format!("DROP VIEW {}", view.name),
                    risk: MigrationRisk::Destructive,
                    rollback_sql: Some(format!("CREATE VIEW {} AS {}", view.name, view.definition)),
                    summary: format!("DROP VIEW {}", view.name),
                }),
                DriverOperation::CreateRoutine { routine } => Ok(MigrationStatement {
                    sql: routine.definition.clone(),
                    risk: MigrationRisk::Additive,
                    rollback_sql: Some(format!("DROP {} {}", routine.kind.as_str(), routine.name)),
                    summary: format!("CREATE {} {}", routine.kind.as_str(), routine.name),
                }),
                DriverOperation::ReplaceRoutine { desired, current } => Ok(MigrationStatement {
                    sql: desired.definition.clone(),
                    risk: MigrationRisk::Rewrite,
                    rollback_sql: Some(current.definition.clone()),
                    summary: format!("REPLACE {} {}", desired.kind.as_str(), desired.name),
                }),
                DriverOperation::DropRoutine { routine } => Ok(MigrationStatement {
                    sql: format!("DROP {} {}", routine.kind.as_str(), routine.name),
                    risk: MigrationRisk::Destructive,
                    rollback_sql: Some(routine.definition.clone()),
                    summary: format!("DROP {} {}", routine.kind.as_str(), routine.name),
                }),
                DriverOperation::CreateTrigger { trigger } => Ok(MigrationStatement {
                    sql: trigger.definition.clone(),
                    risk: MigrationRisk::Additive,
                    rollback_sql: Some(format!("DROP TRIGGER {}", trigger.name)),
                    summary: format!("CREATE TRIGGER {}", trigger.name),
                }),
                DriverOperation::ReplaceTrigger { desired, current } => Ok(MigrationStatement {
                    sql: desired.definition.clone(),
                    risk: MigrationRisk::Rewrite,
                    rollback_sql: Some(current.definition.clone()),
                    summary: format!("REPLACE TRIGGER {}", desired.name),
                }),
                DriverOperation::DropTrigger { trigger } => Ok(MigrationStatement {
                    sql: format!("DROP TRIGGER {}", trigger.name),
                    risk: MigrationRisk::Destructive,
                    rollback_sql: Some(trigger.definition.clone()),
                    summary: format!("DROP TRIGGER {}", trigger.name),
                }),
                _ => Err("unexpected operation".into()),
            }
        }
    }

    struct TestCapabilities {
        replace: bool,
    }
    impl MigrationCapabilities for TestCapabilities {
        fn supports(&self, operation: &DriverOperation) -> bool {
            !matches!(operation, DriverOperation::ReplaceView { .. }) || self.replace
        }
    }

    fn plan(
        source: &[SchemaObjectSnapshot],
        target: &[SchemaObjectSnapshot],
        allow: bool,
    ) -> SchemaDiffPlan {
        build_view_migration_plan_with_components(
            source,
            target,
            "postgresql",
            "postgresql",
            allow,
            &TestRenderer,
            &TestCapabilities { replace: true },
        )
    }

    #[test]
    fn creates_missing_view_and_returns_rollback() {
        let result = plan(
            &[SchemaObjectSnapshot::view(
                Some("public"),
                "active_users",
                "SELECT id FROM users",
            )],
            &[],
            false,
        );
        assert!(result.requirements.is_empty());
        assert_eq!(result.statements.len(), 1);
        assert_eq!(result.statements[0].risk, StatementRisk::Additive);
        assert!(result.statements[0].rollback_sql.is_some());
        assert_eq!(result.tables, vec!["public.active_users"]);
    }

    #[test]
    fn replaces_changed_view_and_drops_extra_only_with_destructive_approval() {
        let source = [SchemaObjectSnapshot::view(
            None,
            "active_users",
            "SELECT id, email FROM users",
        )];
        let target = [
            SchemaObjectSnapshot::view(None, "active_users", "SELECT id FROM users"),
            SchemaObjectSnapshot::view(None, "legacy_users", "SELECT id FROM legacy_users"),
        ];
        let safe = plan(&source, &target, false);
        assert_eq!(safe.statements.len(), 1);
        assert!(safe.statements[0].sql.contains("REPLACE VIEW active_users"));
        assert!(safe
            .warnings
            .iter()
            .any(|warning| warning.contains("view:legacy_users")));

        let approved = plan(&source, &target, true);
        assert_eq!(approved.statements.len(), 2);
        assert!(approved
            .statements
            .iter()
            .any(|statement| statement.risk == StatementRisk::Destructive));
        assert!(approved.rollback_completeness.complete);
    }

    #[test]
    fn rejects_cross_dialect_and_unsupported_replacement_before_rendering() {
        let source = [SchemaObjectSnapshot::view(None, "v", "SELECT 1")];
        let cross = build_view_migration_plan_with_components(
            &source,
            &[],
            "postgresql",
            "mysql",
            false,
            &TestRenderer,
            &TestCapabilities { replace: true },
        );
        assert!(cross.statements.is_empty());
        assert!(cross.requirements.iter().any(|requirement| matches!(
            requirement,
            PlanRequirement::Unsupported { reason, .. }
                if reason.contains("matching source and target dialects")
        )));

        let unsupported = build_view_migration_plan_with_components(
            &source,
            &[SchemaObjectSnapshot::view(None, "v", "SELECT 2")],
            "postgresql",
            "postgresql",
            false,
            &TestRenderer,
            &TestCapabilities { replace: false },
        );
        assert!(unsupported.statements.is_empty());
        assert!(unsupported.requirements.iter().any(|requirement| matches!(
            requirement,
            PlanRequirement::Unsupported { operation, .. } if operation == "view:v"
        )));
    }

    #[test]
    fn rejects_invalid_and_duplicate_metadata() {
        let invalid = plan(
            &[SchemaObjectSnapshot::view(
                None,
                "v",
                "SELECT 1; DROP TABLE users",
            )],
            &[],
            false,
        );
        assert!(invalid.statements.is_empty());
        assert!(!invalid.requirements.is_empty());

        let duplicate = plan(
            &[
                SchemaObjectSnapshot::view(Some("public"), "v", "SELECT 1"),
                SchemaObjectSnapshot::view(Some("public"), "v", "SELECT 2"),
            ],
            &[],
            false,
        );
        assert!(duplicate.requirements.iter().any(|requirement| matches!(
            requirement,
            PlanRequirement::Unsupported { reason, .. }
                if reason.contains("duplicate view identities")
        )));
    }

    fn routine(kind: ObjectKind, name: &str, definition: &str) -> SchemaObjectSnapshot {
        SchemaObjectSnapshot::routine(kind, Some("public"), name, Some("integer"), definition)
    }

    #[test]
    fn routine_trigger_plan_creates_replaces_and_drops_with_destructive_gate() {
        let source = [
            routine(
                ObjectKind::Function,
                "calculate_total",
                "CREATE FUNCTION calculate_total(integer) RETURNS integer AS $$ SELECT 1 $$",
            ),
            SchemaObjectSnapshot::trigger(
                Some("public"),
                "audit_insert",
                Some("public"),
                "orders",
                "CREATE TRIGGER audit_insert AFTER INSERT ON orders EXECUTE FUNCTION audit()",
            ),
        ];
        let target = [
            routine(
                ObjectKind::Function,
                "calculate_total",
                "CREATE FUNCTION calculate_total(integer) RETURNS integer AS $$ SELECT 2 $$",
            ),
            SchemaObjectSnapshot::trigger(
                Some("public"),
                "old_trigger",
                Some("public"),
                "orders",
                "CREATE TRIGGER old_trigger AFTER INSERT ON orders EXECUTE FUNCTION audit()",
            ),
        ];
        let safe = build_routine_trigger_migration_plan_with_components(
            &source,
            &target,
            "postgresql",
            "postgresql",
            false,
            &TestRenderer,
            &TestCapabilities { replace: true },
        );
        assert_eq!(safe.statements.len(), 2);
        assert!(safe.statements[0].summary.contains("REPLACE function"));
        assert!(safe
            .statements
            .iter()
            .any(|statement| statement.summary.contains("CREATE TRIGGER audit_insert")));
        assert!(safe
            .warnings
            .iter()
            .any(|warning| warning.contains("old_trigger")));

        let approved = build_routine_trigger_migration_plan_with_components(
            &source,
            &target,
            "postgresql",
            "postgresql",
            true,
            &TestRenderer,
            &TestCapabilities { replace: true },
        );
        assert_eq!(approved.statements.len(), 3);
        assert!(approved
            .statements
            .iter()
            .any(|statement| statement.risk == StatementRisk::Destructive));
    }

    #[test]
    fn routine_trigger_plan_fails_closed_for_cross_dialect_sqlite_and_bad_ddl() {
        let source = [routine(
            ObjectKind::Function,
            "calculate_total",
            "CREATE FUNCTION calculate_total(integer) RETURNS integer AS $$ SELECT 1 $$",
        )];
        let cross = build_routine_trigger_migration_plan_with_components(
            &source,
            &[],
            "postgresql",
            "mysql",
            false,
            &TestRenderer,
            &TestCapabilities { replace: true },
        );
        assert!(cross.statements.is_empty());
        assert!(cross.requirements.iter().any(|requirement| matches!(
            requirement,
            PlanRequirement::Unsupported { reason, .. }
                if reason.contains("matching source and target dialects")
        )));

        let bad = [routine(ObjectKind::Function, "calculate_total", "SELECT 1")];
        let plan = build_routine_trigger_migration_plan_with_components(
            &bad,
            &[],
            "postgresql",
            "postgresql",
            false,
            &TestRenderer,
            &TestCapabilities { replace: true },
        );
        assert!(plan.statements.is_empty());
        assert!(!plan.requirements.is_empty());

        let sqlite = build_routine_trigger_migration_plan(&source, &[], "sqlite", "sqlite", false);
        assert!(sqlite.statements.is_empty());
        assert!(!sqlite.requirements.is_empty());
    }

    #[test]
    fn test_tester_overloaded_routine_definition_must_match_requested_signature() {
        // A catalog lookup for lookup(integer) must not accept DDL for the
        // different lookup(text) overload. Otherwise a reviewed replacement
        // could deploy the wrong definition while retaining the requested
        // overload identity for later destructive operations.
        let source = [SchemaObjectSnapshot::routine(
            ObjectKind::Function,
            Some("public"),
            "lookup",
            Some("integer"),
            "CREATE FUNCTION lookup(text) RETURNS integer AS $$ SELECT 1 $$",
        )];
        let plan = build_routine_trigger_migration_plan_with_components(
            &source,
            &[],
            "postgresql",
            "postgresql",
            false,
            &TestRenderer,
            &TestCapabilities { replace: true },
        );
        assert!(plan.statements.is_empty());
        assert!(plan.requirements.iter().any(|requirement| matches!(
            requirement,
            PlanRequirement::Unsupported { reason, .. }
                if reason.contains("signature")
        )));
    }
}
