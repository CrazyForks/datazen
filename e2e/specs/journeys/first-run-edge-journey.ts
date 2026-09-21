/** Zero-connection workspace: validation, failure recovery, and last-delete journey. */
import { expect, browser, $ } from '@wdio/globals';
import { t } from '../../i18n.js';
import {
  captureJourneyStep,
  clickNewConnectionSave,
  clickNewConnectionTest,
  closeExtraWindows,
  confirmWebDialog,
  waitForNewConnectionDialog,
} from '../../helpers.js';
import {
  deleteAllJourneyConnections,
  fillPostgresConnectionForm,
  openConnectionContextMenu,
  PG_FORM_DEFAULTS,
  restoreDefaultJourneyConnection,
  setPostgresPort,
  waitForConnectionListed,
  waitForConnectionTestResult,
} from './connectionJourneyHelpers.js';

const CONNECTION_NAME = `E2E Zero State Edge ${Date.now().toString(36)}`;

describe('零连接工作区连接异常恢复旅程 (ZERO-STATE-EDGE-JOURNEY)', () => {
  let mainWindow: string;

  before(async () => {
    mainWindow = await browser.getWindowHandle();
    await deleteAllJourneyConnections();
    await browser.refresh();
    await $('[data-testid="connection-workspace-home"]').waitForDisplayed({ timeout: 15000 });
  });

  after(async () => {
    await closeExtraWindows(mainWindow);
    await deleteAllJourneyConnections();
    await restoreDefaultJourneyConnection();
    await browser.refresh();
  });

  it('完整 edge：必填校验 → 连接失败 → 修正并保存 → 删除最后连接 → 返回空状态', async () => {
    await $('[data-testid="new-connection-button"]').click();
    await waitForNewConnectionDialog();
    await fillPostgresConnectionForm(CONNECTION_NAME, { host: '', port: 'not-a-port' });

    await clickNewConnectionSave();
    await expect(await $('[data-testid="new-connection-dialog"]')).toBeDisplayed();
    const validationText = await $('[data-testid="new-connection-dialog"]').getText();
    expect(validationText).toContain(t('newConn.required'));
    await captureJourneyStep('zero-state-edge-validation');

    const hostInput = await $('input[placeholder="prod-db.example.com"]');
    await hostInput.setValue(PG_FORM_DEFAULTS.host);
    await setPostgresPort('1');
    await clickNewConnectionTest();
    await waitForConnectionTestResult('failure');
    await expect(await $('[data-testid="new-conn-test-connection"]')).toBeClickable();
    await captureJourneyStep('zero-state-edge-test-failed');

    await setPostgresPort(PG_FORM_DEFAULTS.port);
    await clickNewConnectionTest();
    await waitForConnectionTestResult('success');
    await captureJourneyStep('zero-state-edge-test-recovered');

    await clickNewConnectionSave();
    await browser.waitUntil(
      async () => !(await $('[data-testid="new-connection-dialog"]').isExisting()),
      { timeout: 10000, timeoutMsg: '修正连接后保存弹窗未关闭' },
    );
    await waitForConnectionListed(CONNECTION_NAME);

    await openConnectionContextMenu(CONNECTION_NAME);
    const deleteButton = await $('[data-testid="web-context-item-delete-connection"]');
    await deleteButton.waitForClickable({ timeout: 5000 });
    await deleteButton.click();
    await confirmWebDialog();
    await browser.waitUntil(
      async () =>
        await $('[data-testid="connection-workspace-home"]')
          .isDisplayed()
          .catch(() => false),
      { timeout: 10000, timeoutMsg: '删除最后一个连接后未返回空状态' },
    );
    await expect(await $('[data-testid="workspace-nav-databases"]')).toBeDisplayed();
    await captureJourneyStep('zero-state-edge-last-connection-deleted');
  });
});
