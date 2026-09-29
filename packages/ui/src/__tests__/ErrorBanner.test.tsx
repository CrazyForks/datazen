/**
 * ErrorBanner: the single error bar. Its whole job is to be impossible to use
 * wrongly — it announces itself, it never rewrites the call site's copy, and
 * its dismiss control cannot exist without a label.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ErrorBanner } from '../ErrorBanner';

afterEach(cleanup);

describe('ErrorBanner', () => {
  it('announces itself as an alert on a div by default', () => {
    render(<ErrorBanner>connection refused</ErrorBanner>);
    const el = screen.getByRole('alert');
    expect(el.tagName).toBe('DIV');
    expect(el).toHaveTextContent('connection refused');
  });

  it('renders the element the call site asks for, so p/span layouts survive', () => {
    const { rerender } = render(<ErrorBanner as="p">boom</ErrorBanner>);
    expect(screen.getByRole('alert').tagName).toBe('P');

    rerender(<ErrorBanner as="span">boom</ErrorBanner>);
    expect(screen.getByRole('alert').tagName).toBe('SPAN');
  });

  it('paints the three variants differently', () => {
    const classFor = (variant: 'plain' | 'boxed' | 'strip') => {
      const { unmount } = render(
        <ErrorBanner variant={variant} data-testid={`b-${variant}`}>
          x
        </ErrorBanner>,
      );
      const cls = screen.getByTestId(`b-${variant}`).className;
      unmount();
      return cls;
    };

    const plain = classFor('plain');
    const boxed = classFor('boxed');
    const strip = classFor('strip');

    // plain is text only; boxed and strip add a tinted, bordered surface.
    expect(plain).toContain('text-danger');
    expect(plain).not.toContain('bg-danger/10');
    expect(boxed).toContain('bg-danger/10');
    expect(boxed).toContain('rounded-md');
    expect(strip).toContain('bg-danger/10');
    expect(strip).toContain('border-b');
    // The strip is flush with the page edges, so it has no rounded corners.
    expect(strip).not.toContain('rounded-md');
    // No variant may hard-code a literal Tailwind shade: those read no
    // `--c-*` token, so they would render identically under every theme.
    for (const cls of [plain, boxed, strip]) expect(cls).not.toMatch(/red-\d/);

    // All three keep the same role and type ramp, so the a11y contract is
    // identical no matter which chrome a call site picks.
    for (const cls of [plain, boxed, strip]) expect(cls).toContain('text-xs');
  });

  it('defaults to the plain variant', () => {
    render(<ErrorBanner data-testid="b-default">x</ErrorBanner>);
    const el = screen.getByTestId('b-default');
    expect(el.className).not.toContain('bg-danger/10');
    expect(el).toHaveClass('text-xs', 'text-danger');
  });

  it('lets the call site override the variant on conflicting classes', () => {
    render(
      <ErrorBanner variant="boxed" className="mt-3 px-2 text-red-400" data-testid="b-override">
        x
      </ErrorBanner>,
    );
    const el = screen.getByTestId('b-override');
    expect(el).toHaveClass('mt-3', 'px-2', 'text-red-400');
    // A different colour replaces the variant's outright — this is the trap the
    // component's JSDoc warns about: override the text colour alone and the
    // background and border stay on the variant's.
    expect(el).not.toHaveClass('text-danger');
    // Non-conflicting variant classes are untouched, including `p-2`, which no
    // class here conflicts with. (Whether `px-2` then wins on the x axis is a
    // *cascade* fact — Tailwind emits longhands after the shorthand — and is
    // not assertable here, where no stylesheet is loaded.)
    expect(el).toHaveClass('rounded-md', 'border-danger/20', 'bg-danger/10', 'text-xs', 'p-2');
  });

  it('lays the message out as a row when an icon is supplied', () => {
    render(
      <ErrorBanner icon={<span data-testid="glyph">!</span>} data-testid="b-icon">
        a very long operation error that has to wrap
      </ErrorBanner>,
    );
    const el = screen.getByTestId('b-icon');
    expect(el).toHaveClass('flex', 'items-start', 'gap-2');
    expect(screen.getByTestId('glyph')).toBeInTheDocument();
    // The message sits in a wrapping, selectable span so the glyph and a long
    // message stay aligned on the first line.
    const body = el.querySelector('span.select-text');
    expect(body).not.toBeNull();
    expect(body).toHaveTextContent('a very long operation error that has to wrap');
  });

  it('stays a plain block when there is no icon and no dismiss control', () => {
    render(<ErrorBanner data-testid="b-flat">x</ErrorBanner>);
    const el = screen.getByTestId('b-flat');
    expect(el).not.toHaveClass('flex');
    // No wrapper span, so no stray flex child is introduced.
    expect(el.querySelector('span.select-text')).toBeNull();
  });

  it('exposes a labelled, keyboard-reachable dismiss control', () => {
    const onDismiss = vi.fn();
    render(
      <ErrorBanner onDismiss={onDismiss} dismissLabel="Close" data-testid="b-dismiss">
        failed
      </ErrorBanner>,
    );

    const button = screen.getByRole('button', { name: 'Close' });
    // A native <button> is in the tab order without a tabindex override. Any
    // explicit `tabindex` — positive or negative — is caught by the attribute
    // check. Do not *also* assert `button.tabIndex`: a disabled button still
    // reports `tabIndex === 0` in jsdom, so that property proves nothing more.
    expect(button.tagName).toBe('BUTTON');
    expect(button).not.toHaveAttribute('tabindex');
    // Must not submit an enclosing <form> by default.
    expect(button).toHaveAttribute('type', 'button');
    // The glyph must not add a second, noisier name for screen readers.
    expect(button.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    // The dismiss control is styled inside the component, so it is just as
    // theme-blind as the variant would be if it used a literal shade.
    expect(button).toHaveClass('text-danger');
    expect(button.className).not.toMatch(/red-\d/);

    fireEvent.click(button);
    expect(onDismiss).toHaveBeenCalledTimes(1);
    // jsdom does not synthesise a click from keyDown, and the component must
    // not add a handler that would double-fire in a real browser. Asserting
    // `toHaveBeenCalled()` here would be vacuous — the count is already 1.
    fireEvent.keyDown(button, { key: 'Enter' });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('renders no dismiss control unless the call site asks for one', () => {
    render(<ErrorBanner data-testid="b-nodismiss">failed</ErrorBanner>);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('forwards the data attributes driver UI asserts on', () => {
    render(
      <ErrorBanner data-testid="redis-string-save-error" data-i18n-key="redis.detail.saveFailed">
        x
      </ErrorBanner>,
    );
    const el = screen.getByTestId('redis-string-save-error');
    expect(el).toHaveAttribute('data-i18n-key', 'redis.detail.saveFailed');
    expect(el).toHaveAttribute('role', 'alert');
  });

  it('renders children verbatim and translates nothing itself', () => {
    // The call site owns the copy. If the banner ever ran its own t(), an
    // already-translated string (or an i18n key used as an assertion
    // contract) would come back mangled.
    const copy = 'Save failed: connection reset by peer';
    const { container } = render(<ErrorBanner>{copy}</ErrorBanner>);
    expect(container.textContent).toBe(copy);
  });

  it('renders React nodes, not just strings', () => {
    render(
      <ErrorBanner>
        outer <strong data-testid="inner">inner</strong>
      </ErrorBanner>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('outer inner');
    expect(screen.getByTestId('inner').tagName).toBe('STRONG');
  });
});
