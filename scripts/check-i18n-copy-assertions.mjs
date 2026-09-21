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
 * a literal that ends up pinning rendered copy, whichever form the test uses:
 * a text query (`getByText('No expiry')`), an accessible name
 * (`getByRole('button', { name: 'Set TTL' })`), a `toHaveTextContent('…')`, a
 * pinned selector attribute (`$('button[aria-label="Close"]')`, the idiom of the
 * WebdriverIO interaction specs), a translation lookup compared with
 * `.toBe('…')`, an assertion *argument*
 * (`expect(spy).toHaveBeenCalledWith('Missing value for :uid', …)`), a substring
 * match (`body.includes('Structure')`, `expect(text).toContain('Submit Answers')`)
 * or a copy-taking helper call (`findAndClickButton(['History'])`,
 * `openDbContextMenu(db, 'Compare Data')`), whose name list is
 * `COPY_HELPER_NAMES`. In every form the literal must be (a) English copy
 * shaped — starts uppercase, contains a space — and (b) actually present as a
 * value in some shipped English dictionary: a driver pack `locales/en.ts` or a
 * host domain pack `locales/en/<domain>.ts`. Condition (b) keeps most real *data*
 * assertions out of the report: Redis replies (`OK`, `(nil)`, `ERR wrong number
 * of arguments`), SQL text and `INFO` section names are not dictionary values.
 *
 * Known false-positive class, by construction of heuristic (b): a fixture that
 * happens to reuse a dictionary wording as *data* (e.g. a dashboard run seeded
 * with `error: 'Query failed'`, then asserted back) reads as copy. The substring
 * and helper forms widen that class deliberately — asserting one's own fixture
 * sentence, or a test-authored stub dictionary value (原则六 第 4 类), also reads
 * as a hit. That is why this guard is advisory and why hits are reviewed, never
 * auto-fixed.
 *
 * Capability boundary (read this before trusting a green run):
 * - heuristic (b) needs a space, so **single-word copy** (`Console`, `Wrap`,
 *   `Size`, `Discard`) pinned into an assertion is invisible by default;
 * - comparison is **literal equality against a dictionary value**, so an
 *   interpolated/concatenated string only registers through the fragment it
 *   contains in the same line — `'Size: 42 B'` and a copy reassembled from
 *   pieces are not matched by heuristic (b) (watchlisted terms can still catch
 *   the substring forms);
 * - the scan is **line based**: `const label = 'Console'; getByRole(…, { name:
 *   label })` pins copy through a variable and stays invisible;
 * - the default scan face is `packages/drivers` only, i.e. host tests and the
 *   WebdriverIO interaction specs are not looked at unless `--dirs` says so;
 * - a green `--dirs e2e` does **not** mean the specs are clean: `e2e/specs/**`
 *   mostly pins copy through the substring/helper forms above, which need a
 *   dictionary-shaped literal to match, and its bilingual
 *   `x.includes('中文') || x.includes('English')` fallbacks are only visible for
 *   the English half.
 *
 * That is what the two opt-in flags are for:
 * - `--dirs src,packages,e2e` widens the scanned roots (interaction specs under
 *   `e2e/specs/*.ts` count as test sources, they are neither `*.test.ts` nor in
 *   a `__tests__/` directory);
 * - `--terms redis.noExpiry,redis.view.wrap` takes a watchlist of **i18n keys**,
 *   reads their *current* English values back from the dictionaries (so the
 *   watchlist itself never pins copy) and reports every assertion that pins one
 *   of those values — including single words, because the two-word heuristic is
 *   bypassed for watchlisted literals. A term that resolves to no dictionary
 *   entry is reported loudly and fails `--strict`: a typo'd term protects nothing.
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

/** A test file: lives under a `__tests__` dir, is named `*.test.ts(x)`, or is a
 * WebdriverIO interaction spec anywhere under `specs/` (nested helper/journey
 * directories included — the single-level form used to silently drop
 * `e2e/specs/journeys/**`; only reachable once `--dirs` includes that root). */
const TEST_FILE_RE = /(^|\/)__tests__\/|\.test\.tsx?$|(^|\/)specs\/.+\.tsx?$/;
/** English copy shape: `No expiry`, `Set TTL`, `Delete selected`. Uppercase
 * first letter, so an i18n key (`redis.noExpiry`) can never read as copy — that
 * is what keeps key-based assertions (原则六 第 2 类锚点) out of the report. */
const COPY_SHAPE_RE = /^[A-Z][A-Za-z](?:[-A-Za-z0-9 .,:;!?%()[\]/#&=+']*[A-Za-z0-9.)\]])?$/;

/**
 * Helpers in the WebdriverIO specs whose argument is *visible UI text* rather
 * than data: `findAndClickButton(['执行记录', 'History'])` clicks the button
 * rendered from `workflow.history`, `openDbContextMenu(db, 'Compare Data')`
 * picks a context-menu entry. This list is the configuration point — add a
 * helper name here when a new copy-taking wrapper appears, instead of growing
 * the regexes below.
 */
const COPY_HELPER_NAMES = ['findAndClickButton', 'openDbContextMenu'];
const COPY_HELPER_RE = new RegExp(`(?:${COPY_HELPER_NAMES.join('|')})\\s*\\(`);
/** Every string literal on a line (used for the helper form, which is variadic). */
const STRING_LITERAL_RE = /(['"])((?:[^'"\\\n]|\\.)*?)\1/g;

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
    // Interaction specs (`e2e/specs/**`, reachable through `--dirs e2e`) pin copy
    // through a selector attribute rather than a testing-library query:
    // `$('button[aria-label="Close"]')`. The read-back form
    // `` $(`button[aria-label="${t('common.close')}"]`) `` captures only the
    // `${t(` fragment, which fails the copy shape, so positive uses stay quiet.
    re: /aria-label=(['"])([^'"]+)\1/,
  },
  {
    // `expect(getTranslation('en', key)).toBe('…')` / `expect(en[key]).toBe('…')`:
    // reading a dictionary back into an assertion pins the same wording.
    re: /[\]\)]\s*\.toBe\(\s*(['"])([^'"]+)\1/,
    // Gated on the line talking about translations, so ordinary data assertions
    // such as `expect(parseHead()).toBe('Server')` stay out of the report.
    onlyWhen: /translat|i18n|locale|\ben\b|messages|dictionary|\bt\(/i,
  },
  {
    // Assertion-argument form (redis-assert-policy BUG-006): the component hands
    // rendered copy to a callback and the test pins the whole sentence —
    // `expect(showMessageDialog).toHaveBeenCalledWith('Missing value for :uid', …)`.
    // Selector-shaped matchers above never see it, which is exactly how that hit
    // survived a full-dictionary probe.
    re: /\.toHaveBeenCalledWith\(\s*(['"])([^'"]+)\1/,
  },
  {
    // Substring-match form, the dominant idiom of the interaction specs
    // (`body.includes('Structure')`, `expect(text).toContain('Submit Answers')`).
    // A composed/interpolated string still pins the copy fragment it embeds, so
    // this catches more than the exact-value matchers — the price is that a test
    // asserting its own fixture wording now reads as a hit, hence advisory-only.
    re: /\.(?:toContain|toContainEqual|includes|startsWith|endsWith)\(\s*(['"])([^'"]+)\1/,
  },
  {
    // Copy-taking helper calls (see COPY_HELPER_NAMES). Variadic, so the matcher
    // yields every literal on the line and each is judged on its own.
    re: COPY_HELPER_RE,
    literalsFromLine: (text) => [...text.matchAll(STRING_LITERAL_RE)].map((m) => m[2]),
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

/**
 * Collect every value shipped in every dictionary so only real copy is flagged,
 * plus a key → value view used to resolve the `--terms` watchlist. Keys are
 * namespaced per pack, so a collision across packs is itself a defect; the
 * first file walked wins deterministically and the guard never depends on which
 * wording is correct — it only needs *a* current value to look for.
 */
function collectDictionaryEntries(root) {
  const values = new Set();
  const byKey = new Map();
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
      const key = m[2];
      const value = m[4];
      if (value.trim().length === 0) continue;
      values.add(value);
      if (!byKey.has(key)) byKey.set(key, value);
    }
  }
  return { values, byKey };
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
 *   terms?: string[],
 *   strict?: boolean,
 *   log?: (...args: unknown[]) => void,
 *   warn?: (...args: unknown[]) => void,
 * }} [opts]
 * @returns {{
 *   code: number,
 *   hits: Array<{file: string, line: number, literal: string, term?: string}>,
 *   scanned: number,
 *   watchedTerms: Array<{key: string, value: string}>,
 *   unresolvedTerms: string[],
 * }}
 */
export function checkI18nCopyAssertions(opts = {}) {
  const root = opts.root ?? ROOT;
  const dirs = opts.dirs ?? SCAN_DIRS;
  const terms = opts.terms ?? [];
  const strict = opts.strict ?? false;
  const log = opts.log ?? console.log.bind(console);
  const warn = opts.warn ?? console.warn.bind(console);

  const { values: dictionaryValues, byKey } = collectDictionaryEntries(root);

  // literal → the watchlist key that asked for it. Resolved from the
  // dictionaries, so the watchlist is expressed in keys and never pins copy.
  const watched = new Map();
  const watchedTerms = [];
  const unresolvedTerms = [];
  for (const key of terms) {
    const value = byKey.get(key);
    if (value === undefined) {
      unresolvedTerms.push(key);
      continue;
    }
    watchedTerms.push({ key, value });
    if (!watched.has(value)) watched.set(value, key);
  }

  const files = [];
  for (const dir of dirs) {
    walk(resolve(root, dir), root, files, (f) => TEST_FILE_RE.test(relative(root, f)));
  }

  const hits = [];
  const seen = new Set();
  const pushHit = (rel, line, literal, term) => {
    const id = `${rel}:${line}:${literal}`;
    if (seen.has(id)) return;
    seen.add(id);
    hits.push(term === undefined ? { file: rel, line, literal } : { file: rel, line, literal, term });
  };
  for (const file of files) {
    const rel = relative(root, file).split('\\').join('/');
    const lines = readFileSync(file, 'utf-8').split('\n');
    lines.forEach((text, i) => {
      const trimmed = text.trim();
      // Comments and the policy doc-block itself must not trip the alarm.
      if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return;
      for (const matcher of COPY_MATCHERS) {
        if (matcher.onlyWhen && !matcher.onlyWhen.test(text)) continue;
        if (!matcher.re.test(text)) continue;
        // Variadic matchers (helper calls) judge every literal on the line;
        // the selector/assertion forms carry one capture group.
        const literals = matcher.literalsFromLine
          ? matcher.literalsFromLine(text)
          : [matcher.re.exec(text)[2]];
        for (const literal of literals) {
          const term = watched.get(literal);
          if (term === undefined) {
            // Advisory heuristics: English copy shape (which already excludes
            // i18n keys such as `redis.noExpiry`, since those start lowercase), at
            // least two words, and a value that really ships in a dictionary.
            // A watchlisted literal skips all three so single-word copy stays
            // visible — that is the whole point of `--terms`.
            if (!COPY_SHAPE_RE.test(literal) || !literal.includes(' ')) continue;
            if (!dictionaryValues.has(literal)) continue;
          }
          pushHit(rel, i + 1, literal, term);
        }
      }
    });
  }

  if (watchedTerms.length > 0) {
    log(
      `[check-i18n-copy-assertions] watchlist: ${watchedTerms
        .map((entry) => `${entry.key}="${entry.value}"`)
        .join(', ')}`,
    );
  }
  for (const key of unresolvedTerms) {
    warn(
      `[check-i18n-copy-assertions] watchlist term "${key}" matches no English dictionary entry — it protects nothing (typo, or the key was renamed)`,
    );
  }

  if (hits.length > 0) {
    const header = `[check-i18n-copy-assertions] ${hits.length} copy-literal assertion(s) pinned to dictionary wording`;
    if (strict) {
      warn(`${header} (--strict: failing):`);
    } else {
      warn(`${header} (warning only, not blocking):`);
    }
    for (const hit of hits) {
      warn(`  ${hit.file}:${hit.line}: "${hit.literal}"${hit.term ? ` (watchlist: ${hit.term})` : ''}`);
    }
    warn(
      '  -> assert data-* anchors / roles / i18n keys instead; see docs/development/interaction-and-testing-principles.md 原则六',
    );
  } else {
    // Neutral wording: `--dirs` routinely widens the face past the drivers, and
    // "driver test files scanned" then contradicted the run (BUG-008).
    log(`[check-i18n-copy-assertions] ok (${files.length} test files scanned, 0 copy literals pinned)`);
  }
  return {
    code: strict && hits.length + unresolvedTerms.length > 0 ? 1 : 0,
    hits,
    scanned: files.length,
    watchedTerms,
    unresolvedTerms,
  };
}

/* istanbul ignore next */
if (process.argv[1] && process.argv[1].endsWith('check-i18n-copy-assertions.mjs')) {
  const argv = process.argv.slice(2);
  /** `--dirs src,packages,e2e` or `--dirs=src,packages,e2e`. */
  const listFlag = (name) => {
    const inline = argv.find((arg) => arg.startsWith(`${name}=`));
    const raw = inline !== undefined ? inline.slice(name.length + 1) : argv[argv.indexOf(name) + 1];
    if (inline === undefined && argv.indexOf(name) === -1) return undefined;
    if (!raw || raw.startsWith('--')) return undefined;
    return raw.split(',').map((entry) => entry.trim()).filter(Boolean);
  };
  process.exitCode = checkI18nCopyAssertions({
    strict: argv.includes('--strict'),
    dirs: listFlag('--dirs'),
    terms: listFlag('--terms'),
  }).code;
}
