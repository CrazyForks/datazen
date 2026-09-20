import { useI18n } from '../../hooks/useI18n';
import { Input } from '../ui/Input';

export interface PaginationControlsProps {
  /** LIMIT value, or null when the clause is omitted. */
  limit: number | null;
  /** OFFSET value, or null when the clause is omitted. */
  offset: number | null;
  /**
   * Whether the active dialect can express LIMIT/OFFSET. When false the fields
   * are disabled, because a typed value would be silently dropped by the
   * generator (SQL Server uses TOP / OFFSET-FETCH).
   */
  supported?: boolean;
  onLimitChange: (limit: number | null) => void;
  onOffsetChange: (offset: number | null) => void;
}

/**
 * Parse a LIMIT/OFFSET field.
 *
 * An empty or unparseable field means "no clause" (null) rather than 0, so
 * clearing the input removes LIMIT/OFFSET from the generated SQL instead of
 * silently emitting `LIMIT 0`. Negatives are clamped to 0.
 */
export function parseRowCount(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.trunc(parsed));
}

/** LIMIT / OFFSET row-window controls for the visual query builder. */
export function PaginationControls({
  limit,
  offset,
  supported = true,
  onLimitChange,
  onOffsetChange,
}: PaginationControlsProps) {
  const { t } = useI18n();

  return (
    <div className="flex items-center gap-3" data-testid="qb-pagination">
      <label
        className="flex items-center gap-1.5 text-[11px] text-fg-secondary"
        title={supported ? undefined : t('query.visualBuilder.limitUnsupported')}
      >
        {t('query.visualBuilder.limit')}
        <Input
          type="number"
          min={0}
          value={limit ?? ''}
          disabled={!supported}
          onChange={(e) => onLimitChange(parseRowCount(e.target.value))}
          className="h-7 w-20 text-xs"
          data-testid="qb-limit-input"
        />
      </label>
      <label
        className="flex items-center gap-1.5 text-[11px] text-fg-secondary"
        title={supported ? undefined : t('query.visualBuilder.limitUnsupported')}
      >
        {t('query.visualBuilder.offset')}
        <Input
          type="number"
          min={0}
          value={offset ?? ''}
          disabled={!supported}
          onChange={(e) => onOffsetChange(parseRowCount(e.target.value))}
          className="h-7 w-20 text-xs"
          data-testid="qb-offset-input"
        />
      </label>
    </div>
  );
}
