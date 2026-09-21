import { useCallback, useEffect, useState } from 'react';
import { Clock3, Loader2 } from 'lucide-react';
import { historyCommands, type MigrationOperation, type MigrationRunRecord } from '../../commands/history';
import { useI18n } from '../../hooks/useI18n';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';

export function MigrationRunHistoryDialog({ operation }: Readonly<{ operation: MigrationOperation }>) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<MigrationRunRecord[]>([]);
  const [selected, setSelected] = useState<MigrationRunRecord | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try { setItems((await historyCommands.listMigrationRuns({ operation })).items); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setLoading(false); }
  }, [operation]);

  useEffect(() => { if (open) void load(); }, [load, open]);

  return <>
    <Button variant="secondary" className="h-6 px-2 text-xs" onClick={() => setOpen(true)}>
      <Clock3 className="mr-1 h-3 w-3" />{t('migrationHistory.open')}
    </Button>
    <Dialog open={open} onClose={() => setOpen(false)} title={t('migrationHistory.title')}>
      <div className="max-h-[65vh] overflow-auto text-xs" data-testid="migration-run-history">
        {loading && <div className="flex items-center gap-2 p-4 text-fg-muted"><Loader2 className="h-4 w-4 animate-spin" />{t('common.loading')}</div>}
        {error && <p className="p-4 text-danger">{error}</p>}
        {!loading && !error && items.length === 0 && <p className="p-4 text-fg-muted">{t('migrationHistory.empty')}</p>}
        {items.map((run) => <button key={run.id} type="button" className="grid w-full grid-cols-[1fr_auto] gap-3 border-b border-edge p-3 text-left hover:bg-surface-hover" onClick={() => setSelected(run)}>
          <span><strong>{run.status}</strong> · {run.phase}<br /><span className="text-fg-muted">{new Date(run.startedAt).toLocaleString()}</span></span>
          <span>{run.committedCount}/{run.selectedCount}</span>
        </button>)}
        {selected && <div className="m-3 rounded border border-edge bg-surface-secondary p-3" data-testid="migration-run-detail">
          <div>{t('migrationHistory.outcome')}: {selected.outcome}</div>
          <div>{t('migrationHistory.counts')}: {selected.committedCount} / {selected.failedCount} / {selected.conflictCount}</div>
          <div>{t('migrationHistory.rollback')}: {selected.rollbackOutcome}</div>
          {selected.profileId && <div>{t('migrationHistory.profile')}: {selected.profileId} @ {selected.profileRevision}</div>}
          {selected.errorSummary && <div className="mt-2 text-danger">{selected.errorSummary}</div>}
        </div>}
      </div>
    </Dialog>
  </>;
}
