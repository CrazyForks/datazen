/**
 * The right panel's Create key button — the replacement for the action row that
 * used to live in the host toolbar's 48px KV context band.
 *
 * Why this file exists: that band was removed, and with it every other action
 * button (refresh / import / export / overflow). Create key is the one action
 * that survived, so it is the one thing here that must be proven twice:
 *
 * 1. **The button is owned by the panel, not the host.** It renders inside the
 *    tab bar next to the tabs it creates into, and it is driven straight from
 *    the workbench's own overlay state — no KV slot action, no host round-trip.
 * 2. **It is wired, not decorative.** Clicking it opens the real create-key
 *    dialog and submitting it reaches `set_string`, i.e. the feature the user
 *    asked to keep actually works from its new home.
 *
 * Rendered through `RedisConnectionView` rather than `RedisRightPanel` alone,
 * because that is the only path where `renderRightPanel` exists — the prop
 * under test is handed to the panel by the workbench, and a panel-only mount
 * would never see it.
 *
 * 只断言 `data-testid` / `data-*`（PRD §7-6：禁英文字面量）; the i18n `t()` is
 * mocked to echo the key.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { create } from 'zustand';
import {
  bindConfirmDialog,
  bindConnectionStore,
  bindSchemaStore,
  bindSettingsStore,
  type ConnectionBridgeState,
  type SchemaStoreState,
  type SettingsBridgeState,
} from '@datazen/driver-sdk';

vi.mock('@datazen/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@datazen/ui')>()),
  useI18n: () => ({
    t: (key: string) => key,
  }),
}));

const execute = vi.fn();
vi.mock('../shared/redisInvoke', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../shared/redisInvoke')>()),
  redisCommandInvoke: (...args: unknown[]) => execute(...(args as [])),
  // The key tree scans and the detail column reads on mount, none of which this
  // suite asserts. Stubbed to empty replies so the run is not buried in
  // unhandled-IPC stderr from a Tauri bridge jsdom does not have.
  invokeScanKeys: vi.fn(async () => ({ cursor: 0, keys: [], done: true })),
  invokeListChildren: vi.fn(async () => ({ children: [], cursor: 0 })),
  invokeGetKey: vi.fn(async () => null),
  invokeGetKeyRaw: vi.fn(async () => null),
  invokeDbSizes: vi.fn(async () => []),
}));

// The console / pubsub / slowlog bodies open their own heavy panels; the tab
// bar and its action button are what this suite is about.
vi.mock('../console/RedisConsole', () => ({
  RedisConsole: () => <div data-testid="stub-console" />,
}));
vi.mock('../observe/SlowlogPanel', () => ({
  SlowlogPanel: () => <div data-testid="stub-slowlog" />,
}));
vi.mock('../observe/PubSubPanel', () => ({
  PubSubPanel: () => <div data-testid="stub-pubsub" />,
}));

import { RedisConnectionView } from '../connection/RedisConnectionView';

// The workbench reads the same host bridges a real panel would; jsdom has no
// host, so the minimal stand-ins are bound here. Safe Mode off keeps the guard
// out of the way — it is not what this suite is about.
bindSettingsStore(
  create<SettingsBridgeState>(() => ({
    settings: { safeMode: false, editorFontFamily: '', driverSettings: {} },
  })),
);
bindConnectionStore(create<ConnectionBridgeState>(() => ({ connections: [] })));
bindConfirmDialog(() => [async () => true, null]);
bindSchemaStore(
  create<SchemaStoreState>(() => ({
    databases: ['db0', 'db1'],
    loading: false,
    loadForConnection: async () => {},
  })),
);

afterEach(() => {
  cleanup();
  execute.mockReset();
});

function renderView() {
  return render(
    <RedisConnectionView
      dbSessionId="sess-create"
      connectionId="cfg-create"
      connectionName="local"
      databaseType="redis"
      initialDatabase="db0"
      hideSidebar
      isActive
    />,
  );
}

/** A dialog whose rendered title is this i18n key (identity `t` ⇒ title === key). */
async function dialogByTitle(titleKey: string): Promise<HTMLElement> {
  return waitFor(() => {
    const found = Array.from(document.querySelectorAll('[role="dialog"]')).find(
      (el) => el.textContent?.includes(titleKey) ?? false,
    );
    if (!found) throw new Error(`no dialog for ${titleKey}`);
    return found as HTMLElement;
  });
}

function buttonWithKey(container: HTMLElement, key: string): HTMLButtonElement {
  const found = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === key);
  if (!found) throw new Error(`no button ${key}`);
  return found as HTMLButtonElement;
}

describe('Right-panel Create key button', () => {
  it('lives in the tab bar, not in a host toolbar row', async () => {
    renderView();
    await act(async () => {});

    const button = screen.getByTestId('redis-right-create-key');
    // Inside the tab bar ⇒ it travels with the panel wherever the panel mounts,
    // instead of depending on a host row that KV panels no longer render.
    expect(screen.getByTestId('redis-right-tab-bar').contains(button)).toBe(true);
    // Labelled from copy, not a bare glyph.
    expect(button.getAttribute('aria-label')).toBe('redis.createKey');
  });

  it('is the only action control the panel header carries', async () => {
    renderView();
    await act(async () => {});

    // The deleted context band also offered refresh / import / export and an
    // overflow menu. None of them may creep back into the tab bar: this driver
    // has no import/export surface in the panel, and a refresh that silently
    // did nothing was worse than no button at all.
    const bar = screen.getByTestId('redis-right-tab-bar');
    const controls = Array.from(
      bar.querySelectorAll<HTMLElement>('[data-testid^="redis-right-"][data-testid]'),
    ).filter((el) => el.tagName === 'BUTTON' && !el.getAttribute('data-active'));
    expect(controls.map((el) => el.getAttribute('data-testid'))).toEqual([
      'redis-right-create-key',
    ]);
  });

  it('opens the workbench create dialog and reaches set_string on submit', async () => {
    renderView();
    await act(async () => {});

    // Enter condition: no dialog before the click.
    expect(screen.queryByRole('dialog')).toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByTestId('redis-right-create-key'));
    });

    // In-state: the workbench's own overlay opened the real dialog — proof the
    // prop reached the panel and the panel reaches the overlay.
    const dialog = await dialogByTitle('redis.createKey');
    const nameField = dialog.querySelector('input[placeholder="redis.keyName"]');
    expect(nameField).toBeTruthy();
    fireEvent.change(nameField as HTMLInputElement, { target: { value: 'new:key' } });
    fireEvent.click(buttonWithKey(dialog, 'redis.create'));

    // Exit transition: the command the create-key form always issued, now
    // reached from the panel's own button.
    await waitFor(() =>
      expect(execute).toHaveBeenCalledWith(
        'redis',
        'set_string',
        expect.objectContaining({ key: 'new:key' }),
      ),
    );
  });
});
