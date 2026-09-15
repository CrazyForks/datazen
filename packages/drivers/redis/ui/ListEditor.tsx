import { useCallback, useEffect, useState } from 'react';
import { Plus, Trash2, RefreshCw } from 'lucide-react';
import { Button } from '@datazen/ui';
import { Input } from '@datazen/ui';
import { useI18n } from '../../../../src/hooks/useI18n';
import type { KeyDetail } from '../../../../src/types';
import {
  invokeListPop,
  invokeListPush,
  invokeListSet,
  invokeListRange,
} from './keyEditorsInvokes';

const PAGE_SIZE = 100;

export function ListEditor({
  dbSessionId,
  dbIndex,
  detail,
  onChanged,
}: {
  dbSessionId: string;
  dbIndex: number;
  detail: KeyDetail;
  onChanged: () => void;
}) {
  const { t } = useI18n();

  // Pagination state
  const [items, setItems] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [totalLoaded, setTotalLoaded] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);

  // Editing state
  const [newValue, setNewValue] = useState('');
  const [editValues, setEditValues] = useState<Record<number, string>>({});

  const offset = (page - 1) * PAGE_SIZE;

  const loadPage = useCallback(
    async (targetPage: number) => {
      setLoading(true);
      try {
        const start = (targetPage - 1) * PAGE_SIZE;
        const stop = start + PAGE_SIZE - 1;
        const result = await invokeListRange(dbSessionId, dbIndex, detail.key, start, stop);
        setItems(result.items);
        setTotalLoaded(start + result.items.length);
        setHasMore(result.items.length === PAGE_SIZE);
      } finally {
        setLoading(false);
      }
    },
    [dbSessionId, dbIndex, detail.key],
  );

  useEffect(() => {
    void loadPage(page);
  }, [loadPage, page]);

  const handleRefresh = () => {
    setEditValues({});
    void loadPage(page);
  };

  const handlePageChange = (newPage: number) => {
    setPage(newPage);
    setEditValues({});
  };

  const getValue = (index: number, original: string) =>
    editValues[offset + index] !== undefined ? editValues[offset + index] : original;

  return (
    <div className="space-y-2">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-fg-muted">
          {t('redis.totalItems', { count: String(totalLoaded) })}
        </span>
        <Button variant="ghost" className="h-7 px-2 text-xs" onClick={handleRefresh}>
          <RefreshCw className="h-3 w-3" />
        </Button>
      </div>

      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-edge bg-surface-alt text-left">
            <th className="w-12 px-2 py-1.5 font-medium text-fg-muted">#</th>
            <th className="px-2 py-1.5 font-medium text-fg-muted">{t('redis.value')}</th>
            <th className="w-24 px-2 py-1.5" />
          </tr>
        </thead>
        <tbody>
          {items.map((item, index) => (
            <tr key={offset + index} className="border-b border-edge">
              <td className="px-2 py-1.5 font-mono text-fg-muted">{offset + index}</td>
              <td className="px-2 py-1.5">
                <Input
                  value={getValue(index, item)}
                  onChange={(e) =>
                    setEditValues((prev) => ({ ...prev, [offset + index]: e.target.value }))
                  }
                  className="h-7 font-mono text-xs"
                />
              </td>
              <td className="px-2 py-1.5">
                <div className="flex gap-1">
                  <Button
                    variant="secondary"
                    className="h-6 px-1.5 text-[10px]"
                    onClick={() =>
                      void invokeListSet(
                        dbSessionId,
                        dbIndex,
                        detail.key,
                        offset + index,
                        getValue(index, item),
                      ).then(() => {
                        handleRefresh();
                        onChanged();
                      })
                    }
                  >
                    {t('common.save')}
                  </Button>
                  <Button
                    variant="ghost"
                    className="h-6 px-1.5 text-[10px] text-danger"
                    onClick={() =>
                      void invokeListPop(dbSessionId, dbIndex, detail.key, 'left').then(() => {
                        handleRefresh();
                        onChanged();
                      })
                    }
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </td>
            </tr>
          ))}
          {items.length === 0 && !loading && (
            <tr>
              <td colSpan={3} className="px-2 py-4 text-center text-fg-muted">
                {t('redis.noKeys')}
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {/* Pagination */}
      <div className="flex items-center justify-between text-xs text-fg-muted">
        <span>{t('redis.pageInfo', { count: String(page) })}</span>
        <div className="flex gap-1">
          <Button
            variant="secondary"
            className="h-7 px-2 text-xs"
            disabled={page <= 1 || loading}
            onClick={() => handlePageChange(page - 1)}
          >
            {t('redis.loadPrev')}
          </Button>
          <Button
            variant="secondary"
            className="h-7 px-2 text-xs"
            disabled={!hasMore || loading}
            onClick={() => handlePageChange(page + 1)}
          >
            {t('redis.loadNext')}
          </Button>
        </div>
      </div>

      {/* Add new element */}
      <div className="flex flex-wrap items-end gap-2">
        <Input
          value={newValue}
          onChange={(e) => setNewValue(e.target.value)}
          placeholder={t('redis.value')}
          className="h-7 flex-1 font-mono text-xs"
        />
        <Button
          variant="secondary"
          className="h-7 gap-1 px-2 text-xs"
          disabled={!newValue}
          onClick={() =>
            void invokeListPush(dbSessionId, dbIndex, detail.key, 'left', [newValue]).then(() => {
              setNewValue('');
              handleRefresh();
              onChanged();
            })
          }
        >
          <Plus className="h-3 w-3" />
          {t('redis.pushLeft')}
        </Button>
        <Button
          variant="secondary"
          className="h-7 gap-1 px-2 text-xs"
          disabled={!newValue}
          onClick={() =>
            void invokeListPush(dbSessionId, dbIndex, detail.key, 'right', [newValue]).then(() => {
              setNewValue('');
              handleRefresh();
              onChanged();
            })
          }
        >
          <Plus className="h-3 w-3" />
          {t('redis.pushRight')}
        </Button>
        <Button
          variant="secondary"
          className="h-7 px-2 text-xs"
          onClick={() =>
            void invokeListPop(dbSessionId, dbIndex, detail.key, 'left').then(() => {
              handleRefresh();
              onChanged();
            })
          }
        >
          {t('redis.popLeft')}
        </Button>
        <Button
          variant="secondary"
          className="h-7 px-2 text-xs"
          onClick={() =>
            void invokeListPop(dbSessionId, dbIndex, detail.key, 'right').then(() => {
              handleRefresh();
              onChanged();
            })
          }
        >
          {t('redis.popRight')}
        </Button>
      </div>
    </div>
  );
}
