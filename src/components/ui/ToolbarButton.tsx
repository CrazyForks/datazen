import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Button } from './Button';
import { cn } from '../../lib/cn';

export interface ToolbarButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  compact?: boolean;
  label: string;
  icon: ReactNode;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'run';
  /**
   * Icon-only presentation: the text is dropped from the layout and survives
   * only as `title` / `aria-label`. Unlike `compact` this is a fixed decision
   * made by the caller, not a response to the responsive compact toggle.
   */
  iconOnly?: boolean;
}

export function ToolbarButton({
  compact = false,
  label,
  icon,
  variant = 'ghost',
  className,
  title,
  iconOnly = false,
  ...props
}: ToolbarButtonProps) {
  return (
    <Button
      {...props}
      variant={variant}
      title={title ?? label}
      aria-label={label}
      className={cn(
        'shrink-0',
        iconOnly
          ? 'h-7 w-7 justify-center gap-0 p-0'
          : compact
            ? 'h-7 px-1.5'
            : 'h-7 gap-1 px-2 text-xs',
        className,
      )}
    >
      {icon}
      {!iconOnly && <span className={cn(compact && 'sr-only')}>{label}</span>}
    </Button>
  );
}
