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

- **Manual JOINs are created column to column.** Click a column name on one
  table card to arm it, then click a column on a *different* table card. The
  armed column is highlighted and a banner names it; the second click creates an
  `INNER JOIN` between exactly those two columns.
- The armed state always has an exit: clicking the same column again, pressing
  <kbd>Esc</kbd>, or using the banner's cancel button disarms it. Clicking a
  second column of the *same* table moves the anchor rather than self-joining.
  Removing a table from the canvas disarms an anchor on it.
- Manual JOINs render as solid lines (auto-detected ones are dashed) and take
  precedence over an auto-detected JOIN covering the same column pair, so the
  pair never appears twice.
- Every JOIN's type can be changed (`INNER` / `LEFT` / `RIGHT` / `FULL`) from its
  label, and it can be removed. Removing an auto-detected JOIN is remembered for
  the session so it is not re-detected.
- JOINs — auto and manual alike — are part of the generated SQL, so the canvas
  and the SQL preview always agree.

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
- Row-window availability is a **driver capability**, not a dialect guess.
  `LIMIT`/`OFFSET` is standard SQL, so the declaration is **opt-out**: a driver
  that says nothing supports it, and only an explicit
  `supportsOffset: false` in its `DatabaseTypeMeta` (mirroring its Rust
  `supports_offset()`) turns it off. The panel disables the inputs for such a
  driver, and the generator honours the same declaration, so a disabled control
  can never leave a stray clause in the SQL.
- SQL Server is the one host driver that opts out: T-SQL has no `LIMIT`/`OFFSET`
  spelling, and its `OFFSET … FETCH` form is only legal together with an
  `ORDER BY` the builder cannot guarantee.
- Dialect families carry **syntax only** (`LIMIT n OFFSET m` vs `LIMIT m, n`);
  they never grant or deny the feature.

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
| SQL Server | `[column]` | ❌ | Not supported (`supportsOffset: false`) |
| Generic | `"column"` | ❌ | `LIMIT n OFFSET m` |

## Known Limitations

- **One level of condition nesting.** Deeper nesting is representable in the
  store and handled by the generator, but the UI caps the tree at two levels.
- **No subquery support.**
- **No HAVING clause support**, so aggregates cannot be filtered after grouping.
- **No window functions.**
- **SQL Server row windows are not generated.** T-SQL spells pagination
  `OFFSET … FETCH`, which is only legal with an `ORDER BY` the builder cannot
  guarantee, so the driver declares `supportsOffset: false` and the controls stay
  disabled rather than emitting a clause the server would reject.
- **A manual JOIN is always between two columns.** Composite keys must be joined
  one column pair at a time, and a JOIN cannot be given extra ON predicates.

## Architecture

- **State**: Zustand store (`src/stores/queryBuilderStore.ts`) holds all builder
  state, including the WHERE tree and the detected auto-JOINs.
- **SQL generation**: pure function in
  `src/components/query-builder/hooks/useSqlGenerator.ts`, exposed through the
  `useSqlGenerator` hook.
- **Dialect adaptation**: `src/lib/sqlDialects/queryBuilder.ts` handles
  per-database quoting, `ILIKE`, `IN`, `IS NULL` and `LIMIT`/`OFFSET`.
- **Types**: `src/components/query-builder/types.ts`.
- **Integration**: entry in `QueryToolbarMoreMenu.tsx`; the panel is mounted from
  `QueryEditorSection.tsx`.
- **Schema data source — shared with the editor.** The editor and the builder are
  **peers**: neither imports the other, and the data they share lives below both
  in `src/lib/relationMetadata` (+ `src/stores/schemaStoreSelectors.ts` as the
  store-layer facade). `pnpm test:layers` fails if either starts importing the
  other, or if the shared layer reaches back up.

  The builder owns no schema cache of its own:
  - **Columns** come from the schema store's `columnMap`, read for the panel's
    own `dbSessionId` (not the globally active session). This is the same map the
    editor's completion namespace is built from, and the panel warms it with the
    same `ensureColumns` call the editor uses.
  - **Foreign keys** come from the shared relation-metadata cache
    (`lib/relationMetadata/metadataCache`) through `useMetadataSnapshot`. The
    panel queues its selected tables with
    `ensureTableRelations`, which builds relation identities exactly as
    `QueryPanel` does, so both sides resolve one physical table to one cache
    entry.
  - Sharing that cache is what makes a DDL refresh visible to the builder: it
    subscribes to `subscribeSchemaInvalidation`, so a constraint
    added by a statement the user just ran reaches the auto-JOIN detection. A
    private cache would have kept serving stale foreign keys.
  - Relations are resolved by the exact cache key the shared layer derives, *not*
    through the editor's `findRelationMetadata` fuzzy resolver: that resolver's
    bare-name fallback is right for completion but would let a same-named table
    in another schema match, generating a JOIN against the wrong table. Missing a
    relation is recoverable — a manual JOIN can be drawn.
- **i18n**: user-facing strings use `query.visualBuilder.*` keys from
  `src/locales/<locale>/query.ts`.

## Screenshots

<!-- TODO: Add screenshots -->
<!-- ![Query Builder Panel](./screenshots/query-builder-panel.png) -->
<!-- ![Conditions](./screenshots/query-builder-conditions.png) -->
