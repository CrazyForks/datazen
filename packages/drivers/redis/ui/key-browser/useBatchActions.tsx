import { useCallback, useState } from 'react';
import { Button, Dialog, Input, useI18n } from '@datazen/ui';
import { useRedisGate } from '../shared/useRedisGate';
import {
  batchSummary,
  failedKeyNames,
  failuresForAllKeys,
  failuresFromErrors,
  type BatchSummaryPayload,
} from './batchErrors';
import {
  formatMatchCount,
  invokeBatchDeletePattern,
  invokeBatchRenamePrefix,
  invokeBatchSetTtl,
  invokeCountMatching,
  invokeDeleteKeys,
} from './batchInvokes';
import type { CountMatchingResult } from '../shared/redisInvoke';

/**
 * Batch write operations over the tree selection (PRD §3.2 R1 header action
 * group + the pattern/prefix strip).
 *
 * Headless on purpose: the *triggers* live in the column header (R1) and in the
 * pattern strip, while the confirmation dialogs are mounted once by the
 * workbench. That is what lets `⌘A` → 批量删除 and the header buttons share one
 * state machine instead of racing two dialog owners.
 *
 * Dialog state machine (AGENTS.md 「状态机三要素」):
 *  - enter: `request(mode)` seeds that mode's inputs from the current context;
 *  - state: `busy` disables both footer buttons, an inline `error` keeps the
 *    dialog open so nothing is lost on a rejected write;
 *  - exit: `closeDialog()` (cancel, dismiss, or a fully successful run) clears
 *    the mode, the error and the pattern preview count. There is no path that
 *    leaves `dialog` set without an owner rendering it.
 *
 * Selection after a run (I-8 / D-6): the server tells us *which* keys failed, so
 * only the ones that did not fail leave the selection. An exception out of a
 * batch call keeps the entire selection — "we could not verify" is not "succeed".
 */

export type BatchMode = 'delete' | 'pattern' | 'ttl' | 'rename';

export interface BatchActionsOptions {
  dbSessionId: string;
  dbIndex: number;
  selectedKeys: string[];
  /** Current tree filter — the default pattern of the "delete by pattern" dialog. */
  searchPattern: string;
  /** I-8: drop exactly the keys the batch proved it handled. */
  onRemoveFromSelection: (keys: string[]) => void;
  onRefresh: () => void | Promise<void>;
  onSummary?: (summary: BatchSummaryPayload) => void;
}

export function useBatchActions({
  dbSessionId,
  dbIndex,
  selectedKeys,
  searchPattern,
  onRemoveFromSelection,
  onRefresh,
  onSummary,
}: BatchActionsOptions) {
  const { t } = useI18n();
  const { gateWrite, gateDialog } = useRedisGate();
  const [dialog, setDialog] = useState<BatchMode | null>(null);
  const [busy, setBusy] = useState(false);
  const [patternInput, setPatternInput] = useState(searchPattern);
  const [ttlInput, setTtlInput] = useState('');
  const [persistMode, setPersistMode] = useState(false);
  const [oldPrefix, setOldPrefix] = useState('');
  const [newPrefix, setNewPrefix] = useState('');
  const [matchCount, setMatchCount] = useState<CountMatchingResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const closeDialog = useCallback(() => {
    setDialog(null);
    setError(null);
    setMatchCount(null);
  }, []);

  const request = useCallback(
    (mode: BatchMode) => {
      setError(null);
      setMatchCount(null);
      if (mode === 'pattern') setPatternInput(searchPattern);
      if (mode === 'ttl') {
        setPersistMode(false);
        setTtlInput('');
      }
      if (mode === 'rename') {
        setOldPrefix('');
        setNewPrefix('');
      }
      setDialog(mode);
    },
    [searchPattern],
  );

  const loadPatternCount = async (pattern: string) => {
    try {
      const result = await invokeCountMatching(dbSessionId, dbIndex, pattern);
      setMatchCount(result);
    } catch {
      setMatchCount(null);
    }
  };

  /** Every requested key the server did *not* report as failed. */
  const releaseSucceeded = (requested: string[], failed: string[]) => {
    const dropped = new Set(failed);
    onRemoveFromSelection(requested.filter((key) => !dropped.has(key)));
  };

  const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

  const runDeleteSelected = async () => {
    if (!(await gateWrite('write-op'))) return;
    const requested = [...selectedKeys];
    setBusy(true);
    setError(null);
    try {
      const deleted = await invokeDeleteKeys(dbSessionId, dbIndex, requested);
      // `delete_keys` answers a bare count: no per-key verdict exists, so a
      // return without an exception is the only case where the whole selection
      // may leave. Partial failure is not expressible on this command.
      releaseSucceeded(requested, []);
      onSummary?.(batchSummary('delete', deleted, []));
      closeDialog();
      await onRefresh();
    } catch (e) {
      const message = messageOf(e);
      setError(message);
      onSummary?.(batchSummary('delete', 0, failuresForAllKeys(requested, message)));
    } finally {
      setBusy(false);
    }
  };

  const runDeletePattern = async () => {
    if (!(await gateWrite('write-op'))) return;
    setBusy(true);
    setError(null);
    try {
      const result = await invokeBatchDeletePattern(dbSessionId, dbIndex, patternInput);
      // The pattern is not the selection, so I-8 does not apply: leave the checks
      // alone and let the refresh show what survived.
      onSummary?.(batchSummary('delete-pattern', result.deleted, failuresFromErrors(result.errors)));
      closeDialog();
      await onRefresh();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  };

  const runBatchTtl = async () => {
    if (!(await gateWrite('write-op'))) return;
    const requested = [...selectedKeys];
    setBusy(true);
    setError(null);
    try {
      const ttl = persistMode ? -1 : parseInt(ttlInput, 10);
      if (!persistMode && (Number.isNaN(ttl!) || ttl! < 0)) {
        throw new Error(t('redis.ttlSeconds'));
      }
      const result = await invokeBatchSetTtl(dbSessionId, dbIndex, requested, ttl!);
      const failures = failuresFromErrors(result.errors);
      releaseSucceeded(requested, failedKeyNames(failures));
      onSummary?.(batchSummary('ttl', result.updated, failures));
      closeDialog();
      await onRefresh();
    } catch (e) {
      const message = messageOf(e);
      setError(message);
      onSummary?.(batchSummary('ttl', 0, failuresForAllKeys(requested, message)));
    } finally {
      setBusy(false);
    }
  };

  const runBatchRename = async () => {
    if (!(await gateWrite('write-op'))) return;
    const requested = [...selectedKeys];
    setBusy(true);
    setError(null);
    try {
      const keysArg = requested.length > 0 ? requested : undefined;
      const result = await invokeBatchRenamePrefix(
        dbSessionId,
        dbIndex,
        oldPrefix,
        newPrefix,
        keysArg,
      );
      const failures = failuresFromErrors(result.errors);
      releaseSucceeded(requested, failedKeyNames(failures));
      onSummary?.(batchSummary('rename', result.renamed, failures));
      closeDialog();
      await onRefresh();
    } catch (e) {
      const message = messageOf(e);
      setError(message);
      onSummary?.(batchSummary('rename', 0, failuresForAllKeys(requested, message)));
    } finally {
      setBusy(false);
    }
  };

  const hasSelection = selectedKeys.length > 0;
  const selectionLabel = t('redis.selectedCount').replace('{count}', String(selectedKeys.length));

  const dialogs = (
    <>
      <Dialog
        open={dialog === 'delete'}
        title={t('redis.confirmDeleteKeys')}
        description={`${selectionLabel} · db${dbIndex}`}
        onClose={closeDialog}
        footer={
          <>
            <Button
              variant="secondary"
              className="h-8 px-3 text-xs"
              data-testid="redis-batch-delete-cancel"
              onClick={closeDialog}
            >
              {t('common.cancel')}
            </Button>
            <Button
              variant="primary"
              className="h-8 px-3 text-xs"
              disabled={busy}
              data-testid="redis-batch-delete-confirm"
              onClick={() => void runDeleteSelected()}
            >
              {t('common.delete')}
            </Button>
          </>
        }
      >
        {error && <p className="text-danger" data-testid="redis-batch-error">{error}</p>}
      </Dialog>

      <Dialog
        open={dialog === 'pattern'}
        title={t('redis.confirmDeletePattern')}
        description={`db${dbIndex} · ${patternInput.trim() || '*'}`}
        onClose={closeDialog}
        footer={
          <>
            <Button
              variant="secondary"
              className="h-8 px-3 text-xs"
              data-testid="redis-batch-pattern-cancel"
              onClick={closeDialog}
            >
              {t('common.cancel')}
            </Button>
            <Button
              variant="primary"
              className="h-8 px-3 text-xs"
              disabled={busy || !patternInput.trim()}
              data-testid="redis-batch-pattern-confirm"
              onClick={() => void runDeletePattern()}
            >
              {t('common.delete')}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Input
            value={patternInput}
            onChange={(e) => {
              setPatternInput(e.target.value);
              setMatchCount(null);
            }}
            onBlur={() => void loadPatternCount(patternInput)}
            placeholder={t('redis.pattern')}
            className="h-8 font-mono text-xs"
            data-testid="redis-batch-pattern-input"
          />
          {matchCount !== null && (
            <p
              className="text-xs text-fg-muted"
              data-testid="redis-batch-pattern-count"
              data-pattern-match-count={formatMatchCount(matchCount)}
            >
              {t('redis.matchCount').replace('{count}', formatMatchCount(matchCount))}
            </p>
          )}
          {error && <p className="text-danger" data-testid="redis-batch-error">{error}</p>}
        </div>
      </Dialog>

      <Dialog
        open={dialog === 'ttl'}
        title={t('redis.confirmBatchTtl')}
        description={`db${dbIndex} · ${selectionLabel}`}
        onClose={closeDialog}
        footer={
          <>
            <Button
              variant="secondary"
              className="h-8 px-3 text-xs"
              data-testid="redis-batch-ttl-cancel"
              onClick={closeDialog}
            >
              {t('common.cancel')}
            </Button>
            <Button
              variant="primary"
              className="h-8 px-3 text-xs"
              disabled={busy}
              data-testid="redis-batch-ttl-confirm"
              onClick={() => void runBatchTtl()}
            >
              {t('common.confirm')}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={persistMode}
              data-testid="redis-batch-ttl-persist"
              onChange={(e) => setPersistMode(e.target.checked)}
            />
            {t('redis.persist')}
          </label>
          {!persistMode && (
            <Input
              value={ttlInput}
              onChange={(e) => setTtlInput(e.target.value)}
              placeholder={t('redis.ttlSeconds')}
              className="h-8 text-xs"
              data-testid="redis-batch-ttl-input"
            />
          )}
          {error && <p className="text-danger" data-testid="redis-batch-error">{error}</p>}
        </div>
      </Dialog>

      <Dialog
        open={dialog === 'rename'}
        title={t('redis.confirmBatchRename')}
        description={`db${dbIndex}`}
        onClose={closeDialog}
        footer={
          <>
            <Button
              variant="secondary"
              className="h-8 px-3 text-xs"
              data-testid="redis-batch-rename-cancel"
              onClick={closeDialog}
            >
              {t('common.cancel')}
            </Button>
            <Button
              variant="primary"
              className="h-8 px-3 text-xs"
              disabled={busy || !oldPrefix}
              data-testid="redis-batch-rename-confirm"
              onClick={() => void runBatchRename()}
            >
              {t('common.confirm')}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Input
            value={oldPrefix}
            onChange={(e) => setOldPrefix(e.target.value)}
            placeholder={t('redis.oldPrefix')}
            className="h-8 font-mono text-xs"
            data-testid="redis-batch-rename-old"
          />
          <Input
            value={newPrefix}
            onChange={(e) => setNewPrefix(e.target.value)}
            placeholder={t('redis.newPrefix')}
            className="h-8 font-mono text-xs"
            data-testid="redis-batch-rename-new"
          />
          {hasSelection && (
            <p className="text-xs text-fg-muted" data-testid="redis-batch-rename-scope">
              {selectionLabel}
            </p>
          )}
          {error && <p className="text-danger" data-testid="redis-batch-error">{error}</p>}
        </div>
      </Dialog>
      {gateDialog}
    </>
  );

  return {
    request,
    dialogs,
    activeMode: dialog,
    hasSelection,
    selectedCount: selectedKeys.length,
    busy,
  };
}

export type BatchActions = ReturnType<typeof useBatchActions>;
