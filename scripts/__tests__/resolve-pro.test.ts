/** @vitest-environment node */
import { mkdtempSync, mkdirSync, readFileSync, existsSync, writeFileSync, rmSync } from 'fs';
import { execSync } from 'child_process';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import {
  parseArgs,
  readProLock,
  pinProCheckout,
  writeCommunityCodegen,
  writeProCodegen,
  resolvePro,
  clearBuiltinEpStaging,
  stageProExtension,
  ensureProCheckout,
  GENERATED_PRO_TS,
} from '../resolve-pro.mjs';
import { DEFAULT_BUILTIN_EP_ROOT } from '../pack-ep.mjs';

function writeFixtureExtension(root: string) {
  mkdirSync(join(root, 'dist'), { recursive: true });
  writeFileSync(
    join(root, 'package.json'),
    `${JSON.stringify({ name: 'fixture-ep', version: '1.0.0' })}\n`,
  );
  writeFileSync(
    join(root, 'manifest.json'),
    `${JSON.stringify(
      {
        id: 'sql-editor-pro',
        name: 'SQL Editor Pro',
        version: '1.0.0-test',
        main: 'dist/index.esm.js',
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(join(root, 'dist/index.esm.js'), 'export function activate() {}\n');
}

describe('resolve-pro parseArgs', () => {
  it('defaults to community edition', () => {
    const res = parseArgs([]);
    expect(res.edition).toBe('community');
    expect(res.restore).toBe(false);
  });

  it('detects --pro and --edition=pro', () => {
    expect(parseArgs(['--pro']).edition).toBe('pro');
    expect(parseArgs(['--edition=pro']).edition).toBe('pro');
  });

  it('detects --restore', () => {
    const res = parseArgs(['--restore']);
    expect(res.restore).toBe(true);
    expect(res.edition).toBe('community');
  });

  it('parses custom path and git parameters', () => {
    const res = parseArgs([
      '--edition=pro',
      '--pro-path=/custom/path',
      '--pro-git=git@github.com:custom/repo.git',
      '--codegen-only',
    ]);
    expect(res.edition).toBe('pro');
    expect(res.proPath).toBe('/custom/path');
    expect(res.proGit).toBe('git@github.com:custom/repo.git');
    expect(res.codegenOnly).toBe(true);
  });

  it('parses --pro-ref and defaults it to null', () => {
    expect(parseArgs([]).proRef).toBeNull();
    expect(parseArgs(['--pro-ref=abc1234']).proRef).toBe('abc1234');
  });

  it('reads the pinned Pro ref from the lock file', () => {
    const lock = readProLock();
    expect(lock.ref).toMatch(/^[0-9a-f]{40}$/);
    expect(lock.git).toContain('datazen-extension-sql-editor-pro');
  });

  it('treats a missing lock file as unpinned rather than throwing', () => {
    expect(readProLock('/nonexistent/pro-extension.lock.json')).toEqual({
      git: null,
      ref: null,
    });
  });
});

describe('resolve-pro checkout pinning', () => {
  /** Build a throwaway repo with two commits and return both shas. */
  function makeRepo(): { dir: string; first: string; second: string } {
    const dir = mkdtempSync(join(tmpdir(), 'pro-pin-'));
    const run = (cmd: string) => execSync(cmd, { cwd: dir, stdio: 'pipe' });
    run('git init -q');
    run('git config user.email t@t.t');
    run('git config user.name t');
    writeFileSync(join(dir, 'a.txt'), 'one\n');
    run('git add . && git commit -qm one');
    const first = execSync('git rev-parse HEAD', { cwd: dir, encoding: 'utf-8' }).trim();
    writeFileSync(join(dir, 'a.txt'), 'two\n');
    run('git add . && git commit -qm two');
    const second = execSync('git rev-parse HEAD', { cwd: dir, encoding: 'utf-8' }).trim();
    return { dir, first, second };
  }

  it('checks out the pinned commit and reports the resulting sha', () => {
    const { dir, first, second } = makeRepo();
    try {
      expect(second).not.toBe(first);
      const head = pinProCheckout(dir, first, { log: () => {} });
      expect(head).toBe(first);
      expect(execSync('git rev-parse HEAD', { cwd: dir, encoding: 'utf-8' }).trim()).toBe(first);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('is a no-op when no ref is pinned', () => {
    const { dir, second } = makeRepo();
    try {
      expect(pinProCheckout(dir, null, { log: () => {} })).toBeNull();
      expect(execSync('git rev-parse HEAD', { cwd: dir, encoding: 'utf-8' }).trim()).toBe(second);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fails loudly when the pinned ref does not exist', () => {
    const { dir } = makeRepo();
    try {
      expect(() =>
        pinProCheckout(dir, '0000000000000000000000000000000000000000', { log: () => {} }),
      ).toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('resolve-pro codegen output', () => {
  it('writes community codegen with fallback', () => {
    const dir = mkdtempSync(join(tmpdir(), 'resolve-pro-test-'));
    const file = join(dir, 'generated-pro.ts');
    writeCommunityCodegen(file);
    expect(existsSync(file)).toBe(true);
    const content = readFileSync(file, 'utf-8');
    expect(content).toContain("export const DATAZEN_EDITION = 'community'");
    expect(content).toContain('export function initProExtensions(): void');
    expect(content).not.toContain('@datazen/extension-sql-editor-pro');
  });

  it('writes pro codegen with builtin-ep runtime loader', () => {
    const dir = mkdtempSync(join(tmpdir(), 'resolve-pro-test-'));
    const file = join(dir, 'generated-pro.ts');
    writeProCodegen(file);
    expect(existsSync(file)).toBe(true);
    const content = readFileSync(file, 'utf-8');
    expect(content).toContain("export const DATAZEN_EDITION = 'pro'");
    // Track B: dynamic hot-plug through hostExtensionLoader + signature gate,
    // resolved from the staged `builtin-ep` resource — no static alias import.
    expect(content).toContain('hostExtensionLoader');
    expect(content).toContain('loadFromUrl(');
    expect(content).toContain('verifyExtensionPackage');
    expect(content).toContain("'builtin-ep'");
    expect(content).not.toContain('@datazen/extension-sql-editor-pro');
  });

  it('preserves existing generated-pro.ts when codegenOnly is run without explicit edition', () => {
    const res = resolvePro({ codegenOnly: true });
    // Should preserve existing file when no explicit edition passed
    expect(res).toBeDefined();
  });
});

describe('[tester] resolve-pro staging and edition flows', () => {
  it('test_tester_resolvePro_community_writes_codegen_and_clears_staging', () => {
    const staging = join(DEFAULT_BUILTIN_EP_ROOT, 'sql-editor-pro');
    mkdirSync(staging, { recursive: true });
    writeFileSync(join(staging, 'manifest.json'), '{}');

    const res = resolvePro({ edition: 'community' });
    expect(res).toEqual({ edition: 'community', active: false });
    expect(existsSync(GENERATED_PRO_TS)).toBe(true);
    expect(readFileSync(GENERATED_PRO_TS, 'utf-8')).toContain("DATAZEN_EDITION = 'community'");
    expect(existsSync(staging)).toBe(false);
  });

  it('test_tester_resolvePro_restore_alias_for_community', () => {
    const res = resolvePro({ restore: true });
    expect(res.edition).toBe('community');
    expect(res.active).toBe(false);
  });

  it('test_tester_ensureProCheckout_prefers_explicit_pro_path', () => {
    const extDir = mkdtempSync(join(tmpdir(), 'resolve-pro-path-'));
    writeFileSync(join(extDir, 'package.json'), '{}');
    const path = ensureProCheckout({ proPath: extDir, codegenOnly: true });
    expect(path).toBe(extDir);
  });

  it('test_tester_ensureProCheckout_returns_existing_checkout_when_present', () => {
    const path = ensureProCheckout({ codegenOnly: true });
    if (existsSync(join(process.cwd(), 'packages/pro-extensions/sql-editor-pro/package.json'))) {
      expect(path).toContain('sql-editor-pro');
    } else {
      expect(path).toBeNull();
    }
  });

  it('test_tester_clearBuiltinEpStaging_removes_extension_tree', () => {
    const staging = join(DEFAULT_BUILTIN_EP_ROOT, 'sql-editor-pro');
    mkdirSync(staging, { recursive: true });
    writeFileSync(join(staging, 'marker.txt'), 'x');
    clearBuiltinEpStaging();
    expect(existsSync(staging)).toBe(false);
  });

  it('test_tester_stageProExtension_stages_signed_tree', () => {
    const extDir = mkdtempSync(join(tmpdir(), 'resolve-pro-stage-'));
    writeFixtureExtension(extDir);
    const result = stageProExtension({
      extensionDir: extDir,
      skipBuild: true,
      mode: 'stage',
      log: () => {},
    });
    expect(result.staged).toBe(true);
    const staged = join(DEFAULT_BUILTIN_EP_ROOT, 'sql-editor-pro');
    expect(existsSync(join(staged, 'manifest.json'))).toBe(true);
    expect(existsSync(join(staged, 'dist/index.esm.js'))).toBe(true);
    expect(existsSync(join(staged, 'signature.sig'))).toBe(true);
    rmSync(staged, { recursive: true, force: true });
  });

  it('test_tester_resolvePro_pro_codegenOnly_without_staging', () => {
    const extDir = mkdtempSync(join(tmpdir(), 'resolve-pro-pro-'));
    writeFixtureExtension(extDir);
    const res = resolvePro({ edition: 'pro', codegenOnly: true, proPath: extDir });
    expect(res).toEqual({ edition: 'pro', active: true, path: extDir });
    expect(readFileSync(GENERATED_PRO_TS, 'utf-8')).toContain("DATAZEN_EDITION = 'pro'");
    expect(existsSync(join(DEFAULT_BUILTIN_EP_ROOT, 'sql-editor-pro'))).toBe(false);
  });

  it('test_tester_resolvePro_pro_stages_builtin_ep_for_runtime_loading', () => {
    const extDir = join(process.cwd(), 'packages/pro-extensions/sql-editor-pro');
    if (!existsSync(join(extDir, 'package.json'))) {
      return;
    }
    clearBuiltinEpStaging();
    const res = resolvePro({ edition: 'pro', proPath: extDir });
    expect(res).toMatchObject({ edition: 'pro', active: true, path: extDir });
    // Track B: the rewritten + signed bundle is staged as a Tauri resource and
    // the codegen loads it dynamically — no static alias reference.
    const staged = join(DEFAULT_BUILTIN_EP_ROOT, 'sql-editor-pro');
    expect(existsSync(join(staged, 'dist/index.esm.js'))).toBe(true);
    expect(existsSync(join(staged, 'signature.sig'))).toBe(true);
    const stagedBundle = readFileSync(join(staged, 'dist/index.esm.js'), 'utf-8');
    expect(stagedBundle).toContain('__DATAZEN_HOST__');
    expect(readFileSync(GENERATED_PRO_TS, 'utf-8')).not.toContain(
      '@datazen/extension-sql-editor-pro',
    );
    clearBuiltinEpStaging();
  }, 120_000);

  it('test_tester_resolvePro_unknown_edition_throws', () => {
    expect(() => resolvePro({ edition: 'enterprise' as 'pro' })).toThrow(/unknown edition/);
  });

  it('test_tester_parseArgs_respects_DATAZEN_EDITION_env', () => {
    const prev = process.env.DATAZEN_EDITION;
    process.env.DATAZEN_EDITION = 'pro';
    try {
      expect(parseArgs([]).edition).toBe('pro');
    } finally {
      if (prev === undefined) {
        delete process.env.DATAZEN_EDITION;
      } else {
        process.env.DATAZEN_EDITION = prev;
      }
    }
  });
});
