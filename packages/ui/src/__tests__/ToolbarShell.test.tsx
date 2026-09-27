/**
 * ToolbarShell: the shared connection/window toolbar chrome.
 *
 * Purely presentational, but two behaviours are load-bearing for every caller and
 * were not covered by the component's move to @datazen/ui:
 *   1. `forwardRef` — callers focus/scroll the toolbar element (e.g. the connection
 *      toolbar focus ring), and a dropped ref would be a silent regression.
 *   2. `cn(base, className)` merge order — a caller class must win over the base
 *      utilities rather than being dropped or duplicated.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { ToolbarShell } from '../ToolbarShell';

afterEach(cleanup);

describe('ToolbarShell', () => {
  it('renders its children', () => {
    render(
      <ToolbarShell>
        <button type="button" data-testid="toolbar-action">
          Run
        </button>
      </ToolbarShell>,
    );
    expect(screen.getByTestId('toolbar-action')).toBeInTheDocument();
  });

  it('applies the base toolbar utilities', () => {
    render(<ToolbarShell>content</ToolbarShell>);
    const shell = screen.getByText('content');
    expect(shell).toHaveClass('flex', 'shrink-0', 'items-center', 'gap-2');
    expect(shell).toHaveClass('border-b', 'border-edge', 'bg-surface-alt', 'px-4', 'py-1');
  });

  it('merges a caller className on top of the base utilities', () => {
    render(<ToolbarShell className="h-10 min-w-0">content</ToolbarShell>);
    const shell = screen.getByText('content');
    expect(shell).toHaveClass('h-10', 'min-w-0');
    // Base utilities survive the merge — a naive `{...base, ...className}` spread
    // would drop them.
    expect(shell).toHaveClass('flex', 'shrink-0', 'bg-surface-alt');
  });

  it('lets a conflicting caller class win over the base utility (tailwind-merge)', () => {
    // `cn` is `twMerge(clsx(...))`, so the caller is expected to override a
    // base utility it collides with rather than emit both.
    render(<ToolbarShell className="bg-red-500">content</ToolbarShell>);
    const shell = screen.getByText('content');
    expect(shell).toHaveClass('bg-red-500');
    expect(shell).not.toHaveClass('bg-surface-alt');
  });

  it('forwards the ref to the rendered div', () => {
    const ref = createRef<HTMLDivElement>();
    render(
      <ToolbarShell ref={ref} data-testid="shell">
        content
      </ToolbarShell>,
    );
    expect(ref.current).toBe(screen.getByTestId('shell'));
    expect(ref.current?.tagName).toBe('DIV');
  });

  it('spreads arbitrary div attributes through to the DOM node', () => {
    render(
      <ToolbarShell id="conn-toolbar" role="toolbar" aria-label="Connection toolbar">
        content
      </ToolbarShell>,
    );
    const shell = screen.getByRole('toolbar', { name: 'Connection toolbar' });
    expect(shell).toHaveAttribute('id', 'conn-toolbar');
  });
});
