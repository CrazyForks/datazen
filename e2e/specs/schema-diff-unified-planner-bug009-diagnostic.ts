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
    await invokeBackend('execute_query', { dbSessionId: session, sql });
  }
}

describe('BUG-009 live source dependency IPC diagnostic', function () {
  this.timeout(60000);

  it('returns complete exact MySQL table dependencies and omits a self-edge', async () => {
    let source: string | undefined;
    try {
      await Promise.all([
        invokeBackend('save_connection', {
          config: mysqlConnectionConfig(sourceId, `BUG-009 source ${stamp}`, MYSQL_SOURCE_DB),
        }),
        invokeBackend('save_connection', {
          config: mysqlConnectionConfig(targetId, `BUG-009 target ${stamp}`, MYSQL_TARGET_DB),
        }),
      ]);
      source = await invokeBackend<string>('connect', { connectionId: sourceId });
      await withSafeModeOff(async () => {
        await dropFixture(source!);
        await invokeBackend('execute_query', {
          dbSessionId: source,
          sql: `CREATE TABLE ${parent} (id INT PRIMARY KEY) ENGINE=InnoDB`,
        });
        await invokeBackend('execute_query', {
          dbSessionId: source,
          sql: `CREATE TABLE ${child} (
            id INT PRIMARY KEY,
            parent_id INT NOT NULL,
            manager_id INT NULL,
            CONSTRAINT ${foreignKey} FOREIGN KEY (parent_id) REFERENCES ${parent}(id),
            CONSTRAINT ${foreignKey}_self FOREIGN KEY (manager_id) REFERENCES ${child}(id)
          ) ENGINE=InnoDB`,
        });
      });

      const parentResult = await invokeBackend<{
        data: { complete: boolean; dependencies: Array<Record<string, unknown>> };
      }>('execute_driver_command', {
        request: {
          dbSessionId: source,
          command: 'get_object_dependencies',
          input: { kind: 'table', name: parent, schema: MYSQL_SOURCE_DB },
        },
      });
      const childResult = await invokeBackend<{
        data: { complete: boolean; dependencies: Array<Record<string, unknown>> };
      }>('execute_driver_command', {
        request: {
          dbSessionId: source,
          command: 'get_object_dependencies',
          input: { kind: 'table', name: child, schema: MYSQL_SOURCE_DB },
        },
      });

      console.log(
        `[BUG-009] live IPC parent complete=${parentResult.data.complete} dependencies=${JSON.stringify(parentResult.data.dependencies)}; child complete=${childResult.data.complete} dependencies=${JSON.stringify(childResult.data.dependencies)}`,
      );
      expect(parentResult.data.complete).toBe(true);
      expect(parentResult.data.dependencies).toEqual([]);
      expect(childResult.data.complete).toBe(true);
      expect(childResult.data.dependencies).toEqual([
        { kind: 'table', schema: MYSQL_SOURCE_DB, name: parent },
      ]);
    } finally {
      try {
        const cleanupSession =
          source ?? (await invokeBackend<string>('connect', { connectionId: sourceId }));
        try {
          await withSafeModeOff(() => dropFixture(cleanupSession));
        } finally {
          await disconnectBackend(cleanupSession);
        }
      } finally {
        try {
          const remaining = await Promise.all([fixtureCount(sourceId), fixtureCount(targetId)]);
          console.log(
            `[BUG-009] exact fixture cleanup source_remaining=${remaining[0]} target_remaining=${remaining[1]}`,
          );
          expect(remaining).toEqual([0, 0]);
        } finally {
          try {
            await teardownSchemaDiffFixture([sourceId, targetId], [child, parent]);
          } finally {
            const saved = await invokeBackend<Array<{ id: string }>>('get_connections', {});
            expect(saved.map((connection) => connection.id)).not.toEqual(
              expect.arrayContaining([sourceId, targetId]),
            );
          }
        }
      }
    }
  });
});
