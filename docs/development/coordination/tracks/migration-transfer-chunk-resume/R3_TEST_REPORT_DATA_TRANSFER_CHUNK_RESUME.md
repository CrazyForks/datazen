# R3 independent test report — Data Transfer chunk resume

- Tester worktree: `/Users/flyxl/code/datazen/.worktrees/datazen-migration-transfer-chunk-resume-fresh-tester-r2`
- Tester branch: `codex/migration-transfer-chunk-resume-fresh-tester-r3`
- Candidate product commit: `c08a907ef9c3ed64f2c524518a070f3d8c45456e`
- Result: **TEST_FAILED**. BUG-003 remains open, and the ≥80% changed executable-line coverage gate is unverified.

## Phase A — independent review

I reviewed every file changed by `c08a907e`, including the Rust resume/checkpoint/preflight/dispatch paths, PostgreSQL and MySQL capability metadata, both driver journeys, UI changes, and tests. The review found no additional confirmed code defect. The numeric-key gate fails closed for MySQL exact-numeric cursors that decode as strings; preflight binds resumable tokens to target transaction capability and distinct sessions; the isolated WDIO config directly loads both driver specs and avoids shared fixture hooks. This review does not establish runtime correctness for the journeys that failed below.

## Phase B — independent verification

The following passed independently:

- `node scripts/generate-builtin-locales.mjs`
- `pnpm typecheck`
- `pnpm exec vitest run src/windows/data-transfer/__tests__/DataTransferWindow.test.tsx` — 34/34 passed
- `CARGO_TARGET_DIR=/private/tmp/datazen-transfer-chunk-cargo-20260925 LLVM_PROFILE_FILE=/private/tmp/datazen-transfer-r3-20260925-%p-%m.profraw cargo test -p datazen --lib data_transfer` — 146/146 passed
- `rustfmt --edition 2021 --check` for changed Rust files
- `pnpm exec prettier --check` for both changed driver journey files
- `git diff --check`

`pnpm tauri:build:webdriver` produced `target/debug/bundle/macos/DataZen.app/Contents/MacOS/datazen`. The command later exited during DMG packaging; DMG is excluded by the track constraint, and the WebDriver app binary was usable for the live run.

I launched that app with a unique R3 `DATAZEN_DATA_DIR` on port 4445 and ran the isolated configuration directly:

```sh
E2E_WD_PORT=4445 E2E_SKIP_WORKER_DATABASE=1 pnpm exec wdio run e2e/wdio.migration-transfer-ack-loss.conf.ts
```

Result: **2 passed, 3 failed**.

- PG→MySQL commit-acknowledgement-loss journey: passed.
- MySQL→PG commit-acknowledgement-loss journey: passed.
- PG→MySQL cancel/resume journey: failed at the strict initial target `COUNT(*) === 2` wait. The final observer sample successfully pinged and returned `count=5` for `dz_dt_ack_pgm_tgt_mugpnglq.dt_chunk_resume_mugpnglq`.
- MySQL→PG cancel/resume journey: failed at the same strict initial count-two wait. The final observer sample successfully pinged and returned `count=5` for `public.dt_chunk_resume_mugpphzp`.
- PG→MySQL source-mutation refusal journey: failed at the same strict initial count-two wait; final observer sample was `ping=true,count=5`.

No count assertion was relaxed. The three failures occurred before cancellation, resume, source mutation, zero-additional-row refusal, or exact ordered row readback. Those acceptance conditions remain unverified.

The new diagnostics show the observer was reachable and could query the intended fixture relation at timeout; this rules out a dead observer connection as the explanation for these final samples. They do not establish why the intermediate two-row state was not seen. The sample is consistent with either the app/journey not exposing the expected pause boundary or the observer missing that interval. R3 does not claim either as the root cause. The isolated app log contains slow INSERT warnings for the expected fixture tables (about 8.00–8.15 seconds per statement); these logs do not identify the missing count-two observation or prove its cause.

Cleanup evidence: read-only PostgreSQL and MySQL catalog queries returned no schema/database names matching the run's `dz_dt_ack_%` prefix. The R3 app process was stopped, `lsof` showed no listener on 4445, and the unique R3 app-data directory was preserved. No manual `DROP` was run. The build resolver's temporary Redis driver addition to `Cargo.lock` was audited and reverted; no product or WDIO source was changed by this Tester. No `.profraw` file was deleted or overwritten.

## Phase C — coverage evaluation and path map

**Changed executable-line coverage: not measured; percentage and executable-line denominator unavailable. The ≥80% gate is not verified.** This is not a claim of 0% coverage. `command -v cargo-llvm-cov` and `command -v cargo-tarpaulin` both returned no executable path (exit status 1); `xcrun --find llvm-cov` and `xcrun --find llvm-profdata` resolve to Command Line Tools binaries. The normal Cargo test run was not coverage-instrumented. `find /private/tmp -maxdepth 1 -name 'datazen-transfer-r3-20260925-*.profraw' -print` returned no matches. At handoff, only about 2.6 GiB remained; no second instrumented Cargo target was built. Existing shared `.profraw` artifacts were left untouched.

Static path-to-test map (a source review aid, not a substitute for measured line coverage):

| Changed production area | Relevant test evidence | R3 limitation |
| --- | --- | --- |
| `src-tauri/src/data_transfer/resume.rs`, `resume/fingerprint.rs`, `resume_dispatch.rs` — ordered keyset pages, typed source digest, key eligibility, confirmed chunk result | `scalar_keyset_uses_bound_cursor_after_filter_and_hard_limit`; `composite_keyset_uses_complete_pk_tuple_and_correct_parameter_positions`; `keyset_page_refuses_unbounded_or_oversized_limits`; `only_exact_nonnullable_declared_primary_key_order_is_resumable`; `mysql_exact_numeric_keys_require_lossless_integer_cursor_decoding`; `fingerprint_hashes_large_values_and_float_bits_with_type_tags`; `acknowledged_chunk_with_checkpoint_advance_failure_reports_confirmed_target_state` | Unit tests passed, but no executable-line percentage. Live chunk cancel/resume did not reach a successful pause or resume. |
| `src-tauri/src/commands/data_transfer/plans/checkpoint.rs` and `plans/tests.rs` — opaque claim, immutable scope, checkpoint advance, expiry | `resume_checkpoint_is_opaque_single_flight_and_consumed_on_success`; `chunk_checkpoint_binds_progress_and_claims_the_token_once`; `changed_source_digest_rejects_resume_and_session_invalidates_token`; `checkpoint_ttl_is_independent_from_preview_expiry_and_expires_explicitly` | Sequential single-flight behavior is tested; a true concurrent claim race remains unverified. |
| `src-tauri/src/data_transfer/execute/dispatcher.rs` and execution tests — target transaction outcomes, cancellation, and stopping later tables | `unknown_commit_stops_later_tables_and_hides_unconfirmed_rows`; `unknown_rollback_stops_later_tables_and_hides_unconfirmed_rows`; `confirmed_rollback_stops_when_stop_on_error_is_enabled`; `cancel_after_write_reports_current_table_and_rolls_back`; both live acknowledgement-loss journeys passed | Chunk-specific cancel/resume was not reached. Explicit rollback-failure fencing and live final-empty-page behavior remain unverified. |
| `src-tauri/src/commands/data_transfer/exec/execution.rs`, `exec/resume_preflight.rs`, `resume_preflight_tests.rs` — execution context and capability gate | `unknown_target_transaction_metadata_allows_transfer_without_token`; `unsupported_source_snapshot_keeps_transactional_table_boundary_resume`; `mysql_bigint_key_keeps_atomic_table_boundary_resume`; `changed_target_transaction_contract_invalidates_before_legacy_write`; `unknown_source_snapshot_close_preserves_committed_chunk_and_stops_later_tables` | Focused Rust tests passed; no measured coverage percentage. |
| PostgreSQL/MySQL driver metadata and UI resume affordances | Focused Rust filter (146/146), `pnpm typecheck`, and DataTransferWindow Vitest (34/34) passed; isolated WDIO ran both cross-database directions | Live ordered-row equivalence after resume is unverified because both cancel/resume journeys stopped at the initial visibility gate. |

## Phase D — disposition

Progress is marked `FAILED`; BUG-003 status returns to `待修复`. Release remains blocked on resolving the three initial visibility waits and successfully exercising both-direction cancellation/resume, exact row verification, and the PG→MySQL source-mutation refusal. The changed executable-line coverage gate must also be measured and shown to reach at least 80%.
