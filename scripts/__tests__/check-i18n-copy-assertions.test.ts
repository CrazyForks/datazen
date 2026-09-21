/** @vitest-environment node */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
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
