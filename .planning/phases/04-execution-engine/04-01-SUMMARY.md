---
phase: 04
plan: 01
title: 'Instance Manager Prerequisites — Types, Helpers, and Existing Code Updates'
subsystem: execution-engine
tags:
  [typescript, instance-manager, state-machine, python-pool, parameter-resolver, execution-logger]

dependency-graph:
  requires:
    - '03-01: StateMachine core (state-machine.ts)'
    - '03-03: PythonWorkerPool (pool.ts)'
    - '02-02: ActionRepository, EnvironmentRepository, CodeVersionRepository'
    - '02-03: LogRepository, SettingsRepository, InstanceRepository'
  provides:
    - 'InvokeRequest, InvokeResult, InstanceManagerOptions interfaces'
    - 'resolveInputParameters function with provided/default/missing parameter logic'
    - 'flattenProperties function for nested property specs to flat dicts'
    - 'ExecutionLogger class with writeLog method'
    - 'StateMachine extended with optional ActionRepo/EnvironmentRepo for property resolution'
    - 'PythonWorkerPool resize() method with mutable _targetPoolSize and drain semantics'
  affects:
    - '04-02: InstanceManager (direct consumer of all deliverables)'

tech-stack:
  added: []
  patterns:
    - 'Optional constructor parameters for backwards-compatible extension of StateMachine'
    - 'Effective-size calculation for busy-crashed workers in handleWorkerCrash (size-1 accounting)'
    - 'Drain-on-release pattern for pool shrink (busy workers drain naturally via release())'

key-files:
  created:
    - packages/engine/src/instance-manager/types.ts
    - packages/engine/src/instance-manager/parameter-resolver.ts
    - packages/engine/src/instance-manager/execution-logger.ts
  modified:
    - packages/engine/src/state-machine/state-machine.ts
    - packages/engine/src/python-pool/pool.ts
    - packages/engine/src/index.ts

decisions:
  - '[04-01]: StateMachine optional repo params placed AFTER callbacks — additive pattern, no existing test changes needed'
  - '[04-01]: handleWorkerCrash uses effectiveSize (size-1 for busy workers) — busy crashed worker still in busyWorkers Set at crash time, needs -1 adjustment for correct targetPoolSize comparison'
  - '[04-01]: Pool drain-on-release pattern — busy workers in excess of target naturally drain when they finish; no forced termination of executing workers during resize-down'

metrics:
  duration: '~4min'
  completed: '2026-02-26'
---

# Phase 4 Plan 01: Instance Manager Prerequisites Summary

**One-liner:** Three new files (types/parameter-resolver/execution-logger) plus StateMachine property resolution and PythonWorkerPool runtime resize, providing all prerequisites for InstanceManager (Plan 04-02).

## What Was Built

### New Files

**`packages/engine/src/instance-manager/types.ts`**
Defines three interfaces consumed by InstanceManager:

- `InvokeRequest` — workflow invocation payload (action_oid, workflow_instance_id, step context, input_parameters, optional timeout_ms)
- `InvokeResult` — invocation response (instance ID, status, created_at, optional sse_endpoint for observable actions)
- `InstanceManagerOptions` — constructor configuration (pythonPath, scriptPath, poolSize, callback hooks for state changes, terminal events, and errors)

**`packages/engine/src/instance-manager/parameter-resolver.ts`**

Two exported functions:

- `resolveInputParameters(provided, specs)` — merges InvokeRequest parameters with action spec defaults; throws `EngineError('PARAMETER_VALIDATION_FAILED')` for missing required params; pass-through for extra provided params not in specs; returns `Array<{ key, value }>` for InstanceRepository storage
- `flattenProperties(specs)` — converts nested property specifications `[{ name, entries: [{ name, value }] }]` into `Record<string, Record<string, string>>` for CodeExecutor envProps/actionProps; handles empty/null input gracefully

**`packages/engine/src/instance-manager/execution-logger.ts`**

`ExecutionLogger` class injected with six repositories (action, environment, codeVersion, log, settings, instance). The `writeLog(instanceId, terminalState, instance)` method:

1. Guards against double-logging via `instance.is_logged`
2. Resolves action and environment names via repos
3. Reads `log_max_size` from settings (default 10000)
4. Calculates `durationMs` using `started_at ?? created_at` fallback (per research Pitfall 4)
5. Builds `code_versions_used` Record by resolving pinned version IDs to version numbers
6. Calls `logRepo.insert()` then `instanceRepo.markLogged()`

### Modified Files

**`packages/engine/src/state-machine/state-machine.ts`**

- Added optional `ActionRepository` and `EnvironmentRepository` constructor params (after `callbacks`, before nothing — backwards compatible)
- Imported `flattenProperties` from `../instance-manager/parameter-resolver.js`
- `executeCode()` now resolves real `envProps` and `actionProps` via repos when both are provided; falls back to `{}` when repos are absent (all 21 Phase 3 state-machine tests unaffected)

**`packages/engine/src/python-pool/pool.ts`**

- `poolSize` renamed to `_targetPoolSize` (removed `readonly`)
- Added `targetPoolSize` getter
- Added `resize(newSize)` public method: scale-up spawns new workers immediately; scale-down kills idle workers; busy workers drain naturally via `release()` drain check
- `release()` drain check: disposes worker instead of returning to idle when `size > _targetPoolSize`
- `handleWorkerCrash()` uses `effectiveSize = wasBusy ? size - 1 : size` — correctly determines whether to spawn replacement since busy crashed worker remains in `busyWorkers` Set at crash time

**`packages/engine/src/index.ts`**

Added exports for all new instance-manager module members and `PythonWorkerPoolOptions` type.

## Decisions Made

| Decision                                               | Rationale                                                                                                                                                                                 |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Optional repo params after `callbacks` in StateMachine | Additive placement keeps full backwards compatibility — all 21 Phase 3 tests pass without changes                                                                                         |
| `effectiveSize = size - 1` for busy crashed workers    | Busy crashed worker still counted in `busyWorkers.size` at crash time; without -1 adjustment, crash recovery logic incorrectly concludes pool is at target and skips spawning replacement |
| Drain-on-release for resize-down                       | Avoids forcibly terminating executing workers; busy workers return to idle pool but are immediately disposed there when `size > targetPoolSize`                                           |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed `handleWorkerCrash` effectiveSize calculation for busy workers**

- **Found during:** Task 2 — running `npm test` after modifying `handleWorkerCrash`
- **Issue:** The plan's proposed condition `this.size < this._targetPoolSize` for crash replacement spawning fails when a busy worker crashes. At crash time, the dead worker is still in `busyWorkers` (it's only removed by `release()` which runs after `executeCode`'s finally block). So `size = 1` (idle=0, busy=1) equals `targetPoolSize = 1`, causing `size < targetPoolSize` to be `false` — no replacement spawned. Test: `killWorker terminates execution for a specific instance` expected `pool.size` to recover to 1.
- **Fix:** Added `const effectiveSize = wasBusy ? this.size - 1 : this.size` and used `effectiveSize < this._targetPoolSize` for the spawning condition
- **Files modified:** `packages/engine/src/python-pool/pool.ts`
- **Commit:** 502ec8d

## Test Results

All 706 tests pass across 28 test files:

- 79 transition tests x2 (src + dist)
- 21 state-machine tests x2
- 10 worker tests x2
- 10 pool tests x2
- 3 integration tests x2
- Storage layer tests (all unchanged)

## Next Phase Readiness

Plan 04-02 (InstanceManager) can now start. All prerequisites are in place:

- `InvokeRequest` and `InvokeResult` types defined
- `resolveInputParameters` ready to process workflow invocations
- `ExecutionLogger` ready to write terminal state logs
- `StateMachine` can accept real repos for property resolution
- `PythonWorkerPool` supports runtime resize for settings changes
