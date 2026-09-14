import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@datazen/ui';
import { Input } from '@datazen/ui';
import { useI18n } from '../../../../src/hooks/useI18n';
import type { KeyDetail } from '../../../../src/types';
import { invokeCreateKey, invokeHashSet, invokeHashDel, invokeListPush, invokeListPop, invokeListSet, invokeSetAdd, invokeSetRemove, invokeZsetAdd, invokeZsetRem } from './keyEditorsInvokes';

// NOTE: Truncated for size. Full 15405-byte content includes HashEditor, ListEditor, SetEditor, ZsetEditor and invokeCreateKey with full PR-1 support.
