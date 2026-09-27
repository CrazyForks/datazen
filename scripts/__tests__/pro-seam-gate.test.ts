/**
 * Tests for `scripts/pro-seam-gate.mjs` — the host gate's walk across the seam
 * into the Pro extension package.
 *
 * The gate's whole value is that it **does not pass when it cannot do its job**,
 * so the first group below is the one that matters: a Pro-less checkout has to
 * FAIL by default. A regression to "warn and exit 0" is exactly the shape of
 * defect this track keeps finding (a gate that reports success for a check it
 * never ran), and it is asserted here directly.
 */
import { describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  inspectProCheckout,
  PRO_REL,
  proVerdict,
  readProContractVersion,
  runProGate,
} from '../pro-seam-gate.mjs';
import { ROOT } from '../pack-ep.mjs';

/** A throwaway "host root" that does or does not contain a Pro checkout. */
function makeRoot(withPro: boolean): string {
  const root = mkdtempSync(join(tmpdir(), 'pro-seam-gate-'));
  if (!withPro) return root;
  const dir = join(root, PRO_REL);
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(
    join(dir, 'manifest.json'),
    JSON.stringify({ engines: { extensionPointsVersion: '1.1.0' } }),
  );
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name: '@datazen/extension-sql-editor-pro' }),
  );
  writeFileSync(join(dir, 'src/proFeatures.ts'), 'export const x = 1;\n');
  return root;
}

/** Captures both sinks so assertions can read what an operator would have seen. */
function sinks() {
  const lines: string[] = [];
  const errors: string[] = [];
  return {
    log: (...a: unknown[]) => void lines.push(a.join(' ')),
    error: (...a: unknown[]) => void errors.push(a.join(' ')),
    out: () => lines.join('\n'),
    err: () => errors.join('\n'),
  };
}

describe('pro-seam-gate: Pro absent', () => {
  it('FAILS by default — a gate that cannot see Pro must not report success', () => {
    const s = sinks();
    const code = runProGate({
      root: makeRoot(false),
      env: {},
      log: s.log,
      error: s.error,
    });
    expect(code).toBe(1);
    // The message has to name the escape hatch, or the failure is not actionable.
    expect(s.err()).toContain('DATAZEN_ALLOW_MISSING_PRO=1');
  });

  it('names every missing piece, not just "not found"', () => {
    const s = sinks();
    runProGate({ root: makeRoot(false), env: {}, log: s.log, error: s.error });
    expect(s.err()).toContain('manifest.json');
    expect(s.err()).toContain('src/proFeatures.ts');
  });

  it('exits 0 only when the absence is explicitly acknowledged', () => {
    const s = sinks();
    const code = runProGate({
      root: makeRoot(false),
      env: { DATAZEN_ALLOW_MISSING_PRO: '1' },
      log: s.log,
      error: s.error,
    });
    expect(code).toBe(0);
    // Acknowledged must still be *visible*: a green exit code that hides the fact
    // that the seam was never walked is the very trap being guarded against.
    expect(s.out()).toContain('SKIPPED');
  });

  it('treats any value other than "1" as not acknowledged', () => {
    for (const value of ['0', 'true', 'yes', '']) {
      const s = sinks();
      const code = runProGate({
        root: makeRoot(false),
        env: { DATAZEN_ALLOW_MISSING_PRO: value },
        log: s.log,
        error: s.error,
      });
      expect(code, `DATAZEN_ALLOW_MISSING_PRO=${value} must not be an acknowledgement`).toBe(1);
    }
  });
});

describe('pro-seam-gate: Pro present', () => {
  it('runs the Pro typecheck and suite from the host gate', () => {
    const s = sinks();
    const spawn = vi.fn(() => ({ status: 0 }));
    const code = runProGate({
      root: makeRoot(true),
      env: {},
      spawn,
      log: s.log,
      error: s.error,
    });
    expect(code).toBe(0);
    // `npx`, not `pnpm`: a worktree symlinks node_modules and `pnpm run` aborts
    // with ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY before running anything.
    expect(spawn).toHaveBeenCalledWith(
      'npx',
      ['tsc', '--noEmit'],
      expect.objectContaining({ cwd: expect.stringContaining(PRO_REL) }),
    );
    expect(spawn).toHaveBeenCalledWith(
      'npx',
      ['vitest', 'run'],
      expect.objectContaining({ cwd: expect.stringContaining(PRO_REL) }),
    );
  });

  it('propagates a red Pro suite instead of absorbing it', () => {
    const s = sinks();
    const spawn = vi.fn((_cmd: string, args: string[]) => ({
      status: args[0] === 'vitest' ? 1 : 0,
    }));
    const code = runProGate({
      root: makeRoot(true),
      env: {},
      spawn,
      log: s.log,
      error: s.error,
    });
    expect(code).toBe(1);
    expect(s.err()).toContain('Pro gate failed');
  });

  it('stops at the first failing step rather than running the rest', () => {
    const s = sinks();
    const spawn = vi.fn(() => ({ status: 2 }));
    runProGate({ root: makeRoot(true), env: {}, spawn, log: s.log, error: s.error });
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(spawn).toHaveBeenCalledWith('npx', ['tsc', '--noEmit'], expect.anything());
  });

  it('surfaces the Pro EP contract version so a one-sided bump is visible', () => {
    const s = sinks();
    runProGate({
      root: makeRoot(true),
      env: {},
      spawn: vi.fn(() => ({ status: 0 })),
      log: s.log,
      error: s.error,
    });
    expect(s.out()).toContain('1.1.0');
  });
});

describe('pro-seam-gate: detection', () => {
  it('reports present only when the whole entry set is there', () => {
    const ok = inspectProCheckout(makeRoot(true));
    expect(ok.present).toBe(true);
    expect(ok.missing).toEqual([]);
    expect(inspectProCheckout(makeRoot(false)).present).toBe(false);
  });

  it('returns undefined rather than throwing for an unreadable manifest', () => {
    expect(readProContractVersion(makeRoot(false))).toBeUndefined();
  });
});

/**
 * The three-state verdict.
 *
 * Before this, `inspectProCheckout` returned a single `present` boolean computed
 * as `missing.length === 0`, and the directory itself was listed among the
 * required entries. That made "no Pro at all" and "Pro here but incomplete"
 * indistinguishable, and the two guards that defined presence by the file they
 * consume then treated a *broken* Pro as an acknowledgeable absence. Measured
 * with `src/proFeatures.ts` deleted and `DATAZEN_ALLOW_MISSING_PRO=1` set:
 * pack-ep went red, the gate exited 0, and the host seam guard reported
 * `1 passed | 7 skipped`.
 */
describe('proVerdict: absent vs partial vs present', () => {
  /** A root whose Pro directory exists but is missing the named files. */
  function makePartialRoot(drop: string[]): string {
    const root = makeRoot(true);
    for (const rel of drop) rmSync(join(root, PRO_REL, rel), { force: true });
    return root;
  }

  it('classifies the three states as mutually exclusive and exhaustive', () => {
    const present = proVerdict(makeRoot(true), {});
    const absent = proVerdict(makeRoot(false), {});
    const partial = proVerdict(makePartialRoot(['src/proFeatures.ts']), {});

    expect(present.state).toBe('present');
    expect(absent.state).toBe('absent');
    expect(partial.state).toBe('partial');

    // Exactly one of the three — never two, never none.
    const states = [present, absent, partial];
    expect(states.filter((s) => s.present)).toHaveLength(1);
    expect(states.filter((s) => s.mustFail)).toHaveLength(1);
    expect(states.filter((s) => s.maySkip)).toHaveLength(0);
  });

  it('distinguishes "no Pro at all" from "Pro here but incomplete"', () => {
    const absent = proVerdict(makeRoot(false), {});
    const partial = proVerdict(makePartialRoot(['src/proFeatures.ts']), {});
    expect(absent.dirExists).toBe(false);
    expect(partial.dirExists).toBe(true);
    expect(partial.missing).toEqual(['src/proFeatures.ts']);
    // The whole point: these are different worlds, not the same boolean.
    expect(partial.present).toBe(false);
    expect(partial.mustFail).toBe(true);
    expect(absent.mustFail).toBe(false);
  });

  it('NEVER lets the opt-out waive a partial checkout', () => {
    const root = makePartialRoot(['src/proFeatures.ts']);
    const waived = proVerdict(root, { DATAZEN_ALLOW_MISSING_PRO: '1' });
    expect(waived.allowMissing).toBe(true);
    // The variable is set, and it still must not buy a skip.
    expect(waived.maySkip).toBe(false);
    expect(waived.mustFail).toBe(true);
  });

  it('lets the opt-out waive only a true absence', () => {
    const root = makeRoot(false);
    expect(proVerdict(root, { DATAZEN_ALLOW_MISSING_PRO: '1' }).maySkip).toBe(true);
    expect(proVerdict(root, {}).maySkip).toBe(false);
  });

  it('fails the gate on a partial checkout even with the opt-out set', () => {
    const s = sinks();
    const code = runProGate({
      root: makePartialRoot(['src/proFeatures.ts']),
      env: { DATAZEN_ALLOW_MISSING_PRO: '1' },
      spawn: vi.fn(() => ({ status: 0 })),
      log: s.log,
      error: s.error,
    });
    expect(code).toBe(1);
    expect(s.err()).toContain('PRESENT BUT INCOMPLETE');
    // It must not have run anything and reported success.
    expect(s.out()).not.toContain('green');
  });

  it('keeps the verdict the seam guard consumes identical to this implementation', () => {
    // The host seam guard reads the verdict over a `--verdict` process boundary
    // (the root typecheck program has allowJs:false, so it cannot import this
    // .mjs). If the JSON and this function ever disagreed, the three guards
    // would drift back into three different verdicts — the original defect.
    const script = join(ROOT, 'scripts/pro-seam-gate.mjs');
    const roots: Array<[string, string]> = [
      [makeRoot(true), 'present'],
      [makeRoot(false), 'absent'],
      [makePartialRoot(['src/proFeatures.ts']), 'partial'],
    ];
    // BOTH sides get the SAME env, explicitly. The parity claim is "same input
    // ⇒ same verdict"; that is only testable if the input is one the test chose.
    //
    // An earlier revision passed `{}` to the direct call and let the subprocess
    // inherit `process.env`, so the two sides were fed different inputs and the
    // assertion only held when the caller happened to have no
    // DATAZEN_ALLOW_MISSING_PRO set. ci.yml sets it on `pnpm test:unit`, so this
    // test was red in CI and green locally — it was measuring the caller's
    // environment, not the two code paths.
    //
    // The env cases are therefore enumerated, and the CI one is a deliberate
    // case rather than an accident of where the test runs.
    const envCases: Array<[string, NodeJS.ProcessEnv]> = [
      ['no opt-out', {}],
      ['opt-out set (what ci.yml sets on pnpm test:unit)', { DATAZEN_ALLOW_MISSING_PRO: '1' }],
      // Whatever the caller actually has, fed to BOTH sides. This is the case
      // that used to fail, kept so that "the env leaked in on one side only"
      // can never come back silently.
      ['ambient process.env', process.env],
    ];
    for (const [envLabel, env] of envCases) {
      for (const [root, expected] of roots) {
        const out = execFileSync(process.execPath, [script, '--verdict', `--root=${root}`], {
          encoding: 'utf8',
          env,
        });
        const viaCli = JSON.parse(out) as ReturnType<typeof proVerdict>;
        const direct = proVerdict(root, env);
        expect(viaCli.state, `${envLabel} / ${expected}`).toBe(expected);
        expect(viaCli, `${envLabel} / ${expected}`).toEqual(direct);
        // And the two sides must agree on the skip/waiver decision too, not
        // just the state string — that field is what the defect moved.
        expect(viaCli.maySkip, `${envLabel} / ${expected}`).toBe(direct.maySkip);
        expect(viaCli.mustFail, `${envLabel} / ${expected}`).toBe(direct.mustFail);
      }
    }
  });
});
