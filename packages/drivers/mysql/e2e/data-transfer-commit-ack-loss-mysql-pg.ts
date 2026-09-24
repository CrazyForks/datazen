/** MySQL→PG Transfer journey: a real commit applies before its acknowledgement is lost. */
import { expect, browser, $, $$ } from '@wdio/globals';
import {
  advanceTransferWizardToPreview,
  clickTransferNext,
  closeExtraWindows,
  connectBackend,
  disconnectBackend,
  invokeBackend,
  openDataTransferWindow,
  parseQueryRows,
  queryScalar,
  selectDzOptionInWrap,
  withSafeModeOff,
  type QueryResultPayload,
} from '../../../../e2e/helpers.js';
import { t } from '../../../../e2e/i18n.js';

type TransferRunRequest = {
  planId: string;
  selection?: { sourceTables?: string[] };
  options?: { confirmedDestructive?: boolean };
  jobId?: string;
  resumeToken?: string;
};

type TransferExecutionResult = {
  tables: Array<{
    sourceTable: string;
    targetTable: string;
    rowsInserted: number | null;
    outcome?: string | null;
    error?: string | null;
  }>;
  rowsInserted: number;
  resumeToken?: string | null;
};

type CapturedRun = {
  args: { request: TransferRunRequest };
  response?: TransferExecutionResult;
  error?: string;
};

type CapturedRunWire = {
  args: { request: TransferRunRequest };
  response?: TransferExecutionResult;
  error?: string;
};

type CaptureWindow = Window & {
  __dataTransferRunCalls?: CapturedRunWire[];
};

type MigrationRun = {
  id: string;
  operation: string;
  rollbackOutcome: string;
  startedAt: string;
  sourceConnectionId: string | null;
  targetConnectionId: string | null;
};

function pgConfig(id: string, name: string, database: string) {
  return {
    id,
    name,
    databaseType: 'postgresql',
    host: process.env.E2E_PG_HOST || '127.0.0.1',
    port: Number(process.env.E2E_PG_PORT) || 5432,
    username: process.env.E2E_PG_USER || 'postgres',
    password: process.env.E2E_PG_PASSWORD || '',
    database,
    sslMode: 'disable',
  };
}

function mysqlConfig(id: string, name: string, database: string) {
  return {
    id,
    name,
    databaseType: 'mysql',
    host: process.env.E2E_MYSQL_HOST || '127.0.0.1',
    port: Number(process.env.E2E_MYSQL_PORT) || 3306,
    username: process.env.E2E_MYSQL_USER || 'root',
    password: process.env.E2E_MYSQL_PASSWORD || '',
    database,
    sslMode: 'disable',
  };
}

async function installTransferRunCapture() {
  await browser.execute(() => {
    (window as CaptureWindow).__dataTransferRunCalls = [];
  });
}

async function capturedTransferRuns(): Promise<CapturedRun[]> {
  return browser.execute(() => (window as CaptureWindow).__dataTransferRunCalls ?? []) as Promise<
    CapturedRun[]
  >;
}

async function selectOnlyTables(selectedTables: string[]) {
  const rows = await $$('[data-testid="data-transfer-table-row"]');
  for (const row of rows) {
    const rowText = await row.getText();
    const shouldSelect = selectedTables.some((table) => rowText.includes(table));
    const checkbox = await row.$('input[type="checkbox"]');
    if ((await checkbox.isSelected()) !== shouldSelect) await checkbox.click();
  }
  for (const table of selectedTables) {
    await $(`[data-testid="data-transfer-table-row"]*=${table}`).waitForDisplayed({
      timeout: 20_000,
    });
  }
}

describe('Data Transfer MySQL→PG commit acknowledgement loss', function () {
  this.timeout(180_000);
  let mainWindow: string | undefined;
  let sourceAdminConfigSaved = false;
  let targetAdminConfigSaved = false;
  let sourceConfigSaved = false;
  let targetConfigSaved = false;
  // A database is ours only after this run's CREATE DATABASE call returns successfully.
  let sourceDatabaseCreated = false;
  let targetDatabaseCreated = false;
  const stamp = Date.now().toString(36);
  const sourceId = `e2e_dt_ack_mpg_src_${stamp}`;
  const targetId = `e2e_dt_ack_mpg_tgt_${stamp}`;
  const sourceAdminId = `e2e_dt_ack_mpg_src_admin_${stamp}`;
  const targetAdminId = `e2e_dt_ack_mpg_tgt_admin_${stamp}`;
  const sourceDatabase = `dz_dt_ack_mpg_src_${stamp}`;
  const targetDatabase = `dz_dt_ack_mpg_tgt_${stamp}`;
  const sourceName = `DT ack-loss MySQL source ${stamp}`;
  const targetName = `DT ack-loss PG target ${stamp}`;
  const earlierTable = `dt_ack_a_known_${stamp}`;
  const unknownTable = `dt_ack_b_unknown_${stamp}`;
  const laterTable = `dt_ack_c_later_${stamp}`;
  const tables = [earlierTable, unknownTable, laterTable];

  before(async () => {
    mainWindow = await browser.getWindowHandle();
    await invokeBackend('save_connection', {
      config: mysqlConfig(sourceAdminId, `DT admin MySQL ${stamp}`, 'mysql'),
    });
    sourceAdminConfigSaved = true;
    await invokeBackend('save_connection', {
      config: pgConfig(targetAdminId, `DT admin PG ${stamp}`, 'postgres'),
    });
    targetAdminConfigSaved = true;
    let sourceAdminSession: string | undefined;
    let targetAdminSession: string | undefined;
    try {
      sourceAdminSession = await connectBackend(sourceAdminId);
      targetAdminSession = await connectBackend(targetAdminId);
      const sourceCatalog = await invokeBackend<QueryResultPayload>('execute_query', {
        dbSessionId: sourceAdminSession,
        sql: `SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = '${sourceDatabase}'`,
      });
      const targetCatalog = await invokeBackend<QueryResultPayload>('execute_query', {
        dbSessionId: targetAdminSession,
        sql: `SELECT datname FROM pg_database WHERE datname = '${targetDatabase}'`,
      });
      if (parseQueryRows(sourceCatalog).length > 0 || parseQueryRows(targetCatalog).length > 0) {
        throw new Error(
          `Refusing to use pre-existing Transfer fixture database ${sourceDatabase} or ${targetDatabase}`,
        );
      }
      await withSafeModeOff(async () => {
        await invokeBackend('execute_query', {
          dbSessionId: sourceAdminSession,
          sql: `CREATE DATABASE \`${sourceDatabase}\``,
        });
        sourceDatabaseCreated = true;
        await invokeBackend('execute_query', {
          dbSessionId: targetAdminSession,
          sql: `CREATE DATABASE ${targetDatabase}`,
        });
        targetDatabaseCreated = true;
      });
    } finally {
      if (sourceAdminSession) await disconnectBackend(sourceAdminSession);
      if (targetAdminSession) await disconnectBackend(targetAdminSession);
    }

    await invokeBackend('save_connection', {
      config: mysqlConfig(sourceId, sourceName, sourceDatabase),
    });
    sourceConfigSaved = true;
    await invokeBackend('save_connection', {
      config: pgConfig(targetId, targetName, targetDatabase),
    });
    targetConfigSaved = true;
    let sourceSession: string | undefined;
    let targetSession: string | undefined;
    try {
      const sourceSessionId = await connectBackend(sourceId);
      sourceSession = sourceSessionId;
      const targetSessionId = await invokeBackend<string>('connect_dedicated', {
        connectionId: targetId,
        database: targetDatabase,
      });
      targetSession = targetSessionId;
      await withSafeModeOff(async () => {
        for (const table of tables) {
          await invokeBackend('execute_query', {
            dbSessionId: sourceSessionId,
            sql: `CREATE TABLE ${table} (id INT PRIMARY KEY, payload TEXT NOT NULL) ENGINE=InnoDB`,
          });
          await invokeBackend('execute_query', {
            dbSessionId: targetSessionId,
            sql: `CREATE TABLE ${table} (id INT PRIMARY KEY, payload TEXT NOT NULL)`,
          });
        }
        await invokeBackend('execute_query', {
          dbSessionId: sourceSessionId,
          sql: `INSERT INTO ${earlierTable} VALUES (1, 'earlier known commit')`,
        });
        await invokeBackend('execute_query', {
          dbSessionId: sourceSessionId,
          sql: `INSERT INTO ${unknownTable} VALUES (2, 'committed before acknowledgement loss')`,
        });
        await invokeBackend('execute_query', {
          dbSessionId: sourceSessionId,
          sql: `INSERT INTO ${laterTable} VALUES (3, 'must not be copied')`,
        });
        await invokeBackend('execute_query', {
          dbSessionId: targetSessionId,
          sql: `INSERT INTO ${unknownTable} VALUES (2, 'temporary conflict for checkpoint')`,
        });
      });
    } finally {
      if (sourceSession) await disconnectBackend(sourceSession);
      if (targetSession) await disconnectBackend(targetSession);
    }
  });

  after(async () => {
    await invokeBackend('reset_data_transfer_test_commit_ack_loss').catch(() => undefined);
    if (mainWindow) {
      await browser.url('tauri://localhost').catch(() => undefined);
      await browser.pause(400);
      await closeExtraWindows(mainWindow).catch(() => undefined);
    }
    let sourceAdminSession: string | undefined;
    let targetAdminSession: string | undefined;
    const cleanupErrors: string[] = [];
    try {
      if (sourceDatabaseCreated && sourceAdminConfigSaved) {
        try {
          sourceAdminSession = await connectBackend(sourceAdminId);
        } catch (error) {
          cleanupErrors.push(
            `cannot reconnect MySQL admin to clean owned database ${sourceDatabase}: ${String(error)}`,
          );
        }
      }
      if (targetDatabaseCreated && targetAdminConfigSaved) {
        try {
          targetAdminSession = await connectBackend(targetAdminId);
        } catch (error) {
          cleanupErrors.push(
            `cannot reconnect PG admin to clean owned database ${targetDatabase}: ${String(error)}`,
          );
        }
      }
      if (sourceDatabaseCreated && sourceAdminSession) {
        const sourceAdminDbSession = sourceAdminSession;
        try {
          await withSafeModeOff(async () => {
            await invokeBackend('execute_query', {
              dbSessionId: sourceAdminDbSession,
              sql: `DROP DATABASE IF EXISTS \`${sourceDatabase}\``,
            });
          });
          sourceDatabaseCreated = false;
        } catch (error) {
          cleanupErrors.push(
            `failed to drop owned MySQL database ${sourceDatabase}: ${String(error)}`,
          );
        }
      }
      if (targetDatabaseCreated && targetAdminSession) {
        const targetAdminDbSession = targetAdminSession;
        try {
          await withSafeModeOff(async () => {
            await invokeBackend('execute_query', {
              dbSessionId: targetAdminDbSession,
              sql: `DROP DATABASE IF EXISTS ${targetDatabase} WITH (FORCE)`,
            });
          });
          targetDatabaseCreated = false;
        } catch (error) {
          cleanupErrors.push(
            `failed to drop owned PG database ${targetDatabase}: ${String(error)}`,
          );
        }
      }
    } finally {
      if (sourceAdminSession) await disconnectBackend(sourceAdminSession);
      if (targetAdminSession) await disconnectBackend(targetAdminSession);
      if (sourceConfigSaved) {
        await invokeBackend('delete_connection', { id: sourceId }).catch(() => undefined);
      }
      if (targetConfigSaved) {
        await invokeBackend('delete_connection', { id: targetId }).catch(() => undefined);
      }
      if (sourceAdminConfigSaved) {
        await invokeBackend('delete_connection', { id: sourceAdminId }).catch(() => undefined);
      }
      if (targetAdminConfigSaved) {
        await invokeBackend('delete_connection', { id: targetAdminId }).catch(() => undefined);
      }
      if (mainWindow) await closeExtraWindows(mainWindow).catch(() => undefined);
    }
    if (cleanupErrors.length > 0) {
      throw new Error(`Transfer fixture cleanup incomplete: ${cleanupErrors.join('; ')}`);
    }
  });

  it('reports unknown after an applied commit, stops the later table, and consumes the plan/token', async () => {
    await openDataTransferWindow();
    await installTransferRunCapture();
    await selectDzOptionInWrap('data-transfer-source', sourceName);
    await selectDzOptionInWrap('data-transfer-target', targetName);
    await browser.pause(1_000);
    await clickTransferNext();

    await (await $('[data-testid="data-transfer-mode-data"]')).click();
    const stopOnError = await $(`label*=${t('transfer.stopOnError')}`).$('input[type="checkbox"]');
    if (!(await stopOnError.isSelected())) await stopOnError.click();
    expect(await stopOnError.isSelected()).toBe(true);
    await clickTransferNext();

    await selectOnlyTables(tables);
    await clickTransferNext();
    await advanceTransferWizardToPreview();

    const caseStartedAt = Date.now();
    await (await $('[data-testid="data-transfer-execute"]')).click();
    await (await $('[data-testid="data-transfer-result"]')).waitForDisplayed({ timeout: 30_000 });
    const firstResult = (await capturedTransferRuns())[0]?.response;
    expect(firstResult).toBeDefined();
    expect(firstResult?.tables.find((table) => table.sourceTable === earlierTable)?.outcome).toBe(
      'committed',
    );
    expect(firstResult?.tables.find((table) => table.sourceTable === unknownTable)?.outcome).toBe(
      'rolledBack',
    );
    expect(typeof firstResult?.resumeToken).toBe('string');
    expect(firstResult?.resumeToken?.length).toBeGreaterThan(0);

    const targetSession = await invokeBackend<string>('connect_dedicated', {
      connectionId: targetId,
      database: targetDatabase,
    });
    try {
      await invokeBackend('execute_query', {
        dbSessionId: targetSession,
        sql: `DELETE FROM ${unknownTable} WHERE id = 2`,
      });
    } finally {
      await disconnectBackend(targetSession);
    }

    await invokeBackend('arm_data_transfer_test_commit_ack_loss', {
      targetTable: unknownTable,
    });
    await (await $('[data-testid="data-transfer-resume"]')).click();
    await browser.waitUntil(
      async () => {
        const calls = await capturedTransferRuns();
        return (
          calls.length === 2 && (calls[1].response !== undefined || calls[1].error !== undefined)
        );
      },
      {
        timeout: 30_000,
        interval: 200,
        timeoutMsg: 'resumed Data Transfer IPC call did not settle',
      },
    );
    const result = await $('[data-testid="data-transfer-result"]');
    await result.waitForDisplayed({ timeout: 30_000 });

    const calls = await capturedTransferRuns();
    expect(calls).toHaveLength(2);
    const resumedCall = calls[1];
    expect(resumedCall.error).toBeUndefined();
    expect(resumedCall.args.request.resumeToken).toBe(firstResult?.resumeToken);
    const unknownResult = resumedCall.response;
    expect(unknownResult).toBeDefined();
    const unknownTableResult = unknownResult?.tables.find(
      (table) => table.sourceTable === unknownTable,
    );
    const laterTableResult = unknownResult?.tables.find(
      (table) => table.sourceTable === laterTable,
    );
    expect(unknownTableResult?.outcome).toBe('unknown');
    expect(unknownTableResult?.rowsInserted).toBeNull();
    expect(unknownTableResult?.error).toContain('target commit succeeded');
    expect(laterTableResult?.outcome).toBe('notStarted');
    expect(laterTableResult?.rowsInserted).toBe(0);
    expect(unknownResult?.resumeToken).toBeUndefined();
    expect(await $('[data-testid="data-transfer-resume"]').isExisting()).toBe(false);
    expect(await invokeBackend<boolean>('reset_data_transfer_test_commit_ack_loss')).toBe(false);

    const readbackSession = await invokeBackend<string>('connect_dedicated', {
      connectionId: targetId,
      database: targetDatabase,
    });
    try {
      const earlierCount = await invokeBackend<QueryResultPayload>('execute_query', {
        dbSessionId: readbackSession,
        sql: `SELECT COUNT(*) AS c FROM ${earlierTable}`,
      });
      const committedRow = await invokeBackend<QueryResultPayload>('execute_query', {
        dbSessionId: readbackSession,
        sql: `SELECT payload FROM ${unknownTable} WHERE id = 2`,
      });
      const laterCount = await invokeBackend<QueryResultPayload>('execute_query', {
        dbSessionId: readbackSession,
        sql: `SELECT COUNT(*) AS c FROM ${laterTable}`,
      });
      expect(queryScalar(earlierCount, 'c')).toBe(1);
      expect(parseQueryRows(committedRow)[0]?.[0]).toBe('committed before acknowledgement loss');
      expect(queryScalar(laterCount, 'c')).toBe(0);
    } finally {
      await disconnectBackend(readbackSession);
    }

    const originalRequest = calls[0].args.request;
    const originalPlanReplay = { ...originalRequest };
    delete originalPlanReplay.resumeToken;
    let planReplayError = '';
    try {
      await invokeBackend('execute_data_transfer', { request: originalPlanReplay });
    } catch (error) {
      planReplayError = String(error);
    }
    expect(planReplayError).toMatch(/already consumed/i);

    let checkpointReplayError = '';
    try {
      await invokeBackend('execute_data_transfer', { request: resumedCall.args.request });
    } catch (error) {
      checkpointReplayError = String(error);
    }
    expect(checkpointReplayError).toMatch(/consumed|invalid|unknown/i);

    const history = await invokeBackend<{ items: MigrationRun[] }>('list_migration_runs', {
      filter: { operation: 'dataTransfer' },
      offset: 0,
      limit: 100,
    });
    const unknownRuns = history.items.filter(
      (run) =>
        run.operation === 'dataTransfer' &&
        run.rollbackOutcome === 'unknown' &&
        Date.parse(run.startedAt) >= caseStartedAt,
    );
    expect(unknownRuns).toHaveLength(1);
    const historyButton = await $('[data-testid="migration-history-open"]');
    await historyButton.click();
    await (await $(`[data-testid="migration-run-${unknownRuns[0].id}"]`)).click();
    expect(
      await $('[data-testid="migration-history-rollback-outcome"]').getAttribute('data-outcome'),
    ).toBe('unknown');
  });
});
