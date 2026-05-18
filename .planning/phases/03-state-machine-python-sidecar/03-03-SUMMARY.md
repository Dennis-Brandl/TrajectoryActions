---
phase: 03-state-machine-python-sidecar
plan: 03
subsystem: engine
tags: [node, child_process, readline, spawn, python, worker-pool, subprocess, ipc]

# Dependency graph
requires:
  - phase: 03-01
    provides: StateMachine class and CodeExecutor type that pool.executeCode must implement
  - phase: 03-02
    provides: sandbox_runner.py subprocess protocol (stdin/stdout newline-delimited JSON)
  - phase: 02-01
    provides: InstanceRepository, CodeVersionRepository, SettingsRepository for integration test
provides:
  - PythonWorker: single subprocess wrapper (spawn + readline + JSON protocol)
  - PythonWorkerPool: N-worker pool with acquire/release, FIFO queue, crash recovery, recycling
  - SidecarRequest/SidecarResponse TypeScript interfaces matching ExecutionEngineSpec.md §2.2
  - executeCode() implementing CodeExecutor interface — pluggable into StateMachine
  - killWorker(instanceId) for ABORT/STOP support
  - End-to-end integration test proving full pipeline: StateMachine -> pool -> Python
affects: [04-rest-protocol, 05-server-sse, 06-action-resolution]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - PythonWorker extends EventEmitter — emits 'close' for pool crash detection
    - readline.createInterface on process.stdout for line-based JSON response splitting
    - crashHandledWorkers Set prevents double-replacement when release() follows crash handler
    - FIFO waitQueue stores Promise resolve callbacks — served when workers become available

key-files:
  created:
    - packages/engine/src/python-pool/types.ts
    - packages/engine/src/python-pool/worker.ts
    - packages/engine/src/python-pool/pool.ts
    - packages/engine/src/__tests__/worker.test.ts
    - packages/engine/src/__tests__/pool.test.ts
    - packages/engine/src/__tests__/integration.test.ts
  modified:
    - packages/engine/src/index.ts

key-decisions:
  - "PythonWorker extends EventEmitter to emit 'close' for pool crash recovery"
  - 'crashHandledWorkers Set prevents double-replacement: crash handler + release() both called when worker crashes while busy'
  - "Python path is 'python' (not 'python3') — production Windows environment uses 'python'"
  - 'Relative path from __tests__/ to python-sidecar is ../../../python-sidecar/sandbox_runner.py (not ../../../../)'
  - 'Worker timeout = request.timeout_ms + 5000ms grace — allows Python-side timeout to fire first'

patterns-established:
  - "Worker pool crash recovery: handle in 'close' event handler, track in Set to prevent double-spawn"
  - 'executeCode finally block: always release worker, even on error or crash'
  - 'activeExecutions Map: instanceId -> worker for killWorker ABORT/STOP support'

# Metrics
duration: 10min
completed: 2026-02-26
---

# Phase 3 Plan 03: Python Worker Pool Summary

**PythonWorker (single subprocess wrapper) and PythonWorkerPool (N-worker manager) bridging StateMachine's CodeExecutor interface to real Python execution via sandbox_runner.py stdin/stdout JSON protocol**

## Performance

- **Duration:** 10 min
- **Started:** 2026-02-26T03:20:25Z
- **Completed:** 2026-02-26T03:30:46Z
- **Tasks:** 3
- **Files modified:** 7 (6 created, 1 modified)

## Accomplishments

- PythonWorker spawns `python -u sandbox_runner.py` via node:child_process, uses readline.createInterface for line-based JSON parsing, and handles SIGTERM/SIGKILL graceful termination
- PythonWorkerPool manages N workers with FIFO acquire/release queue, automatic crash recovery (crashHandledWorkers Set prevents double-spawn), worker recycling after configurable max executions, and killWorker(instanceId) for ABORT/STOP
- End-to-end integration test proves StateMachine + PythonWorkerPool + sandbox_runner.py work together: inputs received by Python, outputs returned to instance, all three lifecycle paths verified (COMPLETED, HELD, ABORTED)

## Task Commits

Each task was committed atomically:

1. **Task 1: SidecarRequest/Response types and PythonWorker class** - `7648ce4` (feat)
2. **Task 2: PythonWorkerPool with acquire/release, crash recovery, recycling, and CodeExecutor bridge** - `f90fb6d` (feat)
3. **Task 3: End-to-end integration test** - `e368905` (feat)

## Files Created/Modified

- `packages/engine/src/python-pool/types.ts` - SidecarRequest and SidecarResponse interfaces matching ExecutionEngineSpec.md §2.2
- `packages/engine/src/python-pool/worker.ts` - PythonWorker class: spawn, readline, execute(), kill(), killWithGrace(), EventEmitter 'close' for crash detection
- `packages/engine/src/python-pool/pool.ts` - PythonWorkerPool: acquire/release, FIFO waitQueue, crash recovery, recycling, executeCode(), killWorker(), graceful shutdown
- `packages/engine/src/__tests__/worker.test.ts` - 10 integration tests against real sandbox_runner.py
- `packages/engine/src/__tests__/pool.test.ts` - 10 integration tests: acquire/release, concurrent execution, queuing, recycling, crash recovery, killWorker, shutdown
- `packages/engine/src/__tests__/integration.test.ts` - 3 end-to-end tests: COMPLETED path (inputs/outputs), HELD path (return False), ABORTED path (exception + traceback)
- `packages/engine/src/index.ts` - Added exports for PythonWorker, PythonWorkerPool, SidecarRequest, SidecarResponse

## Decisions Made

- `PythonWorker` extends `EventEmitter` so the pool can listen for the 'close' event to detect crashes and spawn replacements without polling
- `crashHandledWorkers` Set: when a worker crashes while busy, `handleWorkerCrash` spawns a replacement and marks the worker; then `executeCode`'s `finally` calls `release()`, which skips spawning a second replacement
- Python binary is `'python'` not `'python3'` — Windows environment uses `python`, confirmed during development
- Path from `src/__tests__/` to `packages/python-sidecar/sandbox_runner.py` is `../../../python-sidecar/sandbox_runner.py` (3 levels up, not 4)
- Worker Node.js-side timeout = `request.timeout_ms + 5000ms` grace so Python-side timeout fires first and returns a proper error response rather than the Node.js side killing the worker

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed `catch (err)` unused variable ESLint error in worker.ts**

- **Found during:** Task 1 (PythonWorker class)
- **Issue:** `catch (err)` on JSON parse failure — `err` never referenced, ESLint `@typescript-eslint/no-unused-vars` blocks commit
- **Fix:** Changed to `catch` (no binding) — valid TypeScript/ES2019+ syntax
- **Files modified:** packages/engine/src/python-pool/worker.ts
- **Verification:** ESLint passes, build succeeds, all tests still pass
- **Committed in:** 7648ce4 (Task 1 commit, post-fix rebuild)

**2. [Rule 1 - Bug] Fixed double-replacement in pool when busy worker crashes**

- **Found during:** Task 2 (pool.test.ts killWorker test)
- **Issue:** When a worker crashed while busy (killWorker scenario), both `handleWorkerCrash` and `release()` each spawned a replacement — pool size grew from 1 to 2
- **Fix:** Added `crashHandledWorkers: Set<PythonWorker>` — crash handler marks workers it handles; `release()` skips spawning if marked
- **Files modified:** packages/engine/src/python-pool/pool.ts
- **Verification:** killWorker test: pool.size === 1 after kill + recovery
- **Committed in:** f90fb6d (Task 2 commit)

**3. [Rule 1 - Bug] Corrected relative path from 4 levels up to 3 levels up for sandbox_runner.py**

- **Found during:** Task 1 (worker.test.ts path resolution)
- **Issue:** Plan specified `../../../../python-sidecar/sandbox_runner.py` (4 levels) but test files are at `packages/engine/src/__tests__/`, so the correct path is `../../../python-sidecar/sandbox_runner.py` (3 levels)
- **Fix:** Corrected relative path in worker.test.ts; verified with Node.js path.resolve()
- **Files modified:** packages/engine/src/**tests**/worker.test.ts
- **Verification:** All 10 worker tests pass against real sandbox_runner.py
- **Committed in:** 7648ce4 (Task 1 commit)

---

**Total deviations:** 3 auto-fixed (3 × Rule 1 — bugs)
**Impact on plan:** All fixes necessary for correctness. No scope creep.

## Issues Encountered

- Vitest discovers both `src/` and `dist/` test files — both sets run against real Python processes. This is expected behaviour given how the engine vitest project is configured (no sourceDir filter). Both pass.
- `describe()` with options object `{ timeout: 30000 }` is not valid Vitest syntax — timeout must be passed per-test as third argument. Fixed by moving timeout to individual `it()` calls.

## Next Phase Readiness

- Full execution pipeline ready: StateMachine.startInstance() -> PythonWorkerPool.executeCode() -> sandbox_runner.py -> Python code -> outputs back to DB instance
- Phase 3 complete: state machine (03-01) + Python sidecar (03-02) + worker pool bridge (03-03)
- Phase 4 (REST protocol) can now wire real PythonWorkerPool into StateMachine for server requests
- killWorker(instanceId) provides the ABORT/STOP hook needed by the REST protocol layer

---

_Phase: 03-state-machine-python-sidecar_
_Completed: 2026-02-26_
