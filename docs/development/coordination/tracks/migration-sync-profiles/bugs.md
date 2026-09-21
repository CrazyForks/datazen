# migration-sync-profiles bugs

## migration-sync-profiles-BUG-001

- **级别**：P1
- **描述**：`Store::ensure_sync_profiles_loaded` treats the whole `sync_profiles.json` array as invalid when any one record has an unknown field or unsupported version. The implementation filters only after deserializing `Vec<SyncProfile>`, so one corrupt/stale profile causes valid profiles in the same file to disappear.
- **状态**：已修复
- **重现步骤**：
  1. Write `sync_profiles.json` with one valid version-1 profile and one record containing an unknown field (or version `99`).
  2. Initialize `Store` and call `get_sync_profiles()`.
  3. Observe that the returned list is empty instead of containing the valid profile.
- **实测错误日志**：Tester regression `store::tests::sync_profiles_filter_invalid_records_on_load` failed: `assertion left == right failed; left: 0; right: 1`.
- **影响范围**：A single malformed or future-version profile can hide every valid saved Data Sync profile. Users lose access to reusable configurations until the file is repaired or rewritten.

## Second-round retest

- The loader now parses each array record independently and retains valid profiles alongside unknown-field, unsupported-version, `null`, and scalar records.
- Regression coverage also verifies that save and delete continue to operate after mixed-record loading.
- Retested in `migration-sync-profiles` worktree; no new defects found.
