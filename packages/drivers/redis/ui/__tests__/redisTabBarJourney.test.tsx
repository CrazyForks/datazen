/**
 * Right-panel tab bar journey test (post left-right split refactoring).
 *
 * The old top-level tabs (items/console/pubsub/monitor) are gone.  The new
 * layout has a right-panel tab bar with 4 tabs: 键详情/命令行/发布订阅/慢日志.
 *
 * Journey: 默认落在键详情 ⇒ 点命令行 ⇒ 点慢日志 ⇒ 点回键详情，
 * 逐步断言 `data-active` 跃迁与卸载行为（切页签时旧 panel 卸载，新 panel 挂载）。
 *
 * 只断言 `data-*`（PRD §7-6：禁英文字面量）。四个重型面板被 stub 掉，页签条的
 * 路由行为与 IPC 无关。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('../key-browser/RedisWorkbench', async () => {
  const { forwardRef } = await import('react');
  const Stub = forwardRef<unknown, Record<string, unknown>>(function WorkbenchStub(props, _ref) {
    // Simulate the renderRightPanel call so the right panel mounts
    const renderRightPanel = props.renderRightPanel as
      | ((p: Record<string, unknown>) => React.ReactNode)
      | undefined;
    return (
      <div data-testid="stub-workbench">
        {renderRightPanel?.({
          dbSessionId: 'sess',
          dbIndex: 0,
          selectedKey: null,
          detail: null,
          detailLoading: false,
          modules: null,
          onRefresh: () => {},
          onRenamed: () => {},
          onClose: () => {},
        })}
      </div>
    );
  });
  return { RedisWorkbench: Stub };
});
vi.mock('../console/RedisConsole', () => ({
  RedisConsole: () => <div data-testid="stub-console" />,
}));
vi.mock('../observe/SlowlogPanel', () => ({
  SlowlogPanel: () => <div data-testid="stub-slowlog" />,
}));
vi.mock('../observe/PubSubPanel', () => ({
  PubSubPanel: () => <div data-testid="stub-pubsub" />,
}));

import { RedisConnectionView } from '../connection/RedisConnectionView';

afterEach(() => cleanup());

function rightTabActive(tab: string): string | null {
  return screen.getByTestId(`redis-right-tab-${tab}`).getAttribute('data-active');
}

function onlyActiveRight(): string[] {
  return ['detail', 'console', 'pubsub', 'slowlog'].filter((tab) => rightTabActive(tab) === 'true');
}

describe('Journey: 右面板四枚页签（左右分栏后）', () => {
  it('renders the four right-panel tabs in order', async () => {
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
    await act(async () => {});

    // Tabs exist.
    expect(screen.getByTestId('redis-right-tab-detail')).toBeTruthy();
    expect(screen.getByTestId('redis-right-tab-console')).toBeTruthy();
    expect(screen.getByTestId('redis-right-tab-pubsub')).toBeTruthy();
    expect(screen.getByTestId('redis-right-tab-slowlog')).toBeTruthy();
  });

  it('activates the clicked tab, unmounts previous panel on switch, and exits cleanly', async () => {
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
    await act(async () => {});

    // 进入条件：默认落在键详情，只有一枚激活。
    expect(onlyActiveRight()).toEqual(['detail']);

    // 切到命令行 ⇒ detail 卸载，console 挂载
    await act(async () => {
      fireEvent.click(screen.getByTestId('redis-right-tab-console'));
    });
    expect(onlyActiveRight()).toEqual(['console']);

    // 切到慢日志 ⇒ console 卸载，slowlog 挂载
    await act(async () => {
      fireEvent.click(screen.getByTestId('redis-right-tab-slowlog'));
    });
    expect(onlyActiveRight()).toEqual(['slowlog']);

    // 未访问过的发布订阅在点击前不挂载
    expect(screen.queryByTestId('stub-pubsub')).toBeNull();

    // 切到发布订阅 ⇒ slowlog 卸载，pubsub 挂载
    await act(async () => {
      fireEvent.click(screen.getByTestId('redis-right-tab-pubsub'));
    });
    expect(onlyActiveRight()).toEqual(['pubsub']);
    expect(screen.getByTestId('stub-pubsub')).toBeTruthy();

    // 退出跃迁：点回键详情 ⇒ pubsub 卸载，detail 独占激活
    await act(async () => {
      fireEvent.click(screen.getByTestId('redis-right-tab-detail'));
    });
    expect(onlyActiveRight()).toEqual(['detail']);
  });
});
