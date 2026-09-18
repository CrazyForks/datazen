import { create } from 'zustand';
import type {
  QbAggregate,
  QbCondition,
  QbConditionGroup,
  QbSortItem,
  QbColumnSelection,
  QbGroupByItem,
  QbColumnPair,
  QbJoin,
  QbJoinType,
} from '../components/query-builder/types';

// ── Types ─────────────────────────────────────────────────────

/** Complete state of the visual query builder. */
export interface QueryBuilderState {
  /** Currently selected table names. */
  selectedTables: string[];
  /** Currently selected columns (with optional alias / aggregate / sort / groupBy / where). */
  selectedColumns: QbColumnSelection[];
  /** WHERE clause root group. */
  where: QbConditionGroup;
  /** ORDER BY items. */
  orderBy: QbSortItem[];
  /** GROUP BY items. */
  groupBy: QbGroupByItem[];
  /** Whether DISTINCT is applied. */
  distinct: boolean;
  /** Whether the builder panel is open. */
  isOpen: boolean;

  // ── JOIN state ──
  /** Manually confirmed JOINs. */
  joins: QbJoin[];
  /** Auto-detected FK relationship JOINs (dashed lines in UI). */
  autoJoins: QbJoin[];
  /** Auto-join ids the user removed; suppressed from the effective join set. */
  removedAutoJoinIds: string[];
  /** Per-auto-join type overrides keyed by auto-join id. */
  autoJoinTypes: Record<string, QbJoinType>;
  /**
   * First half of a column-to-column manual JOIN: the column the user clicked
   * and is waiting to pair with a column of another table. `null` = idle.
   */
  joinAnchor: { table: string; column: string } | null;

  // ── Table metadata ──
  /** Table alias mapping (tableName → alias). */
  tableAliases: Record<string, string>;
  /** Canvas position of each table card. */
  tablePositions: Record<string, { x: number; y: number }>;

  // ── Canvas state ──
  /** Canvas pan offset. */
  canvasOffset: { x: number; y: number };
  /** Canvas zoom level. */
  zoom: number;

  // ── Pagination ──
  /** LIMIT clause value (null = no limit). */
  limit: number | null;
  /** OFFSET clause value (null = no offset). */
  offset: number | null;
}

/** Actions mutating the query builder state. */
export interface QueryBuilderActions {
  toggleTable: (tableName: string) => void;
  toggleColumn: (table: string, column: string) => void;
  setColumnAlias: (table: string, column: string, alias: string) => void;
  setColumnAggregate: (table: string, column: string, agg: QbAggregate | undefined) => void;
  /** Generic patch for any QbColumnSelection fields (alias, aggregate, sort, groupBy, where). */
  updateColumnConfig: (table: string, column: string, patch: Partial<QbColumnSelection>) => void;
  addCondition: (groupId: string, condition: Omit<QbCondition, 'id'>) => void;
  updateCondition: (id: string, patch: Partial<QbCondition>) => void;
  removeCondition: (id: string) => void;
  addConditionGroup: (parentId: string, logic: 'AND' | 'OR') => void;
  /** Change the AND/OR logic of an existing group (root or nested). */
  updateConditionGroupLogic: (id: string, logic: 'AND' | 'OR') => void;
  /** Remove a nested condition group (no-op for the root group). */
  removeConditionGroup: (id: string) => void;
  addSort: (item: QbSortItem) => void;
  removeSort: (index: number) => void;
  addGroupBy: (item: QbGroupByItem) => void;
  removeGroupBy: (index: number) => void;
  setDistinct: (v: boolean) => void;
  toggleOpen: () => void;

  // ── JOIN actions ──
  addJoin: (join: Omit<QbJoin, 'id'>) => void;
  removeJoin: (id: string) => void;
  updateJoinType: (id: string, type: QbJoinType) => void;
  /** Arm/disarm the column-to-column JOIN anchor (pass null to cancel). */
  setJoinAnchor: (anchor: { table: string; column: string } | null) => void;
  /**
   * Column-to-column manual JOIN, driven by clicking a column on a table card.
   *
   * State machine:
   * - idle + click            → arm the clicked column
   * - armed + same column     → disarm (a second click cancels)
   * - armed + same table      → move the anchor (a table cannot join to itself)
   * - armed + other table     → create the manual JOIN and disarm
   *
   * Creating a JOIN for a column pair that already has one is a no-op rather
   * than a duplicate.
   */
  clickJoinColumn: (table: string, column: string) => void;

  // ── Table metadata actions ──
  setTableAlias: (tableName: string, alias: string) => void;
  updateTablePosition: (table: string, pos: { x: number; y: number }) => void;

  // ── Canvas actions ──
  setZoom: (zoom: number) => void;
  setCanvasOffset: (offset: { x: number; y: number }) => void;

  // ── Pagination actions ──
  setLimit: (limit: number | null) => void;
  setOffset: (offset: number | null) => void;

  reset: () => void;
}

// ── Helpers ───────────────────────────────────────────────────

function uid(): string {
  return crypto.randomUUID();
}

function removeConditionById(group: QbConditionGroup, id: string): QbConditionGroup {
  return {
    ...group,
    conditions: group.conditions.filter((c) => c.id !== id),
    groups: group.groups.map((g) => removeConditionById(g, id)),
  };
}

function updateConditionById(
  group: QbConditionGroup,
  id: string,
  patch: Partial<QbCondition>,
): QbConditionGroup {
  return {
    ...group,
    conditions: group.conditions.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    groups: group.groups.map((g) => updateConditionById(g, id, patch)),
  };
}

function addConditionToGroup(
  group: QbConditionGroup,
  groupId: string,
  condition: QbCondition,
): QbConditionGroup {
  if (group.id === groupId) {
    return { ...group, conditions: [...group.conditions, condition] };
  }
  return {
    ...group,
    groups: group.groups.map((g) => addConditionToGroup(g, groupId, condition)),
  };
}

function addSubGroup(
  group: QbConditionGroup,
  parentId: string,
  newGroup: QbConditionGroup,
): QbConditionGroup {
  if (group.id === parentId) {
    return { ...group, groups: [...group.groups, newGroup] };
  }
  return {
    ...group,
    groups: group.groups.map((g) => addSubGroup(g, parentId, newGroup)),
  };
}

function emptyConditionGroup(): QbConditionGroup {
  return { id: uid(), logic: 'AND', conditions: [], groups: [] };
}

function updateGroupLogicById(
  group: QbConditionGroup,
  id: string,
  logic: 'AND' | 'OR',
): QbConditionGroup {
  return {
    ...group,
    logic: group.id === id ? logic : group.logic,
    groups: group.groups.map((g) => updateGroupLogicById(g, id, logic)),
  };
}

/**
 * Drop a nested group by id. The root group is never removed — removing the
 * whole WHERE clause is what `reset` is for.
 */
function removeGroupById(group: QbConditionGroup, id: string): QbConditionGroup {
  return {
    ...group,
    groups: group.groups.filter((g) => g.id !== id).map((g) => removeGroupById(g, id)),
  };
}

/**
 * Order-insensitive identity of a join (ignores id/type/isManual).
 *
 * Every column pair takes part: two joins between the same tables over different
 * columns are different relationships, and collapsing them would let a manual
 * join silently suppress an unrelated auto join.
 */
function joinPairKey(join: QbJoin): string {
  const side = (table: string, pair: (p: QbColumnPair) => string) =>
    `${table}\u0000${join.columnPairs.map(pair).sort().join('\u0002')}`;
  const left = side(join.leftTable, (p) => p.left);
  const right = side(join.rightTable, (p) => p.right);
  return left <= right ? `${left}\u0001${right}` : `${right}\u0001${left}`;
}

/**
 * The join set actually used for rendering *and* SQL generation.
 *
 * Auto-detected FK joins are merged in here so the canvas and the generated SQL
 * can never disagree. Manual joins win over an auto join covering the same
 * column pair, dismissed auto joins are dropped, and per-join type overrides are
 * applied.
 */
export function mergeJoins(
  joins: QbJoin[],
  autoJoins: QbJoin[],
  removedAutoJoinIds: string[],
  autoJoinTypes: Record<string, QbJoinType>,
): QbJoin[] {
  const removed = new Set(removedAutoJoinIds);
  const manualPairs = new Set(joins.map(joinPairKey));
  const effectiveAuto = autoJoins
    .filter((join) => !removed.has(join.id) && !manualPairs.has(joinPairKey(join)))
    .map((join) => {
      const override = autoJoinTypes[join.id];
      return override ? { ...join, type: override } : join;
    });
  // Auto joins first so manual ones draw on top of them.
  return [...effectiveAuto, ...joins];
}

// ── Initial state ─────────────────────────────────────────────

const INITIAL_STATE: QueryBuilderState = {
  selectedTables: [],
  selectedColumns: [],
  where: emptyConditionGroup(),
  orderBy: [],
  groupBy: [],
  distinct: false,
  isOpen: false,
  joins: [],
  autoJoins: [],
  removedAutoJoinIds: [],
  autoJoinTypes: {},
  joinAnchor: null,
  tableAliases: {},
  tablePositions: {},
  canvasOffset: { x: 0, y: 0 },
  zoom: 1,
  limit: null,
  offset: null,
};

// ── Store ─────────────────────────────────────────────────────

export const useQueryBuilderStore = create<QueryBuilderState & QueryBuilderActions>()((set) => ({
  ...INITIAL_STATE,

  toggleTable: (tableName) =>
    set((s) => {
      const tables = s.selectedTables.includes(tableName)
        ? s.selectedTables.filter((t) => t !== tableName)
        : [...s.selectedTables, tableName];
      // When removing a table, also remove its columns and condition references.
      if (s.selectedTables.includes(tableName)) {
        const cols = s.selectedColumns.filter((c) => c.table !== tableName);
        // An anchor on the departing table can never be completed.
        const joinAnchor = s.joinAnchor?.table === tableName ? null : s.joinAnchor;
        return { selectedTables: tables, selectedColumns: cols, joinAnchor };
      }
      return { selectedTables: tables };
    }),

  toggleColumn: (table, column) =>
    set((s) => {
      const exists = s.selectedColumns.some((c) => c.table === table && c.column === column);
      if (exists) {
        return {
          selectedColumns: s.selectedColumns.filter(
            (c) => !(c.table === table && c.column === column),
          ),
        };
      }
      return { selectedColumns: [...s.selectedColumns, { table, column }] };
    }),

  setColumnAlias: (table, column, alias) =>
    set((s) => ({
      selectedColumns: s.selectedColumns.map((c) =>
        c.table === table && c.column === column ? { ...c, alias: alias || undefined } : c,
      ),
    })),

  setColumnAggregate: (table, column, agg) =>
    set((s) => ({
      selectedColumns: s.selectedColumns.map((c) =>
        c.table === table && c.column === column ? { ...c, aggregate: agg } : c,
      ),
    })),

  updateColumnConfig: (table, column, patch) =>
    set((s) => ({
      selectedColumns: s.selectedColumns.map((c) => {
        if (c.table !== table || c.column !== column) return c;
        const updated = { ...c, ...patch };
        // Normalise: empty alias → undefined, empty string where → remove
        if (updated.alias === '') updated.alias = undefined;
        return updated;
      }),
    })),

  addCondition: (groupId, condition) =>
    set((s) => ({
      where: addConditionToGroup(s.where, groupId, { ...condition, id: uid() }),
    })),

  updateCondition: (id, patch) =>
    set((s) => ({
      where: updateConditionById(s.where, id, patch),
    })),

  removeCondition: (id) =>
    set((s) => ({
      where: removeConditionById(s.where, id),
    })),

  addConditionGroup: (parentId, logic) =>
    set((s) => ({
      where: addSubGroup(s.where, parentId, {
        id: uid(),
        logic,
        conditions: [],
        groups: [],
      }),
    })),

  updateConditionGroupLogic: (id, logic) =>
    set((s) => ({
      where: updateGroupLogicById(s.where, id, logic),
    })),

  removeConditionGroup: (id) =>
    set((s) => ({
      where: removeGroupById(s.where, id),
    })),

  addSort: (item) =>
    set((s) => ({
      orderBy: [...s.orderBy, item],
    })),

  removeSort: (index) =>
    set((s) => ({
      orderBy: s.orderBy.filter((_, i) => i !== index),
    })),

  addGroupBy: (item) =>
    set((s) => ({
      groupBy: [...s.groupBy, item],
    })),

  removeGroupBy: (index) =>
    set((s) => ({
      groupBy: s.groupBy.filter((_, i) => i !== index),
    })),

  setDistinct: (v) => set(() => ({ distinct: v })),

  toggleOpen: () => set((s) => ({ isOpen: !s.isOpen })),

  // ── JOIN actions ──

  addJoin: (join) =>
    set((s) => ({
      joins: [...s.joins, { ...join, id: uid() }],
    })),

  removeJoin: (id) =>
    set((s) => {
      const isAuto = s.autoJoins.some((j) => j.id === id);
      return {
        joins: s.joins.filter((j) => j.id !== id),
        // An auto join cannot be deleted from `autoJoins` — FK detection would
        // re-add it — so remember the dismissal instead.
        removedAutoJoinIds: isAuto
          ? [...new Set([...s.removedAutoJoinIds, id])]
          : s.removedAutoJoinIds,
      };
    }),

  updateJoinType: (id, type) =>
    set((s) => {
      const isAuto = s.autoJoins.some((j) => j.id === id);
      return {
        joins: s.joins.map((j) => (j.id === id ? { ...j, type } : j)),
        autoJoinTypes: isAuto ? { ...s.autoJoinTypes, [id]: type } : s.autoJoinTypes,
      };
    }),

  setJoinAnchor: (anchor) => set(() => ({ joinAnchor: anchor })),

  clickJoinColumn: (table, column) =>
    set((s) => {
      const anchor = s.joinAnchor;

      // Idle → arm. Re-clicking the armed column → cancel.
      if (!anchor) return { joinAnchor: { table, column } };
      if (anchor.table === table && anchor.column === column) return { joinAnchor: null };
      // A table cannot be joined to itself — move the anchor instead.
      if (anchor.table === table) return { joinAnchor: { table, column } };

      const candidate: Omit<QbJoin, 'id'> = {
        type: 'INNER',
        leftTable: anchor.table,
        rightTable: table,
        columnPairs: [{ left: anchor.column, right: column }],
        isManual: true,
      };
      const key = joinPairKey({ ...candidate, id: '' });
      const duplicate = s.joins.some((j) => joinPairKey(j) === key);
      return {
        joinAnchor: null,
        joins: duplicate ? s.joins : [...s.joins, { ...candidate, id: uid() }],
      };
    }),

  // ── Table metadata actions ──

  setTableAlias: (tableName, alias) =>
    set((s) => ({
      tableAliases: { ...s.tableAliases, [tableName]: alias },
    })),

  updateTablePosition: (table, pos) =>
    set((s) => ({
      tablePositions: { ...s.tablePositions, [table]: pos },
    })),

  // ── Canvas actions ──

  setZoom: (zoom) => set(() => ({ zoom })),

  setCanvasOffset: (offset) => set(() => ({ canvasOffset: offset })),

  // ── Pagination actions ──

  setLimit: (limit) => set(() => ({ limit })),

  setOffset: (offset) => set(() => ({ offset })),

  reset: () =>
    set((s) => ({
      ...INITIAL_STATE,
      isOpen: s.isOpen,
      where: emptyConditionGroup(),
    })),
}));

// Expose store for E2E tests (WebKit DragEvent doesn't fire React synthetic handlers)
if (typeof window !== 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).__qbStore = useQueryBuilderStore;
}
