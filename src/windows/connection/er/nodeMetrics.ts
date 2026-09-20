/**
 * Node geometry for the ER diagram, defined once.
 *
 * The layout engine needs each node's exact size *before* the node renders, so the
 * size cannot be left to emerge from padding and line-heights — that is how the
 * previous grid came to reserve 1000px for a table that renders at 340px, and how
 * it drew nodes on top of each other. Every dimension here is therefore also
 * applied explicitly in `TableNode`, and the two are pinned together by test.
 *
 * Width is fixed rather than fluid for the same reason: a node that renders
 * anywhere between 180px and 280px cannot be packed without guessing.
 */

/** Fixed node width. The header and column names truncate to fit. */
export const ER_NODE_WIDTH = 260;
/** Table-name header. */
export const ER_HEADER_HEIGHT = 36;
/** One column row. */
export const ER_COLUMN_ROW_HEIGHT = 24;
/** The "N columns" strip shown in place of the column list when collapsed. */
export const ER_COLLAPSED_FOOTER_HEIGHT = 24;
/** The container border, top and bottom. */
export const ER_NODE_BORDER = 1;
/**
 * The column list scrolls past this height. A 60-column table is otherwise a
 * 1500px node that no layout can pack usefully.
 */
export const ER_MAX_BODY_HEIGHT = 300;

/** Height of the column list, capped by the scroll limit. */
export function erNodeBodyHeight(columnCount: number): number {
  return Math.min(Math.max(columnCount, 0) * ER_COLUMN_ROW_HEIGHT, ER_MAX_BODY_HEIGHT);
}

/** Total rendered node height, matching `TableNode` exactly. */
export function erNodeHeight(columnCount: number, collapsed = false): number {
  const inner = collapsed
    ? ER_HEADER_HEIGHT + ER_COLLAPSED_FOOTER_HEIGHT
    : ER_HEADER_HEIGHT + erNodeBodyHeight(columnCount);
  return inner + ER_NODE_BORDER * 2;
}
