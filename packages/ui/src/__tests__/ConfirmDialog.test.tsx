/**
 * ConfirmDialog: open/close rendering, confirm/cancel wiring, optional
 * badge/description, and the truncated SQL code preview with its copy action.
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { act, render, fireEvent, cleanup, screen } from '@testing-library/react';
import { ConfirmDialog } from '../ConfirmDialog';

vi.mock('../i18n', () => ({
  useI18n: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'common.cancel': 'Cancel',
        'common.confirm': 'Confirm',
        'query.editor.executionConfirm.previewTruncated': 'Showing first {lines} lines',
        'query.editor.executionConfirm.copySql': 'Copy SQL',
      };
      return map[key] ?? key;
    },
  }),
}));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function stubClipboard(writeText: () => Promise<void>) {
  Object.defineProperty(window.navigator, 'clipboard', {
    configurable: true,
    value: { writeText: vi.fn(writeText) },
  });
}

describe('ConfirmDialog', () => {
  it('renders title and message when open', () => {
    render(
      <ConfirmDialog
        open
        title="Delete Item"
        message="Are you sure?"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByText('Delete Item')).toBeTruthy();
    expect(screen.getByText('Are you sure?')).toBeTruthy();
  });

  it('does not render when closed', () => {
    const { container } = render(
      <ConfirmDialog
        open={false}
        title="Delete Item"
        message="Are you sure?"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('calls onConfirm when confirm button is clicked', () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open
        title="Delete"
        message="Sure?"
        onConfirm={onConfirm}
        onCancel={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId('confirm-dialog-ok'));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('calls onCancel when cancel button is clicked', () => {
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        open
        title="Delete"
        message="Sure?"
        onConfirm={() => {}}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByTestId('confirm-dialog-cancel'));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('uses custom labels when provided', () => {
    render(
      <ConfirmDialog
        open
        title="Delete"
        message="Sure?"
        confirmLabel="Yes, delete"
        cancelLabel="No, keep it"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByText('Yes, delete')).toBeTruthy();
    expect(screen.getByText('No, keep it')).toBeTruthy();
  });

  it('shows warning icon for warning kind', () => {
    render(
      <ConfirmDialog
        open
        title="Delete"
        message="Sure?"
        kind="warning"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    // Dialog renders via portal to document.body
    const svg = document.body.querySelector('svg');
    expect(svg).toBeTruthy();
  });

  it('renders badge when provided', () => {
    render(
      <ConfirmDialog
        open
        title="Confirm"
        message="Are you sure?"
        badge="Production"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByText('Production')).toBeTruthy();
  });

  it('renders description when provided', () => {
    render(
      <ConfirmDialog
        open
        title="Confirm"
        message="Are you sure?"
        description="This is a longer description with more details."
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByText('This is a longer description with more details.')).toBeTruthy();
  });

  it('renders code preview section when codePreview is provided', () => {
    render(
      <ConfirmDialog
        open
        title="Confirm"
        message="Review SQL"
        codePreview="SELECT * FROM users WHERE id = 1"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByText('SELECT * FROM users WHERE id = 1')).toBeTruthy();
    expect(screen.getByTestId('confirm-dialog-copy-sql')).toBeTruthy();
  });

  it('truncates code preview to max lines', () => {
    const longSql = Array.from({ length: 20 }, (_, i) => `SELECT ${i} FROM t`).join('\n');
    render(
      <ConfirmDialog
        open
        title="Confirm"
        message="Review SQL"
        codePreview={longSql}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    // Should show the truncated indicator (i18n mock returns the key literally)
    expect(screen.getByText(/Showing first \{lines\} lines/)).toBeTruthy();
    // Should not show the last line
    expect(screen.queryByText('SELECT 19 FROM t')).toBeNull();
  });

  it('renders without badge when badge is not provided', () => {
    const { container } = render(
      <ConfirmDialog
        open
        title="Delete"
        message="Sure?"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    // No badge element should be present
    const badges = container.querySelectorAll('[class*="bg-amber-500"]');
    expect(badges.length).toBe(0);
  });
});

/**
 * The copy confirmation now comes from the shared `useCopyFeedback` hook. Two
 * things are specific to this dialog and would otherwise be unpinned: its
 * window is 2000ms (the error surfaces use 1500ms), and it flips the check
 * mark optimistically. Unifying the constant or detaching the dialog from the
 * hook would leave the whole suite green if nothing below existed.
 */
describe('ConfirmDialog code-preview copy confirmation', () => {
  const renderWithPreview = () =>
    render(
      <ConfirmDialog
        open
        title="Confirm"
        message="Review SQL"
        codePreview="SELECT 1;"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );

  it('holds the check mark for 2000ms, then reverts to the copy label', () => {
    vi.useFakeTimers();
    stubClipboard(() => Promise.resolve());
    renderWithPreview();
    const copyBtn = screen.getByTestId('confirm-dialog-copy-sql');

    // Optimistic: the mark is there on the same tick as the click.
    fireEvent.click(copyBtn);
    expect(copyBtn).toHaveTextContent('✓');

    // 2000ms is this dialog's own window, deliberately longer than the
    // 1500ms the error surfaces use.
    act(() => {
      vi.advanceTimersByTime(1999);
    });
    expect(copyBtn).toHaveTextContent('✓');

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(copyBtn).toHaveTextContent('Copy SQL');
  });

  it('rolls the check mark back and cancels the window when the write fails', async () => {
    vi.useFakeTimers();
    stubClipboard(() => Promise.reject(new Error('clipboard denied')));
    renderWithPreview();
    const copyBtn = screen.getByTestId('confirm-dialog-copy-sql');

    // Mounting a Dialog focuses its first focusable element, and jsdom's
    // focus() internally schedules a selection bookkeeping timer of its own
    // (SelectionImpl._associateRange). That timer is an artifact of the test
    // environment and not ours to cancel, so the counts below are deltas
    // against this component's own baseline rather than absolute zero.
    const baseline = vi.getTimerCount();

    fireEvent.click(copyBtn);
    expect(copyBtn).toHaveTextContent('✓');
    expect(vi.getTimerCount()).toBe(baseline + 1);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // The lie is taken back...
    expect(copyBtn).toHaveTextContent('Copy SQL');
    expect(copyBtn).not.toHaveTextContent('✓');
    // ...and the rollback cancels the pending window rather than leaving it
    // armed to fire on a dialog that is no longer showing it.
    expect(vi.getTimerCount()).toBe(baseline);
  });
});
