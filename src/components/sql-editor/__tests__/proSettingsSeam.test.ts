/**
 * Cross-repo seam guard: host settings → EP → **real Pro package** → settings gate.
 *
 * ── Why this file exists ────────────────────────────────────────────────────
 *
 * `foldExtension.ts` documents that `createSqlFoldExtensions` "returns `[]` when
 * `codeFolding` is `false` in the shared settings bag". Before this file, that
 * sentence was enforced **nowhere across the seam**:
 *
 *   - The host suite never *executed* the real Pro package. `createFoldExtensions`
 *     in `proCompartments.ts` is a *host-local* wrapper that happens to share a
 *     name with the Pro's factory; `foldCompartment.test.ts` registers a
 *     hand-written stand-in via `withEnhanced({ createFoldExtensions: spy })`.
 *     (`pack-ep.test.ts` does read the real Pro directory, but only to *build and
 *     sign* it — it asserts the packaging contract and never calls Pro code, and
 *     it skips outright when the checkout is absent.)
 *   - The Pro suite called `createSqlFoldExtensions({ proSettings })` directly,
 *     **bypassing** the EP hop the host actually goes through.
 *
 * So the segment "host settings → EP → Pro's `proFeatures` → `createSqlFoldExtensions`
 * → settings gate" had no real test on *either* side. Changing the Pro factory to
 * `createSqlFoldExtensions()` — dropping the settings bag — kept the Pro suite
 * fully green **and** the host suite fully green, while silently disabling the
 * extension-side half of the gate. That is the same shape as BUG-003: folding once
 * passed two fully green gates while the feature was dead.
 *
 * ── Why it is written the way it is ────────────────────────────────────────
 *
 * *Real on both ends.* The Pro module is loaded from disk by a runtime-resolved
 * dynamic `import()` — deliberately **not** a static import, because
 * `packages/pro-extensions/` is host-`.gitignore`d (`.gitignore:68`) and a static
 * import would make the whole host suite unresolvable in any checkout without the
 * Pro repo. Nothing here is mocked: the Pro's own `createSqlEditorEnhancedFeatures`
 * runs, the host's own `extensionRegistry` / `sqlEditorEnhancedEP` runs, and the
 * host's own `createFoldExtensions` wrapper is the entry point under test.
 *
 * *No silent skip.* If the Pro checkout is missing this file **fails** by default.
 * That is the same rule `packages/extension-points/src/__tests__/security.test.ts`
 * already applies to the Pro manifest, and it is the whole point: a guard that
 * quietly reports success for a seam it never walked reproduces the exact defect
 * it is meant to catch. `DATAZEN_ALLOW_MISSING_PRO=1` is the explicit, greppable
 * acknowledgement for checkouts that legitimately have no Pro repo (the host-only
 * CI checkout is one); it downgrades the failure to a *visible* skip and prints
 * precisely what went uncovered.
 */
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  extensionRegistry,
  sqlEditorEnhancedEP,
  type SqlEditorEnhancedFeatures,
} from '@datazen/extension-points';
import { createFoldExtensions } from '../proCompartments';
import { createFoldCompartmentExtensions, foldSettingEnabled } from '../fold/foldCompartment';

/** Where the Pro checkout lives, relative to the Vitest cwd (the repo root). */
const PRO_FEATURES_ENTRY = 'packages/pro-extensions/sql-editor-pro/src/proFeatures.ts';

const proEntryPath = resolve(process.cwd(), PRO_FEATURES_ENTRY);

/**
 * The shared three-state verdict, produced by `scripts/pro-seam-gate.mjs`.
 *
 * This file used to define "the Pro is here" as `existsSync(<its own entry>)`,
 * i.e. by the very file it consumes. `pack-ep.test.ts` asked a different question
 * (`package.json`) and the gate asked a third, so a Pro directory that was present
 * but incomplete went RED in one guard and became a silent acknowledged skip in
 * the other two — three guards, one opt-out, three verdicts for one checkout.
 * Measured before this change, with `src/proFeatures.ts` deleted and
 * `DATAZEN_ALLOW_MISSING_PRO=1` set: pack-ep 1 failed, gate exit 0, this file
 * `1 passed | 7 skipped`.
 *
 * The verdict is fetched over a process boundary rather than imported, because
 * the root typecheck program has `allowJs: false` and a `.d.mts` would be a
 * fourth, drift-prone copy of the same shape. The JSON is the implementation's
 * own output, so it cannot disagree with the gate or with pack-ep.
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

function readSharedProVerdict(): ProVerdict {
  const script = resolve(process.cwd(), 'scripts/pro-seam-gate.mjs');
  const out = execFileSync(process.execPath, [script, '--verdict', `--root=${process.cwd()}`], {
    encoding: 'utf8',
  });
  const parsed: unknown = JSON.parse(out);
  // Validate the shape instead of asserting a type: a silently reshaped verdict
  // must fail loudly here, not propagate as `undefined` into the gating below.
  if (typeof parsed !== 'object' || parsed === null) throw new Error(`bad verdict: ${out}`);
  const v = parsed as Record<string, unknown>;
  for (const key of [
    'state',
    'present',
    'dir',
    'dirExists',
    'missing',
    'allowMissing',
    'maySkip',
    'mustFail',
  ]) {
    if (!(key in v)) throw new Error(`verdict is missing "${key}": ${out}`);
  }
  if (v.state !== 'absent' && v.state !== 'partial' && v.state !== 'present') {
    throw new Error(`verdict has an unknown state ${String(v.state)}: ${out}`);
  }
  if (!Array.isArray(v.missing)) throw new Error(`verdict "missing" is not an array: ${out}`);
  return v as unknown as ProVerdict;
}

const verdict = readSharedProVerdict();
const proPresent = verdict.present;
const allowMissing = verdict.allowMissing;

const SKIP_REASON =
  `Pro checkout absent (state=${verdict.state}) at ${verdict.dir} — the ` +
  'host→EP→Pro settings seam is UNTESTED and nothing in this file ran.';

/** The real Pro feature set, or `null` when the checkout is absent. */
let proFeatures: SqlEditorEnhancedFeatures | null = null;

beforeAll(async () => {
  if (!proPresent) return;
  // Runtime-resolved specifier: Vite must not statically analyse it, because the
  // path is outside the host's module graph and outside its tsconfig `include`.
  const mod = (await import(/* @vite-ignore */ pathToFileURL(proEntryPath).href)) as {
    createSqlEditorEnhancedFeatures: () => SqlEditorEnhancedFeatures;
  };
  proFeatures = mod.createSqlEditorEnhancedFeatures();
  // The real host registry, holding the real Pro implementation.
  extensionRegistry.register(sqlEditorEnhancedEP, proFeatures);
});

afterAll(() => {
  // The registry is a module-level singleton; leaving a real extension installed
  // would leak into any later test in this file that expects the bare host.
  extensionRegistry.unregister(sqlEditorEnhancedEP);
});

/**
 * Declare a test that needs the real Pro package.
 *
 * Without the checkout it becomes an explicit `it.skip` whose *name* carries the
 * reason, so the skip is visible in the reporter output rather than inferred
 * from a missing line count.
 */
function seamTest(name: string, body: () => void): void {
  if (!proPresent) {
    it.skip(`${name} [SKIPPED — no Pro checkout: ${SKIP_REASON}]`, body);
    return;
  }
  it(name, body);
}

describe('pro settings seam: host → EP → real Pro package → settings gate', () => {
  it('provisions the real Pro package, or says so', () => {
    // The "did the guard actually walk the seam?" check, kept as a real test so
    // the missing-provision case is a named failure rather than an opaque
    // collection error. Skipped only when the absence was explicitly acknowledged.
    if (proPresent) {
      expect(verdict.state).toBe('present');
      expect(verdict.missing).toEqual([]);
      expect(existsSync(proEntryPath)).toBe(true);
      return;
    }
    if (verdict.mustFail) {
      // state=partial — the directory is here but incomplete. NOT acknowledgeable:
      // DATAZEN_ALLOW_MISSING_PRO=1 means "this checkout is knowingly Pro-less",
      // which is false. Before this guard shared the verdict, this branch silently
      // skipped and reported a pass.
      throw new Error(
        `Pro checkout is PRESENT BUT INCOMPLETE at ${verdict.dir} ` +
          `(missing: ${verdict.missing.join(', ')}). The host→EP→Pro seam is ` +
          'UNTESTED and DATAZEN_ALLOW_MISSING_PRO=1 does not apply — it ' +
          'acknowledges a checkout with no Pro, not a broken one. Repair or remove ' +
          'the Pro checkout.',
      );
    }
    expect(
      allowMissing,
      `${SKIP_REASON} Refusing to report a green host gate for a cross-repo seam ` +
        'that was never exercised. Provision the Pro checkout, or re-run with ' +
        'DATAZEN_ALLOW_MISSING_PRO=1 to acknowledge the gap explicitly.',
    ).toBe(true);
  });

  seamTest('loads the real Pro feature set from the checkout on disk', () => {
    // Guards the guard: if this ever resolved to the EP's built-in fallback, a
    // stand-in, or an empty object, every assertion below would be vacuous.
    // ("断言存在" ≠ "断言能失败".)
    //
    // `sqlEditorEnhancedEP`'s frozen `fallbackFeatures` defines no
    // `createFoldExtensions` at all, so the first assertion alone already rules
    // the fallback out; the rest pin that this really is the Pro implementation.
    expect(proFeatures).not.toBe(sqlEditorEnhancedEP.getDefault());
    expect(typeof proFeatures?.createFoldExtensions).toBe('function');
    expect(typeof proFeatures?.createStatementDecorations).toBe('function');
    expect(typeof proFeatures?.createHoverExtensions).toBe('function');
    expect(proFeatures?.settingsContributions?.length).toBeGreaterThan(0);
  });

  seamTest('the Pro contributes the codeFolding setting the host reads', () => {
    // The two ends must agree on *one* flag. If the Pro stopped declaring the
    // key, the host's `proSettingFlag(bag, 'codeFolding')` would silently fall
    // back to `true` and the setting would vanish from the UI with no error.
    const item = (proFeatures?.settingsContributions ?? [])
      .flatMap((c) => c.items ?? [])
      .find((i) => i.key === 'codeFolding');
    expect(item, 'the Pro must still contribute the `codeFolding` setting').toBeDefined();
    expect(foldSettingEnabled({ codeFolding: false })).toBe(false);
    expect(foldSettingEnabled({ codeFolding: true })).toBe(true);
  });

  seamTest('REGRESSION GUARD: the EP entry returns [] when codeFolding is false', () => {
    // THE assertion this file exists for. `createFoldExtensions` is the host's
    // own wrapper in `proCompartments.ts`; it does **not** gate on `codeFolding`
    // (only `createFoldCompartmentExtensions` does, before calling it). So an
    // empty result here can only have come from the Pro's own settings gate —
    // i.e. from the `proSettings` bag surviving the hop.
    //
    // Reverse-injection evidence: replacing
    //   `createSqlFoldExtensions({ proSettings: opts?.proSettings })`
    // with
    //   `createSqlFoldExtensions()`
    // in `packages/pro-extensions/sql-editor-pro/src/proFeatures.ts` turns this
    // red, while the Pro's own suite stays green (it calls
    // `createSqlFoldExtensions` directly and never goes through the EP).
    expect(createFoldExtensions({ proSettings: { codeFolding: false } })).toEqual([]);
  });

  seamTest('the same EP entry installs folding when the key is true', () => {
    // The counterpart of the assertion above, and the reason the guard is not a
    // tautology: the two calls differ only in the bag and only one is empty. If
    // the EP entry ever stopped wiring the bag at all, *both* would be empty and
    // only this one would notice.
    expect(createFoldExtensions({ proSettings: { codeFolding: true } }).length).toBeGreaterThan(0);
  });

  seamTest('folding stays installed when the bag is absent (default-on)', () => {
    // A bag that has not been written yet must not read as "off".
    expect(createFoldExtensions()).not.toEqual([]);
  });

  seamTest('a non-boolean value does not disable folding through the EP either', () => {
    // Mirrors the host gate's rule (`proSettingFlag` falls back on non-boolean).
    // Both readers treat a corrupted bag the same way, so the two cannot drift
    // into a state where the host installs and the extension refuses.
    expect(createFoldExtensions({ proSettings: { codeFolding: 'off' } }).length).toBeGreaterThan(0);
  });

  seamTest('the production entry (host gate → EP) agrees on the same key', () => {
    // `createFoldCompartmentExtensions` is what `SqlEditor.tsx` actually calls. It
    // short-circuits on the host gate *before* reaching the EP, so on this path the
    // Pro gate is defence-in-depth rather than load-bearing — which is exactly why
    // the EP-entry assertions above are the ones that pin the contract. Asserted
    // here so the two ends are known to agree rather than merely hoped to.
    expect(createFoldCompartmentExtensions({ proSettings: { codeFolding: false } })).toEqual([]);
    expect(
      createFoldCompartmentExtensions({ proSettings: { codeFolding: true } }).length,
    ).toBeGreaterThan(0);
  });
});
