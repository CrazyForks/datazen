/**
 * A Tailwind colour utility that names a colour nobody defined compiles to
 * nothing: no error, no warning, just a silently unstyled element. The repo
 * shipped four of them (`bg-destructive`, `text-destructive`, and friends)
 * because `destructive` was never a colour here — the token is `danger`.
 *
 * This walks the source and fails on any colour utility whose colour resolves
 * to neither Tailwind's own default palette, nor a `theme.extend.colors` entry
 * in `tailwind.config.ts`, nor a `--color-*` custom property in CSS.
 */
import { describe, expect, it } from 'vitest';
import type { Dirent } from 'node:fs';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { readScannedIfPresent } from '../lib/scanTargets.mjs';

import tailwindConfig from '../../tailwind.config';

/** Utilities that take a colour argument. */
const COLOUR_UTILITIES = [
  'bg',
  'text',
  'border',
  'ring',
  'fill',
  'stroke',
  'from',
  'via',
  'to',
  'outline',
  'decoration',
  'accent',
  'caret',
  'divide',
  'placeholder',
  'shadow',
];

/**
 * Arguments that share a spelling with colour utilities but are not colours —
 * the border directions, the type scale, the shadow scale, the alignment
 * keywords. Reviewed against the tree; anything not listed here and not a
 * known colour is treated as a bug.
 */
const NON_COLOUR_ARGUMENTS = new Set([
  // border direction / style
  'b',
  't',
  'l',
  'r',
  'x',
  'y',
  's',
  'e',
  'w',
  'solid',
  'dashed',
  'dotted',
  'double',
  'hidden',
  'collapse',
  'separate',
  'none',
  // type scale (text-*)
  'xs',
  'sm',
  'md',
  'base',
  'lg',
  'xl',
  '2xl',
  '3xl',
  '4xl',
  '5xl',
  '6xl',
  '7xl',
  '8xl',
  '9xl',
  'thin',
  'extralight',
  'light',
  'normal',
  'medium',
  'semibold',
  'bold',
  'extrabold',
  'black',
  // text alignment / decoration (text-*)
  'left',
  'center',
  'right',
  'justify',
  'start',
  'end',
  'wrap',
  'nowrap',
  'ellipsis',
  'clip',
  'truncate',
  'uppercase',
  'lowercase',
  'capitalize',
  'pretty',
  'balance',
  'ticker',
  'overline',
  'strikethrough',
  'underline',
  'overline',
  'indent',
  'vertical',
  'horizontal',
  'resizable',
  'scroll',
  'autofill',
  'placeholder',
  'file',
  'marker',
  'first',
  'first-letter',
  'first-line',
  'last',
  'even',
  'odd',
  'before',
  'after',
  'selection',
  'accent',
  'backdrop',
  // shadow / ring / outline / divide
  'inner',
  'none',
  'outer',
  'inset',
  '2xs',
  // spacing-ish tokens picked up from cn()-built class strings
  '0',
  '0.5',
  '1',
  '1.5',
  '2',
  '2.5',
  '3',
  '3.5',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  '10',
  '11',
  '12',
  '14',
  '16',
  '20',
  '24',
  '28',
  '32',
  '40',
  '48',
  '64',
  // English words that appear after these prefixes in comments and identifiers
  // rather than in a class string ("text-ish field", "text-focused surfaces").
  'color',
  'colour',
  'selectable',
  'focused',
  'ish',
]);

const SCAN_ROOTS = ['src', 'packages', 'e2e'];
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.git', 'target', 'coverage']);

/** A source file plus its contents, captured in one pass. */
type ScannedFile = { path: string; content: string };

/**
 * Enumerate source files **and read them in the same pass**.
 *
 * A previous revision returned paths and read them later, from the test body.
 * That left a window between enumeration and use in which another process
 * could create and delete a file, and the guard then died with ENOENT on
 * roughly 1 run in 3 — a flaky gate that proves nothing on any given run.
 * Reading here removes the window rather than hiding it: a file that was
 * already gone is simply never enumerated, and one that vanishes mid-read
 * fails loudly here, where the cause is obvious, instead of as a mystery
 * inside a test assertion.
 *
 * The read is deliberately NOT wrapped in try/catch. Swallowing it would let
 * a genuine I/O failure hide behind a guard that reports itself green.
 */
function walk(dir: string, out: ScannedFile[] = []): ScannedFile[] {
  let entries: Dirent[];
  try {
    // `withFileTypes` takes each entry's type from the same readdir syscall, so
    // the former second `statSync` — a second create/delete window — is gone.
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    // A missing scan root is legitimate; anything else (permissions, I/O) is a
    // real fault and must surface rather than quietly shrink the scan.
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return out;
    throw e;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    // Some filesystems report DT_UNKNOWN, which leaves both predicates false;
    // fall back to a stat only in that case, so the common path stays windowless.
    const isDir = entry.isDirectory() || (!entry.isFile() && statSync(full).isDirectory());
    if (isDir) walk(full, out);
    else if (/\.(ts|tsx|js|jsx|css)$/.test(entry.name)) {
      const content = readScannedIfPresent(full);
      // Deleted between the directory read and this one: not in the tree, so it
      // has no class names for this guard to have an opinion about.
      if (content !== null) out.push({ path: full, content });
    }
  }
  return out;
}

/** Tailwind 4 ships its default palette as `--color-<family>-<shade>` vars. */
function defaultPaletteFamilies(): Set<string> {
  const css = readFileSync('node_modules/tailwindcss/theme.css', 'utf8');
  const families = new Set<string>();
  for (const m of css.matchAll(/--color-([a-z][a-z0-9-]*?)(?:-\d{2,3})?\s*:/g)) {
    families.add(m[1]);
  }
  return families;
}

/** The project's own semantic tokens, nested keys included (`dt.binary`, …). */
function projectColourKeys(): Set<string> {
  const keys = new Set<string>();
  const colors = tailwindConfig.theme?.extend?.colors as Record<string, unknown> | undefined;
  if (!colors) return keys;
  for (const [name, value] of Object.entries(colors)) {
    keys.add(name);
    if (value && typeof value === 'object') {
      for (const child of Object.keys(value as Record<string, unknown>)) {
        keys.add(`${name}-${child}`);
      }
    }
  }
  return keys;
}

const files = SCAN_ROOTS.flatMap((root) => walk(root));

/** Tokens declared straight in CSS (`--color-foo`) — a valid colour source. */
function cssColourKeys(): Set<string> {
  const keys = new Set<string>();
  for (const { path, content } of files) {
    if (!path.endsWith('.css')) continue;
    for (const m of content.matchAll(/--color-([a-z][a-z0-9-]*)\s*:/g)) {
      keys.add(m[1]);
    }
  }
  return keys;
}

const known = new Set<string>([
  ...defaultPaletteFamilies(),
  ...projectColourKeys(),
  ...cssColourKeys(),
  // Valid everywhere, and not spelled as `--color-*` in the palette file.
  'transparent',
  'current',
  'inherit',
  'black',
  'white',
]);

/**
 * Resolve the colour half of a utility by longest known prefix, so
 * `titlebar-fg-muted` matches the declared `titlebar` tree and `red-400`
 * matches `red`.
 */
function resolve(token: string): boolean {
  if (NON_COLOUR_ARGUMENTS.has(token)) return true;
  if (NON_COLOUR_ARGUMENTS.has(token.split('-')[0])) return true;
  for (const candidate of known) {
    if (token === candidate || token.startsWith(`${candidate}-`)) return true;
  }
  return false;
}

const BACKTICK = String.fromCharCode(96);
/**
 * The leading boundary is line-start, whitespace, `"` or a backtick. Two
 * character classes are therefore **invisible to this guard**, and both are
 * deliberate — the costs of admitting them were measured, not guessed:
 *
 * 1. `.` — a utility used as a CSS selector, e.g.
 *    `querySelectorAll('.text-foo')`. Admitting `.` pulls in every non-colour
 *    typography utility (`text-center`, `text-wrap`, `text-ellipsis`, …) and
 *    swamps the signal. This is how the dead `.text-destructive` in
 *    `e2e/specs/zz-screenshots.ts` survived: it was found by reading, not here.
 * 2. `'` — a single-quoted string, e.g. `'bg-ink-900'`. Enabling it was
 *    measured by flipping this regex boundary to include `'` and running this
 *    file. It yields exactly **15 findings**:
 *
 *      `via-saved` ×2, `via-proxy` ×1, `via-ws` ×1  MySQL connection-string
 *                                                     keys (`?via=proxy`), not
 *                                                     gradient utilities.
 *      `from-a` ×5                                 the English preposition.
 *      `from-db0` ×2                               a redis console transcript row.
 *      `stroke-dasharray` ×2                       a real SVG/CSS attribute
 *                                                     (`line.getAttribute(...)`).
 *      `bg-ink-900` ×2                             **one genuinely dead class**
 *                                                     (see below), counted twice
 *                                                     because both occurrences sit
 *                                                     on `ConnectionWorkspaceHomeKvSlot.test.tsx:15`.
 *
 *    So 14 are false positives and **1 is a real dead colour class** under this
 *    guard's own definition: `bg-ink-900` reaches a real `cn()` through
 *    `DbTypeBadge.tsx`, and `ink` is not a declared colour. It is confined to a
 *    test fixture and never ships, so it is left in place — but "0 real bugs"
 *    would be false, and 14-of-15 noise every run is not worth buying.
 *
 *    Reproduce: change the boundary below to `[\\s"'\` + BACKTICK + `]` and run
 *    this file.
 *
 * So this guard covers class names in JSX/TSX `className` strings and double
 * quotes, **not** CSS selectors or single-quoted strings. Those two forms are
 * a review responsibility — do not read a green run here as proof that the
 * repo is free of dead colour classes.
 */
const COLOUR_PATTERN = new RegExp(
  `(?:^|[\\s"${BACKTICK}])((?:[a-z-]+:)?(?:${COLOUR_UTILITIES.join('|')})-([a-z][a-z0-9-]*))`,
  'g',
);

function deadColourClasses(): string[] {
  const dead: string[] = [];
  for (const { path, content } of files) {
    if (path.endsWith('.css')) continue;
    content.split('\n').forEach((line, index) => {
      for (const m of line.matchAll(COLOUR_PATTERN)) {
        if (!resolve(m[2])) {
          dead.push(`${relative(process.cwd(), path)}:${index + 1} \`${m[1]}\``);
        }
      }
    });
  }
  return dead;
}

describe('Tailwind colour utilities reference a colour that exists', () => {
  it('has a default palette and the project tokens to compare against', () => {
    // If Tailwind ever stops shipping theme.css this guard would silently pass
    // everything, so assert the inputs are non-trivial.
    expect(defaultPaletteFamilies().size).toBeGreaterThan(10);
    expect(projectColourKeys()).toContain('danger');
    expect(projectColourKeys()).toContain('titlebar-fg-muted');
  });

  it('finds no dead colour class in the source', () => {
    expect(deadColourClasses()).toEqual([]);
  });
});
