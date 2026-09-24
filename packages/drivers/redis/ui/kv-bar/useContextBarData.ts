/**
 * Data sourcing for the 48px KV context bar (PRD §3.4).
 *
 * Three driver commands, none of them per-key and none of them `KEYS`:
 *
 *   db_sizes          → the db picker's key counts (all dbs, one round trip)
 *   type_distribution → the type chips (+ the `sampled` / `dbsize` bits that
 *                       decide whether the mandatory 采样 annotation appears)
 *   info_filtered     → `used_memory` / `maxmemory` for the memory cluster
 *
 * Each source fails **independently** and degrades to `null`, which the bar
 * renders as "that cluster is not there" — §3.4's rule for unavailable data is
 * 「不渲染」, never a fabricated `0`. A broken `db_sizes` therefore still leaves a
 * usable picker (the `maxDatabaseIndex` window needs no server reply), and an
 * ACL that forbids `type_distribution` leaves every other field on the band.
 *
 * `info_filtered` rather than `info` for the memory section: the same field set
 * (the reply is the parsed INFO of one section) for a fraction of the payload,
 * and it is the command `keyObjectInfo.invokeMaxmemoryPolicy` already uses, so
 * the panel costs one INFO-shaped round trip, not two flavours of it.
 *
 * Every reply is tagged with the identity it was issued for (`dbSessionId` +
 * `dbIndex`); a reply whose identity has moved on is dropped where it lands, so
 * a fast db switch can never paint the previous database's numbers.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KvSlotState } from '@datazen/driver-sdk';
import type { InfoSection } from '../observe/infoParse';
import { redisCommandInvoke, type DbSize, type RedisInvokeFn } from '../shared/redisInvoke';
import { sharedDbSizes } from './dbKeyCounts';
import {
  deriveDbOptions,
  deriveMemoryReadout,
  deriveTypeChips,
  type DbOption,
  type MemoryReadout,
  type TypeChipsModel,
  type TypeDistribution,
} from './contextBarModel';

/** Command names this hook is allowed to issue — the module's whole surface. */
export const CONTEXT_BAR_COMMANDS = {
  dbSizes: 'db_sizes',
  typeDistribution: 'type_distribution',
  infoFiltered: 'info_filtered',
} as const;

export interface ContextBarData {
  /** Every db the picker offers (window ∪ `db_sizes`), in index order. */
  dbOptions: DbOption[];
  /** Key count of the db the panel is bound to; `null` when unreadable. */
  keysInDb: number | null;
  /** `used_memory` / `maxmemory`; `null` when INFO had nothing usable. */
  memory: MemoryReadout | null;
  /** Type chips; `null` ⇒ render **no chips at all** (never a row of zeros). */
  types: TypeChipsModel | null;
  /** Re-issue all three commands (the band's own refresh affordance). */
  reload: () => void;
}

export interface UseContextBarDataArgs {
  /**
   * The panel's relay object. Not read as state here — it is the **identity**
   * that lets the status bar's own `db_sizes` read join this one instead of
   * issuing a second copy of a 32-round-trip command.
   */
  scope: KvSlotState;
  dbSessionId: string;
  /** Numeric db the panel is bound to; `undefined` until one is resolved. */
  dbIndex: number | undefined;
  /** Driver's declared db window (`redisMeta.maxDatabaseIndex`) for the picker. */
  maxDatabaseIndex: number;
  /** Test seam; defaults to the real `execute_driver_command` gateway. */
  invoke?: RedisInvokeFn;
}

/** Flatten the INFO sections of one reply into a single field table. */
function flattenSections(sections: readonly InfoSection[]): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const section of sections) {
    for (const entry of section.entries) fields[entry.key] = entry.value;
  }
  return fields;
}

/** Sections of an `info_filtered` reply, or `[]` for any other shape. */
function sectionsOf(reply: unknown): InfoSection[] {
  if (!reply || typeof reply !== 'object' || !('sections' in reply)) return [];
  const raw = (reply as { sections: unknown }).sections;
  return Array.isArray(raw) ? (raw as InfoSection[]) : [];
}

/**
 * Read the three context-bar sources.
 *
 * The identity guard is a single token (session + db index) rather than a
 * per-source one: all three describe the same database, so landing one of them
 * for another db would be just as wrong as landing all three (the reasoning
 * `useKeyObjectInfo.readToken` records for the key read).
 */
export function useContextBarData({
  scope,
  dbSessionId,
  dbIndex,
  maxDatabaseIndex,
  invoke = redisCommandInvoke,
}: UseContextBarDataArgs): ContextBarData {
  const [dbSizes, setDbSizes] = useState<DbSize[] | null>(null);
  const [distribution, setDistribution] = useState<TypeDistribution | null>(null);
  const [memoryFields, setMemoryFields] = useState<Record<string, string> | null>(null);
  const [attempt, setAttempt] = useState(0);
  const tokenRef = useRef('');

  useEffect(() => {
    const token = `${dbSessionId}\u0000${dbIndex ?? ''}\u0000${attempt}`;
    tokenRef.current = token;
    const stale = () => tokenRef.current !== token;

    // A new identity opens with "no known facts", never with the previous db's
    // numbers — the same rule the key-attribute read follows (BUG-001).
    setDbSizes(null);
    setDistribution(null);
    setMemoryFields(null);
    if (!dbSessionId || dbIndex === undefined) return;

    void (async () => {
      try {
        // Shared with the status bar's own count read: both slots describe the
        // same panel, and `db_sizes` is `SELECT` + `DBSIZE` per database, so two
        // unmerged reads would double a 32-round-trip command on every switch.
        const sizes = await sharedDbSizes(scope, dbSessionId, invoke);
        if (stale()) return;
        setDbSizes(Array.isArray(sizes) ? sizes : []);
      } catch {
        /* counts are best-effort enrichment; the picker survives without them */
      }
    })();

    void (async () => {
      try {
        const reply = (await invoke('redis', CONTEXT_BAR_COMMANDS.typeDistribution, {
          dbSessionId,
          dbIndex,
        })) as TypeDistribution | null | undefined;
        if (stale()) return;
        setDistribution(reply ?? null);
      } catch {
        /* failed / unsupported / unauthorized ⇒ no chips (never zeros) */
      }
    })();

    void (async () => {
      try {
        const reply = await invoke('redis', CONTEXT_BAR_COMMANDS.infoFiltered, {
          dbSessionId,
          section: 'memory',
        });
        if (stale()) return;
        setMemoryFields(flattenSections(sectionsOf(reply)));
      } catch {
        /* no memory section readable ⇒ the memory cluster is not rendered */
      }
    })();
  }, [scope, dbSessionId, dbIndex, attempt, invoke]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  const dbOptions = useMemo(
    () => deriveDbOptions(dbSizes, maxDatabaseIndex),
    [dbSizes, maxDatabaseIndex],
  );
  const keysInDb = useMemo(() => {
    if (dbIndex === undefined || !dbSizes) return null;
    const row = dbSizes.find((size) => size.db === dbIndex);
    return row ? row.keys : null;
  }, [dbSizes, dbIndex]);
  const memory = useMemo(
    () => (memoryFields ? deriveMemoryReadout(memoryFields) : null),
    [memoryFields],
  );
  const types = useMemo(() => deriveTypeChips(distribution), [distribution]);

  return { dbOptions, keysInDb, memory, types, reload };
}
