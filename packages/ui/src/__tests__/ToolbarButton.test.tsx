/**
 * ToolbarButton: default ghost styling, explicit variant override, the compact
 * mode that hides the label visually but keeps it accessible, and iconOnly
 * presentation (no visible label, stable accessible name and square footprint).
 */
import { describe, expect, it, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { ToolbarButton } from '../ToolbarButton';

afterEach(cleanup);

describe('ToolbarButton', () => {
  it('defaults to ghost variant styling', () => {
    const { getByRole } = render(
      <ToolbarButton label="Refresh" icon={<span data-testid="icon">↻</span>} />,
    );
    const btn = getByRole('button', { name: 'Refresh' });

    expect(btn.className).toContain('bg-transparent');
    expect(btn.className).toContain('text-fg-secondary');
    expect(btn.className).not.toContain('bg-accent');
  });

  it('[tester] honors explicit primary variant override', () => {
    const { getByRole } = render(
      <ToolbarButton label="Run" variant="primary" icon={<span data-testid="icon">▶</span>} />,
    );
    const btn = getByRole('button', { name: 'Run' });
    expect(btn.className).toContain('bg-accent');
  });

  it('[tester] compact mode visually hides label but keeps aria-label', () => {
    const { getByRole, getByText } = render(
      <ToolbarButton compact label="Refresh" icon={<span>↻</span>} />,
    );
    const btn = getByRole('button', { name: 'Refresh' });
    expect(btn.className).toContain('h-7');
    expect(getByText('Refresh').className).toContain('sr-only');
  });

  it('[tester] uses explicit title when provided', () => {
    const { getByRole } = render(
      <ToolbarButton label="Refresh" title="Reload data" icon={<span>↻</span>} />,
    );
    expect(getByRole('button', { name: 'Refresh' })).toHaveAttribute('title', 'Reload data');
  });

  it('[tester] iconOnly drops the visible label but keeps title and accessible name', () => {
    const { getByRole, queryByText } = render(
      <ToolbarButton
        iconOnly
        label="Format SQL"
        title="Format SQL (Ctrl+Shift+F)"
        icon={<span>✦</span>}
      />,
    );

    const btn = getByRole('button', { name: 'Format SQL' });
    expect(queryByText('Format SQL')).toBeNull();
    expect(btn.textContent).toBe('✦');
    expect(btn).toHaveAttribute('title', 'Format SQL (Ctrl+Shift+F)');
    // Fixed square so a row of icon-only actions stays visually even.
    expect(btn.className).toContain('w-7');
    expect(btn.className).toContain('justify-center');
  });
});
