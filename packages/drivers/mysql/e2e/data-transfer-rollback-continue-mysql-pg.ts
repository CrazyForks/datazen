/** MySQL→PG Data Transfer journey: confirmed rollback continues when stop-on-error is disabled. */
import { expect, browser, $ } from '@wdio/globals';
import {
  advanceTransferWizardToPreview,
  clickTransferNext,
  closeExtraWindows,
  connectBackend,
  disconnectBackend,
  invokeBackend,
  openDataTransferWindow,
  queryScalar,
  selectDzOptionInWrap,
  withSafeModeOff,
  type QueryResultPayload,
} from '../../../../e2e/helpers.js';
import { t } from '../../../../e2e/i18n.js';

const SOURCE_DATABASE = 'dz_mig_0910_transfer_src';
const TARGET_DATABASE = 'dz_mig_0910_transfer_tgt';

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

describe('Data Transfer MySQL→PG confirmed rollback continuation', function () {
  this.timeout(180_000);
  let mainWindow: string;
  const stamp = Date.now().toString(36);
  const sourceId = `e2e_dt_rb_mpg_src_${stamp}`;
  const targetId = `e2e_dt_rb_mpg_tgt_${stamp}`;
  const sourceName = `DT rollback MySQL source ${stamp}`;
  const targetName = `DT rollback PG target ${stamp}`;
  const failedTable = `dt_rollback_a_fail_${stamp}`;
  const continuedTable = `dt_rollback_b_continue_${stamp}`;

  before(async () => {
    mainWindow = await browser.getWindowHandle();
    await invokeBackend('save_connection', {
      config: mysqlConfig(sourceId, sourceName, SOURCE_DATABASE),
    });
    await invokeBackend('save_connection', {
      config: pgConfig(targetId, targetName, TARGET_DATABASE),
    });
    const sourceSession = await connectBackend(sourceId);
    const targetSession = await connectBackend(targetId);
    try {
      await withSafeModeOff(async () => {
        await invokeBackend('execute_query', {
          dbSessionId: sourceSession,
          sql: `CREATE TABLE ${failedTable} (id INT PRIMARY KEY, payload TEXT NOT NULL) ENGINE=InnoDB`,
        });
        await invokeBackend('execute_query', {
          dbSessionId: sourceSession,
          sql: `INSERT INTO ${failedTable} VALUES (1, 'source row collides')`,
        });
        await invokeBackend('execute_query', {
          dbSessionId: targetSession,
          sql: `CREATE TABLE ${failedTable} (id INT PRIMARY KEY, payload TEXT NOT NULL)`,
        });
        await invokeBackend('execute_query', {
          dbSessionId: targetSession,
          sql: `INSERT INTO ${failedTable} VALUES (1, 'preserve this row')`,
        });
        await invokeBackend('execute_query', {
          dbSessionId: sourceSession,
          sql: `CREATE TABLE ${continuedTable} (id INT PRIMARY KEY, payload TEXT NOT NULL) ENGINE=InnoDB`,
        });
        await invokeBackend('execute_query', {
          dbSessionId: sourceSession,
          sql: `INSERT INTO ${continuedTable} VALUES (7, 'copied after rollback')`,
        });
        await invokeBackend('execute_query', {
          dbSessionId: targetSession,
          sql: `CREATE TABLE ${continuedTable} (id INT PRIMARY KEY, payload TEXT NOT NULL)`,
        });
      });
    } finally {
      await disconnectBackend(sourceSession);
      await disconnectBackend(targetSession);
    }
  });

  after(async () => {
    try {
      const sourceSession = await connectBackend(sourceId);
      const targetSession = await connectBackend(targetId);
      try {
        await withSafeModeOff(async () => {
          for (const table of [failedTable, continuedTable]) {
            await invokeBackend('execute_query', {
              dbSessionId: sourceSession,
              sql: `DROP TABLE IF EXISTS ${table}`,
            });
            await invokeBackend('execute_query', {
              dbSessionId: targetSession,
              sql: `DROP TABLE IF EXISTS ${table}`,
            });
          }
        });
      } finally {
        await disconnectBackend(sourceSession);
        await disconnectBackend(targetSession);
      }
    } catch {
      // Best-effort cleanup; fixture names are unique to this run.
    }
    await invokeBackend('delete_connection', { id: sourceId }).catch(() => undefined);
    await invokeBackend('delete_connection', { id: targetId }).catch(() => undefined);
    await closeExtraWindows(mainWindow);
  });

  it('rolls back the conflicting table and copies the later table', async () => {
    await openDataTransferWindow();
    await selectDzOptionInWrap('data-transfer-source', sourceName);
    await selectDzOptionInWrap('data-transfer-target', targetName);
    await browser.pause(1_000);
    await clickTransferNext();

    await (await $('[data-testid="data-transfer-mode-data"]')).click();
    const stopOnError = await $(`label*=${t('transfer.stopOnError')}`).$('input[type="checkbox"]');
    if (await stopOnError.isSelected()) await stopOnError.click();
    expect(await stopOnError.isSelected()).toBe(false);
    await clickTransferNext();

    for (const table of [failedTable, continuedTable]) {
      const row = await $(`[data-testid="data-transfer-table-row"]*=${table}`);
      await row.waitForDisplayed({ timeout: 20_000 });
      const checkbox = await row.$('input[type="checkbox"]');
      if (!(await checkbox.isSelected())) await checkbox.click();
    }
    await clickTransferNext();
    await advanceTransferWizardToPreview();

    const execute = await $('[data-testid="data-transfer-execute"]');
    await execute.waitForClickable({ timeout: 20_000 });
    await execute.click();
    const result = await $('[data-testid="data-transfer-result"]');
    await result.waitForDisplayed({ timeout: 30_000 });
    expect(await result.getText()).toContain(failedTable);
    expect(await result.getText()).toContain(continuedTable);
    expect(
      await (
        await $(`[data-testid="data-transfer-table-result-${failedTable}"]`)
      ).getAttribute('data-outcome'),
    ).toBe('rolledBack');
    expect(
      await (
        await $(`[data-testid="data-transfer-table-result-${continuedTable}"]`)
      ).getAttribute('data-outcome'),
    ).toBe('committed');

    const targetSession = await connectBackend(targetId);
    try {
      const preserved = await invokeBackend<QueryResultPayload>('execute_query', {
        dbSessionId: targetSession,
        sql: `SELECT COUNT(*) AS c FROM ${failedTable}`,
      });
      const copied = await invokeBackend<QueryResultPayload>('execute_query', {
        dbSessionId: targetSession,
        sql: `SELECT COUNT(*) AS c FROM ${continuedTable}`,
      });
      expect(queryScalar(preserved, 'c')).toBe(1);
      expect(queryScalar(copied, 'c')).toBe(1);
    } finally {
      await disconnectBackend(targetSession);
    }
  });
});
