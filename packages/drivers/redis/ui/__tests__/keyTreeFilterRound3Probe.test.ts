/* Round-3 differential: Redis 7.2 C oracle (./oracle) vs the TS port.
 * Corpus is emitted as hex (so NUL/newline bytes survive execFile strings). */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { redisGlobMatch, compileGlob, globMatcher } from '../key-browser/keyTreeFilter';

/* ---- corpus ------------------------------------------------------------- */
const PATTERNS = [
  // core dialect
  '*', 'a*', '*c', 'a*c', 'a**c', 'app:*', 'user', '*user*', 'app.user*',
  'app.user:1', 'app:user:1', 'root-plain', 'a?c', '?', '??', '???', 'a+b',
  'a(b)', 'x|y', 'a$b^', 'a{2}', 'a\\\\b',
  // classes
  'h[ae]llo', '*[0-9]', 'user[0-9]', 'h[a-b]llo', 'h[b-a]llo', 'h[^e]llo',
  'user[^9]', 'h[!e]llo', 'a[\\]]b', '[abc', '[^abc', 'a[]b', '[]', '[^]',
  '[]]', '[a-]', '[-a]', '[a-b-c]', '[0-9a-f]', '[^a-b]', '[\\^]', '[\\-]',
  'x[', 'x[a', 'x[]', '[', ']', 'a[[]b', '[[]', '[]a]',
  // escapes
  'a\\b', '\\*lit', '\\?', '\\\\', '\\[abc\\]', '\\a\\b\\c', 'a\\\\b',
  '\\*', '*\\*', '\\', 'a\\', '\\*\\?\\[',
  // newline / control bytes
  'a?c', '*x', 'a*b', 'a\nb', '*\n*', 'a[b\n]c', '[\n]', 'a[\n-b]c',
  // multibyte
  '?', '??', '???', 'é', '?é', 'é?', '用', '?用', '用?', '用??',
  '*é*', '*用*', '[é用]', '?[é]', 'é[?]',
  // long / adversarial
  'a*a*a*a*a*b', '*a*a*a*a*a*a*a*a*a*a*b', '********************a',
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'a?'.repeat(30) + 'b', '*'.repeat(20),
  'a[bc]d[ef]g', '[a-z][a-z][a-z]', '*[a-z]*[0-9]*',
];

const KEYS = [
  '', 'a', 'b', 'c', 'x', 'ac', 'abc', 'abbbc', 'ab', 'aXc', 'ab\nc', 'a\nc',
  '\n', 'a\nb', 'x\n', '\na', 'aa', 'aaa', 'aaaa', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaab', 'hello', 'hallo', 'hillo', 'hbllo', 'hcllo',
  'hello\n', 'user', 'User', 'USER', 'username', 'user1', 'user2', 'user5',
  'user9', 'userx', 'cache:9', 'app:user:1', 'app:admin:1', 'other:1', 'appuser:1',
  'app.user:1', 'appXuser:1', 'root-plain', 'root-plainx', 'a+b', 'a(b)', 'x|y',
  'a$b^', 'a{2}', '*lit', '?', '[abc', 'abc]', 'a]b', 'a[b', 'ab', 'a\\b',
  'é', '用', 'éé', '??', 'aé', 'éa', 'x用y', '用用用', 'a\nb\nc', 'a*b',
  'a\nx', 'a\nb', 'a\nc', 'ab',
  'aaaab', 'aab', 'ab', 'b', '*', '**', 'c', 'z', '0', '9', '5', 'f', 'g',
  'x[b', 'x[b]', '[]', ']', '[', 'a-b', '-', '^', '\\', 'a\\', '\\a',
];

/* ---- TS side (the thing under test) -------------------------------------- */
function tsMatch(pattern, key) {
  return redisGlobMatch(key, pattern);
}

/* extra TS-side API probes, independent of redisGlobMatch */
const API_PROBES = [];
function apiProbe(name, fn) {
  try {
    API_PROBES.push([name, fn()]);
  } catch (e) {
    API_PROBES.push([name, `THREW:${e && e.message}`]);
  }
}

/* ---- run ----------------------------------------------------------------- */
const cases = [];
for (const p of PATTERNS) for (const k of KEYS) cases.push([p, k]);

const hex = (s) => Buffer.from(s, 'utf8').toString('hex');
const input = cases.map(([p, k]) => `${hex(p)} ${hex(k)}`).join('\n') + '\n';
writeFileSync('/tmp/r3/corpus.txt', input);

const out = execFileSync('/tmp/r3/oracle', { input, maxBuffer: 1 << 28 })
  .toString()
  .split('\n');
const cVerdicts = cases.map((_, i) => out[i] === '1');

let mismatches = [];
cases.forEach(([p, k], i) => {
  const c = cVerdicts[i];
  const ts = tsMatch(p, k);
  if (c !== ts) mismatches.push({ pattern: p, key: k, redis: c, ts });
});

/* ---- the 16 round-2 divergence faces, explicitly ------------------------- */
const SIXTEEN = [
  ['class:set      h[ae]llo/hello', 'h[ae]llo', 'hello', true],
  ['class:range    *[0-9]/user1', '*[0-9]', 'user1', true],
  ['class:range    user[0-9]/user5', 'user[0-9]', 'user5', true],
  ['class:negate   h[^e]llo/hallo', 'h[^e]llo', 'hallo', true],
  ['class:range    h[a-b]llo/hbllo', 'h[a-b]llo', 'hbllo', true],
  ['escape         a\\b/ab', 'a\\b', 'ab', true],
  ['escape         \\*lit/*lit', '\\*lit', '*lit', true],
  ['escape-inverse a\\b/a\\b', 'a\\b', 'a\\b', false],
  ['newline        a?c/a\\nc', 'a?c', 'a\nc', true],
  ['newline        *x/a\\nx', '*x', 'a\nx', true],
  ['newline        a*b/a\\nb', 'a*b', 'a\nb', true],
  ['multibyte      ?/é', '?', 'é', false],
  ['multibyte      ?/用', '?', '用', false],
  ['multibyte      ??/é', '??', 'é', true],
  ['multibyte      ???/用', '???', '用', true],
  ['multibyte      ??/用 (needs 3 bytes)', '??', '用', false],
];
const faceRows = SIXTEEN.map(([label, p, k, expectedRedis]) => {
  const ts = tsMatch(p, k);
  const idx = cases.findIndex(([cp, ck]) => cp === p && ck === k);
  const c = idx >= 0 ? cVerdicts[idx] : null;
  return { label, pattern: p, key: k, redis: c, expectedRedis, ts, ok: c === ts && ts === expectedRedis };
});

/* extra multibyte faces the brief calls out by name */
const EXTRA = [
  ['? / é', '?', 'é'], ['??? / 用', '???', '用'], ['a?c / a\\nc', 'a?c', 'a\nc'],
  ['h[ae]llo / hello', 'h[ae]llo', 'hello'], ['h[^e]llo / hallo', 'h[^e]llo', 'hallo'],
  ['\\*lit / *lit', '\\*lit', '*lit'],
];

/* ---- API probes ---------------------------------------------------------- */
apiProbe('compileGlob("")', () => JSON.stringify(compileGlob('')));
apiProbe('compileGlob("   ")', () => JSON.stringify(compileGlob('   ')));
apiProbe('compileGlob("*") len', () => compileGlob('*').len);
apiProbe('compileGlob("  *  ") len (trimmed?)', () => compileGlob('  *  ').len);
apiProbe('globMatcher(null)("anything")', () => globMatcher(null)('anything'));
apiProbe('redisGlobMatch("", "")', () => redisGlobMatch('', ''));
apiProbe('compileGlob("é").len (utf8 bytes)', () => compileGlob('é').len);
apiProbe('compileGlob("用").len', () => compileGlob('用').len);

/* ---- report -------------------------------------------------------------- */
console.log(`cases=${cases.length} mismatches=${mismatches.length}`);
if (mismatches.length) {
  console.log('--- MISMATCHES (first 40) ---');
  for (const m of mismatches.slice(0, 40)) {
    console.log(`  pattern=${JSON.stringify(m.pattern)} key=${JSON.stringify(m.key)} redis=${m.redis ? 1 : 0} ts=${m.ts ? 1 : 0}`);
  }
}
console.log('--- 16 FACES ---');
for (const r of faceRows) {
  console.log(`  ${r.ok ? 'OK  ' : 'FAIL'} ${r.label.padEnd(34)} redis=${r.redis === null ? '?' : r.redis ? 1 : 0} expected=${r.expectedRedis ? 1 : 0} ts=${r.ts ? 1 : 0}`);
}
console.log(`faces_ok=${faceRows.filter((r) => r.ok).length}/${faceRows.length}`);
console.log('--- NAMED EXTRA ---');
for (const [label, p, k] of EXTRA) {
  console.log(`  ${label.padEnd(20)} redis=${tsMatch(p, k) ? 1 : 0} ts=${tsMatch(p, k) ? 1 : 0}`);
}
console.log('--- API PROBES ---');
for (const [n, v] of API_PROBES) console.log(`  ${n} => ${v}`);

/* ---- assertions: the probe must go RED if the port drifts from the C ----- */
describe('round-3 differential vs the Redis 7.2 C oracle', () => {
  it('agrees with stringmatchlen on every corpus case', () => {
    expect(mismatches.length, JSON.stringify(mismatches.slice(0, 10))).toBe(0);
  });

  it('matches the 15 round-2 divergence faces', () => {
    const bad = faceRows.filter((r) => !r.ok).map((r) => r.label);
    expect(bad).toEqual([]);
  });

  it('uses byte semantics for `?` over multi-byte names', () => {
    expect(redisGlobMatch('é', '?')).toBe(false);
    expect(redisGlobMatch('用', '?')).toBe(false);
    expect(redisGlobMatch('é', '??')).toBe(true);
    expect(redisGlobMatch('用', '???')).toBe(true);
  });

  it('spans newline bytes with `.`-free wildcards', () => {
    expect(redisGlobMatch('a\nc', 'a?c')).toBe(true);
    expect(redisGlobMatch('a\nb', 'a*b')).toBe(true);
  });

  it('honours classes, negation and escapes', () => {
    expect(redisGlobMatch('hello', 'h[ae]llo')).toBe(true);
    expect(redisGlobMatch('hallo', 'h[^e]llo')).toBe(true);
    expect(redisGlobMatch('*lit', '\\*lit')).toBe(true);
  });
});
