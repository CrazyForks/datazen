//! Dedicated execute path: transaction + parameterized SQL. Not `execute_query`.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use async_trait::async_trait;
use datazen_driver_api::Value;
use serde::{Deserialize, Serialize};

use super::error::DataSyncError;
use super::sql::SqlStatement;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionResult {
    pub applied: usize,
    pub rolled_back: bool,
    /// Total rows reported by the database for successful statements.
    /// Defaults during deserialization so older persisted responses remain valid.
    #[serde(default)]
    pub affected_rows: u64,
}

#[async_trait]
pub trait StatementExecutor: Send {
    fn is_read_only(&self) -> bool;
    async fn begin(&mut self) -> Result<(), DataSyncError>;
    async fn execute(&mut self, sql: &str, params: &[Value]) -> Result<u64, DataSyncError>;
    async fn commit(&mut self) -> Result<(), DataSyncError>;
    async fn rollback(&mut self) -> Result<(), DataSyncError>;
}

pub async fn execute_statements(
    statements: &[SqlStatement],
    executor: &mut dyn StatementExecutor,
    cancelled: Option<Arc<AtomicBool>>,
) -> Result<ExecutionResult, DataSyncError> {
    if statements.is_empty() {
        return Err(DataSyncError::validation(
            "change set is empty; nothing to execute",
        ));
    }
    if executor.is_read_only() {
        return Err(DataSyncError::validation(
            "target connection is read-only; Data Synchronization cannot execute",
        ));
    }
    if cancelled.as_ref().is_some_and(|c| c.load(Ordering::SeqCst)) {
        return Err(DataSyncError::cancelled("execute cancelled"));
    }

    executor.begin().await?;
    let mut applied = 0usize;
    let mut affected_rows = 0u64;
    for stmt in statements {
        if cancelled.as_ref().is_some_and(|c| c.load(Ordering::SeqCst)) {
            executor.rollback().await?;
            return Ok(ExecutionResult {
                applied,
                rolled_back: true,
                affected_rows,
            });
        }
        let operation = stmt.operation;
        match executor.execute(&stmt.sql, &stmt.parameters).await {
            Ok(affected) => {
                if matches!(
                    operation,
                    super::model::ChangeOperation::Update | super::model::ChangeOperation::Delete
                ) && affected == 0
                {
                    let _ = executor.rollback().await;
                    return Err(DataSyncError::conflict(format!(
                        "optimistic sync conflict: {} for table '{}' affected zero rows",
                        match operation {
                            super::model::ChangeOperation::Update => "UPDATE",
                            super::model::ChangeOperation::Delete => "DELETE",
                            _ => "write",
                        },
                        stmt.table
                    )));
                }
                applied += 1;
                affected_rows += affected;
            }
            Err(err) => {
                let _ = executor.rollback().await;
                return Err(DataSyncError::validation(format!(
                    "execution failed after {applied} statements: {err}"
                )));
            }
        }
    }
    executor.commit().await?;
    Ok(ExecutionResult {
        applied,
        rolled_back: false,
        affected_rows,
    })
}

#[derive(Default)]
pub struct RecordingExecutor {
    pub read_only: bool,
    pub fail_at: Option<usize>,
    pub calls: Vec<String>,
    pub begun: bool,
}

#[async_trait]
impl StatementExecutor for RecordingExecutor {
    fn is_read_only(&self) -> bool {
        self.read_only
    }

    async fn begin(&mut self) -> Result<(), DataSyncError> {
        self.calls.push("begin".into());
        self.begun = true;
        Ok(())
    }

    async fn execute(&mut self, sql: &str, params: &[Value]) -> Result<u64, DataSyncError> {
        self.calls.push(format!("execute:{}:{}", params.len(), sql));
        if self.fail_at
            == Some(
                self.calls
                    .iter()
                    .filter(|c| c.starts_with("execute:"))
                    .count()
                    - 1,
            )
        {
            return Err(DataSyncError::validation("injected failure"));
        }
        Ok(1)
    }

    async fn commit(&mut self) -> Result<(), DataSyncError> {
        self.calls.push("commit".into());
        self.begun = false;
        Ok(())
    }

    async fn rollback(&mut self) -> Result<(), DataSyncError> {
        self.calls.push("rollback".into());
        self.begun = false;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::data_sync::model::ChangeOperation;

    fn stmt(sql: &str) -> SqlStatement {
        SqlStatement {
            table: "t".into(),
            operation: ChangeOperation::Insert,
            sql: sql.into(),
            preview_sql: sql.into(),
            parameters: vec![Value::Integer(1)],
            row_key: vec![Value::Integer(1)],
        }
    }

    #[tokio::test]
    async fn commits_all_statements() {
        let mut exec = RecordingExecutor::default();
        let result = execute_statements(&[stmt("INSERT 1"), stmt("INSERT 2")], &mut exec, None)
            .await
            .unwrap();
        assert_eq!(result.applied, 2);
        assert_eq!(result.affected_rows, 2);
        assert!(!result.rolled_back);
        assert_eq!(
            exec.calls,
            vec![
                "begin".to_string(),
                "execute:1:INSERT 1".into(),
                "execute:1:INSERT 2".into(),
                "commit".into(),
            ]
        );
    }

    #[test]
    fn affected_rows_is_wire_compatible_with_older_results() {
        let old: ExecutionResult =
            serde_json::from_str(r#"{"applied":2,"rolledBack":false}"#).unwrap();
        assert_eq!(old.affected_rows, 0);
        let json = serde_json::to_value(ExecutionResult {
            applied: 1,
            rolled_back: false,
            affected_rows: 3,
        })
        .unwrap();
        assert_eq!(json["affectedRows"], 3);
    }

    #[tokio::test]
    async fn read_only_never_begins() {
        let mut exec = RecordingExecutor {
            read_only: true,
            ..RecordingExecutor::default()
        };
        let err = execute_statements(&[stmt("INSERT")], &mut exec, None)
            .await
            .unwrap_err();
        assert!(err.to_string().contains("read-only"));
        assert!(exec.calls.is_empty());
    }

    #[tokio::test]
    async fn empty_set_rejected() {
        let mut exec = RecordingExecutor::default();
        assert!(execute_statements(&[], &mut exec, None).await.is_err());
    }

    #[tokio::test]
    async fn failure_rolls_back() {
        let mut exec = RecordingExecutor {
            fail_at: Some(1),
            ..RecordingExecutor::default()
        };
        let err = execute_statements(&[stmt("A"), stmt("B")], &mut exec, None)
            .await
            .unwrap_err();
        assert!(err.to_string().contains("execution failed after 1"));
        assert!(exec.calls.contains(&"rollback".to_string()));
        assert!(!exec.calls.contains(&"commit".to_string()));
    }

    #[tokio::test]
    async fn zero_row_update_is_a_conflict_and_rolls_back() {
        struct ZeroRowsExecutor {
            calls: Vec<String>,
        }
        #[async_trait]
        impl StatementExecutor for ZeroRowsExecutor {
            fn is_read_only(&self) -> bool {
                false
            }
            async fn begin(&mut self) -> Result<(), DataSyncError> {
                self.calls.push("begin".into());
                Ok(())
            }
            async fn execute(&mut self, _: &str, _: &[Value]) -> Result<u64, DataSyncError> {
                self.calls.push("execute".into());
                Ok(0)
            }
            async fn commit(&mut self) -> Result<(), DataSyncError> {
                self.calls.push("commit".into());
                Ok(())
            }
            async fn rollback(&mut self) -> Result<(), DataSyncError> {
                self.calls.push("rollback".into());
                Ok(())
            }
        }
        let mut exec = ZeroRowsExecutor { calls: Vec::new() };
        let mut update = stmt("UPDATE t");
        update.operation = ChangeOperation::Update;
        let err = execute_statements(&[update], &mut exec, None)
            .await
            .unwrap_err();
        assert!(matches!(err, DataSyncError::Conflict(message) if message.contains("zero rows")));
        assert_eq!(exec.calls, vec!["begin", "execute", "rollback"]);
    }

    #[tokio::test]
    async fn cancel_before_start() {
        let mut exec = RecordingExecutor::default();
        let flag = Arc::new(AtomicBool::new(true));
        let err = execute_statements(&[stmt("A")], &mut exec, Some(flag))
            .await
            .unwrap_err();
        assert!(matches!(err, DataSyncError::Cancelled(_)));
        assert!(exec.calls.is_empty());
    }

    #[tokio::test]
    async fn cancel_mid_run_rolls_back() {
        let _exec = RecordingExecutor::default();
        let flag = Arc::new(AtomicBool::new(false));
        // First execute will run; flip cancel after begin by wrapping — simulate mid-loop
        // by setting flag after begin via fail path: set flag true before second statement
        // Use a custom executor... simpler: set flag true immediately after we know begin ran
        // by using fail_at None and pre-set flag after constructing, then...
        // Mid-loop: start false, but RecordingExecutor can't flip. Set flag true after first
        // execute by using a second test executor. Here we set flag true before call then
        // that's cancel_before_start. For mid-run, toggle after begin using a helper executor.
        struct FlipOnExecute {
            inner: RecordingExecutor,
            flag: Arc<AtomicBool>,
        }
        #[async_trait]
        impl StatementExecutor for FlipOnExecute {
            fn is_read_only(&self) -> bool {
                false
            }
            async fn begin(&mut self) -> Result<(), DataSyncError> {
                self.inner.begin().await
            }
            async fn execute(&mut self, sql: &str, params: &[Value]) -> Result<u64, DataSyncError> {
                let r = self.inner.execute(sql, params).await;
                self.flag.store(true, Ordering::SeqCst);
                r
            }
            async fn commit(&mut self) -> Result<(), DataSyncError> {
                self.inner.commit().await
            }
            async fn rollback(&mut self) -> Result<(), DataSyncError> {
                self.inner.rollback().await
            }
        }
        let mut exec = FlipOnExecute {
            inner: RecordingExecutor::default(),
            flag: flag.clone(),
        };
        let result = execute_statements(&[stmt("A"), stmt("B")], &mut exec, Some(flag))
            .await
            .unwrap();
        assert!(result.rolled_back);
        assert_eq!(result.applied, 1);
        assert_eq!(result.affected_rows, 1);
        assert!(exec.inner.calls.contains(&"rollback".to_string()));
    }
}
