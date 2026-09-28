import { beforeEach, describe, expect, it, vi } from 'vitest';
import { connectionCommands } from '../../commands/connection';
import { ensureDedicatedSession } from '../dedicatedDbSession';

vi.mock('../../commands/connection', () => ({
  connectionCommands: {
    connectDedicated: vi.fn(),
    releaseConnection: vi.fn(),
    pingConnection: vi.fn(),
  },
}));

describe('ensureDedicatedSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(connectionCommands.connectDedicated).mockResolvedValue('sqlite-session');
  });

  it('uses the connection configuration for a SQLite catalog alias', async () => {
    const session = await ensureDedicatedSession(null, 'sqlite-file', 'main', null);
    expect(connectionCommands.connectDedicated).toHaveBeenCalledWith('sqlite-file', undefined);
    expect(session).toEqual({
      connectionId: 'sqlite-file',
      database: 'main',
      dbSessionId: 'sqlite-session',
    });
  });

  it('pins a SQL database selection to its dedicated connection', async () => {
    await ensureDedicatedSession(null, 'pg', 'app_db');
    expect(connectionCommands.connectDedicated).toHaveBeenCalledWith('pg', 'app_db');
  });
});
