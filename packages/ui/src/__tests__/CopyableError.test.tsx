/**
 * CopyableError: selectable message rendering (plain vs monospace) and the
 * clipboard copy action with its "copied" confirmation state.
 */
import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { render, fireEvent, cleanup, screen, act, waitFor } from '@testing-library/react';
import { CopyableError } from '../CopyableError';

vi.mock('../i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

afterEach(cleanup);

describe('CopyableError', () => {
  let clipboardSpy: ReturnType<typeof vi.spyOn>;

  function stubClipboard(writeText: () => Promise<void>) {
    Object.defineProperty(window.navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn(writeText) },
    });
    clipboardSpy = vi.spyOn(window.navigator.clipboard, 'writeText').mockImplementation(writeText);
  }

  beforeEach(() => {
    stubClipboard(() => Promise.resolve());
  });

  it('renders the full message with selectable styling', () => {
    const longMessage = 'line one\nline two with more detail';
    render(<CopyableError message={longMessage} />);
    const el = screen.getByTestId('copyable-error-message');
    expect(el).toHaveClass('selectable', 'select-text', 'whitespace-pre-wrap', 'break-words');
    expect(el.textContent).toBe(longMessage);
  });

  it('copies the message when copyButton is enabled', () => {
    render(<CopyableError message="connection refused" copyButton />);
    fireEvent.click(screen.getByTestId('copyable-error-copy'));
    expect(clipboardSpy).toHaveBeenCalledWith('connection refused');
    expect(screen.getByText('common.copied')).toBeInTheDocument();
  });

  it('omits the copy button by default (copyButton is opt-in)', () => {
    render(<CopyableError message="connection refused" />);
    expect(screen.queryByTestId('copyable-error-copy')).not.toBeInTheDocument();
  });

  it('keeps the copy title on common.copy in both states and swaps only the body text', () => {
    render(<CopyableError message="connection refused" copyButton />);
    const copyBtn = screen.getByTestId('copyable-error-copy');
    expect(copyBtn).toHaveAttribute('title', 'common.copy');

    fireEvent.click(copyBtn);

    expect(copyBtn).toHaveTextContent('common.copied');
    expect(copyBtn).not.toHaveTextContent('common.copy');
    expect(copyBtn).toHaveAttribute('title', 'common.copy');
  });

  it('reverts the copied state after the 1.5s feedback window', () => {
    vi.useFakeTimers();
    render(<CopyableError message="connection refused" copyButton />);

    fireEvent.click(screen.getByTestId('copyable-error-copy'));
    expect(screen.getByTestId('copyable-error-copy')).toHaveTextContent('common.copied');

    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(screen.getByTestId('copyable-error-copy')).toHaveTextContent('common.copy');
    vi.useRealTimers();
  });

  /**
   * The copy action is optimistic — it flips to "Copied" synchronously so the
   * click reads as instant — but a rejected clipboard write (permission denied,
   * insecure context) must roll that state back. Claiming success for a write
   * that never landed is a lie, and the unguarded `void writeText()` this
   * replaced also leaked an unhandled rejection.
   *
   * `waitFor` (not a single `await Promise.resolve()`) because the rollback
   * reaches the DOM only once React commits the re-render, which lands a few
   * microtasks after the rejection handler runs.
   */
  it('does not report "copied" when the clipboard write rejects', async () => {
    stubClipboard(() => Promise.reject(new Error('clipboard denied')));
    render(<CopyableError message="connection refused" copyButton />);

    fireEvent.click(screen.getByTestId('copyable-error-copy'));

    await waitFor(() =>
      expect(screen.getByTestId('copyable-error-copy')).not.toHaveTextContent('common.copied'),
    );
  });
});
