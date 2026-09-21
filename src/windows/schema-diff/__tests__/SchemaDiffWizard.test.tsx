import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { SchemaDiffWindow } from '../SchemaDiffWindow';
import { schemaDiffCommands, type SchemaDiffPlan } from '../../../commands/schemaDiff';
import { databaseCommands } from '../../../commands/database';
import { fileCommands } from '../../../commands/file';

const state = vi.hoisted(() => ({
  t: (key: string) => key,
  loadSettings: vi.fn().mockResolvedValue(undefined),
  endpoints: {
    sourceId: 'src', targetId: 'tgt', sourceDatabase: 'source', targetDatabase: 'target',
    sourceSchema: '', targetSchema: '', sourceDatabases: ['source'], targetDatabases: ['target'],
    sourceSchemas: [], targetSchemas: [], connOptions: [], targetOptions: [],
    targetConn: { name: 'Target', databaseType: 'postgres' }, isCrossDialect: false,
    validateEndpoints: vi.fn(() => true), isSameEndpoint: vi.fn(() => false),
    ensureConnected: vi.fn(async (side: string) => `${side}-session`),
    setSourceId: vi.fn(), setTargetId: vi.fn(), setSourceDatabase: vi.fn(), setTargetDatabase: vi.fn(),
    setSourceSchema: vi.fn(), setTargetSchema: vi.fn(),
  },
}));
vi.mock('../useSchemaDiffEndpoints', () => ({ useSchemaDiffEndpoints: () => state.endpoints }));
vi.mock('../../../hooks/useSettings', () => ({ useSettings: vi.fn() }));
vi.mock('../../../hooks/useI18n', () => ({ useI18n: () => ({ t: state.t, language: 'en' }) }));
vi.mock('../../../hooks/useLocaleDomains', () => ({ useLocaleDomains: () => true }));
vi.mock('../../../stores/settingsStore', () => ({ useSettingsStore: (sel: (s: { loadSettings: typeof state.loadSettings }) => unknown) => sel(state) }));
vi.mock('../../../hooks/useThemeListener', () => ({ useThemeListener: vi.fn() }));
vi.mock('../../../lib/windowManager', () => ({ openDocsWindow: vi.fn() }));
vi.mock('../../../lib/schemaDiffLimitationsPrefs', () => ({ isSchemaDiffLimitationsDismissed: () => true, setSchemaDiffLimitationsDismissed: vi.fn() }));
vi.mock('../../../commands/database', () => ({ databaseCommands: { getTables: vi.fn() } }));
vi.mock('../../../commands/file', () => ({ fileCommands: { saveTextWithDialog: vi.fn() } }));
vi.mock('../../../commands/schemaDiff', async (original) => ({
  ...await original<typeof import('../../../commands/schemaDiff')>(),
  schemaDiffCommands: { compareTableSchemas: vi.fn(), preparePlan: vi.fn(), executeDeploy: vi.fn() },
}));

function plan(overrides: Partial<SchemaDiffPlan> = {}): SchemaDiffPlan {
  return { planId: 'review-1', table: 'users', tables: ['users'], sourceDialect: 'postgres', targetDialect: 'postgres', sameDialect: true,
    statements: [{ sql: 'ALTER TABLE users DROP COLUMN old', risk: 'destructive', rollbackSql: 'ALTER TABLE users ADD COLUMN old int', summary: 'Remove old column' }],
    warnings: [], requirements: [], rollbackCompleteness: { complete: true, missing: [] }, ...overrides };
}
const next = () => fireEvent.click(screen.getByTestId('schema-diff-next'));
const back = () => fireEvent.click(screen.getByRole('button', { name: 'schemaDiff.back' }));
async function reachPlan() {
  next();
  await screen.findByTestId('schema-diff-table-row');
  next();
  await screen.findByTestId('schema-diff-detail-panel');
  next();
  await waitFor(() => expect(schemaDiffCommands.preparePlan).toHaveBeenCalled());
}
async function reachDeploy() {
  await reachPlan();
  await waitFor(() => expect(screen.getByTestId('schema-diff-next')).toBeEnabled());
  next();
  await screen.findByTestId('schema-diff-deploy');
}

beforeEach(() => {
  vi.clearAllMocks();
  state.endpoints.targetDatabase = 'target';
  state.endpoints.validateEndpoints.mockReturnValue(true);
  state.endpoints.ensureConnected.mockImplementation(async (side) => `${side}-session`);
  vi.mocked(databaseCommands.getTables).mockResolvedValue([{ name: 'users', tableType: 'table' }]);
  vi.mocked(schemaDiffCommands.compareTableSchemas).mockResolvedValue({ table: 'users', added: [], removed: [], changed: [] });
  vi.mocked(schemaDiffCommands.preparePlan).mockResolvedValue(plan());
  vi.mocked(schemaDiffCommands.executeDeploy).mockResolvedValue({ status: 'committed', executedCount: 1, statementCount: 1, errors: [], statementResults: [] });
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockResolvedValue(undefined) } });
});
afterEach(cleanup);

describe('complete schema migration wizard journeys', () => {
  it('selects a target-only table without sending it through source comparison', async () => {
    vi.mocked(databaseCommands.getTables).mockImplementation(async (sessionId) =>
      sessionId === 'source-session'
        ? [{ name: 'users', tableType: 'table' }]
        : [
            { name: 'users', tableType: 'table' },
            { name: 'archive', tableType: 'table' },
          ],
    );
    render(<SchemaDiffWindow />);
    next();
    await screen.findByTestId('schema-diff-table-origin-archive');
    const archiveRow = screen
      .getAllByTestId('schema-diff-table-row')
      .find((row) => row.getAttribute('data-table-name') === 'archive');
    expect(archiveRow).toBeDefined();
    expect(within(archiveRow!).getByRole('checkbox')).not.toBeChecked();
    fireEvent.click(within(archiveRow!).getByRole('checkbox'));

    next();
    await screen.findByTestId('schema-diff-detail-panel');
    expect(schemaDiffCommands.compareTableSchemas).toHaveBeenCalledExactlyOnceWith(
      'source-session',
      'target-session',
      'users',
    );
    expect(screen.getByTestId('schema-diff-target-only-detail')).toBeInTheDocument();

    next();
    await waitFor(() => expect(schemaDiffCommands.preparePlan).toHaveBeenCalled());
    expect(schemaDiffCommands.preparePlan).toHaveBeenLastCalledWith(
      expect.objectContaining({
        tableNames: ['users'],
        targetOnlyTableNames: ['archive'],
        allowDestructive: false,
      }),
    );
  });

  it('honors footer confirmation and rollback transitions, then prevents replay after result', async () => {
    render(<SchemaDiffWindow />);
    await reachDeploy();
    const deploy = screen.getByTestId('schema-diff-deploy');
    expect(deploy).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText('DEPLOY'), { target: { value: 'DEPL' } });
    expect(deploy).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText('DEPLOY'), { target: { value: ' DEPLOY ' } });
    expect(deploy).toBeEnabled();
    fireEvent.click(screen.getByLabelText('schemaDiff.requireRollback'));
    fireEvent.click(screen.getByLabelText('schemaDiff.useTransaction'));
    expect(deploy).toBeDisabled();
    fireEvent.click(deploy);
    expect(schemaDiffCommands.executeDeploy).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText('schemaDiff.useTransaction'));
    fireEvent.click(deploy);
    await screen.findByTestId('schema-diff-deploy-result');
    expect(schemaDiffCommands.executeDeploy).toHaveBeenCalledExactlyOnceWith({ targetDbSessionId: 'target-session', plan: plan(), useTransaction: true, requireRollback: true, confirmDestructive: 'DEPLOY' });
    expect(screen.getByTestId('schema-diff-deploy-status')).toHaveTextContent('committed');
    expect(deploy).toBeDisabled();
    fireEvent.click(deploy);
    expect(schemaDiffCommands.executeDeploy).toHaveBeenCalledTimes(1);
  });

  it('reports prepare failure, retries by returning to comparison and rejects stale deployment', async () => {
    vi.mocked(schemaDiffCommands.preparePlan).mockRejectedValueOnce(new Error('prepare unavailable'));
    render(<SchemaDiffWindow />);
    await reachPlan();
    await screen.findByText('prepare unavailable');
    expect(screen.getByTestId('schema-diff-next')).toBeDisabled();
    back(); next();
    await screen.findByText('Remove old column');
    next();
    fireEvent.change(screen.getByPlaceholderText('DEPLOY'), { target: { value: 'DEPLOY' } });
    vi.mocked(schemaDiffCommands.executeDeploy).mockRejectedValueOnce(new Error('Target schema changed; prepare again'));
    fireEvent.click(screen.getByTestId('schema-diff-deploy'));
    await screen.findByText('Target schema changed; prepare again');
    expect(screen.queryByTestId('schema-diff-deploy-result')).not.toBeInTheDocument();
    back();
    fireEvent.click(screen.getByText('schemaDiff.regeneratePlan'));
    await waitFor(() => expect(schemaDiffCommands.preparePlan).toHaveBeenCalledTimes(3));
    next();
    expect(screen.getByPlaceholderText('DEPLOY')).toHaveValue('');
    expect(screen.getByTestId('schema-diff-deploy')).toBeDisabled();
  });

  it('prevents proceeding with empty selection, recovers compare errors and copies comparison', async () => {
    render(<SchemaDiffWindow />);
    next(); await screen.findByTestId('schema-diff-table-row');
    fireEvent.click(screen.getByText('common.deselectAll')); next();
    await screen.findByText('schemaDiff.tableRequired');
    expect(schemaDiffCommands.compareTableSchemas).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByTestId('schema-diff-table-row')).getByRole('checkbox'));
    vi.mocked(schemaDiffCommands.compareTableSchemas).mockRejectedValueOnce('compare failed');
    next(); await screen.findByText('compare failed');
    fireEvent.click(screen.getByText('common.selectAll')); next();
    await screen.findByTestId('schema-diff-detail-panel');
    fireEvent.click(screen.getByText('schemaDiff.copySummary'));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalled());
    expect(schemaDiffCommands.compareTableSchemas).toHaveBeenCalledTimes(2);
  });

  it('updates table-local overrides and regenerates exact options, exports SQL and config', async () => {
    vi.mocked(schemaDiffCommands.preparePlan).mockResolvedValue(plan({ typeSuggestions: [{ table: 'users', column: 'name', sourceType: 'text', suggestedType: 'varchar(255)', currentType: 'varchar(255)', reason: 'index', isKeyOrIndexed: true }] }));
    vi.mocked(fileCommands.saveTextWithDialog).mockResolvedValue(true);
    render(<SchemaDiffWindow />); await reachPlan();
    const input = await screen.findByTestId('type-suggestion-input-name');
    fireEvent.change(input, { target: { value: 'varchar(64)' } });
    fireEvent.click(screen.getByTestId('schema-diff-allow-destructive'));
    fireEvent.click(screen.getByTestId('schema-diff-include-indexes'));
    fireEvent.click(screen.getByTestId('schema-diff-apply-suggestions'));
    await waitFor(() => expect(schemaDiffCommands.preparePlan).toHaveBeenLastCalledWith(expect.objectContaining({ allowDestructive: true, includeIndexes: false, typeOverrides: [{ table: 'users', column: 'name', targetType: 'varchar(64)' }] })));
    fireEvent.click(screen.getByTestId('schema-diff-copy-sql'));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining('ALTER TABLE users DROP COLUMN old;')));
    fireEvent.click(screen.getByTestId('schema-diff-export-config'));
    await waitFor(() => expect(fileCommands.saveTextWithDialog).toHaveBeenCalled());
    const config = JSON.parse(vi.mocked(fileCommands.saveTextWithDialog).mock.calls[0][0]);
    expect(config).toMatchObject({ version: 2, sourceConnectionId: 'src', targetConnectionId: 'tgt', tables: ['users'], allowDestructive: true, includeIndexes: false });
    expect(JSON.stringify(config)).not.toContain('session');
  });

  it('validates imported config, repairs invalid text and returns to selected objects', async () => {
    render(<SchemaDiffWindow />); await reachPlan();
    await screen.findByTestId('schema-diff-copy-sql');
    fireEvent.click(screen.getByTestId('schema-diff-import-config'));
    const text = screen.getByTestId('schema-diff-import-config-text');
    expect(screen.getByTestId('schema-diff-import-config-confirm')).toBeDisabled();
    fireEvent.change(text, { target: { value: '{"version":1}' } });
    fireEvent.click(screen.getByTestId('schema-diff-import-config-confirm'));
    await screen.findByText('schemaDiff.invalidConfig');
    fireEvent.change(text, { target: { value: JSON.stringify({ version: 2, sourceConnectionId: 'src', targetConnectionId: 'tgt', tables: ['users'], requireRollback: true }) } });
    fireEvent.click(screen.getByTestId('schema-diff-import-config-confirm'));
    await screen.findByTestId('schema-diff-objects-panel');
    expect(state.endpoints.setSourceId).toHaveBeenCalledWith('src');
    expect(state.endpoints.setTargetId).toHaveBeenCalledWith('tgt');
    next(); await screen.findByTestId('schema-diff-detail-panel'); next();
    await screen.findByTestId('schema-diff-copy-sql'); next();
    expect(screen.getByLabelText('schemaDiff.requireRollback')).toBeChecked();
  });

  it('clears reviewed artifacts when endpoint changes', async () => {
    const view = render(<SchemaDiffWindow />); await reachDeploy();
    state.endpoints.targetDatabase = 'other-target'; view.rerender(<SchemaDiffWindow />);
    await waitFor(() => expect(screen.getByTestId('schema-diff-deploy')).toBeDisabled());
    expect(screen.queryByPlaceholderText('DEPLOY')).not.toBeInTheDocument();
    expect(schemaDiffCommands.executeDeploy).not.toHaveBeenCalled();
  });

  it.each([
    { targetDialect: 'mysql', rollbackCompleteness: { complete: true, missing: [] } },
    { rollbackCompleteness: { complete: false, missing: ['old column'] } },
    { requirements: [{ kind: 'Unsupported' as const, table: 'users', column: '', reason: 'unsupported' }] },
  ])('refuses footer deploy when rollback or requirements are unmet: %j', async (overrides) => {
    vi.mocked(schemaDiffCommands.preparePlan).mockResolvedValue(plan(overrides));
    render(<SchemaDiffWindow />); await reachDeploy();
    fireEvent.change(screen.getByPlaceholderText('DEPLOY'), { target: { value: 'DEPLOY' } });
    fireEvent.click(screen.getByLabelText('schemaDiff.requireRollback'));
    expect(screen.getByTestId('schema-diff-deploy')).toBeDisabled();
    fireEvent.click(screen.getByTestId('schema-diff-deploy'));
    expect(schemaDiffCommands.executeDeploy).not.toHaveBeenCalled();
  });
});
