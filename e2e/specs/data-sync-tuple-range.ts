/** Real database regression journeys for composite Data Sync recordset ranges. */
import { expect } from '@wdio/globals';
import { disconnectBackend, sqlBlockedBySafeMode, withSafeModeOff, invokeBackend } from '../helpers.js';

type DatabaseType = 'postgresql' | 'mysql';

interface ComparePreview {
  planId: string;
  selectionRevision: number;
  tables: Array<{
    sourceTable: string;
    targetTable: string;
    status: string;
    insertCount: number;
    sourceFilter?: {
      recordset?: {
        tupleRange?: {
          columns: string[];
          start?: { values: string[]; inclusive?: boolean };
          end?: { values: string[]; inclusive?: boolean };
        };
      };
    };
  }>;
}

function config(databaseType: DatabaseType, id: string, database: string) {
  const prefix = databaseType === 'postgresql' ? 'E2E_PG' : 'E2E_MYSQL';
  return {
    id,
    name: id,
    databaseType,
    host: process.env[`${prefix}_HOST`] || '127.0.0.1',
    port: Number(process.env[`${prefix}_PORT`]) || (databaseType === 'mysql' ? 3306 : 5432),
    database,
    username: process.env[`${prefix}_USER`] || (databaseType === 'mysql' ? 'root' : 'postgres'),
    password: process.env[`${prefix}_PASSWORD`] || '',
    sslMode: 'disable',
  };
}

async function sql(dbSessionId: string, query: string): Promise<void> {
  const execute = () => invokeBackend('execute_query', { dbSessionId, sql: query });
  if (sqlBlockedBySafeMode(query)) {
    await withSafeModeOff(execute);
    return;
  }
  await execute();
}

async function commandError(invoke: () => Promise<unknown>): Promise<string> {
  let message = '';
  try {
    await invoke();
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  expect(message).not.toBe('');
  return message;
}

for (const databaseType of ['postgresql', 'mysql'] as const) {
  describe(`[tester] ${databaseType} composite tuple recordset range`, function () {
    this.timeout(180_000);

    const suffix = `${databaseType}_${Date.now().toString(36)}`;
    const table = `e2e_sync_tuple_${suffix}`;
    const sourceDatabase = databaseType === 'postgresql' ? 'datazen_sync_src' : 'datazen_sync_mysql_src';
    const targetDatabase = databaseType === 'postgresql' ? 'datazen_sync_tgt' : 'datazen_sync_mysql_tgt';
    const sourceId = `e2e_tuple_src_${suffix}`;
    const targetId = `e2e_tuple_tgt_${suffix}`;
    let sourceSessionId = '';
    let targetSessionId = '';

    before(async () => {
      await invokeBackend('save_connection', {
        config: config(databaseType, sourceId, sourceDatabase),
      });
      await invokeBackend('save_connection', {
        config: config(databaseType, targetId, targetDatabase),
      });
      sourceSessionId = await invokeBackend<string>('connect', { connectionId: sourceId });
      targetSessionId = await invokeBackend<string>('connect', { connectionId: targetId });

      const keyType = databaseType === 'postgresql' ? 'INTEGER' : 'INT';
      const valueType = databaseType === 'postgresql' ? 'TEXT' : 'VARCHAR(200)';
      const create = `CREATE TABLE ${table} (
        tenant_id ${keyType} NOT NULL,
        id BIGINT NOT NULL,
        value ${valueType} NOT NULL,
        PRIMARY KEY (tenant_id, id)
      )`;
      await sql(sourceSessionId, `DROP TABLE IF EXISTS ${table}; ${create}`);
      await sql(targetSessionId, `DROP TABLE IF EXISTS ${table}; ${create}`);
      await sql(
        sourceSessionId,
        `INSERT INTO ${table} (tenant_id, id, value) VALUES
          (1, 10, 'outside-start'),
          (1, 20, 'inside-a'),
          (1, 30, 'inside-b'),
          (2, 5, 'inside-end'),
          (2, 10, 'outside-end')`,
      );
    });

    after(async () => {
      for (const session of [sourceSessionId, targetSessionId]) {
        if (!session) continue;
        await sql(session, `DROP TABLE IF EXISTS ${table}`).catch(() => undefined);
        await disconnectBackend(session).catch(() => undefined);
      }
      await invokeBackend('delete_connection', { id: sourceId }).catch(() => undefined);
      await invokeBackend('delete_connection', { id: targetId }).catch(() => undefined);
    });

    it('rejects partial tuple shapes before comparison and applies exact bounded rows', async () => {
      const options = {
        insert: true,
        update: false,
        delete: false,
        matchingStrategy: 'primaryKey',
        batchSize: 100,
        largeValueMode: 'full',
      };
      const invalidMessage = await commandError(() =>
        invokeBackend('compare_data_sync', {
          sourceDbSessionId: sourceSessionId,
          targetDbSessionId: targetSessionId,
          sourceDatabase,
          targetDatabase,
          tables: [table],
          options,
          filters: {
            [table]: {
              filters: [],
              recordset: {
                tupleRange: {
                  columns: ['tenant_id'],
                  start: { values: ['1'] },
                },
              },
            },
          },
        }),
      );
      expect(invalidMessage).toMatch(/tupleRange|primary key|recordset/i);

      const untouched = await invokeBackend<{ results: Array<{ rows: unknown[][] }> }>(
        'execute_query',
        { dbSessionId: targetSessionId, sql: `SELECT count(*) FROM ${table}` },
      );
      expect(untouched.results[0]?.rows).toEqual([[0]]);

      const tupleRange = {
        columns: ['tenant_id', 'id'],
        start: { values: ['1', '10'], inclusive: false },
        end: { values: ['2', '5'], inclusive: true },
      };
      const preview = await invokeBackend<ComparePreview>('compare_data_sync', {
        sourceDbSessionId: sourceSessionId,
        targetDbSessionId: targetSessionId,
        sourceDatabase,
        targetDatabase,
        tables: [table],
        options,
        filters: {
          [table]: { filters: [], recordset: { tupleRange } },
        },
      });
      const result = preview.tables.find((candidate) => candidate.sourceTable === table);
      expect(result?.status).toBe('MATCHED');
      expect(result?.insertCount).toBe(3);
      expect(result?.sourceFilter?.recordset?.tupleRange).toEqual(tupleRange);

      const selection = {
        revision: preview.selectionRevision,
        rows: [],
        scopes: [
          {
            sourceTable: table,
            targetTable: table,
            selectionMode: 'all',
            operations: ['INSERT'],
            excludedRows: [],
          },
        ],
      };
      const execution = await invokeBackend<{ applied: number; rolledBack: boolean }>(
        'execute_data_sync',
        { request: { planId: preview.planId, selection, options, jobId: null } },
      );
      expect(execution).toMatchObject({ applied: 3, rolledBack: false });

      const readback = await invokeBackend<{ results: Array<{ rows: unknown[][] }> }>(
        'execute_query',
        {
          dbSessionId: targetSessionId,
          sql: `SELECT tenant_id, id, value FROM ${table} ORDER BY tenant_id, id`,
        },
      );
      expect(readback.results[0]?.rows).toEqual([
        [1, 20, 'inside-a'],
        [1, 30, 'inside-b'],
        [2, 5, 'inside-end'],
      ]);
    });
  });
}
