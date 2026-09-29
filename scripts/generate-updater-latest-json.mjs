#!/usr/bin/env node
/**
 * Build a Tauri v2 updater manifest (`latest*.json`) from one SKU's release assets.
 *
 * Every release SKU gets its own manifest, because the Tauri updater resolves an
 * entry by *platform* only and has no notion of SKU: with a single manifest, an
 * `-all` / `-akulaku` install would be handed Basic's bundle and silently lose
 * every driver Basic does not ship. The SKU list, manifest names and platform
 * sets live in `scripts/release-variants.mjs`.
 *
 * Expects a directory of renamed artifacts (see the release workflow's
 * "Rename artifacts with canonical names" step), including updater bundles and
 * their matching `.sig` files:
 *   - darwin-aarch64: *-macos-arm64[-<variant>].tar.gz
 *   - darwin-x86_64:  *-macos-x64[-<variant>].tar.gz
 *   - windows-x86_64: *-windows-x64[-<variant>].exe (NSIS)
 *   - linux-x86_64:   *-x86_64[-<variant>].AppImage (AppImage catalog naming:
 *                     no platform segment, arch spelled x86_64 — see the
 *                     release.yml rename step)
 *
 * Usage:
 *   node scripts/generate-updater-latest-json.mjs \
 *     --assets-dir ./assets \
 *     --version 0.0.9 \
 *     --tag v0.0.9 \
 *     --repo flyxl/datazen \
 *     --variant all \
 *     --out ./latest-all.json
 *
 * `--out` defaults to the SKU's manifest name, and `--variant` defaults to
 * `basic` (the historical behaviour).
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  artifactSuffixForVariant,
  manifestNameForVariant,
  normalizeVariant,
  platformsForVariant,
} from './release-variants.mjs';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return fallback;
}

/**
 * How each Tauri platform key is named in the canonical asset set:
 * `DataZen-{version}-{stem}{variantSuffix}.{ext}`, where `stem` already carries
 * the OS and arch labels the rename step emits. Linux AppImages have no OS
 * segment (AppImage catalog naming: "linux" in the name is rejected), so their
 * stem is the arch alone.
 */
const PLATFORM_ARTIFACTS = {
  'darwin-aarch64': { stem: 'macos-arm64', ext: 'tar.gz' },
  'darwin-x86_64': { stem: 'macos-x64', ext: 'tar.gz' },
  'windows-x86_64': { stem: 'windows-x64', ext: 'exe' },
  'linux-x86_64': { stem: 'x86_64', ext: 'AppImage' },
};

const variant = normalizeVariant(arg('variant', 'basic'));
const manifestName = manifestNameForVariant(variant);
if (!manifestName) {
  console.error(
    `Release variant "${variant}" has no updater channel, so it publishes no manifest. ` +
      'See scripts/release-variants.mjs.',
  );
  process.exit(1);
}

const assetsDir = path.resolve(arg('assets-dir', 'assets'));
const version = String(arg('version', '')).replace(/^v/, '');
const tag = arg('tag', version ? `v${version}` : '');
const repo = arg('repo', 'flyxl/datazen');
const outPath = path.resolve(arg('out', manifestName));
const notes = arg('notes', '');
const variantSuffix = artifactSuffixForVariant(variant);

if (!version || !tag) {
  console.error('Missing --version and/or --tag');
  process.exit(1);
}
if (!fs.existsSync(assetsDir)) {
  console.error(`Assets dir not found: ${assetsDir}`);
  process.exit(1);
}

const files = fs.readdirSync(assetsDir).filter((f) => !f.startsWith('.'));

/**
 * Match the artifact for one platform key of *this* SKU.
 *
 * The suffix test is exact on purpose: a loose `endsWith('macos-arm64.tar.gz')`
 * still excludes `...-macos-arm64-all.tar.gz`, but relying on that would make
 * "which SKU did this file come from" a property of the whole asset naming
 * scheme rather than of this SKU's own name. Building the expected tail from the
 * SKU's suffix keeps the two in lockstep with release-variants.mjs.
 */
function pick(key) {
  const spec = PLATFORM_ARTIFACTS[key];
  if (!spec) return null;
  const tail = `-${spec.stem}${variantSuffix}.${spec.ext}`;
  const matches = files.filter((f) => f.endsWith(tail));
  if (matches.length > 1) {
    console.warn(
      `Warning: ${matches.length} artifacts match ${key} (${tail}): ${matches.sort().join(', ')} — using the first`,
    );
  }
  return matches.sort()[0] ?? null;
}

function readSig(bundleName) {
  const sigName = `${bundleName}.sig`;
  const sigPath = path.join(assetsDir, sigName);
  if (!fs.existsSync(sigPath)) {
    throw new Error(`Missing signature for ${bundleName} (expected ${sigName})`);
  }
  return fs.readFileSync(sigPath, 'utf8').trim();
}

function platformUrl(fileName) {
  return `https://github.com/${repo}/releases/download/${tag}/${fileName}`;
}

// The SKU's own platform list is authoritative: akulaku has no Linux leg, and a
// key the build never produces must not appear in (nor be silently dropped from)
// the manifest.
const expectedKeys = platformsForVariant(variant);
const unknownKeys = expectedKeys.filter((key) => !PLATFORM_ARTIFACTS[key]);
if (unknownKeys.length > 0) {
  console.error(
    `Variant "${variant}" declares platform(s) with no known artifact pattern: ${unknownKeys.join(', ')}. ` +
      'Add them to PLATFORM_ARTIFACTS or fix release-variants.mjs.',
  );
  process.exit(1);
}

const platforms = {};
const missing = [];

for (const key of expectedKeys) {
  const file = pick(key);
  if (!file) {
    missing.push(key);
    continue;
  }
  platforms[key] = {
    url: platformUrl(file),
    signature: readSig(file),
  };
}

if (Object.keys(platforms).length === 0) {
  console.error(
    `No updater platforms found for variant "${variant}" in assets. Files: ${files.join(', ')}`,
  );
  process.exit(1);
}

// A partial manifest is worse than none for a variant: `check()` simply finds no
// entry for the missing platform and reports "up to date" forever, so those users
// silently stop receiving updates. Basic keeps the historical warning instead,
// because it is the default channel and a missing leg there must not block the
// release of the others.
if (missing.length) {
  if (variant === 'basic') {
    console.warn(`Warning: missing platforms: ${missing.join(', ')}`);
  } else {
    console.error(
      `Variant "${variant}" is missing updater platform(s): ${missing.join(', ')}. ` +
        'Refusing to publish a partial manifest — fix the build or drop the leg from release-variants.mjs.',
    );
    process.exit(1);
  }
}

const latest = {
  version,
  notes,
  pub_date: new Date().toISOString(),
  // Recorded so a published manifest can be traced back to the SKU that produced
  // it; the Tauri updater ignores unknown top-level fields.
  variant,
  platforms,
};

fs.writeFileSync(outPath, `${JSON.stringify(latest, null, 2)}\n`);
console.log(
  `Wrote ${outPath} for variant "${variant}" with platforms: ${Object.keys(platforms).join(', ')}`,
);
