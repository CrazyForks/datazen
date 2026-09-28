import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { DATAZEN_UPDATER_CHANNEL, DATAZEN_VARIANT } from '../extensions/generated';

export type UpdateProgress =
  | { phase: 'checking' }
  | { phase: 'downloading'; downloaded: number; total: number | null }
  | { phase: 'installing' }
  | { phase: 'done'; version: string }
  | { phase: 'idle' };

export type UpdateCheckResult =
  | { status: 'upToDate' }
  | { status: 'available'; version: string }
  | { status: 'installed'; version: string }
  | { status: 'error'; message: string };

/**
 * How this build receives updates.
 *
 * - `auto` — this SKU publishes signed updater artifacts plus its own manifest,
 *   so the in-app updater is safe to run.
 * - `manual` — a desktop build whose SKU publishes no channel; the user
 *   downloads the installer for that SKU from GitHub Releases.
 * - `none` — not a desktop build (browser dev), so there is nothing to show.
 */
export type UpdateChannel = 'auto' | 'manual' | 'none';

function isDesktopApp(): boolean {
  return '__TAURI_INTERNALS__' in globalThis;
}

/** Release SKU this build was produced as ('basic' | 'all' | 'akulaku' | 'custom'). */
export function currentVariant(): string {
  return DATAZEN_VARIANT;
}

/**
 * Whether this SKU publishes signed updater artifacts and its own manifest.
 *
 * Computed at build time by `scripts/resolve-drivers.mjs` from
 * `scripts/release-variants.mjs` (the single source of truth for SKUs), so the
 * frontend gate cannot drift from what CI actually publishes.
 */
export function hasUpdaterChannel(): boolean {
  return DATAZEN_UPDATER_CHANNEL;
}

/**
 * Which update path this build must use.
 *
 * Why SKUs are involved at all: `tauri.conf.json` compiles one updater endpoint
 * into every build, and the Tauri updater picks a manifest entry by *platform*
 * alone — it has no notion of SKU. Before the SKU was threaded through, an
 * `all` or `akulaku` install read Basic's `latest.json` and was silently
 * replaced by a Basic build, losing every driver Basic does not ship. Now each
 * SKU is built against its own manifest (see `scripts/ci-tauri-build.mjs`), and
 * a SKU with no published channel (`custom` / private builds) never
 * self-updates at all — it points at GitHub Releases instead.
 */
export function getUpdateChannel(): UpdateChannel {
  if (!isDesktopApp()) return 'none';
  return hasUpdaterChannel() ? 'auto' : 'manual';
}

/** Returns false when the in-app updater must not run. */
export function isUpdaterSupported(): boolean {
  return getUpdateChannel() === 'auto';
}

export async function checkForUpdates(): Promise<UpdateCheckResult> {
  if (!isUpdaterSupported()) {
    return { status: 'error', message: 'Updater is not available in this build' };
  }

  try {
    const update = await check();
    if (!update) {
      return { status: 'upToDate' };
    }
    return { status: 'available', version: update.version };
  } catch (e) {
    return {
      status: 'error',
      message: e instanceof Error ? e.message : String(e),
    };
  }
}

export async function downloadAndInstallUpdate(
  onProgress?: (progress: UpdateProgress) => void,
): Promise<UpdateCheckResult> {
  if (!isUpdaterSupported()) {
    return { status: 'error', message: 'Updater is not available in this build' };
  }

  onProgress?.({ phase: 'checking' });

  try {
    const update = await check();
    if (!update) {
      onProgress?.({ phase: 'idle' });
      return { status: 'upToDate' };
    }

    let downloaded = 0;
    let total: number | null = null;

    await update.downloadAndInstall((event) => {
      switch (event.event) {
        case 'Started':
          total = event.data.contentLength ?? null;
          downloaded = 0;
          onProgress?.({ phase: 'downloading', downloaded, total });
          break;
        case 'Progress':
          downloaded += event.data.chunkLength;
          onProgress?.({ phase: 'downloading', downloaded, total });
          break;
        case 'Finished':
          onProgress?.({ phase: 'installing' });
          break;
      }
    });

    onProgress?.({ phase: 'done', version: update.version });
    await relaunch();
    return { status: 'installed', version: update.version };
  } catch (e) {
    onProgress?.({ phase: 'idle' });
    return {
      status: 'error',
      message: e instanceof Error ? e.message : String(e),
    };
  }
}

/** Silent startup check; installs when an update is available and setting is on. */
export async function maybeCheckOnStartup(enabled: boolean): Promise<void> {
  if (!enabled || !isUpdaterSupported()) return;

  const result = await downloadAndInstallUpdate();
  if (result.status === 'error') {
    console.warn('[updater] startup check failed:', result.message);
  }
}
