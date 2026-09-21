/**
 * Zero-connection workspace → connection → first query user journey.
 *
 * Covers the currently available first-run path after the onboarding wizard:
 * create a PostgreSQL connection from the workspace empty state, test/save
 * it, connect, and execute the first query.
 */
import { expect, browser, $ } from '@wdio/globals';
import { t } from '../../i18n.js';
import {
  captureJourneyStep,
  clickCardConnectButton,
  closeNewConnectionDialogFromUi,
  closeExtraWindows,
  executeSQL,
  openConnectionsWorkspace,
  openQueryTab,
  waitForConnectionToolbar,
  waitForNewConnectionDialog,
} from '../../helpers.js';
import {
  deleteAllJourneyConnections,
  deleteJourneyConnectionsByName,
  fillPostgresConnectionForm,
  restoreDefaultJourneyConnection,
  testAndSavePostgresConnection,
} from './connectionJourneyHelpers.js';

const JOURNEY_NAME = `E2E Zero State Query ${Date.now().toString(36)}`;

describe('零连接工作区→连接→首条查询完整用户旅程 (ZERO-STATE-QUERY-JOURNEY)', () => {
  let mainWindow: string;

  before(async () => {
    mainWindow = await browser.getWindowHandle();
    await deleteAllJourneyConnections();
    await browser.execute(() => location.reload());
    await $('[data-testid="connection-workspace-home"]').waitForDisplayed({ timeout: 15000 });
  });

  after(async () => {
    try {
      await closeExtraWindows(mainWindow);
      await deleteJourneyConnectionsByName(JOURNEY_NAME);
      await restoreDefaultJourneyConnection();
      await browser.execute(() => location.reload());
    } catch {
      /* best effort; global E2E lifecycle restores the default connection */
    }
  });

  it('完整旅程：零连接空状态 → 取消建连 → 创建首个连接 → 查看连接 → 执行首条查询', async () => {
    await expect(await $('[data-testid="connection-workspace-home"]')).toBeDisplayed();
    const homeText = await $('[data-testid="connection-workspace-home"]').getText();
    expect(homeText).toContain(t('main.noConnections'));
    await expect(await $('[data-testid="new-connection-button"]')).toBeDisplayed();
    await expect(await $('[data-testid="workspace-nav-databases"]')).toBeDisplayed();
    await captureJourneyStep('zero-state-query-empty-visible');

    await $('[data-testid="new-connection-button"]').click();
    await waitForNewConnectionDialog();
    await closeNewConnectionDialogFromUi();
    await expect(await $('[data-testid="connection-workspace-home"]')).toBeDisplayed();
    await captureJourneyStep('zero-state-query-create-cancelled');

    await $('[data-testid="new-connection-button"]').click();
    await waitForNewConnectionDialog();
    await fillPostgresConnectionForm(JOURNEY_NAME);
    await testAndSavePostgresConnection(JOURNEY_NAME);
    await captureJourneyStep('zero-state-query-connection-tested');

    await openConnectionsWorkspace(mainWindow);
    const workspaceHome = await $('[data-testid="connection-workspace-home"]');
    await workspaceHome.waitForDisplayed({ timeout: 10000 });
    expect(await workspaceHome.getText()).toContain(JOURNEY_NAME);
    await captureJourneyStep('zero-state-query-connection-saved');

    expect(await clickCardConnectButton(JOURNEY_NAME)).toBe(true);
    await waitForConnectionToolbar();
    expect(await $('[data-testid="connection-workspace-home"]').getText()).toContain(JOURNEY_NAME);
    await expect(await $('[data-testid="home-quick-new-query"]')).toBeDisplayed();
    await captureJourneyStep('zero-state-query-connection-viewed');

    await openQueryTab();
    await executeSQL('SELECT 1 AS first_activation_value');

    const result = await $('[data-testid="result-workspace-table"]');
    await result.waitForDisplayed({ timeout: 15000 });
    const resultText = await result.getText();
    expect(resultText).toContain('first_activation_value');
    expect(resultText).toContain('1');
    await captureJourneyStep('zero-state-query-first-query-success');
  });
});
