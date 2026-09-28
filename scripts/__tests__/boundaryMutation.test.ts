/**
 * @vitest-environment node
 *
 * Self-healing of the probe lock and the probe sweep.
 *
 * A `mkdir` lock normally outlives its holder: SIGKILL, an OOM kill or a closed
 * terminal run no `finally`, so the directory stays, nothing holds it, and every
 * later run waits out the full timeout before failing — from a directory under
 * `node_modules/`, which `git status` never shows. The only available defence is
 * that the *next* run notices and recovers, which is what these cases pin.
 *
 * Each case drives `withProbeLockAt` against a private lock under a temp dir
 * rather than the shared one: a test that planted a fake lock at the shared path
 * would break the mutual exclusion every other guard test relies on.
 */
import { spawn } from 'child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { lockIsStale, sweepStaleProbes, withProbeLockAt } from './boundaryMutation';

/** A pid that is guaranteed not to be running: one past the kernel's max. */
const DEAD_PID = 0x7fff_fffe;

const sandboxes: string[] = [];

function sandbox() {
  const dir = join(tmpdir(), `dz-probe-lock-${process.pid}-${sandboxes.length}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, 'probe'), { recursive: true });
  sandboxes.push(dir);
  return { lockDir: join(dir, 'probe.lock'), probeRoot: join(dir, 'probe') };
}

/** Plant a lock as if a previous run had been killed while holding it. */
function plantLock(lockDir: string, ownerPid: number, ageMs = 0) {
  mkdirSync(lockDir, { recursive: true });
  writeFileSync(join(lockDir, 'owner.json'), JSON.stringify({ pid: ownerPid, at: Date.now() }));
  if (ageMs > 0) {
    const when = new Date(Date.now() - ageMs);
    utimesSync(lockDir, when, when);
  }
}

function plantProbe(probeRoot: string, rel: string, body = 'leaked by a killed run\n') {
  const full = join(probeRoot, rel);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, body);
  return full;
}

afterEach(() => {
  for (const dir of sandboxes.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('withProbeLockAt · recovery from a killed run', () => {
  it('takes over a lock whose owner is gone instead of waiting it out', () => {
    const { lockDir, probeRoot } = sandbox();
    plantLock(lockDir, DEAD_PID);

    const started = Date.now();
    let entered = false;
    withProbeLockAt(lockDir, probeRoot, () => {
      entered = true;
    });

    expect(entered).toBe(true);
    // The point of the whole change: not one 25ms sleep, let alone 60s.
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(existsSync(lockDir)).toBe(false);
  });

  it('sweeps the probes the killed run left behind before running', () => {
    const { lockDir, probeRoot } = sandbox();
    plantLock(lockDir, DEAD_PID);
    const leaked = [
      plantProbe(probeRoot, 'src/__boundaryProbe__.ts'),
      plantProbe(probeRoot, 'dist/__boundaryProbe__.js'),
      plantProbe(probeRoot, 'node_modules/vendored-lib/__uiBoundaryProbe__.tsx'),
    ];

    let seen: string[] = [];
    withProbeLockAt(lockDir, probeRoot, () => {
      seen = leaked.filter((p) => existsSync(p));
    });

    expect(seen).toEqual([]);
  });

  it('leaves a real source file alone while sweeping', () => {
    const { lockDir, probeRoot } = sandbox();
    plantLock(lockDir, DEAD_PID);
    const real = plantProbe(probeRoot, 'src/PathInput.tsx', 'export const Button = 1;\n');

    withProbeLockAt(lockDir, probeRoot, () => {});

    expect(existsSync(real)).toBe(true);
  });

  it('takes over an aged lock whose pid has been reused', () => {
    // `process.kill(pid, 0)` cannot tell "the holder is alive" from "this pid
    // now belongs to something else", so age is the only second signal.
    const { lockDir, probeRoot } = sandbox();
    plantLock(lockDir, process.pid, 20 * 60_000);

    let entered = false;
    withProbeLockAt(lockDir, probeRoot, () => {
      entered = true;
    });

    expect(entered).toBe(true);
  });

  it('does not steal a lock from a live holder', () => {
    // The other half of the contract: recovery must not become two processes in
    // the critical section, or the probes collide and results get flaky. A
    // short timeout keeps the case fast — the wait itself is the assertion.
    const { lockDir, probeRoot } = sandbox();
    const holder = spawn('sleep', ['30'], { detached: true, stdio: 'ignore' });
    holder.unref();
    plantLock(lockDir, holder.pid);

    let entered = false;
    const started = Date.now();
    try {
      expect(() => withProbeLockAt(lockDir, probeRoot, () => (entered = true), 400)).toThrow(
        /timed out after 400ms/,
      );
      expect(lockIsStale(lockDir)).toBe(false);
      expect(Date.now() - started).toBeGreaterThanOrEqual(400);
    } finally {
      try {
        holder.kill('SIGKILL');
      } catch {
        // Already gone.
      }
    }
    expect(entered).toBe(false);
    // Untouched, so the real holder is not harmed by another run's recovery.
    expect(existsSync(lockDir)).toBe(true);
  });

  it('records the current pid as the owner while it holds the lock', () => {
    const { lockDir, probeRoot } = sandbox();
    let ownerPid = 0;
    withProbeLockAt(lockDir, probeRoot, () => {
      // Read it the way a competing process would.
      ownerPid = JSON.parse(readFileSync(join(lockDir, 'owner.json'), 'utf8')).pid;
    });
    expect(ownerPid).toBe(process.pid);
  });
});

describe('sweepStaleProbes', () => {
  it('removes probe files and the directories they needed', () => {
    const { probeRoot } = sandbox();
    const leaked = [
      plantProbe(probeRoot, 'src/__boundaryProbe__.ts'),
      plantProbe(probeRoot, 'dist/__boundaryProbe__.js'),
      plantProbe(probeRoot, 'build/__boundaryProbe__.js'),
      plantProbe(probeRoot, 'coverage/__boundaryProbe__.js'),
      plantProbe(probeRoot, 'node_modules/vendored-lib/__boundaryProbe__.js'),
    ];
    plantProbe(probeRoot, 'src/index.ts', 'export const real = 1;\n');

    const removed = sweepStaleProbes(probeRoot);

    expect(removed.map((p) => p.slice(probeRoot.length + 1)).sort()).toEqual(
      leaked.map((p) => p.slice(probeRoot.length + 1)).sort(),
    );
    for (const dir of ['dist', 'build', 'coverage', 'node_modules']) {
      expect(existsSync(join(probeRoot, dir))).toBe(false);
    }
    expect(existsSync(join(probeRoot, 'src/index.ts'))).toBe(true);
  });

  it('never removes a directory that still holds something real', () => {
    const { probeRoot } = sandbox();
    plantProbe(probeRoot, 'node_modules/vendored-lib/index.ts', 'export const vendored = 1;\n');

    sweepStaleProbes(probeRoot);

    expect(existsSync(join(probeRoot, 'node_modules/vendored-lib/index.ts'))).toBe(true);
  });
});
