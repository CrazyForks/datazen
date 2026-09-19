/**
 * BuildStatement — the Navicat-style clause list.
 *
 * The behaviours worth pinning are the ones the layout change introduced:
 * every clause exists (HAVING did not exist before), a column is a chip whose
 * options live in a dialog rather than in eight inline controls, and each
 * clause's pickers/chips reach the matching action with the right payload.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { BuildStatement } from '../BuildStatement';
import type { BuildStatementActions } from '../BuildStatement';
import { ConditionClause } from '../../CriteriaGrid/ConditionClause';
import { useQueryBuilderStore } from '../../../../stores/queryBuilderStore';
import type { QbColumnSelection, QbConditionGroup } from '../../types';

vi.mock('../../../../hooks/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

function emptyGroup(id = 'g'): QbConditionGroup {
  return { id, logic: 'AND', conditions: [], groups: [] };
}

const COLUMNS = { sales: ['qty', 'region', 'total'], regions: ['id', 'name'] };

function makeActions(overrides: Partial<BuildStatementActions> = {}): BuildStatementActions {
  return {
    setDistinct: vi.fn(),
    addColumn: vi.fn(),
    removeColumn: vi.fn(),
    updateColumn: vi.fn(),
    setTableAlias: vi.fn(),
    removeTable: vi.fn(),
    addTable: vi.fn(),
    addCondition: vi.fn(),
    updateCondition: vi.fn(),
    removeCondition: vi.fn(),
    addConditionGroup: vi.fn(),
    setGroupLogic: vi.fn(),
    addHavingCondition: vi.fn(),
    updateHavingCondition: vi.fn(),
    removeHavingCondition: vi.fn(),
    addHavingGroup: vi.fn(),
    setHavingGroupLogic: vi.fn(),
    addGroupBy: vi.fn(),
    removeGroupBy: vi.fn(),
    addSort: vi.fn(),
    toggleSort: vi.fn(),
    removeSort: vi.fn(),
    ...overrides,
  };
}

interface HarnessOptions {
  selectedColumns?: QbColumnSelection[];
  where?: QbConditionGroup;
  having?: QbConditionGroup;
  groupBy?: { table: string; column: string }[];
  orderBy?: { table: string; column: string; direction: 'ASC' | 'DESC' }[];
  joins?: Parameters<typeof BuildStatement>[0]['state']['joins'];
  aliases?: Record<string, string>;
  tables?: string[];
  availableTables?: string[];
  actions?: Partial<BuildStatementActions>;
}

function renderStatement(options: HarnessOptions = {}) {
  const actions = makeActions(options.actions);
  const tables = options.tables ?? ['sales'];
  render(
    <BuildStatement
      schema={{
        tables,
        columns: COLUMNS,
        aliases: options.aliases ?? {},
        availableTables: options.availableTables ?? [],
      }}
      state={{
        selectedColumns: options.selectedColumns ?? [],
        distinct: false,
        joins: options.joins ?? [],
        where: options.where ?? emptyGroup('where'),
        having: options.having ?? emptyGroup('having'),
        groupBy: options.groupBy ?? [],
        orderBy: options.orderBy ?? [],
      }}
      actions={actions}
    />,
  );
  return { actions };
}

afterEach(cleanup);

describe('BuildStatement — clause list', () => {
  it('renders every SQL clause, HAVING included', () => {
    renderStatement();
    for (const clause of ['select', 'from', 'where', 'group-by', 'having', 'order-by']) {
      expect(screen.getByTestId(`qb-clause-${clause}`)).toBeInTheDocument();
    }
    // The keywords are SQL, not prose.
    expect(screen.getByTestId('qb-clause-having')).toHaveTextContent('HAVING');
    expect(screen.getByTestId('qb-clause-group-by')).toHaveTextContent('GROUP BY');
  });

  it('shows a column as one chip carrying its aggregate and alias', () => {
    renderStatement({
      selectedColumns: [{ table: 'sales', column: 'qty', aggregate: 'SUM', alias: 'total_qty' }],
    });
    const chip = screen.getByTestId('qb-field-chip-sales-qty');
    expect(chip).toHaveTextContent('SUM(');
    expect(chip).toHaveTextContent('sales.qty');
    expect(chip).toHaveTextContent('AS total_qty');
  });

  it('qualifies chips with the table alias, matching the emitted SQL', () => {
    renderStatement({
      selectedColumns: [{ table: 'sales', column: 'qty' }],
      aliases: { sales: 's' },
    });
    expect(screen.getByTestId('qb-field-chip-sales-qty')).toHaveTextContent('s.qty');
  });
});

describe('BuildStatement — column options dialog', () => {
  it('opens on a chip click and applies the edited options', () => {
    const { actions } = renderStatement({
      selectedColumns: [{ table: 'sales', column: 'qty' }],
    });

    // Closed until asked for: no inline option controls at all.
    expect(screen.queryByTestId('qb-col-opt-apply')).toBeNull();

    fireEvent.click(screen.getByTestId('qb-field-chip-sales-qty').querySelector('button')!);
    expect(screen.getByTestId('qb-col-opt-field')).toHaveTextContent('sales.qty');

    fireEvent.change(screen.getByTestId('qb-col-opt-alias'), { target: { value: 'total' } });
    fireEvent.click(screen.getByTestId('qb-col-opt-groupby'));
    fireEvent.click(screen.getByTestId('qb-col-opt-apply'));

    expect(actions.updateColumn).toHaveBeenCalledTimes(1);
    const [table, column, patch] = vi.mocked(actions.updateColumn).mock.calls[0]!;
    expect(table).toBe('sales');
    expect(column).toBe('qty');
    expect(patch).toMatchObject({ alias: 'total', groupBy: true });
    // Untouched controls must not invent values.
    expect(patch.aggregate).toBeUndefined();
    expect(patch.sort).toBeUndefined();
    expect(patch.where).toBeUndefined();
  });

  it('seeds the existing options, including the per-column criteria', () => {
    renderStatement({
      selectedColumns: [
        {
          table: 'sales',
          column: 'qty',
          alias: 'q',
          aggregate: 'SUM',
          sort: 'DESC',
          groupBy: true,
          where: {
            id: 'w1',
            table: 'sales',
            column: 'qty',
            operator: '>=',
            value: '10',
            conjunction: 'AND',
          },
        },
      ],
    });

    fireEvent.click(screen.getByTestId('qb-field-chip-sales-qty').querySelector('button')!);
    expect(screen.getByTestId('qb-col-opt-alias')).toHaveValue('q');
    expect(screen.getByTestId('qb-col-opt-groupby')).toBeChecked();
    expect(screen.getByTestId('qb-col-opt-value')).toHaveValue('10');
    expect(screen.getByTestId('qb-col-opt-operator')).toHaveTextContent('>=');
    expect(screen.getByTestId('qb-col-opt-aggregate')).toHaveTextContent('SUM');
    expect(screen.getByTestId('qb-col-opt-sort')).toHaveTextContent('query.visualBuilder.desc');
  });

  it('removes the column from the dialog', () => {
    const { actions } = renderStatement({
      selectedColumns: [{ table: 'sales', column: 'qty' }],
    });
    fireEvent.click(screen.getByTestId('qb-field-chip-sales-qty').querySelector('button')!);
    fireEvent.click(screen.getByTestId('qb-col-opt-remove'));
    expect(actions.removeColumn).toHaveBeenCalledWith('sales', 'qty');
  });

  it('leaves re-renders alone while the user is typing', () => {
    const { rerender } = render(
      <BuildStatement
        schema={{ tables: ['sales'], columns: COLUMNS, aliases: {}, availableTables: [] }}
        state={{
          selectedColumns: [{ table: 'sales', column: 'qty' }],
          distinct: false,
          joins: [],
          where: emptyGroup('where'),
          having: emptyGroup('having'),
          groupBy: [],
          orderBy: [],
        }}
        actions={makeActions()}
      />,
    );
    fireEvent.click(screen.getByTestId('qb-field-chip-sales-qty').querySelector('button')!);
    fireEvent.change(screen.getByTestId('qb-col-opt-alias'), { target: { value: 'typing' } });

    // An unrelated store update (new object identities) must not wipe the form.
    rerender(
      <BuildStatement
        schema={{ tables: ['sales'], columns: COLUMNS, aliases: {}, availableTables: [] }}
        state={{
          selectedColumns: [{ table: 'sales', column: 'qty' }],
          distinct: true,
          joins: [],
          where: emptyGroup('where'),
          having: emptyGroup('having'),
          groupBy: [],
          orderBy: [{ table: 'sales', column: 'region', direction: 'ASC' }],
        }}
        actions={makeActions()}
      />,
    );
    expect(screen.getByTestId('qb-col-opt-alias')).toHaveValue('typing');
  });
});

describe('BuildStatement — HAVING', () => {
  it('adds a condition that starts aggregated', () => {
    const { actions } = renderStatement();
    fireEvent.click(screen.getByTestId('qb-having-add-condition'));
    expect(actions.addHavingCondition).toHaveBeenCalledWith(
      'having',
      expect.objectContaining({ table: 'sales', column: 'qty', aggregate: 'SUM', operator: '=' }),
    );
  });

  it('offers an aggregate per HAVING row but not per WHERE row', () => {
    renderStatement({
      where: { ...emptyGroup('where'), conditions: [cond('w1', { column: 'region' })] },
      having: { ...emptyGroup('having'), conditions: [cond('h1', { aggregate: 'AVG' })] },
    });
    expect(screen.getByTestId('qb-having-aggregate')).toHaveTextContent('AVG');
    expect(screen.queryByTestId('qb-where-aggregate')).toBeNull();
  });

  it('shows the empty-state placeholder and hides it once a row exists', () => {
    const { unmount } = render(
      <BuildStatement
        schema={{ tables: ['sales'], columns: COLUMNS, aliases: {}, availableTables: [] }}
        state={{
          selectedColumns: [],
          distinct: false,
          joins: [],
          where: emptyGroup('where'),
          having: emptyGroup('having'),
          groupBy: [],
          orderBy: [],
        }}
        actions={makeActions()}
      />,
    );
    expect(screen.getByTestId('qb-having-empty')).toHaveTextContent(
      '<query.visualBuilder.addConditions>',
    );
    unmount();

    renderStatement({ having: { ...emptyGroup('having'), conditions: [cond('h1')] } });
    expect(screen.queryByTestId('qb-having-empty')).toBeNull();
    expect(screen.getByTestId('qb-having-row')).toBeInTheDocument();
  });

  it('adds and removes HAVING sub-groups', () => {
    const { actions } = renderStatement();
    fireEvent.click(screen.getByTestId('qb-having-add-group'));
    expect(actions.addHavingGroup).toHaveBeenCalledWith('having', 'OR');
  });
});

describe('BuildStatement — GROUP BY / ORDER BY', () => {
  it('renders one chip per key from both sources', () => {
    renderStatement({
      selectedColumns: [{ table: 'sales', column: 'total', sort: 'DESC' }],
      groupBy: [{ table: 'sales', column: 'region' }],
      orderBy: [{ table: 'sales', column: 'region', direction: 'ASC' }],
    });
    expect(screen.getByTestId('qb-group-chip-sales-region')).toBeInTheDocument();
    // The per-column sort shows up in ORDER BY alongside the store-level one.
    expect(screen.getByTestId('qb-order-chip-sales-region')).toHaveTextContent('ASC');
    expect(screen.getByTestId('qb-order-chip-sales-total')).toHaveTextContent('DESC');
  });

  it('flips a direction on chip click and removes with the ×', () => {
    const { actions } = renderStatement({
      orderBy: [{ table: 'sales', column: 'region', direction: 'ASC' }],
    });
    fireEvent.click(screen.getByTestId('qb-order-chip-sales-region').querySelector('button')!);
    expect(actions.toggleSort).toHaveBeenCalledWith(
      expect.objectContaining({ column: 'region', direction: 'ASC', source: 'store', index: 0 }),
    );

    fireEvent.click(screen.getByTestId('qb-order-remove-sales-region'));
    expect(actions.removeSort).toHaveBeenCalledWith(expect.objectContaining({ column: 'region' }));
  });

  it('removes a GROUP BY chip through its own entry', () => {
    const { actions } = renderStatement({
      groupBy: [{ table: 'sales', column: 'region' }],
    });
    fireEvent.click(screen.getByTestId('qb-group-remove-sales-region'));
    expect(actions.removeGroupBy).toHaveBeenCalledWith(
      expect.objectContaining({ column: 'region', source: 'store', index: 0 }),
    );
  });

  it('clears a column-owned GROUP BY through updateColumn', () => {
    const { actions } = renderStatement({
      selectedColumns: [{ table: 'sales', column: 'qty', groupBy: true }],
    });
    fireEvent.click(screen.getByTestId('qb-group-remove-sales-qty'));
    // Chip removal is reported as an entry; the panel maps it onto the owner.
    expect(actions.removeGroupBy).toHaveBeenCalledWith(
      expect.objectContaining({ column: 'qty', source: 'column' }),
    );
  });
});

describe('BuildStatement — WHERE', () => {
  it('surfaces per-column criteria as chips, since the generator merges them', () => {
    renderStatement({
      selectedColumns: [
        {
          table: 'sales',
          column: 'qty',
          where: {
            id: 'w1',
            table: 'sales',
            column: 'qty',
            operator: '>=',
            value: '80',
            conjunction: 'AND',
          },
        },
      ],
    });
    const chip = screen.getByTestId('qb-where-column-chip-sales-qty');
    expect(chip).toHaveTextContent('>= 80');
  });

  it('removes a per-column criterion without touching the WHERE tree', () => {
    const { actions } = renderStatement({
      selectedColumns: [
        {
          table: 'sales',
          column: 'qty',
          where: {
            id: 'w1',
            table: 'sales',
            column: 'qty',
            operator: '>=',
            value: '80',
            conjunction: 'AND',
          },
        },
      ],
    });
    fireEvent.click(screen.getByTestId('qb-where-column-remove-sales-qty'));
    expect(actions.updateColumn).toHaveBeenCalledWith('sales', 'qty', { where: undefined });
    expect(actions.removeCondition).not.toHaveBeenCalled();
  });
});

describe('BuildStatement — FROM', () => {
  it('lists the join the generator will emit, oriented the same way', () => {
    renderStatement({
      tables: ['sales', 'regions'],
      joins: [
        {
          id: 'j1',
          type: 'LEFT',
          leftTable: 'sales',
          leftColumn: 'region_id',
          rightTable: 'regions',
          rightColumn: 'id',
          isManual: false,
        },
      ],
    });
    const row = screen.getByTestId('qb-from-join-0');
    expect(row).toHaveTextContent('LEFT JOIN');
    expect(row).toHaveTextContent('regions');
    // Oriented from the included side outwards: sales.region_id = regions.id
    expect(row).toHaveTextContent('sales.region_id = regions.id');
  });

  it('flags a table that no join reaches', () => {
    renderStatement({ tables: ['sales', 'regions'] });
    expect(screen.getByTestId('qb-from-unjoined-regions')).toHaveTextContent(
      'query.visualBuilder.unjoinedTable',
    );
  });

  it('adds a table from the picker list', () => {
    const { actions } = renderStatement({ availableTables: ['orders'] });
    // ≤10 options renders a plain button trigger, so a click opens the list.
    fireEvent.click(screen.getByTestId('qb-add-tables'));
    fireEvent.mouseDown(screen.getByRole('option', { name: 'orders' }));
    expect(actions.addTable).toHaveBeenCalledWith('orders');
    expect(screen.queryByRole('option', { name: 'orders' })).toBeNull();
  });

  it('adds a field from the SELECT picker', () => {
    const { actions } = renderStatement({ selectedColumns: [{ table: 'sales', column: 'qty' }] });
    fireEvent.click(screen.getByTestId('qb-add-fields'));
    // The already-selected column is not offered again.
    expect(screen.queryByRole('option', { name: 'sales.qty' })).toBeNull();
    fireEvent.mouseDown(screen.getByRole('option', { name: 'sales.region' }));
    expect(actions.addColumn).toHaveBeenCalledWith('sales', 'region');
  });
});

describe('ConditionClause — conjunction seeding', () => {
  /** Wire the clause straight to the real store, as the panel does. */
  function StoreHarness({ clause }: { clause: 'where' | 'having' }) {
    const group = useQueryBuilderStore((s) => (clause === 'where' ? s.where : s.having));
    const actions = useQueryBuilderStore.getState();
    return (
      <ConditionClause
        group={group}
        testIdPrefix={clause === 'where' ? 'qb-where' : 'qb-having'}
        allTables={['t']}
        allColumns={{ t: ['a', 'b'] }}
        allowAggregate={clause === 'having'}
        onAddCondition={clause === 'where' ? actions.addCondition : actions.addHavingCondition}
        onUpdateCondition={
          clause === 'where' ? actions.updateCondition : actions.updateHavingCondition
        }
        onRemoveCondition={
          clause === 'where' ? actions.removeCondition : actions.removeHavingCondition
        }
        onAddGroup={clause === 'where' ? actions.addConditionGroup : actions.addHavingGroup}
        onSetGroupLogic={clause === 'where' ? actions.setGroupLogic : actions.setHavingGroupLogic}
      />
    );
  }

  beforeEach(() => {
    useQueryBuilderStore.setState(useQueryBuilderStore.getInitialState());
  });

  it.each(['where', 'having'] as const)(
    'seeds a row added to an OR sub-group with OR (%s)',
    (clause) => {
      render(<StoreHarness clause={clause} />);
      const prefix = clause === 'where' ? 'qb-where' : 'qb-having';

      fireEvent.click(screen.getByTestId(`${prefix}-add-group`));
      const subId = useQueryBuilderStore.getState()[clause].groups[0]!.id;
      expect(useQueryBuilderStore.getState()[clause].groups[0]!.logic).toBe('OR');

      fireEvent.click(screen.getByTestId(`${prefix}-subgroup-add-condition`));
      const added = useQueryBuilderStore.getState()[clause].groups[0]!.conditions[0]!;
      // Hardcoding AND here would turn the group's `(a OR b)` into `(a AND b)`.
      expect(added.conjunction).toBe('OR');
      expect(subId).toBeTruthy();
      if (clause === 'having') expect(added.aggregate).toBe('SUM');
    },
  );

  it('seeds a root row with the root logic', () => {
    render(<StoreHarness clause="where" />);
    fireEvent.click(screen.getByTestId('qb-where-add-condition'));
    expect(useQueryBuilderStore.getState().where.conditions[0]!.conjunction).toBe('AND');
  });
});

/** Build a condition with defaults. */
function cond(id: string, patch: Partial<QbConditionGroup['conditions'][number]> = {}) {
  return {
    id,
    table: 'sales',
    column: 'qty',
    operator: '>=' as const,
    value: '1',
    conjunction: 'AND' as const,
    ...patch,
  };
}
