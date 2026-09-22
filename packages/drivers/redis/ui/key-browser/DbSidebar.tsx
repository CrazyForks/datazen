import { Database, Loader2, Search } from 'lucide-react';
import { Input, cn, useI18n } from '@datazen/ui';
import { SearchModeTabs, type SearchMode } from './SearchModeTabs';
import { dbIndexOfName } from './workbenchDatabases';

/**
 * Database picker of the key workbench (only rendered when the host has no
 * outer navigator tree, i.e. `hideSidebar` is false).
 *
 * Presentational: it lists the merged db names with their key counts and reports
 * the user's choice. The scan/tree state stays with `RedisWorkbench` (and after
 * D-1 the search-scope segment control moves out of here into the key-tree
 * column header, where PRD §3.2 R1 wants it).
 */

export interface DbSidebarProps {
  searchMode: SearchMode;
  onSearchModeChange: (mode: SearchMode) => void;
  searchPattern: string;
  onSearchPatternChange: (pattern: string) => void;
  /** `Enter` in the pattern input applies the search (PRD §4 I-9). */
  onSearchSubmit: () => void;
  loading: boolean;
  databases: string[];
  selectedDb: string | null;
  dbCounts: Record<number, number>;
  onSelectDb: (db: string) => void;
}

export function DbSidebar({
  searchMode,
  onSearchModeChange,
  searchPattern,
  onSearchPatternChange,
  onSearchSubmit,
  loading,
  databases,
  selectedDb,
  dbCounts,
  onSelectDb,
}: DbSidebarProps) {
  const { t } = useI18n();

  return (
    <aside
      className="flex w-48 shrink-0 flex-col overflow-y-auto border-r border-edge bg-surface-alt"
      data-testid="redis-db-sidebar"
    >
      <div className="border-b border-edge p-2">
        <div className="mb-2">
          <SearchModeTabs mode={searchMode} onChange={onSearchModeChange} />
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-muted" />
          <Input
            value={searchPattern}
            onChange={(e) => onSearchPatternChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onSearchSubmit();
            }}
            placeholder={
              searchMode === 'key' ? t('redis.searchKeys') : t('redis.search.valuePlaceholder')
            }
            className="h-7 pl-7 text-xs"
            data-testid="redis-search-input"
          />
        </div>
      </div>

      {loading && (
        <div className="flex items-center gap-2 px-3 py-2 text-xs text-fg-muted">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {t('common.loading')}
        </div>
      )}

      {databases.map((db) => {
        const count = dbCounts[dbIndexOfName(db)];
        return (
          <button
            key={db}
            type="button"
            className={cn(
              'flex items-center gap-2 px-3 py-2 text-left text-sm transition-colors',
              selectedDb === db
                ? 'bg-accent/10 text-accent font-medium'
                : 'text-fg-secondary hover:bg-surface-raised hover:text-fg',
            )}
            aria-current={selectedDb === db ? 'page' : undefined}
            data-testid={`redis-db-${db}`}
            onClick={() => onSelectDb(db)}
          >
            <Database className="h-4 w-4 shrink-0" />
            <span className="min-w-0 truncate">{db}</span>
            {count != null && (
              <span className="ml-auto shrink-0 text-[11px] text-fg-muted">({count})</span>
            )}
          </button>
        );
      })}
    </aside>
  );
}
