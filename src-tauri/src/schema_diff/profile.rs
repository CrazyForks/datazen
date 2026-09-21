//! Persisted, reusable Schema Diff setup.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use super::types::ColumnTypeOverride;

/// A reusable Schema Diff setup. Runtime sessions, generated plans and DDL are
/// intentionally absent; the current connection configuration is resolved
/// when a profile is loaded.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SchemaDiffProfile {
    pub version: u32,
    pub id: String,
    pub name: String,
    pub source_connection_id: String,
    pub target_connection_id: String,
    pub source_database: String,
    pub target_database: String,
    #[serde(default)]
    pub source_schema: Option<String>,
    #[serde(default)]
    pub target_schema: Option<String>,
    pub tables: Vec<String>,
    pub allow_destructive: bool,
    pub include_indexes: bool,
    pub require_rollback: bool,
    #[serde(default)]
    pub type_overrides: Vec<ColumnTypeOverride>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl SchemaDiffProfile {
    pub const CURRENT_VERSION: u32 = 1;

    pub fn validate(&self) -> Result<(), String> {
        if self.version != Self::CURRENT_VERSION {
            return Err(format!(
                "unsupported schema diff profile version {}",
                self.version
            ));
        }
        if self.id.trim().is_empty() || self.name.trim().is_empty() {
            return Err("schema diff profile id and name are required".into());
        }
        if self.source_connection_id.trim().is_empty()
            || self.target_connection_id.trim().is_empty()
        {
            return Err(
                "schema diff profile sourceConnectionId and targetConnectionId are required".into(),
            );
        }
        if self.source_database.trim().is_empty() || self.target_database.trim().is_empty() {
            return Err(
                "schema diff profile sourceDatabase and targetDatabase are required".into(),
            );
        }
        if self.tables.is_empty() {
            return Err("schema diff profile requires at least one table".into());
        }
        if self.tables.iter().any(|table| table.trim().is_empty()) {
            return Err("schema diff profile tables must not be empty".into());
        }
        if self.type_overrides.iter().any(|override_| {
            override_.table.trim().is_empty()
                || override_.column.trim().is_empty()
                || override_.target_type.trim().is_empty()
        }) {
            return Err("schema diff profile type overrides must be complete".into());
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn profile() -> SchemaDiffProfile {
        let now = Utc::now();
        SchemaDiffProfile {
            version: SchemaDiffProfile::CURRENT_VERSION,
            id: "profile-1".into(),
            name: "Production schema".into(),
            source_connection_id: "source".into(),
            target_connection_id: "target".into(),
            source_database: "app".into(),
            target_database: "app".into(),
            source_schema: Some("public".into()),
            target_schema: Some("public".into()),
            tables: vec!["public.users".into()],
            allow_destructive: false,
            include_indexes: true,
            require_rollback: false,
            type_overrides: vec![],
            created_at: now,
            updated_at: now,
        }
    }

    #[test]
    fn rejects_unknown_fields_and_runtime_artifacts() {
        let mut value = serde_json::to_value(profile()).expect("profile serializes");
        value["dbSessionId"] = serde_json::json!("runtime-session");
        value["plan"] = serde_json::json!({"statements": []});
        assert!(serde_json::from_value::<SchemaDiffProfile>(value).is_err());

        let encoded = serde_json::to_string(&profile()).expect("profile serializes");
        assert!(!encoded.contains("dbSessionId"));
        assert!(!encoded.contains("plan"));
        assert!(!encoded.contains("ddl"));
        assert!(!encoded.contains("password"));
    }

    #[test]
    fn validates_version_scope_and_table_selection() {
        let mut value = profile();
        value.version = 2;
        assert!(value.validate().is_err());
        value = profile();
        value.tables.clear();
        assert!(value.validate().is_err());
        value = profile();
        value.source_database.clear();
        assert!(value.validate().is_err());
        assert!(profile().validate().is_ok());
    }
}
