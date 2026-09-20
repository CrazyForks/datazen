# Migration implementation continuation contracts

This document directs the next coding waves. It records requirements, not implemented capabilities. The initial correctness tracks must pass independent testing before integration.

## Shared contracts before expanding features

1. Qualified relation identity belongs to the driver API: catalog/database, schema and object name remain distinct. A dot inside an identifier must never become a path separator. Session-bound APIs must resolve the requested relation explicitly rather than relying on mutable search paths.
2. Drivers report migration capabilities and their limitations. Distinguish transactional DML, transactional DDL, accurate affected rows, bounded snapshot scanning, typed parameter binding, object extraction and object rendering. An unsupported operation returns a reason before target writes begin; a default implementation must not falsely advertise support.
3. A comparison or preview creates an immutable backend plan. Execution accepts an opaque plan ID and allowed selections/options, not client-supplied replacement SQL or complete comparison rows. Bind source and target sessions, resolved relation identity, source/target schema fingerprints, mapping, filter, operation options and driver contract version. Validate fresh persisted readonly policy and live target identity at execution time.
4. Plans expire and are consumed once execution starts. Unknown transaction outcome stays unknown and cannot be automatically retried. Plan expiry or context changes return the user to comparison with preserved configuration and a concrete reason.
5. Confirmations refer to the exact operations in the plan. DDL rollback capability and rollback-script availability are separate concepts. MySQL implicit DDL commits must not be described as atomic rollback. Destructive operations never precede complete source validation required by the selected transfer policy.

## General key comparison and scalable result storage

The initial integer-key restriction and in-memory result budgets prevent unsafe execution but do not satisfy final acceptance.

- Define key equality explicitly, including collation, numeric types, NULL, timestamp precision and composite keys. Source paging order, target paging order and merge comparison must share that contract. Reject ambiguous keys or duplicate keys before applying a plan.
- Implement a driver-owned stable scan with bounded pages and explicit cancellation/cleanup. A default streaming method that first materializes the whole query is not bounded scanning. Source data must reflect one declared snapshot; changing rows during multi-page reads cannot silently produce missing or duplicate records.
- Where native order differs, use a disk-backed comparison index keyed by lossless canonical keys, or driver-owned order keys with proven equivalence. Binary key comparison must be disclosed if it differs from native database equality; it cannot silently split one case-insensitive key into an insert and delete.
- Keep unchanged rows out of retained changes. Backend comparison storage owns all change records and exposes summaries plus cursor pages. Selections use stable change IDs and table-level defaults with exceptions. Frontend memory must not grow with all compared rows.
- Optimistic apply uses expected target values/schema from the plan and accurate affected rows. A zero-row update/delete is a conflict, not success. Insert collisions are conflicts. Force/skip/recompare are explicit user choices supported by the backend plan contract; never recompute and apply all table differences as an error fallback.
- Cover selected text/composite key mappings, duplicate candidate keys, source and target column order differences, large values, stale schemas and concurrent target modifications with actual database tests.

## Transfer products and object preservation

- Support source filters and row ranges/recordsets in the mapping UI, with validated parameterized execution and the same filter represented in preview and saved profiles.
- Expose transaction boundaries, batch size, stop/continue policy and precise committed/rolled-back/unknown row counts. Cancellation must report the current table and already committed work. Resumption requires a proven checkpoint or idempotent operation, not an OFFSET saved after a failed run.
- Same-family structure copy preserves indexes, foreign keys, checks, defaults, generated/identity columns and driver-supported object metadata. Referenced-object ordering comes from an explicit dependency graph. Cross-family loss or unsupported semantics must be visible per object and blocked unless a reviewed mapping resolves them.
- Extend structure comparison to supported views, routines, triggers, sequences and other relevant objects using driver metadata and renderers. Object identities include namespace and overload signatures. Excluded objects are reported, not silently omitted.
- Add SQL-file targets with driver-owned lossless literal rendering, encoding choice, cancellation and atomic final-file replacement. Binary/decimal/date/JSON/string escaping tests belong to the driver. File output must preserve the chosen structure/data mode and review selections.
- Per-table field/type mapping drives both preview and execution. Table/field renames, skipped columns, missing required target columns, defaults and generated columns must be validated before any writes. Exported SQL and actual typed DML must have equivalent semantics.

## Profiles, runs and user journeys

- A shared persistent profile model holds connectionId values, qualified objects, filters, mapping and options; it never serializes runtime dbSessionId values or credentials. On reopen, resolve fresh sessions and report missing/changed connections.
- Persist versioned run metadata: profile revision, start/end time, phase, selected operation counts, committed/failed/conflict counts, cancellation state and sanitized errors. Do not persist complete sensitive row payloads in general logs/history. Interrupted runs remain interrupted/unknown until reconciled.
- Integrate profile execution with the existing Workflow runtime/scheduler rather than creating another scheduler. GUI and Workflow execution must use the same plan validation and execution services. Unattended destructive policy is a saved explicit profile choice, not implied by successful preview.
- All three windows preserve endpoint/mapping/filter settings when moving back; clear stale preview/selection when those inputs change; display meaningful phase and per-object status; allow selecting all filtered differences across pages; open/export reviewed SQL; and expose profile save/load plus run history.
- Use capability-driven UI. Only en.ts and zh-CN.ts are edited during development. No per-driver family switches in Host UI for newly introduced behavior.

## Local acceptance environment verified 2026-09-10

The integration baseline `2c0270ec` passed the regular `pnpm tauri:build:webdriver` pipeline with basic drivers, including frontend typecheck/bundle and Rust/macOS bundle. A missing ignored Community resource directory was created at `src-tauri/resources/builtin-ep`; no Pro extension was installed. Use `pnpm_config_verify_deps_before_run=warn` to prevent pnpm 11 from attempting to reinstall the worktree's shared node_modules.

WebDriver baseline tests SD-001 and SD-002 passed (2 tests) on a dedicated port 4475 and isolated `e2e/.app-data-migration-navicat`. This is only window smoke evidence, not migration correctness evidence.

Local PostgreSQL and MySQL respond successfully. Separate source/target databases exist for each track: `dz_mig_0910_{sync,transfer,schema}_{src,tgt}`. Read loopback credentials from the local ignored e2e/.env without printing them. Do not run the default environment reset scripts against shared databases; they contain destructive fixture resets. Use the isolated databases and create/drop only track-owned test objects.

Each test worktree needs its own Rust target and app data directory. The current e2e/run.mjs does not honor CARGO_TARGET_DIR when locating the executable, and always runs shared environment setup. For isolated acceptance, build through the regular Tauri pipeline, launch that exact worktree binary with its own port/data directory, then invoke WDIO directly against that port and selected track fixtures. A failed connection to another/default port is not an application test result.

## Final acceptance gates

Independent test reports must distinguish measured coverage from code-path estimates, actual database tests from mocks, and tests deferred from tests passed. The core capability matrix, module user journeys, fault recovery and large-table memory behavior must all pass. A hardcoded protective restriction, explicit unsupported message or a green compilation alone is not evidence of Navicat parity. Database families absent from the registry remain implementation work and must be reported honestly.

## Cross-track findings requiring closure before final acceptance

- The integrated Transfer driver fixes now pass the real PostgreSQL and MySQL Sync binary journey (1/1 each) on the final WebDriver build. The journey verifies `00 ff fe` and other non-UTF8 bytes, driver-owned preview literals, failed-plan rollback, and byte-exact target reads. This closes the shared writer integration gate for typed Sync DML, but not the remaining export consumers: `commands/export.rs` still uses lossy UTF-8 in CSV/text and JSON formatting, and its SQL exporter delegates to the similarly lossy `data_sync::sql::format_literal`. Add an independent lossless-value consumer track: driver-owned SQL-file literals and lossless CSV/JSON representation with display/export regression tests. Do not treat the two Sync journeys as proof that all export paths are lossless.
- `store/models.rs::SyncTask` still serializes runtime session IDs and assumes offset-based resumability. Replace or explicitly migrate this legacy format in the profiles/run-lifecycle wave; a restarted process must resolve current connections and never reuse stale session IDs or claim offset resumption is safe.

## Integrated release-gate evidence (2026-09-17)

The final `codex/migration-navicat` WebDriver build passed the restored PostgreSQL and MySQL Sync binary journeys (1/1 each). The merged branch also passed Sync Rust 101/101, Transfer Rust 39/39, PostgreSQL/MySQL/SQLite driver suites, migration frontend tests 65/65, and TypeScript checking. The journey fixture uses the supported `datazen_sync_src`/`datazen_sync_tgt` databases (and MySQL equivalents) and is safe to rerun after the normal fixture setup. The remaining parity work is tracked above; no profile, bounded-scan, object-graph, SQL-file export, or run-history capability is implied by this gate.

## Immutable Transfer plan release gate (2026-09-20)

The immutable Transfer plan wave is integrated in `7d37002a`. Preview now issues a server-owned opaque plan; execution accepts only the plan ID plus validated selections/options, rechecks live sessions, driver contracts, read-only policy and schema identity, and consumes the plan once before writes. PostgreSQL precision enrichment is excluded from the live schema fingerprint, and `create_new` target mappings preserve the preview `None` sentinel during execution revalidation. Bound multi-row INSERTs retain typed parameters while using the configured batch size.

Independent final testing passed Host Rust 1413/1413 (3 ignored), Transfer frontend 25/25, TypeScript, PostgreSQL/MySQL/SQLite driver suites 101/86/46, formal WebDriver build, and `data-transfer-diverse-types.ts` 3/3. The desktop journey transferred 25,000 wide-type rows in both PG→MySQL and MySQL→PG paths and reached the result page. Integration sanity after merge passed Host Rust 1413/1413, Transfer frontend 30/30, and TypeScript.

This gate closes the immutable-plan, create-new mapping, and large-transfer execution defects recorded in the Transfer track. It does not claim completion of bounded comparison scans, normalized composite-key equality, object dependency preservation, source filters, SQL-file targets, profiles/run history, or the remaining lossless export consumers listed above.

## Immutable Sync plan release gate (2026-09-20)

The Sync plan wave is integrated in merge commit `d8d84182` after `351595a0`. `compare_data_sync` now returns a server-owned opaque plan with a 15-minute TTL; `generate_data_sync_sql` and `execute_data_sync` consume only the plan ID, selection revision, key-only selection and validated options. The plan binds both sessions, active database/schema/relation identity, schema and primary-key fingerprints, driver protocol, target read-only policy and the reviewed comparison. Claim is one-shot and remains consumed after rollback, cancellation or an unknown outcome.

The independent gate passed Host Rust 1419/1419 (3 ignored), Sync command/data-sync suites 27/99, Sync frontend 46/46, TypeScript, PostgreSQL/MySQL/SQLite driver suites 101/86/46, formal WebDriver build, and the real Sync suite 25/25. PostgreSQL and MySQL immutable-plan journeys passed 2/2 each, including selected-only writes and stale schema rejection before target writes. The real suite also verifies legacy apply rejection and one-shot retry behavior.

This closes the Sync immutable-plan and active-database identity gate. Integer-only key ordering, bounded snapshot scans, normalized collation/composite keys, disk-backed ComparisonStore, optimistic conflict detection, object dependency ordering, profiles and run history remain later parity work.

## Normalized Sync key contract release gate (2026-09-20)

The normalized key contract wave is integrated after independent commit `fd6efc4e`. The driver API now owns supported key domains, lossless normalization, NULL policy and order expressions. PostgreSQL, MySQL/MariaDB and SQLite expose conservative integer, exact-decimal, timestamp and binary-text contracts; unsupported or ambiguous combinations fail closed before writes. Comparison and keyset paging use canonical tuples, while seek parameters retain driver-correct storage types. SQLite binary-text cursors are converted to BLOB parameters so `CAST(key AS BLOB)` paging advances without repeating the cursor row.

Independent final testing passed the SQLite single-key and composite-key real pagination regression, Driver API/PostgreSQL/MySQL/SQLite suites 131/102/87/49, Host Rust 1423/1423 (3 ignored), Sync frontend 61/61, TypeScript, formal WebDriver build, the real Sync suite 25/25 and PostgreSQL/MySQL immutable-plan journeys 4/4. The worktree was clean after restoring generated Cargo files. Two old E2E cases still call the removed array-style compare contract or expect a successful comparison when all operations are disabled; they are test-contract cleanup items, not normalized-key business failures.

This gate closes the integer-only key restriction for the supported driver contracts and the SQLite cursor binding defect. It does not claim stable snapshot lifetime, bounded streaming/ComparisonStore, optimistic target conflict detection, source filters, object dependency graphs, SQL-file targets, profiles/run history or broader driver coverage.

## Lossless export consumer release gate (2026-09-20)

The export consumer wave is integrated after independent commit `5a36cbc3` on top of implementation commits `c7e278fd` and `12d39459`. Batch SQL export now delegates every value to the live driver's `format_sql_literal`; PostgreSQL, MySQL/MariaDB, SQLite and SQL Server preserve arbitrary bytes with dialect-correct literals, and SQL Server binary columns remain `Value::Bytes` through decode. CSV uses explicit `datazen:bytes:hex:` and reserved-text markers, quotes both newline forms, and JSON uses a structured bytes marker with a collision-safe envelope for native JSON objects.

Independent final testing passed Host Rust 1428/1428 (3 ignored), export-focused Host 16/16, Driver API SQL dump 12/12, PostgreSQL/MySQL/SQLite/SQL Server suites 103/88/50/44, frontend export-related tests 77/77, TypeScript and the formal WebDriver build. Source review found no lossy UTF-8 conversion in the export path; the existing callback batches and 64 KiB file sink remain bounded. Live UI export assertions were not reachable because this environment lacks `E2E_PG_RO_PASSWORD` and could not initialize the seeded fixture.

This gate closes the lossless SQL/CSV/JSON consumer defect for the covered drivers. It does not add an import decoder, SQL-file target profiles, stable snapshots, bounded comparison storage, object dependency graphs, source filters, run history or broader driver-specific export coverage.

## Optimistic Sync conflict release gate (2026-09-20)

The optimistic-conflict wave is integrated in merge commit `483d9597` after implementation `42d0ee66` and independent testing `2680409c`. Sync UPDATE and DELETE statements now carry the reviewed expected non-key values as null-safe predicates. A target row changed or deleted after comparison therefore affects zero rows and is reported as `DataSyncError::Conflict`; the executor rolls back the transaction instead of treating the write as successful. Missing or malformed reviewed target rows fail closed before execution. The live executor reports the database's actual `affectedRows` in the execution result rather than a constant fallback.

Independent final testing passed Host Rust 1432/1432 (3 ignored), Sync/data-sync suites 112/112, Driver API/PostgreSQL/MySQL/SQLite suites 131/103/88/50, Sync frontend 46/46, TypeScript and the formal WebDriver build. PostgreSQL and MySQL immutable-plan journeys passed 2/2 each; live conflict journeys for both families confirmed target modification causes conflict and rollback, while a successful update reports `affectedRows: 1`.

This gate closes silent zero-row optimistic writes for the covered DML paths. It does not add force/skip/recompare policy, stable snapshots, bounded comparison storage, source filters, object dependency graphs, SQL-file targets, profiles/run history or broader driver coverage.

## Transfer source-filter release gate (2026-09-20)

The Transfer source-filter wave is integrated in merge commit `e4303508`, with implementation `810615a0`, typed-binding fix `c1fad3e0`, preview-contract fix `3fd30e76`, and final independent testing `3bdc3547`. Transfer table mappings now support bounded structured `AND`/`OR` predicates for equality, comparisons, `LIKE`, `IN`, `IS NULL` and `IS NOT NULL`. Columns are validated against the inspected source schema, values remain bound parameters, and enabled-table filters are included in the immutable plan fingerprint. The mapping UI edits filters and the preview displays the driver-typed placeholder shape used at execution; PostgreSQL integer input such as `id > 2` is shown as `$1::integer` while preserving large values as text parameters.

Independent final testing passed Host Transfer/data-transfer 58/58, Transfer command tests 14/14, Driver API 131/131, PostgreSQL driver 103/103, Transfer frontend 27/27, TypeScript, and the formal WebDriver build with PostgreSQL/MySQL/SQLite/Redis injected. The fresh PostgreSQL UI/IPC journey passed 1/1: editor input `id > 2`, preview with `$1::integer`, execution reporting 2 inserted rows, and target verification returning exactly ids 3 and 4. Existing Transfer E2E coverage also passed 8 specs and 40 tests. The environment still lacks `E2E_PG_RO_PASSWORD`, so read-only Sync fixtures are skipped; this does not affect the writable Transfer journey.

This gate closes source filters for Data Transfer and the two typed-preview/execution mismatches found during independent testing. It does not add row ranges/recordsets, Data Sync filters, stable snapshots, bounded comparison storage, object dependency graphs, SQL-file targets, profiles/run history or broader driver coverage.

## Data Sync source-filter release gate (2026-09-20)

The Data Sync source-filter wave is integrated after implementation commit `6cb6456a` and independent verification `940a8518`. Each matched table can carry a structured, parameterized `AND`/`OR` predicate covering equality, inequality, ranges, `LIKE`, `IN`, `IS NULL` and `IS NOT NULL`. The predicate is validated against both matched schemas, passed through the driver placeholder/type contract, applied symmetrically to source and target keyset scans, retained in the reviewed comparison, and included in the immutable plan fingerprint. The mapping UI exposes the editor and clears stale comparison rows when a filter changes.

Independent verification passed the full Host Rust library suite (1446 passed, 3 ignored), Sync command/data-sync focused suites (142/142 and 114/114), Sync window and plan tests (32/32), Transfer frontend regression tests (22/22), TypeScript checking, and the formal `pnpm tauri:build:webdriver` build. A live PostgreSQL journey passed: `id >= 2` produced only the in-scope update/insert changes, excluded id 1 from delete candidates, executed two selected changes, preserved the out-of-scope target row, and rejected reuse of the earlier one-shot plan after changing the filter. The environment still lacks `E2E_PG_RO_PASSWORD`, so read-only fixtures were skipped; SQLite remains outside the current V1 Data Sync family gate.

This gate closes structured Data Sync filters for same-name columns on matched table pairs. Row ranges/recordsets, stable snapshots, bounded comparison storage, renamed-column filter mappings, object dependency graphs, SQL-file targets, profiles/run history and broader driver coverage remain open.

## Data Sync stable snapshot release gate (2026-09-20)

The stable-snapshot wave is integrated after implementation commit `b35d4a70` and independent verification `96848cb8`. Data Sync comparison now requests a driver-owned read snapshot before inspecting schemas and scanning source/target rows. PostgreSQL uses `REPEATABLE READ READ ONLY`; MySQL/MariaDB uses a consistent read-only snapshot. The driver API fails closed for unsupported families, and both snapshots are rolled back on success and every comparison error so a failed comparison cannot leave transactions open.

Independent verification passed the full Host Rust library suite (1446 passed, 3 ignored), the Sync command tests (21/21), Driver API (132/132), PostgreSQL (104/104) and MySQL (89/89) driver suites. Source review and error-path tests confirmed cleanup for successful and failed comparisons. The formal `pnpm tauri:build:webdriver` pipeline also passed during implementation validation. No new live mutation journey was added in this gate; the existing environment still lacks `E2E_PG_RO_PASSWORD` for read-only fixtures.

This gate closes the multi-page comparison consistency gap for the covered PostgreSQL and MySQL/MariaDB paths. Metadata enumeration that uses a temporary pool remains a documented caveat, SQLite is outside this V1 snapshot family, and snapshots last only for one compare call. Disk-backed bounded comparison storage, row ranges/recordsets, object dependency graphs, SQL-file targets, profiles/run history, force/skip/recompare policy and broader driver coverage remain open.

## Data Sync ComparisonStore release gate (2026-09-20)

The ComparisonStore wave is integrated after implementation `bb5eb2e7` and independent verification `450579b3`. Reviewed comparisons above 8 MiB are serialized to uniquely-created private temporary JSON files; smaller plans remain inline. Plan peek, SQL generation and execution reload the server-owned comparison, while expired plans, successful one-shot claims, malformed stores and owner drops clean up the file. The old 64 MiB total plan limit is removed; the existing per-page 8 MiB and per-table 10,000-difference/32 MiB safeguards remain.

Independent verification passed ComparisonStore 5/5, Sync plan 6/6, Sync command 21/21, the full Host Rust suite (1453 passed, 3 ignored), TypeScript checking and the formal `pnpm tauri:build:webdriver` pipeline with PostgreSQL/MySQL/SQLite/Redis injected and macOS App/DMG packaging. Private permissions, unique-file collision handling, malformed data, TTL/claim cleanup and plan/SQL/execute reload paths were checked. No new defect was found.

This gate bounds server-side plan retention, but it does not provide paged IPC results: the current client preview still receives the complete `tables` payload and can hold it in memory. A process crash can leave an orphaned temporary file until OS cleanup, and row comparison is still bounded by the existing single-page/table budgets. True streaming comparison, disk-backed change indexes with cursor selection, row ranges/recordsets, object dependency graphs, SQL-file targets, profiles/run history, force/skip/recompare policy and broader driver coverage remain open.
