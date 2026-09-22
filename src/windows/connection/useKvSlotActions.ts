/**
 * Host dispatcher for KV slot actions (W3-A §1.2).
 *
 * A driver's context bar is the only place these controls live, but it may not
 * reach host capabilities directly (boundary guard R1), so every request it
 * makes arrives here and nowhere else. Three rules shape the implementation:
 *
 * 1. **One dispatcher.** The slot never learns who handled its action and the
 *    host never grows a second entry point, so "what can a context bar ask
 *    for?" has exactly one answer in the tree.
 * 2. **Unwired is not an error.** A request the host cannot carry out is a
 *    no-op plus one developer warning. Throwing would turn a Wave-4 slot that
 *    offers more than this build wires into a crashed toolbar.
 * 3. **The dangerous branch passes the existing write gate before anything
 *    else** (PRD I-6): Safe Mode blocks hard, otherwise the shared confirm
 *    dialog asks. That gate is the host's own `useConfirmDialog` +
 *    `settingsStore.safeMode` — the very primitives `@datazen/driver-sdk` binds
 *    for driver UI (`bindConfirmDialog`), so no second confirmation system is
 *    introduced. The driver workbench keeps its typed FLUSHDB confirm because
 *    *it* is the code that can actually run `flush_db`.
 *
 * `request` keeps a stable identity across renders (latest args through a ref),
 * because the host hands it inside the memoised KV slot props bundle: a churning
 * function would re-render every driver slot on every workspace render.
 */
import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import { useI18n } from '../../hooks/useI18n';
import { useConfirmDialog } from '../../hooks/useConfirmDialog';
import { useSettingsStore } from '../../stores/settingsStore';
import { openSettingsWindow } from '../../lib/windowManager';
import type { KvSlotAction } from '@datazen/driver-sdk';

/** Settings window section hosting the per-driver settings contributions. */
const DRIVER_SETTINGS_SECTION = 'extensions';

/**
 * Actions with a real host capability behind them today. Everything else in
 * {@link KvSlotAction} belongs to the drive side of the panel (creating a key,
 * importing/exporting keys, MONITOR, the scan-budget counter) or needs a driver
 * command the host must not name, so it warns instead of guessing.
 */
const WIRED_ACTIONS: readonly KvSlotAction['type'][] = ['refresh', 'openSettings'];

export interface UseKvSlotActionsArgs {
  /** Refresh the active panel — the same sink the toolbar's own refresh uses. */
  onRefresh: () => void;
}

export interface KvSlotActionDispatcher {
  /** The `request` prop handed to the context bar. */
  request: (action: KvSlotAction) => void;
  /** Confirm dialog for the dangerous branch; render next to the other dialogs. */
  dialog: ReactNode;
}

/** Copy the dangerous branch shows, by key (never inlined English). */
interface DangerCopy {
  titleKey: string;
  messageKey: string;
  /** Shown instead of the prompt while Safe Mode hard-blocks the action. */
  blockedKey: string;
}

const FLUSH_DB_COPY: DangerCopy = {
  titleKey: 'redis.kvSlot.flushTitle',
  messageKey: 'redis.kvSlot.flushMessage',
  blockedKey: 'redis.kvSlot.flushBlocked',
};

/** Warn exactly once per request, naming the action and what is wired. */
function warnUnwired(action: KvSlotAction): void {
  console.warn(
    `[kv-slot-actions] no host handler for "${action.type}" ` +
      `(wired: ${WIRED_ACTIONS.join(', ')}); ignored. A driver slot may offer it, ` +
      'but nothing will happen until the host wires it.',
  );
}

export function useKvSlotActions({ onRefresh }: UseKvSlotActionsArgs): KvSlotActionDispatcher {
  const { t } = useI18n();
  const [confirm, dialog] = useConfirmDialog();

  // Latest `t` / `onRefresh` without folding them into `request`'s identity.
  const latest = useRef({ t, onRefresh });
  useEffect(() => {
    latest.current = { t, onRefresh };
  });

  /**
   * PRD I-6 for a dangerous action: `true` only when the user may proceed.
   * Safe Mode is read live at call time (a dialog can sit open while the user
   * flips the setting), which is how the driver gate this reuses behaves.
   */
  const gateDangerous = useCallback(
    async (copy: DangerCopy): Promise<boolean> => {
      const translate = latest.current.t;
      if (useSettingsStore.getState().settings.safeMode) {
        await confirm({
          title: translate('settings.safeMode'),
          message: translate(copy.blockedKey),
          confirmLabel: translate('common.dismiss'),
          kind: 'info',
        });
        return false;
      }
      return confirm({
        title: translate(copy.titleKey),
        message: translate(copy.messageKey),
        confirmLabel: translate('common.confirm'),
        kind: 'warning',
      });
    },
    [confirm],
  );

  const request = useCallback(
    (action: KvSlotAction) => {
      switch (action.type) {
        case 'refresh':
          latest.current.onRefresh();
          return;
        case 'openSettings':
          openSettingsWindow(DRIVER_SETTINGS_SECTION);
          return;
        case 'flushDb':
          // The gate runs first, always: an unwired executor must never become a
          // way to skip it. Approving only gets as far as the warning below —
          // running FLUSHDB is the driver's `flush_db` command, and the host
          // naming a driver command is the hardcoding PRD §7-4 forbids. Whoever
          // wires an executor adds it to this branch, behind the same gate.
          void gateDangerous(FLUSH_DB_COPY).then((approved) => {
            if (approved) warnUnwired(action);
          });
          return;
        case 'newKey':
        case 'import':
        case 'export':
        case 'openMonitor':
        case 'setScanBudget':
        default:
          warnUnwired(action);
      }
    },
    [gateDangerous],
  );

  return { request, dialog };
}
