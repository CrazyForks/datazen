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
