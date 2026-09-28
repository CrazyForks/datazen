import { Loader2 } from 'lucide-react';
import { cn } from './cn';

/**
 * Visual size of the spinner. The names are deliberately opaque — they map 1:1
 * onto the six box sizes that were hand-written across the app, so moving a
 * call site onto `<Spinner />` keeps the exact same rendered box.
 *
 * `sm` / `md` / `lg` are the three sizes that cover the overwhelming majority
 * of call sites; `xs` / `xl` / `2xl` exist because the real code used them.
 */
export type SpinnerSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl';

export type SpinnerTone = 'current' | 'accent' | 'muted';

/** `icon` is the stroked lucide glyph; `ring` is the bordered circle. */
export type SpinnerVariant = 'icon' | 'ring';

const SIZE_CLASS: Record<SpinnerSize, string> = {
  xs: 'h-2.5 w-2.5',
  sm: 'h-3 w-3',
  md: 'h-3.5 w-3.5',
  lg: 'h-4 w-4',
  xl: 'h-5 w-5',
  '2xl': 'h-6 w-6',
};

/** The glyph is stroked, so it takes a text colour. `current` inherits. */
const ICON_TONE_CLASS: Record<SpinnerTone, string> = {
  current: '',
  accent: 'text-accent',
  muted: 'text-fg-muted',
};

/** The ring paints a border instead, so it needs its own colour scale. */
const RING_TONE_CLASS: Record<SpinnerTone, string> = {
  current: 'border-current',
  accent: 'border-accent',
  muted: 'border-fg-muted',
};

export interface SpinnerProps {
  size?: SpinnerSize;
  tone?: SpinnerTone;
  variant?: SpinnerVariant;
  /**
   * Announcement text, for the case where the spinner is the *only* thing
   * telling the user that work is in flight. Supplying it promotes the spinner
   * from decorative to a live status region carrying visually hidden text.
   *
   * Leave it unset when the spinner sits beside real copy ("Saving…", a row
   * count) or inside a container that already carries `aria-busy` /
   * `role="status"`. Announcing twice is worse than not announcing at all, and
   * a live region nested inside a `<button>` is an ARIA anti-pattern. Nearly
   * every call site is exactly that case, which is why this is opt-in.
   */
  label?: string;
  /**
   * Extra classes for the outermost rendered element. Without a `label` that
   * is the spinner glyph itself, so spacing utilities (`mr-2`, `shrink-0`)
   * land exactly where they did before. With a `label` the outer element is
   * the `role="status"` wrapper, so the same classes move up one level.
   */
  className?: string;
}

/**
 * The one loading indicator.
 *
 * Replaces the `animate-spin` markup that was hand-written at ~100 call sites
 * across the host, the drivers and the design system itself. Motion is always
 * decorative here, so by default the spinner is hidden from assistive tech and
 * the surrounding copy carries the meaning — see {@link SpinnerProps.label}
 * for the standalone case where it has to speak for itself.
 */
export function Spinner({
  size = 'md',
  tone = 'current',
  variant = 'icon',
  label,
  className,
}: SpinnerProps) {
  const box = SIZE_CLASS[size];

  const glyph = (extra: string | undefined) =>
    variant === 'ring' ? (
      <span
        aria-hidden="true"
        className={cn(
          box,
          'animate-spin rounded-full border-2',
          RING_TONE_CLASS[tone],
          'border-t-transparent',
          extra,
        )}
      />
    ) : (
      <Loader2
        aria-hidden="true"
        className={cn(box, 'animate-spin', ICON_TONE_CLASS[tone], extra)}
      />
    );

  if (label === undefined) return glyph(className);

  return (
    <span role="status" aria-busy="true" className={cn('inline-flex items-center', className)}>
      {glyph('')}
      <span className="sr-only">{label}</span>
    </span>
  );
}
