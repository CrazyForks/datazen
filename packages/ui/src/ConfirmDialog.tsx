import { AlertTriangle, Copy } from 'lucide-react';
import { useCallback } from 'react';
import { Button } from './Button';
import { Dialog } from './Dialog';
import { useI18n } from './i18n';
import { useCopyFeedback } from './useCopyFeedback';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  kind?: 'warning' | 'info';
  /** Optional badge/tag displayed next to the title (e.g. "Production", "High risk"). */
  badge?: string;
  /** Optional SQL code preview section (truncated for display; copy button available). */
  codePreview?: string;
  /** Optional longer description displayed below the message. */
  description?: string;
  /**
   * Accessible label for the header close button. Defaults to the localized
   * `common.close`; pass an explicit non-empty value to override it.
   */
  closeLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

const CODE_PREVIEW_MAX_LINES = 12;
const CODE_PREVIEW_MAX_CHARS = 2000;

/**
 * Longer than the other copy affordances in this package: this one sits inside
 * a confirmation for a destructive action, so the user gets more time to notice
 * what they just copied.
 */
const COPIED_FEEDBACK_MS = 2000;

function truncateCodePreview(raw: string): { text: string; truncated: boolean } {
  const lines = raw.split('\n');
  if (lines.length <= CODE_PREVIEW_MAX_LINES && raw.length <= CODE_PREVIEW_MAX_CHARS) {
    return { text: raw, truncated: false };
  }
  const truncated = lines.slice(0, CODE_PREVIEW_MAX_LINES).join('\n');
  return { text: truncated, truncated: true };
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel,
  kind = 'warning',
  badge,
  codePreview,
  description,
  closeLabel,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const { t } = useI18n();
  const { copied, copy } = useCopyFeedback(COPIED_FEEDBACK_MS);

  const handleCopy = useCallback(() => {
    if (!codePreview) return;
    copy(codePreview);
  }, [copy, codePreview]);

  const preview = codePreview ? truncateCodePreview(codePreview) : null;

  return (
    <Dialog
      open={open}
      title={title}
      onClose={onCancel}
      className="max-w-lg"
      closeLabel={closeLabel || t('common.close')}
      footer={
        <>
          <Button
            variant="ghost"
            className="h-8 px-3 text-xs"
            onClick={onCancel}
            data-testid="confirm-dialog-cancel"
          >
            {cancelLabel ?? t('common.cancel')}
          </Button>
          <Button
            variant={kind === 'warning' ? 'danger' : 'primary'}
            className="h-8 px-3 text-xs"
            onClick={onConfirm}
            data-testid="confirm-dialog-ok"
          >
            {confirmLabel ?? t('common.confirm')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="flex items-start gap-3">
          {kind === 'warning' && (
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="text-sm text-fg-secondary">{message}</p>
              {badge && (
                <span className="inline-flex shrink-0 items-center rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-400">
                  {badge}
                </span>
              )}
            </div>
            {description && <p className="mt-1 text-xs text-fg-muted">{description}</p>}
          </div>
        </div>

        {preview && (
          <div className="rounded-md border border-edge bg-surface-alt">
            <div className="flex items-center justify-between border-b border-edge px-3 py-1.5">
              <span className="text-[10px] text-fg-muted">
                {preview.truncated &&
                  t('query.editor.executionConfirm.previewTruncated', {
                    lines: CODE_PREVIEW_MAX_LINES,
                  })}
              </span>
              <button
                type="button"
                onClick={handleCopy}
                className="flex items-center gap-1 text-[10px] text-fg-muted hover:text-fg"
                data-testid="confirm-dialog-copy-sql"
              >
                <Copy className="h-3 w-3" />
                {copied ? '✓' : t('query.editor.executionConfirm.copySql')}
              </button>
            </div>
            <pre className="max-h-40 overflow-auto p-3 font-mono text-xs text-fg-secondary">
              {preview.text}
              {preview.truncated && '\n…'}
            </pre>
          </div>
        )}
      </div>
    </Dialog>
  );
}
