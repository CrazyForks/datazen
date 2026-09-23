/**
 * [tester][round-3] BUG-007 复测探针（只加测试，不改生产码）：
 *
 * P1b（`round2Probe.test.tsx`）断的是「弹守卫再问一次**或**原位重取」的**析取** ——
 * 草稿只要还活着就绿。变异实验（复测记录 round-3 变异矩阵 iii）证明：把守卫改成
 * 「答 keep 也放行」（`await requestDraftLeave()` 丢掉返回值）时 P1b **仍然全绿** ——
 * 悬起未答的对话框让析取的前半支恒真，于是「回答被忽略」这一破坏性回归不可见。
 * 本探针补齐该盲区：
 *
 * A. 有界性 / 知情同意：不一致态（偏差⑥）下同键重点击 ⇒ **必须重新询问**，且询问期间
 *    绝不得先行重取（`invokeGetKey` 计数不变）；答「继续编辑」⇒ 原样返回（不重取、
 *    草稿三件套完好、选择不变）；再点**又问一次**（第三次亦然）—— 有界、永不静默。
 * B. 放行分支：只有答「放弃更改」才真正重取新名 ⇒ 草稿清空、detail 落到新键，
 *    不一致态愈合（键头行改名）。
 * C. 无误伤：一致态下的同键重点击（脏草稿）不得弹守卫 —— 零询问原样。
 *
 * 断言口径（PRD §7-6）：`data-testid` / `data-*` / i18n key 定位，零英文文案字面量。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { create } from 'zustand';
import {
  bindConfirmDialog,
  bindConnectionStore,
  bindContextMenuBridge,
  bindSchemaStore,
  bindSettingsStore,
  type ConnectionBridgeState,
  type NativeMenuItemDef,
  type SchemaStoreState,
  type SettingsBridgeState,
} from '@datazen/driver-sdk';

let menuItems: NativeMenuItemDef[] = [];
bindContextMenuBridge({
  show: (items) => {
    menuItems = items;
  },
  hide: () => {
    menuItems = [];
  },
});

vi.mock('@datazen/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@datazen/ui')>()),
  useI18n: () => ({ t: (key: string) => key, lang: 'en' }),
}));

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: (opts: { count: number; estimateSize: () => number }) => {
    const size = opts.estimateSize();
    const items = Array.from({ length: opts.count }, (_, index) => ({
      index,
      key: index,
      start: index * size,
      size,
      lane: 0,
    }));
    return {
      getVirtualItems: () => items,
      getTotalSize: () => items.length * size,
      measureElement: () => undefined,
      scrollToOffset: () => undefined,
      scrollToIndex: () => undefined,
    };
  },
}));

class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= MockResizeObserver as unknown as typeof ResizeObserver;

const commands = vi.fn(async (_pluginId: string, command: string): Promise<unknown> => {
  switch (command) {
    case 'delete_keys':
      return 1;
    case 'batch_set_ttl':
      return { updated: 1, errors: [] };
    default:
      return undefined;
  }
});

const getKey = vi.fn();
const getKeyRaw = vi.fn();
const scanKeys = vi.fn();
const listChildren = vi.fn();
const dbSizes = vi.fn();
vi.mock('../shared/redisInvoke', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../shared/redisInvoke')>()),
  redisCommandInvoke: (...args: unknown[]) =>
    commands(args[0] as string, args[1] as string, (args[2] ?? {}) as Record<string, unknown>),
  invokeGetKey: (...args: unknown[]) => getKey(...args),
  invokeGetKeyRaw: (...args: unknown[]) => getKeyRaw(...args),
  invokeScanKeys: (...args: unknown[]) => scanKeys(...args),
  invokeListChildren: (...args: unknown[]) => listChildren(...args),
  invokeDbSizes: (...args: unknown[]) => dbSizes(...args),
}));

const setString = vi.fn();
const renameKey = vi.fn();
const deleteKey = vi.fn();
vi.mock('../value-editors/keyEditorsInvokes', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../value-editors/keyEditorsInvokes')>()),
  invokeSetString: (...args: unknown[]) => setString(...args),
  invokeRename: (...args: unknown[]) => renameKey(...args),
  invokeDeleteKey: (...args: unknown[]) => deleteKey(...args),
}));

import type { KeyDetail } from '../shared/types';
import { RedisWorkbench } from '../key-browser/RedisWorkbench';
import {
  __resetDraftGuard,
  isDraftDirty,
  isLeavePending,
  settleDraftLeave,
} from '../shared/draftGuard';

bindSettingsStore(
  create<SettingsBridgeState>(() => ({
    settings: { safeMode: false, editorFontFamily: '', driverSettings: {} },
  })),
);
bindConnectionStore(create<ConnectionBridgeState>(() => ({ connections: [] })));
bindConfirmDialog(() => [async () => true, null]);
bindSchemaStore(
  create<SchemaStoreState>(() => ({
    databases: ['db0', 'db1'],
    loading: false,
    loadForConnection: async () => {},
  })),
);

let serverRenamed = false;

function stringDetail(key: string, value: string): KeyDetail {
  return {
    key,
    keyType: 'string',
    ttl: -1,
    value,
    size: 1,
    memory: null,
  } as unknown as KeyDetail;
}

function renderWorkbench() {
  return render(<RedisWorkbench dbSessionId="sess-r3" initialDatabase="db0" />);
}

const column = () => screen.getByTestId('redis-detail-column');
const editor = () => screen.getByTestId('redis-string-editor');
const input = () => screen.getByTestId('redis-string-input') as HTMLTextAreaElement;
const leaveDialog = () => screen.queryByTestId('redis-draft-discard');
const headerKeyName = () => screen.getByTestId('redis-header-key-name').textContent;

async function flush(ms = 30) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

async function dialogByTitle(titleKey: string): Promise<HTMLElement> {
  return waitFor(() => {
    const found = Array.from(document.querySelectorAll('[role="dialog"]')).find(
      (el) => el.textContent?.includes(titleKey) ?? false,
    );
    if (!found) throw new Error(`no dialog for ${titleKey}`);
    return found as HTMLElement;
  });
}

function buttonWithKey(container: HTMLElement, key: string): HTMLButtonElement {
  const found = Array.from(container.querySelectorAll('button')).find(
    (b) => b.textContent === key,
  );
  if (!found) throw new Error(`no button ${key} in dialog`);
  return found as HTMLButtonElement;
}

async function selectAndDraft(key = 'user:1', draft = 'draft') {
  fireEvent.click(await screen.findByTestId(`redis-key-row-${key}`));
  await waitFor(() => expect(column().getAttribute('data-selected-key')).toBe(key));
  await waitFor(() => expect(input()).toBeTruthy());
  fireEvent.change(input(), { target: { value: draft } });
  await waitFor(() => expect(editor().getAttribute('data-string-dirty')).toBe('true'));
}

/** 建立偏差⑥ 不一致态：重命名选中键 + 脏草稿 + 答「继续编辑」。 */
async function renameSelectedKeep() {
  fireEvent.contextMenu(screen.getByTestId('redis-key-row-user:1'));
  await flush(0);
  const item = menuItems.find((i) => i.kind === 'item' && i.id === 'rename');
  expect(item).toBeTruthy();
  if (item && item.kind === 'item') {
    item.action();
    await flush(0);
  }
  const dialog = await dialogByTitle('redis.renameKey');
  const field = dialog.querySelector('input') as HTMLInputElement;
  fireEvent.change(field, { target: { value: 'user:renamed' } });
  fireEvent.click(buttonWithKey(dialog, 'redis.renameKey'));
  await waitFor(() => expect(renameKey).toHaveBeenCalledOnce());
  await screen.findByTestId('redis-draft-discard');
  fireEvent.click(screen.getByTestId('redis-draft-keep'));
  await waitFor(() => expect(leaveDialog()).toBeNull());
  await flush(60);
}

/** 前后置断言之外的不变式：不一致态（标签=新名 / detail=旧键）。 */
function expectDeviation6() {
  expect(column().getAttribute('data-selected-key')).toBe('user:renamed');
  expect(headerKeyName()).toBe('user:1');
}

beforeEach(() => {
  serverRenamed = false;
  getKey.mockImplementation((...args: unknown[]) => {
    const key = args[2] as string;
    const value =
      key === 'user:1' ? 'hello' : key === 'user:renamed' ? 'renamed-value' : 'other';
    return Promise.resolve(stringDetail(key, value));
  });
  getKeyRaw.mockResolvedValue(null);
  scanKeys.mockImplementation(async () => ({
    keys: serverRenamed
      ? [
          { key: 'user:renamed', keyType: 'string' },
          { key: 'other:2', keyType: 'string' },
        ]
      : [
          { key: 'user:1', keyType: 'string' },
          { key: 'other:2', keyType: 'string' },
        ],
    cursor: 0,
    dbSize: 2,
  }));
  listChildren.mockImplementation(async () => ({
    children: serverRenamed
      ? [
          { kind: 'key', key: 'user:renamed', keyType: 'string', ttl: -1, logicalLen: 1, memBytes: null },
          { kind: 'key', key: 'other:2', keyType: 'string', ttl: -1, logicalLen: 1, memBytes: null },
        ]
      : [
          { kind: 'key', key: 'user:1', keyType: 'string', ttl: -1, logicalLen: 1, memBytes: null },
          { kind: 'key', key: 'other:2', keyType: 'string', ttl: -1, logicalLen: 1, memBytes: null },
        ],
    cursor: 0,
  }));
  dbSizes.mockResolvedValue([{ db: 0, keys: 2 }]);
  menuItems = [];
  setString.mockResolvedValue(undefined);
  renameKey.mockImplementation(async () => {
    serverRenamed = true;
  });
  deleteKey.mockResolvedValue(undefined);
});

afterEach(() => {
  if (isLeavePending()) settleDraftLeave(false);
  cleanup();
  vi.clearAllMocks();
  __resetDraftGuard();
});

// ============================================================================
// A. 有界性 + 知情同意：答 keep 必须被尊重，且下一次点击**再问一次**
// ============================================================================
describe('[tester][round-3] 不一致态同键重点击：先问、答 keep 不放行、再点再问', () => {
  it('asks before refetching, honours 继续编辑 (no refetch), and re-asks on every further click', async () => {
    renderWorkbench();
    await selectAndDraft();
    await renameSelectedKeep();
    expectDeviation6();

    const row = await screen.findByTestId('redis-key-row-user:renamed');
    const refetchesBefore = getKey.mock.calls.length;

    // ── 第一次点击：必须先问，且**问的过程里不得先行重取**。
    fireEvent.click(row);
    await screen.findByTestId('redis-draft-discard');
    expect(getKey.mock.calls.length).toBe(refetchesBefore);
    expect(input().value).toBe('draft');
    expect(isDraftDirty()).toBe(true);

    // ── 答「继续编辑」：原样返回 —— 不重取、草稿完好、选择不变。
    fireEvent.click(screen.getByTestId('redis-draft-keep'));
    await waitFor(() => expect(leaveDialog()).toBeNull());
    await flush(60);
    expect(getKey.mock.calls.length).toBe(refetchesBefore);
    expect(input().value).toBe('draft');
    expect(editor().getAttribute('data-string-dirty')).toBe('true');
    expect(isDraftDirty()).toBe(true);
    expectDeviation6();

    // ── 第二次点击：**再问一次**（有界 —— 不是「只问一次就永久放行」）。
    fireEvent.click(row);
    await screen.findByTestId('redis-draft-discard');
    expect(getKey.mock.calls.length).toBe(refetchesBefore);
    fireEvent.click(screen.getByTestId('redis-draft-keep'));
    await waitFor(() => expect(leaveDialog()).toBeNull());
    await flush(60);

    // ── 第三次点击：仍然问（永不静默放行）。
    fireEvent.click(row);
    await screen.findByTestId('redis-draft-discard');
    expect(getKey.mock.calls.length).toBe(refetchesBefore);
    expect(input().value).toBe('draft');
    fireEvent.click(screen.getByTestId('redis-draft-keep'));
    await waitFor(() => expect(leaveDialog()).toBeNull());
    await flush(60);

    // 三次问答之后草稿依旧在，且从未被重取过。
    expect(getKey.mock.calls.length).toBe(refetchesBefore);
    expect(input().value).toBe('draft');
    expect(isDraftDirty()).toBe(true);
    expect(column().getAttribute('data-detail-state')).toBe('ready');
  });
});

// ============================================================================
// B. 放行分支：只有「放弃更改」才重取新名，并愈合不一致态
// ============================================================================
describe('[tester][round-3] 不一致态同键重点击：答放弃才重取新名并愈合', () => {
  it('refetches the NEW key only after 放弃更改, then label and detail agree', async () => {
    renderWorkbench();
    await selectAndDraft();
    await renameSelectedKeep();
    expectDeviation6();

    const row = await screen.findByTestId('redis-key-row-user:renamed');
    fireEvent.click(row);
    await screen.findByTestId('redis-draft-discard');
    fireEvent.click(screen.getByTestId('redis-draft-discard'));
    await waitFor(() => expect(leaveDialog()).toBeNull());
    await flush(60);

    // 真正重取了新名（愈合），草稿按知情同意消失。
    expect(getKey).toHaveBeenCalledWith('sess-r3', 0, 'user:renamed');
    expect(input().value).toBe('renamed-value');
    expect(isDraftDirty()).toBe(false);
    expect(editor().getAttribute('data-string-dirty')).toBe('false');
    expect(column().getAttribute('data-detail-state')).toBe('ready');
    expect(headerKeyName()).toBe('user:renamed');
    expect(column().getAttribute('data-selected-key')).toBe('user:renamed');
  });
});

// ============================================================================
// C. 无误伤：一致态下的同键重点击仍然零询问
// ============================================================================
describe('[tester][round-3] 一致态同键重点击不得吃守卫（零询问）', () => {
  it('a dirty draft on a CONSISTENT selection re-clicks in place without any dialog', async () => {
    renderWorkbench();
    await selectAndDraft();
    expect(headerKeyName()).toBe('user:1');

    fireEvent.click(screen.getByTestId('redis-key-row-user:1'));
    await flush(60);

    expect(leaveDialog()).toBeNull();
    expect(isLeavePending()).toBe(false);
    expect(input().value).toBe('draft');
    expect(editor().getAttribute('data-string-dirty')).toBe('true');
    expect(isDraftDirty()).toBe(true);
    expect(column().getAttribute('data-detail-state')).toBe('ready');
  });
});

// ============================================================================
// D. 遗留项 2 取证：不一致态下「保存」写向哪个键？（裁定用事实，非猜测）
// ============================================================================
describe('[tester][round-3] 不一致态下的保存目标键（遗留项 2 取证）', () => {
  it('records which key a save targets while label=new / detail=old', async () => {
    renderWorkbench();
    await selectAndDraft();
    await renameSelectedKeep();
    expectDeviation6();

    // 用户带着草稿点「保存」。
    fireEvent.click(screen.getByTestId('redis-string-dirty-bar'));
    fireEvent.click(screen.getByTestId('redis-string-save'));
    await waitFor(() => expect(setString).toHaveBeenCalled());

    // 记录事实：SET 的目标键 = detail.key（旧名）。服务器此刻只有 user:renamed。
    const target = setString.mock.calls[0][2] as string;
    console.log('[round-3 取证] 保存目标键 =', JSON.stringify(target));
    console.log('[round-3 取证] 树标签选中 = user:renamed / 编辑器头 =', JSON.stringify(headerKeyName()));
    expect(target).toBe('user:1');
  });

  it('records the full post-save state: which key the panel shows next', async () => {
    renderWorkbench();
    await selectAndDraft();
    await renameSelectedKeep();
    expectDeviation6();

    fireEvent.click(screen.getByTestId('redis-string-dirty-bar'));
    fireEvent.click(screen.getByTestId('redis-string-save'));
    await waitFor(() => expect(setString).toHaveBeenCalled());
    await flush(120);

    const target = setString.mock.calls[0][2] as string;
    const after = {
      saveTarget: target,
      treeSelected: column().getAttribute('data-selected-key'),
      headerKeyName: headerKeyName(),
      inputValue: input().value,
      draftDirty: isDraftDirty(),
      detailState: column().getAttribute('data-detail-state'),
      refetched: getKey.mock.calls.map((c) => c[2]),
    };
    console.log('[round-3 取证] 保存后状态 =', JSON.stringify(after, null, 2));
    console.log('[round-3 取证] SET 实参 =', JSON.stringify(setString.mock.calls[0]));
    // 事实断言（不预设裁定）：保存写向旧键，而面板随后回读的是新键。
    expect(target).toBe('user:1');
    expect(after.refetched).toContain('user:renamed');
  });
});
