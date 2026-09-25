/** R3 structure-mapping and dependency-ordering acceptance journeys. */
import { $, browser, expect } from '@wdio/globals';
import {
  cleanupR3Suite,
  fixtures,
  sessions,
  pgTables,
  renamedTables,
  prepareTransfer,
  executeIfPreviewExists,
  startR3Suite,
  connectFixture,
  disconnectBackend,
  sql,
  queryScalar,
  assertPgToMysqlObjectsAndRows,
} from './data-transfer-structure-mapping-r3-shared.js';

describe('Data Transfer mapped structure independent live journeys', () => {
  let mainWindow = '';
  before(async () => {
    mainWindow = await startR3Suite();
  });
  after(async () => {
    if (mainWindow) await cleanupR3Suite(mainWindow);
  });

  it('accepts the default target-native suggestion for PostgreSQL identity columns', async () => {
    await prepareTransfer(fixtures[0], fixtures[3], [pgTables.parent, pgTables.child], 'structure');
    const previewError = await $('[data-testid="data-transfer-preview-error"]');
    if (await previewError.isExisting()) {
      throw new Error(`default identity mapping was rejected: ${await previewError.getText()}`);
    }
    const preview = await $('[data-testid="data-transfer-preview"]');
    if (!(await preview.isDisplayed())) throw new Error('structure preview was not displayed');
  });

  it('preserves PG identity, PK, secondary index, FK and data in a new MySQL target', async () => {
    await prepareTransfer(fixtures[0], fixtures[3], [pgTables.parent, pgTables.child], 'both', {
      clearSuggestedTypes: true,
    });
    const outcome = await executeIfPreviewExists();
    if (outcome.rejected) throw new Error(outcome.text);
    expect(outcome.rejected).toBe(false);
    await assertPgToMysqlObjectsAndRows();
  });

  it('maps renamed tables and columns, installs dependencies, and qualifies the configured PostgreSQL schema', async () => {
    await prepareTransfer(fixtures[0], fixtures[1], [pgTables.parent, pgTables.child], 'both', {
      clearSuggestedTypes: true,
      renameTables: {
        [pgTables.parent]: renamedTables.parent,
        [pgTables.child]: renamedTables.child,
      },
      renameColumns: {
        [pgTables.parent]: { id: 'parent_key', code: 'code_value' },
        [pgTables.child]: { id: 'child_key', parent_id: 'parent_ref', label: 'label_text' },
      },
    });
    const outcome = await executeIfPreviewExists();
    if (outcome.rejected) throw new Error(outcome.text);

    const target = await connectFixture(fixtures[1]);
    try {
      const schema = await sql(target, 'SELECT current_schema() AS c');
      expect(queryScalar(schema, 'c')).toBe(fixtures[1].schema);
      const tables = await sql(
        target,
        `SELECT COUNT(*) AS c FROM information_schema.tables
         WHERE table_schema = '${fixtures[1].schema}'
           AND table_name IN ('${renamedTables.parent}', '${renamedTables.child}')`,
      );
      expect(queryScalar(tables, 'c')).toBe(2);
      const parentColumns = await sql(
        target,
        `SELECT COUNT(*) AS c FROM information_schema.columns
         WHERE table_schema = '${fixtures[1].schema}' AND table_name = '${renamedTables.parent}'
           AND column_name IN ('parent_key', 'code_value')`,
      );
      const childColumns = await sql(
        target,
        `SELECT COUNT(*) AS c FROM information_schema.columns
         WHERE table_schema = '${fixtures[1].schema}' AND table_name = '${renamedTables.child}'
           AND column_name IN ('child_key', 'parent_ref', 'label_text')`,
      );
      const index = await sql(
        target,
        `SELECT COUNT(*) AS c FROM pg_indexes
         WHERE schemaname = '${fixtures[1].schema}' AND tablename = '${renamedTables.child}'
           AND indexdef LIKE '%(label_text)%'`,
      );
      const foreignKey = await sql(
        target,
        `SELECT COUNT(*) AS c FROM information_schema.key_column_usage
         WHERE table_schema = '${fixtures[1].schema}' AND table_name = '${renamedTables.child}'
           AND column_name = 'parent_ref' AND referenced_table_name = '${renamedTables.parent}'
           AND referenced_column_name = 'parent_key'`,
      );
      const rows = await sql(target, `SELECT COUNT(*) AS c FROM ${renamedTables.child}`);
      expect(queryScalar(parentColumns, 'c')).toBe(2);
      expect(queryScalar(childColumns, 'c')).toBe(3);
      expect(queryScalar(index, 'c')).toBe(1);
      expect(queryScalar(foreignKey, 'c')).toBe(1);
      expect(queryScalar(rows, 'c')).toBe(2);
    } finally {
      await disconnectBackend(target);
      sessions.delete(target);
    }
  });

  it('rejects an omitted referenced table before creating the mapped child', async () => {
    await prepareTransfer(fixtures[0], fixtures[3], [pgTables.child], 'structure', {
      renameTables: { [pgTables.child]: renamedTables.omittedChild },
    });
    const outcome = await executeIfPreviewExists();
    const target = await connectFixture(fixtures[3]);
    try {
      const targetTables = await sql(
        target,
        `SELECT COUNT(*) AS c FROM information_schema.tables
         WHERE table_schema = DATABASE() AND table_name = '${renamedTables.omittedChild}'`,
      );
      expect(outcome.rejected).toBe(true);
      expect(outcome.text).toMatch(/foreign key.*unselected|unselected.*foreign key/i);
      expect(queryScalar(targetTables, 'c')).toBe(0);
    } finally {
      await disconnectBackend(target);
      sessions.delete(target);
    }
  });
});
