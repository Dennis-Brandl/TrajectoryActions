# Console Reskin — Design Spec

**Status**: Approved
**Date**: 2026-03-31
**Phase**: v2 Phase 2

---

## Goal

Replace the current sidebar navigation with a VS Code-style IDE layout: activity bar, collapsible tree panel with 3-level hierarchy (Environment > Action > State), top navigation for global pages, inline code editing, dark/light theme toggle, and search.

## Architecture

The console shifts from a flat sidebar-driven layout to a three-zone IDE layout:

1. **Activity Bar** (left edge, ~40px) — icon strip that switches the side panel content
2. **Side Panel** (collapsible, ~220px) — context-sensitive content driven by the active activity bar icon
3. **Main Content** (flex, remaining space) — page content with breadcrumb header

A thin **top nav bar** provides global page navigation (Dashboard, Log, Settings), a search input, and a theme toggle. A **status bar** at the bottom shows environment/action counts and version info.

## Layout Structure

```
+------+--------+------------------------------------------+
| Top Nav: [Trajectory] Dashboard  Log  Settings  [Search] [Theme] |
+------+--------+------------------------------------------+
|      |        |                                          |
| Act  | Side   |  Main Content                            |
| Bar  | Panel  |  (breadcrumb + page content)             |
| 40px | 220px  |                                          |
|      | (coll) |                                          |
+------+--------+------------------------------------------+
| Status Bar: 3 environments | 15 actions       v1.0.0    |
+------+--------+------------------------------------------+
```

## Components

### Top Nav Bar

- **Brand**: "Trajectory" text logo (left)
- **Global pages**: Dashboard, Log, Settings — styled as tabs, active tab highlighted
- **Search input**: Right-aligned, placeholder "Search...", searches across environments, actions, and states by name
- **Theme toggle**: Sun/moon icon button, toggles dark/light, persists to `localStorage`

### Activity Bar

Three icons, vertically stacked. Clicking an icon either opens/switches the side panel to that view, or collapses the panel if already active (VS Code toggle behavior).

| Icon               | Panel           | Description                       |
| ------------------ | --------------- | --------------------------------- |
| Explorer (folder)  | Explorer Panel  | Environment > Action > State tree |
| Instances (play)   | Instances Panel | Active and recent instances list  |
| Search (magnifier) | Search Panel    | Full-text search across entities  |

Active icon gets a left accent border (`2px solid primary`) and highlighted background.

### Explorer Panel

Three-level collapsible tree:

```
v Home Kitchen
    v PreheatOven
        * EXECUTING        (green dot = has active code)
        * ABORTING          (green dot)
          STARTING          (gray dot = no code)
          COMPLETING        (gray dot)
          STOPPING          (gray dot)
    > SetTimer              (action count or code count badge)
> Warehouse                 (action count badge)
> Back Office               (action count badge)
```

**Behavior:**

- Environments are collapsible, showing their actions when expanded
- Actions are collapsible, showing their applicable states when expanded (observable states for observable actions, opaque states for opaque actions)
- States show a green dot if active code exists, gray dot if no code
- Clicking an environment navigates to the environment detail page
- Clicking an action navigates to the action detail page
- Clicking a state navigates to the action's inline code editor for that state
- **Filter toggle button** in panel header: when active, hides states without code across the entire tree. Toggle state persists to `localStorage`

**Data fetching:** The explorer needs a lightweight endpoint or can compose from existing data. On mount, fetch all environments with their actions. State code status is fetched per-action when expanded (using existing `GET /actions/:oid` which returns `code_summary.states_with_code`).

### Instances Panel

Replaces the current standalone Instances page for quick access:

- **Active tab**: Shows currently running instances with state, action name, duration
- **Recent tab**: Shows recently completed instances with final status
- Clicking an instance navigates to the instance detail page in the main content area
- Compact list format (no table — just rows with action name, state badge, timestamp)

The full Instances page (`/instances`) is removed from top nav. Instance detail pages (`/instances/:id`) still exist and render in the main content area.

### Search Panel

- Text input at the top of the panel
- Searches across environment names, action names (local_id), and action OIDs
- Results grouped by type (Environments, Actions)
- Clicking a result navigates to the corresponding detail page
- Client-side filtering of already-loaded explorer data (no new API endpoint needed for v1)

### Main Content Area

Renders page-specific content with a breadcrumb bar at the top.

**Breadcrumb bar**: Shows navigation context. Examples:

- `Dashboard` (top-level pages)
- `Home Kitchen` (environment detail)
- `Home Kitchen / PreheatOven` (action detail)
- `Home Kitchen / PreheatOven / EXECUTING` (state code editor)

**Pages and their content:**

| Route                       | Content                                                                                    |
| --------------------------- | ------------------------------------------------------------------------------------------ |
| `/`                         | Dashboard — container overview (unchanged)                                                 |
| `/environments/:oid`        | Environment detail — metadata, properties, action list                                     |
| `/actions/:oid`             | Action detail — params, export/import, code overview, "select a state to edit code" prompt |
| `/actions/:oid/code/:state` | Inline code editor — compact param bar + Monaco editor + save/test/history controls        |
| `/instances/:id`            | Instance detail — execution timeline, params, code versions                                |
| `/log`                      | Execution log — filters, paginated table (unchanged)                                       |
| `/settings`                 | Settings — config, snapshot export/import, container info (unchanged)                      |

**Removed routes:**

- `/environments` (list page) — replaced by explorer panel; clicking "Environments" section header in explorer could show a list, but the tree itself is the primary navigation
- `/code-editor` — replaced by inline code editing at `/actions/:oid/code/:state`
- `/instances` (list page) — replaced by instances activity bar panel

### Inline Code Editor

When a state is selected in the explorer (or navigated to via `/actions/:oid/code/:state`):

**Layout** (top to bottom):

1. **Compact param bar** — breadcrumb + inline display of input/output params + version info. This is a thin, always-visible strip.
2. **Monaco editor** — fills remaining vertical space. Same Monaco configuration as the current code editor page.
3. **Action bar** — Save, Test, History buttons on the left; version/created info on the right. Same functionality as current code editor.

The test panel (run code with test inputs, see output) opens as a bottom panel below the editor (like VS Code's terminal panel), not as a side panel.

### Status Bar

Thin bar at the very bottom of the viewport:

- Left: `{N} environments | {M} actions`
- Right: `Trajectory v1.0.0`

Data comes from the dashboard API (already fetched on mount).

## Theme System

### Implementation

- Add `dark` class to `<html>` element (Tailwind dark mode strategy: `class`)
- Default: dark theme
- Toggle persists to `localStorage` key `Trajectory-theme` (values: `dark`, `light`)
- On load, read `localStorage` and apply before first render (avoid flash)

### Color Palette

Use Tailwind's existing dark mode classes (`dark:bg-*`, `dark:text-*`). The current `index.css` already defines CSS custom properties for both `:root` (light) and `.dark` (dark) contexts. These will be used as-is.

The activity bar and side panel use slightly darker shades than the main background to create visual depth:

- Dark mode: activity bar `bg-[#16161e]`, side panel `bg-[#1e1e2e]`, main `bg-background`
- Light mode: activity bar `bg-slate-100`, side panel `bg-slate-50`, main `bg-background`

## State Management

### Panel State (React Context)

```typescript
interface PanelState {
  activePanel: 'explorer' | 'instances' | 'search' | null // null = collapsed
  panelWidth: number // user-resizable (future), default 220
  codeFilterActive: boolean // hide states without code in explorer
}
```

Persisted to `localStorage`:

- `Trajectory-active-panel` — which panel is open (or `null`)
- `Trajectory-code-filter` — boolean for the state filter toggle

### Explorer Data

- Environment list + action list fetched on mount via existing APIs
- Per-action state code status fetched on expand (lazy, cached by React Query)
- Tree expand/collapse state: local React state (not persisted — re-expand on navigation is fine)

### Theme State

- `Trajectory-theme` in `localStorage`
- Applied via `document.documentElement.classList.toggle('dark')`
- React context exposes `{ theme, toggleTheme }` for components

## Routing Changes

| Current Route        | New Route                   | Change                        |
| -------------------- | --------------------------- | ----------------------------- |
| `/`                  | `/`                         | Unchanged                     |
| `/environments`      | Removed                     | Explorer panel replaces this  |
| `/environments/:oid` | `/environments/:oid`        | Unchanged                     |
| `/actions/:oid`      | `/actions/:oid`             | Unchanged                     |
| `/code-editor`       | `/actions/:oid/code/:state` | New route pattern             |
| `/instances`         | Removed                     | Instances panel replaces this |
| `/instances/:id`     | `/instances/:id`            | Unchanged                     |
| `/log`               | `/log`                      | Unchanged                     |
| `/settings`          | `/settings`                 | Unchanged                     |

## File Structure (New/Modified)

### New Files

| File                                          | Responsibility                                                |
| --------------------------------------------- | ------------------------------------------------------------- |
| `layout/TopNav.tsx`                           | Top navigation bar with tabs, search, theme toggle            |
| `layout/ActivityBar.tsx`                      | Icon strip for panel switching                                |
| `layout/SidePanel.tsx`                        | Container for panel content, handles collapse/expand          |
| `layout/StatusBar.tsx`                        | Bottom status bar                                             |
| `layout/PanelContext.tsx`                     | React context for panel state + theme state                   |
| `features/explorer/ExplorerPanel.tsx`         | Environment > Action > State tree                             |
| `features/explorer/TreeNode.tsx`              | Individual tree node (environment, action, or state)          |
| `features/explorer/hooks.ts`                  | Data fetching for explorer tree                               |
| `features/instances-panel/InstancesPanel.tsx` | Compact instances list for activity bar                       |
| `features/instances-panel/hooks.ts`           | Instance data hooks for panel                                 |
| `features/search-panel/SearchPanel.tsx`       | Search input + results                                        |
| `features/actions/InlineCodeEditor.tsx`       | Monaco editor + param bar + action bar for state code editing |

### Modified Files

| File                | Change                                                                                               |
| ------------------- | ---------------------------------------------------------------------------------------------------- |
| `layout/Layout.tsx` | Replace sidebar layout with activity bar + side panel + top nav + status bar                         |
| `App.tsx`           | Update routes: remove `/environments`, `/instances`, `/code-editor`; add `/actions/:oid/code/:state` |
| `index.css`         | Add dark mode as default, ensure `.dark` class is applied                                            |
| `main.tsx`          | Initialize theme from `localStorage` before render                                                   |

### Removed Files

| File                                         | Reason                              |
| -------------------------------------------- | ----------------------------------- |
| `layout/Sidebar.tsx`                         | Replaced by ActivityBar + SidePanel |
| `features/environments/EnvironmentsPage.tsx` | Replaced by Explorer panel          |
| `features/instances/InstancesPage.tsx`       | Replaced by Instances panel         |
| `features/code-editor/CodeEditorPage.tsx`    | Replaced by InlineCodeEditor        |

Note: Components from the old code editor page (Monaco setup, version history, test panel, state diagrams) will be reused/refactored into the new InlineCodeEditor and its sub-components.

### Upload (.WFenvir) Relocation

The current EnvironmentsPage hosts the Upload dialog for importing `.WFenvir` files. With that page removed, the upload action moves to the **Explorer panel header** — a small "+" or upload icon button next to the "Explorer" title. Clicking it opens the same upload dialog. This keeps environment import accessible without a dedicated page.

## Scope Boundaries

**In scope:**

- New layout structure (activity bar, side panel, top nav, status bar)
- Explorer panel with 3-level tree
- Instances panel (compact list)
- Search panel (client-side filtering)
- Inline code editing replacing the standalone code editor page
- Dark/light theme toggle
- Route changes

**Out of scope (deferred):**

- Branding changes (logo, colors beyond dark/light)
- Resizable panels (drag to resize)
- Keyboard shortcuts
- Mobile/responsive optimizations
- Panel drag-and-drop or reordering
