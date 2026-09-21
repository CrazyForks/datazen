import { describe, expect, it } from 'vitest';
import type { DatabaseTypeMeta, KvWorkspaceCapabilities } from '../databaseMeta';
import {
  KV_SLOT_NAMES,
  hasAnyKvSlotCapability,
  hasKvSlotCapability,
} from '../kvWorkspaceCapabilities';

/**
 * Minimal meta fixture — the capability reader must not care about any of the
 * SQL/document fields, so only the required ones are filled.
 */
function metaWithKvWorkspace(kvWorkspace?: KvWorkspaceCapabilities): DatabaseTypeMeta {
  const base = {
    label: 'Fixture KV',
    shortLabel: 'FK',
    iconBg: 'bg-red-600',
    iconColor: 'text-red-400',
    defaultPort: 0,
    defaultHost: '127.0.0.1',
    defaultUser: '',
    quoteChar: '`',
    connectionMode: 'server',
    supportsSSH: false,
    supportsSSL: false,
    supportsBackup: false,
    supportsTables: false,
    isKeyValue: true,
    supportsSQL: false,
    category: 'kv',
    connectionView: 'keyvalue',
    databaseFieldType: 'index',
    connectionForm: 'standard',
  } satisfies DatabaseTypeMeta;

  return kvWorkspace ? { ...base, kvWorkspace } : base;
}

const FULL: KvWorkspaceCapabilities = {
  contextBar: true,
  statusBar: true,
  keyPropsSidebar: true,
  home: true,
};

describe('kvWorkspaceCapabilities', () => {
  it('exposes exactly the four slot names the generator knows', () => {
    expect([...KV_SLOT_NAMES].sort()).toEqual(
      ['connectionHome', 'contextBar', 'keyPropsSidebar', 'statusBar'].sort(),
    );
  });

  it('treats a meta without kvWorkspace as "no capability" for every slot', () => {
    // Regression guard for the track's core promise: a driver that never heard of
    // KV slots (mysql / postgresql / mongodb …) keeps the pre-track rendering path.
    const meta = metaWithKvWorkspace();
    for (const slot of KV_SLOT_NAMES) {
      expect(hasKvSlotCapability(meta, slot)).toBe(false);
    }
    expect(hasAnyKvSlotCapability(meta)).toBe(false);
  });

  it('treats an empty kvWorkspace declaration as "no capability"', () => {
    const meta = metaWithKvWorkspace({});
    for (const slot of KV_SLOT_NAMES) {
      expect(hasKvSlotCapability(meta, slot)).toBe(false);
    }
    expect(hasAnyKvSlotCapability(meta)).toBe(false);
  });

  it('resolves connectionHome from the `home` flag and the others by their own name', () => {
    const meta = metaWithKvWorkspace(FULL);
    expect(hasKvSlotCapability(meta, 'contextBar')).toBe(true);
    expect(hasKvSlotCapability(meta, 'statusBar')).toBe(true);
    expect(hasKvSlotCapability(meta, 'keyPropsSidebar')).toBe(true);
    expect(hasKvSlotCapability(meta, 'connectionHome')).toBe(true);
    expect(hasAnyKvSlotCapability(meta)).toBe(true);
  });

  it('keeps slots independent so a driver can fill only one surface', () => {
    const meta = metaWithKvWorkspace({ keyPropsSidebar: true });
    expect(hasKvSlotCapability(meta, 'keyPropsSidebar')).toBe(true);
    expect(hasKvSlotCapability(meta, 'contextBar')).toBe(false);
    expect(hasKvSlotCapability(meta, 'statusBar')).toBe(false);
    expect(hasKvSlotCapability(meta, 'connectionHome')).toBe(false);
    expect(hasAnyKvSlotCapability(meta)).toBe(true);
  });

  it('requires a literal true, not just a present key', () => {
    const meta = metaWithKvWorkspace({ contextBar: false, home: false });
    expect(hasKvSlotCapability(meta, 'contextBar')).toBe(false);
    expect(hasKvSlotCapability(meta, 'connectionHome')).toBe(false);
    expect(hasAnyKvSlotCapability(meta)).toBe(false);
  });

  it('answers false for a missing meta (unknown or not-yet-registered driver)', () => {
    for (const slot of KV_SLOT_NAMES) {
      expect(hasKvSlotCapability(undefined, slot)).toBe(false);
    }
    expect(hasAnyKvSlotCapability(undefined)).toBe(false);
  });
});
