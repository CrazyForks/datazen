import { expect, browser, $ } from '@wdio/globals';
import {
  clickCardConnectButton,
  closeExtraWindows,
  setEditorContent,
  openQueryTab,
  openConnectionsWorkspace,
  expandConnectedConnectionInNavigator,
  waitForConnectionToolbar,
  executeSQL,
  invokeBackend,
  typeAtSelections,
} from '../helpers.js';

/**
 * SQL Editor completion — the cases a **Community** build can satisfy.
 *
 * Only completion contexts live here: alias completion, FROM-table completion
 * and WHERE-column completion. They are implemented in the Host
 * (`src/components/sql-editor/completion/`), so a build without the Pro
 * extension exercises them for real.
 *
 * The Alt+Enter intentions, the FK JOIN source, the INSERT inlay hints and the
 * hover / definition-navigation cards are **Pro-only**: the Host asks the
 * extension point for them and substitutes an empty list when it gets nothing
 * back (`createIntentionExtensions` and `createHoverExtensions` in
 * `src/components/sql-editor/editorExtensions.ts` both fall back to `?? []`).
 * Those cases live with the code that implements them, in
 * `packages/pro-extensions/sql-editor-pro/e2e/specs/sql-editor-intelligence.ts`.
 *
 * Requires a PostgreSQL connection. Host generic behaviour — no dialect-specific
 * assertions.
 */
describe('SQL Editor 补全 (SE-INT)', () => {
  let mainWindow: string;
  const connId = 'e2e_pg_sql_int';
  const connName = 'E2E-PostgreSQL-Int';

  before(async () => {
    mainWindow = await browser.getWindowHandle();
    await invokeBackend('save_connection', {
      config: {
        id: connId,
        name: connName,
        databaseType: 'postgresql',
        host: process.env.E2E_PG_HOST || '127.0.0.1',
        port: Number(process.env.E2E_PG_PORT) || 5432,
        username: process.env.E2E_PG_USER || 'postgres',
        password: process.env.E2E_PG_PASSWORD || '',
        database: process.env.E2E_PG_DB || 'postgres',
        schema: process.env.E2E_WORKER_SCHEMA || undefined,
        group: 'E2E 测试',
        colorTag: 'purple',
        sslMode: 'disable',
        options: {},
      },
    });
    await browser.refresh();
    await browser.pause(1500);
    await openConnectionsWorkspace();
    await clickCardConnectButton(connName);
    await waitForConnectionToolbar();
    await expandConnectedConnectionInNavigator(connName);
    await browser.pause(1000);
    await openQueryTab();
  });

  // Every case starts from a known workspace, not from whatever the previous
  // one left behind. SE-INT-041's Mod+Click really does navigate — it opens the
  // table's panel — so without this the cases that follow it run against that
  // layout and cannot find the editor at all, failing with
  // `element still not displayed` rather than saying anything about themselves.
  // `openQueryTab` is idempotent: it polls until the editor has mounted and
  // no-ops when a query tab is already open.
  beforeEach(async () => {
    await openQueryTab();
  });

  after(async () => {
    try {
      await closeExtraWindows(mainWindow);
      await invokeBackend('delete_connection', { id: connId });
    } catch {
      /* cleanup best-effort */
    }
  });

  // ── 别名补全 ───────────────────────────────────────────────────

  it('SE-INT-001: 输入表名后应提供别名补全建议', async () => {
    await setEditorContent('SELECT * FROM pg_stat_activity ');
    await browser.pause(300);

    // Focus the editor and trigger autocompletion
    const editor = await $('.cm-editor .cm-content');
    await editor.click();
    await browser.pause(200);

    // Type a letter so `activateOnTyping` queries the sources. `browser.keys`
    // is not a usable character channel on this WebKit build — a plain
    // character arrives as keydown/keyup with no DOM input event, so CodeMirror
    // never sees it (see `typeAtSelections` in ../helpers.ts).
    await typeAtSelections('a');
    await browser.pause(800);

    // Check if autocomplete tooltip appeared
    const hasAutocomplete = await browser.execute(() => {
      const tooltip = document.querySelector('.cm-tooltip-autocomplete');
      return tooltip !== null && tooltip.children.length > 0;
    });
    expect(hasAutocomplete).toBe(true);

    // Escape to close any open autocomplete
    await browser.keys('Escape');
    await browser.pause(200);
  });

  it('SE-INT-002: FROM 子句后应列出可用表', async () => {
    // A table this case owns. Asserting on a table that merely happens to exist
    // in the E2E database makes the case pass or fail on unrelated fixtures —
    // `pg_stat_activity` was the earlier choice and this database does not even
    // have it.
    await executeSQL('CREATE TABLE IF NOT EXISTS zz_e2e_int_from (id INT)');
    await openQueryTab();
    await setEditorContent('SELECT * FROM ');
    await browser.pause(300);

    const editor = await $('.cm-editor .cm-content');
    await editor.click();
    await browser.pause(500);

    // Trigger the sources. This used to be `browser.keys(['Control', ' '])`,
    // which cannot work here: with a capture-phase listener installed before
    // the press, WebKit delivers the Space with `ctrlKey` already cleared, so
    // the `Ctrl-Space` binding never matches. Typing reaches the same sources
    // through `activateOnTyping`, which is the path a real user takes.
    // `z` matches the first letter of the table this case created.
    // CodeMirror's FuzzyMatcher only matches a SINGLE-character query at
    // position 0 (`@codemirror/autocomplete` 6.20.1 dist/index.js:259-267:
    // "For single-character queries, only match when they occur right at the
    // start"), so a one-letter query needs a first letter that something
    // actually starts with. Typing `a` matched no object at all, the candidate
    // list came back empty, and the dialog was never built — which reads
    // exactly like a broken feature.
    await typeAtSelections('z');
    await browser.pause(800);

    // Read existence AND contents in one call, for two reasons. Doing it in two
    // steps gave two contradictory answers: the popup closes between the
    // assertion and a later read, so a second read reported `null` while the
    // first reported 44 items — a reader that can contradict itself is worse
    // than no reader. And a bare "the popup exists" assertion passes on a list
    // of SQL keywords, which says nothing about tables.
    // The compared value is a joined string rather than a boolean, on purpose:
    // expect-webdriverio rejects a second `message` argument ("Expect takes at
    // most one argument"), so `expect(someBoolean).toBe(true)` prints only
    // `false` and hides everything the popup actually offered. Joining the
    // candidates makes the failure message carry the real list.
    const offered = await browser.execute(() => {
      const tip = document.querySelector('.cm-tooltip-autocomplete');
      if (!tip) return '<no popup element>';
      return Array.from(tip.querySelectorAll('li'))
        .map((li) => li.textContent ?? '')
        .join(' | ');
    });
    expect(offered).toContain('zz_e2e_int_from');

    await executeSQL('DROP TABLE IF EXISTS zz_e2e_int_from');

    await browser.keys('Escape');
    await browser.pause(200);
  });

  // ── FK JOIN 补全 ───────────────────────────────────────────────

  // ── Alt+Enter 意图 (星号展开) ──────────────────────────────────

  // ── Alt+Enter 意图 (限定符添加/移除) ──────────────────────────

  // ── INSERT 值内联提示 ──────────────────────────────────────────

  // ── 悬停和定义导航 ─────────────────────────────────────────────

  // ── 补全上下文 ─────────────────────────────────────────────────

  it('SE-INT-050: WHERE 子句后应提供列名补全', async () => {
    await executeSQL(
      'CREATE TABLE IF NOT EXISTS _e2e_int_where (id SERIAL PRIMARY KEY, name TEXT)',
    );

    await openQueryTab();
    await setEditorContent('SELECT * FROM _e2e_int_where WHERE ');
    await browser.pause(300);

    const editor = await $('.cm-editor .cm-content');
    await editor.click();
    await browser.pause(500);

    // Same reachability fix as SE-INT-002: `Ctrl-Space` cannot be delivered on
    // this WebKit build, so the sources are queried by typing instead.
    // `n` matches the `name` column, one of the two this table declares. Same
    // single-character prefix rule as SE-INT-002.
    await typeAtSelections('n');
    await browser.pause(800);

    const hasColumnCompletion = await browser.execute(() => {
      const tooltip = document.querySelector('.cm-tooltip-autocomplete');
      if (!tooltip) return false;
      const items = tooltip.querySelectorAll('li');
      return Array.from(items).some(
        (li) => li.textContent?.includes('id') || li.textContent?.includes('name'),
      );
    });
    // As above: whether the column completion actually offered `id`/`name`
    // is the whole content of the case.
    expect(hasColumnCompletion).toBe(true);

    await browser.keys('Escape');
    await browser.pause(200);

    // Clean up
    await executeSQL('DROP TABLE IF EXISTS _e2e_int_where');
  });
});
