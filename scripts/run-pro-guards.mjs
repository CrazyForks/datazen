#!/usr/bin/env node
/**
 * Run ONLY the Pro-dependent host guards, in their own process.
 *
 * ── Why this exists ────────────────────────────────────────────────────────────
 * The Pro guards used to be observable only through `pnpm test:unit`, whose exit
 * code is the OR of every test in the repo. Measured under CI conditions (Pro
 * absent, `DATAZEN_ALLOW_MISSING_PRO=1`): the full host suite was **5 red, exit
 * 1**, and every one of those 5 came from somewhere else — 4 ENOENTs in
 * `packages/extension-points/src/__tests__/security.test.ts` (a file this track
 * never touched, and which does not consult the opt-out at all) plus the
 * pre-existing `sqlSnippetsLifecycleJourney` flake.
 *
 * So "the Pro guards went red" and "something else went red" were the SAME
 * signal, and the new `env:` block could not change that step's exit code at
 * all. A real Pro regression would have been indistinguishable from a pre-existing
 * red — which is the same defect one level up: reporting an outcome that does not
 * correspond to the check that produced it.
 *
 * This runner separates them: it runs only the Pro-dependent files, so its exit
 * code and its summary line are attributable to the Pro guards and nothing else.
 * It is a reporting step, not a replacement — those files still run inside
 * `pnpm test:unit` too.
 *
 * ── The opt-out is a decision, never a green light ──────────────────────────────
 * `DATAZEN_ALLOW_MISSING_PRO=1` acknowledges a checkout with NO Pro. It is
 * deliberately not consulted for `state=partial` (directory here, key files
 * missing): that is a broken checkout, and acknowledging it here is what turned
 * a partial Pro into a silent green skip in two of the three guards.
 *
 * ⚠️ The `state=` field in the summary line is the thing to read. A green exit
 * code with `state=ABSENT` means "not tested", NOT "passed".
 */
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { proVerdict } from './pro-seam-gate.mjs';

/** The host test files whose verdict depends on the Pro checkout. */
export const PRO_GUARD_FILES = [
  'scripts/__tests__/pack-ep.test.ts',
  'src/components/sql-editor/__tests__/proSettingsSeam.test.ts',
];

/**
 * @typedef {object} RunnerOptions
 * @property {string} [root]    host repo root (default: cwd)
 * @property {Record<string, string|undefined>} [env] env source (default: process.env)
 * @property {Function} [log]   info sink
 * @property {Function} [error] error sink
 * @property {Function} [spawn] spawnSync-shaped runner (injectable for tests)
 */

/**
 * @param {RunnerOptions} [opts]
 * @returns {number} exit code attributable to the Pro guards alone
 */
export function runProGuards(opts = {}) {
  const {
    root = process.cwd(),
    env = process.env,
    log = console.log,
    error = console.error,
    spawn = spawnSync,
  } = opts;

  const verdict = proVerdict(root, env);

  /** One greppable line naming the state, the verdict and the exit code.
   * @param {string} result @param {number} code */
  const summary = (result, code) =>
    `PRO-GUARDS state=${verdict.state.toUpperCase()} verdict=${result} exit=${code}`;

  if (verdict.mustFail) {
    error(
      `\n  ✖ Pro checkout is PRESENT BUT INCOMPLETE at ${verdict.dir}. Missing: ` +
        `${verdict.missing.join(', ')}.\n` +
        '    DATAZEN_ALLOW_MISSING_PRO=1 does not apply: it acknowledges a checkout ' +
        'with no Pro, not a broken one. Repair or remove the Pro checkout.\n',
    );
    log(summary('FAIL(not-waivable)', 1));
    return 1;
  }

  if (!verdict.present && !verdict.allowMissing) {
    error(
      `\n  ✖ No Pro checkout at ${verdict.dir}. The Pro-dependent guards were NOT ` +
        'run and their coverage is UNTESTED.\n' +
        '    Provision the Pro repo, or re-run with DATAZEN_ALLOW_MISSING_PRO=1 to ' +
        'acknowledge the gap explicitly.\n',
    );
    log(summary('FAIL(not-waived)', 1));
    return 1;
  }

  log(`\n  pro state : ${verdict.state.toUpperCase()}`);
  log('  → npx vitest run  (Pro-dependent guard files only)');
  const result = spawn('npx', ['vitest', 'run', ...PRO_GUARD_FILES], {
    cwd: root,
    stdio: 'inherit',
  });
  const code = result?.status ?? 1;
  if (code === 0) {
    log(summary(verdict.mustFail ? 'FAIL' : verdict.present ? 'RAN' : 'SKIPPED(acknowledged)', 0));
  } else {
    log(summary('FAIL', code));
  }
  return code;
}

/**
 * CLI entry.
 *
 * @param {RunnerOptions & {argv?: string[]}} [opts]
 * @returns {number} exit code
 */
export function runCli(opts = {}) {
  const argv = /** @type {string[]} */ (opts.argv ?? process.argv);
  const rootArg = argv.find((a) => a.startsWith('--root='));
  return runProGuards({
    ...opts,
    root: rootArg ? resolve(rootArg.slice('--root='.length)) : opts.root,
  });
}

/* istanbul ignore next */
if (process.argv[1] && process.argv[1].endsWith('run-pro-guards.mjs')) {
  process.exitCode = runCli();
}
