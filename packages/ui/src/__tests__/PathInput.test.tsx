/**
 * PathInput: the control is a pure view — it must call the picker it is handed
 * and nothing else. These tests pin exactly that contract, because the picker
 * used to be a hard-coded `@tauri-apps/plugin-dialog` import inside this
 * package, which the `packages/ui` purity guards now forbid.
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/react';
import { PathInput, type PathPickerDialogOptions } from '../PathInput';

afterEach(cleanup);

describe('PathInput', () => {
  it('passes dialogOptions straight through to the injected picker', async () => {
    const onBrowse = vi.fn<(options?: PathPickerDialogOptions) => Promise<string | null>>(
      async () => null,
    );
    const { getByRole } = render(
      <PathInput
        value=""
        onChange={() => {}}
        onBrowse={onBrowse}
        dialogOptions={{ directory: true }}
      />,
    );

    fireEvent.click(getByRole('button'));

    await waitFor(() => expect(onBrowse).toHaveBeenCalledTimes(1));
    expect(onBrowse).toHaveBeenCalledWith({ directory: true });
  });

  it('reports the picked path through onChange', async () => {
    const onChange = vi.fn();
    const { getByRole } = render(
      <PathInput value="" onChange={onChange} onBrowse={async () => '/tmp/picked.sqlite'} />,
    );

    fireEvent.click(getByRole('button'));

    await waitFor(() => expect(onChange).toHaveBeenCalledWith('/tmp/picked.sqlite'));
  });

  it('leaves the value alone when the picker resolves null (user cancelled)', async () => {
    const onChange = vi.fn();
    const { getByRole } = render(
      <PathInput value="/keep" onChange={onChange} onBrowse={async () => null} />,
    );

    fireEvent.click(getByRole('button'));

    await waitFor(() => expect(getByRole('button')).toBeTruthy());
    expect(onChange).not.toHaveBeenCalled();
  });

  it('swallows a rejected picker instead of crashing the dialog', async () => {
    // The pre-refactor implementation caught around `open()` for exactly this
    // case (cancelled, or a Tauri webview that is not there); the behaviour
    // has to survive the call moving out to the host.
    const onChange = vi.fn();
    const { getByRole } = render(
      <PathInput
        value=""
        onChange={onChange}
        onBrowse={async () => {
          throw new Error('no webview');
        }}
      />,
    );

    fireEvent.click(getByRole('button'));

    await waitFor(() => expect(getByRole('button')).toBeTruthy());
    expect(onChange).not.toHaveBeenCalled();
  });

  it('does not open a picker while disabled', () => {
    const onBrowse = vi.fn(async () => '/tmp/nope');
    const { getByRole } = render(
      <PathInput value="" onChange={() => {}} onBrowse={onBrowse} disabled />,
    );

    fireEvent.click(getByRole('button'));

    expect(onBrowse).not.toHaveBeenCalled();
  });

  it('keeps typing in the text input independent of the picker', () => {
    const onChange = vi.fn();
    const onBrowse = vi.fn(async () => null);
    render(<PathInput value="" onChange={onChange} onBrowse={onBrowse} inputTestId="p" />);

    fireEvent.change(screen.getByTestId('p'), { target: { value: '/typed' } });

    expect(onChange).toHaveBeenCalledWith('/typed');
    expect(onBrowse).not.toHaveBeenCalled();
  });
});
