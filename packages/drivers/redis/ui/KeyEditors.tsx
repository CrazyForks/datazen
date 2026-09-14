import { useCallback, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@datazen/ui';
import { Input } from '@datazen/ui';
import { useI18n } from '../../../../src/hooks/useI18n';
import type { KeyDetail } from '../../../../src/types';
import { hasRedisJson, isJsonKeyType, looksLikeJsonModuleDetail } from './hasRedisJson';
import { JsonEditor } from './JsonEditor';
import { StreamEditor } from './StreamEditor';
import {
  initialStringEditorValue,
  looksLikeJsonText,
  tryPrettyJson,
  tryDecompressString,
  valueLooksCompressed,
  type DecompressResult,
} from './stringKeyValue';
import {
  invokeCreateKey,
  invokeRename,
  invokeSetExpireAt,
  invokeSetString,
  invokeSetTtl,
} from './keyEditorsInvokes';
import { HashEditor } from './HashEditor';
import { ListEditor } from './ListEditor';
import { SetEditor } from './SetEditor';
import { ZsetEditor } from './ZsetEditor';

export type { PluginInvokeFn } from './keyEditorsInvokes';
export {
  invokeCreateKey,
  invokeHashDel,
  invokeHashSet,
  invokeListPop,
  invokeListPush,
  invokeListSet,
  invokeRename,
  invokeSetAdd,
  invokeSetExpireAt,
  invokeSetRemove,
  invokeSetString,
  invokeSetTtl,
  invokeZsetAdd,
  invokeZsetRemove,
} from './keyEditorsInvokes';

export interface KeyDetailEditorProps {
  dbSessionId: string;
  dbIndex: number;
  detail: KeyDetail;
  modules?: string[] | null;
  onRefresh: () => void | Promise<void>;
  onRenamed?: (newKey: string) => void;
}

export function KeyDetailEditor({
  dbSessionId,
  dbIndex,
  detail,
  modules,
  onRefresh,
  onRenamed,
}: KeyDetailEditorProps) {
  const { t } = useI18n();
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState(detail.key);
  const [ttlInput, setTtlInput] = useState('');
  const [busy, setBusy] = useState(false);

  const handleRename = useCallback(async () => {
    if (!newName.trim() || newName === detail.key) {
      setRenaming(false);
      return;
    }
    setBusy(true);
    try {
      await invokeRename(dbSessionId, dbIndex, detail.key, newName.trim());
      onRenamed?.(newName.trim());
      setRenaming(false);
      await onRefresh();
    } finally {
      setBusy(false);
    }
  }, [dbSessionId, dbIndex, detail.key, newName, onRenamed, onRefresh]);

  const handleSetTtl = useCallback(async () => {
    const sec = parseInt(ttlInput, 10);
    if (Number.isNaN(sec)) return;
    setBusy(true);
    try {
      await invokeSetTtl(dbSessionId, dbIndex, detail.key, sec);
      setTtlInput('');
      await onRefresh();
    } finally {
      setBusy(false);
    }
  }, [dbSessionId, dbIndex, detail.key, ttlInput, onRefresh]);

  const keyType = detail.type;

  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="flex flex-wrap items-center gap-2">
        {renaming ? (
          <>
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="h-8 font-mono text-sm"
              autoFocus
            />
            <Button size="sm" disabled={busy} onClick={() => void handleRename()}>
              {t('common.save')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setRenaming(false)}>
              {t('common.cancel')}
            </Button>
          </>
        ) : (
          <>
            <span className="font-mono text-sm font-medium">{detail.key}</span>
            <span className="rounded bg-surface-alt px-1.5 py-0.5 text-xs text-fg-muted">
              {keyType}
            </span>
            <Button size="sm" variant="ghost" onClick={() => setRenaming(true)}>
              {t('redis.rename')}
            </Button>
          </>
        )}
        <div className="ml-auto flex items-center gap-1">
          <Input
            value={ttlInput}
            onChange={(e) => setTtlInput(e.target.value)}
            placeholder="TTL s"
            className="h-7 w-20 text-xs"
          />
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void handleSetTtl()}>
            {t('redis.setTtl')}
          </Button>
        </div>
      </div>

      {keyType === 'string' && (
        <StringEditor
          dbSessionId={dbSessionId}
          dbIndex={dbIndex}
          detail={detail}
          onChanged={() => void onRefresh()}
        />
      )}
      {keyType === 'hash' && (
        <HashEditor
          dbSessionId={dbSessionId}
          dbIndex={dbIndex}
          detail={detail}
          onChanged={() => void onRefresh()}
        />
      )}
      {keyType === 'list' && (
        <ListEditor
          dbSessionId={dbSessionId}
          dbIndex={dbIndex}
          detail={detail}
          onChanged={() => void onRefresh()}
        />
      )}
      {keyType === 'set' && (
        <SetEditor
          dbSessionId={dbSessionId}
          dbIndex={dbIndex}
          detail={detail}
          onChanged={() => void onRefresh()}
        />
      )}
      {keyType === 'zset' && (
        <ZsetEditor
          dbSessionId={dbSessionId}
          dbIndex={dbIndex}
          detail={detail}
          onChanged={() => void onRefresh()}
        />
      )}
      {(keyType === 'ReJSON' || isJsonKeyType(keyType) || looksLikeJsonModuleDetail(detail)) &&
        hasRedisJson(modules) && (
          <JsonEditor
            dbSessionId={dbSessionId}
            dbIndex={dbIndex}
            detail={detail}
            onChanged={() => void onRefresh()}
          />
        )}
      {keyType === 'stream' && (
        <StreamEditor
          dbSessionId={dbSessionId}
          dbIndex={dbIndex}
          detail={detail}
          onChanged={() => void onRefresh()}
        />
      )}
    </div>
  );
}

function StringEditor({
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
  const [value, setValue] = useState(() => initialStringEditorValue(detail.value));
  const [keepTtl, setKeepTtl] = useState(false);
  const [expireAt, setExpireAt] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [decomp, setDecomp] = useState<DecompressResult | null>(null);
  const [decompError, setDecompError] = useState<string | null>(null);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      await invokeSetString(dbSessionId, dbIndex, detail.key, value, keepTtl);
      if (expireAt && !keepTtl) {
        const ts = Math.floor(new Date(expireAt).getTime() / 1000);
        if (!Number.isNaN(ts)) {
          await invokeSetExpireAt(dbSessionId, dbIndex, detail.key, ts);
        }
      }
      onChanged();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [dbSessionId, dbIndex, detail.key, value, keepTtl, expireAt, onChanged]);

  const handleDecompress = useCallback(() => {
    setDecompError(null);
    const result = tryDecompressString(value);
    if (result) {
      setDecomp(result);
    } else {
      setDecompError(t('redis.decompressFailed'));
      setDecomp(null);
    }
  }, [value, t]);

  const canDecompress = valueLooksCompressed(value);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={keepTtl}
            onChange={(e) => setKeepTtl(e.target.checked)}
          />
          {t('redis.keepTtl')}
        </label>
        <label className="flex items-center gap-1.5">
          {t('redis.expireAt')}
          <input
            type="datetime-local"
            value={expireAt}
            onChange={(e) => setExpireAt(e.target.value)}
            className="h-7 rounded border border-edge bg-surface px-2 text-xs"
            disabled={keepTtl}
          />
        </label>
        {canDecompress && (
          <Button variant="outline" className="h-7 px-2 text-xs" onClick={handleDecompress}>
            {t('redis.decompress')}
          </Button>
        )}
        {looksLikeJsonText(value) && (
          <Button
            variant="outline"
            className="h-7 px-2 text-xs"
            onClick={() => setValue(tryPrettyJson(value) ?? value)}
          >
            {t('redis.jsonPretty')}
          </Button>
        )}
      </div>
      <textarea
        className="min-h-[200px] w-full rounded border border-edge bg-surface p-2 font-mono text-sm"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        spellCheck={false}
      />
      {error && (
        <div className="rounded-md border border-danger/20 bg-danger/10 px-2 py-1.5 text-danger">
          {error}
        </div>
      )}
      <div className="flex gap-2">
        <Button disabled={saving} onClick={() => void handleSave()}>
          {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
          {t('common.save')}
        </Button>
      </div>
      {decompError && (
        <div className="rounded-md border border-danger/20 bg-danger/10 px-2 py-1.5 text-danger">
          {decompError}
        </div>
      )}
      {decomp && (
        <div className="space-y-1 rounded-md border border-edge bg-surface-alt p-2">
          <div className="text-fg-muted">
            {t('redis.decompressCodec').replace('{codec}', decomp.codec)} · {decomp.bytes} B
          </div>
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all font-mono text-fg-secondary">
            {decomp.text}
          </pre>
        </div>
      )}
    </div>
  );
}

function unwrapRaw(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && 'value' in value) {
    const inner = (value as { value: unknown }).value;
    if (typeof inner === 'string') return inner;
  }
  return '';
}
