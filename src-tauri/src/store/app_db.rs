//! Unified SQLite persistence for workflows, dashboards, widgets, and widget runs.
//!
//! File: `{data_dir}/datazen.sqlite`

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use thiserror::Error;
pub const APP_DB_FILE: &str = "datazen.sqlite";
pub const SCHEMA_VERSION: i32 = 1;
pub const MAX_RUN_ROWS: usize = 500;

#[derive(Debug, Error)]
pub enum AppDbError {
    #[error("SQLite error: {0}")]
    Sqlite(#[from] rusqlite::Error),

    #[error("Not found: {0}")]
    NotFound(String),

    #[error("Validation error: {0}")]
    Validation(String),

    #[error("Workflow in use by dashboards: {0}")]
    WorkflowInUse(String),

    #[error("{0}")]
    Other(String),
}

pub struct AppDb {
    db_path: PathBuf,
    conn: Mutex<Connection>,
}

impl AppDb {
    pub fn open(data_dir: &Path) -> Result<Arc<Self>, AppDbError> {
        let db_path = data_dir.join(APP_DB_FILE);
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| AppDbError::Other(e.to_string()))?;
        }
        let conn = Connection::open(&db_path)?;
        conn.execute_batch("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;")?;
        let db = Arc::new(Self {
            db_path,
            conn: Mutex::new(conn),
        });
        db.init_schema()?;
        Ok(db)
    }

    #[cfg(test)]
    pub fn open_in_memory() -> Result<Arc<Self>, AppDbError> {
        let conn = Connection::open_in_memory()?;
        conn.execute_batch("PRAGMA foreign_keys = ON;")?;
        let db = Arc::new(Self {
            db_path: PathBuf::from(":memory:"),
            conn: Mutex::new(conn),
        });
        db.init_schema()?;
        Ok(db)
    }

    pub fn db_path(&self) -> &Path {
        &self.db_path
    }

    fn with_conn<T, F>(&self, f: F) -> Result<T, AppDbError>
    where
        F: FnOnce(&Connection) -> Result<T, AppDbError>,
    {
        let conn = self
            .conn
            .lock()
            .map_err(|e| AppDbError::Other(format!("app db lock poisoned: {e}")))?;
        f(&conn)
    }

    fn init_schema(&self) -> Result<(), AppDbError> {
        self.with_conn(|conn| {
            conn.execute_batch(
                r#"
                CREATE TABLE IF NOT EXISTS schema_migrations (
                  version INTEGER PRIMARY KEY NOT NULL,
                  applied_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS workflows (
                  id TEXT PRIMARY KEY NOT NULL,
                  name TEXT NOT NULL,
                  description TEXT NOT NULL DEFAULT '',
                  visibility TEXT NOT NULL DEFAULT 'user'
                    CHECK (visibility IN ('user', 'dashboardHidden')),
                  definition_yaml TEXT NOT NULL,
                  updated_at TEXT NOT NULL,
                  created_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_workflows_visibility
                  ON workflows(visibility);

                CREATE TABLE IF NOT EXISTS dashboards (
                  id TEXT PRIMARY KEY NOT NULL,
                  name TEXT NOT NULL,
                  created_at TEXT NOT NULL,
                  updated_at TEXT NOT NULL,
                  layout_cols INTEGER NOT NULL DEFAULT 12,
                  layout_row_height INTEGER NOT NULL DEFAULT 80,
                  enabled INTEGER NOT NULL DEFAULT 1,
                  refresh_paused INTEGER NOT NULL DEFAULT 0
                );

                CREATE TABLE IF NOT EXISTS widgets (
                  id TEXT PRIMARY KEY NOT NULL,
                  dashboard_id TEXT NOT NULL REFERENCES dashboards(id) ON DELETE CASCADE,
                  title TEXT NOT NULL,
                  workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE RESTRICT,
                  view_mode TEXT NOT NULL CHECK (view_mode IN ('chart', 'table')),
                  chart_config_json TEXT,
                  layout_x INTEGER NOT NULL,
                  layout_y INTEGER NOT NULL,
                  layout_w INTEGER NOT NULL,
                  layout_h INTEGER NOT NULL,
                  refresh_mode TEXT NOT NULL
                    CHECK (refresh_mode IN ('manual', 'onOpen', 'interval')),
                  refresh_sec INTEGER,
                  alert_json TEXT,
                  enabled INTEGER NOT NULL DEFAULT 1,
                  sort_order INTEGER NOT NULL DEFAULT 0,
                  created_at TEXT NOT NULL,
                  updated_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_widgets_dashboard
                  ON widgets(dashboard_id, sort_order);
                CREATE INDEX IF NOT EXISTS idx_widgets_workflow
                  ON widgets(workflow_id);

                CREATE TABLE IF NOT EXISTS widget_runs (
                  id TEXT PRIMARY KEY NOT NULL,
                  dashboard_id TEXT NOT NULL,
                  widget_id TEXT NOT NULL REFERENCES widgets(id) ON DELETE CASCADE,
                  workflow_id TEXT NOT NULL,
                  started_at TEXT NOT NULL,
                  finished_at TEXT NOT NULL,
                  status TEXT NOT NULL CHECK (status IN ('ok', 'error', 'timeout')),
                  error TEXT,
                  row_count INTEGER NOT NULL DEFAULT 0,
                  columns_json TEXT NOT NULL,
                  rows_json TEXT NOT NULL,
                  variables_json TEXT,
                  alert_fired INTEGER,
                  alert_value REAL
                );
                CREATE INDEX IF NOT EXISTS idx_widget_runs_widget_started
                  ON widget_runs(widget_id, started_at DESC);

                CREATE TABLE IF NOT EXISTS widget_latest_run (
                  widget_id TEXT PRIMARY KEY NOT NULL REFERENCES widgets(id) ON DELETE CASCADE,
                  run_id TEXT NOT NULL REFERENCES widget_runs(id) ON DELETE CASCADE,
                  started_at TEXT NOT NULL,
                  status TEXT NOT NULL
                );
                "#,
            )?;

            let applied: Option<i32> = conn
                .query_row(
                    "SELECT version FROM schema_migrations WHERE version = ?1",
                    params![SCHEMA_VERSION],
                    |row| row.get(0),
                )
                .optional()?;
            if applied.is_none() {
                conn.execute(
                    "INSERT INTO schema_migrations (version, applied_at) VALUES (?1, ?2)",
                    params![SCHEMA_VERSION, Utc::now().to_rfc3339()],
                )?;
            }
            Ok(())
        })
    }

    // ── Workflows ─────────────────────────────────────────────────────────
}

mod dashboards;
mod runs;
mod workflows;

#[cfg(test)]
#[path = "app_db_tests.rs"]
mod tests;

// Re-exported so the paths `app_db::X` keep resolving for `store/mod.rs`
// and anything else that names these types through this module.
pub use dashboards::{DashboardRecord, DashboardWorkflowRef, WidgetRecord};
pub use runs::WidgetRunRecord;
pub use workflows::{WorkflowRecord, WorkflowVisibility};
