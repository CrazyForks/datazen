# migration-schema-dependency-dag

- Phase: PASSED
- coding_commit: `e71d0a55`
- test_commit: `f46d0b09`
- merge_commit: `6210b2ec`
- branch: `feature/migration-schema-dependency-dag-repair`

## Scope

Add a validated, deterministic dependency DAG to the Schema Diff planners where current operation payloads provide structured identities and dependency evidence. Keep operation identity typed by schema object kind and its defining attributes, order known dependencies before rendering, and reject cycles, duplicate/ambiguous identities, and references that can only be guessed from an unqualified basename. Provide a guarded inverse-order primitive that accepts rollback only when the apply order is valid and every node has renderer-provided rollback SQL; existing plan payloads continue to report per-statement rollback completeness.

This track covers the existing independent planner boundaries. It does **not** implement a combined reviewed plan across all selected object kinds; see the release blocker below.

## Implemented boundaries

- Table-operation planning uses typed object identities and a deterministic topological sort. Known edges include create-table before same-table changes/FKs/triggers, create custom type before a table/column that uses that exact type, FK/key/index tightening and removal order, and trigger removal before its target table is dropped.
- View, routine/trigger, sequence, and type standalone plans pass their operations through the same deterministic DAG identity/validation layer instead of relying on the previous category-priority sort.
- Ambiguous or basename-only table/type/trigger references fail closed. Planner errors become unsupported requirements before renderer output is exposed.
- Rollback helper validates the supplied apply order and rollback availability before returning a reverse sequence.
- Unit coverage includes a typed custom-type → table → FK/trigger chain, overload and trigger-target identity distinctions, qualified versus unqualified reference behavior, deterministic independent nodes, graph error cases, rollback gating, and planner rejection.
- Implementation is split into a small compatibility facade, DAG/order logic, and relation/type reference validation modules; no source module in this track exceeds 600 lines.

## Acceptance criteria

- [ ] A combined reviewed plan represents supported dependencies across all selected table, view, routine, trigger, sequence, and type operations and validates them against source/target snapshots.
- [ ] Dependencies inside opaque view/routine SQL bodies are extracted or supplied as driver metadata; unresolved references block execution instead of being silently omitted.
- [ ] End-to-end mixed-kind apply and reverse drop are verified on PostgreSQL and MySQL using WDIO, with rendered SQL and read-back assertions.
- [x] Independent Tester review confirms changed-core coverage ≥80%, reruns focused checks, executes all supported DAG WDIO boundaries without failures, and files any bugs. R4 candidate `e71d0a550b9e3f9eb99a507f415bd228065305d` passed all 10 serial WDIO journeys and independently measured 588/688 changed executable lines (85.5%). The prior R3 result remains historical in [TEST_FAILED.md](./TEST_FAILED.md); current verification follows below.

The supported standalone planner boundaries passed independent review and live PostgreSQL/MySQL validation. The unchecked combined-plan and mixed-kind items remain release blockers tracked in the unified-planner track; this result does not close them.

## Release blocker: no unified cross-category reviewed plan

The current IPC exposes separate prepare paths: `prepare_schema_diff_plan` for table operations and independent `prepare_schema_view_plan`, `prepare_schema_routine_trigger_plan`, `prepare_schema_sequence_plan`, and `prepare_schema_type_plan` paths. The Schema Diff UI does not collect these selected kinds into one plan/deploy request or one reviewed snapshot. Consequently, each standalone plan can order only operations in its own payload; table ↔ view/routine ↔ sequence/type dependencies are not globally ordered or validated, and SQL-body references cannot be proven from these payloads. A deterministic order inside these API boundaries is not evidence that a mixed migration is safe.

The follow-on work is tracked at [migration-schema-unified-planner](../migration-schema-unified-planner/progress.md). It must add a host-owned combined plan/deployment boundary, carry typed selections and source/target snapshots through review and execution, and reject dependencies that cannot be resolved. This is a release blocker even if the current DAG track passes independent review.

## E2E registration

- [ ] Tester: WDIO PostgreSQL and MySQL case for supported table-structure dependency order (create/drop table, FK, custom type, trigger) with database read-back.
- [ ] Tester: WDIO rejection path for an unsafe / unsupported renderer and visible actionable plan error.
- [x] Tester: run both stale-catalog journeys (prepare parent-only DROP, add a dependent child after review, reject before writes, read back both tables/FK); MySQL ran with complete-catalog visibility. R4 passed both dialects and recorded scan counts/latencies below.
- [x] Tester: positively verify MySQL selected child/parent drop and read-back with direct global SELECT/ALL and no partial revokes; R3 and R4 passed with the local account's proven global catalog visibility.
- [ ] Follow-on unified-planner track: mixed table/object selection and deploy journey across supported kinds; register its cross-category cases there.

## Self-validation

- Original Coder implementation commit: `d0545a3d`; this bugfix changeset is being prepared for independent retest.
- BUG-001: PostgreSQL foreign-key introspection now pairs `pg_constraint` column arrays by ordinal and constraint OID; query failures return an error rather than silently presenting an empty FK set.
- BUG-002: source FK metadata now reaches the existing FK diff planner, which produces the reviewed `ADD FOREIGN KEY` operation for a missing target constraint.
- BUG-003: selected target-only table snapshots add explicit dependent-child-before-referenced-parent edges before rendering `DROP TABLE`; ambiguous basename-only identities fail closed.
- Regression tests cover source FK retention for absent tables, FK addition for existing tables, PG/MySQL child-first target drops, ambiguous-reference rejection, and graph-cycle rejection.
- `CARGO_TARGET_DIR=target/cargo-wt RUST_TEST_THREADS=1 cargo test -p datazen --lib schema_diff:: -- --test-threads=1`: 154 passed, 0 failed.
- `cargo test -p datazen-driver-api --lib schema_migration -- --test-threads=1`: 15 passed.
- `cargo test -p datazen-driver-postgres -- --test-threads=1`: 132 library tests passed; integration/doc tests passed, with two existing isolation-gated tests ignored.
- `cargo test -p datazen-driver-mysql -- --test-threads=1`: 113 library tests passed; integration/doc tests passed.
- Opt-in PostgreSQL FK-introspection integration test: 1 passed using the authorized local `datazen_sync_src` database and unique `dz_mig_fk_*` fixtures; test teardown removed the fixtures.
- `npx tsc --noEmit`: passed. WDIO was not run by Coder and remains reserved for a fresh independent Tester.
- Coverage attempt used `RUSTFLAGS=-Cinstrument-coverage`, `CARGO_INCREMENTAL=0`, and CommandLineTools `xcrun llvm-profdata` / `xcrun llvm-cov`. On newly added executable production lines, 90/107 were covered (84.1%): `plan.rs` 70/82, `operation_dependencies.rs` 14/15, `dependencies.rs` 5/5, `schema.rs` 1/1, and `commands/schema_diff.rs` 0/4. The changed command wrapper lines require the independent WDIO run; the driver query itself was exercised by the opt-in integration test. Whole-file rates include pre-existing code and are lower in `operation_dependencies.rs` (71.1%) and PostgreSQL `schema.rs` (49.7%).
- `rustfmt --edition 2021 --config skip_children=true --check` on changed Rust sources, `git diff --check`, and `npx tsc --noEmit`: passed.

## Previous Independent Tester Result

- Status: `TEST_FAILED`. BUG-001 and BUG-002 passed independent live PostgreSQL journeys. BUG-003 passed on MySQL but failed closed on PostgreSQL due to a qualified/unqualified FK reference identity mismatch. Independent plan-only checks additionally reproduced BUG-004 on both PostgreSQL and MySQL: selecting just a referenced target parent exposes a `DROP TABLE` with no requirement while its FK child is left unselected. Neither failing plan was deployed.
- The original six serial WDIO journeys produced 5 passed and 1 failed: PG create+FK and existing-table FK passed; MySQL create+FK, existing-table FK, and reverse-order target-only drop passed; PostgreSQL target-only drop failed with an unsupported `target-only-table-drop-order` requirement and zero statements. Both parent-only boundary tests independently showed the unsafe executable drop on their respective dialects.
- WDIO was run directly against the webdriver binary from this worktree, with an absolute spec path, isolated temporary `DATAZEN_DATA_DIR`, port 4445, and `E2E_SKIP_WORKER_DATABASE=1`. No `pnpm e2e`, runner setup/reset script, global worker database bootstrap, or database teardown ran. Every fixture used unique per-spec table names; test `finally` cleanup ran, PostgreSQL cleanup was verified by querying `information_schema` (0 matching fixture tables), and 4445 was free afterward. The initial bad relative-spec invocation failed before running the test and did not create fixtures.
- The PG/MySQL boundary plans were inspected only; they were not deployed. Do not interpret the WDIO failure as an execution failure or claim either parent-only drop is safe.
- Independent focused checks: `cargo test -p datazen --lib schema_diff::` — 154 passed; `cargo test -p datazen-driver-api migration` — 15 passed; `cargo test -p datazen-driver-postgres` — 132 library tests passed plus live `schema_foreign_key_introspection` 1/1; `cargo test -p datazen-driver-mysql` — 113 library and 4 cross-database integration tests passed, with one existing DB-gated test skipped. TypeScript typecheck passed. Changed Rust sources passed `rustfmt --check` and `git diff --check`; workspace-wide `cargo fmt --all -- --check` only flagged generated, ignored `src-tauri/src/driver_init.rs` ordering.
- Independent instrumented Host Schema Diff suite passed 154/154 using `RUSTFLAGS=-Cinstrument-coverage`, `CARGO_INCREMENTAL=0`, `xcrun llvm-profdata`, and `xcrun llvm-cov`. Measured whole-file line rates: `plan.rs` 89.21%, `operation_dependencies.rs` 71.09%, `operation_dependency_references.rs` 81.12%, `dependencies.rs` 86.36%, and `commands/schema_diff.rs` 15.52% (the latter includes substantial pre-existing code). The live PostgreSQL integration profile showed changed FK catalog query lines executed twice and reference normalization once. These file-level numbers do not independently certify ≥80% coverage across all changed executable lines.
- Formal webdriver Tauri build produced the app binary used by WDIO; the overall packaging command later exited in the DMG hook. DMG packaging is explicitly excluded from this feature gate.
- This changeset does not close the separate combined-plan/unified-planner release blocker above.

## BUG-003/004 Coder Repair Handoff

- Phase: `READY_FOR_TEST`. The previous independent `TEST_FAILED` findings remain historical evidence; these fixes await a fresh independent Tester and are not marked passed.
- BUG-003 preserves PostgreSQL `referenced_schema.referenced_table` from the catalog and MySQL `REFERENCES database.table` identity. The target-drop DAG compares strict full relation identities; PostgreSQL bare selections use the proven target schema (`default_schema()` is `public`) for dependency matching while renderer operation names remain unchanged. Exact selected child-to-parent matches create edges; basename-only matches fail closed.
- BUG-004 scans the PostgreSQL target catalog across schemas. MySQL first proves direct global `SELECT ON *.*` or `ALL PRIVILEGES ON *.*` via `SHOW GRANTS FOR CURRENT_USER()` and rejects any partial `REVOKE` or role-only grant, then enumerates every database. If complete visibility cannot be proven or catalog reading fails/times out, the reviewed plan contains an actionable requirement and zero executable statements. MySQL selected child/parent drops remain available to accounts meeting the visibility gate.
- Before any reviewed table DROP runs, deploy re-enumerates the complete target catalog under the same visibility gate and a 30-second bound, then compares the exact relation identity set and every frozen schema/FK snapshot. Newly added/removed relations or changed schemas/FKs reject the one-shot plan before any write.
- Cross-database MySQL FK references retain exact qualified identities; same-basename tables in different databases do not produce guessed edges. Catalog reads remain N+1 metadata queries; logs include table count and elapsed milliseconds, but large-database end-to-end latency still needs independent observation.
- Catalog reading remains N+1 table-schema metadata reads, bounded by a 30-second timeout. Successful reads log table count and elapsed milliseconds. Coder did not measure full-catalog latency against a representative production-sized database; fresh Tester must record realistic PostgreSQL and MySQL scan durations.
- Host Schema Diff tests: 162 passed. New regressions cover PostgreSQL default-schema identity and late catalog relation/schema changes. Driver API migration tests: 15 passed. PostgreSQL driver tests: 132 passed, plus the separately run opt-in real PostgreSQL FK introspection test (1 passed). MySQL driver tests: 115 library tests passed, plus 4 cross-database integration tests and package integration/doc checks.
- `pnpm exec tsc --noEmit`: passed. The E2E project typecheck reports existing workspace errors in shared helpers, other specs, and generated extension aliases; none reference the changed WDIO spec. Prettier on the changed spec and `git diff --check` passed.
- Coder did not run WDIO. Parent-only boundary journeys wait for an actionable blocker, assert zero statements and disabled deploy, and verify fixture tables/FK remain. The positive MySQL selected child/parent drop journey explicitly skips when the account lacks proven global catalog visibility; Tester must report this as skipped, never passed. If skipped, successful MySQL child-before-parent deploy/read-back remains an open release blocker and must be rerun with direct global SELECT/ALL and no partial revokes.
- The unified cross-category reviewed planner remains a separate release blocker and is not implemented by this repair.

## Fresh Independent Tester R3

- Phase: `TEST_FAILED`; report: [TEST_FAILED.md](./TEST_FAILED.md); confirmed production finding: [BUG-005](./bugs/migration-schema-dependency-dag-BUG-005.md).
- Focused validation passed: Host Schema Diff 162/162, Driver API migration 15/15, PostgreSQL 132 plus live FK-introspection 1/1, MySQL 115 plus 4 cross-database integration tests, Host TypeScript, formatting, and diff checks.
- WDIO completed 5 passing and 5 failing journeys. MySQL create+FK, add-FK, and selected child-before-parent deploy/read-back passed; parent-only unselected-dependent blocking passed for PostgreSQL and MySQL. Two PostgreSQL no-change FK plans failed stale validation. PostgreSQL selected-drop and the two stale-after-review journeys timed out without deploying a rejected/stale plan.
- MySQL catalog visibility was proven and its positive selected-drop path passed, but this run emitted no catalog scan duration/count log. Changed-production executable coverage is below the 80% gate; the app-runtime profile did not flush.
- Test setup incident and cleanup are documented in the report. After direct WDIO execution, read-only verification confirmed no `sd_dag_*` fixtures or temporary connection IDs remained; the app stopped and port 4445 was released.
- The R3 candidate's BUG-005 and coverage findings are addressed in the Coder handoff below. Dispatch a fresh Tester for full retest before merge. The combined cross-category planner remains a separate release blocker.

## BUG-005 Coder Repair Handoff

- Phase: `TEST_PASS` after R4 independent verification. The Coder repair was independently confirmed against unchanged PostgreSQL FK plans and the actual post-review catalog mutation path.
- Root cause: PostgreSQL prepare snapshots retained `public.table` in `TableSchema.table_name`, while deploy fetched the same relation as `table` with schema `public` supplied separately. Snapshot comparison treated this presentation difference as a target mutation.
- Fix: reviewed snapshot validation now checks the reported relation name against the frozen full identity, allowing a qualified frozen identity to match a bare driver name only when schema is already known separately. It rejects differing qualified schemas and rejects a qualified reported name when the reviewed identity is unqualified. It excludes only the redundant serialized `tableName` presentation field before comparing all structural snapshot data, preserving stale-schema detection.
- Regression coverage: direct reviewed-snapshot tests cover the qualified-to-bare unchanged PG case, FK mutations, wrong schema, wrong relation, and an unqualified identity reported as `archive.table`. Focused command tests cover both unchanged PostgreSQL FK deploy journeys (create missing parent/child+FK and add FK to an existing table), and a real schema mutation after review still rejects before any write.
- Changed-line coverage: 588/688 mapped added executable production lines covered (85.5%), using the Tester baseline `906b42fc` and the same test-only exclusions listed in R3. The earlier 658-line denominator grew by 30 mapped executable lines from the BUG-005 snapshot-identity fix. Per-file: `commands/schema_diff.rs` 258/299; `schema_diff/plan.rs` 179/206; `schema_diff/reviewed.rs` 70/85; `driver-api/reuse.rs` 2/2; `driver-api/traits.rs` 2/2; MySQL `mysql.rs` 77/86; PostgreSQL `schema.rs` 0/8. The instrumented run covered Host and driver unit tests; this worktree had no live PG/MySQL integration credentials configured, and the app-runtime profile remains unavailable. The prior independent R3 report separately recorded one successful live PG FK-introspection integration test, without coverage instrumentation.
- Instrumented serial suites passed: Host Schema Diff 173/173; Driver API 156/156; MySQL driver 116/116; PostgreSQL driver 132/132. Host TypeScript passed. Targeted Rust formatting, changed-spec Prettier, and `git diff --check` passed. Workspace-wide `cargo fmt --all -- --check` only flags ignored generated `src-tauri/src/driver_init.rs` ordering.
- Coder did not run WDIO; R4 independently ran the complete serial suite, including unchanged PostgreSQL FK deployment and stale-catalog rejection with readback.
- The WDIO workspace typecheck continues to report pre-existing diagnostics in shared helpers, unrelated specs, and generated extension aliases; no diagnostic referred to the changed dependency-order spec. This does not replace fresh E2E execution.
- This repair does not close the separate combined-plan/unified-planner release blocker.

## Fresh Independent Tester R4

- Candidate: `e71d0a550b9e3f9eb99a507f415bd228065305d`; tester branch: `codex/migration-schema-dependency-dag-fresh-tester-r4`; status: `PASSED`. Review of the candidate production diff found no remaining confirmed product defect within the supported table/FK dependency boundary.
- Focused serial suites: `cargo test -p datazen --lib schema_diff:: -- --test-threads=1` passed 171 tests; the broader `schema_diff` filter passed 173 because it also includes two `store::schema_diff_profiles` tests. This explains the 171-versus-173 count. Driver API passed 156; PostgreSQL driver passed 132 plus the live `schema_foreign_key_introspection` integration test (1/1); MySQL driver passed 116 plus four cross-database integration tests. Host TypeScript, changed Rust formatting, changed WDIO Prettier, and `git diff --check` passed.
- Coverage was independently reproduced from 1,531 serial instrumented profiles using the R3 documented `llvm-cov` source filter plus 30 added executable production lines: 588/688 (85.5%). The arithmetic is 456/525 mapped Host/driver lines plus 132/163 mapper-excluded additions. Per-file counts: `commands/schema_diff.rs` 258/299; `schema_diff/plan.rs` 179/206; `schema_diff/reviewed.rs` 70/85; driver API `reuse.rs` 2/2 and `traits.rs` 2/2; MySQL `mysql.rs` 77/86; PostgreSQL `schema.rs` 0/8. The same explicit test-only source ranges and unmapped-line exclusions recorded in R3 were preserved; the PostgreSQL schema gap remains in the denominator. The optional app-runtime profile was not claimed.
- WDIO used the built app from this worktree, one manual app process, private app-data, port 4445, `E2E_SKIP_WORKER_DATABASE=1`, and direct single-worker `pnpm exec wdio run e2e/wdio.conf.ts --spec <absolute spec>`. No `pnpm e2e`, black-box tester, global worker database setup/reset, or broad teardown ran. Three serial runs were needed to make the test reliable: run 1 had 8 pass/2 timeout failures from WebKit element-text reads; run 2 had 8 pass/2 assertion failures because using the same target connection ID for concurrent DDL invalidated the reviewed session identity; after changing plan readers to `browser.execute` over the exact data-testid DOM nodes and using a distinct temporary config alias for concurrent DDL, run 3 passed all 10 journeys in 5m35.6s. These were test reader/setup corrections, not product bugs; no product bug was added.
- The final suite verified PG/MySQL create-table plus FK order and readback, FK addition to existing tables, selected child-before-parent drops and readback, parent-only unselected-dependent blocks with zero SQL and unchanged tables/FK, and rejection after an FK dependent appears after review. The MySQL global-catalog positive path ran, not skipped. Schema-diff logs measured MySQL at 176 relations/1,192ms for plan and 176/1,186ms for deploy recheck; parent-only blocking scanned 176/1,211ms; its stale-catalog journey scanned 175 before mutation and 176 during deploy revalidation (1,186/1,192ms). PostgreSQL scans measured 2 relations at 0/25ms, the parent-only block at 2/16ms, and the late-dependent recheck at 2/34ms.
- Cleanup was verified with read-only queries: no `sd_dag_%` fixtures remained in PostgreSQL `datazen_sync_src`/`datazen_sync_tgt` or MySQL `datazen_sync_mysql_src`/`datazen_sync_mysql_tgt`; the private connection store had no `e2e_schema_dag_` IDs. The app was stopped, port 4445 was free, and both tester-owned temporary app-data directories were removed. `node_modules` was physical with its real path inside this worktree; no main-checkout module link was used.
- `pnpm tauri:build:webdriver` produced the app bundle used by direct WDIO. The command exited only in the explicitly excluded DMG packaging hook. DMG packaging is not part of this gate. The separate combined cross-category planner remains a release blocker and is not covered by this track's passing result.

## Schema safety follow-up merged from `feature/migration-schema-dependency-safety`

- Phase: `READY_FOR_TEST`. The prior R4 pass above applies to candidate `e71d0a550b9e3f9eb99a507f415bd228065305d`; it does not independently certify this later safety follow-up.
- The follow-up preserves schema-qualified PostgreSQL FK identity, includes cross-schema inbound dependencies in target catalog enumeration, orders selected child-before-parent drops, and blocks parent-only plans before exposing executable DROP SQL.
- Safety-branch checks: `cargo test -p datazen --lib target_only -- --nocapture` passed 16 tests; PostgreSQL identity driver test passed 1/1; Host typecheck, scoped rustfmt, WDIO Prettier, and `git diff --check` passed.
- WDIO is pending on the merged candidate. Retest the existing PostgreSQL/MySQL selected-parent blocker journeys and `SD-DAG-postgresql-005` (inbound child in another schema), preserve the R4 stale-catalog mutation journeys, verify zero statements/disabled deploy/read-back, and record changed-core coverage. Never deploy a parent-only plan.
- The unified cross-category reviewed planner remains a separate release blocker.
