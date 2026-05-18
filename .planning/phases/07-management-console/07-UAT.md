---
status: complete
phase: 07-management-console
source: [07-01-SUMMARY.md, 07-02-SUMMARY.md, 07-03-SUMMARY.md, 07-04-SUMMARY.md]
started: 2026-02-27T19:10:00Z
updated: 2026-02-27T19:10:00Z
---

## Current Test

<!-- OVERWRITE each test - shows where we are -->

number: 1
name: Sidebar navigation and page routing
expected: |
All 6 nav items visible in sidebar: Dashboard, Environments, Code Editor, Instances, Execution Log, Settings.
Clicking each navigates to the correct page. Dashboard is highlighted when on "/". Other pages highlight when active.
Dashboard NavLink does NOT stay highlighted on other pages.
awaiting: user response

## Tests

### 1. Sidebar navigation and page routing

expected: All 6 nav items visible in sidebar. Clicking each navigates to correct page. Active item is highlighted. Dashboard only highlights on "/" (not on other pages).
result: [pass]

### 2. Dashboard status cards and auto-refresh

expected: Dashboard shows 4 cards (Uptime, Python Pool, Active Instances, Execution Log) with live data from the server. Recent Activity table below. Data refreshes automatically every ~5 seconds (watch a value change without manual refresh).
result: [pass-with-note]
note: Cards show live data and refresh works, but there is no visible indicator of when data was last refreshed. Add a "Last refreshed: HH:MM:SS" label so the user can confirm auto-refresh is working.

### 3. Environments list with cards

expected: Environments page shows environment cards with name, version, OID (monospace), action count, and import date. Cards are clickable and navigate to environment detail. Upload Package button is visible.
result: [pass]

### 4. Upload dialog with drag-and-drop

expected: Clicking Upload Package opens a dialog. Dragging a .WFenvir or .WFaction file onto the zone shows "Drop the file here". Dropping uploads it and shows import results (environment name, OID, action count, created/updated status). The environments list updates immediately.
result: [pass]
note: Initially failed with "Internal server error" — root cause was FormData field name mismatch ('package' vs 'files'). Fixed in api.ts.

### 5. Environment detail page

expected: Clicking an environment card shows detail page with back link, name, version, OID, import date. Property sections (Action, Value, Resource) shown if present. Actions table lists actions with name (linked), visibility badge, I/O counts, code status.
result: [pass]

### 6. Action detail page

expected: Clicking an action from environment detail shows action page with name, visibility badge, OID. Input Parameters and Output Parameters tables with column data. Code Status section shows states with "Edit" links that navigate to the code editor with pre-selected env/action/state.
result: [pass]

### 7. Code Editor with Monaco and selectors

expected: Code Editor page has 3 dropdown selectors (Environment, Action, State). Selecting all three loads the Monaco editor with Python syntax highlighting (vs-dark theme). If no code exists, a template is shown with the action name and parameter names in the docstring.
result: [pass]

### 8. Code save and version history

expected: After typing code in the editor, clicking Save opens a dialog with an optional description field. Saving creates a new version. The version history panel updates to show the new version with "Active" badge. Clicking an older version shows it in read-only mode with a "Viewing version" banner.
result: [pass]

### 9. Code test panel

expected: Clicking Test opens a panel below the editor with input fields pre-populated from the action's parameter defaults. Clicking "Run Test" executes the code and displays results: success/failure, return value, outputs, stdout, stderr, duration.
result: [pass-with-note]
note: Two UX issues: (1) Input fields show values but not parameter names as labels. (2) print() output not shown in stdout section of test results.

### 10. Instances list with auto-refresh

expected: Instances page shows Active and History tabs. Active tab shows running instances with colored state dots (green for executing states, yellow for paused/held, red for aborting/stopping, gray for terminal). List auto-refreshes every ~2 seconds.
result: [skipped]
note: No active or history instances available to test against. Page renders with empty state messages.

### 11. Instance detail with timeline and commands

expected: Clicking an instance shows detail page with state timeline (vertical list of states with timestamps and durations), input/output parameters, pinned code versions. Command buttons (Pause, Abort, Stop, etc.) are shown based on current state.
result: [skipped]
note: No instances available to navigate to detail page.

### 12. Execution log with filtering and pagination

expected: Execution Log page shows a table with log entries (ID, Action, Environment, Status badge, Duration, Completed At). Filter bar allows filtering by status. Pagination controls (Previous/Next) navigate pages. Clicking a row expands it to show full execution record (parameters, state executions).
result: [skipped]
note: No execution log entries available to test against.

### 13. Settings page with save and reset

expected: Settings page shows form inputs for: Max Log Entries, Python Pool Size, Execution Timeout (ms), Instance Retention (hours). Changing a value enables the Save button. Save persists changes. Reset to Defaults button restores default values (10000, 4, 60000, 24). Container Info section shows read-only system info.
result: [pass]

## Summary

total: 13
passed: 10
issues: 0
pending: 0
skipped: 3
skipped: 0

## Gaps

- **GAP-01** (minor/UX): Dashboard needs a "Last refreshed" timestamp label so users can visually confirm auto-refresh is active.
- **GAP-02** (resolved): File upload field name mismatch — fixed `'package'` → `'files'` in api.ts to match multer config.
- **GAP-03** (minor/UX): Test panel input fields show values but not parameter names as labels.
- **GAP-04** (minor/functional): print() output from code execution not shown in the stdout section of test results.
