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
    expect(plain).toContain('text-red-400');
    expect(plain).not.toContain('bg-red-500');
    expect(boxed).toContain('bg-red-500');
    expect(boxed).toContain('rounded-md');
    expect(strip).toContain('bg-red-500');
    expect(strip).toContain('border-b');
    // The strip is flush with the page edges, so it has no rounded corners.
    expect(strip).not.toContain('rounded-md');

    // All three keep the same role and type ramp, so the a11y contract is
    // identical no matter which chrome a call site picks.
    for (const cls of [plain, boxed, strip]) expect(cls).toContain('text-xs');
  });

  it('defaults to the plain variant', () => {
    render(<ErrorBanner data-testid="b-default">x</ErrorBanner>);
    const el = screen.getByTestId('b-default');
    expect(el.className).not.toContain('bg-red-500');
    expect(el).toHaveClass('text-xs', 'text-red-400');
  });

  it('lets the call site override the variant on conflicting classes', () => {
    render(
      <ErrorBanner variant="boxed" className="mt-3 px-2 text-danger" data-testid="b-override">
        x
      </ErrorBanner>,
    );
    const el = screen.getByTestId('b-override');
    const cls = el.className;
    expect(el).toHaveClass('mt-3', 'px-2', 'text-danger');
    // A different colour replaces the variant's outright.
    expect(el).not.toHaveClass('text-red-400');
    // Axis padding is not removed by the shorthand; it is ordered after it, so
    // the call site's `px-2` still wins for the x axis while `p-2` keeps
    // governing y. This is what lets a call site retune the boxed padding
    // without the component having to know about it.
    expect(cls.indexOf('px-2')).toBeGreaterThan(cls.indexOf('p-2'));
    // Non-conflicting variant classes are untouched.
    expect(el).toHaveClass('rounded-md', 'border-red-500/20', 'bg-red-500/10', 'text-xs');
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
    // A native <button> is in the tab order without a tabindex override.
    expect(button.tagName).toBe('BUTTON');
    expect(button).not.toHaveAttribute('tabindex');
    // The glyph must not add a second, noisier name for screen readers.
    expect(button.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');

    fireEvent.click(button);
    expect(onDismiss).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(button, { key: 'Enter' });
    expect(onDismiss).toHaveBeenCalled();
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
