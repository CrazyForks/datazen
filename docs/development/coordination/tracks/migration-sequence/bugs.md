# migration-sequence bugs

## migration-sequence-BUG-001 — sequence identity validator mishandles legal PostgreSQL quoted identifiers

- 描述：`validate_sequence_definition_with_identity` tokenizes quoted identifiers
  without restoring doubled double-quotes, compares identifiers after forcing
  ASCII uppercase, and rejects comment-like text before lexical analysis. This
  makes legal `quote_ident` output fail closed for names containing `"`, `--`,
  `/*`, `#`, or apostrophes, while allowing a wrong case in a quoted identity.
- 量级：P1，PostgreSQL sequence create/replace/drop cannot migrate valid
  schema-qualified objects using these names, and a mismatched quoted identity
  can pass validation and reach reviewed SQL rendering.
- 状态：待修复
- 重现步骤：
  1. Run `cargo test --offline --manifest-path tracks/migration-sequence/tests/Cargo.toml`.
  2. Observe the tester cases
     `test_tester_sequence_validator_accepts_quote_ident_escaped_names`,
     `test_tester_sequence_validator_accepts_comment_like_quote_ident_name`,
     and `test_tester_sequence_validator_rejects_case_mismatch_in_quoted_identity`.
  3. The first two pass catalog-shaped legal DDL with names `sales"team`,
     `order"id`, and `a--b`; the third passes lower-case DDL while requesting
     quoted identities `Public` and `Orders_Id_Seq`.
- 实测错误日志：the independent tester crate reports **0 passed, 3 failed**;
  errors are `sequence definition identity does not match the catalog object`,
  `sequence definition contains unsupported literal or comment syntax`, and
  an assertion that the case-mismatched identity must be rejected.
- 影响范围：Driver API sequence DDL validation, PostgreSQL renderer and Host
  sequence planner. The affected legal names are not limited to synthetic
  client input because the catalog query uses PostgreSQL `quote_ident`.

## migration-sequence-BUG-002 — sequence replacement is reported as completely rollbackable

- 描述：`ReplaceSequence` drops and recreates the sequence. Its renderer
  returns a rollback script made from the original CREATE definition, and the
  Host planner marks rollback completeness solely from the presence of
  `rollback_sql`. A CREATE definition contains `START WITH` and mutable
  attributes but not the current `last_value`, so replacement cannot restore
  the sequence counter state. The operation comment explicitly says it must
  not claim complete rollback, but the current plan does so.
- 量级：P1，`requireRollback` can approve a destructive sequence replacement
  whose rollback loses the pre-change counter state; a failed later statement
  can therefore leave sequence values altered after rollback.
- 状态：待修复
- 重现步骤：
  1. Run `cargo test --offline --manifest-path tracks/migration-sequence/tests/Cargo.toml`.
  2. Observe `test_tester_sequence_replace_does_not_claim_counter_state_rollback`.
  3. The test renders a valid replacement changing `INCREMENT BY 1` to `10`
     and requires no complete rollback claim.
- 实测错误日志：the independent tester crate reports the assertion
  `replace resets last_value and cannot provide a complete rollback`; the
  renderer returns `Some("DROP SEQUENCE ...; CREATE SEQUENCE ...")`.
  The Host planner then computes `rollback_completeness.complete` from that
  non-`None` value at `src-tauri/src/schema_diff/objects.rs:981-998`.
- 影响范围：PostgreSQL sequence replacement, reviewed deploy rollback gate,
  and any profile or IPC deployment using `requireRollback=true`.
