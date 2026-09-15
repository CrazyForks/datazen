import type { QbCondition, QbConditionGroup } from './types';
import { ConditionGroup } from './ConditionGroup';
import { useI18n } from '../../hooks/useI18n';

interface WhereClauseProps {
  where: QbConditionGroup;
  selectedTables: string[];
  columnMap: Record<string, string[]>;
  onAddCondition: (groupId: string, condition: Omit<QbCondition, 'id'>) => void;
  onUpdateCondition: (id: string, patch: Partial<QbCondition>) => void;
  onRemoveCondition: (id: string) => void;
  onAddGroup: (parentId: string, logic: 'AND' | 'OR') => void;
}

export function WhereClause({
  where,
  selectedTables,
  columnMap,
  onAddCondition,
  onUpdateCondition,
  onRemoveCondition,
  onAddGroup,
}: WhereClauseProps) {
  const { t } = useI18n();

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px] font-medium text-fg-secondary">
        {t('query.visualBuilder.where')}
      </span>
      <ConditionGroup
        group={where}
        depth={0}
        selectedTables={selectedTables}
        columnMap={columnMap}
        onAddCondition={onAddCondition}
        onUpdateCondition={onUpdateCondition}
        onRemoveCondition={onRemoveCondition}
        onAddGroup={onAddGroup}
      />
    </div>
  );
}
