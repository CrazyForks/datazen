/**
 * Layered (Sugiyama-style) layout for the ER diagram, via dagre.
 *
 * ## Why not a grid
 *
 * The previous layout placed table *i* at `(i % cols) * 300, floor(i / cols) * height`
 * in the order the backend returned them — which is `ORDER BY relname`, i.e. the
 * alphabet. Nothing about that relates to the foreign keys, so:
 *
 * - Related tables landed wherever their names fell. A hub and its five children
 *   scattered across three rows.
 * - The row's `y` used the *node's own* height, so nodes in one row sat at
 *   different heights — measured 672px of spread in a 12-table diagram — and a wide
 *   table above a narrow one **overlapped it by 192px**.
 * - Edges were routed across unrelated nodes: 10 edges crossed 18 unrelated node
 *   bands in a realistic 12-table shape, and React Flow draws edges *under* nodes,
 *   so the crossings were hidden rather than merely messy.
 *
 * A layered layout fixes the cause rather than the symptoms: it ranks tables by the
 * direction of the foreign keys, so a child is placed next to the parent it points
 * at, and it minimises crossings by construction.
 *
 * ## Why `LR`
 *
 * Edges run child → parent (the child holds the foreign key). With `rankdir: 'LR'`
 * dagre puts the parent at a higher rank, i.e. to the **right**, so an edge leaves
 * the child's right side and enters the parent's left side. That matches the
 * handles `TableNode` already renders (`source` on the right, `target` on the
 * left), so the common edge is a straight horizontal run instead of the S-curve
 * that 7-in-10 edges previously drew.
 */

import dagre from '@dagrejs/dagre';
import type { Edge, Node } from '@xyflow/react';

/** Gap between nodes in the same rank. */
const NODE_SEP = 40;
/** Gap between ranks — the horizontal band each layer occupies. */
const RANK_SEP = 110;
/** Gap between edges sharing a rank span. */
const EDGE_SEP = 20;
/** Padding around the whole graph, so nothing sits on the canvas edge. */
export const ER_LAYOUT_MARGIN = 24;

/** A declared constraint should shape the diagram more than an inference does. */
const DECLARED_WEIGHT = 2;
const PREDICTED_WEIGHT = 1;

export interface ErLayoutOptions {
  /** `LR` (default) puts referenced tables to the right; `TB` puts them below. */
  direction?: 'LR' | 'TB';
}

function byId(a: { id: string }, b: { id: string }): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Read the layout weight of an edge from the kind the graph builder tagged it with. */
function edgeWeight(edge: Edge): number {
  const kind = (edge.data as { kind?: string } | undefined)?.kind;
  return kind === 'predicted' ? PREDICTED_WEIGHT : DECLARED_WEIGHT;
}

/**
 * Position `nodes` and `edges` with a layered layout.
 *
 * Nodes must already carry `width` and `height`; the layout cannot infer them, and
 * guessing is what the previous grid got wrong. Returns new node objects — the
 * input is not mutated.
 *
 * Disconnected tables are laid out too, in their own components, rather than being
 * dropped or stacked at the origin.
 */
export function layoutErGraph(
  nodes: readonly Node[],
  edges: readonly Edge[],
  options: ErLayoutOptions = {},
): Node[] {
  if (nodes.length === 0) return [];

  const graph = new dagre.graphlib.Graph({ multigraph: true, compound: false });
  graph.setGraph({
    rankdir: options.direction ?? 'LR',
    nodesep: NODE_SEP,
    ranksep: RANK_SEP,
    edgesep: EDGE_SEP,
    marginx: ER_LAYOUT_MARGIN,
    marginy: ER_LAYOUT_MARGIN,
  });
  graph.setDefaultEdgeLabel(() => ({}));

  // dagre's result depends on insertion order, so insert sorted to make the same
  // schema always produce the same diagram. The returned array keeps the caller's
  // order — this only fixes the coordinates, not the z-order React Flow draws in.
  for (const node of [...nodes].sort(byId)) {
    graph.setNode(node.id, { width: node.width ?? 0, height: node.height ?? 0 });
  }

  const known = new Set(nodes.map((n) => n.id));
  for (const edge of [...edges].sort(byId)) {
    // An edge to a table that is not on the canvas (filtered out by focus mode)
    // would otherwise make dagre invent a node for it.
    if (!known.has(edge.source) || !known.has(edge.target)) continue;
    // The edge id doubles as dagre's multigraph name, so two relationships
    // between the same pair stay two distinct edges.
    graph.setEdge(edge.source, edge.target, { weight: edgeWeight(edge) }, edge.id);
  }

  dagre.layout(graph);

  return nodes.map((node) => {
    const placed = graph.node(node.id) as { x: number; y: number } | undefined;
    // A node dagre never saw cannot be positioned; leave it rather than emit NaN.
    if (!placed) return node;
    // dagre reports centres; React Flow positions by the top-left corner.
    return {
      ...node,
      position: {
        x: Math.round(placed.x - (node.width ?? 0) / 2),
        y: Math.round(placed.y - (node.height ?? 0) / 2),
      },
    };
  });
}
