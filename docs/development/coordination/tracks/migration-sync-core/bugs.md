# migration-sync-core independent test findings

## migration-sync-core-BUG-001 — Unknown outcome unlocked by cancelled comparison (P1)

- 状态：待修复
- Reproduction: execute selected changes; lose commit response; return from preview to comparison; start a new comparison; cancel it; advance to preview.
- Actual: `handleCompare` replaces unknown with comparing; `handleCancel` sees retained mappingResults and sets compared. The stale reviewed changes become executable without a successful fresh comparison. The next write may repeat an already committed transaction.
- Evidence: `[tester] cancelling a fresh comparison must not unlock an unknown write outcome` fails at DataSyncWindow.test.tsx:823: expected no data-sync-start, received enabled Execute button. Existing execute call count remains 1 before retry.
- Impact: every supported driver; source/target mappings and rows retained after uncertain execution. Preserve an independent invalidation fence until a successful fresh comparison, including failed/cancelled inspection/comparison paths.

## migration-sync-core-BUG-002 — Binary SQL preview corrupts bytes (P1 export correctness)

- 状态：待修复
- Reproduction: generate INSERT preview with Value::Bytes([0,255,254]).
- Actual: sql.rs format_literal converts with from_utf8_lossy, producing replacement characters and a literal NUL. Copied SQL cannot round-trip original bytes.
- Evidence: `test_tester_binary_preview_never_replaces_bytes_with_unicode` fails: `binary SQL preview is lossy: INSERT INTO "target" ("id", "payload") VALUES (1, '<NUL>��')`.
- Scope: SQL preview/copy/export; test confirms typed parameters still retain [0,255,254], so this evidence does NOT prove the normal parameterized execution corrupts bytes. Driver-owned binary literal rendering or honest non-executable parameter display is required.

## Validation gate not satisfied

- Frontend five changed business modules: lines 82.92%, statements 80.95%, branches 77.60%, functions 85.10%. DataSyncWindow lines80.65%, DiffDetail81.48%, SqlPreview100%, mappingView89.15%, utils100%. Branch coverage remains below80%; not reported as all gates passing.
- Rust instrumented percentage not measured; independent 100 passing/1 failing sync tests plus21 passing command tests and actual PG/MySQL journeys provide path evidence, not a numerical coverage claim.
- Integer-only keys and 10k-diff/32MiB table/64MiB result limits remain wave1 guardrails, not Navicat parity. Shared immutable plans, normalized ordering, bounded ComparisonStore, conflict checks remain later wave work.
