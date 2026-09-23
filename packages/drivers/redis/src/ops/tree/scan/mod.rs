//! Budgeted key-tree scan pages and the cluster-safe batches behind them.
//!
//! This module owns the *cost shape* of the key tree (PRD §3.2, §4 I-2/I-3):
//!
//! - [`scan_budgeted`] walks `SCAN` under a [`ScanBudget`] ledger, so one action
//!   can never spend more cumulative `COUNT` than its budget, and anything it
//!   could not reach is reported as `truncated` rather than silently missing.
//! - [`read_dbsize`] is called **once per command**, both to scale that budget
//!   and to fill the reply's `dbsize` — the flat browser used to re-send it on
//!   every page.
//! - [`fetch_key_meta`] / [`fetch_key_values`] resolve a page's per-key
//!   attributes in **two batches per page** (type / expiry / memory, then
//!   logical-length / preview) instead of one round trip per key per attribute.
//! - [`count_budgeted`] is the same loop for `count_matching`, which is what
//!   lets a partial answer be labelled `n+`.
//!
//! # Cluster discipline (do not regress this)
//!
//! A single-node `Pipeline` cannot be used as-is on a cluster connection:
//! `ClusterConnection` pins a batch to one slot (`route_for_pipeline` →
//! `CrossSlot`) and re-folds per-command errors into one batch error, so a
//! cross-key page batch would fail the whole command whenever the page crosses a
//! slot, and one rejected command (e.g. `MEMORY USAGE` below Redis 4.0) would
//! take the page down with it. [`fetch_key_group`] is the unit of the fix, and it
//! is the same shape `ops_workbench::fetch_memory_sample_fields` already uses:
//!
//! * standalone / sentinel: one chunked pipeline per
//!   [`TREE_KEYS_PER_PIPELINE`] keys;
//! * cluster: **one addressed batch per key** (all of a key's commands hash to
//!   that key's own slot, so the batch is never cross-slot) aimed at the shard
//!   owning it, replayed command-by-command if the batch is rejected — so a bad
//!   field degrades alone instead of failing the page.
//!
//! `SCAN` is pinned on a cluster too: redis gives it no route at all, which would
//! hand one node's cursor to another node, so every round of one action goes to
//! [`cluster_scan_anchor_slot`]. The consequence Wave 4 must render honestly: a
//! cluster page covers **one shard**, while `dbsize` is `DBSIZE` fanned out over
//! all masters and summed (redis' own routing table; deliberately *not* addressed
//! here — see `ops_workbench`'s module docs). That is `type_distribution`'s
//! established 口径, and it is strictly better than the pre-budget behaviour,
//! where a multi-page tree walk mixed shards cursor by cursor.

use std::time::Instant;

use datazen_driver_api::{DriverError, KeyEntry};
use redis::aio::ConnectionLike;
use redis::cluster_routing::get_slot;
use redis::Value as RValue;

use crate::connect::Topology;
use crate::ops::key_probe::key_exists;
use crate::ops::tree::budget::{is_exact_key_pattern, tree_scan_budget, ScanBudget, ScanLoopGuard};
use crate::ops::workbench::{
    cluster_scan_anchor_slot, parse_opt_int, parse_type_token, type_reply_says_absent,
    SlotRoutedConnection, TTL_MISSING,
};
use crate::driver::session::normalize_type_filter;
use crate::value::{
    parse_scan_result, preview_value_to_string, truncate_preview, value_to_string,
};

pub(crate) mod batch;
pub(crate) mod budget;
pub(crate) mod count;
pub(crate) mod meta;
pub(crate) mod page;
pub(crate) mod transport;
pub(crate) mod value;

pub(crate) use batch::scan_round;
pub use batch::PageKey;
pub use batch::ScannedPage;
pub(crate) use budget::read_dbsize;
pub(crate) use budget::scan_budgeted;
pub(crate) use count::count_budgeted;
pub use count::CountOutcome;
pub use meta::build_meta_pipeline;
pub(crate) use meta::fetch_key_meta;
pub use meta::meta_fields_per_key;
pub use meta::meta_slots;
pub use meta::parse_meta_group;
pub use meta::KeyMeta;
pub(crate) use page::scan_keys_page;
pub use page::ScanKeysPage;
pub(crate) use transport::fetch_key_group;
pub use transport::META_FIELDS_BASE;
pub use transport::META_FIELDS_MEMORY;
pub use transport::TREE_KEYS_PER_PIPELINE;
pub use transport::VALUE_FIELDS_MAX;
pub use value::build_value_pipeline;
pub use value::extract_hscan_preview;
pub(crate) use value::fetch_key_values;
pub use value::has_preview_command;
pub use value::length_command_for;
pub use value::parse_value_group;
pub use value::render_preview;
pub use value::ValueFields;

pub(crate) use batch::fetch_page_groups;
pub(crate) use batch::scatter;
pub(crate) use meta::reply_at;
pub(crate) use transport::fold_command_answer;
pub(crate) use transport::is_connection_level_failure;
pub(crate) use transport::pipeline_raw;

#[cfg(test)]
mod tests;
