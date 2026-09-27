/** @vitest-environment node */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');
const releaseWorkflow = readFileSync(resolve(root, '.github/workflows/release.yml'), 'utf8');
const windowsConfig = JSON.parse(
  readFileSync(resolve(root, 'src-tauri/tauri.windows.conf.json'), 'utf8'),
);
const windowsReleaseDocs = [
  '.github/workflows/release.yml',
  'README.md',
  'README.zh-CN.md',
  'docs/development/packaging.md',
  'docs/development/updater.md',
  'site/download.html',
  'site/zh/download.html',
  'site/manual.html',
  'site/zh/manual.html',
];

describe('Windows release packaging', () => {
  it('only asks Tauri to build the NSIS installer on Windows', () => {
    expect(windowsConfig.bundle.targets).toEqual(['nsis']);
  });

  it.each(windowsReleaseDocs)('%s no longer advertises MSI packages', (relativePath) => {
    const contents = readFileSync(resolve(root, relativePath), 'utf8');
    expect(contents).not.toMatch(/\bmsi\b/i);
  });

  it('publishes an installer-free portable archive with runtime resources', () => {
    expect(releaseWorkflow).toContain('Package Windows portable archive');
    // New naming: DataZen-{version}-{osLabel}[-variant]-portable.zip
    expect(releaseWorkflow).toContain('DataZen-$version-$osLabel-portable.zip');
    expect(releaseWorkflow).toContain('Copy-Item -LiteralPath $prompts');
    // Portable includes Pro extension resources
    expect(releaseWorkflow).toContain('builtin-ep');
    expect(releaseWorkflow).toContain('Copy-Item -LiteralPath $builtinEp');
  });

  it('builds Pro edition by default in release workflow and excludes pure community builds', () => {
    // Assert all matrix entries have edition: "pro" and needs_pro: true
    expect(releaseWorkflow).toContain('edition: "pro"');
    expect(releaseWorkflow).toContain('needs_pro: true');
    expect(releaseWorkflow).not.toMatch(/edition:\s*"community"/);
    expect(releaseWorkflow).toMatch(/variant_suffix:\s*"-all"/);
  });

  it('drops Akulaku Linux matrix entries', () => {
    // Akulaku should only have Windows and macOS — no ubuntu / linux
    const akulakuBlock = releaseWorkflow.slice(
      releaseWorkflow.indexOf('# ── Akulaku'),
      releaseWorkflow.indexOf('# ── Akulaku') + 500,
    );
    expect(akulakuBlock).not.toContain('ubuntu-22.04');
    expect(akulakuBlock).not.toContain('linux-x64');
  });

  it('uses canonical artifact naming: DataZen-{Version}-{Platform}-{Arch}[-{Variant}]-{Type}.{ext}', () => {
    expect(releaseWorkflow).toContain('Rename artifacts with canonical names');
    // Canonical name function
    expect(releaseWorkflow).toContain('DataZen-${VERSION}-${PLATFORM}-${ARCH}');
    // Pro verification step checks actual bundled output (.app / deb), not staging dir
    expect(releaseWorkflow).toContain('Verify Pro extension is bundled in app');
    expect(releaseWorkflow).toContain('builtin-ep/sql-editor-pro/dist/index.esm.js');
  });

  it('builds the Pro extension once and shares it with every variant as an artifact', () => {
    // One clone/build/sign for the whole matrix instead of one per variant.
    expect(releaseWorkflow).toContain('prepare-pro-extension');
    expect(releaseWorkflow).toContain(
      'Clone, build and sign the Pro extension at the pinned revision',
    );
    expect(releaseWorkflow).toContain('node scripts/resolve-pro.mjs --edition=pro');
    expect(releaseWorkflow).toContain('actions/upload-artifact@v4');
    expect(releaseWorkflow).toContain('if-no-files-found: error');
    // Every Pro variant consumes that artifact rather than re-cloning the repo.
    expect(releaseWorkflow).toContain('actions/download-artifact@v4');
    expect(releaseWorkflow).toContain('name: pro-extension');
    expect(releaseWorkflow).toContain('needs: [prepare-pro-extension, warm-driver-deps]');
    // The .dzx is packed from the Pro source checkout, so it is produced once in
    // the prepare job too and downloaded by the one variant that ships it.
    expect(releaseWorkflow).toContain('Pack the signed Pro .dzx');
    expect(releaseWorkflow).toContain('Upload the signed Pro .dzx');
    expect(releaseWorkflow).toContain('name: pro-dzx');
    expect(releaseWorkflow).toContain('Download the signed Pro .dzx (Default Pro, once)');
    // pack-ep must run exactly once for the whole workflow — the build jobs no
    // longer hold a Pro checkout to pack from.
    expect(releaseWorkflow.match(/scripts\/pack-ep\.mjs/g)?.length).toBe(1);
    // No PAT: the private Pro repo is reached with the deploy key, so the
    // releases API token and its fallback notices are gone.
    expect(releaseWorkflow).not.toContain('PRO_PREBUILT_TOKEN');
    expect(releaseWorkflow).not.toContain('Download prebuilt Pro extension (fast path)');
    // Verify step emits notices so the next failure is diagnosable from annotations
    expect(releaseWorkflow).toContain('::notice::[pro-verify]');
  });
});

describe('Release build time optimisation', () => {
  const warmupJob = releaseWorkflow.slice(
    releaseWorkflow.indexOf('  warm-driver-deps:'),
    releaseWorkflow.indexOf('  build:'),
  );

  it('compiles the driver union once per target before the variant matrix', () => {
    // all,kiwi,superset is the superset of basic / all / akulaku.
    expect(warmupJob).toContain('--drivers=all,kiwi,superset');
    expect(warmupJob).toContain('node scripts/ci-driver-warmup.mjs --target=${{ matrix.target }}');
    // The union build is the lib only: no per-variant link, no Vite bundle.
    const warmupScript = readFileSync(resolve(root, 'scripts/ci-driver-warmup.mjs'), 'utf-8');
    expect(warmupScript).toContain("'-p', 'datazen', '--lib'");
  });

  it('warms the cache for exactly the targets the matrix builds', () => {
    const warmTargets = [...warmupJob.matchAll(/target: (\S+)/g)].map((m) => m[1]);
    expect(warmTargets).toEqual([
      'x86_64-pc-windows-msvc',
      'aarch64-apple-darwin',
      'x86_64-apple-darwin',
      'x86_64-unknown-linux-gnu',
    ]);
    // Every target the matrix builds must have a warmup leg, or it compiles
    // the driver union cold.
    const buildTargets = new Set(
      [...releaseWorkflow.matchAll(/^\s+target: (\S+)$/gm)].map((m) => m[1]),
    );
    for (const target of buildTargets) {
      expect(warmTargets).toContain(target);
    }
  });

  it('makes the warmup job the only writer of the shared cargo cache', () => {
    // Previously every variant on a target shared one key, so the cache stayed
    // pinned to whichever job saved first (always the cheapest variant).
    expect(warmupJob).toContain('shared-key: ${{ matrix.target }}');
    expect(warmupJob).toContain('cache-workspace-crates: true');
    // The build jobs restore read-only.
    const buildJob = releaseWorkflow.slice(releaseWorkflow.indexOf('  build:'));
    expect(buildJob).toContain('save-if: false');
  });

  it('runs the driver injection inside a clean tree in both jobs', () => {
    // rust-cache hashes every workspace Cargo.toml, so the cache step must run
    // before with-driver-inject rewrites them — otherwise the two jobs compute
    // different keys and never share a cache.
    const cacheIndex = warmupJob.indexOf('Cache Rust compilation');
    const injectIndex = warmupJob.indexOf('with-driver-inject.mjs');
    expect(cacheIndex).toBeGreaterThan(-1);
    expect(injectIndex).toBeGreaterThan(cacheIndex);

    const buildJob = releaseWorkflow.slice(releaseWorkflow.indexOf('  build:'));
    const buildCacheIndex = buildJob.indexOf('Cache Rust compilation');
    const buildInjectIndex = buildJob.indexOf('with-driver-inject.mjs');
    expect(buildCacheIndex).toBeGreaterThan(-1);
    expect(buildInjectIndex).toBeGreaterThan(buildCacheIndex);
  });

  it('typechecks the union once instead of once per variant', () => {
    expect(releaseWorkflow).toContain('DATAZEN_CI_TYPECHECK_ONCE:');
    expect(warmupJob).toContain('--typecheck');
    // Local `pnpm build` must keep the typecheck.
    const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
    expect(pkg.scripts.build).toContain('tsc --noEmit');
    expect(pkg.scripts['build:bundle']).not.toContain('tsc --noEmit');
  });

  it('builds the release profile and no longer selects a custom one', () => {
    // tauri-cli 2.10.1 has no `--profile` flag, so a custom Cargo profile is
    // unreachable through `tauri build`. Release run 36298158059 set
    // DATAZEN_BUILD_PROFILE=ci-release and every one of the 11 build jobs died
    // in under a second: `error: unexpected argument '--profile' found`, exit 2.
    expect(releaseWorkflow).not.toMatch(/DATAZEN_BUILD_PROFILE/);
    // Match command lines only — a prose comment may legitimately name the
    // flag to explain why it is absent.
    const workflowCommands = releaseWorkflow
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('#'))
      .join('\n');
    expect(workflowCommands).not.toMatch(/--profile/);
    // Cargo.toml must not keep a profile the build can no longer select.
    const cargoToml = readFileSync(resolve(root, 'Cargo.toml'), 'utf8');
    expect(cargoToml).not.toMatch(/\[profile\.ci-release\]/);

    // Bundle discovery and the UPX scan must read the directory the build
    // really writes. Now that the env var is gone the dir is spelled out, and
    // the regression to guard is an interpolation that collapses to `target//`.
    expect(releaseWorkflow).toContain('target/${{ matrix.target }}/release/bundle');
    expect(releaseWorkflow).not.toMatch(/\$\{\{ env\.DATAZEN_BUILD_PROFILE \}\}/);
  });

  it('serialises releases so a re-pushed tag does not double the compile', () => {
    expect(releaseWorkflow).toMatch(/^concurrency:/m);
    expect(releaseWorkflow).toContain('group: release-${{ github.ref }}');
  });
});
