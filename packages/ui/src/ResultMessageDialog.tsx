import { useCallback } from 'react';
import { AlertCircle, Check, CheckCircle2, Copy } from 'lucide-react';
import { useI18n } from './i18n';
import { Button } from './Button';
import { Dialog } from './Dialog';
import { useCopyFeedback } from './useCopyFeedback';

export interface ResultMessageDialogProps {
  open: boolean;
  kind: 'error' | 'success';
  message: string;
  /**
   * Accessible label for the header close button. Defaults to the localized
   * `common.close`; pass an explicit non-empty value to override it.
   */
  closeLabel?: string;
  onClose: () => void;
}

/** How long the "Copied" confirmation stays visible before reverting. */
const COPIED_FEEDBACK_MS = 1500;

/** Compact success/error alert with an explicit dismiss button. */
export function ResultMessageDialog({
  open,
  kind,
  message,
  closeLabel,
  onClose,
}: ResultMessageDialogProps) {
  const { t } = useI18n();
  const { copied, copy } = useCopyFeedback(COPIED_FEEDBACK_MS);

  const handleCopy = useCallback(() => copy(message), [copy, message]);

  return (
    <Dialog
      open={open}
      title={kind === 'error' ? t('common.error') : t('common.success')}
      onClose={onClose}
      className="max-w-sm"
      closeLabel={closeLabel || t('common.close')}
      footer={
        <div className="flex w-full items-center justify-between gap-2">
          {kind === 'error' ? (
            <button
              type="button"
              data-testid="result-message-copy"
              className="flex items-center gap-1 rounded px-2 py-1 text-xs text-fg-muted hover:bg-surface-raised hover:text-fg"
              onClick={handleCopy}
              title={t('common.copy')}
            >
              {copied ? (
                <>
                  <Check className="h-3.5 w-3.5 text-success" />
                  <span>{t('common.copied')}</span>
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5" />
                  <span>{t('common.copy')}</span>
                </>
              )}
            </button>
          ) : (
            <div />
          )}
          <Button
            variant="primary"
            className="h-8 px-3 text-xs"
            onClick={onClose}
            data-testid="result-message-ok"
          >
            {t('common.ok')}
          </Button>
        </div>
      }
    >
      <div className="flex items-start gap-3">
        {kind === 'error' ? (
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-danger" aria-hidden="true" />
        ) : (
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" aria-hidden="true" />
        )}
        <p className="selectable select-text whitespace-pre-wrap break-words text-sm text-fg-secondary">
          {message}
        </p>
      </div>
    </Dialog>
  );
}
