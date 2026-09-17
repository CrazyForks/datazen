import { useRef } from 'react';
import { cn } from './cn';

export interface SliderProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  disabled?: boolean;
  'aria-label': string;
  onChange: (value: number) => void;
  className?: string;
}

/**
 * Design-system slider replacing the native input[type=range].
 * Dragging listens on the window so the thumb keeps following the pointer
 * outside the track, and keyboard steps adjust by `step`.
 */
export function Slider({
  value,
  min,
  max,
  step = 1,
  disabled,
  'aria-label': ariaLabel,
  onChange,
  className,
}: SliderProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const clamp = (next: number) => Math.min(max, Math.max(min, next));
  const percent = ((clamp(value) - min) / (max - min)) * 100;

  const valueFromPointer = (clientX: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return null;
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return clamp(min + Math.round((ratio * (max - min)) / step) * step);
  };

  const startDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled || e.button !== 0) return;
    const first = valueFromPointer(e.clientX);
    if (first !== undefined && first !== null) onChange(first);
    const move = (ev: PointerEvent) => {
      const next = valueFromPointer(ev.clientX);
      if (next !== null) onChange(next);
    };
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
  };

  return (
    <div
      ref={containerRef}
      role="slider"
      aria-label={ariaLabel}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={clamp(value)}
      aria-disabled={disabled}
      tabIndex={disabled ? -1 : 0}
      data-testid="slider"
      className={cn(
        'group relative flex h-9 flex-1 cursor-pointer touch-none select-none items-center',
        disabled && 'cursor-not-allowed opacity-50',
        className,
      )}
      onPointerDown={startDrag}
      onKeyDown={(e) => {
        if (disabled) return;
        const jump = { ArrowRight: step, ArrowUp: step, ArrowLeft: -step, ArrowDown: -step }[e.key];
        if (jump !== undefined) {
          e.preventDefault();
          onChange(clamp(value + jump));
        } else if (e.key === 'Home') {
          e.preventDefault();
          onChange(min);
        } else if (e.key === 'End') {
          e.preventDefault();
          onChange(max);
        }
      }}
    >
      <div className="h-1 w-full rounded-full bg-surface-raised">
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-75"
          style={{ width: `${percent}%` }}
        />
      </div>
      <div
        data-testid="slider-thumb"
        className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border border-edge-hi bg-surface shadow transition-[left] duration-75 group-hover:border-accent"
        style={{ left: `${percent}%` }}
      />
    </div>
  );
}
