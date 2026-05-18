---
phase: 06-management-api
plan: 01
subsystem: api
tags: [express, multer, management, upload, wfenvir, wfaction, dashboard, sqlite, transaction]

# Dependency graph
requires:
  - phase: 05-Trajectory-rest-protocol
    provides: Express server structure, createProtocolRouter factory pattern, errorHandler, SseManager, createTestApp test pattern
  - phase: 02-storage-layer
    provides: EnvironmentRepository, ActionRepository, CodeVersionRepository, InstanceRepository, LogRepository, SettingsRepository, createTransactionHelper
  - phase: 04-execution-engine
    provides: InstanceManager with poolStatus
provides:
  - createManagementRouter factory in packages/server/src/routes/management.ts
  - POST /management/v1/upload with multer, all-or-nothing transaction, diff computation, orphan deletion
  - GET /management/v1/dashboard with container info, pool status, env/instance/log stats
  - GET /management/v1/environments and GET /management/v1/environments/:oid
  - DELETE /management/v1/environments/:oid with active instance check (409)
  - GET /management/v1/actions/:oid with environment name and code summary
  - Management router mounted at /management/v1 in packages/server/src/index.ts
  - 22 integration tests covering all MGMT-01 through MGMT-06 endpoints
affects: [06-02, 06-03, future console phase]

# Tech tracking
tech-stack:
  added: [multer@2.1.0, @types/multer@2.0.0]
  patterns:
    - createManagementRouter factory pattern (mirrors createProtocolRouter, receives all repos + dbPath)
    - All-or-nothing upload via createTransactionHelper(db).transaction()
    - Diff computation by comparing incoming vs existing action sets before upsert
    - Module-level Python version cache (execSync once on first factory call)
    - Explicit delete ordering in MGMT-05: code_versions then actions then environment

key-files:
  created:
    - packages/server/src/routes/management.ts
    - packages/server/src/__tests__/management.test.ts
  modified:
    - packages/server/src/index.ts
    - packages/server/package.json

key-decisions:
  - "createManagementRouter receives dbPath: string as second param for dashboard db_size_bytes via statSync"
  - "cachedPythonVersion is module-level let — set once on first factory invocation, null if python not found"
  - "Upload all-or-nothing: JSON parsing and field validation done eagerly before transaction to produce correct 400 before any DB writes"
  - "MGMT-05 delete ordering: fetch actions list, delete code_versions, delete actions, delete environment — avoids referencing deleted data"
  - "No auth middleware on management routes (open by design per CONTEXT.md)"
  - "CORS methods updated to include PUT for future settings endpoint (MGMT-18)"
  - "Diff computation compares local_id for display; OID-based comparison for added/removed/modified detection"

patterns-established:
  - "Management router uses same void res.status() early return pattern as protocol.ts"
  - "Integration tests use createTestApp() factory with fresh :memory: DB + InstanceManager poolSize:1"
  - "seedEnvironment(db, opts?) and seedAction(db, envOid, opts?) helpers for management tests"
  - "makeEnvJson() helper produces valid .WFenvir JSON for upload tests"

# Metrics
duration: 7min
completed: 2026-02-27
---

# Phase 6 Plan 01: Management API Foundation Summary

**multer-powered .WFenvir/.WFaction upload with all-or-nothing transactions, diff computation, and MGMT-01 through MGMT-06 CRUD endpoints mounted at /management/v1**

## Performance

- **Duration:** 7 min
- **Started:** 2026-02-27T15:38:36Z
- **Completed:** 2026-02-27T15:45:17Z
- **Tasks:** 3
- **Files modified:** 4

## Accomplishments

- Management router factory with 6 endpoint groups (upload, environments list/detail/delete, action detail, dashboard) — all using {data, meta} envelope
- Multer 2.x memory storage upload with all-or-nothing SQLite transaction, diff summary (added/removed/modified), and orphan action deletion on re-upload
- 22 integration tests covering all MGMT-01 through MGMT-06 happy paths and key error cases — total test suite now 836 (814 + 22 new)

## Task Commits

Each task was committed atomically:

1. **Task 1: Install multer and create management router** - `f1e0e3e` (feat)
2. **Task 2: Wire management router into server index.ts** - `7d82e0e` (feat)
3. **Task 3: Integration tests** - `c534baf` (test)

**Plan metadata:** (created below in docs commit)

## Files Created/Modified

- `packages/server/src/routes/management.ts` - createManagementRouter factory with MGMT-01 through MGMT-06 endpoints
- `packages/server/src/index.ts` - imports and mounts management router at /management/v1, CORS updated with PUT
- `packages/server/package.json` - added multer@2.1.0 and @types/multer@2.0.0
- `packages/server/src/__tests__/management.test.ts` - 22 integration tests

## Decisions Made

- `createManagementRouter` receives `dbPath: string` as second parameter so the dashboard can report `db_size_bytes` via `statSync(dbPath).size` (catches errors if ':memory:')
- `cachedPythonVersion` is a module-level `let` initialized to `null`, set once on first factory call via `execSync('python --version')`
- Upload validation (JSON parsing + required fields) happens eagerly before the transaction to produce correct 400 responses without any partial DB writes — true all-or-nothing
- MGMT-05 delete order: fetch actions list first, then delete code_versions per action, then `deleteByEnvironment`, then `delete` environment — avoids referencing orphaned rows
- No auth middleware on `/management/v1` routes (open by design per CONTEXT.md decision)
- CORS methods updated to include `PUT` for future settings endpoint compatibility (MGMT-18)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## Next Phase Readiness

- Management router foundation complete with all MGMT-01 through MGMT-06 endpoints
- 06-02 can add code management endpoints to the same router (createManagementRouter extended or separate router)
- 06-03 can add instance/log/settings endpoints to the same router

---

_Phase: 06-management-api_
_Completed: 2026-02-27_
