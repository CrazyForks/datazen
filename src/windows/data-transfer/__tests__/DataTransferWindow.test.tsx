import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectionConfig } from '../../../types';
import type { TransferExecutionResult, TransferTableResult } from '../../../commands/transfer';
import { transferCommands } from '../../../commands/transfer';
import { clearTransferLimitationsDismissed } from '../../../lib/transferLimitationsPrefs';

const {
  invokeMock,
  inspectTransferMock,
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
    inspect: (...args: unknown[]) => inspectTransferMock(...args),
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
    targetColumns: ['id', 'name', 'email'],
    columnMappings: [
      { sourceColumn: 'id', targetColumn: 'id', skip: false },
      { sourceColumn: 'name', targetColumn: 'name', skip: false },
      { sourceColumn: 'extra', targetColumn: '', skip: true },
    ],
  },
];

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
  const trigger = within(wrap).getAllByRole('button')[0];
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

async function dismissLimitationsDialog() {
  await waitFor(() => {
    expect(screen.getByTestId('data-transfer-limitations')).toBeTruthy();
  });
  fireEvent.click(screen.getByTestId('data-transfer-limitations-close'));
  await waitFor(() => {
    expect(screen.queryByTestId('data-transfer-limitations')).toBeNull();
  });
}

async function advanceToMappingStep() {
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

  inspectTransferMock.mockResolvedValue(inspectRows);
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
