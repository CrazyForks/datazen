/**
 * Relation routing: turns relation groups into SVG shapes.
 *
 * Pure and DOM-free on purpose — this is where the composite-FK topology lives,
 * so it can be unit tested exhaustively without rendering a canvas.
 *
 * Topology rules
 * --------------
 * - One **group** = one constraint (or one manual join) = one visual object.
 * - A single-column group is a straight line (the common case).
 * - A composite group merges its source stubs into **one trunk**, then splits
 *   the trunk into one stub per target column: many → one → many.
 * - Groups sharing the same table pair get **parallel lanes** (14px apart) so
 *   they never overlap; lane order is derived from row indices, not from card
 *   positions, so it stays stable while a card is dragged.
 * - A self-referencing group loops out of the card's right edge.
 * - Every target end carries an arrowhead pointing into the referenced column.
 */

import { CARD_WIDTH, cardHeight, rowCenterY } from './cardLayout';
import type { QbJoinType } from '../types';

export type RelationKind = 'fk' | 'manual';
export type RelationState = 'candidate' | 'confirmed' | 'partial';

export interface RelationPair {
  fromTable: string;
  fromColumn: string;
  toTable: string;
  toColumn: string;
  /** Whether this particular column pair is already part of the SQL. */
  confirmed: boolean;
}

export interface RelationGroup {
  /** Stable identity: the FK constraint key, or the manual join id. */
  id: string;
  kind: RelationKind;
  type: QbJoinType;
  /** FK constraint name, when known (used by the popover header). */
  constraint?: string;
  pairs: RelationPair[];
}

export interface RelationGeometryInput {
  groups: RelationGroup[];
  positions: Record<string, { x: number; y: number }>;
  /** table → column names in row order. */
  columnOrder: Record<string, string[]>;
}

export interface RelationSegment {
  /** Polyline path; `stroke-linejoin: round` rounds the corners. */
  d: string;
  part: 'stub' | 'trunk';
  state: RelationState;
}

export interface RelationShape {
  groupId: string;
  kind: RelationKind;
  /** Aggregate state: all pairs confirmed, none, or in between. */
  state: RelationState;
  /** Confirmed pairs / total pairs — shown by the popover. */
  pairCount: number;
  confirmedCount: number;
  type: QbJoinType;
  constraint?: string;
  segments: RelationSegment[];
  /** Filled arrowheads at the referenced (parent) ends. */
  arrows: Array<{ d: string; state: RelationState }>;
  /** Round endpoints at the FK (child) ends. */
  dots: Array<{ x: number; y: number; state: RelationState }>;
  /** `table.column` keys of every column this group touches. */
  columnKeys: string[];
  /** Stable sort key, exported for tests. */
  lane: number;
}

/** Horizontal gap between two lanes of the same table pair. */
export const LANE_STEP = 14;
/** Extra length added beyond the outermost anchor so a trunk is always visible. */
export const TRUNK_OVERHANG = 10;
/** Minimum trunk length, so aligned rows still read as "merged". */
export const MIN_TRUNK = 24;
/** Distance a self-loop bulges out of the card. */
export const SELF_LOOP_OFFSET = 40;
/** Setback used when two cards leave no room for a trunk between them. */
const BYPASS_MARGIN = 28;

const ARROW_LENGTH = 7;
const ARROW_WIDTH = 6;

/** Arrowhead pointing at (x, y) from direction (dirX, dirY) (unit-ish). */
function arrowPath(x: number, y: number, dirX: number, dirY: number): string {
  const baseX = x - ARROW_LENGTH * dirX;
  const baseY = y - ARROW_LENGTH * dirY;
  const perpX = -dirY;
  const perpY = dirX;
  const half = ARROW_WIDTH / 2;
  const p1x = baseX + perpX * half;
  const p1y = baseY + perpY * half;
  const p2x = baseX - perpX * half;
  const p2y = baseY - perpY * half;
  return `M ${x} ${y} L ${p1x} ${p1y} L ${p2x} ${p2y} Z`;
}

/** Unordered key identifying a card pair (used for lane grouping). */
function pairKey(fromTable: string, toTable: string): string {
  return [fromTable, toTable].sort().join('::');
}

function resolveIndex(
  columnOrder: Record<string, string[]>,
  table: string,
  column: string,
): number {
  return (columnOrder[table] ?? []).indexOf(column);
}

function stateOf(pairs: RelationPair[]): RelationState {
  const confirmed = pairs.filter((p) => p.confirmed).length;
  if (confirmed === 0) return 'candidate';
  if (confirmed === pairs.length) return 'confirmed';
  return 'partial';
}

/**
 * Assign each group a lane index within its table pair.
 *
 * Ordered by the smallest source row index, then target table + group id: the
 * ordering is position-independent, so lanes never swap while dragging a card.
 */
export function assignLanes(
  groups: RelationGroup[],
  columnOrder: Record<string, string[]>,
): Map<string, number> {
  const byPair = new Map<string, RelationGroup[]>();
  for (const group of groups) {
    const first = group.pairs[0];
    if (!first) continue;
    const key = pairKey(first.fromTable, first.toTable);
    const list = byPair.get(key) ?? [];
    list.push(group);
    byPair.set(key, list);
  }

  const lanes = new Map<string, number>();
  for (const list of byPair.values()) {
    const sorted = [...list].sort((a, b) => {
      const aRow = Math.min(
        ...a.pairs.map((p) => {
          const i = resolveIndex(columnOrder, p.fromTable, p.fromColumn);
          return i === -1 ? Number.MAX_SAFE_INTEGER : i;
        }),
      );
      const bRow = Math.min(
        ...b.pairs.map((p) => {
          const i = resolveIndex(columnOrder, p.fromTable, p.fromColumn);
          return i === -1 ? Number.MAX_SAFE_INTEGER : i;
        }),
      );
      if (aRow !== bRow) return aRow - bRow;
      const aTarget = a.pairs[0]?.toTable ?? '';
      const bTarget = b.pairs[0]?.toTable ?? '';
      if (aTarget !== bTarget) return aTarget.localeCompare(bTarget);
      return a.id.localeCompare(b.id);
    });
    sorted.forEach((group, index) => lanes.set(group.id, index));
  }
  return lanes;
}

/** Offset (px) applied to the trunk of the group at `lane` among `count` lanes. */
export function laneOffset(lane: number, count: number): number {
  return (lane - (count - 1) / 2) * LANE_STEP;
}

/** Build every relation shape for the current canvas state. */
export function buildRelationShapes(input: RelationGeometryInput): RelationShape[] {
  const { positions, columnOrder } = input;
  const lanes = assignLanes(input.groups, columnOrder);

  // Lane counts per table pair, needed to centre the lanes in the gap.
  const laneCounts = new Map<string, number>();
  for (const group of input.groups) {
    const first = group.pairs[0];
    if (!first) continue;
    const key = pairKey(first.fromTable, first.toTable);
    laneCounts.set(key, Math.max(laneCounts.get(key) ?? 0, (lanes.get(group.id) ?? 0) + 1));
  }

  const shapes: RelationShape[] = [];
  for (const group of input.groups) {
    const first = group.pairs[0];
    if (!first) continue;

    // Only draw pairs whose tables are on the canvas and whose columns exist.
    const resolved = group.pairs
      .map((pair) => ({
        pair,
        fromPos: positions[pair.fromTable],
        toPos: positions[pair.toTable],
        fromIndex: resolveIndex(columnOrder, pair.fromTable, pair.fromColumn),
        toIndex: resolveIndex(columnOrder, pair.toTable, pair.toColumn),
      }))
      .filter(
        (entry) =>
          entry.fromPos !== undefined &&
          entry.toPos !== undefined &&
          entry.fromIndex !== -1 &&
          entry.toIndex !== -1,
      );
    if (resolved.length === 0) continue;

    const key = pairKey(first.fromTable, first.toTable);
    const lane = lanes.get(group.id) ?? 0;
    const offset = laneOffset(lane, laneCounts.get(key) ?? 1);
    const state = stateOf(group.pairs);

    const shape: PartialShape =
      first.fromTable === first.toTable
        ? buildSelfLoop(resolved, offset, state)
        : buildBetweenCards(resolved, offset, state, columnOrder);

    shapes.push({
      ...shape,
      groupId: group.id,
      kind: group.kind,
      type: group.type,
      constraint: group.constraint,
      state,
      pairCount: group.pairs.length,
      confirmedCount: group.pairs.filter((p) => p.confirmed).length,
      lane,
      columnKeys: resolved.flatMap((entry) => [
        `${entry.pair.fromTable}.${entry.pair.fromColumn}`,
        `${entry.pair.toTable}.${entry.pair.toColumn}`,
      ]),
    });
  }
  return shapes;
}

interface ResolvedPair {
  pair: RelationPair;
  fromPos: { x: number; y: number };
  toPos: { x: number; y: number };
  fromIndex: number;
  toIndex: number;
}

type PartialShape = Pick<RelationShape, 'segments' | 'arrows' | 'dots'>;

/** Composite/single group between two distinct cards. */
function buildBetweenCards(
  resolved: ResolvedPair[],
  offset: number,
  state: RelationState,
  columnOrder: Record<string, string[]>,
): PartialShape {
  const first = resolved[0]!;
  const fromCenterX = first.fromPos.x + CARD_WIDTH / 2;
  const toCenterX = first.toPos.x + CARD_WIDTH / 2;
  const fromCenterY = first.fromPos.y;
  const toCenterY = first.toPos.y;
  const horizontal = Math.abs(toCenterX - fromCenterX) >= Math.abs(toCenterY - fromCenterY);

  const segments: RelationSegment[] = [];
  const arrows: Array<{ d: string; state: RelationState }> = [];
  const dots: Array<{ x: number; y: number; state: RelationState }> = [];

  if (horizontal) {
    const fromIsLeft = fromCenterX <= toCenterX;
    const leftCardX = fromIsLeft ? first.fromPos.x : first.toPos.x;
    const rightCardX = fromIsLeft ? first.toPos.x : first.fromPos.x;
    const gapLeft = leftCardX + CARD_WIDTH;
    const gapRight = rightCardX;

    // Cards too close (or overlapping): bypass to the right of both.
    const hasGap = gapRight - gapLeft >= LANE_STEP * 3;
    const trunkX = hasGap
      ? (gapLeft + gapRight) / 2 + offset
      : Math.max(gapLeft, rightCardX + CARD_WIDTH) + BYPASS_MARGIN + offset;

    const anchors = resolved.map((entry) => {
      const fromX = fromIsLeft ? entry.fromPos.x + CARD_WIDTH : entry.fromPos.x;
      const toX = fromIsLeft ? entry.toPos.x : entry.toPos.x + CARD_WIDTH;
      return {
        entry,
        fromX,
        toX,
        fromY: rowCenterY(entry.fromPos.y, entry.fromIndex),
        toY: rowCenterY(entry.toPos.y, entry.toIndex),
        pairState: (entry.pair.confirmed ? 'confirmed' : 'candidate') as RelationState,
      };
    });

    // A single column pair is a plain straight line — no trunk to speak of.
    if (anchors.length === 1 && state !== 'partial') {
      const only = anchors[0]!;
      segments.push({
        d: `M ${only.fromX} ${only.fromY} L ${only.toX} ${only.toY}`,
        part: 'stub',
        state: only.pairState,
      });
      dots.push({ x: only.fromX, y: only.fromY, state: only.pairState });
      arrows.push({
        d: arrowPath(only.toX, only.toY, fromIsLeft ? 1 : -1, 0),
        state: only.pairState,
      });
      return { segments, arrows, dots };
    }

    const ys = anchors.flatMap((a) => [a.fromY, a.toY]);
    let trunkTop = Math.min(...ys) - TRUNK_OVERHANG;
    let trunkBottom = Math.max(...ys) + TRUNK_OVERHANG;
    if (trunkBottom - trunkTop < MIN_TRUNK) {
      const mid = (trunkTop + trunkBottom) / 2;
      trunkTop = mid - MIN_TRUNK / 2;
      trunkBottom = mid + MIN_TRUNK / 2;
    }

    segments.push({
      d: `M ${trunkX} ${trunkTop} L ${trunkX} ${trunkBottom}`,
      part: 'trunk',
      state,
    });

    for (const anchor of anchors) {
      segments.push({
        d: `M ${anchor.fromX} ${anchor.fromY} L ${trunkX} ${anchor.fromY}`,
        part: 'stub',
        state: anchor.pairState,
      });
      segments.push({
        d: `M ${trunkX} ${anchor.toY} L ${anchor.toX} ${anchor.toY}`,
        part: 'stub',
        state: anchor.pairState,
      });
      dots.push({ x: anchor.fromX, y: anchor.fromY, state: anchor.pairState });
      arrows.push({
        d: arrowPath(anchor.toX, anchor.toY, fromIsLeft ? 1 : -1, 0),
        state: anchor.pairState,
      });
    }
    return { segments, arrows, dots };
  }

  // Vertical stacking: the trunk runs horizontally between the two cards and the
  // stubs leave through the facing top/bottom edges, at the column's X.
  const fromIsTop = fromCenterY <= toCenterY;

  const anchors = resolved.map((entry) => ({
    fromX: rowCenterX(entry.fromPos),
    toX: rowCenterX(entry.toPos),
    fromY: fromIsTop
      ? entry.fromPos.y + cardHeight((columnOrder[entry.pair.fromTable] ?? []).length) - 1
      : entry.fromPos.y,
    toY: fromIsTop
      ? entry.toPos.y
      : entry.toPos.y + cardHeight((columnOrder[entry.pair.toTable] ?? []).length) - 1,
    pairState: (entry.pair.confirmed ? 'confirmed' : 'candidate') as RelationState,
  }));

  const trunkY = (anchors[0]!.fromY + anchors[0]!.toY) / 2 + offset;
  const xs = anchors.flatMap((a) => [a.fromX, a.toX]);
  let trunkLeft = Math.min(...xs) - TRUNK_OVERHANG;
  let trunkRight = Math.max(...xs) + TRUNK_OVERHANG;
  if (trunkRight - trunkLeft < MIN_TRUNK) {
    const mid = (trunkLeft + trunkRight) / 2;
    trunkLeft = mid - MIN_TRUNK / 2;
    trunkRight = mid + MIN_TRUNK / 2;
  }

  segments.push({ d: `M ${trunkLeft} ${trunkY} L ${trunkRight} ${trunkY}`, part: 'trunk', state });
  for (const anchor of anchors) {
    segments.push({
      d: `M ${anchor.fromX} ${anchor.fromY} L ${anchor.fromX} ${trunkY}`,
      part: 'stub',
      state: anchor.pairState,
    });
    segments.push({
      d: `M ${anchor.toX} ${trunkY} L ${anchor.toX} ${anchor.toY}`,
      part: 'stub',
      state: anchor.pairState,
    });
    dots.push({ x: anchor.fromX, y: anchor.fromY, state: anchor.pairState });
    arrows.push({
      d: arrowPath(anchor.toX, anchor.toY, 0, fromIsTop ? 1 : -1),
      state: anchor.pairState,
    });
  }
  return { segments, arrows, dots };
}

/** Horizontal center of a card (vertical-stacking routing anchors on it). */
function rowCenterX(pos: { x: number; y: number }): number {
  return pos.x + CARD_WIDTH / 2;
}

/** Self-referencing group: bulge out of the card's right edge. */
function buildSelfLoop(
  resolved: ResolvedPair[],
  offset: number,
  state: RelationState,
): PartialShape {
  const first = resolved[0]!;
  const anchorX = first.fromPos.x + CARD_WIDTH;
  const loopX = anchorX + SELF_LOOP_OFFSET + offset;

  const segments: RelationSegment[] = [];
  const arrows: Array<{ d: string; state: RelationState }> = [];
  const dots: Array<{ x: number; y: number; state: RelationState }> = [];

  const anchors = resolved.map((entry) => ({
    fromY: rowCenterY(entry.fromPos.y, entry.fromIndex),
    toY: rowCenterY(entry.toPos.y, entry.toIndex),
    pairState: (entry.pair.confirmed ? 'confirmed' : 'candidate') as RelationState,
  }));

  const ys = anchors.flatMap((a) => [a.fromY, a.toY]);
  const top = Math.min(...ys);
  const bottom = Math.max(...ys);
  segments.push({ d: `M ${loopX} ${top} L ${loopX} ${bottom}`, part: 'trunk', state });

  for (const anchor of anchors) {
    segments.push({
      d: `M ${anchorX} ${anchor.fromY} L ${loopX} ${anchor.fromY}`,
      part: 'stub',
      state: anchor.pairState,
    });
    segments.push({
      d: `M ${loopX} ${anchor.toY} L ${anchorX} ${anchor.toY}`,
      part: 'stub',
      state: anchor.pairState,
    });
    dots.push({ x: anchorX, y: anchor.fromY, state: anchor.pairState });
    arrows.push({ d: arrowPath(anchorX, anchor.toY, -1, 0), state: anchor.pairState });
  }
  return { segments, arrows, dots };
}
