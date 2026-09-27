#!/usr/bin/env node
/**
 * Static guard for the invariant asserted in mutation-check-pane-focus.mjs:
 * no statement in its `finally` block may throw.
 *
 * Why the invariant needs a machine check. The block's promise is that a failure
 * there degrades the report instead of escaping the module — an escaping throw
 * prints a bare stack and makes node force exit 1 regardless of process.exitCode,
 * which is EXIT.UNCOVERED, and it does so *before* the exit-code fold at the
 * bottom, discarding every exitReason pushed so far. That promise is invisible to
 * review: a bare `unlinkSync(backup);` looks exactly as innocent as a guarded one.
 * It was in fact bare, unchanged since before that harness was extended, and the
 * first proof of the restore path found a *different* bare call in the same block.
 *
 * What it checks, and why each part is there:
 *   1. the `finally` block exists — otherwise the property is vacuously "true",
 *      and a deleted block would pass;
 *   2. every node:fs call in it sits at try-depth > 0;
 *   3. it contains no `throw` statement. This is what makes (2) sufficient rather
 *      than merely necessary: a guarded call inside a try whose catch re-throws is
 *      protected by nothing, and depth counting alone would call that safe.
 *
 * Usage:
 *   node scripts/check-restore-block-guards.mjs           check the harness
 *   node scripts/check-restore-block-guards.mjs <file>    check some other file
 *   node scripts/check-restore-block-guards.mjs --selftest prove the check itself
 *
 * Exit 0 = invariant holds. Exit 1 = it does not, and every offending line is
 * printed. Exit 2 = the file could not be read or does not have the expected
 * shape. The selftest exits 0 only if the check FAILS on the fixtures it is
 * supposed to fail on AND passes on the real file; a check that cannot report a
 * failure is worse than no check, so that is the point of `--selftest`.
 *
 * Scope — read this before assuming it is a gate. Nothing in CI runs this: no
 * workflow and no npm script names it (grep the .github/ and package.json for
 * `check-restore-block-guards` and you get nothing). It is in the `files` list of
 * tsconfig.pack-ep.json, so `pnpm typecheck` checks its *types* — that is what
 * the list is for, and it says nothing about the harness being re-checked on
 * every commit. Run it by hand after touching the finally block.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const MIN_BLOCK_LINES = 5;
const HARNESS = 'scripts/mutation-check-pane-focus.mjs';
/** @type {readonly string[]} */
const FS_CALLS = ['unlinkSync', 'writeFileSync', 'readFileSync', 'chmodSync', 'renameSync', 'rmSync'];

/**
 * Blank out comments and string literals, so a call named inside prose or a
 * message is not mistaken for code. Returns the source padded with spaces and
 * newlines intact, so line numbers survive.
 * @param {string} src
 * @returns {string}
 */
function strip(src) {
  const out = src.split('');
  let i = 0;
  const n = src.length;
  while (i < n) {
    const two = src.slice(i, i + 2);
    if (two === '//') {
      while (i < n && src[i] !== '\n') out[i++] = ' ';
    } else if (two === '/*') {
      while (i < n && src.slice(i, i + 2) !== '*/') out[i++] = src[i] === '\n' ? '\n' : ' ';
      out[i] = ' ';
      i++;
      out[i] = ' ';
      i++;
    } else if (src[i] === "'" || src[i] === '"' || src[i] === '`') {
      const quote = src[i];
      out[i++] = ' ';
      while (i < n && src[i] !== quote) {
        // A backtick template may span lines; keep the newlines so numbering holds.
        if (src[i] === '\\') {
          out[i++] = ' ';
          if (i < n) out[i++] = ' ';
          continue;
        }
        out[i++] = src[i] === '\n' ? '\n' : ' ';
      }
      if (i < n) out[i++] = ' ';
    } else {
      i++;
    }
  }
  return out.join('');
}

/**
 * @typedef {{ ok: boolean, blockFound: boolean, linesChecked: number, findings: string[] }} Verdict
 */

/**
 * The keyword that opened the block whose `{` is at index `i`, or '' if none.
 * Strings are already blank by the time this runs, so parens found here are real.
 * The paren-skip is load-bearing: in `catch (err) {` the keyword is not adjacent
 * to the brace, and without this the catch is read as an anonymous block, its
 * `hasCatch` never gets set, and every call inside a correctly-guarded try is
 * reported bare.
 * @param {string} text
 * @param {number} i
 * @returns {string}
 */
function keywordBefore(text, i) {
  let j = i - 1;
  while (j >= 0 && /\s/.test(text[j])) j--;
  if (text[j] === ')') {
    let depth = 0;
    while (j >= 0) {
      if (text[j] === ')') depth++;
      else if (text[j] === '(') {
        depth--;
        if (depth === 0) {
          j--;
          break;
        }
      }
      j--;
    }
    while (j >= 0 && /\s/.test(text[j])) j--;
  }
  const k = j;
  while (j >= 0 && /[A-Za-z0-9_$]/.test(text[j])) j--;
  return text.slice(j + 1, k + 1);
}

/**
 * Pass 1: map every `{` in the body to the keyword that opened it, and record
 * whether a `try` block is followed by a `catch`.
 *
 * This is a second pass rather than a running counter on purpose. A counter that
 * watches for `try` at the start of a line is wrong in two ways that both matter
 * here, and the selftest fixtures exist to keep them fixed:
 *   - `try { … } catch (e) { … }` on ONE line increments on `try` and never
 *     decrements, so every later call in the block looks guarded. Measured: that
 *     bug let a bare `unlinkSync` through.
 *   - `try { … } finally { … }` has no `catch` at all, so a throw from inside it
 *     propagates. Depth alone would call that protected.
 * Resolving try→catch needs to look ahead of the try's close brace, hence a pass.
 * @param {string} text
 * @param {number} from
 * @param {number} to
 * @returns {Map<number, { type: string, hasCatch: boolean }>}
 */
function blockTable(text, from, to) {
  /** @type {Map<number, { type: string, hasCatch: boolean }>} */
  const byStart = new Map();
  /** @type {{ type: string, hasCatch: boolean }[]} */
  const stack = [];
  /** @type {{ type: string, hasCatch: boolean } | null} */
  let lastClosedTry = null;
  for (let i = from; i < to; i++) {
    if (text[i] === '{') {
      const rec = { type: keywordBefore(text, i), hasCatch: false };
      byStart.set(i, rec);
      if (rec.type === 'catch' && lastClosedTry) lastClosedTry.hasCatch = true;
      stack.push(rec);
    } else if (text[i] === '}') {
      const done = stack.pop();
      if (done && done.type === 'try') lastClosedTry = done;
    }
  }
  return byStart;
}

/**
 * The check itself, over a source string, so `--selftest` can feed it fixtures.
 * @param {string} src
 * @returns {Verdict}
 */
function checkSource(src) {
  const text = strip(src);
  const lineOf = (/** @type {number} */ i) => text.slice(0, i).split('\n').length;

  // Locate the `finally` block by its keyword, not by the shape of a line, so a
  // reformatted `} finally {` does not silently stop being checked.
  const fin = /finally\s*\{/.exec(text);
  if (!fin) {
    return {
      ok: false,
      blockFound: false,
      linesChecked: 0,
      findings: ['no `finally` block found — the invariant is vacuous without one'],
    };
  }
  const open = fin.index + fin[0].length - 1;
  // Recompute the matching close for this specific block (the table below covers
  // only up to here, so a stray brace later in the file cannot skew it).
  let depth = 0;
  let close = text.length;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') {
      depth--;
      if (depth === 0) {
        close = i;
        break;
      }
    }
  }
  const table = blockTable(text, open, close);
  const bodyStart = open + 1;
  const linesChecked = text.slice(bodyStart, close).split('\n').length;

  /** @type {string[]} */
  const findings = [];
  /** @type {{ type: string, hasCatch: boolean }[]} */
  const stack = [];
  for (let i = bodyStart; i < close; i++) {
    const ch = text[i];
    if (ch === '{') {
      stack.push(table.get(i) ?? { type: '', hasCatch: false });
      continue;
    }
    if (ch === '}') {
      stack.pop();
      continue;
    }
    // `startsWith` plus a lookbehind character test IS the word-boundary check;
    // an extra "am I inside a word" guard here would skip every identifier body.
    for (const fn of FS_CALLS) {
      if (!text.startsWith(fn, i)) continue;
      // Skip when the previous character IS a word char — that means we are inside
      // a longer identifier, e.g. the tail of `myUnlinkSync(`.
      if (/[A-Za-z0-9_$]/.test(text[i - 1] ?? ' ')) continue;
      const after = text[i + fn.length];
      if (after !== '(') continue;
      // A declaration does not throw: `function unlinkSync(` is a definition.
      if (/\bfunction\s+$/.test(text.slice(Math.max(0, i - 20), i))) continue;
      if (!stack.some((b) => b.type === 'try' && b.hasCatch)) {
        findings.push(`line ${lineOf(i)}: bare ${fn}(…) — not inside a try/catch`);
      }
      i += fn.length;
    }
    if (text.startsWith('throw', i) && !/[A-Za-z0-9_$]/.test(text[i + 5] ?? ' ')) {
      findings.push(`line ${lineOf(i)}: throw in the block — a re-throw escapes the try it sits in`);
    }
  }
  if (linesChecked < MIN_BLOCK_LINES) {
    findings.push(
      `the block resolved to only ${linesChecked} line(s) — a truncated range would pass ` +
        `vacuously, so this is reported rather than trusted`,
    );
  }
  return { ok: findings.length === 0, blockFound: true, linesChecked, findings };
}

/**
 * Fixtures that the check MUST fail on, plus the real file that it must pass.
 * Without these a silently-broken check would report "invariant holds" forever.
 * @returns {{ name: string, src: string, expect: boolean }[]}
 */
function fixtures() {
  const head = 'const STORE = "x";\ntry {\n  run();\n';
  const tail = '\n} catch (err) {\n  record(err);\n} finally {\n';
  const end = '\n}\nprocess.exitCode = 0;\n';
  return [
    {
      name: 'all four calls guarded (must PASS)',
      src:
        head +
        tail +
        '  try { writeFileSync(STORE, a); } catch (e) { note(e); }\n' +
        '  try { chmodSync(STORE, 0o644); } catch (e) { note(e); }\n' +
        '  try { readFileSync(STORE); } catch (e) { note(e); }\n' +
        '  try { unlinkSync(STORE); } catch (e) { note(e); }\n' +
        end,
      expect: true,
    },
    {
      name: 'one bare unlinkSync — the bug this guard exists for (must FAIL)',
      src:
        head + tail +
        '  try { writeFileSync(STORE, a); } catch (e) { note(e); }\n' +
        '  // padding so this fixture fails for the bare call and nothing else\n' +
        '  // padding\n  unlinkSync(STORE);\n' + end,
      expect: false,
    },
    {
      name: 'every call bare (must FAIL)',
      src:
        head +
        tail +
        '  writeFileSync(STORE, a);\n  chmodSync(STORE, 0o644);\n  readFileSync(STORE);\n  unlinkSync(STORE);\n' +
        end,
      expect: false,
    },
    {
      name: 'single-line try/catch, then a bare call after it (must FAIL — the depth bug)',
      src:
        head +
        tail +
        '  try { writeFileSync(STORE, a); } catch (e) { note(e); }\n' +
        '  // padding so this fixture fails for the bare call and nothing else\n' +
        '  // padding\n  unlinkSync(STORE);\n' + end,
      expect: false,
    },
    {
      name: 'try/finally with NO catch (must FAIL — a throw from it propagates)',
      src:
        head +
        tail +
        '  try { unlinkSync(STORE); } finally { note(1); }\n' +
        '  // padding\n  // padding\n  // padding\n' + end,
      expect: false,
    },
    {
      name: 'guarded, but the catch re-throws (must FAIL — depth alone is not enough)',
      src:
        head + tail +
        '  // padding so this fixture fails for the re-throw and nothing else\n' +
        '  // padding\n  try { unlinkSync(STORE); } catch (e) { throw e; }\n' + end,
      expect: false,
    },
    {
      name: 'no finally block at all (must FAIL — vacuous truth is not a pass)',
      src: head + '  run();\n}\nprocess.exitCode = 0;\n',
      expect: false,
    },
  ];
}

/**
 * @param {string[]} args
 * @returns {number}
 */
function main(args) {
  if (args.includes('--selftest')) {
    let bad = 0;
    for (const f of fixtures()) {
      const v = checkSource(f.src);
      const pass = v.ok === f.expect;
      if (!pass) bad++;
      console.log(
        `  ${pass ? 'ok  ' : 'FAIL'}  expected ${f.expect ? 'PASS' : 'FAIL'}, got ${v.ok ? 'PASS' : 'FAIL'}  — ${f.name}`,
      );
      for (const line of v.findings) console.log(`          ${line}`);
    }
    const real = checkSource(readFileSync(resolve(HARNESS), 'utf8'));
    const realOk = real.ok;
    if (!realOk) bad++;
    console.log(`  ${realOk ? 'ok  ' : 'FAIL'}  expected PASS, got ${real.ok ? 'PASS' : 'FAIL'}  — the real ${HARNESS}`);
    for (const line of real.findings) console.log(`          ${line}`);
    console.log(bad === 0 ? '\nselftest: the check can report failure. good.' : `\nselftest: ${bad} case(s) wrong.`);
    return bad === 0 ? 0 : 1;
  }

  const target = args.find((a) => !a.startsWith('--')) ?? HARNESS;
  const verdict = checkSource(readFileSync(resolve(target), 'utf8'));
  if (verdict.ok) {
    console.log(`ok: every fs call in the finally block of ${target} is guarded, and nothing there throws.`);
    return 0;
  }
  console.error(`✖ the finally block of ${target} can throw:`);
  for (const line of verdict.findings) console.error(`  ${line}`);
  console.error('  A throw there becomes a bare stack and a forced exit 1, i.e. EXIT.UNCOVERED.');
  return verdict.blockFound ? 1 : 2;
}

process.exitCode = main(process.argv.slice(2));

// Referenced so an unused-import lint does not fire; also documents the intent.
void dirname;
void fileURLToPath;
