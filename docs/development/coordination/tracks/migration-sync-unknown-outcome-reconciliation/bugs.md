# Bugs — Data Sync unknown-outcome reconciliation

- **Coder follow-up commit:** `d523eb3b` (`fix(sync): clarify unknown result and history outcomes`).

## migration-sync-unknown-outcome-reconciliation-BUG-001 — P2

- **Status:** TEST_PASSED（新鲜 Tester 在候选提交 `efc2866b` 上独立确认）。
- **Description:** An execution response with outcome unknown correctly sets the Data Sync window's state to unknown, keeps the write fence, and opens an error. The result panel nevertheless shows the green sync.executeDone completion label because its rendering checks only rolledBack.
- **Reproduction:** Run the tester regression named "an explicit unknown execution response never renders a successful completion label" in src/windows/data-sync/__tests__/DataSyncWindow.test.tsx.
- **Observed:** Tester regression reproduced the green `sync.executeDone` label and success styling despite `state=unknown` and the active write fence.
- **Impact:** A user can see a successful-completion label after the app explicitly says the database commit/rollback outcome is unknown, obscuring whether writes were applied.
- **Coder change:** Result presentation now branches on explicit `outcome`, uses the existing localized unknown-outcome warning with amber styling, and exposes `role=status`. It leaves the unknown state and write fence untouched.
- **Evidence:** The regression now asserts warning text, no green success label, amber styling, `state=unknown`, and `data-write-outcome-uncertain=true`; the fresh Tester’s two focused Vitest suites pass 51/51.

## migration-sync-unknown-outcome-reconciliation-BUG-002 — P2

- **Status:** TEST_PASSED（根因确认为 E2E 检查竞态；产品 IPC 契约独立验证通过）。
- **Description:** Earlier real-database WDIO attempts timed out after the execution outcome and history replay, which initially looked like an IPC boundary failure. The actual issue was a test race: the journey clicked Next while the Data Sync window was still inspecting table mappings, so the disabled action did not start the compare.
- **Reproduction:** On the old spec, proceed to the objects step and click Next as soon as `data-sync-step=objects`; that step may still have `data-sync-state=inspecting`, leaving the compare summary unopened until the WDIO timeout. The corrected spec waits for inspection to finish and Next to enable.
- **Historical observation:** A prior tester run using the retrying helper reported a generic not-started message and could not attribute whether the Tauri IPC had resolved or rejected. The fresh one-shot run proved the initial execution and old-plan replay independently.
- **Impact:** The missing wait made the test unreliable and prevented it from verifying the user-facing fresh-compare path. No production IPC/reconciliation defect was found; the old plan remained fenced and was never replayed as a write.
- **Attribution:** The initial four-case fresh run showed one resolved unknown and one `not_started` replay per profile in private history, but each case timed out about two minutes later in the UI. A read-only UI diagnostic reproduced the timeout: the test advanced into the objects step while `data-sync-state=inspecting`, clicked disabled Next, and then waited for a summary that could not appear. Inspection finished in 269 ms; Next became enabled. After waiting for that state, the same retained unknown history item reached a fresh compare with the expected `~1` difference and cleared the fence. This is a test synchronization race, not an IPC rejection or product recovery defect.
- **Coder change:** The initial execution and deliberate old-plan replay now use a test-local one-shot IPC observer. It calls the browser IPC once and returns a JSON-string envelope for either the resolved value or native rejection; a rejection fails immediately, while a resolved response still must assert `outcome=unknown` and continue through history, fence, new comparison, and readback. This cannot make a failed outcome pass and cannot retry the old write.
- **Fresh retest:** Added a tester-only wait for both `data-sync-state !== inspecting` and an enabled Next control. The corrected four-case spec passed 4/4. All four one-shot calls resolved `outcome=unknown`; each profile had exactly one unknown and one `not_started` replay. Target readback was 20 after `lost_after_commit` and 10 after `lost_before_commit` for both databases. History reconciliation retained the fence until a successful fresh comparison; summaries showed `~0` after commit and `~1` before commit. No old execution request was retried.
- **Cleanup/evidence:** Removed only the fresh Tester’s uniquely named tables from both PG databases and both MySQL databases; exact catalog probes returned zero matches. The isolated app-data directories were removed after profile/connection cleanup. The app stopped and port 4445 was free. Logs: `/private/tmp/datazen-sync-unknown-outcome-fresh-tester-wdio.log` and `/private/tmp/datazen-sync-unknown-outcome-rerun-wdio.log`.
