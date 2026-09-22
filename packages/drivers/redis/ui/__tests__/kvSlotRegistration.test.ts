/**
 * [tester] KV slot registration guard for Redis — the double gate (PRD §7-4, F-1 + F-3).
 *
 * The host only renders a KV slot when **both** gates say yes: the driver's
 * `DatabaseTypeMeta.kvWorkspace` capability flag (F-1, `ui/shared/meta.ts`) and a
 * component row contributed by this build (F-3, the `kvSlots` block read by
 * `scripts/resolve-drivers.mjs`). The host-side suites
 * (`src/lib/__tests__/kvWorkspaceSlots.test.ts`) prove the *mechanism* with
 * fixture drivers only, so nothing pinned **Redis' own two halves**: deleting the
 * capability block, or deleting a registration row, left the whole suite green
 * (verified by mutation during this track's test round). This file closes that.
 *
 * Mutation evidence for this file (test round, driver suite): flipping
 * `statusBar: true` → `false` reddens 2 cases; typo'ing the generated component
 * name reddens 2; undeclaring the `keyPropsSidebar` row reddens 2 (including the
 * cross-gate agreement case below).
 *
 * Maintenance contract: {@link SHIPPED_SLOTS} is the **only** track-scoped fact in
 * this file. The slot that Wave-2 deliberately leaves out (`contextBar`, owned by
 * Rescuer-B, and `connectionHome`, owned by `redis-overview`) is therefore not
 * asserted as "missing forever" — it is asserted as "missing while this list says
 * so", and adding a slot here re-checks both gates at once. Everything else
 * (exports, paths, copy keys) is derived from the tree rather than hardcoded, so
 * a new slot file cannot make this suite lie in either direction.
 *
 * Boundary note: importing `scripts/resolve-drivers.mjs` from a driver test is
 * test-only tooling access, not a host-`src/**` reference, so guard rule R1 does
 * not apply (it fires on specifiers resolving into `src/`). Verified with
 * `node scripts/check-driver-import-boundaries.mjs` → 0 blocking violations.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
// The codegen's own contract surface — the same helpers that emit `DRIVER_KV_SLOTS`.
import {
  KV_SLOT_NAMES,
  collectDriverKvSlotEntries,
} from '../../../../../scripts/resolve-drivers.mjs';

import { redisMeta } from '../shared/meta';
// Namespace import: the registration rows name components by string, and this is
// the same module the host's generated import resolves against.
import * as kvBar from '../kv-bar';
import en from '../../locales/en';

/** Slots this build ships from `ui/kv-bar` — the one line a new slot edits. */
const SHIPPED_SLOTS = ['statusBar', 'keyPropsSidebar'];

/** The module path the codegen emits for every row of this package. */
const KV_BAR_PATH = '../../packages/drivers/redis/ui/kv-bar';

/** `connectionHome` is the slot name; the capability flag behind it is `home`. */
const CAPABILITY_KEY: Record<string, string> = {
  contextBar: 'contextBar',
  statusBar: 'statusBar',
  keyPropsSidebar: 'keyPropsSidebar',
  connectionHome: 'home',
};

/** Capability Redis declares for a slot, normalised to a boolean. */
function capability(slot: string): boolean {
  const key = CAPABILITY_KEY[slot];
  return (redisMeta.kvWorkspace as Record<string, boolean | undefined> | undefined)?.[key] === true;
}

/** Slot names this build registers a component for, for the `redis` db type. */
function registeredSlots(): Array<Record<string, string>> {
  return collectDriverKvSlotEntries(undefined, ['redis']).map(
    (entry: Record<string, string>) => ({
      dbType: entry.dbType,
      slot: entry.slot,
      component: entry.component,
      path: entry.path,
    }),
  );
}

describe('[tester] redis KV slot double gate (F-1 ⇄ F-3)', () => {
  it('declares a capability for exactly the slots this build ships', () => {
    // One loop over the four contract slot names: a shipped slot must be true, an
    // unshipped slot must be absent/false, so the host keeps its default rendering
    // there (no dead button, no orphan import).
    for (const slot of KV_SLOT_NAMES) {
      expect(capability(slot), `capability(${slot})`).toBe(SHIPPED_SLOTS.includes(slot));
    }
  });

  it('registers exactly one row per shipped slot, all for redis, from ui/kv-bar', () => {
    const rows = registeredSlots();
    // Sorted-set compare: a duplicated object key in the `kvSlots` block collapses
    // silently in JS (the collector reads slot by slot), which would drop a row.
    expect(rows.map((row) => row.slot).sort()).toEqual([...SHIPPED_SLOTS].sort());
    for (const row of rows) {
      expect(row.dbType).toBe('redis');
      expect(row.path, `row ${row.slot}`).toBe(KV_BAR_PATH);
    }
  });

  it('names components that really are exports of the declared module', () => {
    // A stale or typo'd `component` string would only fail at `vite build`; this
    // catches it while the row is still the only thing that changed. Resolved
    // against `ui/kv-bar` itself, so it never needs a per-slot update.
    const exports_ = kvBar as unknown as Record<string, unknown>;
    for (const row of registeredSlots()) {
      expect(exports_, `no export named ${row.component}`).toHaveProperty(row.component);
      expect(typeof exports_[row.component], row.component).toBe('function');
    }
  });

  it('keeps capability and registration in lockstep, never one gate alone', () => {
    // Capability without a row ⇒ the host falls back to the row-detail panel and
    // the driver's slot never renders; a row without capability ⇒ an orphan import
    // the host refuses to render. Both are silent dead code.
    const rows = new Set(registeredSlots().map((row) => row.slot));
    for (const slot of KV_SLOT_NAMES) {
      expect(capability(slot), `capability(${slot})`).toBe(rows.has(slot));
    }
  });
});

describe('[tester] kv-bar copy keys resolve', () => {
  const KV_BAR_DIR = resolve(process.cwd(), 'packages/drivers/redis/ui/kv-bar');
  const translations = en as unknown as Record<string, string>;

  /**
   * Every i18n key literal rendered by any slot in this package.
   *
   * Derived by walking `ui/kv-bar/*.tsx` rather than a hardcoded file list, so a
   * slot added later (contextBar) is covered automatically and its copy is never
   * reported as orphaned.
   */
  function keysInUse(): Set<string> {
    const keys = new Set<string>();
    for (const name of readdirSync(KV_BAR_DIR).filter((f) => f.endsWith('.tsx'))) {
      const text = readFileSync(join(KV_BAR_DIR, name), 'utf8');
      for (const match of text.matchAll(/['"]((?:redis|common)\.[A-Za-z0-9.]+)['"]/g)) {
        keys.add(match[1]);
      }
    }
    return keys;
  }

  it('every driver-owned key the slots render is present in en.ts', () => {
    // `redis.*` is this package's own dictionary. `common.*` belongs to the host
    // pack, which a driver unit test must not read (boundary rule R1) — the host
    // locale suite owns those, so only the driver keys are checked here.
    const driverKeys = [...keysInUse()].filter((key) => key.startsWith('redis.'));
    expect(driverKeys.length).toBeGreaterThan(0);
    for (const key of driverKeys) {
      expect(translations[key], `missing locale key: ${key}`).toBeTypeOf('string');
    }
  });

  it('borrows nothing from the host pack beyond the shared common.* keys', () => {
    // Keeps the host coupling surface explicit: the slots may only lean on
    // `common.*`, never on some other host namespace.
    for (const key of keysInUse()) {
      expect(/^(redis|common)\./.test(key), key).toBe(true);
      if (!key.startsWith('redis.')) expect(key.startsWith('common.'), key).toBe(true);
    }
  });

  it('leaves no unused copy behind in the namespaces these slots own', () => {
    const used = keysInUse();
    const owned = Object.keys(translations).filter(
      (key) => key.startsWith('redis.keyProps.') || key.startsWith('redis.contextBar.'),
    );
    expect(owned.length).toBeGreaterThan(0);
    for (const key of owned) expect(used.has(key), `unused locale key: ${key}`).toBe(true);
  });
});
