/**
 * The `data-*` passthrough contract shared by this design system's
 * closed-prop components (`Select`, and the other components that declare an
 * explicit prop list instead of extending a DOM `*Attributes` type).
 *
 * ## Why this exists
 *
 * A component that destructures only the props it declares and forwards
 * nothing else silently discards every other prop a caller passes. In JSX,
 * hyphenated attribute names are exempt from TypeScript's excess-property
 * check, so `<Select data-testid="connection-picker" />` type-checks cleanly,
 * survives `createElement`, and then vanishes at render. The element the
 * locator was meant to mark does not exist, and a query for it matches
 * nothing — so a test written that way goes green while verifying nothing.
 *
 * The project rule that clicks and selections are bound through DOM `data-*`
 * attributes (rather than viewport geometry) is unimplementable on such a
 * component until this passthrough exists.
 *
 * ## Why the passthrough is narrow
 *
 * Forwarding `...rest` wholesale would fix `data-testid` and introduce two
 * new failures:
 *
 * 1. Non-DOM props (`options`, a mistyped `onFoo`, a component-only flag)
 *    would land on a DOM node and trigger React unknown-attribute warnings.
 * 2. Widening the prop type to `[key: string]` would turn today's *compile
 *    errors* for typos such as `dataTestId` or `onchane` into silently
 *    ignored props — trading a loud type error for a quiet test that cannot
 *    fail.
 *
 * So the contract is deliberately narrow on both sides:
 *
 * - **Type level** — a *pattern* index signature,
 *   ``[key: `data-${string}`]: string | undefined``. TypeScript applies
 *   excess-property checking against pattern index signatures, so
 *   `data-testid` and `data-foo` are accepted while `dataTestId` and
 *   `onchane` remain compile errors. A broad `[key: string]` would lose that.
 * - **Runtime level** — `splitDataAttrs` forwards the `data-*` keys and
 *   reports everything else as unknown, instead of leaking it onto the DOM.
 *
 * A pattern index signature cannot help a prop that arrives through a spread
 * (`{...rest}` is not subject to excess-property checking), so components
 * using this contract also report the unknown keys in development. That is
 * the second rail, and it is the only one that covers the spread path.
 */

/**
 * `data-*` attributes a caller passes straight through to a component.
 *
 * Declared as a pattern index signature on purpose: TypeScript's
 * excess-property check honours the `data-` prefix, so typos that drop the
 * hyphen (`dataTestId`) or misspell a declared prop (`onchane`) still fail
 * to compile.
 */
export interface DataAttrProps {
  readonly [key: `data-${string}`]: string | undefined;
}

const DATA_ATTR_PREFIX = 'data-';

export interface SplitDataAttrs {
  /** Safe to spread onto a DOM node. */
  readonly data: Record<string, string>;
  /** Keys that are neither declared props nor `data-*`; dropped, never spread. */
  readonly unknown: readonly string[];
}

/**
 * Split a component's `...rest` into the `data-*` attributes that may reach
 * the DOM and the keys that may not.
 */
export function splitDataAttrs(props: object): SplitDataAttrs {
  const data: Record<string, string> = {};
  const unknown: string[] = [];
  for (const [key, value] of Object.entries(props)) {
    if (key.startsWith(DATA_ATTR_PREFIX)) {
      if (value !== undefined) data[key] = String(value);
      continue;
    }
    unknown.push(key);
  }
  return { data, unknown };
}
