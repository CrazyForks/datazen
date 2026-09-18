import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PaginationControls, parseRowCount } from '../PaginationControls';

afterEach(cleanup);

describe('parseRowCount', () => {
  it('treats an empty field as "no clause" rather than zero', () => {
    expect(parseRowCount('')).toBeNull();
    expect(parseRowCount('   ')).toBeNull();
  });

  it('parses a positive integer', () => {
    expect(parseRowCount('25')).toBe(25);
    expect(parseRowCount(' 25 ')).toBe(25);
  });

  it('treats unparseable input as "no clause"', () => {
    expect(parseRowCount('abc')).toBeNull();
    expect(parseRowCount('1e999')).toBeNull();
  });

  it('clamps negatives to zero and truncates fractions', () => {
    expect(parseRowCount('-5')).toBe(0);
    expect(parseRowCount('10.9')).toBe(10);
  });
});

describe('PaginationControls', () => {
  it('renders the current limit and offset', () => {
    render(
      <PaginationControls
        limit={10}
        offset={20}
        onLimitChange={() => {}}
        onOffsetChange={() => {}}
      />,
    );
    expect((screen.getByTestId('qb-limit-input') as HTMLInputElement).value).toBe('10');
    expect((screen.getByTestId('qb-offset-input') as HTMLInputElement).value).toBe('20');
  });

  it('renders an empty field when the clause is unset', () => {
    render(
      <PaginationControls
        limit={null}
        offset={null}
        onLimitChange={() => {}}
        onOffsetChange={() => {}}
      />,
    );
    expect((screen.getByTestId('qb-limit-input') as HTMLInputElement).value).toBe('');
    expect((screen.getByTestId('qb-offset-input') as HTMLInputElement).value).toBe('');
  });

  it('reports a parsed number when the limit changes', () => {
    const onLimitChange = vi.fn();
    render(
      <PaginationControls
        limit={null}
        offset={null}
        onLimitChange={onLimitChange}
        onOffsetChange={() => {}}
      />,
    );
    fireEvent.change(screen.getByTestId('qb-limit-input'), { target: { value: '50' } });
    expect(onLimitChange).toHaveBeenCalledWith(50);
  });

  it('disables both fields when the dialect cannot express a row window', () => {
    render(
      <PaginationControls
        limit={null}
        offset={null}
        supported={false}
        onLimitChange={() => {}}
        onOffsetChange={() => {}}
      />,
    );
    expect((screen.getByTestId('qb-limit-input') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByTestId('qb-offset-input') as HTMLInputElement).disabled).toBe(true);
  });

  it('reports null when a field is cleared', () => {
    const onOffsetChange = vi.fn();
    render(
      <PaginationControls
        limit={null}
        offset={20}
        onLimitChange={() => {}}
        onOffsetChange={onOffsetChange}
      />,
    );
    fireEvent.change(screen.getByTestId('qb-offset-input'), { target: { value: '' } });
    expect(onOffsetChange).toHaveBeenCalledWith(null);
  });
});
