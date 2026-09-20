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
      tables: [{
        sourceTable: 'users',
        targetTable: 'users',
        status: 'MATCHED',
        rows: [{
          operation: 'INSERT',
          key: [1],
          sourceRow: [1, 'alice'],
          targetRow: null,
          changedColumns: [],
          selected: true,
        }],
      }],
    });
    await syncCommands.compareDataSync('source-session', 'target-session', ['users']);

    invoke.mockResolvedValueOnce([]);
    await syncCommands.generateDataSyncSql(
      'source-session',
      'target-session',
      [{
        sourceTable: 'users',
        targetTable: 'users',
        status: 'MATCHED',
        rows: [{
          operation: 'INSERT',
          key: [1],
          sourceRow: [1, 'alice'],
          targetRow: null,
          changedColumns: [],
          selected: true,
        }],
      }],
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
      [{
        table: 'users',
        operation: 'INSERT',
        sql: 'DROP TABLE users',
        previewSql: 'DROP TABLE users',
        parameters: [1, 'attacker supplied row'],
        rowKey: [1],
      }],
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
    expect(invoke).toHaveBeenCalledWith('compare_data_sync', expect.objectContaining({
      filters: {
        users: {
          filters: [{ column: 'status', operator: 'eq', value: 'active' }],
          logic: 'and',
        },
      },
    }));
    expect(JSON.stringify(invoke.mock.calls.at(-1))).not.toContain('WHERE');
  });
});
