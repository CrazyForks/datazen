#!/usr/bin/env node
/**
 * i18n-sync-check.mjs
 *
 * Compares English locale (en.ts) against all other locale files.
 * Reports missing keys and stale translations (unchanged since last tag).
 *
 * Two scopes, same contract (`en.ts` is the single source of truth):
 *   1. Host dictionaries — src/locales domain packs
 *   2. Driver-owned locale packs — packages/drivers/<id>/locales
 *      (driver packs self-register into the shared @datazen/ui registry, so
 *      nothing else validates their completeness)
 *
 * Usage:
 *   node scripts/i18n-sync-check.mjs              # check all locales
 *   node scripts/i18n-sync-check.mjs --from v1.0   # diff from tag v1.0
 *   node scripts/i18n-sync-check.mjs --verbose      # show changed en values
 */

import { execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const localesDir = resolve(root, 'src/locales');
const driversDir = resolve(root, 'packages/drivers');

const LOCALE_FILES = ['de', 'es', 'fr', 'ja', 'ko', 'pt-BR', 'ru', 'zh-TW'];

function extractKeys(filePath) {
  const src = readFileSync(filePath, 'utf-8');
  const keys = {};
  const re = /^\s*'([^']+)':\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")/gm;
  let m;
  while ((m = re.exec(src)) !== null) {
    keys[m[1]] = m[2] ?? m[3] ?? '';
  }
  return keys;
}

function extractLocaleKeys(locale) {
  const localeDir = resolve(localesDir, locale);
  const files = existsSync(localeDir)
    ? readdirSync(localeDir)
        .filter((name) => name.endsWith('.ts'))
        .sort()
        .map((name) => resolve(localeDir, name))
    : [resolve(localesDir, `${locale}.ts`)];
  const keys = {};
  for (const file of files) Object.assign(keys, extractKeys(file));
  return keys;
}

/**
 * Key extractor for driver-owned locale packs.
 *
 * Same shape as `extractKeys`, but additionally recognises the line-wrapped
 * form used by driver dictionaries (`'key':` ending a line, value on the next
 * one) — without it those keys would be invisible to the completeness check.
 */
function extractPackKeys(filePath) {
  const src = readFileSync(filePath, 'utf-8');
  const keys = {};
  const re =
    /^\s*'([^']+)':\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|`(?:[^`\\]|\\.)*`|$)/gm;
  let m;
  while ((m = re.exec(src)) !== null) {
    keys[m[1]] = m[2] ?? m[3] ?? '';
  }
  return keys;
}

/** Every `packages/drivers/<id>/locales/` directory shipping an en.ts source. */
function findDriverLocalePacks() {
  if (!existsSync(driversDir)) return [];
  const packs = [];
  for (const entry of readdirSync(driversDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === 'node_modules') continue;
    const dir = join(driversDir, entry.name, 'locales');
    if (existsSync(join(dir, 'en.ts'))) packs.push({ driver: entry.name, dir });
  }
  return packs.sort((a, b) => a.driver.localeCompare(b.driver));
}

function getEnKeysAtRef(ref) {
  try {
    const content = execSync(`git show ${ref}:src/locales/en.ts`, {
      cwd: root,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const keys = {};
    const re = /^\s*'([^']+)':\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")/gm;
    let m;
    while ((m = re.exec(content)) !== null) {
      keys[m[1]] = m[2] ?? m[3] ?? '';
    }
    return keys;
  } catch {
    return null;
  }
}

function getLatestTag() {
  try {
    return execSync('git describe --tags --abbrev=0', {
      cwd: root,
      encoding: 'utf-8',
    }).trim();
  } catch {
    return null;
  }
}

const args = process.argv.slice(2);
const verbose = args.includes('--verbose');
const fromIdx = args.indexOf('--from');
const fromRef = fromIdx >= 0 ? args[fromIdx + 1] : getLatestTag();

const enKeys = extractLocaleKeys('en');
const enKeySet = new Set(Object.keys(enKeys));

let changedEnKeys = new Set();
if (fromRef) {
  const oldEnKeys = getEnKeysAtRef(fromRef);
  if (oldEnKeys) {
    for (const key of enKeySet) {
      if (!(key in oldEnKeys) || oldEnKeys[key] !== enKeys[key]) {
        changedEnKeys.add(key);
      }
    }
    console.log(`\nComparing en.ts against ${fromRef}: ${changedEnKeys.size} key(s) changed/added\n`);
    if (verbose && changedEnKeys.size > 0) {
      for (const key of changedEnKeys) {
        const old = oldEnKeys[key];
        console.log(`  ${old ? '~' : '+'} ${key}`);
        if (old) console.log(`    was: ${old}`);
        console.log(`    now: ${enKeys[key]}`);
      }
      console.log();
    }
  } else {
    console.log(`\nCould not read en.ts at ref '${fromRef}', skipping diff.\n`);
  }
}

let totalMissing = 0;
let totalStale = 0;

for (const locale of LOCALE_FILES) {
  let localeKeys;
  try {
    localeKeys = extractLocaleKeys(locale);
  } catch {
    console.log(`[${locale}] locale files not found`);
    continue;
  }

  const localeKeySet = new Set(Object.keys(localeKeys));
  const missing = [...enKeySet].filter((k) => !localeKeySet.has(k));
  const extra = [...localeKeySet].filter((k) => !enKeySet.has(k));
  const stale = changedEnKeys.size > 0
    ? [...changedEnKeys].filter((k) => localeKeySet.has(k) && localeKeys[k] === enKeys[k])
    : [];

  if (missing.length === 0 && extra.length === 0 && stale.length === 0) {
    continue;
  }

  console.log(`[${locale}]`);
  if (missing.length > 0) {
    console.log(`  Missing ${missing.length} key(s): ${missing.slice(0, 10).join(', ')}${missing.length > 10 ? '…' : ''}`);
    totalMissing += missing.length;
  }
  if (extra.length > 0) {
    console.log(`  Extra ${extra.length} key(s): ${extra.slice(0, 5).join(', ')}${extra.length > 5 ? '…' : ''}`);
  }
  if (stale.length > 0) {
    console.log(`  Stale ${stale.length} key(s) (value equals en, may need translation): ${stale.slice(0, 10).join(', ')}${stale.length > 10 ? '…' : ''}`);
    totalStale += stale.length;
  }
}

// ── Driver-owned locale packs (packages/drivers/<id>/locales/) ───────────────
// Drivers self-register their dictionaries through locales/index.ts, so the
// host performs no aggregation and nothing else validates completeness.
let totalStructural = 0;
let driverPackCount = 0;

for (const { driver, dir } of findDriverLocalePacks()) {
  driverPackCount += 1;
  const siblings = readdirSync(dir)
    .filter((name) => name.endsWith('.ts') && name !== 'en.ts' && name !== 'index.ts')
    .sort();

  // Structural convention: an index.ts side-effect module must import every
  // language file in the pack, otherwise the translations never reach the
  // shared registry at runtime.
  const indexPath = join(dir, 'index.ts');
  if (!existsSync(indexPath)) {
    console.log(`[driver.${driver}] locales/index.ts is missing — a driver pack must self-register via registerTranslations().`);
    totalStructural += 1;
  } else {
    const indexSrc = readFileSync(indexPath, 'utf-8');
    const notRegistered = siblings.filter(
      (name) => !new RegExp(`from\\s+'\\./${name.replace(/\.ts$/, '')}'`).test(indexSrc),
    );
    if (notRegistered.length > 0) {
      console.log(`[driver.${driver}] locales/index.ts does not import ${notRegistered.length} locale file(s): ${notRegistered.join(', ')}`);
      totalStructural += notRegistered.length;
    }
  }

  const packEnKeys = extractPackKeys(join(dir, 'en.ts'));
  const packEnKeySet = new Set(Object.keys(packEnKeys));

  for (const file of siblings) {
    const locale = file.replace(/\.ts$/, '');
    const keys = extractPackKeys(join(dir, file));
    const keySet = new Set(Object.keys(keys));
    const missing = [...packEnKeySet].filter((k) => !keySet.has(k));
    const extra = [...keySet].filter((k) => !packEnKeySet.has(k));

    if (missing.length === 0 && extra.length === 0) continue;

    console.log(`[driver.${driver}/${locale}]`);
    if (missing.length > 0) {
      console.log(`  Missing ${missing.length} key(s): ${missing.slice(0, 10).join(', ')}${missing.length > 10 ? '…' : ''}`);
      totalMissing += missing.length;
    }
    if (extra.length > 0) {
      console.log(`  Extra ${extra.length} key(s): ${extra.slice(0, 5).join(', ')}${extra.length > 5 ? '…' : ''}`);
    }
  }
}

if (totalMissing === 0 && totalStale === 0 && totalStructural === 0) {
  console.log('All locale files are in sync with en.ts.');
} else {
  console.log(
    `\nSummary: ${totalMissing} missing key(s), ${totalStale} stale translation(s) across ${LOCALE_FILES.length} host locales; ` +
      `${totalStructural} driver pack issue(s) across ${driverPackCount} driver locale pack(s).`,
  );
  process.exitCode = 1;
}
