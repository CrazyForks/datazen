# BUG-002 — Unsafe legacy fallback can issue tokens without target atomicity proof

- Status: `修复中` (included in the active repair wave; no fix is claimed by this tester report).
- Severity: P1 — when target write atomicity is unknown or false, a partial legacy write can be presented as resumable even though no safe per-table boundary is guaranteed.
- Candidate: `e774e3554a07e889383be02d757395f315e7fdf6`.
- Evidence: source-code review of the executor capability gate, per-table dispatcher, and checkpoint lifecycle.

## Reproduction

1. Prepare a Data-only, Insert-mode transfer from distinct source/target sessions for an existing matched table.
2. Use a target relation whose transaction capability is false or unknown (for example a MySQL non-transactional table), or make target schema inspection unavailable before any resume progress exists. Keep the job otherwise eligible under the static resume predicate.
3. Start the transfer and cause the legacy path to return partial/cancelled after a target write. Check whether the response includes a resume token despite no committed bounded chunk cursor.
4. Submit that token with the same plan. Observe that it is claimed and the same target safety condition can again select the legacy path, which starts from the table boundary without proof that replaying the partially written table is atomic or safe.

This reproduction follows the code branches and has not yet been independently run against a live non-transactional target.

## Code path and cause

- `src-tauri/src/commands/data_transfer/exec.rs:495-500` implements `supports_bounded_resume` using only SQL-file absence, Data mode, Insert mode, and existing-table mappings. It does not inspect source/target driver family, source key eligibility, or target transaction capability.
- `src-tauri/src/commands/data_transfer/exec/execution.rs:132-137` creates a checkpoint session for the execution; lines 400-414 later call `finish` and expose its token whenever the static predicate passes and the result is partial/cancelled.
- `src-tauri/src/data_transfer/resume_dispatch.rs:61-83,89-123` can return `NotApplicable` when the chunk preconditions are not met. In particular, if there is no saved progress yet, target metadata failure or a target relation without `supports_consistent_snapshot == Some(true)` returns `NotApplicable` rather than rejecting a resumability claim.
- `src-tauri/src/data_transfer/execute/dispatcher.rs:219-232` treats `NotApplicable` as a fall-through. It proceeds to the ordinary legacy scan/writer path beginning at line 320.
- `src-tauri/src/commands/data_transfer/plans/checkpoint.rs:502-526` creates a checkpoint token for any partial result when the session was not invalidated; it does not require a bounded per-table cursor to have been advanced.
- On resume, `src-tauri/src/commands/data_transfer/exec/execution.rs:104-107` claims the checkpoint first. Since the static job predicate still passes, an empty per-table progress record can again fall through to the legacy path. The token therefore does not prove that a resumable in-table cursor or safe target transaction boundary exists.

The unsafe gap is specifically the combination of fallback and token lifecycle: an unknown or unsafe target transaction contract may use the legacy writer while the executor still advertises resumability. A later retry can be accepted without a durable row cursor or a proven atomic table boundary, so it may replay already-applied rows or otherwise fail to represent the true partial-write boundary. The safe table-boundary fallback remains valid when target per-table atomic commit and distinct source/target sessions are verified; the issue is not that every job lacking a row key must be rejected.

## Expected behavior

Preserve the existing safe table-boundary resume when row-key chunking is unavailable but target per-table atomic commit and distinct source/target sessions are verified. In that case, replaying an uncompleted table from its boundary is safe. However, if target transaction capability is unknown or false, the sessions are shared, or the saved resume contract is invalid, fail closed before the legacy writer can create an untracked partial target state; do not issue or consume a token that implies an atomic boundary the executor has not proved. Issue a row-chunk token only after a verified page commit and cursor advance; issue a table-boundary token only after verified per-table atomicity; retain existing replay protections for invalidated contracts.
