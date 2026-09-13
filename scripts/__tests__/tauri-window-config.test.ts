/** @vitest-environment node */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

interface WindowConfig {
  label: string;
  dragDropEnabled?: boolean;
  [key: string]: unknown;
}

function readWindows(filename: string): WindowConfig[] {
  const config = JSON.parse(
    readFileSync(new URL(`../../src-tauri/${filename}`, import.meta.url), 'utf8'),
  ) as { app: { windows: WindowConfig[] } };
  return config.app.windows;
}

describe('Tauri platform window replacement', () => {
  // The main window is created programmatically by Rust at startup
  // (see `create_main_window` / `create_onboarding_window` in commands/window.rs)
  // so all config files define an empty windows array.

  it('has no statically defined windows (created programmatically)', () => {
    const baseWindows = readWindows('tauri.conf.json');
    expect(baseWindows).toHaveLength(0);
  });

  it.each([['macos'], ['windows']] as const)(
    '%s config defines an empty windows array (merged into base)',
    (platform) => {
      const platformWindows = readWindows(`tauri.${platform}.conf.json`);
      expect(platformWindows).toHaveLength(0);
    },
  );
});
