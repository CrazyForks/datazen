#!/usr/bin/env node
/**
 * Cross-repo gate: the host's blind spot toward the Pro extension package.
 *
 * ── The gap this closes ─────────────────────────────────────────────────────
 *
 * `packages/pro-extensions/sql-editor-pro` is a **separate git repository**,
 * gitignored by the host (`.gitignore:68`), and by design **absent from a plain
 * host checkout** — the host-only CI job never clones it. The consequence is a
 * structural one, not an oversight:
 *
 *   `npx vitest run` in the host is **structurally incapable** of failing on a
 *   Pro-side defect. Its `test.include` lists no `packages/pro-extensions/**`
 *   path, and the 9 audited host test files that touch the privileged-extension
 *   contract never import the real Pro package (they exercise a host-local
 *   wrapper in `src/components/sql-editor/proCompartments.ts` that merely shares
 *   the name `createFoldExtensions`).
 *
 * So any regression that lives purely on the Pro side of the seam is invisible
 * to the host gate **by construction**. Two real defects got through that way:
 * BUG-003 (folding entirely dead) and G1 (`proFeatures.createFoldExtensions`
 * dropping the settings bag, silently disabling the extension-side half of the
 * `codeFolding` gate) — each shipped with a fully green host suite *and* a fully
 * green Pro suite, because the two suites were on opposite sides of the seam and
 * neither walked it.
 *
 * ── Precision about "no visibility": it is behavioural, not absolute ────────
 *
 * Two host tests do touch the Pro directory, and neither supplies the missing
 * coverage:
 *   · `pack-ep.test.ts` builds and signs the real Pro — but only when its
 *     `package.json` exists (`it.skip` otherwise, line 194) — and it asserts the
 *     **packaging contract** (bundle emitted, signature written, peerDeps in
 *     range), never Pro behaviour.
 *   · `security.test.ts` reads the real Pro `manifest.json` to compare the EP
 *     contract version.
 * Both evaporate in precisely the checkout that matters. The host-only CI job
 * clones no Pro: the first skips, the second fails ENOENT. So in CI the host
 * gate asserts *nothing* about how the Pro behaves, and the Pro's own suite
 * belongs to no CI job at all. `pack-ep.test.ts` is, in its own way, a third
 * instance of the silent-skip pattern this gate exists to stop.
 *
 * This gate is the seam-walker. When the Pro checkout is present it runs the Pro
 * suite *from the host gate*, so "Pro is green" stops being a fact a developer
 * has to remember to go check and becomes a fact the host gate verifies.
 *
 * ── Why it FAILS rather than skips when the Pro is absent ───────────────────
 *
 * The tempting implementation is `if (!exists) { skip; return 0 }`, and it is
 * exactly the trap: a gate that prints a friendly line and exits 0 in the one
 * environment where it cannot do its job is indistinguishable, to any CI that
 * reads the exit code, from a gate that did its job. That is the same
 * "0 hits treated as a conclusion" error that has bitten this track repeatedly.
 *
 * So the default is a **failure with an actionable message**, and the escape
 * hatch is an explicit, greppable acknowledgement:
 *
 *   DATAZEN_ALLOW_MISSING_PRO=1   acknowledge a legitimately Pro-less checkout
 *                                 (the host-only CI job is one)
 *
 * This matches the rule the repo already applies elsewhere: the Pro manifest
 * checks in `packages/extension-points/src/__tests__/security.test.ts` read the
 * real `manifest.json` off disk and fail with ENOENT when it is absent. This
 * gate is that policy, stated once and applied to the whole package.
 *
 * Usage:
 *   node scripts/pro-seam-gate.mjs [--root=<dir>] [--skip-tests] [--skip-typecheck]
 *
 * Exit codes: 0 = Pro suite green (or absence explicitly acknowledged);
 *             1 = Pro absent without acknowledgement, or Pro suite/typecheck red.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Pro checkout location, relative to the host repo root. */
export const PRO_REL = 'packages/pro-extensions/sql-editor-pro';

const BANNER = '─'.repeat(72);

/**
 * What the host gate can see of the Pro package at `root`.
 *
 * Reports *what is missing* rather than a bare boolean, so the failure message
 * can name the specific thing an operator has to provision.
 *
 * @param {string} root host repo root
 * @returns {{ present: boolean, dir: string, missing: string[] }}
 */
export function inspectProCheckout(root) {
  const dir = resolve(root, PRO_REL);
  const required = {
    'the Pro checkout directory': dir,
    'manifest.json': resolve(dir, 'manifest.json'),
    'package.json': resolve(dir, 'package.json'),
    'src/proFeatures.ts': resolve(dir, 'src/proFeatures.ts'),
  };
  const missing = Object.entries(required)
    .filter(([, path]) => !existsSync(path))
    .map(([label]) => label);
  return { present: missing.length === 0, dir, missing };
}

/** Read the Pro `engines.extensionPointsVersion`, or `undefined`. */
export function readProContractVersion(dir) {
  try {
    const manifest = JSON.parse(readFileSync(resolve(dir, 'manifest.json'), 'utf8'));
    return manifest?.engines?.extensionPointsVersion;
  } catch {
    return undefined;
  }
}

/**
 * Run the Pro gate.
 *
 * @param {object} [opts]
 * @param {string} [opts.root]        host repo root (default: cwd)
 * @param {boolean} [opts.runTests]   run `npx vitest run` in Pro (default true)
 * @param {boolean} [opts.runTypecheck] run `npx tsc --noEmit` in Pro (default true)
 * @param {Function} [opts.log]      info sink
 * @param {Function} [opts.error]     error sink
 * @param {object} [opts.env]         env source (default: process.env)
 * @param {Function} [opts.spawn]     spawnSync-shaped runner (injectable for tests)
 * @returns {number} exit code
 */
export function runProGate(opts = {}) {
  const {
    root = process.cwd(),
    runTests = true,
    runTypecheck = true,
    log = console.log,
    error = console.error,
    env = process.env,
    spawn = spawnSync,
  } = opts;

  const state = inspectProCheckout(root);
  log(BANNER);
  log('cross-repo seam gate: host → Pro extension package');
  log(`  host root : ${root}`);
  log(`  pro dir   : ${state.dir}`);

  if (!state.present) {
    const allow = env.DATAZEN_ALLOW_MISSING_PRO === '1';
    const explanation = [
      '',
      '  ✖ Pro checkout NOT available. The host gate is structurally blind to',
      '    the Pro package, so no Pro-side defect can be caught by it. Missing:',
      ...state.missing.map((m) => `      · ${m}`),
      '',
      '    Provision the Pro repo (see scripts/new-feature-worktree.sh step 6) to',
      '    run this gate for real, or re-run with',
      '      DATAZEN_ALLOW_MISSING_PRO=1',
      '    to acknowledge that this checkout is knowingly Pro-less.',
      '',
    ].join('\n');
    if (allow) {
      log(explanation.replace('✖', '⚠'));
      log('  → SKIPPED (acknowledged via DATAZEN_ALLOW_MISSING_PRO=1)');
      log(BANNER);
      return 0;
    }
    error(explanation);
    return 1;
  }

  const version = readProContractVersion(state.dir);
  log(`  pro EP contract version: ${version ?? '(undeclared)'}`);

  const steps = [];
  if (runTypecheck) steps.push(['tsc --noEmit', ['tsc', '--noEmit']]);
  if (runTests) steps.push(['vitest run', ['vitest', 'run']]);

  for (const [label, args] of steps) {
    log(`\n  → npx ${args.join(' ')}   (in Pro)`);
    // `npx` rather than `pnpm`: a worktree's `node_modules` is a symlink to the
    // main checkout, and `pnpm run` aborts on it with
    // ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY before executing anything.
    const result = spawn('npx', args, { cwd: state.dir, stdio: 'inherit' });
    const code = result?.status ?? 1;
    if (code !== 0) {
      error(`\n  ✖ Pro gate failed at \`${label}\` (exit ${code}).`);
      error('    A green host suite does NOT imply a green Pro package — this is');
      error('    exactly the seam the host gate cannot see on its own.');
      log(BANNER);
      return code;
    }
    log(`  ✓ ${label}`);
  }

  log('\n  ✓ Pro gate green: typecheck + suite both pass.');
  log(BANNER);
  return 0;
}

/** CLI entry, kept separate from the module so it stays unit-testable. */
export function runCli(opts = {}) {
  const argv = opts.argv ?? process.argv;
  const rest = { ...opts };
  delete rest.argv;
  const rootArg = argv.find((a) => a.startsWith('--root='));
  if (rootArg) rest.root = resolve(rootArg.slice('--root='.length));
  if (argv.includes('--skip-tests')) rest.runTests = false;
  if (argv.includes('--skip-typecheck')) rest.runTypecheck = false;
  return runProGate(rest);
}

/* istanbul ignore next */
if (process.argv[1] && process.argv[1].endsWith('pro-seam-gate.mjs')) {
  process.exitCode = runCli();
}
