import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@datazen/ui';
import { Input } from '@datazen/ui';
import { useI18n } from '../../../../src/hooks/useI18n';
import type { KeyDetail } from '../../../../src/types';
import { redisCommandInvoke } from './redisInvoke';
import {
  invokeHashDel,
  invokeHashSet,
  invokeListPop,
  invokeListPush,
  invokeListSet,
  invokeSetAdd,
  invokeSetRemove,
  invokeSetString,
  invokeZsetAdd,
  invokeZsetRemove,
  type PluginInvokeFn,
} from './keyEditorsInvokes';

export function HashEditor({
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
  const raw =
    typeof detail.value === 'object' && detail.value !== null
      ? ((detail.value as Record<string, Record<string, string>>).fields ??
        (detail.value as Record<string, string>))
      : {};
  const fields = Object.entries(raw);
  const [newField, setNewField] = useState('');
  const [newValue, setNewValue] = useState('');
  const [editValues, setEditValues] = useState<Record<string, string>>({});

  const getValue = (field: string, original: string) => editValues[field] ?? original;

  return (
    <div className="space-y-2">
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-edge bg-surface-alt text-left">
            <th className="px-2 py-1.5 font-medium text-fg-muted">{t('redis.field')}</th>
            <th className="px-2 py-1.5 font-medium text-fg-muted">{t('redis.value')}</th>
            <th className="w-20 px-2 py-1.5" />
          </tr>
        </thead>
        <tbody>
          {fields.map(([field, val]) => (
            <tr key={field} className="border-b border-edge">
              <td className="px-2 py-1.5 font-mono text-fg-secondary">{field}</td>
              <td className="px-2 py-1.5">
                <Input
                  value={getValue(field, String(val))}
                  onChange={(e) => setEditValues((prev) => ({ ...prev, [field]: e.target.value }))}
                  className="h-7 font-mono text-xs"
                />
              </td>
              <td className="px-2 py-1.5">
                <div className="flex gap-1">
                  <Button
                    variant="secondary"
                    className="h-6 px-1.5 text-[10px]"
                    onClick={() =>
                      void invokeHashSet(
                        dbSessionId,
                        dbIndex,
                        detail.key,
                        field,
                        getValue(field, String(val)),
                      ).then(onChanged)
                    }
                  >
                    {t('common.save')}
                  </Button>
                  <button
                    type="button"
                    className="rounded p-1 text-danger hover:bg-danger/10"
                    onClick={() =>
                      void invokeHashDel(dbSessionId, dbIndex, detail.key, [field]).then(onChanged)
                    }
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex flex-wrap items-end gap-2">
        <Input
          value={newField}
          onChange={(e) => setNewField(e.target.value)}
          placeholder={t('redis.field')}
          className="h-7 flex-1 font-mono text-xs"
        />
        <Input
          value={newValue}
          onChange={(e) => setNewValue(e.target.value)}
          placeholder={t('redis.value')}
          className="h-7 flex-1 font-mono text-xs"
        />
        <Button
          variant="secondary"
          className="h-7 gap-1 px-2 text-xs"
          disabled={!newField.trim()}
          onClick={() =>
            void invokeHashSet(dbSessionId, dbIndex, detail.key, newField.trim(), newValue).then(
              () => {
                setNewField('');
                setNewValue('');
                onChanged();
              },
            )
          }
        >
          <Plus className="h-3 w-3" />
          {t('redis.add')}
        </Button>
      </div>
    </div>
  );
}

function listItems(detail: KeyDetail): string[] {
  const v = detail.value as Record<string, unknown>;
  const items = v?.items ?? v?.members;
  return Array.isArray(items) ? (items as string[]) : [];
}

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
  const items = listItems(detail);
  const [pushValue, setPushValue] = useState('');
  const [editIndex, setEditIndex] = useState<number | null>(null);
  const [editValue, setEditValue] = useState('');

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1">
        <Button
          variant="secondary"
          className="h-7 px-2 text-xs"
          onClick={() =>
            void invokeListPop(dbSessionId, dbIndex, detail.key, 'left').then(onChanged)
          }
        >
          {t('redis.popLeft')}
        </Button>
        <Button
          variant="secondary"
          className="h-7 px-2 text-xs"
          onClick={() =>
            void invokeListPop(dbSessionId, dbIndex, detail.key, 'right').then(onChanged)
          }
        >
          {t('redis.popRight')}
        </Button>
      </div>
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-edge bg-surface-alt text-left">
            <th className="w-16 px-2 py-1.5 font-medium text-fg-muted">#</th>
            <th className="px-2 py-1.5 font-medium text-fg-muted">{t('redis.value')}</th>
            <th className="w-16 px-2 py-1.5" />
          </tr>
        </thead>
        <tbody>
          {items.map((item, i) => (
            <tr key={i} className="border-b border-edge">
              <td className="px-2 py-1.5 text-fg-muted">{i}</td>
              <td className="px-2 py-1.5">
                {editIndex === i ? (
                  <Input
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    className="h-7 font-mono text-xs"
                  />
                ) : (
                  <span className="font-mono text-fg-secondary">{String(item)}</span>
                )}
              </td>
              <td className="px-2 py-1.5">
                {editIndex === i ? (
                  <Button
                    variant="secondary"
                    className="h-6 px-1.5 text-[10px]"
                    onClick={() =>
                      void invokeListSet(dbSessionId, dbIndex, detail.key, i, editValue).then(
                        () => {
                          setEditIndex(null);
                          onChanged();
                        },
                      )
                    }
                  >
                    {t('common.save')}
                  </Button>
                ) : (
                  <button
                    type="button"
                    className="text-xs text-accent hover:underline"
                    onClick={() => {
                      setEditIndex(i);
                      setEditValue(String(item));
                    }}
                  >
                    {t('common.edit')}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex flex-wrap items-end gap-2">
        <Input
          value={pushValue}
          onChange={(e) => setPushValue(e.target.value)}
          placeholder={t('redis.value')}
          className="h-7 flex-1 font-mono text-xs"
        />
        <Button
          variant="secondary"
          className="h-7 px-2 text-xs"
          disabled={!pushValue.trim()}
          onClick={() =>
            void invokeListPush(dbSessionId, dbIndex, detail.key, 'left', [pushValue.trim()]).then(
              () => {
                setPushValue('');
                onChanged();
              },
            )
          }
        >
          {t('redis.pushLeft')}
        </Button>
        <Button
          variant="secondary"
          className="h-7 px-2 text-xs"
          disabled={!pushValue.trim()}
          onClick={() =>
            void invokeListPush(dbSessionId, dbIndex, detail.key, 'right', [pushValue.trim()]).then(
              () => {
                setPushValue('');
                onChanged();
              },
            )
          }
        >
          {t('redis.pushRight')}
        </Button>
      </div>
    </div>
  );
}

function setMembers(detail: KeyDetail): string[] {
  const v = detail.value as Record<string, unknown>;
  const members = v?.members ?? v?.items;
  return Array.isArray(members) ? (members as string[]) : [];
}

export function SetEditor({
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
  const members = setMembers(detail);
  const [newMember, setNewMember] = useState('');

  return (
    <div className="space-y-2">
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-edge bg-surface-alt text-left">
            <th className="px-2 py-1.5 font-medium text-fg-muted">{t('redis.member')}</th>
            <th className="w-12 px-2 py-1.5" />
          </tr>
        </thead>
        <tbody>
          {members.map((member) => (
            <tr key={member} className="border-b border-edge">
              <td className="px-2 py-1.5 font-mono text-fg-secondary">{member}</td>
              <td className="px-2 py-1.5">
                <button
                  type="button"
                  className="rounded p-1 text-danger hover:bg-danger/10"
                  onClick={() =>
                    void invokeSetRemove(dbSessionId, dbIndex, detail.key, [member]).then(onChanged)
                  }
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex flex-wrap items-end gap-2">
        <Input
          value={newMember}
          onChange={(e) => setNewMember(e.target.value)}
          placeholder={t('redis.member')}
          className="h-7 flex-1 font-mono text-xs"
        />
        <Button
          variant="secondary"
          className="h-7 gap-1 px-2 text-xs"
          disabled={!newMember.trim()}
          onClick={() =>
            void invokeSetAdd(dbSessionId, dbIndex, detail.key, [newMember.trim()]).then(() => {
              setNewMember('');
              onChanged();
            })
          }
        >
          <Plus className="h-3 w-3" />
          {t('redis.add')}
        </Button>
      </div>
    </div>
  );
}

function zsetMembers(detail: KeyDetail): { member: string; score: number }[] {
  const v = detail.value as Record<string, { member: string; score: number }[]>;
  return Array.isArray(v?.members) ? v.members : [];
}

export function ZsetEditor({
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
  const members = zsetMembers(detail);
  const [newMember, setNewMember] = useState('');
  const [newScore, setNewScore] = useState('0');

  return (
    <div className="space-y-2">
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-edge bg-surface-alt text-left">
            <th className="px-2 py-1.5 font-medium text-fg-muted">{t('redis.score')}</th>
            <th className="px-2 py-1.5 font-medium text-fg-muted">{t('redis.member')}</th>
            <th className="w-12 px-2 py-1.5" />
          </tr>
        </thead>
        <tbody>
          {members.map((item) => (
            <tr key={item.member} className="border-b border-edge">
              <td className="px-2 py-1.5 text-fg-secondary">{item.score}</td>
              <td className="px-2 py-1.5 font-mono text-fg-secondary">{item.member}</td>
              <td className="px-2 py-1.5">
                <button
                  type="button"
                  className="rounded p-1 text-danger hover:bg-danger/10"
                  onClick={() =>
                    void invokeZsetRemove(dbSessionId, dbIndex, detail.key, [item.member]).then(
                      onChanged,
                    )
                  }
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex flex-wrap items-end gap-2">
        <Input
          value={newScore}
          onChange={(e) => setNewScore(e.target.value)}
          placeholder={t('redis.score')}
          className="h-7 w-20 text-xs"
        />
        <Input
          value={newMember}
          onChange={(e) => setNewMember(e.target.value)}
          placeholder={t('redis.member')}
          className="h-7 flex-1 font-mono text-xs"
        />
        <Button
          variant="secondary"
          className="h-7 gap-1 px-2 text-xs"
          disabled={!newMember.trim()}
          onClick={() =>
            void invokeZsetAdd(dbSessionId, dbIndex, detail.key, [
              { member: newMember.trim(), score: parseFloat(newScore) || 0 },
            ]).then(() => {
              setNewMember('');
              onChanged();
            })
          }
        >
          <Plus className="h-3 w-3" />
          {t('redis.add')}
        </Button>
      </div>
    </div>
  );
}

export async function invokeCreateKey(
  dbSessionId: string,
  dbIndex: number,
  key: string,
  keyType: string,
  initialValue: string,
  invoke: PluginInvokeFn = redisCommandInvoke,
) {
  switch (keyType) {
    case 'string':
      await invokeSetString(dbSessionId, dbIndex, key, initialValue, false, invoke);
      break;
    case 'hash':
      await invokeHashSet(dbSessionId, dbIndex, key, 'field', initialValue || '', invoke);
      break;
    case 'list':
      await invokeListPush(dbSessionId, dbIndex, key, 'right', [initialValue || ''], invoke);
      break;
    case 'set':
      await invokeSetAdd(dbSessionId, dbIndex, key, [initialValue || 'member'], invoke);
      break;
    case 'zset':
      await invokeZsetAdd(
        dbSessionId,
        dbIndex,
        key,
        [{ member: initialValue || 'member', score: 0 }],
        invoke,
      );
      break;
    case 'ReJSON': {
      const trimmed = initialValue.trim();
      let jsonValue = '{}';
      if (trimmed) {
        try {
          JSON.parse(trimmed);
          jsonValue = trimmed;
        } catch {
          jsonValue = JSON.stringify(trimmed);
        }
      }
      await invoke('redis', 'json_set', {
        dbSessionId: dbSessionId,
        dbIndex: dbIndex,
        key,
        path: '$',
        value: jsonValue,
      });
      break;
    }
    default:
      throw new Error(`Unsupported key type: ${keyType}`);
  }
}
