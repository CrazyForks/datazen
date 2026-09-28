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
    expect(releaseWorkflow).toContain('needs: [prepare-pro-extension, union-typecheck]');
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
  const typecheckJob = releaseWorkflow.slice(
    releaseWorkflow.indexOf('  union-typecheck:'),
    releaseWorkflow.indexOf('  build:'),
  );
  const buildJob = releaseWorkflow.slice(releaseWorkflow.indexOf('  build:'));

  it('no longer gates the matrix behind a driver warmup', () => {
    // A `warm-driver-deps` job compiled the driver union once per target and
    // ran it as a `needs:` barrier ahead of all 11 variant jobs. Measured
    // (runs 36286459429 -> 36300831455) that cost 34:47 -> 56:12 of wall clock
    // and +65 runner-minutes while the variant jobs' heavy steps moved
    // 155:42 -> 156:37, i.e. nothing: all 11 already restored a warm closure
    // from the previous run. See docs/development/ci-test-matrix.md §6.1.
    expect(releaseWorkflow).not.toContain('warm-driver-deps');
    expect(releaseWorkflow).not.toContain('ci-driver-warmup.mjs');
    // Needs is the serialisation point, so it must name only the two jobs that
    // still earn their place ahead of the matrix.
    expect(releaseWorkflow).toContain('needs: [prepare-pro-extension, union-typecheck]');
    // ...and the job must not exist as a `needs:` target of anything either.
    expect(releaseWorkflow).not.toMatch(/^\s*needs:.*warm-driver-deps/m);
  });

  it('still lets the variant jobs write the shared cargo cache', () => {
    // The regression to guard: the warmup used to be the sole writer and every
    // build job carried `save-if: false`. Dropping the warmup without dropping
    // that would have left NO writer at all — the entry would go stale, be
    // evicted after 7 idle days, and every later release would silently go back
    // to a cold compile.
    expect(buildJob).toContain('shared-key: ${{ matrix.target }}');
    expect(buildJob).toContain('cache-workspace-crates: true');
    expect(buildJob).not.toContain('save-if: false');
  });

  it('runs the driver injection inside a clean tree', () => {
    // rust-cache hashes every workspace Cargo.toml, so the cache step must run
    // before with-driver-inject rewrites them.
    const buildCacheIndex = buildJob.indexOf('Cache Rust compilation');
    const buildInjectIndex = buildJob.indexOf('with-driver-inject.mjs');
    expect(buildCacheIndex).toBeGreaterThan(-1);
    expect(buildInjectIndex).toBeGreaterThan(buildCacheIndex);
  });

  it('typechecks the union once, in a job of its own', () => {
    expect(releaseWorkflow).toContain('DATAZEN_CI_TYPECHECK_ONCE:');
    // Once over the union, and on a single runner: the check is target
    // independent. Dropping this job would put `tsc` back inside all 11 variant
    // jobs, which does not shorten the run (every leg grows by T_tsc and the
    // longest leg sets the finish time) but costs 10x T_tsc of runner time and
    // narrows coverage from the union down to per-variant.
    expect(typecheckJob).toContain('union-typecheck:');
    expect(typecheckJob).toContain('--drivers=all,kiwi,superset');
    expect(typecheckJob).toContain('node scripts/ci-union-typecheck.mjs');
    // It gates the build, or a broken union would ship untyped.
    expect(releaseWorkflow).toContain('needs: [prepare-pro-extension, union-typecheck]');
    // The union script must not compile anything — that is what the removed
    // warmup did, and nothing needs it any more. Match code only: a prose
    // comment may legitimately name cargo to explain why it is absent.
    const unionScript = readFileSync(resolve(root, 'scripts/ci-union-typecheck.mjs'), 'utf-8');
    const unionCode = unionScript
      .split('\n')
      .filter((line) => {
        const t = line.trim();
        return !t.startsWith('*') && !t.startsWith('//') && !t.startsWith('/*');
      })
      .join('\n');
    expect(unionCode).not.toMatch(/\bcargo\b/);
    expect(unionCode).not.toContain('--lib');
    expect(unionCode).not.toContain('--target');
    expect(unionCode).not.toContain("spawnSync('cargo'");
    // Local `pnpm build` must keep the typecheck.
    const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
    expect(pkg.scripts.build).toContain('tsc --noEmit');
    expect(pkg.scripts['build:bundle']).not.toContain('tsc --noEmit');
  });

  it('shares one copy of the private git driver SSH setup', () => {
    // kiwi and superset are git drivers, so the union typecheck needs the deploy
    // keys. An inline copy would drift — and a drifted insteadOf surfaces as
    // "repository not found", not as a diff.
    const setupScript = readFileSync(resolve(root, 'scripts/ci-setup-git-drivers.sh'), 'utf-8');
    expect(setupScript).toContain('install_deploy_key KIWI_DEPLOY_KEY kiwi');
    expect(setupScript).toContain('install_deploy_key SUPERSET_DEPLOY_KEY superset');
    const sshStep = 'run: bash scripts/ci-setup-git-drivers.sh';
    expect(typecheckJob).toContain(sshStep);
    expect(typecheckJob).not.toContain('ssh-keyscan');
  });

  it('leaves the build job its own SSH setup, because Pro needs a third key', () => {
    // Deliberately not folded into scripts/ci-setup-git-drivers.sh: that block
    // also installs PRO_DEPLOY_KEY and re-adds insteadOf idempotently, so it is
    // not the same work. Merging it is a Pro-extension change, not a build-time
    // one — do it as its own commit with the Pro path tested.
    expect(buildJob).toContain('PRO_DEPLOY_KEY:');
    expect(buildJob).toContain('ssh-keyscan -t ed25519,rsa github.com');
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
