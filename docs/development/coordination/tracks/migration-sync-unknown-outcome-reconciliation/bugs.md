# Bugs — Data Sync unknown-outcome reconciliation

## migration-sync-unknown-outcome-reconciliation-BUG-001 — P2

- **Status:** 待修复。
- **Description:** An execution response with outcome unknown correctly sets the Data Sync window's state to unknown, keeps the write fence, and opens an error. The result panel nevertheless shows the green sync.executeDone completion label because its rendering checks only rolledBack.
- **Reproduction:** Run the tester regression named "an explicit unknown execution response never renders a successful completion label" in src/windows/data-sync/__tests__/DataSyncWindow.test.tsx.
- **Observed:** Vitest fails at line 1518. Expected the result panel not to contain sync.executeDone; it contains sync.executeDonesync.reCompare. The completion row also has the success styling.
- **Impact:** A user can see a successful-completion label after the app explicitly says the database commit/rollback outcome is unknown, obscuring whether writes were applied.
- **Evidence:** Independent Vitest run: 45 passed, 1 failed of 46 across DataSyncWindow.test.tsx and MigrationRunHistoryDialog.test.tsx. The failure is reproducible without a database.

## migration-sync-unknown-outcome-reconciliation-BUG-002 — P2

- **Status:** 待定位（生产 IPC 契约与 WDIO/helper 归因尚未确认）。
- **Description:** The four new real-database WDIO cases cannot consume the execution outcome through the raw Tauri IPC helper. The first injected execution reaches an unknown commit outcome, but the WebDriver execute/async invocation fails with the generic not-started error before the spec can proceed to history recovery and the fresh comparison.
- **Reproduction:** With a webdriver .app, private DATAZEN_DATA_DIR, and local PG/MySQL test databases available, run only e2e/specs/data-sync-unknown-outcome.ts using node_modules/.bin/wdio run e2e/wdio.conf.ts --spec e2e/specs/data-sync-unknown-outcome.ts.
- **Observed:** 0 passed / 4 failed. All cases failed at e2e/specs/data-sync-unknown-outcome.ts:197 through invokeBackend; the WDIO trace categorized it as a WebDriver error on execute/async and reported "Execution did not start. Check the plan and endpoint context, then compare again." The same trace records "Commit or rollback could not be confirmed. Compare current data before continuing." followed by repeated not-started responses for the already-used plan. Database authentication/bootstrap succeeded, there were no timeouts, and target readback matched the injected behavior in all four cases (PG/MySQL: 20 after lost_after_commit, 10 after lost_before_commit).
- **Impact:** The required end-to-end recovery journey stops before opening the unknown history item, so this run cannot verify the user-facing fresh-compare path. Repeated attempts were refused as not_started; no old-plan write was replayed.
- **Attribution:** The observed failure is at the raw invoke/WebDriver boundary. Backend history and readback prove that the unknown commit path was reached, but the available error is generic and does not establish whether the production IPC response contract or WDIO/helper retry handling caused the test to reject the result. Do not treat either attribution as confirmed without a targeted follow-up.
- **Cleanup/evidence:** Only this run's unique tables were removed; PG/MySQL fixture catalogs and the worker DB were verified empty. The app and port 4445 were stopped. Sanitized raw WDIO output: /private/tmp/datazen-sync-unknown-outcome-tester-20260924-wdio.log.
