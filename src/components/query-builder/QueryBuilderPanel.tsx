import { useEffect } from 'react';
import { X } from 'lucide-react';
import { useSchemaStore } from '../../stores/schemaStore';
import { useQueryBuilderStore } from '../../stores/queryBuilderStore';
import { useSqlGenerator } from './hooks/useSqlGenerator';
import { TableSelector } from './TableSelector';
import { ColumnSelector } from './ColumnSelector';
import { WhereClause } from './WhereClause';
import { SortClause } from './SortClause';
import { GroupByClause } from './GroupByClause';
import { SqlPreview } from './SqlPreview';
import { Button } from '../ui/Button';
import { useI18n } from '../../hooks/useI18n';

export interface QueryBuilderPanelProps {
  dbSessionId: string;
  databaseType?: string;
  onApplySql: (sql: string) => void;
}

export function QueryBuilderPanel({
  dbSessionId: _dbSessionId,
  databaseType,
  onApplySql,
}: QueryBuilderPanelProps) {
  const { t } = useI18n();

  // Schema data
  const tables = useSchemaStore((s) => s.tables);
  const columnMap = useSchemaStore((s) => s.columnMap);
  const ensureColumns = useSchemaStore((s) => s.ensureColumns);

  // Query builder state
  const selectedTables = useQueryBuilderStore((s) => s.selectedTables);
  const selectedColumns = useQueryBuilderStore((s) => s.selectedColumns);
  const where = useQueryBuilderStore((s) => s.where);
  const orderBy = useQueryBuilderStore((s) => s.orderBy);
  const groupBy = useQueryBuilderStore((s) => s.groupBy);
  const distinct = useQueryBuilderStore((s) => s.distinct);

  // Query builder actions
  const toggleTable = useQueryBuilderStore((s) => s.toggleTable);
  const toggleColumn = useQueryBuilderStore((s) => s.toggleColumn);
  const setColumnAlias = useQueryBuilderStore((s) => s.setColumnAlias);
  const setColumnAggregate = useQueryBuilderStore((s) => s.setColumnAggregate);
  const addCondition = useQueryBuilderStore((s) => s.addCondition);
  const updateCondition = useQueryBuilderStore((s) => s.updateCondition);
  const removeCondition = useQueryBuilderStore((s) => s.removeCondition);
  const addConditionGroup = useQueryBuilderStore((s) => s.addConditionGroup);
  const addSort = useQueryBuilderStore((s) => s.addSort);
  const removeSort = useQueryBuilderStore((s) => s.removeSort);
  const addGroupBy = useQueryBuilderStore((s) => s.addGroupBy);
  const removeGroupBy = useQueryBuilderStore((s) => s.removeGroupBy);
  const setDistinct = useQueryBuilderStore((s) => s.setDistinct);
  const reset = useQueryBuilderStore((s) => s.reset);
  const toggleOpen = useQueryBuilderStore((s) => s.toggleOpen);

  // Ensure columns are loaded for selected tables
  useEffect(() => {
    if (selectedTables.length === 0) return;
    void ensureColumns(selectedTables);
  }, [selectedTables, ensureColumns]);

  // Generate SQL preview
  const sql = useSqlGenerator({
    selectedTables,
    selectedColumns,
    where,
    orderBy,
    groupBy,
    distinct,
    databaseType,
  });

  const handleApply = () => {
    if (sql) {
      onApplySql(sql);
    }
  };

  const handleClose = () => {
    toggleOpen();
  };

  return (
    <div className="flex flex-col gap-3 border-b border-edge bg-surface p-3" data-testid="qb-panel">
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-semibold text-fg">{t('query.visualBuilder.title')}</span>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-[11px] text-fg-secondary">
            <input
              type="checkbox"
              checked={distinct}
              onChange={(e) => setDistinct(e.target.checked)}
              className="accent-accent"
              data-testid="qb-distinct-checkbox"
            />
            {t('query.visualBuilder.distinct')}
          </label>
          <button
            type="button"
            onClick={reset}
            className="rounded px-2 py-0.5 text-[11px] text-fg-muted hover:bg-surface-raised hover:text-fg"
          >
            {t('query.visualBuilder.reset')}
          </button>
          <button
            type="button"
            onClick={handleClose}
            title={t('query.visualBuilder.close')}
            className="flex items-center justify-center rounded px-2 py-0.5 text-fg-muted hover:bg-surface-raised hover:text-fg"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Main content: two-column layout */}
      <div className="flex gap-3">
        {/* Left: Tables + Columns */}
        <div className="flex w-64 shrink-0 flex-col gap-3">
          <TableSelector
            tables={tables.map((tbl) => tbl.name)}
            selectedTables={selectedTables}
            onToggle={toggleTable}
          />
          <ColumnSelector
            selectedTables={selectedTables}
            columnMap={columnMap}
            selectedColumns={selectedColumns}
            onToggle={toggleColumn}
            onSetAlias={setColumnAlias}
            onSetAggregate={setColumnAggregate}
          />
        </div>

        {/* Right: Conditions + Sort + Group */}
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <WhereClause
            where={where}
            selectedTables={selectedTables}
            columnMap={columnMap}
            onAddCondition={addCondition}
            onUpdateCondition={updateCondition}
            onRemoveCondition={removeCondition}
            onAddGroup={addConditionGroup}
          />
          <SortClause
            orderBy={orderBy}
            selectedColumns={selectedColumns}
            onAdd={addSort}
            onRemove={removeSort}
          />
          <GroupByClause
            groupBy={groupBy}
            selectedColumns={selectedColumns}
            onAdd={addGroupBy}
            onRemove={removeGroupBy}
          />
        </div>
      </div>

      {/* SQL Preview + Apply */}
      <SqlPreview sql={sql} />
      <div className="flex justify-end">
        <Button
          variant="primary"
          size="sm"
          onClick={handleApply}
          disabled={!sql}
          data-testid="qb-apply-sql"
        >
          {t('query.visualBuilder.applySql')}
        </Button>
      </div>
    </div>
  );
}
