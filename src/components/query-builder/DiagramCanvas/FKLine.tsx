import { useMemo } from 'react';

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
 * Compute a curved path between two column positions.
 * Uses a cubic bezier with horizontal control points for a smooth curve.
 */
function bezierPath(from: { x: number; y: number }, to: { x: number; y: number }): string {
  const dx = Math.abs(to.x - from.x);
  const cp = Math.max(dx * 0.3, 30);
  return `M ${from.x} ${from.y} C ${from.x + cp} ${from.y}, ${to.x - cp} ${to.y}, ${to.x} ${to.y}`;
}

/**
 * FKLine — Draws a connecting line between two foreign key columns
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

  const pathD = useMemo(() => bezierPath(from, to), [from, to]);

  // Midpoint for the FK label
  const midX = (from.x + to.x) / 2;
  const midY = (from.y + to.y) / 2;

  return (
    <g data-testid={`qb-fk-line-${fromTable}.${fromColumn}-${toTable}.${toColumn}`}>
      {/* Shadow/glow effect */}
      <path
        d={pathD}
        fill="none"
        stroke="var(--color-accent)"
        strokeWidth={4}
        opacity={0.1}
        className="pointer-events-none"
      />
      {/* Main line */}
      <path
        d={pathD}
        fill="none"
        stroke="var(--color-accent)"
        strokeWidth={1.5}
        strokeDasharray="4 3"
        opacity={0.7}
        className="pointer-events-none"
      />
      {/* Animated dash overlay */}
      <path
        d={pathD}
        fill="none"
        stroke="var(--color-accent)"
        strokeWidth={1.5}
        strokeDasharray="3 6"
        opacity={0.4}
      >
        <animate
          attributeName="stroke-dashoffset"
          from="0"
          to="-9"
          dur="1.5s"
          repeatCount="indefinite"
        />
      </path>
      {/* FK label */}
      <foreignObject
        x={midX - 16}
        y={midY - 9}
        width={32}
        height={18}
        className="pointer-events-none"
        style={{ overflow: 'visible' }}
      >
        <div
          className="flex items-center justify-center rounded bg-accent/90 px-1 py-0 text-[8px] font-bold text-white"
          style={{ lineHeight: '16px' }}
        >
          FK
        </div>
      </foreignObject>
      {/* Dots at endpoints */}
      <circle cx={from.x} cy={from.y} r={3} fill="var(--color-accent)" opacity={0.8} />
      <circle cx={to.x} cy={to.y} r={3} fill="var(--color-accent)" opacity={0.8} />
    </g>
  );
}
