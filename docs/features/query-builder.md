# Visual Query Builder

> Point-and-click construction of `SELECT` statements: pick tables, columns,
> conditions, sorting, grouping and a row window, then apply the generated SQL.
>
> Source of truth: `src/components/query-builder/`, `src/stores/queryBuilderStore.ts`,
> `src/lib/sqlDialects/queryBuilder.ts`. The E2E journey is
> `e2e/specs/journeys/visual-query-builder-journey.ts`.

## Overview

The Visual Query Builder is a graphical interface for constructing SQL `SELECT`
queries without writing SQL by hand. It covers table selection, column selection
(aliases, aggregates, sorting, grouping), WHERE conditions with AND/OR grouping,
JOINs derived from foreign keys, `DISTINCT`, `LIMIT`/`OFFSET`, and a live SQL
preview.

## How to Access

1. Open a database connection and navigate to the **Query** tab.
2. Open the **More** menu in the query toolbar and choose **Visual Builder**
   (wand icon). There is no dedicated toolbar button.
3. The builder panel appears above the SQL editor.

## Features

### Table Selection

- Tables are added by **dragging them from the connection sidebar's schema tree**
  onto the builder canvas. Dropping a table loads its columns.
- There is no table browser inside the panel; use the sidebar's own search to
  narrow the tree before dragging.
- Multiple tables can be dropped onto the canvas; each renders as a table card
  that can be repositioned by dragging.

### Column Selection

- Click a column inside a canvas table card to include it in the query.
- Selected columns also appear in the criteria grid below the canvas, where each
  row exposes:
  - **Field** — the `table.column` to project
  - **Alias** — optional `AS` alias
  - **Sort** — `ASC` / `DESC`
  - **Func** — aggregate function: `COUNT`, `SUM`, `AVG`, `MIN`, `MAX`
  - **Where** — a per-column quick condition (see below)
  - **Group** — include this column in `GROUP BY`
- Table cards also allow setting a table alias, used for the `FROM` and JOIN
  references.

### WHERE Conditions

Two complementary mechanisms:

1. **Per-column quick condition** — the **Where** cell in the criteria grid opens
   a dialog for a single `column operator value` test.
2. **Conditions panel** — a condition tree under the criteria grid. It supports:
   - any number of conditions, each with its own field / operator / value
   - a per-group **AND** / **OR** toggle
   - **one level of nested groups**, so a group can be combined with the rest
     using the opposite operator
   - adding and removing individual conditions and nested groups

   Per-column quick conditions are merged into the same tree at generation time,
   so both mechanisms appear in one `WHERE` clause.

### JOINs

- Foreign-key relationships between the selected tables are **detected
  automatically** and drawn as dashed lines on the canvas.
- An auto-detected JOIN's type can be changed (`INNER` / `LEFT` / `RIGHT` /
  `FULL`) and it can be removed; a removal is remembered for the session so the
  JOIN is not re-detected.
- Auto-detected JOINs are part of the generated SQL, so the canvas and the SQL
  preview always agree.
- **Manually specifying an ON condition between arbitrary columns is not
  implemented** (see Known Limitations).

### ORDER BY

- Set **Sort** on any selected column in the criteria grid to `ASC` or `DESC`.

### GROUP BY

- Tick **Group** on the columns to group by. Combine with **Func** on other
  columns for aggregate queries.

### DISTINCT

- The `DISTINCT` checkbox in the panel header toggles duplicate elimination.

### LIMIT / OFFSET

- Row-window inputs sit in the panel footer. Leaving a field blank omits its
  clause; clearing a field removes it again.
- Row-window availability is a **driver capability**, not a dialect guess: a
  driver declares `supportsOffset: false` in its `DatabaseTypeMeta` (mirroring
  its Rust `supports_offset()`), and the panel disables the inputs for it. The
  generator honours the same declaration, so a disabled control can never leave
  a stray clause in the SQL. SQL Server is the one host driver that opts out —
  T-SQL spells pagination `OFFSET … FETCH`, which is only legal together with an
  `ORDER BY` the builder cannot guarantee.

### SQL Preview

- A live preview of the generated statement. It is hidden while the query is
  incomplete (no tables or no columns selected).

### Apply SQL

- Writes the generated SQL into the editor and closes the panel.

### Reset

- Clears the query (tables, columns, conditions, joins, sorting, grouping, row
  window) but **keeps the panel open** so the user can start over in place.

### Close

- The header close button hides the panel. State is retained, so reopening the
  builder shows the previous query.

## Supported Operators

| Operator | Description |
|----------|-------------|
| `=` | Equal to |
| `!=` | Not equal to |
| `>` | Greater than |
| `<` | Less than |
| `>=` | Greater than or equal to |
| `<=` | Less than or equal to |
| `LIKE` | Pattern match (supports `%` and `_` wildcards) |
| `NOT LIKE` | Negated pattern match |
| `IN` | Value is in a list (comma-separated) |
| `NOT IN` | Value is not in a list |
| `IS NULL` | Value is NULL |
| `IS NOT NULL` | Value is not NULL |

## Supported Dialects

| Database | Identifier Quoting | ILIKE | LIMIT/OFFSET |
|----------|-------------------|-------|--------------|
| PostgreSQL | `"column"` | ✅ | `LIMIT n OFFSET m` |
| MySQL | `` `column` `` | ❌ | `LIMIT m, n` |
| SQLite | `"column"` | ❌ | `LIMIT n OFFSET m` |
| SQL Server | `[column]` | ❌ | Not supported (needs `TOP` / `OFFSET … FETCH`) |
| Generic | `"column"` | ❌ | `LIMIT n OFFSET m` |

## Known Limitations

- **No manual JOIN creation.** JOINs come from detected foreign keys only; there
  is no UI for an arbitrary ON condition between two columns.
- **One level of condition nesting.** Deeper nesting is representable in the
  store and handled by the generator, but the UI caps the tree at two levels.
- **No subquery support.**
- **No HAVING clause support**, so aggregates cannot be filtered after grouping.
- **No window functions.**
- **SQL Server row windows are not generated** (`TOP` / `OFFSET … FETCH`).

## Architecture

- **State**: Zustand store (`src/stores/queryBuilderStore.ts`) holds all builder
  state, including the WHERE tree and the detected auto-JOINs.
- **SQL generation**: pure function in
  `src/components/query-builder/hooks/useSqlGenerator.ts`, exposed through the
  `useSqlGenerator` hook.
- **Dialect adaptation**: `src/lib/sqlDialects/queryBuilder.ts` handles
  per-database quoting, `ILIKE`, `IN`, `IS NULL` and `LIMIT`/`OFFSET`.
- **Types**: `src/components/query-builder/types.ts`.
- **Integration**: toolbar entry in `QueryToolbarMoreMenu.tsx`; the panel is
  mounted from `QueryEditorSection.tsx`.
- **i18n**: user-facing strings use `query.visualBuilder.*` keys from
  `src/locales/<locale>/query.ts`.

## Screenshots

<!-- TODO: Add screenshots -->
<!-- ![Query Builder Panel](./screenshots/query-builder-panel.png) -->
<!-- ![Conditions](./screenshots/query-builder-conditions.png) -->
