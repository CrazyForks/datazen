# Visual Query Builder

> Status: **v3.2** — canvas + bottom tabs + OK commit, covered by three E2E journeys.
> PRD: [docs/prd/query-builder-prd.md](../prd/query-builder-prd.md)

## Overview

The Visual Query Builder builds a SQL `SELECT` graphically — tables, joins,
columns, aliases, aggregates, WHERE (including nested groups), GROUP BY,
ORDER BY, DISTINCT and LIMIT/OFFSET — and hands the generated statement to the
SQL editor. **It never executes anything itself**; running the query stays the
editor's job.

## How to Access

1. Open a database connection and open a **Query** tab.
2. Toolbar → **More** menu (`query-toolbar-more-menu-trigger`) → **Visual Builder**
   (`more-menu-visual-builder`).
3. The builder **replaces the query content area** (it is not stacked above the
   editor). The left `ConnectionNavigatorTree` stays visible and doubles as the
   builder's object source — the builder has no tree of its own.

Closing: **OK** commits to the editor, **Cancel** / **×** discard and return to
the editor, and the More-menu entry toggles the builder hidden/shown without
discarding (the canvas state survives).

## Layout

```
┌──────────────────────────────────────────────┐
│ header  [title] [DISTINCT] [reset] [⤢] [×]   │
├──────────────────────────────────────────────┤
│ canvas (flex-1, collapsible)                 │
├══ splitter (draggable, persisted) ═══════════┤
│ bottom tabs  [ Build | Preview ]             │
├──────────────────────────────────────────────┤
│ footer                          [Cancel][OK] │
└──────────────────────────────────────────────┘
```

- **Build** and **Preview** are mutually exclusive — only the active tab is
  mounted, which is what keeps the canvas tall enough to work in.
- The splitter between canvas and tabs is draggable; the height persists under
  `localStorage["resize:qb-split-height"]`.
- The canvas collapses from the header button or `Ctrl/Cmd + B`.

## Features

### Table Selection

- Drag a **table or view** from the connection navigator onto the canvas.
  Dragging is the _only_ way a table enters the builder.
- **Clicking** a navigator entry always opens that table's data view, whether or
  not the builder is open — the builder never hijacks navigation.
- New cards are grid-snapped onto the row they were dropped into, so several
  drops line up instead of landing a few pixels apart.

### Table Cards

- **Move** a card by dragging anywhere on it (the header is the natural grab
  point); positions snap to a 24px grid and align to a neighbouring row, so
  cards can be tidied by hand.
- **Remove** a table with the card's `×`. That also drops its selected columns,
  its WHERE conditions (nested ones included), its JOINs, its alias and its
  position — nothing is left referencing a deleted table.
- **Select all columns** with the checkbox in the card header (indeterminate
  when only some are selected). Unchecking clears every column of that table.
- **Alias**: every table gets a default alias as soon as it is added
  (`film_actor` → `fa`, unique per query). The alias field edits it.

> Depends on the desktop runtime forwarding HTML5 drag events to the webview:
> every programmatically created window must call `disable_drag_drop_handler`
> (see [e2e-coverage → macOS 原生拖放验收](../development/e2e-coverage.md)).

### Column Selection

- Toggle individual columns on/off from the table card, or all at once.
- Set column aliases (`AS`).
- Apply aggregate functions: `COUNT`, `SUM`, `AVG`, `MIN`, `MAX`.
- Table aliases are **used everywhere**: the alias is declared once in
  `FROM`/`JOIN` and then qualifies every column in `SELECT`, `WHERE`,
  `GROUP BY`, `ORDER BY` and `ON`. The condition editors label fields with that
  same qualifier, so what the builder shows is what the SQL emits. (Previously
  an alias appeared in `ON` only, which made adding one pointless.)

### JOINs

- Foreign keys between the selected tables are detected automatically and shown
  as **dashed candidates**. Candidates are _not_ in the SQL.
- Click a candidate's **Confirm join** button to promote it; it then renders as
  a solid line and enters the SQL.
- Join types: `INNER`, `LEFT`, `RIGHT`, `FULL`.
- A candidate is dismissed with its `×`.
- Joins are emitted by walking the join graph outward from the `FROM` table, so
  a chained three-table query produces a valid order, repeated pairs merge into
  one `JOIN … ON a AND b`, and the `FROM` table is never re-joined.

### WHERE Conditions

- Two surfaces, both writing the same clause:
  - **Build → column rows**: a per-column `WHERE` button (`CriteriaGrid`).
  - **Build → WHERE editor**: root conditions plus nested groups
    (`qb-where-add-condition` / `qb-where-add-group`), one level of nesting.
- Operators: `=`, `!=`, `>`, `<`, `>=`, `<=`, `LIKE`, `NOT LIKE`, `IN`,
  `NOT IN`, `IS NULL`, `IS NOT NULL`.
- `IN` / `NOT IN` take a comma-separated list; `IS NULL` / `IS NOT NULL` hide
  the value input.
- Nested groups are parenthesised in the generated SQL (`a AND (b OR c)`).

### ORDER BY / GROUP BY / DISTINCT / LIMIT-OFFSET

- Sort by any selected column, `ASC` / `DESC`. Sorting an **aggregated** column
  orders by the aggregate expression (`ORDER BY SUM(x) DESC`), not the bare
  column — the latter is rejected by every engine once the column is aggregated
  but not grouped.
- Group by selected columns; combines with aggregates for summary queries.
- `DISTINCT` toggles at the top of the panel.
- `LIMIT` / `OFFSET` are numeric inputs pinned to the top of the Build tab.
  An offset without a limit emits `OFFSET n` (PostgreSQL/SQLite via `LIMIT -1`;
  MySQL uses its unbounded sentinel) instead of the old `LIMIT 0`, which
  silently returned zero rows.

### Validation

Invalid states are **named and blocked** rather than emitted as confident-looking
SQL. `validateQuery` (`components/query-builder/validation.ts`) reports:

| Diagnostic                                | Blocks OK | Why                                                                                                   |
| ----------------------------------------- | --------- | ----------------------------------------------------------------------------------------------------- |
| `no-tables` / `no-columns`                | yes       | Nothing to build                                                                                      |
| `empty-condition-value`                   | yes       | `col = NULL` is never true                                                                            |
| `empty-in-list`                           | yes       | `IN ()` is a syntax error                                                                             |
| `invalid-limit`                           | yes       | `LIMIT -5` is a syntax error                                                                          |
| `unsupported-pagination`                  | yes       | SQL Server cannot express LIMIT/OFFSET here; dropping it silently would return a different result set |
| `alias-duplicate` / `alias-shadows-table` | yes       | Ambiguous identifier references                                                                       |
| `unknown-join-table` / `self-join`        | yes       | Join cannot be expressed as drawn                                                                     |

Diagnostics appear above the SQL in the Preview tab, dot the Build tab, and
disable OK (with the reason in its tooltip).

Values are typed conservatively: only literals that survive `String(Number(v))`
unchanged are emitted unquoted, so `007` stays `'007'` and `1.50` does not
silently become `1.5`.

### Preview Tab

- Live SQL for the current canvas, with the active dialect badge and a copy
  button.
- Read-only by design: the builder is the single source of truth, so text edits
  belong in the editor after OK.
- A generation problem (for example a table with no columns selected) shows a
  dot on the **Build** tab.

### OK / Cancel

- **OK** writes the generated SQL back, closes the builder and focuses the
  editor:
  - editor empty → written directly;
  - editor content already identical → nothing is rewritten, it just closes;
  - editor content differs → a three-way prompt: **Replace** / **Append** /
    **Keep editor content** (never silently overwritten).
- **Cancel** / **×** roll the canvas back to the snapshot taken when the builder
  opened, asking for confirmation first when the canvas was modified.
- **Reset** clears the canvas but keeps the builder open.

## Keyboard Shortcuts

| Action                   | Shortcut           |
| ------------------------ | ------------------ |
| Collapse / expand canvas | `Ctrl/Cmd + B`     |
| Commit (same as OK)      | `Ctrl/Cmd + Enter` |
| Cancel (asks when dirty) | `Esc`              |

Shortcuts are active only while the builder is visible.

## Supported Operators

| Operator                  | Description                       |
| ------------------------- | --------------------------------- |
| `=`                       | Equal to                          |
| `!=`                      | Not equal to                      |
| `>` / `<` / `>=` / `<=`   | Comparisons                       |
| `LIKE`                    | Pattern match (`%`, `_`)          |
| `NOT LIKE`                | Negated pattern match             |
| `IN` / `NOT IN`           | List membership (comma-separated) |
| `IS NULL` / `IS NOT NULL` | Null checks                       |

## Supported Dialects

| Database   | Identifier Quoting | ILIKE | LIMIT/OFFSET                               |
| ---------- | ------------------ | ----- | ------------------------------------------ |
| PostgreSQL | `"column"`         | ✅    | `LIMIT n OFFSET m` (offset omitted when 0) |
| MySQL      | `` `column` ``     | ❌    | `LIMIT m, n`                               |
| SQLite     | `"column"`         | ❌    | `LIMIT n OFFSET m`                         |
| SQL Server | `[column]`         | ❌    | Not supported in v1                        |
| Generic    | `"column"`         | ❌    | `LIMIT n OFFSET m`                         |

## E2E Coverage

Three journeys, registered in the `query-builder` suite:

```bash
pnpm e2e:qb              # run all three (uses the existing debug build)
pnpm e2e:qb:build        # build first
pnpm e2e:qb:regression   # blast-radius guard: query panel / editor / navigator
```

| Journey             | Spec                                                         | Covers                                                                                                                                                |
| ------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| A — normal          | `e2e/specs/journeys/visual-query-builder-journey.ts`         | open from navigator → columns → tabs → splitter → collapse → WHERE → DISTINCT → OK → execute → reset → close                                          |
| B — abnormal        | `e2e/specs/journeys/visual-query-builder-edge-journey.ts`    | empty state, OK never executes, replace/append/keep conflict paths, cancel rollback, no-relation hint, panel isolation                                |
| C — high complexity | `e2e/specs/journeys/visual-query-builder-complex-journey.ts` | 3-table FK joins + LEFT re-type + aggregate/alias + GROUP BY + ORDER BY + DISTINCT + nested `AND (… OR …)` + IN list + LIMIT/OFFSET, then executes it |

Shared drivers live in `e2e/specs/journeys/visualQueryBuilderHelpers.ts`.

Each journey brings up its **own disposable connection** and seeds its tables
through the live panel. That is deliberate: the runner recreates the worker
database between spec files, so reusing the shared `conn_e2e_pg` config can
hand a spec a session pointing at a database a previous spec just dropped.

## Lifecycle

The builder belongs to the query panel that opened it:

- Closing a query panel **tab** destroys its builder — the next panel starts
  from a blank canvas, never a leftover one.
- Switching tabs does _not_ destroy it: an inactive panel is unmounted, and its
  canvas (plus selected tab and splitter height) is restored when you return.
- Two query panels never share a canvas.

## Architecture

- **State**: Zustand `queryBuilderStore` — canvas state plus panel-scoped view
  state (`openPanelId`, `bottomTab`, `canvasCollapsed`) and an entry snapshot
  used for the dirty check and cancel rollback.
- **SQL generation**: pure `generateSql` in
  `components/query-builder/hooks/useSqlGenerator.ts`.
- **Join ordering**: `generateJoinClause` in `lib/sqlDialects/queryBuilder.ts`.
- **Dialect adaptation**: `QbDialectAdapter`.
- **Integration**: `QueryEditorSection.tsx` hosts the builder and owns the
  commit/focus/toast behaviour; `QueryPanel.tsx` yields the result pane while
  the builder is up.
- **i18n**: all UI text uses `query.visualBuilder.*` (source of truth:
  `src/locales/en/query.ts`).

## Known Limitations

- SQL Server LIMIT/OFFSET not supported (uses TOP/OFFSET-FETCH).
- Subqueries, HAVING, UNION and window functions are not supported.
- Self-joins cannot be expressed (no table alias instances).
- The builder's canvas state is not persisted across app restarts.
