/**
 * Visual Query Builder complete user journey.
 *
 * Covers the full lifecycle of the v2 canvas-based builder:
 *   Open via More menu → drag table to canvas → select columns on card
 *   → configure WHERE in CriteriaGrid → configure ORDER BY → toggle DISTINCT
 *   → preview SQL → apply SQL → execute → verify results → reset → close.
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

  it('完整旅程：More菜单打开 → 拖入表 → 选列 → WHERE → ORDER BY → DISTINCT → 预览 SQL → 应用并执行 → 重置 → 关闭', async () => {
    // ── Step 1: Open Visual Builder via More menu ──
    const moreMenu = await $('[data-testid="more-menu-button"]');
    await moreMenu.waitForClickable({ timeout: 5000 });
    await moreMenu.click();
    await browser.pause(300);

    const qbMenuItem = await $('[data-testid="more-menu-visual-builder"]');
    await qbMenuItem.waitForClickable({ timeout: 5000 });
    await qbMenuItem.click();

    const qbPanel = await $('[data-testid="qb-panel"]');
    await qbPanel.waitForDisplayed({ timeout: 5000 });
    await captureJourneyStep('qb-panel-open');

    // ── Step 2: Add a table to the canvas via simulated drop ──
    // The canvas accepts `application/datazen-schema-object` MIME drops.
    // We simulate a drop event with the correct payload.
    const canvasAdded = await browser.execute((tableName: string) => {
      const canvas = document.querySelector('[data-testid="qb-diagram-canvas"]');
      if (!canvas) return false;

      const payload = JSON.stringify({
        version: 1,
        kind: 'table',
        namespace: { database: 'postgres', table: tableName },
        connectionId: 'conn_e2e_pg',
        databaseType: 'postgresql',
      });

      const dragEvent = new DragEvent('drop', {
        bubbles: true,
        cancelable: true,
        dataTransfer: new DataTransfer(),
      });
      dragEvent.dataTransfer!.setData('application/datazen-schema-object', payload);
      canvas.dispatchEvent(dragEvent);
      return true;
    }, TABLE_NAME);
    expect(canvasAdded).toBe(true);

    // Wait for the TableCard to render
    await browser.waitUntil(
      async () => {
        return await browser.execute((name: string) => {
          return !!document.querySelector(`[data-testid="qb-drag-${name}"]`);
        }, TABLE_NAME);
      },
      { timeout: 5000, timeoutMsg: 'Table card not rendered after drop' },
    );
    await captureJourneyStep('qb-table-on-canvas');

    // ── Step 3: Select columns via TableCard checkboxes ──
    // Click the checkbox for 'name' column on the table card
    const nameChecked = await browser.execute((tbl: string) => {
      const col = document.querySelector(`[data-testid="qb-col-${tbl}-name"]`);
      if (col) {
        const checkbox = col.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
        if (checkbox) {
          checkbox.click();
          return true;
        }
      }
      return false;
    }, TABLE_NAME);
    expect(nameChecked).toBe(true);
    await browser.pause(300);

    // Click the checkbox for 'score' column on the table card
    const scoreChecked = await browser.execute((tbl: string) => {
      const col = document.querySelector(`[data-testid="qb-col-${tbl}-score"]`);
      if (col) {
        const checkbox = col.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
        if (checkbox) {
          checkbox.click();
          return true;
        }
      }
      return false;
    }, TABLE_NAME);
    expect(scoreChecked).toBe(true);
    await browser.pause(500);
    await captureJourneyStep('qb-columns-selected');

    // ── Step 4: Verify SQL preview shows SELECT ──
    const preview = await $('[data-testid="qb-sql-preview"]');
    await preview.waitForDisplayed({ timeout: 5000 });
    let previewText = await preview.getText();
    expect(previewText).toContain('SELECT');
    expect(previewText).toContain(TABLE_NAME);
    await captureJourneyStep('qb-sql-preview-basic');

    // ── Step 5: Add a column to CriteriaGrid and configure WHERE ──
    const addColBtn = await $('[data-testid="criteria-add-column"]');
    await addColBtn.waitForClickable({ timeout: 5000 });
    await addColBtn.click();
    await browser.pause(300);

    // A CriteriaRow should appear
    const criteriaRow = await $('[data-testid="criteria-row"]');
    await criteriaRow.waitForDisplayed({ timeout: 3000 });

    // Select field in the CriteriaRow field dropdown
    const fieldSelect = await $('[data-testid="criteria-field-select"]');
    await fieldSelect.click();
    await browser.waitUntil(
      () =>
        browser.execute(() => document.querySelector('[data-testid="select-listbox"]') !== null),
      { timeout: 3000, timeoutMsg: 'Field dropdown not opened' },
    );

    // Pick the table.column option
    const fieldPicked = await browser.execute((tbl: string) => {
      const listbox = document.querySelector('[data-testid="select-listbox"]');
      if (!listbox) return false;
      const options = Array.from(listbox.querySelectorAll('[data-testid="select-option"]'));
      const field = options.find(
        (o) => o.textContent?.includes(tbl) && o.textContent?.includes('name'),
      );
      if (field) {
        field.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
        return true;
      }
      return false;
    }, TABLE_NAME);
    expect(fieldPicked).toBe(true);
    await browser.pause(300);

    // Open WHERE editor for this row
    const whereBtn = await $('[data-testid="criteria-where-button"]');
    await whereBtn.click();
    await browser.pause(500);

    // The WhereEditor dialog should open
    const whereDialog = await $('[data-testid="where-editor-dialog"]');
    await whereDialog.waitForDisplayed({ timeout: 3000 });

    // Type value 'Alice' in the where value input
    const whereValue = await $('[data-testid="where-value-input"]');
    await whereValue.waitForDisplayed({ timeout: 3000 });
    await whereValue.click();
    await whereValue.setValue('Alice');
    await browser.pause(200);

    // Click Save button in the dialog
    const saveBtn = await browser.execute(() => {
      const dialog = document.querySelector('[data-testid="where-editor-dialog"]');
      if (!dialog) return false;
      const buttons = Array.from(dialog.querySelectorAll('button'));
      const save = buttons.find(
        (b) => b.textContent?.includes('Save') || b.textContent?.includes('保存'),
      );
      if (save) {
        save.click();
        return true;
      }
      return false;
    });
    expect(saveBtn).toBe(true);
    await browser.pause(500);

    // Verify SQL preview now includes WHERE
    previewText = await preview.getText();
    expect(previewText).toContain('WHERE');
    await captureJourneyStep('qb-where-added');

    // ── Step 6: Add ORDER BY via CriteriaGrid sort ──
    const sortSelect = await $('[data-testid="criteria-sort-select"]');
    await sortSelect.click();
    await browser.waitUntil(
      () =>
        browser.execute(() => document.querySelector('[data-testid="select-listbox"]') !== null),
      { timeout: 3000, timeoutMsg: 'Sort dropdown not opened' },
    );

    const ascPicked = await browser.execute(() => {
      const listbox = document.querySelector('[data-testid="select-listbox"]');
      if (!listbox) return false;
      const options = Array.from(listbox.querySelectorAll('[data-testid="select-option"]'));
      const asc = options.find((o) => o.textContent?.includes('ASC'));
      if (asc) {
        asc.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
        return true;
      }
      return false;
    });
    expect(ascPicked).toBe(true);
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
    expect(resultText).toContain('Alice');
    await captureJourneyStep('qb-result-after-apply');

    // ── Step 10: Re-open the panel and Reset ──
    const moreMenu2 = await $('[data-testid="more-menu-button"]');
    await moreMenu2.waitForClickable({ timeout: 5000 });
    await moreMenu2.click();
    await browser.pause(300);

    const qbMenuItem2 = await $('[data-testid="more-menu-visual-builder"]');
    await qbMenuItem2.waitForClickable({ timeout: 5000 });
    await qbMenuItem2.click();

    const reopenedPanel = await $('[data-testid="qb-panel"]');
    await reopenedPanel.waitForDisplayed({ timeout: 5000 });

    const resetBtn = await $('[data-testid="qb-reset"]');
    await resetBtn.waitForClickable({ timeout: 5000 });
    await resetBtn.click();
    await browser.pause(500);
    await captureJourneyStep('qb-reset');

    // ── Step 11: Close the panel ──
    const closeBtn = await $('[data-testid="qb-close"]');
    await closeBtn.waitForClickable({ timeout: 5000 });
    await closeBtn.click();

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
