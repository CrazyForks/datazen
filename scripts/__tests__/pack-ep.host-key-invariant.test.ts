/** @vitest-environment node */
/**
 * [tester] BUG-002 产物级宿主键不变量 —— 边界与 fail-closed 路径补齐。
 *
 * Coder 的 20 例已覆盖主路径（收集 / 拒绝 / 签名前拦截 / 两份基准）。本文件
 * 补的是覆盖率报告里**新代码中仍未被执行**的三条分支，外加一组「能否被绕过」
 * 的形态矩阵：
 *
 *   1. `readHostGlobalTableKeys` 的**条目不可解析**抛错（原套件只钉了「文件读不到」）
 *   2. `unquoteHostKey` 的**异体转义兜底** `catch { return raw }`
 *   3. `assertHostGlobalKeysInTree` 的**产物文件缺失**抛错
 *   4. 扫描器对六种「改写者可能写出的形态」的处理：能验证的验证、不能验证的一律 fail closed
 *
 * 第 4 组是这套闸门的核心承诺——「无论 Pro 侧用什么正则、怎么改写，产物里出现
 * 宿主表没有的键，或出现无法验证的取法，都不会被签出签名」。每一条都是**变异
 * 式**断言：把相应分支改成「读不懂就放行」时，用例必须转红。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import {
  assertHostGlobalKeysAllowed,
  assertHostGlobalKeysInTree,
  collectHostGlobalKeys,
  countUnverifiableHostRefs,
  readHostGlobalTableKeys,
} from '../pack-ep.mjs';

const UNMAPPED = '@codemirror/search';
const GLOBAL = '__DATAZEN_HOST__';

/** A host entry module whose `__DATAZEN_HOST__` table body is `body`. */
function hostEntryWith(body: string): string {
  return [
    "import * as ui from '@datazen/ui';",
    '',
    '(globalThis as any).__DATAZEN_HOST__ = {',
    body,
    '};',
    '',
    "startLocaleSync();",
  ].join('\n');
}

function writeHostEntry(name: string, body: string): { dir: string; path: string } {
  const dir = mkdtempSync(join(tmpdir(), `pack-ep-host-${name}-`));
  const path = join(dir, 'main.tsx');
  writeFileSync(path, hostEntryWith(body), 'utf-8');
  return { dir, path };
}

describe('[tester] host-table parser: fail closed on anything it cannot read', () => {
  /**
   * A parser that skips what it cannot read is not a guard: an unreadable entry
   * means the key set is silently smaller than the real table, and the invariant
   * would then admit keys the host never publishes. Must throw, not shrug.
   */
  it('test_tester_readHostGlobalTableKeys_throws_on_unparsable_table_entry', () => {
    const spread = writeHostEntry('spread', "  'react': reactAll,\n  ...otherModules,");
    try {
      expect(() => readHostGlobalTableKeys(spread.path)).toThrow(
        /unparsable __DATAZEN_HOST__ table entry "\.\.\.otherModules,"/,
      );
    } finally {
      rmSync(spread.dir, { recursive: true, force: true });
    }
  });

  it('test_tester_readHostGlobalTableKeys_throws_on_a_conditional_entry', () => {
    // A per-platform entry (`...(isMac ? a : b)`) is exactly the shape that would
    // silently shrink the derived key set on the wrong OS.
    const cond = writeHostEntry('cond', "  'react': reactAll,\n  ...(isMac ? macOnly : winOnly),");
    try {
      expect(() => readHostGlobalTableKeys(cond.path)).toThrow(/unparsable __DATAZEN_HOST__ table entry/);
    } finally {
      rmSync(cond.dir, { recursive: true, force: true });
    }
  });

  it('test_tester_readHostGlobalTableKeys_throws_when_the_table_literal_is_absent', () => {
    // A host entry that lost its `__DATAZEN_HOST__` table (renamed global, moved
    // to another module) must be fatal, not an empty baseline that permits all.
    const dir = mkdtempSync(join(tmpdir(), 'pack-ep-host-noliteral-'));
    try {
      const path = join(dir, 'main.tsx');
      writeFileSync(path, 'export const x = 1;\n', 'utf-8');
      expect(() => readHostGlobalTableKeys(path)).toThrow(
        /__DATAZEN_HOST__ table literal not found/,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('[tester] key unquoting: never guess an escape it cannot decode', () => {
  /**
   * `unquoteHostKey` decodes with `JSON.parse` and returns the **raw** text when
   * that throws. The raw text then fails the allow-list lookup, so the key is
   * reported as unmapped — the gate stays loud instead of guessing a key that
   * might exist. Both shapes below end in a refusal; they differ only in which
   * refusal, and both refusals are exercised.
   */
  it('test_tester_unquoteHostKey_reports_the_raw_form_rather_than_guessing', () => {
    // `\'` is legal in a JS single-quoted string but not a JSON escape, so the
    // decode fails and the scanner must report the *raw* text, not a guess.
    const code = `const { a } = ${GLOBAL}['x\\'b'];`;
    expect(collectHostGlobalKeys(code)).toEqual(["x\\'b"]);
    expect(() => assertHostGlobalKeysAllowed(code)).toThrow(/unmapped host table key "x\\'b"/);
  });

  it('test_tester_a_dangling_backslash_is_refused_as_unverifiable', () => {
    // `['trail\']` cannot be closed by the scanner, so it is neither a readable
    // key nor a matched reference — it counts as a non-literal access.
    const code = `const { a } = ${GLOBAL}['trail\\'];`;
    expect(collectHostGlobalKeys(code)).toEqual([]);
    expect(countUnverifiableHostRefs(code)).toBe(1);
    expect(() => assertHostGlobalKeysAllowed(code)).toThrow(
      /1 non-literal __DATAZEN_HOST__ access\(es\) \(computed key or whole-table read\) cannot be verified/,
    );
  });

  it('test_tester_json_escapes_are_decoded_the_same_way_js_would', () => {
    // `\u0040` is `@` in both JSON.parse and JS source semantics, so the scanner
    // agrees with what the bundle will actually read at runtime.
    expect(collectHostGlobalKeys(`const { a } = ${GLOBAL}["\\u0040codemirror/search"];`)).toEqual([
      UNMAPPED,
    ]);
  });
});

describe('[tester] artifact gate: fail closed on every unverifiable access shape', () => {
  /**
   * The two rewriters in play (pack-ep's own `hostGlobalRef` and the Pro
   * `renderChunk`) can only emit literal bracket access or dot access. Anything
   * else in the shipped bytes — a computed key, a template literal, a whole-table
   * read — cannot be checked against the host table, and the gate's contract is
   * to refuse to sign rather than assume it is fine.
   */
  it.each([
    ['computed global access (double quotes)', `const { a } = globalThis["${GLOBAL}"]["${UNMAPPED}"];`],
    ['computed global access (single quotes)', `const { a } = globalThis['${GLOBAL}']['${UNMAPPED}'];`],
    ['template-literal key', `const { a } = ${GLOBAL}[\`${UNMAPPED}\`];`],
    ['computed index from a variable', `const k = "${UNMAPPED}"; const { a } = ${GLOBAL}[k];`],
    ['whole-table destructuring', `const { react, search } = globalThis.${GLOBAL};`],
    ['whole-table spread', `const h = { ...globalThis.${GLOBAL} };`],
  ])('test_tester_fails_closed_on_%s', (_label, code) => {
    expect(countUnverifiableHostRefs(code)).toBe(1);
    expect(() => assertHostGlobalKeysAllowed(code)).toThrow(
      /1 non-literal __DATAZEN_HOST__ access\(es\) \(computed key or whole-table read\) cannot be verified/,
    );
  });

  it.each([
    ['bracket form with surrounding whitespace', `const { a } = ${GLOBAL} [ "${UNMAPPED}" ] ;`],
    ['dot form with surrounding whitespace', `const a = ${GLOBAL} . my_key ;`],
  ])('test_tester_fails_closed_on_%s_because_the_key_is_out_of_table', (_label, code) => {
    // Whitespace must not turn a rejected key into an accepted one.
    const expected = _label.startsWith('dot') ? 'my_key' : UNMAPPED;
    expect(collectHostGlobalKeys(code)).toEqual([expected]);
    expect(() => assertHostGlobalKeysAllowed(code)).toThrow(
      new RegExp(`unmapped host table key "${expected}"`),
    );
  });

  it('test_tester_a_non_identifier_after_the_dot_is_unverifiable_not_a_key', () => {
    // `__DATAZEN_HOST__.@codemirror/view` is not valid JS member syntax for a
    // scoped name, so no rewriter can emit it; if one ever did, the access is
    // refused rather than read as a key.
    const code = `const a = ${GLOBAL} . @codemirror/search ;`;
    expect(collectHostGlobalKeys(code)).toEqual([]);
    expect(countUnverifiableHostRefs(code)).toBe(1);
    expect(() => assertHostGlobalKeysAllowed(code)).toThrow(/cannot be verified against the host table/);
  });

  it('test_tester_dot_form_reads_the_first_identifier_only', () => {
    // `__DATAZEN_HOST__.react.default` is the shape the published Pro bundle
    // actually uses; only the leading segment names a host key.
    expect(collectHostGlobalKeys(`const a = ${GLOBAL}.react.default;`)).toEqual(['react']);
  });

  it('test_tester_underscore_dot_key_is_matched_exactly_not_prefixed', () => {
    expect(collectHostGlobalKeys(`const a = ${GLOBAL}.my_key;`)).toEqual(['my_key']);
    expect(() => assertHostGlobalKeysAllowed(`const a = ${GLOBAL}.my_key;`)).toThrow(
      /unmapped host table key "my_key"/,
    );
  });

  it('test_tester_nested_property_of_a_published_key_is_not_a_host_key', () => {
    // Over-eagerness would be a real defect: a legitimate
    // `__DATAZEN_HOST__["react"].useState` must not be reported as a missing key.
    const code = `const { useState } = ${GLOBAL}["react"];`;
    expect(collectHostGlobalKeys(code)).toEqual(['react']);
    expect(() => assertHostGlobalKeysAllowed(code)).not.toThrow();
  });

  it('test_tester_a_renamed_host_global_is_not_attributed_to_the_real_one', () => {
    // `__DATAZEN_HOST_X__` must not be scanned as `__DATAZEN_HOST__`.
    const code = `const a = __DATAZEN_HOST_X__["${UNMAPPED}"];`;
    expect(collectHostGlobalKeys(code)).toEqual([]);
    expect(countUnverifiableHostRefs(code)).toBe(0);
  });
});

describe('[tester] assertHostGlobalKeysInTree: missing bundle is fatal', () => {
  it('test_tester_assertHostGlobalKeysInTree_throws_when_the_bundle_is_absent', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pack-ep-nobundle-'));
    try {
      mkdirSync(join(dir, 'dist'), { recursive: true });
      writeFileSync(join(dir, 'manifest.json'), '{"version":"1.0.0"}\n', 'utf-8');
      expect(() => assertHostGlobalKeysInTree(dir)).toThrow(
        /cannot verify host keys: .*dist\/index\.esm\.js does not exist/,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('test_tester_assertHostGlobalKeysInTree_reads_the_bytes_on_disk', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pack-ep-bytes-'));
    try {
      mkdirSync(join(dir, 'dist'), { recursive: true });
      writeFileSync(
        join(dir, 'dist/index.esm.js'),
        `const { a } = ${GLOBAL}["${UNMAPPED}"];\n`,
        'utf-8',
      );
      expect(() => assertHostGlobalKeysInTree(dir)).toThrow(
        new RegExp(`unmapped host table key "${UNMAPPED}"`),
      );
      writeFileSync(join(dir, 'dist/index.esm.js'), `const { a } = ${GLOBAL}["react"];\n`, 'utf-8');
      expect(assertHostGlobalKeysInTree(dir)).toEqual(['react']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
