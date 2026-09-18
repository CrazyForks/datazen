import { describe, it, expect } from 'vitest';
import {
  getQbDialectAdapter,
  generateJoinClause,
  generateLimitOffset,
  supportsLimitOffset,
} from '../queryBuilder';
import type { QbDialectAdapter } from '../queryBuilder';
import type { QbJoin } from '../../../components/query-builder/types';
import { DB_REGISTRY } from '../../databaseTypes';

// ── Tests ─────────────────────────────────────────────────────

describe('getQbDialectAdapter', () => {
  // ── Factory resolution ─────────────────────────────────────

  describe('factory resolution', () => {
    it('returns postgresql adapter for "postgresql" family', () => {
      const adapter = getQbDialectAdapter('postgresql');
      expect(adapter.quoteIdentifier('col')).toBe('"col"');
      expect(adapter.supportsILike).toBe(true);
    });

    it('returns mysql adapter for "mysql" family', () => {
      const adapter = getQbDialectAdapter('mysql');
      expect(adapter.quoteIdentifier('col')).toBe('`col`');
      expect(adapter.supportsILike).toBe(false);
    });

    it('returns sqlite adapter for "sqlite" family', () => {
      const adapter = getQbDialectAdapter('sqlite');
      expect(adapter.quoteIdentifier('col')).toBe('"col"');
      expect(adapter.supportsILike).toBe(false);
    });

    it('returns sqlserver adapter for "sqlserver" family', () => {
      const adapter = getQbDialectAdapter('sqlserver');
      expect(adapter.quoteIdentifier('col')).toBe('[col]');
      expect(adapter.supportsILike).toBe(false);
    });

    it('returns generic adapter for unknown database type', () => {
      const adapter = getQbDialectAdapter('unknown_db');
      expect(adapter.quoteIdentifier('col')).toBe('"col"');
      expect(adapter.supportsILike).toBe(false);
    });

    it('returns generic adapter for undefined database type', () => {
      const adapter = getQbDialectAdapter(undefined);
      expect(adapter.quoteIdentifier('col')).toBe('"col"');
      expect(adapter.supportsILike).toBe(false);
    });
  });

  // ── PostgreSQL adapter ─────────────────────────────────────

  describe('postgresql adapter', () => {
    let adapter: QbDialectAdapter;
    it('setup', () => {
      adapter = getQbDialectAdapter('postgresql');
    });

    it('quotes identifiers with double quotes', () => {
      expect(adapter.quoteIdentifier('users')).toBe('"users"');
      expect(adapter.quoteIdentifier('user id')).toBe('"user id"');
    });

    it('supports ILIKE', () => {
      expect(adapter.supportsILike).toBe(true);
    });

    it('formats LIMIT without offset', () => {
      expect(adapter.formatLimitOffset(10, 0)).toBe('LIMIT 10');
    });

    it('formats LIMIT with offset', () => {
      expect(adapter.formatLimitOffset(10, 20)).toBe('LIMIT 10 OFFSET 20');
    });

    it('formats IS NULL', () => {
      expect(adapter.formatNullComparison('"col"', true)).toBe('"col" IS NULL');
    });

    it('formats IS NOT NULL', () => {
      expect(adapter.formatNullComparison('"col"', false)).toBe('"col" IS NOT NULL');
    });

    it('formats IN list', () => {
      expect(adapter.formatInList('"id"', ['1', '2', '3'], false)).toBe('"id" IN (1, 2, 3)');
    });

    it('formats NOT IN list', () => {
      expect(adapter.formatInList('"id"', ['1', '2'], true)).toBe('"id" NOT IN (1, 2)');
    });

    it('formats empty IN list', () => {
      expect(adapter.formatInList('"id"', [], false)).toBe('"id" IN ()');
    });
  });

  // ── MySQL adapter ──────────────────────────────────────────

  describe('mysql adapter', () => {
    let adapter: QbDialectAdapter;
    it('setup', () => {
      adapter = getQbDialectAdapter('mysql');
    });

    it('quotes identifiers with backticks', () => {
      expect(adapter.quoteIdentifier('users')).toBe('`users`');
    });

    it('does not support ILIKE', () => {
      expect(adapter.supportsILike).toBe(false);
    });

    it('formats LIMIT without offset', () => {
      expect(adapter.formatLimitOffset(10, 0)).toBe('LIMIT 10');
    });

    it('formats LIMIT with offset (MySQL syntax: LIMIT offset, count)', () => {
      expect(adapter.formatLimitOffset(10, 20)).toBe('LIMIT 20, 10');
    });

    it('formats IS NULL', () => {
      expect(adapter.formatNullComparison('`col`', true)).toBe('`col` IS NULL');
    });

    it('formats IS NOT NULL', () => {
      expect(adapter.formatNullComparison('`col`', false)).toBe('`col` IS NOT NULL');
    });

    it('formats IN list', () => {
      expect(adapter.formatInList('`id`', ['1', '2'], false)).toBe('`id` IN (1, 2)');
    });

    it('formats NOT IN list', () => {
      expect(adapter.formatInList('`id`', ['1'], true)).toBe('`id` NOT IN (1)');
    });
  });

  // ── SQLite adapter ─────────────────────────────────────────

  describe('sqlite adapter', () => {
    let adapter: QbDialectAdapter;
    it('setup', () => {
      adapter = getQbDialectAdapter('sqlite');
    });

    it('quotes identifiers with double quotes', () => {
      expect(adapter.quoteIdentifier('users')).toBe('"users"');
    });

    it('does not support ILIKE', () => {
      expect(adapter.supportsILike).toBe(false);
    });

    it('formats LIMIT without offset', () => {
      expect(adapter.formatLimitOffset(10, 0)).toBe('LIMIT 10');
    });

    it('formats LIMIT with offset', () => {
      expect(adapter.formatLimitOffset(10, 20)).toBe('LIMIT 10 OFFSET 20');
    });

    it('formats IS NULL', () => {
      expect(adapter.formatNullComparison('"col"', true)).toBe('"col" IS NULL');
    });

    it('formats IS NOT NULL', () => {
      expect(adapter.formatNullComparison('"col"', false)).toBe('"col" IS NOT NULL');
    });

    it('formats IN list', () => {
      expect(adapter.formatInList('"id"', ['1', '2'], false)).toBe('"id" IN (1, 2)');
    });

    it('formats NOT IN list', () => {
      expect(adapter.formatInList('"id"', [], true)).toBe('"id" NOT IN ()');
    });
  });

  // ── SQL Server adapter ─────────────────────────────────────

  describe('sqlserver adapter', () => {
    let adapter: QbDialectAdapter;
    it('setup', () => {
      adapter = getQbDialectAdapter('sqlserver');
    });

    it('quotes identifiers with square brackets', () => {
      expect(adapter.quoteIdentifier('users')).toBe('[users]');
    });

    it('does not support ILIKE', () => {
      expect(adapter.supportsILike).toBe(false);
    });

    it('returns null for LIMIT/OFFSET (SQL Server uses TOP/OFFSET-FETCH)', () => {
      expect(adapter.formatLimitOffset(10, 0)).toBeNull();
      expect(adapter.formatLimitOffset(10, 20)).toBeNull();
    });

    it('formats IS NULL', () => {
      expect(adapter.formatNullComparison('[col]', true)).toBe('[col] IS NULL');
    });

    it('formats IS NOT NULL', () => {
      expect(adapter.formatNullComparison('[col]', false)).toBe('[col] IS NOT NULL');
    });

    it('formats IN list', () => {
      expect(adapter.formatInList('[id]', ['1', '2'], false)).toBe('[id] IN (1, 2)');
    });

    it('formats NOT IN list', () => {
      expect(adapter.formatInList('[id]', ['a'], true)).toBe('[id] NOT IN (a)');
    });
  });

  // ── Generic adapter (fallback) ─────────────────────────────

  describe('generic adapter (fallback)', () => {
    let adapter: QbDialectAdapter;
    it('setup', () => {
      adapter = getQbDialectAdapter('unknown_db');
    });

    it('quotes identifiers with double quotes', () => {
      expect(adapter.quoteIdentifier('test')).toBe('"test"');
    });

    it('does not support ILIKE', () => {
      expect(adapter.supportsILike).toBe(false);
    });

    it('formats LIMIT without offset', () => {
      expect(adapter.formatLimitOffset(5, 0)).toBe('LIMIT 5');
    });

    it('formats LIMIT with offset', () => {
      expect(adapter.formatLimitOffset(5, 10)).toBe('LIMIT 5 OFFSET 10');
    });

    it('formats IS NULL', () => {
      expect(adapter.formatNullComparison('"c"', true)).toBe('"c" IS NULL');
    });

    it('formats IS NOT NULL', () => {
      expect(adapter.formatNullComparison('"c"', false)).toBe('"c" IS NOT NULL');
    });

    it('formats IN list', () => {
      expect(adapter.formatInList('"c"', ['x'], false)).toBe('"c" IN (x)');
    });

    it('formats NOT IN list', () => {
      expect(adapter.formatInList('"c"', ['x', 'y'], true)).toBe('"c" NOT IN (x, y)');
    });
  });
});

// ── generateJoinClause ────────────────────────────────────────

describe('generateJoinClause', () => {
  const pg = getQbDialectAdapter('postgresql');
  const mysql = getQbDialectAdapter('mysql');

  it('returns empty string for empty joins', () => {
    expect(generateJoinClause([], {}, pg)).toBe('');
  });

  it('generates INNER JOIN with no aliases', () => {
    const joins: QbJoin[] = [
      {
        id: 'j1',
        type: 'INNER',
        leftTable: 'users',
        leftColumn: 'id',
        rightTable: 'orders',
        rightColumn: 'user_id',
        isManual: true,
      },
    ];
    const result = generateJoinClause(joins, {}, pg);
    expect(result).toBe('\nINNER JOIN "orders" ON "users"."id" = "orders"."user_id"');
  });

  it('generates LEFT JOIN', () => {
    const joins: QbJoin[] = [
      {
        id: 'j1',
        type: 'LEFT',
        leftTable: 'users',
        leftColumn: 'id',
        rightTable: 'orders',
        rightColumn: 'user_id',
        isManual: false,
      },
    ];
    const result = generateJoinClause(joins, {}, pg);
    expect(result).toBe('\nLEFT JOIN "orders" ON "users"."id" = "orders"."user_id"');
  });

  it('generates RIGHT JOIN', () => {
    const joins: QbJoin[] = [
      {
        id: 'j1',
        type: 'RIGHT',
        leftTable: 'a',
        leftColumn: 'id',
        rightTable: 'b',
        rightColumn: 'a_id',
        isManual: true,
      },
    ];
    const result = generateJoinClause(joins, {}, pg);
    expect(result).toBe('\nRIGHT JOIN "b" ON "a"."id" = "b"."a_id"');
  });

  it('generates FULL JOIN', () => {
    const joins: QbJoin[] = [
      {
        id: 'j1',
        type: 'FULL',
        leftTable: 'a',
        leftColumn: 'id',
        rightTable: 'b',
        rightColumn: 'a_id',
        isManual: true,
      },
    ];
    const result = generateJoinClause(joins, {}, pg);
    expect(result).toBe('\nFULL JOIN "b" ON "a"."id" = "b"."a_id"');
  });

  it('uses alias for left table when provided', () => {
    const joins: QbJoin[] = [
      {
        id: 'j1',
        type: 'INNER',
        leftTable: 'users',
        leftColumn: 'id',
        rightTable: 'orders',
        rightColumn: 'user_id',
        isManual: true,
      },
    ];
    const result = generateJoinClause(joins, { users: 'u' }, pg);
    expect(result).toBe('\nINNER JOIN "orders" ON "u"."id" = "orders"."user_id"');
  });

  it('generates multiple JOINs', () => {
    const joins: QbJoin[] = [
      {
        id: 'j1',
        type: 'INNER',
        leftTable: 'a',
        leftColumn: 'id',
        rightTable: 'b',
        rightColumn: 'a_id',
        isManual: true,
      },
      {
        id: 'j2',
        type: 'LEFT',
        leftTable: 'b',
        leftColumn: 'id',
        rightTable: 'c',
        rightColumn: 'b_id',
        isManual: false,
      },
    ];
    const result = generateJoinClause(joins, {}, pg);
    expect(result).toContain('INNER JOIN "b"');
    expect(result).toContain('LEFT JOIN "c"');
  });

  it('uses MySQL backtick quoting', () => {
    const joins: QbJoin[] = [
      {
        id: 'j1',
        type: 'INNER',
        leftTable: 'users',
        leftColumn: 'id',
        rightTable: 'orders',
        rightColumn: 'user_id',
        isManual: true,
      },
    ];
    const result = generateJoinClause(joins, {}, mysql);
    expect(result).toBe('\nINNER JOIN `orders` ON `users`.`id` = `orders`.`user_id`');
  });
});

// ── generateLimitOffset ───────────────────────────────────────

describe('generateLimitOffset', () => {
  const pg = getQbDialectAdapter('postgresql');
  const mysql = getQbDialectAdapter('mysql');

  it('returns empty string when both are null', () => {
    expect(generateLimitOffset(null, null, pg)).toBe('');
  });

  it('generates LIMIT only (PostgreSQL)', () => {
    expect(generateLimitOffset(50, null, pg)).toBe(' LIMIT 50');
  });

  it('generates LIMIT and OFFSET (PostgreSQL)', () => {
    expect(generateLimitOffset(10, 20, pg)).toBe(' LIMIT 10 OFFSET 20');
  });

  it('generates LIMIT only (MySQL)', () => {
    expect(generateLimitOffset(50, null, mysql)).toBe(' LIMIT 50');
  });

  it('generates LIMIT and OFFSET (MySQL) with reversed syntax', () => {
    expect(generateLimitOffset(10, 20, mysql)).toBe(' LIMIT 20, 10');
  });
});

// ── supportsLimitOffset ───────────────────────────────────────

describe('supportsLimitOffset', () => {
  it('is true for dialects that emit LIMIT/OFFSET', () => {
    expect(supportsLimitOffset('postgresql')).toBe(true);
    expect(supportsLimitOffset('mysql')).toBe(true);
    expect(supportsLimitOffset('sqlite')).toBe(true);
  });

  it('is false for SQL Server, which needs TOP / OFFSET-FETCH', () => {
    expect(supportsLimitOffset('sqlserver')).toBe(false);
  });

  it('falls back to the generic adapter for an unknown dialect', () => {
    expect(supportsLimitOffset('some-unknown-db')).toBe(true);
    expect(supportsLimitOffset(undefined)).toBe(true);
  });

  it('honours a driver-level opt-out even when its dialect family can paginate', () => {
    // questdb shares the postgresql dialect family, so only the driver's own
    // declaration can turn the row window off.
    const target = DB_REGISTRY.questdb;
    expect(target.sqlDialect).toBe('postgresql');
    const prev = target.supportsOffset;
    try {
      target.supportsOffset = false;
      expect(supportsLimitOffset('questdb')).toBe(false);
      // The generator must drop the clause too, not just the controls.
      expect(generateLimitOffset(5, 2, getQbDialectAdapter('questdb'))).toBe('');
    } finally {
      if (prev === undefined) delete target.supportsOffset;
      else target.supportsOffset = prev;
    }
    expect(supportsLimitOffset('questdb')).toBe(true);
  });

  it('is opt-out: an undeclared driver keeps its family default', () => {
    expect(DB_REGISTRY.postgresql.supportsOffset).toBeUndefined();
    // Only drivers present in this build's generated registry can be asserted.
    if (DB_REGISTRY.sqlserver) expect(DB_REGISTRY.sqlserver.supportsOffset).toBe(false);
  });
});
