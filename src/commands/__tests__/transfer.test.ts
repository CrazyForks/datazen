import { beforeEach, describe, expect, it, vi } from 'vitest';

const invokeMock = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

describe('transferCommands.inspect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invokeMock.mockResolvedValue([]);
  });

  it('passes source-only SQL-file inspection to the host', async () => {
    const { transferCommands } = await import('../transfer');

    await transferCommands.inspectSqlFile(
      'src-session-uuid',
      'structureAndData',
      'goecoride',
      'public',
      'mysql',
      [
        {
          sourceTable: 'users',
          targetTable: 'users_copy',
          createNew: true,
          enabled: true,
          columnMappings: [{ sourceColumn: 'id', targetColumn: 'user_id', skip: false }],
        },
      ],
    );

    expect(invokeMock).toHaveBeenCalledWith('inspect_sql_file_transfer', {
      sourceDbSessionId: 'src-session-uuid',
      sourceDatabase: 'goecoride',
      sourceSchema: 'public',
      targetDatabaseType: 'mysql',
      mode: 'structureAndData',
      tables: [
        {
          sourceTable: 'users',
          targetTable: 'users_copy',
          createNew: true,
          enabled: true,
          columnMappings: [{ sourceColumn: 'id', targetColumn: 'user_id', skip: false }],
        },
      ],
    });
  });

  it('passes db session ids to inspect_data_transfer IPC', async () => {
    const { transferCommands } = await import('../transfer');

    await transferCommands.inspect(
      'src-session-uuid',
      'tgt-session-uuid',
      'structureAndData',
      'goecoride',
      'datazen_test',
    );

    expect(invokeMock).toHaveBeenCalledWith('inspect_data_transfer', {
      sourceDbSessionId: 'src-session-uuid',
      targetDbSessionId: 'tgt-session-uuid',
      sourceDatabase: 'goecoride',
      targetDatabase: 'datazen_test',
      mode: 'structureAndData',
      tables: null,
    });
  });

  it('persists profiles through dedicated IPC commands', async () => {
    const { transferCommands } = await import('../transfer');
    const profile = {
      version: 1,
      id: 'profile-1',
      name: 'nightly',
      sourceConnectionId: 'src',
      destinationMode: 'sqlFile',
      mode: 'data',
      writeMode: 'insert',
      tables: [],
      options: { batchSize: 500, stopOnError: true, confirmedDestructive: false },
      createdAt: '2026-09-21T00:00:00.000Z',
      updatedAt: '2026-09-21T00:00:00.000Z',
    } as const;
    await transferCommands.getProfiles();
    await transferCommands.saveProfile(profile);
    await transferCommands.deleteProfile('profile-1');
    expect(invokeMock).toHaveBeenNthCalledWith(1, 'get_transfer_profiles');
    expect(invokeMock).toHaveBeenNthCalledWith(2, 'save_transfer_profile', { profile });
    expect(invokeMock).toHaveBeenNthCalledWith(3, 'delete_transfer_profile', {
      profileId: 'profile-1',
    });
  });

  it('executes only an opaque plan with controlled selection and options', async () => {
    const { transferCommands } = await import('../transfer');

    await transferCommands.execute({
      planId: 'opaque-plan-id',
      selection: { sourceTables: ['users'] },
      options: { confirmedDestructive: true },
      jobId: 'cancel-token',
    });

    expect(invokeMock).toHaveBeenCalledWith('execute_data_transfer', {
      request: {
        planId: 'opaque-plan-id',
        selection: { sourceTables: ['users'] },
        options: { confirmedDestructive: true },
        jobId: 'cancel-token',
      },
    });
  });

  it('routes pairing classification through the transfer IPC', async () => {
    const { transferCommands } = await import('../transfer');

    await transferCommands.classifyPair('postgres', 'mysql');

    expect(invokeMock).toHaveBeenCalledWith('classify_transfer_pair', {
      sourceDatabaseType: 'postgres',
      targetDatabaseType: 'mysql',
    });
  });

  it('forwards a complete job to preview and exposes the returned plan', async () => {
    const { transferCommands } = await import('../transfer');
    const job = {
      source: { dbSessionId: 'source-session', database: 'source-db' },
      target: { dbSessionId: 'target-session', database: 'target-db' },
      mode: 'data' as const,
      writeMode: 'insert' as const,
      tables: [],
      options: { batchSize: 10, stopOnError: true },
    };

    await transferCommands.preview(job);

    expect(invokeMock).toHaveBeenCalledWith('preview_data_transfer', { job });
  });

  it('routes cancellation by the opaque job token', async () => {
    const { transferCommands } = await import('../transfer');

    await transferCommands.cancel('cancel-token');

    expect(invokeMock).toHaveBeenCalledWith('cancel_data_transfer', { jobId: 'cancel-token' });
  });

  it('requests an opaque SQL-file destination from the native host dialog', async () => {
    const { transferCommands } = await import('../transfer');

    await transferCommands.pickSqlFile();

    expect(invokeMock).toHaveBeenCalledWith('pick_data_transfer_sql_file');
  });
});
