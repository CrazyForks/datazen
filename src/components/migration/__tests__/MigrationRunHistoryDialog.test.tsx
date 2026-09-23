import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { historyCommands, type MigrationRunRecord } from '../../../commands/history';
import { MigrationRunHistoryDialog } from '../MigrationRunHistoryDialog';

vi.mock('../../../hooks/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

vi.mock('../../../commands/history', () => ({
  historyCommands: {
    listMigrationRuns: vi.fn(),
  },
}));

afterEach(cleanup);

const run: MigrationRunRecord = {
  id: 'sync-unknown-run',
  operation: 'dataSync',
  status: 'failed',
  outcome: 'unknown',
  phase: 'finished',
  profileId: 'profile-1',
  profileRevision: '2026-09-23T00:00:00Z',
  sourceConnectionId: 'source-1',
  targetConnectionId: 'target-1',
  startedAt: '2026-09-23T00:00:00Z',
  finishedAt: '2026-09-23T00:01:00Z',
  selectedCount: 1,
  committedCount: 0,
  failedCount: 0,
  conflictCount: 0,
  cancelled: false,
  rollbackOutcome: 'unknown',
  errorSummary: 'Commit or rollback could not be confirmed.',
};

describe('MigrationRunHistoryDialog Data Sync recovery action', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(historyCommands.listMigrationRuns).mockResolvedValue({
      items: [run],
      total: 1,
      offset: 0,
      limit: 25,
    });
  });

  it('offers a fresh-comparison action only for unknown Data Sync runs', async () => {
    render(<MigrationRunHistoryDialog operation="dataSync" onReconcile={vi.fn()} />);
    fireEvent.click(screen.getByText('migrationHistory.open'));
    fireEvent.click(await screen.findByText(/failed/));

    expect(await screen.findByTestId('migration-run-reconcile')).toBeInTheDocument();
    expect(screen.getByText('migrationHistory.syncUnknownHint')).toBeInTheDocument();
  });

  it('delegates the selected run and closes only after reconciliation is accepted', async () => {
    const onReconcile = vi.fn().mockResolvedValue(true);
    render(<MigrationRunHistoryDialog operation="dataSync" onReconcile={onReconcile} />);
    fireEvent.click(screen.getByText('migrationHistory.open'));
    fireEvent.click(await screen.findByText(/failed/));
    fireEvent.click(await screen.findByTestId('migration-run-reconcile'));

    await waitFor(() => expect(onReconcile).toHaveBeenCalledWith(run));
    await waitFor(() =>
      expect(screen.queryByTestId('migration-run-history')).not.toBeInTheDocument(),
    );
  });

  it('does not expose the Data Sync action for another migration operation', async () => {
    const transferRun = { ...run, operation: 'dataTransfer' as const };
    vi.mocked(historyCommands.listMigrationRuns).mockResolvedValue({
      items: [transferRun],
      total: 1,
      offset: 0,
      limit: 25,
    });
    render(<MigrationRunHistoryDialog operation="dataTransfer" onReconcile={vi.fn()} />);
    fireEvent.click(screen.getByText('migrationHistory.open'));
    fireEvent.click(await screen.findByText(/failed/));

    expect(screen.queryByTestId('migration-run-reconcile')).not.toBeInTheDocument();
  });

  it('renders a readable Transfer rollback outcome in shared history', async () => {
    const transferRun = { ...run, operation: 'dataTransfer' as const };
    vi.mocked(historyCommands.listMigrationRuns).mockResolvedValue({
      items: [transferRun],
      total: 1,
      offset: 0,
      limit: 25,
    });
    render(<MigrationRunHistoryDialog operation="dataTransfer" />);
    fireEvent.click(screen.getByText('migrationHistory.open'));
    fireEvent.click(await screen.findByText(/failed/));

    expect(
      await screen.findByText('migrationHistory.rollback: transfer.historyOutcome.unknown'),
    ).toBeInTheDocument();
  });
});
