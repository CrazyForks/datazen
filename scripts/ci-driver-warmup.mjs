#!/usr/bin/env node
/**
 * ci-driver-warmup.mjs — compile the driver union once per release target.
 *
 * release.yml runs this from `warm-driver-deps`, inside a
 * `with-driver-inject --drivers=<union>` boundary, *before* the variant
 * matrix. `<union>` is the superset of every variant (all path drivers plus
 * the git drivers the Akulaku SKU needs), so one `cargo build` here leaves the
 * shared rust-cache holding, for the exact target + cargo profile the matrix
 * uses:
 *
 *   - every third-party dependency, and
 *   - every driver crate.
 *
 * Driver crates are compiled from the same sources with the same features in
 * every variant, so their artifacts are interchangeable. What stays per
 * variant is exactly what cannot be shared: the host `datazen` lib (three
 * different driver feature sets), the Vite bundle (`generated.ts` differs and
 * `dist/` is embedded into the binary by `generate_context!`), the final link,
 * and the installer.
 *
 * Two things this job deliberately does NOT do, because they are per-variant
 * and would be wasted here:
 *   - the final link (it builds `--lib`; the bin is a thin shim over it), and
 *   - the Vite build.
 *
 * The typecheck is the one exception, because it is cheap relative to the
 * compile and running it once over the union (a strict superset of every
 * variant's driver set) is stronger than the 11 per-variant typechecks it
 * replaces. It is opt-in via `--typecheck` and paired with
 * `DATAZEN_CI_TYPECHECK_ONCE=1` on the build side.
 *
 * Usage:
 *   node scripts/ci-driver-warmup.mjs --target=aarch64-apple-darwin [--typecheck]
 *   node scripts/ci-driver-warmup.mjs --target=...
 */

import { spawnSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const DRIVER_FEATURES_FILE = '.driver-features.json';
const TSC = join('node_modules', 'typescript', 'bin', 'tsc');

/**
 * Codegen + typecheck commands run once over the union driver set.
 * `generate-builtin-locales` / `generate-menu-labels` mirror the codegen half
 * of `pnpm build`; `tsc` is invoked through its local entry point so the
 * command is identical on Windows, macOS and Linux (no `pnpm.cmd` shell
 * re-parse).
 */
export function planTypecheckCommands(root = ROOT) {
  return [
    { cmd: process.execPath, args: [join(root, 'scripts', 'generate-builtin-locales.mjs')] },
    { cmd: process.execPath, args: [join(root, 'scripts', 'generate-menu-labels.mjs')] },
    { cmd: process.execPath, args: [join(root, TSC), '--noEmit'] },
  ];
}

/**
 * The single cargo invocation that warms the cache.
 *
 * `--lib` is deliberate: `main.rs` is a shim over `datazen_lib`, and
 * `generate_context!` (which needs a real `dist/`) only exists in the bin. The
 * lib is where `mod driver_init` and every `#[cfg(feature = "driver-*")]` block
 * live, so `--lib` still pulls in the whole driver set.
 *
 * `--release` is equally deliberate and must stay in sync with `tauri build`,
 * which compiles the release profile. A bare `cargo build` would warm the `dev`
 * profile — a different target dir the variant jobs never read, so the warmup
 * would cost time and save nothing.
 */
export function planCargoArgs({ target, features }) {
  const args = ['build', '--release'];
  if (target) {
    args.push('--target', target);
  }
  args.push('-p', 'datazen', '--lib');
  if (features.length > 0) {
    args.push('--features', features.join(','));
  }
  return args;
}

export function readDriverFeatures(root = ROOT) {
  const path = join(root, DRIVER_FEATURES_FILE);
  if (!existsSync(path)) {
    throw new Error(
      `missing ${DRIVER_FEATURES_FILE} — run resolve-drivers before the warmup (use with-driver-inject)`,
    );
  }
  const { features } = JSON.parse(readFileSync(path, 'utf-8'));
  return features ?? [];
}

/**
 * `tauri-build` reads `frontendDist` during the build; a stub keeps the lib
 * build from depending on a Vite bundle this job has no reason to produce.
 * The real variant builds overwrite `dist/` on their own runner.
 */
export function writeStubFrontend(root = ROOT) {
  const dist = join(root, 'dist');
  mkdirSync(dist, { recursive: true });
  const file = join(dist, 'index.html');
  writeFileSync(file, '<!doctype html><title>driver warmup stub</title>\n');
  return file;
}

export function runWarmup(argv, { root = ROOT, env = process.env, log = console.log } = {}) {
  const targetArg = argv.find((a) => a.startsWith('--target='));
  const target = targetArg ? targetArg.slice('--target='.length) : null;
  const typecheck = argv.includes('--typecheck') || argv.includes('--typecheck=1');

  const features = readDriverFeatures(root);
  log(`[ci-driver-warmup] target=${target ?? '<host>'} drivers=${features.length}`);

  // Needed by both paths below; written once so the codegen scripts and the
  // cargo build see the same tree.
  writeStubFrontend(root);

  if (typecheck) {
    log('[ci-driver-warmup] typechecking the union driver set once');
    for (const { cmd, args } of planTypecheckCommands(root)) {
      const result = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', shell: false });
      if (result.status !== 0) {
        return { status: result.status ?? 1, stage: 'typecheck' };
      }
    }
  }

  const args = planCargoArgs({ target, features });
  log(`[ci-driver-warmup] cargo ${args.join(' ')}`);
  const result = spawnSync('cargo', args, { cwd: root, stdio: 'inherit', shell: false });
  if (result.error) {
    console.error('[ci-driver-warmup] cargo spawn failed:', result.error);
  }
  return { status: result.status ?? 1, stage: 'cargo' };
}

function main() {
  const result = runWarmup(process.argv.slice(2));
  process.exit(result.status);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main();
}
