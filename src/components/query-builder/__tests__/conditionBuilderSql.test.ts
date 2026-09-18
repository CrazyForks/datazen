import { afterEach, describe, expect, it } from 'vitest';
import { useQueryBuilderStore } from '../../../stores/queryBuilderStore';
import { generateSql } from '../hooks/useSqlGenerator';

afterEach(() => {
  useQueryBuilderStore.setState(useQueryBuilderStore.getInitialState());
});

/**
 * Closes the loop from the WHERE editor's store actions to the emitted SQL.
 *
 * The generator and the store are each unit-tested on their own; this pins the
 * contract between them, which is what the ConditionBuilder UI actually drives.
 */
describe('ConditionBuilder → SQL', () => {
  function sqlFromStore(): string {
    const s = useQueryBuilderStore.getState();
    return generateSql({
      selectedTables: s.selectedTables,
      selectedColumns: s.selectedColumns,
      joins: s.joins,
      tableAliases: s.tableAliases,
      where: s.where,
      orderBy: s.orderBy,
      groupBy: s.groupBy,
      distinct: s.distinct,
      limit: s.limit,
      offset: s.offset,
    });
  }

  function seedQuery(): void {
    useQueryBuilderStore.setState({
      selectedTables: ['users'],
      selectedColumns: [{ table: 'users', column: 'name' }],
    });
  }

  it('emits a flat AND clause for root-level conditions', () => {
    seedQuery();
    const store = useQueryBuilderStore.getState();
    store.addCondition(store.where.id, {
      table: 'users',
      column: 'active',
      operator: '=',
      value: '1',
      conjunction: 'AND',
    });
    store.addCondition(store.where.id, {
      table: 'users',
      column: 'role',
      operator: '=',
      value: 'admin',
      conjunction: 'AND',
    });

    expect(sqlFromStore()).toBe(
      'SELECT "users"."name" FROM "users" WHERE "users"."active" = 1 AND "users"."role" = \'admin\';',
    );
  });

  it('emits OR between root conditions once the group logic is flipped', () => {
    seedQuery();
    const store = useQueryBuilderStore.getState();
    store.addCondition(store.where.id, {
      table: 'users',
      column: 'role',
      operator: '=',
      value: 'admin',
      conjunction: 'AND',
    });
    store.addCondition(store.where.id, {
      table: 'users',
      column: 'role',
      operator: '=',
      value: 'editor',
      conjunction: 'AND',
    });
    store.updateConditionGroupLogic(store.where.id, 'OR');

    expect(sqlFromStore()).toBe(
      'SELECT "users"."name" FROM "users" WHERE "users"."role" = \'admin\' OR "users"."role" = \'editor\';',
    );
  });

  it('parenthesises a nested group and keeps the outer AND', () => {
    seedQuery();
    const store = useQueryBuilderStore.getState();
    store.addCondition(store.where.id, {
      table: 'users',
      column: 'active',
      operator: '=',
      value: '1',
      conjunction: 'AND',
    });
    store.addConditionGroup(store.where.id, 'OR');

    const groupId = useQueryBuilderStore.getState().where.groups[0].id;
    useQueryBuilderStore.getState().addCondition(groupId, {
      table: 'users',
      column: 'role',
      operator: '=',
      value: 'admin',
      conjunction: 'AND',
    });
    useQueryBuilderStore.getState().addCondition(groupId, {
      table: 'users',
      column: 'role',
      operator: '=',
      value: 'editor',
      conjunction: 'AND',
    });

    expect(sqlFromStore()).toBe(
      'SELECT "users"."name" FROM "users" WHERE "users"."active" = 1 AND ("users"."role" = \'admin\' OR "users"."role" = \'editor\');',
    );
  });

  it('drops the nested group from the SQL once it is removed', () => {
    seedQuery();
    const store = useQueryBuilderStore.getState();
    store.addConditionGroup(store.where.id, 'OR');
    const groupId = useQueryBuilderStore.getState().where.groups[0].id;
    useQueryBuilderStore.getState().addCondition(groupId, {
      table: 'users',
      column: 'role',
      operator: '=',
      value: 'admin',
      conjunction: 'AND',
    });

    useQueryBuilderStore.getState().removeConditionGroup(groupId);

    expect(sqlFromStore()).toBe('SELECT "users"."name" FROM "users";');
  });

  it('omits LIMIT/OFFSET until they are set, then includes them', () => {
    seedQuery();
    expect(sqlFromStore()).toBe('SELECT "users"."name" FROM "users";');

    useQueryBuilderStore.getState().setLimit(10);
    useQueryBuilderStore.getState().setOffset(5);

    expect(sqlFromStore()).toBe('SELECT "users"."name" FROM "users" LIMIT 10 OFFSET 5;');
  });
});
