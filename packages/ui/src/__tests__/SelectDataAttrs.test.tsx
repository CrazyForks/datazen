import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Select, type SelectProps } from '../Select';

afterEach(cleanup);

const OPTIONS = [
  { value: 'http', label: 'HTTP' },
  { value: 'https', label: 'HTTPS' },
];

/**
 * `Select` declares an explicit prop list, so before the `data-*` passthrough
 * every prop it does not destructure was discarded. Hyphenated JSX attribute
 * names are exempt from TypeScript's excess-property check, which is why the
 * defect was invisible: `data-testid` compiled, reached `createElement`, and
 * then vanished at render — leaving a locator that matches nothing, and a test
 * that therefore passes while verifying nothing.
 */
describe('@datazen/ui Select data-* forwarding', () => {
  it('puts a caller-supplied data-testid on the clickable listbox trigger', () => {
    render(
      <Select value="http" options={OPTIONS} onChange={() => {}} data-testid="connection-picker" />,
    );

    const trigger = screen.getByTestId('connection-picker');
    // The real interactive target, not a wrapper around it.
    expect(trigger.tagName).toBe('BUTTON');
    expect(trigger).toHaveAttribute('aria-haspopup', 'listbox');
  });

  it('puts a caller-supplied data-testid on the combobox input, not the wrapper', () => {
    render(
      <Select
        value="http"
        options={OPTIONS}
        onChange={() => {}}
        searchable
        data-testid="connection-picker"
      />,
    );

    const trigger = screen.getByTestId('connection-picker');
    expect(trigger.tagName).toBe('INPUT');
    expect(trigger).toHaveAttribute('role', 'combobox');
    // The previous placement was a non-interactive wrapper div one level above
    // the control, so a locator there addressed nothing you can click or type
    // into — the same defect, one level down.
    expect(trigger.parentElement).not.toHaveAttribute('data-testid');
  });

  it('forwards every data-* attribute, not just data-testid', () => {
    render(
      <Select
        value="http"
        options={OPTIONS}
        onChange={() => {}}
        searchable
        data-testid="connection-picker"
        data-query-context-level="0"
      />,
    );

    const trigger = screen.getByTestId('connection-picker');
    expect(trigger).toHaveAttribute('data-query-context-level', '0');
  });

  it('keeps the triggerDataAttrs hatch and lets a direct data-* prop win the collision', () => {
    render(
      <Select
        value="http"
        options={OPTIONS}
        onChange={() => {}}
        data-testid="direct-wins"
        triggerDataAttrs={{ 'data-testid': 'from-hatch', 'data-aria-note': 'kept' }}
      />,
    );

    const trigger = screen.getByTestId('direct-wins');
    expect(trigger).toHaveAttribute('data-aria-note', 'kept');
    expect(screen.queryByTestId('from-hatch')).toBeNull();
  });

  it('opens the listbox from the located element, so the locator is a working handle', () => {
    render(
      <Select value="http" options={OPTIONS} onChange={() => {}} data-testid="connection-picker" />,
    );

    const trigger = screen.getByTestId('connection-picker');
    fireEvent.click(trigger);
    expect(screen.getByTestId('select-listbox')).toBeInTheDocument();
  });
});

/**
 * Negative control for the typo trade the passthrough could have introduced.
 *
 * Forwarding `...rest` and widening the prop type to `[key: string]` would
 * turn these compile errors into silently ignored props — a quiet regression
 * traded for a loud one. The guard is a *pattern* index signature
 * (``[key: `data-${string}`]``), which TypeScript's excess-property check
 * honours: it accepts `data-*` and still rejects everything else.
 *
 * The control can fail. `@ts-expect-error` is an assertion, not a comment:
 * if the guard were widened to a plain string index signature, the directives
 * below would report "Unused '@ts-expect-error' directive" and
 * `npx tsc --noEmit` — which type-checks this file — would fail.
 */
describe('@datazen/ui Select typo guard (compile time)', () => {
  it('rejects a hyphen-less dataTestId and a misspelled onchane', () => {
    // Each directive sits directly above the offending property, because
    // `@ts-expect-error` only suppresses errors on the *next* line. Placed
    // above the object literal it would suppress nothing and stay "used" for
    // an unrelated reason — a control that cannot fail.
    const hyphenDropped: SelectProps = {
      value: 'http',
      options: OPTIONS,
      onChange: () => {},
      // @ts-expect-error `dataTestId` is not a `data-*` attribute; it must not compile.
      dataTestId: 'connection-picker',
    };
    const misspelled: SelectProps = {
      value: 'http',
      options: OPTIONS,
      onChange: () => {},
      // @ts-expect-error `onchane` is not a declared prop; it must not compile.
      onchane: () => {},
    };
    // Asserted so the values are read and `noUnusedLocals` stays satisfied;
    // the compile-time verdict is the `@ts-expect-error` directives above.
    expect([Boolean(hyphenDropped), Boolean(misspelled)]).toEqual([true, true]);
  });

  it('accepts the data-* attributes the contract promises', () => {
    const props: SelectProps = {
      value: 'http',
      options: OPTIONS,
      onChange: () => {},
      'data-testid': 'connection-picker',
      'data-query-context-level': '0',
    };
    expect(props['data-testid']).toBe('connection-picker');
  });
});

/**
 * The type system cannot cover every path: `{...rest}` is exempt from
 * excess-property checking, so a typo that arrives through a spread compiles
 * cleanly. That is the one hole the pattern index signature leaves, and the
 * dev-time warning in `Select` is the rail that closes it.
 */
describe('@datazen/ui Select unknown-prop guard (runtime)', () => {
  it('names a typo that arrived through a spread and never puts it on the DOM', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // No `@ts-expect-error` here on purpose: TypeScript accepts this, which is
    // the point. The runtime guard is what catches it.
    const escaped = { dataTestId: 'connection-picker' };

    const { container } = render(
      <Select value="http" options={OPTIONS} onChange={() => {}} {...escaped} />,
    );

    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('dataTestId');
    // Not forwarded: a non-`data-*` key must never reach a DOM node.
    expect(container.querySelector('[dataTestId]')).toBeNull();
    expect(container.querySelector('[data-testid]')).toBeNull();
    expect(container.querySelector('button')?.getAttributeNames()).not.toContain('datatestid');
    warn.mockRestore();
  });

  it('stays silent for a well-formed render, so the warning cannot cry wolf', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    render(
      <Select
        value="http"
        options={OPTIONS}
        onChange={() => {}}
        data-testid="connection-picker"
        title="Scheme"
        placeholder="Scheme"
      />,
    );

    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('does not re-warn on every re-render of the same unknown prop', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const escaped = { onchane: () => {} };

    const { rerender } = render(
      <Select value="http" options={OPTIONS} onChange={() => {}} {...escaped} />,
    );
    rerender(<Select value="https" options={OPTIONS} onChange={() => {}} {...escaped} />);
    rerender(<Select value="http" options={OPTIONS} onChange={() => {}} {...escaped} />);

    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  /**
   * The guard's real property is "an unchanged prop list does not re-warn" — but
   * only if the effect key identifies the *set*. `Object.entries` follows JSX
   * prop insertion order, so joining unsorted made two renders carrying the same
   * two unknown props in opposite order look like a change and warn twice.
   */
  it('warns once for the same unknown prop set regardless of prop order', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const onChnge = () => {};
    const onBlah = () => {};

    const { rerender } = render(
      <Select value="http" options={OPTIONS} onChange={() => {}} {...{ onChnge, onBlah }} />,
    );
    rerender(
      <Select value="https" options={OPTIONS} onChange={() => {}} {...{ onBlah, onChnge }} />,
    );

    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});
