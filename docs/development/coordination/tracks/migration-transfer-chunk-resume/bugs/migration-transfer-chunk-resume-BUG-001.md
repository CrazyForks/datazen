# BUG-001 — MySQL exact numeric primary-key cursors are rebound as strings

- Status: `修复中` (included in the active repair wave; no fix is claimed by this tester report).
- Severity: P1 — bounded resume can skip source rows when advancing past large or high-precision numeric keys.
- Candidate: `e774e3554a07e889383be02d757395f315e7fdf6`.
- Evidence: source-code review of the MySQL decode/bind and keyset query paths; supported by the MySQL 8.4 Reference Manual.

## Reproduction

1. Create a MySQL source table with an exact numeric primary key, for example `BIGINT UNSIGNED` (or `DECIMAL(30,0)`), and adjacent keys `9007199254740992` and `9007199254740993`.
2. Use Data Transfer bounded resume with a chunk size of one so the first key becomes the next-page cursor.
3. Continue the transfer and compare the destination keys with the source keys. The expected result contains every source key exactly once; a string cursor comparison can round the adjacent numeric values to the same double and exclude a later key from `id > ?`.

This is a code-path finding; the live database journey has not yet independently reproduced the missing-row outcome.

## Code path and cause

- `packages/drivers/mysql/src/type_decode.rs:37-42,95-108` converts BIGINT values outside JavaScript's safe-integer range to `Value::String`; lines 178-182 also decode DECIMAL/NUMERIC as an exact decimal string.
- `src-tauri/src/data_transfer/resume/fingerprint.rs:271-296` preserves the decoded cursor and explicitly accepts `Value::String`.
- `src-tauri/src/data_transfer/resume.rs:144-170` appends that cursor to a keyset predicate of the form `<primary key> > <placeholder>`.
- `packages/drivers/mysql/src/mysql.rs:1583-1589` uses an untyped `?` placeholder and ignores the column type. `packages/drivers/mysql/src/type_decode.rs:45-59` binds `Value::String` as a string parameter.

As a result, a BIGINT above the safe-integer boundary and every DECIMAL cursor reach MySQL as a string operand instead of a typed exact numeric parameter. MySQL's comparison conversion rules make a string/numeric comparison a double-precision comparison; distinct 64-bit integers and high-precision decimal values can collapse to the same approximate value. Since keyset paging requires a strict exact `>` boundary, a later page can omit rows (or otherwise advance incorrectly).

## Official documentation

- MySQL's [type conversion rules for comparisons](https://dev.mysql.com/doc/refman/8.4/en/type-conversion.html) state that a string/numeric comparison uses floating-point (double-precision) values. The same page documents that large integer/float comparisons are approximate and demonstrates distinct 64-bit integers comparing equal.
- MySQL's [numeric type syntax](https://dev.mysql.com/doc/refman/8.4/en/numeric-type-syntax.html) documents the BIGINT signed/unsigned ranges and DECIMAL's maximum precision of 65 digits.
- MySQL's [DECIMAL characteristics](https://dev.mysql.com/doc/refman/8.4/en/precision-math-decimal-characteristics.html) document its exact fixed-point representation and precision.

## Expected behavior

Keyset cursor binds must preserve the source key's exact numeric type and value through MySQL comparison, including signed/unsigned BIGINT and DECIMAL. If the driver cannot bind a key type exactly, the chunk-resume path must fail closed before issuing a token or writing a page. Add real MySQL tests for adjacent values above 2^53 and a high-precision DECIMAL, asserting exact ordered source/destination key equality across multiple pages.
