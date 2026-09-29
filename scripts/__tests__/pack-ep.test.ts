/** @vitest-environment node */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import {
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
import { SYNTHETIC_BUNDLE, writeFixtureExtension } from './pack-ep.fixtures';

// ─────────────────────────────────────────────────────────────────────────────
// Scope: this file tests the Host's packaging pipeline, against a synthetic EP
// ─────────────────────────────────────────────────────────────────────────────
//
// Four cases here used to read `packages/pro-extensions/sql-editor-pro/` — a
// separate git repository, gitignored by the Host, never cloned by Host CI. Two
// of them were bare `if (!existsSync) return` guards, so in a Pro-less checkout
// they reported **green for a check that never ran**: a test named after a
// contract, passing without having looked at it. The other two were `it.skipIf`.
//
// They are gone, and the coverage is not. What all four actually pinned is
// either a Host-owned rule, or a Pro-owned one:
//
//   * `.dzx` build/sign/layout, and the shipped-artifact host-key invariant —
//     the Host's pipeline. Re-pointed at a synthetic EP below, with a bundle
//     that really does import the shared modules, so the key scan is not
//     vacuous. Runs on every checkout.
//
//   * "the extension's peerDependencies stay inside the Host's published set" —
//     moved to the extension's own repository, into `verify-host-pin.mjs`, which
//     runs on every Pro CI run and has no path by which the extension is absent.
//     A Host copy of that check could only ever be a skip or a local-only red.
//
//   * "the extension's vite.config.ts keeps the wide /^@codemirror\// rule" and
//     "the wide range is strictly wider than the allow-list" — the first is
//     Pro's own build config and moved there wholesale. The second was half
//     Pro, half Host; only the Host half is kept below, and it derives its own
//     inputs from Host data instead of from the extension's checkout.

// The half of the subject that is about *packaging*: argument parsing, staging,
// signing, layout and the `.dzx` archive. What the rewriter does to the bundle and
// what the shipped artifact must then prove lives in
// `pack-ep-host-globals.test.ts`.

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

/**
 * The full pack → sign → `.dzx` round trip, plus the artifact-level host-key
 * invariant, on a **synthetic** extension.
 *
 * This is the case that used to run the real Pro build (measured 9.6–13.8s per
 * run). The invariant it guards is entirely about the Host's own pipeline: that
 * whatever the rewriter emits ends up as `__DATAZEN_HOST__` keys the Host table
 * actually publishes, and that no ref survives that the rewriter could not have
 * resolved.
 *
 * The synthetic bundle below imports the shared modules for real, so the key
 * scan has something to find. A fixture whose bundle imported nothing would
 * satisfy every assertion in the block vacuously — `shippedKeys.length` is
 * pinned precisely so that a scanner which quietly stopped matching shows up as
 * a red instead of a pass.
 */
describe('pack-ep end-to-end on a synthetic EP', () => {
  it('builds, signs, writes .dzx, and every shipped host key is published', () => {
    const src = join(tmpdir(), `pack-ep-synth-src-${Date.now()}`);
    const outDir = join(tmpdir(), `pack-ep-synth-out-${Date.now()}`);
    mkdirSync(outDir, { recursive: true });
    writeFixtureExtension(src, SYNTHETIC_BUNDLE);

    const result = packEp({
      extension: 'fixture-ep',
      extensionDir: src,
      mode: 'dzx',
      outDir,
      skipBuild: true,
      log: () => {},
    });

    expect(result.dzxPath).toMatch(/fixture-ep-.*\.dzx$/);
    expect(existsSync(result.dzxPath!)).toBe(true);

    const entries = unzipSync(readFileSync(result.dzxPath!));
    expect(Object.keys(entries)).toEqual(
      expect.arrayContaining(['manifest.json', 'dist/index.esm.js', 'signature.sig']),
    );

    // Read back out of the archive, not out of the staging directory: the
    // artifact is what ships, and a staging-only check is blind to everything
    // that happens between staging and the zip.
    const shippedBundle = Buffer.from(entries['dist/index.esm.js']).toString('utf8');
    const shippedKeys = collectHostGlobalKeys(shippedBundle);
    const published = new Set(readHostGlobalTableKeys());
    expect(shippedKeys.filter((key) => !published.has(key))).toEqual([]);
    expect(shippedKeys.filter((key) => !HOST_SHARED_MODULES.includes(key))).toEqual([]);
    expect(shippedKeys.length).toBeGreaterThan(0);
    expect(countUnverifiableHostRefs(shippedBundle)).toBe(0);

    // The synthetic inputs must actually have been rewritten, or the key scan
    // above is measuring an artifact the rewriter never touched.
    expect(shippedBundle).not.toContain("from '@codemirror/");
    expect(shippedBundle).toContain(HOST_GLOBAL_NAME);

    rmSync(outDir, { recursive: true, force: true });
  });
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
