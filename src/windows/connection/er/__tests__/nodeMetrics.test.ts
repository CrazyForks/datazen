import { describe, it, expect } from 'vitest';
import {
  ER_COLLAPSED_FOOTER_HEIGHT,
  ER_COLUMN_ROW_HEIGHT,
  ER_HEADER_HEIGHT,
  ER_MAX_BODY_HEIGHT,
  ER_NODE_BORDER,
  ER_NODE_WIDTH,
  erNodeBodyHeight,
  erNodeHeight,
} from '../nodeMetrics';

/**
 * These numbers are a contract with `TableNode`, which applies each one as an
 * explicit inline height. If they drift, the layout packs nodes against a size
 * that is not what renders — which is precisely how the previous grid came to
 * reserve 1000px for a table that draws at 340px.
 */
describe('ER node metrics', () => {
  it('gives a node a fixed width the layout can pack against', () => {
    expect(ER_NODE_WIDTH).toBeGreaterThan(0);
  });

  it('sizes a node from its header, its rows and its border', () => {
    const columns = 5;
    expect(erNodeHeight(columns)).toBe(
      ER_HEADER_HEIGHT + columns * ER_COLUMN_ROW_HEIGHT + ER_NODE_BORDER * 2,
    );
  });

  it('stops growing once the column list starts scrolling', () => {
    const capped = ER_HEADER_HEIGHT + ER_MAX_BODY_HEIGHT + ER_NODE_BORDER * 2;
    // 40 columns would otherwise reserve 40 * 24 = 960px of body.
    expect(erNodeBodyHeight(40)).toBe(ER_MAX_BODY_HEIGHT);
    expect(erNodeHeight(40)).toBe(capped);
    // And the cap must not bite before it is reached.
    expect(erNodeHeight(5)).toBeLessThan(capped);
  });

  it('matches the body height below the cap', () => {
    expect(erNodeBodyHeight(3)).toBe(3 * ER_COLUMN_ROW_HEIGHT);
    expect(erNodeBodyHeight(0)).toBe(0);
  });

  it('ignores a negative column count rather than going above the header', () => {
    expect(erNodeBodyHeight(-4)).toBe(0);
    expect(erNodeHeight(-4)).toBe(ER_HEADER_HEIGHT + ER_NODE_BORDER * 2);
  });

  it('makes a collapsed node shorter than the same node expanded', () => {
    const expanded = erNodeHeight(20);
    const collapsed = erNodeHeight(20, true);
    expect(collapsed).toBe(ER_HEADER_HEIGHT + ER_COLLAPSED_FOOTER_HEIGHT + ER_NODE_BORDER * 2);
    expect(collapsed).toBeLessThan(expanded);
  });

  it('collapses to the same height regardless of column count', () => {
    // The column list is not rendered when collapsed, so its length is irrelevant.
    expect(erNodeHeight(3, true)).toBe(erNodeHeight(60, true));
  });
});
