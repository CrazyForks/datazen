//! Dedicated execute path: transaction + parameterized SQL. Not `execute_query`.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use async_trait::async_trait;
use datazen_driver_api::Value;
use serde::{Deserialize, Serialize};

use super::error::DataSyncError;
use super::model::{ChangeOperation, ConflictPolicy};
use super::sql::SqlStatement;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncConflict {
    pub table: String,
    pub operation: ChangeOperation,
    pub row_key: Vec<Value>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionResult {
    pub applied: usize,
    pub rolled_back: bool,
    /// Explains a confirmed rollback. A missing reason means execution
    /// committed successfully or returned an error with an unknown outcome.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rollback_reason: Option<String>,
    /// Total rows reported by the database for successful statements.
    /// Defaults during deserialization so older persisted responses remain valid.
    #[serde(default)]
    pub affected_rows: u64,
    #[serde(default, skip_serializing_if = "is_zero")]
    pub skipped: usize,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub conflicts: Vec<SyncConflict>,
}

fn is_zero(value: &usize) -> bool {
    *value == 0
}

#[async_trait]
pub trait StatementExecutor: Send {
    fn is_read_only(&self) -> bool;
    async fn begin(&mut self) -> Result<(), DataSyncError>;
    async fn execute(&mut self, sql: &str, params: &[Value]) -> Result<u64, DataSyncError>;
    async fn commit(&mut self) -> Result<(), DataSyncError>;
    async fn rollback(&mut self) -> Result<(), DataSyncError>;
}

/// Produces one bounded group of statements at a time for large sync plans.
/// A source error after execution has started is handled like a statement
/// failure: the active target transaction is rolled back.
#[async_trait]
pub trait StatementBatchSource: Send {
    async fn next_batch(&mut self) -> Result<Option<Vec<SqlStatement>>, DataSyncError>;
}

pub async fn execute_statements(
    statements: &[SqlStatement],
    executor: &mut dyn StatementExecutor,
    cancelled: Option<Arc<AtomicBool>>,
) -> Result<ExecutionResult, DataSyncError> {
    execute_statements_with_policy(statements, executor, cancelled, ConflictPolicy::Abort).await
}

pub async fn execute_statements_with_policy(
    statements: &[SqlStatement],
    executor: &mut dyn StatementExecutor,
    cancelled: Option<Arc<AtomicBool>>,
    conflict_policy: ConflictPolicy,
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
        return Ok(ExecutionResult {
            applied: 0,
            rolled_back: true,
            rollback_reason: Some("execute cancelled before any changes were applied".into()),
            affected_rows: 0,
            skipped: 0,
            conflicts: Vec::new(),
        });
    }

    if let Err(error) = executor.begin().await {
        return Ok(ExecutionResult {
            applied: 0,
            rolled_back: true,
            rollback_reason: Some(format!(
                "transaction could not start; no changes were applied: {error}"
            )),
            affected_rows: 0,
            skipped: 0,
            conflicts: Vec::new(),
        });
    }
    let mut applied = 0usize;
    let mut affected_rows = 0u64;
    let mut skipped = 0usize;
    let mut conflicts = Vec::new();
    for stmt in statements {
        if cancelled.as_ref().is_some_and(|c| c.load(Ordering::SeqCst)) {
            executor.rollback().await.map_err(|error| {
                DataSyncError::validation(format!(
                    "execute cancelled; rollback failed, outcome UNKNOWN: {error}"
                ))
            })?;
            return Ok(ExecutionResult {
                applied,
                rolled_back: true,
                rollback_reason: Some("execute cancelled; all changes were rolled back".into()),
                affected_rows,
                skipped: 0,
                conflicts: Vec::new(),
            });
        }
        let operation = stmt.operation;
        match executor.execute(&stmt.sql, &stmt.parameters).await {
            Ok(affected) => {
                if matches!(operation, ChangeOperation::Update | ChangeOperation::Delete)
                    && affected == 0
                {
                    let message = format!(
                        "optimistic sync conflict: {} for table '{}' affected zero rows",
                        match operation {
                            ChangeOperation::Update => "UPDATE",
                            ChangeOperation::Delete => "DELETE",
                            _ => "write",
                        },
                        stmt.table
                    );
                    if conflict_policy == ConflictPolicy::Skip {
                        skipped += 1;
                        conflicts.push(SyncConflict {
                            table: stmt.table.clone(),
                            operation,
                            row_key: stmt.row_key.clone(),
                            message,
                        });
                        continue;
                    }
                    executor.rollback().await.map_err(|error| {
                        DataSyncError::validation(format!(
                            "{message}; rollback failed, outcome UNKNOWN: {error}"
                        ))
                    })?;
                    return Ok(ExecutionResult {
                        applied,
                        rolled_back: true,
                        rollback_reason: Some(message.clone()),
                        affected_rows,
                        skipped: 0,
                        conflicts: vec![SyncConflict {
                            table: stmt.table.clone(),
                            operation,
                            row_key: stmt.row_key.clone(),
                            message,
                        }],
                    });
                }
                applied += 1;
                affected_rows += affected;
            }
            Err(err) => {
                let reason = format!("execution failed after {applied} statements: {err}");
                executor.rollback().await.map_err(|rollback_error| {
                    DataSyncError::validation(format!(
                        "{reason}; rollback failed, outcome UNKNOWN: {rollback_error}"
                    ))
                })?;
                return Ok(ExecutionResult {
                    applied,
                    rolled_back: true,
                    rollback_reason: Some(reason),
                    affected_rows,
                    skipped: 0,
                    conflicts: Vec::new(),
                });
            }
        }
    }
    executor.commit().await?;
    Ok(ExecutionResult {
        applied,
        rolled_back: false,
        rollback_reason: None,
        affected_rows,
        skipped,
        conflicts,
    })
}

/// Execute a pre-generated first page and then request further statement
/// pages while keeping one transaction open for the entire plan.
///
/// The caller generates the first non-empty page before claiming the plan or
/// opening a transaction. Later page-generation failures roll back prior
/// writes from this run.
pub async fn execute_statement_batches_with_policy(
    first_batch: Vec<SqlStatement>,
    source: &mut dyn StatementBatchSource,
    executor: &mut dyn StatementExecutor,
    cancelled: Option<Arc<AtomicBool>>,
    conflict_policy: ConflictPolicy,
) -> Result<ExecutionResult, DataSyncError> {
    if first_batch.is_empty() {
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
        return Ok(ExecutionResult {
            applied: 0,
            rolled_back: true,
            rollback_reason: Some("execute cancelled before any changes were applied".into()),
            affected_rows: 0,
            skipped: 0,
            conflicts: Vec::new(),
        });
    }

    if let Err(error) = executor.begin().await {
        return Ok(ExecutionResult {
            applied: 0,
            rolled_back: true,
            rollback_reason: Some(format!(
                "transaction could not start; no changes were applied: {error}"
            )),
            affected_rows: 0,
            skipped: 0,
            conflicts: Vec::new(),
        });
    }

    let mut applied = 0usize;
    let mut affected_rows = 0u64;
    let mut skipped = 0usize;
    let mut conflicts = Vec::new();
    let mut batch = Some(first_batch);
    loop {
        let statements = match batch.take() {
            Some(statements) => statements,
            None => match source.next_batch().await {
                Ok(Some(statements)) if !statements.is_empty() => statements,
                Ok(Some(_)) => continue,
                Ok(None) => break,
                Err(error) => {
                    let reason =
                        format!("statement generation failed after {applied} statements: {error}");
                    executor.rollback().await.map_err(|rollback_error| {
                        DataSyncError::validation(format!(
                            "{reason}; rollback failed, outcome UNKNOWN: {rollback_error}"
                        ))
                    })?;
                    return Ok(ExecutionResult {
                        applied,
                        rolled_back: true,
                        rollback_reason: Some(reason),
                        affected_rows,
                        skipped: 0,
                        conflicts: Vec::new(),
                    });
                }
            },
        };

        for stmt in statements {
            if cancelled.as_ref().is_some_and(|c| c.load(Ordering::SeqCst)) {
                executor.rollback().await.map_err(|error| {
                    DataSyncError::validation(format!(
                        "execute cancelled; rollback failed, outcome UNKNOWN: {error}"
                    ))
                })?;
                return Ok(ExecutionResult {
                    applied,
                    rolled_back: true,
                    rollback_reason: Some("execute cancelled; all changes were rolled back".into()),
                    affected_rows,
                    skipped: 0,
                    conflicts: Vec::new(),
                });
            }
            let operation = stmt.operation;
            match executor.execute(&stmt.sql, &stmt.parameters).await {
                Ok(affected) => {
                    if matches!(operation, ChangeOperation::Update | ChangeOperation::Delete)
                        && affected == 0
                    {
                        let message = format!(
                            "optimistic sync conflict: {} for table '{}' affected zero rows",
                            match operation {
                                ChangeOperation::Update => "UPDATE",
                                ChangeOperation::Delete => "DELETE",
                                _ => "write",
                            },
                            stmt.table
                        );
                        if conflict_policy == ConflictPolicy::Skip {
                            skipped += 1;
                            conflicts.push(SyncConflict {
                                table: stmt.table,
                                operation,
                                row_key: stmt.row_key,
                                message,
                            });
                            continue;
                        }
                        executor.rollback().await.map_err(|error| {
                            DataSyncError::validation(format!(
                                "{message}; rollback failed, outcome UNKNOWN: {error}"
                            ))
                        })?;
                        return Ok(ExecutionResult {
                            applied,
                            rolled_back: true,
                            rollback_reason: Some(message.clone()),
                            affected_rows,
                            skipped: 0,
                            conflicts: vec![SyncConflict {
                                table: stmt.table,
                                operation,
                                row_key: stmt.row_key,
                                message,
                            }],
                        });
                    }
                    applied += 1;
                    affected_rows += affected;
                }
                Err(error) => {
                    let reason = format!("execution failed after {applied} statements: {error}");
                    executor.rollback().await.map_err(|rollback_error| {
                        DataSyncError::validation(format!(
                            "{reason}; rollback failed, outcome UNKNOWN: {rollback_error}"
                        ))
                    })?;
                    return Ok(ExecutionResult {
                        applied,
                        rolled_back: true,
                        rollback_reason: Some(reason),
                        affected_rows,
                        skipped: 0,
                        conflicts: Vec::new(),
                    });
                }
            }
        }
    }

    executor.commit().await?;
    Ok(ExecutionResult {
        applied,
        rolled_back: false,
        rollback_reason: None,
        affected_rows,
        skipped,
        conflicts,
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
    use std::collections::VecDeque;

    struct VecBatchSource(VecDeque<Result<Option<Vec<SqlStatement>>, DataSyncError>>);

    #[async_trait]
    impl StatementBatchSource for VecBatchSource {
        async fn next_batch(&mut self) -> Result<Option<Vec<SqlStatement>>, DataSyncError> {
            self.0.pop_front().unwrap_or(Ok(None))
        }
    }

    fn batch_source(batches: impl IntoIterator<Item = Vec<SqlStatement>>) -> VecBatchSource {
        VecBatchSource(
            batches
                .into_iter()
                .map(|batch| Ok(Some(batch)))
                .chain(std::iter::once(Ok(None)))
                .collect(),
        )
    }

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
    async fn test_tester_stream_rejects_empty_first_batch_before_opening_a_transaction() {
        let mut exec = RecordingExecutor::default();
        let mut source = batch_source(Vec::<Vec<SqlStatement>>::new());
        let error = execute_statement_batches_with_policy(
            Vec::new(),
            &mut source,
            &mut exec,
            None,
            ConflictPolicy::Abort,
        )
        .await
        .unwrap_err();

        assert!(error.to_string().contains("change set is empty"));
        assert!(exec.calls.is_empty());
    }

    #[tokio::test]
    async fn test_tester_stream_rejects_read_only_before_opening_a_transaction() {
        let mut exec = RecordingExecutor {
            read_only: true,
            ..RecordingExecutor::default()
        };
        let mut source = batch_source(Vec::<Vec<SqlStatement>>::new());
        let error = execute_statement_batches_with_policy(
            vec![stmt("INSERT")],
            &mut source,
            &mut exec,
            None,
            ConflictPolicy::Abort,
        )
        .await
        .unwrap_err();

        assert!(error.to_string().contains("read-only"));
        assert!(exec.calls.is_empty());
    }

    #[tokio::test]
    async fn test_tester_stream_cancelled_before_begin_does_not_open_a_transaction() {
        let mut exec = RecordingExecutor::default();
        let mut source = batch_source(Vec::<Vec<SqlStatement>>::new());
        let cancelled = Arc::new(AtomicBool::new(true));
        let result = execute_statement_batches_with_policy(
            vec![stmt("INSERT")],
            &mut source,
            &mut exec,
            Some(cancelled),
            ConflictPolicy::Abort,
        )
        .await
        .unwrap();

        assert!(result.rolled_back);
        assert_eq!(result.applied, 0);
        assert!(result
            .rollback_reason
            .as_deref()
            .is_some_and(|reason| reason.contains("before any changes")));
        assert!(exec.calls.is_empty());
    }

    #[tokio::test]
    async fn test_tester_stream_begin_failure_reports_no_writes() {
        struct BeginFailureExecutor(Vec<String>);
        #[async_trait]
        impl StatementExecutor for BeginFailureExecutor {
            fn is_read_only(&self) -> bool {
                false
            }
            async fn begin(&mut self) -> Result<(), DataSyncError> {
                self.0.push("begin".into());
                Err(DataSyncError::validation("injected begin failure"))
            }
            async fn execute(&mut self, _: &str, _: &[Value]) -> Result<u64, DataSyncError> {
                self.0.push("execute".into());
                Ok(1)
            }
            async fn commit(&mut self) -> Result<(), DataSyncError> {
                self.0.push("commit".into());
                Ok(())
            }
            async fn rollback(&mut self) -> Result<(), DataSyncError> {
                self.0.push("rollback".into());
                Ok(())
            }
        }

        let mut exec = BeginFailureExecutor(Vec::new());
        let mut source = batch_source(Vec::<Vec<SqlStatement>>::new());
        let result = execute_statement_batches_with_policy(
            vec![stmt("INSERT")],
            &mut source,
            &mut exec,
            None,
            ConflictPolicy::Abort,
        )
        .await
        .unwrap();

        assert!(result.rolled_back);
        assert_eq!(result.applied, 0);
        assert!(result
            .rollback_reason
            .as_deref()
            .is_some_and(|reason| reason.contains("no changes were applied")));
        assert_eq!(exec.0, vec!["begin"]);
    }

    #[tokio::test]
    async fn test_tester_stream_skips_empty_generated_batches_and_continues_in_order() {
        let mut exec = RecordingExecutor::default();
        let mut source = VecBatchSource(VecDeque::from([
            Ok(Some(Vec::new())),
            Ok(Some(vec![stmt("page-2")])),
            Ok(None),
        ]));
        let result = execute_statement_batches_with_policy(
            vec![stmt("page-1")],
            &mut source,
            &mut exec,
            None,
            ConflictPolicy::Abort,
        )
        .await
        .unwrap();

        assert_eq!(result.applied, 2);
        assert_eq!(
            exec.calls,
            vec!["begin", "execute:1:page-1", "execute:1:page-2", "commit"]
        );
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
            rollback_reason: None,
            affected_rows: 3,
            skipped: 0,
            conflicts: Vec::new(),
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
        let result = execute_statements(&[stmt("A"), stmt("B")], &mut exec, None)
            .await
            .unwrap();
        assert!(result.rolled_back);
        assert!(result
            .rollback_reason
            .as_deref()
            .is_some_and(|reason| reason.contains("execution failed after 1")));
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
        let result = execute_statements(&[update], &mut exec, None)
            .await
            .unwrap();
        assert!(result.rolled_back);
        assert!(result
            .rollback_reason
            .as_deref()
            .is_some_and(|message| message.contains("zero rows")));
        assert_eq!(result.conflicts.len(), 1);
        assert_eq!(exec.calls, vec!["begin", "execute", "rollback"]);
    }

    #[tokio::test]
    async fn failed_rollback_keeps_the_write_outcome_unknown() {
        struct RollbackFailureExecutor;
        #[async_trait]
        impl StatementExecutor for RollbackFailureExecutor {
            fn is_read_only(&self) -> bool {
                false
            }
            async fn begin(&mut self) -> Result<(), DataSyncError> {
                Ok(())
            }
            async fn execute(&mut self, _: &str, _: &[Value]) -> Result<u64, DataSyncError> {
                Ok(0)
            }
            async fn commit(&mut self) -> Result<(), DataSyncError> {
                panic!("a conflicted statement must never commit")
            }
            async fn rollback(&mut self) -> Result<(), DataSyncError> {
                Err(DataSyncError::validation("connection lost during rollback"))
            }
        }

        let mut update = stmt("UPDATE t");
        update.operation = ChangeOperation::Update;
        let error = execute_statements(&[update], &mut RollbackFailureExecutor, None)
            .await
            .unwrap_err();
        assert!(error
            .to_string()
            .contains("rollback failed, outcome UNKNOWN"));
    }

    #[tokio::test]
    async fn skip_policy_commits_other_rows_and_reports_conflicts() {
        struct MixedRowsExecutor {
            calls: Vec<String>,
            executions: usize,
        }
        #[async_trait]
        impl StatementExecutor for MixedRowsExecutor {
            fn is_read_only(&self) -> bool {
                false
            }
            async fn begin(&mut self) -> Result<(), DataSyncError> {
                self.calls.push("begin".into());
                Ok(())
            }
            async fn execute(&mut self, _: &str, _: &[Value]) -> Result<u64, DataSyncError> {
                self.calls.push("execute".into());
                let affected = if self.executions == 0 { 0 } else { 1 };
                self.executions += 1;
                Ok(affected)
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
        let mut first = stmt("UPDATE first");
        first.operation = ChangeOperation::Update;
        first.row_key = vec![Value::Integer(1)];
        let mut second = stmt("UPDATE second");
        second.operation = ChangeOperation::Update;
        second.row_key = vec![Value::Integer(2)];
        let mut exec = MixedRowsExecutor {
            calls: Vec::new(),
            executions: 0,
        };
        let result =
            execute_statements_with_policy(&[first, second], &mut exec, None, ConflictPolicy::Skip)
                .await
                .unwrap();
        assert_eq!(result.applied, 1);
        assert_eq!(result.skipped, 1);
        assert_eq!(result.conflicts.len(), 1);
        assert!(matches!(
            result.conflicts[0].row_key.as_slice(),
            [Value::Integer(1)]
        ));
        assert_eq!(exec.calls, vec!["begin", "execute", "execute", "commit"]);
    }

    #[tokio::test]
    async fn force_policy_still_aborts_on_missing_primary_key_row() {
        struct ZeroRowsExecutor;
        #[async_trait]
        impl StatementExecutor for ZeroRowsExecutor {
            fn is_read_only(&self) -> bool {
                false
            }
            async fn begin(&mut self) -> Result<(), DataSyncError> {
                Ok(())
            }
            async fn execute(&mut self, _: &str, _: &[Value]) -> Result<u64, DataSyncError> {
                Ok(0)
            }
            async fn commit(&mut self) -> Result<(), DataSyncError> {
                panic!("must not commit")
            }
            async fn rollback(&mut self) -> Result<(), DataSyncError> {
                Ok(())
            }
        }
        let mut update = stmt("UPDATE t");
        update.operation = ChangeOperation::Update;
        let result = execute_statements_with_policy(
            &[update],
            &mut ZeroRowsExecutor,
            None,
            ConflictPolicy::Force,
        )
        .await
        .unwrap();
        assert!(result.rolled_back);
        assert_eq!(result.conflicts.len(), 1);
    }

    #[tokio::test]
    async fn force_policy_does_not_skip_insert_errors() {
        let mut exec = RecordingExecutor {
            fail_at: Some(0),
            ..RecordingExecutor::default()
        };
        let result = execute_statements_with_policy(
            &[stmt("INSERT duplicate")],
            &mut exec,
            None,
            ConflictPolicy::Force,
        )
        .await
        .unwrap();
        assert!(result.rolled_back);
        assert!(result
            .rollback_reason
            .as_deref()
            .is_some_and(|reason| reason.contains("execution failed")));
        assert!(exec.calls.contains(&"rollback".to_string()));
        assert!(!exec.calls.contains(&"commit".to_string()));
    }

    #[tokio::test]
    async fn cancel_before_start() {
        let mut exec = RecordingExecutor::default();
        let flag = Arc::new(AtomicBool::new(true));
        let result = execute_statements(&[stmt("A")], &mut exec, Some(flag))
            .await
            .unwrap();
        assert!(result.rolled_back);
        assert!(result
            .rollback_reason
            .as_deref()
            .is_some_and(|reason| reason.contains("before any changes")));
        assert!(exec.calls.is_empty());
    }

    #[tokio::test]
    async fn begin_failure_confirms_no_statements_were_applied() {
        struct BeginFailureExecutor;
        #[async_trait]
        impl StatementExecutor for BeginFailureExecutor {
            fn is_read_only(&self) -> bool {
                false
            }
            async fn begin(&mut self) -> Result<(), DataSyncError> {
                Err(DataSyncError::validation("database rejected transaction"))
            }
            async fn execute(&mut self, _: &str, _: &[Value]) -> Result<u64, DataSyncError> {
                panic!("failed begin must prevent statement execution")
            }
            async fn commit(&mut self) -> Result<(), DataSyncError> {
                panic!("failed begin must prevent commit")
            }
            async fn rollback(&mut self) -> Result<(), DataSyncError> {
                panic!("failed begin must not attempt rollback")
            }
        }

        let result = execute_statements(&[stmt("INSERT")], &mut BeginFailureExecutor, None)
            .await
            .unwrap();
        assert!(result.rolled_back);
        assert_eq!(result.applied, 0);
        assert!(result
            .rollback_reason
            .as_deref()
            .is_some_and(|reason| reason.contains("no changes were applied")));
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

    #[tokio::test]
    async fn statement_batches_preserve_order_across_page_boundaries() {
        let mut exec = RecordingExecutor::default();
        let mut source = batch_source(vec![vec![stmt("page-2-a"), stmt("page-2-b")]]);
        let result = execute_statement_batches_with_policy(
            vec![stmt("page-1")],
            &mut source,
            &mut exec,
            None,
            ConflictPolicy::Abort,
        )
        .await
        .unwrap();

        assert_eq!(result.applied, 3);
        assert_eq!(
            exec.calls,
            vec![
                "begin",
                "execute:1:page-1",
                "execute:1:page-2-a",
                "execute:1:page-2-b",
                "commit"
            ]
        );
    }

    #[tokio::test]
    async fn statement_source_error_after_a_page_rolls_back_prior_writes() {
        let mut exec = RecordingExecutor::default();
        let mut source = VecBatchSource(VecDeque::from([Err(DataSyncError::validation(
            "injected later page failure",
        ))]));
        let result = execute_statement_batches_with_policy(
            vec![stmt("page-1")],
            &mut source,
            &mut exec,
            None,
            ConflictPolicy::Abort,
        )
        .await
        .unwrap();

        assert!(result.rolled_back);
        assert_eq!(result.applied, 1);
        assert!(result
            .rollback_reason
            .as_deref()
            .is_some_and(|reason| reason.contains("statement generation failed after 1")));
        assert!(exec.calls.contains(&"rollback".to_string()));
        assert!(!exec.calls.contains(&"commit".to_string()));
    }

    #[tokio::test]
    async fn test_tester_later_batch_statement_failure_rolls_back_prior_page() {
        let mut exec = RecordingExecutor {
            fail_at: Some(1),
            ..RecordingExecutor::default()
        };
        let mut source = batch_source(vec![vec![stmt("page-2")]]);
        let result = execute_statement_batches_with_policy(
            vec![stmt("page-1")],
            &mut source,
            &mut exec,
            None,
            ConflictPolicy::Abort,
        )
        .await
        .expect("a later-page statement failure should be reported as a confirmed rollback");

        assert!(result.rolled_back);
        assert_eq!(result.applied, 1);
        assert!(result
            .rollback_reason
            .as_deref()
            .is_some_and(|reason| reason.contains("execution failed after 1 statements")));
        assert_eq!(
            exec.calls,
            vec!["begin", "execute:1:page-1", "execute:1:page-2", "rollback"]
        );
    }

    #[tokio::test]
    async fn later_page_failure_with_rollback_failure_reports_unknown_outcome() {
        struct RollbackFailureExecutor(RecordingExecutor);

        #[async_trait]
        impl StatementExecutor for RollbackFailureExecutor {
            fn is_read_only(&self) -> bool {
                false
            }
            async fn begin(&mut self) -> Result<(), DataSyncError> {
                self.0.begin().await
            }
            async fn execute(&mut self, sql: &str, params: &[Value]) -> Result<u64, DataSyncError> {
                self.0.execute(sql, params).await
            }
            async fn commit(&mut self) -> Result<(), DataSyncError> {
                self.0.commit().await
            }
            async fn rollback(&mut self) -> Result<(), DataSyncError> {
                self.0.calls.push("rollback-failed".into());
                Err(DataSyncError::validation("injected rollback failure"))
            }
        }

        let mut exec = RollbackFailureExecutor(RecordingExecutor::default());
        let mut source = VecBatchSource(VecDeque::from([Err(DataSyncError::validation(
            "injected later page failure",
        ))]));
        let error = execute_statement_batches_with_policy(
            vec![stmt("page-1")],
            &mut source,
            &mut exec,
            None,
            ConflictPolicy::Abort,
        )
        .await
        .unwrap_err();

        assert!(error.to_string().contains("outcome UNKNOWN"));
        assert!(error.to_string().contains("injected rollback failure"));
        assert_eq!(
            exec.0.calls.last().map(String::as_str),
            Some("rollback-failed")
        );
    }

    #[tokio::test]
    async fn cancellation_between_statement_pages_rolls_back_prior_page() {
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
                let result = self.inner.execute(sql, params).await;
                self.flag.store(true, Ordering::SeqCst);
                result
            }
            async fn commit(&mut self) -> Result<(), DataSyncError> {
                self.inner.commit().await
            }
            async fn rollback(&mut self) -> Result<(), DataSyncError> {
                self.inner.rollback().await
            }
        }

        let flag = Arc::new(AtomicBool::new(false));
        let mut exec = FlipOnExecute {
            inner: RecordingExecutor::default(),
            flag: flag.clone(),
        };
        let mut source = batch_source(vec![vec![stmt("page-2")]]);
        let result = execute_statement_batches_with_policy(
            vec![stmt("page-1")],
            &mut source,
            &mut exec,
            Some(flag),
            ConflictPolicy::Abort,
        )
        .await
        .unwrap();

        assert!(result.rolled_back);
        assert_eq!(result.applied, 1);
        assert!(exec.inner.calls.contains(&"rollback".to_string()));
        assert!(!exec.inner.calls.contains(&"execute:1:page-2".to_string()));
    }

    #[tokio::test]
    async fn streamed_skip_policy_reports_conflict_and_commits_following_page() {
        struct MixedRowsExecutor {
            calls: Vec<String>,
            executions: usize,
        }
        #[async_trait]
        impl StatementExecutor for MixedRowsExecutor {
            fn is_read_only(&self) -> bool {
                false
            }
            async fn begin(&mut self) -> Result<(), DataSyncError> {
                self.calls.push("begin".into());
                Ok(())
            }
            async fn execute(&mut self, _: &str, _: &[Value]) -> Result<u64, DataSyncError> {
                self.calls.push("execute".into());
                let affected = if self.executions == 0 { 0 } else { 1 };
                self.executions += 1;
                Ok(affected)
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

        let mut update = stmt("UPDATE first");
        update.operation = ChangeOperation::Update;
        let mut followup = stmt("UPDATE second");
        followup.operation = ChangeOperation::Update;
        let mut source = batch_source(vec![vec![followup]]);
        let mut exec = MixedRowsExecutor {
            calls: Vec::new(),
            executions: 0,
        };
        let result = execute_statement_batches_with_policy(
            vec![update],
            &mut source,
            &mut exec,
            None,
            ConflictPolicy::Skip,
        )
        .await
        .unwrap();

        assert!(!result.rolled_back);
        assert_eq!(result.applied, 1);
        assert_eq!(result.skipped, 1);
        assert_eq!(result.conflicts.len(), 1);
        assert_eq!(exec.calls, vec!["begin", "execute", "execute", "commit"]);
    }
}
