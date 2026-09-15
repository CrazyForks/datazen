/**
 * Visual Query Builder complete user journey.
 *
 * Covers the full lifecycle:
 *   Toggle open → select tables → select columns → add WHERE condition
 *   → add ORDER BY → toggle DISTINCT → preview SQL → apply SQL → execute → verify results
 *   → reset → close panel.
 *
 * Test data is created in the worker database via connectBackend IPC;
 * the journey assumes nothing about pre-existing tables.
 */
import { expect, browser, $ } from '@wdio/globals';
import {
  captureJourneyStep,
  closeDataExportDialogIfOpen,
  closeExtraWindows,
  connectBackend,
  disconnectBackend,
  invokeBackend,
  openConnectionWindow,
  openQueryTab,
  withSafeModeOff,
} from '../../helpers.js';

const TABLE_NAME = `e2e_qb_journey_${Date.now().toString(36)}`;

describe('Visual Query Builder 完整用户旅程 (QB-JOURNEY)', () => {
  let mainWindow: string;

  before(async () => {
    // Create test table and seed data via backend IPC (no UI dependency).
    // Safe Mode blocks DROP, so wrap DDL in withSafeModeOff.
    const dbSessionId = await connectBackend('conn_e2e_pg');
    try {
      await withSafeModeOff(async () => {
        await invokeBackend('execute_query', {
          dbSessionId,
          sql: `DROP TABLE IF EXISTS ${TABLE_NAME}`,
        });
        await invokeBackend('execute_query', {
          dbSessionId,
          sql: `CREATE TABLE ${TABLE_NAME} (id INTEGER, name TEXT, category TEXT, score INTEGER)`,
        });
        await invokeBackend('execute_query', {
          dbSessionId,
          sql: `INSERT INTO ${TABLE_NAME} (id, name, category, score) VALUES (1, 'Alice', 'A', 90), (2, 'Bob', 'B', 80), (3, 'Charlie', 'A', 70), (4, 'Diana', 'B', 95)`,
        });
      });
    } finally {
      await disconnectBackend(dbSessionId);
    }

    // Open the connection in the UI and open a query tab
    const opened = await openConnectionWindow();
    mainWindow = opened.mainWindow;
    await openQueryTab();
  });

  after(async () => {
    try {
      await closeDataExportDialogIfOpen();
      const dbSessionId = await connectBackend('conn_e2e_pg');
      try {
        await withSafeModeOff(async () => {
          await invokeBackend('execute_query', {
            dbSessionId,
            sql: `DROP TABLE IF EXISTS ${TABLE_NAME}`,
          });
        });
      } finally {
        await disconnectBackend(dbSessionId);
      }
    } catch {
      /* best effort; the shared E2E teardown also removes journey tables */
    }
    await closeExtraWindows(mainWindow);
  });

  it('完整旅程：打开面板 → 选表 → 选列 → WHERE → ORDER BY → DISTINCT → 预览 SQL → 应用并执行 → 重置 → 关闭', async () => {
    // ── Step 1: Toggle the Visual Builder panel open ──
    const qbToggle = await $('[data-testid="qb-toggle-button"]');
    await qbToggle.waitForClickable({ timeout: 5000 });
    await qbToggle.click();

    const qbPanel = await $('[data-testid="qb-panel"]');
    await qbPanel.waitForDisplayed({ timeout: 5000 });
    await captureJourneyStep('qb-panel-open');

    // ── Step 2: Select a table ──
    const tableList = await $('[data-testid="qb-table-list"]');
    await tableList.waitForDisplayed({ timeout: 5000 });

    // The worker DB has a seeded `product` table and our journey table.
    // Click the journey table checkbox.
    const tableClicked = await browser.execute((name: string) => {
      const items = Array.from(document.querySelectorAll('[data-testid^="qb-table-item-"]'));
      for (const item of items) {
        const checkbox = item.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
        if (checkbox && item.textContent?.includes(name)) {
          checkbox.click();
          return true;
        }
      }
      return false;
    }, TABLE_NAME);
    expect(tableClicked).toBe(true);
    await browser.pause(500);
    await captureJourneyStep('qb-table-selected');

    // ── Step 3: Expand column group and select columns ──
    const columnSelector = await $('[data-testid="qb-column-selector"]');
    await columnSelector.waitForDisplayed({ timeout: 5000 });

    // Column groups are collapsed by default — expand the table group first
    const groupExpanded = await browser.execute((tbl: string) => {
      // Find the expand/collapse button that contains the table name
      const buttons = Array.from(
        document.querySelector('[data-testid="qb-column-selector"]')?.querySelectorAll('button') ??
          [],
      );
      const btn = buttons.find((b) => b.textContent?.trim().includes(tbl));
      if (btn) {
        btn.click();
        return true;
      }
      return false;
    }, TABLE_NAME);
    expect(groupExpanded).toBe(true);
    await browser.pause(300);

    // Select 'name' column
    const nameChecked = await browser.execute((tbl: string) => {
      const check = document.querySelector(
        `[data-testid="qb-column-check-${tbl}.name"]`,
      ) as HTMLInputElement | null;
      if (check) {
        check.click();
        return true;
      }
      return false;
    }, TABLE_NAME);
    expect(nameChecked).toBe(true);
    await browser.pause(200);

    // Select 'score' column
    const scoreChecked = await browser.execute((tbl: string) => {
      const check = document.querySelector(
        `[data-testid="qb-column-check-${tbl}.score"]`,
      ) as HTMLInputElement | null;
      if (check) {
        check.click();
        return true;
      }
      return false;
    }, TABLE_NAME);
    expect(scoreChecked).toBe(true);
    await browser.pause(300);
    await captureJourneyStep('qb-columns-selected');

    // ── Step 4: Verify SQL preview shows SELECT ──
    const preview = await $('[data-testid="qb-sql-preview"]');
    await preview.waitForDisplayed({ timeout: 5000 });
    let previewText = await preview.getText();
    expect(previewText).toContain('SELECT');
    expect(previewText).toContain('name');
    expect(previewText).toContain('score');
    expect(previewText).toContain(TABLE_NAME);
    await captureJourneyStep('qb-sql-preview-basic');

    // ── Step 5: Add a WHERE condition ──
    const addCondBtn = await $('[data-testid="qb-add-condition"]');
    await addCondBtn.waitForClickable({ timeout: 5000 });
    await addCondBtn.click();
    await browser.pause(300);

    // Type a value into the condition value input
    const condValueInput = await $('[data-testid="qb-condition-value"]');
    await condValueInput.waitForDisplayed({ timeout: 3000 });
    await condValueInput.click();
    await condValueInput.setValue('Alice');
    await browser.pause(300);

    // Verify SQL preview now includes WHERE
    previewText = await preview.getText();
    expect(previewText).toContain('WHERE');
    await captureJourneyStep('qb-where-added');

    // ── Step 6: Add ORDER BY ──
    const addSortBtn = await $('[data-testid="qb-add-sort"]');
    await addSortBtn.waitForClickable({ timeout: 5000 });
    await addSortBtn.click();
    await browser.pause(300);

    previewText = await preview.getText();
    expect(previewText).toContain('ORDER BY');
    await captureJourneyStep('qb-sort-added');

    // ── Step 7: Toggle DISTINCT ──
    const distinctCheckbox = await $('[data-testid="qb-distinct-checkbox"]');
    await distinctCheckbox.waitForClickable({ timeout: 5000 });
    await distinctCheckbox.click();
    await browser.pause(300);

    previewText = await preview.getText();
    expect(previewText).toContain('DISTINCT');
    await captureJourneyStep('qb-distinct-toggled');

    // ── Step 8: Apply SQL ──
    const applyBtn = await $('[data-testid="qb-apply-sql"]');
    await applyBtn.waitForClickable({ timeout: 5000 });
    await applyBtn.click();

    // Panel should close after applying
    await browser.waitUntil(
      async () =>
        !(await $('[data-testid="qb-panel"]')
          .isDisplayed()
          .catch(() => false)),
      { timeout: 5000, timeoutMsg: 'Apply SQL 后面板未关闭' },
    );
    await captureJourneyStep('qb-applied-sql');

    // ── Step 9: Execute the applied SQL and verify results ──
    await browser.pause(500);
    const execBtn = await $('[data-testid="editor-execute-button"]');
    await execBtn.waitForClickable({ timeout: 5000 });
    await execBtn.click();

    // Wait for the result table to appear
    const resultTable = await $('[data-testid="result-workspace-table"]');
    await resultTable.waitForDisplayed({ timeout: 15000 });
    const resultText = await resultTable.getText();
    // The WHERE clause filters for Alice, so only her row should appear
    expect(resultText).toContain('Alice');
    // DISTINCT is on, so no duplicates expected
    await captureJourneyStep('qb-result-after-apply');

    // ── Step 10: Re-open the panel, verify Reset works ──
    await qbToggle.click();
    await qbPanel.waitForDisplayed({ timeout: 5000 });

    // Click Reset via the panel header button
    const resetDone = await browser.execute(() => {
      const panel = document.querySelector('[data-testid="qb-panel"]');
      if (!panel) return false;
      const buttons = Array.from(panel.querySelectorAll('button'));
      const reset = buttons.find(
        (b) => b.textContent?.includes('重置') || b.textContent?.includes('Reset'),
      );
      if (reset) {
        reset.click();
        return true;
      }
      return false;
    });
    expect(resetDone).toBe(true);
    await browser.pause(500);

    // After reset, SQL preview should be absent (no columns selected)
    const previewAfterReset = await $('[data-testid="qb-sql-preview"]');
    const previewExists = await previewAfterReset.isExisting().catch(() => false);
    if (previewExists) {
      const resetPreviewText = await previewAfterReset.getText();
      expect(resetPreviewText).not.toContain('name');
    }
    await captureJourneyStep('qb-reset');

    // ── Step 11: Close the panel via the X button ──
    const closed = await browser.execute(() => {
      const panel = document.querySelector('[data-testid="qb-panel"]');
      if (!panel) return false;
      const buttons = Array.from(panel.querySelectorAll('button'));
      const close = buttons.find(
        (b) =>
          b.querySelector('.lucide-x') ||
          b.getAttribute('title')?.includes('Close') ||
          b.getAttribute('title')?.includes('关闭'),
      );
      if (close) {
        close.click();
        return true;
      }
      return false;
    });
    expect(closed).toBe(true);

    await browser.waitUntil(
      async () =>
        !(await $('[data-testid="qb-panel"]')
          .isDisplayed()
          .catch(() => false)),
      { timeout: 5000, timeoutMsg: '关闭面板超时' },
    );
    await captureJourneyStep('qb-panel-closed');
  });
});
