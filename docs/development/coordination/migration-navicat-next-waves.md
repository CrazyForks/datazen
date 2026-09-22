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

## Data Sync conflict-policy release gate (2026-09-20)

The conflict-policy wave is integrated after implementation `268be9d8` and independent verification `c957183f`. Data Sync now binds an explicit `abort`, `skip` or `force` policy into the reviewed plan. `abort` remains the default and rolls back on an optimistic zero-row UPDATE/DELETE. `skip` keeps the expected-target predicate, records the conflict and commits independent rows. `force` removes only the expected-target predicate while retaining the primary-key predicate; INSERT collisions still fail and roll back. Preview SQL and execution use the same policy, and changing it clears the stale comparison in the UI.

Independent verification passed conflict-policy Rust 11/11, SQL generation 15/15, Sync command 36/36, Host Rust 1458/1458 (3 ignored), PostgreSQL/MySQL drivers 104/104 and 89/89, Data Sync frontend 46/46, TypeScript, locale checks, formal WebDriver/macOS packaging, Data Sync window 12/12, boundary 15/15 and real base/cross-family journeys 23/23. The environment still lacks `E2E_PG_RO_PASSWORD` for read-only fixtures. Two full-journey assertions remain pre-existing contract issues unrelated to this policy.

This gate closes explicit conflict handling for the covered Sync DML. It does not add paged IPC comparison results, row ranges/recordsets, object dependency graphs, SQL-file targets, profiles/run history, automatic recompare workflows or broader driver coverage.

## SyncTask persistence safety release gate (2026-09-20)

The SyncTask persistence wave is integrated after implementation `33bbfc5b`, database-override fix `3be34051`, dedicated-session cleanup fix `f7c2d9b4`, and independent verification `f42775aa`. Persisted tasks no longer write runtime `sourceDbSessionId` or `targetDbSessionId`. Legacy files are normalized on load: unsafe offsets and `continue`/`running`/`paused` states become `interrupted` with `resumeState: unknown`, offset zero and a re-run message. Conflict checks resolve fresh sessions from stable connection IDs, honor saved database/schema overrides, and release dedicated sessions on success and every error path.

Independent verification passed Store focused 64/64 (2 ignored), Sync focused 24/24, session cleanup 4/4 and TypeScript checking. The original database-override defect and the follow-up dedicated-session leak were both reproduced, fixed and independently closed. The formal WebDriver build was not rerun in the final fix loop because the worktree host ran out of shared disk space; the prior successful build remains valid for the unchanged UI/runtime path, while a clean rebuild is still required before release.

This gate closes stale-session and unsafe-offset persistence for the legacy SyncTask commands. It does not add full profile editing, run history, cursor-based resumability, paged comparison IPC, row ranges/recordsets, object dependency graphs, SQL-file targets or broader driver coverage.

## Data Sync paged comparison release gate (2026-09-20)

The paged comparison wave is integrated after implementation `70bd5ea5` and independent verification `d0b71d3e`. `compare_data_sync` now returns versioned table summaries with schema metadata, operation counts, unchanged counts and bounded page hints. `get_data_sync_comparison_page` returns only a bounded row page for an opaque plan and exact source/target table pair. Server-signed cursors bind the plan, table pair and offset; expired or claimed plans, unknown tables, forged/out-of-range cursors and invalid limits fail before data is exposed.

The Sync review UI keeps table summaries, the current page and selected row keys, with previous/next navigation and a visible current-page scope. Returning to a page restores its key selections. SQL generation and execution still consume the server-owned immutable comparison and key-only selections, so client page payloads cannot become an execution authority. Independent verification passed Sync plans 9/9, Sync command tests 41/41, focused frontend tests 39/39, TypeScript checking and the added summary→page→next→deselect→back/forward→SQL-selection journey. The coder-recorded formal WebDriver build passed with PostgreSQL/MySQL/SQLite/Redis injection and macOS App/DMG packaging.

This gate bounds comparison rows crossing IPC and frontend memory, but it is not true backend streaming: the current private JSON ComparisonStore still deserializes the complete server-side comparison before slicing a page. A disk-backed row index/stream reader remains required for very large comparisons. Table-level select-all across unloaded pages, row ranges/recordsets, object dependency graphs, SQL-file targets, profiles/run history and broader driver coverage remain open.

## Data Sync disk-backed comparison index release gate (2026-09-20)

The disk-index wave is integrated after implementation `97a34583`, frame-prefix fix `7b64617e`, and second independent verification `7698d173`. Large server-owned comparisons now use a private 0700 directory with a 0600 manifest and one length-framed row file per table. Manifest metadata carries operation counts and row offsets, so summaries do not deserialize row payloads and page requests seek only the requested table and row interval. Full comparison loading remains available for SQL generation and execution, while TTL, one-shot claim, clone and drop cleanup remove the complete directory.

Independent verification passed ComparisonStore 7/7, Sync plans 10/10, all `commands::sync` tests 44/44, the focused Data Sync frontend files 39/39 and TypeScript checking. The directed corruption journey changed a frame length prefix without changing file size; summaries, page reads and full loads all failed closed and cleanup removed the directory. The prior P1 defect where summaries accepted that corruption was fixed and independently closed. The coder-recorded formal WebDriver/App/DMG build remains valid because the final fix is Rust-only and the UI is unchanged.

This gate removes whole-comparison deserialization from the paged IPC path, but the comparison engine still builds a complete `ComparisonResult` before it is persisted. Full bounded compare generation, table-level select-all across unloaded pages, row ranges/recordsets, object dependency graphs, SQL-file targets, profiles/run history and broader driver coverage remain open.

## Transfer stable recordset release gate (2026-09-20)

The Transfer recordset wave is integrated in merge commit `ef0d9e2b` after implementation `69383112`, boundary validation fix `b14e1b0`, and independent verification `96c655b2`. Each table mapping can now select a deterministic single-column recordset: the source effective primary key is used when there is exactly one, otherwise the user must choose an existing source column. Inclusive or exclusive typed start/end bounds and a positive limit are parameterized, quoted and rendered through the same source-scope builder used by preview and execution. The scope is a reviewed selection for one run; it never persists an OFFSET checkpoint or claims resumability.

The server validates bounds against the inspected source type, preserves exact frontend integer text, rejects NULL/non-finite/malformed/overflow values, reversed ranges and empty equal-exclusive intervals, and includes the recordset in the immutable plan fingerprint. The mapping UI exposes order column, typed bound inputs, inclusivity and limit, clears stale previews when the scope changes, and shows the selected scope in preview. Legacy mappings without a recordset remain valid.

Independent verification passed Transfer Rust 73/73, frontend 25/25, TypeScript, focused coverage (84.93% statements, 75.38% branches, 85.71% functions, 87.25% lines), formal `CI=true pnpm tauri:build:webdriver` with App/DMG packaging, and the integration-branch Transfer Rust 73/73. The two P1 boundary defects found in the first independent pass (reversed bounds and integer overflow from text input) were fixed and re-tested. Live PostgreSQL recordset smoke remains deferred because this environment has no `E2E_PG_RO_PASSWORD` or seeded database fixture.

This gate closes single-column stable range selection for the covered Transfer paths. Composite tuple ranges, driver-specific recordset syntax, SQL-file targets, object dependency preservation, profiles/run history, checkpointed resumability and broader driver coverage remain open.

## Data Sync cross-page selection release gate (2026-09-20)

The cross-page selection wave is integrated in merge commit `ba2d718a` after implementation `eb2454f8`, clear-semantics fix `c98ce4ea`, and independent verification `0da1211a`. The reviewed Sync selection now supports server-owned table/operation scopes with key-only exclusions. A scope expands over the complete server comparison, so selecting all INSERT/UPDATE/DELETE rows does not require loading every page into the browser or sending every key through IPC. Explicit row selections remain supported for legacy and mixed selections.

Scope validation is bound to the plan revision and matched source/target pair. Unknown tables or keys, duplicate or overlapping operations, disabled operations, duplicate exclusions, cross-table exclusions, client row payloads and stale revisions fail closed. Clearing an operation uses a `defaults` scope that asks the server to restore that operation's normal default selection across unloaded pages; an `all` scope still supports per-row exclusions. SQL preview and execution expand the same server-owned selection contract.

The review UI exposes per-operation select-all and clear actions, keeps exclusions while paging, restores checkbox state when returning to a page, and reports counts from comparison summaries minus exclusions. The clear journey initially exposed a P1 that dropped unseen default-selected rows; the defaults scope fix was independently re-tested.

Independent verification passed injected Sync command tests 50/50, Data Sync/IPC frontend tests 53/53, TypeScript, formal `CI=true pnpm tauri:build:webdriver` with App/DMG packaging, and the integration branch Sync command tests 50/50. PostgreSQL read-only E2E remains skipped because this environment has no `E2E_PG_RO_PASSWORD` or fixture. The server still retains the complete comparison for execution; this wave only removes the frontend/IPC all-keys limitation.

This gate closes table-level select-all across loaded and unloaded comparison pages for the covered Sync paths. True bounded comparison generation, multi-table one-click selection, row ranges/recordsets for Sync, object dependency graphs, SQL-file targets, profiles/run history and broader driver coverage remain open.

## Data Transfer SQL-file destination release gate (2026-09-20)

The SQL-file destination wave is integrated in merge commit `e973abe8` after implementation `bf15be8a`, the four-defect fix `8aa2d68c`, and independent verification `a42a78ea`. Data Transfer can now choose a native-dialog SQL destination without exposing a filesystem path or SQL payload to the webview. The server owns the opaque destination token, binds it into the immutable preview plan and executes only by plan ID. The renderer streams structure and data from the source dialect into a sibling private staging file, flushes and syncs it, then publishes it with an atomic replace; a failed or cancelled run leaves the previous destination untouched. Existing database targets remain supported.

The SQL-file path supports source table discovery, source filters, typed recordset scopes, column mappings, DDL overrides on the database-target path, driver literal formatting, destructive preambles and source-catalog-qualified reads. The SQL-file UI intentionally skips the database-target mapping editor; its DDL preview is read-only so the reviewed SQL cannot diverge from the server-owned plan. Empty SQL-file selections preserve the server-discovered table set, and preview back navigation returns to the usable setup step. The Windows publication path uses `MoveFileExW(REPLACE_EXISTING | WRITE_THROUGH)`; this host could statically review that branch but could not run Windows integration tests.

The first independent pass found four P1 defects: empty selections disabled every server-discovered table, preview back navigation landed on an unused mapping page, the SQL-file DDL editor was not part of the immutable plan, and `std::fs::rename` could not replace an existing Windows destination. The fixes were followed by a fresh independent pass.

Independent final testing passed Vitest 32/32, injected Data Transfer command tests 17/17, the full `data_transfer` Rust module 79/79, TypeScript checking, and the formal `CI=true pnpm tauri:build:webdriver` App/DMG build. Opaque token/path validation, immutable plan checks, atomic failure preservation and database-target compatibility passed. The earlier 29/29, 16/16 and 3/3 defect-reproduction suites remain recorded in the track log.

This gate closes SQL-file output for the covered source dialects and the four UI/publication defects. Cross-dialect SQL-file target dialect selection, index/foreign-key/dependency ordering, encoding/compression profiles, resumable checkpoints, per-table mapping editing in SQL-file mode, and broader driver coverage remain later parity work.

## Cross-dialect SQL-file target release gate (2026-09-20)

The cross-dialect SQL-file wave is integrated in merge commit `26d5d52c` after implementation `6ea7303a`, the source-type enrichment fix `f3d8f314`, regression coverage `9efeb47c`, and independent final verification. It adds an optional registered target driver to the opaque `SqlFileTarget`. When omitted, the source driver remains the rendering dialect for backwards compatibility. When selected, preview and execution resolve the target through the server-side driver registry, bind its driver type and protocol into the one-shot immutable plan, and render target identifiers, DDL, and literals through the target adapter while source discovery, filters, recordsets, and scans continue to use the source driver. A source catalog is never copied implicitly into the SQL-file target relation; the target currently uses the selected driver's default catalog and the source schema when that family treats schema as a relation qualifier.

Cross-family preview and execution fail closed when no registered SQL driver or sync adapter exists, when the source IR contains an unsupported native type, or when a custom DDL override would bypass target-dialect rendering. The SQL-file UI exposes only registered SQL dialects and keeps the reviewed DDL read-only. Database destinations retain their existing path.

Independent final verification passed the enriched-type regression, `commands::data_transfer` 20/20, the full `data_transfer` module 84/84, Data Transfer Vitest 33/33, TypeScript checking, formatting/diff checks, and the formal `CI=true pnpm tauri:build:webdriver` App/DMG build. The integration branch reproduced the same Rust totals (20/20 and 84/84) after merging. Windows `MoveFileExW(REPLACE_EXISTING | WRITE_THROUGH)` remains statically reviewed because this host has no Windows runtime.

This gate closes target-dialect selection and target-dialect rendering for the covered registered SQL drivers. It does not add an explicit target catalog/schema field, dependency-aware ordering, encoding/compression profiles, resumable checkpoints, per-table SQL-file mapping editing, or representation-specific value policies beyond the registered adapter contract.

## SQL-file structure-dependency release gate (2026-09-20)

The structure-dependency wave is integrated in merge commit `cf5d9baa` after implementation `0a4fe1c1` and independent final verification. SQL-file structure planning now carries tables, indexes and foreign keys as one immutable ordered sequence. Tables are emitted in deterministic parent-before-child order where the source foreign-key graph permits it; indexes and foreign keys are emitted after successful data inserts. Source-to-target column mappings are applied to index and foreign-key definitions, unselected foreign-key parents fail closed, and unsupported index expressions/prefix lengths or foreign-key actions fail closed through the target adapter contract. Custom table DDL remains authoritative and suppresses generated objects for that table.

The same preview sequence is captured in the immutable transfer plan and consumed by execution, so preview cannot drift from the published SQL file. Same-dialect exports use the source adapter when no explicit target dialect is selected; cross-dialect exports continue to use the selected target adapter. Target SQL never receives an implicit source catalog or schema qualifier.

Independent final verification passed `data_transfer::sql_file` 8/8, `commands::data_transfer` 20/20, the full Host `data_transfer` module 86/86, Driver API 132/132, Data Transfer frontend tests 33/33, TypeScript checking, formatting and a clean worktree. The formal `CI=true pnpm tauri:build:webdriver` pipeline then passed on the integration branch with PostgreSQL/MySQL/SQLite/Redis injection and macOS App/DMG packaging. Windows publication behavior remains statically reviewed because this host has no Windows runtime.

This gate closes dependency-aware SQL-file structure output for the covered registered adapters. It does not add explicit target catalog/schema controls, driver-specific expression/index feature translation beyond fail-closed validation, encoding/compression profiles, resumable checkpoints, per-table SQL-file mapping editing, or broader driver coverage.

## Data Sync stable recordset release gate (2026-09-21)

The stable-recordset wave is integrated in merge commit `532ba640` after implementation `843a2f6b` and independent final testing. Each matched Sync table can now carry a reviewed row range inside the existing structured source scope: optional single primary-key order column, typed inclusive/exclusive start and end bounds, and an optional maximum row count. A missing order column is inferred only for a single effective primary key; composite-key tables must choose one primary-key column, while keyset paging still preserves the complete primary-key tuple order. Non-key order columns, missing keys, malformed or overflowing bounds, reversed ranges, equal exclusive endpoints and invalid limits fail closed before a query.

The same scope is validated against source and target schemas, parameterized through both keyset sources, and retained in the immutable comparison fingerprint. Source and target scans apply the range symmetrically; the per-side limit is enforced without an OFFSET checkpoint. Existing `AND`/`OR` predicates remain grouped before the range, and recordset-only scopes are preserved when the filter editor is cleared. The Sync mapping UI exposes order, bounds, inclusivity and maximum rows with lossless text input; unsafe limits are rejected before IPC.

Independent final testing passed injected `commands::sync` 50/50, full `data_sync` 126/126, Vitest 10 files/57 tests, TypeScript checking and a clean worktree. The integration branch reproduced `commands::sync` 50/50 and `data_sync` 126/126. The formal `CI=true pnpm tauri:build:webdriver` pipeline passed with PostgreSQL/MySQL/SQLite/Redis injection and macOS App/DMG packaging. PostgreSQL/MySQL live journeys were skipped because this environment has no matching credentials. Generated driver files and temporary Cargo injection were restored after every build.

This gate closes bounded, typed, reviewable row-range selection for the covered Sync paths. It does not add row-range resume checkpoints, arbitrary non-key ordering, tuple bounds spanning multiple primary-key columns, multi-table range presets, profiles/run history or broader driver coverage.

## SQL-file target-scope release gate (2026-09-21)

The target-scope wave is integrated in merge commit `7e4547c7` after implementation `8f63b4a9`, follow-up hardening `34872bc1`, and independent final verification. SQL-file transfers can now carry an optional target database/catalog and schema alongside the registered target dialect. The server normalizes single-segment identifiers, rejects dotted or quoted fragments, and validates the qualifier combination against the target family: MySQL/MariaDB/ClickHouse use a database/catalog, PostgreSQL/SQLite/DuckDB use a schema, and SQL Server accepts both. Unsupported combinations fail closed instead of silently falling back to the source namespace.

The explicit scope is applied consistently to destructive preambles, table DDL, inserts, indexes and foreign-key statements. When supplied, it overrides the legacy source-schema fallback; source catalog/schema values remain confined to source reads. Preview canonicalizes and validates the scope, the immutable plan fingerprints dialect/database/schema together, and execution rejects any scope drift before writing. The Data Transfer UI exposes both fields and clears an old preview when either changes.

Independent final verification passed the hardened `data_transfer::sql_file` suite (13/13), `commands::data_transfer` (20/20), focused `data_transfer` (91/91), full Host Rust (1510 passed, 3 ignored), Data Transfer frontend tests (35/35), TypeScript checking, Rust formatting and diff checks. The integration branch reproduced 91/91 Rust tests. The final formal `CI=true pnpm tauri:build:webdriver` pipeline passed with PostgreSQL/MySQL/SQLite/Redis injection and macOS App/DMG packaging. Windows replacement behavior remains statically reviewed because this host has no Windows runtime; live PostgreSQL/MySQL transfer fixtures are unavailable in this environment.

This gate closes explicit target namespace selection for the covered SQL-file dialects. It does not add target profiles/history, schema/database creation, dialect-specific namespace translation beyond the registered family contract, resumable checkpoints or broader driver coverage.

## SQL-file encoding release gate (2026-09-21)

The encoding wave is integrated in merge commit `916648df` after implementation `6e38af76` and independent final verification. SQL-file targets now expose UTF-8 and UTF-8-with-BOM output choices; omitted or default selection preserves the historical UTF-8 bytes. The encoding is part of the server-owned target fingerprint, so changing it after preview invalidates the plan rather than silently changing the published artifact. The atomic writer emits the BOM before the reviewed header and retains the existing flush, sync and replace guarantees.

The Data Transfer UI exposes the encoding selector beside the target dialect and clears a stale preview when it changes. The IPC model accepts the new optional field while old payloads without it deserialize as UTF-8, and the generated SQL text, target scope and structure/dependency behavior remain unchanged.

Independent final verification passed Rust `data_transfer` focused tests (92/92), Host Rust (1511 passed, 3 ignored), DataTransferWindow tests (29/29), TypeScript and diff checks. The integration branch reproduced `data_transfer` 92/92 and frontend 27/27. The formal `CI=true pnpm tauri:build:webdriver` pipeline passed with PostgreSQL/MySQL/SQLite/Redis injection and macOS App/DMG packaging. This environment has no Windows runtime or live transfer fixtures, so those checks remain deferred.

This gate closes selectable UTF-8 output variants for SQL-file transfer. It does not add legacy code-page encodings, UTF-16/GBK conversion, compression, target profiles/history, resumable checkpoints or broader driver coverage.

## SQL-file table-mapping release gate (2026-09-21)

The table-mapping wave is integrated in merge commit `3be9943b` after implementation `7a4f4db6` and independent final verification. SQL-file Data Transfer now performs a source-only inspection before preview, so the wizard exposes the same object and mapping review used by database destinations: tables can be disabled, target table names can be changed, and columns can be renamed or skipped. The selected source filter and recordset remain part of each mapping, while the server still forces SQL-file mappings to create-new targets and renders only the reviewed immutable plan.

The source-only IPC resolves the selected source session and schema, validates an optional registered target dialect, enriches target-native types through the adapter contract, and never opens or trusts a target database. Empty table payloads retain the legacy server-discovered-table behavior. Changing the SQL dialect clears inspected mappings so target-native overrides cannot leak across dialects; preview back navigation returns to the mapping step.

Independent verification passed source-only inspect 1/1, related Data Transfer Rust 94/94, frontend transfer tests 35/35, TypeScript, formatting and diff checks. The integration branch reproduced Data Transfer 94/94 and frontend 35/35. The formal `CI=true pnpm tauri:build:webdriver` pipeline passed with PostgreSQL/MySQL/SQLite/Redis injection and macOS App/DMG packaging. Live database journeys and Windows publication remain deferred in this environment.

This gate closes per-table and per-column review for SQL-file output for the covered registered adapters. It does not add reusable target profiles/history, code-page/UTF-16 encodings, compression, resumable checkpoints, composite recordset ranges or broader driver coverage.

## Data Transfer profile release gate (2026-09-21)

The reusable-profile wave is integrated in commit `e7c66a6e`. Data Transfer profiles are versioned persisted records containing connection IDs, qualified database/schema settings, destination mode, SQL-file dialect/encoding/scope, table mappings, filters/recordsets and execution options. Runtime `dbSessionId` values, credentials and native SQL-file `fileToken` values are excluded; loading a SQL-file profile requires choosing a new destination file and then re-inspects the source with the saved mappings.

The host exposes get/save/delete profile IPC with connection-existence validation and rejects unsupported versions, unknown fields and invalid destination/options. The Data Transfer window can save the current reviewed configuration, load it back into the endpoints/setup state, restore mappings after source inspection, and clears stale previews. Existing empty-table SQL-file payload compatibility remains intact.

Independent verification passed profile-focused Rust command/store tests 24/24, Data Transfer command/frontend tests 37/37, TypeScript, formatting and diff checks. The formal `CI=true pnpm tauri:build:webdriver` pipeline passed with PostgreSQL/MySQL/SQLite/Redis injection and macOS App/DMG packaging. Subsequent Sync and Schema Diff profile waves plus shared run-history and host-owned workflow execution are integrated in the same branch; live database and Windows-specific checks remain environment limits.

This gate closes repeatable Data Transfer setup persistence. It does not add unattended scheduling, resumable checkpoints, profile sharing/encryption beyond the existing local store, or profiles for migration features outside the reviewed trio.

## Schema Diff target-only table picker release gate (2026-09-21)

The target-only picker wave is integrated after implementation `d02f0e0f` and independent verification `ac0a124c`/`94049488`. Schema Diff now merges source and target table inventories by qualified relation identity, keeps target-only tables unchecked by default, and carries the exact target endpoint selector through the picker, comparison, profile, workflow and plan IPC contracts. An explicitly selected target-only table reads its real target schema and produces one reviewed `DropTable` operation; it never fabricates an empty source schema.

Destructive approval remains required, and reviewed plans retain target snapshots so review and deploy revalidate the target before execution. Invalid identifiers, unknown drivers, missing targets and stale target snapshots fail closed. Existing source-only and mixed table flows retain their endpoint-qualified selectors.

Independent verification passed 6 Vitest files/49 tests, including picker defaults, qualified selectors, destructive reject/allow, reviewed snapshots, profile round-trip and workflow-compatible validation; focused Schema Diff Rust passed 96/96, TypeScript, changed-file rustfmt and diff checks passed, and the integrated full Host Rust suite passed 1645 with 3 ignored. Live database/WebDriver coverage for this slice remains deferred.

This gate closes explicit target-only table selection for Schema Diff. CHECK constraints, table options, sequence translation, cross-dialect view translation, Windows packaging validation and broader driver coverage remain open parity work.

## Schema Diff CHECK constraint release gate (2026-09-21)

The CHECK constraint wave is integrated after implementation `d60ab3d5`, parser hardening `2426b710`, and independent verification `300e91f9`. The dialect-neutral schema IR now carries named CHECK constraints through comparison, reviewed snapshots and migration operations. PostgreSQL and MySQL read and render safe add/drop statements with rollback metadata; changed predicates become a reviewed drop/add pair. SQLite reads CHECK metadata accurately but fails closed for direct changes because applying them requires a table rebuild. Cross-dialect predicate changes are rejected until expression translation exists.

The independent first pass found two parser boundary defects: MySQL default string literals and SQLite comments could be mistaken for CHECK clauses. Both were fixed by skipping quoted text, identifiers and comments before recognition, then verified by a fresh second tester. Final verification passed MySQL 98/98, SQLite 58/58, PostgreSQL 119/119, Driver API 141/141, Host Schema Diff 100/100 and frontend Schema Diff 49/49; the integrated full Host Rust suite passed 1649 with 3 ignored, plus TypeScript, rustfmt and diff checks.

This gate closes CHECK comparison and safe same-dialect rendering for the covered drivers. SQLite table-rebuild support, table-level engine/charset/collation/comment/partition options, sequence translation, cross-dialect view translation, Windows packaging validation and broader driver coverage remain open parity work.

## Schema Diff table-option release gate (2026-09-21)

The table-option wave is integrated after implementation `03644d70`, Redis completeness fix `e693b7fa`, and independent verification `aed5c713`. The dialect-neutral snapshot now carries table comments plus storage engine and default charset. MySQL/MariaDB read these values from `information_schema` and render validated `ALTER TABLE` option changes with rollback metadata. Schema Diff compare, plan, reviewed snapshot, deployment, UI and text export all preserve the reviewed option values. PostgreSQL, SQLite and cross-dialect plans fail closed rather than copying incompatible syntax.

The first independent pass caught a missing `TableOptions` initializer in the Redis driver, which blocked basic Host compilation. The fix was isolated and a fresh tester then passed Driver API 141, MySQL 17, PostgreSQL 17, SQLite 58, Redis 126 (1 ignored), Host Schema Diff 101 and Schema Diff frontend 66; TypeScript, rustfmt and diff checks passed. The integrated full Host Rust suite passed 1650 with 3 ignored.

This gate closes table comments and MySQL/MariaDB engine/charset migration for the covered contract. Collation translation, partitioning, compression, SQLite table rebuilds, sequence translation, cross-dialect view translation, Windows packaging validation and broader driver coverage remain open parity work.

## Schema Diff routine and trigger release gate (2026-09-22)

The routine/trigger wave is integrated after implementation `add22767`, declaration-header hardening `57808124`, identity hardening `982fd5e4`, and independent final verification `d440ee0d`. The shared migration IR now models create, replace and destructive drop for routines and triggers. PostgreSQL and MySQL render same-dialect operations with rollback metadata where it is sound; PostgreSQL routine identity includes its argument signature and trigger identity includes its attached relation. The host reads object definitions only from the server catalog, binds qualified selectors into the reviewed target snapshot, orders dependencies deterministically, and requires explicit destructive approval for removals.

The track intentionally fails closed for cross-dialect changes, SQLite, unsupported object kinds, ambiguous or absent catalog DDL, invalid identifiers, declaration/name/signature mismatches, and stale reviewed targets. The frontend command wrapper exposes the server-owned preparation API; it never accepts client-provided DDL.

Two independent test rounds found three correctness defects before the final pass: executable declaration validation could be bypassed by kind words in comments, strings or quoted identifiers; a requested routine name could occur only in a body or comment; and an overloaded PostgreSQL routine could be accepted with a different argument signature. The fixes scan the executable declaration envelope and validate exact normalized object identity. Final independent verification passed Driver API 145/145, PostgreSQL 121/121, MySQL 102/102, Host Schema Diff 105/105 and frontend wrapper 17/17, with TypeScript, formatting, and diff checks clean. The integration branch full Host suite then passed 1654 tests with 3 ignored. PostgreSQL/MySQL live create/replace/drop journeys remain pending because no database fixtures are available in this environment.

This gate closes safe same-dialect PostgreSQL/MySQL routine and trigger migration for the covered object identities. Sequence translation, cross-dialect view/object translation, broader dependency graphs, live database journeys, and wider driver coverage remain open parity work.
