/**
 * Manual column-to-column JOIN → generated SQL.
 *
 * Closes the loop the store unit tests cannot: clicking a column on one table
 * card and a column on another must produce a JOIN in the statement the user
 * actually applies, and removing it must take the JOIN away again.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useQueryBuilderStore, mergeJoins } from '../../../stores/queryBuilderStore';
import { generateSql } from '../hooks/useSqlGenerator';
import type { GenerateSqlInput } from '../hooks/useSqlGenerator';

const USERS = 'users';
const ORDERS = 'orders';

function reset() {
  useQueryBuilderStore.setState(useQueryBuilderStore.getInitialState());
}

/** Generate SQL from the current store, as the panel does. */
function sqlFromStore(): string {
  const s = useQueryBuilderStore.getState();
  const joins = mergeJoins(s.joins, s.autoJoins, s.removedAutoJoinIds, s.autoJoinTypes);
  const input: GenerateSqlInput = {
    selectedTables: s.selectedTables,
    selectedColumns: s.selectedColumns,
    joins,
    tableAliases: s.tableAliases,
    where: s.where,
    orderBy: s.orderBy,
    groupBy: s.groupBy,
    distinct: s.distinct,
    limit: s.limit,
    offset: s.offset,
    databaseType: 'postgresql',
  };
  return generateSql(input);
}

describe('manual column-to-column JOIN', () => {
  beforeEach(() => {
    reset();
    useQueryBuilderStore.setState({
      selectedTables: [USERS, ORDERS],
      selectedColumns: [
        { table: USERS, column: 'name' },
        { table: ORDERS, column: 'total' },
      ],
    });
  });

  it('emits an INNER JOIN once both columns are clicked', () => {
    const store = useQueryBuilderStore.getState();
    store.clickJoinColumn(USERS, 'id');
    store.clickJoinColumn(ORDERS, 'user_id');

    expect(sqlFromStore()).toContain('INNER JOIN "orders" ON "users"."id" = "orders"."user_id"');
  });

  it('has no JOIN while only the anchor is armed', () => {
    useQueryBuilderStore.getState().clickJoinColumn(USERS, 'id');
    expect(sqlFromStore()).not.toContain('JOIN');
  });

  it('reflects a JOIN type change made on the canvas label', () => {
    const store = useQueryBuilderStore.getState();
    store.clickJoinColumn(USERS, 'id');
    store.clickJoinColumn(ORDERS, 'user_id');
    const id = useQueryBuilderStore.getState().joins[0].id;
    useQueryBuilderStore.getState().updateJoinType(id, 'LEFT');

    expect(sqlFromStore()).toContain('LEFT JOIN "orders" ON "users"."id" = "orders"."user_id"');
  });

  it('drops the JOIN when the user removes it', () => {
    const store = useQueryBuilderStore.getState();
    store.clickJoinColumn(USERS, 'id');
    store.clickJoinColumn(ORDERS, 'user_id');
    const id = useQueryBuilderStore.getState().joins[0].id;
    useQueryBuilderStore.getState().removeJoin(id);

    expect(sqlFromStore()).not.toContain('JOIN');
  });

  it('a manual JOIN supersedes an auto-detected one for the same pair', () => {
    // Auto detection already found users.id → orders.user_id.
    useQueryBuilderStore.setState({
      autoJoins: [
        {
          id: 'auto-users.id-orders.user_id',
          type: 'INNER',
          leftTable: USERS,
          rightTable: ORDERS,
          columnPairs: [{ left: 'id', right: 'user_id' }],
          isManual: false,
        },
      ],
    });

    const store = useQueryBuilderStore.getState();
    store.clickJoinColumn(USERS, 'id');
    store.clickJoinColumn(ORDERS, 'user_id');

    const sql = sqlFromStore();
    // Exactly one JOIN, and it is the manual one (never duplicated).
    expect(sql.match(/JOIN/g)).toHaveLength(1);
    expect(useQueryBuilderStore.getState().joins).toHaveLength(1);
  });

  it('uses a table alias on the left side when one is set', () => {
    const store = useQueryBuilderStore.getState();
    store.clickJoinColumn(USERS, 'id');
    store.clickJoinColumn(ORDERS, 'user_id');
    useQueryBuilderStore.getState().setTableAlias(USERS, 'u');

    expect(sqlFromStore()).toContain('ON "u"."id" = "orders"."user_id"');
  });
});
