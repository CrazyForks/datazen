import { invoke } from '@tauri-apps/api/core';
import type { TableSchemaDiff } from '../types';

export type StatementRisk = 'additive' | 'destructive' | 'rewrite';

export type DeployStatus =
  | 'committed'
  | 'unknown'
  | 'rolled_back'
  | 'mixed'
  | 'failed'
  | 'cancelled';

export interface PlanStatement {
  sql: string;
  risk: StatementRisk;
  rollbackSql: string | null;
  summary: string;
}

export interface RollbackCompleteness {
  complete: boolean;
  missing: string[];
}

export interface TypeSuggestion {
  table: string;
  column: string;
  sourceType: string;
  suggestedType: string;
  currentType: string;
  reason: string;
  isKeyOrIndexed: boolean;
}

export interface ColumnTypeOverride {
  table: string;
  column: string;
  targetType: string;
}

/** Normalized plan requirement (from IPC tagged enum). */
export interface PlanRequirement {
  kind: 'Backfill' | 'Unsupported';
  table: string;
  column: string;
  reason: string;
}

/** Rollback counts derived from {@link RollbackCompleteness} and statement list. */
export interface RollbackCompletenessCounts {
  complete: number;
  missing: number;
}

type PlanRequirementIpc =
  | { backfill: { table: string; column: string; reason: string } }
  | { unsupported: { operation: string; reason: string } };

type SchemaDiffPlanIpc = Omit<SchemaDiffPlan, 'requirements'> & {
  requirements?: PlanRequirementIpc[];
};

function normalizeRequirement(raw: PlanRequirementIpc): PlanRequirement {
  if ('backfill' in raw) {
    const { table, column, reason } = raw.backfill;
    return { kind: 'Backfill', table, column, reason };
  }
  const { operation, reason } = raw.unsupported;
  const dot = operation.indexOf('.');
  if (dot > 0) {
    return {
      kind: 'Unsupported',
      table: operation.slice(0, dot),
      column: operation.slice(dot + 1),
      reason,
    };
  }
  return { kind: 'Unsupported', table: operation, column: '', reason };
}

function normalizePlan(plan: SchemaDiffPlanIpc): SchemaDiffPlan {
  return {
    ...plan,
    requirements: (plan.requirements ?? []).map(normalizeRequirement),
  };
}

function denormalizeRequirement(req: PlanRequirement): PlanRequirementIpc {
  if (req.kind === 'Backfill') {
    return { backfill: { table: req.table, column: req.column, reason: req.reason } };
  }
  const operation = req.column ? `${req.table}.${req.column}` : req.table;
  return { unsupported: { operation, reason: req.reason } };
}

function denormalizePlan(plan: SchemaDiffPlan): SchemaDiffPlanIpc {
  return {
    ...plan,
    requirements: (plan.requirements ?? []).map(denormalizeRequirement),
  };
}

export function rollbackCompletenessCounts(plan: SchemaDiffPlan): RollbackCompletenessCounts {
  const total = plan.statements.length;
  const missing = plan.rollbackCompleteness.missing.length;
  return { complete: total - missing, missing };
}

export interface SchemaDiffPlan {
  planId?: string;
  table: string;
  tables: string[];
  sourceDialect: string;
  targetDialect: string;
  sameDialect: boolean;
  statements: PlanStatement[];
  warnings: string[];
  requirements?: PlanRequirement[];
  rollbackCompleteness: RollbackCompleteness;
  typeSuggestions?: TypeSuggestion[];
}

export interface StatementExecResult {
  index: number;
  sql: string;
  ok: boolean;
  error: string | null;
}

export interface SchemaDiffDeployResult {
  status: DeployStatus;
  executedCount: number;
  statementCount: number;
  errors: string[];
  statementResults: StatementExecResult[];
}

/// Clipboard export/import format. v2: keys renamed to connectionId per the
/// connectionId(dbSessionId) terminology (v1 configs with configId are rejected).
export interface SchemaDiffConfigJson {
  version: 2;
  sourceConnectionId: string;
  targetConnectionId: string;
  tables: string[];
  allowDestructive: boolean;
  includeIndexes?: boolean;
  requireRollback?: boolean;
}

/** Persisted Schema Diff setup. Runtime sessions and generated plans are never stored. */
export interface SchemaDiffProfile {
  version: 1;
  id: string;
  name: string;
  sourceConnectionId: string;
  targetConnectionId: string;
  sourceDatabase: string;
  targetDatabase: string;
  sourceSchema?: string | null;
  targetSchema?: string | null;
  tables: string[];
  allowDestructive: boolean;
  includeIndexes: boolean;
  requireRollback: boolean;
  typeOverrides?: ColumnTypeOverride[];
  createdAt: string;
  updatedAt: string;
}

export const DESTRUCTIVE_CONFIRM_TOKEN = 'DEPLOY';

export async function cancelSchemaDiffDeploy(jobId: string): Promise<boolean> {
  return invoke('cancel_schema_diff_deploy', { jobId });
}

export function planHasDestructive(plan: SchemaDiffPlan): boolean {
  return plan.statements.some((s) => s.risk === 'destructive' || s.risk === 'rewrite');
}

export function dialectSupportsTransactionalDdl(dialect: string): boolean {
  const d = dialect.toLowerCase();
  return d === 'postgresql' || d === 'postgres' || d === 'sqlite';
}

export function exportPlanSql(plan: SchemaDiffPlan): string {
  const header = [
    `-- Schema Diff Deploy plan`,
    `-- tables: ${plan.tables.join(', ')}`,
    `-- ${plan.sourceDialect} → ${plan.targetDialect}`,
    '',
  ];
  return [...header, ...plan.statements.map((s) => `${s.sql};`)].join('\n');
}

export const schemaDiffCommands = {
  getProfiles: () => invoke<SchemaDiffProfile[]>('get_schema_diff_profiles'),

  saveProfile: (profile: SchemaDiffProfile) =>
    invoke<void>('save_schema_diff_profile', { profile }),

  deleteProfile: (profileId: string) => invoke<void>('delete_schema_diff_profile', { profileId }),

  compareTableSchemas: (sourceDbSessionId: string, targetDbSessionId: string, tableName: string) =>
    invoke<TableSchemaDiff>('compare_table_schemas', {
      sourceDbSessionId,
      targetDbSessionId,
      tableName,
    }),

  preparePlan: (params: {
    sourceDbSessionId: string;
    targetDbSessionId: string;
    tableNames: string[];
    allowDestructive: boolean;
    includeIndexes?: boolean;
    typeOverrides?: ColumnTypeOverride[];
  }) =>
    invoke<SchemaDiffPlanIpc>('prepare_schema_diff_plan', {
      sourceDbSessionId: params.sourceDbSessionId,
      targetDbSessionId: params.targetDbSessionId,
      tableNames: params.tableNames,
      allowDestructive: params.allowDestructive,
      includeIndexes: params.includeIndexes,
      typeOverrides: params.typeOverrides,
    }).then(normalizePlan),

  executeDeploy: (params: {
    targetDbSessionId: string;
    plan: SchemaDiffPlan;
    useTransaction?: boolean;
    requireRollback?: boolean;
    confirmDestructive?: string;
    jobId?: string;
    profile?: { id: string; revision: string };
  }) =>
    invoke<SchemaDiffDeployResult>('execute_schema_diff_deploy', {
      targetDbSessionId: params.targetDbSessionId,
      plan: denormalizePlan(params.plan),
      useTransaction: params.useTransaction,
      requireRollback: params.requireRollback,
      confirmDestructive: params.confirmDestructive,
      jobId: params.jobId,
      ...(params.profile ? { profile: params.profile } : {}),
    }),

  cancelDeploy: (jobId: string) => cancelSchemaDiffDeploy(jobId),
};
