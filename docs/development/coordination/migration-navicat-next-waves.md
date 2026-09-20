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
