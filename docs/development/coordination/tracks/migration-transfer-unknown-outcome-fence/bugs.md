# Bugs — Data Transfer unknown-outcome fence

## migration-transfer-unknown-outcome-fence-BUG-001 — P1

- **Status:** READY_FOR_TEST. Coder fix and focused Rust/UI checks are complete; independent real-database WDIO validation remains.
- **Description:** With `stop_on_error=false`, a table whose commit or rollback response was lost could be followed by writes to later tables. The same path reported unknown rows as zero and could leave a prior table-level resume checkpoint usable.
- **Coder change:** Added typed table outcomes; commit/rollback and target-DDL acknowledgement loss now fail closed, stop all later tables, preserve unknown row counts as unknown, invalidate checkpoints, and consume plans. Confirmed rollback still follows the configured continue/stop policy. Transfer result and run-history mapping distinguish `unknown`, `rolledBack`, `notStarted`, and `partiallyApplied`; SQL-file history compatibility remains intact.
- **Evidence:** Instrumented focused Rust suite passes 151/151; changed production executable-line coverage is 354/409 (86.55%). Focused Transfer result and shared history UI tests pass. Tests cover lost commit acknowledgement before/after the mock effect, rollback failure, later-table fencing, checkpoint invalidation, and workflow outcome mapping.
- **Tester work:** Run the PG→MySQL and MySQL→PG confirmed-rollback/continue WDIO specs serially with a dedicated `DATAZEN_DATA_DIR`; verify no fixture residue and release port 4445. The Coder did not access local databases or run WDIO.

## migration-transfer-unknown-outcome-fence-BUG-002 — P2

- **Status:** READY_FOR_TEST. Coder fix and focused tests are complete; independent WDIO remains for the track.
- **Description:** A successful destructive preamble such as `TRUNCATE`, `DROP+CREATE`, or Structure+Data `CREATE` can remain applied when the later row transaction fails. Reporting that table as merely rolled back hides the surviving target change and could imply whole-table rollback.
- **Coder change:** Report confirmed surviving preamble effects as `partiallyApplied` with a known zero row count when no row transaction commits, preserve `unknown` if rollback or DDL acknowledgement is uncertain, and disable resume checkpoints for those modes. Added coverage for post-preamble reinspection/begin failures and confirmed rollback.
- **Evidence:** Focused Rust tests verify partial outcomes and no resumable checkpoint for destructive modes; Transfer UI displays the per-table partial label and explanation. Shared migration history renders the partial label with amber warning styling.

## migration-transfer-unknown-outcome-fence-BUG-003 — P2

- **Status:** READY_FOR_TEST. Coder added a debug/WebDriver-only post-commit acknowledgement-loss seam and both real PG↔MySQL direction journeys passed; a fresh independent Tester must rebuild and repeat them.
- **Description:** The previous live journeys exercised ordinary constraint failures only, so they could not establish behavior when a real target commit succeeds but its acknowledgement disappears.
- **Evidence:** Both unique-fixture WDIO journeys assert unknown row counts, stop before the later table, verify committed target rows by readback, confirm Transfer history `unknown`, ensure no token/replay remains, and check cleanup. The injected fault occurs only after the actual driver commit returns successfully; it does not simulate a network partition.

## migration-transfer-unknown-outcome-fence-BUG-004 — P1

- **Status:** READY_FOR_TEST. Both ack-loss fixtures now refuse pre-existing database names and clean up only databases whose own create call succeeded in this run.
- **Scope:** Per-database ownership flags and independent admin/fixture config/session cleanup are limited to the two PG↔MySQL specs. No product or shared fixture behavior changed.
- **Validation:** Static checks passed; no database journey ran in the Coder phase. A fresh Tester should execute the unique-fixture journeys serially and verify cleanup.

## Deferred gap outside this track

Large-table bounded chunk/recovery remains separate work. Current Transfer still has table-level, not mid-table, checkpoints; it does not promise bounded memory for fallback materialization or guaranteed interruption of an active source query. This track does not add a chunk cursor or claim those behaviors.
