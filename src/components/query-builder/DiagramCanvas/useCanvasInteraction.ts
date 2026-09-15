import { useCallback, useEffect, useRef, useState } from 'react';

/** Zoom/pan state and handlers for the diagram canvas. */
export interface CanvasInteraction {
  zoom: number;
  canvasOffset: { x: number; y: number };
  handleZoom: (e: React.WheelEvent) => void;
  handlePointerDown: (e: React.PointerEvent) => void;
  handlePointerMove: (e: React.PointerEvent) => void;
  handlePointerUp: () => void;
  screenToCanvas: (
    screenX: number,
    screenY: number,
    containerRect: DOMRect,
  ) => { x: number; y: number };
  isPanning: boolean;
}

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2;
const ZOOM_STEP = 0.1;

export function useCanvasInteraction(
  zoom: number,
  canvasOffset: { x: number; y: number },
  onZoomChange: (zoom: number) => void,
  onOffsetChange: (offset: { x: number; y: number }) => void,
): CanvasInteraction {
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef<{ x: number; y: number; offsetX: number; offsetY: number } | null>(
    null,
  );
  const spaceHeldRef = useRef(false);

  // Track space key for pan mode
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        e.code === 'Space' &&
        !e.repeat &&
        !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)
      ) {
        e.preventDefault();
        spaceHeldRef.current = true;
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        spaceHeldRef.current = false;
        setIsPanning(false);
        panStartRef.current = null;
      }
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  const handleZoom = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
      const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom + delta));
      if (next !== zoom) {
        onZoomChange(next);
      }
    },
    [zoom, onZoomChange],
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      // Middle button always pans; left button only pans when space is held
      if (e.button === 1 || (e.button === 0 && spaceHeldRef.current)) {
        e.preventDefault();
        setIsPanning(true);
        panStartRef.current = {
          x: e.clientX,
          y: e.clientY,
          offsetX: canvasOffset.x,
          offsetY: canvasOffset.y,
        };
      }
    },
    [canvasOffset],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isPanning || !panStartRef.current) return;
      const dx = e.clientX - panStartRef.current.x;
      const dy = e.clientY - panStartRef.current.y;
      onOffsetChange({
        x: panStartRef.current.offsetX + dx,
        y: panStartRef.current.offsetY + dy,
      });
    },
    [isPanning, onOffsetChange],
  );

  const handlePointerUp = useCallback(() => {
    setIsPanning(false);
    panStartRef.current = null;
  }, []);

  const screenToCanvas = useCallback(
    (screenX: number, screenY: number, containerRect: DOMRect) => {
      return {
        x: (screenX - containerRect.left - canvasOffset.x) / zoom,
        y: (screenY - containerRect.top - canvasOffset.y) / zoom,
      };
    },
    [zoom, canvasOffset],
  );

  return {
    zoom,
    canvasOffset,
    handleZoom,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    screenToCanvas,
    isPanning,
  };
}
