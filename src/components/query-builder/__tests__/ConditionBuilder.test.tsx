import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConditionBuilder } from '../ConditionBuilder/ConditionBuilder';
import { useQueryBuilderStore } from '../../../stores/queryBuilderStore';

afterEach(cleanup);

const COLUMN_MAP = { users: ['id', 'name'], orders: ['id', 'user_id'] };

function setup(tables: string[] = ['users', 'orders']) {
  useQueryBuilderStore.setState(useQueryBuilderStore.getInitialState());
  useQueryBuilderStore.setState({ selectedTables: tables });
  return render(<ConditionBuilder columnMap={COLUMN_MAP} />);
}

describe('ConditionBuilder', () => {
  beforeEach(() => {
    useQueryBuilderStore.setState(useQueryBuilderStore.getInitialState());
  });

  it('shows a hint instead of an empty group when no columns are available', () => {
    setup([]);
    expect(screen.getByTestId('condition-builder-empty')).toBeTruthy();
    expect(screen.queryByTestId('condition-group-root')).toBeNull();
  });

  it('renders the root group once columns are available', () => {
    setup();
    expect(screen.getByTestId('condition-group-root')).toBeTruthy();
    expect(screen.queryByTestId('condition-builder-empty')).toBeNull();
  });

  it('adds a condition seeded with the first available field', () => {
    setup();
    fireEvent.click(screen.getByTestId('condition-add-button'));

    expect(screen.getAllByTestId('condition-row')).toHaveLength(1);
    const conditions = useQueryBuilderStore.getState().where.conditions;
    expect(conditions).toHaveLength(1);
    expect(conditions[0].table).toBe('users');
    expect(conditions[0].column).toBe('id');
  });

  it('writes edits to the value input back into the store', () => {
    setup();
    fireEvent.click(screen.getByTestId('condition-add-button'));
    fireEvent.change(screen.getByTestId('condition-value-input'), { target: { value: '42' } });

    expect(useQueryBuilderStore.getState().where.conditions[0].value).toBe('42');
  });

  it('removes a condition', () => {
    setup();
    fireEvent.click(screen.getByTestId('condition-add-button'));
    fireEvent.click(screen.getByTestId('condition-remove-button'));

    expect(screen.queryAllByTestId('condition-row')).toHaveLength(0);
    expect(useQueryBuilderStore.getState().where.conditions).toEqual([]);
  });

  it('adds a nested group', () => {
    setup();
    fireEvent.click(screen.getByTestId('condition-add-group-button'));

    expect(screen.getAllByTestId('condition-group-nested')).toHaveLength(1);
    expect(useQueryBuilderStore.getState().where.groups).toHaveLength(1);
  });

  it('toggles the root group logic to OR', () => {
    setup();
    fireEvent.click(screen.getByTestId('condition-group-logic-or'));

    expect(useQueryBuilderStore.getState().where.logic).toBe('OR');
  });

  it('toggles a nested group logic without changing the root', () => {
    setup();
    fireEvent.click(screen.getByTestId('condition-add-group-button'));

    // The nested group's own toggle is the last one in document order.
    const orToggles = screen.getAllByTestId('condition-group-logic-or');
    fireEvent.click(orToggles[orToggles.length - 1]);

    const { where } = useQueryBuilderStore.getState();
    expect(where.groups[0].logic).toBe('OR');
    expect(where.logic).toBe('AND');
  });

  it('caps nesting at one level', () => {
    setup();
    fireEvent.click(screen.getByTestId('condition-add-group-button'));

    // Root still offers "Add group"; the nested group must not.
    expect(screen.getAllByTestId('condition-add-group-button')).toHaveLength(1);
  });

  it('removes a nested group', () => {
    setup();
    fireEvent.click(screen.getByTestId('condition-add-group-button'));
    fireEvent.click(screen.getByTestId('condition-group-remove-button'));

    expect(screen.queryAllByTestId('condition-group-nested')).toHaveLength(0);
    expect(useQueryBuilderStore.getState().where.groups).toEqual([]);
  });

  it('does not offer a remove button for the root group', () => {
    setup();
    expect(screen.queryAllByTestId('condition-group-remove-button')).toHaveLength(0);
  });
});
