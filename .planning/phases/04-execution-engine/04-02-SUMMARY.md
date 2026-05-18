---
phase: 04-execution-engine
plan: 02
subsystem: engine
tags:
  [typescript, sqlite, python, state-machine, worker-pool, instance-manager, integration-testing]

# Dependency graph
requires:
  - phase: 04-01
    provides: instance-manager types, parameter-resolver, execution-logger, StateMachine property resolution, PythonWorkerPool resize
  - phase: 03-01
    provides: StateMachine with CodeExecutor interface, callbacks, deferred commands
  - phase: 03-03
    provides: PythonWorkerPool with acquire/release, crash recovery, resize, killWorker
  - phase: 02-01
    provides: All 6 repositories via @trajectory/storage, initializeDatabase()
provides:
  - InstanceManager class — central orchestrator wiring pool, state machine, logger, and parameter resolution
  - invoke() creates instance with pinned code, starts async execution, returns InvokeResult immediately
  - sendCommand() delegates to StateMachine, getInstance(), getActiveInstances(), resizePool(), shutdown()
  - poolSize/poolStatus getters for runtime introspection
  - 26 new tests (15 InstanceManager integration + 11 parameter-resolver unit)
affects: [05-rest-protocol, future-phases]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - 'InstanceManager fire-and-forget: invoke() calls startInstance().catch() without await — caller gets InvokeResult immediately'
    - 'Retrying executor pattern: wraps pool.executeCode with one retry on WORKER_CRASH/RUNTIME_ERROR, exempt for ABORTING/STOPPING/CLEARING'
    - 'Code pinning at invocation time: getAllActiveVersions() snapshot prevents mid-run code version changes'
    - 'onTerminal writes ExecutionLogger before forwarding to caller callback'

key-files:
  created:
    - packages/engine/src/instance-manager/instance-manager.ts
    - packages/engine/src/__tests__/parameter-resolver.test.ts
    - packages/engine/src/__tests__/instance-manager.test.ts
  modified:
    - packages/engine/src/index.ts

key-decisions:
  - 'SettingsRepository python_pool_size takes precedence over options.poolSize — DB is source of truth for runtime config'
  - 'LogRepository.query() returns {entries, total} not an array — test correctly uses .entries property'
  - 'All InstanceManager tests use 30s timeout — shutdown() in finally block waits up to 10s for busy Python workers'
  - "RETRY_EXEMPT_STATES = Set(['ABORTING','STOPPING','CLEARING']) — matches CONTEXT.md: cleanup code must never retry after crash"

patterns-established:
  - 'Integration test pattern: shared DB/repos in beforeAll, fresh InstanceManager per test with try/finally shutdown()'
  - 'Terminal promise pattern: new Promise<string> resolved in onTerminal callback for awaiting async execution'

# Metrics
duration: 6min
completed: 2026-02-26
---

# Phase 4 Plan 02: InstanceManager Summary

**InstanceManager class wires PythonWorkerPool + StateMachine + ExecutionLogger + parameter resolution into a single invoke/sendCommand/getInstance API with retrying code executor and automatic execution log writes on terminal state**

## Performance

- **Duration:** ~6 min
- **Started:** 2026-02-26T15:27:25Z
- **Completed:** 2026-02-26T15:33:40Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- InstanceManager class delivering the complete Phase 5-ready public API: invoke(), sendCommand(), getInstance(), getActiveInstances(), resizePool(), shutdown(), poolSize/poolStatus
- Retrying code executor wrapping pool.executeCode with one retry on WORKER_CRASH/RUNTIME_ERROR (exempt for ABORTING/STOPPING/CLEARING), matching CONTEXT.md "same as crash — retry once" spec
- 15 integration tests proving: invoke returns immediately, parameters resolve with defaults, code versions are pinned, instance reaches COMPLETED, execution log is written, sendCommand HOLD->HELD, resizePool, concurrent invocations, shutdown
- 11 unit tests for resolveInputParameters and flattenProperties covering all edge cases

## Task Commits

Each task was committed atomically:

1. **Task 1: InstanceManager class implementation** - `f9056c9` (feat)
2. **Task 2: Parameter resolver tests and InstanceManager tests** - `a83c50f` (test)

**Plan metadata:** (docs commit follows)

## Files Created/Modified

- `packages/engine/src/instance-manager/instance-manager.ts` - Central orchestrator: all constructor wiring, makeRetryingExecutor(), pinCodeVersions(), invoke(), sendCommand(), getInstance(), getActiveInstances(), resizePool(), shutdown(), poolSize/poolStatus
- `packages/engine/src/__tests__/instance-manager.test.ts` - 15 integration tests with real SQLite and Python
- `packages/engine/src/__tests__/parameter-resolver.test.ts` - 11 unit tests for resolver and flatten helpers
- `packages/engine/src/index.ts` - Added InstanceManager export

## Decisions Made

- **SettingsRepository takes precedence over options.poolSize**: `getNumericValue('python_pool_size')` returns 4 from DB default. The options.poolSize is a fallback only when DB returns null. This is correct behavior — DB is source of truth for runtime config. Tests updated to not assume a specific initial pool size.
- **LogRepository.query() API**: Returns `{ entries, total }` not a bare array — test uses `.entries`. Discovered during test failure, fixed immediately (Rule 1 - bug in test assertion, not production code).
- **Test timeout strategy**: All InstanceManager tests use 30000ms timeout. Each test calls `shutdown()` in finally block; shutdown waits up to 10s for busy Python workers (default pool size 4 means 4 workers to wait for). Quick tests (invoke/getInstance/poolStatus) actually take 10s due to shutdown waiting for async execution to complete.

## Deviations from Plan

None - plan executed exactly as written. Test assertion bugs discovered and fixed inline before the commit (not counted as deviations since they were pre-commit discovery in the same work session).

## Issues Encountered

- **Test assertion: `toThrow('PARAMETER_VALIDATION_FAILED')` vs error code**: The EngineError `.code` field is `PARAMETER_VALIDATION_FAILED` but `.message` is `"Missing required parameter: ..."`. Vitest's `toThrow(string)` checks the message, not the code. Fixed to `toThrowError(expect.objectContaining({ code: 'PARAMETER_VALIDATION_FAILED' }))`.
- **LogRepository.query() returns object, not array**: `logRepo.query({ actionOid })` returns `{ entries, total }`. Test fixed to use `.entries`.
- **Pool size 4, not 2**: SettingsRepository seeds `python_pool_size = 4` by default. Options `poolSize: 2` is only a fallback when DB returns null. Removed the assumption from the resizePool test.

## Next Phase Readiness

- Phase 5 (REST Protocol) can begin immediately — InstanceManager exports `invoke()`, `sendCommand()`, `getInstance()`, `getActiveInstances()`, `resizePool()`, `shutdown()` — everything the REST layer needs
- All types exported from `@trajectory/engine`: `InstanceManager`, `InvokeRequest`, `InvokeResult`, `InstanceManagerOptions`
- 733 total tests pass, full monorepo builds clean

---

_Phase: 04-execution-engine_
_Completed: 2026-02-26_
