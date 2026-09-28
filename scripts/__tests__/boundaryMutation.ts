/**
 * Mutation helper for the boundary guards.
 *
 * A synthetic rule over an in-memory tree proves a *predicate* fires. This
 * helper proves the **shipped configuration** fires: it drops a real file into
 * the real working tree, lets the guard walk the real directory, and removes
 * the file again afterwards. That is the only way to know a new guard has
 * teeth — a guard whose rule table is never exercised against a real file can
 * be green for the wrong reason (wrong directory, wrong root, walk skipped).
 *
 * Vitest runs test *files* in parallel and both guard suites mutate the same
 * `packages/ui/` tree, so every operation that observes or mutates that tree
 * goes through {@link withProbeLock} — an on-disk `mkdir` lock, which is atomic
 * across processes — instead of a per-process mutex that would not help.
 */
import { execFileSync } from 'child_process';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** Lives under `node_modules/` so it can never end up in `git status`. */
const LOCK_DIR = join(REPO_ROOT, 'node_modules/.cache/dz-boundary-probe.lock');
const LOCK_OWNER_FILE = join(LOCK_DIR, 'owner.json');
const LOCK_TIMEOUT_MS = 60_000;
/**
 * Age at which a lock is taken over even if its recorded pid still looks alive.
 *
 * Only a backstop for pid reuse, which is the one case `process.kill(pid, 0)`
 * cannot see: a killed holder's pid may already belong to an unrelated
 * process. It is set far above any real critical section (a guard walk is
 * ~1s) so it cannot fire against a live-but-slow holder, and far below the
 * 60s wait so recovery still happens inside a single test run.
 */
const LOCK_MAX_AGE_MS = 10 * 60_000;
/** How many stale locks to clear before falling back to waiting, as a loop guard. */
const MAX_STALE_CLEARANCES = 16;

/**
 * Filename prefixes reserved for mutation probes.
 *
 * Every probe must use one of them ({@link withTempSourceFiles} enforces it),
 * which is what makes {@link sweepStaleProbes} able to find a probe left behind
 * by a hard kill: a killed process gets no `finally`, so the only thing that can
 * clean up after it is the next run.
 */
const PROBE_PREFIXES = ['__boundaryProbe__', '__uiBoundaryProbe__'];

/** The subtree a probe can land in. Everything here is a throwaway test file. */
const PROBE_ROOT = 'packages/ui';

/** Synchronous sleep — the lock must not be awaited away inside a sync test. */
function sleepSync(ms: number) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** `process.kill(pid, 0)` reports existence; `EPERM` means alive but unowned. */
function isProcessAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return /** @type {NodeJS.ErrnoException} */ err.code === 'EPERM';
  }
}

/** The pid that created the lock, or `null` if it left no readable owner file. */
function readLockOwnerPid(lockDir) {
  try {
    const parsed = JSON.parse(readFileSync(join(lockDir, 'owner.json'), 'utf8'));
    return typeof parsed?.pid === 'number' ? parsed.pid : null;
  } catch {
    return null;
  }
}

/**
 * Whether a lock left behind by a dead run can be taken over.
 *
 * A `mkdir` lock alone is a lock that outlives its holder: SIGKILL, an OOM kill
 * or a closed terminal runs no `finally`, so the directory stays, nothing holds
 * it, and every later run waits out the full timeout before failing — and the
 * directory is under `node_modules/`, so `git status` never shows it. Recovery
 * therefore has to be the *next* run's job, which is what this decides.
 */
export function lockIsStale(lockDir) {
  const ownerPid = readLockOwnerPid(lockDir);
  // Ours to keep: a re-entrant call must not steal its own lock.
  if (ownerPid !== null && ownerPid !== process.pid && !isProcessAlive(ownerPid)) return true;

  let age;
  try {
    age = Date.now() - statSync(lockDir).mtimeMs;
  } catch {
    return true; // Vanished between the failed mkdir and here — retry will win.
  }
  if (age > LOCK_MAX_AGE_MS) return true;
  return false;
}

/**
 * Delete probes a previous run left behind, then the empty directories they
 * needed. The lock is held, so anything matching a reserved prefix is debris.
 *
 * @returns {string[]} repo-relative paths removed
 */
export function sweepStaleProbes(root = join(REPO_ROOT, PROBE_ROOT)) {
  const removed = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (PROBE_PREFIXES.some((prefix) => entry.name.startsWith(prefix))) {
        rmSync(full, { force: true });
        removed.push(full);
      }
    }
  };
  if (existsSync(root)) walk(root);

  // Probe directories are created for the test and left behind empty by a kill.
  // `rmdirSync` fails on a non-empty directory, so this can never touch a real
  // one — and unlike `rmSync` it removes an empty directory at all.
  for (const rel of ['dist', 'build', 'coverage', 'node_modules/vendored-lib', 'node_modules']) {
    try {
      rmdirSync(join(root, rel));
    } catch {
      // Not empty (or already gone) — leave it alone.
    }
  }
  return removed;
}

/**
 * Run `fn` with exclusive access to the real `packages/ui/` tree.
 *
 * Self-healing: a lock left by a killed run is detected and taken over rather
 * than waited out, and the probes that run left behind are swept before this
 * run starts.
 *
 * @template T
 * @param {() => T} fn
 * @returns {T}
 */
export function withProbeLock(fn) {
  return withProbeLockAt(LOCK_DIR, join(REPO_ROOT, PROBE_ROOT), fn);
}

/**
 * The lock + sweep machinery, pointed at a caller-chosen lock and probe root.
 *
 * The parameters exist so the recovery paths can be tested against a private
 * lock instead of the shared one: a test that plants a fake lock at
 * {@link LOCK_DIR} would break the very mutual exclusion every other guard test
 * depends on.
 *
 * @template T
 * @param {string} lockDir
 * @param {string} probeRoot
 * @param {() => T} fn
 * @param {number} [timeoutMs] how long to wait for a *live* holder before failing
 * @returns {T}
 */
export function withProbeLockAt(lockDir, probeRoot, fn, timeoutMs = LOCK_TIMEOUT_MS) {
  mkdirSync(dirname(lockDir), { recursive: true });
  const deadline = Date.now() + timeoutMs;
  let cleared = 0;
  for (;;) {
    try {
      mkdirSync(lockDir);
      break;
    } catch (err) {
      if (/** @type {NodeJS.ErrnoException} */ err.code !== 'EEXIST') throw err;
      if (cleared < MAX_STALE_CLEARANCES && lockIsStale(lockDir)) {
        cleared += 1;
        rmSync(lockDir, { recursive: true, force: true });
        continue; // Retry immediately instead of sleeping on a dead holder.
      }
      if (Date.now() > deadline) {
        throw new Error(
          `withProbeLock: timed out after ${timeoutMs}ms waiting for ${lockDir}` +
            ` (owner pid ${readLockOwnerPid(lockDir) ?? 'unknown'} still alive?)`,
        );
      }
      sleepSync(25);
    }
  }
  try {
    // Written after the mkdir so a lock is never owned by a pid that has not
    // claimed it yet; until then the age cap is the only signal.
    writeFileSync(
      join(lockDir, 'owner.json'),
      JSON.stringify({ pid: process.pid, at: Date.now() }),
    );
    sweepStaleProbes(probeRoot);
    return fn();
  } finally {
    rmSync(lockDir, { recursive: true, force: true });
  }
}

/**
 * Reject a probe path that {@link sweepStaleProbes} could never find again.
 *
 * A hard kill skips the `finally` that deletes the file, and recovery relies on
 * the next run sweeping by filename prefix — so a probe that does not carry a
 * reserved prefix is a probe that can outlive the suite and show up in
 * `git status`.
 */
function assertProbePath(rel) {
  const name = rel.slice(rel.lastIndexOf('/') + 1);
  if (PROBE_PREFIXES.some((prefix) => name.startsWith(prefix))) return;
  throw new Error(
    `probe filenames must start with one of ${PROBE_PREFIXES.join(' / ')} ` +
      `so a killed run's leftovers stay sweepable, got: ${rel}`,
  );
}

/**
 * Every repo-relative path the guard suites write to, for assertions that must
 * hold about all of them at once (see the gitignore check in the suite).
 */
export const PROBE_PATHS = [
  'packages/ui/src/__boundaryProbe__.ts',
  'packages/ui/src/__boundaryProbe__.tsx',
  'packages/ui/src/__boundaryProbe__.js',
  'packages/ui/src/__boundaryProbe__.jsx',
  'packages/ui/src/__boundaryProbe__.mjs',
  'packages/ui/src/__boundaryProbe__.cjs',
  'packages/ui/src/__uiBoundaryProbe__.tsx',
  'packages/ui/dist/__boundaryProbe__.ts',
  'packages/ui/dist/__boundaryProbe__.js',
  'packages/ui/coverage/__boundaryProbe__.js',
  'packages/ui/node_modules/vendored-lib/__boundaryProbe__.js',
];

/**
 * Run `run` while `rel` (repo-relative) exists with `contents`. The file is
 * always removed, including when `run` throws, and an existing file is never
 * overwritten.
 *
 * @template T
 * @param {string} rel repo-relative POSIX path
 * @param {string} contents file body to write
 * @param {() => T} run
 * @returns {T}
 */
export function withTempSourceFile(rel, contents, run) {
  return withTempSourceFiles([[rel, contents]], run);
}

/**
 * Run `run` while every `[relPath, contents]` pair exists on disk. Missing
 * parent directories are created and — and only those that did not exist
 * before — removed again afterwards, so a probe can exercise a guard's
 * directory-skipping behaviour (`dist/`, `node_modules/`, …) without leaving a
 * tree behind or deleting a real one.
 *
 * @template T
 * @param {Array<[string, string]>} entries repo-relative POSIX path → file body
 * @param {() => T} run
 * @returns {T}
 */
export function withTempSourceFiles(entries, run) {
  return withProbeLock(() => {
    const createdDirs = [];
    const createdFiles = [];
    for (const [rel, contents] of entries) {
      assertProbePath(rel);
      const full = join(REPO_ROOT, rel);
      if (existsSync(full)) {
        cleanup();
        throw new Error(`withTempSourceFiles refused to overwrite a tracked file: ${rel}`);
      }
      let dir = dirname(full);
      const missing = [];
      while (!existsSync(dir)) {
        missing.push(dir);
        const parent = dirname(dir);
        if (parent === dir) break;
        dir = parent;
      }
      for (const d of missing.reverse()) {
        mkdirSync(d);
        createdDirs.push(d);
      }
      writeFileSync(full, contents);
      createdFiles.push(full);
    }

    function cleanup() {
      for (const file of createdFiles) rmSync(file, { force: true });
      // Deepest first, and only directories this helper created.
      for (const d of createdDirs.sort((a, b) => b.length - a.length)) {
        rmSync(d, { recursive: true, force: true });
      }
    }

    try {
      return run();
    } finally {
      cleanup();
    }
  });
}
