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
 * WARNING — the variant tints below are the *native* Tailwind `red-500` /
 * `red-400` shades, not the project's `danger` token. They were chosen to
 * reproduce the error bars this component absorbed, and that is deliberate.
 *
 * The trap: these are baked into the variant, so a call site that was using
 * the `danger` token does **not** get it back by passing its own colour.
 * `className` only overrides what it names. Re-specifying the text colour
 * alone leaves the *background and border on the `red-500` shades* — two
 * visibly different reds for what the user reads as the same kind of failure
 * (measured ΔE76 ≈ 9.6 on the border: clearly visible).
 *
 * So a `danger`-token call site must restate **background and border as well
 * as text**. `StringEditor`'s save error is the worked example:
 * `className="border-danger/20 bg-danger/10 px-2 py-1.5 text-base text-danger"`.
 * `text-base` is there for the same reason — `boxed` carries `text-xs`, and
 * that call site inherited 16px.
 *
 * Migrating the variants themselves onto the `danger` token is a repo-wide
 * colour-system decision (200+ call sites) and is deliberately out of scope
 * here; until it happens, this contract has to be honoured per call site.
 */
const variants: Record<ErrorBannerVariant, string> = {
  plain: 'text-xs text-red-400',
  boxed: 'rounded-md border border-red-500/20 bg-red-500/10 p-2 text-xs text-red-400',
  strip: 'border-b border-red-500/20 bg-red-500/10 px-3 py-1.5 text-xs text-red-400',
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
          className="shrink-0 rounded px-1 text-red-200 hover:bg-red-500/20"
          aria-label={dismissLabel}
          onClick={onDismiss}
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      ) : null}
    </Tag>
  );
}
