//! Core Data Transfer types (Navicat-style one-way copy).

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use super::error::TransferError;
use super::filter::SourceFilter;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Endpoint {
    pub db_session_id: String,
    pub database: String,
    pub schema: Option<String>,
}

impl Endpoint {
    #[allow(dead_code)]
    pub fn normalized_schema(&self) -> Option<&str> {
        self.schema
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum TransferMode {
    Structure,
    #[default]
    Data,
    StructureAndData,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum WriteMode {
    #[default]
    Insert,
    TruncateInsert,
    DropCreateInsert,
}

impl WriteMode {
    pub fn is_destructive(self) -> bool {
        matches!(self, Self::TruncateInsert | Self::DropCreateInsert)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ColumnMapping {
    pub source_column: String,
    pub target_column: String,
    #[serde(default)]
    pub skip: bool,
    /// Native DDL type on the target (e.g. `VARCHAR(255)`); cross-dialect create-new only.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_native_type: Option<String>,
}

/// A bounded source recordset selected by a deterministic single-column order.
///
/// `order_by` may be omitted only when the inspected source schema has exactly
/// one effective primary-key column. Bounds are JSON on the IPC boundary so the
/// server can convert them using the inspected source column type before
/// binding them. This is a selection scope, never a resumable checkpoint.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TransferRecordsetBound {
    pub value: serde_json::Value,
    #[serde(default = "default_true")]
    pub inclusive: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TransferRecordset {
    /// One source column. Composite ordering is deliberately rejected in this
    /// wave because a scalar bound cannot express an unambiguous tuple range.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub order_by: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub start: Option<TransferRecordsetBound>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub end: Option<TransferRecordsetBound>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub limit: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TableMapping {
    pub source_table: String,
    pub target_table: String,
    #[serde(default)]
    pub create_new: bool,
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default)]
    pub column_mappings: Vec<ColumnMapping>,
    /// When set, structure phase executes this SQL instead of auto-generated CREATE TABLE.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ddl_override: Option<String>,
    /// Optional structured predicate applied to source rows during data copy.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_filter: Option<SourceFilter>,
    /// Optional deterministic source recordset selection. This does not
    /// represent a restart checkpoint or persisted OFFSET.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub recordset: Option<TransferRecordset>,
}

fn default_true() -> bool {
    true
}

impl TableMapping {
    pub fn auto(source_table: impl Into<String>) -> Self {
        let name = source_table.into();
        Self {
            source_table: name.clone(),
            target_table: name,
            create_new: false,
            enabled: true,
            column_mappings: Vec::new(),
            ddl_override: None,
            source_filter: None,
            recordset: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TransferOptions {
    pub batch_size: u32,
    pub stop_on_error: bool,
    #[serde(default)]
    pub confirmed_destructive: bool,
}

impl Default for TransferOptions {
    fn default() -> Self {
        Self {
            batch_size: 500,
            stop_on_error: true,
            confirmed_destructive: false,
        }
    }
}

impl TransferOptions {
    pub fn validate(&self) -> Result<(), TransferError> {
        if self.batch_size == 0 {
            return Err(TransferError::validation(
                "batchSize must be greater than 0",
            ));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TransferJob {
    pub source: Endpoint,
    pub target: Endpoint,
    pub mode: TransferMode,
    pub write_mode: WriteMode,
    pub tables: Vec<TableMapping>,
    pub options: TransferOptions,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum TableMappingStatus {
    Matched,
    CreateNew,
    UnmappedSource,
    UnmappedTarget,
    Disabled,
    Incompatible,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TableInspectResult {
    pub source_table: String,
    pub target_table: String,
    pub status: TableMappingStatus,
    pub create_new: bool,
    pub enabled: bool,
    pub column_mappings: Vec<ColumnMapping>,
    #[serde(default)]
    pub source_columns: Vec<String>,
    #[serde(default)]
    pub source_primary_keys: Vec<String>,
    #[serde(default)]
    pub target_columns: Vec<String>,
    #[serde(default)]
    pub source_column_types: HashMap<String, String>,
    pub incompatible_reason: Option<String>,
    pub source_row_count: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub recordset: Option<TransferRecordset>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DdlPreviewItem {
    pub source_table: String,
    pub target_table: String,
    pub ddl: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WritePlanItem {
    pub source_table: String,
    pub target_table: String,
    pub write_mode: WriteMode,
    pub mapped_columns: Vec<ColumnMapping>,
    pub estimated_rows: Option<u64>,
    pub preamble: Vec<String>,
    /// Parameterized source WHERE preview. Values remain bound server-side.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_filter_preview: Option<String>,
    /// Parameterized ORDER BY/bounds/LIMIT reviewed for this source table.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub recordset_preview: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TransferPreview {
    /// Opaque server-side plan token. A preview produced by the command layer
    /// always contains one; pure preview builders leave it empty until the
    /// command has captured the immutable execution snapshot.
    pub plan_id: String,
    pub pairing_path: String,
    pub mode: TransferMode,
    pub write_mode: WriteMode,
    pub ddl: Vec<DdlPreviewItem>,
    pub write_plans: Vec<WritePlanItem>,
    pub warnings: Vec<String>,
    pub can_execute: bool,
    pub block_reason: Option<String>,
}

/// The only mutable choices accepted after a preview has produced a plan.
/// Table names refer to source tables already present in the plan; callers
/// cannot replace mappings, endpoints, DDL or row payloads.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TransferRunSelection {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_tables: Option<Vec<String>>,
}

/// Run-time controls that are safe to choose at the final confirmation step.
/// Batch/error policy is intentionally fixed in the immutable preview plan.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TransferRunOptions {
    #[serde(default)]
    pub confirmed_destructive: bool,
}

/// Execute a previously previewed Transfer plan.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TransferRunRequest {
    pub plan_id: String,
    #[serde(default)]
    pub selection: TransferRunSelection,
    #[serde(default)]
    pub options: TransferRunOptions,
    /// Optional cancellation token. This is a job registry key, not an
    /// alternate execution payload.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub job_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TableExecutionResult {
    pub source_table: String,
    pub target_table: String,
    pub rows_inserted: u64,
    pub success: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct TransferExecutionResult {
    pub tables: Vec<TableExecutionResult>,
    pub rows_inserted: u64,
    pub cancelled: bool,
    pub partial: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TransferPairingView {
    pub path: String,
    pub supported: bool,
    pub family: Option<String>,
    pub reason: Option<String>,
}
