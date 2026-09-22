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
 * It also pins the deliberate Wave-2 split: `contextBar` and `connectionHome`
 * stay undeclared on both gates, which is what keeps the host's default
 * rendering (no dead button, no orphan import) until the owning track lands.
 *
 * Boundary note: importing `scripts/resolve-drivers.mjs` from a driver test is
 * test-only tooling access, not a host-`src/**` reference, so guard rule R1 does
 * not apply (it fires on specifiers resolving into `src/`).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
// The codegen's own contract surface — the same helpers that emit `DRIVER_KV_SLOTS`.
import {
  KV_SLOT_NAMES,
  collectDriverKvSlotEntries,
} from '../../../../../scripts/resolve-drivers.mjs';

import { redisMeta } from '../shared/meta';
import { RedisKeyPropsSidebar, RedisKvStatusBar } from '../kv-bar';
import en from '../../locales/en';

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

describe('[tester] redis kvWorkspace capability (gate 1, F-1)', () => {
  it('declares exactly the two surfaces this track ships', () => {
    expect(redisMeta.kvWorkspace).toEqual({ statusBar: true, keyPropsSidebar: true });
  });

  it('leaves contextBar and connectionHome undeclared (host keeps default rendering)', () => {
    expect(capability('contextBar')).toBe(false);
    expect(capability('connectionHome')).toBe(false);
  });
});

describe('[tester] redis kvSlots registration (gate 2, F-3)', () => {
  it('emits exactly two rows, both for redis, from ui/kv-bar', () => {
    expect(registeredSlots()).toEqual([
      {
        dbType: 'redis',
        slot: 'statusBar',
        component: 'RedisKvStatusBar',
        path: '../../packages/drivers/redis/ui/kv-bar',
      },
      {
        dbType: 'redis',
        slot: 'keyPropsSidebar',
        component: 'RedisKeyPropsSidebar',
        path: '../../packages/drivers/redis/ui/kv-bar',
      },
    ]);
  });

  it('names components that actually exist as exports of the declared module', () => {
    // A stale or typo'd `component` name would only fail at `vite build`; this
    // catches it while the row is still the only thing that changed.
    const byName: Record<string, unknown> = { RedisKvStatusBar, RedisKeyPropsSidebar };
    for (const row of registeredSlots()) {
      expect(typeof byName[row.component], row.component).toBe('function');
    }
  });

  it('contributes nothing for the slots this track does not ship', () => {
    const slots = registeredSlots().map((row) => row.slot);
    expect(slots).not.toContain('contextBar');
    expect(slots).not.toContain('connectionHome');
  });
});

describe('[tester] double gate agreement (F-1 ⇄ F-3)', () => {
  it('capability and registration are set for the same slots, never one alone', async () => {
    // Capability without a row ⇒ the host falls back to the row-detail panel and
    // the driver's slot never renders; a row without capability ⇒ an orphan
    // import the host refuses to render. Both are silent dead code.
    for (const slot of KV_SLOT_NAMES) {
      expect(capability(slot), `capability(${slot})`).toBe(
        registeredSlots().some((row) => row.slot === slot),
        `registered(${slot})`,
      );
    }
  });

  it('never registers a slot for a db type other than redis', () => {
    for (const row of registeredSlots()) expect(row.dbType).toBe('redis');
  });
});

describe('[tester] kv-bar copy keys resolve', () => {
  const SOURCES = [
    'packages/drivers/redis/ui/kv-bar/KvStatusBar.tsx',
    'packages/drivers/redis/ui/kv-bar/KeyPropsSidebar.tsx',
  ];
  const translations = en as unknown as Record<string, string>;

  /** Every i18n key literal rendered by the two slots. */
  function keysInUse(): Set<string> {
    const keys = new Set<string>();
    for (const rel of SOURCES) {
      const text = readFileSync(resolve(process.cwd(), rel), 'utf8');
      for (const match of text.matchAll(/['"]((?:redis|common)\.[A-Za-z0-9.]+)['"]/g)) {
        keys.add(match[1]);
      }
    }
    return keys;
  }

  it('every driver-owned key the two slots render is present in en.ts', () => {
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
    // Keeps the host coupling surface explicit: two slots may only lean on
    // `common.*`, never on some other host namespace.
    for (const key of keysInUse()) {
      expect(/^(redis|common)\./.test(key), key).toBe(true);
      if (!key.startsWith('redis.')) expect(key.startsWith('common.'), key).toBe(true);
    }
  });

  it('leaves no unused copy behind in the two namespaces it owns', () => {
    const used = keysInUse();
    const owned = Object.keys(translations).filter(
      (key) => key.startsWith('redis.keyProps.') || key.startsWith('redis.contextBar.'),
    );
    expect(owned.length).toBeGreaterThan(0);
    for (const key of owned) expect(used.has(key), `unused locale key: ${key}`).toBe(true);
  });
});
