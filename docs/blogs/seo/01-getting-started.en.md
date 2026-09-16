---
title: "DataZen Getting Started Guide: Connect to Your First Database in 5 Minutes"
description: "DataZen is a free, open-source, cross-platform desktop database management tool supporting PostgreSQL, MySQL, SQLite, Redis, and more — with built-in AI assistance. This step-by-step guide walks you through downloading, installing, and connecting to your first database in just 5 minutes."
date: 2026-09-18
slug: getting-started
keywords:
  - database management tool getting started
  - free database client
  - DataZen download
  - database connection setup
---

# DataZen Getting Started Guide: Connect to Your First Database in 5 Minutes

Are you tired of constantly switching between the terminal and a GUI to manage databases? Looking for a free, cross-platform, ready-to-use database management tool? DataZen was built to solve exactly these problems.

This guide will take you from zero to a working database connection in just 5 minutes.

## Why Choose DataZen?

There are plenty of database management tools out there, but DataZen stands out for several key reasons:

- **Completely free and open-source** — No paid license required, no account registration needed. Just download and use. The source code is hosted on GitHub — you can audit it, contribute, or fork it.
- **Cross-platform** — macOS (Intel and Apple Silicon), Windows, and Linux are all fully supported. Switch operating systems without having to relearn your tools.
- **Built-in AI assistance** — Struggling with SQL? AI Chat can help you generate queries, optimize statements, and explain error messages. Supports OpenAI, Anthropic, DeepSeek, Ollama, and other providers.
- **Mainstream database support** — PostgreSQL, MySQL, MariaDB, SQLite, Redis, ClickHouse, MongoDB — connect out of the box.
- **Modern tech stack** — Built on Tauri v2 (Rust + React), fast startup, low memory footprint — not one of those memory-hungry Electron apps.

In short, DataZen delivers both "great to use" and "completely free."

## Step 1: Download and Install

Visit the [DataZen download page](https://flyxl.github.io/datazen/download.html) and choose the right installer for your operating system:

| Operating System | Installer Format | Notes |
|----------|-----------|------|
| macOS (Apple Silicon) | `.dmg` | Native ARM, best performance |
| macOS (Intel) | `.dmg` | For Intel Macs |
| Windows | `.msi` / `.exe` | Standard installer |
| Linux | `.deb` / `.AppImage` | Ubuntu/Debian supported; AppImage works everywhere |

### macOS Installation

Open the `.dmg` file and drag the DataZen icon into your Applications folder. On first launch, the system may warn that the developer cannot be verified — go to **System Settings → Privacy & Security** and click **Open Anyway**.

### Windows Installation

Double-click the `.msi` installer and follow the wizard. Once installation is complete, launch DataZen from the Start menu or desktop shortcut.

### Linux Installation

On Ubuntu/Debian, install the `.deb` package directly:

```bash
sudo dpkg -i datazen_*.deb
```

If you prefer `.AppImage`, add execute permissions and run it:

```bash
chmod +x datazen_*.AppImage
./datazen_*.AppImage
```

After installation, you'll see DataZen's welcome page — clean, modern, and free of any ads.

## Step 2: Connect to Your First Database

We'll use PostgreSQL as an example to demonstrate how to create and connect to a database.

### Open the Connection Manager

Click the **+** button in the left navigation bar, or select **New Connection** from the welcome page.

![New Connection Entry](https://raw.githubusercontent.com/flyxl/datazen/main/site/assets/blog/getting-started-02-new-connection.png)

### Select the Database Type

Choose **PostgreSQL** from the database type dropdown. DataZen will automatically display the connection fields specific to that database.

![Select Database Type](https://raw.githubusercontent.com/flyxl/datazen/main/site/assets/blog/getting-started-03-select-db-type.png)

### Fill in Connection Details

Enter the following information:

- **Host**: `localhost` (for local databases) or a remote IP address
- **Port**: `5432` (PostgreSQL's default port)
- **Username**: Your database username
- **Password**: Your database password
- **Database**: The name of the database to connect to

You can also click the tabs on the left to configure advanced options like SSL and SSH tunnels — but for getting started, the defaults are fine.

### Test and Save

Click the **Test Connection** button. If everything is correct, you'll see a green "Connection Successful" message. Once confirmed, click **Save**.

Congratulations! You've successfully created your first database connection.

## Step 3: Basic Operations

After connecting, DataZen's main workspace is ready for you. Let's try a few basic operations.

### Browse the Schema

The connection tree on the left displays the full structure of your database: tables, views, stored procedures, triggers, and more. Expand the `public` schema to see all tables, including column names, types, and primary key indicators.

### Run SQL Queries

Click the **Query** tab at the top to open the SQL editor. Enter a simple query:

```sql
SELECT * FROM users LIMIT 10;
```

Press `Ctrl + Enter` (or `Cmd + Enter`) to execute. Results are displayed in a table below, with support for sorting, filtering, and exporting.

![SQL Query Results](https://raw.githubusercontent.com/flyxl/datazen/main/site/assets/blog/getting-started-06-query-result.png)

### Handy Features

- **Auto-complete**: Type `SELECT` followed by a space, and table and column names will automatically appear.
- **SQL formatting**: Select a block of SQL and press `Shift + Alt + F` to auto-format it.
- **Safe mode**: Enabled by default to prevent accidental modifications. In read-only mode, `DELETE` or `UPDATE` statements are blocked — you must manually disable the read-only toggle to execute write operations.

## Next Steps: Explore More Features

Connecting to a database is just the beginning. DataZen offers a wealth of powerful features for you to discover:

- **AI Chat** — Describe what you need in natural language, and the AI will generate the corresponding SQL statement. You can also select a block of SQL and ask the AI to explain what it does.
- **Data Export** — Export query results to CSV, JSON, SQL, and other formats for easy collaboration with other tools.
- **ER Diagrams** — Visualize database table relationships at a glance, seeing foreign keys and associations clearly.
- **Schema Diff** — Compare structural differences between two databases and quickly generate migration SQL.
- **Chart Visualization** — Generate bar charts, line charts, pie charts, and more from query results for clear data insights.
- **Workflow** — Define automated workflows in YAML for batch SQL execution, scheduled backups, cross-database synchronization, and more.
- **MCP Server** — Run DataZen as an MCP server, allowing AI assistants to access your databases directly.

Start with the [Features page](https://flyxl.github.io/datazen/features.html) to explore these capabilities step by step.

## Final Thoughts

There are many database management tools to choose from, but DataZen combines "free and open-source + cross-platform + AI assistance" into a truly compelling package. Whether you're a developer, DBA, or data analyst, 5 minutes of setup time buys you an entire efficient database workflow.

Try it now — completely free, no registration required.

---

**[Download DataZen Now](https://flyxl.github.io/datazen/download.html)** · [GitHub Source](https://github.com/flyxl/datazen)
