/** @vitest-environment node */
import { execFileSync } from 'child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import {
  assertHostGlobalKeysAllowed,
  assertPackageLayout,
  collectHostGlobalKeys,
  countUnverifiableHostRefs,
  createDzxArchive,
  dzxFileName,
  HOST_GLOBAL_NAME,
  HOST_SHARED_MODULES,
  listZipEntries,
  packEp,
  parsePackArgs,
  readHostGlobalTableKeys,
  readManifestVersion,
  REQUIRED_PACKAGE_PATHS,
  ROOT,
  rewriteEpBundleFile,
  rewriteEpImportsToHostGlobals,
  stagePackageTree,
  syncLocales,
} from '../pack-ep.mjs';
import {
  buildSignaturePayload,
  parsePrivateKeyMaterial,
  parseSignArgs,
  sha256File,
  sha256Hex,
  signEpPackage,
} from '../sign-ep.mjs';
import { generateKeyPairSync } from 'crypto';

// ─────────────────────────────────────────────────────────────────────────────
// Pro checkout availability — fail-by-default, one opt-out for the whole family
// ─────────────────────────────────────────────────────────────────────────────
//
// `packages/pro-extensions/sql-editor-pro` is a **separate git repository**,
// gitignored by the host (`.gitignore:68`) and never cloned by the host-only CI
// job. Four Pro-dependent checks used to be guarded by `if (!existsSync) return`
// or `it.skipIf(...)` — i.e. they reported **green for a check that never ran**.
// Two of them were bare `return`s, so they were not even visible as skips in the
// reporter. That is the same defect class as the `panelStore` fixture's
// provenance layer, on a different seam, and the rule is the same: a guard must
// not report success for a check it did not run.
//
// So the default is a FAILURE, carried by the named provisioning test plus one
// self-describing error per check that needed the Pro (measured: 3 failures
// together — the provisioning test, the `.dzx` build/sign, and peerDependencies
// — each naming the exact check, so the cause is never ambiguous). The remaining
// `vite.config.ts` probes genuinely cannot run without the Pro, so they skip
// either way: when the absence is unacknowledged the suite is already red, and
// when it is acknowledged the skip is the intended outcome.
//
// `DATAZEN_ALLOW_MISSING_PRO=1` is the single opt-out for **every** Pro-absent
// gate in this repo (here, `src/components/sql-editor/__tests__/
// proSettingsSeam.test.ts`, and `scripts/pro-seam-gate.mjs`), so an operator
// acknowledges the whole family with one variable or none of it. The host-only CI
// job sets it explicitly, with the reason recorded next to it in the workflow.
//
// ⚠️ "This test is slow, so it should skip" is NOT a valid exemption. The Pro
// build in `builds, signs, and writes .dzx for sql-editor-pro` costs 9.6–13.8s
// per run (measured twice, under different load). It is paid on every run where
// the Pro exists, and the opt-out exists for checkouts that genuinely have no Pro
// repo.
//
// Measured cost of the no-Pro path, same file: **1.59s wall / 90ms of test time**
// with the Pro absent and acknowledged, versus **13.47s** with the Pro present
// (56 passed) — i.e. the guards short-circuit on the missing directory instead of
// attempting a build. Fail-by-default makes a Pro-less checkout *cheaper*, not
// more expensive.
const PRO_PKG_DIR = join(ROOT, 'packages/pro-extensions/sql-editor-pro');
const proPresent = existsSync(join(PRO_PKG_DIR, 'package.json'));
const allowMissingPro = process.env.DATAZEN_ALLOW_MISSING_PRO === '1';

/** Skip Pro-dependent checks only when the absence has been acknowledged. */
const proSkip = !proPresent;

/**
 * Gate a single Pro-dependent check.
 *
 * @returns `true` when the check may proceed, `false` only on the acknowledged
 *          no-Pro path. Throws (test failure) when the absence is unacknowledged.
 */
function requireProCheckout(what: string): boolean {
  if (proPresent) return true;
  if (allowMissingPro) {
    console.warn(
      `[pack-ep] ACKNOWLEDGED SKIP — "${what}" did NOT run: no Pro checkout at ` +
        `${PRO_PKG_DIR} (DATAZEN_ALLOW_MISSING_PRO=1).`,
    );
    return false;
  }
  throw new Error(
    `[pack-ep] "${what}" requires the real Pro checkout, which is absent at ` +
      `${PRO_PKG_DIR}. The Pro is a separate, host-gitignored git repository, so ` +
      'this guard would otherwise report success for a check that never ran — the ' +
      'same failure mode as a silent skip. Provision the Pro checkout, or re-run ' +
      'with DATAZEN_ALLOW_MISSING_PRO=1 to acknowledge that this checkout is ' +
      'knowingly Pro-less. (NOT exempting this for being slow.)',
  );
}

describe('Pro checkout provisioning (fail-by-default)', () => {
  it('provisions the real Pro package, or says so', () => {
    // The single named failure carrying the whole family, so an unacknowledged
    // absence is one actionable line rather than four unrelated errors.
    if (proPresent) {
      expect(existsSync(join(PRO_PKG_DIR, 'package.json'))).toBe(true);
      return;
    }
    expect(
      allowMissingPro,
      `Pro checkout not found at ${PRO_PKG_DIR} — the Pro packaging contract ` +
        '(build, sign, peerDependencies, externalize rules) is UNTESTED and nothing ' +
        'in it ran. Provision the Pro checkout, or re-run with ' +
        'DATAZEN_ALLOW_MISSING_PRO=1 to acknowledge the gap explicitly.',
    ).toBe(true);
  });
});

function writeFixtureExtension(root: string) {
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
  writeFileSync(join(root, 'dist/index.esm.js'), 'export function activate() {}\n');
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
function parseHostGlobalTableKeys(source: string): string[] {
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

describe('sign-ep', () => {
  it('writes signature.sig with stable file hashes', () => {
    const dir = join(tmpdir(), `sign-ep-test-${Date.now()}`);
    writeFixtureExtension(dir);
    const { outPath, sigDoc } = signEpPackage({ packageDir: dir });
    expect(existsSync(outPath)).toBe(true);
    expect(sigDoc.files['manifest.json'].sha256).toBe(sha256File(join(dir, 'manifest.json')));
    expect(sigDoc.files['dist/index.esm.js'].sha256).toBe(
      sha256File(join(dir, 'dist/index.esm.js')),
    );
    expect(sigDoc.signature).toMatch(/^[A-Za-z0-9+/=]+$/);
  });
});

describe('pack-ep staging and .dzx archive', () => {
  it('stages signed package tree with required layout', () => {
    const src = join(tmpdir(), `pack-ep-src-${Date.now()}`);
    const staged = join(tmpdir(), `pack-ep-staged-${Date.now()}`);
    writeFixtureExtension(src);
    stagePackageTree(src, staged);
    assertPackageLayout(staged);
    for (const rel of REQUIRED_PACKAGE_PATHS) {
      expect(existsSync(join(staged, rel))).toBe(true);
    }
    expect(existsSync(join(staged, 'locales/en.ts'))).toBe(true);
    const sig = JSON.parse(readFileSync(join(staged, 'signature.sig'), 'utf8'));
    expect(sig.algorithm).toBe('Ed25519');
  });

  it('creates .dzx zip with manifest, bundle, signature, and locales', () => {
    const src = join(tmpdir(), `pack-ep-dzx-src-${Date.now()}`);
    const staged = join(tmpdir(), `pack-ep-dzx-staged-${Date.now()}`);
    const outDir = join(tmpdir(), `pack-ep-dzx-out-${Date.now()}`);
    mkdirSync(outDir, { recursive: true });
    writeFixtureExtension(src);
    stagePackageTree(src, staged);

    const dzxPath = join(outDir, dzxFileName('fixture-ep', '9.9.9'));
    createDzxArchive(staged, dzxPath);
    expect(existsSync(dzxPath)).toBe(true);

    const entries = unzipSync(readFileSync(dzxPath));
    const names = Object.keys(entries).sort();
    expect(names).toEqual(
      expect.arrayContaining([
        'manifest.json',
        'dist/index.esm.js',
        'signature.sig',
        'locales/en.ts',
      ]),
    );

    const manifest = JSON.parse(Buffer.from(entries['manifest.json']).toString('utf8'));
    expect(manifest.version).toBe('9.9.9');
    const sig = JSON.parse(Buffer.from(entries['signature.sig']).toString('utf8'));
    expect(sig.files['dist/index.esm.js']).toBeTruthy();
  });

  it('packEp --skip-build packages from an existing staged tree', () => {
    const src = join(tmpdir(), `pack-ep-skip-src-${Date.now()}`);
    const staged = join(tmpdir(), `pack-ep-skip-staged-${Date.now()}`);
    const outDir = join(tmpdir(), `pack-ep-skip-out-${Date.now()}`);
    writeFixtureExtension(src);
    stagePackageTree(src, staged);

    const result = packEp({
      extension: 'fixture-ep',
      extensionDir: staged,
      mode: 'dzx',
      outDir,
      skipBuild: true,
      log: () => {},
    });

    expect(result.dzxPath).toBe(join(outDir, 'fixture-ep-9.9.9.dzx'));
    expect(existsSync(result.dzxPath!)).toBe(true);
  });
});

describe('pack-ep helpers', () => {
  it('listZipEntries preserves relative paths', () => {
    const root = join(tmpdir(), `pack-ep-zip-${Date.now()}`);
    mkdirSync(join(root, 'dist'), { recursive: true });
    writeFileSync(join(root, 'manifest.json'), '{}');
    writeFileSync(join(root, 'dist/index.esm.js'), 'export {}');
    const entries = listZipEntries(root);
    expect(Object.keys(entries).sort()).toEqual(['dist/index.esm.js', 'manifest.json']);
  });

  it('buildSignaturePayload sorts file keys deterministically', () => {
    const payload = buildSignaturePayload({
      'dist/index.esm.js': 'bbb',
      'manifest.json': 'aaa',
    });
    expect(payload.indexOf('"dist/index.esm.js"')).toBeLessThan(payload.indexOf('"manifest.json"'));
  });
});

describe('pack-ep integration with sql-editor-pro (fail-by-default when absent)', () => {
  it('builds, signs, and writes .dzx for sql-editor-pro', () => {
    const extDir = PRO_PKG_DIR;
    // Was a bare `return` — the test reported PASS while doing nothing at all.
    if (!requireProCheckout('builds, signs, and writes .dzx for sql-editor-pro')) return;

    const outDir = join(tmpdir(), `pack-ep-pro-${Date.now()}`);
    mkdirSync(outDir, { recursive: true });

    const result = packEp({
      extension: 'sql-editor-pro',
      extensionDir: extDir,
      mode: 'dzx',
      outDir,
      log: () => {},
    });

    expect(result.dzxPath).toMatch(/sql-editor-pro-.*\.dzx$/);
    expect(existsSync(result.dzxPath!)).toBe(true);

    const entries = unzipSync(readFileSync(result.dzxPath!));
    expect(Object.keys(entries)).toEqual(
      expect.arrayContaining(['manifest.json', 'dist/index.esm.js', 'signature.sig']),
    );

    // Per-key evidence that the shipped artifact satisfies the invariant,
    // read back out of the archive rather than out of the staging directory.
    const shippedBundle = Buffer.from(entries['dist/index.esm.js']).toString('utf8');
    const shippedKeys = collectHostGlobalKeys(shippedBundle);
    const published = new Set(readHostGlobalTableKeys());
    expect(shippedKeys.filter((key) => !published.has(key))).toEqual([]);
    expect(shippedKeys.filter((key) => !HOST_SHARED_MODULES.includes(key))).toEqual([]);
    // A zero-key artifact would satisfy the filter vacuously — pin the shape so
    // a scanner that quietly stopped matching shows up as a red, not a pass.
    expect(shippedKeys.length).toBeGreaterThan(0);
    expect(countUnverifiableHostRefs(shippedBundle)).toBe(0);

    rmSync(outDir, { recursive: true, force: true });
  }, 120_000);
});

describe('[tester] pack-ep args, locales, and error paths', () => {
  it('test_tester_parsePackArgs_parses_mode_out_and_skip_build', () => {
    const parsed = parsePackArgs([
      '--extension=custom-ep',
      '--mode=stage',
      '--out=/tmp/out',
      '--stage-dir=/tmp/stage',
      '--skip-build',
    ]);
    expect(parsed.extension).toBe('custom-ep');
    expect(parsed.mode).toBe('stage');
    expect(parsed.outDir).toContain('/tmp/out');
    expect(parsed.stageDir).toContain('/tmp/stage');
    expect(parsed.skipBuild).toBe(true);
  });

  it('test_tester_readManifestVersion_requires_string_version', () => {
    const dir = join(tmpdir(), `pack-ep-manifest-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ id: 'x' }));
    expect(() => readManifestVersion(join(dir, 'manifest.json'))).toThrow(
      /missing string "version"/,
    );
  });

  it('test_tester_packEp_unknown_mode_throws', () => {
    const src = join(tmpdir(), `pack-ep-bad-mode-${Date.now()}`);
    writeFixtureExtension(src);
    expect(() =>
      packEp({
        extensionDir: src,
        mode: 'invalid' as 'dzx',
        skipBuild: true,
        log: () => {},
      }),
    ).toThrow(/unknown mode/);
  });

  it('test_tester_packEp_mode_both_writes_dzx_and_stages', () => {
    const src = join(tmpdir(), `pack-ep-both-src-${Date.now()}`);
    const stageDir = join(tmpdir(), `pack-ep-both-stage-${Date.now()}`);
    const outDir = join(tmpdir(), `pack-ep-both-out-${Date.now()}`);
    writeFixtureExtension(src);
    const result = packEp({
      extension: 'fixture-ep',
      extensionDir: src,
      mode: 'both',
      outDir,
      stageDir,
      skipBuild: true,
      log: () => {},
    });
    expect(result.staged).toBe(true);
    expect(result.dzxPath).toBe(join(outDir, 'fixture-ep-9.9.9.dzx'));
    expect(existsSync(result.dzxPath!)).toBe(true);
    expect(existsSync(join(stageDir, 'signature.sig'))).toBe(true);
    rmSync(outDir, { recursive: true, force: true });
    rmSync(stageDir, { recursive: true, force: true });
  });

  it('test_tester_syncLocales_copies_explicit_locales_directory', () => {
    const src = join(tmpdir(), `pack-ep-locales-src-${Date.now()}`);
    const target = join(tmpdir(), `pack-ep-locales-target-${Date.now()}`);
    mkdirSync(join(src, 'locales'), { recursive: true });
    writeFileSync(join(src, 'locales/en.json'), '{"k":"v"}');
    syncLocales(src, target, { log: () => {} });
    expect(existsSync(join(target, 'locales/en.json'))).toBe(true);
  });

  it('test_tester_assertPackageLayout_throws_when_incomplete', () => {
    const dir = join(tmpdir(), `pack-ep-incomplete-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'manifest.json'), '{}');
    expect(() => assertPackageLayout(dir)).toThrow(/incomplete package/);
  });
});

describe('[tester] sign-ep helpers and error paths', () => {
  it('test_tester_sha256Hex_matches_file_digest', () => {
    const dir = join(tmpdir(), `sign-ep-hex-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const file = join(dir, 'sample.txt');
    writeFileSync(file, 'hello');
    expect(sha256Hex('hello')).toBe(sha256File(file));
  });

  it('test_tester_parsePrivateKeyMaterial_accepts_generated_ed25519_pem', () => {
    const { privateKey } = generateKeyPairSync('ed25519');
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    expect(parsePrivateKeyMaterial(pem)).toBeDefined();
  });

  it('test_tester_signEpPackage_throws_when_signed_file_missing', () => {
    const dir = join(tmpdir(), `sign-ep-missing-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'manifest.json'), '{}');
    expect(() => signEpPackage({ packageDir: dir })).toThrow(/missing signed artifact/);
  });

  it('test_tester_parseSignArgs_reads_dir_and_out', () => {
    expect(parseSignArgs(['--dir=/pkg', '--out=/sig'])).toEqual({
      packageDir: '/pkg',
      outPath: '/sig',
    });
  });

  it('test_tester_parsePrivateKeyMaterial_rejects_invalid_seed_length', () => {
    expect(() => parsePrivateKeyMaterial(Buffer.from('short').toString('base64'))).toThrow(
      /32-byte Ed25519 seed/,
    );
  });
});

describe('rewriteEpImportsToHostGlobals (track B blob loading)', () => {
  const SAMPLE = [
    'import { a as b, c } from "@datazen/extension-points";',
    'import D, { x } from "react";',
    'import * as ns from "@codemirror/view";',
    'import "@datazen/ui";',
    'export { p as q } from "@codemirror/state";',
    'const m = await import("@codemirror/lint");',
    'import rel from "./relative.js";',
    'import abs from "/abs/path.js";',
  ].join('\n');

  it('rewrites every bare import form to the host singleton table', () => {
    const { code, rewritten } = rewriteEpImportsToHostGlobals(SAMPLE);
    expect(rewritten.sort()).toEqual(
      [
        '@codemirror/lint',
        '@codemirror/state',
        '@codemirror/view',
        '@datazen/extension-points',
        '@datazen/ui',
        'react',
      ].sort(),
    );
    // No bare shared-specifier import/export remains.
    for (const spec of HOST_SHARED_MODULES) {
      expect(code).not.toMatch(
        new RegExp(`from\\s*["']${spec.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']`),
      );
    }
    // Relative + absolute specifiers pass through untouched.
    expect(code).toContain('import rel from "./relative.js";');
    expect(code).toContain('import abs from "/abs/path.js";');
    // Default-import interop keeps `.default ?? namespace`.
    expect(code).toContain('.default ?? ');
    // The host global name is referenced, not a bare module.
    expect(code).toContain(`globalThis.${HOST_GLOBAL_NAME}["react"]`);
  });

  it('named default re-export preserves the exported name', () => {
    const { code } = rewriteEpImportsToHostGlobals('export { default as D, v } from "react";');
    expect(code).toContain('export {');
    expect(code).toContain('as D');
    expect(code).toContain('as v');
  });

  it('is idempotent — a rewritten bundle has nothing left to rewrite', () => {
    const once = rewriteEpImportsToHostGlobals(SAMPLE).code;
    const twice = rewriteEpImportsToHostGlobals(once);
    expect(twice.rewritten).toEqual([]);
    expect(twice.code).toBe(once);
  });

  it('throws on unmapped bare specifiers instead of shipping a crashing bundle', () => {
    expect(() => rewriteEpImportsToHostGlobals('import x from "@tauri-apps/api/core";')).toThrow(
      /unmapped bare.*__DATAZEN_HOST__/,
    );
    expect(() => rewriteEpImportsToHostGlobals('export * from "react";')).toThrow(
      /cannot rewrite 'export \* from/,
    );
  });

  it('drops stale sourcemap refs invalidated by the rewrite', () => {
    const { code } = rewriteEpImportsToHostGlobals(
      'const a = 1;\n//# sourceMappingURL=index.esm.js.map\n',
    );
    expect(code).not.toContain('sourceMappingURL');
  });

  it('rewriteEpBundleFile rewrites a bundle file in place', () => {
    const dir = join(tmpdir(), `rewrite-file-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const file = join(dir, 'index.esm.js');
    writeFileSync(file, 'import { a } from "@datazen/extension-points";\nexport const v = a;\n');
    const { rewritten } = rewriteEpBundleFile(file);
    expect(rewritten).toEqual(['@datazen/extension-points']);
    expect(readFileSync(file, 'utf8')).toContain(`globalThis.${HOST_GLOBAL_NAME}`);
  });

  it('stagePackageTree ships a rewritten bundle (no stale map, signed after rewrite)', () => {
    const src = join(tmpdir(), `rewrite-stage-src-${Date.now()}`);
    const staged = join(tmpdir(), `rewrite-stage-staged-${Date.now()}`);
    writeFixtureExtension(src);
    writeFileSync(
      join(src, 'dist/index.esm.js'),
      'import { a } from "@datazen/extension-points";\nexport const v = a;\n',
    );
    writeFileSync(join(src, 'dist/index.esm.js.map'), '{"version":3}');
    stagePackageTree(src, staged, { log: () => {} });
    const bundle = readFileSync(join(staged, 'dist/index.esm.js'), 'utf8');
    expect(bundle).toContain(`globalThis.${HOST_GLOBAL_NAME}`);
    // The stale map is not staged (rewrite invalidates its mappings).
    expect(existsSync(join(staged, 'dist/index.esm.js.map'))).toBe(false);
    // Signature covers the rewritten bytes.
    const sig = JSON.parse(readFileSync(join(staged, 'signature.sig'), 'utf8'));
    const { sha256File: sha } = { sha256File };
    expect(sig.files['dist/index.esm.js'].sha256).toBe(sha(join(staged, 'dist/index.esm.js')));
    rmSync(src, { recursive: true, force: true });
    rmSync(staged, { recursive: true, force: true });
  });
});

/**
 * Track G1 anti-drift guard. The host entry table (`src/main.tsx`) and the
 * pack-time allow-list (`HOST_SHARED_MODULES`) are two halves of one
 * mechanism: pack-ep rewrites every bare import to
 * `globalThis.__DATAZEN_HOST__[spec]`, so a specifier present in one list but
 * not the other either crashes the blob-loaded bundle (whitelist-only) or
 * becomes dead weight the host never hands out (table-only). They are edited
 * as one change, and these tests make that mandatory.
 */
describe('host shared module registry (G1 anti-drift guard)', () => {
  const hostTableKeys = parseHostGlobalTableKeys(readFileSync(join(ROOT, 'src/main.tsx'), 'utf8'));

  it('parses both quoted specifiers and bare identifier keys from the host table', () => {
    expect(hostTableKeys).toContain('react');
    expect(hostTableKeys).toContain('@codemirror/view');
  });

  it('registers exactly 11 shared modules on both sides', () => {
    expect(hostTableKeys).toHaveLength(11);
    expect(HOST_SHARED_MODULES).toHaveLength(11);
  });

  it('registers @codemirror/language and @codemirror/commands on both sides', () => {
    for (const spec of ['@codemirror/language', '@codemirror/commands']) {
      expect(hostTableKeys).toContain(spec);
      expect(HOST_SHARED_MODULES).toContain(spec);
    }
  });

  it('host table and HOST_SHARED_MODULES hold identical, duplicate-free key sets', () => {
    expect(new Set(hostTableKeys).size).toBe(hostTableKeys.length);
    expect([...hostTableKeys].sort()).toEqual([...HOST_SHARED_MODULES].sort());
  });

  it('every allow-listed specifier is actually published by the host table', () => {
    // The subset direction is the one that costs a user a crash: an entry that
    // exists only in the declaration rewrites to `__DATAZEN_HOST__['spec']`,
    // the host never hands that key out, and the EP dies on load with a signed
    // artifact. The reverse direction (a published key nothing imports) is dead
    // weight, not a crash, so the subset assertion is the load-bearing half.
    const published = new Set(hostTableKeys);
    const declaredOnly = HOST_SHARED_MODULES.filter((spec) => !published.has(spec));
    expect(
      declaredOnly,
      `HOST_SHARED_MODULES declares ${declaredOnly.join(', ')} but src/main.tsx never ` +
        `publishes them — a Pro import of those would ship signed and crash on load`,
    ).toEqual([]);
  });

  it('rewrites a Pro import of the newly shared modules through the host table', () => {
    const { code, rewritten } = rewriteEpImportsToHostGlobals(
      [
        'import { foldService } from "@codemirror/language";',
        'import { defaultKeymap } from "@codemirror/commands";',
      ].join('\n'),
    );
    expect(rewritten.sort()).toEqual(['@codemirror/commands', '@codemirror/language']);
    expect(code).toContain(`globalThis.${HOST_GLOBAL_NAME}["@codemirror/language"]`);
    expect(code).toContain(`globalThis.${HOST_GLOBAL_NAME}["@codemirror/commands"]`);
  });

  it('still throws for a specifier missing from the narrow list', () => {
    const drifted = HOST_SHARED_MODULES.filter((spec) => spec !== '@codemirror/language');
    expect(() =>
      rewriteEpImportsToHostGlobals('import { foldService } from "@codemirror/language";', {
        modules: drifted,
      }),
    ).toThrow(/unmapped bare import from "@codemirror\/language"/);
  });

  it('sql-editor-pro peerDependencies stay inside the host shared set (fail-by-default when absent)', () => {
    const proPkg = join(PRO_PKG_DIR, 'package.json');
    // Was a bare `return` — the test reported PASS while doing nothing at all.
    if (!requireProCheckout('sql-editor-pro peerDependencies stay inside the host shared set')) {
      return;
    }
    const parsed: unknown = JSON.parse(readFileSync(proPkg, 'utf8'));
    const peers = Object.keys(
      (parsed as { peerDependencies?: Record<string, string> }).peerDependencies ?? {},
    );
    // Pro 是**独立 git 仓库**，每个 worktree 各有一份检出，且由各轨自行建 worktree。
    // 「目录存在」不等于「检出在匹配 commit」——陈旧检出会让本断言给出**看似代码缺陷的
    // 红灯**（实测：集成分支的 Pro 检出停在 base 时，本例报 5 个 peer 缺 @codemirror/language，
    // 而宿主代码毫无问题）。故把检出身份写进失败信息，让红灯自证来源。
    const proBranch = ((): string => {
      try {
        return execFileSync('git', ['-C', PRO_PKG_DIR, 'rev-parse', '--abbrev-ref', 'HEAD'], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
        }).trim();
      } catch {
        return '(非 git 检出)';
      }
    })();
    const proHint =
      `Pro 检出 = ${proBranch}。若本断言失败而该检出并非本 initiative 的 Pro 集成分支` +
      `（productivity/editor-productivity），则多半是本 worktree 的 Pro 检出陈旧，` +
      `而非宿主代码缺陷 —— 请先对齐 Pro 检出再判定。`;

    expect(peers, proHint).toContain('@codemirror/language');
    expect(peers, proHint).toContain('@codemirror/commands');
    const hostSet = new Set(HOST_SHARED_MODULES);
    // A peer the host never publishes is a guaranteed missing key at load.
    expect(
      peers.filter((peer) => !hostSet.has(peer)),
      proHint,
    ).toEqual([]);
  });
});

/**
 * [tester] Probe-integrity guard for the G1 red line.
 *
 * The two layers are *supposed* to disagree: the Pro build externalizes every
 * `@codemirror/*` (wide regex) while `HOST_SHARED_MODULES` stays a narrow
 * literal list. That gap is the probe — it is what makes a newly imported
 * shared package fail the build instead of being silently bundled as a second
 * copy of a host singleton (cross-realm identity split, no error at load).
 *
 * The registry-parity tests above read only `src/main.tsx` and
 * `scripts/pack-ep.mjs`, so they stay green if someone "tidies up" the two
 * sides into one rule. These cases close that hole. They read the Pro
 * `vite.config.ts` as text and rebuild the predicate from the source, so the
 * assertion is about what the repo actually ships, not a copy of it.
 */
describe('externalize / allow-list asymmetry probe (G1 red line)', () => {
  const proViteConfig = join(ROOT, 'packages/pro-extensions/sql-editor-pro/vite.config.ts');
  const hasProViteConfig = existsSync(proViteConfig);
  const proSource = hasProViteConfig ? readFileSync(proViteConfig, 'utf8') : '';
  // Gate on the *Pro checkout*, not on this one file. Pro absent → skip (the
  // fail-by-default provisioning test is already red). Pro present but
  // `vite.config.ts` missing → these run and fail loudly, which is correct:
  // that is a real packaging defect, not a missing checkout.
  const skipProSource = proSkip;

  /** Body of `const isBareExternal = (s) => …;` — the externalize predicate. */
  function readExternalizePredicate(source: string): string {
    const decl = source.match(/const isBareExternal[^=]*=\s*([\s\S]*?);/);
    if (!decl) {
      throw new Error('vite.config.ts: isBareExternal declaration not found');
    }
    return decl[1];
  }

  /**
   * Rebuild the wide CodeMirror regex from the source text (not from a local
   * copy) so a narrowed or deleted predicate cannot be masked by the test.
   */
  function readWideCodemirrorPattern(source: string): RegExp {
    const literal = readExternalizePredicate(source).match(/\/\^@codemirror\\?\/\//);
    if (!literal) {
      throw new Error(
        'vite.config.ts: isBareExternal no longer externalizes via /^@codemirror\\// — ' +
          'the narrow-list probe has been removed',
      );
    }
    return new RegExp(literal[0].slice(1, -1));
  }

  it.skipIf(skipProSource)(
    'keeps the wide /^@codemirror\\// externalize rule on the Pro side',
    () => {
      expect(readExternalizePredicate(proSource)).toContain('/^@codemirror\\//');
      // `rollupOptions.external` must keep its regex entry too, not a string list.
      expect(proSource).toContain('/^@codemirror\\/.*/');
    },
  );

  it.skipIf(skipProSource)('keeps HOST_SHARED_MODULES a literal list, free of regexes', () => {
    expect(HOST_SHARED_MODULES.every((entry: unknown) => typeof entry === 'string')).toBe(true);
    expect(HOST_SHARED_MODULES).not.toContain('/^@codemirror\\//');
  });

  it.skipIf(skipProSource)(
    'wide externalize range is still strictly wider than the narrow allow-list',
    () => {
      const wide = readWideCodemirrorPattern(proSource);
      const narrow = new Set(HOST_SHARED_MODULES);
      // Specifiers the wide rule externalizes but the host table never publishes.
      const admitted = [
        '@codemirror/search',
        '@codemirror/lang-sql',
        '@codemirror/theme-one-dark',
      ].filter((spec) => wide.test(spec) && !narrow.has(spec));
      expect(admitted.length).toBeGreaterThan(0);
      // The probe is live: each of them must still hard-fail at pack time.
      for (const spec of admitted) {
        expect(() => rewriteEpImportsToHostGlobals(`import { probe } from "${spec}";`)).toThrow(
          new RegExp(`unmapped bare import from "${spec.replace('/', '\\/')}"`),
        );
      }
    },
  );
});

/**
 * BUG-002 — artifact-level host key invariant.
 *
 * The narrow allow-list gate (`rewriteEpImportsToHostGlobals`) only ever sees
 * the input *of the pack-time rewrite*. The Pro build's own `renderChunk` runs
 * FIRST and already rewrites every `/^@codemirror\//` import — named, default
 * and namespace alike — into `globalThis.__DATAZEN_HOST__['…']` without ever
 * consulting the allow-list. By the time the host gate runs, there is no bare
 * import left to reject: the log line `rewrote bare imports:` is permanently
 * empty. An unmapped key therefore shipped signed and blew up at load time
 * (`const { foldGutter } = undefined`).
 *
 * These cases exercise the artifact, not the rewrite input, because that is
 * the only layer the bypass cannot reach. Side-effect imports already hard-failed
 * (the host gate's regex does match them), which is exactly why the defect hid
 * for so long: the control group works, the named-import group does not.
 */
describe('[bug-002] artifact host-key invariant', () => {
  /**
   * A bundle shaped like the Pro `renderChunk` output: bare specifiers are
   * already `__DATAZEN_HOST__` member accesses by the time pack-ep sees them.
   * `quote` mirrors the Pro plugin (single) vs the pack-ep rewriter (double).
   */
  function writeHostGlobalBundle(root: string, specs: string[], quote: "'" | '"' = "'") {
    const q = quote;
    const lines = specs.map(
      (spec, i) => `const { fn${i} } = globalThis.${HOST_GLOBAL_NAME}[${q}${spec}${q}];`,
    );
    writeFixtureExtension(root);
    writeFileSync(
      join(root, 'dist/index.esm.js'),
      `${lines.join('\n')}\nexport function activate() { return [${specs
        .map((_, i) => `fn${i}`)
        .join(', ')}]; }\n`,
    );
  }

  const UNMAPPED = '@codemirror/search';

  it('collects host keys from both quote styles the two rewriters emit', () => {
    const code = [
      `const a = globalThis.${HOST_GLOBAL_NAME}["@codemirror/state"];`,
      `const b = globalThis.${HOST_GLOBAL_NAME}['@codemirror/view'];`,
      `const c = globalThis.${HOST_GLOBAL_NAME}['@codemirror/state'];`,
    ].join('\n');
    expect(collectHostGlobalKeys(code)).toEqual(['@codemirror/state', '@codemirror/view']);
  });

  it('collects the keys the pack-ep rewriter itself produces', () => {
    const { code } = rewriteEpImportsToHostGlobals(
      'import { a } from "@codemirror/language";\nimport * as ns from "react";\n',
    );
    expect(collectHostGlobalKeys(code)).toEqual(['@codemirror/language', 'react']);
  });

  it('assertHostGlobalKeysAllowed accepts a key set inside the allow-list', () => {
    const code = `const a = globalThis.${HOST_GLOBAL_NAME}["react"];`;
    expect(assertHostGlobalKeysAllowed(code)).toEqual(['react']);
  });

  it('assertHostGlobalKeysAllowed rejects an unmapped key in either quote style', () => {
    expect(() => assertHostGlobalKeysAllowed(`const a = globalThis.${HOST_GLOBAL_NAME}['${UNMAPPED}'];`)).toThrow(
      /unmapped host table key "@codemirror\/search"/,
    );
    expect(() => assertHostGlobalKeysAllowed(`const a = globalThis.${HOST_GLOBAL_NAME}["${UNMAPPED}"];`)).toThrow(
      /unmapped host table key "@codemirror\/search"/,
    );
  });

  it('assertHostGlobalKeysAllowed fails closed on a non-literal key', () => {
    expect(() =>
      assertHostGlobalKeysAllowed(`const a = globalThis.${HOST_GLOBAL_NAME}[someVar];`),
    ).toThrow(/non-literal/);
    // Reading the whole table claims no specific key but cannot be verified
    // either — same discipline, so a future refactor cannot widen the hole.
    expect(() => assertHostGlobalKeysAllowed(`const t = globalThis.${HOST_GLOBAL_NAME};`)).toThrow(
      /non-literal/,
    );
  });

  it('assertHostGlobalKeysAllowed honours a renamed host global', () => {
    const code = `const a = globalThis.__DZ_OTHER__['@codemirror/state'];`;
    expect(() => assertHostGlobalKeysAllowed(code, { globalName: '__DZ_OTHER__' })).not.toThrow();
    // A different global's keys must never be counted as ours — and code that
    // never touches our table claims no keys, so it passes with an empty set.
    expect(assertHostGlobalKeysAllowed(code)).toEqual([]);
  });

  it('collects dot-form host keys, not just bracket form', () => {
    // The shipped Pro bundle resolves React through `__DATAZEN_HOST__.react`.
    // A bracket-only scanner reports zero keys for it and lets any future
    // `__DATAZEN_HOST__.search` through signed, so the dot form is a key claim
    // like any other and must be checked.
    expect(collectHostGlobalKeys(`const R = globalThis.${HOST_GLOBAL_NAME}.react.default;`)).toEqual([
      'react',
    ]);
    expect(
      assertHostGlobalKeysAllowed(`const R = globalThis.${HOST_GLOBAL_NAME}.react.default;`),
    ).toEqual(['react']);
    expect(() =>
      assertHostGlobalKeysAllowed(`const S = globalThis.${HOST_GLOBAL_NAME}.search;`),
    ).toThrow(/unmapped host table key "search"/);
    // A dot chain resolves only its first segment; `.default` is a member of
    // the React namespace, not a host table key.
    expect(
      collectHostGlobalKeys(`const D = globalThis.${HOST_GLOBAL_NAME}.react.default;`),
    ).not.toContain('default');
  });

  it('rejects an allow-listed key the host entry table never publishes', () => {
    // The second bypass class: the narrow list is a *declaration of intent*, the
    // `src/main.tsx` table is what exists at runtime. An entry present only in
    // the declaration is an `undefined` deref at load, exactly like an unmapped
    // one — so it must be a hard failure too, not a silent pass.
    const code = `const a = globalThis.${HOST_GLOBAL_NAME}["react-dom/server"];`;
    expect(() =>
      assertHostGlobalKeysAllowed(code, {
        modules: [...HOST_SHARED_MODULES, 'react-dom/server'],
      }),
    ).toThrow(/is in HOST_SHARED_MODULES but the .* table in src\/main\.tsx never publishes it/);
  });

  it('matches keys exactly, never by prefix', () => {
    // A prefix rule would admit `react-anything` and quietly make the
    // enumerated allow-list decorative, while the real `react/jsx-runtime`
    // sub-path keeps working and looks like the rule is fine.
    const code = `const a = globalThis.${HOST_GLOBAL_NAME}["react-faux"];`;
    expect(() => assertHostGlobalKeysAllowed(code)).toThrow(
      /unmapped host table key "react-faux"/,
    );
    // The genuine sub-path is allow-listed as its own entry, and passes.
    expect(
      assertHostGlobalKeysAllowed(`const a = globalThis.${HOST_GLOBAL_NAME}["react/jsx-runtime"];`),
    ).toEqual(['react/jsx-runtime']);
  });

  it('reads the real host entry table and finds 11 published keys', () => {
    const keys = readHostGlobalTableKeys();
    expect(keys).toHaveLength(11);
    expect(keys).toContain('react');
    expect(keys).toContain('@codemirror/commands');
  });

  it('fails closed when the host entry table cannot be read', () => {
    expect(() => readHostGlobalTableKeys(join(ROOT, 'scripts/pack-ep.mjs'))).toThrow(
      /artifact key invariant cannot be verified/,
    );
  });

  // --- the mutation tests: the real gate, exercised through the real entry points ---

  it('stagePackageTree refuses to sign a bundle holding an unmapped host key', () => {
    const src = join(tmpdir(), `bug002-stage-src-${Date.now()}`);
    const staged = join(tmpdir(), `bug002-stage-out-${Date.now()}`);
    writeHostGlobalBundle(src, [UNMAPPED]);

    expect(() => stagePackageTree(src, staged, { log: () => {} })).toThrow(
      /unmapped host table key "@codemirror\/search"/,
    );
    // No signature may be issued for a bundle the host table cannot satisfy —
    // a signed artifact is what makes the crash unauditable downstream.
    expect(existsSync(join(staged, 'signature.sig'))).toBe(false);
    rmSync(src, { recursive: true, force: true });
    rmSync(staged, { recursive: true, force: true });
  });

  it.each([["'"] as const, ['"'] as const])(
    'stagePackageTree catches an out-of-table key written with %s quotes',
    (quote) => {
      // A one-style scanner is a vacuous gate: it reports zero keys on an
      // artifact written in the other style and passes. Both rewriters are in
      // play (Pro `renderChunk` emits single quotes, pack-ep emits double), so
      // both styles must independently trip the gate.
      const src = join(tmpdir(), `bug002-quote-src-${Date.now()}`);
      const staged = join(tmpdir(), `bug002-quote-out-${Date.now()}`);
      writeHostGlobalBundle(src, [UNMAPPED], quote);
      expect(() => stagePackageTree(src, staged, { log: () => {} })).toThrow(
        /unmapped host table key "@codemirror\/search"/,
      );
      expect(existsSync(join(staged, 'signature.sig'))).toBe(false);
      rmSync(src, { recursive: true, force: true });
      rmSync(staged, { recursive: true, force: true });
    },
  );

  it('stagePackageTree signs the very same shape once the key is allow-listed', () => {
    const src = join(tmpdir(), `bug002-stage-ok-src-${Date.now()}`);
    const staged = join(tmpdir(), `bug002-stage-ok-out-${Date.now()}`);
    writeHostGlobalBundle(src, ['@codemirror/language']);

    stagePackageTree(src, staged, { log: () => {} });
    expect(existsSync(join(staged, 'signature.sig'))).toBe(true);
    const bundle = readFileSync(join(staged, 'dist/index.esm.js'), 'utf8');
    const shipped = collectHostGlobalKeys(bundle);
    expect(shipped).toEqual(['@codemirror/language']);
    for (const key of shipped) {
      expect(HOST_SHARED_MODULES).toContain(key);
    }
    rmSync(src, { recursive: true, force: true });
    rmSync(staged, { recursive: true, force: true });
  });

  it('packEp produces neither .dzx nor signature for an unmapped host key', () => {
    const src = join(tmpdir(), `bug002-pack-src-${Date.now()}`);
    const outDir = join(tmpdir(), `bug002-pack-out-${Date.now()}`);
    mkdirSync(outDir, { recursive: true });
    writeHostGlobalBundle(src, ['react', UNMAPPED]);

    expect(() =>
      packEp({
        extension: 'fixture-ep',
        extensionDir: src,
        mode: 'dzx',
        outDir,
        skipBuild: true,
        log: () => {},
      }),
    ).toThrow(/unmapped host table key "@codemirror\/search"/);
    expect(existsSync(join(outDir, dzxFileName('fixture-ep', '9.9.9')))).toBe(false);
    expect(existsSync(join(outDir, '.pack-ep-staging-fixture-ep/signature.sig'))).toBe(false);
    rmSync(src, { recursive: true, force: true });
    rmSync(outDir, { recursive: true, force: true });
  });

  it('stagePackageTree also refuses a tree whose bytes arrive pre-rewritten', () => {
    // The CI/prebuilt handoff: `rewriteImports: false` means the bytes were
    // already turned into host accesses by the extension's own build, so the
    // input gate has nothing left to look at. The artifact gate is the only
    // thing standing between that path and a signed, unloadable bundle.
    const src = join(tmpdir(), `bug002-prebuilt-src-${Date.now()}`);
    const staged = join(tmpdir(), `bug002-prebuilt-staged-${Date.now()}`);
    writeFixtureExtension(src);
    writeFileSync(
      join(src, 'dist/index.esm.js'),
      `const { foldGutter } = globalThis.${HOST_GLOBAL_NAME}['${UNMAPPED}'];\nexport { foldGutter };\n`,
    );
    expect(() =>
      stagePackageTree(src, staged, { log: () => {}, rewriteImports: false }),
    ).toThrow(/unmapped host table key "@codemirror\/search"/);
    expect(existsSync(join(staged, 'signature.sig'))).toBe(false);
    rmSync(src, { recursive: true, force: true });
    rmSync(staged, { recursive: true, force: true });
  });

  it('createDzxArchive refuses to ship an already-staged tree with an unmapped key', () => {
    // Defence in depth: `stagePackageTree` is the first gate, but a prebuilt
    // tree handed straight to the archiver must not slip past it. Build the
    // tree by hand so it genuinely never passed through the first gate.
    const src = join(tmpdir(), `bug002-dzx-src-${Date.now()}`);
    const staged = join(tmpdir(), `bug002-dzx-staged-${Date.now()}`);
    const outDir = join(tmpdir(), `bug002-dzx-out-${Date.now()}`);
    mkdirSync(outDir, { recursive: true });
    writeFixtureExtension(src);
    writeFileSync(
      join(src, 'dist/index.esm.js'),
      `const { foldGutter } = globalThis.${HOST_GLOBAL_NAME}['${UNMAPPED}'];\nexport { foldGutter };\n`,
    );
    cpSync(join(src, 'manifest.json'), join(staged, 'manifest.json'));
    mkdirSync(join(staged, 'dist'), { recursive: true });
    cpSync(join(src, 'dist/index.esm.js'), join(staged, 'dist/index.esm.js'));
    signEpPackage({ packageDir: staged });
    expect(existsSync(join(staged, 'signature.sig'))).toBe(true);

    const outFile = join(outDir, dzxFileName('fixture-ep', '9.9.9'));
    expect(() => createDzxArchive(staged, outFile)).toThrow(
      /unmapped host table key "@codemirror\/search"/,
    );
    expect(existsSync(outFile)).toBe(false);
    rmSync(src, { recursive: true, force: true });
    rmSync(staged, { recursive: true, force: true });
    rmSync(outDir, { recursive: true, force: true });
  });

  it('keeps the side-effect-import control green (the gate itself is not broken)', () => {
    // The group that already worked must keep working — a fix that only turns
    // everything red is not a fix.
    expect(() =>
      rewriteEpImportsToHostGlobals(`import '${UNMAPPED}';`),
    ).toThrow(/unmapped bare side-effect import "@codemirror\/search"/);
    const src = join(tmpdir(), `bug002-sideeffect-src-${Date.now()}`);
    const staged = join(tmpdir(), `bug002-sideeffect-out-${Date.now()}`);
    writeFixtureExtension(src);
    writeFileSync(
      join(src, 'dist/index.esm.js'),
      `import '${UNMAPPED}';\nexport function activate() {}\n`,
    );
    expect(() => stagePackageTree(src, staged, { log: () => {} })).toThrow(
      /unmapped bare side-effect import "@codemirror\/search"/,
    );
    expect(existsSync(join(staged, 'signature.sig'))).toBe(false);
    rmSync(src, { recursive: true, force: true });
    rmSync(staged, { recursive: true, force: true });
  });
});
