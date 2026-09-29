import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import {
  buildSignaturePayload,
  EP_SIGNATURE_ALGORITHM,
  EP_SIGNATURE_VERSION,
  parseSignatureFile,
} from '../signaturePayload';
import {
  checkEngineCompatibility,
  EXTENSION_POINTS_VERSION,
  normalizeTrustedPublicKey,
  OFFICIAL_EP_PUBLIC_KEY_SPKI_B64,
  parseTrustedPublicKeys,
  readAllowUnverifiedFromEnv,
  sha256Hex,
  UNVERIFIED_EXTENSION_LABEL,
  verifyExtensionPackage,
  verifySignatureWithPublicKey,
  type ExtensionManifest,
} from '../security';

/** Test private key (PKCS8 DER base64) — pairs with OFFICIAL_EP_PUBLIC_KEY_SPKI_B64 */
const TEST_EP_PRIVATE_KEY_PKCS8_B64 =
  'MC4CAQAwBQYDK2VwBCIEIPEWEScCcGuvAK1PLiblsaf/hx6x2/oVqUovRkBU/X0N';

const SAMPLE_MANIFEST: ExtensionManifest = {
  id: '@datazen/extension-demo',
  version: '0.0.1',
  main: 'dist/index.esm.js',
  engines: {
    datazen: '>=0.1.2',
    extensionPointsVersion: EXTENSION_POINTS_VERSION,
  },
};

const SAMPLE_BUNDLE = `export function activate() { return 'demo'; }\n`;

function decodeBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
}

/**
 * TS 5.7 made the typed-array buffer type parameterised: `crypto.subtle` still
 * takes `BufferSource` (`ArrayBufferView<ArrayBuffer>`), while `TextEncoder`
 * and `Uint8Array.from` hand back `Uint8Array<ArrayBufferLike>`. Both bytes
 * objects here are really backed by a plain `ArrayBuffer`, so the narrowing is
 * sound and keeps the crypto call sites free of inline casts.
 */
function asBufferSource(bytes: Uint8Array): BufferSource {
  return bytes as Uint8Array<ArrayBuffer>;
}

async function importTestPrivateKey(): Promise<CryptoKey> {
  const der = decodeBase64(TEST_EP_PRIVATE_KEY_PKCS8_B64);
  return crypto.subtle.importKey('pkcs8', asBufferSource(der), { name: 'Ed25519' }, false, [
    'sign',
  ]);
}

async function signFiles(files: Record<string, { sha256: string }>): Promise<string> {
  const payload = buildSignaturePayload(files);
  const privateKey = await importTestPrivateKey();
  const signature = await crypto.subtle.sign('Ed25519', privateKey, asBufferSource(payload));
  return btoa(String.fromCharCode(...new Uint8Array(signature)));
}

async function buildSignedPackage(manifestContent: string, bundleContent: string): Promise<string> {
  const files = {
    'manifest.json': { sha256: await sha256Hex(manifestContent) },
    'dist/index.esm.js': { sha256: await sha256Hex(bundleContent) },
  };
  const signature = await signFiles(files);
  return JSON.stringify(
    {
      version: EP_SIGNATURE_VERSION,
      algorithm: EP_SIGNATURE_ALGORITHM,
      signedAt: new Date().toISOString(),
      files,
      signature,
    },
    null,
    2,
  );
}

describe('EP security gate (security.test.ts)', () => {
  let manifestContent: string;
  let signatureContent: string;

  beforeAll(async () => {
    manifestContent = JSON.stringify(SAMPLE_MANIFEST, null, 2);
    signatureContent = await buildSignedPackage(manifestContent, SAMPLE_BUNDLE);
  });

  it('accepts a valid official signature', async () => {
    const result = await verifyExtensionPackage({
      manifest: SAMPLE_MANIFEST,
      files: {
        manifestContent,
        bundleContent: SAMPLE_BUNDLE,
        signatureContent,
      },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.trustSource).toBe('official');
      expect(result.unverifiedLabel).toBeUndefined();
    }
  });

  it('rejects tampered manifest digest mismatch', async () => {
    const tamperedManifest = manifestContent.replace('"0.0.1"', '"9.9.9"');
    const result = await verifyExtensionPackage({
      manifest: { ...SAMPLE_MANIFEST, version: '9.9.9' },
      files: {
        manifestContent: tamperedManifest,
        bundleContent: SAMPLE_BUNDLE,
        signatureContent,
      },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('tampered');
    }
  });

  it('rejects tampered bundle with valid signature file digests', async () => {
    const result = await verifyExtensionPackage({
      manifest: SAMPLE_MANIFEST,
      files: {
        manifestContent,
        bundleContent: `${SAMPLE_BUNDLE}// tampered`,
        signatureContent,
      },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('tampered');
    }
  });

  it('rejects invalid signature even when developer mode is enabled', async () => {
    const parsed = JSON.parse(signatureContent) as { signature: string };
    const sigBytes = decodeBase64(parsed.signature);
    sigBytes[0] ^= 0xff;
    parsed.signature = btoa(String.fromCharCode(...sigBytes));
    const badSig = JSON.stringify(parsed);
    const result = await verifyExtensionPackage({
      manifest: SAMPLE_MANIFEST,
      files: {
        manifestContent,
        bundleContent: SAMPLE_BUNDLE,
        signatureContent: badSig,
      },
      allowUnsignedExtensions: true,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(['invalid-signature', 'tampered']).toContain(result.code);
    }
  });

  it('allows unsigned extensions in developer mode with unverified label', async () => {
    const result = await verifyExtensionPackage({
      manifest: SAMPLE_MANIFEST,
      files: {
        manifestContent,
        bundleContent: SAMPLE_BUNDLE,
        signatureContent: null,
      },
      allowUnsignedExtensions: true,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.trustSource).toBe('unverified');
      expect(result.unverifiedLabel).toBe(UNVERIFIED_EXTENSION_LABEL);
    }
  });

  it('rejects unsigned extensions when developer mode is off', async () => {
    const result = await verifyExtensionPackage({
      manifest: SAMPLE_MANIFEST,
      files: {
        manifestContent,
        bundleContent: SAMPLE_BUNDLE,
      },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('unsigned-rejected');
    }
  });

  it('accepts extensions signed by enterprise trusted public keys', async () => {
    const enterprise = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']);
    const spki = await crypto.subtle.exportKey('spki', enterprise.publicKey);
    const enterprisePubB64 = btoa(String.fromCharCode(...new Uint8Array(spki)));

    const files = {
      'manifest.json': { sha256: await sha256Hex(manifestContent) },
      'dist/index.esm.js': { sha256: await sha256Hex(SAMPLE_BUNDLE) },
    };
    const payload = buildSignaturePayload(files);
    const signature = await crypto.subtle.sign(
      'Ed25519',
      enterprise.privateKey,
      asBufferSource(payload),
    );
    const enterpriseSig = JSON.stringify({
      version: EP_SIGNATURE_VERSION,
      algorithm: EP_SIGNATURE_ALGORITHM,
      signedAt: new Date().toISOString(),
      files,
      signature: btoa(String.fromCharCode(...new Uint8Array(signature))),
    });

    const result = await verifyExtensionPackage({
      manifest: SAMPLE_MANIFEST,
      files: {
        manifestContent,
        bundleContent: SAMPLE_BUNDLE,
        signatureContent: enterpriseSig,
      },
      trustedPublicKeys: [enterprisePubB64],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.trustSource).toBe('enterprise');
    }
  });

  it('rejects engine version mismatch with safe fallback', async () => {
    const incompatibleManifest: ExtensionManifest = {
      ...SAMPLE_MANIFEST,
      engines: {
        ...SAMPLE_MANIFEST.engines,
        extensionPointsVersion: '99.0.0',
      },
    };
    const incompatibleContent = JSON.stringify(incompatibleManifest, null, 2);

    const result = await verifyExtensionPackage({
      manifest: incompatibleManifest,
      files: {
        manifestContent: incompatibleContent,
        bundleContent: SAMPLE_BUNDLE,
        signatureContent,
      },
      allowUnsignedExtensions: true,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('engine-incompatible');
    }
  });

  it('bypasses signature gate for local directory linking', async () => {
    const result = await verifyExtensionPackage({
      manifest: {
        ...SAMPLE_MANIFEST,
        engines: { extensionPointsVersion: '99.0.0' },
      },
      files: {
        manifestContent: '{}',
        bundleContent: '',
      },
      sourceKind: 'local-link',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.trustSource).toBe('local-dev');
    }
  });

  it('verifySignatureWithPublicKey validates official key round-trip', async () => {
    const files = {
      'manifest.json': { sha256: await sha256Hex('{}') },
      'dist/index.esm.js': { sha256: await sha256Hex('export {}') },
    };
    const signature = await signFiles(files);
    const ok = await verifySignatureWithPublicKey(
      files,
      signature,
      OFFICIAL_EP_PUBLIC_KEY_SPKI_B64,
    );
    expect(ok).toBe(true);
  });

  it('checkEngineCompatibility enforces exact contract version', () => {
    expect(checkEngineCompatibility(SAMPLE_MANIFEST).compatible).toBe(true);
    expect(
      checkEngineCompatibility({
        ...SAMPLE_MANIFEST,
        engines: { extensionPointsVersion: '2.0.0' },
      }).compatible,
    ).toBe(false);
  });

  it('parseTrustedPublicKeys normalizes PEM and raw base64 entries', () => {
    const pem = `-----BEGIN PUBLIC KEY-----\n${OFFICIAL_EP_PUBLIC_KEY_SPKI_B64}\n-----END PUBLIC KEY-----`;
    const keys = parseTrustedPublicKeys([
      { content: OFFICIAL_EP_PUBLIC_KEY_SPKI_B64 },
      { content: pem },
    ]);
    expect(keys).toHaveLength(1);
    expect(keys[0]).toBe(OFFICIAL_EP_PUBLIC_KEY_SPKI_B64);
  });

  it('normalizeTrustedPublicKey strips PEM wrappers', () => {
    const pem = `-----BEGIN PUBLIC KEY-----\n${OFFICIAL_EP_PUBLIC_KEY_SPKI_B64}\n-----END PUBLIC KEY-----`;
    expect(normalizeTrustedPublicKey(pem)).toBe(OFFICIAL_EP_PUBLIC_KEY_SPKI_B64);
  });

  it('readAllowUnverifiedFromEnv reads DATAZEN_ALLOW_UNVERIFIED_EP', () => {
    expect(readAllowUnverifiedFromEnv({})).toBe(false);
    expect(readAllowUnverifiedFromEnv({ DATAZEN_ALLOW_UNVERIFIED_EP: '1' })).toBe(true);
    expect(readAllowUnverifiedFromEnv({ DATAZEN_ALLOW_UNVERIFIED_EP: '0' })).toBe(false);
  });

  it('allows unsigned via DATAZEN_ALLOW_UNVERIFIED_EP env flag', async () => {
    const result = await verifyExtensionPackage({
      manifest: SAMPLE_MANIFEST,
      files: {
        manifestContent,
        bundleContent: SAMPLE_BUNDLE,
      },
      allowUnverifiedEnv: true,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.trustSource).toBe('unverified');
    }
  });

  it('parseSignatureFile rejects malformed and incomplete signature files', () => {
    expect(() => parseSignatureFile('not-json')).toThrow(/malformed JSON/);
    expect(() => parseSignatureFile('null')).toThrow(/expected object/);
    expect(() =>
      parseSignatureFile(
        JSON.stringify({ version: 99, algorithm: 'Ed25519', files: {}, signature: 'x' }),
      ),
    ).toThrow(/unsupported version/);
    expect(() =>
      parseSignatureFile(
        JSON.stringify({ version: 1, algorithm: 'RSA', files: {}, signature: 'x' }),
      ),
    ).toThrow(/unsupported algorithm/);
    expect(() =>
      parseSignatureFile(JSON.stringify({ version: 1, algorithm: 'Ed25519', signature: 'x' })),
    ).toThrow(/missing files/);
    expect(() =>
      parseSignatureFile(
        JSON.stringify({
          version: 1,
          algorithm: 'Ed25519',
          files: { 'manifest.json': { sha256: 'abc' } },
          signature: '',
        }),
      ),
    ).toThrow(/missing signature/);
  });

  it('checkEngineCompatibility rejects manifest without extensionPointsVersion', () => {
    const result = checkEngineCompatibility({ id: 'x', version: '1.0.0' });
    expect(result.compatible).toBe(false);
    if (!result.compatible) {
      expect(result.reason).toContain('missing engines.extensionPointsVersion');
    }
  });

  it('[tester] verifyExtensionPackage maps parseSignatureFile errors to invalid-signature', async () => {
    const result = await verifyExtensionPackage({
      manifest: SAMPLE_MANIFEST,
      files: {
        manifestContent,
        bundleContent: SAMPLE_BUNDLE,
        signatureContent: 'not-json',
      },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('invalid-signature');
      expect(result.reason).toContain('malformed JSON');
    }
  });

  it('[tester] parseSignatureFile rejects invalid digest hex for bundle path', () => {
    expect(() =>
      parseSignatureFile(
        JSON.stringify({
          version: 1,
          algorithm: 'Ed25519',
          files: {
            'manifest.json': { sha256: 'a'.repeat(64) },
            'dist/index.esm.js': { sha256: 'not-valid-hex' },
          },
          signature: 'x',
        }),
      ),
    ).toThrow(/invalid digest for dist\/index\.esm\.js/);
  });

  it('verifyExtensionPackage rejects unknown signer without developer bypass', async () => {
    const foreign = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']);
    const files = {
      'manifest.json': { sha256: await sha256Hex(manifestContent) },
      'dist/index.esm.js': { sha256: await sha256Hex(SAMPLE_BUNDLE) },
    };
    const payload = buildSignaturePayload(files);
    const signature = await crypto.subtle.sign(
      'Ed25519',
      foreign.privateKey,
      asBufferSource(payload),
    );
    const foreignSig = JSON.stringify({
      version: EP_SIGNATURE_VERSION,
      algorithm: EP_SIGNATURE_ALGORITHM,
      signedAt: new Date().toISOString(),
      files,
      signature: btoa(String.fromCharCode(...new Uint8Array(signature))),
    });

    const result = await verifyExtensionPackage({
      manifest: SAMPLE_MANIFEST,
      files: {
        manifestContent,
        bundleContent: SAMPLE_BUNDLE,
        signatureContent: foreignSig,
      },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('invalid-signature');
    }
  });
});

/**
 * The 1.1.0 contract version, pinned from both ends.
 *
 * `checkEngineCompatibility` compares `engines.extensionPointsVersion` to
 * `EXTENSION_POINTS_VERSION` with exact string equality and silently falls
 * back to the community feature set on a mismatch — it does not range-check and
 * it does not warn. A one-sided bump is therefore invisible: either the host
 * rejects the Pro package, or (worse) an old manifest is rejected by a new
 * host, and the failure surfaces as "Pro features quietly stopped working"
 * rather than as an error.
 *
 * ── Why the five cases are split three ways ───────────────────────────────────
 *
 * They do not need the same things, and the split is what makes this file
 * runnable in a host-only checkout without ever reporting a seam it did not
 * walk as green:
 *
 *   - ONE case pins the host constant and reads nothing else.
 *   - TWO cases assert that the two repos AGREE. That claim is meaningless
 *     unless both sides are actually read, so they need the real Pro
 *     `manifest.json` and are gated on the shared verdict.
 *   - TWO cases assert the host's COMPARISON RULE — exact equality, not a
 *     range check. The rule is a pure function of one field, so they are pinned
 *     to a synthetic manifest and run on every checkout, Pro or not.
 *
 * The two groups used to be fused: the last two spread `readProManifest()`, so a
 * checkout without the Pro ENOENTed on a bare `readFileSync` and this file was a
 * FOURTH Pro-dependent guard that consulted neither the shared verdict nor
 * `DATAZEN_ALLOW_MISSING_PRO` — three guards with one opt-out between them, and
 * a fourth that had never heard of it. It now reads the same verdict as the
 * rest, from `scripts/pro-seam-gate.mjs`, which is the single implementation
 * `pack-ep.test.ts` and the CI seam gate also read.
 */

/**
 * The shared three-state verdict, produced by `scripts/pro-seam-gate.mjs`.
 *
 * This file used to answer "is the Pro here?" by opening the very
 * `manifest.json` it wanted to read, and had no answer at all for a Pro
 * directory that exists but is incomplete. It now asks the same question as
 * every other host guard, over a process boundary: the root typecheck program
 * has `allowJs: false`, so a `packages/**` TypeScript file importing the `.mjs`
 * would fail with TS7016, and a hand-written `.d.mts` would be a fourth,
 * drift-prone copy of the same shape. The JSON is the implementation's own
 * output, so it cannot disagree with the gate or with `pack-ep`.
 */
interface ProVerdict {
  state: 'absent' | 'partial' | 'present';
  present: boolean;
  dir: string;
  dirExists: boolean;
  missing: string[];
  allowMissing: boolean;
  maySkip: boolean;
  mustFail: boolean;
}

/** Narrow the parsed verdict to a record, without `any` and without a cast. */
function toVerdictRecord(parsed: unknown, raw: string): Record<string, unknown> {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`pro-seam-gate --verdict did not return a JSON object: ${raw}`);
  }
  const record: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(parsed)) record[key] = value;
  return record;
}

/**
 * Ask `pro-seam-gate.mjs` what it can see of the Pro checkout.
 *
 * Every field is validated rather than assumed: a silently reshaped verdict has
 * to fail loudly here, not propagate as `undefined` into the gating below, where
 * `undefined` reads as "not present" and would turn into a skip.
 */
function readSharedProVerdict(): ProVerdict {
  const script = resolve(process.cwd(), 'scripts/pro-seam-gate.mjs');
  const out = execFileSync(process.execPath, [script, '--verdict', `--root=${process.cwd()}`], {
    encoding: 'utf8',
  });
  const record = toVerdictRecord(JSON.parse(out) as unknown, out);
  const readString = (key: string): string => {
    const value = record[key];
    if (typeof value !== 'string') throw new Error(`verdict "${key}" is not a string: ${out}`);
    return value;
  };
  const readBoolean = (key: string): boolean => {
    const value = record[key];
    if (typeof value !== 'boolean') throw new Error(`verdict "${key}" is not a boolean: ${out}`);
    return value;
  };
  const state = readString('state');
  if (state !== 'absent' && state !== 'partial' && state !== 'present') {
    throw new Error(`verdict has an unknown state "${state}": ${out}`);
  }
  const missingRaw = record.missing;
  if (!Array.isArray(missingRaw)) throw new Error(`verdict "missing" is not an array: ${out}`);
  const missing: string[] = [];
  for (const entry of missingRaw) {
    if (typeof entry !== 'string') throw new Error(`verdict "missing" is not a string[]: ${out}`);
    missing.push(entry);
  }
  return {
    state,
    present: readBoolean('present'),
    dir: readString('dir'),
    dirExists: readBoolean('dirExists'),
    missing,
    allowMissing: readBoolean('allowMissing'),
    maySkip: readBoolean('maySkip'),
    mustFail: readBoolean('mustFail'),
  };
}

/** Decided once per file, from the same implementation every other guard uses. */
const sharedVerdict = readSharedProVerdict();

const PRO_ABSENT_REASON =
  `Pro checkout absent (state=${sharedVerdict.state}) at ${sharedVerdict.dir} — the ` +
  'host↔Pro manifest contract is UNTESTED and nothing in this file read it.';

/**
 * A synthetic stand-in for the Pro `manifest.json`, for the two cases that pin
 * the host's comparison rule rather than the two repos agreeing.
 *
 * Those two cases used to spread the real manifest and override one field, which
 * welded a host-only rule to a cross-repo checkout: without the Pro the file
 * ENOENTed, so the rule the host actually owns was only ever exercised where the
 * Pro happens to be. `checkEngineCompatibility` reads exactly one field,
 * `engines.extensionPointsVersion`, so the surrounding fields are inert here and
 * are modelled on the real manifest's shape. The baseline value tracks
 * `EXTENSION_POINTS_VERSION`, so the fixture can never disagree with the host it
 * is tested against; a one-sided Pro bump is still caught, by the two cases that
 * read the real manifest.
 */
const PRO_MANIFEST_FIXTURE: ExtensionManifest = {
  id: 'sql-editor-pro',
  version: '0.0.0',
  main: 'dist/index.esm.js',
  engines: {
    datazen: '>=0.1.2',
    extensionPointsVersion: EXTENSION_POINTS_VERSION,
  },
};

/**
 * Declare a case that can only mean something with the real Pro manifest.
 *
 * Four outcomes, mirroring `proVerdict()` exactly — this file does not get a
 * second, laxer opinion about what "the Pro is here" means:
 *
 *   present                    → the case runs.
 *   absent  + acknowledged     → `it.skip`, with the reason in the test NAME so
 *                                the gap is visible in the reporter output
 *                                rather than inferred from a line count.
 *   absent  + NOT acknowledged → a real, failing test. The guards are
 *                                fail-by-default so that an unrunnable seam is a
 *                                loud failure, not a quiet green.
 *   partial (mustFail)         → a real, failing test, never waivable. The
 *                                directory is here but incomplete; the opt-out
 *                                means "this checkout knowingly has no Pro",
 *                                which is false here, and honouring it is
 *                                exactly how a broken checkout becomes a green
 *                                skip.
 */
function proManifestTest(name: string, body: () => void): void {
  if (sharedVerdict.mustFail) {
    it(name, () => {
      throw new Error(
        `Pro checkout is PRESENT BUT INCOMPLETE at ${sharedVerdict.dir} ` +
          `(missing: ${sharedVerdict.missing.join(', ')}). The host↔Pro manifest ` +
          'contract is UNREAD and DATAZEN_ALLOW_MISSING_PRO=1 does not apply — it ' +
          'acknowledges a checkout with no Pro, not a broken one. Repair or ' +
          'remove the Pro checkout.',
      );
    });
    return;
  }
  if (!sharedVerdict.present) {
    if (sharedVerdict.allowMissing) {
      it.skip(`${name} [SKIPPED — no Pro checkout: ${PRO_ABSENT_REASON}]`, body);
      return;
    }
    it(name, () => {
      throw new Error(
        `${PRO_ABSENT_REASON} Refusing to report a green host gate for a ` +
          'cross-repo contract that was never read. Provision the Pro checkout, ' +
          'or re-run with DATAZEN_ALLOW_MISSING_PRO=1 to acknowledge the gap ' +
          'explicitly.',
      );
    });
    return;
  }
  it(name, body);
}

describe('EXTENSION_POINTS_VERSION 1.1.0 contract (security.test.ts)', () => {
  // `import.meta.url` is not a file: URL under this Vitest transform, so the
  // manifest is located from the workspace root instead. Vitest runs with cwd
  // at the config root, which is the repository root.
  const PRO_MANIFEST_PATH = resolve(
    process.cwd(),
    'packages/pro-extensions/sql-editor-pro/manifest.json',
  );

  function readProManifest(): ExtensionManifest {
    return JSON.parse(readFileSync(PRO_MANIFEST_PATH, 'utf8')) as ExtensionManifest;
  }

  it('pins the host contract version at 1.1.0', () => {
    expect(EXTENSION_POINTS_VERSION).toBe('1.1.0');
  });

  proManifestTest('the Pro manifest declares the same version', () => {
    // `engines` lives in manifest.json, not package.json.
    expect(readProManifest().engines?.extensionPointsVersion).toBe('1.1.0');
  });

  proManifestTest('the real Pro manifest is compatible with this host', () => {
    const result = checkEngineCompatibility(readProManifest());
    expect(result).toEqual({ compatible: true });
  });

  it('a manifest pinned to the previous 1.0.0 contract is rejected', () => {
    // The failure mode a one-sided bump produces. Asserted explicitly so the
    // exactness of the comparison cannot be quietly relaxed to a range check.
    const result = checkEngineCompatibility({
      ...PRO_MANIFEST_FIXTURE,
      engines: { ...PRO_MANIFEST_FIXTURE.engines, extensionPointsVersion: '1.0.0' },
    });
    expect(result.compatible).toBe(false);
    if (!result.compatible) {
      expect(result.reason).toContain('1.0.0');
    }
  });

  it('a minor mismatch is rejected too — there is no semver range', () => {
    // '1.2.0' would satisfy a caret range on a 1.1.0 host, but this gate is
    // exact equality on purpose: the hook surface is not negotiated at runtime.
    expect(
      checkEngineCompatibility({
        ...PRO_MANIFEST_FIXTURE,
        engines: { ...PRO_MANIFEST_FIXTURE.engines, extensionPointsVersion: '1.2.0' },
      }).compatible,
    ).toBe(false);
  });
});
