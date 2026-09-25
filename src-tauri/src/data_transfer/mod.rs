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
pub(crate) mod resume;
mod resume_dispatch;
mod scan;
pub mod sql_file;
mod sql_structure;
pub mod structure;
mod writer;

pub use error::TransferError;
pub(crate) use execute::execute_transfer_data_with_resume_checkpoint;
pub(crate) use execute::execute_transfer_data_with_write_observer;
pub use execute::{execute_transfer_data, DropCreateContext, ValueFormatter};
pub use execute::{is_self_table_overwrite, validate_no_self_table_overwrite};
pub use filter::{FilterLogic, SourceFilter};
pub use mapping::inspect_tables;
pub use model::{
    DdlPreviewItem, DdlPreviewKind, SqlFileCompression, SqlFileEncoding, SqlFileTarget,
    TableInspectResult, TableMapping, TransferExecutionResult, TransferJob, TransferMode,
    TransferPairingView, TransferPreview, TransferRecordset, TransferRecordsetBound,
    TransferRecordsetTupleBound, TransferRecordsetTupleRange, TransferRunRequest, WriteMode,
};
pub use pairing::{classify_transfer_pair, enforce_transfer_pairing, is_same_family};
pub use preview::{build_preview, TransferPreviewAdapters};
pub use profile::TransferProfile;
pub(crate) use structure::create_target_tables_with_write_observer;
pub use structure::{column_ir_types_by_source, create_target_tables, source_schema_to_target_ir};

#[cfg(test)]
mod execution_tests;
