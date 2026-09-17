# Editor settings

Phase: READY_FOR_TEST

## Scope and implementation
- Host reads persistent `driverSettings['sql-editor-enhanced'].intentionActions` (legacy `sql-editor-pro` fallback) using strict `=== true`, so absent settings default off.
- Uses the existing generic boolean `settingsContributions` renderer/persistence path. Parent owns the Pro contribution plus English/Chinese labels/help; no duplicate host toggle or new global AppSettings property.
- Per parent inspection of the actual Pro package, lightbulbs are in `createLinterExtensions`, not `createIntentionExtensions`. Added `LinterCompartmentOptions.intentionActions` and live linter compartment memo dependency. Diagnostics, Alt+Enter, INSERT hints, statement gutter and hover settings remain independent. No caret gating added.
- Default execution strategy is `current_statement` in frontend initial/load defaults, Rust fresh-install/serde missing-field defaults, toolbar fallback/label and execution routing fallback. Explicit saved entire-script/current/largest/ask choices remain unchanged.
- E2E bootstrap's explicit whole-script test-session preference is intentionally preserved; it is not an application default.

## Validation
- PASS: focused Vitest suite: 11 files, 104 tests. Files: SqlEditorIntentionSettingsJourney, SqlEditorLifecycle, editorHotplug, epHotplugJourney, settingsStore, SettingsContent, ExecutionStrategySelect, resolveExecutionTarget, useQueryExecutionGate, queryExecutionJourney, settingsExport.
- New journeys cover generic UI off/on/off and persisted sibling preservation; editor EP off/on/off for both canonical and legacy settings IDs, document/cursor/undo preservation and independent diagnostics/hints; initial/missing execution mode and explicit toolbar changes; settings reload/save and each explicit execution strategy.
- PASS: `npx tsc --noEmit`.
- PASS: `CARGO_TARGET_DIR=target/cargo-wt cargo test -p datazen --lib store::tests::` — 64 passed, 2 OS-keychain-dependent tests ignored, 0 failed.
- Rust first attempt failed because ignored `src-tauri/resources/builtin-ep` was absent in this worktree. Created empty worktree-local directory and reran successfully. Cargo's unrelated lockfile edit was restored.
- PASS: scoped Prettier/rustfmt and `git diff --check`.

## Three-dimensional self-review
1. Lightbulb opt-in reaches its actual Pro compartment and default execution no longer runs the whole script implicitly.
2. Other enhancements and explicit execution modes remain intact; existing hotplug and routing regressions pass.
3. Live toggles preserve typing/caret/undo and toolbar mode changes remain immediately reflected.

## Handoff / limitations
- Coding commit: recorded in the subsequent handoff entry after commit creation.
- Independent Tester must verify before marking PASSED.
- Host tests use a small EP implementation to observe the real compartment contract; visual lightbulb/menu behavior and translated Pro contribution require the parent's separate Pro implementation/integration validation.
- No desktop/WebDriver E2E run; no main checkout, Pro source, generated files or hub.md modified; no pnpm install.
