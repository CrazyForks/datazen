import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@datazen/ui';
import { useI18n } from '@datazen/ui';
import {
  useBoundSettingsStore,
  resolveEditorFontFamily,
  HOST_DEFAULT_EDITOR_FONT,
  readBooleanField,
} from '@datazen/driver-sdk';
import { redisCommandInvoke } from '../shared/redisInvoke';
import { assessCommand, classifyDangerLevel, isFlushCommand } from './redisConsoleDanger';
import {
  assessCommands,
  badgeAssessment,
  composeBlockedMessage,
  describeCommands,
} from './consoleCommandBatch';
import { RedisConsoleDangerBadge, dangerBorderClass } from './RedisConsoleDangerBadge';
import {
  ConsoleResultView,
  inferResultType,
  type ConsoleResultItem,
} from './consoleResultRenderer';
import { useRedisGate } from '../shared/useRedisGate';
import { SafeModeBadge } from '../shared/SafeModeBadge';
import {
  loadConsoleHistory,
  navigateConsoleHistory,
  pushConsoleHistory,
  type HistoryNavigationState,
} from './consoleHistory';
import { useCompletion } from './consoleCompletion/useCompletion';
import { CompletionPopup } from './consoleCompletion/CompletionPopup';
import { ClusterNodePicker } from '../connection/ClusterNodePicker';
import { readClusterRouting, resolvePinnedNodeAddr } from '../connection/settingsHelpers';

export interface RedisConsoleProps {
  dbSessionId: string;
  dbIndex?: number;
  keySuggestions?: string[];
  pinnedNodeAddr?: string;
  onPinnedNodeAddrChange?: (addr: string) => void;
}

interface ExecResult {
  command: string;
  ok: boolean;
  value?: string;
  error?: string;
  /** Server-classified result shape (`scalar` | `array` | `map` | `ok` | `nil` | `error`). */
  resultType?: string;
  /** Server-side danger level, echoed for parity with the client classifier. */
  dangerLevel?: string;
}

interface ExecResponse {
  results: ExecResult[];
}

function applyCompletion(
  text: string,
  tokenStart: number,
  tokenEnd: number,
  completion: string,
): { text: string; cursor: number } {
  const nextText = `${text.slice(0, tokenStart)}${completion} ${text.slice(tokenEnd)}`;
  const nextCursor = tokenStart + completion.length + 1;
  return { text: nextText, cursor: nextCursor };
}

const RESULT_TYPES: readonly string[] = ['scalar', 'array', 'map', 'ok', 'nil', 'error'];

/**
 * Map one server `exec` result onto the pure renderer's props. The server's own
 * `resultType` wins; `inferResultType` is only the fallback for servers that do
 * not send the field (P0-3: the Console used to drop it and re-guess shapes).
 */
function toConsoleResultItem(result: ExecResult): ConsoleResultItem {
  const fromServer = result.resultType && RESULT_TYPES.includes(result.resultType);
  return {
    command: result.command,
    ok: result.ok,
    value: result.value,
    error: result.error,
    resultType: (fromServer ? result.resultType : inferResultType(result.value)) as ConsoleResultItem['resultType'],
    dangerLevel: classifyDangerLevel(result.command),
  };
}

export function RedisConsole({
  dbSessionId,
  dbIndex = 0,
  keySuggestions = [],
  pinnedNodeAddr = '',
  onPinnedNodeAddrChange,
}: RedisConsoleProps) {
  const { t } = useI18n();
  const driverSettings = useBoundSettingsStore((s) => s.settings.driverSettings);
  const clusterRouting = readClusterRouting(driverSettings?.redis);
  const allowFlush = readBooleanField(
    (driverSettings?.redis ?? {}) as Record<string, unknown>,
    'allowFlush',
    false,
  );
  const { gateWrite, gateDialog } = useRedisGate();
  const nodeAddr = resolvePinnedNodeAddr(clusterRouting, pinnedNodeAddr);
  const editorFontFamily = useBoundSettingsStore(
    (s) => s.settings.editorFontFamily || HOST_DEFAULT_EDITOR_FONT,
  );
  const fontFamily = resolveEditorFontFamily(editorFontFamily, '', HOST_DEFAULT_EDITOR_FONT);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [commands, setCommands] = useState('');
  const [cursor, setCursor] = useState(0);
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<ExecResult[]>([]);
  const [activeResultIdx, setActiveResultIdx] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [historyState, setHistoryState] = useState<HistoryNavigationState>({
    index: null,
    draft: '',
  });
  const [history, setHistory] = useState<string[]>([]);
  const [completionActive, setCompletionActive] = useState(0);
  const [completionDismissed, setCompletionDismissed] = useState(false);

  useEffect(() => {
    setHistory(loadConsoleHistory(dbSessionId));
    setCommands('');
    setResults([]);
    setError(null);
    setHistoryState({ index: null, draft: '' });
  }, [dbSessionId]);

  const completion = useCompletion({
    text: commands,
    cursor,
    dbSessionId,
    dbIndex,
    prewarmKeys: keySuggestions,
  });
  const completions = completion.items;
  const completionOpen = completion.open && !completionDismissed;

  useEffect(() => {
    setCompletionActive(0);
  }, [commands, cursor]);

  useEffect(() => {
    setCompletionDismissed(false);
  }, [commands, cursor]);

  const acceptCompletion = useCallback(
    (index: number) => {
      const item = completions[index];
      if (!item) return;
      const applied = applyCompletion(
        commands,
        completion.tokenStart,
        completion.tokenEnd,
        item.insertText,
      );
      setCommands(applied.text);
      requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (el) {
          el.selectionStart = applied.cursor;
          el.selectionEnd = applied.cursor;
        }
      });
      setCursor(applied.cursor);
    },
    [commands, completions, completion.tokenStart, completion.tokenEnd],
  );

  const syncCursor = useCallback(() => {
    const el = textareaRef.current;
    if (el) setCursor(el.selectionStart ?? 0);
  }, []);

  const handleExecute = useCallback(async () => {
    const trimmed = commands.trim();
    if (!trimmed || running) return;

    // PRD I-7: classify the whole batch. A multi-line paste used to be graded by
    // its first line only, which let `GET a\nDEL b` through with no brake at all.
    const batch = assessCommands(trimmed, allowFlush);

    if (batch.blocked.length > 0) {
      // Refuse before the gate: a confirmation dialog is not a release valve for
      // the blocked tier (task book §1.2 "不可仅弹确认放行"). FLUSHDB/FLUSHALL
      // keep their dedicated copy, which explains the Allow Flush opt-in.
      const flushOnly = batch.blocked.every((command) => isFlushCommand(command.name));
      setError(flushOnly ? t('redis.console.flushBlocked') : composeBlockedMessage(batch, t));
      return;
    }

    // R-3 (task book §6.1): one confirmation for the whole batch, listing every
    // danger-tier-and-above command, then a second one for the surviving
    // ultra-danger commands (FLUSHDB/FLUSHALL with the allowFlush opt-in).
    const confirmTargets = [...batch.confirmations, ...batch.doubleConfirmations];
    if (confirmTargets.length > 0) {
      const listing = describeCommands(confirmTargets);
      if (!(await gateWrite('danger', listing))) return;
      for (const command of batch.doubleConfirmations) {
        if (!(await gateWrite('ultra-danger', command.raw))) return;
      }
    } else if (batch.worst !== 'safe') {
      // Pure write / read batch: still route through the gate so Safe Mode can
      // refuse the write path (I-6 semantics, unchanged).
      if (!(await gateWrite(batch.worst, trimmed))) return;
    }

    setRunning(true);
    setError(null);
    setResults([]);
    setActiveResultIdx(0);
    setHistoryState({ index: null, draft: trimmed });

    try {
      const response = await redisCommandInvoke<ExecResponse>('redis', 'exec', {
        dbSessionId,
        dbIndex,
        commands: trimmed,
        nodeAddr,
      });
      setResults(response.results ?? []);
      setHistory(pushConsoleHistory(dbSessionId, trimmed));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  }, [commands, dbSessionId, dbIndex, nodeAddr, running, allowFlush, gateWrite, t]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      const isMod = event.metaKey || event.ctrlKey;

      if (completionOpen) {
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          setCompletionActive((idx) => (idx + 1) % completions.length);
          return;
        }
        if (event.key === 'ArrowUp') {
          event.preventDefault();
          setCompletionActive((idx) => (idx - 1 + completions.length) % completions.length);
          return;
        }
        if (event.key === 'Tab') {
          event.preventDefault();
          acceptCompletion(completionActive);
          return;
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          setCompletionDismissed(true);
          return;
        }
        // Any other key (including Enter) falls through to the handlers below;
        // the popup will close itself once the text/cursor changes.
      }

      // Plain Enter (or Cmd/Ctrl+Enter) executes the command.
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        void handleExecute();
        return;
      }

      if (event.key === 'ArrowUp' && !isMod) {
        const el = event.currentTarget;
        const atLineStart =
          el.selectionStart === el.selectionEnd &&
          el.selectionStart === commands.lastIndexOf('\n', Math.max(0, el.selectionStart - 1)) + 1;
        if (atLineStart || historyState.index !== null) {
          event.preventDefault();
          const next = navigateConsoleHistory(history, historyState, 'up');
          setHistoryState({ index: next.index, draft: next.draft });
          setCommands(next.text);
          return;
        }
      }

      if (event.key === 'ArrowDown' && !isMod) {
        if (historyState.index !== null) {
          event.preventDefault();
          const next = navigateConsoleHistory(history, historyState, 'down');
          setHistoryState({ index: next.index, draft: next.draft });
          setCommands(next.text);
          return;
        }
      }
    },
    [
      completionOpen,
      completions.length,
      completionActive,
      acceptCompletion,
      commands,
      handleExecute,
      history,
      historyState,
    ],
  );

  const activeResult = results[activeResultIdx];
  const failedCount = results.reduce((count, result) => (result.ok ? count : count + 1), 0);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* ── top toolbar ──────────────────────────────────────────────── */}
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-edge bg-surface-alt px-3">
        <span className="text-[11px] text-fg-muted">{t('redis.console.hint')}</span>
        {commands.trim() && (
          <RedisConsoleDangerBadge assessment={badgeAssessment(commands, allowFlush)} t={t} />
        )}
        <div className="flex-1" />
        <SafeModeBadge />
        <ClusterNodePicker
          dbSessionId={dbSessionId}
          compact
          value={pinnedNodeAddr}
          onChange={onPinnedNodeAddrChange}
        />
      </div>

      {/* ── results area (scrollable, top) ───────────────────────────── */}
      <div className="flex min-h-0 flex-1 flex-col overflow-auto">
        {running && (
          <div className="flex flex-1 items-center justify-center gap-2 text-fg-muted">
            <Loader2 className="h-5 w-5 animate-spin" />
            {t('query.executing')}
          </div>
        )}

        {error && !running && (
          <div className="flex-1 overflow-auto p-4">
            <div
              className="whitespace-pre-line rounded-md border border-danger/20 bg-danger/10 px-4 py-3 text-sm text-danger"
              data-testid="redis-console-error"
            >
              {error}
            </div>
          </div>
        )}

        {results.length > 0 && !running && (
          <>
            {failedCount > 0 && (
              <div
                className="shrink-0 border-b border-danger/20 bg-danger/10 px-3 py-1 text-xs text-danger"
                data-testid="redis-console-failed-count"
              >
                {t('redis.errorsCount', { count: String(failedCount) })}
              </div>
            )}
            {results.length > 1 && (
              <div className="flex shrink-0 items-center border-b border-edge bg-surface-alt px-1">
                {results.map((result, idx) => (
                  <button
                    key={`${result.command}-${idx}`}
                    type="button"
                    className={cn(
                      'relative max-w-[220px] truncate border-l-2 px-3 py-1.5 text-xs transition-colors',
                      dangerBorderClass(assessCommand(result.command)),
                      idx === activeResultIdx
                        ? 'text-fg font-medium'
                        : 'text-fg-muted hover:text-fg-secondary',
                    )}
                    title={result.command}
                    onClick={() => setActiveResultIdx(idx)}
                  >
                    {t('query.result')} {idx + 1}
                    <span
                      className={cn(
                        'ml-1.5 text-[10px]',
                        result.ok ? 'text-success/80' : 'text-danger',
                      )}
                    >
                      {result.ok ? 'OK' : 'ERR'}
                    </span>
                    <span
                      className={cn(
                        'absolute inset-x-0 bottom-0 h-0.5 bg-accent transition-opacity duration-300',
                        idx === activeResultIdx ? 'opacity-100' : 'opacity-0',
                      )}
                    />
                  </button>
                ))}
              </div>
            )}

            {activeResult && (
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                <div
                  className={cn(
                    'flex items-center gap-3 border-b border-l-2 border-edge bg-surface-alt px-3 py-1.5 text-xs text-fg-secondary',
                    dangerBorderClass(assessCommand(activeResult.command)),
                  )}
                >
                  <span className="font-mono">{activeResult.command}</span>
                  <span className="text-edge">|</span>
                  <span className={activeResult.ok ? 'text-success/90' : 'text-danger'}>
                    {activeResult.ok ? t('redis.console.ok') : t('redis.console.failed')}
                  </span>
                </div>
                <div
                  className="min-h-0 flex-1 overflow-auto p-4"
                  data-testid="redis-console-result"
                >
                  <ConsoleResultView item={toConsoleResultItem(activeResult)} />
                </div>
              </div>
            )}
          </>
        )}

        {results.length === 0 && !running && !error && (
          <div className="flex flex-1 items-center justify-center text-sm text-fg-muted">
            {t('redis.console.empty')}
          </div>
        )}
      </div>

      {/* ── input bar (terminal-style, bottom) ───────────────────────── */}
      <div className="relative shrink-0 border-t border-edge" style={{ minHeight: 48 }}>
        <div className="flex items-stretch bg-surface">
          <span
            className="flex shrink-0 items-center pl-3 pr-1 font-mono text-[13px] text-accent select-none"
            aria-hidden="true"
          >
            db{dbIndex}&gt;
          </span>
          <textarea
            ref={textareaRef}
            value={commands}
            data-testid="redis-console-input"
            onChange={(e) => {
              setCommands(e.target.value);
              setHistoryState((prev) =>
                prev.index === null ? { ...prev, draft: e.target.value } : prev,
              );
              setCursor(e.target.selectionStart ?? 0);
            }}
            onClick={syncCursor}
            onKeyUp={syncCursor}
            onKeyDown={handleKeyDown}
            spellCheck={false}
            placeholder={t('redis.console.placeholder')}
            rows={1}
            className="min-h-[48px] w-full resize-none bg-transparent py-3 pr-4 text-[13px] text-fg outline-none"
            style={{
              fontFamily: `${fontFamily}, ui-monospace, SFMono-Regular, Menlo, monospace`,
              height: 'auto',
              overflowY: commands.split('\n').length > 3 ? 'auto' : 'hidden',
            }}
          />
        </div>
        {completionOpen && (
          <CompletionPopup
            items={completions}
            activeIndex={completionActive}
            loading={completion.loading}
            onHover={(index) => setCompletionActive(index)}
            onAccept={acceptCompletion}
          />
        )}
      </div>
      {gateDialog}
    </div>
  );
}
