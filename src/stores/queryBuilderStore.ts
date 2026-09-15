import { create } from 'zustand';
import type {
  QbAggregate,
  QbCondition,
  QbConditionGroup,
  QbSortItem,
  QbColumnSelection,
  QbGroupByItem,
} from '../components/query-builder/types';

// ── Types ─────────────────────────────────────────────────────

/** Complete state of the visual query builder. */
export interface QueryBuilderState {
  /** Currently selected table names. */
  selectedTables: string[];
  /** Currently selected columns (with optional alias / aggregate). */
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
}

/** Actions mutating the query builder state. */
export interface QueryBuilderActions {
  toggleTable: (tableName: string) => void;
  toggleColumn: (table: string, column: string) => void;
  setColumnAlias: (table: string, column: string, alias: string) => void;
  setColumnAggregate: (table: string, column: string, agg: QbAggregate | undefined) => void;
  addCondition: (groupId: string, condition: Omit<QbCondition, 'id'>) => void;
  updateCondition: (id: string, patch: Partial<QbCondition>) => void;
  removeCondition: (id: string) => void;
  addConditionGroup: (parentId: string, logic: 'AND' | 'OR') => void;
  addSort: (item: QbSortItem) => void;
  removeSort: (index: number) => void;
  addGroupBy: (item: QbGroupByItem) => void;
  removeGroupBy: (index: number) => void;
  setDistinct: (v: boolean) => void;
  toggleOpen: () => void;
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

function updateConditionById(group: QbConditionGroup, id: string, patch: Partial<QbCondition>): QbConditionGroup {
  return {
    ...group,
    conditions: group.conditions.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    groups: group.groups.map((g) => updateConditionById(g, id, patch)),
  };
}

function addConditionToGroup(group: QbConditionGroup, groupId: string, condition: QbCondition): QbConditionGroup {
  if (group.id === groupId) {
    return { ...group, conditions: [...group.conditions, condition] };
  }
  return {
    ...group,
    groups: group.groups.map((g) => addConditionToGroup(g, groupId, condition)),
  };
}

function addSubGroup(group: QbConditionGroup, parentId: string, newGroup: QbConditionGroup): QbConditionGroup {
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

// ── Initial state ─────────────────────────────────────────────

const INITIAL_STATE: QueryBuilderState = {
  selectedTables: [],
  selectedColumns: [],
  where: emptyConditionGroup(),
  orderBy: [],
  groupBy: [],
  distinct: false,
  isOpen: false,
};

// ── Store ─────────────────────────────────────────────────────

export const useQueryBuilderStore = create<QueryBuilderState & QueryBuilderActions>()(
  (set) => ({
    ...INITIAL_STATE,

    toggleTable: (tableName) =>
      set((s) => {
        const tables = s.selectedTables.includes(tableName)
          ? s.selectedTables.filter((t) => t !== tableName)
          : [...s.selectedTables, tableName];
        // When removing a table, also remove its columns and condition references.
        if (s.selectedTables.includes(tableName)) {
          const cols = s.selectedColumns.filter((c) => c.table !== tableName);
          return { selectedTables: tables, selectedColumns: cols };
        }
        return { selectedTables: tables };
      }),

    toggleColumn: (table, column) =>
      set((s) => {
        const exists = s.selectedColumns.some((c) => c.table === table && c.column === column);
        if (exists) {
          return { selectedColumns: s.selectedColumns.filter((c) => !(c.table === table && c.column === column)) };
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

    reset: () => set(() => ({ ...INITIAL_STATE, where: emptyConditionGroup() })),
  }),
);
