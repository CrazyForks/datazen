/** @vitest-environment node */
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import {
  BUILD_PROFILE_ENV,
  planCargoArgs,
  planTypecheckCommands,
  readDriverFeatures,
  writeStubFrontend,
} from '../ci-driver-warmup.mjs';

describe('ci-driver-warmup cargo plan', () => {
  it('builds the lib only, with the profile and target the matrix will use', () => {
    // --lib skips the LTO link and the generate_context! macro, both of which
    // are per-variant work this job would throw away.
    const args = planCargoArgs({
      target: 'x86_64-pc-windows-msvc',
      profile: 'ci-release',
      features: ['driver-postgres', 'driver-kiwi'],
    });
    expect(args).toEqual([
      'build',
      '--profile',
      'ci-release',
      '--target',
      'x86_64-pc-windows-msvc',
      '-p',
      'datazen',
      '--lib',
      '--features',
      'driver-postgres,driver-kiwi',
    ]);
    expect(args).not.toContain('--release');
    expect(args.join(' ')).not.toContain('driver-api=');
  });

  it('omits --features when the driver set is empty', () => {
    const args = planCargoArgs({ profile: 'release', target: null, features: [] });
    expect(args).toEqual(['build', '--profile', 'release', '-p', 'datazen', '--lib']);
  });

  it('reads the profile from the environment the workflow sets', () => {
    // Mirrors ci-tauri-build.mjs: same env var, same fallback order.
    expect(BUILD_PROFILE_ENV).toBe('DATAZEN_BUILD_PROFILE');
  });
});

describe('ci-driver-warmup inputs', () => {
  it('reads the resolved driver feature list written by with-driver-inject', () => {
    const root = mkdtempSync(join(tmpdir(), 'datazen-warmup-'));
    writeFileSync(
      join(root, '.driver-features.json'),
      JSON.stringify({ features: ['driver-postgres', 'driver-superset'] }),
    );
    expect(readDriverFeatures(root)).toEqual(['driver-postgres', 'driver-superset']);
  });

  it('fails loudly when resolve-drivers has not run', () => {
    const root = mkdtempSync(join(tmpdir(), 'datazen-warmup-'));
    // A silent empty feature set would warm the cache with no drivers at all
    // and leave the matrix compiling cold anyway.
    expect(() => readDriverFeatures(root)).toThrow(/\.driver-features\.json/);
  });

  it('stubs dist/ so the lib build does not need a Vite bundle', () => {
    const root = mkdtempSync(join(tmpdir(), 'datazen-warmup-'));
    const file = writeStubFrontend(root);
    expect(file).toBe(join(root, 'dist', 'index.html'));
    expect(readFileSync(file, 'utf-8')).toContain('warmup stub');
  });
});

describe('ci-driver-warmup typecheck plan', () => {
  it('runs the same codegen as pnpm build, then tsc', () => {
    const root = mkdtempSync(join(tmpdir(), 'datazen-warmup-'));
    const commands = planTypecheckCommands(root).map((c) => c.args.join(' ').replaceAll('\\', '/'));
    expect(commands[0]).toContain('generate-builtin-locales.mjs');
    expect(commands[1]).toContain('generate-menu-labels.mjs');
    expect(commands[2]).toContain('typescript/bin/tsc --noEmit');
    // Invoked through process.execPath so the plan is identical on Windows.
    for (const command of planTypecheckCommands(root)) {
      expect(command.cmd).toBe(process.execPath);
    }
  });
});

describe('upx-compress profile awareness', () => {
  it('finds the binary under a custom cargo profile directory', async () => {
    const { findTargetExecutables } = await import('../upx-compress.mjs');
    const root = mkdtempSync(join(tmpdir(), 'datazen-upx-'));
    const dir = join(root, 'target', 'x86_64-pc-windows-msvc', 'ci-release');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'DataZen.exe'), 'MZ');

    expect(findTargetExecutables(root, 'win32')).toEqual([]);
    expect(findTargetExecutables(root, 'win32', 'release')).toEqual([]);
    expect(findTargetExecutables(root, 'win32', 'ci-release')).toEqual([join(dir, 'DataZen.exe')]);
  });
});
