---
title: "Write INSERT Statements in Seconds: Alt+Enter Smart Intent Actions"
description: "DataZen's SQL smart editor triggers context-aware intent menus via Alt+Enter, supporting star expansion, INSERT template generation, qualifier additions, subquery wrapping, and more to dramatically boost SQL writing efficiency."
date: 2026-09-20
slug: alt-enter-intentions
keywords:
  - SQL smart editing
  - Code intentions
  - Alt+Enter
  - INSERT template
---

# Write INSERT Statements in Seconds: Alt+Enter Smart Intent Actions

When writing SQL, have you ever found yourself in this situation: you want to write an `INSERT INTO` statement, but the table has a dozen or more fields and you have to type each column name one by one, then fill in each value one by one — and if you're not careful, you'll mistype a column name or forget a comma.

This kind of repetitive work is not only tedious, it's also extremely error-prone. Especially when table structures change frequently, manually maintaining INSERT statements can be pure torture.

DataZen's SQL editor comes with a built-in "smart intent" system. With a single shortcut key — `Alt+Enter` — you can trigger context-sensitive operation suggestions at the cursor position. This isn't simple code completion; it actually understands what you're writing and helps you finish the most tedious part.

## Alt+Enter Triggers the Intent Menu

In DataZen's SQL editor, you don't need to select any text — just place the cursor anywhere, press `Alt+Enter`, and the editor analyzes the current context and pops up a context-sensitive operation suggestion menu.

This menu intelligently determines what operation you might need based on your cursor position, the SQL statement you're currently editing, and the database's schema information.

## Star Expansion: SELECT * Is No Longer a Bad Habit

Writing `SELECT * FROM _blog_employee` feels great, but in practice you rarely need every column. The problem is, manually replacing `*` with a long list of column names is just too tedious.

In DataZen, place the cursor on the asterisk in `SELECT *` and press `Alt+Enter` — the editor automatically expands it to all column names:

```sql
-- Before expansion
SELECT * FROM _blog_employee

-- After expansion
SELECT id, name, email, salary, dept_id, is_active, hire_date, created_at, updated_at FROM _blog_employee
```

![Star expansion](https://raw.githubusercontent.com/flyxl/datazen/main/site/assets/blog/06-intention-star-expand.png)

After expansion, you can delete any columns you don't need — at least ten times faster than typing them out. And the column names are fetched in real time from the database schema, so there's no risk of typos.

## INSERT Template: Say Goodbye to Column Name Hell

This is probably the most practical use case for `Alt+Enter`.

Normally, to write an INSERT statement you first need to look up the table structure, note all column names and types, then manually piece together the complete statement. If the table has a dozen fields, typing the column names alone takes several minutes.

In DataZen, simply type `INSERT INTO _blog_employee ()`, place the cursor inside the parentheses, and press `Alt+Enter` — the editor automatically expands it into a complete INSERT template:

```sql
-- Before expansion
INSERT INTO _blog_employee ()

-- After expansion
INSERT INTO _blog_employee (
    id,
    name,
    email,
    salary,
    dept_id,
    is_active,
    hire_date,
    created_at,
    updated_at
) VALUES (
    /* id */ NULL,
    /* name */ '',
    /* email */ '',
    /* salary */ 0,
    /* dept_id */ NULL,
    /* is_active */ TRUE,
    /* hire_date */ NOW(),
    /* created_at */ NOW(),
    /* updated_at */ NOW()
);
```

![INSERT template expansion](https://raw.githubusercontent.com/flyxl/datazen/main/site/assets/blog/06-intention-insert-template.png)

Each value comes with a column name comment, and the types are intelligently inferred: strings use empty string placeholders, numbers use 0, and datetime fields use `NOW()`. You just need to replace the placeholder values with actual data.

Even better, if you only want to insert certain columns, just delete the unwanted columns and their corresponding values after expansion — far more efficient than starting from scratch.

![INSERT column selection](https://raw.githubusercontent.com/flyxl/datazen/main/site/assets/blog/06-intention-insert-columns.png)

## Adding and Removing Qualifiers

When writing complex queries, you often need to add table alias prefixes to column names, like `e.name` instead of `name`. If you need to add or remove these prefixes in bulk, doing it manually is tiring and easy to miss spots.

In DataZen, place the cursor on a column name and press `Alt+Enter` to quickly add or remove a table alias prefix:

- Add: `name` → `e.name`
- Remove: `e.name` → `name`

In multi-table JOIN queries, this feature is especially useful — quickly qualify all columns to avoid "ambiguous column" errors.

## Subquery Wrapping

Sometimes you want to wrap a plain expression into a subquery, for example turning `SELECT id FROM _blog_employee WHERE is_active = 1` into `SELECT * FROM (SELECT id FROM _blog_employee WHERE is_active = 1) AS subquery`.

In DataZen, select the SQL fragment you want to wrap, press `Alt+Enter`, and choose "Wrap as subquery" — the editor automatically adds the outer `SELECT * FROM (...) AS subquery` structure for you.

## Function Signature Hints

When writing SQL functions, do you often forget the parameter order? For example, is `SUBSTRING` `(str, start, length)` or `(str, length, start)`?

In DataZen, after typing a function name and the opening parenthesis `(`, the editor automatically shows a function signature hint displaying parameter names and types:

![Function signature hint](https://raw.githubusercontent.com/flyxl/datazen/main/site/assets/blog/06-signature-help.png)

For unfamiliar functions, this saves you from looking up documentation. For familiar functions, it helps confirm parameter order and avoid careless mistakes.

## Live Demo

Let's put all the features together in a real development scenario.

Suppose you're writing a bulk import script for an employee management system:

**Step 1**: Type the table name and use `Alt+Enter` to expand the INSERT template — no need to look up column names.

**Step 2**: Delete fields that don't need auto-population (like the auto-incrementing `id`).

**Step 3**: Type `SELECT *` to query the department table, use `Alt+Enter` to expand the columns, and quickly select the ones you need.

**Step 4**: Add `d.` prefixes to column names to avoid ambiguity in multi-table JOINs.

The entire process — from "I think the employee table has about a dozen fields" to "a complete INSERT...SELECT statement" — takes just two or three minutes.

That's the value of smart intentions — it doesn't write SQL for you, but it helps you skip the repetitive, boring, error-prone mechanical work so you can focus on business logic.

## Final Thoughts

The intelligence level of a SQL editor directly impacts your work efficiency. DataZen's `Alt+Enter` intent system covers the most common pain points in daily SQL writing — from star expansion to INSERT templates, from qualifier management to subquery wrapping.

Combined with function signature hints and real-time completion, you can put more energy into thinking about business logic rather than wrestling with the editor.

---

**[Download DataZen Now](https://flyxl.github.io/datazen/download.html)** · [GitHub Source Code](https://github.com/flyxl/datazen)
