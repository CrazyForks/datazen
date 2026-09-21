import type { Node, Edge } from '@xyflow/react';
import { MarkerType } from '@xyflow/react';
import type { TableSchema } from '../../../types';

const NODE_BASE_HEIGHT = 40;
const COL_HEIGHT = 24;
/**
 * Generous gutters: a smoothstep route needs room to turn, and two lines leaving
 * the same pair of tables need room to separate.
 */
const GAP_X = 400;
const GAP_Y = 90;

/** How an edge between two tables was established. */
export type ErRelationKind = 'declared' | 'predicted';

/**
 * A relationship the engine inferred rather than read from a constraint.
 *
 * Structurally a subset of the engine's `RelationCandidate`, redeclared here so
 * the graph builder does not depend on the prediction module for its input shape.
 */
export interface ErPredictedRelation {
  /** Stable id from the engine, so a dismissal could survive re-prediction. */
  id: string;
  fromTable: string;
  toTable: string;
  columnPairs: readonly { left: string; right: string }[];
  score: number;
  /**
   * Another table matched these columns just as well. The engine will not pick one
   * automatically, and the diagram must not present its guess as a certain one.
   */
  ambiguous?: boolean;
}

const DECLARED_COLOR = 'var(--c-accent, #3b82f6)';
const PREDICTED_COLOR = 'var(--c-warning, #e39a27)';
/** How quiet an ambiguous inference sits: still visible, never as loud as a constraint. */
const AMBIGUOUS_OPACITY = 0.3;
/**
 * A label that lands on top of another line has to knock that line out behind it.
 * React Flow's default chip is white, which disappears into the light theme's own
 * whiteness and glares in the dark one, so it is taken from the surface token.
 */
const LABEL_BG_STYLE = { fill: 'var(--c-surface, #ffffff)' };
const LABEL_BG_PADDING: [number, number] = [4, 2];
const LABEL_BG_RADIUS = 3;
/**
 * An arrowhead is painted by a `<marker>`, which the line's own opacity does not
 * reach: leaving it fully saturated would put a bright chevron on a faint line.
 * `color-mix` is already a baseline here (globals.css).
 */
const AMBIGUOUS_MARKER_COLOR = `color-mix(in oklab, ${PREDICTED_COLOR} ${AMBIGUOUS_OPACITY * 100}%, transparent)`;

/**
 * The column a line attaches to. Connection points live on rendered rows, so a
 * name the table does not report would drop the edge entirely.
 */
function handleColumn(schema: TableSchema | undefined, wanted: string | undefined): string {
  const columns = schema?.columns ?? [];
  if (columns.length === 0) return '';
  const needle = wanted?.toLowerCase();
  const match = needle ? columns.find((c) => c.name.toLowerCase() === needle) : undefined;
  return (match ?? columns[0]).name;
}

/**
 * Collapse a relationship the engine guessed in both directions into one edge.
 *
 * `a.user_id → b.user_id` and `b.user_id → a.user_id` are the same unknown link
 * seen twice; drawing both doubles the lines crossing the canvas without adding
 * information. The stronger-scoring direction wins.
 *
 * Exported because the stats readout must count the lines that are actually drawn.
 */
export function dedupeSymmetricPredictions(
  relations: readonly ErPredictedRelation[],
): ErPredictedRelation[] {
  const best = new Map<string, ErPredictedRelation>();
  for (const relation of relations) {
    const tables = [relation.fromTable, relation.toTable].sort();
    const columns = relation.columnPairs
      .flatMap((pair) => [pair.left, pair.right])
      .map((name) => name.toLowerCase())
      .sort()
      .join(',');
    const key = `${tables[0]}\u0000${tables[1]}\u0000${columns}`;
    const existing = best.get(key);
    if (!existing || relation.score > existing.score) best.set(key, relation);
  }
  return [...best.values()];
}

/**
 * Place related tables next to each other.
 *
 * An alphabetical grid can put two joined tables at opposite ends of the canvas,
 * and every line between them then has to travel over the whole diagram. Walking
 * out from the most connected table keeps each relationship short.
 */
function orderByConnectivity(
  schemas: readonly TableSchema[],
  adjacency: Map<string, Set<string>>,
): TableSchema[] {
  const byName = new Map(schemas.map((s) => [s.tableName, s]));
  const remaining = new Set(byName.keys());
  const degree = (name: string) => adjacency.get(name)?.size ?? 0;
  const rank = (names: string[]) =>
    [...names].sort((a, b) => degree(b) - degree(a) || (a < b ? -1 : a > b ? 1 : 0));

  const ordered: TableSchema[] = [];
  while (remaining.size > 0) {
    const queue = [rank([...remaining])[0]!];
    remaining.delete(queue[0]!);
    while (queue.length > 0) {
      const current = queue.shift()!;
      const schema = byName.get(current);
      if (schema) ordered.push(schema);
      for (const neighbour of rank(
        [...(adjacency.get(current) ?? [])].filter((n) => remaining.has(n)),
      )) {
        remaining.delete(neighbour);
        queue.push(neighbour);
      }
    }
  }
  return ordered;
}

/**
 * Build the ER diagram's nodes and edges.
 *
 * @param schemas    Every table in the database.
 * @param focusTable When set, only the focused table and its relations are shown.
 * @param predicted  Inferred relationships to draw in addition to the declared
 *   ones. They are dashed and amber so an inference is never mistaken for a
 *   constraint the database enforces.
 */
export function buildErGraph(
  schemas: TableSchema[],
  focusTable?: string,
  predicted: readonly ErPredictedRelation[] = [],
): { nodes: Node[]; edges: Edge[] } {
  // Both kinds mark their columns as foreign keys — a predicted one is a foreign
  // key in everything but the constraint.
  const fkColumns = new Set<string>();
  for (const schema of schemas) {
    for (const fk of schema.foreignKeys) {
      for (const col of fk.columns) fkColumns.add(`${schema.tableName}.${col}`);
    }
  }
  for (const relation of predicted) {
    for (const pair of relation.columnPairs) {
      fkColumns.add(`${relation.fromTable}.${pair.left}`);
    }
  }

  /** Tables related to `tableName`, by constraint or by inference. */
  const relationsOf = (tableName: string): string[] => {
    const related = new Set<string>();
    const schema = schemas.find((s) => s.tableName === tableName);
    for (const fk of schema?.foreignKeys ?? []) related.add(fk.referencedTable);
    for (const relation of predicted) {
      if (relation.fromTable === tableName) related.add(relation.toTable);
      else if (relation.toTable === tableName) related.add(relation.fromTable);
    }
    return [...related];
  };

  let visibleSchemas = schemas;
  if (focusTable) {
    const focusSchema = schemas.find((s) => s.tableName === focusTable);
    if (focusSchema) {
      const related = new Set<string>([focusTable, ...relationsOf(focusTable)]);
      for (const schema of schemas) {
        if (relationsOf(schema.tableName).includes(focusTable)) related.add(schema.tableName);
      }
      visibleSchemas = schemas.filter((s) => related.has(s.tableName));
    }
  }

  const visibleNames = new Set(visibleSchemas.map((s) => s.tableName));
  const schemaByName = new Map(visibleSchemas.map((s) => [s.tableName, s]));
  const predictions = dedupeSymmetricPredictions(
    predicted.filter((r) => visibleNames.has(r.fromTable) && visibleNames.has(r.toTable)),
  );

  /** Undirected table→table links, used only to lay the tables out. */
  const adjacency = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    if (a === b || !visibleNames.has(a) || !visibleNames.has(b)) return;
    for (const [from, to] of [
      [a, b],
      [b, a],
    ] as const) {
      const neighbours = adjacency.get(from) ?? new Set<string>();
      neighbours.add(to);
      adjacency.set(from, neighbours);
    }
  };
  for (const schema of visibleSchemas) {
    for (const fk of schema.foreignKeys) link(schema.tableName, fk.referencedTable);
  }
  for (const relation of predictions) link(relation.fromTable, relation.toTable);

  const laidOut = orderByConnectivity(visibleSchemas, adjacency);
  const cols = Math.max(1, Math.ceil(Math.sqrt(laidOut.length)));

  // A row is as tall as its tallest table; using each node's own height would make
  // the next row overlap whichever neighbour was shorter.
  const heightOf = (schema: TableSchema) => NODE_BASE_HEIGHT + schema.columns.length * COL_HEIGHT;
  const rowHeight = new Map<number, number>();
  laidOut.forEach((schema, i) => {
    const row = Math.floor(i / cols);
    rowHeight.set(row, Math.max(rowHeight.get(row) ?? 0, heightOf(schema)));
  });
  const rowOffset = (row: number) => {
    let y = 0;
    for (let r = 0; r < row; r++) y += (rowHeight.get(r) ?? 0) + GAP_Y;
    return y;
  };

  const nodes: Node[] = laidOut.map((schema, i) => {
    const row = Math.floor(i / cols);
    const col = i % cols;

    return {
      id: schema.tableName,
      type: 'tableNode',
      position: { x: col * GAP_X, y: rowOffset(row) },
      data: {
        tableName: schema.tableName,
        columns: schema.columns.map((c) => ({
          name: c.name,
          type: c.dataType,
          isPk: c.isPrimaryKey ?? schema.primaryKeys.includes(c.name),
          isFk: fkColumns.has(`${schema.tableName}.${c.name}`),
        })),
        highlighted: schema.tableName === focusTable,
      },
    };
  });

  const edges: Edge[] = [];

  for (const schema of visibleSchemas) {
    for (const fk of schema.foreignKeys) {
      if (!visibleNames.has(fk.referencedTable)) continue;
      // A composite key still draws as one line, anchored on its first column and
      // labelled with all of them.
      const fromColumn = handleColumn(schema, fk.columns[0]);
      const toColumn = handleColumn(schemaByName.get(fk.referencedTable), fk.referencedColumns[0]);
      edges.push({
        id: `${schema.tableName}-${fk.name}`,
        source: schema.tableName,
        target: fk.referencedTable,
        sourceHandle: fromColumn ? `s:${fromColumn}` : undefined,
        targetHandle: toColumn ? `t:${toColumn}` : undefined,
        label: fk.columns.join(', '),
        type: 'smoothstep',
        animated: true,
        style: { stroke: DECLARED_COLOR },
        markerEnd: { type: MarkerType.ArrowClosed, color: DECLARED_COLOR },
        labelStyle: { fontSize: 10, fill: 'var(--c-fg-muted, #888)' },
        labelBgStyle: LABEL_BG_STYLE,
        labelBgPadding: LABEL_BG_PADDING,
        labelBgBorderRadius: LABEL_BG_RADIUS,
        data: { kind: 'declared' satisfies ErRelationKind },
      });
    }
  }

  for (const relation of predictions) {
    const ambiguous = relation.ambiguous === true;
    const fromColumn = handleColumn(
      schemaByName.get(relation.fromTable),
      relation.columnPairs[0]?.left,
    );
    const toColumn = handleColumn(
      schemaByName.get(relation.toTable),
      relation.columnPairs[0]?.right,
    );
    edges.push({
      // The engine's id already encodes both tables and every column pair, so it
      // is stable across re-prediction and unique among sibling edges.
      id: relation.id,
      source: relation.fromTable,
      target: relation.toTable,
      sourceHandle: fromColumn ? `s:${fromColumn}` : undefined,
      targetHandle: toColumn ? `t:${toColumn}` : undefined,
      // The line now says which column it joins by touching its row, so an
      // ambiguous guess carries no label: a clique of identical labels is
      // precisely what made this diagram unreadable.
      label: ambiguous ? undefined : relation.columnPairs.map((pair) => pair.left).join(', '),
      type: 'smoothstep',
      // Not animated and dashed: this relationship is inferred, and the diagram
      // must not present it with the same certainty as a constraint.
      animated: false,
      style: {
        stroke: PREDICTED_COLOR,
        strokeDasharray: ambiguous ? '2 5' : '4 3',
        opacity: ambiguous ? AMBIGUOUS_OPACITY : 1,
      },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: ambiguous ? AMBIGUOUS_MARKER_COLOR : PREDICTED_COLOR,
      },
      labelStyle: { fontSize: 10, fill: PREDICTED_COLOR },
      labelBgStyle: LABEL_BG_STYLE,
      labelBgPadding: LABEL_BG_PADDING,
      labelBgBorderRadius: LABEL_BG_RADIUS,
      data: {
        kind: 'predicted' satisfies ErRelationKind,
        score: relation.score,
        ambiguous,
      },
    });
  }

  return { nodes, edges };
}
