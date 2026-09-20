import { invoke } from '@tauri-apps/api/core';
import type { FilterCondition, Value } from '../types';

export interface SyncTask {
  id: string;
  /**
   * Legacy runtime ids may be absent. They are transient and are never used
   * to reopen a saved task; resolve fresh sessions from the connection ids.
   */
  sourceDbSessionId?: string;
  targetDbSessionId?: string;
  /** Persisted owning connection ids (config) for display / resume lookup. */
  sourceConnectionId: string;
  targetConnectionId: string;
  sourceDatabase?: string | null;
  targetDatabase?: string | null;
  sourceSchema?: string | null;
  targetSchema?: string | null;
  tables: string[];
  completedTables: string[];
  currentTable: string | null;
  currentTableOffset: number;
  sourceRowCounts: Record<string, number>;
  strategy: string;
  status: string;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  /** Saved checkpoints are explicitly unknown and require a fresh compare. */
  resumeState: 'unknown' | string;
}

export type DataSyncOperation = 'INSERT' | 'UPDATE' | 'DELETE' | 'UNCHANGED';

export type DataSyncMappingStatus =
  | 'MATCHED'
  | 'UNMAPPED_SOURCE'
  | 'UNMAPPED_TARGET'
  | 'DISABLED'
  | 'INCOMPATIBLE';

export interface DataSyncRowChange {
  operation: DataSyncOperation;
  key: Value[];
  sourceRow: (Value | null)[] | null;
  targetRow: (Value | null)[] | null;
  changedColumns: string[];
  selected: boolean;
}

export interface DataSyncTableResult {
  sourceTable: string;
  targetTable: string;
  status: DataSyncMappingStatus;
  incompatibleReason?: string | null;
  warnings?: string[];
  columns?: string[];
  columnTypes?: string[];
  primaryKeys?: string[];
  unchangedCount?: number;
  rows?: DataSyncRowChange[];
  sourceFilter?: DataSyncSourceFilter;
}

/** Structured, parameterized predicate applied symmetrically to one table pair. */
export interface DataSyncSourceFilter {
  filters: FilterCondition[];
  logic?: 'and' | 'or';
}

export interface SyncOptions {
  insert: boolean;
  update: boolean;
  delete: boolean;
  matchingStrategy?: 'primaryKey';
  batchSize?: number;
  largeValueMode?: 'full' | 'hash';
  conflictPolicy?: 'abort' | 'skip' | 'force';
}

export interface DataSyncSqlStatement {
  table: string;
  operation: DataSyncOperation;
  sql: string;
  previewSql: string;
  parameters: Value[];
  rowKey: Value[];
}

export interface DataSyncExecutionResult {
  applied: number;
  rolledBack: boolean;
  /** Total database-reported affected rows; optional for older responses. */
  affectedRows?: number;
  skipped?: number;
  conflicts?: DataSyncConflict[];
}

export interface DataSyncConflict {
  table: string;
  operation: DataSyncOperation;
  rowKey: Value[];
  message: string;
}

export interface DataSyncSelectedRow {
  sourceTable: string;
  targetTable: string;
  operation: DataSyncOperation;
  key: Value[];
}

export interface DataSyncSelection {
  revision: number;
  rows: DataSyncSelectedRow[];
}

export interface DataSyncComparisonPreview {
  planId: string;
  selectionRevision: number;
  tables: DataSyncTableResult[];
}

export interface DataSyncPairingView {
  path: string;
  supported: boolean;
  family?: string | null;
  reason?: string | null;
}

export const DEFAULT_SYNC_OPTIONS: SyncOptions = {
  insert: true,
  update: true,
  delete: false,
  matchingStrategy: 'primaryKey',
  batchSize: 1000,
  largeValueMode: 'full',
  conflictPolicy: 'abort',
};

let activeComparisonPlan: DataSyncComparisonPreview | null = null;
let activeExecutionOptions: SyncOptions = DEFAULT_SYNC_OPTIONS;

function valueToken(value: Value[]): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function selectionFromTables(
  plan: DataSyncComparisonPreview,
  tables: DataSyncTableResult[],
  options: SyncOptions,
): DataSyncSelection {
  const requested = new Set(
    tables.flatMap((table) =>
      (table.rows ?? [])
        .filter((row) => row.selected && row.operation !== 'UNCHANGED')
        .map(
          (row) =>
            `${table.sourceTable}\u0000${table.targetTable}\u0000${row.operation}\u0000${valueToken(row.key)}`,
        ),
    ),
  );
  const rows = plan.tables.flatMap((table) =>
    (table.rows ?? [])
      .filter((row) => {
        if (!row.selected || row.operation === 'UNCHANGED') return false;
        if (row.operation === 'INSERT' && !options.insert) return false;
        if (row.operation === 'UPDATE' && !options.update) return false;
        if (row.operation === 'DELETE' && !options.delete) return false;
        return requested.has(
          `${table.sourceTable}\u0000${table.targetTable}\u0000${row.operation}\u0000${valueToken(row.key)}`,
        );
      })
      .map((row) => ({
        sourceTable: table.sourceTable,
        targetTable: table.targetTable,
        operation: row.operation,
        key: row.key,
      })),
  );
  return { revision: plan.selectionRevision, rows };
}

function selectionFromStatements(
  plan: DataSyncComparisonPreview,
  statements: DataSyncSqlStatement[],
): DataSyncSelection {
  const rows: DataSyncSelectedRow[] = [];
  for (const statement of statements) {
    for (const table of plan.tables) {
      if (table.targetTable !== statement.table) continue;
      const match = (table.rows ?? []).find(
        (row) =>
          row.operation === statement.operation &&
          valueToken(row.key) === valueToken(statement.rowKey),
      );
      if (match) {
        rows.push({
          sourceTable: table.sourceTable,
          targetTable: table.targetTable,
          operation: match.operation,
          key: match.key,
        });
        break;
      }
    }
  }
  return { revision: plan.selectionRevision, rows };
}

export const syncCommands = {
  classifyDataSyncPair: (sourceDatabaseType: string, targetDatabaseType: string) =>
    invoke<DataSyncPairingView>('classify_data_sync_pair', {
      sourceDatabaseType,
      targetDatabaseType,
    }),

  getSyncTasks: () => invoke<SyncTask[]>('get_sync_tasks'),

  deleteSyncTask: (taskId: string) => invoke<void>('delete_sync_task', { taskId }),

  checkSyncConflicts: (taskId: string) =>
    invoke<{
      hasConflicts: boolean;
      conflicts: { table: string; originalRows: number; currentRows: number }[];
    }>('check_sync_conflicts', { taskId }),

  executeDataSync: (
    targetDbSessionId: string,
    statements: DataSyncSqlStatement[],
    jobId?: string,
    targetDatabase?: string,
  ) => {
    void targetDbSessionId;
    void targetDatabase;
    if (!activeComparisonPlan) {
      return Promise.reject(new Error('data sync comparison plan is missing; compare again'));
    }
    const request = {
      planId: activeComparisonPlan.planId,
      selection: selectionFromStatements(activeComparisonPlan, statements),
      options: activeExecutionOptions,
      jobId: jobId ?? null,
    };
    return invoke<DataSyncExecutionResult>('execute_data_sync', { request });
  },

  cancelDataSync: (jobId: string) => invoke<boolean>('cancel_data_sync', { jobId }),

  compareDataSync: async (
    sourceDbSessionId: string,
    targetDbSessionId: string,
    tables?: string[],
    jobId?: string,
    sourceDatabase?: string,
    targetDatabase?: string,
    sourceSchema?: string,
    targetSchema?: string,
    options?: SyncOptions,
    filters?: Record<string, DataSyncSourceFilter>,
  ) => {
    activeComparisonPlan = null;
    const response = await invoke<DataSyncComparisonPreview>('compare_data_sync', {
      sourceDbSessionId,
      targetDbSessionId,
      tables: tables ?? null,
      jobId: jobId ?? null,
      sourceDatabase: sourceDatabase ?? null,
      targetDatabase: targetDatabase ?? null,
      sourceSchema: sourceSchema ?? null,
      targetSchema: targetSchema ?? null,
      options: options ?? null,
      filters: filters ?? null,
    });
    activeComparisonPlan = response;
    return response;
  },

  applyDataSync: (
    sourceDbSessionId: string,
    targetDbSessionId: string,
    tables: string[],
    jobId?: string,
    sourceDatabase?: string,
    targetDatabase?: string,
    sourceSchema?: string,
    targetSchema?: string,
    options?: SyncOptions,
  ) =>
    invoke<DataSyncExecutionResult>('apply_data_sync', {
      sourceDbSessionId,
      targetDbSessionId,
      tables,
      jobId: jobId ?? null,
      sourceDatabase: sourceDatabase ?? null,
      targetDatabase: targetDatabase ?? null,
      sourceSchema: sourceSchema ?? null,
      targetSchema: targetSchema ?? null,
      options: options ?? null,
    }),

  inspectDataSync: (
    sourceDbSessionId: string,
    targetDbSessionId: string,
    sourceDatabase?: string,
    targetDatabase?: string,
    sourceSchema?: string,
    targetSchema?: string,
  ) =>
    invoke<DataSyncTableResult[]>('inspect_data_sync', {
      sourceDbSessionId,
      targetDbSessionId,
      sourceDatabase: sourceDatabase ?? null,
      targetDatabase: targetDatabase ?? null,
      sourceSchema: sourceSchema ?? null,
      targetSchema: targetSchema ?? null,
    }),

  /** Generate only the selected rows; failures never trigger another write path. */
  generateDataSyncSql: (
    sourceDbSessionId: string,
    targetDbSessionId: string,
    tables: DataSyncTableResult[],
    options: SyncOptions,
    sourceDatabase?: string,
    targetDatabase?: string,
    sourceSchema?: string,
    targetSchema?: string,
  ) => {
    void sourceDbSessionId;
    void targetDbSessionId;
    void sourceDatabase;
    void targetDatabase;
    void sourceSchema;
    void targetSchema;
    if (!activeComparisonPlan) {
      return Promise.reject(new Error('data sync comparison plan is missing; compare again'));
    }
    activeExecutionOptions = options;
    return invoke<DataSyncSqlStatement[]>('generate_data_sync_sql', {
      planId: activeComparisonPlan.planId,
      selection: selectionFromTables(activeComparisonPlan, tables, options),
      options,
    });
  },
};
