//! Compatibility entry points for Schema Diff operation dependency planning.

use super::operations::MigrationOperation;

pub fn retain_dependency_closed(
    all: &[MigrationOperation],
    selected: &mut Vec<MigrationOperation>,
) {
    super::operation_dependencies::retain_dependency_closed(all, selected)
}

pub(super) fn try_resolve_dependencies(
    ops: &[MigrationOperation],
) -> Result<Vec<MigrationOperation>, String> {
    super::operation_dependencies::try_resolve_dependencies(ops)
}

pub fn resolve_dependencies(ops: Vec<MigrationOperation>) -> Vec<MigrationOperation> {
    super::operation_dependencies::resolve_dependencies(ops)
}
