import { useMemo, useState } from 'react';
import { Input } from '../ui/Input';
import { useI18n } from '../../hooks/useI18n';

interface TableSelectorProps {
  tables: string[];
  selectedTables: string[];
  onToggle: (table: string) => void;
}

export function TableSelector({ tables, selectedTables, onToggle }: TableSelectorProps) {
  const { t } = useI18n();
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    if (!search.trim()) return tables;
    const q = search.trim().toLowerCase();
    return tables.filter((name) => name.toLowerCase().includes(q));
  }, [tables, search]);

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px] font-medium text-fg-secondary">
        {t('query.visualBuilder.tables')}
      </span>
      <Input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={t('query.visualBuilder.searchTables')}
        className="h-7 text-xs"
      />
      <div className="flex max-h-40 flex-col gap-0.5 overflow-y-auto">
        {filtered.length === 0 && (
          <span className="py-1 text-center text-[11px] text-fg-muted">
            {t('select.noMatches')}
          </span>
        )}
        {filtered.map((name) => (
          <label
            key={name}
            className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-[12px] text-fg hover:bg-surface-raised"
          >
            <input
              type="checkbox"
              checked={selectedTables.includes(name)}
              onChange={() => onToggle(name)}
              className="accent-accent"
            />
            <span className="min-w-0 truncate">{name}</span>
          </label>
        ))}
      </div>
    </div>
  );
}
