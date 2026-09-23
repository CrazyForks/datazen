/**
 * Composite-key Data Transfer journey. The equal non-ASCII text components
 * deliberately let the numeric key determine endpoint order without assuming
 * a host-side text collation.
 */
import { expect, browser, $ } from '@wdio/globals';
import { t } from '../../i18n.js';
import {
  clickTransferNext,
  closeExtraWindows,
  connectBackend,
  disconnectBackend,
  invokeBackend,
  openDataTransferWindow,
  parseQueryRows,
  selectDzOptionInWrap,
  withSafeModeOff,
  type QueryResultPayload,
} from '../../helpers.js';

type DriverType = 'postgresql' | 'mysql';

interface Route {
  label: string;
  sourceType: DriverType;
  sourceDatabase: string;
  targetType: DriverType;
  targetDatabase: string;
}

const routes: Route[] = [
  {
    label: 'PostgreSQL to MySQL',
    sourceType: 'postgresql',
    sourceDatabase: 'datazen_sync_src',
    targetType: 'mysql',
    targetDatabase: 'datazen_sync_mysql_tgt',
  },
  {
    label: 'MySQL to PostgreSQL',
    sourceType: 'mysql',
    sourceDatabase: 'datazen_sync_mysql_tgt',
    targetType: 'postgresql',
    targetDatabase: 'datazen_sync_tgt',
  },
];

function connectionConfig(type: DriverType, id: string, name: string, database: string) {
  if (type === 'postgresql') {
    return {
      id,
      name,
      databaseType: type,
      host: process.env.E2E_PG_HOST || '127.0.0.1',
      port: Number(process.env.E2E_PG_PORT) || 5432,
      username: process.env.E2E_PG_USER || 'postgres',
      password: process.env.E2E_PG_PASSWORD || '',
      database,
      sslMode: 'disable',
    };
  }
  return {
    id,
    name,
    databaseType: type,
    host: process.env.E2E_MYSQL_HOST || '127.0.0.1',
    port: Number(process.env.E2E_MYSQL_PORT) || 3306,
    username: process.env.E2E_MYSQL_USER || 'root',
    password: process.env.E2E_MYSQL_PASSWORD || '',
    database,
    sslMode: 'disable',
  };
}

function createTableSql(type: DriverType, table: string): string {
  const tenant =
    type === 'mysql' ? 'VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin' : 'TEXT';
  return `CREATE TABLE ${table} (tenant ${tenant} NOT NULL, seq BIGINT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY (tenant, seq))`;
}

function insertFixtureSql(table: string): string {
  return `INSERT INTO ${table} (tenant, seq, payload) VALUES
    ('a-雪', -3, 'before-start'),
    ('a-雪', -2, 'inside-negative'),
    ('a-雪', 0, 'inside-zero'),
    ('a-雪', 9223372036854775806, 'inside-large'),
    ('a-雪', 9223372036854775807, 'after-end'),
    ('z-外', 0, 'outside-text-prefix')`;
}

describe('Data Transfer composite tuple recordset journeys', () => {
  for (const route of routes) {
    describe(route.label, () => {
      let mainWindow: string;
      let sourceSession: string | undefined;
      let targetSession: string | undefined;
      const stamp = `${Date.now().toString(36)}_${route.sourceType}`;
      const sourceId = `e2e_dt_tuple_src_${stamp}`;
      const targetId = `e2e_dt_tuple_tgt_${stamp}`;
      const sourceName = `DT-Tuple-Source-${stamp}`;
      const targetName = `DT-Tuple-Target-${stamp}`;
      const table = `dt_tuple_${stamp}`;

      before(async () => {
        mainWindow = await browser.getWindowHandle();
        await $('[data-testid="workspace-nav-databases"]').waitForDisplayed({ timeout: 15000 });
        await invokeBackend('save_connection', {
          config: connectionConfig(route.sourceType, sourceId, sourceName, route.sourceDatabase),
        });
        await invokeBackend('save_connection', {
          config: connectionConfig(route.targetType, targetId, targetName, route.targetDatabase),
        });
        sourceSession = await connectBackend(sourceId);
        targetSession = await connectBackend(targetId);
        await withSafeModeOff(async () => {
          await invokeBackend('execute_query', {
            dbSessionId: sourceSession!,
            sql: `DROP TABLE IF EXISTS ${table}`,
          });
          await invokeBackend('execute_query', {
            dbSessionId: targetSession!,
            sql: `DROP TABLE IF EXISTS ${table}`,
          });
          await invokeBackend('execute_query', {
            dbSessionId: sourceSession!,
            sql: createTableSql(route.sourceType, table),
          });
          await invokeBackend('execute_query', {
            dbSessionId: sourceSession!,
            sql: insertFixtureSql(table),
          });
          await invokeBackend('execute_query', {
            dbSessionId: targetSession!,
            sql: createTableSql(route.targetType, table),
          });
        });
      });

      after(async () => {
        try {
          const source = sourceSession ?? (await connectBackend(sourceId));
          const target = targetSession ?? (await connectBackend(targetId));
          await withSafeModeOff(async () => {
            await invokeBackend('execute_query', {
              dbSessionId: source,
              sql: `DROP TABLE IF EXISTS ${table}`,
            });
            await invokeBackend('execute_query', {
              dbSessionId: target,
              sql: `DROP TABLE IF EXISTS ${table}`,
            });
          });
          if (!sourceSession) await disconnectBackend(source);
          if (!targetSession) await disconnectBackend(target);
        } catch {
          /* Best-effort cleanup after a failed database journey. */
        }
        if (sourceSession) await disconnectBackend(sourceSession);
        if (targetSession) await disconnectBackend(targetSession);
        try {
          await invokeBackend('delete_connection', { id: sourceId });
        } catch {
          /* The connection may already have been removed. */
        }
        try {
          await invokeBackend('delete_connection', { id: targetId });
        } catch {
          /* The connection may already have been removed. */
        }
        await closeExtraWindows(mainWindow);
        await browser.switchToWindow(mainWindow);
      });

      it('transfers only the selected inclusive/exclusive composite key range', async () => {
        await openDataTransferWindow();
        await selectDzOptionInWrap('data-transfer-source', sourceName);
        await selectDzOptionInWrap('data-transfer-target', targetName);
        await clickTransferNext();

        const dataMode = await $('[data-testid="data-transfer-mode-data"]');
        await dataMode.waitForClickable({ timeout: 10000 });
        await dataMode.click();
        await clickTransferNext();

        await $('[data-testid="data-transfer-table-row"]').waitForDisplayed({ timeout: 15000 });
        expect(await $('body').getText()).toContain(table);
        await clickTransferNext();

        const enableRecordset = await $('[data-testid="data-transfer-recordset-enable"]');
        await enableRecordset.waitForDisplayed({ timeout: 10000 });
        await enableRecordset.click();
        const tupleEditor = await $('[data-testid="data-transfer-recordset-tuple-editor"]');
        await tupleEditor.waitForDisplayed({ timeout: 5000 });
        await expect(
          await $('[data-testid="data-transfer-recordset-tuple-collation-hint"]'),
        ).toBeDisplayed();

        await $('[data-testid="data-transfer-recordset-tuple-start-0"]').setValue('a-雪');
        await $('[data-testid="data-transfer-recordset-tuple-start-1"]').setValue('-3');
        await $('[data-testid="data-transfer-recordset-tuple-start-inclusive"]').click();
        await $('[data-testid="data-transfer-recordset-tuple-end-0"]').setValue('a-雪');
        await $('[data-testid="data-transfer-recordset-tuple-end-1"]').setValue(
          '9223372036854775806',
        );
        await clickTransferNext({ timeout: 30000, pauseMs: 2500 });

        const preview = await $('[data-testid="data-transfer-preview"]');
        await preview.waitForDisplayed({ timeout: 20000 });
        const previewText = await preview.getText();
        expect(previewText).toContain('a-雪');
        expect(previewText).toContain('9223372036854775806');
        expect(previewText).toMatch(/Estimated rows|预计行数/);
        expect(previewText).toContain('3');

        await $('[data-testid="data-transfer-execute"]').click();
        const result = await $('[data-testid="data-transfer-result"]');
        await result.waitForDisplayed({ timeout: 30000 });
        expect(await result.getText()).not.toContain(t('transfer.error'));

        const target = await connectBackend(targetId);
        try {
          const cast = route.targetType === 'postgresql' ? 'TEXT' : 'CHAR';
          const rows = await invokeBackend<QueryResultPayload>('execute_query', {
            dbSessionId: target,
            sql: `SELECT tenant, CAST(seq AS ${cast}) AS seq FROM ${table} ORDER BY tenant, seq`,
          });
          const actual = parseQueryRows(rows).map((row) => `${String(row[0])}:${String(row[1])}`);
          expect(actual).toEqual(['a-雪:-2', 'a-雪:0', 'a-雪:9223372036854775806']);
        } finally {
          await disconnectBackend(target);
        }
      });
    });
  }
});
