---
phase: 07-management-console
plan: 01
subsystem: ui
tags: [react, react-router, tanstack-query, tailwind, shadcn, vite, typescript]

# Dependency graph
requires:
  - phase: 06-management-api
    provides: All /management/v1/ endpoints that the console's API layer wraps

provides:
  - React SPA scaffold with React Router v7, TanStack Query v5, Tailwind CSS v4, shadcn/ui
  - Typed API layer (api.ts) covering all 22 /management/v1/ endpoints
  - TypeScript interfaces for all API response shapes (types.ts)
  - Sidebar + Outlet layout with 6-page navigation
  - All 9 routes defined with placeholder pages
  - Dashboard page with 4 status cards and recent activity table (5s auto-refresh)

affects:
  - 07-02 and all subsequent console plans that build on this routing/API/layout foundation

# Tech tracking
tech-stack:
  added:
    - react-router@7.x (BrowserRouter, Routes, Route, NavLink, Outlet)
    - '@tanstack/react-query@5.x (useQuery, useMutation, QueryClientProvider)'
    - '@tanstack/react-query-devtools@5.x'
    - tailwindcss@4.x with @tailwindcss/vite plugin
    - shadcn/ui (new-york style, zinc color) — button, card, dialog, select, table, tabs, input, label, badge, separator
    - '@monaco-editor/react@next'
    - vite-plugin-monaco-editor@1.x
    - react-dropzone@15.x
    - '@tanstack/react-table@8.x'
  patterns:
    - Feature folder structure (features/dashboard/, features/environments/, etc.)
    - hooks.ts per feature for TanStack Query hooks
    - Typed api.ts facade pattern with apiFetch<T> generic
    - NavLink className callback for active state styling
    - refetchInterval in useQuery for auto-refresh polling

key-files:
  created:
    - apps/console/src/lib/types.ts
    - apps/console/src/lib/api.ts
    - apps/console/src/layout/Layout.tsx
    - apps/console/src/layout/Sidebar.tsx
    - apps/console/src/features/dashboard/DashboardPage.tsx
    - apps/console/src/features/dashboard/hooks.ts
    - apps/console/src/components/ui/ (10 shadcn components)
    - apps/console/src/index.css
    - apps/console/components.json
  modified:
    - apps/console/tsconfig.json (added baseUrl and paths alias)
    - apps/console/vite.config.ts (tailwindcss plugin, @ path alias)
    - apps/console/package.json (many new dependencies)
    - apps/console/src/App.tsx (full routing tree)
    - apps/console/src/main.tsx (QueryClientProvider + BrowserRouter wrap)
    - apps/console/src/lib/utils.ts (formatUptime, formatDuration, formatTimestamp helpers)

key-decisions:
  - 'vite-plugin-monaco-editor skipped in vite.config.ts — the CJS plugin has Vite 6 ESM compatibility risk; @monaco-editor/react CDN loading works by default and the Code Editor page is in a later plan'
  - 'Tailwind v4 uses @tailwindcss/vite plugin — no PostCSS config, no tailwind.config.js needed'
  - 'shadcn init -d flag used for non-interactive setup (new-york style, zinc color, CSS variables)'
  - "end={to === '/'} pattern on Dashboard NavLink prevents it matching all routes"
  - 'api.ts uses typed apiFetch<T> generic wrapper — no external HTTP client (axios, ky) needed'
  - 'StatusBadge uses inline span with color classes (not shadcn Badge) to avoid unused import ESLint error'

patterns-established:
  - 'Feature folder: src/features/{feature}/{FeaturePage,hooks}.tsx — one folder per page/domain'
  - "API typing: apiFetch<ResponseType>('/endpoint') — return type enforced at call site"
  - 'Polling: refetchInterval in useQuery hook (not useEffect + setInterval)'
  - 'Placeholder pages: each non-dashboard feature returns minimal JSX, replaced in subsequent plans'

# Metrics
duration: 6min
completed: 2026-02-27
---

# Phase 7 Plan 01: Console Foundation Summary

**React SPA with React Router v7, TanStack Query v5, Tailwind CSS v4, shadcn/ui, typed api.ts for all 22 management endpoints, sidebar layout, 9 routes, and Dashboard page with 5s auto-refresh**

## Performance

- **Duration:** 6 min
- **Started:** 2026-02-27T18:22:12Z
- **Completed:** 2026-02-27T18:28:49Z
- **Tasks:** 3
- **Files modified:** 20+

## Accomplishments

- Complete SPA build foundation: React Router v7 routing, TanStack Query v5, Tailwind CSS v4, shadcn/ui (10 components)
- Typed API layer covering all 22 /management/v1/ endpoints with TypeScript interfaces for every response shape
- Sidebar navigation with Trajectory branding, 6 nav items, NavLink active state (Dashboard uses `end={to === "/"}`)
- Dashboard page with 4 status cards (Uptime, Python Pool, Active Instances, Execution Log) and Recent Activity table with 5-second auto-refresh
- All 9 routes defined with placeholder pages ready for subsequent plans

## Task Commits

Each task was committed atomically:

1. **Task 1: Install dependencies and configure build tooling** - `ac07a4d` (chore)
2. **Task 2: API layer, types, routing, and layout** - `530c193` (feat)
3. **Task 3: Dashboard page with status cards and auto-refresh** - `0bfb19d` (feat)

## Files Created/Modified

- `apps/console/src/lib/types.ts` - TypeScript interfaces for all API response shapes (DashboardResponse, EnvironmentSummary, ActionDetail, CodeVersion, ActiveInstance, LogEntry, SettingsResponse, etc.)
- `apps/console/src/lib/api.ts` - Typed fetch wrappers for all 22 /management/v1/ endpoints via apiFetch<T>
- `apps/console/src/lib/utils.ts` - cn() helper (shadcn) + formatUptime, formatDuration, formatTimestamp
- `apps/console/src/layout/Layout.tsx` - Sidebar + Outlet layout wrapper
- `apps/console/src/layout/Sidebar.tsx` - NavLink sidebar with 6 items, end={to === "/"} for Dashboard
- `apps/console/src/features/dashboard/hooks.ts` - useDashboard() with refetchInterval: 5000
- `apps/console/src/features/dashboard/DashboardPage.tsx` - 4 cards + Recent Activity table, loading/error states
- `apps/console/src/features/environments/EnvironmentsPage.tsx` - Placeholder
- `apps/console/src/features/environments/EnvironmentDetailPage.tsx` - Placeholder
- `apps/console/src/features/actions/ActionDetailPage.tsx` - Placeholder
- `apps/console/src/features/code-editor/CodeEditorPage.tsx` - Placeholder
- `apps/console/src/features/instances/InstancesPage.tsx` - Placeholder
- `apps/console/src/features/instances/InstanceDetailPage.tsx` - Placeholder
- `apps/console/src/features/log/LogPage.tsx` - Placeholder
- `apps/console/src/features/settings/SettingsPage.tsx` - Placeholder
- `apps/console/src/components/ui/` - 10 shadcn components (button, card, dialog, select, table, tabs, input, label, badge, separator)
- `apps/console/src/index.css` - Tailwind v4 @import + shadcn CSS variables
- `apps/console/components.json` - shadcn configuration
- `apps/console/tsconfig.json` - Added baseUrl: "." and paths: {"@/_": ["./src/_"]}
- `apps/console/vite.config.ts` - tailwindcss() plugin + @ path alias
- `apps/console/src/App.tsx` - Full Routes tree (9 routes under Layout)
- `apps/console/src/main.tsx` - QueryClientProvider + BrowserRouter + ReactQueryDevtools

## Decisions Made

- **vite-plugin-monaco-editor skipped:** The plugin is CJS (last release 2022) and has Vite 6 ESM compatibility risk. `@monaco-editor/react` uses CDN loading by default which works for dev and the Code Editor page is implemented in a later plan. Avoiding broken vite config is more important than bundling Monaco workers now.
- **`end={to === "/"}` pattern:** Used directly in JSX prop (not via data array `end: true`) to satisfy the plan's must-have pattern check.
- **StatusBadge uses inline span:** shadcn Badge was imported then replaced with a custom span to give more color control (green/red/yellow). Removed the unused Badge import to satisfy ESLint.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Removed unused Badge import in DashboardPage.tsx**

- **Found during:** Task 3 commit (pre-commit ESLint hook)
- **Issue:** Badge was imported from shadcn but replaced by a custom inline span; ESLint `no-unused-vars` blocked commit
- **Fix:** Removed the unused Badge import
- **Files modified:** apps/console/src/features/dashboard/DashboardPage.tsx
- **Verification:** ESLint passed, build succeeded
- **Committed in:** 0bfb19d (Task 3 commit)

**2. [Rule 1 - Bug] Skipped vite-plugin-monaco-editor in vite.config.ts**

- **Found during:** Task 1 vite config setup
- **Issue:** vite-plugin-monaco-editor is CJS-only (2022), no ESM export; importing as default in Vite 6 ESM config would cause runtime errors. Monaco CDN loading handles dev use case.
- **Fix:** Omitted the plugin from vite config. Package remains installed (for future use in 07-0x Code Editor plan).
- **Files modified:** apps/console/vite.config.ts
- **Verification:** Build passes, no Monaco worker errors in browser during dev
- **Committed in:** ac07a4d (Task 1 commit)

---

**Total deviations:** 2 auto-fixed (1 Rule 1 bug fix, 1 Rule 1 blocking issue avoided)
**Impact on plan:** Both fixes maintain correctness. The monaco plugin deviation defers proper worker bundling to the Code Editor plan where it's actually needed.

## Issues Encountered

None beyond the two auto-fixed deviations above.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- Complete SPA routing foundation ready for plan 07-02 (Environments page)
- api.ts covers all endpoints, types.ts covers all shapes — feature pages only need to import and use
- Dashboard is fully functional; all other pages are placeholders ready to be replaced
- shadcn components available for all feature pages via `@/components/ui/`
- No blockers

---

_Phase: 07-management-console_
_Completed: 2026-02-27_
