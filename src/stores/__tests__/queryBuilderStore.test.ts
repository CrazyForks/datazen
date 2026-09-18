import { describe, it, expect, beforeEach } from 'vitest';
import { useQueryBuilderStore, mergeJoins } from '../queryBuilderStore';
import type {
  QbCondition,
  QbConditionGroup,
  QbJoin,
  QbJoinType,
} from '../../components/query-builder/types';

// ── Helpers ───────────────────────────────────────────────────

function getSnapshot() {
  return useQueryBuilderStore.getState();
}

function reset() {
  useQueryBuilderStore.setState(useQueryBuilderStore.getInitialState());
}

/** An FK-detected join as `useAutoJoin` would produce it. */
function makeAutoJoin(): QbJoin {
  return {
    id: 'auto-users.id-orders.user_id',
    type: 'INNER',
    leftTable: 'users',
    leftColumn: 'id',
    rightTable: 'orders',
    rightColumn: 'user_id',
    isManual: false,
  };
}

// ── Tests ─────────────────────────────────────────────────────

describe('queryBuilderStore', () => {
  beforeEach(() => {
    reset();
  });

  // ── Initial state ──────────────────────────────────────────

  describe('initial state', () => {
    it('has empty selectedTables', () => {
      expect(getSnapshot().selectedTables).toEqual([]);
    });

    it('has empty selectedColumns', () => {
      expect(getSnapshot().selectedColumns).toEqual([]);
    });

    it('has empty orderBy', () => {
      expect(getSnapshot().orderBy).toEqual([]);
    });

    it('has empty groupBy', () => {
      expect(getSnapshot().groupBy).toEqual([]);
    });

    it('has distinct false', () => {
      expect(getSnapshot().distinct).toBe(false);
    });

    it('has isOpen false', () => {
      expect(getSnapshot().isOpen).toBe(false);
    });

    it('has an empty WHERE root group', () => {
      const where = getSnapshot().where;
      expect(where.logic).toBe('AND');
      expect(where.conditions).toEqual([]);
      expect(where.groups).toEqual([]);
    });
  });

  // ── toggleTable ────────────────────────────────────────────

  describe('toggleTable', () => {
    it('adds a table when not already selected', () => {
      useQueryBuilderStore.getState().toggleTable('users');
      expect(getSnapshot().selectedTables).toEqual(['users']);
    });

    it('adds multiple tables', () => {
      useQueryBuilderStore.getState().toggleTable('users');
      useQueryBuilderStore.getState().toggleTable('orders');
      expect(getSnapshot().selectedTables).toEqual(['users', 'orders']);
    });

    it('removes a table when already selected', () => {
      useQueryBuilderStore.getState().toggleTable('users');
      useQueryBuilderStore.getState().toggleTable('users');
      expect(getSnapshot().selectedTables).toEqual([]);
    });

    it('removes a table and its columns from selectedColumns', () => {
      useQueryBuilderStore.getState().toggleTable('users');
      useQueryBuilderStore.getState().toggleColumn('users', 'id');
      useQueryBuilderStore.getState().toggleColumn('users', 'name');
      useQueryBuilderStore.getState().toggleTable('users');
      expect(getSnapshot().selectedColumns).toEqual([]);
    });

    it('does not remove columns from other tables when removing a table', () => {
      useQueryBuilderStore.getState().toggleTable('users');
      useQueryBuilderStore.getState().toggleTable('orders');
      useQueryBuilderStore.getState().toggleColumn('users', 'id');
      useQueryBuilderStore.getState().toggleColumn('orders', 'total');
      useQueryBuilderStore.getState().toggleTable('users');
      expect(getSnapshot().selectedColumns).toEqual([{ table: 'orders', column: 'total' }]);
    });
  });

  // ── toggleColumn ───────────────────────────────────────────

  describe('toggleColumn', () => {
    it('adds a column', () => {
      useQueryBuilderStore.getState().toggleColumn('users', 'id');
      expect(getSnapshot().selectedColumns).toEqual([{ table: 'users', column: 'id' }]);
    });

    it('adds multiple columns', () => {
      useQueryBuilderStore.getState().toggleColumn('users', 'id');
      useQueryBuilderStore.getState().toggleColumn('users', 'name');
      expect(getSnapshot().selectedColumns).toEqual([
        { table: 'users', column: 'id' },
        { table: 'users', column: 'name' },
      ]);
    });

    it('removes an already-selected column', () => {
      useQueryBuilderStore.getState().toggleColumn('users', 'id');
      useQueryBuilderStore.getState().toggleColumn('users', 'id');
      expect(getSnapshot().selectedColumns).toEqual([]);
    });

    it('does not affect other columns', () => {
      useQueryBuilderStore.getState().toggleColumn('users', 'id');
      useQueryBuilderStore.getState().toggleColumn('users', 'name');
      useQueryBuilderStore.getState().toggleColumn('users', 'id');
      expect(getSnapshot().selectedColumns).toEqual([{ table: 'users', column: 'name' }]);
    });
  });

  // ── setColumnAlias ─────────────────────────────────────────

  describe('setColumnAlias', () => {
    it('sets alias on an existing column', () => {
      useQueryBuilderStore.getState().toggleColumn('users', 'id');
      useQueryBuilderStore.getState().setColumnAlias('users', 'id', 'user_id');
      expect(getSnapshot().selectedColumns[0].alias).toBe('user_id');
    });

    it('clears alias when empty string is passed', () => {
      useQueryBuilderStore.getState().toggleColumn('users', 'id');
      useQueryBuilderStore.getState().setColumnAlias('users', 'id', 'user_id');
      useQueryBuilderStore.getState().setColumnAlias('users', 'id', '');
      expect(getSnapshot().selectedColumns[0].alias).toBeUndefined();
    });

    it('does not affect other columns', () => {
      useQueryBuilderStore.getState().toggleColumn('users', 'id');
      useQueryBuilderStore.getState().toggleColumn('users', 'name');
      useQueryBuilderStore.getState().setColumnAlias('users', 'id', 'uid');
      expect(getSnapshot().selectedColumns[0].alias).toBe('uid');
      expect(getSnapshot().selectedColumns[1].alias).toBeUndefined();
    });
  });

  // ── setColumnAggregate ─────────────────────────────────────

  describe('setColumnAggregate', () => {
    it('sets aggregate on an existing column', () => {
      useQueryBuilderStore.getState().toggleColumn('orders', 'total');
      useQueryBuilderStore.getState().setColumnAggregate('orders', 'total', 'SUM');
      expect(getSnapshot().selectedColumns[0].aggregate).toBe('SUM');
    });

    it('clears aggregate when undefined is passed', () => {
      useQueryBuilderStore.getState().toggleColumn('orders', 'total');
      useQueryBuilderStore.getState().setColumnAggregate('orders', 'total', 'SUM');
      useQueryBuilderStore.getState().setColumnAggregate('orders', 'total', undefined);
      expect(getSnapshot().selectedColumns[0].aggregate).toBeUndefined();
    });

    it('does not affect other columns', () => {
      useQueryBuilderStore.getState().toggleColumn('orders', 'total');
      useQueryBuilderStore.getState().toggleColumn('orders', 'id');
      useQueryBuilderStore.getState().setColumnAggregate('orders', 'total', 'COUNT');
      expect(getSnapshot().selectedColumns[0].aggregate).toBe('COUNT');
      expect(getSnapshot().selectedColumns[1].aggregate).toBeUndefined();
    });
  });

  // ── addCondition ───────────────────────────────────────────

  describe('addCondition', () => {
    it('adds a condition to the root group', () => {
      const rootId = getSnapshot().where.id;
      useQueryBuilderStore.getState().addCondition(rootId, {
        table: 'users',
        column: 'name',
        operator: '=',
        value: 'Alice',
        conjunction: 'AND',
      });
      const conditions = getSnapshot().where.conditions;
      expect(conditions).toHaveLength(1);
      expect(conditions[0].table).toBe('users');
      expect(conditions[0].column).toBe('name');
      expect(conditions[0].operator).toBe('=');
      expect(conditions[0].value).toBe('Alice');
      expect(conditions[0].id).toBeDefined();
    });

    it('generates a unique id for each condition', () => {
      const rootId = getSnapshot().where.id;
      useQueryBuilderStore.getState().addCondition(rootId, {
        table: 'users',
        column: 'id',
        operator: '=',
        value: '1',
        conjunction: 'AND',
      });
      useQueryBuilderStore.getState().addCondition(rootId, {
        table: 'users',
        column: 'id',
        operator: '=',
        value: '2',
        conjunction: 'AND',
      });
      const conditions = getSnapshot().where.conditions;
      expect(conditions).toHaveLength(2);
      expect(conditions[0].id).not.toBe(conditions[1].id);
    });

    it('adds a condition to a nested group', () => {
      const rootId = getSnapshot().where.id;
      useQueryBuilderStore.getState().addConditionGroup(rootId, 'OR');
      const subGroupId = getSnapshot().where.groups[0].id;
      useQueryBuilderStore.getState().addCondition(subGroupId, {
        table: 'users',
        column: 'role',
        operator: '=',
        value: 'admin',
        conjunction: 'OR',
      });
      expect(getSnapshot().where.groups[0].conditions).toHaveLength(1);
      expect(getSnapshot().where.conditions).toHaveLength(0);
    });
  });

  // ── updateCondition ────────────────────────────────────────

  describe('updateCondition', () => {
    it('updates a condition in the root group', () => {
      const rootId = getSnapshot().where.id;
      useQueryBuilderStore.getState().addCondition(rootId, {
        table: 'users',
        column: 'name',
        operator: '=',
        value: 'Alice',
        conjunction: 'AND',
      });
      const condId = getSnapshot().where.conditions[0].id;
      useQueryBuilderStore.getState().updateCondition(condId, { value: 'Bob' });
      expect(getSnapshot().where.conditions[0].value).toBe('Bob');
    });

    it('updates a condition in a nested group', () => {
      const rootId = getSnapshot().where.id;
      useQueryBuilderStore.getState().addConditionGroup(rootId, 'OR');
      const subGroupId = getSnapshot().where.groups[0].id;
      useQueryBuilderStore.getState().addCondition(subGroupId, {
        table: 'users',
        column: 'role',
        operator: '=',
        value: 'admin',
        conjunction: 'OR',
      });
      const condId = getSnapshot().where.groups[0].conditions[0].id;
      useQueryBuilderStore.getState().updateCondition(condId, { value: 'superadmin' });
      expect(getSnapshot().where.groups[0].conditions[0].value).toBe('superadmin');
    });

    it('can update operator', () => {
      const rootId = getSnapshot().where.id;
      useQueryBuilderStore.getState().addCondition(rootId, {
        table: 'users',
        column: 'age',
        operator: '=',
        value: '18',
        conjunction: 'AND',
      });
      const condId = getSnapshot().where.conditions[0].id;
      useQueryBuilderStore.getState().updateCondition(condId, { operator: '>' });
      expect(getSnapshot().where.conditions[0].operator).toBe('>');
    });

    it('can update multiple fields at once', () => {
      const rootId = getSnapshot().where.id;
      useQueryBuilderStore.getState().addCondition(rootId, {
        table: 'users',
        column: 'name',
        operator: '=',
        value: 'Alice',
        conjunction: 'AND',
      });
      const condId = getSnapshot().where.conditions[0].id;
      useQueryBuilderStore.getState().updateCondition(condId, {
        table: 'orders',
        column: 'total',
        operator: '>',
        value: '100',
      });
      const updated = getSnapshot().where.conditions[0];
      expect(updated.table).toBe('orders');
      expect(updated.column).toBe('total');
      expect(updated.operator).toBe('>');
      expect(updated.value).toBe('100');
    });
  });

  // ── removeCondition ────────────────────────────────────────

  describe('removeCondition', () => {
    it('removes a condition from the root group', () => {
      const rootId = getSnapshot().where.id;
      useQueryBuilderStore.getState().addCondition(rootId, {
        table: 'users',
        column: 'id',
        operator: '=',
        value: '1',
        conjunction: 'AND',
      });
      const condId = getSnapshot().where.conditions[0].id;
      useQueryBuilderStore.getState().removeCondition(condId);
      expect(getSnapshot().where.conditions).toHaveLength(0);
    });

    it('removes a condition from a nested group', () => {
      const rootId = getSnapshot().where.id;
      useQueryBuilderStore.getState().addConditionGroup(rootId, 'OR');
      const subGroupId = getSnapshot().where.groups[0].id;
      useQueryBuilderStore.getState().addCondition(subGroupId, {
        table: 'users',
        column: 'role',
        operator: '=',
        value: 'admin',
        conjunction: 'OR',
      });
      const condId = getSnapshot().where.groups[0].conditions[0].id;
      useQueryBuilderStore.getState().removeCondition(condId);
      expect(getSnapshot().where.groups[0].conditions).toHaveLength(0);
    });

    it('does nothing when id does not match any condition', () => {
      const rootId = getSnapshot().where.id;
      useQueryBuilderStore.getState().addCondition(rootId, {
        table: 'users',
        column: 'id',
        operator: '=',
        value: '1',
        conjunction: 'AND',
      });
      useQueryBuilderStore.getState().removeCondition('nonexistent-id');
      expect(getSnapshot().where.conditions).toHaveLength(1);
    });
  });

  // ── addConditionGroup ──────────────────────────────────────

  describe('addConditionGroup', () => {
    it('adds a sub-group to the root group', () => {
      const rootId = getSnapshot().where.id;
      useQueryBuilderStore.getState().addConditionGroup(rootId, 'OR');
      expect(getSnapshot().where.groups).toHaveLength(1);
      expect(getSnapshot().where.groups[0].logic).toBe('OR');
    });

    it('adds a sub-group to a nested group', () => {
      const rootId = getSnapshot().where.id;
      useQueryBuilderStore.getState().addConditionGroup(rootId, 'OR');
      const subGroupId = getSnapshot().where.groups[0].id;
      useQueryBuilderStore.getState().addConditionGroup(subGroupId, 'AND');
      expect(getSnapshot().where.groups[0].groups).toHaveLength(1);
      expect(getSnapshot().where.groups[0].groups[0].logic).toBe('AND');
    });

    it('generates unique ids for sub-groups', () => {
      const rootId = getSnapshot().where.id;
      useQueryBuilderStore.getState().addConditionGroup(rootId, 'OR');
      useQueryBuilderStore.getState().addConditionGroup(rootId, 'AND');
      const groups = getSnapshot().where.groups;
      expect(groups).toHaveLength(2);
      expect(groups[0].id).not.toBe(groups[1].id);
    });
  });

  // ── updateConditionGroupLogic ──────────────────────────────

  describe('updateConditionGroupLogic', () => {
    it('flips the logic of the root group', () => {
      const rootId = getSnapshot().where.id;
      useQueryBuilderStore.getState().updateConditionGroupLogic(rootId, 'OR');
      expect(getSnapshot().where.logic).toBe('OR');
    });

    it('flips the logic of a nested group without touching the root', () => {
      const rootId = getSnapshot().where.id;
      useQueryBuilderStore.getState().addConditionGroup(rootId, 'AND');
      const subGroupId = getSnapshot().where.groups[0].id;

      useQueryBuilderStore.getState().updateConditionGroupLogic(subGroupId, 'OR');

      expect(getSnapshot().where.groups[0].logic).toBe('OR');
      expect(getSnapshot().where.logic).toBe('AND');
    });

    it('reaches a group nested below another nested group', () => {
      const rootId = getSnapshot().where.id;
      useQueryBuilderStore.getState().addConditionGroup(rootId, 'AND');
      const subGroupId = getSnapshot().where.groups[0].id;
      useQueryBuilderStore.getState().addConditionGroup(subGroupId, 'AND');
      const deepId = getSnapshot().where.groups[0].groups[0].id;

      useQueryBuilderStore.getState().updateConditionGroupLogic(deepId, 'OR');

      expect(getSnapshot().where.groups[0].groups[0].logic).toBe('OR');
    });
  });

  // ── removeConditionGroup ───────────────────────────────────

  describe('removeConditionGroup', () => {
    it('removes a nested group', () => {
      const rootId = getSnapshot().where.id;
      useQueryBuilderStore.getState().addConditionGroup(rootId, 'OR');
      const subGroupId = getSnapshot().where.groups[0].id;

      useQueryBuilderStore.getState().removeConditionGroup(subGroupId);

      expect(getSnapshot().where.groups).toEqual([]);
    });

    it('keeps sibling groups intact', () => {
      const rootId = getSnapshot().where.id;
      useQueryBuilderStore.getState().addConditionGroup(rootId, 'OR');
      useQueryBuilderStore.getState().addConditionGroup(rootId, 'AND');
      const [first, second] = getSnapshot().where.groups;

      useQueryBuilderStore.getState().removeConditionGroup(first.id);

      expect(getSnapshot().where.groups.map((g) => g.id)).toEqual([second.id]);
    });

    it('never removes the root group', () => {
      const rootId = getSnapshot().where.id;
      useQueryBuilderStore.getState().removeConditionGroup(rootId);
      expect(getSnapshot().where.id).toBe(rootId);
    });

    it('removes a group nested below another nested group', () => {
      const rootId = getSnapshot().where.id;
      useQueryBuilderStore.getState().addConditionGroup(rootId, 'AND');
      const subGroupId = getSnapshot().where.groups[0].id;
      useQueryBuilderStore.getState().addConditionGroup(subGroupId, 'OR');
      const deepId = getSnapshot().where.groups[0].groups[0].id;

      useQueryBuilderStore.getState().removeConditionGroup(deepId);

      expect(getSnapshot().where.groups[0].groups).toEqual([]);
      expect(getSnapshot().where.groups).toHaveLength(1);
    });
  });

  // ── addSort / removeSort ───────────────────────────────────

  describe('addSort', () => {
    it('adds a sort item', () => {
      useQueryBuilderStore.getState().addSort({
        table: 'users',
        column: 'name',
        direction: 'ASC',
      });
      expect(getSnapshot().orderBy).toEqual([{ table: 'users', column: 'name', direction: 'ASC' }]);
    });

    it('adds multiple sort items', () => {
      useQueryBuilderStore.getState().addSort({
        table: 'users',
        column: 'name',
        direction: 'ASC',
      });
      useQueryBuilderStore.getState().addSort({
        table: 'users',
        column: 'age',
        direction: 'DESC',
      });
      expect(getSnapshot().orderBy).toHaveLength(2);
    });
  });

  describe('removeSort', () => {
    it('removes a sort item by index', () => {
      useQueryBuilderStore.getState().addSort({
        table: 'users',
        column: 'name',
        direction: 'ASC',
      });
      useQueryBuilderStore.getState().addSort({
        table: 'users',
        column: 'age',
        direction: 'DESC',
      });
      useQueryBuilderStore.getState().removeSort(0);
      expect(getSnapshot().orderBy).toEqual([{ table: 'users', column: 'age', direction: 'DESC' }]);
    });

    it('handles removing last item', () => {
      useQueryBuilderStore.getState().addSort({
        table: 'users',
        column: 'name',
        direction: 'ASC',
      });
      useQueryBuilderStore.getState().removeSort(0);
      expect(getSnapshot().orderBy).toEqual([]);
    });
  });

  // ── addGroupBy / removeGroupBy ─────────────────────────────

  describe('addGroupBy', () => {
    it('adds a group-by item', () => {
      useQueryBuilderStore.getState().addGroupBy({
        table: 'orders',
        column: 'user_id',
      });
      expect(getSnapshot().groupBy).toEqual([{ table: 'orders', column: 'user_id' }]);
    });
  });

  describe('removeGroupBy', () => {
    it('removes a group-by item by index', () => {
      useQueryBuilderStore.getState().addGroupBy({
        table: 'orders',
        column: 'user_id',
      });
      useQueryBuilderStore.getState().addGroupBy({
        table: 'orders',
        column: 'date',
      });
      useQueryBuilderStore.getState().removeGroupBy(0);
      expect(getSnapshot().groupBy).toEqual([{ table: 'orders', column: 'date' }]);
    });

    it('handles removing last item', () => {
      useQueryBuilderStore.getState().addGroupBy({
        table: 'orders',
        column: 'user_id',
      });
      useQueryBuilderStore.getState().removeGroupBy(0);
      expect(getSnapshot().groupBy).toEqual([]);
    });
  });

  // ── setDistinct ────────────────────────────────────────────

  describe('setDistinct', () => {
    it('sets distinct to true', () => {
      useQueryBuilderStore.getState().setDistinct(true);
      expect(getSnapshot().distinct).toBe(true);
    });

    it('sets distinct to false', () => {
      useQueryBuilderStore.getState().setDistinct(true);
      useQueryBuilderStore.getState().setDistinct(false);
      expect(getSnapshot().distinct).toBe(false);
    });
  });

  // ── toggleOpen ─────────────────────────────────────────────

  describe('toggleOpen', () => {
    it('toggles from false to true', () => {
      useQueryBuilderStore.getState().toggleOpen();
      expect(getSnapshot().isOpen).toBe(true);
    });

    it('toggles from true to false', () => {
      useQueryBuilderStore.getState().toggleOpen();
      useQueryBuilderStore.getState().toggleOpen();
      expect(getSnapshot().isOpen).toBe(false);
    });
  });

  // ── reset ──────────────────────────────────────────────────

  describe('reset', () => {
    it('resets all state to initial values', () => {
      const store = useQueryBuilderStore.getState();
      store.toggleTable('users');
      store.toggleColumn('users', 'id');
      store.setDistinct(true);
      store.toggleOpen();
      store.addSort({ table: 'users', column: 'name', direction: 'ASC' });
      store.addGroupBy({ table: 'users', column: 'name' });

      const rootId = getSnapshot().where.id;
      store.addCondition(rootId, {
        table: 'users',
        column: 'name',
        operator: '=',
        value: 'Alice',
        conjunction: 'AND',
      });

      useQueryBuilderStore.getState().reset();

      const s = getSnapshot();
      expect(s.selectedTables).toEqual([]);
      expect(s.selectedColumns).toEqual([]);
      expect(s.distinct).toBe(false);
      // reset() clears the query but keeps the panel open (close is a separate action).
      expect(s.isOpen).toBe(true);
      expect(s.orderBy).toEqual([]);
      expect(s.groupBy).toEqual([]);
      expect(s.where.conditions).toEqual([]);
      expect(s.where.groups).toEqual([]);
    });

    it('resets WHERE group to a fresh group (different id)', () => {
      const oldId = getSnapshot().where.id;
      useQueryBuilderStore.getState().reset();
      expect(getSnapshot().where.id).not.toBe(oldId);
    });

    it('resets all new state fields', () => {
      const store = useQueryBuilderStore.getState();
      store.addJoin({
        type: 'INNER',
        leftTable: 'a',
        leftColumn: 'id',
        rightTable: 'b',
        rightColumn: 'a_id',
        isManual: true,
      });
      store.setTableAlias('users', 'u');
      store.updateTablePosition('users', { x: 100, y: 200 });
      store.setZoom(1.5);
      store.setCanvasOffset({ x: 50, y: 75 });
      store.setLimit(100);
      store.setOffset(20);

      useQueryBuilderStore.getState().reset();

      const s = getSnapshot();
      expect(s.joins).toEqual([]);
      expect(s.autoJoins).toEqual([]);
      expect(s.tableAliases).toEqual({});
      expect(s.tablePositions).toEqual({});
      expect(s.canvasOffset).toEqual({ x: 0, y: 0 });
      expect(s.zoom).toBe(1);
      expect(s.limit).toBeNull();
      expect(s.offset).toBeNull();
    });
  });

  // ── addJoin ─────────────────────────────────────────────────

  describe('addJoin', () => {
    it('adds a join with a generated id', () => {
      useQueryBuilderStore.getState().addJoin({
        type: 'INNER',
        leftTable: 'users',
        leftColumn: 'id',
        rightTable: 'orders',
        rightColumn: 'user_id',
        isManual: true,
      });
      const joins = getSnapshot().joins;
      expect(joins).toHaveLength(1);
      expect(joins[0].id).toBeDefined();
      expect(joins[0].type).toBe('INNER');
      expect(joins[0].leftTable).toBe('users');
      expect(joins[0].leftColumn).toBe('id');
      expect(joins[0].rightTable).toBe('orders');
      expect(joins[0].rightColumn).toBe('user_id');
      expect(joins[0].isManual).toBe(true);
    });

    it('adds multiple joins with unique ids', () => {
      const store = useQueryBuilderStore.getState();
      store.addJoin({
        type: 'INNER',
        leftTable: 'a',
        leftColumn: 'id',
        rightTable: 'b',
        rightColumn: 'a_id',
        isManual: true,
      });
      store.addJoin({
        type: 'LEFT',
        leftTable: 'b',
        leftColumn: 'id',
        rightTable: 'c',
        rightColumn: 'b_id',
        isManual: false,
      });
      const joins = getSnapshot().joins;
      expect(joins).toHaveLength(2);
      expect(joins[0].id).not.toBe(joins[1].id);
    });
  });

  // ── removeJoin ──────────────────────────────────────────────

  describe('removeJoin', () => {
    it('removes a join by id', () => {
      const store = useQueryBuilderStore.getState();
      store.addJoin({
        type: 'INNER',
        leftTable: 'a',
        leftColumn: 'id',
        rightTable: 'b',
        rightColumn: 'a_id',
        isManual: true,
      });
      const joinId = getSnapshot().joins[0].id;
      store.removeJoin(joinId);
      expect(getSnapshot().joins).toEqual([]);
    });

    it('does nothing when id does not match', () => {
      useQueryBuilderStore.getState().addJoin({
        type: 'INNER',
        leftTable: 'a',
        leftColumn: 'id',
        rightTable: 'b',
        rightColumn: 'a_id',
        isManual: true,
      });
      useQueryBuilderStore.getState().removeJoin('nonexistent-id');
      expect(getSnapshot().joins).toHaveLength(1);
    });
  });

  // ── updateJoinType ──────────────────────────────────────────

  describe('updateJoinType', () => {
    it('updates the join type', () => {
      const store = useQueryBuilderStore.getState();
      store.addJoin({
        type: 'INNER',
        leftTable: 'a',
        leftColumn: 'id',
        rightTable: 'b',
        rightColumn: 'a_id',
        isManual: true,
      });
      const joinId = getSnapshot().joins[0].id;
      store.updateJoinType(joinId, 'LEFT');
      expect(getSnapshot().joins[0].type).toBe('LEFT');
    });

    it('does nothing when id does not match', () => {
      useQueryBuilderStore.getState().addJoin({
        type: 'INNER',
        leftTable: 'a',
        leftColumn: 'id',
        rightTable: 'b',
        rightColumn: 'a_id',
        isManual: true,
      });
      useQueryBuilderStore.getState().updateJoinType('nonexistent-id', 'RIGHT');
      expect(getSnapshot().joins[0].type).toBe('INNER');
    });

    it('overrides the type of an auto-detected join', () => {
      const auto = makeAutoJoin();
      useQueryBuilderStore.setState({ autoJoins: [auto] });
      useQueryBuilderStore.getState().updateJoinType(auto.id, 'LEFT');
      // The auto join is not in `joins`, so the override must live separately.
      expect(getSnapshot().joins).toEqual([]);
      expect(getSnapshot().autoJoinTypes).toEqual({ [auto.id]: 'LEFT' });
    });
  });

  // ── auto-join merging ───────────────────────────────────────

  describe('mergeJoins', () => {
    it('includes auto-detected joins so the canvas and SQL agree', () => {
      const auto = makeAutoJoin();
      expect(mergeJoins([], [auto], [], {})).toEqual([auto]);
    });

    it('drops auto joins the user removed', () => {
      const auto = makeAutoJoin();
      expect(mergeJoins([], [auto], [auto.id], {})).toEqual([]);
    });

    it('applies a type override to an auto join', () => {
      const auto = makeAutoJoin();
      const merged = mergeJoins([], [auto], [], { [auto.id]: 'RIGHT' });
      expect(merged).toHaveLength(1);
      expect(merged[0].type).toBe('RIGHT');
    });

    it('lets a manual join win over an auto join for the same column pair', () => {
      const auto = makeAutoJoin();
      const manual: QbJoin = { ...auto, id: 'manual-1', type: 'LEFT', isManual: true };
      const merged = mergeJoins([manual], [auto], [], {});
      expect(merged).toEqual([manual]);
    });

    it('treats a reversed manual pair as the same relation', () => {
      const auto = makeAutoJoin();
      const reversed: QbJoin = {
        ...auto,
        id: 'manual-reversed',
        leftTable: auto.rightTable,
        leftColumn: auto.rightColumn,
        rightTable: auto.leftTable,
        rightColumn: auto.leftColumn,
        isManual: true,
      };
      expect(mergeJoins([reversed], [auto], [], {})).toEqual([reversed]);
    });

    it('keeps unrelated manual and auto joins together, auto first', () => {
      const auto = makeAutoJoin();
      const manual: QbJoin = {
        id: 'manual-2',
        type: 'INNER',
        leftTable: 'c',
        leftColumn: 'id',
        rightTable: 'd',
        rightColumn: 'c_id',
        isManual: true,
      };
      const merged = mergeJoins([manual], [auto], [], {});
      expect(merged.map((j) => j.id)).toEqual([auto.id, manual.id]);
    });
  });

  describe('removeJoin on an auto join', () => {
    it('records the dismissal instead of touching `joins`', () => {
      const auto = makeAutoJoin();
      useQueryBuilderStore.setState({ autoJoins: [auto] });
      useQueryBuilderStore.getState().removeJoin(auto.id);
      expect(getSnapshot().joins).toEqual([]);
      expect(getSnapshot().removedAutoJoinIds).toEqual([auto.id]);
    });

    it('does not duplicate a dismissal recorded twice', () => {
      const auto = makeAutoJoin();
      useQueryBuilderStore.setState({ autoJoins: [auto] });
      useQueryBuilderStore.getState().removeJoin(auto.id);
      useQueryBuilderStore.getState().removeJoin(auto.id);
      expect(getSnapshot().removedAutoJoinIds).toEqual([auto.id]);
    });
  });

  // ── clickJoinColumn (column-to-column manual JOIN) ─────────

  describe('clickJoinColumn', () => {
    it('arms the anchor on the first click', () => {
      useQueryBuilderStore.getState().clickJoinColumn('users', 'id');
      expect(getSnapshot().joinAnchor).toEqual({ table: 'users', column: 'id' });
      expect(getSnapshot().joins).toEqual([]);
    });

    it('cancels when the armed column is clicked again', () => {
      useQueryBuilderStore.getState().clickJoinColumn('users', 'id');
      useQueryBuilderStore.getState().clickJoinColumn('users', 'id');
      expect(getSnapshot().joinAnchor).toBeNull();
      expect(getSnapshot().joins).toEqual([]);
    });

    it('moves the anchor instead of self-joining within one table', () => {
      useQueryBuilderStore.getState().clickJoinColumn('users', 'id');
      useQueryBuilderStore.getState().clickJoinColumn('users', 'email');
      expect(getSnapshot().joinAnchor).toEqual({ table: 'users', column: 'email' });
      expect(getSnapshot().joins).toEqual([]);
    });

    it('creates a manual INNER join on a column of another table and disarms', () => {
      useQueryBuilderStore.getState().clickJoinColumn('users', 'id');
      useQueryBuilderStore.getState().clickJoinColumn('orders', 'user_id');

      expect(getSnapshot().joinAnchor).toBeNull();
      const joins = getSnapshot().joins;
      expect(joins).toHaveLength(1);
      expect(joins[0]).toMatchObject({
        type: 'INNER',
        leftTable: 'users',
        leftColumn: 'id',
        rightTable: 'orders',
        rightColumn: 'user_id',
        isManual: true,
      });
      expect(joins[0].id).toBeTruthy();
    });

    it('keeps the clicked order so the anchor is always the left side', () => {
      useQueryBuilderStore.getState().clickJoinColumn('orders', 'user_id');
      useQueryBuilderStore.getState().clickJoinColumn('users', 'id');
      const join = getSnapshot().joins[0];
      expect(join.leftTable).toBe('orders');
      expect(join.rightTable).toBe('users');
    });

    it('does not add a second join for the same column pair (either direction)', () => {
      const store = useQueryBuilderStore.getState();
      store.clickJoinColumn('users', 'id');
      store.clickJoinColumn('orders', 'user_id');
      store.clickJoinColumn('orders', 'user_id');
      store.clickJoinColumn('users', 'id');

      expect(getSnapshot().joins).toHaveLength(1);
      // The second attempt still disarms rather than leaving a dangling anchor.
      expect(getSnapshot().joinAnchor).toBeNull();
    });

    it('setJoinAnchor(null) cancels without creating a join', () => {
      useQueryBuilderStore.getState().clickJoinColumn('users', 'id');
      useQueryBuilderStore.getState().setJoinAnchor(null);
      expect(getSnapshot().joinAnchor).toBeNull();
      expect(getSnapshot().joins).toEqual([]);
    });

    it('clears an anchor on a table that leaves the canvas', () => {
      useQueryBuilderStore.setState({ selectedTables: ['users', 'orders'] });
      useQueryBuilderStore.getState().clickJoinColumn('users', 'id');
      useQueryBuilderStore.getState().toggleTable('users');
      expect(getSnapshot().joinAnchor).toBeNull();
    });

    it('keeps an anchor on a table that stays on the canvas', () => {
      useQueryBuilderStore.setState({ selectedTables: ['users', 'orders'] });
      useQueryBuilderStore.getState().clickJoinColumn('users', 'id');
      useQueryBuilderStore.getState().toggleTable('orders');
      expect(getSnapshot().joinAnchor).toEqual({ table: 'users', column: 'id' });
    });

    it('reset clears the anchor and the manual joins', () => {
      useQueryBuilderStore.getState().clickJoinColumn('users', 'id');
      useQueryBuilderStore.getState().clickJoinColumn('orders', 'user_id');
      reset();
      expect(getSnapshot().joinAnchor).toBeNull();
      expect(getSnapshot().joins).toEqual([]);
    });
  });

  // ── setTableAlias ───────────────────────────────────────────

  describe('setTableAlias', () => {
    it('sets an alias for a table', () => {
      useQueryBuilderStore.getState().setTableAlias('users', 'u');
      expect(getSnapshot().tableAliases).toEqual({ users: 'u' });
    });

    it('overwrites an existing alias', () => {
      useQueryBuilderStore.getState().setTableAlias('users', 'u');
      useQueryBuilderStore.getState().setTableAlias('users', 'usr');
      expect(getSnapshot().tableAliases).toEqual({ users: 'usr' });
    });
  });

  // ── updateTablePosition ─────────────────────────────────────

  describe('updateTablePosition', () => {
    it('sets position for a table', () => {
      useQueryBuilderStore.getState().updateTablePosition('users', { x: 100, y: 200 });
      expect(getSnapshot().tablePositions).toEqual({ users: { x: 100, y: 200 } });
    });

    it('updates position for a table', () => {
      useQueryBuilderStore.getState().updateTablePosition('users', { x: 100, y: 200 });
      useQueryBuilderStore.getState().updateTablePosition('users', { x: 150, y: 250 });
      expect(getSnapshot().tablePositions).toEqual({ users: { x: 150, y: 250 } });
    });
  });

  // ── setZoom / setCanvasOffset ───────────────────────────────

  describe('setZoom', () => {
    it('sets zoom level', () => {
      useQueryBuilderStore.getState().setZoom(1.5);
      expect(getSnapshot().zoom).toBe(1.5);
    });
  });

  describe('setCanvasOffset', () => {
    it('sets canvas offset', () => {
      useQueryBuilderStore.getState().setCanvasOffset({ x: 50, y: 75 });
      expect(getSnapshot().canvasOffset).toEqual({ x: 50, y: 75 });
    });
  });

  // ── setLimit / setOffset ────────────────────────────────────

  describe('setLimit', () => {
    it('sets limit', () => {
      useQueryBuilderStore.getState().setLimit(100);
      expect(getSnapshot().limit).toBe(100);
    });

    it('clears limit to null', () => {
      useQueryBuilderStore.getState().setLimit(100);
      useQueryBuilderStore.getState().setLimit(null);
      expect(getSnapshot().limit).toBeNull();
    });
  });

  describe('setOffset', () => {
    it('sets offset', () => {
      useQueryBuilderStore.getState().setOffset(20);
      expect(getSnapshot().offset).toBe(20);
    });

    it('clears offset to null', () => {
      useQueryBuilderStore.getState().setOffset(20);
      useQueryBuilderStore.getState().setOffset(null);
      expect(getSnapshot().offset).toBeNull();
    });
  });

  // ── updateColumnConfig ──────────────────────────────────────

  describe('updateColumnConfig', () => {
    it('patches alias on a column', () => {
      useQueryBuilderStore.getState().toggleColumn('users', 'id');
      useQueryBuilderStore.getState().updateColumnConfig('users', 'id', { alias: 'uid' });
      expect(getSnapshot().selectedColumns[0].alias).toBe('uid');
    });

    it('patches aggregate on a column', () => {
      useQueryBuilderStore.getState().toggleColumn('orders', 'total');
      useQueryBuilderStore.getState().updateColumnConfig('orders', 'total', { aggregate: 'SUM' });
      expect(getSnapshot().selectedColumns[0].aggregate).toBe('SUM');
    });

    it('patches sort on a column', () => {
      useQueryBuilderStore.getState().toggleColumn('users', 'name');
      useQueryBuilderStore.getState().updateColumnConfig('users', 'name', { sort: 'ASC' });
      expect(getSnapshot().selectedColumns[0].sort).toBe('ASC');
    });

    it('patches groupBy on a column', () => {
      useQueryBuilderStore.getState().toggleColumn('users', 'id');
      useQueryBuilderStore.getState().updateColumnConfig('users', 'id', { groupBy: true });
      expect(getSnapshot().selectedColumns[0].groupBy).toBe(true);
    });

    it('clears alias when empty string is passed', () => {
      useQueryBuilderStore.getState().toggleColumn('users', 'id');
      useQueryBuilderStore.getState().updateColumnConfig('users', 'id', { alias: 'uid' });
      useQueryBuilderStore.getState().updateColumnConfig('users', 'id', { alias: '' });
      expect(getSnapshot().selectedColumns[0].alias).toBeUndefined();
    });

    it('does not affect other columns', () => {
      useQueryBuilderStore.getState().toggleColumn('users', 'id');
      useQueryBuilderStore.getState().toggleColumn('users', 'name');
      useQueryBuilderStore.getState().updateColumnConfig('users', 'id', { alias: 'uid' });
      expect(getSnapshot().selectedColumns[0].alias).toBe('uid');
      expect(getSnapshot().selectedColumns[1].alias).toBeUndefined();
    });
  });
});
