import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OptionsBar } from '../OptionsBar';

vi.mock('../../../hooks/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

afterEach(() => cleanup());

describe('Data Sync conflict policy options', () => {
  it('defaults missing policy to abort and emits an explicit policy', () => {
    const onChange = vi.fn();
    const view = render(
      <OptionsBar
        options={{ insert: true, update: true, delete: false }}
        onChange={onChange}
        onEnableDelete={vi.fn()}
      />,
    );
    const select = screen.getByTestId('data-sync-conflict-policy') as HTMLSelectElement;
    expect(select.value).toBe('abort');
    fireEvent.change(select, { target: { value: 'skip' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ conflictPolicy: 'skip' }));
    view.rerender(
      <OptionsBar
        options={{ insert: true, update: true, delete: false, conflictPolicy: 'skip' }}
        onChange={onChange}
        onEnableDelete={vi.fn()}
      />,
    );
    expect(screen.getByText('sync.conflictPolicySkipWarning')).toBeTruthy();
  });
});
