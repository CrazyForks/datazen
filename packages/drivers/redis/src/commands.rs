//! Redis Driver Command definitions and dispatch.
//!
//! Redis UI, Workflow, generic IPC, and MCP all execute operations through
//! `execute_command`. The Redis Tauri plugin is setup-only (Pub/Sub events).

use datazen_driver_api::{
    execute_command_definition, execute_standard_sql_command, query_command_definition,
    query_stream_command_definition, schema_catalog_command_definitions,
    try_execute_schema_catalog_command, CommandCategory, CommandResult, ConnectionHandle,
    DriverCommandDefinition, DriverCommandMetadata, DriverError,
};
use serde_json::Value as JsonValue;

use crate::ops::ZsetMember;
use crate::ops_io::RestoreKeyEntry;
use crate::RedisDriver;

fn redis_command_metadata(id: &str) -> DriverCommandMetadata {
    let category = match id {
        id if id.starts_with("pubsub_") => CommandCategory::PubSub,
        "xrange" | "xadd" | "xgroup_create" | "xgroup_destroy" | "xinfo_groups" | "xpending"
        | "xack" | "stream_overview" => CommandCategory::Stream,
        "dump_keys" | "restore_keys" => CommandCategory::Io,
        "flush_db" | "flush_all" | "slowlog_reset" => CommandCategory::Admin,
        "scan_keys" | "get_key" | "info" | "memory_sample" | "slowlog_get" | "modules_list"
        | "cluster_nodes" | "count_matching" => CommandCategory::Observe,
        _ => CommandCategory::Mutate,
    };
    let mut metadata = DriverCommandMetadata {
        category,
        ..DriverCommandMetadata::default()
    };
    if matches!(id, "pubsub_subscribe" | "pubsub_unsubscribe") {
        metadata = metadata.hide_from_workflow();
    }
    metadata
}
