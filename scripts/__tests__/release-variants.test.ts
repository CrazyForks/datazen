/** @vitest-environment node */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_VARIANT,
  RELEASE_VARIANTS,
  VARIANT_NAMES,
  artifactSuffixForVariant,
  hasUpdaterChannel,
  manifestNameForVariant,
  manifestUrlForVariant,
  normalizeVariant,
  platformsForVariant,
  variantConfig,
} from '../release-variants.mjs';

describe('normalizeVariant', () => {
  it('keeps canonical SKU names', () => {
    expect(normalizeVariant('basic')).toBe('basic');
    expect(normalizeVariant('all')).toBe('all');
    expect(normalizeVariant('akulaku')).toBe('akulaku');
  });

  it('accepts the matrix variant_suffix spelling with a leading hyphen', () => {
    // matrix.variant_suffix is part of the *artifact* name ("-all"), not the SKU
    // name, so both spellings must land on the same channel.
    expect(normalizeVariant('-all')).toBe('all');
    expect(normalizeVariant('-akulaku')).toBe('akulaku');
  });

  it('falls back to the safe default for missing or empty values', () => {
    // 'custom' is the direction that loses auto-update rather than handing a
    // build someone else's manifest.
    expect(normalizeVariant(null)).toBe(DEFAULT_VARIANT);
    expect(normalizeVariant(undefined)).toBe(DEFAULT_VARIANT);
    expect(normalizeVariant('')).toBe(DEFAULT_VARIANT);
    expect(normalizeVariant('-')).toBe(DEFAULT_VARIANT);
    expect(DEFAULT_VARIANT).toBe('custom');
  });

  it('lowercases and trims', () => {
    expect(normalizeVariant('  ALL ')).toBe('all');
  });

  it('passes unknown SKUs through instead of guessing a channel', () => {
    expect(normalizeVariant('acme')).toBe('acme');
    expect(hasUpdaterChannel('acme')).toBe(false);
    expect(manifestNameForVariant('acme')).toBeNull();
  });
});

describe('release SKU channels', () => {
  it('gives every release SKU its own manifest', () => {
    const names = VARIANT_NAMES.map((v) => RELEASE_VARIANTS[v].manifest);
    expect(names).toEqual(['latest.json', 'latest-all.json', 'latest-akulaku.json']);
    // A shared manifest is the bug: Tauri resolves entries by platform only, so
    // two SKUs pointing at one file means one of them installs the other's build.
    expect(new Set(names).size).toBe(names.length);
  });

  it('keeps Basic on the historical manifest name and platform set', () => {
    // Already-installed Basic builds have this URL compiled in; renaming it
    // would strand every one of them.
    expect(manifestNameForVariant('basic')).toBe('latest.json');
    expect(platformsForVariant('basic')).toEqual([
      'darwin-aarch64',
      'darwin-x86_64',
      'windows-x86_64',
      'linux-x86_64',
    ]);
  });

  it('drops the Linux leg for Akulaku, which builds Windows/macOS only', () => {
    expect(platformsForVariant('akulaku')).toEqual([
      'darwin-aarch64',
      'darwin-x86_64',
      'windows-x86_64',
    ]);
    expect(platformsForVariant('all')).toContain('linux-x86_64');
  });

  it('publishes a channel for every release SKU and none for custom', () => {
    for (const variant of VARIANT_NAMES) {
      expect(hasUpdaterChannel(variant), variant).toBe(true);
      expect(variantConfig(variant)).not.toBeNull();
    }
    expect(hasUpdaterChannel('custom')).toBe(false);
    expect(hasUpdaterChannel(undefined)).toBe(false);
  });

  it('builds absolute release URLs from the manifest name', () => {
    expect(manifestUrlForVariant('all')).toBe(
      'https://github.com/flyxl/datazen/releases/latest/download/latest-all.json',
    );
    expect(manifestUrlForVariant('all', 'acme/fork')).toBe(
      'https://github.com/acme/fork/releases/latest/download/latest-all.json',
    );
    expect(manifestUrlForVariant('custom')).toBeNull();
  });

  it('suffixes artifact names for every SKU except Basic', () => {
    // Canonical scheme: DataZen-{version}-{platform}-{arch}[-{variant}].{ext}
    expect(artifactSuffixForVariant('basic')).toBe('');
    expect(artifactSuffixForVariant('all')).toBe('-all');
    expect(artifactSuffixForVariant('akulaku')).toBe('-akulaku');
    expect(artifactSuffixForVariant('-all')).toBe('-all');
    expect(artifactSuffixForVariant('custom')).toBe('-custom');
  });
});
