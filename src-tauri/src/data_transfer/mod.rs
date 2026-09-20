//! Data Transfer domain (one-way copy / migration).

pub mod error;
pub mod execute;
pub mod filter;
pub mod mapping;
pub mod metadata;
pub mod model;
pub mod pairing;
pub mod preview;
pub mod recordset;
mod recordset_bounds;
mod scan;
pub mod structure;
mod writer;

pub use error::TransferError;
pub use execute::{execute_transfer_data, DropCreateContext, ValueFormatter};
pub use filter::{FilterLogic, SourceFilter};
pub use mapping::inspect_tables;
pub use model::{
    TableInspectResult, TableMapping, TransferExecutionResult, TransferJob, TransferMode,
    TransferPairingView, TransferPreview, TransferRecordset, TransferRecordsetBound,
    TransferRunRequest, WriteMode,
};
pub use pairing::{classify_transfer_pair, enforce_transfer_pairing, is_same_family};
pub use preview::{build_preview, TransferPreviewAdapters};
pub use structure::{column_ir_types_by_source, create_target_tables, source_schema_to_target_ir};

#[cfg(test)]
mod execution_tests;
