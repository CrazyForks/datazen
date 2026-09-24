import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectionConfig } from '../../../types';
import type {
  TransferExecutionResult,
  TransferProfile,
  TransferTableResult,
} from '../../../commands/transfer';
import { transferCommands } from '../../../commands/transfer';
import { clearTransferLimitationsDismissed } from '../../../lib/transferLimitationsPrefs';

const {
  invokeMock,
  inspectTransferMock,
  inspectSqlFileTransferMock,
  previewTransferMock,
  getDatabasesMock,
  stableT,
  urlParamMock,
  crossWindowHandlers,
} = vi.hoisted(() => {
  const stableT = (key: string, params?: Record<string, string | number>) =>
    params ? `${key}:${JSON.stringify(params)}` : key;
  return {
    invokeMock: vi.fn(),
    inspectTransferMock: vi.fn(),
    inspectSqlFileTransferMock: vi.fn(),
    previewTransferMock: vi.fn(),
    getDatabasesMock: vi.fn(),
    stableT,
    urlParamMock: vi.fn<(name: string) => string | null>(),
    crossWindowHandlers: new Map<string, (payload?: unknown) => void>(),
  };
});

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));

vi.mock('../../../hooks/useSettings', () => ({
  useSettings: () => undefined,
}));

vi.mock('../../../stores/settingsStore', () => ({
  useSettingsStore: (sel: (s: { loadSettings: () => void }) => unknown) =>
    sel({ loadSettings: vi.fn() }),
}));

vi.mock('../../../hooks/useI18n', () => ({
  useI18n: () => ({ t: stableT }),
}));

vi.mock('../../../hooks/useLocaleDomains', () => ({
  useLocaleDomains: () => true,
}));

vi.mock('../../../lib/windowKind', () => ({
  getUrlParam: (name: string) => urlParamMock(name),
}));

vi.mock('../../../lib/crossWindowBus', () => ({
  listenCrossWindow: vi.fn(async (event: string, handler: (payload?: unknown) => void) => {
    crossWindowHandlers.set(event, handler);
    return () => crossWindowHandlers.delete(event);
  }),
}));

vi.mock('../../../commands/database', () => ({
  databaseCommands: {
    getDatabases: (...args: unknown[]) => getDatabasesMock(...args),
  },
}));

vi.mock('../../../commands/transfer', () => ({
  DEFAULT_TRANSFER_OPTIONS: { batchSize: 500, stopOnError: true, confirmedDestructive: false },
  transferCommands: {
    getProfiles: vi.fn().mockResolvedValue([]),
    saveProfile: vi.fn().mockResolvedValue(undefined),
    deleteProfile: vi.fn().mockResolvedValue(undefined),
    pickSqlFile: vi.fn().mockResolvedValue({ fileToken: 'sql-file-token' }),
    inspect: (...args: unknown[]) => inspectTransferMock(...args),
    inspectSqlFile: (...args: unknown[]) => inspectSqlFileTransferMock(...args),
    preview: (...args: unknown[]) => previewTransferMock(...args),
    execute: vi.fn().mockResolvedValue({ rowsInserted: 3, tables: [] }),
    cancel: vi.fn(),
    classifyPair: vi.fn(),
  },
}));

vi.mock('../../../components/TitleBar', () => ({
  TitleBar: ({ title }: { title?: unknown }) => <div>{String(title ?? '')}</div>,
}));

vi.mock('../../../components/StatusBar', () => ({
  StatusBar: () => <div data-testid="status-bar" />,
}));

vi.mock('../../../components/SqlCodeBlock', () => ({
  SqlCodeBlock: ({ code, onChange }: { code: string; onChange?: (value: string) => void }) => (
    <>
      <pre data-testid="sql-code-block">{code}</pre>
      <button data-testid="sql-code-change" onClick={() => onChange?.('CREATE TABLE edited')}>
        edit
      </button>
    </>
  ),
}));

const pgSrc: ConnectionConfig = {
  id: 'pg-src',
  name: 'PG Src',
  databaseType: 'postgresql',
  host: '127.0.0.1',
  port: 5432,
  database: 'src',
  username: 'postgres',
  password: '',
  sslMode: 'disable',
};

const pgTgt: ConnectionConfig = {
  id: 'pg-tgt',
  name: 'PG Tgt',
  databaseType: 'postgresql',
  host: '127.0.0.1',
  port: 5432,
  database: 'tgt',
  username: 'postgres',
  password: '',
  sslMode: 'disable',
};

const redisTgt: ConnectionConfig = {
  ...pgTgt,
  id: 'redis-tgt',
  name: 'Redis Tgt',
  databaseType: 'redis',
  database: '0',
  port: 6379,
};

const inspectRows: TransferTableResult[] = [
  {
    sourceTable: 'users',
    targetTable: 'users',
    status: 'MATCHED',
    createNew: false,
    enabled: true,
    sourceColumns: ['id', 'name', 'extra'],
    sourcePrimaryKeys: ['id'],
    sourceColumnTypes: { id: 'INTEGER', name: 'TEXT', extra: 'TEXT' },
    targetColumns: ['id', 'name', 'email'],
    columnMappings: [
      { sourceColumn: 'id', targetColumn: 'id', skip: false },
      { sourceColumn: 'name', targetColumn: 'name', skip: false },
      { sourceColumn: 'extra', targetColumn: '', skip: true },
    ],
  },
];

const sqlInspectRows: TransferTableResult[] = inspectRows.map((row) => ({
  ...row,
  status: 'CREATE_NEW',
  createNew: true,
  targetColumns: [],
}));

const previewSuccess = {
  planId: 'plan-test-1',
  canExecute: true,
  ddl: [],
  writePlans: [
    {
      sourceTable: 'users',
      targetTable: 'users',
      writeMode: 'truncateInsert',
      mappedColumns: [],
      preamble: [],
      estimatedRows: 3,
    },
  ],
  warnings: [],
  pairingPath: 'direct',
  mode: 'data',
  writeMode: 'truncateInsert',
};

async function advanceToObjectsStep(emptyTables = false) {
  const { DataTransferWindow } = await import('../DataTransferWindow');
  render(<DataTransferWindow />);

  await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('get_connections'));
  await dismissLimitationsDialog();

  await pickSelect('data-transfer-source', 'PG Src (postgresql)');
  await pickSelect('data-transfer-target', 'PG Tgt (postgresql)');
  await waitFor(() => expect(getDatabasesMock).toHaveBeenCalled());

  fireEvent.click(screen.getByTestId('data-transfer-next'));
  await waitFor(() => expect(screen.getByTestId('data-transfer-mode-data')).toBeTruthy());
  fireEvent.click(screen.getByTestId('data-transfer-mode-data'));

  inspectTransferMock.mockResolvedValue(emptyTables ? [] : inspectRows);
  fireEvent.click(screen.getByTestId('data-transfer-next'));
  await waitFor(() => expect(inspectTransferMock).toHaveBeenCalled());

  if (emptyTables) {
    await waitFor(() => expect(screen.getByTestId('data-transfer-objects-empty')).toBeTruthy());
  } else {
    await waitFor(() => expect(screen.getByTestId('data-transfer-table-row')).toBeTruthy());
  }
}

async function advanceToSetupStep() {
  const { DataTransferWindow } = await import('../DataTransferWindow');
  render(<DataTransferWindow />);
  await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('get_connections'));
  await dismissLimitationsDialog();
  await pickSelect('data-transfer-source', 'PG Src (postgresql)');
  await pickSelect('data-transfer-target', 'PG Tgt (postgresql)');
  await waitFor(() => expect(getDatabasesMock).toHaveBeenCalled());
  fireEvent.click(screen.getByTestId('data-transfer-next'));
  await waitFor(() => expect(screen.getByTestId('data-transfer-mode-data')).toBeTruthy());
}

async function pickSelect(testId: string, optionLabel: string) {
  const wrap = screen.getByTestId(testId);
  const trigger = wrap.matches('button') ? wrap : within(wrap).getAllByRole('button')[0];
  fireEvent.click(trigger);
  const list = await waitFor(() => {
    return screen.getByRole('listbox');
  });
  const option = Array.from(list.children).find((el) =>
    (el.textContent || '').includes(optionLabel),
  );
  expect(option, `option ${optionLabel}`).toBeTruthy();
  fireEvent.mouseDown(option!);
}

async function advanceToSqlFilePreview(
  mode: 'data' | 'structure' = 'data',
  stopAt: 'objects' | 'mapping' | 'preview' = 'preview',
  inspectedRows: TransferTableResult[] = sqlInspectRows,
) {
  const { DataTransferWindow } = await import('../DataTransferWindow');
  render(<DataTransferWindow />);
  await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('get_connections'));
  await dismissLimitationsDialog();

  fireEvent.click(screen.getByTestId('data-transfer-destination-sql-file'));
  await waitFor(() =>
    expect(screen.getByTestId('data-transfer-destination-sql-file')).toHaveTextContent(
      'transfer.destination.sqlFileSelected',
    ),
  );
  await pickSelect('data-transfer-source', 'PG Src (postgresql)');
  await waitFor(() => expect(getDatabasesMock).toHaveBeenCalled());
  await pickSelect('data-transfer-source-database', 'src');

  fireEvent.click(screen.getByTestId('data-transfer-next'));
  await waitFor(() => expect(screen.getByTestId('data-transfer-mode-data')).toBeTruthy());
  if (mode === 'structure') {
    fireEvent.click(screen.getByTestId('data-transfer-mode-structure'));
  }
  inspectSqlFileTransferMock.mockResolvedValue(inspectedRows);
  fireEvent.click(screen.getByTestId('data-transfer-next'));
  await waitFor(() => expect(inspectSqlFileTransferMock).toHaveBeenCalled());
  await waitFor(() =>
    expect(screen.getAllByTestId('data-transfer-table-row').length).toBeGreaterThan(0),
  );
  await waitFor(() => expect(screen.getByTestId('data-transfer-next')).not.toBeDisabled());
  if (stopAt === 'objects') return;
  fireEvent.click(screen.getByTestId('data-transfer-next'));
  await waitFor(() => expect(screen.getByTestId('data-transfer-mapping-step')).toBeTruthy());
  if (stopAt === 'mapping') return;
  fireEvent.click(screen.getByTestId('data-transfer-next'));
  await waitFor(() => expect(screen.getByTestId('data-transfer-preview')).toBeTruthy());
}

async function dismissLimitationsDialog() {
  await waitFor(() => {
    expect(screen.getByTestId('data-transfer-limitations')).toBeTruthy();
  });
  fireEvent.click(screen.getByTestId('data-transfer-limitations-close'));
  await waitFor(() => {
    expect(screen.queryByTestId('data-transfer-limitations')).toBeNull();
  });
}

async function advanceToMappingStep(inspectedRows = inspectRows) {
  const { DataTransferWindow } = await import('../DataTransferWindow');
  render(<DataTransferWindow />);

  await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('get_connections'));

  await dismissLimitationsDialog();

  await pickSelect('data-transfer-source', 'PG Src (postgresql)');
  await pickSelect('data-transfer-target', 'PG Tgt (postgresql)');

  await waitFor(() => expect(getDatabasesMock).toHaveBeenCalled());

  // endpoints → setup
  fireEvent.click(screen.getByTestId('data-transfer-next'));
  await waitFor(() => expect(screen.getByTestId('data-transfer-mode-data')).toBeTruthy());

  fireEvent.click(screen.getByTestId('data-transfer-mode-data'));

  inspectTransferMock.mockResolvedValue(inspectedRows);
  // setup → objects
  fireEvent.click(screen.getByTestId('data-transfer-next'));

  await waitFor(() => expect(inspectTransferMock).toHaveBeenCalled());
  await waitFor(() => expect(screen.getByTestId('data-transfer-table-row')).toBeTruthy());

  // objects → mapping
  fireEvent.click(screen.getByTestId('data-transfer-next'));

  await waitFor(() => expect(screen.getByTestId('data-transfer-mapping-step')).toBeTruthy());
}

async function advanceToPreviewStep(writeMode: 'insert' | 'truncateInsert' = 'truncateInsert') {
  const { DataTransferWindow } = await import('../DataTransferWindow');
  render(<DataTransferWindow />);

  await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('get_connections'));
  await dismissLimitationsDialog();

  await pickSelect('data-transfer-source', 'PG Src (postgresql)');
  await pickSelect('data-transfer-target', 'PG Tgt (postgresql)');
  await waitFor(() => expect(getDatabasesMock).toHaveBeenCalled());

  fireEvent.click(screen.getByTestId('data-transfer-next'));
  await waitFor(() => expect(screen.getByTestId('data-transfer-mode-data')).toBeTruthy());
  fireEvent.click(screen.getByTestId('data-transfer-mode-data'));

  if (writeMode !== 'insert') {
    await waitFor(() => expect(screen.getByTestId('data-transfer-write-mode')).toBeTruthy());
    await pickSelect('data-transfer-write-mode', 'transfer.writeMode.truncateInsert');
    fireEvent.click(screen.getByTestId('data-transfer-destructive-confirm'));
  }

  inspectTransferMock.mockResolvedValue(inspectRows);
  fireEvent.click(screen.getByTestId('data-transfer-next'));
  await waitFor(() => expect(screen.getByTestId('data-transfer-table-row')).toBeTruthy());
  fireEvent.click(screen.getByTestId('data-transfer-next'));
  await waitFor(() => expect(screen.getByTestId('data-transfer-mapping-step')).toBeTruthy());
  fireEvent.click(screen.getByTestId('data-transfer-next'));
  await waitFor(() => expect(screen.getByTestId('data-transfer-preview')).toBeTruthy());
}

describe('DataTransferWindow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(transferCommands.getProfiles).mockResolvedValue([]);
    crossWindowHandlers.clear();
    clearTransferLimitationsDismissed();
    urlParamMock.mockReset();
    urlParamMock.mockReturnValue(null);
    getDatabasesMock.mockResolvedValue(['src', 'tgt']);
    previewTransferMock.mockReset();
    previewTransferMock.mockResolvedValue(previewSuccess);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    invokeMock.mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
      if (cmd === 'get_connections') return [pgSrc, pgTgt];
      if (cmd === 'get_available_drivers') return ['postgresql', 'mysql', 'redis'];
      if (cmd === 'connect_dedicated') {
        const conn = args?.connectionId as string;
        const db = (args?.database as string | null | undefined) ?? 'default';
        return `dedicated-${conn}-${db}`;
      }
      if (cmd === 'release_connection') return false;
      if (cmd === 'connect') return `live-${args?.connectionId as string}`;
      return null;
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('[tester] prefills connection endpoints from URL params', async () => {
    urlParamMock.mockImplementation((name) => {
      const params: Record<string, string> = {
        sourceId: 'pg-src',
        targetId: 'pg-tgt',
      };
      return params[name] ?? null;
    });
    const { DataTransferWindow } = await import('../DataTransferWindow');
    render(<DataTransferWindow />);
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('get_connections'));
    await dismissLimitationsDialog();
    await waitFor(() =>
      expect(screen.getByTestId('data-transfer-source')).toHaveTextContent('PG Src'),
    );
    await waitFor(() =>
      expect(screen.getByTestId('data-transfer-target')).toHaveTextContent('PG Tgt'),
    );
  });

  it('[tester] marks unsupported target families and explains the pairing', async () => {
    urlParamMock.mockImplementation((name) => {
      const params: Record<string, string> = {
        sourceId: 'pg-src',
        targetId: 'redis-tgt',
      };
      return params[name] ?? null;
    });
    invokeMock.mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
      if (cmd === 'get_connections') return [pgSrc, redisTgt];
      if (cmd === 'connect_dedicated') {
        return `dedicated-${args?.connectionId as string}-${String(args?.database ?? 'default')}`;
      }
      if (cmd === 'release_connection') return false;
      return null;
    });

    const { DataTransferWindow } = await import('../DataTransferWindow');
    render(<DataTransferWindow />);
    await waitFor(() =>
      expect(screen.getByTestId('data-transfer-target')).toHaveTextContent('Redis Tgt'),
    );
    await dismissLimitationsDialog();

    expect(screen.getByTestId('data-transfer-path')).toHaveTextContent(/redis/i);
    expect(screen.getByTestId('data-transfer-next')).toBeDisabled();
  });

  it('[tester] drops only the dedicated side reported closed by the event bus', async () => {
    await advanceToSetupStep();
    const handler = crossWindowHandlers.get('datazen:connection-closed');
    expect(handler).toBeTruthy();

    handler?.();
    handler?.({ dbSessionId: 'dedicated-pg-src-src' });
    handler?.({ dbSessionId: 'dedicated-pg-tgt-tgt' });

    fireEvent.click(screen.getByTestId('data-transfer-mode-data'));
    expect(screen.getByTestId('data-transfer-mode-data')).toBeChecked();
  });

  it('renders wizard shell', async () => {
    const { DataTransferWindow } = await import('../DataTransferWindow');
    render(<DataTransferWindow />);
    expect(screen.getByTestId('data-transfer-window')).toBeTruthy();
    expect(screen.getByTestId('data-transfer-step-endpoints')).toBeTruthy();
    expect(screen.getByTestId('data-transfer-step-setup')).toBeTruthy();
    expect(screen.getByTestId('data-transfer-source')).toBeTruthy();
    expect(screen.getByTestId('data-transfer-target')).toBeTruthy();
  });

  it('loads a saved profile without restoring a runtime SQL-file token', async () => {
    const profile: TransferProfile = {
      version: 1,
      id: 'profile-1',
      name: 'Nightly export',
      sourceConnectionId: 'pg-src',
      targetConnectionId: null,
      sourceDatabase: 'src',
      targetDatabase: null,
      sourceSchema: null,
      targetSchema: null,
      destinationMode: 'sqlFile',
      sqlFileDialect: 'mysql',
      sqlFileEncoding: 'utf8Bom',
      sqlFileCompression: 'gzip',
      sqlFileDatabase: 'analytics',
      sqlFileSchema: null,
      mode: 'data',
      writeMode: 'insert',
      tables: [],
      options: { batchSize: 500, stopOnError: true, confirmedDestructive: false },
      createdAt: '2026-09-21T00:00:00.000Z',
      updatedAt: '2026-09-21T00:00:00.000Z',
    };
    vi.mocked(transferCommands.getProfiles).mockResolvedValue([profile]);
    const { DataTransferWindow } = await import('../DataTransferWindow');
    render(<DataTransferWindow />);
    await waitFor(() => expect(screen.getByTestId('data-transfer-profile-select')).toBeTruthy());
    await pickSelect('data-transfer-profile-select', 'Nightly export');
    fireEvent.click(screen.getByTestId('data-transfer-profile-load'));
    await waitFor(() =>
      expect(screen.getByTestId('data-transfer-sql-file-dialect')).toHaveTextContent(/mysql/i),
    );
    expect(screen.getByTestId('data-transfer-sql-file-compression')).toHaveTextContent(
      'transfer.destination.sqlCompressionGzip',
    );
    expect(screen.getByText('transfer.profile.chooseFile')).toBeTruthy();
  });

  it('opens limitations dialog on first visit', async () => {
    const { DataTransferWindow } = await import('../DataTransferWindow');
    render(<DataTransferWindow />);

    await waitFor(() => {
      expect(screen.getByTestId('data-transfer-limitations')).toBeTruthy();
      expect(screen.getByTestId('data-transfer-limitations-close')).toBeTruthy();
    });
  });

  it('does not reopen limitations dialog after dontShowAgain is checked', async () => {
    const { DataTransferWindow } = await import('../DataTransferWindow');
    const { unmount } = render(<DataTransferWindow />);

    await waitFor(() => {
      expect(screen.getByTestId('data-transfer-limitations')).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('data-transfer-limitations-dismiss'));
    fireEvent.click(screen.getByTestId('data-transfer-limitations-close'));

    await waitFor(() => {
      expect(screen.queryByTestId('data-transfer-limitations')).toBeNull();
    });

    unmount();
    cleanup();

    render(<DataTransferWindow />);
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('get_connections'));

    expect(screen.queryByTestId('data-transfer-limitations')).toBeNull();
  });

  it('allows editing column mappings on mapping step', async () => {
    await advanceToMappingStep();

    expect(screen.getByTestId('data-transfer-column-editor')).toBeTruthy();
    expect(screen.getAllByTestId('data-transfer-column-row')).toHaveLength(3);

    fireEvent.click(screen.getByTestId('data-transfer-auto-match'));
    expect(screen.getByTestId('data-transfer-skip-extra')).toBeChecked();
    expect(screen.getByTestId('data-transfer-unmapped-target-warning')).toBeTruthy();

    const emailRow = screen
      .getAllByTestId('data-transfer-column-row')
      .find((row) => within(row).queryByText('extra'));
    expect(emailRow).toBeTruthy();

    const selectWrap = within(emailRow!).getByTestId('data-transfer-target-select-extra');
    const trigger = within(selectWrap).getAllByRole('button')[0];
    fireEvent.click(trigger);
    const list = await waitFor(() => screen.getByRole('listbox'));
    const emailOption = Array.from(list.children).find((el) =>
      (el.textContent || '').includes('email'),
    );
    fireEvent.mouseDown(emailOption!);

    expect(screen.getByTestId('data-transfer-skip-extra')).not.toBeChecked();
    expect(screen.queryByTestId('data-transfer-unmapped-target-warning')).toBeNull();
  });

  it('keeps recordset editing parameterized and invalidates the old preview before re-preview', async () => {
    await advanceToMappingStep();

    fireEvent.click(screen.getByTestId('data-transfer-recordset-enable'));
    expect(screen.queryByTestId('data-transfer-recordset-order-error')).toBeNull();
    fireEvent.change(screen.getByTestId('data-transfer-recordset-start'), {
      target: { value: '10' },
    });
    fireEvent.change(screen.getByTestId('data-transfer-recordset-end'), {
      target: { value: '20' },
    });
    fireEvent.change(screen.getByTestId('data-transfer-recordset-limit'), {
      target: { value: '5' },
    });

    previewTransferMock.mockResolvedValueOnce({
      ...previewSuccess,
      writePlans: [
        {
          ...previewSuccess.writePlans[0],
          recordsetPreview: 'ORDER BY "id" ASC LIMIT $3',
        },
      ],
    });
    fireEvent.click(screen.getByTestId('data-transfer-next'));
    await waitFor(() => expect(screen.getByTestId('data-transfer-preview')).toBeTruthy());
    expect(previewTransferMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tables: [
          expect.objectContaining({
            recordset: {
              orderBy: 'id',
              start: { value: '10', inclusive: true },
              end: { value: '20', inclusive: true },
              limit: 5,
            },
          }),
        ],
      }),
    );
    expect(screen.getByText('ORDER BY "id" ASC LIMIT $3')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /transfer.back/i }));
    await waitFor(() => expect(screen.getByTestId('data-transfer-mapping-step')).toBeTruthy());
    fireEvent.change(screen.getByTestId('data-transfer-recordset-start'), {
      target: { value: '11' },
    });
    fireEvent.click(screen.getByTestId('data-transfer-next'));
    await waitFor(() => expect(screen.getByTestId('data-transfer-preview')).toBeTruthy());
    expect(previewTransferMock).toHaveBeenCalledTimes(2);
  });

  it('sends complete composite primary-key tuple bounds in declared order', async () => {
    const compositeRows: TransferTableResult[] = [
      {
        ...inspectRows[0],
        sourceColumns: ['tenant', 'sequence', 'payload'],
        sourcePrimaryKeys: ['tenant', 'sequence'],
        sourceColumnTypes: { tenant: 'TEXT', sequence: 'BIGINT', payload: 'TEXT' },
        columnMappings: [
          { sourceColumn: 'tenant', targetColumn: 'tenant', skip: false },
          { sourceColumn: 'sequence', targetColumn: 'sequence', skip: false },
          { sourceColumn: 'payload', targetColumn: 'payload', skip: false },
        ],
      },
    ];
    await advanceToMappingStep(compositeRows);

    fireEvent.click(screen.getByTestId('data-transfer-recordset-enable'));
    expect(screen.getByTestId('data-transfer-recordset-tuple-editor')).toBeTruthy();
    expect(screen.getByTestId('data-transfer-recordset-tuple-collation-hint')).toBeTruthy();
    fireEvent.change(screen.getByTestId('data-transfer-recordset-tuple-start-0'), {
      target: { value: 'a-雪' },
    });
    fireEvent.change(screen.getByTestId('data-transfer-recordset-tuple-start-1'), {
      target: { value: '-3' },
    });
    fireEvent.click(screen.getByTestId('data-transfer-recordset-tuple-start-inclusive'));
    fireEvent.change(screen.getByTestId('data-transfer-recordset-tuple-end-0'), {
      target: { value: 'a-雪' },
    });
    fireEvent.change(screen.getByTestId('data-transfer-recordset-tuple-end-1'), {
      target: { value: '9223372036854775806' },
    });

    fireEvent.click(screen.getByTestId('data-transfer-next'));
    await waitFor(() => expect(screen.getByTestId('data-transfer-preview')).toBeTruthy());
    expect(previewTransferMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tables: [
          expect.objectContaining({
            recordset: {
              tupleRange: {
                columns: ['tenant', 'sequence'],
                start: { values: ['a-雪', '-3'], inclusive: false },
                end: { values: ['a-雪', '9223372036854775806'], inclusive: true },
              },
            },
          }),
        ],
      }),
    );
  });

  it('[tester] clears an empty tuple bound while preserving the opposite endpoint', async () => {
    const compositeRows: TransferTableResult[] = [
      {
        ...inspectRows[0],
        sourceColumns: ['tenant', 'sequence', 'payload'],
        sourcePrimaryKeys: ['tenant', 'sequence'],
        sourceColumnTypes: { tenant: 'TEXT', sequence: 'BIGINT', payload: 'TEXT' },
        columnMappings: [
          { sourceColumn: 'tenant', targetColumn: 'tenant', skip: false },
          { sourceColumn: 'sequence', targetColumn: 'sequence', skip: false },
          { sourceColumn: 'payload', targetColumn: 'payload', skip: false },
        ],
      },
    ];
    await advanceToMappingStep(compositeRows);

    fireEvent.click(screen.getByTestId('data-transfer-recordset-enable'));
    fireEvent.change(screen.getByTestId('data-transfer-recordset-tuple-start-0'), {
      target: { value: 'a-雪' },
    });
    fireEvent.change(screen.getByTestId('data-transfer-recordset-tuple-start-1'), {
      target: { value: '10' },
    });
    fireEvent.change(screen.getByTestId('data-transfer-recordset-tuple-end-0'), {
      target: { value: 'z-雪' },
    });
    fireEvent.change(screen.getByTestId('data-transfer-recordset-tuple-end-1'), {
      target: { value: '20' },
    });
    fireEvent.click(screen.getByTestId('data-transfer-next'));
    await waitFor(() => expect(screen.getByTestId('data-transfer-preview')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: /transfer.back/i }));
    await waitFor(() => expect(screen.getByTestId('data-transfer-mapping-step')).toBeTruthy());
    fireEvent.change(screen.getByTestId('data-transfer-recordset-tuple-start-0'), {
      target: { value: '' },
    });
    fireEvent.change(screen.getByTestId('data-transfer-recordset-tuple-start-1'), {
      target: { value: '' },
    });
    fireEvent.click(screen.getByTestId('data-transfer-next'));
    await waitFor(() => expect(screen.getByTestId('data-transfer-preview')).toBeTruthy());

    expect(previewTransferMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        tables: [
          expect.objectContaining({
            recordset: {
              tupleRange: {
                columns: ['tenant', 'sequence'],
                end: { values: ['z-雪', '20'], inclusive: true },
              },
            },
          }),
        ],
      }),
    );
  });

  it('sends the selected registered SQL file dialect into preview', async () => {
    const { DataTransferWindow } = await import('../DataTransferWindow');
    render(<DataTransferWindow />);
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('get_connections'));
    await dismissLimitationsDialog();

    fireEvent.click(screen.getByTestId('data-transfer-destination-sql-file'));
    await waitFor(() =>
      expect(screen.getByTestId('data-transfer-destination-sql-file')).toHaveTextContent(
        'transfer.destination.sqlFileSelected',
      ),
    );
    await pickSelect('data-transfer-source', 'PG Src (postgresql)');
    await waitFor(() => expect(getDatabasesMock).toHaveBeenCalled());
    await pickSelect('data-transfer-source-database', 'src');
    await pickSelect('data-transfer-sql-file-dialect', 'MySQL');
    await pickSelect('data-transfer-sql-file-encoding', 'transfer.destination.sqlEncodingUtf8Bom');
    fireEvent.change(screen.getByTestId('data-transfer-sql-file-target-database'), {
      target: { value: 'analytics' },
    });

    fireEvent.click(screen.getByTestId('data-transfer-next'));
    await waitFor(() => expect(screen.getByTestId('data-transfer-mode-data')).toBeTruthy());
    inspectSqlFileTransferMock.mockResolvedValue(sqlInspectRows);
    fireEvent.click(screen.getByTestId('data-transfer-next'));
    await waitFor(() => expect(screen.getByTestId('data-transfer-table-row')).toBeTruthy());
    fireEvent.click(screen.getByTestId('data-transfer-next'));
    await waitFor(() => expect(screen.getByTestId('data-transfer-mapping-step')).toBeTruthy());
    fireEvent.click(screen.getByTestId('data-transfer-next'));
    await waitFor(() => expect(screen.getByTestId('data-transfer-preview')).toBeTruthy());
    expect(previewTransferMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sqlFileTarget: {
          fileToken: 'sql-file-token',
          databaseType: 'mysql',
          encoding: 'utf8Bom',
          database: 'analytics',
        },
      }),
    );
  });

  it('sends UTF-16 and gzip SQL-file settings into preview and clears stale preview', async () => {
    const { DataTransferWindow } = await import('../DataTransferWindow');
    render(<DataTransferWindow />);
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('get_connections'));
    await dismissLimitationsDialog();

    fireEvent.click(screen.getByTestId('data-transfer-destination-sql-file'));
    await waitFor(() =>
      expect(screen.getByTestId('data-transfer-destination-sql-file')).toHaveTextContent(
        'transfer.destination.sqlFileSelected',
      ),
    );
    await pickSelect('data-transfer-source', 'PG Src (postgresql)');
    await waitFor(() => expect(getDatabasesMock).toHaveBeenCalled());
    await pickSelect('data-transfer-source-database', 'src');
    await pickSelect('data-transfer-sql-file-encoding', 'transfer.destination.sqlEncodingUtf16Le');
    await pickSelect(
      'data-transfer-sql-file-compression',
      'transfer.destination.sqlCompressionGzip',
    );

    fireEvent.click(screen.getByTestId('data-transfer-next'));
    await waitFor(() => expect(screen.getByTestId('data-transfer-mode-data')).toBeTruthy());
    inspectSqlFileTransferMock.mockResolvedValue(sqlInspectRows);
    fireEvent.click(screen.getByTestId('data-transfer-next'));
    await waitFor(() => expect(screen.getByTestId('data-transfer-table-row')).toBeTruthy());
    fireEvent.click(screen.getByTestId('data-transfer-next'));
    await waitFor(() => expect(screen.getByTestId('data-transfer-mapping-step')).toBeTruthy());
    fireEvent.click(screen.getByTestId('data-transfer-next'));
    await waitFor(() => expect(screen.getByTestId('data-transfer-preview')).toBeTruthy());
    expect(previewTransferMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sqlFileTarget: expect.objectContaining({
          encoding: 'utf16Le',
          compression: 'gzip',
        }),
      }),
    );
  });

  it('[tester] clears empty bounds, toggles endpoint inclusivity, and disables the recordset', async () => {
    await advanceToMappingStep();

    fireEvent.click(screen.getByTestId('data-transfer-recordset-enable'));
    expect(screen.getByTestId('data-transfer-recordset-editor')).toBeTruthy();
    expect(screen.queryByTestId('data-transfer-recordset-order-error')).toBeNull();

    fireEvent.change(screen.getByTestId('data-transfer-recordset-start'), {
      target: { value: '10' },
    });
    fireEvent.click(screen.getByTestId('data-transfer-recordset-start-inclusive'));
    expect(screen.getByTestId('data-transfer-recordset-start-inclusive')).not.toBeChecked();
    fireEvent.change(screen.getByTestId('data-transfer-recordset-start'), {
      target: { value: ' ' },
    });
    expect(screen.queryByTestId('data-transfer-recordset-start-inclusive')).toBeNull();

    fireEvent.change(screen.getByTestId('data-transfer-recordset-end'), {
      target: { value: '20' },
    });
    fireEvent.click(screen.getByTestId('data-transfer-recordset-end-inclusive'));
    expect(screen.getByTestId('data-transfer-recordset-end-inclusive')).not.toBeChecked();
    fireEvent.change(screen.getByTestId('data-transfer-recordset-end'), {
      target: { value: '' },
    });
    expect(screen.queryByTestId('data-transfer-recordset-end-inclusive')).toBeNull();

    fireEvent.change(screen.getByTestId('data-transfer-recordset-limit'), {
      target: { value: '8' },
    });
    fireEvent.change(screen.getByTestId('data-transfer-recordset-limit'), {
      target: { value: '' },
    });
    fireEvent.click(screen.getByTestId('data-transfer-recordset-enable'));
    expect(screen.queryByTestId('data-transfer-recordset-editor')).toBeNull();
    expect(screen.getByText('transfer.mapping.noRecordset')).toBeTruthy();
  });

  it('[tester] requires an explicit order column when the source has no primary key', async () => {
    const previousPrimaryKeys = inspectRows[0].sourcePrimaryKeys;
    inspectRows[0].sourcePrimaryKeys = [];
    try {
      await advanceToMappingStep();
      fireEvent.click(screen.getByTestId('data-transfer-recordset-enable'));
      expect(screen.getByTestId('data-transfer-recordset-order-error')).toBeTruthy();
    } finally {
      inspectRows[0].sourcePrimaryKeys = previousPrimaryKeys;
    }
  });

  it('shows execute confirm dialog for destructive write mode before running', async () => {
    await advanceToPreviewStep('truncateInsert');

    fireEvent.click(screen.getByTestId('data-transfer-execute'));
    await waitFor(() => {
      expect(screen.getByTestId('data-transfer-execute-confirm')).toBeTruthy();
      expect(screen.getByTestId('data-transfer-execute-confirm-table-users')).toBeTruthy();
    });
    expect(transferCommands.execute).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('data-transfer-execute-confirm-proceed'));
    await waitFor(() => expect(transferCommands.execute).toHaveBeenCalled());
    expect(transferCommands.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        planId: 'plan-test-1',
        selection: { sourceTables: ['users'] },
        options: { confirmedDestructive: true },
      }),
    );
  });

  it('runs execute immediately for insert write mode without confirm dialog', async () => {
    await advanceToPreviewStep('insert');

    fireEvent.click(screen.getByTestId('data-transfer-execute'));
    await waitFor(() => expect(transferCommands.execute).toHaveBeenCalled());
    expect(screen.queryByTestId('data-transfer-execute-confirm')).toBeNull();
  });

  it('[tester] lets a SQL-file preview export the server-selected multi-table scope', async () => {
    previewTransferMock.mockResolvedValueOnce({
      ...previewSuccess,
      writePlans: [
        previewSuccess.writePlans[0],
        { ...previewSuccess.writePlans[0], sourceTable: 'orders', targetTable: 'orders' },
      ],
    });
    await advanceToSqlFilePreview();

    fireEvent.click(screen.getByTestId('data-transfer-execute'));
    await waitFor(() => expect(transferCommands.execute).toHaveBeenCalled());
    expect(transferCommands.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        planId: 'plan-test-1',
        selection: { sourceTables: ['users'] },
      }),
    );
  });

  it('[tester] returns SQL-file preview back to the mapping step', async () => {
    await advanceToSqlFilePreview();

    fireEvent.click(screen.getByRole('button', { name: /transfer.back/i }));
    await waitFor(() => expect(screen.getByTestId('data-transfer-mapping-step')).toBeTruthy());
  });

  it('[tester] keeps SQL-file DDL preview read-only', async () => {
    previewTransferMock.mockResolvedValueOnce({
      ...previewSuccess,
      ddl: [
        {
          sourceTable: 'users',
          targetTable: 'users',
          ddl: 'CREATE TABLE users (id integer)',
        },
      ],
    });
    await advanceToSqlFilePreview('structure');

    expect(screen.getByTestId('data-transfer-ddl-preview-users')).toHaveTextContent(
      'CREATE TABLE users (id integer)',
    );
    expect(screen.queryByTestId('data-transfer-ddl-editor-users')).toBeNull();
    expect(screen.queryByTestId('sql-code-change')).toBeNull();
  });

  it('keeps SQL-file table and column selection in the reviewed preview job', async () => {
    const orders = {
      ...sqlInspectRows[0],
      sourceTable: 'orders',
      targetTable: 'orders',
      sourceColumns: ['id', 'total'],
      sourcePrimaryKeys: ['id'],
      sourceColumnTypes: { id: 'INTEGER', total: 'NUMERIC' },
      columnMappings: [
        { sourceColumn: 'id', targetColumn: 'id', skip: false },
        { sourceColumn: 'total', targetColumn: 'total', skip: false },
      ],
    } satisfies TransferTableResult;
    await advanceToSqlFilePreview('data', 'objects', [...sqlInspectRows, orders]);

    const ordersRow = screen
      .getAllByTestId('data-transfer-table-row')
      .find((row) => within(row).queryByText('orders'));
    expect(ordersRow).toBeTruthy();
    fireEvent.click(within(ordersRow!).getByRole('checkbox'));
    fireEvent.click(screen.getByTestId('data-transfer-next'));
    await waitFor(() => expect(screen.getByTestId('data-transfer-mapping-step')).toBeTruthy());

    fireEvent.change(screen.getByTestId('data-transfer-target-table-input'), {
      target: { value: 'users_copy' },
    });
    expect(screen.getByTestId('data-transfer-skip-extra')).toBeChecked();
    fireEvent.click(screen.getByTestId('data-transfer-next'));
    await waitFor(() => expect(screen.getByTestId('data-transfer-preview')).toBeTruthy());

    expect(previewTransferMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tables: [
          expect.objectContaining({
            sourceTable: 'users',
            targetTable: 'users_copy',
            createNew: true,
            columnMappings: expect.arrayContaining([
              expect.objectContaining({ sourceColumn: 'extra', skip: true }),
            ]),
          }),
        ],
      }),
    );
  });

  it('disables next and shows empty guidance when no tables are detected', async () => {
    await advanceToObjectsStep(true);

    expect(screen.getByText('transfer.objects.noTablesFound')).toBeTruthy();
    expect(screen.getByText('transfer.objects.noTablesHint')).toBeTruthy();
    expect(screen.getByTestId('data-transfer-next')).toBeDisabled();

    inspectTransferMock.mockClear();
    inspectTransferMock.mockResolvedValue(inspectRows);
    fireEvent.click(screen.getByTestId('data-transfer-reinspect'));

    await waitFor(() => expect(inspectTransferMock).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByTestId('data-transfer-table-row')).toBeTruthy());
    expect(screen.getByTestId('data-transfer-next')).not.toBeDisabled();
  });

  it('[tester] applies setup controls and table selection before mapping', async () => {
    await advanceToSetupStep();
    fireEvent.click(screen.getByTestId('data-transfer-mode-structure'));
    expect(screen.getByTestId('data-transfer-mode-structure')).toBeChecked();
    fireEvent.click(screen.getByTestId('data-transfer-mode-data'));

    const batchInput = screen.getByRole('spinbutton');
    fireEvent.change(batchInput, { target: { value: '0' } });
    expect(batchInput).toHaveValue(500);
    fireEvent.change(batchInput, { target: { value: '25' } });
    expect(batchInput).toHaveValue(25);
    const stopOnError = within(
      screen.getByText('transfer.stopOnError').closest('label')!,
    ).getByRole('checkbox');
    fireEvent.click(stopOnError);
    expect(stopOnError).not.toBeChecked();

    inspectTransferMock.mockResolvedValue([{ ...inspectRows[0], targetTable: '' }]);
    fireEvent.click(screen.getByTestId('data-transfer-next'));
    await waitFor(() => expect(screen.getByTestId('data-transfer-table-row')).toBeTruthy());

    const tableRow = screen.getByTestId('data-transfer-table-row');
    expect(within(tableRow).getByText('→ —')).toBeTruthy();
    const tableToggle = within(tableRow).getByRole('checkbox');
    fireEvent.click(tableToggle);
    expect(screen.getByTestId('data-transfer-next')).toBeDisabled();
    fireEvent.click(tableToggle);
    expect(screen.getByTestId('data-transfer-next')).not.toBeDisabled();

    fireEvent.click(screen.getByTestId('data-transfer-next'));
    await waitFor(() => expect(screen.getByTestId('data-transfer-mapping-step')).toBeTruthy());
  });

  it('[tester] reports a non-Error inspect rejection without hiding object recovery', async () => {
    await advanceToSetupStep();
    inspectTransferMock.mockRejectedValueOnce('inspect failed');
    fireEvent.click(screen.getByTestId('data-transfer-next'));

    await waitFor(() =>
      expect(screen.getByTestId('data-transfer-error')).toHaveTextContent('inspect failed'),
    );
    expect(screen.getByTestId('data-transfer-objects-empty')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'common.ok' }));
    await waitFor(() => expect(screen.queryByTestId('data-transfer-error')).toBeNull());
  });

  it('shows preview error state with retry and back actions when preview fails', async () => {
    await advanceToMappingStep();

    previewTransferMock.mockRejectedValueOnce(new Error('preview boom'));
    fireEvent.click(screen.getByTestId('data-transfer-next'));

    const errorPanel = await waitFor(() => screen.getByTestId('data-transfer-preview-error'));
    expect(within(errorPanel).getByText('preview boom')).toBeTruthy();
    expect(screen.queryByTestId('data-transfer-preview')).toBeNull();

    previewTransferMock.mockResolvedValueOnce(previewSuccess);
    fireEvent.click(screen.getByTestId('data-transfer-preview-retry'));
    await waitFor(() => expect(screen.getByTestId('data-transfer-preview')).toBeTruthy());
  });

  it('returns to mapping from preview error state', async () => {
    await advanceToMappingStep();

    previewTransferMock.mockRejectedValueOnce(new Error('preview boom'));
    fireEvent.click(screen.getByTestId('data-transfer-next'));
    await waitFor(() => expect(screen.getByTestId('data-transfer-preview-error')).toBeTruthy());

    fireEvent.click(screen.getByTestId('data-transfer-preview-back-mapping'));
    await waitFor(() => expect(screen.getByTestId('data-transfer-mapping-step')).toBeTruthy());
  });

  it('updates preview error message when retry fails', async () => {
    await advanceToMappingStep();

    previewTransferMock.mockRejectedValueOnce(new Error('preview boom'));
    fireEvent.click(screen.getByTestId('data-transfer-next'));
    await waitFor(() => expect(screen.getByTestId('data-transfer-preview-error')).toBeTruthy());

    previewTransferMock.mockRejectedValueOnce('retry failed');
    fireEvent.click(screen.getByTestId('data-transfer-preview-retry'));
    await waitFor(() => {
      const errorPanel = screen.getByTestId('data-transfer-preview-error');
      expect(within(errorPanel).getByText('retry failed')).toBeTruthy();
    });
  });

  it('advances to preview error state instead of blank when preview fails from mapping', async () => {
    await advanceToMappingStep();

    previewTransferMock.mockRejectedValueOnce(new Error('mapping preview failed'));
    fireEvent.click(screen.getByTestId('data-transfer-next'));

    const errorPanel = await waitFor(() => screen.getByTestId('data-transfer-preview-error'));
    expect(within(errorPanel).getByText('mapping preview failed')).toBeTruthy();
    expect(screen.queryByTestId('data-transfer-preview')).toBeNull();
  });

  it('[tester] renders, edits, and copies the exact DDL preview with warnings', async () => {
    previewTransferMock.mockResolvedValueOnce({
      ...previewSuccess,
      ddl: [
        {
          sourceTable: 'users',
          targetTable: 'users_copy',
          ddl: 'CREATE TABLE users_copy (id bigint)',
        },
      ],
      warnings: ['DDL commits independently'],
      blockReason: 'Target is blocked for this dry run',
      canExecute: false,
      writePlans: [
        {
          ...previewSuccess.writePlans[0],
          estimatedRows: null,
        },
      ],
    });
    await advanceToPreviewStep('insert');

    expect(screen.getByTestId('sql-code-block')).toHaveTextContent(
      'CREATE TABLE users_copy (id bigint)',
    );
    expect(screen.getByText('DDL commits independently')).toBeTruthy();
    expect(screen.getByText('Target is blocked for this dry run')).toBeTruthy();
    expect(screen.getByText(/transfer.estimatedRows.*—/)).toBeTruthy();

    fireEvent.click(screen.getByTestId('sql-code-change'));
    expect(screen.getByTestId('sql-code-block')).toHaveTextContent('CREATE TABLE edited');
    fireEvent.click(screen.getByTestId('data-transfer-copy-ddl-users'));
    await waitFor(() =>
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('CREATE TABLE edited'),
    );
  });

  it('[tester] exposes cancellable execution progress and finishes as success', async () => {
    let finishExecute!: (result: TransferExecutionResult) => void;
    vi.mocked(transferCommands.execute).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishExecute = resolve;
        }),
    );
    vi.mocked(transferCommands.cancel).mockRejectedValueOnce(new Error('already finished'));
    await advanceToPreviewStep('insert');
    fireEvent.click(screen.getByTestId('data-transfer-execute'));

    await waitFor(() => expect(screen.getByTestId('data-transfer-executing-overlay')).toBeTruthy());
    expect(screen.getAllByText(/transfer.executingProgress/)).toHaveLength(2);
    fireEvent.click(screen.getByTestId('data-transfer-cancel'));
    await waitFor(() => expect(transferCommands.cancel).toHaveBeenCalledTimes(1));

    finishExecute({
      rowsInserted: 3,
      partial: false,
      cancelled: false,
      tables: [
        {
          sourceTable: 'users',
          targetTable: 'users',
          rowsInserted: 3,
          success: true,
        },
      ],
    });
    await waitFor(() => expect(screen.getByTestId('data-transfer-result')).toBeTruthy());
    expect(screen.getByRole('status')).toHaveTextContent('transfer.success');
    expect(screen.queryByText('transfer.partialExplanation')).toBeNull();
  });

  it('[tester] renders partial execution as incomplete with recovery guidance', async () => {
    vi.mocked(transferCommands.execute).mockResolvedValueOnce({
      rowsInserted: 0,
      partial: true,
      cancelled: false,
      tables: [
        {
          sourceTable: 'users',
          targetTable: 'users',
          rowsInserted: 0,
          success: false,
          error: 'injected write failure',
        },
      ],
    });
    await advanceToPreviewStep('insert');
    fireEvent.click(screen.getByTestId('data-transfer-execute'));

    await waitFor(() => expect(screen.getByTestId('data-transfer-result')).toBeTruthy());
    expect(screen.getByRole('status')).toHaveTextContent('transfer.runPartial');
    expect(screen.getByText('transfer.partialExplanation')).toBeTruthy();
    expect(screen.getByText('injected write failure')).toBeTruthy();
  });

  it('renders an unknown commit outcome distinctly and does not offer resume', async () => {
    vi.mocked(transferCommands.execute).mockResolvedValueOnce({
      rowsInserted: 0,
      partial: true,
      cancelled: false,
      tables: [
        {
          sourceTable: 'users',
          targetTable: 'users',
          rowsInserted: null,
          success: false,
          outcome: 'unknown',
          error: 'commit failed; outcome UNKNOWN',
        },
        {
          sourceTable: 'orders',
          targetTable: 'orders',
          rowsInserted: 0,
          success: false,
          outcome: 'notStarted',
          error: 'not started because an earlier table has an unknown outcome',
        },
      ],
    });
    await advanceToPreviewStep('insert');
    fireEvent.click(screen.getByTestId('data-transfer-execute'));

    await waitFor(() => expect(screen.getByTestId('data-transfer-result')).toBeTruthy());
    expect(screen.getByRole('status')).toHaveTextContent('transfer.runUnknownOutcome');
    expect(screen.getByText('transfer.confirmedRowsInserted: 0')).toBeTruthy();
    expect(screen.getByText(/transfer.tableOutcome.unknown/)).toBeTruthy();
    expect(screen.getByText(/transfer.tableOutcome.notStarted/)).toBeTruthy();
    expect(screen.getAllByText(/transfer.rowsInserted: transfer.rowsUnknown/)).toHaveLength(1);
    expect(screen.queryByTestId('data-transfer-resume')).toBeNull();
  });

  it('renders a confirmed destructive preamble with rolled-back rows as partially applied', async () => {
    vi.mocked(transferCommands.execute).mockResolvedValueOnce({
      rowsInserted: 1,
      partial: true,
      cancelled: false,
      tables: [
        {
          sourceTable: 'users',
          targetTable: 'users',
          rowsInserted: 0,
          success: false,
          outcome: 'partiallyApplied',
          error: 'truncate was confirmed; data transaction did not start',
        },
        {
          sourceTable: 'orders',
          targetTable: 'orders',
          rowsInserted: 1,
          success: true,
          outcome: 'committed',
        },
      ],
    });
    await advanceToPreviewStep('truncateInsert');
    fireEvent.click(screen.getByTestId('data-transfer-execute'));
    await waitFor(() => expect(screen.getByTestId('data-transfer-execute-confirm')).toBeTruthy());
    fireEvent.click(screen.getByTestId('data-transfer-execute-confirm-proceed'));

    await waitFor(() => expect(screen.getByTestId('data-transfer-result')).toBeTruthy());
    expect(screen.getByRole('status')).toHaveTextContent('transfer.runPartial');
    expect(screen.getByText(/transfer.tableOutcome.partiallyApplied/)).toBeTruthy();
    expect(screen.getByTestId('data-transfer-table-result-users')).toHaveAttribute(
      'data-outcome',
      'partiallyApplied',
    );
  });

  it('[tester] renders a cancelled execution distinctly from success', async () => {
    vi.mocked(transferCommands.execute).mockResolvedValueOnce({
      rowsInserted: 0,
      partial: true,
      cancelled: true,
      tables: [],
    });
    await advanceToPreviewStep('insert');
    fireEvent.click(screen.getByTestId('data-transfer-execute'));

    await waitFor(() => expect(screen.getByTestId('data-transfer-result')).toBeTruthy());
    expect(screen.getByRole('status')).toHaveTextContent('transfer.runCancelled');
    expect(screen.getByText('transfer.partialExplanation')).toBeTruthy();
  });
});
