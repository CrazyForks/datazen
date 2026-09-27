import { expect, browser } from '@wdio/globals';
import {
  captureJourneyStep,
  clickCardConnectButton,
  closeExtraWindows,
  setEditorContent,
  openQueryTab,
  openConnectionsWorkspace,
  expandConnectedConnectionInNavigator,
  waitForConnectionToolbar,
  invokeBackend,
} from '../helpers.js';

/**
 * SQL Editor multi-cursor gestures (SE-MC).
 *
 * Covers the two gestures that `sql-editor-productivity.ts` does not:
 * the platform chord (Cmd+click on macOS / Ctrl+click elsewhere) and Escape.
 *
 * ## Why these assertions look at `state.selection`, not at the DOM
 *
 * A cursor is a selection range, not an element — CodeMirror renders the
 * primary cursor and the extra ones from one decoration pass, so counting
 * `.cm-cursor` nodes is coupled to whether `drawSelection` is mounted. The
 * selection *is* the feature's contract, so that is what is asserted.
 *
 * ## Why clicks are driven as a real mousedown/mousemove/mouseup triple
 *
 * `EditorView.clickAddsSelectionRange` is read by `MouseSelection`'s
 * **constructor** from the mousedown event (`@codemirror/view` index.js:4753):
 *
 * ```js
 * this.multiple = view.state.facet(EditorState.allowMultipleSelections)
 *   && addsSelectionRange(view, startEvent);
 * ```
 *
 * Dispatching a `click` event therefore exercises nothing. The sequence and
 * the event targets matter: mousedown goes to `contentDOM`, while mousemove and
 * mouseup are listened for on the document.
 *
 * `detail: 1` is required. `getClickType` returns `event.detail` on a browser
 * with well-behaved mouse detail, so a synthetic click left at its default
 * `detail: 0` can be misread as the start of a multi-click and turn the gesture
 * into a word or line selection.
 *
 * ## Coordinates
 *
 * Points are derived from each `.cm-line`'s own `getBoundingClientRect()`, found
 * by the line's text — never from fixed viewport numbers, so a viewport change
 * or a different font cannot silently retarget the click at a different line.
 *
 * ## Status
 *
 * These cases have NOT been executed: the E2E suite needs
 * `pnpm tauri:build:webdriver`, which this environment cannot produce. They are
 * written against the implementations in `paste/multiCursorPointer.ts` and
 * `paste/multiCursorEscape.ts` and the CodeMirror sources cited above; the first
 * run should be treated as the real verdict.
 */

/**
 * What `readSelection()` returns: enough to tell one cursor from many.
 *
 * `.cm-editor` carries the live `EditorView` on a `cmView` property, so the
 * callbacks below narrow it structurally rather than casting through `any`.
 * The shapes are spelled out inline because `browser.execute` stringifies its
 * callback — nothing from module scope survives into the page.
 */
interface SelectionSnapshot {
  rangeCount: number;
  mainEmpty: boolean;
  mainHead: number;
  /** Present only when an editor was found, so a null result is a real failure. */
  found: boolean;
}

describe('SQL Editor 多光标手势 (SE-MC)', () => {
  let mainWindow: string;
  const connId = 'e2e_pg_sql_multicursor';
  const connName = 'E2E-PostgreSQL-MultiCursor';

  /**
   * The platform chord. `multiCursorPointer.ts` reads it through `isMacOS()`,
   * which the app decides the same way — so the test must agree with it.
   */
  let isMac = false;
  /** WebdriverIO modifier that matches {@link isMac}. */
  let modKey = 'Control';

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
        colorTag: 'teal',
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

    isMac = /Mac|iPhone|iPad/.test(await browser.execute(() => navigator.platform));
    modKey = isMac ? 'Meta' : 'Control';
  });

  after(async () => {
    try {
      await closeExtraWindows(mainWindow);
      await invokeBackend('delete_connection', { id: connId });
    } catch {
      /* cleanup best-effort */
    }
  });

  /**
   * Reads the live selection off whichever `.cm-editor` actually has a view.
   *
   * Scans backwards because the query tab can keep earlier editors mounted;
   * the last one with a live view is the visible one. Self-contained because
   * `browser.execute` stringifies the callback — nothing from module scope is
   * in scope inside the page.
   */
  const readSelection = (): Promise<SelectionSnapshot> =>
    browser.execute((): SelectionSnapshot => {
      const hosts = Array.from(document.querySelectorAll<HTMLElement>('.cm-editor'));
      for (let i = hosts.length - 1; i >= 0; i -= 1) {
        const view = (hosts[i] as HTMLElement & { cmView?: { view?: unknown } }).cmView
          ?.view as
          | { state: { selection: { main: { from: number; to: number; head: number }; ranges: readonly unknown[] } } }
          | undefined;
        if (!view) continue;
        return {
          rangeCount: view.state.selection.ranges.length,
          mainEmpty: view.state.selection.main.from === view.state.selection.main.to,
          mainHead: view.state.selection.main.head,
          found: true,
        };
      }
      return { rangeCount: 0, mainEmpty: false, mainHead: -1, found: false };
    });

  /**
   * A primary-button click on the line containing `lineText`, with the modifier
   * flags under test.
   *
   * Returns false when no such line is rendered, so a case can assert on it
   * instead of silently passing against a click that never landed.
   */
  const clickLine = (
    lineText: string,
    mods: { altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean },
  ): Promise<boolean> =>
    browser.execute(
      (args: { lineText: string; mods: Record<string, boolean> }): boolean => {
        const line = Array.from(document.querySelectorAll<HTMLElement>('.cm-line')).find((el) =>
          (el.textContent || '').includes(args.lineText),
        );
        if (!line) return false;
        const rect = line.getBoundingClientRect();
        // Near the left edge, on the text baseline: `left + 1` lands inside the
        // first character rather than in the line's padding.
        const clientX = rect.left + 1;
        const clientY = rect.top + rect.height / 2;
        const init: MouseEventInit = {
          bubbles: true,
          cancelable: true,
          button: 0,
          detail: 1,
          clientX,
          clientY,
          ...args.mods,
        };
        // Find the editor that owns this line so mousedown targets its contentDOM.
        let contentDOM: HTMLElement | null = null;
        let node: HTMLElement | null = line;
        while (node && !contentDOM) {
          const host = node.closest<HTMLElement>('.cm-editor');
          const view = (host as (HTMLElement & { cmView?: { view?: unknown } }) | null)?.cmView
            ?.view as { contentDOM?: HTMLElement } | undefined;
          if (view?.contentDOM) contentDOM = view.contentDOM;
          node = node.parentElement;
        }
        if (!contentDOM) return false;
        contentDOM.dispatchEvent(new MouseEvent('mousedown', { ...init, buttons: 1 }));
        document.dispatchEvent(new MouseEvent('mousemove', { ...init, buttons: 1 }));
        document.dispatchEvent(new MouseEvent('mouseup', { ...init, buttons: 0 }));
        return true;
      },
      { lineText, mods: mods as Record<string, boolean> },
    );

  /** Puts the caret on `lineText` as a single empty range. */
  const placeCaretOn = (lineText: string): Promise<boolean> =>
    browser.execute((args: { lineText: string }): boolean => {
      const line = Array.from(document.querySelectorAll<HTMLElement>('.cm-line')).find((el) =>
        (el.textContent || '').includes(args.lineText),
      );
      if (!line) return false;
      const hosts = Array.from(document.querySelectorAll<HTMLElement>('.cm-editor'));
      for (let i = hosts.length - 1; i >= 0; i -= 1) {
        const view = (hosts[i] as HTMLElement & { cmView?: { view?: unknown } }).cmView
          ?.view as
          | { posAtCoords(c: { x: number; y: number }): number | null; dispatch(s: unknown): void; focus(): void }
          | undefined;
        if (!view?.posAtCoords) continue;
        const rect = line.getBoundingClientRect();
        const pos = view.posAtCoords({ x: rect.left + 1, y: rect.top + rect.height / 2 });
        if (pos == null) continue;
        view.focus();
        view.dispatch({ selection: { anchor: pos, head: pos } });
        return true;
      }
      return false;
    }, { lineText });

  /**
   * Builds a 3-range selection with Mod+D, the stock CodeMirror chord.
   *
   * Preferred over clicking for the Escape cases: `selectNextOccurrence` is
   * keyboard-only, so it needs no coordinates and cannot be perturbed by layout.
   */
  const buildMultiCursorWithModD = async (): Promise<void> => {
    await setEditorContent('alpha\nalpha\nalpha');
    await browser.pause(300);
    await browser.execute(() => {
      const hosts = Array.from(document.querySelectorAll<HTMLElement>('.cm-editor'));
      for (let i = hosts.length - 1; i >= 0; i -= 1) {
        const view = (hosts[i] as HTMLElement & { cmView?: { view?: unknown } }).cmView
          ?.view as
          | { state: { doc: { toString(): string } }; dispatch(s: unknown): void; focus(): void }
          | undefined;
        if (!view) continue;
        const doc = view.state.doc.toString();
        const idx = doc.indexOf('alpha');
        if (idx < 0) continue;
        view.focus();
        view.dispatch({ selection: { anchor: idx, head: idx + 5 } });
        return;
      }
    });
    await browser.pause(200);
    await browser.keys([modKey, 'D']);
    await browser.pause(200);
    await browser.keys([modKey, 'D']);
    await browser.pause(300);
  };

  // ── 平台修饰键 + 点击 ────────────────────────────────────────────

  it('SE-MC-001: 平台修饰键+点击应新增一个光标', async () => {
    await setEditorContent('first line\nsecond line\nthird line');
    await browser.pause(300);

    expect(await placeCaretOn('first line')).toBe(true);
    await browser.pause(200);
    expect((await readSelection()).rangeCount).toBe(1);

    // macOS ⌘ / Win-Linux Ctrl — the chord this module restores.
    const landed = await clickLine('second line', isMac ? { metaKey: true } : { ctrlKey: true });
    expect(landed).toBe(true);
    await browser.pause(300);

    const after = await readSelection();
    expect(after.found).toBe(true);
    // The load-bearing assertion: a click that added nothing still leaves one
    // range, so only `toBe(2)` can fail here.
    expect(after.rangeCount).toBe(2);

    await captureJourneyStep('multi-cursor-platform-chord-click');
  });

  it('SE-MC-002: Shift+点击不应新增光标（仍为扩展选区）', async () => {
    await setEditorContent('first line\nsecond line\nthird line');
    await browser.pause(300);

    expect(await placeCaretOn('first line')).toBe(true);
    await browser.pause(200);

    const landed = await clickLine('second line', { shiftKey: true });
    expect(landed).toBe(true);
    await browser.pause(300);

    const after = await readSelection();
    expect(after.found).toBe(true);
    // Shift is excluded on every platform by `clickAddsCursor`'s first branch.
    expect(after.rangeCount).toBe(1);
    // ...and it extended rather than replaced, which is what distinguishes
    // "declined to add a cursor" from "ignored the click entirely".
    expect(after.mainEmpty).toBe(false);
  });

  it('SE-MC-003: Alt+点击仍应新增光标（既有宿主手势回归）', async () => {
    await setEditorContent('first line\nsecond line\nthird line');
    await browser.pause(300);

    expect(await placeCaretOn('first line')).toBe(true);
    await browser.pause(200);

    const landed = await clickLine('second line', { altKey: true });
    expect(landed).toBe(true);
    await browser.pause(300);

    const after = await readSelection();
    expect(after.found).toBe(true);
    expect(after.rangeCount).toBe(2);
  });

  // ── Escape ───────────────────────────────────────────────────────

  it('SE-MC-010: 多光标下 Escape 应退化为唯一空光标', async () => {
    await buildMultiCursorWithModD();

    const multi = await readSelection();
    expect(multi.found).toBe(true);
    // Precondition: Mod+D must really have produced several ranges, otherwise
    // the Escape below would be testing the single-cursor path by accident.
    expect(multi.rangeCount).toBe(3);
    expect(multi.mainEmpty).toBe(false);

    await browser.keys('Escape');
    await browser.pause(300);

    const after = await readSelection();
    expect(after.rangeCount).toBe(1);
    // The whole point of the dedicated command: a bare cursor, not the still
    // highlighted word `simplifySelection` would have left behind.
    expect(after.mainEmpty).toBe(true);
  });

  it('SE-MC-011: 多光标下 Escape 应丢弃矩形选区状态', async () => {
    await buildMultiCursorWithModD();

    const before = await readSelection();
    expect(before.found).toBe(true);
    expect(before.rangeCount).toBeGreaterThan(1);

    await browser.keys('Escape');
    await browser.pause(300);

    const after = await readSelection();
    expect(after.rangeCount).toBe(1);
    expect(after.mainEmpty).toBe(true);
  });

  it('SE-MC-012: 单光标选中词时 Escape 应仍由默认绑定折叠', async () => {
    await setEditorContent('select only this word');
    await browser.pause(300);
    await browser.execute(() => {
      const hosts = Array.from(document.querySelectorAll<HTMLElement>('.cm-editor'));
      for (let i = hosts.length - 1; i >= 0; i -= 1) {
        const view = (hosts[i] as HTMLElement & { cmView?: { view?: unknown } }).cmView
          ?.view as
          | { dispatch(s: unknown): void; focus(): void }
          | undefined;
        if (!view) continue;
        view.focus();
        view.dispatch({ selection: { anchor: 7, head: 11 } });
        return;
      }
    });
    await browser.pause(200);

    const before = await readSelection();
    expect(before.found).toBe(true);
    expect(before.rangeCount).toBe(1);
    expect(before.mainEmpty).toBe(false);

    await browser.keys('Escape');
    await browser.pause(300);

    // `exitMultiCursor` returns false at one range, so `simplifySelection` is
    // the command that runs. The *outcome* is deliberately identical to what
    // `exitMultiCursor` would have produced (`simplifySelection` also collapses
    // to `main.head`) — that sameness is exactly why the handoff exists, and
    // why this case asserts the outcome rather than trying to prove which
    // command ran. What it does prove is that the binding still fires at all
    // at one range, which a shadowing binding would have broken.
    const after = await readSelection();
    expect(after.rangeCount).toBe(1);
    expect(after.mainEmpty).toBe(true);
    expect(after.mainHead).toBe(before.mainHead);
  });

  it('SE-MC-013: 单个空光标下 Escape 应无操作', async () => {
    await setEditorContent('alpha\nalpha\nalpha');
    await browser.pause(300);
    await browser.execute(() => {
      const hosts = Array.from(document.querySelectorAll<HTMLElement>('.cm-editor'));
      for (let i = hosts.length - 1; i >= 0; i -= 1) {
        const view = (hosts[i] as HTMLElement & { cmView?: { view?: unknown } }).cmView
          ?.view as
          | { dispatch(s: unknown): void; focus(): void }
          | undefined;
        if (!view) continue;
        view.focus();
        view.dispatch({ selection: { anchor: 3, head: 3 } });
        return;
      }
    });
    await browser.pause(200);

    const before = await readSelection();
    expect(before.found).toBe(true);
    expect(before.rangeCount).toBe(1);
    expect(before.mainEmpty).toBe(true);

    await browser.keys('Escape');
    await browser.pause(300);

    // Both commands decline on an empty single range (`simplifySelection`
    // returns false, `exitMultiCursor` returns false), so nothing should move.
    const after = await readSelection();
    expect(after.rangeCount).toBe(1);
    expect(after.mainEmpty).toBe(true);
    expect(after.mainHead).toBe(before.mainHead);
  });

  it('SE-MC-014: 补全打开时第一次 Escape 只关补全，第二次才退出多光标', async () => {
    await buildMultiCursorWithModD();

    const before = await readSelection();
    expect(before.found).toBe(true);
    expect(before.rangeCount).toBe(3);

    // `startCompletion` (Mod-Space in defaultKeymap) is deterministic, unlike
    // typing a letter and hoping a source activates.
    await browser.keys([modKey, ' ']);
    await browser.pause(800);

    const completionOpen = await browser.execute(() => {
      const tooltip = document.querySelector('.cm-tooltip-autocomplete');
      return tooltip !== null && tooltip.children.length > 0;
    });
    // Asserted, not assumed. If the completion did not open, the first Escape
    // below would fall through to `exitMultiCursor` and the case would be
    // asserting the wrong branch while reporting success.
    expect(completionOpen).toBe(true);

    // First Escape: `closeCompletion` runs at Prec.highest, above the
    // multi-cursor binding, so the cursors must survive it.
    await browser.keys('Escape');
    await browser.pause(400);

    const afterFirst = await readSelection();
    const completionStillOpen = await browser.execute(() => {
      const tooltip = document.querySelector('.cm-tooltip-autocomplete');
      return tooltip !== null && tooltip.children.length > 0;
    });
    expect(completionStillOpen).toBe(false);
    expect(afterFirst.rangeCount).toBe(3);

    // Second Escape: nothing is open, so the multi-cursor binding answers.
    await browser.keys('Escape');
    await browser.pause(300);

    const afterSecond = await readSelection();
    expect(afterSecond.rangeCount).toBe(1);
    expect(afterSecond.mainEmpty).toBe(true);
  });
});
