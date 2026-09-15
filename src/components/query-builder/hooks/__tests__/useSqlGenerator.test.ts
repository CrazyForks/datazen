import { describe, it, expect } from 'vitest';
import { generateSql } from '../useSqlGenerator';
import type { GenerateSqlInput } from '../useSqlGenerator';
import type { QbConditionGroup } from '../../types';

// ── Helpers ───────────────────────────────────────────────────

function emptyGroup(id = 'root'): QbConditionGroup {
  return { id, logic: 'AND', conditions: [], groups: [] };
}

function baseInput(overrides: Partial<GenerateSqlInput> = {}): GenerateSqlInput {
  return {
    selectedTables: [],
    selectedColumns: [],
    where: emptyGroup(),
    orderBy: [],
    groupBy: [],
    distinct: false,
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────

describe('generateSql', () => {
  // ── Empty state ────────────────────────────────────────────

  it('returns empty string when no tables selected', () => {
    const sql = generateSql(baseInput());
    expect(sql).toBe('');
  });

  it('returns empty string when tables selected but no columns', () => {
    const sql = generateSql(baseInput({ selectedTables: ['users'] }));
    expect(sql).toBe('');
  });

  // ── Single-table SELECT ────────────────────────────────────

  it('generates simple single-table SELECT', () => {
    const sql = generateSql(
      baseInput({
        selectedTables: ['users'],
        selectedColumns: [{ table: 'users', column: 'id' }, { table: 'users', column: 'name' }],
      }),
    );
    expect(sql).toBe('SELECT "users"."id", "users"."name" FROM "users";');
  });

  // ── Multi-column with alias ────────────────────────────────

  it('generates SELECT with column alias', () => {
    const sql = generateSql(
      baseInput({
        selectedTables: ['users'],
        selectedColumns: [{ table: 'users', column: 'name', alias: 'user_name' }],
      }),
    );
    expect(sql).toBe('SELECT "users"."name" AS "user_name" FROM "users";');
  });

  // ── Aggregate functions ────────────────────────────────────

  it('generates SELECT with COUNT aggregate', () => {
    const sql = generateSql(
      baseInput({
        selectedTables: ['orders'],
        selectedColumns: [{ table: 'orders', column: 'id', aggregate: 'COUNT', alias: 'order_count' }],
      }),
    );
    expect(sql).toBe('SELECT COUNT("orders"."id") AS "order_count" FROM "orders";');
  });

  it('generates SELECT with SUM aggregate', () => {
    const sql = generateSql(
      baseInput({
        selectedTables: ['orders'],
        selectedColumns: [{ table: 'orders', column: 'total', aggregate: 'SUM', alias: 'sum_total' }],
      }),
    );
    expect(sql).toBe('SELECT SUM("orders"."total") AS "sum_total" FROM "orders";');
  });

  it('generates SELECT with AVG aggregate', () => {
    const sql = generateSql(
      baseInput({
        selectedTables: ['orders'],
        selectedColumns: [{ table: 'orders', column: 'total', aggregate: 'AVG' }],
      }),
    );
    expect(sql).toBe('SELECT AVG("orders"."total") FROM "orders";');
  });

  // ── WHERE single conditions ────────────────────────────────

  it('generates WHERE with equals condition', () => {
    const where = emptyGroup();
    where.conditions = [
      { id: '1', table: 'users', column: 'name', operator: '=', value: 'Alice', conjunction: 'AND' },
    ];
    const sql = generateSql(
      baseInput({
        selectedTables: ['users'],
        selectedColumns: [{ table: 'users', column: '*' }],
        where,
      }),
    );
    expect(sql).toBe('SELECT "users"."*" FROM "users" WHERE "users"."name" = \'Alice\';');
  });

  it('generates WHERE with not-equals condition', () => {
    const where = emptyGroup();
    where.conditions = [
      { id: '1', table: 'users', column: 'status', operator: '!=', value: 'inactive', conjunction: 'AND' },
    ];
    const sql = generateSql(
      baseInput({
        selectedTables: ['users'],
        selectedColumns: [{ table: 'users', column: 'id' }],
        where,
      }),
    );
    expect(sql).toBe('SELECT "users"."id" FROM "users" WHERE "users"."status" != \'inactive\';');
  });

  it('generates WHERE with greater-than condition', () => {
    const where = emptyGroup();
    where.conditions = [
      { id: '1', table: 'users', column: 'age', operator: '>', value: '18', conjunction: 'AND' },
    ];
    const sql = generateSql(
      baseInput({
        selectedTables: ['users'],
        selectedColumns: [{ table: 'users', column: 'name' }],
        where,
      }),
    );
    expect(sql).toBe('SELECT "users"."name" FROM "users" WHERE "users"."age" > 18;');
  });

  it('generates WHERE with less-than condition', () => {
    const where = emptyGroup();
    where.conditions = [
      { id: '1', table: 'users', column: 'age', operator: '<', value: '65', conjunction: 'AND' },
    ];
    const sql = generateSql(
      baseInput({
        selectedTables: ['users'],
        selectedColumns: [{ table: 'users', column: 'name' }],
        where,
      }),
    );
    expect(sql).toBe('SELECT "users"."name" FROM "users" WHERE "users"."age" < 65;');
  });

  it('generates WHERE with LIKE condition', () => {
    const where = emptyGroup();
    where.conditions = [
      { id: '1', table: 'users', column: 'name', operator: 'LIKE', value: '%test%', conjunction: 'AND' },
    ];
    const sql = generateSql(
      baseInput({
        selectedTables: ['users'],
        selectedColumns: [{ table: 'users', column: 'name' }],
        where,
      }),
    );
    expect(sql).toBe('SELECT "users"."name" FROM "users" WHERE "users"."name" LIKE \'%test%\';');
  });

  it('generates WHERE with IN condition', () => {
    const where = emptyGroup();
    where.conditions = [
      { id: '1', table: 'users', column: 'id', operator: 'IN', value: '1, 2, 3', conjunction: 'AND' },
    ];
    const sql = generateSql(
      baseInput({
        selectedTables: ['users'],
        selectedColumns: [{ table: 'users', column: 'name' }],
        where,
      }),
    );
    expect(sql).toBe('SELECT "users"."name" FROM "users" WHERE "users"."id" IN (1, 2, 3);');
  });

  it('generates WHERE with IS NULL condition', () => {
    const where = emptyGroup();
    where.conditions = [
      { id: '1', table: 'users', column: 'email', operator: 'IS NULL', value: null, conjunction: 'AND' },
    ];
    const sql = generateSql(
      baseInput({
        selectedTables: ['users'],
        selectedColumns: [{ table: 'users', column: 'name' }],
        where,
      }),
    );
    expect(sql).toBe('SELECT "users"."name" FROM "users" WHERE "users"."email" IS NULL;');
  });

  // ── WHERE AND/OR combinations ──────────────────────────────

  it('generates WHERE with AND combination', () => {
    const where = emptyGroup();
    where.conditions = [
      { id: '1', table: 'users', column: 'age', operator: '>', value: '18', conjunction: 'AND' },
      { id: '2', table: 'users', column: 'status', operator: '=', value: 'active', conjunction: 'AND' },
    ];
    const sql = generateSql(
      baseInput({
        selectedTables: ['users'],
        selectedColumns: [{ table: 'users', column: 'name' }],
        where,
      }),
    );
    expect(sql).toBe(
      "SELECT \"users\".\"name\" FROM \"users\" WHERE \"users\".\"age\" > 18 AND \"users\".\"status\" = 'active';",
    );
  });

  it('generates WHERE with OR combination', () => {
    const where = emptyGroup('root');
    where.logic = 'OR';
    where.conditions = [
      { id: '1', table: 'users', column: 'role', operator: '=', value: 'admin', conjunction: 'OR' },
      { id: '2', table: 'users', column: 'role', operator: '=', value: 'superadmin', conjunction: 'OR' },
    ];
    const sql = generateSql(
      baseInput({
        selectedTables: ['users'],
        selectedColumns: [{ table: 'users', column: 'name' }],
        where,
      }),
    );
    expect(sql).toBe(
      "SELECT \"users\".\"name\" FROM \"users\" WHERE \"users\".\"role\" = 'admin' OR \"users\".\"role\" = 'superadmin';",
    );
  });

  // ── Nested condition groups ────────────────────────────────

  it('generates WHERE with nested condition groups', () => {
    const subGroup: QbConditionGroup = {
      id: 'sub',
      logic: 'OR',
      conditions: [
        { id: '3', table: 'users', column: 'role', operator: '=', value: 'admin', conjunction: 'OR' },
        { id: '4', table: 'users', column: 'role', operator: '=', value: 'editor', conjunction: 'OR' },
      ],
      groups: [],
    };
    const where = emptyGroup('root');
    where.conditions = [
      { id: '1', table: 'users', column: 'active', operator: '=', value: '1', conjunction: 'AND' },
    ];
    where.groups = [subGroup];

    const sql = generateSql(
      baseInput({
        selectedTables: ['users'],
        selectedColumns: [{ table: 'users', column: 'name' }],
        where,
      }),
    );
    expect(sql).toBe(
      "SELECT \"users\".\"name\" FROM \"users\" WHERE \"users\".\"active\" = 1 AND (\"users\".\"role\" = 'admin' OR \"users\".\"role\" = 'editor');",
    );
  });

  // ── ORDER BY ───────────────────────────────────────────────

  it('generates ORDER BY single column', () => {
    const sql = generateSql(
      baseInput({
        selectedTables: ['users'],
        selectedColumns: [{ table: 'users', column: 'name' }],
        orderBy: [{ table: 'users', column: 'name', direction: 'ASC' }],
      }),
    );
    expect(sql).toBe('SELECT "users"."name" FROM "users" ORDER BY "users"."name" ASC;');
  });

  it('generates ORDER BY multiple columns', () => {
    const sql = generateSql(
      baseInput({
        selectedTables: ['users'],
        selectedColumns: [{ table: 'users', column: 'name' }],
        orderBy: [
          { table: 'users', column: 'name', direction: 'ASC' },
          { table: 'users', column: 'age', direction: 'DESC' },
        ],
      }),
    );
    expect(sql).toBe('SELECT "users"."name" FROM "users" ORDER BY "users"."name" ASC, "users"."age" DESC;');
  });

  // ── GROUP BY ───────────────────────────────────────────────

  it('generates GROUP BY with aggregate', () => {
    const sql = generateSql(
      baseInput({
        selectedTables: ['orders'],
        selectedColumns: [
          { table: 'orders', column: 'user_id' },
          { table: 'orders', column: 'total', aggregate: 'SUM', alias: 'sum_total' },
        ],
        groupBy: [{ table: 'orders', column: 'user_id' }],
      }),
    );
    expect(sql).toBe(
      'SELECT "orders"."user_id", SUM("orders"."total") AS "sum_total" FROM "orders" GROUP BY "orders"."user_id";',
    );
  });

  // ── DISTINCT ───────────────────────────────────────────────

  it('generates SELECT DISTINCT', () => {
    const sql = generateSql(
      baseInput({
        selectedTables: ['users'],
        selectedColumns: [{ table: 'users', column: 'country' }],
        distinct: true,
      }),
    );
    expect(sql).toBe('SELECT DISTINCT "users"."country" FROM "users";');
  });

  // ── Dialect differences ────────────────────────────────────

  it('generates PostgreSQL with double-quote identifiers', () => {
    const sql = generateSql(
      baseInput({
        selectedTables: ['users'],
        selectedColumns: [{ table: 'users', column: 'name' }],
        databaseType: 'postgresql',
      }),
    );
    expect(sql).toBe('SELECT "users"."name" FROM "users";');
  });

  it('generates MySQL with backtick identifiers', () => {
    const sql = generateSql(
      baseInput({
        selectedTables: ['users'],
        selectedColumns: [{ table: 'users', column: 'name' }],
        databaseType: 'mysql',
      }),
    );
    expect(sql).toBe('SELECT `users`.`name` FROM `users`;');
  });

  it('generates SQLite with double-quote identifiers', () => {
    const sql = generateSql(
      baseInput({
        selectedTables: ['users'],
        selectedColumns: [{ table: 'users', column: 'name' }],
        databaseType: 'sqlite',
      }),
    );
    expect(sql).toBe('SELECT "users"."name" FROM "users";');
  });

  it('generates SQL Server with bracket identifiers', () => {
    const sql = generateSql(
      baseInput({
        selectedTables: ['users'],
        selectedColumns: [{ table: 'users', column: 'name' }],
        databaseType: 'sqlserver',
      }),
    );
    expect(sql).toBe('SELECT [users].[name] FROM [users];');
  });

  // ── Special character escaping ─────────────────────────────

  it('escapes single quotes in values', () => {
    const where = emptyGroup();
    where.conditions = [
      { id: '1', table: 'users', column: 'name', operator: '=', value: "O'Brien", conjunction: 'AND' },
    ];
    const sql = generateSql(
      baseInput({
        selectedTables: ['users'],
        selectedColumns: [{ table: 'users', column: 'name' }],
        where,
      }),
    );
    expect(sql).toBe("SELECT \"users\".\"name\" FROM \"users\" WHERE \"users\".\"name\" = 'O''Brien';");
  });

  // ── Full complex query ─────────────────────────────────────

  it('generates a complete complex query', () => {
    const subGroup: QbConditionGroup = {
      id: 'sub',
      logic: 'OR',
      conditions: [
        { id: '3', table: 'users', column: 'role', operator: '=', value: 'admin', conjunction: 'OR' },
      ],
      groups: [],
    };
    const where = emptyGroup('root');
    where.conditions = [
      { id: '1', table: 'users', column: 'active', operator: '=', value: '1', conjunction: 'AND' },
    ];
    where.groups = [subGroup];

    const sql = generateSql(
      baseInput({
        selectedTables: ['users', 'orders'],
        selectedColumns: [
          { table: 'users', column: 'name' },
          { table: 'orders', column: 'total', aggregate: 'SUM', alias: 'sum_total' },
        ],
        where,
        orderBy: [{ table: 'users', column: 'name', direction: 'ASC' }],
        groupBy: [{ table: 'users', column: 'name' }],
        distinct: false,
        databaseType: 'postgresql',
      }),
    );
    expect(sql).toBe(
      'SELECT "users"."name", SUM("orders"."total") AS "sum_total" FROM "users" WHERE "users"."active" = 1 AND ("users"."role" = \'admin\') GROUP BY "users"."name" ORDER BY "users"."name" ASC;',
    );
  });

  // ── >= and <= operators ────────────────────────────────────

  it('generates WHERE with >= and <= operators', () => {
    const where = emptyGroup();
    where.conditions = [
      { id: '1', table: 'users', column: 'age', operator: '>=', value: '18', conjunction: 'AND' },
      { id: '2', table: 'users', column: 'age', operator: '<=', value: '65', conjunction: 'AND' },
    ];
    const sql = generateSql(
      baseInput({
        selectedTables: ['users'],
        selectedColumns: [{ table: 'users', column: 'name' }],
        where,
      }),
    );
    expect(sql).toBe(
      'SELECT "users"."name" FROM "users" WHERE "users"."age" >= 18 AND "users"."age" <= 65;',
    );
  });

  // ── NOT LIKE operator ──────────────────────────────────────

  it('generates WHERE with NOT LIKE', () => {
    const where = emptyGroup();
    where.conditions = [
      { id: '1', table: 'users', column: 'name', operator: 'NOT LIKE', value: '%admin%', conjunction: 'AND' },
    ];
    const sql = generateSql(
      baseInput({
        selectedTables: ['users'],
        selectedColumns: [{ table: 'users', column: 'name' }],
        where,
      }),
    );
    expect(sql).toBe("SELECT \"users\".\"name\" FROM \"users\" WHERE \"users\".\"name\" NOT LIKE '%admin%';");
  });

  // ── NOT IN operator ────────────────────────────────────────

  it('generates WHERE with NOT IN', () => {
    const where = emptyGroup();
    where.conditions = [
      { id: '1', table: 'users', column: 'id', operator: 'NOT IN', value: '1, 2', conjunction: 'AND' },
    ];
    const sql = generateSql(
      baseInput({
        selectedTables: ['users'],
        selectedColumns: [{ table: 'users', column: 'name' }],
        where,
      }),
    );
    expect(sql).toBe('SELECT "users"."name" FROM "users" WHERE "users"."id" NOT IN (1, 2);');
  });

  // ── IS NOT NULL operator ───────────────────────────────────

  it('generates WHERE with IS NOT NULL', () => {
    const where = emptyGroup();
    where.conditions = [
      { id: '1', table: 'users', column: 'email', operator: 'IS NOT NULL', value: null, conjunction: 'AND' },
    ];
    const sql = generateSql(
      baseInput({
        selectedTables: ['users'],
        selectedColumns: [{ table: 'users', column: 'name' }],
        where,
      }),
    );
    expect(sql).toBe('SELECT "users"."name" FROM "users" WHERE "users"."email" IS NOT NULL;');
  });

  // ── Empty value → NULL ─────────────────────────────────────

  it('generates NULL for empty string value', () => {
    const where = emptyGroup();
    where.conditions = [
      { id: '1', table: 'users', column: 'email', operator: '=', value: '', conjunction: 'AND' },
    ];
    const sql = generateSql(
      baseInput({
        selectedTables: ['users'],
        selectedColumns: [{ table: 'users', column: 'name' }],
        where,
      }),
    );
    expect(sql).toBe('SELECT "users"."name" FROM "users" WHERE "users"."email" = NULL;');
  });

  // ── Unknown database type falls back to generic ────────────

  it('falls back to generic adapter for unknown database type', () => {
    const sql = generateSql(
      baseInput({
        selectedTables: ['users'],
        selectedColumns: [{ table: 'users', column: 'name' }],
        databaseType: 'unknown_db',
      }),
    );
    expect(sql).toBe('SELECT "users"."name" FROM "users";');
  });
});
