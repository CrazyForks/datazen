#!/usr/bin/env node
/**
 * i18n-key-collision-check.mjs — host ↔ driver translation-key ownership guard.
 *
 * WHY (measured, not assumed — see the numbers in the closing report):
 * the host and every driver feed the SAME translation registry
 * (`@datazen/ui` `registerTranslations`, which merges with `Object.assign`).
 * Nothing in that engine has namespaces: a key is a flat string, and on a
 * duplicate the LAST registration silently wins. `i18n-sync-check.mjs` only
 * compares one key set across languages within a scope — it never compares two
 * scopes against each other, so a cross-scope duplicate is invisible to it.
 *
 * That is exactly how the host's `mongo.*` set (src/locales/<loc>/connection.ts,
 * consumed by 19 `t()` call sites in src/windows/connection/DocumentConnectionView.tsx)
 * and the mongodb driver pack's `mongo.*` set (packages/drivers/mongodb/locales/*)
 * ended up defining the same 15 keys. The driver pack self-registers second
 * (host registers at src/locales/index.ts module load; the pack registers via
 * packages/drivers/<id>/ui/meta.ts → locales/index.ts, imported later through
 * src/extensions/generated.ts), so 15/15 host values were overwritten and 9/15
 * English strings the host actually renders were replaced by the driver's
 * wording ('Insert document' → 'Insert', '{count} document(s)' → '{count} docs').
 * The two sides serve different consumers — the host renders the document
 * connection view, the driver ships the meta record and a JSON-command builder
 * — so merging the wording is not a fix either. The only correct fix is
 * separate namespaces, which this script then keeps separate.
 *
 * THE RULE: a translation key must be defined by exactly one owner. Host
 * dictionaries (src/locales) and driver locale packs (packages/drivers/<id>/locales)
 * are separate owners; a key present in both is a collision and is reported
 * with the key itself, plus every file that defines it, so the finding names
 * what to rename.
 *
 * The OK line deliberately prints how many host keys and how many keys per
 * driver pack were actually read. "0 collisions" is only meaningful next to
 * non-zero input counts — a scanner that silently scanned nothing also reports
 * zero. If nothing could be scanned the run exits 2 rather than 0.
 *
 * Usage:
 *   node scripts/i18n-key-collision-check.mjs
 *   node scripts/i18n-key-collision-check.mjs --root=<dir>
 *
 * Exit codes: 0 no collision · 1 at least one collision · 2 nothing scanned.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { extractPackKeys, findDriverLocalePacks } from './i18n-sync-check.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Every host locale directory under `src/locales`. `en` + `zh-CN` are the two
 * runtime-registered locales (src/locales/builtinLocales.ts); the other eight
 * ship as source-only files but are equally part of the host key contract, so a
 * key present in any of them counts as host-owned.
 */
export const HOST_LOCALE_DIRS = [
  'en',
  'zh-CN',
  'zh-TW',
  'de',
  'es',
  'fr',
  'ja',
  'ko',
  'pt-BR',
  'ru',
];

/** Files at `src/locales/` root that are NOT dictionaries (generated, barrels). */
const HOST_SKIP_FILES = new Set([
  'builtinLocales.ts', // codegen: BUILTIN_LOCALES + labels, not a dictionary
  'builtin-locales.json',
  'domains.ts',
  'index.ts',
  'lazyPacks.ts',
  't.ts',
  'fullLocales.ts',
]);

const TAG = '[i18n-key-collision]';

/**
 * @param {string} dir absolute path of a host locale directory
 * @returns {string[]} absolute paths of its dictionary files, sorted
 */
export function hostDictionaryFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith('.ts') && !HOST_SKIP_FILES.has(name))
    .sort()
    .map((name) => join(dir, name));
}

/**
 * Read one host locale into `key → defining file`.
 *
 * @param {string} locale
 * @param {string} localesDir absolute path of `src/locales`
 * @returns {Map<string, string>} key → absolute file path that defines it
 */
export function readHostLocaleKeys(locale, localesDir) {
  const owners = new Map();
  for (const file of hostDictionaryFiles(join(localesDir, locale))) {
    for (const key of Object.keys(extractPackKeys(readFileSync(file, 'utf-8')))) {
      // First definition wins for reporting; i18n-sync-check.mjs is the gate on
      // "one definition per locale", this gate only cares about the owner side.
      if (!owners.has(key)) owners.set(key, file);
    }
  }
  return owners;
}

/**
 * Collect every host-owned key with the file that defines it.
 *
 * @param {string} localesDir absolute path of `src/locales`
 * @returns {{ keys: Map<string, string>, localeCount: number, fileCount: number }}
 */
export function collectHostKeys(localesDir) {
  const keys = new Map();
  let localeCount = 0;
  let fileCount = 0;
  for (const locale of HOST_LOCALE_DIRS) {
    const files = hostDictionaryFiles(join(localesDir, locale));
    if (files.length === 0) continue;
    localeCount += 1;
    fileCount += files.length;
    for (const [key, file] of readHostLocaleKeys(locale, localesDir)) {
      if (!keys.has(key)) keys.set(key, file);
    }
  }
  return { keys, localeCount, fileCount };
}

/**
 * Read one driver locale pack into `key → defining file`.
 *
 * Every language file of the pack is read, not just `en.ts`: a key that only
 * one language of a pack carries is still a definition that will land in the
 * shared registry and can still overwrite a host value.
 *
 * `en.ts` is the pack's source of truth, so it is the file named in a report
 * even when another language of the pack also defines the key.
 *
 * @param {{ driver: string, dir: string }} pack as produced by findDriverLocalePacks
 * @returns {{ keys: Map<string, string>, fileCount: number }}
 */
export function readDriverPackKeys(pack) {
  const keys = new Map();
  const files = readdirSync(pack.dir)
    .filter((name) => name.endsWith('.ts') && name !== 'index.ts')
    .sort();
  for (const name of files) {
    const file = join(pack.dir, name);
    const isSource = name === 'en.ts';
    for (const key of Object.keys(extractPackKeys(readFileSync(file, 'utf-8')))) {
      if (isSource || !keys.has(key)) keys.set(key, file);
    }
  }
  return { keys, fileCount: files.length };
}

/**
 * Find every key defined by both the host and a driver pack.
 *
 * @param {{ localesDir: string, driversDir: string }} dirs
 * @returns {{ collisions: Array<{ key: string, driver: string, hostFile: string, driverFile: string }>,
 *             hostKeyCount: number, hostLocaleCount: number, hostFileCount: number,
 *             packs: Array<{ driver: string, keyCount: number, fileCount: number }> }}
 */
export function findKeyCollisions({ localesDir, driversDir }) {
  const host = collectHostKeys(localesDir);
  const collisions = [];
  const packs = [];

  for (const pack of findDriverLocalePacks(driversDir)) {
    const driver = readDriverPackKeys(pack);
    packs.push({
      driver: pack.driver,
      keyCount: driver.keys.size,
      fileCount: driver.fileCount,
    });
    for (const [key, driverFile] of driver.keys) {
      const hostFile = host.keys.get(key);
      if (hostFile !== undefined) {
        collisions.push({ key, driver: pack.driver, hostFile, driverFile });
      }
    }
  }

  collisions.sort(
    (a, b) => a.key.localeCompare(b.key) || a.driver.localeCompare(b.driver),
  );
  return {
    collisions,
    hostKeyCount: host.keys.size,
    hostLocaleCount: host.localeCount,
    hostFileCount: host.fileCount,
    packs,
  };
}

/**
 * @typedef {{ root?: string, log?: Function, error?: Function }} GuardOptions
 */

/**
 * @param {GuardOptions} [opts]
 * @returns {number} exit code (see header)
 */
export function checkI18nKeyCollisions(opts = {}) {
  const root = opts.root ?? ROOT;
  const log = opts.log ?? console.log.bind(console);
  const error = opts.error ?? console.error.bind(console);

  const result = findKeyCollisions({
    localesDir: join(root, 'src/locales'),
    driversDir: join(root, 'packages/drivers'),
  });

  // Positive control: refuse to report success if either side came back empty.
  // Without this, a renamed directory or a broken checkout would look exactly
  // like a clean repo.
  if (result.hostKeyCount === 0 || result.packs.length === 0) {
    error(
      `${TAG} FAILED: nothing to compare — read ${result.hostKeyCount} host key(s) from ` +
        `${result.hostLocaleCount} host locale(s) and found ${result.packs.length} driver locale pack(s) ` +
        `(root=${root}). Refusing to report "0 collisions" from an empty scan.`,
    );
    return 2;
  }

  for (const hit of result.collisions) {
    error(
      `${TAG} '${hit.key}' is defined by BOTH the host and the ${hit.driver} driver ` +
        `(host: ${hit.hostFile}, driver: ${hit.driverFile}).`,
    );
    error(
      `    The shared registry merges with Object.assign, so the ${hit.driver} pack — which registers ` +
        `after the host — silently wins and the host never renders its own string.`,
    );
    error(
      `    Rename one side into its own namespace (host connection-view strings live under ` +
        `'docView.*'; driver packs own theirs).`,
    );
  }

  const packSummary = result.packs
    .map((p) => `${p.driver}=${p.keyCount}`)
    .join(' ');
  if (result.collisions.length > 0) {
    error(
      `${TAG} FAILED: ${result.collisions.length} key(s) defined by both the host and a driver pack.`,
    );
    return 1;
  }

  log(
    `${TAG} ok — ${result.hostKeyCount} host key(s) from ${result.hostLocaleCount} locale(s) ` +
      `(${result.hostFileCount} files) vs ${result.packs.length} driver pack(s) [${packSummary}]: ` +
      `0 key(s) owned by both.`,
  );
  return 0;
}

/**
 * @param {{ argv?: string[] } & GuardOptions} [opts]
 * @returns {number} exit code
 */
export function runCli(opts = {}) {
  const { argv = process.argv, ...rest } = opts;
  const rootArg = argv.find((arg) => arg.startsWith('--root='));
  if (rootArg) rest.root = resolve(rootArg.slice('--root='.length));
  return checkI18nKeyCollisions(rest);
}

/* istanbul ignore next */
if (process.argv[1] && process.argv[1].endsWith('i18n-key-collision-check.mjs')) {
  process.exitCode = runCli();
}
