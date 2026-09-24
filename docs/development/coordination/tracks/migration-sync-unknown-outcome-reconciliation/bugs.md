# Bugs — Data Sync unknown-outcome reconciliation

- **Coder follow-up commit:** `d523eb3b` (`fix(sync): clarify unknown result and history outcomes`).

## migration-sync-unknown-outcome-reconciliation-BUG-001 — P2

- **Status:** READY_FOR_RETEST（Coder 修复候选，尚未由独立 Tester 确认）。
- **Description:** An execution response with outcome unknown correctly sets the Data Sync window's state to unknown, keeps the write fence, and opens an error. The result panel nevertheless shows the green sync.executeDone completion label because its rendering checks only rolledBack.
- **Reproduction:** Run the tester regression named "an explicit unknown execution response never renders a successful completion label" in src/windows/data-sync/__tests__/DataSyncWindow.test.tsx.
- **Observed:** Tester regression reproduced the green `sync.executeDone` label and success styling despite `state=unknown` and the active write fence.
- **Impact:** A user can see a successful-completion label after the app explicitly says the database commit/rollback outcome is unknown, obscuring whether writes were applied.
- **Coder change:** Result presentation now branches on explicit `outcome`, uses the existing localized unknown-outcome warning with amber styling, and exposes `role=status`. It leaves the unknown state and write fence untouched.
- **Evidence:** The regression now asserts warning text, no green success label, amber styling, `state=unknown`, and `data-write-outcome-uncertain=true`; the two focused Vitest suites pass 48/48.

## migration-sync-unknown-outcome-reconciliation-BUG-002 — P2

- **Status:** READY_FOR_RETEST（根因归因仍未确认；不得标记 PASSED）。
- **Description:** The four new real-database WDIO cases cannot consume the execution outcome through the raw Tauri IPC helper. The first injected execution reaches an unknown commit outcome, but the WebDriver execute/async invocation fails with the generic not-started error before the spec can proceed to history recovery and the fresh comparison.
- **Reproduction:** With a fresh webdriver app, private `DATAZEN_DATA_DIR`, and local PG/MySQL test databases, run only `e2e/specs/data-sync-unknown-outcome.ts` using the WDIO runner.
- **Observed:** 0 passed / 4 failed. All cases failed at e2e/specs/data-sync-unknown-outcome.ts:197 through invokeBackend; the WDIO trace categorized it as a WebDriver error on execute/async and reported "Execution did not start. Check the plan and endpoint context, then compare again." The same trace records "Commit or rollback could not be confirmed. Compare current data before continuing." followed by repeated not-started responses for the already-used plan. Database authentication/bootstrap succeeded, there were no timeouts, and target readback matched the injected behavior in all four cases (PG/MySQL: 20 after lost_after_commit, 10 after lost_before_commit).
- **Impact:** The required end-to-end recovery journey stops before opening the unknown history item, so this run cannot verify the user-facing fresh-compare path. Repeated attempts were refused as not_started; no old-plan write was replayed.
- **Attribution:** Still unconfirmed. The Tester app was built at 2026-09-24 14:04 from Tester worktree HEAD `68c881e5`; its production command source matches this branch's `1ded6911` implementation, so stale build/revision is not supported by current evidence. In source, `execute_data_sync` converts outcome errors to `DataSyncExecutionResponse` and returns `Ok(response)`, whose flattened JSON has `outcome` and an `error` field. The log shows unknown text followed by repeated not-started results, but does not prove whether Tauri resolved that payload or rejected the invoke.
- **Coder change:** The initial execution and deliberate old-plan replay now use a test-local one-shot IPC observer. It calls the browser IPC once and returns a JSON-string envelope for either the resolved value or native rejection; a rejection fails immediately, while a resolved response still must assert `outcome=unknown` and continue through history, fence, new comparison, and readback. This cannot make a failed outcome pass and cannot retry the old write.
- **Retest required:** Run all four PG/MySQL fault cases with the one-shot observer. Record whether the first call resolves to the structured unknown payload or rejects; verify only one unknown initial history run, explicit replay is `not_started`, expected target values stay 20/10, history action keeps the fence, and a fresh compare completes. If the observer reports rejection or the journey still fails, preserve BUG-002 as unresolved and report the actual IPC boundary; do not infer row-level outcomes.
- **Cleanup/evidence:** Only this run's unique tables were removed; PG/MySQL fixture catalogs and the worker DB were verified empty. The app and port 4445 were stopped. Sanitized raw WDIO output: /private/tmp/datazen-sync-unknown-outcome-tester-20260924-wdio.log.
