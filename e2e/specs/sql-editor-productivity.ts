import { expect, browser, $ } from '@wdio/globals';
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
 * SQL Editor Productivity — Host-owned editor gestures.
 *
 * Every case here is **Community** behaviour: Mod+D, multi-cursor and
 * rectangular selection come from `paste/multipleSelections.ts`, which reaches
 * `@codemirror/search` directly and holds zero references to
 * `sqlEditorEnhancedEP`. Run on any build:
 * `pnpm tauri:build:webdriver` → `pnpm e2e:sql-editor-prod`.
 *
 * The paste-as-IN and schema-tree drop cases used to live here. They are Pro
 * capabilities — `paste/createPasteExtensions.ts` returns
 * `enhanced.createPasteExtensions?.(opts) ?? []`, so on Community neither the
 * clipboard read nor the drop handler is installed. They now live in
 * `packages/pro-extensions/sql-editor-pro/e2e/specs/sql-editor-productivity.ts`
 * (SE-PROD-001..004, SE-PROD-010) and assert exact documents.
 *
 * Requires a PostgreSQL connection (seeded by wdio.conf.ts).
 *
 * Uses Host generic behavior — no specific database dialect assertions.
 */
describe('SQL Editor 生产力功能 (SE-PROD)', () => {
  let mainWindow: string;
  const connId = 'e2e_pg_sql_prod';
  const connName = 'E2E-PostgreSQL-Prod';

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
        colorTag: 'orange',
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

  after(async () => {
    try {
      await closeExtraWindows(mainWindow);
      await invokeBackend('delete_connection', { id: connId });
    } catch {
      /* cleanup best-effort */
    }
  });

  // ── 多光标 / 矩形选择的取状态辅助 ──────────────────────────────────
  //
  // 这些辅助集中放在这里，因为 SE-PROD-030/031/040 与文件其余部分共享同一套
  // 约束（见下）。它们刻意返回 `false` 而非静默跳过：一次没落地的点击必须让
  // 用例变红，而不是让它对着「什么都没发生」的状态通过。
  //
  // 为什么驱动真实的 mousedown/mousemove/mouseup：
  // `EditorView.clickAddsSelectionRange` 由 `MouseSelection` 的**构造函数**从
  // mousedown 读取：`handlers.mousedown`（@codemirror/view dist/index.js:4967）把
  // 事件作为 startEvent 交给构造函数，构造函数内第 4753 行求值
  // `this.multiple = view.state.facet(EditorState.allowMultipleSelections) &&
  // addsSelectionRange(view, startEvent)`。派发一个 `click` 事件永远走不到这里——
  // 那正是 SE-PROD-030 原先的写法，它断言的分支一次都没被执行过。
  //
  // 同一构造函数第 4750-4751 行把 mousemove / mouseup 注册到
  // `view.contentDOM.ownerDocument` 上，所以本文件的手势辅助必须在 contentDOM 上
  // 派发 mousedown、而在 document 上派发后两个事件。
  //
  // 为什么 detail: 1 是必须的：
  // `getClickType` 在行为正常的浏览器上直接返回 `event.detail`。合成事件若留在
  // 默认的 `detail: 0`，会被当成多击序列的起点，把手势变成按词/按行选择，
  // 于是「加了光标」被误测成「选了词」。
  //
  // 为什么坐标从 .cm-line 自己的 rect 推导：
  // 固定视口坐标（x: 50, y: 100）会随视口、缩放或字体变化而静默命中另一行，
  // 那样用例仍然通过，却测的是别的东西。

  //
  // 注意：`browser.execute(fn, args)` 会把 fn 序列化后在页面里执行，因此它
  // **不能**闭包捕获本文件的任何变量。后面三个辅助里重复的 Range 遍历代码是
  // 这个限制的必然结果，不是重复劳动——把它们提到模块级反而会在页面里变成
  // 未定义引用。

  /**
   * Sends a complete primary-button gesture: mousedown on the editor's
   * `contentDOM`, then mousemove/mouseup on `document` — which is where
   * `MouseSelection` registers the drag listeners.
   *
   * Returns false when a named line is not rendered or has no owning editor,
   * so the caller can assert on it instead of testing a gesture that never landed.
   */
  const gesture = (
    fromLineText: string,
    fromChar: number,
    toLineText: string | null,
    toChar: number | null,
    mods: { altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean },
  ): Promise<boolean> =>
    browser.execute(
      (args: {
        fromLineText: string;
        fromChar: number;
        toLineText: string | null;
        toChar: number | null;
        mods: Record<string, boolean>;
      }): boolean => {
        const lineFor = (text: string): HTMLElement | undefined =>
          Array.from(document.querySelectorAll<HTMLElement>('.cm-line')).find(
            (el) => text.length > 0 && (el.textContent || '').includes(text),
          );
        const fromLine = lineFor(args.fromLineText);
        if (!fromLine) return false;
        // A null target line means "release where we pressed" — that is a click.
        const toLine = args.toLineText === null ? fromLine : lineFor(args.toLineText);
        if (!toLine) return false;

        const range = document.createRange();
        const charRect = (line: HTMLElement, charIndex: number): DOMRect | null => {
          let remaining = charIndex;
          let out: DOMRect | null = null;
          const visit = (node: Node): boolean => {
            if (node.nodeType === Node.TEXT_NODE) {
              const len = node.textContent?.length ?? 0;
              if (remaining <= len) {
                range.setStart(node, Math.max(0, Math.min(remaining, len)));
                range.setEnd(node, Math.max(0, Math.min(remaining + 1, len)));
                out = range.getBoundingClientRect();
                return true;
              }
              remaining -= len;
              return false;
            }
            for (let i = 0; i < node.childNodes.length; i += 1) {
              if (visit(node.childNodes[i])) return true;
            }
            return false;
          };
          if (!visit(line)) return null;
          return out;
        };

        const start = charRect(fromLine, args.fromChar);
        if (!start) return false;
        const end = args.toChar === null ? start : charRect(toLine, args.toChar);
        if (!end) return false;

        // Walk up to the editor that owns the start line so mousedown lands on
        // its contentDOM, the element CodeMirror's mousedown handler reads.
        type View = {
          state: unknown;
          dispatch(s: unknown): void;
          focus(): void;
          contentDOM: HTMLElement;
        };
        let contentDOM: HTMLElement | null = null;
        let node: HTMLElement | null = fromLine;
        while (node && !contentDOM) {
          const host = node.closest<HTMLElement>('.cm-editor');
          const view = (host as (HTMLElement & { cmView?: { view?: View } }) | null)?.cmView?.view;
          if (view?.contentDOM) contentDOM = view.contentDOM;
          node = node.parentElement;
        }
        if (!contentDOM) return false;

        const at = (rect: DOMRect): MouseEventInit => ({
          bubbles: true,
          cancelable: true,
          button: 0,
          detail: 1,
          clientX: rect.left + 1,
          clientY: rect.top + rect.height / 2,
          ...args.mods,
        });
        const startInit = at(start);
        const endInit = at(end);
        contentDOM.dispatchEvent(new MouseEvent('mousedown', { ...startInit, buttons: 1 }));
        if (args.toChar !== null) {
          document.dispatchEvent(new MouseEvent('mousemove', { ...endInit, buttons: 1 }));
        }
        document.dispatchEvent(new MouseEvent('mouseup', { ...endInit, buttons: 0 }));
        return true;
      },
      {
        fromLineText,
        fromChar,
        toLineText,
        toChar,
        mods: mods as Record<string, boolean>,
      },
    );

  /**
   * Reads the current multi-cursor state, plus the line number each range starts
   * and ends on. `ranges` is `[]` when no editor is mounted at all, which the
   * assertions treat as a failure rather than an empty success.
   */
  const readSelection = (): Promise<{
    rangeCount: number;
    ranges: { from: number; to: number; fromLine: number; toLine: number }[];
    doc: string;
    mounted: boolean;
  }> =>
    browser.execute(
      (): {
        rangeCount: number;
        ranges: { from: number; to: number; fromLine: number; toLine: number }[];
        doc: string;
        mounted: boolean;
      } => {
        const empty = {
          rangeCount: 0,
          ranges: [],
          doc: '',
          mounted: false,
        };
        const view = Array.from(document.querySelectorAll<HTMLElement>('.cm-editor'))
          .map((el) => (el as HTMLElement & { cmView?: { view?: unknown } }).cmView?.view)
          .find((v) => Boolean(v)) as
          | {
              state: {
                doc: { toString(): string; lineAt(p: number): { number: number } };
                selection: { ranges: readonly { from: number; to: number }[] };
              };
            }
          | undefined;
        if (!view) return empty;
        const { doc, selection } = view.state;
        return {
          rangeCount: selection.ranges.length,
          ranges: selection.ranges.map((r) => ({
            from: r.from,
            to: r.to,
            fromLine: doc.lineAt(r.from).number,
            toLine: doc.lineAt(r.to).number,
          })),
          doc: doc.toString(),
          mounted: true,
        };
      },
    );

  // ── Mod+D 下一个匹配 ──────────────────────────────────────────

  it('SE-PROD-020: Mod+D 应选择下一个匹配项', async () => {
    await setEditorContent('SELECT test_col, test_col, test_col FROM t');
    // Same stale-doc race as SE-PROD-021 (latent here — this case passed the
    // failing run only by timing luck): setEditorContent writes through the DOM
    // while CodeMirror's state document syncs asynchronously. Dispatching the
    // selection against a stale doc silently finds no 'test_col' (indexOf === -1
    // → the dispatch below is skipped) and leaves a collapsed cursor, so Mod+D
    // would select nothing. Wait for the observable state instead of a fixed
    // pause. [tester]
    await browser.waitUntil(
      async () =>
        await browser.execute(() => {
          const editors = Array.from(document.querySelectorAll('.cm-editor'));
          for (let i = editors.length - 1; i >= 0; i--) {
            const view = (editors[i] as any)?.cmView?.view;
            if (
              view &&
              view.state.doc.toString().includes('SELECT test_col, test_col, test_col FROM t')
            )
              return true;
          }
          return false;
        }),
      { timeout: 5000, timeoutMsg: 'editor state doc did not sync to SE-PROD-020 content' },
    );

    // Select the first 'test_col'
    await browser.execute(() => {
      const editors = Array.from(document.querySelectorAll('.cm-editor'));
      let cmView: any = null;
      for (let i = editors.length - 1; i >= 0; i--) {
        if ((editors[i] as any)?.cmView?.view) {
          cmView = (editors[i] as any).cmView.view;
          break;
        }
      }
      if (!cmView) return;
      cmView.focus();
      const doc = cmView.state.doc.toString();
      const idx = doc.indexOf('test_col');
      if (idx >= 0) {
        cmView.dispatch({ selection: { anchor: idx, head: idx + 8 } });
      }
    });
    // Confirm the initial selection dispatch actually landed before pressing
    // Mod+D — otherwise the key press would act on a collapsed cursor. [tester]
    await browser.waitUntil(
      async () =>
        await browser.execute(() => {
          const editors = Array.from(document.querySelectorAll('.cm-editor'));
          for (let i = editors.length - 1; i >= 0; i--) {
            const view = (editors[i] as any)?.cmView?.view;
            if (!view) continue;
            const ranges = view.state.selection.ranges;
            if (ranges.length !== 1) continue;
            return view.state.doc.sliceString(ranges[0].from, ranges[0].to) === 'test_col';
          }
          return false;
        }),
      { timeout: 5000, timeoutMsg: 'initial test_col selection did not land for SE-PROD-020' },
    );

    // Press Mod+d to select next occurrence
    await browser.keys(['Meta', 'd']);
    await browser.pause(300);

    // Check if multiple selections exist
    const selectionCount = await browser.execute(() => {
      const editors = Array.from(document.querySelectorAll('.cm-editor'));
      let cmView: any = null;
      for (let i = editors.length - 1; i >= 0; i--) {
        if ((editors[i] as any)?.cmView?.view) {
          cmView = (editors[i] as any).cmView.view;
          break;
        }
      }
      if (!cmView) return 1;
      return cmView.state.selection.ranges.length;
    });
    expect(selectionCount).toBeGreaterThanOrEqual(2);

    await captureJourneyStep('mod-d-next-occurrence');
  });

  it('SE-PROD-021: 多次 Mod+D 应选择所有匹配项', async () => {
    const getRangeCount = () =>
      browser.execute(() => {
        const editors = Array.from(document.querySelectorAll('.cm-editor'));
        let cmView: any = null;
        for (let i = editors.length - 1; i >= 0; i--) {
          if ((editors[i] as any)?.cmView?.view) {
            cmView = (editors[i] as any).cmView.view;
            break;
          }
        }
        if (!cmView) return 1;
        return cmView.state.selection.ranges.length;
      });

    const selectFirstFoo = () =>
      browser.execute(() => {
        const editors = Array.from(document.querySelectorAll('.cm-editor'));
        let cmView: any = null;
        for (let i = editors.length - 1; i >= 0; i--) {
          if ((editors[i] as any)?.cmView?.view) {
            cmView = (editors[i] as any).cmView.view;
            break;
          }
        }
        if (!cmView) return false;
        cmView.focus();
        const doc = cmView.state.doc.toString();
        const idx = doc.indexOf('foo');
        if (idx < 0) return false;
        cmView.dispatch({ selection: { anchor: idx, head: idx + 3 } });
        return true;
      });

    await setEditorContent('foo bar foo bar foo bar');
    // setEditorContent writes through the DOM while the CodeMirror state
    // document syncs asynchronously. Dispatching the selection against a
    // stale doc silently finds no 'foo', leaves a collapsed cursor at the end
    // of the document, and Mod+D then selects nothing — the observed
    // "Expected >= 3, Received 1" (SE-PROD-020 passed only by timing luck).
    await browser.waitUntil(
      async () =>
        await browser.execute(() => {
          const editors = Array.from(document.querySelectorAll('.cm-editor'));
          for (let i = editors.length - 1; i >= 0; i--) {
            const view = (editors[i] as any)?.cmView?.view;
            if (view && view.state.doc.toString().includes('foo bar foo bar foo bar')) return true;
          }
          return false;
        }),
      { timeout: 5000, timeoutMsg: 'editor state doc did not sync to SE-PROD-021 content' },
    );

    await selectFirstFoo();
    await browser.waitUntil(
      async () =>
        await browser.execute(() => {
          const editors = Array.from(document.querySelectorAll('.cm-editor'));
          for (let i = editors.length - 1; i >= 0; i--) {
            const view = (editors[i] as any)?.cmView?.view;
            if (!view) continue;
            const ranges = view.state.selection.ranges;
            if (ranges.length !== 1) continue;
            const text = view.state.doc.sliceString(ranges[0].from, ranges[0].to);
            if (text === 'foo') return true;
          }
          return false;
        }),
      { timeout: 5000, timeoutMsg: 'selection did not land on the first foo' },
    );

    // Press Mod+D until all three occurrences are selected (bounded). If the
    // selection collapses mid-way (focus steal), re-establish it once — the
    // final assertion is unchanged, so a genuinely broken keybinding still
    // fails this test.
    for (let attempt = 0; attempt < 4; attempt++) {
      const count = await getRangeCount();
      if (count >= 3) break;
      await browser.keys(['Meta', 'd']);
      await browser.pause(250);
      if (attempt === 1 && (await getRangeCount()) < 2) {
        await selectFirstFoo();
      }
    }

    const selectionCount = await getRangeCount();
    expect(selectionCount).toBeGreaterThanOrEqual(3);
  });

  it('SE-PROD-022: Mod+D 在无选区时应无效', async () => {
    await setEditorContent('hello world');
    await browser.pause(300);

    // Place cursor without selection
    await browser.execute(() => {
      const cmView = (document.querySelector('.cm-editor') as any)?.cmView?.view;
      if (!cmView) return;
      cmView.dispatch({ selection: { anchor: 0, head: 0 } });
    });
    await browser.pause(200);

    await browser.keys(['Meta', 'D']);
    await browser.pause(300);

    const selectionCount = await browser.execute(() => {
      const cmView = (document.querySelector('.cm-editor') as any)?.cmView?.view;
      if (!cmView) return 1;
      return cmView.state.selection.ranges.length;
    });
    // Should still have only one selection (no-op)
    expect(selectionCount).toBe(1);
  });

  // ── 多光标 ─────────────────────────────────────────────────────

  it('SE-PROD-030: Alt+Click 应添加多光标', async () => {
    await setEditorContent('line one\nline two\nline three');
    await browser.pause(300);

    // Put one cursor on line one, so the Alt+click below has something to add to.
    const seeded = await gesture('line one', 0, null, null, {});
    expect(seeded).toBe(true);
    await browser.pause(200);
    const before = await readSelection();
    expect(before.mounted).toBe(true);
    expect(before.rangeCount).toBe(1);

    // Alt+click on line two must ADD a second cursor.
    const landed = await gesture('line two', 0, null, null, { altKey: true });
    expect(landed).toBe(true);
    await browser.pause(300);

    const after = await readSelection();
    // Exactly two. This used to assert `toBeGreaterThanOrEqual(1)`, which the
    // single cursor left behind by the never-dispatched mousedown satisfied.
    expect(after.rangeCount).toBe(2);
    // "Add" has to mean add: the original cursor survives, and neither range may
    // have become a word or line selection. A non-empty range here means the
    // gesture was read as a multi-click instead of an Alt+click.
    const byLine = [...after.ranges].sort((a, b) => a.fromLine - b.fromLine);
    expect(byLine.map((r) => r.fromLine)).toEqual([1, 2]);
    expect(byLine.map((r) => r.from === r.to)).toEqual([true, true]);

    await captureJourneyStep('multi-cursor-alt-click');
  });

  it('SE-PROD-031: 多光标输入应同时编辑多行', async () => {
    await setEditorContent('aaa\naaa\naaa');
    await browser.pause(300);

    // Drag-select the first 'aaa', then pull in the other two with Mod+D.
    // `Meta` is the modifier convention the rest of this suite already uses
    // (SE-PROD-021, hotkeys.ts); WebdriverIO has no portable `Mod` key. All three
    // lines are identical, so `gesture` deterministically resolves to the first.
    const seeded = await gesture('aaa', 0, 'aaa', 3, {});
    expect(seeded).toBe(true);
    await browser.pause(200);
    await browser.keys(['Meta', 'D']);
    await browser.pause(200);
    await browser.keys(['Meta', 'D']);
    await browser.pause(200);

    // Precondition: one cursor per line. Checked before typing, so a broken
    // Mod+D is reported as a Mod+D failure rather than as a typing failure.
    const cursors = await readSelection();
    expect(cursors.rangeCount).toBe(3);

    await browser.execute(() => {
      const el = document.querySelector<HTMLElement>('.cm-editor .cm-content');
      el?.focus();
    });
    await browser.keys('bbb');
    await browser.pause(300);

    // The observable is the document, read from editor state rather than from
    // `.cm-content` textContent: CodeMirror renders only the visible window, so
    // the DOM text is not the document. This case used to assert
    // `expect(typeof allReplaced).toBe('boolean')` over `!includes('aaa') &&
    // includes('bbb')` — a `&&` of two booleans, so no input could ever fail it.
    const after = await readSelection();
    expect(after.doc).toBe('bbb\nbbb\nbbb');
  });

  // ── 矩形选择 ───────────────────────────────────────────────────

  it('SE-PROD-040: Alt+拖动应创建矩形选择', async () => {
    await setEditorContent('col_a col_b col_c\nval_1 val_2 val_3');
    await browser.pause(300);

    // A real Alt+drag from the start of line 1 down to the same column on line 2.
    // This case used to dispatch an ordinary `{anchor, head}` range and then
    // assert `not.toBeNull()` on `state.selection`, which is never null — so the
    // rectangular gesture was never performed and nothing could ever fail.
    const landed = await gesture('col_a', 0, 'val_1', 3, { altKey: true });
    expect(landed).toBe(true);
    await browser.pause(300);

    const after = await readSelection();
    const byLine = [...after.ranges].sort((a, b) => a.fromLine - b.fromLine);
    // One range per line touched. A plain drag produces a single range spanning
    // the newline, so this count alone already rules that out.
    expect(after.rangeCount).toBe(2);
    expect(byLine.map((r) => r.fromLine)).toEqual([1, 2]);
    // The rectangular invariant proper: no range crosses a line break. This is
    // the one property an ordinary cross-line selection cannot fake.
    expect(byLine.map((r) => r.fromLine === r.toLine)).toEqual([true, true]);
    // And the covered text is the same column on both rows. The fixture keeps
    // the two rows the same width so this stays an exact slice.
    expect(byLine.map((r) => after.doc.slice(r.from, r.to))).toEqual(['col', 'val']);

    await captureJourneyStep('rectangular-selection');
  });
});
