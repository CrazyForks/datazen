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
 *   6. set and then clear LIMIT/OFFSET
 *   7. add a condition in the Conditions panel and flip the group to OR
 *   8. apply the generated SQL, execute it, verify the result rows
 *   9. re-open, drag an FK pair in and confirm the JOIN reaches the SQL
 *  10. build a manual JOIN by clicking a column, then a column of another table
 *  11. reset (panel stays open), close
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

/**
 * The id the builder derives for an auto-detected relationship.
 *
 * Mirrors `groupRelationsIntoJoins`: one join per table pair, with every column
 * pair folded into it.
 */
function autoJoinId(
  fromTable: string,
  fromColumn: string,
  toTable: string,
  toColumn: string,
): string {
  return `auto-${fromTable}-${toTable}-${fromColumn}=${toColumn}`;
}

/** Parent / child pair with a real FK, used to exercise auto-detected JOINs. */
const PARENT_TABLE = `${TABLE_NAME}_parent`;
const CHILD_TABLE = `${TABLE_NAME}_child`;

/**
 * Owner / member pair with **no** declared constraint.
 *
 * The member column spells the owner table out in full, so the naming convention
 * links them exactly and the builder must infer the relationship from structure
 * alone. The naming style decides the tier: an exact `{table}_id` scores high and
 * is applied, while a prefix-dropping `owner_id` scores medium and is only
 * offered. This phase pins the applied path; the offered path is pinned by the
 * engine's unit tests.
 */
const OWNER_TABLE = `${TABLE_NAME}_owner`;
const MEMBER_TABLE = `${TABLE_NAME}_member`;

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
  paginationApplied: false,
  conditionApplied: false,
  sqlApplied: false,
  autoJoinVerified: false,
  predictedJoinVerified: false,
  manualJoinVerified: false,
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
async function dropOnCanvas(xRatio = 0.5, yRatio = 0.5): Promise<boolean> {
  return browser.execute(
    (xr: number, yr: number) => {
      const canvas = document.querySelector<HTMLElement>('[data-testid="qb-diagram-canvas"]');
      const dataTransfer = (window as DragWindow).__qbDragTransfer;
      if (!canvas || !dataTransfer) return false;

      const rect = canvas.getBoundingClientRect();
      const clientX = Math.round(rect.left + rect.width * xr);
      const clientY = Math.round(rect.top + rect.height * yr);

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
    },
    xRatio,
    yRatio,
  ) as Promise<boolean>;
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

/**
 * Set a React-controlled input's value through the native setter.
 *
 * `setValue('')` on a `type="number"` field is unreliable in WebKit, and both
 * the LIMIT/OFFSET and condition-value fields are React-controlled, so drive
 * them the same way the navigator filter is driven. `index` picks among
 * repeated testids (the nested condition row is the second one).
 */
async function setInputValue(testId: string, value: string, index = 0): Promise<void> {
  const applied = await browser.execute(
    (id: string, v: string, i: number) => {
      const input = document.querySelectorAll<HTMLInputElement>(`[data-testid="${id}"]`)[i];
      if (!input) return false;
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      )?.set;
      setter?.call(input, v);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    },
    testId,
    value,
    index,
  );
  expectTrue(applied, `未找到输入框 ${testId}[${index}]`);
  await browser.pause(250);
}

/**
 * Click a real button by testid through the DOM.
 *
 * Used where the control lives in an SVG <foreignObject> beneath the table
 * cards, so a coordinate click would depend on canvas geometry.
 */
async function clickByTestId(testId: string): Promise<boolean> {
  return browser.execute((id: string) => {
    const btn = document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
    if (!btn) return false;
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    return true;
  }, testId);
}

/** Count elements by testid straight from the DOM (avoids WDIO array typing). */
async function countByTestId(testId: string): Promise<number> {
  return browser.execute(
    (id: string) => document.querySelectorAll(`[data-testid="${id}"]`).length,
    testId,
  );
}

/**
 * Count elements whose testid starts with a prefix. Manual JOIN ids are
 * nanoids, so they can only be matched by prefix.
 */
async function countByTestIdPrefix(prefix: string): Promise<number> {
  return browser.execute(
    (p: string) => document.querySelectorAll(`[data-testid^="${p}"]`).length,
    prefix,
  );
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
        // FK pair: the builder must turn this relationship into a real JOIN in
        // the generated SQL, not just a line on the canvas.
        await invokeBackend('execute_query', {
          dbSessionId,
          sql: `CREATE TABLE ${PARENT_TABLE} (id INTEGER PRIMARY KEY, label TEXT)`,
        });
        await invokeBackend('execute_query', {
          dbSessionId,
          sql: `INSERT INTO ${PARENT_TABLE} (id, label) VALUES (1, 'root'), (2, 'branch')`,
        });
        await invokeBackend('execute_query', {
          dbSessionId,
          sql: `CREATE TABLE ${CHILD_TABLE} (id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES ${PARENT_TABLE}(id), note TEXT)`,
        });
        await invokeBackend('execute_query', {
          dbSessionId,
          sql: `INSERT INTO ${CHILD_TABLE} (id, parent_id, note) VALUES (1, 1, 'first'), (2, 2, 'second')`,
        });
        // Predicted pair: no REFERENCES clause anywhere, so only the naming
        // convention links them.
        await invokeBackend('execute_query', {
          dbSessionId,
          sql: `CREATE TABLE ${OWNER_TABLE} (id INTEGER PRIMARY KEY, label TEXT)`,
        });
        await invokeBackend('execute_query', {
          dbSessionId,
          sql: `INSERT INTO ${OWNER_TABLE} (id, label) VALUES (1, 'acme'), (2, 'globex')`,
        });
        await invokeBackend('execute_query', {
          dbSessionId,
          sql: `CREATE TABLE ${MEMBER_TABLE} (id INTEGER PRIMARY KEY, ${OWNER_TABLE}_id INTEGER, note TEXT)`,
        });
        await invokeBackend('execute_query', {
          dbSessionId,
          sql: `INSERT INTO ${MEMBER_TABLE} (id, ${OWNER_TABLE}_id, note) VALUES (1, 1, 'a'), (2, 2, 'b')`,
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
          // Drop the FK child before its parent.
          await invokeBackend('execute_query', {
            dbSessionId,
            sql: `DROP TABLE IF EXISTS ${CHILD_TABLE}`,
          });
          await invokeBackend('execute_query', {
            dbSessionId,
            sql: `DROP TABLE IF EXISTS ${PARENT_TABLE}`,
          });
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

    // The column row carries two affordances now: the checkbox selects, and the
    // column name arms a manual JOIN. Select via the checkbox.
    for (const column of ['name', 'score']) {
      const check = await $(`[data-testid="qb-col-check-${TABLE_NAME}-${column}"]`);
      await check.waitForClickable({ timeout: 5000 });
      await check.click();
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
      const save = document.querySelector<HTMLElement>('[data-testid="where-save-button"]');
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

  it('阶段6：设置 LIMIT/OFFSET 后 SQL 预览包含行窗口，清空后移除', async function () {
    if (!journey.distinctApplied) this.skip();

    const limitInput = await $('[data-testid="qb-limit-input"]');
    await limitInput.waitForDisplayed({ timeout: 5000 });
    await setInputValue('qb-limit-input', '5');

    await browser.waitUntil(async () => (await sqlPreviewText()).includes('LIMIT 5'), {
      timeout: 5000,
      timeoutMsg: 'SQL 预览未包含 LIMIT 5',
    });
    await captureJourneyStep('qb-limit-set');

    const offsetInput = await $('[data-testid="qb-offset-input"]');
    await offsetInput.waitForDisplayed({ timeout: 5000 });
    await setInputValue('qb-offset-input', '2');

    await browser.waitUntil(async () => (await sqlPreviewText()).includes('LIMIT 5 OFFSET 2'), {
      timeout: 5000,
      timeoutMsg: 'SQL 预览未包含 LIMIT 5 OFFSET 2',
    });
    await captureJourneyStep('qb-offset-set');

    // Clearing a field must drop the clause again, not emit `LIMIT 0`. The
    // journey applies this query in phase 8, so the row window has to go.
    await setInputValue('qb-limit-input', '');
    await setInputValue('qb-offset-input', '');

    await browser.waitUntil(async () => !(await sqlPreviewText()).includes('LIMIT'), {
      timeout: 5000,
      timeoutMsg: '清空后 SQL 预览仍包含 LIMIT',
    });
    await captureJourneyStep('qb-pagination-cleared');

    journey.paginationApplied = true;
  });

  it('阶段7：条件组面板添加条件并切换为 OR 后 SQL 预览同步', async function () {
    if (!journey.paginationApplied) this.skip();

    const addCondition = await $('[data-testid="condition-add-button"]');
    await addCondition.waitForClickable({ timeout: 5000 });
    await addCondition.click();
    await browser.pause(300);

    // A new row is seeded with the first available field; only the value needs
    // typing. `id` is the first column of the journey table.
    await setInputValue('condition-value-input', '1');

    await browser.waitUntil(async () => (await sqlPreviewText()).includes('"id" = 1'), {
      timeout: 5000,
      timeoutMsg: 'SQL 预览未包含条件组新增的条件',
    });
    await captureJourneyStep('qb-condition-added');

    // A nested group is emitted parenthesised.
    const addGroup = await $('[data-testid="condition-add-group-button"]');
    await addGroup.waitForClickable({ timeout: 5000 });
    await addGroup.click();
    await browser.pause(300);

    expectTrue((await countByTestId('condition-group-nested')) === 1, '未渲染嵌套条件组');

    const nestedAdd = await $(
      '[data-testid="condition-group-nested"] [data-testid="condition-add-button"]',
    );
    await nestedAdd.waitForClickable({ timeout: 5000 });
    await nestedAdd.click();
    await browser.pause(300);

    // The nested row's value input is the second one in document order.
    await setInputValue('condition-value-input', '3', 1);

    await browser.waitUntil(async () => (await sqlPreviewText()).includes('('), {
      timeout: 5000,
      timeoutMsg: 'SQL 预览未包含括号包裹的嵌套条件组',
    });

    // Flipping the nested group to OR must change the connector inside it.
    const nestedOr = await $(
      '[data-testid="condition-group-nested"] [data-testid="condition-group-logic-or"]',
    );
    await nestedOr.waitForClickable({ timeout: 5000 });
    await nestedOr.click();
    await browser.pause(300);

    await browser.waitUntil(
      async () => {
        const text = await sqlPreviewText();
        return text.includes('OR') && text.includes('(');
      },
      { timeout: 5000, timeoutMsg: '切换 OR 后 SQL 预览未更新' },
    );
    await captureJourneyStep('qb-condition-group-or');

    // Remove the nested group again so phase 8 executes the same result set the
    // earlier phases established.
    const removeGroup = await $('[data-testid="condition-group-remove-button"]');
    await removeGroup.waitForClickable({ timeout: 5000 });
    await removeGroup.click();
    await browser.pause(300);

    expectTrue((await countByTestId('condition-group-nested')) === 0, '删除后嵌套条件组仍存在');

    journey.conditionApplied = true;
  });

  it('阶段8：应用 SQL 并执行后结果包含筛选行', async function () {
    if (!journey.conditionApplied) this.skip();

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

  it('阶段9：拖入带外键的两张表后 SQL 预览出现 JOIN，移除后消失', async function () {
    if (!journey.sqlApplied) this.skip();

    await openBuilderFromMoreMenu();
    expect(await isQbPanelOpen()).toBe(true);

    // Drag the FK pair onto the canvas. Detection reads the schema cache, so the
    // JOIN must appear in the preview — a line on the canvas alone is the bug
    // this phase pins.
    await filterNavigatorTo(PARENT_TABLE);
    expectTrue(await startTableDrag(PARENT_TABLE), '父表 dragstart 未写入 schema 对象');
    expectTrue(await dropOnCanvas(0.28, 0.35), '父表未被画布接收');
    await browser.pause(600);

    await filterNavigatorTo(CHILD_TABLE);
    expectTrue(await startTableDrag(CHILD_TABLE), '子表 dragstart 未写入 schema 对象');
    expectTrue(await dropOnCanvas(0.72, 0.6), '子表未被画布接收');
    await browser.pause(600);

    // The FK line is drawn...
    await browser.waitUntil(
      async () =>
        (await countByTestId(
          `qb-join-line-${autoJoinId(CHILD_TABLE, 'parent_id', PARENT_TABLE, 'id')}`,
        )) === 1,
      { timeout: 10000, timeoutMsg: '未渲染自动检测的 JOIN 连线' },
    );
    await captureJourneyStep('qb-auto-join-line');

    // ...and it must also be in the SQL, not only on the canvas.
    await browser.waitUntil(
      async () => {
        const text = await sqlPreviewText();
        return text.includes('JOIN') && text.includes('parent_id');
      },
      { timeout: 10000, timeoutMsg: 'SQL 预览未包含自动检测的 JOIN' },
    );
    await captureJourneyStep('qb-auto-join-sql');

    // Removing the auto JOIN must drop it from the SQL again (and must not be
    // immediately re-detected).
    const joinId = autoJoinId(CHILD_TABLE, 'parent_id', PARENT_TABLE, 'id');
    expectTrue(await clickByTestId(`qb-join-remove-${joinId}`), '未找到自动检测 JOIN 的移除按钮');
    await browser.pause(500);

    await browser.waitUntil(async () => !(await sqlPreviewText()).includes('JOIN'), {
      timeout: 5000,
      timeoutMsg: '移除后 SQL 预览仍包含 JOIN',
    });
    await captureJourneyStep('qb-auto-join-removed');

    journey.autoJoinVerified = true;
  });

  it('阶段10：点击列到列创建手动 JOIN，Esc 可取消', async function () {
    if (!journey.autoJoinVerified) this.skip();

    // ── Exit transition: Esc must disarm an armed anchor ──
    expectTrue(await clickByTestId(`qb-col-join-${TABLE_NAME}-id`), '未找到第一张表的列');
    await browser.waitUntil(async () => (await countByTestId('qb-join-anchor-banner')) === 1, {
      timeout: 5000,
      timeoutMsg: '点击列后未进入 JOIN 锚点状态',
    });
    expectTrue(await sqlPreviewText().then((t) => !t.includes('JOIN')), '仅锚定时不应产生 JOIN');

    await browser.keys(['Escape']);
    await browser.waitUntil(async () => (await countByTestId('qb-join-anchor-banner')) === 0, {
      timeout: 5000,
      timeoutMsg: 'Esc 未能取消 JOIN 锚点',
    });

    // ── Enter + complete: click a column, then a column of another table ──
    expectTrue(await clickByTestId(`qb-col-join-${TABLE_NAME}-id`), '未找到第一张表的列');
    await browser.waitUntil(async () => (await countByTestId('qb-join-anchor-banner')) === 1, {
      timeout: 5000,
      timeoutMsg: '点击列后未进入 JOIN 锚点状态',
    });
    await captureJourneyStep('qb-join-anchor-armed');

    // No FK links these two tables, so any JOIN here is the manual one.
    expectTrue(await clickByTestId(`qb-col-join-${PARENT_TABLE}-id`), '未找到第二张表的列');
    await browser.waitUntil(async () => (await countByTestId('qb-join-anchor-banner')) === 0, {
      timeout: 5000,
      timeoutMsg: '创建 JOIN 后锚点状态未退出',
    });
    await browser.waitUntil(
      async () => {
        const text = await sqlPreviewText();
        return (
          text.includes('INNER JOIN') &&
          text.includes(`"${TABLE_NAME}"."id" = "${PARENT_TABLE}"."id"`)
        );
      },
      { timeout: 10000, timeoutMsg: '手动 JOIN 未进入 SQL 预览' },
    );
    await captureJourneyStep('qb-manual-join');

    // The same pair must not be added twice (either click order).
    expectTrue(await clickByTestId(`qb-col-join-${TABLE_NAME}-id`), '未找到第一张表的列');
    expectTrue(await clickByTestId(`qb-col-join-${PARENT_TABLE}-id`), '未找到第二张表的列');
    await browser.pause(300);
    // Only the manual JOIN exists here (the FK one was dismissed in 阶段9), so
    // a duplicate would show up as a second line.
    const joinLines = await countByTestIdPrefix('qb-join-line-');
    expectTrue(joinLines === 1, `重复点击产生了 ${joinLines} 条 JOIN 连线`);

    journey.manualJoinVerified = true;
  });

  it('阶段11：Reset 清空查询但保持面板打开，随后可关闭', async function () {
    if (!journey.manualJoinVerified) this.skip();

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

  it('阶段9b：无外键约束的两张表也能按命名推测出 JOIN', async function () {
    if (!journey.manualJoinVerified) this.skip();

    await openBuilderFromMoreMenu();
    expect(await isQbPanelOpen()).toBe(true);

    // Neither table declares a REFERENCES clause, so anything that appears here
    // was inferred. The prefix on the table names is dropped by the column name,
    // which is the naming style most ORM-managed schemas use.
    await filterNavigatorTo(OWNER_TABLE);
    expectTrue(await startTableDrag(OWNER_TABLE), 'owner 表 dragstart 未写入 schema 对象');
    expectTrue(await dropOnCanvas(0.28, 0.35), 'owner 表未被画布接收');
    await browser.pause(600);

    await filterNavigatorTo(MEMBER_TABLE);
    expectTrue(await startTableDrag(MEMBER_TABLE), 'member 表 dragstart 未写入 schema 对象');
    expectTrue(await dropOnCanvas(0.72, 0.6), 'member 表未被画布接收');
    await browser.pause(800);

    // The preview only exists once there is something to select, so pick a column
    // from each table before asserting on the SQL.
    for (const table of [OWNER_TABLE, MEMBER_TABLE]) {
      const check = await $(`[data-testid="qb-col-check-${table}-id"]`);
      await check.waitForClickable({ timeout: 5000 });
      await check.click();
      await browser.pause(200);
    }

    const joinId = autoJoinId(MEMBER_TABLE, `${OWNER_TABLE}_id`, OWNER_TABLE, 'id');

    // The inference must reach the canvas...
    await browser.waitUntil(async () => (await countByTestId(`qb-join-line-${joinId}`)) === 1, {
      timeout: 10000,
      timeoutMsg: '未渲染推测出的 JOIN 连线',
    });

    // ...and be labelled as inferred, never as a declared constraint.
    expectTrue(
      (await countByTestId(`qb-join-predicted-${joinId}`)) === 1,
      '推测出的 JOIN 未标注 predicted',
    );
    await captureJourneyStep('qb-predicted-join-line');

    // ...and reach the SQL, like any other detected relationship.
    await browser.waitUntil(
      async () => {
        const text = await sqlPreviewText();
        return text.includes('JOIN') && text.includes(`${OWNER_TABLE}_id`);
      },
      { timeout: 10000, timeoutMsg: 'SQL 预览未包含推测出的 JOIN' },
    );
    await captureJourneyStep('qb-predicted-join-sql');

    // Removing it must drop it from the SQL and not immediately come back.
    expectTrue(await clickByTestId(`qb-join-remove-${joinId}`), '未找到推测 JOIN 的移除按钮');
    await browser.pause(600);
    await browser.waitUntil(async () => !(await sqlPreviewText()).includes('JOIN'), {
      timeout: 5000,
      timeoutMsg: '移除后 SQL 预览仍包含推测的 JOIN',
    });
    await captureJourneyStep('qb-predicted-join-removed');

    journey.predictedJoinVerified = true;
  });
});
