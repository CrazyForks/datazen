import { useCallback, useState, type MouseEvent as ReactMouseEvent } from 'react';

/**
 * Draggable tree/detail split of 屏 B (PRD §3.2 left column width).
 *
 * State machine (AGENTS.md 「状态机三要素」):
 *  - enter: `pointerdown` on the separator;
 *  - during: every `pointermove` clamps the new width into [{@link MIN_TREE_WIDTH},
 *    {@link MAX_TREE_WIDTH}];
 *  - exit: `pointerup` removes **both** listeners, so a release anywhere
 *    (including outside the window's tree pane) ends the drag — no one-way latch.
 *
 * The width is component state on purpose: persisting it is a Wave 4 concern
 * (same as the container-query breakpoints, PRD §4 I-10).
 */

export const DEFAULT_TREE_WIDTH = 360;
export const MIN_TREE_WIDTH = 220;
export const MAX_TREE_WIDTH = 900;

export function clampTreeWidth(next: number): number {
  if (!Number.isFinite(next)) return DEFAULT_TREE_WIDTH;
  return Math.min(MAX_TREE_WIDTH, Math.max(MIN_TREE_WIDTH, Math.round(next)));
}

export function useWorkbenchSplit(initial: number = DEFAULT_TREE_WIDTH) {
  const [treeWidth, setTreeWidth] = useState(() => clampTreeWidth(initial));

  const startSplitDrag = useCallback(
    (e: ReactMouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = treeWidth;
      const onMove = (ev: globalThis.MouseEvent) => {
        setTreeWidth(clampTreeWidth(startWidth + ev.clientX - startX));
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [treeWidth],
  );

  return { treeWidth, setTreeWidth, startSplitDrag };
}
