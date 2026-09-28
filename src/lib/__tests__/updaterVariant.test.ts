import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockCheck = vi.fn();

vi.mock('@tauri-apps/plugin-updater', () => ({
  check: (...args: unknown[]) => mockCheck(...args),
}));

vi.mock('@tauri-apps/plugin-process', () => ({
  relaunch: vi.fn(),
}));

// A private / local SKU: it names itself but publishes no updater channel, which
// is what a build that passed no --variant ends up as.
vi.mock('../../extensions/generated', () => ({
  DATAZEN_VARIANT: 'custom',
  DATAZEN_UPDATER_CHANNEL: false,
}));

import {
  checkForUpdates,
  currentVariant,
  downloadAndInstallUpdate,
  getUpdateChannel,
  hasUpdaterChannel,
  isUpdaterSupported,
  maybeCheckOnStartup,
} from '../updater';

describe('updater on a SKU with no published channel', () => {
  beforeEach(() => {
    (globalThis as Record<string, unknown>).__TAURI_INTERNALS__ = {};
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete (globalThis as Record<string, unknown>).__TAURI_INTERNALS__;
  });

  it('is a desktop build, so it shows the manual download card', () => {
    expect(currentVariant()).toBe('custom');
    expect(hasUpdaterChannel()).toBe(false);
    expect(getUpdateChannel()).toBe('manual');
  });

  it('never runs the in-app updater', async () => {
    expect(isUpdaterSupported()).toBe(false);

    // Regression guard for the reported bug: a variant whose SKU has no channel
    // used to read Basic's manifest and install a Basic build over itself,
    // dropping every driver Basic does not ship. Nothing may reach the plugin.
    await maybeCheckOnStartup(true);
    expect(mockCheck).not.toHaveBeenCalled();

    const check = await checkForUpdates();
    expect(check).toEqual({
      status: 'error',
      message: 'Updater is not available in this build',
    });

    const install = await downloadAndInstallUpdate();
    expect(install).toEqual({
      status: 'error',
      message: 'Updater is not available in this build',
    });
    expect(mockCheck).not.toHaveBeenCalled();
  });

  it('stays inert even when the startup setting is on', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await maybeCheckOnStartup(true);
    // Not even a warning: there is nothing to report, the SKU simply has no channel.
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
