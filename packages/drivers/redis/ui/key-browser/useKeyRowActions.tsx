import { useCallback } from 'react';
import { useI18n } from '@datazen/ui';
import { showNativeContextMenu, useBoundConfirmDialog } from '@datazen/driver-sdk';
import { buildRedisKeyContextMenuItems } from './redisKeyContextMenu';
import { invokeDeleteKeys, invokeBatchDeletePattern } from './batchInvokes';
import {
  openKeyCtxDelete,
  openKeyCtxRename,
  openKeyCtxTtl,
  type KeyCtxDialog,
} from './KeyWorkbenchDialogs';
import { useRedisGate } from '../shared/useRedisGate';
import type { KeyTreeDeleteTarget } from './KeyTreeList';

/**
 * Row-level actions of the key tree: the right-click menu and the hover/row
 * delete (single key **or** whole folder subtree).
 *
 * Extracted from the workbench wall (D-0). The gate order is load-bearing and
 * unchanged: confirm first, then `gateWrite('write-op')` — Safe Mode therefore
 * blocks before anything is sent, and cancelling the confirm never reaches the
 * write gate (PRD §4 I-6).
 */

export interface KeyRowActionsOptions {
  dbSessionId: string;
  dbIndex: number;
  /** Refresh after a successful delete so the tree drops the gone rows. */
  onRefreshKeys: () => void;
  onBatchSummary: (message: string | null) => void;
  onKeyCtxDialog: (dialog: KeyCtxDialog) => void;
}

export function useKeyRowActions({
  dbSessionId,
  dbIndex,
  onRefreshKeys,
  onBatchSummary,
  onKeyCtxDialog,
}: KeyRowActionsOptions) {
  const { t } = useI18n();
  const { gateWrite, gateDialog } = useRedisGate();
  const [confirmDelete, confirmDialog] = useBoundConfirmDialog();

  const handleKeyContextMenu = useCallback(
    (e: React.MouseEvent, key: string) => {
      e.preventDefault();
      e.stopPropagation();
      void showNativeContextMenu(
        buildRedisKeyContextMenuItems({
          labels: {
            copyKey: t('common.copyName'),
            setTtl: t('redis.setTtl'),
            rename: t('redis.renameKey'),
            delete: t('common.delete'),
          },
          handlers: {
            onCopyKey: () => {
              void navigator.clipboard.writeText(key);
            },
            onSetTtl: () => onKeyCtxDialog(openKeyCtxTtl(key)),
            onRename: () => onKeyCtxDialog(openKeyCtxRename(key)),
            onDelete: () => onKeyCtxDialog(openKeyCtxDelete(key)),
          },
        }),
        { x: e.clientX, y: e.clientY },
      );
    },
    [t, onKeyCtxDialog],
  );

  const handleDeleteRow = useCallback(
    async (target: KeyTreeDeleteTarget) => {
      const ok = await confirmDelete({
        title: t('redis.delete'),
        message:
          target.kind === 'folder'
            ? t('redis.deleteFolderConfirm')
                .replace('{count}', String(target.count))
                .replace('{label}', target.label)
            : t('redis.deleteKeyConfirm').replace('{key}', target.key),
        confirmLabel: t('common.delete'),
        cancelLabel: t('common.cancel'),
        kind: 'warning',
      });
      if (!ok) return;
      if (!(await gateWrite('write-op'))) return;
      try {
        const deleted =
          target.kind === 'folder'
            ? (await invokeBatchDeletePattern(dbSessionId, dbIndex, `${target.prefix}*`)).deleted
            : await invokeDeleteKeys(dbSessionId, dbIndex, [target.key]);
        onBatchSummary(t('redis.deleted').replace('{count}', String(deleted)));
        onRefreshKeys();
      } catch (e) {
        onBatchSummary(e instanceof Error ? e.message : String(e));
      }
    },
    [confirmDelete, gateWrite, dbSessionId, dbIndex, t, onRefreshKeys, onBatchSummary],
  );

  return {
    handleKeyContextMenu,
    handleDeleteRow,
    /** Rendered by the workbench: Safe-Mode block dialog + delete confirmation. */
    actionDialogs: (
      <>
        {gateDialog}
        {confirmDialog}
      </>
    ),
  };
}
