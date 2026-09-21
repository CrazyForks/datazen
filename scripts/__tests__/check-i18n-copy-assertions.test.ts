/** @vitest-environment node */
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { checkI18nCopyAssertions } from '../check-i18n-copy-assertions.mjs';

/**
 * Guard for 原则六「断言与 i18n 文案解耦」
 * (docs/development/interaction-and-testing-principles.md).
 *
 * The guard is advisory: it must WARN without blocking, and it must stay quiet
 * on assertions over *data* (Redis replies, SQL, INFO section names), which is
 * exactly what makes the dictionary-value cross-check load-bearing.
 */
describe('checkI18nCopyAssertions', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'check-i18n-copy-'));
    mkdirSync(join(root, 'packages/drivers/redis/locales'), { recursive: true });
    mkdirSync(join(root, 'packages/drivers/redis/ui/__tests__'), { recursive: true });
    writeFileSync(
      join(root, 'packages/drivers/redis/locales/en.ts'),
      "export const redisEn = {\n  'redis.noExpiry': 'No expiry',\n  'redis.setTtl': 'Set TTL',\n  'redis.ttl': 'TTL',\n};\n",
    );
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const writeTest = (source: string) =>
    writeFileSync(join(root, 'packages/drivers/redis/ui/__tests__/sample.test.tsx'), source);

  const run = (strict = false) => {
    const warnings: string[] = [];
    const result = checkI18nCopyAssertions({
      root,
      dirs: ['packages/drivers'],
      strict,
      log: () => {},
      warn: (msg) => warnings.push(String(msg)),
    });
    return { ...result, warnings };
  };

  it('scans the driver test files it is pointed at', () => {
    writeTest("it('ok', () => {});\n");
    expect(run().scanned).toBe(1);
  });

  it('stays silent when assertions pin data-* anchors and i18n keys', () => {
    writeTest(
      "it('ok', () => {\n" +
        "  expect(screen.getByTestId('redis-ttl-value').getAttribute('data-ttl-state')).toBe('no-expiry');\n" +
        "  expect(t('redis.noExpiry')).toBe('redis.noExpiry');\n" +
        '});\n',
    );
    const { code, hits } = run(true);
    expect(hits).toEqual([]);
    expect(code).toBe(0);
  });

  it('warns but does not fail on a copy literal, and fails only under --strict', () => {
    writeTest("it('ok', () => {\n  expect(screen.getByText('No expiry')).toBeInTheDocument();\n});\n");
    const advisory = run();
    expect(advisory.code).toBe(0);
    expect(advisory.warnings.join('\n')).toContain('warning only, not blocking');

    const strict = run(true);
    expect(strict.code).toBe(1);
    expect(strict.hits).toHaveLength(1);
    expect(strict.hits[0]).toMatchObject({
      file: 'packages/drivers/redis/ui/__tests__/sample.test.tsx',
      line: 2,
      literal: 'No expiry',
    });
    expect(strict.warnings.join('\n')).toContain('interaction-and-testing-principles.md');
  });

  it('covers the placeholder/label queries and toHaveTextContent too', () => {
    writeTest(
      "it('ok', () => {\n" +
        "  screen.getByPlaceholderText('Set TTL');\n" +
        "  screen.getByLabelText('Set TTL');\n" +
        "  expect(el).toHaveTextContent('No expiry');\n" +
        '});\n',
    );
    expect(run().hits.map((h) => h.line)).toEqual([2, 3, 4]);
  });

  it('flags a translation lookup compared with a dictionary value', () => {
    writeTest(
      "it('ok', () => {\n  expect(getTranslations('en')['redis.noExpiry']).toBe('No expiry');\n});\n",
    );
    expect(run().hits).toHaveLength(1);
  });

  it('leaves data assertions alone: Redis replies, SQL and INFO sections are not copy', () => {
    writeTest(
      "it('ok', () => {\n" +
        "  expect(screen.getByText('(nil)')).toBeInTheDocument();\n" +
        "  expect(screen.getByText('OK')).toBeInTheDocument();\n" +
        "  screen.getByText('ERR unknown command');\n" +
        "  screen.getByText('SELECT name FROM users');\n" +
        '});\n',
    );
    expect(run(true).hits).toEqual([]);
  });

  it('ignores copy-shaped strings that only live in comments', () => {
    writeTest(
      "it('ok', () => {\n" +
        "  // the old assertion read getByText('No expiry') before 原则六\n" +
        "  expect(screen.getByTestId('redis-ttl-value')).toBeTruthy();\n" +
        '});\n',
    );
    expect(run(true).hits).toEqual([]);
  });

  it('does not treat an untranslated i18n key as copy', () => {
    // What actually excludes a key such as `redis.noExpiry` is COPY_SHAPE_RE:
    // it demands an uppercase first letter *and* (see the gate in the guard) a
    // space, while i18n keys are lowercase dotted identifiers. Locating by key
    // is 原则六 第 2 类锚点, i.e. the fix. An earlier revision also carried a
    // separate `KEY_SHAPE_RE` short-circuit; it could never be reached, so it
    // was deleted rather than "covered" (redis-assert-policy BUG-004). This
    // case is the regression guard for that behaviour: if the copy-shape gate
    // is ever loosened, a key-shaped locator must still not read as copy.
    writeTest("it('ok', () => {\n  expect(screen.getByText('redis.noExpiry')).toBeTruthy();\n});\n");
    expect(run(true).hits).toEqual([]);
  });

  it('considers both the driver packs and the host dictionary', () => {
    mkdirSync(join(root, 'src/locales'), { recursive: true });
    writeFileSync(
      join(root, 'src/locales/en.ts'),
      "export default { 'redis.batchDelete': 'Delete selected keys' };\n",
    );
    writeTest(
      "it('ok', () => {\n  expect(screen.getByText('Delete selected keys')).toBeTruthy();\n});\n",
    );
    expect(run().hits).toHaveLength(1);
  });

  it('also reads the host domain packs under locales/en/', () => {
    // The host dictionary is split into `src/locales/en/<domain>.ts` and merged
    // by `en.ts`, so a guard that only reads `en.ts` is blind to every host term.
    mkdirSync(join(root, 'src/locales/en'), { recursive: true });
    writeFileSync(
      join(root, 'src/locales/en/core.ts'),
      "export default { 'common.importConnections': 'Import Connections' };\n",
    );
    writeTest(
      "it('ok', () => {\n  screen.getByRole('menuitem', { name: 'Import Connections' });\n});\n",
    );
    const { hits } = run();
    expect(hits).toHaveLength(1);
    expect(hits[0].literal).toBe('Import Connections');
  });
});

/**
 * [tester] Branch coverage for the guard's own surface: the walker's missing-root
 * and skip-list paths, the shipped defaults (including the real repository), and
 * the wider text-query alternation.
 *
 * Deliberately NOT asserted: the hit count of the real repository. The guard is
 * advisory by ruling (PRD §8.2 — no dev-time release gate on i18n), so a test
 * that demanded `hits.length === 0` would re-introduce exactly the blocking gate
 * this track refused to build.
 */
describe('[tester] checkI18nCopyAssertions walker and default-option branches', () => {
  let root: string;
  const REL_TEST_DIR = 'packages/drivers/redis/ui/__tests__';

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'check-i18n-branches-'));
    mkdirSync(join(root, 'packages/drivers/redis/locales/en'), { recursive: true });
    mkdirSync(join(root, REL_TEST_DIR), { recursive: true });
    // `'redis.empty': ''` exercises the "ignore empty dictionary values" path.
    writeFileSync(
      join(root, 'packages/drivers/redis/locales/en.ts'),
      "export const redisEn = {\n  'redis.setTtl': 'Set TTL',\n  'redis.empty': '',\n};\n",
    );
    // Host-style domain pack under locales/en/<domain>.ts (nested vocabulary path).
    writeFileSync(
      join(root, 'packages/drivers/redis/locales/en/nested.ts'),
      "export default { 'redis.hostOnly': 'Host Only Copy' };\n",
    );
    writeFileSync(
      join(root, REL_TEST_DIR, 'sample.test.tsx'),
      "it('ok', () => {});\n",
    );
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const writeTest = (source: string) =>
    writeFileSync(join(root, REL_TEST_DIR, 'sample.test.tsx'), source);

  const probe = (dirs: string[], strict = false) => {
    const logs: string[] = [];
    const warnings: string[] = [];
    const result = checkI18nCopyAssertions({
      root,
      dirs,
      strict,
      log: (msg) => logs.push(String(msg)),
      warn: (msg) => warnings.push(String(msg)),
    });
    return { ...result, logs, warnings };
  };

  it('survives a scan root that does not exist (git driver not cloned here)', () => {
    const present = probe(['packages/drivers']);
    const withMissing = probe(['packages/drivers', 'packages/drivers/mysql']);
    // A worktree without an optional driver must not throw and must not change
    // the scan result for the drivers that are present.
    expect(withMissing.scanned).toBe(present.scanned);
    expect(withMissing.hits).toEqual(present.hits);
    expect(withMissing.code).toBe(0);
  });

  it('skips build/vendor directories and non-source files while walking', () => {
    writeTest("it('ok', () => {\n  screen.getByText('Set TTL');\n});\n");
    for (const skipped of ['node_modules', 'dist', 'coverage', '.git', 'icons']) {
      mkdirSync(join(root, 'packages/drivers/redis/ui', skipped, '__tests__'), { recursive: true });
      writeFileSync(
        join(root, 'packages/drivers/redis/ui', skipped, '__tests__', 'vendored.test.tsx'),
        "it('vendored', () => {\n  screen.getByText('Set TTL');\n});\n",
      );
    }
    writeFileSync(
      join(root, REL_TEST_DIR, 'sample.test.tsx.bak'),
      "it('backup', () => {\n  screen.getByText('Set TTL');\n});\n",
    );
    const { scanned, hits } = probe(['packages/drivers']);
    expect(scanned).toBe(1);
    expect(hits).toHaveLength(1);
    expect(hits[0].file).toBe(`${REL_TEST_DIR}/sample.test.tsx`);
  });

  it('covers the getAllBy / queryAllBy / findBy and Title/Placeholder spellings', () => {
    writeTest(
      "it('ok', () => {\n" +
        "  screen.getAllByTitle('Set TTL');\n" +
        "  screen.queryAllByText('Set TTL');\n" +
        "  screen.findAllByPlaceholderText('Set TTL');\n" +
        '});\n',
    );
    const { hits } = probe(['packages/drivers'], true);
    expect(hits.map((h) => h.line)).toEqual([2, 3, 4]);
    expect(hits.every((h) => h.literal === 'Set TTL')).toBe(true);
  });

  it('ignores JSDoc continuation and block-comment lines, and reads nested host packs', () => {
    writeTest(
      "/**\n" +
        " * Legacy locator: screen.getByText('Set TTL') lived here.\n" +
        " */\n" +
        "/* screen.getByText('Set TTL') */\n" +
        "it('ok', () => {\n" +
        "  screen.getByText('Host Only Copy');\n" +
        '});\n',
    );
    const { hits } = probe(['packages/drivers'], true);
    // Only the executable line 6 matches: lines 2 and 4 are comments.
    expect(hits).toHaveLength(1);
    expect(hits[0].line).toBe(6);
    expect(hits[0].literal).toBe('Host Only Copy');
  });

  it('falls back to the shipped roots and console output when called with no options', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { code, scanned, hits, watchedTerms, unresolvedTerms } = checkI18nCopyAssertions();
      // Real repository, default (advisory) mode: never a non-zero exit.
      expect(code).toBe(0);
      expect(scanned).toBeGreaterThan(10);
      expect(Array.isArray(hits)).toBe(true);
      // No options means no watchlist: the default face must stay exactly the
      // two-word dictionary heuristic, with nothing resolved or unresolved.
      expect(watchedTerms).toEqual([]);
      expect(unresolvedTerms).toEqual([]);
      // Exactly the guard's own report channel fired (one ok line, or a warning
      // block when the tree has hits — the repository's hit count is deliberately
      // not asserted, see the note above).
      const emitted = [...logSpy.mock.calls, ...warnSpy.mock.calls].map((c) => String(c[0]));
      expect(emitted.length).toBeGreaterThan(0);
      expect(emitted.every((line) => line.includes('check-i18n-copy-assertions'))).toBe(true);
    } finally {
      logSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });
});

/**
 * [coder] redis-assert-policy-BUG-005: the two structural blind spots the
 * default heuristics cannot see — single-word copy (`Console`, `Wrap`, `Size`,
 * `Discard`: 3 of the 4 copy strings 裁定 8-4 is about to change) and the
 * WebdriverIO interaction specs under `e2e/specs/` — are closed by the two
 * opt-in flags `--terms` (i18n-key watchlist, values read back from the
 * dictionaries) and `--dirs` (widened scan face).
 */
describe('[coder] checkI18nCopyAssertions watchlist and scan-face options', () => {
  let root: string;
  const DRIVER_TESTS = 'packages/drivers/redis/ui/__tests__';

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'check-i18n-terms-'));
    mkdirSync(join(root, 'packages/drivers/redis/locales'), { recursive: true });
    mkdirSync(join(root, DRIVER_TESTS), { recursive: true });
    mkdirSync(join(root, 'e2e/specs'), { recursive: true });
    writeFileSync(
      join(root, 'packages/drivers/redis/locales/en.ts'),
      "export const redisEn = {\n  'redis.console': 'Console',\n  'redis.alias': 'Console',\n  'redis.view.wrap': 'Wrap',\n  'redis.noExpiry': 'No expiry',\n};\n",
    );
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const writeAt = (rel: string, source: string) => writeFileSync(join(root, rel), source);

  const probe = (opts: { dirs?: string[]; terms?: string[]; strict?: boolean } = {}) => {
    const logs: string[] = [];
    const warnings: string[] = [];
    const result = checkI18nCopyAssertions({
      root,
      dirs: opts.dirs ?? ['packages/drivers'],
      terms: opts.terms,
      strict: opts.strict ?? false,
      log: (msg) => logs.push(String(msg)),
      warn: (msg) => warnings.push(String(msg)),
    });
    return { ...result, logs, warnings };
  };

  it('sees a pinned single-word term only when it is on the watchlist', () => {
    writeAt(
      `${DRIVER_TESTS}/sample.test.tsx`,
      "it('ok', () => {\n  screen.getByRole('tab', { name: 'Console' });\n});\n",
    );
    // Default heuristics (space gate) — the BUG-005 blindness, kept as evidence.
    expect(probe().hits).toEqual([]);
    const { hits, watchedTerms, logs } = probe({ terms: ['redis.console', 'redis.view.wrap'] });
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      file: `${DRIVER_TESTS}/sample.test.tsx`,
      line: 2,
      literal: 'Console',
      term: 'redis.console',
    });
    // The watchlist is expressed in keys and resolved at run time, and it says
    // so out loud, so a reviewer can see which value each term currently has.
    expect(watchedTerms).toEqual([
      { key: 'redis.console', value: 'Console' },
      { key: 'redis.view.wrap', value: 'Wrap' },
    ]);
    expect(logs.join('\n')).toContain('watchlist: redis.console="Console"');

    // Two keys may carry the same wording (the real repository has exactly that
    // with `common.close` / `common.retry`): both stay listed, the first one
    // resolved is the one named on the hit.
    const aliased = probe({ terms: ['redis.alias', 'redis.console'] });
    expect(aliased.watchedTerms).toEqual([
      { key: 'redis.alias', value: 'Console' },
      { key: 'redis.console', value: 'Console' },
    ]);
    expect(aliased.hits).toHaveLength(1);
    expect(aliased.hits[0].term).toBe('redis.alias');
  });

  it('follows the dictionary when the wording changes instead of pinning it', () => {
    // Rewording 8-4 must not require touching the watchlist or the invocation:
    // the guard looks for whatever the key says *now*. (`No expiry` on line 3 is
    // the two-word baseline behaviour, present in both runs, and carries no
    // term — only the watchlisted `Wrap` does.)
    writeAt(
      `${DRIVER_TESTS}/sample.test.tsx`,
      "it('ok', () => {\n  screen.getByText('Wrap');\n  screen.getByText('No expiry');\n});\n",
    );
    const before = probe({ terms: ['redis.view.wrap'] }).hits;
    expect(before.map((h) => h.literal)).toEqual(['Wrap', 'No expiry']);
    expect(before[0].term).toBe('redis.view.wrap');
    expect(before[1].term).toBeUndefined();

    writeFileSync(
      join(root, 'packages/drivers/redis/locales/en.ts'),
      "export const redisEn = {\n  'redis.console': 'Console',\n  'redis.view.wrap': 'Wrap lines',\n  'redis.noExpiry': 'No expiry',\n};\n",
    );
    // Same term key, same invocation: after the copy change the old literal is
    // no longer protected copy, and the multi-word pin still trips the heuristics.
    const after = probe({ terms: ['redis.view.wrap'] }).hits;
    expect(after.map((h) => h.literal)).toEqual(['No expiry']);
    expect(after[0].term).toBeUndefined();
  });

  it('fails loudly for a watchlist term that resolves to nothing', () => {
    writeAt(`${DRIVER_TESTS}/sample.test.tsx`, "it('ok', () => {});\n");
    const advisory = probe({ terms: ['redis.discard'] });
    expect(advisory.unresolvedTerms).toEqual(['redis.discard']);
    expect(advisory.hits).toEqual([]);
    // Advisory mode still exits 0 (PRD §8.2: no dev-time release gate)…
    expect(advisory.code).toBe(0);
    expect(advisory.warnings.join('\n')).toContain('protects nothing');
    // …while --strict treats "the protection is not there" as a failure.
    expect(probe({ terms: ['redis.discard'], strict: true }).code).toBe(1);
    // A real key alongside the typo still resolves: only the bad term is flagged.
    const mixed = probe({ terms: ['redis.console', 'redis.discard'] });
    expect(mixed.watchedTerms).toEqual([{ key: 'redis.console', value: 'Console' }]);
    expect(mixed.unresolvedTerms).toEqual(['redis.discard']);
  });

  it('scans WebdriverIO interaction specs once their root is on the face', () => {
    writeAt(`${DRIVER_TESTS}/sample.test.tsx`, "it('ok', () => {});\n");
    writeAt(
      'e2e/specs/redis-console.ts',
      'export async function journey(browser) {\n' +
        "  await $('button[aria-label=\"No expiry\"]').click();\n" +
        "  await $('button[aria-label=\"Console\"]').click();\n" +
        // Positive form: the selector reads the copy back from i18n, so only a
        // `${t(` fragment reaches the matcher and the guard stays quiet.
        '  await $(`button[aria-label="${t(\'redis.noExpiry\')}"]`).click();\n' +
        '}\n',
    );
    // `e2e/specs/*.ts` is neither `*.test.ts` nor under `__tests__/`: before the
    // specs pattern this root contributed 0 interaction files (BUG-005).
    const face = probe({ dirs: ['e2e', 'packages/drivers'] });
    expect(face.scanned).toBe(2);
    // A two-word pin trips the default heuristics on the widened face…
    expect(face.hits).toEqual([{ file: 'e2e/specs/redis-console.ts', line: 2, literal: 'No expiry' }]);
    // …and the watchlist additionally catches the single-word pin on line 3,
    // while the read-back form on line 4 stays out of the report.
    expect(probe({ dirs: ['e2e'], terms: ['redis.console'] }).hits).toEqual([
      { file: 'e2e/specs/redis-console.ts', line: 2, literal: 'No expiry' },
      {
        file: 'e2e/specs/redis-console.ts',
        line: 3,
        literal: 'Console',
        term: 'redis.console',
      },
    ]);
  });
});
