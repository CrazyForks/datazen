import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { SchemaDiffWindow } from '../SchemaDiffWindow';

const { endpointState, profile, schemaDiffCommands, databaseCommands } = vi.hoisted(() => {
  const state = {
    sourceId: 'initial-source',
    targetId: 'initial-target',
    sourceDatabase: 'initial-db',
    targetDatabase: 'initial-db',
    sourceSchema: '',
    targetSchema: '',
  };
  const savedProfile = {
    version: 1 as const,
    id: 'schema-profile-1',
    name: 'Production schema',
    sourceConnectionId: 'profile-source',
    targetConnectionId: 'profile-target',
    sourceDatabase: 'profile-db',
    targetDatabase: 'profile-db',
    sourceSchema: 'public',
    targetSchema: 'public',
    targetOnlyTables: [],
    tables: ['public.users'],
    allowDestructive: true,
    includeIndexes: false,
    requireRollback: true,
    typeOverrides: [{ table: 'public.users', column: 'name', targetType: 'VARCHAR(64)' }],
    createdAt: '2026-09-21T00:00:00.000Z',
    updatedAt: '2026-09-21T00:00:00.000Z',
  };
  return {
    endpointState: state,
    profile: savedProfile,
    schemaDiffCommands: {
      getProfiles: vi.fn().mockResolvedValue([savedProfile]),
      saveProfile: vi.fn().mockResolvedValue(undefined),
      deleteProfile: vi.fn().mockResolvedValue(undefined),
      compareTableSchemas: vi.fn().mockResolvedValue({
        table: 'public.users',
        missingOnTarget: [],
        extraOnTarget: [],
        changed: [],
        added: [],
        removed: [],
      }),
      preparePlan: vi.fn().mockResolvedValue({
        table: 'public.users',
        tables: ['public.users'],
        sourceDialect: 'postgresql',
        targetDialect: 'postgresql',
        sameDialect: true,
        statements: [],
        warnings: [],
        requirements: [],
        rollbackCompleteness: { complete: true, missing: [] },
        typeSuggestions: [],
      }),
      executeDeploy: vi.fn(),
    },
    databaseCommands: {
      getTables: vi
        .fn()
        .mockResolvedValue([{ name: 'users', schema: 'public', tableType: 'table' }]),
    },
  };
});

vi.mock('../useSchemaDiffEndpoints', () => ({
  useSchemaDiffEndpoints: () => ({
    ...endpointState,
    sourceDatabases: ['initial-db', 'profile-db'],
    targetDatabases: ['initial-db', 'profile-db'],
    sourceSchemas: ['public'],
    targetSchemas: ['public'],
    sourceSession: null,
    targetSession: null,
    sourceConn: {
      id: endpointState.sourceId,
      name: endpointState.sourceId,
      databaseType: 'postgres',
    },
    targetConn: {
      id: endpointState.targetId,
      name: endpointState.targetId,
      databaseType: 'postgres',
    },
    connOptions: [],
    targetOptions: [],
    isCrossDialect: false,
    setSourceId: (value: string) => {
      endpointState.sourceId = value;
    },
    setTargetId: (value: string) => {
      endpointState.targetId = value;
    },
    setSourceDatabase: (value: string) => {
      endpointState.sourceDatabase = value;
    },
    setTargetDatabase: (value: string) => {
      endpointState.targetDatabase = value;
    },
    setSourceSchema: (value: string) => {
      endpointState.sourceSchema = value;
    },
    setTargetSchema: (value: string) => {
      endpointState.targetSchema = value;
    },
    ensureConnected: vi
      .fn()
      .mockImplementation(async (side: 'source' | 'target') =>
        side === 'source' ? 'source-session' : 'target-session',
      ),
    refreshEndpointSessions: vi.fn().mockResolvedValue({ source: null, target: null }),
    validateEndpoints: vi.fn().mockReturnValue(true),
    isSameEndpoint: vi.fn().mockReturnValue(false),
    handleSwap: vi.fn(),
    connections: [],
  }),
}));

vi.mock('../../../commands/database', () => ({ databaseCommands }));
vi.mock('../../../commands/file', () => ({
  fileCommands: {
    saveTextWithDialog: vi.fn(),
    openTextWithDialog: vi.fn(),
  },
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn().mockResolvedValue([]) }));
vi.mock('../../../hooks/useThemeListener', () => ({ useThemeListener: vi.fn() }));
vi.mock('../../../hooks/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key, language: 'en' }),
}));
vi.mock('../../../hooks/useLocaleDomains', () => ({ useLocaleDomains: () => true }));
vi.mock('../../../stores/settingsStore', () => ({
  useSettingsStore: (selector: (state: { loadSettings: () => Promise<void> }) => unknown) =>
    selector({ loadSettings: vi.fn().mockResolvedValue(undefined) }),
}));
vi.mock('../../../hooks/useSettings', () => ({ useSettings: vi.fn() }));
vi.mock('../../../lib/windowManager', () => ({ openDocsWindow: vi.fn() }));
vi.mock('../../../lib/crossWindowBus', () => ({
  listenCrossWindow: vi.fn().mockResolvedValue(() => {}),
}));
vi.mock('../../../lib/schemaDiffLimitationsPrefs', () => ({
  isSchemaDiffLimitationsDismissed: vi.fn().mockReturnValue(true),
  setSchemaDiffLimitationsDismissed: vi.fn(),
}));
vi.mock('../../../commands/schemaDiff', () => ({
  dialectSupportsTransactionalDdl: vi.fn().mockReturnValue(true),
  exportPlanSql: vi.fn().mockReturnValue(''),
  planHasDestructive: vi.fn().mockReturnValue(false),
  schemaDiffCommands,
}));

describe('SchemaDiffWindow profile loading', () => {
  beforeEach(() => {
    endpointState.sourceId = 'initial-source';
    endpointState.targetId = 'initial-target';
    endpointState.sourceDatabase = 'initial-db';
    endpointState.targetDatabase = 'initial-db';
    endpointState.sourceSchema = '';
    endpointState.targetSchema = '';
    profile.targetOnlyTables = [];
    vi.clearAllMocks();
    schemaDiffCommands.getProfiles.mockResolvedValue([profile]);
    schemaDiffCommands.compareTableSchemas.mockResolvedValue({
      table: 'public.users',
      missingOnTarget: [],
      extraOnTarget: [],
      changed: [],
      added: [],
      removed: [],
    });
    schemaDiffCommands.preparePlan.mockResolvedValue({
      table: 'public.users',
      tables: ['public.users'],
      sourceDialect: 'postgresql',
      targetDialect: 'postgresql',
      sameDialect: true,
      statements: [],
      warnings: [],
      requirements: [],
      rollbackCompleteness: { complete: true, missing: [] },
      typeSuggestions: [],
    });
  });

  afterEach(() => cleanup());

  function chooseProfile(profileName: string) {
    fireEvent.click(screen.getByTestId('schema-diff-profile-select'));
    fireEvent.mouseDown(screen.getByRole('option', { name: profileName }));
  }

  it('[tester] reloads a profile through fresh inspection and preserves options and type overrides', async () => {
    render(<SchemaDiffWindow />);

    await waitFor(() => expect(screen.getByTestId('schema-diff-next')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('schema-diff-next'));
    await waitFor(() =>
      expect(screen.getByTestId('schema-diff-objects-panel')).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId('schema-diff-next'));
    await waitFor(() => expect(screen.getByTestId('schema-diff-step-compare')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('schema-diff-next'));
    await waitFor(() => expect(screen.getByTestId('schema-diff-step-plan')).toBeInTheDocument());
    await waitFor(() => expect(schemaDiffCommands.preparePlan).toHaveBeenCalled());

    chooseProfile(profile.name);
    fireEvent.click(screen.getByTestId('schema-diff-profile-load'));

    await waitFor(() =>
      expect(screen.getByTestId('schema-diff-objects-panel')).toBeInTheDocument(),
    );
    expect(databaseCommands.getTables).toHaveBeenCalledWith('source-session', 'profile-db');
    expect(screen.getByTestId('schema-diff-table-row')).toHaveAttribute(
      'data-table-name',
      'public.users',
    );

    fireEvent.click(screen.getByTestId('schema-diff-next'));
    await waitFor(() => expect(screen.getByTestId('schema-diff-step-compare')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('schema-diff-next'));
    await waitFor(() => expect(screen.getByTestId('schema-diff-step-plan')).toBeInTheDocument());
    await waitFor(() => {
      expect(schemaDiffCommands.preparePlan).toHaveBeenLastCalledWith(
        expect.objectContaining({
          tableNames: ['public.users'],
          allowDestructive: true,
          includeIndexes: false,
          typeOverrides: profile.typeOverrides,
        }),
      );
    });
  });

  it('[tester] restores a target-only profile row and forwards separate selectors', async () => {
    profile.targetOnlyTables = ['public.archive'];
    databaseCommands.getTables.mockImplementation(async (sessionId: string) =>
      sessionId === 'source-session'
        ? [{ name: 'users', schema: 'public', tableType: 'table' }]
        : [
            { name: 'users', schema: 'public', tableType: 'table' },
            { name: 'archive', schema: 'public', tableType: 'table' },
          ],
    );
    render(<SchemaDiffWindow />);

    fireEvent.click(screen.getByTestId('schema-diff-next'));
    await waitFor(() =>
      expect(screen.getByTestId('schema-diff-objects-panel')).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId('schema-diff-next'));
    await waitFor(() => expect(screen.getByTestId('schema-diff-step-compare')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('schema-diff-next'));
    await waitFor(() => expect(screen.getByTestId('schema-diff-step-plan')).toBeInTheDocument());

    chooseProfile(profile.name);
    fireEvent.click(screen.getByTestId('schema-diff-profile-load'));
    await waitFor(() =>
      expect(screen.getByTestId('schema-diff-objects-panel')).toBeInTheDocument(),
    );

    const archive = screen
      .getAllByTestId('schema-diff-table-row')
      .find((row) => row.getAttribute('data-table-name') === 'public.archive');
    expect(archive).toBeDefined();
    expect(archive).toHaveAttribute('data-table-origin', 'target-only');
    expect(within(archive!).getByRole('checkbox')).toBeChecked();

    fireEvent.click(screen.getByTestId('schema-diff-next'));
    await waitFor(() => expect(screen.getByTestId('schema-diff-step-compare')).toBeInTheDocument());
    expect(schemaDiffCommands.compareTableSchemas).toHaveBeenCalledWith(
      'source-session',
      'target-session',
      'public.users',
    );
    expect(schemaDiffCommands.compareTableSchemas).not.toHaveBeenCalledWith(
      'source-session',
      'target-session',
      'public.archive',
    );
    fireEvent.click(screen.getByTestId('schema-diff-next'));
    await waitFor(() =>
      expect(schemaDiffCommands.preparePlan).toHaveBeenLastCalledWith(
        expect.objectContaining({
          tableNames: ['public.users'],
          targetOnlyTableNames: ['public.archive'],
        }),
      ),
    );
  });
});
