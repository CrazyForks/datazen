/**
 * CopyableError: selectable message rendering (plain vs monospace) and the
 * clipboard copy action with its "copied" confirmation state.
 */
import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { render, fireEvent, cleanup, screen, act } from '@testing-library/react';
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
   * KNOWN DEFECT (pre-existing, not introduced by the @datazen/ui move):
   * `handleCopy` does `void navigator.clipboard.writeText(message); setCopied(true)`
   * with no `.catch`, so a rejected clipboard write (permission denied, insecure
   * context) both raises an unhandled rejection AND still claims "Copied" to the
   * user. `ConfirmDialog.handleCopy` in the same package does guard the rejection,
   * so the two copy buttons are inconsistent. `it.fails` records the correct
   * contract and turns RED automatically once the component is fixed.
   */
  it.fails('does not report "copied" when the clipboard write rejects', async () => {
    stubClipboard(() => Promise.reject(new Error('clipboard denied')));
    render(<CopyableError message="connection refused" copyButton />);

    fireEvent.click(screen.getByTestId('copyable-error-copy'));
    await Promise.resolve();

    expect(screen.getByTestId('copyable-error-copy')).not.toHaveTextContent('common.copied');
  });
});
