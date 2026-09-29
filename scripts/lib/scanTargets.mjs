import { existsSync, readFileSync } from 'fs';

/**
 * Read a file a walk has just enumerated, tolerating exactly one race: the
 * file being deleted by another process between the directory read and this
 * read (a mutation probe, a branch switch, a build).
 *
 * A file that is already gone by the time we read it is not part of the tree
 * being scanned, and a deleted file has no imports and no class names to
 * check, so skipping it cannot hide a finding.
 *
 * This is deliberately **not** a blanket try/catch, which is what makes it
 * safe rather than a way to mute the guard:
 *   * ENOENT that does not reconcile — the path exists again when we look — is
 *     rethrown, because then "the file is gone" is not what happened.
 *   * Every other errno (EACCES, EISDIR, EIO) is rethrown, so a real I/O
 *     fault fails the guard loudly instead of quietly shrinking its scan into
 *     a false "clean".
 *
 * Shared by every guard that walks the tree, so they cannot drift apart on how
 * a vanished file is treated.
 */
export function readScannedIfPresent(full) {
  try {
    return readFileSync(full, 'utf8');
  } catch (e) {
    if (e.code !== 'ENOENT' || existsSync(full)) throw e;
    return null;
  }
}

/**
 * What counts as scannable source, shared by every import-boundary guard.
 *
 * These two sets used to be declared separately in `check-module-layers.mjs`
 * and `check-driver-import-boundaries.mjs`, which meant the two guards silently
 * disagreed about *which files exist* — one reported `packages/ui/dist/**`
 * while the other ignored it, and only one of them looked at `.mjs`. Two
 * guards that are meant to police the same invariant must agree on their input
 * set, so the set is declared exactly once, here.
 */

/** Source files the boundary rules speak to (never `.rs`, `.css`, `.md`, …). */
export const SCAN_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);

/**
 * Vendored / generated directories that are not authored source.
 *
 * Skipping them is not leniency: `node_modules` and `dist` hold third-party or
 * build output, so a violation found there is someone else's bug, and a
 * finding there must not be able to block this repository's gate.
 */
export const SKIP_DIR_NAMES = new Set([
  'node_modules',
  'dist',
  'build',
  'coverage',
  'target',
  '.git',
  '.turbo',
  '__snapshots__',
]);

/**
 * Repository-relative directory paths that are not this repository's source.
 *
 * This set exists because `SKIP_DIR_NAMES` **cannot express a path**. It matches
 * a single `entry.name` at any depth, so the two only differ in what they get
 * wrong:
 *
 *   * adding `'packages/pro-extensions'` to `SKIP_DIR_NAMES` would match
 *     nothing at all — the walk tests the basename, not the path;
 *   * adding `'pro-extensions'` would match, but would also skip any unrelated
 *     directory that happens to share the name, at any depth, anywhere in the
 *     tree. A skip list that over-matches is a guard that quietly stops
 *     guarding.
 *
 * So a path-scoped exclusion needs its own set, and callers prune with
 * {@link isSkippedPath} against a **repo-relative POSIX** path.
 *
 * `packages/pro-extensions` holds independently versioned extension packages:
 * each is its own git repository, and the Pro ones are never checked out by Host
 * CI at all. A Host guard that scanned them would be reading code that no Host
 * build produces, no Host commit controls, and no Host reviewer can change —
 * findings there are neither actionable by a Host commit nor, when the checkout
 * is absent, even reproducible. The guards that own that code are the ones in
 * the extension's own repository, which always have their own checkout.
 *
 * This is a scoping statement, not a suppression: nothing in this repository is
 * exempt, and the exclusion prunes at the directory level so nothing under the
 * path is read in the first place.
 */
export const SKIP_PATH_PREFIXES = new Set(['packages/pro-extensions']);

/**
 * @param {string} rel repo-relative POSIX path (use `/` separators on any OS)
 * @returns {boolean} whether the path is inside an excluded subtree
 */
export function isSkippedPath(rel) {
  for (const prefix of SKIP_PATH_PREFIXES) {
    if (rel === prefix || rel.startsWith(`${prefix}/`)) return true;
  }
  return false;
}
