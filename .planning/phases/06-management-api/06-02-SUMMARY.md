---
phase: 06-management-api
plan: 02
subsystem: api
tags: [express, code-versioning, dry-run, python-pool, integration-tests]

# Dependency graph
requires:
  - phase: 06-01
    provides: management router foundation with env/action/upload endpoints
  - phase: 04-02
    provides: InstanceManager with Python pool
  - phase: 02-02
    provides: CodeVersionRepository with saveAndActivate, getVersionHistory, getActive, activate

provides:
  - MGMT-07: GET /code/:action_oid/:state (version list, metadata only — no source_code)
  - MGMT-08: GET /code/:action_oid/:state/active (active version with full source)
  - MGMT-08: GET /code/:action_oid/:state/:version_id (specific version with full source)
  - MGMT-09: POST /code/:action_oid/:state (save new version, deactivate previous)
  - MGMT-10: POST /code/:action_oid/:state/:version_id/activate (rollback)
  - MGMT-11: DELETE /code/:action_oid/:state/:version_id (409 active/pinned guards)
  - MGMT-12: POST /code/:action_oid/:state/test (dry-run via testCode())
  - testCode() method on InstanceManager for direct code execution without instance records
  - 24 integration tests covering all 6 code endpoints

affects:
  - 06-03 (instance/log/settings endpoints — builds on same management router)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - 'Literal routes (/active, /test) registered before parameterized (/:version_id) in Express'
    - 'testCode() bypasses retrying executor — dry-run failures return immediately'
    - 'MGMT-12 tests use beforeAll/afterAll shared manager for stable Python execution'
    - 'stdout_capture/stderr_capture field names from CodeExecutionResult (not stdout/stderr)'

key-files:
  created:
    - packages/server/src/__tests__/management-code.test.ts
  modified:
    - packages/engine/src/instance-manager/instance-manager.ts
    - packages/server/src/routes/management.ts

key-decisions:
  - 'testCode() intentionally calls pool.executeCode() directly, bypassing retrying executor — dry-run failures should return immediately (not retry)'
  - "Literal route paths (/active, /test) must be registered BEFORE parameterized (/:version_id) to prevent Express treating 'active' as a version_id"
  - 'MGMT-11 delete checks is_active first (409), then instanceRepo.findActive() pinned check (409), then raw DELETE statement (no deleteById on repo)'
  - 'MGMT-12 integration tests use shared manager with beforeAll/afterAll to avoid process exhaustion on Windows'
  - 'SCRIPT_PATH in management-code.test.ts uses 3 levels up (../../../) not 4 to reach packages/python-sidecar/'

patterns-established:
  - 'Code management endpoints follow /code/:action_oid/:state/* URL hierarchy'
  - 'Version list (MGMT-07) strips source_code from response — metadata only with code_size'
  - 'Version retrieval (MGMT-08) includes full source_code'
  - 'Save (MGMT-09) uses saveAndActivate — single transaction deactivates previous, activates new'
  - 'Rollback (MGMT-10) uses activate() — no new row, just flips is_active flags'

# Metrics
duration: 16min
completed: 2026-02-27
---

# Phase 6 Plan 02: Code Management Endpoints Summary

**6 code management endpoints (MGMT-07 to MGMT-12) and testCode() dry-run method enabling the full code versioning workflow: list, retrieve, save, rollback, delete, and test Python code**

## Performance

- **Duration:** 16 min
- **Started:** 2026-02-27T15:49:32Z
- **Completed:** 2026-02-27T16:05:04Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- Added testCode() to InstanceManager with explicit JSDoc documenting intentional retry bypass for dry-run semantics
- Added all 6 code management endpoints to management router with correct route ordering (literal before parameterized)
- Created 24 integration tests covering MGMT-07 through MGMT-12, including active guard, pinned-by-instance guard, and dry-run execution

## Task Commits

Each task was committed atomically:

1. **Task 1: Add testCode() and code management endpoints** - `37e572b` (feat)
2. **Task 2: Integration tests for code management endpoints** - `c6be91b` (test)

**Plan metadata:** (see final commit below)

## Files Created/Modified

- `packages/engine/src/instance-manager/instance-manager.ts` - Added testCode() method
- `packages/server/src/routes/management.ts` - Added 6 code management endpoints (MGMT-07 through MGMT-12)
- `packages/server/src/__tests__/management-code.test.ts` - 24 integration tests for all code endpoints

## Decisions Made

- **testCode() bypasses retry executor**: Dry-run failures should return immediately to the caller. Retry is not appropriate for test/validation runs. Documented in JSDoc.
- **Route ordering**: Express registers routes in order, so literal paths (/active, /test) must come before parameterized (/:version_id) or 'active' would be treated as a version_id.
- **Raw DELETE**: CodeVersionRepository has no `deleteById()`. Used `db.prepare('DELETE FROM code_versions WHERE id = ?').run(version_id)` directly in the route since a repo method wasn't needed elsewhere.
- **beforeAll/afterAll for MGMT-12 tests**: Python dry-run tests need a stable, warmed-up worker. Using per-test `createTestApp()` caused worker crashes due to the wrong SCRIPT_PATH (4 levels up instead of 3). Fixed path and used shared manager pattern.
- **SCRIPT_PATH correction**: `packages/server/src/__tests__/` is 3 levels from `packages/`, not 4. The existing `management.test.ts` has an incorrect path (4 levels) but doesn't fail because it never actually executes Python.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed stdout/stderr field names in testCode()**

- **Found during:** Task 1 (build verification)
- **Issue:** Used `result.stdout` and `result.stderr` but `CodeExecutionResult` has `stdout_capture` and `stderr_capture`
- **Fix:** Updated field references to `result.stdout_capture` and `result.stderr_capture`
- **Files modified:** packages/engine/src/instance-manager/instance-manager.ts
- **Verification:** `npm run build` passed after fix
- **Committed in:** 37e572b (Task 1 commit)

**2. [Rule 1 - Bug] Fixed SCRIPT_PATH in management-code.test.ts**

- **Found during:** Task 2 (MGMT-12 test failures with WORKER_CRASH exit code 2)
- **Issue:** Used `'../../../../python-sidecar/sandbox_runner.py'` (4 levels up, pointing to nonexistent root directory). Python workers crashed on startup. Syntax error tests masked this — they returned `success: false` which matched the WORKER_CRASH result, but valid Python tests expected `success: true` and failed.
- **Fix:** Changed to `'../../../python-sidecar/sandbox_runner.py'` (3 levels up = `packages/python-sidecar/`)
- **Files modified:** packages/server/src/**tests**/management-code.test.ts
- **Verification:** All 24 MGMT-12 tests pass including dry-run execution returning `success: true`
- **Committed in:** c6be91b (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (2 bugs)
**Impact on plan:** Both fixes necessary for correctness. No scope creep.

## Issues Encountered

- TypeScript type mismatch: CodeExecutionResult uses `stdout_capture`/`stderr_capture` (not `stdout`/`stderr`) — caught at compile time, fixed immediately.
- WORKER_CRASH exit code 2: Python workers were crashing with "Worker crashed with exit code 2" because the sidecar script path was incorrect. The diagnosis was subtle because syntax error tests masked the issue (WORKER_CRASH also returns `success: false`). Only valid execution tests expose the path bug since they expect `success: true`.

## Next Phase Readiness

- Code management lifecycle is complete: save → list → get active → rollback → delete old → test
- MGMT-12 dry-run confirms testCode() works correctly with the Python pool
- 06-03 (instance/log/settings endpoints) can proceed using the same management router pattern

---

_Phase: 06-management-api_
_Completed: 2026-02-27_
