import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ErrorBoundary } from '../ErrorBoundary';
import en from '../../locales/en';

vi.mock('../TitleBar', () => ({ TitleBar: () => <div data-testid="title-bar" /> }));

afterEach(cleanup);

function BrokenView(): never {
  throw new Error('render failed');
}

describe('ErrorBoundary', () => {
  it('renders a localized, actionable fallback without crashing the shell', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <ErrorBoundary>
        <BrokenView />
      </ErrorBoundary>,
    );

    // The contract is "heading + two actionable buttons, each carrying a real
    // localised accessible name". The wording belongs to the dictionary, so the
    // expected names are read from it instead of being hard-coded here.
    for (const key of ['common.error', 'common.close', 'common.retry'] as const) {
      expect(en[key].trim().length, key).toBeGreaterThan(0);
    }
    expect(screen.getByTestId('title-bar')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: en['common.error'] })).toBeInTheDocument();
    expect(screen.getByText('render failed')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: en['common.close'] })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: en['common.retry'] })).toBeInTheDocument();
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
