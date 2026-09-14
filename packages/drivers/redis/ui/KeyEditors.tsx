import { useCallback, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@datazen/ui';
import { useTranslation } from 'react-i18next';
import { invokeSetString, invokeSetExpireAt } from './keyEditorsInvokes';
import { tryDecompress, formatJsonPretty } from './stringKeyValue';
import type { RedisKeyDetail } from './meta';

interface StringEditorProps {
  connectionId: string;
  keyName: string;
  detail: RedisKeyDetail;
  onSaved?: () => void;
}

export function StringEditor({ connectionId, keyName, detail, onSaved }: StringEditorProps) {
  const { t } = useTranslation();
  const [value, setValue] = useState(detail.value ?? '');
  const [keepTtl, setKeepTtl] = useState(false);
  const [expireAt, setExpireAt] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDecompressed, setShowDecompressed] = useState(false);
  const [decompView, setDecompView] = useState<'raw' | 'json'>('raw');

  const handleSave = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const opts: { keepTtl?: boolean; expireAt?: number } = {};
      if (keepTtl) opts.keepTtl = true;
      if (expireAt) {
        const ts = Math.floor(new Date(expireAt).getTime() / 1000);
        if (!Number.isNaN(ts)) opts.expireAt = ts;
      }
      await invokeSetString(connectionId, keyName, value, opts);
      if (opts.expireAt != null && !opts.keepTtl) {
        await invokeSetExpireAt(connectionId, keyName, opts.expireAt);
      }
      onSaved?.();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [connectionId, keyName, value, keepTtl, expireAt, onSaved]);

  const decompressed = tryDecompress(value);
  const canDecompress = decompressed != null;

  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="flex items-center gap-2 flex-wrap">
        <label className="flex items-center gap-1.5 text-sm">
          <input
            type="checkbox"
            checked={keepTtl}
            onChange={(e) => setKeepTtl(e.target.checked)}
          />
          {t('redis.keepTtl', 'Keep TTL')}
        </label>
        <label className="flex items-center gap-1.5 text-sm">
          {t('redis.expireAt', 'Expire at')}
          <input
            type="datetime-local"
            value={expireAt}
            onChange={(e) => setExpireAt(e.target.value)}
            className="border rounded px-2 py-1 text-sm"
            disabled={keepTtl}
          />
        </label>
        {canDecompress && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowDecompressed((v) => !v)}
          >
            {showDecompressed
              ? t('redis.hideDecompress', 'Hide decompressed')
              : t('redis.showDecompress', 'Show decompressed')}
          </Button>
        )}
        {showDecompressed && canDecompress && (
          <select
            value={decompView}
            onChange={(e) => setDecompView(e.target.value as 'raw' | 'json')}
            className="border rounded px-2 py-1 text-sm"
          >
            <option value="raw">{t('redis.raw', 'Raw')}</option>
            <option value="json">{t('redis.jsonPretty', 'JSON pretty')}</option>
          </select>
        )}
      </div>

      {showDecompressed && canDecompress ? (
        <pre className="bg-muted/50 rounded p-3 text-xs overflow-auto max-h-96 whitespace-pre-wrap break-all">
          {decompView === 'json'
            ? formatJsonPretty(decompressed)
            : decompressed}
        </pre>
      ) : (
        <textarea
          className="w-full min-h-[200px] border rounded p-2 font-mono text-sm"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          spellCheck={false}
        />
      )}

      {error && <div className="text-destructive text-sm">{error}</div>}

      <div className="flex gap-2">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? <Loader2 className="animate-spin mr-1 h-4 w-4" /> : null}
          {t('common.save', 'Save')}
        </Button>
      </div>
    </div>
  );
}

interface KeyEditorsProps {
  connectionId: string;
  keyName: string;
  keyType: string;
  detail: RedisKeyDetail;
  onSaved?: () => void;
  onDeleted?: () => void;
}

export function KeyEditors(props: KeyEditorsProps) {
  const { keyType } = props;
  if (keyType === 'string') {
    return <StringEditor {...props} />;
  }
  const Rest = require('./KeyEditorsRest').KeyEditorsRest;
  return <Rest {...props} />;
}

export { tryDecompress, formatJsonPretty } from './stringKeyValue';

function extractStringValue(v: unknown): string {
  if (typeof v === 'string') return v;
  if (v && typeof v === 'object' && 'value' in (v as object)) {
    const inner = (v as { value: unknown }).value;
    if (typeof inner === 'string') return inner;
  }
  return '';
}
