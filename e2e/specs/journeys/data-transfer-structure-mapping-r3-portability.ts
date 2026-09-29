/** R3 type-portability and safe preflight acceptance journeys. */
import { $, browser, expect } from '@wdio/globals';
import {
  cleanupR3Suite,
  fixtures,
  sessions,
  pgCollationTable,
  pgTextIndexTable,
  pgLossyTypesTable,
  pgArrayTable,
  pgEnumTable,
  mysqlTables,
  sharedTables,
  prepareTransfer,
  executeIfPreviewExists,
  startR3Suite,
  connectFixture,
  disconnectBackend,
  sql,
  queryScalar,
  parseQueryRows,
  inspectStructurePreview,
  createPostgresTargetStructureForMysqlFixture,
  assertMysqlToPgObjectsRowsAndSequence,
} from './data-transfer-structure-mapping-r3-shared.js';

describe('Data Transfer type portability independent live journeys', () => {
  let mainWindow = '';
  before(async () => {
    mainWindow = await startR3Suite();
  });
  after(async () => {
    if (mainWindow) await cleanupR3Suite(mainWindow);
  });

  it('warns or blocks before DDL when PostgreSQL types narrow on MySQL', async () => {
    const failures: string[] = [];
    for (const table of [pgLossyTypesTable, pgEnumTable]) {
      const preview = await inspectStructurePreview(fixtures[0], fixtures[3], table);
      if (!preview.blocked) {
        failures.push(
          `${table}: preview accepted without a type-fidelity warning; ${preview.text}`,
        );
      }
    }
    const target = await connectFixture(fixtures[3]);
    try {
      const writes = await sql(
        target,
        `SELECT COUNT(*) AS c FROM information_schema.tables
         WHERE table_schema = DATABASE() AND table_name IN ('${pgLossyTypesTable}', '${pgEnumTable}')`,
      );
      expect(queryScalar(writes, 'c')).toBe(0);
    } finally {
      await disconnectBackend(target);
      sessions.delete(target);
    }
    expect(failures).toEqual([]);
  });

  it('rejects undecoded PostgreSQL arrays before writing an existing MySQL table', async () => {
    await prepareTransfer(fixtures[0], fixtures[3], [pgArrayTable], 'data', {
      createNew: false,
    });
    const outcome = await executeIfPreviewExists();
    const target = await connectFixture(fixtures[3]);
    try {
      const rowCount = await sql(target, `SELECT COUNT(*) AS c FROM ${pgArrayTable}`);
      expect(outcome.rejected).toBe(true);
      expect(outcome.text).toMatch(/array.*not supported|does not yet decode arrays/i);
      expect(queryScalar(rowCount, 'c')).toBe(0);
    } finally {
      await disconnectBackend(target);
      sessions.delete(target);
    }
  });

  it('preflights a PostgreSQL TEXT secondary index before any MySQL write', async () => {
    await prepareTransfer(fixtures[0], fixtures[3], [pgTextIndexTable], 'both', {
      clearSuggestedTypes: true,
    });
    const previewError = await $('[data-testid="data-transfer-preview-error"]');
    const preflightRejected = await previewError.isExisting();
    let outcome = { rejected: true, text: '' };
    if (preflightRejected) {
      outcome.text = await previewError.getText();
    } else {
      outcome = await executeIfPreviewExists();
    }

    const target = await connectFixture(fixtures[3]);
    try {
      const targetTables = await sql(
        target,
        `SELECT COUNT(*) AS c FROM information_schema.tables
         WHERE table_schema = DATABASE() AND table_name = '${pgTextIndexTable}'`,
      );
      const targetRows =
        queryScalar(targetTables, 'c') === 0
          ? 0
          : queryScalar(await sql(target, `SELECT COUNT(*) AS c FROM ${pgTextIndexTable}`), 'c');
      const targetTableCount = queryScalar(targetTables, 'c');
      const actionableIndexError = /index.*(text|prefix|key length)|text.*index|key length/i.test(
        outcome.text,
      );
      if (
        !preflightRejected ||
        !actionableIndexError ||
        targetTableCount !== 0 ||
        targetRows !== 0
      ) {
        throw new Error(
          `expected pre-write TEXT-index rejection; previewRejected=${preflightRejected}; ` +
            `actionableIndexError=${actionableIndexError}; targetTables=${targetTableCount}; ` +
            `targetRows=${targetRows}; outcome=${outcome.text}`,
        );
      }
    } finally {
      await disconnectBackend(target);
      sessions.delete(target);
    }
  });

  it('rejects shared custom PG sequences before writing any MySQL DDL', async () => {
    await prepareTransfer(
      fixtures[0],
      fixtures[3],
      [sharedTables.first, sharedTables.second],
      'structure',
      { clearSuggestedTypes: true },
    );
    const outcome = await executeIfPreviewExists();
    const target = await connectFixture(fixtures[3]);
    try {
      const targetTables = await sql(
        target,
        `SELECT COUNT(*) AS c FROM information_schema.tables
         WHERE table_schema = DATABASE() AND table_name IN ('${sharedTables.first}', '${sharedTables.second}')`,
      );
      const targetAutoIncrementColumns = await sql(
        target,
        `SELECT COUNT(*) AS c FROM information_schema.columns
         WHERE table_schema = DATABASE() AND table_name IN ('${sharedTables.first}', '${sharedTables.second}')
         AND extra LIKE '%auto_increment%'`,
      );
      const targetTableCount = queryScalar(targetTables, 'c');
      const autoIncrementCount = queryScalar(targetAutoIncrementColumns, 'c');
      const sequenceSpecific = /sequence|increment|ownership|nextval/i.test(outcome.text);
      const actionable = /unsupported|cannot|preserv|represent|reject/i.test(outcome.text);
      if (
        !outcome.rejected ||
        !sequenceSpecific ||
        !actionable ||
        targetTableCount !== 0 ||
        autoIncrementCount !== 0
      ) {
        throw new Error(
          `expected sequence-specific pre-write rejection; rejected=${outcome.rejected}; ` +
            `sequenceSpecific=${sequenceSpecific}; actionable=${actionable}; ` +
            `targetTables=${targetTableCount}; targetAutoIncrementColumns=${autoIncrementCount}; ` +
            `outcome=${outcome.text}`,
        );
      }
    } finally {
      await disconnectBackend(target);
      sessions.delete(target);
    }
  });

  it('rejects default MySQL utf8mb4 table options before PostgreSQL DDL', async () => {
    await prepareTransfer(
      fixtures[2],
      fixtures[1],
      [mysqlTables.parent, mysqlTables.child],
      'both',
      { clearSuggestedTypes: true },
    );
    const previewError = await $('[data-testid="data-transfer-preview-error"]');
    if (!(await previewError.isExisting())) {
      throw new Error('expected MySQL table-collation incompatibility to fail during preview');
    }
    const previewErrorText = await previewError.getText();
    const source = await connectFixture(fixtures[2]);
    let sourceCollation: string;
    try {
      const collationRows = parseQueryRows(
        await sql(
          source,
          `SELECT TABLE_COLLATION AS c FROM information_schema.tables
           WHERE table_schema = DATABASE() AND table_name = '${mysqlTables.parent}'`,
        ),
      );
      sourceCollation = String(collationRows[0]?.[0] ?? '');
      if (!sourceCollation) throw new Error('source table collation was not returned');
    } finally {
      await disconnectBackend(source);
      sessions.delete(source);
    }
    expect(previewErrorText).toContain(
      `source table collation '${sourceCollation}' has no proven equivalent on this target; ` +
        'choose a target collation with reviewed matching semantics or create the target table ' +
        'with an explicit reviewed conversion. The source UTF8MB4 character encoding can map ' +
        'to PostgreSQL UTF8, but that does not prove equivalent sort, case, or accent rules.',
    );
    const target = await connectFixture(fixtures[1]);
    try {
      const targetTables = await sql(
        target,
        `SELECT COUNT(*) AS c FROM information_schema.tables
         WHERE table_schema = current_schema() AND table_name IN ('${mysqlTables.parent}', '${mysqlTables.child}')`,
      );
      expect(queryScalar(targetTables, 'c')).toBe(0);
    } finally {
      await disconnectBackend(target);
      sessions.delete(target);
    }
  });

  it('fails closed on unproven PostgreSQL text collation before creating a MySQL target', async () => {
    await prepareTransfer(fixtures[0], fixtures[3], [pgCollationTable], 'structure');
    const previewError = await $('[data-testid="data-transfer-preview-error"]');
    if (!(await previewError.isExisting())) {
      throw new Error('expected PostgreSQL text collation incompatibility to fail during preview');
    }
    const previewErrorText = await previewError.getText();
    expect(previewErrorText).toMatch(/requires collation preservation/i);

    const target = await connectFixture(fixtures[3]);
    try {
      const targetTables = await sql(
        target,
        `SELECT COUNT(*) AS c FROM information_schema.tables
         WHERE table_schema = DATABASE() AND table_name = '${pgCollationTable}'`,
      );
      expect(queryScalar(targetTables, 'c')).toBe(0);
    } finally {
      await disconnectBackend(target);
      sessions.delete(target);
    }
  });

  it('advances PostgreSQL identity sequences after explicit MySQL ids are imported', async () => {
    await createPostgresTargetStructureForMysqlFixture();
    await prepareTransfer(
      fixtures[2],
      fixtures[1],
      [mysqlTables.parent, mysqlTables.child],
      'data',
      { createNew: false },
    );
    const outcome = await executeIfPreviewExists();
    if (outcome.rejected) {
      const target = await connectFixture(fixtures[1]);
      try {
        const parentRows = await sql(target, `SELECT COUNT(*) AS c FROM ${mysqlTables.parent}`);
        const childRows = await sql(target, `SELECT COUNT(*) AS c FROM ${mysqlTables.child}`);
        throw new Error(
          `data-only transfer was rejected before import; parentRows=${queryScalar(parentRows, 'c')}; ` +
            `childRows=${queryScalar(childRows, 'c')}; outcome=${outcome.text}`,
        );
      } finally {
        await disconnectBackend(target);
        sessions.delete(target);
      }
    }
    await assertMysqlToPgObjectsRowsAndSequence();
  });
});
