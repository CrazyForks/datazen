import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@datazen/ui';
import { Input } from '@datazen/ui';
import { useI18n } from '../../../../src/hooks/useI18n';
import type { KeyDetail } from '../../../../src/types';
import {
  invokeHashDel,
  invokeHashSet,
  invokeListPop,
  invokeListPush,
  invokeListSet,
  invokeSetAdd,
  invokeSetRemove,
  invokeZsetAdd,
  invokeZsetRemove,
  type PluginInvokeFn,
} from './keyEditorsInvokes';
import { redisCommandInvoke } from './redisInvoke';

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
          <tr className="text-left text-fg-muted text-xs">
            <th className="p-1">{t('redis.field', 'Field')}</th>
            <th className="p-1">{t('redis.value', 'Value')}</th>
            <th className="p-1 w-20" />
          </tr>
        </thead>
        <tbody>
          {fields.map(([field, val]) => (
            <tr key={field} className="border-t border-edge">
              <td className="p-1 font-mono text-sm">{field}</td>
              <td className="p-1">
                <Input
                  className="font-mono text-sm"
                  value={getValue(field, val)}
                  onChange={(e) =>
                    setEditValues((m) => ({ ...m, [field]: e.target.value }))
                  }
                />
              </td>
              <td className="p-1 flex gap-1">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    await invokeHashSet(dbSessionId, dbIndex, detail.name, field, getValue(field, val));
                    onChanged();
                  }}
                >
                  {t('common.save', 'Save')}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    await invokeHashDel(dbSessionId, dbIndex, detail.name, field);
                    onChanged();
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex gap-2 items-center">
        <Input
          placeholder={t('redis.field', 'Field')}
          value={newField}
          onChange={(e) => setNewField(e.target.value)}
          className="font-mono text-sm"
        />
        <Input
          placeholder={t('redis.value', 'Value')}
          value={newValue}
          onChange={(e) => setNewValue(e.target.value)}
          className="font-mono text-sm"
        />
        <Button
          size="sm"
          onClick={async () => {
            if (!newField) return;
            await invokeHashSet(dbSessionId, dbIndex, detail.name, newField, newValue);
            setNewField('');
            setNewValue('');
            onChanged();
          }}
        >
          <Plus className="h-3.5 w-3.5 mr-1" />
          {t('common.add', 'Add')}
        </Button>
      </div>
    </div>
  );
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
  const items = Array.isArray(detail.value) ? (detail.value as string[]) : [];
  const [newItem, setNewItem] = useState('');

  return (
    <div className="space-y-2">
      <ul className="space-y-1">
        {items.map((item, i) => (
          <li key={i} className="flex items-center gap-2 font-mono text-sm border-b border-edge py-1">
            <span className="text-fg-muted w-8">{i}</span>
            <span className="flex-1 break-all">{item}</span>
            <Button
              size="sm"
              variant="ghost"
              onClick={async () => {
                await invokeListSet(dbSessionId, dbIndex, detail.name, i, item);
                onChanged();
              }}
            >
              {t('common.save', 'Save')}
            </Button>
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <Input
          value={newItem}
          onChange={(e) => setNewItem(e.target.value)}
          placeholder={t('redis.value', 'Value')}
          className="font-mono text-sm"
        />
        <Button
          size="sm"
          onClick={async () => {
            if (!newItem) return;
            await invokeListPush(dbSessionId, dbIndex, detail.name, newItem);
            setNewItem('');
            onChanged();
          }}
        >
          <Plus className="h-3.5 w-3.5 mr-1" />
          {t('common.add', 'Add')}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={async () => {
            await invokeListPop(dbSessionId, dbIndex, detail.name);
            onChanged();
          }}
        >
          Pop
        </Button>
      </div>
    </div>
  );
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
  const members = Array.isArray(detail.value) ? (detail.value as string[]) : [];
  const [newMember, setNewMember] = useState('');

  return (
    <div className="space-y-2">
      <ul className="space-y-1">
        {members.map((m) => (
          <li key={m} className="flex items-center gap-2 font-mono text-sm border-b border-edge py-1">
            <span className="flex-1 break-all">{m}</span>
            <Button
              size="sm"
              variant="ghost"
              onClick={async () => {
                await invokeSetRemove(dbSessionId, dbIndex, detail.name, m);
                onChanged();
              }}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <Input
          value={newMember}
          onChange={(e) => setNewMember(e.target.value)}
          placeholder={t('redis.member', 'Member')}
          className="font-mono text-sm"
        />
        <Button
          size="sm"
          onClick={async () => {
            if (!newMember) return;
            await invokeSetAdd(dbSessionId, dbIndex, detail.name, newMember);
            setNewMember('');
            onChanged();
          }}
        >
          <Plus className="h-3.5 w-3.5 mr-1" />
          {t('common.add', 'Add')}
        </Button>
      </div>
    </div>
  );
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
  const entries = Array.isArray(detail.value)
    ? (detail.value as { member: string; score: number }[])
    : [];
  const [newMember, setNewMember] = useState('');
  const [newScore, setNewScore] = useState('0');

  return (
    <div className="space-y-2">
      <ul className="space-y-1">
        {entries.map((e) => (
          <li key={e.member} className="flex items-center gap-2 font-mono text-sm border-b border-edge py-1">
            <span className="w-16 text-fg-muted">{e.score}</span>
            <span className="flex-1 break-all">{e.member}</span>
            <Button
              size="sm"
              variant="ghost"
              onClick={async () => {
                await invokeZsetRemove(dbSessionId, dbIndex, detail.name, e.member);
                onChanged();
              }}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <Input
          value={newScore}
          onChange={(e) => setNewScore(e.target.value)}
          placeholder="score"
          className="w-20 font-mono text-sm"
        />
        <Input
          value={newMember}
          onChange={(e) => setNewMember(e.target.value)}
          placeholder={t('redis.member', 'Member')}
          className="font-mono text-sm"
        />
        <Button
          size="sm"
          onClick={async () => {
            if (!newMember) return;
            await invokeZsetAdd(dbSessionId, dbIndex, detail.name, newMember, Number(newScore) || 0);
            setNewMember('');
            setNewScore('0');
            onChanged();
          }}
        >
          <Plus className="h-3.5 w-3.5 mr-1" />
          {t('common.add', 'Add')}
        </Button>
      </div>
    </div>
  );
}

export async function invokeCreateKey(
  invoke: PluginInvokeFn,
  dbSessionId: string,
  dbIndex: number,
  key: string,
  keyType: string,
  value?: string,
) {
  switch (keyType) {
    case 'string':
      await invoke('redis', 'set_string', {
        dbSessionId,
        dbIndex,
        key,
        value: value ?? '',
      });
      break;
    case 'hash':
      await invoke('redis', 'hash_set', {
        dbSessionId,
        dbIndex,
        key,
        field: 'field1',
        value: value ?? '',
      });
      break;
    case 'list':
      await invoke('redis', 'list_push', {
        dbSessionId,
        dbIndex,
        key,
        value: value ?? '',
      });
      break;
    case 'set':
      await invoke('redis', 'set_add', {
        dbSessionId,
        dbIndex,
        key,
        member: value ?? '',
      });
      break;
    case 'zset':
      await invoke('redis', 'zset_add', {
        dbSessionId,
        dbIndex,
        key,
        member: value ?? '',
        score: 0,
      });
      break;
    case 'json': {
      let jsonValue = value ?? '{}';
      const trimmed = jsonValue.trim();
      if (trimmed) {
        try {
          JSON.parse(trimmed);
          jsonValue = trimmed;
        } catch {
          jsonValue = JSON.stringify(trimmed);
        }
      }
      await invoke('redis', 'json_set', {
        dbSessionId,
        dbIndex,
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

export function KeyEditorsRest(props: {
  connectionId: string;
  keyName: string;
  keyType: string;
  detail: any;
  onSaved?: () => void;
}) {
  const { keyType, detail, onSaved } = props;
  const dbSessionId = props.connectionId;
  const dbIndex = 0;
  const onChanged = () => onSaved?.();

  if (keyType === 'hash') {
    return <HashEditor dbSessionId={dbSessionId} dbIndex={dbIndex} detail={detail} onChanged={onChanged} />;
  }
  if (keyType === 'list') {
    return <ListEditor dbSessionId={dbSessionId} dbIndex={dbIndex} detail={detail} onChanged={onChanged} />;
  }
  if (keyType === 'set') {
    return <SetEditor dbSessionId={dbSessionId} dbIndex={dbIndex} detail={detail} onChanged={onChanged} />;
  }
  if (keyType === 'zset') {
    return <ZsetEditor dbSessionId={dbSessionId} dbIndex={dbIndex} detail={detail} onChanged={onChanged} />;
  }
  return <div>Unsupported key type: {keyType}</div>;
}
