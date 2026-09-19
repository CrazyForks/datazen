/** Props for the SVG foreign-key connecting line between two columns. */
export interface FKLineProps {
  /** Source table name. */
  fromTable: string;
  /** Source column name. */
  fromColumn: string;
  /** Target table name. */
  toTable: string;
  /** Target column name. */
  toColumn: string;
  /** Position and dimensions of the source card. */
  fromCardPos: { x: number; y: number };
  /** Position and dimensions of the target card. */
  toCardPos: { x: number; y: number };
  /** Column index of the source column in its card. */
  fromColumnIndex: number;
  /** Column index of the target column in its card. */
  toColumnIndex: number;
}

/** Header height of a table card in pixels. */
const HEADER_HEIGHT = 44;
/** Row height of a column item in pixels. */
const ROW_HEIGHT = 28;

/**
 * FKLine — Draws a straight connecting line between two foreign key columns
 * across different table cards on the diagram canvas.
 */
export function FKLine({
  fromTable,
  fromColumn,
  toTable,
  toColumn,
  fromCardPos,
  toCardPos,
  fromColumnIndex,
  toColumnIndex,
}: FKLineProps) {
  // Calculate the Y position of each column row center
  const fromY = fromCardPos.y + HEADER_HEIGHT + fromColumnIndex * ROW_HEIGHT + ROW_HEIGHT / 2;
  const toY = toCardPos.y + HEADER_HEIGHT + toColumnIndex * ROW_HEIGHT + ROW_HEIGHT / 2;

  // Connect from the right edge of the left card to the left edge of the right card
  // Determine which card is on the left
  const isFromLeft = fromCardPos.x <= toCardPos.x;
  const from = isFromLeft
    ? { x: fromCardPos.x + 220, y: fromY } // right edge of from card (CARD_WIDTH ≈ 220)
    : { x: fromCardPos.x, y: fromY }; // left edge of from card
  const to = isFromLeft
    ? { x: toCardPos.x, y: toY } // left edge of to card
    : { x: toCardPos.x + 220, y: toY }; // right edge of to card

  return (
    <g data-testid={`qb-fk-line-${fromTable}.${fromColumn}-${toTable}.${toColumn}`}>
      {/* Straight line connecting the two columns */}
      <line
        x1={from.x}
        y1={from.y}
        x2={to.x}
        y2={to.y}
        stroke="var(--color-fg)"
        strokeWidth={1.5}
        opacity={0.8}
        className="pointer-events-none"
      />
      {/* Endpoint markers */}
      <rect
        x={from.x - 3}
        y={from.y - 3}
        width={6}
        height={6}
        fill="var(--color-fg)"
        opacity={0.9}
      />
      <rect x={to.x - 3} y={to.y - 3} width={6} height={6} fill="var(--color-fg)" opacity={0.9} />
    </g>
  );
}
