/**
 * Real database migration workflow journey.
 *
 * This suite is intentionally opt-in. Set E2E_MIGRATION_LIVE=1 after the
 * PostgreSQL/MySQL fixtures have been provisioned with e2e/setup-e2e-env.sh.
 * Without that switch the suites are reported as skipped by WebDriver; a
 * missing or unreachable database is also a skip, never a fake pass.
 */
import { expect } from '@wdio/globals';
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import {
  connectBackend,
  disconnectBackend,
  injectDialogPath,
  invokeBackend,
  queryScalar,
  resetDialogQueue,
  executeQuery,
  withSafeModeOff,
} from '../helpers.js';

type Dialect = 'postgresql' | 'mysql';

interface MigrationRun {
  id: string;
  operation: string;
  status: string;
  outcome: string;
  profileId: string | null;
  profileRevision: string | null;
  sourceConnectionId: string | null;
  targetConnectionId: string | null;
  errorSummary: string | null;
}

interface MigrationRunPage {
  items: MigrationRun[];
  total: number;
}

interface TransferProfile {
  version: number;
  id: string;
  name: string;
  sourceConnectionId: string;
  targetConnectionId?: string;
  sourceDatabase: string;
  targetDatabase?: string;
  sourceSchema?: string;
  targetSchema?: string;
  destinationMode: 'database' | 'sqlFile';
  sqlFileDialect?: Dialect;
  mode: 'structure' | 'data' | 'structureAndData';
  writeMode: 'insert' | 'truncateInsert' | 'dropCreateInsert';
  tables: Array<{
    sourceTable: string;
    targetTable: string;
    createNew: boolean;
    enabled: boolean;
    columnMappings: [];
  }>;
  options: {
    batchSize: number;
    stopOnError: boolean;
    confirmedDestructive: boolean;
  };
  createdAt: string;
  updatedAt: string;
}

interface WorkflowDefinition {
  id: string;
  name: string;
  description: string;
  version: null;
  author: null;
  variables: Array<{
    name: string;
    type: string;
    description: string;
    required: boolean;
    default: null;
  }>;
  connection: null;
  database: null;
  steps: Array<Record<string, unknown>>;
  output: null;
  timeoutSecs: null;
  errorHandling: null;
  schedule: { enabled: boolean; intervalSecs: number } | null;
  visibility: 'user';
}

interface WorkflowExecutionResult {
  success: boolean;
  steps: Array<{ status: string; result?: unknown }>;
  error: string | null;
}

const LIVE_ENABLED = process.env.E2E_MIGRATION_LIVE === '1';
const LIVE_DIALECTS = new Set(
  (process.env.E2E_MIGRATION_LIVE_DIALECTS || 'postgresql,mysql')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean),
);

function databaseFor(dialect: Dialect, role: 'source' | 'target'): string {
  if (dialect === 'postgresql') {
    return role === 'source' ? 'datazen_sync_src' : 'datazen_sync_tgt';
  }
  return role === 'source' ? 'datazen_sync_mysql_src' : 'datazen_sync_mysql_tgt';
}

function connectionConfig(dialect: Dialect, id: string, name: string, database: string) {
  const prefix = dialect === 'postgresql' ? 'E2E_PG' : 'E2E_MYSQL';
  return {
    id,
    name,
    databaseType: dialect,
    host: process.env[`${prefix}_HOST`] || '127.0.0.1',
    port: Number(process.env[`${prefix}_PORT`]) || (dialect === 'mysql' ? 3306 : 5432),
    username: process.env[`${prefix}_USER`] || (dialect === 'mysql' ? 'root' : 'postgres'),
    password: process.env[`${prefix}_PASSWORD`] || '',
    database,
    sslMode: 'disable',
  };
}

function tableSql(dialect: Dialect, table: string): string[] {
  const text = dialect === 'postgresql' ? 'TEXT' : 'VARCHAR(128)';
  return [
    `DROP TABLE IF EXISTS ${table}`,
    `CREATE TABLE ${table} (id INT PRIMARY KEY, value ${text} NOT NULL)`,
    `INSERT INTO ${table} (id, value) VALUES (1, 'one'), (2, 'two')`,
  ];
}

function countSql(table: string): string {
  return `SELECT COUNT(*) AS c FROM ${table}`;
}

function profileTemplate(
  dialect: Dialect,
  id: string,
  sourceId: string,
  targetId: string,
  table: string,
): TransferProfile {
  const now = new Date(0).toISOString();
  return {
    version: 1,
    id,
    name: `Live migration ${dialect}`,
    sourceConnectionId: sourceId,
    targetConnectionId: targetId,
    sourceDatabase: databaseFor(dialect, 'source'),
    targetDatabase: databaseFor(dialect, 'target'),
    ...(dialect === 'postgresql' ? { sourceSchema: 'public', targetSchema: 'public' } : {}),
    destinationMode: 'database',
    mode: 'data',
    writeMode: 'insert',
    tables: [
      {
        sourceTable: table,
        targetTable: table,
        createNew: false,
        enabled: true,
        columnMappings: [],
      },
    ],
    options: { batchSize: 100, stopOnError: true, confirmedDestructive: false },
    createdAt: now,
    updatedAt: now,
  };
}

function workflowTemplate(
  id: string,
  profileId: string,
  revision: string,
  policy: 'reject' | 'allow',
  schedule: boolean,
  tokenVariable?: string,
): WorkflowDefinition {
  return {
    id,
    name: id,
    description: 'Live migration workflow E2E',
    version: null,
    author: null,
    variables: tokenVariable
      ? [
          {
            name: tokenVariable,
            type: 'string',
            description: 'native SQL file token',
            // Leave this optional so the host migration step, rather than the
            // generic workflow validator, records the fail-closed token error.
            required: false,
            default: null,
          },
        ]
      : [],
    connection: null,
    database: null,
    steps: [
      {
        type: 'migration',
        id: 'migration',
        operation: 'dataTransfer',
        profileId,
        profileRevision: revision,
        destructivePolicy: policy,
        ...(tokenVariable ? { sqlFileTokenVariable: tokenVariable } : {}),
      },
    ],
    output: null,
    timeoutSecs: null,
    errorHandling: null,
    schedule: schedule ? { enabled: true, intervalSecs: 30 } : null,
    visibility: 'user',
  };
}

async function listRuns(filter?: Record<string, unknown>): Promise<MigrationRun[]> {
  const page = await invokeBackend<MigrationRunPage>('list_migration_runs', {
    filter: filter || null,
    offset: 0,
    limit: 100,
  });
  return page.items;
}

async function waitForNewRun(
  knownIds: Set<string>,
  predicate: (run: MigrationRun) => boolean,
  timeout = 15000,
): Promise<MigrationRun> {
  let latest: MigrationRun | undefined;
  await browser.waitUntil(
    async () => {
      const runs = await listRuns();
      latest = runs.find((run) => !knownIds.has(run.id) && predicate(run));
      return latest !== undefined;
    },
    { timeout, interval: 500, timeoutMsg: 'Timed out waiting for migration run history' },
  );
  if (!latest) throw new Error('migration run disappeared after waitUntil');
  return latest;
}

async function runWorkflow(workflowId: string, variables: Record<string, unknown> = {}) {
  return invokeBackend<WorkflowExecutionResult>('workflow_execute', {
    workflowId,
    variables,
    connectionId: null,
  });
}

function liveMigrationJourney(dialect: Dialect) {
  describe(`[live] ${dialect} scheduled migration workflow`, function () {
    this.timeout(180000);

    const stamp = `${dialect}_${Date.now().toString(36)}`;
    const sourceId = `e2e_live_mig_src_${stamp}`;
    const targetId = `e2e_live_mig_tgt_${stamp}`;
    const table = `e2e_live_mig_${stamp}`;
    const profileId = `e2e_live_profile_${stamp}`;
    const directWorkflowId = `e2e_live_direct_${stamp}`;
    const destructiveWorkflowId = `e2e_live_destructive_${stamp}`;
    const sqlWorkflowId = `e2e_live_sql_${stamp}`;
    const scheduledWorkflowId = `e2e_live_scheduled_${stamp}`;
    const sqlPath = `/tmp/${sqlWorkflowId}.sql`;
    let profile: TransferProfile;
    let initialized = false;
    let connectionsSaved = false;
    let sourceSession = '';
    let targetSession = '';

    before(async function () {
      if (!LIVE_ENABLED) {
        console.warn(`[migration-live] ${dialect} skipped: set E2E_MIGRATION_LIVE=1`);
        this.skip();
        return;
      }
      if (!LIVE_DIALECTS.has(dialect)) {
        console.warn(`[migration-live] ${dialect} skipped by E2E_MIGRATION_LIVE_DIALECTS`);
        this.skip();
        return;
      }

      try {
        await invokeBackend('save_connection', {
          config: connectionConfig(
            dialect,
            sourceId,
            `${sourceId}`,
            databaseFor(dialect, 'source'),
          ),
        });
        connectionsSaved = true;
        await invokeBackend('save_connection', {
          config: connectionConfig(
            dialect,
            targetId,
            `${targetId}`,
            databaseFor(dialect, 'target'),
          ),
        });
        sourceSession = await connectBackend(sourceId);
        targetSession = await connectBackend(targetId);
        await withSafeModeOff(async () => {
          for (const statement of tableSql(dialect, table)) {
            await invokeBackend('execute_query', { dbSessionId: sourceSession, sql: statement });
          }
          for (const statement of tableSql(dialect, table).slice(0, 2)) {
            await invokeBackend('execute_query', { dbSessionId: targetSession, sql: statement });
          }
        });
        await disconnectBackend(sourceSession);
        await disconnectBackend(targetSession);
        sourceSession = '';
        targetSession = '';
      } catch (error) {
        await disconnectBackend(sourceSession);
        await disconnectBackend(targetSession);
        sourceSession = '';
        targetSession = '';
        console.warn(
          `[migration-live] ${dialect} skipped: database preflight failed: ${String(error)}`,
        );
        this.skip();
        return;
      }

      profile = profileTemplate(dialect, profileId, sourceId, targetId, table);
      await invokeBackend('save_transfer_profile', { profile });
      const profiles = await invokeBackend<TransferProfile[]>('get_transfer_profiles');
      const stored = profiles.find((candidate) => candidate.id === profileId);
      if (!stored) throw new Error(`saved transfer profile ${profileId} was not returned`);
      profile = stored;
      initialized = true;
    });

    after(async () => {
      if (!initialized) {
        if (connectionsSaved) {
          await invokeBackend('delete_connection', { id: sourceId }).catch(() => undefined);
          await invokeBackend('delete_connection', { id: targetId }).catch(() => undefined);
        }
        return;
      }
      await resetDialogQueue().catch(() => undefined);
      await disconnectBackend(sourceSession);
      await disconnectBackend(targetSession);
      try {
        const cleanupSource = await connectBackend(sourceId);
        await withSafeModeOff(() => executeQuery(cleanupSource, `DROP TABLE IF EXISTS ${table}`));
        await disconnectBackend(cleanupSource);
      } catch {
        /* database was unavailable or suite was skipped */
      }
      try {
        const cleanupTarget = await connectBackend(targetId);
        await withSafeModeOff(() => executeQuery(cleanupTarget, `DROP TABLE IF EXISTS ${table}`));
        await disconnectBackend(cleanupTarget);
      } catch {
        /* database was unavailable or suite was skipped */
      }
      for (const workflowId of [
        directWorkflowId,
        destructiveWorkflowId,
        sqlWorkflowId,
        scheduledWorkflowId,
      ]) {
        await invokeBackend('workflow_delete', { workflowId }).catch(() => undefined);
      }
      await invokeBackend('delete_transfer_profile', { profileId: `${profileId}_sql` }).catch(
        () => undefined,
      );
      await invokeBackend('delete_transfer_profile', { profileId }).catch(() => undefined);
      await invokeBackend('delete_connection', { id: sourceId }).catch(() => undefined);
      await invokeBackend('delete_connection', { id: targetId }).catch(() => undefined);
      if (existsSync(sqlPath)) unlinkSync(sqlPath);
    });

    it('executes through fresh sessions and records a completed run with the profile revision', async () => {
      const known = new Set((await listRuns()).map((run) => run.id));
      await invokeBackend('workflow_save', {
        workflow: workflowTemplate(directWorkflowId, profileId, profile.updatedAt, 'reject', false),
      });
      const result = await runWorkflow(directWorkflowId);
      expect(result.success).toBe(true);
      expect(result.steps[0]?.status).toBe('success');

      const run = await waitForNewRun(
        known,
        (candidate) => candidate.profileId === profileId && candidate.status === 'completed',
      );
      expect(run.outcome).toBe('success');
      expect(Date.parse(run.profileRevision || '')).toBe(Date.parse(profile.updatedAt));
      expect(run.sourceConnectionId).toBeNull();
      expect(run.targetConnectionId).toBeNull();

      const verifySession = await connectBackend(targetId);
      try {
        const rows = await executeQuery(verifySession, countSql(table));
        expect(queryScalar(rows, 'c')).toBe(2);
      } finally {
        await disconnectBackend(verifySession);
      }
    });

    it('fails closed when a saved profile revision is stale and converges in run history', async () => {
      const known = new Set((await listRuns()).map((run) => run.id));
      const changedProfile = {
        ...profile,
        name: `${profile.name} revised`,
        updatedAt: new Date().toISOString(),
      };
      await invokeBackend('save_transfer_profile', { profile: changedProfile });
      let error = '';
      try {
        await runWorkflow(directWorkflowId);
      } catch (caught) {
        error = caught instanceof Error ? caught.message : String(caught);
      }
      expect(error).toMatch(/profile changed|review|prepare/i);
      const run = await waitForNewRun(known, (candidate) => candidate.status === 'failed');
      expect(run.outcome).toBe('failed');
      expect(run.errorSummary).toMatch(/failed/i);
      profile = (await invokeBackend<TransferProfile[]>('get_transfer_profiles')).find(
        (candidate) => candidate.id === profileId,
      ) as TransferProfile;
    });

    it('rejects unattended destructive mode, then allows it explicitly', async () => {
      const destructiveProfile = {
        ...profile,
        writeMode: 'truncateInsert' as const,
        options: { ...profile.options, confirmedDestructive: true },
        updatedAt: new Date().toISOString(),
      };
      await invokeBackend('save_transfer_profile', { profile: destructiveProfile });
      profile = (await invokeBackend<TransferProfile[]>('get_transfer_profiles')).find(
        (candidate) => candidate.id === profileId,
      ) as TransferProfile;

      const rejectKnown = new Set((await listRuns()).map((run) => run.id));
      await invokeBackend('workflow_save', {
        workflow: workflowTemplate(
          destructiveWorkflowId,
          profileId,
          profile.updatedAt,
          'reject',
          false,
        ),
      });
      let rejectError = '';
      try {
        await runWorkflow(destructiveWorkflowId);
      } catch (caught) {
        rejectError = caught instanceof Error ? caught.message : String(caught);
      }
      expect(rejectError).toMatch(/destructive policy rejects/i);
      const rejected = await waitForNewRun(
        rejectKnown,
        (candidate) => candidate.profileId === profileId && candidate.status === 'failed',
      );
      expect(rejected.outcome).toBe('failed');

      await invokeBackend('workflow_save', {
        workflow: workflowTemplate(
          destructiveWorkflowId,
          profileId,
          profile.updatedAt,
          'allow',
          false,
        ),
      });
      const allowed = await runWorkflow(destructiveWorkflowId);
      expect(allowed.success).toBe(true);
      const verifySession = await connectBackend(targetId);
      try {
        const rows = await executeQuery(verifySession, countSql(table));
        expect(queryScalar(rows, 'c')).toBe(2);
      } finally {
        await disconnectBackend(verifySession);
      }
    });

    it('requires a fresh SQL-file token and redacts it from workflow history after a real export', async () => {
      const sqlProfileId = `${profileId}_sql`;
      const sqlProfile = {
        ...profile,
        id: sqlProfileId,
        name: `${profile.name} SQL`,
        targetConnectionId: undefined,
        targetDatabase: undefined,
        destinationMode: 'sqlFile' as const,
        sqlFileDialect: dialect,
        mode: 'structureAndData' as const,
        writeMode: 'insert' as const,
        tables: [{ ...profile.tables[0], createNew: true }],
      };
      await invokeBackend('save_transfer_profile', { profile: sqlProfile });
      const savedSqlProfile = (
        await invokeBackend<TransferProfile[]>('get_transfer_profiles')
      ).find((candidate) => candidate.id === sqlProfileId) as TransferProfile;

      const missingKnown = new Set((await listRuns()).map((run) => run.id));
      await invokeBackend('workflow_save', {
        workflow: workflowTemplate(
          sqlWorkflowId,
          sqlProfileId,
          savedSqlProfile.updatedAt,
          'reject',
          false,
          'sqlToken',
        ),
      });
      let missingError = '';
      try {
        await runWorkflow(sqlWorkflowId);
      } catch (caught) {
        missingError = caught instanceof Error ? caught.message : String(caught);
      }
      expect(missingError).toMatch(/SQL-file workflow migration requires a fresh token/i);
      const missingRun = await waitForNewRun(
        missingKnown,
        (candidate) => candidate.profileId === sqlProfileId && candidate.status === 'failed',
      );
      expect(missingRun.outcome).toBe('failed');

      await resetDialogQueue();
      await injectDialogPath(sqlPath);
      const picked = await invokeBackend<{ fileToken: string }>('pick_data_transfer_sql_file');
      expect(picked.fileToken).toBeTruthy();
      const exported = await runWorkflow(sqlWorkflowId, { sqlToken: picked.fileToken });
      expect(exported.success).toBe(true);
      expect(existsSync(sqlPath)).toBe(true);
      const sqlText = readFileSync(sqlPath, 'utf8');
      expect(sqlText).toMatch(new RegExp(table));

      const workflowHistory = await invokeBackend<Array<{ id: string; workflowId: string }>>(
        'workflow_history_list',
        { workflowId: sqlWorkflowId },
      );
      const latest = workflowHistory[0];
      expect(latest).toBeDefined();
      const history = await invokeBackend<{ variables: Record<string, unknown> }>(
        'workflow_history_get',
        {
          historyId: latest.id,
        },
      );
      expect(history.variables.sqlToken).toBe('[redacted]');
      await invokeBackend('delete_transfer_profile', { profileId: sqlProfileId });
    });

    it('runs an enabled scheduled workflow through the real scheduler', async () => {
      if (process.env.E2E_MIGRATION_SCHEDULED === '0') {
        console.warn('[migration-live] scheduled trigger skipped by E2E_MIGRATION_SCHEDULED=0');
        return;
      }
      const currentProfile = {
        ...profile,
        writeMode: 'insert' as const,
        updatedAt: new Date().toISOString(),
      };
      await invokeBackend('save_transfer_profile', { profile: currentProfile });
      profile = (await invokeBackend<TransferProfile[]>('get_transfer_profiles')).find(
        (candidate) => candidate.id === profileId,
      ) as TransferProfile;
      const target = await connectBackend(targetId);
      try {
        await withSafeModeOff(() => executeQuery(target, `DELETE FROM ${table}`));
      } finally {
        await disconnectBackend(target);
      }

      const known = new Set((await listRuns()).map((run) => run.id));
      await invokeBackend('workflow_save', {
        workflow: workflowTemplate(
          scheduledWorkflowId,
          profileId,
          profile.updatedAt,
          'reject',
          true,
        ),
      });
      const listed =
        await invokeBackend<Array<{ id: string; scheduled: boolean }>>('workflow_list');
      expect(listed.find((item) => item.id === scheduledWorkflowId)?.scheduled).toBe(true);

      const run = await waitForNewRun(
        known,
        (candidate) => candidate.profileId === profileId && candidate.status === 'completed',
        50000,
      );
      expect(run.outcome).toBe('success');
      const verifySession = await connectBackend(targetId);
      try {
        const rows = await executeQuery(verifySession, countSql(table));
        expect(queryScalar(rows, 'c')).toBe(2);
      } finally {
        await disconnectBackend(verifySession);
      }
    });
  });
}

liveMigrationJourney('postgresql');
liveMigrationJourney('mysql');
