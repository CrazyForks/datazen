# Visual Query Builder

> Status: **v1.0** (in development)

## Overview

The Visual Query Builder is a graphical interface for constructing SQL SELECT queries without writing SQL manually. It provides a point-and-click interface for selecting tables, columns, WHERE conditions, ORDER BY, GROUP BY, and aggregate functions.

## How to Access

1. Open a database connection and navigate to the **Query** tab
2. Click the **Visual Builder** button (wand icon `WandSparkles`) in the toolbar, located between the NL2SQL and More menus
3. The Visual Query Builder panel appears above the SQL editor

<!-- TODO: Screenshot — toolbar button highlighted -->

## Features

### Table Selection
- Browse all available tables from the connected database
- Search/filter tables by name
- Select one or more tables for the query

<!-- TODO: Screenshot — tables panel with search and selection -->

### Column Selection
- View columns for each selected table
- Toggle individual columns on/off
- Set column aliases (AS)
- Apply aggregate functions: COUNT, SUM, AVG, MIN, MAX

<!-- TODO: Screenshot — columns with alias and aggregate options -->

### WHERE Conditions
- Add conditions with comparison operators: `=`, `!=`, `>`, `<`, `>=`, `<=`, `LIKE`, `NOT LIKE`, `IN`, `NOT IN`, `IS NULL`, `IS NOT NULL`
- Group conditions with AND/OR logic
- Nest condition groups for complex queries (one level of nesting in v1)
- Each condition shows table → column → operator → value

<!-- TODO: Screenshot — conditions with nested groups -->

### ORDER BY
- Sort results by any selected column
- Toggle ascending (ASC) / descending (DESC)

### GROUP BY
- Group results by selected columns
- Works with aggregate functions for summary queries

### DISTINCT
- Toggle DISTINCT to eliminate duplicate rows

### SQL Preview
- Live preview of the generated SQL statement
- Syntax-highlighted code block

<!-- TODO: Screenshot — SQL preview panel -->

### Apply SQL
- Click "Apply SQL" to insert the generated SQL into the editor
- The builder panel closes automatically after applying

### Reset
- Click "Reset" to clear all selections and start over

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
| SQL Server | `[column]` | ❌ | Not supported in v1 |
| Generic | `"column"` | ❌ | `LIMIT n OFFSET m` |

## Keyboard Shortcuts

| Action | Shortcut |
|--------|----------|
| Toggle Visual Builder | Click toolbar button |
| Apply SQL & Close | Click "Apply SQL" button |

## Screenshots

<!-- TODO: Add screenshots after UI implementation is complete -->
<!-- ![Query Builder Panel](./screenshots/query-builder-panel.png) -->
<!-- ![Table Selection](./screenshots/query-builder-tables.png) -->
<!-- ![WHERE Conditions](./screenshots/query-builder-conditions.png) -->

## Architecture

- **State**: Zustand store (`queryBuilderStore`) manages all builder state
- **SQL Generation**: Pure function (`useSqlGenerator` hook) converts state to SQL
- **Dialect Adaptation**: `QbDialectAdapter` handles per-database SQL differences
- **Types**: Shared type definitions in `src/components/query-builder/types.ts`
- **Integration**: Toolbar button and panel render wired in `QueryEditorSection.tsx`
- **i18n**: All UI text uses `query.visualBuilder.*` keys (source of truth: `en/query.ts`)

## Known Limitations (v1.0)

- SQL Server LIMIT/OFFSET not supported (uses TOP/OFFSET-FETCH)
- No JOIN support (single-table FROM only in v1)
- No subquery support
- No HAVING clause support
- No window functions
