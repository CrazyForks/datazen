/**
 * Multi-cursor extension for CodeMirror 6.
 *
 * Enables multiple selections, Mod+D next occurrence, and rectangular
 * (Alt+drag / Option+drag) selection. Handles keymap priority to avoid breaking
 * CodeMirror's built-in find-next behavior.
 *
 * §Track S5-A step 8, §6.6
 */

import { keymap, rectangularSelection, EditorView } from '@codemirror/view';
import { EditorState, Prec } from '@codemirror/state';
import type { Extension } from '@codemirror/state';
import { selectNextOccurrence } from '@codemirror/search';
import { addCursorAbove, addCursorBelow, copyLineUp, copyLineDown } from '@codemirror/commands';

/**
 * Multi-cursor extension for CodeMirror 6.
 *
 * Enables multiple selections, Mod+D next occurrence, Option+Click multi-cursor,
 * and rectangular (Alt/Option+drag) column selection compatible with macOS Magic Trackpads.
 * Also provides Option+Cmd+Up/Down (Shift+Alt+Up/Down) to insert vertical cursors directly.
 */
export function createMultipleSelectionsExtension(): Extension[] {
  return [
    EditorState.allowMultipleSelections.of(true),
    rectangularSelection({
      eventFilter: (e: MouseEvent) => {
        // Support macOS Option+drag, Shift+Option+drag, and Cmd+Option+drag on Trackpad
        return (
          (e.altKey || (e.altKey && e.shiftKey) || (e.metaKey && e.altKey)) &&
          (e.button === 0 || e.buttons === 1)
        );
      },
    }),
    EditorView.clickAddsSelectionRange.of((e) => e.altKey && !e.shiftKey),
    EditorView.domEventHandlers({
      keydown(e, view) {
        // High-priority direct handler for Mod+D / Cmd+D across macOS WKWebView and web
        if (
          (e.metaKey || e.ctrlKey) &&
          !e.altKey &&
          (e.key === 'd' || e.key === 'D' || e.code === 'KeyD')
        ) {
          const handled = selectNextOccurrence(view);
          if (handled) {
            e.preventDefault();
            e.stopPropagation();
            return true;
          }
        }
        return false;
      },
    }),
    keymap.of([
      {
        key: 'Mod-d',
        run: selectNextOccurrence,
        preventDefault: true,
      },
      {
        key: 'Mod-D',
        run: selectNextOccurrence,
        preventDefault: true,
      },
      {
        key: 'Shift-Mod-d',
        run: selectNextOccurrence,
        preventDefault: true,
      },
      {
        key: 'Shift-Mod-D',
        run: selectNextOccurrence,
        preventDefault: true,
      },
      {
        key: 'Alt-Mod-ArrowUp',
        mac: 'Alt-Cmd-ArrowUp',
        run: addCursorAbove,
        preventDefault: true,
      },
      {
        key: 'Alt-Mod-ArrowDown',
        mac: 'Alt-Cmd-ArrowDown',
        run: addCursorBelow,
        preventDefault: true,
      },
      /*
       * copy line keeps a home now that Option+Shift+Up/Down is multi-cursor.
       *
       * `Mod-Shift-ArrowUp/Down` is free on Windows/Linux, where it is
       * registered as a normal-precedence binding so it can never shadow the
       * editor's own custom shortcuts. On macOS that chord is NOT free:
       * `standardKeymap` owns it as { mac: "Cmd-ArrowUp", shift: selectDocStart },
       * i.e. Cmd+Shift+Up selects to the start of the document. Leaving it
       * alone (no Prec) preserves that core macOS gesture instead of breaking
       * it — hence the mac-only four-modifier fallback below.
       */
      {
        key: 'Mod-Shift-ArrowUp',
        run: copyLineUp,
        preventDefault: true,
      },
      {
        key: 'Mod-Shift-ArrowDown',
        run: copyLineDown,
        preventDefault: true,
      },
      {
        key: 'Alt-Shift-Mod-ArrowUp',
        mac: 'Alt-Shift-Cmd-ArrowUp',
        run: copyLineUp,
        preventDefault: true,
      },
      {
        key: 'Alt-Shift-Mod-ArrowDown',
        mac: 'Alt-Shift-Cmd-ArrowDown',
        run: copyLineDown,
        preventDefault: true,
      },
    ]),
    /*
     * KEYMAP PRECEDENCE — the actual fix for the dead Shift-Alt-Arrow* keys.
     *
     * CodeMirror resolves a keymap by facet precedence first and by
     * registration order within one precedence. This extension is mounted
     * through `compartments.paste.of(...)`, which comes AFTER
     * `createBaseEditorExtensions()` in the SqlEditor extension array, so its
     * plain `keymap.of(...)` above lost every conflict to the defaultKeymap
     * registered in `editorExtensions.ts`.
     *
     * `@codemirror/commands` binds `Shift-Alt-ArrowUp/Down` to
     * `copyLineUp/copyLineDown` with NO platform variant, so the conflict is
     * NOT macOS-only — it exists on every platform.
     *
     * `Prec.high` lifts ONLY these two bindings above defaultKeymap. Raising
     * the whole keymap would also outrank the editor's own custom shortcuts
     * (execute / save / Tab), which this extension must not do.
     */
    Prec.high(
      keymap.of([
        {
          key: 'Shift-Alt-ArrowUp',
          run: addCursorAbove,
          preventDefault: true,
        },
        {
          key: 'Shift-Alt-ArrowDown',
          run: addCursorBelow,
          preventDefault: true,
        },
      ]),
    ),
  ];
}
