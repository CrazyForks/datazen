import { beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));

import { syncCommands } from '../sync';

describe('Data Sync immutable plan IPC', () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it('keeps replacement SQL and row payloads out of preview and execute IPC', async () => {
    invoke.mockResolvedValueOnce({
      planId: 'opaque-plan',
      selectionRevision: 1,
      tables: [
        {
          sourceTable: 'users',
          targetTable: 'users',
          status: 'MATCHED',
          rows: [
            {
              operation: 'INSERT',
              key: [1],
              sourceRow: [1, 'alice'],
              targetRow: null,
              changedColumns: [],
              selected: true,
            },
          ],
        },
      ],
    });
    await syncCommands.compareDataSync('source-session', 'target-session', ['users']);

    invoke.mockResolvedValueOnce([]);
    await syncCommands.generateDataSyncSql(
      'source-session',
      'target-session',
      [
        {
          sourceTable: 'users',
          targetTable: 'users',
          status: 'MATCHED',
          rows: [
            {
              operation: 'INSERT',
              key: [1],
              sourceRow: [1, 'alice'],
              targetRow: null,
              changedColumns: [],
              selected: true,
            },
          ],
        },
      ],
      { insert: true, update: true, delete: false },
    );
    expect(invoke).toHaveBeenLastCalledWith('generate_data_sync_sql', {
      planId: 'opaque-plan',
      selection: {
        revision: 1,
        rows: [{ sourceTable: 'users', targetTable: 'users', operation: 'INSERT', key: [1] }],
      },
      options: { insert: true, update: true, delete: false },
    });

    invoke.mockResolvedValueOnce({ applied: 1, rolledBack: false });
    await syncCommands.executeDataSync(
      'target-session',
      [
        {
          table: 'users',
          operation: 'INSERT',
          sql: 'DROP TABLE users',
          previewSql: 'DROP TABLE users',
          parameters: [1, 'attacker supplied row'],
          rowKey: [1],
        },
      ],
      'job-1',
      'app',
    );
    expect(invoke).toHaveBeenLastCalledWith('execute_data_sync', {
      request: {
        planId: 'opaque-plan',
        selection: {
          revision: 1,
          rows: [{ sourceTable: 'users', targetTable: 'users', operation: 'INSERT', key: [1] }],
        },
        options: { insert: true, update: true, delete: false },
        jobId: 'job-1',
      },
    });
    expect(JSON.stringify(invoke.mock.calls.at(-1))).not.toContain('DROP TABLE');
    expect(JSON.stringify(invoke.mock.calls.at(-1))).not.toContain('attacker supplied row');
  });

  it('sends only structured per-table filters with the compare request', async () => {
    invoke.mockResolvedValueOnce({ planId: 'filtered-plan', selectionRevision: 1, tables: [] });
    await syncCommands.compareDataSync(
      'source-session',
      'target-session',
      ['users'],
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { insert: true, update: true, delete: false },
      {
        users: {
          filters: [{ column: 'status', operator: 'eq', value: 'active' }],
          logic: 'and',
        },
      },
    );
    expect(invoke).toHaveBeenCalledWith(
      'compare_data_sync',
      expect.objectContaining({
        filters: {
          users: {
            filters: [{ column: 'status', operator: 'eq', value: 'active' }],
            logic: 'and',
          },
        },
      }),
    );
    expect(JSON.stringify(invoke.mock.calls.at(-1))).not.toContain('WHERE');
  });

  it('loads an opaque page and preserves selected keys without row payloads in compare', async () => {
    invoke.mockResolvedValueOnce({
      contractVersion: 1,
      pageSize: 100,
      planId: 'paged-plan',
      selectionRevision: 1,
      tables: [
        {
          sourceTable: 'users',
          targetTable: 'users',
          status: 'MATCHED',
          insertCount: 2,
          updateCount: 1,
          deleteCount: 0,
          unchangedCount: 40,
          rowCount: 43,
          pageSize: 100,
          firstCursor: 'v1.0.signature',
          hasMore: false,
        },
      ],
    });
    const preview = await syncCommands.compareDataSync('source-session', 'target-session', [
      'users',
    ]);
    expect(preview.tables[0].rows).toBeUndefined();

    invoke.mockResolvedValueOnce({
      contractVersion: 1,
      planId: 'paged-plan',
      sourceTable: 'users',
      targetTable: 'users',
      cursor: 'v1.0.signature',
      nextCursor: null,
      hasMore: false,
      pageSize: 100,
      rows: [
        {
          operation: 'INSERT',
          key: [7],
          sourceRow: [7, 'alice'],
          targetRow: null,
          changedColumns: [],
          selected: true,
        },
      ],
    });
    await syncCommands.getDataSyncComparisonPage('v1.0.signature', 'users', 'users');
    expect(invoke).toHaveBeenLastCalledWith('get_data_sync_comparison_page', {
      request: {
        planId: 'paged-plan',
        sourceTable: 'users',
        targetTable: 'users',
        cursor: 'v1.0.signature',
        limit: 100,
      },
    });

    invoke.mockResolvedValueOnce([]);
    await syncCommands.generateDataSyncSql(
      'source-session',
      'target-session',
      [preview.tables[0]],
      { insert: true, update: true, delete: false },
      undefined,
      undefined,
      undefined,
      undefined,
      [{ sourceTable: 'users', targetTable: 'users', operation: 'INSERT', key: [7] }],
    );
    expect(invoke).toHaveBeenLastCalledWith(
      'generate_data_sync_sql',
      expect.objectContaining({
        selection: {
          revision: 1,
          rows: [{ sourceTable: 'users', targetTable: 'users', operation: 'INSERT', key: [7] }],
        },
      }),
    );
  });

  it('sends a table scope and one exclusion without materializing page keys', async () => {
    invoke.mockResolvedValueOnce({
      contractVersion: 1,
      planId: 'scoped-plan',
      selectionRevision: 7,
      pageSize: 100,
      tables: [
        {
          sourceTable: 'users',
          targetTable: 'users',
          status: 'MATCHED',
          insertCount: 5000,
          updateCount: 0,
          deleteCount: 0,
          unchangedCount: 0,
          rowCount: 5000,
          pageSize: 100,
          firstCursor: null,
          hasMore: true,
        },
      ],
    });
    await syncCommands.compareDataSync('source-session', 'target-session', ['users']);

    invoke.mockResolvedValueOnce([]);
    await syncCommands.generateDataSyncSql(
      'source-session',
      'target-session',
      [
        {
          sourceTable: 'users',
          targetTable: 'users',
          status: 'MATCHED',
          rowCount: 5000,
          insertCount: 5000,
        },
      ],
      { insert: true, update: true, delete: false },
      undefined,
      undefined,
      undefined,
      undefined,
      [],
      [
        {
          sourceTable: 'users',
          targetTable: 'users',
          selectionMode: 'all',
          operations: ['INSERT'],
          excludedRows: [{ operation: 'INSERT', key: [42] }],
        },
      ],
    );
    expect(invoke).toHaveBeenLastCalledWith('generate_data_sync_sql', {
      planId: 'scoped-plan',
      selection: {
        revision: 7,
        rows: [],
        scopes: [
          {
            sourceTable: 'users',
            targetTable: 'users',
            selectionMode: 'all',
            operations: ['INSERT'],
            excludedRows: [{ operation: 'INSERT', key: [42] }],
          },
        ],
      },
      options: { insert: true, update: true, delete: false },
    });
    expect(JSON.stringify(invoke.mock.calls.at(-1))).not.toContain('5000');
  });
});
