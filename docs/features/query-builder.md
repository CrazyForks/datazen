# Visual Query Builder

> Status: **v1.0** (in development)

## Overview

The Visual Query Builder is a graphical interface for constructing SQL SELECT queries without writing SQL manually. It provides a point-and-click interface for selecting tables, columns, WHERE conditions, ORDER BY, GROUP BY, and aggregate functions.

## How to Access

1. Open a database connection and navigate to the **Query** tab
2. Click the **Visual Builder** button (wand icon) in the toolbar
3. The Visual Query Builder panel appears above the SQL editor

## Features

### Table Selection
- Browse all available tables from the connected database
- Search/filter tables by name
- Select one or more tables for the query

### Column Selection
- View columns for each selected table
- Toggle individual columns on/off
- Set column aliases (AS)
- Apply aggregate functions: COUNT, SUM, AVG, MIN, MAX

### WHERE Conditions
- Add conditions with comparison operators: `=`, `!=`, `>`, `<`, `>=`, `<=`, `LIKE`, `NOT LIKE`, `IN`, `NOT IN`, `IS NULL`, `IS NOT NULL`
- Group conditions with AND/OR logic
- Nest condition groups for complex queries
- Each condition shows table → column → operator → value

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

### Apply SQL
- Click "Apply SQL" to insert the generated SQL into the editor
- The builder panel closes automatically after applying

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

## Known Limitations (v1.0)

- SQL Server LIMIT/OFFSET not supported (uses TOP/OFFSET-FETCH)
- No JOIN support (single-table FROM only in v1)
- No subquery support
- No HAVING clause support
- No window functions
