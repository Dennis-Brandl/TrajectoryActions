---
phase: 07-management-console
plan: 02
subsystem: ui
tags: [react, react-dropzone, tanstack-query, shadcn, tailwind, typescript]

# Dependency graph
requires:
  - phase: 07-management-console
    plan: 01
    provides: React SPA scaffold, typed api.ts (upload, environments, actions endpoints), types.ts interfaces, routing tree with placeholder pages, shadcn components

provides:
  - Environments list page with responsive card grid (OID, version, action count, import date, delete with confirm)
  - Upload dialog with react-dropzone drag-and-drop for .WFenvir/.WFaction, 5 UI states (idle/drag-active/uploading/success/error), client-side extension validation
  - Environment detail page with Action/Value/Resource property sections and actions table with links to action pages
  - Action detail page with Input/Output parameter tables, Action Properties, and Code Status per ISA-88 state with Edit links
  - hooks.ts for environments (useEnvironments, useEnvironment, useUploadPackage, useDeleteEnvironment) and actions (useAction)

affects:
  - 07-03 and subsequent plans (code editor, instances, log, settings) can follow same hooks/page pattern

# Tech tracking
tech-stack:
  added: []
  patterns:
    - useDropzone with accept + client-side extension validation in onDrop callback
    - useMutation with onSuccess invalidateQueries for upload and delete
    - useQuery with enabled: !!oid for detail pages (skips fetch when oid is empty)
    - Confirm-before-delete pattern in card component with local confirming state
    - ISA-88 state subset for opaque vs observable actions in Code Status section

key-files:
  created:
    - apps/console/src/features/environments/hooks.ts
    - apps/console/src/features/environments/UploadDialog.tsx
    - apps/console/src/features/actions/hooks.ts
  modified:
    - apps/console/src/features/environments/EnvironmentsPage.tsx
    - apps/console/src/features/environments/EnvironmentDetailPage.tsx
    - apps/console/src/features/actions/ActionDetailPage.tsx

key-decisions:
  - 'UploadDialog does NOT set Content-Type header on FormData — browser sets multipart boundary automatically (same pattern as api.ts upload())'
  - 'Client-side .WFenvir/.WFaction extension validation in onDrop callback before API call — gives immediate feedback without network round-trip'
  - 'useEnvironment(oid) uses enabled: !!oid guard — prevents query firing on empty oid from useParams'
  - 'App.tsx already had real component imports from 07-01 — no changes needed for Task 3 wiring'
  - 'Opaque actions show reduced CODE_STATES subset (STARTING/STOPPING/ABORTING/CLEARING only) matching the opaque transition table'

patterns-established:
  - 'Detail page pattern: useParams -> useQuery(enabled: !!oid) -> loading/error/data render branches'
  - 'Card-with-delete pattern: confirm state in card component, Confirm/Cancel buttons on click'
  - 'Upload dialog state machine: idle | drag-active | uploading | success | error with reset-on-close'

# Metrics
duration: 3min
completed: 2026-02-27
---

# Phase 7 Plan 02: Environments and Actions Pages Summary

**Environments list with upload dialog (react-dropzone, .WFenvir/.WFaction), environment detail with property sections and actions table, action detail with parameter tables and ISA-88 state code status**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-27T18:36:22Z
- **Completed:** 2026-02-27T18:39:46Z
- **Tasks:** 3
- **Files modified:** 6

## Accomplishments

- Environments list page: responsive card grid showing OID (monospace), version, action count, import date; delete button with confirm flow; Upload Package button
- Upload dialog: react-dropzone with accept hint for .WFenvir/.WFaction, client-side extension validation in onDrop, 5 explicit UI states (idle, drag-active, uploading, success showing imported items, error with retry), no Content-Type override on FormData
- Environment detail page: back link, header with name/version/OID/dates, Action Properties / Value Properties / Resource Properties sections (hidden when empty), Actions table with Name (link to /actions/:oid), Visibility badge, I/O counts, Code status badges per state
- Action detail page: breadcrumb nav, header with name/version/VisibilityBadge/OID/environment link, Input Parameters table, Output Parameters table, Action Properties section, Code Status table per ISA-88 state (full 16 states for observable, 4-state subset for opaque) with Edit links to /code-editor
- TanStack Query hooks covering all environment and action data needs with proper cache invalidation

## Task Commits

Each task was committed atomically:

1. **Task 1: Environments list page and upload dialog** - `c88cabc` (feat)
2. **Task 2: Environment detail page** - `959aaf5` (feat)
3. **Task 3: Action detail page and App.tsx wiring** - `f86e262` (feat)

## Files Created/Modified

- `apps/console/src/features/environments/hooks.ts` - useEnvironments, useEnvironment(oid), useUploadPackage (mutate -> api.upload, invalidates ['environments']), useDeleteEnvironment (mutate -> api.deleteEnvironment, invalidates ['environments'])
- `apps/console/src/features/environments/UploadDialog.tsx` - shadcn Dialog wrapping react-dropzone zone; accept .WFenvir/.WFaction; idle/drag-active/uploading/success/error states; client-side extension validation; success shows imported item list; resets on dialog close
- `apps/console/src/features/environments/EnvironmentsPage.tsx` - EnvironmentCard grid with OID, version, action count, import date, hover-reveal delete with confirm; empty state; loading skeleton; Upload Package button opens dialog
- `apps/console/src/features/environments/EnvironmentDetailPage.tsx` - useParams :oid; back link; header; conditional Action/Value/Resource property sections; ActionsTable with VisibilityBadge and CodeStatusBadge
- `apps/console/src/features/actions/hooks.ts` - useAction(oid) with queryKey ['actions', oid], enabled: !!oid
- `apps/console/src/features/actions/ActionDetailPage.tsx` - useParams :oid; breadcrumb nav; InputParamsTable; OutputParamsTable; ActionPropertiesTable; CodeStatusSection with ISA-88 states and Edit links; opaque vs observable state subset

## Decisions Made

- **No Content-Type on FormData:** UploadDialog calls uploadMutation.mutateAsync(file) which routes through api.upload() — that function never sets Content-Type on FormData, letting the browser set the multipart boundary automatically. Consistent with the api.ts comment.
- **enabled: !!oid in useEnvironment/useAction:** Prevents TanStack Query from firing with an empty string oid if useParams returns undefined (e.g., during hydration).
- **App.tsx unchanged:** The routing tree was already fully wired in 07-01 with real component imports — no placeholder-to-real swap needed for this plan.
- **Opaque CODE_STATES subset:** Observable actions show all 16 ISA-88 states in Code Status; opaque actions show only STARTING, STOPPING, ABORTING, CLEARING (matching the opaque transition table from phase 03).

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Environments, Environment Detail, and Action Detail pages are fully functional
- Upload dialog wired to /management/v1/upload with FormData (no Content-Type override)
- hooks.ts pattern (useQuery + useMutation + invalidateQueries) established for remaining feature pages
- App.tsx routing complete — remaining placeholder pages (Instances, Log, Settings, Code Editor) ready for 07-03/07-04

---

_Phase: 07-management-console_
_Completed: 2026-02-27_
