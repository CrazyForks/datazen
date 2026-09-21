#!/usr/bin/env node
/**
 * i18n copy-assertion alarm (warn-only).
 *
 * Policy: docs/development/interaction-and-testing-principles.md — 原则六
 * "断言与 i18n 文案解耦". A test must never pin a *visible copy string* that a
 * component renders through `t()`: `locales/**\/en.ts` is the single source of
 * truth and product terminology is rewritten on demand, so an English literal
 * inside an assertion turns one copy change into N test-file changes.
 *
 * What it reports: in every scanned test file (default: `packages/drivers/**`),
 * a text query (`getByText('No expiry')`), an accessible name
 * (`getByRole('button', { name: 'Set TTL' })`), `toHaveTextContent('…')` or a
 * translation lookup compared with `.toBe('…')` whose literal is (a) English copy
 * shaped — starts uppercase, contains a space — and (b) actually present as a
 * value in some shipped English dictionary: a driver pack `locales/en.ts` or a
 * host domain pack `locales/en/<domain>.ts`. Condition (b) keeps most real *data*
 * assertions out of the report: Redis replies (`OK`, `(nil)`, `ERR wrong number
 * of arguments`), SQL text and `INFO` section names are not dictionary values.
 *
 * Known false-positive class, by construction of heuristic (b): a fixture that
 * happens to reuse a dictionary wording as *data* (e.g. a dashboard run seeded
 * with `error: 'Query failed'`, then asserted back) reads as copy. That is why
 * this guard is advisory and why hits are reviewed, never auto-fixed.
 *
 * Exit code is 0 by design (advisory, not a gate) — there is no dev-time release
 * gate on i18n (PRD §8.2). Pass `--strict` to fail on hits; useful as a
 * self-check before committing new tests.
 */
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Roots whose `locales/**\/en*.ts` files define the copy vocabulary. */
const DICTIONARY_GLOBS = ['packages/drivers', 'src/locales'];
/** Test sources scanned for pinned copy. */
const SCAN_DIRS = ['packages/drivers'];

const SKIP_DIR_NAMES = new Set(['node_modules', 'dist', 'coverage', '.git', 'icons']);
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx']);

/** A test file: lives under a `__tests__` dir or is named `*.test.ts(x)`. */
const TEST_FILE_RE = /(^|\/)__tests__\/|\.test\.tsx?$/;
/** English copy shape: `No expiry`, `Set TTL`, `Delete selected`. */
const COPY_SHAPE_RE = /^[A-Z][A-Za-z](?:[-A-Za-z0-9 .,:;!?%()[\]/#&=+']*[A-Za-z0-9.)\]])?$/;
/** i18n key shape (`redis.noExpiry`) — key-based assertions are the fix, not the bug. */
const KEY_SHAPE_RE = /^[a-z][A-Za-z0-9]*(?:\.[A-Za-z0-9]+)+$/;

const COPY_MATCHERS = [
  { re: /(?:get|query|find)(?:All)?By(?:Text|LabelText|Title|PlaceholderText)\(\s*(['"])([^'"]+)\1/ },
  {
    // `getByRole('button', { name: 'Set TTL' })` — an accessible name is rendered
    // copy, so a string literal here pins the wording just as hard as getByText.
    // The role argument is matched non-capturing so group 2 is the literal, like
    // every other matcher below.
    re: /(?:get|query|find)(?:All)?ByRole\(\s*['"][^'"]*['"]\s*,\s*\{\s*name:\s*(['"])([^'"]+)\1/,
  },
  { re: /toHaveTextContent\(\s*(['"])([^'"]+)\1/ },
  {
    // `expect(getTranslation('en', key)).toBe('…')` / `expect(en[key]).toBe('…')`:
    // reading a dictionary back into an assertion pins the same wording.
    re: /[\]\)]\s*\.toBe\(\s*(['"])([^'"]+)\1/,
    // Gated on the line talking about translations, so ordinary data assertions
    // such as `expect(parseHead()).toBe('Server')` stay out of the report.
    onlyWhen: /translat|i18n|locale|\ben\b|messages|dictionary|\bt\(/i,
  },
];


/**
 * English source-of-truth dictionaries: driver packs (`locales/en.ts`) and the
 * host domain packs (`locales/en/<domain>.ts`, merged by `locales/en.ts`). Both
 * ship the copy a test must not pin, so both feed the vocabulary.
 */
function isEnglishDictionary(rel) {
  return /(^|\/)locales\/en\.ts$/.test(rel) || /(^|\/)locales\/en\/[^/]+\.ts$/.test(rel);
}

/** Collect every value shipped in every dictionary so only real copy is flagged. */
function collectDictionaryValues(root) {
  const values = new Set();
  const files = [];
  for (const dir of DICTIONARY_GLOBS) {
    walk(resolve(root, dir), root, files, () => true);
  }
  const entryRe = /(['"])([A-Za-z0-9_.-]+)\1\s*:\s*(['"])((?:[^'"\\]|\\.)*)\3/g;
  for (const file of files) {
    const rel = relative(root, file).split('\\').join('/');
    if (!isEnglishDictionary(rel)) continue;
    const source = readFileSync(file, 'utf-8');
    let m;
    while ((m = entryRe.exec(source))) {
      const value = m[4];
      if (value.trim().length > 0) values.add(value);
    }
  }
  return values;
}

function walk(dir, root, out, accept) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (SKIP_DIR_NAMES.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, root, out, accept);
    else if (SOURCE_EXTENSIONS.has(name.slice(name.lastIndexOf('.'))) && accept(full)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * @param {{
 *   root?: string,
 *   dirs?: string[],
 *   strict?: boolean,
 *   log?: (...args: unknown[]) => void,
 *   warn?: (...args: unknown[]) => void,
 * }} [opts]
 * @returns {{ code: number, hits: Array<{file: string, line: number, literal: string}>, scanned: number }}
 */
export function checkI18nCopyAssertions(opts = {}) {
  const root = opts.root ?? ROOT;
  const dirs = opts.dirs ?? SCAN_DIRS;
  const strict = opts.strict ?? false;
  const log = opts.log ?? console.log.bind(console);
  const warn = opts.warn ?? console.warn.bind(console);

  const dictionaryValues = collectDictionaryValues(root);
  const files = [];
  for (const dir of dirs) {
    walk(resolve(root, dir), root, files, (f) => TEST_FILE_RE.test(relative(root, f)));
  }

  const hits = [];
  for (const file of files) {
    const rel = relative(root, file).split('\\').join('/');
    const lines = readFileSync(file, 'utf-8').split('\n');
    lines.forEach((text, i) => {
      const trimmed = text.trim();
      // Comments and the policy doc-block itself must not trip the alarm.
      if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return;
      for (const matcher of COPY_MATCHERS) {
        if (matcher.onlyWhen && !matcher.onlyWhen.test(text)) continue;
        const m = matcher.re.exec(text);
        if (!m) continue;
        const literal = m[2];
        if (!COPY_SHAPE_RE.test(literal) || !literal.includes(' ')) continue;
        if (KEY_SHAPE_RE.test(literal)) continue;
        if (!dictionaryValues.has(literal)) continue;
        hits.push({ file: rel, line: i + 1, literal });
      }
    });
  }

  if (hits.length > 0) {
    const header = `[check-i18n-copy-assertions] ${hits.length} copy-literal assertion(s) pinned to dictionary wording`;
    if (strict) {
      warn(`${header} (--strict: failing):`);
    } else {
      warn(`${header} (warning only, not blocking):`);
    }
    for (const hit of hits) warn(`  ${hit.file}:${hit.line}: "${hit.literal}"`);
    warn(
      '  -> assert data-* anchors / roles / i18n keys instead; see docs/development/interaction-and-testing-principles.md 原则六',
    );
  } else {
    log(`[check-i18n-copy-assertions] ok (${files.length} driver test files scanned, 0 copy literals pinned)`);
  }
  return { code: strict && hits.length > 0 ? 1 : 0, hits, scanned: files.length };
}

/* istanbul ignore next */
if (process.argv[1] && process.argv[1].endsWith('check-i18n-copy-assertions.mjs')) {
  process.exitCode = checkI18nCopyAssertions({ strict: process.argv.includes('--strict') }).code;
}
