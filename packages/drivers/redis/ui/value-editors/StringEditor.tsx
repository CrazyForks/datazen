//! String 键的**常驻可编辑**编辑面（PRD §3.3 屏 B 右列 / §4 I-5，本轨 E-2 + E-3）。
//!
//! 形状：Codec / View 两行「渲染预检」（`ValueViewer` 的 `showOutput={false}` 档）
//! → 编辑区 → 动作行。没有「查看 / 编辑」两态开关：编辑区一直在，值就显示在编辑区里。
//! 只保留 I-5 穷举出的两种真只读态（字节视图 / 大 value），二者都必须带原因文案。

import { useEffect, useState } from 'react';
import { Button, useI18n } from '@datazen/ui';
import type { KeyDetail, ValueFrame } from '../shared/types';
import { formatSize } from '../shared/formatSize';
import type { GateWriteFn } from '../shared/useRedisGate';
import {
  initialStringEditorValue,
  looksLikeJsonText,
  tryDecompressString,
  unwrapStringKeyValue,
  valueLooksCompressed,
  type DecompressResult,
} from './stringKeyValue';
import { JsonModeBar } from './JsonModeBar';
import {
  formatJson,
  JSON_TEXT_MODES,
  type JsonDisplayMode,
  type JsonTextMode,
} from './jsonModes';
import { invokeSetString } from './keyEditorsInvokes';
import { ValueViewer } from './ValueViewer';
import { resolveReadOnlyPolicy } from './keyReadOnlyPolicy';
import type { Codec } from './valueView/codecs';
import type { ViewMode } from './valueView/views';

export interface StringEditorProps {
  dbSessionId: string;
  dbIndex: number;
  detail: KeyDetail;
  frame: ValueFrame | null;
  gateWrite?: GateWriteFn;
  onSaved: () => void;
  /**
   * 未保存草稿信号（PRD §4 I-1）。E-5 的底栏与拦截都读这一个信号源，
   * 它由 `jsonDirty` 直接驱动——进入编辑面不等于 dirty，敲第一个字符才等于。
   */
  onDirtyChange?: (dirty: boolean) => void;
}

function unwrapRaw(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && 'value' in value) {
    const inner = (value as { value: unknown }).value;
    if (typeof inner === 'string') return inner;
  }
  return '';
}

export function StringEditor({
  dbSessionId,
  dbIndex,
  detail,
  frame,
  gateWrite,
  onSaved,
  onDirtyChange,
}: StringEditorProps) {
  const { t } = useI18n();
  const [value, setValue] = useState(() => initialStringEditorValue(detail.value));
  const [saving, setSaving] = useState(false);
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [jsonDisplay, setJsonDisplay] = useState<JsonTextMode>('pretty');
  const [jsonDirty, setJsonDirty] = useState(false);
  const [keepTtl, setKeepTtl] = useState(detail.ttl >= 0);
  const [decomp, setDecomp] = useState<DecompressResult | null>(null);
  const [decompBusy, setDecompBusy] = useState(false);
  const [decompError, setDecompError] = useState<string | null>(null);
  // 视图 / 解码选择提升到编辑面：I-5 只读态由「当前 view」决定，
  // 所以判定方必须持有它，而不是藏在预览组件里。
  const [view, setView] = useState<ViewMode>('utf8');
  const [codec, setCodec] = useState<Codec>('none');
  const jsonMode = looksLikeJsonText(value);
  const rawOriginal = unwrapStringKeyValue(detail.value);
  const maybeCompressed = valueLooksCompressed(unwrapRaw(detail.value));

  const policy = resolveReadOnlyPolicy({ frame, view });
  const readOnly = policy.readOnly;

  // `jsonDirty` is exactly the unsaved-draft signal: rendering the resident
  // editor is not dirty, and reformatting JSON (which does not touch
  // `jsonDirty`) is not a data-loss risk either.
  useEffect(() => {
    onDirtyChange?.(jsonDirty);
    return () => {
      // An unmounted editor cannot have a draft — never publish a stale flag.
      onDirtyChange?.(false);
    };
  }, [jsonDirty, onDirtyChange]);

  const selectJsonMode = (next: JsonDisplayMode) => {
    if (next === 'tree') return;
    setJsonDisplay(next);
    setJsonError(null);
    setValue((prev) => (next === 'raw' && !jsonDirty ? rawOriginal : formatJson(prev, next)));
  };

  const save = () => {
    if (readOnly) return;
    if (jsonMode) {
      try {
        JSON.parse(value);
      } catch {
        setJsonError(t('redis.invalidJson'));
        return;
      }
      setJsonError(null);
    }
    setSaving(true);
    void (async () => {
      if (gateWrite && !(await gateWrite('write-op'))) {
        setSaving(false);
        return;
      }
      await invokeSetString(dbSessionId, dbIndex, detail.key, value, keepTtl)
        .then(() => {
          // Saved: the draft no longer exists, so the dirty relay must drop.
          setJsonDirty(false);
          onSaved();
        })
        .finally(() => setSaving(false));
    })();
  };

  const runDecompress = () => {
    setDecompBusy(true);
    setDecompError(null);
    void tryDecompressString(unwrapRaw(detail.value))
      .then((r) => {
        if (!r) {
          setDecompError(t('redis.decompressFailed'));
          setDecomp(null);
        } else {
          setDecomp(r);
        }
      })
      .catch((e) => {
        setDecompError(e instanceof Error ? e.message : String(e));
        setDecomp(null);
      })
      .finally(() => setDecompBusy(false));
  };

  const onEdit = (next: string) => {
    // 只读档连逻辑层也要挡：DOM 的 readOnly 拦不住 jsdom 直接派发的 change，
    // 而「只读」的语义就是这份载荷不允许被改写回服务器。
    if (readOnly) return;
    setValue(next);
    setJsonDirty(true);
    setJsonError(null);
  };

  return (
    <div
      className="space-y-2"
      data-testid="redis-string-editor"
      data-string-dirty={jsonDirty ? 'true' : 'false'}
      data-string-readonly={readOnly ? 'true' : 'false'}
      data-readonly-reason={policy.reason?.id ?? 'none'}
    >
      <ValueViewer
        dbSessionId={dbSessionId}
        frame={frame}
        view={view}
        codec={codec}
        onViewChange={setView}
        onCodecChange={setCodec}
        showOutput={readOnly}
      />

      {policy.reason && (
        <div
          className="flex flex-wrap items-center gap-2 rounded-md border border-warning/25 bg-warning/10 px-2 py-1.5 text-fg-secondary"
          data-testid="redis-string-readonly-reason"
          data-readonly-reason={policy.reason.id}
        >
          <span data-i18n-key={policy.reason.i18nKey}>{t(policy.reason.i18nKey)}</span>
          {policy.bigValue.bytes != null && (
            <span className="font-mono text-fg-muted" data-big-value-bytes={policy.bigValue.bytes}>
              {formatSize(policy.bigValue.bytes)}
            </span>
          )}
        </div>
      )}

      <textarea
        value={value}
        onChange={(e) => onEdit(e.target.value)}
        readOnly={readOnly}
        aria-readonly={readOnly}
        className="min-h-[160px] w-full rounded-md border border-edge bg-surface-alt p-3 font-mono text-xs text-fg-secondary read-only:cursor-not-allowed read-only:opacity-70"
        spellCheck={false}
        data-testid="redis-string-input"
        data-string-readonly={readOnly ? 'true' : 'false'}
      />
      {jsonError && (
        <div className="rounded-md border border-danger/20 bg-danger/10 px-2 py-1.5 text-danger">
          {jsonError}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-1.5 text-fg-secondary">
          <input
            type="checkbox"
            checked={keepTtl}
            onChange={(e) => setKeepTtl(e.target.checked)}
            className="rounded border-edge"
          />
          {t('redis.keepTtl')}
        </label>
        <span className="text-fg-muted">{t('redis.keepTtlHint')}</span>
        {jsonMode && (
          <JsonModeBar modes={JSON_TEXT_MODES} active={jsonDisplay} onSelect={selectJsonMode} />
        )}
        {(maybeCompressed || decomp) && (
          <Button
            variant="secondary"
            className="h-7 px-2 text-xs"
            disabled={decompBusy}
            onClick={runDecompress}
          >
            {t('redis.decompressView')}
          </Button>
        )}
        <Button
          variant="primary"
          className="h-7 px-2 text-xs"
          disabled={saving || readOnly}
          onClick={save}
          data-testid="redis-string-save"
          data-save-blocked-by={readOnly ? 'readonly' : 'none'}
        >
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
