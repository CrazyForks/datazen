/**
 * Card placement rules: grid snapping and row alignment.
 *
 * These exist because two tables dragged onto the canvas previously landed a
 * few pixels apart vertically, which made the diagram look broken with no way
 * to fix it by hand.
 */
import { describe, expect, it } from 'vitest';
import {
  CARD_GRID,
  CARD_STRIDE,
  alignDroppedCard,
  resolveDragPosition,
  snapToGrid,
} from '../cardLayout';

describe('snapToGrid', () => {
  it('rounds to the nearest grid step', () => {
    expect(snapToGrid(0)).toBe(0);
    expect(snapToGrid(CARD_GRID + 1)).toBe(CARD_GRID);
    expect(snapToGrid(CARD_GRID * 1.6)).toBe(CARD_GRID * 2);
  });

  it('never goes negative', () => {
    expect(snapToGrid(-50)).toBe(0);
  });
});

describe('alignDroppedCard', () => {
  it('snaps to the grid when the canvas is empty', () => {
    expect(alignDroppedCard({ x: 40, y: 25 }, {})).toEqual({ x: 48, y: 24 });
  });

  it('adopts the top edge of a card in the same row', () => {
    const pos = alignDroppedCard({ x: 400, y: 61 }, { users: { x: 48, y: 24 } });
    expect(pos.y).toBe(24);
  });

  it('places the new card to the right of the row it joins', () => {
    const pos = alignDroppedCard({ x: 50, y: 30 }, { users: { x: 48, y: 24 } });
    expect(pos.x).toBe(48 + CARD_STRIDE);
  });

  it('keeps its own row when dropped far below', () => {
    const pos = alignDroppedCard({ x: 300, y: 400 }, { users: { x: 48, y: 24 } });
    expect(pos.y).toBe(408);
    expect(pos.x).toBe(312);
  });

  it('stacks a third card after the rightmost card of the row', () => {
    const row = { a: { x: 48, y: 24 }, b: { x: 48 + CARD_STRIDE, y: 24 } };
    const pos = alignDroppedCard({ x: 60, y: 30 }, row);
    expect(pos.y).toBe(24);
    expect(pos.x).toBe(48 + CARD_STRIDE * 2);
  });
});

describe('resolveDragPosition', () => {
  it('ignores the card being dragged when looking for its row', () => {
    // Dragging `users` must not align it to its own stale position.
    const pos = resolveDragPosition({ x: 300, y: 400 }, { users: { x: 48, y: 24 } }, 'users');
    expect(pos).toEqual({ x: 312, y: 408 });
  });

  it('aligns to the other cards while dragging', () => {
    const pos = resolveDragPosition(
      { x: 300, y: 40 },
      { users: { x: 48, y: 24 }, orders: { x: 600, y: 24 } },
      'orders',
    );
    expect(pos.y).toBe(24);
  });
});
