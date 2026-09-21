import { expect, browser, $, $$ } from '@wdio/globals';
import { closeExtraWindows } from '../helpers.js';
import {
  E2E_DASHBOARD_PREFIX,
  cleanupDashboard,
  createEmptyDashboard,
  getSeededConnectionId,
  invokeBackend,
  openDashboardFromMain,
  seedSqlWidget,
  setDashboardPaused,
} from '../helpers/data-dashboard.js';

const BOARD_A = `${E2E_DASHBOARD_PREFIX}-boards-a`;
const BOARD_B = `${E2E_DASHBOARD_PREFIX}-boards-b`;

describe('数据看板面板 (UJ-02, UJ-08)', () => {
  let mainWindow: string;

  before(async () => {
    mainWindow = await browser.getWindowHandle();
    await browser.pause(1000);
    await cleanupDashboard(BOARD_A);
    await cleanupDashboard(BOARD_B);
    await createEmptyDashboard(BOARD_A, 'E2E Board A');
    await setDashboardPaused(BOARD_A, true);
  });

  after(async () => {
    try {
      await browser.switchToWindow(mainWindow);
      await cleanupDashboard(BOARD_A);
      await cleanupDashboard(BOARD_B);
    } catch {
      /* ok */
    }
    await closeExtraWindows(mainWindow);
  });

  it('UJ-02: 应显示 Tab、新建面板并在添加 Widget 后自动执行', async () => {
    await openDashboardFromMain(mainWindow);

    const tabA = await $(`[data-testid="dashboard-tab"][data-dashboard-id="${BOARD_A}"]`);
    await tabA.waitForDisplayed({ timeout: 10000 });

    const addTab = await $('[data-testid="dashboard-tab-add"]');
    await addTab.click();
    await browser.pause(800);

    const tabs = await $$('[data-testid="dashboard-tab"]');
    expect(tabs.length).toBeGreaterThanOrEqual(2);

    const list = await invokeBackend<{ id: string; name: string }[]>('list_dashboards');
    expect(list.length).toBeGreaterThanOrEqual(2);

    // Seed a real widget into the newly-created dashboard. The dashboard UI
    // receives the creation result through the same command path used by
    // "Add to Dashboard", which triggers the one-shot widget execution.
    const connectionId = await getSeededConnectionId();
    await seedSqlWidget(BOARD_A, connectionId, {
      title: 'E2E 自动执行',
      sql: 'SELECT 1 AS value',
      yAxes: ['value'],
    });

    await browser.waitUntil(
      async () => {
        const dashboard = await invokeBackend<{
          widgets: Array<{ id: string; enabled?: boolean }>;
        }>('get_dashboard', { id: BOARD_A });
        return dashboard.widgets.length === 1;
      },
      {
        timeout: 10000,
        interval: 200,
        timeoutMsg: 'dashboard widget was not created',
      },
    );

    const widget = await $('[data-testid="dashboard-tile"]');
    await widget.waitForDisplayed({ timeout: 10000 });

    // Do not click the widget refresh button here. This journey verifies the
    // creation-time one-shot execution itself.
    await browser.waitUntil(
      async () => {
        const tile = await $('[data-testid="dashboard-tile"]');
        const text = await tile.getText().catch(() => '');
        const chart = await tile.$('[data-testid="dashboard-tile-chart"]').catch(() => null);
        return Boolean((await chart?.isDisplayed().catch(() => false)) || /1/.test(text));
      },
      {
        timeout: 30000,
        interval: 300,
        timeoutMsg: 'dashboard widget did not display automatically executed data',
      },
    );

    const deletePanel = await $('[data-testid="dashboard-delete-panel"]');
    await deletePanel.waitForDisplayed({ timeout: 5000 });
    await deletePanel.click();

    // The confirmation is rendered in a portal. Use its E2E locator instead
    // of searching all buttons by translated text; the latter can hit a
    // hidden/stale button and leave the dashboard untouched.
    const confirmDelete = await $('[data-testid="dashboard-delete-confirm"]');
    await confirmDelete.waitForDisplayed({ timeout: 5000 });
    await confirmDelete.waitForClickable({ timeout: 5000 });
    await confirmDelete.click();

    await browser.waitUntil(
      async () => {
        const current = await invokeBackend<{ id: string }[]>('list_dashboards');
        return current.length === list.length - 1;
      },
      {
        timeout: 10000,
        interval: 200,
        timeoutMsg: 'dashboard deletion did not complete in the backend',
      },
    );
    const listAfter = await invokeBackend<{ id: string }[]>('list_dashboards');
    expect(listAfter.length).toBe(list.length - 1);
  });

  it('UJ-08: 应能切换面板级暂停状态', async () => {
    await browser.switchToWindow(mainWindow);
    await openDashboardFromMain(mainWindow);

    const pauseBtn = await $('[data-testid="dashboard-pause-toggle"]');
    await pauseBtn.waitForDisplayed({ timeout: 5000 });

    await browser.waitUntil(
      async () => {
        const dash = await invokeBackend<{ refreshPaused?: boolean }>('get_dashboard', {
          id: BOARD_A,
        });
        return (
          dash.refreshPaused === true && (await pauseBtn.getAttribute('title')) === '恢复本看板定时'
        );
      },
      {
        timeout: 10000,
        interval: 200,
        timeoutMsg: 'dashboard pause state did not load into the UI',
      },
    );

    await pauseBtn.click();
    await browser.waitUntil(
      async () => {
        const dash = await invokeBackend<{ refreshPaused?: boolean }>('get_dashboard', {
          id: BOARD_A,
        });
        return (
          dash.refreshPaused === false &&
          (await pauseBtn.getAttribute('title')) === '暂停本看板定时'
        );
      },
      {
        timeout: 10000,
        interval: 200,
        timeoutMsg: 'dashboard resume state did not propagate to the UI',
      },
    );
    const dash = await invokeBackend<{ refreshPaused?: boolean }>('get_dashboard', { id: BOARD_A });
    expect(dash.refreshPaused).toBe(false);

    await pauseBtn.click();
    await browser.waitUntil(
      async () => {
        const dashAgain = await invokeBackend<{ refreshPaused?: boolean }>('get_dashboard', {
          id: BOARD_A,
        });
        return (
          dashAgain.refreshPaused === true &&
          (await pauseBtn.getAttribute('title')) === '恢复本看板定时'
        );
      },
      {
        timeout: 10000,
        interval: 200,
        timeoutMsg: 'dashboard pause state did not propagate to the UI',
      },
    );
    const dashAgain = await invokeBackend<{ refreshPaused?: boolean }>('get_dashboard', {
      id: BOARD_A,
    });
    expect(dashAgain.refreshPaused).toBe(true);
  });
});
