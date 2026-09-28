/** @vitest-environment node */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');
const script = resolve(root, 'scripts/generate-updater-latest-json.mjs');

/** Canonical asset names are `DataZen-{version}-{os}-{arch}[-{variant}].{ext}`. */
const VERSION = '9.9.9';

type RunResult = { status: number; stdout: string; stderr: string };

function runGenerator(assetsDir: string, variant: string, out: string): RunResult {
  try {
    const stdout = execFileSync(
      process.execPath,
      [
        script,
        '--assets-dir',
        assetsDir,
        '--version',
        VERSION,
        '--tag',
        `v${VERSION}`,
        '--repo',
        'acme/datazen',
        '--variant',
        variant,
        '--out',
        out,
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    return { status: 0, stdout, stderr: '' };
  } catch (error) {
    const e = error as { status?: number; stdout?: string; stderr?: string };
    return { status: e.status ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

function artifact(dir: string, name: string): void {
  writeFileSync(join(dir, name), 'bundle');
  writeFileSync(join(dir, `${name}.sig`), `sig:${name}`);
}

describe('generate-updater-latest-json per SKU', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'updater-manifest-'));
    // Every SKU's release artifacts live in one asset set (the workflow downloads
    // the whole release), so each manifest must select only its own.
    for (const suffix of ['', '-all', '-akulaku']) {
      artifact(dir, `DataZen-${VERSION}-macos-arm64${suffix}.tar.gz`);
      artifact(dir, `DataZen-${VERSION}-macos-x64${suffix}.tar.gz`);
      artifact(dir, `DataZen-${VERSION}-windows-x64${suffix}.exe`);
    }
    for (const suffix of ['', '-all']) {
      artifact(dir, `DataZen-${VERSION}-linux-x64${suffix}.AppImage`);
    }
    // Non-updater files that share the naming scheme must be ignored.
    writeFileSync(join(dir, `DataZen-${VERSION}-macos-arm64.dmg`), 'dmg');
    writeFileSync(join(dir, `DataZen-${VERSION}-windows-x64-portable.zip`), 'zip');
    writeFileSync(join(dir, `DataZen-${VERSION}-windows-x64-portable-all.zip`), 'zip');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  /** Filename of the URL the manifest points at for one platform key. */
  function fileFor(manifestPath: string, key: string): string {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const url: string = manifest.platforms[key].url;
    return url.slice(url.lastIndexOf('/') + 1);
  }

  it('picks only the SKU’s own artifacts, never a sibling SKU’s', () => {
    // The regression this whole module exists for: with a single manifest an
    // `-all` install was handed Basic's bundle and lost its extra drivers.
    const expectations: Array<[string, Record<string, string>]> = [
      [
        'basic',
        {
          'darwin-aarch64': `DataZen-${VERSION}-macos-arm64.tar.gz`,
          'darwin-x86_64': `DataZen-${VERSION}-macos-x64.tar.gz`,
          'windows-x86_64': `DataZen-${VERSION}-windows-x64.exe`,
          'linux-x86_64': `DataZen-${VERSION}-linux-x64.AppImage`,
        },
      ],
      [
        'all',
        {
          'darwin-aarch64': `DataZen-${VERSION}-macos-arm64-all.tar.gz`,
          'darwin-x86_64': `DataZen-${VERSION}-macos-x64-all.tar.gz`,
          'windows-x86_64': `DataZen-${VERSION}-windows-x64-all.exe`,
          'linux-x86_64': `DataZen-${VERSION}-linux-x64-all.AppImage`,
        },
      ],
      [
        'akulaku',
        {
          'darwin-aarch64': `DataZen-${VERSION}-macos-arm64-akulaku.tar.gz`,
          'darwin-x86_64': `DataZen-${VERSION}-macos-x64-akulaku.tar.gz`,
          'windows-x86_64': `DataZen-${VERSION}-windows-x64-akulaku.exe`,
        },
      ],
    ];

    for (const [variant, expected] of expectations) {
      const out = join(dir, `latest-${variant}.json`);
      const result = runGenerator(dir, variant, out);
      expect(result.status, result.stderr).toBe(0);

      const manifest = JSON.parse(readFileSync(out, 'utf8'));
      expect(manifest.variant).toBe(variant);
      expect(manifest.version).toBe(VERSION);
      expect(Object.keys(manifest.platforms).sort()).toEqual(Object.keys(expected).sort());
      for (const [key, file] of Object.entries(expected)) {
        expect(fileFor(out, key), `${variant}/${key}`).toBe(file);
        expect(manifest.platforms[key].signature).toBe(`sig:${file}`);
      }
    }
  });

  it('omits the Linux leg for Akulaku, which builds no Linux artifact', () => {
    const out = join(dir, 'akulaku.json');
    expect(runGenerator(dir, 'akulaku', out).status).toBe(0);
    const manifest = JSON.parse(readFileSync(out, 'utf8'));
    expect(manifest.platforms['linux-x86_64']).toBeUndefined();
  });

  it('fails instead of publishing a manifest built from another SKU’s assets', () => {
    const basicOnly = mkdtempSync(join(tmpdir(), 'updater-basic-only-'));
    try {
      for (const [name, ext] of [
        [`DataZen-${VERSION}-macos-arm64`, 'tar.gz'],
        [`DataZen-${VERSION}-macos-x64`, 'tar.gz'],
        [`DataZen-${VERSION}-windows-x64`, 'exe'],
        [`DataZen-${VERSION}-linux-x64`, 'AppImage'],
      ]) {
        artifact(basicOnly, `${name}.${ext}`);
      }
      const out = join(basicOnly, 'latest-all.json');
      const result = runGenerator(basicOnly, 'all', out);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('No updater platforms found');
      expect(existsSync(out)).toBe(false);
    } finally {
      rmSync(basicOnly, { recursive: true, force: true });
    }
  });

  it('refuses a partial manifest for a variant, but only warns for Basic', () => {
    // A missing platform makes check() report "up to date" forever for those
    // users, so a variant must fail loudly; Basic is the default channel and
    // keeps publishing the legs that did build.
    const noMac = mkdtempSync(join(tmpdir(), 'updater-no-mac-'));
    try {
      for (const [name, ext] of [
        [`DataZen-${VERSION}-windows-x64-all`, 'exe'],
        [`DataZen-${VERSION}-linux-x64-all`, 'AppImage'],
      ]) {
        artifact(noMac, `${name}.${ext}`);
      }
      const variantOut = join(noMac, 'latest-all.json');
      const variantResult = runGenerator(noMac, 'all', variantOut);
      expect(variantResult.status).not.toBe(0);
      expect(variantResult.stderr).toContain('darwin-aarch64');
      expect(existsSync(variantOut)).toBe(false);

      // Same asset set, Basic recognised as partial-but-publishable.
      const noLinux = mkdtempSync(join(tmpdir(), 'updater-no-linux-'));
      try {
        for (const [name, ext] of [
          [`DataZen-${VERSION}-macos-arm64`, 'tar.gz'],
          [`DataZen-${VERSION}-macos-x64`, 'tar.gz'],
          [`DataZen-${VERSION}-windows-x64`, 'exe'],
        ]) {
          artifact(noLinux, `${name}.${ext}`);
        }
        const basicOut = join(noLinux, 'latest.json');
        const basicResult = runGenerator(noLinux, 'basic', basicOut);
        expect(basicResult.status, basicResult.stderr).toBe(0);
        expect(
          JSON.parse(readFileSync(basicOut, 'utf8')).platforms['linux-x86_64'],
        ).toBeUndefined();
      } finally {
        rmSync(noLinux, { recursive: true, force: true });
      }
    } finally {
      rmSync(noMac, { recursive: true, force: true });
    }
  });

  it('rejects an SKU with no updater channel', () => {
    const out = join(dir, 'latest-custom.json');
    const result = runGenerator(dir, 'custom', out);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('no updater channel');
    expect(existsSync(out)).toBe(false);
  });

  it('fails when a matched bundle has no signature', () => {
    // An unsigned bundle must never reach users: the updater would reject it, and
    // publishing it silently would look like a working release.
    const unsigned = mkdtempSync(join(tmpdir(), 'updater-unsigned-'));
    try {
      const name = `DataZen-${VERSION}-windows-x64.exe`;
      writeFileSync(join(unsigned, name), 'bundle');
      const result = runGenerator(unsigned, 'basic', join(unsigned, 'latest.json'));
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('Missing signature');
    } finally {
      rmSync(unsigned, { recursive: true, force: true });
    }
  });
});

describe('generate-updater-latest-json output naming', () => {
  it('defaults --out to the SKU manifest name', () => {
    const source = readFileSync(script, 'utf8');
    // The release workflow omits --out on purpose so manifest names live only in
    // release-variants.mjs; a hardcoded second list here would be free to drift.
    expect(source).toContain("arg('out', manifestName)");
  });

  it('creates the output directory assumption only for the assets dir', () => {
    // Guard against a regression where a missing assets dir silently yields an
    // empty manifest instead of failing.
    expect(readFileSync(script, 'utf8')).toContain('Assets dir not found');
  });
});
