# Bugs and boundaries

- Filters are intentionally symmetric across the matched source and target
  columns. A source-only predicate would make target-only rows look like delete
  candidates and could remove rows outside the requested scope.
- The current contract supports same-name columns only. Mapped or renamed key
  columns remain outside this track and must use a later explicit mapping
  contract.
- Filter values remain server-side parameters; preview text uses anonymous
  placeholders and never interpolates user values.

## Independent verification (2026-09-20)

No defect was reproduced in the Rust filter, keyset, plan-fingerprint, or
frontend test coverage. The final pass also completed the full host Rust suite,
Sync frontend tests, TypeScript checking, and the formal WebDriver build. A
live PostgreSQL filter journey was not rerun in this environment because the
read-only fixture password is unavailable; the existing track record contains
the prior live journey evidence. The unsupported SQLite V1 family gate is an
existing product boundary, not a regression in this track.
