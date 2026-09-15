import { useMemo } from 'react';
import type { QbJoin } from '../types';
import { JoinLabel } from './JoinLabel';
import type { QbJoinType } from '../types';

/** Props for the SVG JOIN line between two table cards. */
export interface JoinLineProps {
  join: QbJoin;
  /** Center position of the left (source) table card. */
  fromPos: { x: number; y: number };
  /** Center position of the right (target) table card. */
  toPos: { x: number; y: number };
  /** Whether this is an auto-detected FK (dashed line). */
  isAuto: boolean;
  onUpdateType: (type: QbJoinType) => void;
  onRemove: () => void;
}

/**
 * Compute a cubic bezier path string between two points.
 * The control points are horizontally offset for a smooth curve.
 */
function bezierPath(from: { x: number; y: number }, to: { x: number; y: number }): string {
  const dx = Math.abs(to.x - from.x);
  const cp = Math.max(dx * 0.4, 40);
  return `M ${from.x} ${from.y} C ${from.x + cp} ${from.y}, ${to.x - cp} ${to.y}, ${to.x} ${to.y}`;
}

export function JoinLine({ join, fromPos, toPos, isAuto, onUpdateType, onRemove }: JoinLineProps) {
  const pathD = useMemo(() => bezierPath(fromPos, toPos), [fromPos, toPos]);

  // Midpoint for the label
  const midX = (fromPos.x + toPos.x) / 2;
  const midY = (fromPos.y + toPos.y) / 2;

  return (
    <g data-testid={`qb-join-line-${join.id}`}>
      {/* The bezier path */}
      <path
        d={pathD}
        fill="none"
        stroke={isAuto ? 'var(--color-fg-muted)' : 'var(--color-accent)'}
        strokeWidth={isAuto ? 1.5 : 2}
        strokeDasharray={isAuto ? '6 4' : undefined}
        opacity={isAuto ? 0.6 : 0.9}
        className="pointer-events-auto cursor-pointer"
        style={{ transition: 'stroke 0.15s, opacity 0.15s' }}
      />

      {/* Animated dash overlay for confirmed joins */}
      {!isAuto && (
        <path
          d={pathD}
          fill="none"
          stroke="var(--color-accent)"
          strokeWidth={2}
          strokeDasharray="4 8"
          opacity={0.3}
        >
          <animate
            attributeName="stroke-dashoffset"
            from="0"
            to="-12"
            dur="1s"
            repeatCount="indefinite"
          />
        </path>
      )}

      {/* Label via foreignObject for rich HTML */}
      <foreignObject
        x={midX - 80}
        y={midY - 14}
        width={160}
        height={28}
        className="pointer-events-auto"
        style={{ overflow: 'visible' }}
      >
        <div>
          <JoinLabel join={join} onUpdateType={onUpdateType} onRemove={onRemove} />
        </div>
      </foreignObject>
    </g>
  );
}
