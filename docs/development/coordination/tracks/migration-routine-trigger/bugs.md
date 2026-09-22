# migration-routine-trigger bugs

## migration-routine-trigger-BUG-001 — object DDL kind validation is fail-open

- 状态：已修复（最终独立复测）
- 描述：`validate_object_definition` uses an unrestricted `contains` check for
  `FUNCTION` / `PROCEDURE` / `TRIGGER`. A `CREATE VIEW` whose body contains the
  relevant word inside a string literal is accepted as a routine or trigger
  definition. This violates the track's malformed-DDL fail-closed contract.
- 重现：run
  `cargo test -p datazen-driver-api --lib test_tester_object_definition_requires_kind_in_create_header`.
  The test passes `CREATE VIEW calculate_total AS SELECT 'FUNCTION' AS marker`
  as a function and `CREATE VIEW audit_insert AS SELECT 'TRIGGER' AS marker`
  as a trigger; both must be rejected, but the current validator accepts the
  first input and the test fails.
- 实测：the full Driver API suite reports **142 passed, 1 failed**, with the
  failure at `schema_migration.rs:518` asserting that the view-shaped DDL is
  rejected.
- 影响：a malformed or incorrect driver DDL response can enter the
  routine/trigger planner, be rendered as an object migration, and reach the
  reviewed deployment flow under a misleading summary. The validator must
  inspect the `CREATE [OR REPLACE] <kind>` envelope outside literals/comments,
  not merely search the complete definition for a token.

### 修复记录

- `validate_object_definition` now lexes the executable declaration header,
  ignores quoted strings and SQL comments, supports PostgreSQL
  `CREATE [OR REPLACE]` and MySQL `DEFINER=...` forms, and rejects object-kind
  words that occur only in a view body or comment.
- Added string and comment regression cases. Awaiting a fresh independent
  Tester re-run.

### 第二轮复测

- `test_tester_object_definition_requires_kind_in_create_header` passed as
  part of the full Driver API suite. PostgreSQL `CREATE OR REPLACE` and MySQL
  `DEFINER` declaration forms are covered by the new tester regression below.
- The final independent re-test also covers kind words in backtick, double
  quote, and bracket identifiers; all must remain outside the declaration
  header.

## migration-routine-trigger-BUG-002 — requested routine name is accepted from a body or comment

- 状态：已修复（最终独立复测）
- 描述：after BUG-001, `validate_object_definition` verifies the declaration
  kind but still searches the whole DDL text for the requested object name. A
  driver response for `other_name` is accepted as `wanted_name` when that
  requested name appears only in a dollar-quoted body literal or a trailing
  SQL comment.
- 重现：run
  `cargo test -p datazen-driver-api --lib test_tester_object_definition_requires_requested_name_in_declaration`.
  The tester cases submit `CREATE OR REPLACE FUNCTION other_name ... SELECT
'wanted_name'` and `CREATE FUNCTION other_name ... -- wanted_name` while
  asking for `wanted_name`; both must be rejected. Valid PostgreSQL `CREATE OR
REPLACE` and MySQL `DEFINER` function/procedure/trigger declarations using
  `wanted_name` are asserted in the same test.
- 实测：full Driver API suite reports **143 passed, 1 failed**. The new
  assertion at `schema_migration.rs:655` fails because the unrelated function
  is accepted.
- 影响：a catalog/driver response for a different same-kind object can enter a
  reviewed routine/trigger migration plan under the requested identity. The
  renderer can therefore deploy a definition that does not belong to the
  selected object.
- 修复要求：extract the declared object identifier from the executable
  `CREATE` envelope (outside quoted literals/comments) and require it to match
  the requested name; do not use a whole-definition substring/token search.

### 修复记录

- `validate_object_definition_with_identity` now extracts the terminal
  declaration identifier from the executable `CREATE` header and compares it
  with the requested object name. Body literals and trailing comments cannot
  satisfy the identity check. PostgreSQL `OR REPLACE` and MySQL `DEFINER`
  envelopes remain supported.
- Driver API regression and PostgreSQL/MySQL renderer regressions pass. The
  final independent re-test passed, including a requested name present only in
  a body literal or trailing comment.

## migration-routine-trigger-BUG-003 — PostgreSQL overload signature is not verified against source DDL

- 状态：已修复（最终独立复测）
- 描述：the routine planner carries `signature` in its identity key, but DDL
  validation accepts a declaration for another overload that has the same
  routine name. For a selected `public.lookup(integer)`, a returned `CREATE
FUNCTION lookup(text)` is planned as an executable create/replace operation.
- 重现：run
  `node scripts/with-driver-inject.mjs --drivers=basic -- cargo test -p datazen --lib schema_diff::objects::tests::test_tester_overloaded_routine_definition_must_match_requested_signature`
  (with the temporary ignored `src-tauri/resources/builtin-ep` directory used
  for the Tauri build). The test constructs a `lookup(integer)` snapshot with
  `lookup(text)` DDL and requires a fail-closed unsupported requirement.
- 实测：injected Host Schema Diff suite reports **104 passed, 1 failed**. The
  tester assertion at `objects.rs:1091` fails because the plan has an
  executable statement.
- 影响：the reviewed identity can name one overload while its SQL creates or
  replaces another. Subsequent drop/rollback SQL uses the selected overload
  identity, which can make the deployment mutate the wrong pair of routines.
- 修复要求：for routines with a signature, parse or driver-validate the
  executable declaration arguments against the selected identity using
  dialect-aware canonicalization. If an exact match cannot be established,
  return an unsupported requirement rather than rendering SQL.

### 修复记录

- Routine validation now extracts declaration parameters and compares them
  with the selected routine signature after safe whitespace, mode, default,
  and nested-type normalization. An unverified or mismatched signature is
  rejected before plan statements or renderer SQL are produced.
- The injected Host overload regression and focused renderer regressions pass.
  The final independent re-test confirmed a `lookup(integer)` selection fails
  closed when the source DDL declares `lookup(text)`.
