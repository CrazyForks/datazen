//! Data Transfer domain (one-way copy / migration).

pub mod error;
pub mod execute;
pub mod filter;
pub mod mapping;
pub mod metadata;
pub mod model;
pub mod pairing;
pub mod preview;
pub mod profile;
pub mod recordset;
pub(crate) mod recordset_bounds;
mod scan;
pub mod sql_file;
mod sql_structure;
pub mod structure;
mod writer;

pub use error::TransferError;
pub use execute::{DropCreateContext, ValueFormatter, execute_transfer_data};
pub use filter::{FilterLogic, SourceFilter};
pub use mapping::inspect_tables;
pub use model::{
    DdlPreviewItem, DdlPreviewKind, SqlFileCompression, SqlFileEncoding, SqlFileTarget,
    TableInspectResult, TableMapping, TransferExecutionResult, TransferJob, TransferMode,
    TransferPairingView, TransferPreview, TransferRecordset, TransferRecordsetBound,
    TransferRecordsetTupleBound, TransferRecordsetTupleRange, TransferRunRequest, WriteMode,
};
pub use pairing::{classify_transfer_pair, enforce_transfer_pairing, is_same_family};
pub use preview::{TransferPreviewAdapters, build_preview};
pub use profile::TransferProfile;
pub use structure::{column_ir_types_by_source, create_target_tables, source_schema_to_target_ir};

#[cfg(test)]
mod execution_tests;
