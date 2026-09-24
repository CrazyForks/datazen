/**
 * E-1（裁定 8-1）：右列页签条必须是 4 枚（键详情 / 命令行 / 发布订阅 / 监控）。
 *
 * 慢日志已降级为 Monitor 子页签，不再独立为一级 Tab。
 *
 * 旅程而不是静态快照：默认落在键详情 ⇒ 点命令行 ⇒ 点监控 ⇒ 点回键详情，
 * 逐步断言 `data-active` 跃迁与 keep-alive（访问过的面板不卸载）。
 *
 * 只断言 `data-*`（PRD §7-6：禁英文字面量）。四个重型面板被 stub 掉，页签条的
 * 路由行为与 IPC 无关。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('../key-browser/RedisWorkbench', async () => {
  const { forwardRef } = await import('react');
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

import { RedisConnectionView, TABS, type ActiveTab } from '../connection/RedisConnectionView';

afterEach(() => cleanup());

function tabActive(tab: ActiveTab): string | null {
  return screen.getByTestId(`redis-tab-${tab}`).getAttribute('data-active');
}

function onlyActive(): ActiveTab[] {
  return TABS.filter((tab) => tabActive(tab) === 'true');
}

describe('Journey: 四枚一级页签（慢日志降为 Monitor 子页签）', () => {
  it('declares exactly the four PRD tabs in order', () => {
    expect(TABS).toEqual(['items', 'console', 'pubsub', 'monitor']);
  });

  it('activates the clicked tab, keeps visited panels mounted and exits cleanly', async () => {
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

    // 进入条件：默认落在键详情，页签条 4 枚，且只有一枚激活。
    expect(screen.getByTestId('redis-tab-bar').getAttribute('data-tab-count')).toBe('4');
    expect(onlyActive()).toEqual(['items']);
    expect(screen.getByTestId('stub-workbench')).toBeTruthy();

    // 切到命令行
    await act(async () => {
      fireEvent.click(screen.getByTestId('redis-tab-console'));
    });
    expect(onlyActive()).toEqual(['console']);
    expect(screen.getByTestId('stub-workbench')).toBeTruthy();

    // keep-alive：切到监控后，已访问面板仍挂在 DOM（只是 hidden）。
    await act(async () => {
      fireEvent.click(screen.getByTestId('redis-tab-monitor'));
    });
    expect(onlyActive()).toEqual(['monitor']);
    expect(screen.getByTestId('stub-monitor')).toBeTruthy();

    // 未访问过的发布订阅不得被提前挂载（懒挂载 + keep-alive 的组合契约）。
    expect(screen.queryByTestId('stub-pubsub')).toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByTestId('redis-tab-pubsub'));
    });
    expect(onlyActive()).toEqual(['pubsub']);
    expect(screen.getByTestId('stub-pubsub')).toBeTruthy();

    // 退出跃迁：点回键详情 ⇒ 键详情独占激活，没有任何页签残留高亮。
    await act(async () => {
      fireEvent.click(screen.getByTestId('redis-tab-items'));
    });
    expect(onlyActive()).toEqual(['items']);
  });
});
