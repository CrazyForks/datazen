import { expect } from '@wdio/globals';
import { disconnectBackend, invokeBackend, queryScalar, withSafeModeOff } from '../helpers.js';
import { mysqlConnectionConfig, teardownSchemaDiffFixture } from '../lib/schemaDiffFixtures.js';

const MYSQL_SOURCE_DB = 'datazen_sync_mysql_src';
const MYSQL_TARGET_DB = 'datazen_sync_mysql_tgt';
const stamp = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
const sourceId = `e2e_bug009_mysql_src_${stamp}`;
const targetId = `e2e_bug009_mysql_tgt_${stamp}`;
const parent = `sd_bug009_${stamp}_parent`;
const child = `sd_bug009_${stamp}_child`;
const foreignKey = `fk_bug009_${stamp}`;

async function executeOn(connectionId: string, sql: string) {
  const session = await invokeBackend<string>('connect', { connectionId });
  try {
    return await invokeBackend('execute_query', { dbSessionId: session, sql });
  } finally {
    await disconnectBackend(session);
  }
}

async function fixtureCount(connectionId: string): Promise<number> {
  const result = await executeOn(
    connectionId,
    `SELECT count(*) AS c FROM information_schema.tables
     WHERE table_schema=DATABASE() AND table_name IN ('${parent}','${child}')`,
  );
  return queryScalar(result, 'c');
}

async function dropFixture(session: string) {
  for (const sql of [`DROP TABLE IF EXISTS ${child}`, `DROP TABLE IF EXISTS ${parent}`]) {
    try {
      await invokeBackend('execute_query', { dbSessionId: session, sql });
    } catch {
      // Unique fixture objects may not exist if setup failed early.
    }
  }
}

// R7 diagnostic for the currently registered BUG-009. Do not add this to the
// normal six-journey suite: after the driver fix, replace these observations
// with positive completeness and exact FK-edge assertions.
describe('BUG-009 live source dependency IPC diagnostic', function () {
  this.timeout(60000);

  it('records incomplete dependency snapshots for both MySQL source tables', async () => {
    await Promise.all([
      invokeBackend('save_connection', {
        config: mysqlConnectionConfig(sourceId, `BUG-009 source ${stamp}`, MYSQL_SOURCE_DB),
      }),
      invokeBackend('save_connection', {
        config: mysqlConnectionConfig(targetId, `BUG-009 target ${stamp}`, MYSQL_TARGET_DB),
      }),
    ]);
    const source = await invokeBackend<string>('connect', { connectionId: sourceId });
    try {
      await withSafeModeOff(async () => {
        await dropFixture(source);
        await invokeBackend('execute_query', {
          dbSessionId: source,
          sql: `CREATE TABLE ${parent} (id INT PRIMARY KEY) ENGINE=InnoDB`,
        });
        await invokeBackend('execute_query', {
          dbSessionId: source,
          sql: `CREATE TABLE ${child} (id INT PRIMARY KEY, parent_id INT NOT NULL,
            CONSTRAINT ${foreignKey} FOREIGN KEY (parent_id) REFERENCES ${parent}(id)) ENGINE=InnoDB`,
        });
      });

      for (const name of [parent, child]) {
        const result = await invokeBackend<{
          data: { complete: boolean; dependencies: unknown[] };
        }>('execute_driver_command', {
          request: {
            dbSessionId: source,
            command: 'get_object_dependencies',
            input: { kind: 'table', name, schema: MYSQL_SOURCE_DB },
          },
        });
        console.log(
          `[BUG-009] live IPC kind=table schema=${MYSQL_SOURCE_DB} name=${name} complete=${result.data.complete} dependencies=${JSON.stringify(result.data.dependencies)}`,
        );
        expect(result.data.complete).toBe(false);
        expect(result.data.dependencies).toEqual([]);
      }
    } finally {
      try {
        await withSafeModeOff(() => dropFixture(source));
      } finally {
        await disconnectBackend(source);
        try {
          const remaining = await Promise.all([fixtureCount(sourceId), fixtureCount(targetId)]);
          expect(remaining).toEqual([0, 0]);
          console.log(
            `[BUG-009] exact fixture cleanup source_remaining=${remaining[0]} target_remaining=${remaining[1]}`,
          );
        } finally {
          await teardownSchemaDiffFixture([sourceId, targetId], [child, parent]);
        }
      }
    }
  });
});
