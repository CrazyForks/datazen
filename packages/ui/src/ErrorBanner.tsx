import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from './cn';

/**
 * How much chrome the banner carries. The three shapes are what the call
 * sites actually use, not a designer-imposed scale:
 *  - `plain` — an inline line of red text next to the thing that failed
 *    (form footers, list headers). The default.
 *  - `boxed` — a self-contained tinted card for a message that needs to read
 *    as its own block (a dialog's submit error).
 *  - `strip` — a full-bleed band that separates one region of a page from the
 *    next, so it is flush with the edges and carries a bottom rule.
 */
export type ErrorBannerVariant = 'plain' | 'boxed' | 'strip';

/**
 * Which host element to render. Some call sites sit inside a `<p>`-only
 * context or an inline flex row where a `div` would break the flow.
 */
export type ErrorBannerElement = 'div' | 'p' | 'span';

/**
 * The variants use the project's `danger` token — `text-danger` /
 * `bg-danger/10` / `border-danger/20` all resolve to `var(--c-danger)`
 * (`tailwind.config.ts` defines `danger: { DEFAULT: 'var(--c-danger)' }`,
 * and `themes.css` re-points `--c-danger` per theme). Do not reintroduce
 * literal Tailwind `red-*` shades here: those are theme-blind, so a variant
 * built on them bypasses the theme mechanism entirely.
 *
 * The same rule governs the dismiss button's own styling, further down:
 * it was `text-red-200 hover:bg-red-500/20` and is now
 * `text-danger hover:bg-danger/20`. **That is a deliberately visible change**,
 * not a pure cleanup: a literal shade is a different, fixed colour, so moving
 * it onto the token shifts the button's rendered colour (measured ΔL* −31.2
 * light / −18.8 dark). It is accepted for the same reason the variants moved —
 * the old value ignored the active theme — but it is not colour-preserving, and
 * the per-variant recolouring of every call site is likewise a visible change
 * rather than a no-op refactor.
 *
 * The remaining trap is the same as for any `className` override: **the
 * variant is baked in, and `className` only overrides the properties it
 * names.** A call site that wants a different alpha or a different shade
 * must restate **background and border as well as text** — restating only
 * the text colour leaves the background and border on the variant's.
 */
const variants: Record<ErrorBannerVariant, string> = {
  plain: 'text-xs text-danger',
  boxed: 'rounded-md border border-danger/20 bg-danger/10 p-2 text-xs text-danger',
  strip: 'border-b border-danger/20 bg-danger/10 px-3 py-1.5 text-xs text-danger',
};

type ErrorBannerBaseProps = {
  children: ReactNode;
  /** Defaults to `plain`. */
  variant?: ErrorBannerVariant;
  /** Defaults to `div`. */
  as?: ErrorBannerElement;
  /** Leading glyph. Supplying one puts the banner into a flex row. */
  icon?: ReactNode;
  /** Extra layout classes for the call site; merged over the variant's. */
  className?: string;
  'data-testid'?: string;
  'data-i18n-key'?: string;
};

/**
 * Dismissal is all-or-nothing at the type level: a close control without a
 * label is an unlabelled button, and auto-translating the label here would
 * quietly take the wording decision away from the call site.
 */
type ErrorBannerDismissProps =
  | { onDismiss?: undefined; dismissLabel?: undefined }
  | { onDismiss: () => void; dismissLabel: string };

export type ErrorBannerProps = ErrorBannerBaseProps & ErrorBannerDismissProps;

/**
 * The one error bar. `role="alert"` is fixed here — a banner that has to be
 * announced when it appears cannot leave that to each call site to remember.
 *
 * Call sites own their *text*: pass `children` that already went through
 * `t()`. This component deliberately does not translate, so extracting a
 * banner can never silently change or drop a string at a call site.
 *
 * Not for warnings. Amber/`text-warning` notices that are announced with
 * `role="alert"` are a different message with a different meaning, and
 * rendering them through an error component would mislabel them.
 */
export function ErrorBanner({
  children,
  variant = 'plain',
  as = 'div',
  icon,
  onDismiss,
  dismissLabel,
  className,
  'data-testid': testId,
  'data-i18n-key': i18nKey,
}: Readonly<ErrorBannerProps>) {
  const Tag = as;
  // Icon and dismiss control need a row so the glyph and the button stay
  // aligned with the first line of a message that wraps.
  const isRow = Boolean(icon) || Boolean(onDismiss);

  const body = isRow ? (
    <span className="select-text min-w-0 flex-1 break-words">{children}</span>
  ) : (
    children
  );

  return (
    <Tag
      role="alert"
      className={cn(variants[variant], isRow && 'flex items-start gap-2', className)}
      data-testid={testId}
      data-i18n-key={i18nKey}
    >
      {icon}
      {body}
      {onDismiss && dismissLabel ? (
        <button
          type="button"
          className="shrink-0 rounded px-1 text-danger hover:bg-danger/20"
          aria-label={dismissLabel}
          onClick={onDismiss}
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      ) : null}
    </Tag>
  );
}
