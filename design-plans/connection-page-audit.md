# Connection Selection Page - UI Audit & Optimization

## Design Language
- Audited surface: Connection Selection / Welcome Page (workspace-mode: connections, no active tab)
- Design sources: `src/windows/connection/ConnectionPage.tsx`, `src/components/connection/`
- Tailwind CSS 4 with custom tokens (`--color-accent-*`, `--color-surface-*`, `--color-fg-*`)
- Dark theme default

## Current Issues Identified

### 1. Visual Hierarchy Problem
- **"+ New Connection" button** is the primary CTA but placed at top-right corner
- "Select a connection" heading dominates but provides no action guidance
- Stats line ("3 connections saved · 0 groups · 3 database types") adds noise without value

### 2. Redundant Connection Display
- Left sidebar tree shows connections (RECENT, Ungrouped groups)
- Main content area shows the same connections as cards
- Users must mentally map between two representations of the same data

### 3. Wasted Vertical Space
- Empty "QUERY HISTORY" section with "No query history records yet" takes ~120px
- "DataZen MCP Server" section takes ~80px even when not actively used
- Together these waste ~200px of prime viewport space

### 4. Unlabeled Navigation Icons
- 6 icons in left sidebar rail have no tooltips or labels
- Users must guess: Database, Settings, Dashboard, Workflow, Extensions, Help?

### 5. Filter Bar Disconnect
- "Filter connections..." input is far from the connection list
- Filter is positioned above cards but below header, creating visual confusion

### 6. Connection Card Design
- Cards are tall with significant empty space
- Status indicators (Offline/Online) are small and easy to miss
- Database type badges are inconsistent in placement

## Proposed Optimizations

### Option A: Card-Centric Redesign
Move primary CTA to center, remove redundant sidebar for initial view, use compact cards.

### Option B: Streamlined Two-Panel
Keep sidebar but make it functional (search + quick actions), simplify main area.

### Option C: Minimal Welcome State
Show only when no connections exist or as first-time experience; otherwise go directly to last-used connection.
