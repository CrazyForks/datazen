/**
 * Visual Query Builder complete user journey.
 *
 * Covers the full lifecycle of the v2 canvas-based builder as an ordered
 * sequence of phases sharing one session:
 *
 *   1. open via the More menu
 *   2. real HTML5 drag from the sidebar schema tree onto the canvas
 *   3. select columns on the table card
 *   4. configure WHERE in the CriteriaGrid
 *   5. configure ORDER BY and DISTINCT
 *   6. apply the generated SQL, execute it, verify the result rows
 *   7. re-open, reset (panel stays open), close
 *
 * Phases are separate `it()` blocks so a failure localises to one step instead
 * of losing every later assertion. A phase whose predecessor did not complete
 * is skipped rather than cascading into a misleading failure.
 *
 * The drag is a genuine drag: the spec dispatches `dragstart` on the product's
 * own schema-tree row (letting its handler build the payload) and then
 * `dragover`/`drop` on the builder canvas, so the real drop handler, the
 * `application/datazen-schema-object` contract and the follow-up column load
 * are all exercised. No store state is injected.
 *
 * Test data is created through backend IPC in `before`, so the journey assumes
 * nothing about pre-existing tables.
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
  waitForTableInSidebar,
  withSafeModeOff,
} from '../../helpers.js';

const TABLE_NAME = `e2e_qb_journey_${Date.now().toString(36)}`;

/** Versioned MIME the schema tree writes and the builder canvas consumes. */
const SCHEMA_OBJECT_MIME = 'application/datazen-schema-object';

/**
 * Shared phase state. Each phase flips its own flag on success; a phase whose
 * precondition is still false is skipped so one broken step does not produce a
 * cascade of unrelated failures.
 */
const journey = {
  panelOpen: false,
  tableOnCanvas: false,
  columnsSelected: false,
  whereApplied: false,
  distinctApplied: false,
  sqlApplied: false,
};

type DragWindow = Window & { __qbDragTransfer?: DataTransfer };

/**
 * Assert a boolean with a message. WDIO's `expect` takes no second argument,
 * and a bare `toBe(true)` would hide which contract broke.
 */
function expectTrue(value: boolean, message: string): void {
  if (!value) throw new Error(message);
}

function qbPanel() {
  return $('[data-testid="qb-panel"]');
}

async function isQbPanelOpen(): Promise<boolean> {
  return (
    (await qbPanel()
      .isDisplayed()
      .catch(() => false)) === true
  );
}

async function openBuilderFromMoreMenu(): Promise<void> {
  const moreMenu = await $('[data-testid="query-toolbar-more-menu-trigger"]');
  await moreMenu.waitForClickable({ timeout: 10000 });
  await moreMenu.click();
  await browser.pause(300);

  const qbMenuItem = await $('[data-testid="more-menu-visual-builder"]');
  await qbMenuItem.waitForClickable({ timeout: 5000 });
  await qbMenuItem.click();

  await (await qbPanel()).waitForDisplayed({ timeout: 10000 });
}

/**
 * Narrow the navigator search to the table so its row stays mounted at the top
 * of the virtualized schema tree while we drag it. Uses the native value setter
 * so React's controlled input sees the change.
 */
async function filterNavigatorTo(tableName: string): Promise<void> {
  await browser.execute((name: string) => {
    const nav =
      document.querySelector<HTMLElement>('[data-testid="connection-navigator-aside"]') ??
      Array.from(document.querySelectorAll('aside')).find((a) =>
        a.querySelector('[data-conn-item]'),
      );
    const input = nav?.querySelector<HTMLInputElement>('input');
    if (!input) return;

    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, name);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, tableName);
  await browser.pause(600);
}

/**
 * Dispatch the product's own `dragstart` on the sidebar table row and keep the
 * resulting DataTransfer for the matching drop.
 *
 * Resolves true only when the product handler actually populated the versioned
 * MIME — a bare synthetic event would otherwise pass silently.
 */
async function startTableDrag(tableName: string): Promise<boolean> {
  return browser.execute(
    (name: string, mime: string) => {
      const source = Array.from(
        document.querySelectorAll<HTMLElement>(
          '[data-testid="schema-tree-node"][data-tree-node="table"]',
        ),
      ).find((node) => node.getAttribute('data-item-name') === name);
      if (!source) return false;

      const dataTransfer = new DataTransfer();
      (window as DragWindow).__qbDragTransfer = dataTransfer;
      source.dispatchEvent(
        new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer }),
      );
      return dataTransfer.getData(mime).length > 0;
    },
    tableName,
    SCHEMA_OBJECT_MIME,
  ) as Promise<boolean>;
}

/** Drop the retained payload on the centre of the builder canvas. */
async function dropOnCanvas(): Promise<boolean> {
  return browser.execute(() => {
    const canvas = document.querySelector<HTMLElement>('[data-testid="qb-diagram-canvas"]');
    const dataTransfer = (window as DragWindow).__qbDragTransfer;
    if (!canvas || !dataTransfer) return false;

    const rect = canvas.getBoundingClientRect();
    const clientX = Math.round(rect.left + rect.width / 2);
    const clientY = Math.round(rect.top + rect.height / 2);

    canvas.dispatchEvent(
      new DragEvent('dragover', {
        bubbles: true,
        cancelable: true,
        clientX,
        clientY,
        dataTransfer,
      }),
    );
    const drop = new DragEvent('drop', {
      bubbles: true,
      cancelable: true,
      clientX,
      clientY,
      dataTransfer,
    });
    canvas.dispatchEvent(drop);
    return drop.defaultPrevented;
  }) as Promise<boolean>;
}

/** Pick an option from an open @datazen/ui Select listbox by visible text. */
async function pickSelectOption(match: string): Promise<boolean> {
  return browser.execute((needle: string) => {
    const listbox = document.querySelector('[data-testid="select-listbox"]');
    if (!listbox) return false;
    const option = Array.from(listbox.querySelectorAll('[data-testid="select-option"]')).find((o) =>
      o.textContent?.includes(needle),
    );
    if (!option) return false;
    option.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    return true;
  }, match) as Promise<boolean>;
}

async function waitForSelectListbox(): Promise<void> {
  await browser.waitUntil(
    () => browser.execute(() => document.querySelector('[data-testid="select-listbox"]') !== null),
    { timeout: 5000, timeoutMsg: '下拉列表未打开' },
  );
}

async function sqlPreviewText(): Promise<string> {
  return (await $('[data-testid="qb-sql-preview"]')).getText();
}

describe('Visual Query Builder 完整用户旅程 (QB-JOURNEY)', () => {
  let mainWindow: string;

  before(async () => {
    // Create the test table and seed rows through backend IPC (no UI dependency).
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

  it('阶段1：More 菜单可打开可视化构建器面板', async () => {
    await openBuilderFromMoreMenu();
    await captureJourneyStep('qb-panel-open');
    journey.panelOpen = true;
  });

  it('阶段2：从侧边栏 schema 树真实拖放表到画布并加载列', async function () {
    if (!journey.panelOpen) this.skip();

    // Make the freshly created table reachable in the sidebar, then keep it
    // mounted at the top of the virtualized list for the drag.
    await waitForTableInSidebar(TABLE_NAME);
    await filterNavigatorTo(TABLE_NAME);

    const payloadReady = await startTableDrag(TABLE_NAME);
    expectTrue(payloadReady, 'dragstart 未写入 application/datazen-schema-object 负载');

    const dropped = await dropOnCanvas();
    expectTrue(dropped, 'canvas 未消费 drop 事件');

    await filterNavigatorTo('');

    // The card proves the drop handler ran; the column row proves the builder
    // then fetched columns from the backend for the dropped table.
    await browser.waitUntil(
      () =>
        browser.execute(
          (name: string) => !!document.querySelector(`[data-testid="qb-drag-${name}"]`),
          TABLE_NAME,
        ),
      { timeout: 10000, timeoutMsg: '拖放后画布未生成表卡片' },
    );
    await (
      await $(`[data-testid="qb-col-${TABLE_NAME}-name"]`)
    ).waitForDisplayed({
      timeout: 10000,
    });
    await captureJourneyStep('qb-table-dropped');

    journey.tableOnCanvas = true;
  });

  it('阶段3：勾选列后 SQL 预览包含所选列', async function () {
    if (!journey.tableOnCanvas) this.skip();

    for (const column of ['name', 'score']) {
      const cell = await $(`[data-testid="qb-col-${TABLE_NAME}-${column}"]`);
      await cell.waitForClickable({ timeout: 5000 });
      await cell.click();
      await browser.pause(200);
    }

    await browser.waitUntil(async () => (await sqlPreviewText()).includes('name'), {
      timeout: 5000,
      timeoutMsg: 'SQL 预览未包含所选列',
    });
    const preview = await sqlPreviewText();
    expect(preview).toContain('SELECT');
    expect(preview).toContain(TABLE_NAME);
    expect(preview).toContain('score');
    await captureJourneyStep('qb-columns-selected');

    journey.columnsSelected = true;
  });

  it('阶段4：CriteriaGrid 配置 WHERE 后 SQL 预览包含条件', async function () {
    if (!journey.columnsSelected) this.skip();

    const addColBtn = await $('[data-testid="criteria-add-column"]');
    await addColBtn.waitForClickable({ timeout: 5000 });
    await addColBtn.click();
    await browser.pause(300);

    await (await $('[data-testid="criteria-row"]')).waitForDisplayed({ timeout: 3000 });

    // Field dropdown lives inside the row; the testid wraps the trigger button.
    const fieldSelect = await $('[data-testid="criteria-field-select"] button');
    await fieldSelect.waitForClickable({ timeout: 5000 });
    await fieldSelect.click();
    await waitForSelectListbox();
    // Option labels are `table.column`; match the exact field, not just the table,
    // or the first column of that table (`id`) would be picked instead.
    expectTrue(await pickSelectOption(`${TABLE_NAME}.name`), '字段下拉未找到该表的 name 列选项');
    await browser.pause(300);

    const whereBtn = await $('[data-testid="criteria-where-button"]');
    await whereBtn.waitForClickable({ timeout: 5000 });
    await whereBtn.click();
    await browser.pause(500);

    const whereDialog = await $('[data-testid="where-editor-dialog"]');
    await whereDialog.waitForDisplayed({ timeout: 5000 });

    const whereValue = await $('[data-testid="where-value-input"]');
    await whereValue.waitForDisplayed({ timeout: 3000 });
    await whereValue.click();
    await whereValue.setValue('Alice');
    await browser.pause(200);

    const saved = await browser.execute(() => {
      const dialog = document.querySelector('[data-testid="where-editor-dialog"]');
      if (!dialog) return false;
      const save = Array.from(dialog.querySelectorAll('button')).find((b) =>
        b.textContent?.includes('Save'),
      );
      if (!save) return false;
      save.click();
      return true;
    });
    expectTrue(saved, 'WHERE 弹窗未找到 Save 按钮');
    await browser.pause(500);

    await browser.waitUntil(async () => (await sqlPreviewText()).includes('WHERE'), {
      timeout: 5000,
      timeoutMsg: 'SQL 预览未包含 WHERE',
    });
    expect(await sqlPreviewText()).toContain('Alice');
    await captureJourneyStep('qb-where-added');

    journey.whereApplied = true;
  });

  it('阶段5：配置 ORDER BY 与 DISTINCT 后 SQL 预览同步更新', async function () {
    if (!journey.whereApplied) this.skip();

    const sortSelect = await $('[data-testid="criteria-sort-select"]');
    await sortSelect.waitForClickable({ timeout: 5000 });
    await sortSelect.click();
    await waitForSelectListbox();
    expectTrue(await pickSelectOption('ASC'), '排序下拉未找到 ASC 选项');
    await browser.pause(300);

    await browser.waitUntil(async () => (await sqlPreviewText()).includes('ORDER BY'), {
      timeout: 5000,
      timeoutMsg: 'SQL 预览未包含 ORDER BY',
    });
    await captureJourneyStep('qb-sort-added');

    const distinctCheckbox = await $('[data-testid="qb-distinct-checkbox"]');
    await distinctCheckbox.waitForClickable({ timeout: 5000 });
    await distinctCheckbox.click();
    await browser.pause(300);

    await browser.waitUntil(async () => (await sqlPreviewText()).includes('DISTINCT'), {
      timeout: 5000,
      timeoutMsg: 'SQL 预览未包含 DISTINCT',
    });
    await captureJourneyStep('qb-distinct-toggled');

    journey.distinctApplied = true;
  });

  it('阶段6：应用 SQL 并执行后结果包含筛选行', async function () {
    if (!journey.distinctApplied) this.skip();

    const applyBtn = await $('[data-testid="qb-apply-sql"]');
    await applyBtn.waitForClickable({ timeout: 5000 });
    await applyBtn.click();

    await browser.waitUntil(async () => !(await isQbPanelOpen()), {
      timeout: 10000,
      timeoutMsg: 'Apply SQL 后面板未关闭',
    });
    await captureJourneyStep('qb-applied-sql');

    await browser.pause(500);
    const execBtn = await $('[data-testid="editor-execute-button"]');
    await execBtn.waitForClickable({ timeout: 10000 });
    await execBtn.click();

    const resultTable = await $('[data-testid="result-workspace-table"]');
    await resultTable.waitForDisplayed({ timeout: 20000 });
    await browser.waitUntil(async () => (await resultTable.getText()).includes('Alice'), {
      timeout: 10000,
      timeoutMsg: '查询结果未包含 Alice',
    });
    await captureJourneyStep('qb-result-after-apply');

    journey.sqlApplied = true;
  });

  it('阶段7：重新打开后 Reset 清空查询但保持面板打开，随后可关闭', async function () {
    if (!journey.sqlApplied) this.skip();

    await openBuilderFromMoreMenu();
    expect(await isQbPanelOpen()).toBe(true);

    const resetBtn = await $('[data-testid="qb-reset"]');
    await resetBtn.waitForClickable({ timeout: 5000 });
    await resetBtn.click();
    await browser.pause(500);

    // Reset clears the query but must not dismiss the panel — closing is a
    // separate, explicit action (qb-close).
    expectTrue(await isQbPanelOpen(), 'Reset 后构建器面板不应关闭');
    // The preview unmounts entirely once the generated SQL is empty again.
    await browser.waitUntil(
      () =>
        browser.execute(() => document.querySelector('[data-testid="qb-sql-preview"]') === null),
      { timeout: 5000, timeoutMsg: 'Reset 后 SQL 预览未清空' },
    );
    await captureJourneyStep('qb-reset');

    const closeBtn = await $('[data-testid="qb-close"]');
    await closeBtn.waitForClickable({ timeout: 5000 });
    await closeBtn.click();

    await browser.waitUntil(async () => !(await isQbPanelOpen()), {
      timeout: 10000,
      timeoutMsg: '关闭面板超时',
    });
    await captureJourneyStep('qb-panel-closed');
  });
});
