import { expect } from '@wdio/globals';
import { invokeBackend } from '../helpers.js';
import type { DataSyncTableResult, DataSyncSqlStatement } from '../../src/commands/sync.js';

/** Isolated relational IPC journey. Credentials never included in assertion messages. */
export function syncWaveOneJourney(databaseType: 'postgresql' | 'mysql') {
  describe(`[tester] ${databaseType} canonical sync projection`, () => {
    it('applies only selected rows across reordered physical columns then compares exact values', async () => {
      const prefix = databaseType === 'mysql' ? 'E2E_MYSQL' : 'E2E_PG';
      const host = process.env[`${prefix}_HOST`] || '127.0.0.1';
      if (!['localhost', '127.0.0.1', '::1'].includes(host)) throw new Error('test requires loopback database');
      const sessions: string[] = [];
      const sourceDatabase = 'dz_mig_0910_sync_src', targetDatabase = 'dz_mig_0910_sync_tgt';
      for (const [side, database] of [['src', sourceDatabase], ['tgt', targetDatabase]]) {
        const id = `tester_sync_${databaseType}_${side}`;
        await invokeBackend('save_connection', { config: { id, name: id, databaseType, host,
          port: Number(process.env[`${prefix}_PORT`]) || (databaseType === 'mysql' ? 3306 : 5432),
          database, username: process.env[`${prefix}_USER`] || (databaseType === 'mysql' ? 'root' : 'postgres'),
          password: process.env[`${prefix}_PASSWORD`] || '', sslMode: 'disable' } });
        sessions.push(await invokeBackend<string>('connect', { connectionId: id }));
      }
      const [sourceDbSessionId, targetDbSessionId] = sessions;
      const settings = await invokeBackend<Record<string, unknown>>('get_settings');
      await invokeBackend('save_settings', { settings: { ...settings, safeMode: false } });
      const sql = (dbSessionId: string, query: string) => invokeBackend<{ data: { results: { rows: unknown[][] }[] } }>('execute_driver_command', {
        request: { dbSessionId, command: 'query', input: { sql: query } },
      });
      for (const session of sessions) await sql(session, 'DROP TABLE IF EXISTS tester_sync_projection');
      await sql(sourceDbSessionId, 'CREATE TABLE tester_sync_projection (id INT PRIMARY KEY, a INT, b INT)');
      await sql(targetDbSessionId, 'CREATE TABLE tester_sync_projection (id INT PRIMARY KEY, b INT, a INT)');
      await sql(sourceDbSessionId, 'INSERT INTO tester_sync_projection (id,a,b) VALUES (1,10,20),(2,30,40),(3,50,60)');
      await sql(targetDbSessionId, 'INSERT INTO tester_sync_projection (id,a,b) VALUES (1,9,20)');
      const args = { sourceDbSessionId, targetDbSessionId, sourceDatabase, targetDatabase,
        tables: ['tester_sync_projection'], options: { insert: true, update: true, delete: false, batchSize: 1 } };
      const compared = await invokeBackend<DataSyncTableResult[]>('compare_data_sync', args);
      const table = compared.find(r => r.sourceTable === 'tester_sync_projection');
      expect(table?.columns).toEqual(['id', 'a', 'b']);
      expect(table?.rows).toHaveLength(3);
      for (const row of table?.rows || []) if (row.key[0] === 3) row.selected = false;
      const statements = await invokeBackend<DataSyncSqlStatement[]>('generate_data_sync_sql', { ...args, tables: compared });
      expect(statements).toHaveLength(2);
      await expect(invokeBackend('apply_data_sync', args)).rejects.toThrow(/legacy apply/);
      const beforeWrite = await sql(targetDbSessionId, 'SELECT id,a,b FROM tester_sync_projection ORDER BY id');
      expect(beforeWrite.data.results[0].rows).toEqual([[1,9,20]]);
      await invokeBackend('execute_data_sync', { targetDbSessionId, targetDatabase, statements });
      const result = await sql(targetDbSessionId, 'SELECT id,a,b FROM tester_sync_projection ORDER BY id');
      expect(result.data.results[0].rows).toEqual([[1,10,20],[2,30,40]]);
      const after = await invokeBackend<DataSyncTableResult[]>('compare_data_sync', args);
      expect(after[0].unchangedCount).toBe(2);
      expect(after[0].rows?.map(r => r.key)).toEqual([[3]]);
      for (const session of sessions) await sql(session, 'DROP TABLE tester_sync_projection');
      await invokeBackend('save_settings', { settings });
    });
  });
}
