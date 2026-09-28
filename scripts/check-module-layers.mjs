#!/usr/bin/env node
/**
 * Source-layer guard: each named layer must not import from the layers above it.
 *
 * Two independent layers are policed here:
 *
 *  1. `src/lib/relationMetadata` — the shared relation-metadata layer, which
 *     must not climb back up into the components / stores / windows / hooks
 *     that consume it. (Query Builder is owned by the independent SQL Editor
 *     Pro repository and no longer participates in Host source-layer checks.)
 *  2. `packages/ui` — the `@datazen/ui` design system. It is the shared
 *     **leaf**: the host, every driver and every extension bundle it, so a
 *     host-owned runtime imported from a primitive breaks every consumer at
 *     once. `PathInput` importing `@tauri-apps/plugin-dialog` is exactly that,
 *     and neither the previous single rule nor the driver boundary guard
 *     (`check-driver-import-boundaries.mjs`) could see it.
 *
 * A rule names a source subtree (`from`), the subtrees it must not import from
 * (`forbidden`, matched on the *resolved* repo-relative path) and — because the
 * design system's leaks are almost always bare package specifiers rather than
 * relative climbs — the bare specifier prefixes it must not name
 * (`forbiddenPackages`, matched as prefixes). Both lists are prefix matches, so
 * a new subtree or a new `@tauri-apps/plugin-*` is covered without editing
 * this file.
 *
 * Detection walks **every string literal** in the scanned subtree, not just
 * `from '…'`: plain imports, `export … from`, dynamic `import()`,
 * `require()`, and `vi.mock()` / `vi.doMock()` all end up as literals, and
 * matching a single keyword is how violations stayed invisible. The tokenizer
 * is shared with the driver boundary guard.
 *
 * The set of files that count as source (`SCAN_EXTENSIONS`,
 * `SKIP_DIR_NAMES`) is shared with it as well, via
 * `scripts/lib/scanTargets.mjs`. Declaring the set twice is how the two guards
 * ended up disagreeing about which files exist — one reported
 * `packages/ui/dist/**` while the other ignored it, and only one of them
 * looked at `.mjs` — and a guard that quietly watches a different file set is
 * not a second opinion on the same question.
 */
import { readFileSync, readdirSync } from 'fs';
import { resolve, dirname, extname, relative, posix } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { scanCode } from './lib/scanSourceCode.mjs';
import { SCAN_EXTENSIONS, SKIP_DIR_NAMES } from './lib/scanTargets.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Each rule names a source subtree and the subtrees it must not import from.
 * Paths are POSIX-style, relative to the repo root.
 *
 * @type {Array<{name: string, from: string, forbidden?: string[], forbiddenPackages?: string[]}>}
 */
export const LAYER_RULES = [
  {
    name: 'shared relation metadata must not import its consumers',
    from: 'src/lib/relationMetadata',
    forbidden: ['src/components', 'src/stores', 'src/windows', 'src/hooks'],
  },
  {
    name: 'shared design system (@datazen/ui) must stay a host-free leaf',
    from: 'packages/ui',
    // Host source, driver internals and sibling DataZen packages all sit
    // *above* the design system; reaching into any of them inverts the
    // layering every other package is built on.
    forbidden: [
      'src',
      'packages/drivers',
      'packages/driver-sdk',
      'packages/wapp-sdk',
      'packages/extension-points',
    ],
    // Bare specifiers a Tauri webview (or a host-owned store) is the only
    // place for. Matched as prefixes so a newly published plugin is covered.
    forbiddenPackages: [
      '@tauri-apps/',
      'zustand',
      '@datazen/driver-sdk',
      '@datazen/wapp-sdk',
      '@datazen/extension-points',
    ],
  },
];

const SOURCE_EXTENSIONS = SCAN_EXTENSIONS;

/** Every source file under `dir`, recursively. */
function collectSourceFiles(dir) {
  const out = [];
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      // Vendored / generated trees are somebody else's source. Skipping them
      // here matters more than it looks: `packages/ui/` has no `node_modules`
      // or `dist` today, so without this a single `npm install` under the
      // design system would start failing the gate on third-party code.
      if (entry.isDirectory() && SKIP_DIR_NAMES.has(entry.name)) continue;
      const full = resolve(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (SOURCE_EXTENSIONS.has(extname(entry.name))) {
        out.push(full);
      }
    }
  };
  walk(resolve(ROOT, dir));
  return out;
}

/** Resolve a relative import specifier to a repo-relative POSIX path. */
function resolveSpecifier(file, specifier) {
  if (!specifier.startsWith('.')) return null;
  const target = resolve(dirname(file), specifier);
  return relative(ROOT, target).split('\\').join(posix.sep);
}

function isForbidden(target, forbidden = []) {
  return forbidden.some((prefix) => target === prefix || target.startsWith(`${prefix}/`));
}

function forbiddenPackage(specifier, prefixes = []) {
  return prefixes.find((prefix) => specifier.startsWith(prefix)) ?? null;
}

/**
 * @param {{ root?: string, log?: (...a: unknown[]) => void }} [opts]
 * @returns {number} 0 when clean, 1 when any rule is violated
 */
export function checkModuleLayers(opts = {}) {
  const log = opts.log ?? console.log;
  const violations = [];

  for (const rule of LAYER_RULES) {
    for (const file of collectSourceFiles(rule.from)) {
      const source = readFileSync(file, 'utf8');
      const { literals } = scanCode(source);
      const lines = source.split('\n');
      for (const { value, line } of literals) {
        const target = resolveSpecifier(file, value);
        if (target && isForbidden(target, rule.forbidden)) {
          violations.push({
            rule: rule.name,
            file: relative(ROOT, file),
            line,
            text: (lines[line - 1] ?? '').trim(),
            specifier: value,
            target,
          });
          continue;
        }
        const pkg = forbiddenPackage(value, rule.forbiddenPackages);
        if (pkg) {
          violations.push({
            rule: rule.name,
            file: relative(ROOT, file),
            line,
            text: (lines[line - 1] ?? '').trim(),
            specifier: value,
            target: `${pkg}…`,
          });
        }
      }
    }
  }

  if (violations.length === 0) {
    log(`[check-module-layers] ok (${LAYER_RULES.length} rules)`);
    return 0;
  }

  log(`[check-module-layers] ${violations.length} violation(s):`);
  for (const v of violations) {
    log(`  ${v.file}:${v.line}  →  ${v.target}`);
    log(`    ${v.text}`);
    log(`    rule: ${v.rule}`);
  }
  return 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(checkModuleLayers());
}
