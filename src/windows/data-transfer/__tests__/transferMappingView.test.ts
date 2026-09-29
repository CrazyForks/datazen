import { describe, expect, it } from 'vitest';
import type { TransferTableResult } from '../../../commands/transfer';
import {
  mergeInspectTables,
  normalizeColumnMappings,
  tableHasActiveMappings,
} from '../transferMappingView';

function createNewRow(overrides: Partial<TransferTableResult> = {}): TransferTableResult {
  return {
    sourceTable: 'users',
    targetTable: 'users',
    status: 'DISABLED',
    createNew: true,
    enabled: false,
    sourceColumns: ['id', 'active'],
    targetColumns: [],
    columnMappings: [
      { sourceColumn: 'id', targetColumn: 'id', skip: false },
      { sourceColumn: 'active', targetColumn: 'active', skip: false, targetNativeType: 'BOOLEAN' },
    ],
    ...overrides,
  };
}

describe('transfer mapping view state', () => {
  it('[tester] keeps every disabled create-new source column ready for explicit selection', () => {
    const row = createNewRow();

    expect(normalizeColumnMappings(row)).toEqual(row.columnMappings);
    expect(tableHasActiveMappings(row)).toBe(true);
    expect(row.enabled).toBe(false);
  });

  it('[tester] preserves selected create-new edits when inspect refreshes the row', () => {
    const previous = createNewRow({
      enabled: true,
      targetTable: 'accounts',
      columnMappings: [
        { sourceColumn: 'id', targetColumn: 'account_id', skip: false },
        {
          sourceColumn: 'active',
          targetColumn: 'active',
          skip: false,
          targetNativeType: 'BOOLEAN',
        },
      ],
    });
    const inspected = createNewRow({
      status: 'CREATE_NEW',
      targetTable: 'users',
      columnMappings: [],
    });

    expect(mergeInspectTables([previous], [inspected])).toEqual([
      {
        ...inspected,
        enabled: true,
        targetTable: 'accounts',
        createNew: true,
        columnMappings: previous.columnMappings,
      },
    ]);
  });
});
