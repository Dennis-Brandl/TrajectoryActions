---
phase: 07-management-console
plan: 03
subsystem: ui
tags: [monaco-editor, react, tanstack-query, shadcn, python-editor, code-versioning]

# Dependency graph
requires:
  - phase: 07-01
    provides: SPA foundation, TanStack Query, shadcn components, api.ts with typed apiFetch
  - phase: 06-02
    provides: /management/v1/code/* endpoints for code CRUD, test, and version management

provides:
  - Code Editor page (UI-08 through UI-12) with Monaco Python editor
  - hooks.ts with useCodeVersions, useActiveCode, useSaveCode, useTestCode, useActivateVersion, useDeleteVersion
  - SaveDialog component: description-input save flow
  - VersionHistory component: scrollable version list with active badge, activate, delete
  - TestPanel component: per-parameter input fields, run test, results with outputs/stdout/stderr
  - URL deep linking via ?env=X&action=Y&state=Z query params
  - Python code template auto-generation for states with no active code

affects:
  - 07-04 (if exists): further management console pages can reference hooks.ts pattern

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Feature-local hooks.ts co-located with feature components (same pattern as environments/hooks.ts)
    - useActiveCode with staleTime 30s + refetchOnWindowFocus false to prevent editor overwrites
    - Cascading Select dropdowns (env -> action -> state) with reset on parent change
    - useCallback for async handlers that call api.* directly (version fetch on click)

key-files:
  created:
    - apps/console/src/features/code-editor/hooks.ts
    - apps/console/src/features/code-editor/CodeEditorPage.tsx
    - apps/console/src/features/code-editor/SaveDialog.tsx
    - apps/console/src/features/code-editor/VersionHistory.tsx
    - apps/console/src/features/code-editor/TestPanel.tsx
  modified: []

key-decisions:
  - 'useActiveCode staleTime 30s + refetchOnWindowFocus false — prevents TanStack Query from overwriting unsaved editor code on window focus'
  - 'Version click uses api.codeVersion() directly (not a useQuery hook) — single-fetch on click, no ongoing subscription needed for historical versions'
  - 'Template generation triggered by activeCodeError (404) — sets isDirty true so user is reminded to save before leaving'
  - 'VersionHistory selectedVersionId prop tracks what is being viewed, not the active version ID — highlights selected item in history list'
  - 'handleEditThisVersion clears viewingVersionId + sets isDirty=true — allows user to edit historical code without auto-replacing from active query'
  - 'OPAQUE_CODE_STATES = [STARTING, STOPPING, ABORTING, CLEARING] — matches opaque transition table (same as 07-02 decision)'

patterns-established:
  - 'Cascade reset: each selector change clears child selection and resets editor state (editorCode, isDirty, viewingVersionId)'
  - 'Mutation handlers use mutateAsync with try/catch in component; hooks only invalidate on success'
  - 'Confirmation UI for destructive actions (delete version) inline in list item, not modal'

# Metrics
duration: 6min
completed: 2026-02-27
---

# Phase 7 Plan 3: Code Editor Summary

**Monaco Python editor with cascading env/action/state selectors, save-with-description flow, version history with activate/rollback, test panel with parameter inputs and results display, and template auto-generation**

## Performance

- **Duration:** 6 min
- **Started:** 2026-02-27T18:42:45Z
- **Completed:** 2026-02-27T18:48:22Z
- **Tasks:** 2
- **Files modified:** 5 created, 0 modified

## Accomplishments

- Full code editor page (UI-08 through UI-12) with Monaco editor in Python mode, vs-dark theme
- Three cascading Select dropdowns populate from API: environment -> action -> state; each reset child state on change
- SaveDialog (shadcn Dialog) with optional description input, calls useSaveCode mutation, invalidates version cache on success
- VersionHistory lists all versions newest-first, highlights active with Badge, Activate/Delete buttons on non-active versions with inline delete confirmation
- TestPanel renders input fields per action parameter (pre-populated from defaults), calls useTestCode, shows structured results (success/fail badge, outputs JSON, stdout/stderr pre blocks, duration)
- Template auto-generation when no active code exists: fills in action name, state, input param names, prop names into docstring
- URL deep linking: ?env=X&action=Y&state=Z loads from query params on mount, syncs back on selection change
- Viewing old version shows read-only banner with "Edit this version" and "Back to active" buttons
- staleTime 30s + refetchOnWindowFocus false on useActiveCode prevents editor overwrite while user types

## Task Commits

1. **Task 1: Code editor page with selectors, Monaco editor, and template generation** - `d65c5d7` (feat)
2. **Task 2: Save dialog, test panel, version history, and App.tsx wiring** - `7c5bdaa` (feat)

**Plan metadata:** (created next)

## Files Created/Modified

- `apps/console/src/features/code-editor/hooks.ts` - All query/mutation hooks: useEnvironments, useEnvironmentDetail, useAction, useCodeVersions, useActiveCode, useSaveCode, useActivateVersion, useDeleteVersion, useTestCode
- `apps/console/src/features/code-editor/CodeEditorPage.tsx` - Main editor page with cascading selectors, Monaco editor, status bar, URL sync, template generation
- `apps/console/src/features/code-editor/SaveDialog.tsx` - shadcn Dialog for save-with-description flow
- `apps/console/src/features/code-editor/VersionHistory.tsx` - Scrollable version list with active Badge, Activate, Delete (with confirmation)
- `apps/console/src/features/code-editor/TestPanel.tsx` - Test execution panel: parameter inputs, run button, results display

## Decisions Made

- `useActiveCode` uses `staleTime: 30_000` and `refetchOnWindowFocus: false` to prevent TanStack Query auto-fetching from overwriting unsaved editor code when the user switches browser tabs
- Version history item click fetches the specific version via `api.codeVersion()` directly (not a `useQuery` hook) because this is an on-demand single fetch with no polling needed
- Template generation is triggered by `activeCodeError` (404 from `/active` endpoint) — sets `isDirty: true` so the user sees the "Unsaved changes" indicator and knows to save
- `handleEditThisVersion` sets `viewingVersionId: null` and `isDirty: true` without reloading active code — preserves the historical code in editor for the user to modify before saving as a new version
- App.tsx already had the real CodeEditorPage import from 07-01 — no changes needed

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Removed invalid ESLint disable comment**

- **Found during:** Task 2 commit (pre-commit hook failure)
- **Issue:** `// eslint-disable-next-line react-hooks/exhaustive-deps` was rejected by ESLint pre-commit hook because the `react-hooks` plugin is not configured in this project
- **Fix:** Added `viewingVersionId` to the useEffect dependency array (which is the correct behavior — effect should skip code reload when user is viewing a historical version), removed the disable comment
- **Files modified:** apps/console/src/features/code-editor/CodeEditorPage.tsx
- **Verification:** Build and TypeScript checks pass; pre-commit hook passes
- **Committed in:** 7c5bdaa (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Fix was correct and improved the behavior — the effect now properly guards against overwriting historical code view.

## Issues Encountered

None beyond the ESLint disable comment (handled as deviation above).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Code Editor page is feature-complete covering UI-08 through UI-12
- All five code editor feature files created and committed
- Build passes with 1955 modules transformed
- 07-03 completes the core feature set of Phase 7 Management Console
- If 07-04 exists: any remaining pages (Instances, Log, Settings) are already scaffolded as placeholder pages from 07-01

---

_Phase: 07-management-console_
_Completed: 2026-02-27_
