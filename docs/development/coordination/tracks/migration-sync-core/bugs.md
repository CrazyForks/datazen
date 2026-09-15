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

- Frontend five changed business modules: lines 84.84%, statements 82.84%, branches 80.33%, functions 85.63%. The required branch gate is now satisfied with continuous state-machine and mapping journeys.
- Rust instrumented percentage was not measured; 101 passing sync tests plus 22 passing command tests and actual PostgreSQL/MySQL journeys provide path evidence, not a numerical coverage claim.
- Required real-database canonical projection/selection journeys pass 2/2 on PostgreSQL and MySQL after the rescue build.
- Integer-only keys and 10k-diff/32MiB table/64MiB result limits remain wave1 guardrails, not Navicat parity. Shared immutable plans, normalized ordering, bounded ComparisonStore, conflict checks remain later wave work.

## migration-sync-core-BUG-003 — Cancel IPC race clears the unknown-write fence (P1)

- 状态：待修复
- Reproduction: enter Unknown after losing the execute/commit response; go back and start a fresh comparison; click Cancel; hold the `cancel_data_sync` response pending; let the comparison resolve successfully before the cancel response; then resolve cancellation.
- Actual: `handleCancel` increments `compareGenerationRef` only after `await cancelDataSync(jobId)`. The comparison therefore remains current long enough to run `setWriteOutcomeUncertain(false)`. When cancellation finishes, the visible state returns to `unknown`, but `data-write-outcome-uncertain` is false. Preview can expose Execute for the stale mapping, and `runExecute` sees the same false fence, allowing a duplicate write after an unknown commit result.
- Evidence: `[tester] invalidates a comparison before awaiting the cancel response` fails at `DataSyncWindow.test.tsx:900`: expected `data-write-outcome-uncertain="true"`, received `"false"`. Full frontend result is 7 files, 39 passed and 1 failed.
- Impact: every supported sync driver when cancellation IPC and comparison completion interleave. The database cancel flag is set quickly in normal local runs, but the frontend correctness contract must not depend on IPC latency or event-loop ordering.
- Required fix: synchronously invalidate the active compare generation and preserve/set the independent unknown-write fence before awaiting cancellation. Completion and cancellation handlers must verify the active generation before clearing or transitioning state. Keep both the Execute button and `runExecute` gated by the fence.
- Required regression: retain the delayed-cancel continuous journey, then rerun the complete Rust, frontend, coverage, required WebDriver build and isolated PostgreSQL/MySQL matrix with a fresh Tester.
