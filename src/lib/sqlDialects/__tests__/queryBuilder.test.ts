import { describe, it, expect } from 'vitest';
import { getQbDialectAdapter } from '../queryBuilder';
import type { QbDialectAdapter } from '../queryBuilder';

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
    it('setup', () => { adapter = getQbDialectAdapter('postgresql'); });

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
    it('setup', () => { adapter = getQbDialectAdapter('mysql'); });

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
    it('setup', () => { adapter = getQbDialectAdapter('sqlite'); });

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
    it('setup', () => { adapter = getQbDialectAdapter('sqlserver'); });

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
    it('setup', () => { adapter = getQbDialectAdapter('unknown_db'); });

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
