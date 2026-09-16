---
title: "View Schema Without Leaving the Editor: Table Structure Hover Cards and Quick Navigation"
description: "DataZen SQL editor lets you hover over a table name to view complete Schema information — including columns, types, foreign key relationships, and table comments — without switching to the Schema tree panel."
date: 2025-09-16
slug: hover-tooltip
---

# View Schema Without Leaving the Editor: Table Structure Hover Cards and Quick Navigation

> One of the most annoying things when writing SQL: you've just typed a table name and suddenly can't remember what a certain column is called, forcing you to switch to the Schema tree to look it up. Your flow is broken, and your train of thought goes with it.

## The "Looking Up Tables" Dilemma While Writing SQL

Anyone who writes SQL has experienced this:

You're writing a multi-table JOIN query. You've figured out the logic, and the table names and JOIN conditions are all set. But when you get to the SELECT list, you suddenly can't remember whether the field is called `user_name`, `username`, or `display_name`.

What do you need to do?

1. Move your cursor away from its current position;
2. Switch to the Schema tree panel on the left;
3. Expand the target table's column list;
4. Find the field name;
5. Switch back to the editor;
6. Reposition your cursor where you left off and continue writing.

Six steps — just to confirm a single column name. If the query involves three or four tables, you might repeat this process several times. Each interruption breaks your thought process, and regaining that mental context takes extra time and energy.

DataZen's approach: **let you see complete Schema information without ever leaving the editor.**

## Hover Cards: Information Right Where Your Cursor Is

In DataZen's SQL editor, when you hover over a table name or table alias, the editor automatically displays a Schema hover card.

![Table Structure Hover Card](https://raw.githubusercontent.com/flyxl/datazen/main/site/assets/blog/04-hover-tooltip.png)

This card contains more information than you might expect:

**Column information**: Lists all columns in the table with their names and data types. You can instantly see what fields exist and what type each one is, without switching to the Schema tree.

**Nullable**: Whether each column allows NULL values is shown directly next to the type. This information is critical when writing INSERT or UPDATE statements.

**Default values**: If a column has a default value, it's displayed on the card too — no need to look up the table structure definition.

**Foreign key relationships**: Which other tables are related to this one, which table and which column each foreign key points to — all clearly visible on the card. This is especially useful when writing JOIN queries: no need to memorize relationships or consult documentation; the associations are right in front of you.

**Table comments**: If a COMMENT was defined when the table was created, it appears at the top of the card. For business tables where column meanings aren't immediately obvious, these comments help you quickly understand the table's purpose.

## Cmd/Ctrl+Click Quick Navigation

Beyond hover-to-view, DataZen also supports Cmd+Click (macOS) or Ctrl+Click (Windows/Linux) to jump directly to the corresponding object in the Schema tree.

When you Cmd+Click a table name in the editor, the Schema tree automatically expands and locates that table. Clicking a column name also navigates directly to that column.

This feature is especially useful when you genuinely need more context — for example, viewing the full DDL of a table, checking index definitions, or comparing the structure of multiple tables. The hover card gives you a quick overview; Cmd+Click gives you deep inspection. Together, they cover the vast majority of "look up Schema" needs.

## Multi-Table JOIN Scenario: Hover Multiple Tables, Compare Quickly

When writing multi-table JOIN queries, you often need to reference multiple table structures simultaneously. In traditional tools, you might need to expand several tables in the Schema tree and switch between them.

DataZen's hover cards support displaying multiple at once. You can hover over each table in the JOIN one by one, quickly comparing column names and types to confirm that the join conditions are correct.

![Multi-Table Hover Comparison](https://raw.githubusercontent.com/flyxl/datazen/main/site/assets/blog/04-hover-multi-table.png)

For example, you're writing a query that joins `_blog_employee` JOIN `_blog_dept` JOIN `_blog_emp_project`. Hover over `_blog_employee` to see its foreign keys, then move to `_blog_dept` to confirm the primary key column name, then move to `_blog_emp_project` to verify the join column. The entire process requires no cursor movement, no panel switching, and no interruption to your thought process.

This "view in place" experience lets you focus your attention on SQL logic design rather than becoming an information courier between panels.

## Comparing Schema Viewing with Traditional Tools

In Navicat and DBeaver, viewing table structure typically requires the following:

- **Navicat**: Double-click a table name to open the table design panel, or expand the column list in the left tree. If there are multiple tables in the editor, you need to look them up one by one.
- **DBeaver**: Expand Table → Columns in the left Database Navigator, or right-click the table name and select "Properties." Information is scattered across different tab pages.

The common problem with both approaches: **you need to leave the editor to get information, then bring that information back to the editor to continue working.** This back-and-forth switching is the root cause of broken flow.

DataZen's hover cards compress this process to zero switches — information appears right next to your cursor when you need it, and once you've read it, you continue writing without any intermediate steps.

| Operation | Traditional Tools | DataZen |
|------|---------|---------|
| View single table columns | Switch to Schema tree, expand table | Hover over table name |
| View foreign key relationships | Right-click table → Properties → FK Tab | Hover over table name; shown at card bottom |
| Confirm column names and types | Switch to Schema tree → expand columns | Hover over table name; columns are immediately visible |
| View table comments | Right-click table → Properties → Comment | Hover over table name; shown at card top |
| Compare multiple tables | Expand each table separately, switch between them | Hover over each one in sequence |
| Navigate to Schema tree | Manually search in the tree | Cmd+Click for automatic navigation |

## From "Switching" to "In-Place": An Experience Upgrade

The essence of this design philosophy is **reducing context switching.**

Writing SQL requires intense focus — you're constructing relationships between tables in your head, planning query logic, and organizing column selections and aggregations. Every panel switch, every search for a piece of information, interrupts this mental process.

DataZen's hover cards and quick navigation reduce the cost of "looking up Schema information" to a minimum. You don't need to leave the editor, remember paths, or shuttle information between panels. Schema information is right next to your cursor — it appears when you need it, and once you've read it, you keep writing.

This isn't a "fancy" feature. It solves a small problem that you encounter every single day and that breaks your concentration each time. And when you accumulate the solutions to these "small problems," the overall editor experience takes a qualitative leap forward.

## Try It Out

Next time you're writing a multi-table JOIN, try hovering over a table name in DataZen's SQL editor — you'll find that confirming a column name can be this fast.

👉 [Download DataZen](https://flyxl.github.io/datazen/) and experience the seamless workflow of viewing complete Schema without leaving the editor.

📦 Source code is open on [GitHub](https://github.com/flyxl/datazen) — Stars and feedback are welcome.
