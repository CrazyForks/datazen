/**
 * Schema Diff dependency-order E2E for supported table/FK operations.
 */
import { expect, browser, $, $$ } from '@wdio/globals';
import { t } from '../i18n.js';
import {
  captureJourneyStep,
  closeExtraWindows,
  disconnectBackend,
  invokeBackend,
  openSchemaDiffWindow,
  queryScalar,
  selectSchemaDiffEndpoints,
  setSchemaDiffTables,
  clickSchemaDiffCompare,
  clickSchemaDiffGeneratePlan,
  advanceSchemaDiffToReview,
  deploySchemaDiffPlan,
  withSafeModeOff,
  type QueryResultPayload,
} from '../helpers.js';
import {
  MYSQL_SYNC_DB,
  PG_SYNC_DB,
  PG_SYNC_TGT_DB,
  mysqlConnectionConfig,
  pgConnectionConfig,
} from '../lib/schemaDiffFixtures.js';

type Dialect = 'postgresql' | 'mysql';
type Scenario =
  | 'missing-target'
  | 'missing-fk'
  | 'target-only'
  | 'target-only-parent'
  | 'target-only-cross-schema';

type DialectFixture = {
  dialect: Dialect;
  sourceId: string;
  targetId: string;
  sourceName: string;
  targetName: string;
  sourceConfig: ReturnType<typeof pgConnectionConfig> | ReturnType<typeof mysqlConnectionConfig>;
  targetConfig: ReturnType<typeof pgConnectionConfig> | ReturnType<typeof mysqlConnectionConfig>;
  parentTable: string;
  childTable: string;
  childSchema?: string;
  foreignKey: string;
};

async function withFixture<T>(
  dialect: Dialect,
  scenario: Scenario,
  mainWindow: string,
  run: (fixture: DialectFixture) => Promise<T>,
): Promise<T> {
  const fixture = createFixture(dialect, scenario);
  await Promise.all([
    invokeBackend('save_connection', { config: fixture.sourceConfig }),
    invokeBackend('save_connection', { config: fixture.targetConfig }),
  ]);
  try {
    await setupFixture(fixture, scenario);
    return await run(fixture);
  } finally {
    await cleanupOwnFixture(fixture);
    await closeExtraWindows(mainWindow);
    await browser.switchToWindow(mainWindow);
  }
}

async function cleanupOwnFixture(fixture: DialectFixture) {
  const errors: string[] = [];
  for (const connectionId of [fixture.sourceId, fixture.targetId]) {
    let session: string | undefined;
    try {
      session = await invokeBackend<string>('connect', { connectionId });
      await withSafeModeOff(async () => {
        const cleanupTables =
          connectionId === fixture.targetId || !fixture.childSchema
            ? [childTableIdentifier(fixture), fixture.parentTable]
            : [fixture.parentTable];
        for (const table of cleanupTables) {
          await invokeBackend('execute_query', {
            dbSessionId: session,
            sql: `DROP TABLE IF EXISTS ${table}`,
          });
        }
        if (connectionId === fixture.targetId && fixture.childSchema) {
          await invokeBackend('execute_query', {
            dbSessionId: session,
            sql: `DROP SCHEMA IF EXISTS ${fixture.childSchema}`,
          });
        }
      });
    } catch (error) {
      errors.push(`fixture cleanup for ${connectionId} failed: ${String(error)}`);
    } finally {
      if (session) {
        try {
          await disconnectBackend(session);
        } catch (error) {
          errors.push(`disconnect for ${connectionId} failed: ${String(error)}`);
        }
      }
      try {
        await invokeBackend('delete_connection', { id: connectionId });
      } catch (error) {
        errors.push(`connection cleanup for ${connectionId} failed: ${String(error)}`);
      }
    }
  }
  if (errors.length > 0) throw new Error(errors.join('\n'));
}

async function setupFixture(fixture: DialectFixture, scenario: Scenario) {
  const source = await invokeBackend<string>('connect', { connectionId: fixture.sourceId });
  const target = await invokeBackend<string>('connect', { connectionId: fixture.targetId });
  try {
    await withSafeModeOff(async () => {
      if (scenario === 'target-only-cross-schema') {
        await invokeBackend('execute_query', {
          dbSessionId: target,
          sql: `CREATE SCHEMA ${fixture.childSchema}`,
        });
      }
      for (const session of [source, target]) {
        if (session === target || !fixture.childSchema) {
          await invokeBackend('execute_query', {
            dbSessionId: session,
            sql: `DROP TABLE IF EXISTS ${childTableIdentifier(fixture)}`,
          });
        }
        await invokeBackend('execute_query', {
          dbSessionId: session,
          sql: `DROP TABLE IF EXISTS ${fixture.parentTable}`,
        });
      }

      if (scenario === 'missing-target' || scenario === 'missing-fk') {
        await createParentChild(source, fixture, true);
      }
      if (scenario === 'missing-fk') {
        await createParentChild(target, fixture, false);
      }
      if (scenario === 'target-only') {
        await createParentChild(target, fixture, true);
      }
      if (scenario === 'target-only-parent') {
        await createParentChild(target, fixture, true);
      }
      if (scenario === 'target-only-cross-schema') {
        await createParentChild(target, fixture, true);
      }
    });
  } finally {
    await disconnectBackend(source);
    await disconnectBackend(target);
  }
}

async function createParentChild(
  session: string,
  fixture: DialectFixture,
  includeForeignKey: boolean,
) {
  await invokeBackend('execute_query', {
    dbSessionId: session,
    sql: `CREATE TABLE ${fixture.parentTable} (id INT PRIMARY KEY)${engineClause(fixture)}`,
  });
  await invokeBackend('execute_query', {
    dbSessionId: session,
    sql: `CREATE TABLE ${childTableIdentifier(fixture)} (
      id INT PRIMARY KEY,
      parent_id INT NOT NULL${
        includeForeignKey
          ? `,\n      CONSTRAINT ${fixture.foreignKey}\n        FOREIGN KEY (parent_id) REFERENCES ${
              fixture.childSchema ? `public.${fixture.parentTable}` : fixture.parentTable
            }(id)`
          : ''
      }
    )${engineClause(fixture)}`,
  });
}

function childTableIdentifier(fixture: DialectFixture): string {
  return fixture.childSchema ? `${fixture.childSchema}.${fixture.childTable}` : fixture.childTable;
}

function engineClause(fixture: DialectFixture): string {
  return fixture.dialect === 'mysql' ? ' ENGINE=InnoDB' : '';
}

async function openPlan(fixture: DialectFixture) {
  await openSchemaDiffWindow();
  await selectSchemaDiffEndpoints(fixture.sourceName, fixture.targetName);
  await setSchemaDiffTables(`${fixture.childTable}, ${fixture.parentTable}`);
  await clickSchemaDiffCompare();
  await clickSchemaDiffGeneratePlan();

  const requirements = await $('[data-testid="schema-diff-plan-requirements"]');
  expect(await requirements.isExisting()).toBe(false);
}

async function readPlanStatements(): Promise<string[]> {
  const elements = await $$('[data-testid="schema-diff-plan-panel"] li pre');
  const statements: string[] = [];
  for (const element of elements) statements.push(await element.getText());
  return statements;
}

function assertForeignKeyPlanOrder(fixture: DialectFixture, statements: string[]) {
  const parentCreate = statements.findIndex(
    (sql) => /\bCREATE\s+TABLE\b/i.test(sql) && sql.includes(fixture.parentTable),
  );
  const childCreate = statements.findIndex(
    (sql) => /\bCREATE\s+TABLE\b/i.test(sql) && sql.includes(fixture.childTable),
  );
  const foreignKeyStatement = statements.findIndex(
    (sql) =>
      /\bFOREIGN\s+KEY\b/i.test(sql) &&
      sql.includes(fixture.foreignKey) &&
      (sql.includes(fixture.childTable) || /\bALTER\s+TABLE\b/i.test(sql)),
  );

  if (parentCreate < 0) throw new Error(`parent CREATE TABLE missing:\n${statements.join('\n')}`);
  if (childCreate < 0) throw new Error(`child CREATE TABLE missing:\n${statements.join('\n')}`);
  if (foreignKeyStatement < 0) {
    throw new Error(
      `foreign key absent from reviewed SQL (inline or separate FK is acceptable):\n${statements.join('\n')}`,
    );
  }

  const statement = statements[foreignKeyStatement];
  if (/\bCREATE\s+TABLE\b/i.test(statement)) {
    // An inline constraint belongs to the child CREATE and its referenced table
    // must already exist.
    expect(foreignKeyStatement).toBe(childCreate);
    expect(parentCreate).toBeLessThan(childCreate);
  } else {
    // A separately rendered ALTER can run only after both endpoint tables exist.
    expect(/\bALTER\s+TABLE\b/i.test(statement)).toBe(true);
    expect(parentCreate).toBeLessThan(foreignKeyStatement);
    expect(childCreate).toBeLessThan(foreignKeyStatement);
  }
}

async function foreignKeyCount(fixture: DialectFixture): Promise<number> {
  const session = await invokeBackend<string>('connect', { connectionId: fixture.targetId });
  try {
    const sql =
      fixture.dialect === 'postgresql'
        ? `SELECT count(*)::int AS c FROM information_schema.table_constraints
           WHERE constraint_schema = 'public'
             AND table_name = '${fixture.childTable}'
             AND constraint_name = '${fixture.foreignKey}'
             AND constraint_type = 'FOREIGN KEY'`
        : `SELECT count(*) AS c FROM information_schema.table_constraints
           WHERE constraint_schema = DATABASE()
             AND table_name = '${fixture.childTable}'
             AND constraint_name = '${fixture.foreignKey}'
             AND constraint_type = 'FOREIGN KEY'`;
    const result = await invokeBackend<QueryResultPayload>('execute_query', {
      dbSessionId: session,
      sql,
    });
    return queryScalar(result, 'c');
  } finally {
    await disconnectBackend(session);
  }
}

async function tableCount(fixture: DialectFixture): Promise<number> {
  const session = await invokeBackend<string>('connect', { connectionId: fixture.targetId });
  try {
    const sql =
      fixture.dialect === 'postgresql'
        ? `SELECT count(*)::int AS c FROM information_schema.tables
           WHERE table_schema = 'public'
             AND table_name IN ('${fixture.childTable}', '${fixture.parentTable}')`
        : `SELECT count(*) AS c FROM information_schema.tables
           WHERE table_schema = DATABASE()
             AND table_name IN ('${fixture.childTable}', '${fixture.parentTable}')`;
    const result = await invokeBackend<QueryResultPayload>('execute_query', {
      dbSessionId: session,
      sql,
    });
    return queryScalar(result, 'c');
  } finally {
    await disconnectBackend(session);
  }
}

async function deployPlan(fixture: DialectFixture, step: string, destructive = false) {
  await captureJourneyStep(step);
  await advanceSchemaDiffToReview();
  if (destructive) {
    const confirmation = await $('[data-testid="schema-diff-deploy-panel"] input[type="text"]');
    await confirmation.setValue('DEPLOY');
  }
  await deploySchemaDiffPlan();
}

async function assertTargetOnlyDropOrder(fixture: DialectFixture) {
  await allowDestructiveAndRegenerate();

  await browser.waitUntil(
    async () => {
      const statements = await readPlanStatements();
      return (
        statements.some((sql) => sql.includes(fixture.parentTable)) &&
        statements.some((sql) => sql.includes(fixture.childTable))
      );
    },
    { timeout: 30000, timeoutMsg: 'target-only drop plan did not regenerate' },
  );
  const statements = await readPlanStatements();
  const childDrop = statements.findIndex(
    (sql) => /\bDROP\s+TABLE\b/i.test(sql) && sql.includes(fixture.childTable),
  );
  const parentDrop = statements.findIndex(
    (sql) => /\bDROP\s+TABLE\b/i.test(sql) && sql.includes(fixture.parentTable),
  );
  if (childDrop < 0) throw new Error(`child DROP TABLE missing:\n${statements.join('\n')}`);
  if (parentDrop < 0) throw new Error(`parent DROP TABLE missing:\n${statements.join('\n')}`);
  // Dropping the dependent child first removes its FK before the referenced
  // parent is dropped. This order must come from the reviewed plan, not DB
  // cascade behavior.
  expect(childDrop).toBeLessThan(parentDrop);
}

async function allowDestructiveAndRegenerate() {
  const allowDestructive = await $('[data-testid="schema-diff-allow-destructive"]');
  if (!(await allowDestructive.isSelected())) await allowDestructive.click();
  const regenerate = await $(`button*=${t('schemaDiff.regeneratePlan')}`);
  await regenerate.waitForClickable({ timeout: 10000 });
  await regenerate.click();
}

function createFixture(dialect: Dialect, scenario: Scenario): DialectFixture {
  const stamp = Date.now().toString(36);
  const sourceId = `e2e_schema_dag_${dialect}_${scenario}_src_${stamp}`;
  const targetId = `e2e_schema_dag_${dialect}_${scenario}_tgt_${stamp}`;
  const sourceName = `SD-DAG-${dialect}-${scenario}-SRC-${stamp}`;
  const targetName = `SD-DAG-${dialect}-${scenario}-TGT-${stamp}`;
  const database = dialect === 'postgresql' ? PG_SYNC_DB : 'datazen_sync_mysql_src';
  const targetDatabase = dialect === 'postgresql' ? PG_SYNC_TGT_DB : MYSQL_SYNC_DB;
  const parentTable = `sd_dag_${dialect}_${scenario.replaceAll('-', '_')}_a_parent_${stamp}`;
  const childTable = `sd_dag_${dialect}_${scenario.replaceAll('-', '_')}_z_child_${stamp}`;
  const childSchema = scenario === 'target-only-cross-schema' ? `sd_dag_${stamp}` : undefined;
  const foreignKey = `fk_dag_${dialect}_${scenario.replaceAll('-', '_')}_${stamp}`;
  const sourceConfig =
    dialect === 'postgresql'
      ? pgConnectionConfig(sourceId, sourceName, database)
      : mysqlConnectionConfig(sourceId, sourceName, database);
  const targetConfig =
    dialect === 'postgresql'
      ? pgConnectionConfig(targetId, targetName, targetDatabase)
      : mysqlConnectionConfig(targetId, targetName, targetDatabase);
  return {
    dialect,
    sourceId,
    targetId,
    sourceName,
    targetName,
    sourceConfig,
    targetConfig,
    parentTable,
    childTable,
    childSchema,
    foreignKey,
  };
}

describe('Schema Diff supported dependency order (SD-DAG)', function () {
  this.timeout(120000);
  let mainWindow: string;

  before(async () => {
    mainWindow = await browser.getWindowHandle();
    await closeExtraWindows(mainWindow);
    await browser.switchToWindow(mainWindow);
  });

  for (const dialect of ['postgresql', 'mysql'] as const) {
    it(`SD-DAG-${dialect}-001: creates missing tables and deploys their FK in dependency order`, async () => {
      await withFixture(dialect, 'missing-target', mainWindow, async (fixture) => {
        await openPlan(fixture);
        const statements = await readPlanStatements();
        assertForeignKeyPlanOrder(fixture, statements);
        await deployPlan(fixture, `schema-dag-${dialect}-missing-target`);
        expect(await tableCount(fixture)).toBe(2);
        expect(await foreignKeyCount(fixture)).toBe(1);
      });
    });

    it(`SD-DAG-${dialect}-002: adds a missing FK to existing tables and reads it back`, async () => {
      await withFixture(dialect, 'missing-fk', mainWindow, async (fixture) => {
        await openPlan(fixture);
        const statements = await readPlanStatements();
        const foreignKeyStatement = statements.find(
          (sql) => /\bFOREIGN\s+KEY\b/i.test(sql) && sql.includes(fixture.foreignKey),
        );
        if (!foreignKeyStatement) {
          throw new Error(`missing FK operation in reviewed SQL:\n${statements.join('\n')}`);
        }
        await deployPlan(fixture, `schema-dag-${dialect}-missing-fk`);
        expect(await tableCount(fixture)).toBe(2);
        expect(await foreignKeyCount(fixture)).toBe(1);
      });
    });

    it(`SD-DAG-${dialect}-003: drops target-only dependent tables in reverse dependency order`, async () => {
      await withFixture(dialect, 'target-only', mainWindow, async (fixture) => {
        await openPlan(fixture);
        await assertTargetOnlyDropOrder(fixture);
        await deployPlan(fixture, `schema-dag-${dialect}-target-only-drop`, true);
        expect(await tableCount(fixture)).toBe(0);
        expect(await foreignKeyCount(fixture)).toBe(0);
      });
    });

    it(`SD-DAG-${dialect}-004: blocks a parent-only target drop while an FK child remains`, async () => {
      await withFixture(dialect, 'target-only-parent', mainWindow, async (fixture) => {
        await openSchemaDiffWindow();
        await selectSchemaDiffEndpoints(fixture.sourceName, fixture.targetName);
        await setSchemaDiffTables(fixture.parentTable);
        await clickSchemaDiffCompare();
        await clickSchemaDiffGeneratePlan();
        await allowDestructiveAndRegenerate();

        const requirements = await $('[data-testid="schema-diff-plan-requirements"]');
        await requirements.waitForDisplayed({ timeout: 15000 });
        expect(await requirements.getText()).toContain(fixture.childTable);
        const statements = await readPlanStatements();
        expect(
          statements.some(
            (sql) => /\bDROP\s+TABLE\b/i.test(sql) && sql.includes(fixture.parentTable),
          ),
        ).toBe(false);
        // This is a plan-only safety journey. The parent-only plan is never deployed.
      });
    });

    if (dialect === 'postgresql') {
      it('SD-DAG-postgresql-005: blocks a parent-only drop with an inbound child in another schema', async () => {
        await withFixture(dialect, 'target-only-cross-schema', mainWindow, async (fixture) => {
          await openSchemaDiffWindow();
          await selectSchemaDiffEndpoints(fixture.sourceName, fixture.targetName);
          await setSchemaDiffTables(fixture.parentTable);
          await clickSchemaDiffCompare();
          await clickSchemaDiffGeneratePlan();
          await allowDestructiveAndRegenerate();

          const requirements = await $('[data-testid="schema-diff-plan-requirements"]');
          await requirements.waitForDisplayed({ timeout: 15000 });
          expect(await requirements.getText()).toContain(childTableIdentifier(fixture));
          const statements = await readPlanStatements();
          expect(
            statements.some(
              (sql) => /\bDROP\s+TABLE\b/i.test(sql) && sql.includes(fixture.parentTable),
            ),
          ).toBe(false);
          // Cross-schema inbound-dependency proof is plan-only; do not deploy.
        });
      });
    }
  }
});
