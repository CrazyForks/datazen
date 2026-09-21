#!/usr/bin/env node
/**
 * Fail if the SQL editor and the Visual Query Builder start depending on each
 * other, or if the shared relation-metadata layer reaches back up.
 *
 * The two are **peers**: they present different ways to build the same query and
 * both read the same schema data. Sharing that data must go through the layer
 * below them (`src/lib/relationMetadata`, `src/stores/schemaStoreSelectors`), not
 * through one importing the other — a peer import means a change to either one
 * can break the other, and it hides which side actually owns the data.
 *
 * A regression here is easy to introduce by autocomplete, so it is guarded
 * rather than left to review.
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { resolve, dirname, relative, posix } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Each rule names a source subtree and the subtrees it must not import from.
 * Paths are POSIX-style, relative to the repo root.
 */
export const LAYER_RULES = [
  {
    name: 'visual-query-builder must not import the SQL editor',
    from: 'src/components/query-builder',
    forbidden: ['src/components/sql-editor'],
  },
  {
    name: 'the SQL editor must not import the Visual Query Builder',
    from: 'src/components/sql-editor',
    forbidden: ['src/components/query-builder'],
  },
  {
    name: 'shared relation metadata must not import its consumers',
    from: 'src/lib/relationMetadata',
    forbidden: ['src/components', 'src/stores', 'src/windows', 'src/hooks'],
  },
];

const SOURCE_EXTENSIONS = ['.ts', '.tsx'];

/** Every source file under `dir`, recursively. */
function collectSourceFiles(dir) {
  const out = [];
  const walk = (current) => {
    for (const entry of readdirSync(current)) {
      const full = resolve(current, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else if (SOURCE_EXTENSIONS.some((ext) => entry.endsWith(ext))) {
        out.push(full);
      }
    }
  };
  walk(resolve(ROOT, dir));
  return out;
}

const IMPORT_SPECIFIER = /(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g;

/** Resolve a relative import specifier to a repo-relative POSIX path. */
function resolveSpecifier(file, specifier) {
  if (!specifier.startsWith('.')) return null;
  const target = resolve(dirname(file), specifier);
  return relative(ROOT, target).split('\\').join(posix.sep);
}

function isForbidden(target, forbidden) {
  return forbidden.some((prefix) => target === prefix || target.startsWith(`${prefix}/`));
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
      for (const match of source.matchAll(IMPORT_SPECIFIER)) {
        const target = resolveSpecifier(file, match[1]);
        if (target && isForbidden(target, rule.forbidden)) {
          violations.push({ rule: rule.name, file: relative(ROOT, file), target });
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
    log(`  ${v.file}  →  ${v.target}`);
    log(`    rule: ${v.rule}`);
  }
  return 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(checkModuleLayers());
}
