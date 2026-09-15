# migration-sync-core independent test findings

## migration-sync-core-BUG-001 — Unknown outcome unlocked by cancelled comparison (P1)

- 状态：已修复（独立复测通过）
- Reproduction: execute selected changes; lose commit response; return from preview to comparison; start a new comparison; cancel it; advance to preview.
- Actual: `handleCompare` replaces unknown with comparing; `handleCancel` sees retained mappingResults and sets compared. The stale reviewed changes become executable without a successful fresh comparison. The next write may repeat an already committed transaction.
- Evidence: `[tester] cancelling a fresh comparison must not unlock an unknown write outcome` fails at DataSyncWindow.test.tsx:823: expected no data-sync-start, received enabled Execute button. Existing execute call count remains 1 before retry.
- Impact: every supported driver; source/target mappings and rows retained after uncertain execution. Preserve an independent invalidation fence until a successful fresh comparison, including failed/cancelled inspection/comparison paths.
- Fix: execution now raises an independent `writeOutcomeUncertain` fence. Back navigation, a cancelled or failed inspection/comparison, and preview navigation cannot clear it or re-enable Execute. Only a successful fresh comparison clears the fence; an in-flight write remains non-cancellable until its outcome is known.
- Regression evidence: the original failing continuous journey now proves Unknown → back → compare → cancel → preview remains blocked, then proves a later successful comparison alone restores execution. Additional journeys cover failed inspection, failed comparison, string-valued IPC rejection, and cancellation while a write is pending.

## migration-sync-core-BUG-002 — Binary SQL preview corrupts bytes (P1 export correctness)

- 状态：已修复（独立复测通过）
- Reproduction: generate INSERT preview with Value::Bytes([0,255,254]).
- Actual: sql.rs format_literal converts with from_utf8_lossy, producing replacement characters and a literal NUL. Copied SQL cannot round-trip original bytes.
- Evidence: `test_tester_binary_preview_never_replaces_bytes_with_unicode` fails: `binary SQL preview is lossy: INSERT INTO "target" ("id", "payload") VALUES (1, '<NUL>��')`.
- Scope: SQL preview/copy/export; test confirms typed parameters still retain [0,255,254], so this evidence does NOT prove the normal parameterized execution corrupts bytes. Driver-owned binary literal rendering or honest non-executable parameter display is required.
- Fix: the generic fallback no longer decodes arbitrary bytes as UTF-8. It emits an explicit non-executable marker, while the command path delegates preview rendering to the target `SyncTargetAdapter`: PostgreSQL renders `bytea` as `'\\x00fffe'`, MySQL renders binary data as `X'00fffe'`. Typed parameters remain byte-for-byte unchanged.
- Regression evidence: the original lossy-preview test passes, and a command-level test checks both PostgreSQL and MySQL driver-owned literals, absence of NUL/U+FFFD, and exact `Value::Bytes([0, 255, 254])` parameters.

## Shared driver dependency retained for integration regression

- An exploratory real-database binary extension was intentionally removed from this track's executable E2E because its failures are in shared driver decode/binding code owned by the pending Transfer track, outside this rescue boundary. The failing evidence is retained here and must become a real PostgreSQL/MySQL binary matrix again after that driver work merges.
- PostgreSQL actual failure: `execution failed after 1 statements: Query failed: error returned from database: column "payload" is of type bytea but expression is of type text`. `Value::Bytes` is currently bound as text on that path.
- MySQL actual failure: the source BLOB is decoded as `NULL`, producing preview SQL `INSERT ... payload) VALUES (2, 30, 40, NULL)` instead of a binary literal.
- These failures do not invalidate BUG-002's preview repair: the driver-aware preview contract and exact typed parameter are covered in unit/command tests. They do block claiming binary real-database round-trip support until the shared driver fixes are integrated and the matrix is restored.

## Validation gates after rescue

- Frontend five changed business modules after the BUG-004/005 repair: lines 85.42%, statements 83.55%, branches 80.73%, functions 85.63%. The required branch gate remains satisfied with continuous state-machine and mapping journeys.
- Rust instrumented percentage was not measured; 101 passing sync tests plus 22 passing command tests and actual PostgreSQL/MySQL journeys provide path evidence, not a numerical coverage claim.
- Required real-database canonical projection/selection journeys pass 2/2 on PostgreSQL and MySQL after the rescue build.
- Integer-only keys and 10k-diff/32MiB table/64MiB result limits remain wave1 guardrails, not Navicat parity. Shared immutable plans, normalized ordering, bounded ComparisonStore, conflict checks remain later wave work.

## migration-sync-core-BUG-003 — Cancel IPC race clears the unknown-write fence (P1)

- 状态：已修复（独立复测通过）
- Reproduction: enter Unknown after losing the execute/commit response; go back and start a fresh comparison; click Cancel; hold the `cancel_data_sync` response pending; let the comparison resolve successfully before the cancel response; then resolve cancellation.
- Actual: `handleCancel` increments `compareGenerationRef` only after `await cancelDataSync(jobId)`. The comparison therefore remains current long enough to run `setWriteOutcomeUncertain(false)`. When cancellation finishes, the visible state returns to `unknown`, but `data-write-outcome-uncertain` is false. Preview can expose Execute for the stale mapping, and `runExecute` sees the same false fence, allowing a duplicate write after an unknown commit result.
- Evidence: `[tester] invalidates a comparison before awaiting the cancel response` fails at `DataSyncWindow.test.tsx:900`: expected `data-write-outcome-uncertain="true"`, received `"false"`. Full frontend result is 7 files, 39 passed and 1 failed.
- Impact: every supported sync driver when cancellation IPC and comparison completion interleave. The database cancel flag is set quickly in normal local runs, but the frontend correctness contract must not depend on IPC latency or event-loop ordering.
- Required fix: synchronously invalidate the active compare generation and preserve/set the independent unknown-write fence before awaiting cancellation. Completion and cancellation handlers must verify the active generation before clearing or transitioning state. Keep both the Execute button and `runExecute` gated by the fence.
- Required regression: retain the delayed-cancel continuous journey, then rerun the complete Rust, frontend, coverage, required WebDriver build and isolated PostgreSQL/MySQL matrix with a fresh Tester.
- Fix: `handleCancel` now increments `compareGenerationRef` and preserves the unknown-write fence synchronously, before the cancellation IPC begins. On return it verifies that the cancellation still owns the active generation, and clears `jobIdRef` only when it still refers to the cancelled job. Existing inspection/comparison completion handlers already reject stale generations, so a superseded async completion cannot clear the fence or transition current UI state.
- Regression evidence: the deterministic delayed-cancel journey passes; the complete frontend suite is 40/40, TypeScript passes, injected Rust remains 101/101 plus 22/22, and the frontend branch gate remains above 80%.

## migration-sync-core-BUG-004 — Compare cancellation remains busy until IPC returns (P1 liveness)

- 状态：已修复（独立复测通过）
- Reproduction: after an unknown write outcome, start a fresh comparison, click Cancel, hold `cancel_data_sync` pending, then let the invalidated comparison request return. The workflow returns to the Objects step, but the cancel response remains pending.
- Actual: the stale comparison correctly fails its generation check, but `handleCancel` does not leave `comparing` until after the cancellation IPC resolves. The Objects step therefore has a disabled Next button and disabled Back button. A delayed or lost cancel response permanently blocks the wizard, so no fresh comparison can clear the unknown-write fence. The same state prevents verifying that the stale cancellation preserves the newer comparison job id because a newer comparison cannot start.
- Evidence: `[tester] lets a fresh comparison win while an older cancel response is delayed` times out at `DataSyncWindow.test.tsx:949` waiting for `data-sync-summary`; `[tester] a stale cancel response never clears the newer comparison job id` times out at line 995 waiting for the new comparison cancel control. At both failures the DOM reports `data-sync-step="objects"`, `data-sync-state="comparing"`, and disabled navigation. Full frontend result: 7 files, 40 passed and 3 failed.
- Impact: every supported sync driver when cancellation IPC is slow, blocked, or its response is lost. The user cannot recover inside the wizard and cannot perform the mandatory fresh comparison after an uncertain write.
- Required fix: for comparison/inspection cancellation, invalidate the generation and transition to the stable fenced state synchronously before awaiting IPC. Treat the captured job id as the cancellation target, and let the eventual response perform only ownership-checked cleanup; it must not overwrite a newer comparison state or clear its job id. Preserve the separate wait-for-transaction behavior for an in-flight write.
- Required regression: retain both Tester journeys. Prove a fresh comparison can succeed while the older cancellation response is pending, its fresh mapping is the only executable mapping, and a pending newer comparison can still cancel using its own job id after the older response arrives.
- Fix: cancellation now captures the active job id and operation kind, marks that job cancelled, invalidates the comparison generation, and transitions comparison/generation UI to a stable state before the IPC await. A later response can only clean up when generation, job id and operation kind still match; a newer comparison owns its own job throughout.
- Regression evidence: both delayed-response journeys pass. The first executes only the fresh key `[9]`; the second proves the newer comparison remains cancellable with its own job id after the old cancellation returns.

## migration-sync-core-BUG-005 — Late execution-cancel response overwrites success (P1 state correctness)

- 状态：已修复（独立复测通过）
- Reproduction: start execution, click Cancel while `execute_data_sync` is pending, hold the cancel response, then let execution and its verification comparison complete successfully before resolving cancellation.
- Actual: execution reaches the Result step with `done`, but the old `handleCancel` resumes after `writeInFlightRef` becomes false and changes the current state to `compared` plus `sync.compareCancelled`. This replaces a confirmed successful outcome with a false cancellation result.
- Evidence: `[tester] a delayed execution-cancel response cannot overwrite a successful result` fails at `DataSyncWindow.test.tsx:1102`: expected `data-sync-state="done"`, received `data-sync-state="compared"`. The status bar is also overwritten with `sync.compareCancelled`.
- Impact: every supported sync driver when cancellation loses the race with a successful transaction and post-write comparison. Users receive a contradictory outcome and may repeat or distrust a completed migration.
- Required fix: bind cancellation completion to the operation and phase it cancelled. A response for an execution that has already reached a terminal result must not mutate the result state or status. Cleanup must remain conditional on the matching job id and must not affect later work.
- Required regression: retain the delayed execution-cancel journey and prove the terminal Result/done state and success status survive the late response.
- Fix: execution cancellation keeps the in-flight transaction state authoritative. Its eventual IPC response verifies the captured generation, job id, operation kind and phase, and never writes user-visible state. Execution completion owns the terminal `done`, rollback or Unknown transition and conditionally releases its own job.
- Regression evidence: the delayed execution-cancel journey reaches Result/done and retains its success status after the old cancellation response resolves. Complete frontend result is 43/43.

## migration-sync-core-BUG-006 — Rollback and Unknown retain a stale cancelling status (P2 terminal UI correctness)

- 状态：待修复
- Reproduction: start execution, click Cancel while `execute_data_sync` is pending, hold the `cancel_data_sync` response, then either resolve execution with `rolledBack: true` or reject it after the write started. Finally resolve the delayed cancel response.
- Actual: the execution pipeline correctly reaches `compared` with `sync.rolledBack`, or `unknown` with `sync.executionUnknown`, and the late cancel response no longer overwrites either state. However, both terminal paths leave the status bar permanently at `sync.cancellingExecution` because only the success path clears `statusMsg`.
- Evidence: the existing delayed-cancel `done` journey passes and retains `done` with no cancellation status. The two cases in `[tester] a delayed execution-cancel response cannot leave $outcome in a cancelling phase` fail at `DataSyncWindow.test.tsx:1163`: rollback retains the correct `compared` state and `sync.rolledBack` error, while Unknown retains the correct `unknown` state and `sync.executionUnknown` error, but both still display `sync.cancellingExecution` after the delayed cancellation response resolves. Full frontend result is **7 files, 43 passed and 2 failed**.
- Impact: all supported drivers when a cancellation races with a confirmed rollback or an execution whose commit outcome is unknown. The write safety state is preserved, but the persistent phase indicator contradicts the terminal error and makes the operation appear still active.
- Required fix: every terminal execution exit must own and clear its transient cancellation/progress status when it still belongs to that execution. Preserve the generation/job/kind ownership checks so an old execution cannot clear a newer operation's status.
- Required regression: retain both rollback and Unknown delayed-cancel journeys, prove their terminal state/error/status remain coherent after the late response, then rerun the complete frontend, Rust, coverage and required integration gates with a fresh Tester.
