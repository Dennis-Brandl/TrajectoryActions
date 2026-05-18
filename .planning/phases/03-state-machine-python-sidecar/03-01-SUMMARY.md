---
phase: 03-state-machine-python-sidecar
plan: 01
subsystem: engine
tags: [typescript, state-machine, isa-88, vitest, sqlite, better-sqlite3]

# Dependency graph
requires:
  - phase: 02-storage-layer
    provides: InstanceRepository, CodeVersionRepository, SettingsRepository, Instance type, updateState() with traceback field

provides:
  - ISA-88 state machine core: ObservableState/OpaqueState/Command types, TRANSITION_TABLE, AUTO_ADVANCE
  - StateMachine class with enterState(), sendCommand(), startInstance(), processCurrentState()
  - EngineError, InvalidStateTransitionError, ExecutionError error types
  - CodeExecutor injectable callback interface for Python worker pool
  - Two-tier error detail: error summary on error field, full traceback on traceback field

affects:
  - 03-02 (Python sandbox runner plugs into CodeExecutor interface)
  - 03-03 (PythonWorkerPool replaces mock CodeExecutor in production)
  - 04-rest-protocol (StateMachine.sendCommand() handles client commands)
  - 05-sse (StateMachineCallbacks.onStateChange/onTerminal drive SSE events)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - 'Transition table as Map<state, Map<command, targetState>> — O(1) lookup for any (state, command) pair'
    - 'Injectable CodeExecutor callback — StateMachine tests use vi.fn(), production uses PythonWorkerPool'
    - 'Two-tier error detail — error field holds summary (error_type: message), traceback field holds full Python traceback'
    - 'Deferred command pattern — executingInstances Set + deferredCommands Map for HOLD/STOP/ABORT during code execution'
    - 'processCurrentState() shared logic — called by both enterState() and startInstance() to avoid duplicate history entries'

key-files:
  created:
    - packages/engine/src/errors.ts
    - packages/engine/src/state-machine/states.ts
    - packages/engine/src/state-machine/transitions.ts
    - packages/engine/src/state-machine/state-machine.ts
    - packages/engine/src/__tests__/transitions.test.ts
    - packages/engine/src/__tests__/state-machine.test.ts
  modified:
    - packages/engine/src/index.ts
    - packages/storage/src/types.ts (added traceback field to Instance and InstanceRow)
    - packages/storage/src/repositories/instance.repository.ts (updateState supports traceback)
    - packages/storage/src/migrations/001-initial-schema.ts (traceback column in instances table)

key-decisions:
  - 'TRANSITION_TABLE and AUTO_ADVANCE built as Maps for O(1) lookup — no switch/if chains'
  - 'HOLD valid from all 9 active observable states per CONTEXT.md extension (mirrors ABORT flexibility)'
  - 'enterState()/processCurrentState() two-method split — enterState persists + emits, processCurrentState handles code/advance'
  - 'startInstance() calls processCurrentState() directly — avoids duplicate state_history entry from initial state'
  - 'Deferred commands (HOLD during code execution) stored in Map, applied after code executor returns in finally block'
  - 'traceback added to storage Instance type (deviation Rule 2) — required for two-tier error detail in state-machine.ts'

patterns-established:
  - 'StateMachine tests: createTestDeps() with real :memory: repositories + vi.fn() code executor for realistic testing'
  - 'makeSuccessResult()/makeFailureResult() factories for configurable CodeExecutionResult in tests'

# Metrics
duration: 8min
completed: 2026-02-25
---

# Phase 3 Plan 01: ISA-88 State Machine Core Summary

**ISA-88 state machine with typed transition tables, injectable CodeExecutor, deferred-HOLD support, and two-tier error detail — fully tested with 200 passing tests**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-02-25T22:10:00Z
- **Completed:** 2026-02-25T22:16:30Z
- **Tasks:** 3
- **Files modified:** 10

## Accomplishments

- 14 observable states + 4 opaque states as TypeScript literal unions with TRANSITION_TABLE, AUTO_ADVANCE, and OPAQUE_AUTO_ADVANCE Maps
- StateMachine class drives any action instance through its full ISA-88 lifecycle: STARTING -> EXECUTING -> COMPLETING -> COMPLETED, HOLD cycles, ABORT/STOP paths, and CLEAR recovery
- Code executor is injectable — tests use vi.fn() returning configurable CodeExecutionResult, production will plug in PythonWorkerPool from Plan 03-03
- Deferred-HOLD: HOLD/STOP/ABORT sent during code execution stored in deferredCommands Map, applied after the finally block removes the instance from executingInstances
- Two-tier error detail: execution failure stores summary (`error_type: message`) on error field and full Python traceback on traceback field separately

## Task Commits

Each task was committed atomically:

1. **Task 1: State types, transition tables, engine errors** - `decfd92` (feat)
2. **Task 2: StateMachine class implementation** - `d729299` (feat)
3. **Task 3: StateMachine tests** - `da059d3` (test)

**Plan metadata:** _(committed after this summary)_

## Files Created/Modified

- `packages/engine/src/errors.ts` — EngineError, InvalidStateTransitionError (code/currentState/command), ExecutionError (errorType)
- `packages/engine/src/state-machine/states.ts` — ObservableState, OpaqueState, Command, ANY_ACTIVE_STATES (9 states), TERMINAL_STATES, isTerminal/isActiveState helpers
- `packages/engine/src/state-machine/transitions.ts` — TRANSITION_TABLE, OPAQUE_TRANSITION_TABLE, AUTO_ADVANCE (10 entries), OPAQUE_AUTO_ADVANCE (3 entries), validateCommand()
- `packages/engine/src/state-machine/state-machine.ts` — StateMachine class with enterState/sendCommand/startInstance/processCurrentState/executeCode/autoAdvance
- `packages/engine/src/index.ts` — exports all types, constants, classes for downstream packages
- `packages/engine/src/__tests__/transitions.test.ts` — 79 tests covering all commands, SC auto-advance, and validateCommand
- `packages/engine/src/__tests__/state-machine.test.ts` — 21 tests covering happy path, HOLD cycle, error path, all commands, deferred HOLD, opaque, callbacks
- `packages/storage/src/types.ts` — added traceback?: string to Instance and InstanceRow (deviation Rule 2)
- `packages/storage/src/repositories/instance.repository.ts` — updateState() supports traceback in SQL and fromRow()
- `packages/storage/src/migrations/001-initial-schema.ts` — traceback TEXT column in instances table

## Decisions Made

- TRANSITION_TABLE and AUTO_ADVANCE built as Maps for O(1) lookup — avoids switch/if chains, directly maps StateMachineSpec.md §2 table rows
- HOLD from all 9 active states per CONTEXT.md extension (not just EXECUTING as in spec diagram) — consistent with ABORT flexibility
- Two-method split: enterState() persists + emits onStateChange, processCurrentState() handles code lookup/execute/advance — shared by both startInstance and enterState
- startInstance() calls processCurrentState() directly to avoid creating a duplicate state_history entry for the initial state (instance was already created with initial state)
- Deferred commands stored in a Map keyed by instanceId, checked and applied in the finally block after codeExecutor resolves — HOLD, STOP, ABORT all deferred this way
- traceback added to storage types as deviation Rule 2 (missing critical field required by the plan for two-tier error detail)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Added traceback field to storage Instance type and database schema**

- **Found during:** Task 2 (StateMachine class implementation)
- **Issue:** The plan's two-tier error detail requirement (CONTEXT.md: "full Python traceback stored on the instance") required a separate `traceback` field on Instance, but the existing `Instance` type and `instances` table only had an `error` field — the traceback would have been lost or conflated with the error summary
- **Fix:** Added `traceback: string | null` to `InstanceRow`, `Instance`, updated `create()` (sets null), `updateState()` (accepts optional traceback in updates object), `fromRow()` (maps traceback from row), and the `001-initial-schema.ts` migration (adds `traceback TEXT` column)
- **Files modified:** packages/storage/src/types.ts, packages/storage/src/repositories/instance.repository.ts, packages/storage/src/migrations/001-initial-schema.ts
- **Verification:** Build passes, state-machine tests verify instance.traceback contains the full Python traceback string separately from instance.error
- **Committed in:** decfd92 (Task 1 commit — added alongside storage type modifications)

---

**Total deviations:** 1 auto-fixed (1 missing critical)
**Impact on plan:** Required for two-tier error detail per CONTEXT.md decision. No scope creep.

## Issues Encountered

- Vitest 4.x changed `vi.fn<Params, Return>()` generic signature to `vi.fn<FunctionType>()` — fixed by using `vi.fn<CodeExecutor>()` syntax and `ReturnType<typeof vi.fn<CodeExecutor>>` for the interface type field

## Next Phase Readiness

- StateMachine class ready for Plan 03-02/03-03 to plug in the real PythonWorkerPool via the CodeExecutor interface
- All 200 engine tests pass (79 transition + 21 state machine, each running from both src and dist)
- storage layer types updated with traceback — any existing storage tests still pass
- No blockers for proceeding with Python sidecar plans (03-02, 03-03)

---

_Phase: 03-state-machine-python-sidecar_
_Completed: 2026-02-25_
