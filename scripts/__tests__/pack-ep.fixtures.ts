/**
 * Fixtures shared by the two `pack-ep` test files.
 *
 * `pack-ep.test.ts` covers the packaging pipeline end to end;
 * `pack-ep-host-globals.test.ts` covers what the packer rewrites and what the
 * shipped artifact is then required to prove. They are one subject seen from two
 * sides, and the fixture definitions they both stand on live here rather than
 * being copied into each -- a fixture that exists twice is a fixture that will
 * be edited in one file only.
 */
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

/**
 * A bundle shaped like a real privileged extension: bare imports of the shared
 * singleton modules, in all three import forms the rewriter claims to handle
 * (named, default, namespace).
 *
 * The artifact-level host-key invariant is only meaningful if the rewriter had
 * something to rewrite, so the end-to-end case feeds it this rather than the
 * empty `activate() {}` the other fixtures use. Every specifier here is in
 * `HOST_SHARED_MODULES`, so each must come out the other side as a published
 * `__DATAZEN_HOST__` key.
 */
export const SYNTHETIC_BUNDLE = `import { EditorView } from '@codemirror/view';
import react from 'react';
import * as state from '@codemirror/state';
import { Compartment } from '@codemirror/state';

export function activate(view) {
  const c = new Compartment();
  c.reconfigure(EditorView.editable.of(false));
  view.dispatch({ effects: state.Composer.map.of(c.reconfigure()) });
  return react;
}
`;

export function writeFixtureExtension(root: string, bundle = 'export function activate() {}\n') {
  mkdirSync(join(root, 'dist'), { recursive: true });
  mkdirSync(join(root, 'src/locales'), { recursive: true });
  writeFileSync(
    join(root, 'manifest.json'),
    `${JSON.stringify(
      {
        id: '@datazen/extension-fixture',
        name: 'Fixture EP',
        version: '9.9.9',
        main: 'dist/index.esm.js',
        engines: { datazen: '>=0.1.2', extensionPointsVersion: '1.0.0' },
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(join(root, 'dist/index.esm.js'), bundle);
  writeFileSync(
    join(root, 'src/locales/en.ts'),
    "export const en = { 'fixture.key': 'Fixture' };\n",
  );
}

/**
 * Extract the key set of the `globalThis.__DATAZEN_HOST__` table from the host
 * entry module. Entries come in two shapes — quoted specifiers
 * (`'@codemirror/view': cmView`) and bare identifiers (`react: reactAll`) — so
 * the parser must accept both; a quoted-only regex silently drops `react` and
 * the drift guard goes blind in exactly the case it is meant to catch.
 *
 * An entry line matching neither shape throws instead of being skipped: a
 * parser that shrugs off what it cannot read is not a guard.
 */
export function parseHostGlobalTableKeys(source: string): string[] {
  const table = source.match(/__DATAZEN_HOST__\s*=\s*\{([\s\S]*?)\n\};/);
  if (!table) {
    throw new Error('src/main.tsx: __DATAZEN_HOST__ table literal not found');
  }
  const keys: string[] = [];
  for (const rawLine of table[1].split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('//') || line.startsWith('/*') || line.startsWith('*')) {
      continue;
    }
    const entry = line.match(/^(?:(['"])((?:[^'"\\]|\\.)*)\1|([A-Za-z_$][\w$]*))\s*:\s*.+?,?$/);
    if (!entry) {
      throw new Error(`src/main.tsx: unparsable __DATAZEN_HOST__ entry "${line}"`);
    }
    keys.push(entry[3] ?? entry[2]);
  }
  return keys;
}
