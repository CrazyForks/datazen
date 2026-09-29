//! Shared harness for the SQL Server **live** tests.
//!
//! Configuration comes from the environment first, then from the crate-local
//! `.env.test` (gitignored, see the file header for the key list). Anything
//! required that is missing makes the calling test **skip** — never fail — so a
//! checkout without an Azure instance still runs the offline suite.
//!
//! Driver-specific tests belong to this crate (see `AGENTS.md`); nothing here
//! reaches into the host.

#![allow(dead_code)]

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use datazen_driver_api::{ConnectionConfig, ConnectionHandle, DriverError, SslMode, Value};
// Trait methods (`connect`, `query`, …) are called on the concrete driver type.
use datazen_driver_api::DatabaseDriver as _;
use datazen_driver_sqlserver::SqlServerDriver;

/// Platform the instance runs on. Declared by `TEST_SQLSERVER_EXPECT_PLATFORM`
/// so a platform limitation is never reported as a driver defect.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Platform {
    /// Azure SQL Database: no backup/restore, no SQL Agent, `sys.databases`
    /// only lists the current database (plus `master`), cross-database writes
    /// are rejected.
    AzureSqlDatabase,
    /// Azure SQL Managed Instance.
    AzureManagedInstance,
    /// SQL Server on a VM or on-premises: full engine surface.
    Vm,
}

impl Platform {
    pub fn label(self) -> &'static str {
        match self {
            Platform::AzureSqlDatabase => "azure-sql-db",
            Platform::AzureManagedInstance => "azure-mi",
            Platform::Vm => "vm",
        }
    }

    /// `BACKUP DATABASE` / `RESTORE` are unavailable on Azure SQL Database.
    pub fn supports_backup_restore(self) -> bool {
        !matches!(self, Platform::AzureSqlDatabase)
    }

    /// Whether `SELECT name FROM sys.databases` can enumerate every database on
    /// the server (Azure SQL Database scopes that view to the current database).
    pub fn lists_all_databases(self) -> bool {
        !matches!(self, Platform::AzureSqlDatabase)
    }

    /// SQL Agent is absent from Azure SQL Database.
    pub fn has_sql_agent(self) -> bool {
        !matches!(self, Platform::AzureSqlDatabase)
    }
}

#[derive(Debug, Clone)]
pub struct LiveConfig {
    pub host: String,
    pub port: u16,
    pub database: String,
    pub user: String,
    pub password: String,
    pub schema: String,
    pub ssl_mode: SslMode,
    pub trust_server_certificate: bool,
    pub application_name: Option<String>,
    pub connection_timeout: u32,
    pub platform: Platform,
    pub database_b: Option<String>,
    pub database_b_name: String,
    pub temp_prefix: String,
    pub allow_write: bool,
    pub allow_create_database: bool,
    pub skip: bool,
}

impl LiveConfig {
    /// Scratch object name, unique per process and call, e.g.
    /// `dz_test_t_3_7f21a0`.
    pub fn scratch(&self, kind: &str) -> String {
        static SEQ: AtomicU64 = AtomicU64::new(0);
        let n = SEQ.fetch_add(1, Ordering::Relaxed);
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.subsec_nanos())
            .unwrap_or(0);
        format!(
            "{}{kind}_{}_{:06x}{:04x}",
            self.temp_prefix,
            std::process::id(),
            nanos & 0xFFFF,
            (n as u64) & 0xFFFF
        )
    }

    /// A `ConnectionConfig` for the configured credentials, with optional
    /// SSL/trust overrides used by the TLS tests.
    pub fn connection_config(&self, ssl_mode: SslMode, trust: bool) -> ConnectionConfig {
        let mut options = serde_json::Map::new();
        options.insert(
            "trustServerCertificate".to_string(),
            serde_json::Value::Bool(trust),
        );
        if let Some(name) = &self.application_name {
            options.insert(
                "applicationName".to_string(),
                serde_json::Value::String(name.clone()),
            );
        }
        ConnectionConfig {
            id: "sqlserver-live-it".into(),
            name: "SQL Server live integration".into(),
            database_type: "sqlserver".into(),
            host: Some(self.host.clone()),
            port: Some(self.port),
            database: Some(self.database.clone()),
            schema: None,
            username: Some(self.user.clone()),
            password: Some(self.password.clone()),
            ssl_mode,
            connection_timeout: self.connection_timeout,
            max_pool_size: 4,
            ssh_tunnel: None,
            tunnel_kind: None,
            tunnel_id: None,
            http_proxy_tunnel: None,
            websocket_tunnel: None,
            color_tag: None,
            group: None,
            last_connected_at: None,
            server_version: None,
            options: Some(options),
            read_only: false,
            pinned: false,
        }
    }

    /// Config with the credentials exactly as configured in `.env.test`.
    pub fn default_config(&self) -> ConnectionConfig {
        self.connection_config(self.ssl_mode.clone(), self.trust_server_certificate)
    }
}

fn parse_env_file(path: &std::path::Path) -> HashMap<String, String> {
    let mut map = HashMap::new();
    let Ok(content) = std::fs::read_to_string(path) else {
        return map;
    };
    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if let Some((key, value)) = line.split_once('=') {
            let value = value.trim();
            let value = value
                .strip_prefix('\'')
                .and_then(|v| v.strip_suffix('\''))
                .or_else(|| value.strip_prefix('"').and_then(|v| v.strip_suffix('"')))
                .unwrap_or(value);
            map.insert(key.trim().to_string(), value.to_string());
        }
    }
    map
}

/// `.env.test` next to this crate, falling back to a legacy `.env`.
fn env_file() -> HashMap<String, String> {
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let test = dir.join(".env.test");
    if test.exists() {
        return parse_env_file(&test);
    }
    parse_env_file(&dir.join(".env"))
}

fn setting(file: &HashMap<String, String>, key: &str) -> Option<String> {
    if let Ok(value) = std::env::var(key) {
        let value = value.trim().to_string();
        if !value.is_empty() {
            return Some(value);
        }
    }
    file.get(key)
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}

fn flag(file: &HashMap<String, String>, key: &str, default: bool) -> bool {
    match setting(file, key).as_deref() {
        Some("1") | Some("true") | Some("TRUE") | Some("yes") => true,
        Some("0") | Some("false") | Some("FALSE") | Some("no") => false,
        Some(other) => {
            eprintln!("⚠️  {key}={other} is not a boolean; using {default}");
            default
        }
        None => default,
    }
}

fn parse_ssl_mode(raw: &str) -> SslMode {
    match raw.trim().to_ascii_lowercase().replace('_', "-").as_str() {
        "disable" | "none" | "off" => SslMode::Disable,
        "prefer" => SslMode::Prefer,
        "require" | "required" => SslMode::Require,
        "verify-ca" => SslMode::VerifyCa,
        "verify-full" => SslMode::VerifyFull,
        other => {
            eprintln!("⚠️  TEST_SQLSERVER_SSL_MODE={other} unknown; using require");
            SslMode::Require
        }
    }
}

fn parse_platform(raw: &str) -> Platform {
    match raw.trim().to_ascii_lowercase().as_str() {
        "azure-mi" | "azure-managed-instance" | "managed-instance" => {
            Platform::AzureManagedInstance
        }
        "vm" | "on-prem" | "on-premises" | "self-hosted" => Platform::Vm,
        _ => Platform::AzureSqlDatabase,
    }
}

/// Load the live configuration, or `None` when the test must skip.
///
/// Missing required keys print the reason once per call and skip.
pub fn live_config() -> Option<LiveConfig> {
    let file = env_file();

    if flag(&file, "TEST_SQLSERVER_SKIP", false) {
        eprintln!("⏭  Skipping SQL Server live tests: TEST_SQLSERVER_SKIP=1");
        return None;
    }

    let host = match setting(&file, "TEST_SQLSERVER_HOST") {
        Some(v) => v,
        None => {
            eprintln!(
                "⏭  Skipping SQL Server live tests: TEST_SQLSERVER_HOST unset \
                 (see packages/drivers/sqlserver/.env.test)"
            );
            return None;
        }
    };
    let user = match setting(&file, "TEST_SQLSERVER_USER") {
        Some(v) => v,
        None => {
            eprintln!("⏭  Skipping SQL Server live tests: TEST_SQLSERVER_USER unset");
            return None;
        }
    };
    let password = match setting(&file, "TEST_SQLSERVER_PASSWORD") {
        Some(v) => v,
        None => {
            eprintln!("⏭  Skipping SQL Server live tests: TEST_SQLSERVER_PASSWORD unset");
            return None;
        }
    };
    let database = match setting(&file, "TEST_SQLSERVER_DATABASE") {
        Some(v) => v,
        None => {
            eprintln!("⏭  Skipping SQL Server live tests: TEST_SQLSERVER_DATABASE unset");
            return None;
        }
    };

    let ssl_mode = setting(&file, "TEST_SQLSERVER_SSL_MODE")
        .map(|v| parse_ssl_mode(&v))
        .unwrap_or(SslMode::Require);
    // `Prefer`/`Require` historically trust the self-signed server certificate;
    // `Verify*` always validates the chain, whatever the trust flag says.
    let trust_default = matches!(ssl_mode, SslMode::Prefer | SslMode::Require);
    let trust_server_certificate = flag(
        &file,
        "TEST_SQLSERVER_TRUST_SERVER_CERTIFICATE",
        trust_default,
    );

    Some(LiveConfig {
        host,
        port: setting(&file, "TEST_SQLSERVER_PORT")
            .and_then(|v| v.parse().ok())
            .unwrap_or(1433),
        database,
        user,
        password,
        schema: setting(&file, "TEST_SQLSERVER_SCHEMA").unwrap_or_else(|| "dbo".into()),
        ssl_mode,
        trust_server_certificate,
        application_name: setting(&file, "TEST_SQLSERVER_APPLICATION_NAME"),
        connection_timeout: setting(&file, "TEST_SQLSERVER_CONNECTION_TIMEOUT")
            .and_then(|v| v.parse().ok())
            .unwrap_or(30),
        platform: setting(&file, "TEST_SQLSERVER_EXPECT_PLATFORM")
            .map(|v| parse_platform(&v))
            .unwrap_or(Platform::AzureSqlDatabase),
        database_b: setting(&file, "TEST_SQLSERVER_DATABASE_B"),
        database_b_name: setting(&file, "TEST_SQLSERVER_DATABASE_B_NAME")
            .unwrap_or_else(|| "DataZenTest2".into()),
        temp_prefix: setting(&file, "TEST_SQLSERVER_TEMP_PREFIX")
            .unwrap_or_else(|| "dz_test_".into()),
        allow_write: flag(&file, "TEST_SQLSERVER_ALLOW_WRITE", false),
        allow_create_database: flag(&file, "TEST_SQLSERVER_ALLOW_CREATE_DATABASE", false),
        skip: false,
    })
}

/// Gate for tests that mutate the instance. Returns `false` (skip) when the
/// write switch is off.
pub fn write_allowed(cfg: &LiveConfig, what: &str) -> bool {
    if cfg.allow_write {
        return true;
    }
    eprintln!("⏭  Skipping {what}: TEST_SQLSERVER_ALLOW_WRITE is not 1");
    false
}

/// Azure SQL **serverless** auto-pauses when idle; the first login during the
/// resume window fails with 40613 `Database … is not currently available`.
/// That is an instance property, not a driver defect, so live tests retry it
/// instead of reporting a failure.
pub fn is_azure_resume_error(error: &DriverError) -> bool {
    let text = error.to_string().to_ascii_lowercase();
    text.contains("40613") || text.contains("not currently available")
}

/// Run `op`, retrying only the Azure resume window.
pub async fn with_resume_retry<T, F, Fut>(label: &str, mut op: F) -> Result<T, DriverError>
where
    F: FnMut() -> Fut,
    Fut: std::future::Future<Output = Result<T, DriverError>>,
{
    const ATTEMPTS: usize = 6;
    let mut attempt = 1;
    loop {
        match op().await {
            Ok(value) => {
                if attempt > 1 {
                    eprintln!("ℹ️  {label}: succeeded on attempt {attempt} (Azure resume)");
                }
                return Ok(value);
            }
            Err(error) if is_azure_resume_error(&error) && attempt < ATTEMPTS => {
                eprintln!(
                    "⏳ {label}: database resuming (Azure 40613), attempt {attempt}/{ATTEMPTS}, \
                     retrying in 8s"
                );
                attempt += 1;
                tokio::time::sleep(std::time::Duration::from_secs(8)).await;
            }
            Err(error) => return Err(error),
        }
    }
}

/// Connect with the configured credentials and return the driver + handle.
pub async fn connect(cfg: &LiveConfig) -> (Arc<SqlServerDriver>, ConnectionHandle) {
    let driver = Arc::new(SqlServerDriver::new());
    let config = cfg.default_config();
    let handle = with_resume_retry("live connect", || driver.connect(&config))
        .await
        .unwrap_or_else(|e| panic!("live connect to {} failed: {e}", cfg.host));
    (driver, handle)
}

/// Connect, run `body`, then always disconnect.
pub async fn with_connection<F, Fut, T>(cfg: &LiveConfig, body: F) -> T
where
    F: FnOnce(Arc<SqlServerDriver>, ConnectionHandle) -> Fut,
    Fut: std::future::Future<Output = T>,
{
    let (driver, handle) = connect(cfg).await;
    let out = body(Arc::clone(&driver), handle.clone()).await;
    let _ = driver.disconnect(handle).await;
    out
}

pub fn cell(value: &Option<Value>) -> String {
    match value {
        None | Some(Value::Null) => "NULL".to_string(),
        Some(Value::Integer(i)) => i.to_string(),
        Some(Value::Float(f)) => f.to_string(),
        Some(Value::Bool(b)) => b.to_string(),
        Some(Value::String(s)) => s.clone(),
        Some(Value::Bytes(b)) => format!(
            "0x{}",
            b.iter().map(|x| format!("{x:02x}")).collect::<String>()
        ),
        Some(other) => format!("{other:?}"),
    }
}

pub fn cell_i64(value: &Option<Value>) -> Option<i64> {
    match value {
        Some(Value::Integer(i)) => Some(*i),
        Some(Value::Float(f)) => Some(*f as i64),
        Some(Value::String(s)) => s.trim().parse().ok(),
        _ => None,
    }
}

pub fn cell_string(value: &Option<Value>) -> Option<String> {
    match value {
        Some(Value::String(s)) => Some(s.clone()),
        Some(Value::Integer(i)) => Some(i.to_string()),
        _ => None,
    }
}

/// Single row / single column helper for scalar probes.
pub async fn scalar(
    driver: &SqlServerDriver,
    handle: &ConnectionHandle,
    sql: &str,
) -> Result<Option<Value>, DriverError> {
    let result = driver.query(handle, sql).await?;
    Ok(result
        .rows
        .first()
        .and_then(|row| row.first().cloned())
        .flatten())
}

/// Drop a table and schema, ignoring "does not exist" errors.
pub async fn drop_quietly(driver: &SqlServerDriver, handle: &ConnectionHandle, sql: &str) {
    if let Err(error) = driver.query(handle, sql).await {
        eprintln!("ℹ️  cleanup `{sql}` reported: {error}");
    }
}
