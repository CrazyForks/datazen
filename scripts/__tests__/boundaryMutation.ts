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
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** Lives under `node_modules/` so it can never end up in `git status`. */
const LOCK_DIR = join(REPO_ROOT, 'node_modules/.cache/dz-boundary-probe.lock');
const LOCK_TIMEOUT_MS = 60_000;

/** Synchronous sleep — the lock must not be awaited away inside a sync test. */
function sleepSync(ms: number) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Run `fn` with exclusive access to the real `packages/ui/` tree.
 *
 * @template T
 * @param {() => T} fn
 * @returns {T}
 */
export function withProbeLock(fn) {
  mkdirSync(dirname(LOCK_DIR), { recursive: true });
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  for (;;) {
    try {
      mkdirSync(LOCK_DIR);
      break;
    } catch {
      if (Date.now() > deadline) {
        throw new Error(
          `withProbeLock: timed out after ${LOCK_TIMEOUT_MS}ms waiting for ${LOCK_DIR}`,
        );
      }
      sleepSync(25);
    }
  }
  try {
    return fn();
  } finally {
    rmSync(LOCK_DIR, { recursive: true, force: true });
  }
}

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
  return withProbeLock(() => {
    const full = join(REPO_ROOT, rel);
    if (existsSync(full)) {
      throw new Error(`withTempSourceFile refused to overwrite a tracked file: ${rel}`);
    }
    writeFileSync(full, contents);
    try {
      return run();
    } finally {
      rmSync(full, { force: true });
    }
  });
}
