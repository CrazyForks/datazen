import { useCallback, type KeyboardEventHandler } from 'react';
import { FolderOpen } from 'lucide-react';
import { Input } from './Input';
import { Button } from './Button';
import { cn } from './cn';
import { useI18n } from './i18n';

/**
 * Structural mirror of the Tauri `OpenDialogOptions` subset this control uses.
 *
 * It is declared here rather than imported from `@tauri-apps/plugin-dialog` so
 * the design system never names a host runtime: the host supplies a
 * {@link PathPicker} that maps these fields onto the native dialog, and the
 * fields grow with the consumers rather than with any one platform's typings.
 */
export interface PathPickerDialogOptions {
  directory?: boolean;
  multiple?: boolean;
  title?: string;
  defaultPath?: string;
  filters?: Array<{ name: string; extensions: string[] }>;
}

/**
 * Opens a native path picker and resolves to the selected path, or `null` when
 * the user cancels. Provided by the embedding host (see `src/lib/pathPicker.ts`)
 * — the design system never calls a host API on its own.
 */
export type PathPicker = (options?: PathPickerDialogOptions) => Promise<string | null>;

export interface PathInputProps {
  value: string;
  onChange: (path: string) => void;
  /**
   * Required, not optional: a path input whose browse button silently does
   * nothing is worse than a compile error, and the design system has no way to
   * supply a picker itself. Every call site therefore fails type-checking until
   * it passes one.
   */
  onBrowse: PathPicker;
  placeholder?: string;
  dialogOptions?: PathPickerDialogOptions;
  disabled?: boolean;
  className?: string;
  error?: boolean;
  onKeyDown?: KeyboardEventHandler<HTMLInputElement>;
  inputTestId?: string;
}

export function PathInput({
  value,
  onChange,
  onBrowse,
  placeholder,
  dialogOptions,
  disabled,
  className,
  error,
  onKeyDown,
  inputTestId,
}: PathInputProps) {
  const { t } = useI18n();

  const handleBrowse = useCallback(async () => {
    if (disabled) return;
    try {
      const selected = await onBrowse(dialogOptions);
      if (typeof selected === 'string') {
        onChange(selected);
      }
    } catch {
      // Dialog cancelled or unavailable (e.g. browser dev mode)
    }
  }, [disabled, dialogOptions, onBrowse, onChange]);

  return (
    <div className={cn('flex w-full gap-1', className)}>
      <Input
        data-testid={inputTestId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        onKeyDown={onKeyDown}
        className={cn('min-w-0 flex-1', error && 'border-red-500')}
      />
      <Button
        variant="ghost"
        type="button"
        disabled={disabled}
        onClick={() => void handleBrowse()}
        className="h-9 w-9 shrink-0 px-0"
        title={t('common.browse')}
        aria-label={t('common.browse')}
      >
        <FolderOpen className="h-4 w-4" />
      </Button>
    </div>
  );
}
