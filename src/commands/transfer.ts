import { invoke } from '@tauri-apps/api/core';
import type { FilterCondition } from '../types';

export type TransferMode = 'structure' | 'data' | 'structureAndData';
export type WriteMode = 'insert' | 'truncateInsert' | 'dropCreateInsert';

export type TransferMappingStatus =
  | 'MATCHED'
  | 'CREATE_NEW'
  | 'UNMAPPED_SOURCE'
  | 'UNMAPPED_TARGET'
  | 'DISABLED'
  | 'INCOMPATIBLE';

export interface TransferEndpoint {
  dbSessionId: string;
  database: string;
  schema?: string | null;
}

export interface TransferColumnMapping {
  sourceColumn: string;
  targetColumn: string;
  skip?: boolean;
  /** Native target DDL type override (cross-dialect create-new). */
  targetNativeType?: string;
}

export interface TransferTableMapping {
  sourceTable: string;
  targetTable: string;
  createNew?: boolean;
  enabled?: boolean;
  columnMappings?: TransferColumnMapping[];
  /** Execute this CREATE instead of auto-generated DDL. */
  ddlOverride?: string;
  /** Structured, parameterized source row filter. */
  sourceFilter?: TransferSourceFilter;
  /** Stable source recordset selection; never a restart checkpoint. */
  recordset?: TransferRecordset;
}

export interface TransferSourceFilter {
  filters: FilterCondition[];
  logic?: 'and' | 'or';
}

export interface TransferRecordsetBound {
  /** Text stays lossless on the IPC boundary; the source driver binds it using the inspected column type. */
  value: string;
  inclusive?: boolean;
}

export interface TransferRecordset {
  /** One source column. Composite order/ranges are rejected by the server in this wave. */
  orderBy?: string;
  start?: TransferRecordsetBound;
  end?: TransferRecordsetBound;
  limit?: number;
}

export interface TransferOptions {
  batchSize?: number;
  stopOnError?: boolean;
  confirmedDestructive?: boolean;
}

export interface TransferJob {
  source: TransferEndpoint;
  target: TransferEndpoint;
  mode: TransferMode;
  writeMode: WriteMode;
  tables: TransferTableMapping[];
  options: TransferOptions;
}

export interface TransferTableResult {
  sourceTable: string;
  targetTable: string;
  status: TransferMappingStatus;
  createNew: boolean;
  enabled: boolean;
  columnMappings: TransferColumnMapping[];
  sourceColumns?: string[];
  sourcePrimaryKeys?: string[];
  targetColumns?: string[];
  sourceColumnTypes?: Record<string, string>;
  ddlOverride?: string;
  incompatibleReason?: string | null;
  sourceRowCount?: number | null;
  sourceFilter?: TransferSourceFilter;
  recordset?: TransferRecordset;
}

export interface TransferDdlPreview {
  sourceTable: string;
  targetTable: string;
  ddl: string;
}

export interface TransferWritePlan {
  sourceTable: string;
  targetTable: string;
  writeMode: WriteMode;
  mappedColumns: TransferColumnMapping[];
  estimatedRows?: number | null;
  preamble: string[];
  sourceFilterPreview?: string | null;
  recordsetPreview?: string | null;
}

export interface TransferPreview {
  planId: string;
  pairingPath: string;
  mode: TransferMode;
  writeMode: WriteMode;
  ddl: TransferDdlPreview[];
  writePlans: TransferWritePlan[];
  warnings: string[];
  canExecute: boolean;
  blockReason?: string | null;
}

export interface TransferTableExecution {
  sourceTable: string;
  targetTable: string;
  rowsInserted: number;
  success: boolean;
  error?: string | null;
}

export interface TransferExecutionResult {
  tables: TransferTableExecution[];
  rowsInserted: number;
  cancelled: boolean;
  partial: boolean;
}

export interface TransferRunSelection {
  sourceTables?: string[];
}

export interface TransferRunOptions {
  confirmedDestructive?: boolean;
}

export interface TransferRunRequest {
  planId: string;
  selection?: TransferRunSelection;
  options?: TransferRunOptions;
  jobId?: string;
}

export interface TransferPairingView {
  path: string;
  supported: boolean;
  family?: string | null;
  reason?: string | null;
}

export const DEFAULT_TRANSFER_OPTIONS: TransferOptions = {
  batchSize: 500,
  stopOnError: true,
  confirmedDestructive: false,
};

export const transferCommands = {
  classifyPair: (sourceDatabaseType: string, targetDatabaseType: string) =>
    invoke<TransferPairingView>('classify_transfer_pair', {
      sourceDatabaseType,
      targetDatabaseType,
    }),

  inspect: (
    sourceDbSessionId: string,
    targetDbSessionId: string,
    mode: TransferMode,
    sourceDatabase?: string,
    targetDatabase?: string,
    tables?: TransferTableMapping[],
  ) =>
    invoke<TransferTableResult[]>('inspect_data_transfer', {
      sourceDbSessionId,
      targetDbSessionId,
      sourceDatabase: sourceDatabase ?? null,
      targetDatabase: targetDatabase ?? null,
      mode,
      tables: tables ?? null,
    }),

  preview: (job: TransferJob) => invoke<TransferPreview>('preview_data_transfer', { job }),

  execute: (request: TransferRunRequest) =>
    invoke<TransferExecutionResult>('execute_data_transfer', {
      request,
    }),

  cancel: (jobId: string) => invoke<boolean>('cancel_data_transfer', { jobId }),
};
