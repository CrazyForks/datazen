/**
 * Canvas card placement rules.
 *
 * Cards are free-floating, but two behaviours keep the diagram readable:
 *  - every position snaps to a grid, so manual dragging can actually align;
 *  - a dropped card aligns its top with the cards already in that band and
 *    lands to their right, so dragging two tables in does not leave their tops
 *    a few pixels apart.
 */

/** Grid step for card positions. */
export const CARD_GRID = 24;
/** Horizontal stride between cards sharing a row (max card width + gap). */
export const CARD_STRIDE = 264;
/** Vertical tolerance for "this drop belongs to the same row". */
export const CARD_ROW_TOLERANCE = 56;

export type CardPositions = Record<string, { x: number; y: number }>;

/** Round a coordinate to the canvas grid, never negative. */
export function snapToGrid(value: number, grid: number = CARD_GRID): number {
  return Math.max(0, Math.round(value / grid) * grid);
}

/**
 * Resolve the position for a newly dropped card.
 *
 * Returns a grid-snapped position that shares the top edge of any nearby row
 * and sits to the right of the cards already in it.
 */
export function alignDroppedCard(pos: { x: number; y: number }, existing: CardPositions) {
  const x = snapToGrid(pos.x);
  const y = snapToGrid(pos.y);

  const sameRow = Object.values(existing).filter((p) => Math.abs(p.y - y) <= CARD_ROW_TOLERANCE);
  if (sameRow.length === 0) return { x, y };

  const top = sameRow[0]!.y;
  const rightMost = Math.max(...sameRow.map((p) => p.x));
  return { x: Math.max(x, rightMost + CARD_STRIDE), y: top };
}

/**
 * Resolve a manual drag position: the same grid/row rules, but the card is the
 * one being positioned, so it is excluded from the "existing" band lookup.
 */
export function resolveDragPosition(
  pos: { x: number; y: number },
  others: CardPositions,
  selfKey: string,
) {
  const { [selfKey]: _self, ...rest } = others;
  return alignDroppedCard(pos, rest);
}
