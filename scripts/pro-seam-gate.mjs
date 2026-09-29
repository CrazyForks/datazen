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
 * @returns {{state: string, present: boolean, dir: string, dirExists: boolean, missing: string[]}}
 */
export function inspectProCheckout(root) {
  const dir = resolve(root, PRO_REL);
  // The directory is inspected SEPARATELY from the files inside it. Conflating
  // them is what produced three different "is the Pro here?" definitions across
  // three guards: a checkout that is present-but-incomplete then looks absent,
  // and the `DATAZEN_ALLOW_MISSING_PRO=1` opt-out silently turns a broken
  // checkout into a green skip.
  const dirExists = existsSync(dir);
  const files = {
    'manifest.json': resolve(dir, 'manifest.json'),
    'package.json': resolve(dir, 'package.json'),
    'src/proFeatures.ts': resolve(dir, 'src/proFeatures.ts'),
  };
  const missing = Object.entries(files)
    .filter(([, path]) => !existsSync(path))
    .map(([label]) => label);
  /** absent = no checkout at all; partial = here but incomplete; present = usable. */
  const state = !dirExists ? 'absent' : missing.length === 0 ? 'present' : 'partial';
  return { state, present: state === 'present', dir, dirExists, missing };
}

/**
 * The Pro-availability decision, made once, for the guards that consult the
 * opt-out.
 *
 * ⚠️ "every Pro-dependent guard" was the wording here until a review caught it,
 * and it was wrong in the same way a comment in `pack-ep.test.ts` was wrong.
 * `packages/extension-points/src/__tests__/security.test.ts` was the fourth:
 * a Pro-dependent gate that made its own decision, never reading
 * `DATAZEN_ALLOW_MISSING_PRO` (it called `readFileSync(PRO_MANIFEST_PATH)`
 * bare) and ENOENTing on a Pro-less checkout. Four guards, one opt-out, and one
 * of them outside the family.
 *
 * It now fetches this verdict over the `--verdict` process boundary, so the
 * family is whole. What that buys, and what it does not: the host unit-test step
 * goes green on a Pro-less checkout because all four guards now skip — and a
 * green unit-test step is the signal a maintainer reads as "the Pro guards are
 * fine". They are not; they did not run. That is why the skips are *visible*
 * (`it.skip` with the reason in the test NAME, so the reporter prints it) and
 * why `scripts/run-pro-guards.mjs` runs the family in its own step with a
 * `PRO-GUARDS state=...` summary line. A green `pnpm test:unit` and a green
 * Pro-seam verdict are two different claims; do not read one as the other, and
 * do not let the opt-out outlive a CI checkout that can obtain the Pro.
 * Three states, mutually exclusive and exhaustive over any checkout:
 *   'present' — usable; the Pro-dependent checks must RUN.
 *   'partial' — directory here, key files missing. NEVER skippable: a checkout
 *               that is half-there is a broken checkout, and acknowledging it
 *               with an env var is exactly the "report success for a check that
 *               never ran" defect this module exists to prevent. No opt-out.
 *   'absent'  — no checkout at all. Skippable, but only when explicitly
 *               acknowledged; otherwise the guards are red.
 *
 * @param {string} root host repo root
 * @param {Record<string, string|undefined>} [env] env source (default: process.env)
 * @returns {{state: string, present: boolean, dir: string, dirExists: boolean,
 *            missing: string[], allowMissing: boolean, maySkip: boolean,
 *            mustFail: boolean}}
 */
export function proVerdict(root, env = process.env) {
  const info = inspectProCheckout(root);
  const allowMissing = env.DATAZEN_ALLOW_MISSING_PRO === '1';
  return {
    ...info,
    allowMissing,
    maySkip: info.state === 'absent' && allowMissing,
    mustFail: info.state === 'partial',
  };
}

/**
 * Read the Pro `engines.extensionPointsVersion`, or `undefined`.
 *
 * @param {string} dir
 * @returns {string|undefined}
 */
export function readProContractVersion(dir) {
  try {
    const manifest = JSON.parse(readFileSync(resolve(dir, 'manifest.json'), 'utf8'));
    return manifest?.engines?.extensionPointsVersion;
  } catch {
    return undefined;
  }
}

/**
 * @typedef {object} GateOptions
 * @property {string} [root]                host repo root (default: cwd)
 * @property {boolean} [runTests]           run `npx vitest run` in Pro (default true)
 * @property {boolean} [runTypecheck]       run `npx tsc --noEmit` in Pro (default true)
 * @property {Function} [log]               info sink
 * @property {Function} [error]             error sink
 * @property {Record<string, string|undefined>} [env] env source (default: process.env)
 * @property {Function} [spawn]             spawnSync-shaped runner (injectable for tests)
 * @property {string[]} [argv]              CLI argv (default: process.argv)
 */

/**
 * Run the Pro gate.
 *
 * @param {GateOptions} [opts]
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

  const verdict = proVerdict(root, env);
  const state = verdict;
  log(BANNER);
  log('cross-repo seam gate: host → Pro extension package');
  log(`  host root : ${root}`);
  log(`  pro dir   : ${state.dir}`);
  log(`  pro state : ${state.state.toUpperCase()}`);

  if (state.mustFail) {
    // Not skippable, not acknowledgeable. A half-present checkout is a broken
    // checkout; `DATAZEN_ALLOW_MISSING_PRO=1` exists for "there is no Pro here",
    // and honouring it here is what previously turned a partial Pro into a
    // silent green skip in two of the three guards.
    error(
      [
        '',
        `  ✖ Pro checkout is PRESENT BUT INCOMPLETE (state=partial). Missing:`,
        ...state.missing.map((m) => `      · ${m}`),
        '',
        '    This is not a "no Pro checkout" situation and cannot be waived with',
        '    DATAZEN_ALLOW_MISSING_PRO=1 — that variable means "this checkout is',
        '    knowingly Pro-less", which is false here. A partial Pro is a broken',
        '    checkout: repairing it (or removing it) is the only correct action.',
      ].join('\n'),
    );
    return 1;
  }

  if (!state.present) {
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
    if (verdict.allowMissing) {
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

  /** @type {Array<[string, string[]]>} */
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

/**
 * CLI entry, kept separate from the module so it stays unit-testable.
 *
 * @param {GateOptions} [opts]
 * @returns {number} exit code
 */
export function runCli(opts = {}) {
  const argv = opts.argv ?? process.argv;
  const rest = { ...opts };
  delete rest.argv;
  const rootArg = argv.find((a) => a.startsWith('--root='));
  if (rootArg) rest.root = resolve(rootArg.slice('--root='.length));
  if (argv.includes('--skip-tests')) rest.runTests = false;
  if (argv.includes('--skip-typecheck')) rest.runTypecheck = false;

  // `--verdict` prints the shared judgement as JSON and runs NOTHING. It exists
  // so the TypeScript seam guard can consume this exact implementation instead
  // of re-deriving its own "is the Pro here?" rule.
  //
  // Why a process boundary rather than a plain `import`: the root typecheck
  // program has `allowJs: false`, so a `src/**` TypeScript file importing this
  // `.mjs` fails with TS7016, and the project forbids `any`. The alternative
  // — a hand-written `pro-seam-gate.d.mts` — would be a FOURTH independent
  // statement of the same shape, free to drift from the implementation, which
  // is the very defect class (three disagreeing definitions) this refactor
  // removes. The JSON is the implementation's own output, so it cannot drift.
  //
  // This is a query, not a gate: it exits 0 even for `partial`, because the
  // caller decides what to do with the verdict. It never runs tsc or vitest.
  if (argv.includes('--verdict')) {
    const root = rest.root ?? process.cwd();
    process.stdout.write(`${JSON.stringify(proVerdict(root), null, 2)}\n`);
    return 0;
  }
  return runProGate(rest);
}

/* istanbul ignore next */
if (process.argv[1] && process.argv[1].endsWith('pro-seam-gate.mjs')) {
  process.exitCode = runCli();
}
