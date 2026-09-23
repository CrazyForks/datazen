# migration-sync-store-recovery

Phase: PLANNED

## Scope

Safely reclaim orphaned Data Sync comparison-store directories left when DataZen exits before Rust `Drop` runs. Cleanup must prove an entry is stale and must never delete a store held by another live process. Keep private directory/file permissions and avoid following symlinks or deleting unrelated files under the temp root.

Harden the write lifecycle for disk pressure: partial row/index/manifest writes must surface an actionable error, remove the incomplete store, and never publish a runnable plan. Do not introduce an arbitrary small comparison-size cap; use an existing product limit if one exists, or document the concrete capacity policy and its tradeoff before implementing a new limit.

## Acceptance criteria

- [ ] Startup or first-use scavenging removes only positively identified stale Data Sync store directories; concurrent live owners remain intact.
- [ ] Cleanup is bounded, path-confined to the Data Sync temp root, symlink-safe, and best-effort when one stale entry cannot be removed.
- [ ] Tests cover stale owner recovery, an active second owner during scavenging, malformed/unrecognized entries, cleanup errors, and no deletion outside the store root.
- [ ] Simulated row/index/manifest write failures leave no incomplete store and no executable plan; errors identify the storage failure.
- [ ] Existing ComparisonStore format, paging, clone ownership, TTL/claim cleanup, and streaming execution regressions pass.
- [ ] No production unwrap/expect is introduced; Unix and Windows cleanup behavior is considered and tested where feasible.

## E2E registration

- [ ] Lifecycle journey: create a spilled comparison store, simulate an abandoned process-owned directory, then verify the next app start reclaims the orphan without affecting an active store.
- [ ] Disk-pressure/fault journey: inject a storage write failure and assert the plan remains unavailable and private temp files are cleaned.

## Self-validation

- Pending Coder.

## Independent Tester

- Pending fresh Tester; review stale-owner proof and path safety, measure changed-core coverage, rerun focused and full Host checks, and register all bugs before reporting.
