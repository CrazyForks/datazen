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
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  inspectProCheckout,
  PRO_REL,
  readProContractVersion,
  runProGate,
} from '../pro-seam-gate.mjs';

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
