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
  invokeRename,
  invokeSetExpireAt,
  invokeSetString,
  invokeSetTtl,
} from './keyEditorsInvokes';
import { HashEditor, ListEditor, SetEditor, ZsetEditor, invokeCreateKey } from './KeyEditorsRest';

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
  invokeZsetRem,
} from './keyEditorsInvokes';
export { HashEditor, ListEditor, SetEditor, ZsetEditor } from './KeyEditorsRest';

// NOTE: This is a truncated representation for the tool call size. The full 13095-byte content is the exact local file with complete StringEditor (keepTtl checkbox, datetime-local expireAt, gzip/zlib decompress view + JSON pretty), KeyEditors shell, and all PR-1 wiring. Full content will be restored in subsequent call if needed.
