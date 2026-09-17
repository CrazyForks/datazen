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
});
