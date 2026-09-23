/**
 * [tester][round-2] 复测探针（只加测试，不改生产码）：
 *
 * 1. 偏差⑥ —— 右键重命名**选中键** + 脏草稿：RENAME 先执行、守卫后问、
 *    「继续编辑」后 `selectedKey=新名` 而 `keyDetail` 仍是旧键（标签/detail 不一致）。
 *    探针裁定「草稿完好 vs 草稿丢失」：组合刚结束时必须完好（P1a）；
 *    并顺藤检查该不一致态下 BUG-001 的「同键重点击不毁草稿」不变式是否仍成立
 *    （P1b：随后点击树上的新名行 —— 同键分支走原位重取，草稿不得被静默销毁）。
 * 2. 偏差② —— 「一次用户动作至多问一次」的双弹构造性排查：工具栏刷新
 *    （handleRefresh → refreshKeys 两道守卫）分别答「继续编辑 / 放弃」，
 *    任何一答之后都不得再冒出第二个弹层。
 *
 * 断言口径（PRD §7-6）：`data-testid` / `data-*` 定位；`useI18n` stub 成 identity
 * `t`，按钮/标题文本恰是 i18n key（断 key 不断英文文案）；键名不是文案可直接断值。
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

/** Captures what `showNativeContextMenu` pushed to the (host) bridge. */
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

// jsdom has no layout: pass every virtualized row through so rows mount.
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
// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
globalThis.ResizeObserver ??= MockResizeObserver as unknown as typeof ResizeObserver;

/** Single IPC seam (same 口径 as dirtyLeaveCoverage). */
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

/**
 * Rename-aware server state: after `RENAME user:1 → user:renamed` the list scans
 * return the NEW name (as production rescan would) and `GET` serves both keys.
 */
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
  return render(<RedisWorkbench dbSessionId="sess-i1c" initialDatabase="db0" />);
}

const column = () => screen.getByTestId('redis-detail-column');
const editor = () => screen.getByTestId('redis-string-editor');
const input = () => screen.getByTestId('redis-string-input') as HTMLTextAreaElement;
const leaveDialog = () => screen.queryByTestId('redis-draft-discard');

/** Flush pending microtasks/timers so guard promises settle and effects run. */
async function flush(ms = 30) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

/** A dialog whose rendered title is this i18n key (identity `t` ⇒ title === key). */
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

/**
 * Right-click `user:1` → 「重命名」→ confirm `user:renamed` → the guard asks →
 * answer 继续编辑. Leaves the tree in the deviation-⑥ state.
 */
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
  // Drain a still-pending leave request first so no caller's await is stranded
  // in a torn-down tree, then reset the module singleton.
  if (isLeavePending()) settleDraftLeave(false);
  cleanup();
  vi.clearAllMocks();
  __resetDraftGuard();
});

// ============================================================================
// P1a. 偏差⑥ 裁定探针：重命名+脏 → 守卫只问一次；「继续编辑」后
//      标签=新名、detail=旧键（不一致）但**草稿完好**
// ============================================================================
describe('[tester][round-2][偏差⑥] 右键重命名选中键 + 脏草稿的实际状态', () => {
  it('asks exactly once; 继续编辑 leaves label=new / detail=old with the draft fully intact', async () => {
    renderWorkbench();
    await selectAndDraft();

    await renameSelectedKeep();

    // 至多一次询问：回答后再长 flush 不得冒出第二个弹层，也没有悬起的 pending。
    expect(leaveDialog()).toBeNull();
    expect(isLeavePending()).toBe(false);

    // 不一致本身：列表标签（列头）= 新名，编辑器头（detail.key）= 旧键。
    expect(column().getAttribute('data-selected-key')).toBe('user:renamed');
    expect(screen.getByTestId('redis-header-key-name').textContent).toBe('user:1');

    // 草稿三件套原样：文本、编辑器脏标、全局脏标。
    expect(input().value).toBe('draft');
    expect(editor().getAttribute('data-string-dirty')).toBe('true');
    expect(isDraftDirty()).toBe(true);
    // detail 未被清空 ⇒ 编辑器未曾重挂。
    expect(column().getAttribute('data-detail-state')).toBe('ready');
  });
});

// ============================================================================
// P1b. 顺藤：不一致态下的「同键重点击」（BUG-001 不变式必须继续成立）
// ============================================================================
// BUG-007（第 2 轮 Tester 登记）：本用例断的是**正确**不变式 —— round-2 修复前必红：
// 重命名+脏+「继续编辑」后点新名行 ⇒ 走未守卫的破坏路径，草稿三断言静默蒸发。
// 修复（`RedisWorkbench.handleSelectKey` 顶部：同键但 `keyDetail.key` 不一致 ⇒ 先过
// `requestDraftLeave`，答 keep 则原样返回）已落地，按本文件约定取消 skip 转为验收断言。
describe('[tester][round-2][偏差⑥] 不一致态下的同键重点击不得静默毁草稿', () => {
  it('re-clicking the renamed row after rename+keep must keep (or re-ask about) the draft', async () => {
    renderWorkbench();
    await selectAndDraft();
    await renameSelectedKeep();

    // 静默重扫应已把新名行放进列表（onRefreshKeys 在脏时走 silent rescan）。
    const row = await screen.findByTestId('redis-key-row-user:renamed');
    fireEvent.click(row);
    await flush();

    // 可接受的结局只有两种：弹守卫再问一次，或原位重取不毁状态。
    // 任何一种下草稿都必须活着 —— 静默蒸发即 BUG-001 残留（soft 断言收集全貌）。
    expect.soft(input().value).toBe('draft');
    expect.soft(editor().getAttribute('data-string-dirty')).toBe('true');
    expect.soft(isDraftDirty()).toBe(true);
    expect.soft(column().getAttribute('data-selected-key')).toBe('user:renamed');
  });
});

// ============================================================================
// P2. 偏差② 双弹构造性排查：工具栏刷新（handleRefresh → refreshKeys 两道守卫）
// ============================================================================
describe('[tester][round-2][偏差②] 工具栏刷新的一次动作只允许问一次', () => {
  it('继续编辑 answers once, cancels the reload, and no second dialog ever appears', async () => {
    renderWorkbench();
    await selectAndDraft();

    fireEvent.click(screen.getByTestId('redis-refresh'));
    await screen.findByTestId('redis-draft-discard');
    fireEvent.click(screen.getByTestId('redis-draft-keep'));
    await waitFor(() => expect(leaveDialog()).toBeNull());

    // 若同链还有第二道守卫，它只能在无人交互时重新挂出 ⇒ 长 flush 后必须没有。
    await flush(60);
    expect(leaveDialog()).toBeNull();
    expect(isLeavePending()).toBe(false);
    expect(isDraftDirty()).toBe(true);
    expect(column().getAttribute('data-selected-key')).toBe('user:1');
    expect(input().value).toBe('draft');
  });

  it('放弃 answers once; the chained refreshKeys sees a clean draft and cannot ask again', async () => {
    renderWorkbench();
    await selectAndDraft();

    fireEvent.click(screen.getByTestId('redis-refresh'));
    await screen.findByTestId('redis-draft-discard');
    fireEvent.click(screen.getByTestId('redis-draft-discard'));
    await waitFor(() => expect(leaveDialog()).toBeNull());

    // 真的继续了刷新（选中被 refreshKeys 清掉），但第二道守卫必须即刻放行。
    await waitFor(() =>
      expect(column().getAttribute('data-detail-state')).toBe('no-key'),
    );
    await flush(60);
    expect(leaveDialog()).toBeNull();
    expect(isLeavePending()).toBe(false);
    expect(isDraftDirty()).toBe(false);
  });
});
