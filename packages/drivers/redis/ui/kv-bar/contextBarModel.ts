/**
 * Pure view model for the 48px KV context bar (PRD §3.4, ruling 8-2 = full).
 *
 * Everything the bar prints is derived here so `RedisContextBar.tsx` stays a
 * rendering shell (PRD §5 "组件薄 + 纯逻辑模块厚") and each §3.4 hard constraint
 * is a unit-testable function rather than a JSX branch:
 *
 * - **the type-distribution chips are a sample and must say so.** `sampled <
 *   dbsize` yields a mandatory annotation; `sampled >= dbsize` (a small db read
 *   in full) is the only case that may present itself as exact. A failed /
 *   unauthorized / unsupported read returns `null`, which the renderer turns
 *   into *no chips at all* — never a row of zeros (§3.4 「整组 chips 不渲染
 *   （不是渲染 0）」).
 * - **`maxmemory 0` means no ceiling**, not "zero bytes of ceiling": it gets its
 *   own `unlimited` kind so no renderer can print `0` (the same call
 *   `overviewModel.buildMemoryModel` makes for 屏 A).
 * - **an unknown scan budget has no bar.** A bar is a fraction and a fraction
 *   needs a denominator, so `total === 0` (F-1: "0 = unknown") renders the
 *   used count alone rather than a 0%-or-100% bar that would be a fabrication.
 * - **copy-free**: the model returns enums, numbers and boolean flags. Only the
 *   `.tsx` files name i18n keys, which is also what keeps
 *   `kvSlotRegistration.test.ts`'s "unused copy" scan honest (it walks
 *   `ui/kv-bar/*.tsx`, so a key named only in a `.ts` file would be reported as
 *   orphaned).
 */
import type { DbSize } from '../shared/redisInvoke';

/** Upper bound of the `db_sizes` list the driver asks for when it must guess. */
export const DEFAULT_DATABASE_COUNT = 16;

/** Budget tiers the ⋯ menu offers (PRD §4 I-2). Values are `SCAN COUNT` ceilings. */
export const SCAN_BUDGET_TIERS = [10_000, 50_000, 200_000, 1_000_000] as const;

// ---------------------------------------------------------------------------
// db picker
// ---------------------------------------------------------------------------

export interface DbOption {
  /** `db{n}` — a Redis logical-database identifier, not translated copy. */
  name: string;
  dbIndex: number;
  /** Key count from `db_sizes`; `null` when the reply did not cover this db. */
  keys: number | null;
}

/** `db12` — the label Redis itself uses; never translated. */
export function dbLabel(dbIndex: number): string {
  return `db${dbIndex}`;
}

/** Numeric index of a `db{n}` label; `null` for an unparseable name. */
export function dbIndexOf(name: string): number | null {
  const match = /^db(\d+)$/.exec(name);
  if (!match) return null;
  const index = Number(match[1]);
  return Number.isSafeInteger(index) ? index : null;
}

/**
 * The db list the picker offers: the standard `db0 … db{maxDatabaseIndex}`
 * window **unioned** with whatever `db_sizes` reported.
 *
 * Union rather than "one or the other" because the two sources fail
 * independently and mean different things: `maxDatabaseIndex` is the driver's
 * declared window (always available, PRD §3.4 "或按 maxDatabaseIndex 生成"),
 * while `db_sizes` is server truth (may show a db outside the window on a
 * reconfigured server, may be empty on an ACL that forbids `DBSIZE`). Losing
 * either one would silently hide a database the user can reach.
 */
export function deriveDbOptions(
  dbSizes: readonly DbSize[] | null,
  maxDatabaseIndex: number,
): DbOption[] {
  const counts = new Map<number, number>();
  for (const row of dbSizes ?? []) {
    if (Number.isSafeInteger(row.db) && row.db >= 0) counts.set(row.db, row.keys);
  }
  const window = Number.isSafeInteger(maxDatabaseIndex) && maxDatabaseIndex >= 0 ? maxDatabaseIndex : 0;
  const highest = Math.max(window, ...counts.keys(), 0);
  const options: DbOption[] = [];
  for (let index = 0; index <= highest; index += 1) {
    options.push({ name: dbLabel(index), dbIndex: index, keys: counts.get(index) ?? null });
  }
  return options;
}

// ---------------------------------------------------------------------------
// counts
// ---------------------------------------------------------------------------

/**
 * Compact server count for a 48px bar: `52`, `1.2k`, `12k`, `1.4M`.
 *
 * Deliberately not a translated unit — these are measurements (the same call
 * `keyObjectInfo.formatDurationMs` makes), and a 48px band cannot afford
 * `12,345 keys` next to five other facts.
 */
export function formatCompactCount(value: number): string {
  const n = Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
  if (n < 1000) return String(n);
  if (n < 10_000) {
    const thousands = (n / 1000).toFixed(1);
    return `${thousands.endsWith('.0') ? thousands.slice(0, -2) : thousands}k`;
  }
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  return `${Math.round(n / 1_000_000)}M`;
}

// ---------------------------------------------------------------------------
// type distribution (chips)
// ---------------------------------------------------------------------------

/** Wire shape of the `type_distribution` reply (camelCase, `serde` renamed). */
export interface TypeDistribution {
  /** `TYPE` token → count; module types keep their raw server token. */
  counts: Record<string, number>;
  /** Keys whose type was actually resolved (always the sum of `counts`). */
  sampled: number;
  /** `DBSIZE` of the selected database (whole cluster on a cluster). */
  dbsize: number;
  /** `sampled < dbsize` — the distribution is an estimate, not a census. */
  truncated: boolean;
}

export interface TypeChip {
  type: string;
  count: number;
}

export interface TypeChipsModel {
  /** Descending by count, then ascending by type name — stable across renders. */
  chips: TypeChip[];
  /**
   * Present **only** when the sample is short of the census and the annotation
   * is therefore mandatory. `null` means "exact, no note needed".
   */
  sample: { sampled: number; dbsize: number } | null;
}

/**
 * Chips for a distribution reply, or `null` when there is nothing honest to
 * show — which includes a malformed reply, because a reply the driver could not
 * shape is indistinguishable from a failure at this layer.
 *
 * The truncation verdict is recomputed from `sampled` / `dbsize` instead of
 * trusting the wire `truncated` flag: both bits are frozen in the payload
 * (§6 / W3-B contract) and the comparison is the rule §3.4 actually states.
 */
export function deriveTypeChips(distribution: TypeDistribution | null): TypeChipsModel | null {
  if (!distribution) return null;
  const raw = distribution.counts;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const chips: TypeChip[] = [];
  for (const [type, count] of Object.entries(raw)) {
    if (typeof count === 'number' && Number.isFinite(count) && count > 0) {
      chips.push({ type, count });
    }
  }
  if (chips.length === 0) return null;
  chips.sort((a, b) => (b.count - a.count) || a.type.localeCompare(b.type));
  const sampled = Number.isFinite(distribution.sampled) ? distribution.sampled : 0;
  const dbsize = Number.isFinite(distribution.dbsize) ? distribution.dbsize : 0;
  return { chips, sample: sampled < dbsize ? { sampled, dbsize } : null };
}

// ---------------------------------------------------------------------------
// memory
// ---------------------------------------------------------------------------

export interface MemoryReadout {
  usedBytes: number;
  /**
   * `null` ⇒ the server declares **no ceiling** (`maxmemory 0`, or the field is
   * absent from a `maxmemory`-less build). Renderers must print the "no limit"
   * word here and must never fall back to `0`.
   */
  maxBytes: number | null;
}

/** Parse a non-negative integer INFO field; `null` when absent or malformed. */
function infoNumber(fields: Record<string, string>, key: string): number | null {
  const raw = fields[key];
  if (raw === undefined) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

/**
 * `used_memory` / `maxmemory` from the INFO `memory` section.
 *
 * `null` when `used_memory` itself is unreadable: the bar then omits the whole
 * memory cluster rather than printing a lone `max` (§3.4 「不渲染」).
 */
export function deriveMemoryReadout(fields: Record<string, string>): MemoryReadout | null {
  const usedBytes = infoNumber(fields, 'used_memory');
  if (usedBytes === null) return null;
  const max = infoNumber(fields, 'maxmemory');
  // `0` is Redis' own way of saying "no ceiling" — the one value that must not
  // reach the DOM as a number.
  return { usedBytes, maxBytes: max === null || max <= 0 ? null : max };
}

// ---------------------------------------------------------------------------
// scan progress
// ---------------------------------------------------------------------------

/** `idle` = nothing to report; the other three are all "there is a number here". */
export type ScanState = 'idle' | 'scanning' | 'stopped' | 'done';

export interface ScanReadout {
  state: ScanState;
  used: number;
  /** `0` ⇒ unknown ceiling (F-1). */
  total: number;
  /** `null` ⇒ no denominator, so no bar may be drawn. */
  percent: number | null;
  /** `▉▉▉░` for the PRD's four-cell gauge; empty when there is no fraction. */
  bar: string;
  /** True while a scan is in flight (drives the animated word, not the numbers). */
  scanning: boolean;
}

const BAR_CELLS = 4;

/** Four-cell gauge of a 0–100 percentage, rounding half up. */
export function budgetBar(percent: number | null): string {
  if (percent === null) return '';
  const filled = Math.max(0, Math.min(BAR_CELLS, Math.round((percent / 100) * BAR_CELLS)));
  return `${'▉'.repeat(filled)}${'░'.repeat(BAR_CELLS - filled)}`;
}

export interface ScanInput {
  /** F-1 `isScanning()`. */
  scanning: boolean;
  /** F-1 `getScanBudgetUsed()` — COUNT consumed by the current user action. */
  used: number;
  /** F-1 `getScanBudgetTotal()` — `0` = unknown. */
  total: number;
  /** F-1 `getScanCursor()` — `'0'` after the cursor wrapped. */
  cursor: string;
}

/**
 * The scan cluster, or `null` when the relay has nothing to say.
 *
 * Judgement calls, written down because each one is a place a bar could lie:
 *
 * 1. **Idle and unused ⇒ no cluster.** `used === 0` with no scan running is the
 *    initial value of a fresh panel (F-1's EMPTY_SNAPSHOT); printing
 *    `0/0` there would be noise dressed as a measurement.
 * 2. **`total === 0` ⇒ used only, no bar.** The budget is unknown, and a
 *    fraction without a denominator is exactly the fabrication §3.4 forbids for
 *    the chips. The used count *is* a real measurement, so it survives.
 * 3. **`cursor === '0'` alone is not "done".** F-1 spells this out: the initial
 *    snapshot also carries `'0'`, so `done` additionally requires `used > 0` —
 *    i.e. somebody actually scanned something and the cursor wrapped. That pair
 *    is enforced by rule 1's early return, which is why a fresh panel reports
 *    `idle` (via `null`) rather than a claim of completion.
 */
export function deriveScanReadout({ scanning, used, total, cursor }: ScanInput): ScanReadout | null {
  const usedCount = Number.isFinite(used) && used > 0 ? used : 0;
  const totalCount = Number.isFinite(total) && total > 0 ? total : 0;
  if (!scanning && usedCount === 0) return null;

  const percent = totalCount > 0 ? Math.min(100, Math.round((usedCount / totalCount) * 100)) : null;
  // Past the early return above, `usedCount > 0` always holds, so the pair that
  // separates "stopped early" from "wrapped" is `cursor !== '0'` (see the
  // docblock, point 3). Re-testing `usedCount` here would be an unreachable
  // branch — a branch no test can execute, which is worse than a shorter
  // expression.
  const stopped = cursor !== '0' && !scanning;
  const state: ScanState = scanning ? 'scanning' : stopped ? 'stopped' : 'done';
  return {
    state,
    used: usedCount,
    total: totalCount,
    percent,
    bar: budgetBar(percent),
    scanning,
  };
}

// ---------------------------------------------------------------------------
// responsive layout (I-10)
// ---------------------------------------------------------------------------

/**
 * The two degradations the host's single `compact` flag buys (PRD §4 I-10
 * asks for three breakpoints; the frozen `KvContextBarProps` hands the driver
 * one boolean, so this is the honest resolution of that gap):
 *
 * - `full` — every field + button labels.
 * - `compact` — **first** the button labels go (icon-only, `title` keeps them
 *   discoverable), **then** the two server-wide decorations (memory, chips)
 *   collapse behind the ⋯ menu, whose items carry the same numbers.
 *
 * `db` / `keys` / `scan` stay in the band at every width: they are what
 * identifies the panel and what moves while the user waits.
 */
export type ContextBarLayout = 'full' | 'compact';

export function contextBarLayout(compact: boolean): ContextBarLayout {
  return compact ? 'compact' : 'full';
}

/** Fields the ⋯ menu has to carry in `compact` (they leave the band). */
export const COMPACT_OVERFLOW_PARTS = ['memory', 'types'] as const;

export type ContextBarPart = 'db' | 'keys' | 'memory' | 'types' | 'scan';

/** Whether a field still renders in the band itself at this layout. */
export function partInBand(part: ContextBarPart, layout: ContextBarLayout): boolean {
  if (layout === 'full') return true;
  return !(COMPACT_OVERFLOW_PARTS as readonly string[]).includes(part);
}
