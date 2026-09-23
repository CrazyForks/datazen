/**
 * E-1（裁定 8-1）：右列页签条必须是 5 枚（键详情 / 命令行 / 发布订阅 / 监控 / 慢日志）。
 *
 * 旅程而不是静态快照：默认落在键详情 ⇒ 点慢日志 ⇒ 点命令行 ⇒ 点回慢日志 ⇒ 点回
 * 键详情，逐步断言 `data-active` 跃迁与 keep-alive（访问过的面板不卸载）。
 *
 * 只断言 `data-*`（PRD §7-6：禁英文字面量）。四个重型面板被 stub 掉，页签条的
 * 路由行为与 IPC 无关。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('../key-browser/RedisWorkbench', async () => {
  const { forwardRef } = await import('react');
  // The real handle is a `forwardRef` component; keep the stub ref-compatible so
  // React does not warn about a function component receiving a ref.
  const Stub = forwardRef<unknown>(function WorkbenchStub(_props, _ref) {
    return <div data-testid="stub-workbench" />;
  });
  return { RedisWorkbench: Stub };
});
vi.mock('../console/RedisConsole', () => ({
  RedisConsole: () => <div data-testid="stub-console" />,
}));
vi.mock('../observe/MonitorPanel', () => ({
  MonitorPanel: () => <div data-testid="stub-monitor" />,
}));
vi.mock('../observe/PubSubPanel', () => ({
  PubSubPanel: () => <div data-testid="stub-pubsub" />,
}));
vi.mock('../observe/SlowlogPanel', () => ({
  SlowlogPanel: () => <div data-testid="stub-slowlog" />,
}));

import { RedisConnectionView, TABS, type ActiveTab } from '../connection/RedisConnectionView';

afterEach(() => cleanup());

function tabActive(tab: ActiveTab): string | null {
  return screen.getByTestId(`redis-tab-${tab}`).getAttribute('data-active');
}

function onlyActive(): ActiveTab[] {
  return TABS.filter((tab) => tabActive(tab) === 'true');
}

describe('Journey: 五枚一级页签（裁定 8-1）', () => {
  it('declares exactly the five PRD tabs in order', () => {
    expect(TABS).toEqual(['items', 'console', 'pubsub', 'monitor', 'slowlog']);
  });

  it('activates the clicked tab, keeps visited panels mounted and exits cleanly', async () => {
    // E-5: tab clicks pass the I-1 draft guard first (a microtask even when
    // clean), so every click must be flushed through `act` before asserting.
    render(
      <RedisConnectionView
        dbSessionId="sess-tabs"
        connectionId="cfg-tabs"
        connectionName="local"
        databaseType="redis"
        initialDatabase="db2"
        hideSidebar
        isActive
      />,
    );

    // 进入条件：默认落在键详情，页签条 5 枚，且只有一枚激活。
    expect(screen.getByTestId('redis-tab-bar').getAttribute('data-tab-count')).toBe('5');
    expect(onlyActive()).toEqual(['items']);
    expect(screen.getByTestId('stub-workbench')).toBeTruthy();

    // 慢日志现在是一级页签（此前只能进监控二极子页）。
    await act(async () => {
      fireEvent.click(screen.getByTestId('redis-tab-slowlog'));
    });
    expect(onlyActive()).toEqual(['slowlog']);
    expect(screen.getByTestId('stub-slowlog')).toBeTruthy();

    // keep-alive：切到命令行后，两个已访问面板仍挂在 DOM（只是 hidden）。
    await act(async () => {
      fireEvent.click(screen.getByTestId('redis-tab-console'));
    });
    expect(onlyActive()).toEqual(['console']);
    expect(screen.getByTestId('stub-workbench')).toBeTruthy();
    expect(screen.getByTestId('stub-slowlog')).toBeTruthy();

    // 未访问过的监控/发布订阅不得被提前挂载（懒挂载 + keep-alive 的组合契约）。
    expect(screen.queryByTestId('stub-monitor')).toBeNull();
    expect(screen.queryByTestId('stub-pubsub')).toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByTestId('redis-tab-monitor'));
    });
    expect(onlyActive()).toEqual(['monitor']);
    expect(screen.getByTestId('stub-monitor')).toBeTruthy();

    // 退出跃迁：点回键详情 ⇒ 键详情独占激活，没有任何页签残留高亮。
    await act(async () => {
      fireEvent.click(screen.getByTestId('redis-tab-items'));
    });
    expect(onlyActive()).toEqual(['items']);
  });
});
