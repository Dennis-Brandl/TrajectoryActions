# Phase 4: Execution Engine - Research

**Researched:** 2026-02-26
**Domain:** TypeScript async orchestration — InstanceManager, parameter resolution, execution logging, pool resize
**Confidence:** HIGH

---

## Summary

Phase 3 delivered more than its planned scope. The Python worker pool (planned for Phase 4 Plan 04-01) is **fully complete** — `PythonWorkerPool` with acquire/release, FIFO queue, crash recovery, recycling, and `killWorker()` already exists in `packages/engine/src/python-pool/pool.ts`. The `StateMachine` class already walks instances through the full ISA-88 lifecycle with injectable `CodeExecutor`. The storage layer provides all six repositories with full CRUD.

Phase 4's remaining work is the **InstanceManager** — the orchestrating class that (1) takes an invoke request, validates action existence, pins code versions, creates a runtime instance, and starts async execution; (2) resolves parameters (type coercion, defaults, property flattening); (3) manages pool resize when `python_pool_size` setting changes; and (4) writes execution log entries at terminal state via the `StateMachine`'s `onTerminal` callback. The retry-on-crash behavior and ABORTING-cleanup behaviors are new requirements atop the existing `StateMachine` error path.

The ROADMAP plan labels (04-01: pool, 04-02: code registry/instance manager, 04-03: parameter/logging) are stale. Phase 4 planning should replace this with the actual work remaining: the InstanceManager class (central orchestrator), parameter resolution helpers, execution logger hook, and pool resize watcher.

**Primary recommendation:** Build a single `InstanceManager` class in `packages/engine/src/instance-manager/` that encapsulates all Phase 4 work. It owns the `PythonWorkerPool` and `StateMachine`, providing `invoke()`, `sendCommand()`, `getInstance()`, and `resizePool()` as its public API to Phase 5.

---

## Standard Stack

No new npm libraries are required. Phase 4 is pure orchestration using already-installed packages.

### Core (already installed)

| Package               | Version   | Purpose                           | Notes            |
| --------------------- | --------- | --------------------------------- | ---------------- |
| `@trajectory/storage` | workspace | All 6 repositories + types        | Already wired    |
| `@trajectory/engine`  | workspace | StateMachine, PythonWorkerPool    | Phase 3 complete |
| `node:crypto`         | built-in  | `randomUUID()` for instance IDs   | Already used     |
| `node:path`           | built-in  | sandbox_runner.py path resolution | Already used     |

### Supporting

| Package          | Version        | Purpose                         | Notes                  |
| ---------------- | -------------- | ------------------------------- | ---------------------- |
| `better-sqlite3` | workspace peer | Synchronous SQLite transactions | Via SettingsRepository |

### Alternatives Considered

| Instead of                | Could Use                     | Tradeoff                                                                                               |
| ------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------ |
| No external queue library | `async-fifo-queue`, `p-queue` | Pool already has FIFO queue built-in; adding a second queue layer would add complexity with no benefit |
| No retry library          | `p-retry`                     | Retry is one `try/catch` with a boolean flag; an external library is overkill                          |

**Installation:** No new packages needed.

---

## Architecture Patterns

### Recommended Project Structure

```
packages/engine/src/
├── instance-manager/
│   ├── instance-manager.ts    # InstanceManager class (main orchestrator)
│   ├── parameter-resolver.ts  # Type coercion + default filling + property flattening
│   ├── execution-logger.ts    # onTerminal callback that writes log entry
│   └── types.ts               # InvokeRequest, InvokeResult, InstanceManagerOptions
├── python-pool/               # Phase 3 — complete, no changes needed
│   ├── pool.ts
│   ├── worker.ts
│   └── types.ts
├── state-machine/             # Phase 3 — complete, no changes needed
│   ├── state-machine.ts
│   ├── states.ts
│   └── transitions.ts
└── index.ts                   # Adds InstanceManager exports
```

### Pattern 1: InstanceManager as Central Orchestrator

**What:** A single class that owns `PythonWorkerPool` and `StateMachine`, receives invoke requests from the REST layer, and manages the full instance lifecycle.

**When to use:** Always — this is the only pattern for this phase.

**The InstanceManager constructor wires everything together:**

```typescript
// Source: codebase pattern — same as StateMachine constructor wiring in Phase 3
export class InstanceManager {
  private readonly pool: PythonWorkerPool
  private readonly stateMachine: StateMachine
  private readonly instanceRepo: InstanceRepository
  private readonly codeVersionRepo: CodeVersionRepository
  private readonly actionRepo: ActionRepository
  private readonly environmentRepo: EnvironmentRepository
  private readonly logRepo: LogRepository
  private readonly settingsRepo: SettingsRepository

  constructor(db: BetterSqlite3.Database, options: InstanceManagerOptions) {
    this.instanceRepo = new InstanceRepository(db)
    this.codeVersionRepo = new CodeVersionRepository(db)
    this.actionRepo = new ActionRepository(db)
    this.environmentRepo = new EnvironmentRepository(db)
    this.logRepo = new LogRepository(db)
    this.settingsRepo = new SettingsRepository(db)

    const poolSize = this.settingsRepo.getNumericValue('python_pool_size') ?? 4
    this.pool = new PythonWorkerPool({
      pythonPath: options.pythonPath ?? 'python',
      scriptPath: options.scriptPath,
      poolSize,
    })

    this.stateMachine = new StateMachine(
      this.instanceRepo,
      this.codeVersionRepo,
      this.settingsRepo,
      this.pool.executeCode.bind(this.pool),
      {
        onStateChange: options.onStateChange,
        onTerminal: (instanceId, state, instance) => {
          this.writeExecutionLog(instanceId, state, instance)
          options.onTerminal?.(instanceId, state, instance)
        },
        onError: options.onError,
      }
    )
  }
}
```

### Pattern 2: Code Pinning — Snapshot at Invocation Time

**What:** When `invoke()` is called, capture which code version is currently active for each state using `CodeVersionRepository.getActive()` for all observable/opaque states. Store as `pinned_code_versions` on the instance.

**When to use:** Every invocation. This is the hot-reload mechanism — once pinned, the instance uses those exact code versions regardless of subsequent code saves.

**Implementation:**

```typescript
// Source: ExecutionEngineSpec.md §1 "Pin active code versions for all states"
// + CodeVersionRepository.getActive() from packages/storage/src/repositories/code-version.repository.ts

private pinCodeVersions(actionOid: string): Array<{ state: string; code_version_id: string }> {
  const allStates = [...OBSERVABLE_STATES, ...OPAQUE_STATES]
  const pinned: Array<{ state: string; code_version_id: string }> = []

  for (const state of allStates) {
    const version = this.codeVersionRepo.getActive(actionOid, state)
    if (version) {
      pinned.push({ state, code_version_id: version.id })
    }
  }
  return pinned
}
```

Only states with an active code version appear in `pinned_code_versions`. The `StateMachine.processCurrentState()` already does a `.find()` on this array to look up pinned code — no changes needed to the state machine.

### Pattern 3: Parameter Resolution

**What:** Process `input_parameters` from the invoke request: apply type coercion, fill missing values from action spec defaults, reject only if parameter has no default and was not provided.

**When to use:** At invocation time, before creating the instance.

**Type coercion rules (locked decision):**

```typescript
// Source: CONTEXT.md "Type coercion when possible"
function coerceValue(value: string, jsonSchema?: string): string | null {
  // All values stay as strings — Python code receives strings
  // Coercion is for VALIDATION: check that '5' is actually numeric when schema says integer
  // The value stored remains a string; Python casts as needed
  // Return null only for truly incompatible types (e.g., value='foo' where schema requires integer)
  return value // Pass through; reject only on clear incompatibility
}
```

**Key insight:** The `outputs` dict in Python is `Record<string, string>` — all values are strings. Input parameters are stored as strings. Coercion is validation, not transformation. Python code does its own casting with `int(inputs['x'])`.

**Property flattening:**

```typescript
// Source: ExecutionEngineSpec.md §4.3 and §4.4
// DataModelSpec.md §6.1 and §6.2 — PropertySpecification shape

function flattenProperties(specs: unknown[]): Record<string, Record<string, string>> {
  const result: Record<string, Record<string, string>> = {}
  for (const spec of specs as Array<{
    name: string
    entries: Array<{ name: string; value: string }>
  }>) {
    result[spec.name] = {}
    for (const entry of spec.entries) {
      result[spec.name][entry.name] = entry.value
    }
  }
  return result
}

// Usage:
const envProps = flattenProperties(environment.action_property_specifications as unknown[])
const actionProps = flattenProperties(action.property_specifications as unknown[])
// These are passed to StateMachine → CodeExecutor → PythonWorkerPool → SidecarRequest
```

**Connecting envProps/actionProps to StateMachine:** The `StateMachine.executeCode()` currently passes `envProps: {}` and `actionProps: {}` (Phase 3 placeholder). Phase 4 must pass these through. **The StateMachine's `executeCode()` private method reads these from the instance record, not from a separate argument.** The correct approach is to store `envProps` and `actionProps` in the instance's `input_parameters` array OR pass them through a new mechanism.

**Resolved approach:** Pass `envProps` and `actionProps` directly on the `StateMachine` at construction time — the InstanceManager computes them once at invocation and passes them via a callback, OR the StateMachine queries repos itself. The cleanest approach matching existing patterns:

- Store flattened `envProps` and `actionProps` on the **instance** as additional `input_parameters` entries with reserved key prefixes (e.g., `__env_props__` and `__action_props__` as JSON strings), OR
- Give the `StateMachine` access to `ActionRepository` and `EnvironmentRepository` so it can resolve props from the `instance.action_oid` and `instance.environment_oid` at execution time.

**Recommended:** Pass `actionRepo` and `environmentRepo` to `StateMachine` and let it resolve properties from the `instance.action_oid` / `instance.environment_oid`. This is the cleanest pattern — it avoids serializing complex objects into the instance record. The StateMachine's `executeCode()` already reads `instance.action_oid` implicitly; adding repo access is a small change. **Alternative (simpler):** Extend `InstanceInput` to add `env_action_properties` and `action_properties` as JSON blobs, store at creation, read in `executeCode()`. This keeps StateMachine self-contained.

### Pattern 4: Retry-on-Crash Logic

**What:** When a worker crashes or throws an unhandled exception, retry once on a fresh worker. If it crashes again, transition to ABORTING.

**When to use:** The CONTEXT.md decision overrides the Phase 3 behavior. Phase 3's `executeCode()` returns `WORKER_CRASH` result immediately on crash. Phase 4 must add one retry before accepting `WORKER_CRASH`.

**Placement:** This retry logic belongs in the `InstanceManager` or in a wrapper around `StateMachine.codeExecutor`. The cleanest place: wrap the pool's `executeCode` before passing it to `StateMachine`:

```typescript
// Source: CONTEXT.md "Worker crash: retry once on a fresh worker, then ABORT"
private makeRetryingExecutor(): CodeExecutor {
  return async (instanceId, state, sourceCode, inputs, outputs, envProps, actionProps, timeoutMs) => {
    const result = await this.pool.executeCode(
      instanceId, state, sourceCode, inputs, outputs, envProps, actionProps, timeoutMs
    )
    if (!result.success && (result.error_type === 'WORKER_CRASH')) {
      // Retry once on a fresh worker
      return await this.pool.executeCode(
        instanceId, state, sourceCode, inputs, outputs, envProps, actionProps, timeoutMs
      )
    }
    return result
  }
}
```

The StateMachine receives this wrapping executor. If the retry also returns `WORKER_CRASH`, the StateMachine's existing error path transitions to ABORTING.

### Pattern 5: Execution Logging via onTerminal Callback

**What:** When the `StateMachine` fires `onTerminal`, build an `ExecutionLogInput` from the instance and write it via `LogRepository.insert()`.

**When to use:** Every time an instance reaches COMPLETED, ABORTED, or STOPPED.

**Implementation:**

```typescript
// Source: LogRepository.insert() signature from packages/storage/src/repositories/log.repository.ts
// DataModelSpec.md §4 for ExecutionLogEntry shape

private writeExecutionLog(instanceId: string, terminalState: string, instance: Instance): void {
  const action = this.actionRepo.findByOid(instance.action_oid)
  const environment = instance.environment_oid
    ? this.environmentRepo.findByOid(instance.environment_oid)
    : null

  if (!action || !instance.started_at || !instance.completed_at) return

  const logMaxSize = this.settingsRepo.getNumericValue('log_max_size') ?? 10000
  const durationMs = new Date(instance.completed_at).getTime() -
    new Date(instance.started_at).getTime()

  const codeVersionsUsed: Record<string, number> = {}
  for (const pinned of instance.pinned_code_versions as Array<{ state: string; code_version_id: string }>) {
    const version = this.codeVersionRepo.findById(pinned.code_version_id)
    if (version) {
      codeVersionsUsed[pinned.state] = version.version_number
    }
  }

  this.logRepo.insert({
    runtime_action_instance_id: instance.runtime_action_instance_id,
    action_oid: instance.action_oid,
    action_name: action.local_id,
    environment_oid: instance.environment_oid,
    environment_name: environment?.local_id ?? '',
    workflow_instance_id: instance.workflow_instance_id,
    step_oid: instance.step_oid,
    input_parameters: instance.input_parameters,
    output_parameters: instance.output_parameters,
    states_executed: instance.states_with_code_executed,
    code_versions_used: codeVersionsUsed,
    started_at: instance.started_at,
    completed_at: instance.completed_at,
    duration_ms: durationMs,
    final_status: terminalState as 'COMPLETED' | 'ABORTED' | 'STOPPED',
    error: instance.error ?? undefined,
  }, logMaxSize)

  this.instanceRepo.markLogged(instanceId)
}
```

### Pattern 6: Pool Resize at Runtime

**What:** When `python_pool_size` setting is updated (via the future Management API), the `InstanceManager` must resize the pool — spawning new workers if size increased, letting busy workers drain if size decreased.

**When to use:** Called by the REST layer when `PUT /management/v1/settings/python_pool_size` fires (Phase 6). Phase 4 implements the mechanism; Phase 6 calls it.

**Implementation approach:** `PythonWorkerPool` needs a `resize(newSize: number)` method. This is a new method on the existing pool.

```typescript
// Source: PythonWorkerPool patterns in packages/engine/src/python-pool/pool.ts
// Drain pattern: reduce poolSize, kill idle workers to meet target; busy workers finish naturally

resize(newSize: number): void {
  const currentSize = this.size
  if (newSize === currentSize) return

  if (newSize > currentSize) {
    // Spawn additional workers
    for (let i = 0; i < newSize - currentSize; i++) {
      const worker = this.spawnWorker()
      this.serveOrEnqueue(worker)
    }
  } else {
    // Drain: kill idle workers to meet target; busy workers drain naturally
    const toKill = currentSize - newSize
    let killed = 0
    while (killed < toKill && this.idleWorkers.length > 0) {
      const worker = this.idleWorkers.pop()!
      worker.dispose()
      killed++
    }
    // If we couldn't kill enough (all workers busy), update poolSize so
    // future release() calls dispose workers instead of returning them to idle
    // until the pool shrinks naturally
  }
  this.poolSize = newSize  // Note: poolSize must become mutable
}
```

**Note:** `poolSize` is currently `readonly` in `pool.ts`. Phase 4 must change this to allow runtime resize.

### Pattern 7: Queued-State Representation

**What:** When all pool workers are busy, new invocations queue. The CONTEXT.md says "instance starts in IDLE/queued state". The decision says caller receives 201 immediately. The instance needs a state that represents "created but waiting for a worker."

**When to use:** When `pool.acquire()` blocks (all workers busy) and the instance has been created.

**Recommended approach:** Use the existing `STARTING` state (observable) or `POSTED` state (opaque) as the "waiting for worker" state. The instance is created with this initial state and the state machine starts processing. When `processCurrentState()` calls `codeExecutor()`, the pool's `acquire()` will block until a worker is available — the instance sits in `STARTING` while the promise is pending. **No new state is needed.** The FIFO queue is internal to `PythonWorkerPool.acquire()`.

**The sequence is:**

1. `invoke()` creates instance with state `STARTING` (or `POSTED` for opaque)
2. `stateMachine.startInstance()` is called async (after 201 response sent)
3. `processCurrentState()` calls `codeExecutor()` which calls `pool.executeCode()` which calls `pool.acquire()`
4. If pool is busy: `acquire()` returns a Promise that queues — the state machine awaits it
5. Instance stays in `STARTING` until a worker is available
6. No additional state tracking needed

**Confidence:** HIGH — this is the natural behavior of the existing async architecture. The instance is in its initial state while waiting. The queue is transparent.

### Pattern 8: invoke() Async Fire-and-Forget

**What:** The `invoke()` method must return a 201 response **before** the state machine starts. This means calling `startInstance()` without awaiting it.

**Implementation:**

```typescript
// Source: ExecutionEngineSpec.md §1.1 "Return 201 response immediately then begin async"
// + Node.js event loop — unhandled promise rejections must be caught

async invoke(request: InvokeRequest): Promise<InvokeResult> {
  // 1. Validate action exists
  const action = this.actionRepo.findByOid(request.action_oid)
  if (!action) throw new EngineError('ACTION_NOT_FOUND', `Action not found: ${request.action_oid}`)

  // 2. Validate and resolve parameters
  const resolvedInputs = this.parameterResolver.resolve(request.input_parameters, action)

  // 3. Pin code versions
  const pinnedVersions = this.pinCodeVersions(request.action_oid)

  // 4. Create instance
  const instance = this.instanceRepo.create({
    runtime_action_instance_id: randomUUID(),
    action_oid: request.action_oid,
    environment_oid: action.environment_oid,
    workflow_instance_id: request.workflow_instance_id,
    step_instance_id: request.step_instance_id,
    step_oid: request.step_oid,
    visibility: action.action_visibility,
    state: action.action_visibility === 'observable' ? 'STARTING' : 'POSTED',
    input_parameters: resolvedInputs,
    output_parameters: [],
    state_history: [],
    pinned_code_versions: pinnedVersions,
    states_with_code_executed: [],
  })

  // 5. Start async execution (DO NOT AWAIT — returns 201 first)
  this.stateMachine.startInstance(instance.runtime_action_instance_id)
    .catch((err) => {
      // Log unhandled state machine errors — these should not escape
      console.error(`State machine error for instance ${instance.runtime_action_instance_id}:`, err)
    })

  // 6. Return immediately
  return {
    runtime_action_instance_id: instance.runtime_action_instance_id,
    action_oid: request.action_oid,
    status: instance.state,
    created_at: instance.created_at,
    sse_endpoint: action.action_visibility === 'observable'
      ? `/trajectory/v1/instances/${instance.runtime_action_instance_id}/events`
      : undefined,
  }
}
```

### Anti-Patterns to Avoid

- **Awaiting startInstance() before responding:** Returns a 201 only after the full state machine run — blocks the HTTP response for seconds or minutes.
- **Adding a new 'QUEUED' state to the state machine:** Unnecessary. The FIFO queue is internal to `PythonWorkerPool.acquire()`. Instances wait in `STARTING` state, which is correct.
- **Storing envProps/actionProps in a separate in-memory Map keyed by instanceId:** Creates a memory leak if instances are never cleaned up. Prefer resolving at execution time from repos, or storing on the instance record.
- **Building a separate CodeRegistry class:** `CodeVersionRepository.getActive()` IS the code registry. No additional class is needed; just call it at invocation time to pin versions.
- **Hand-rolling retry logic with complex state:** Use the simple boolean flag approach — one retry attempt, then fall through to the existing ABORTING path.

---

## Don't Hand-Roll

| Problem                | Don't Build       | Use Instead                         | Why                                                                   |
| ---------------------- | ----------------- | ----------------------------------- | --------------------------------------------------------------------- |
| Worker pool management | Custom pool       | `PythonWorkerPool` (already exists) | Phase 3 built it; full crash recovery, recycling, FIFO queue          |
| Code version lookup    | In-memory Map     | `CodeVersionRepository.getActive()` | Already implemented; SQLite is the source of truth                    |
| State machine          | Custom FSM        | `StateMachine` (already exists)     | Phase 3 built it; handles all 14 states, deferred commands, traceback |
| Execution log write    | Custom log writer | `LogRepository.insert()`            | Already implemented with size trimming                                |
| Parameter persistence  | Custom store      | `InstanceRepository.create()`       | Already implemented; all fields stored in SQLite                      |
| Async FIFO queue       | Custom queue      | `PythonWorkerPool.acquire()`        | Built into pool; wait queue already resolves FIFO                     |

**Key insight:** Phase 4 is orchestration, not infrastructure. Everything except the `InstanceManager` class itself already exists. The entire phase should be about connecting pieces, not building new ones.

---

## Common Pitfalls

### Pitfall 1: Unhandled Promise Rejection from startInstance()

**What goes wrong:** `startInstance()` is called without `await` and throws an error. If the `.catch()` is missing, Node.js emits `UnhandledPromiseRejection`, crashing the server.

**Why it happens:** The fire-and-forget pattern requires explicit error handling on the detached promise.

**How to avoid:** Always attach `.catch((err) => console.error(...))` on the `startInstance()` call in `invoke()`.

**Warning signs:** `UnhandledPromiseRejection` in server logs for specific instance IDs.

### Pitfall 2: Double-Spawning During Pool Resize

**What goes wrong:** When pool is resized down, if `release()` is called for a busy worker while the pool is draining, the pool spawns a replacement worker (hitting the idle-worker logic), but the intended target size has already been reduced.

**Why it happens:** `PythonWorkerPool.release()` respawns dead/recycled workers based on the stored `poolSize`. If `poolSize` is updated but the internal workers haven't drained yet, the release path spawns back to the old size.

**How to avoid:** When shrinking, set a `targetSize` field that `release()` checks before respawning. Only spawn a replacement if `this.size < this.targetSize`.

**Warning signs:** Pool size grows beyond the configured target after dynamic resize.

### Pitfall 3: Retry on Non-Crash Errors

**What goes wrong:** Retrying Python runtime errors (RUNTIME_ERROR, SYNTAX_ERROR) — these are deterministic failures that will fail again identically on the retry, wasting a worker cycle.

**Why it happens:** Conflating WORKER_CRASH with Python exceptions.

**How to avoid:** Only retry `error_type === 'WORKER_CRASH'` — never retry RUNTIME_ERROR or SYNTAX_ERROR or TIMEOUT. The CONTEXT.md confirms "Python exception (unhandled runtime error): same as crash — retry once". However, implementation should distinguish: retry the execution attempt (with fresh worker), but if the retry produces RUNTIME_ERROR again, that's not a crash — it's a real error that should ABORT.

**Recommendation:** Retry only on `WORKER_CRASH` error type. Python exceptions naturally produce `RUNTIME_ERROR` (not `WORKER_CRASH`) even when the worker crashes after running Python code — the PythonWorker already returns `WORKER_CRASH` when the subprocess exits unexpectedly. So retrying on `WORKER_CRASH` is correct.

### Pitfall 4: Missing started_at Prevents Log Entry

**What goes wrong:** `writeExecutionLog()` checks `instance.started_at` before writing. If the instance never transitions out of STARTING (e.g., fails immediately), `started_at` may be null, causing the log write to be silently skipped.

**Why it happens:** `started_at` is set by the `StateMachine.autoAdvance()` on the STARTING→EXECUTING transition. If STARTING has code that immediately throws, the instance goes STARTING → ABORTING → ABORTED without setting `started_at`.

**How to avoid:** Set `started_at` at instance creation time (not on first code execution), OR set it on any state where code executes. The simplest fix: always set `started_at` when `startInstance()` is called.

**Alternative:** In `writeExecutionLog()`, use `instance.created_at` as fallback for `started_at`.

### Pitfall 5: envProps/actionProps Not Reaching Python Code

**What goes wrong:** Phase 3's `StateMachine.executeCode()` hardcodes `envProps = {}` and `actionProps = {}`. Without Phase 4 wiring these up, Python code always receives empty property dicts.

**Why it happens:** Phase 3 deferred this to Phase 4 with a comment: "envProps and actionProps are empty for now (Phase 4 will resolve parameters)".

**How to avoid:** Phase 4 must modify `StateMachine.executeCode()` to resolve props from the action/environment repos, OR pass props through a different mechanism. See Pattern 3 above.

**Warning signs:** Python code that accesses `props.get('RetryPolicy')` gets an empty dict.

### Pitfall 6: ABORTING-state Code Runs Even After Crash

**What goes wrong:** After a crash+retry fails, the instance goes to ABORTING. If ABORTING has user code, the `StateMachine` calls `codeExecutor()` for ABORTING state. The retry wrapper must NOT retry ABORTING-state execution — only the original state that crashed gets retried.

**Why it happens:** The retry wrapper applies to all `codeExecutor()` calls, including ABORTING-state cleanup.

**How to avoid:** In the retry wrapper, check the `state` parameter. Only retry when `state !== 'ABORTING'` (and `state !== 'STOPPING'`).

```typescript
private makeRetryingExecutor(): CodeExecutor {
  const RETRY_EXEMPT_STATES = new Set(['ABORTING', 'STOPPING', 'CLEARING'])

  return async (instanceId, state, sourceCode, inputs, outputs, envProps, actionProps, timeoutMs) => {
    const result = await this.pool.executeCode(
      instanceId, state, sourceCode, inputs, outputs, envProps, actionProps, timeoutMs
    )
    if (!result.success && result.error_type === 'WORKER_CRASH' && !RETRY_EXEMPT_STATES.has(state)) {
      return await this.pool.executeCode(
        instanceId, state, sourceCode, inputs, outputs, envProps, actionProps, timeoutMs
      )
    }
    return result
  }
}
```

---

## Code Examples

### Invoke Request Type

```typescript
// Source: RESTProtocolSpec.md §2.3 + DataModelSpec.md §3.1
export interface InvokeRequest {
  action_oid: string
  workflow_instance_id: string
  step_instance_id: string
  step_oid: string
  input_parameters: Array<{ name: string; value: string }> // From Trajectory Mobile
  timeout_ms?: number // Optional per-invocation override
}

export interface InvokeResult {
  runtime_action_instance_id: string
  action_oid: string
  status: string
  created_at: string
  sse_endpoint?: string // Only for observable actions
}
```

### Parameter Resolution

```typescript
// Source: DataModelSpec.md §1.2 ParameterSpecification shape
// + CONTEXT.md "Type coercion when possible; defaults from action def"

interface ParameterSpec {
  id: string // Parameter name (used as lookup key)
  default_value: string
  value_type: 'literal' | 'property'
  json_schema?: string
  description?: string
}

function resolveInputParameters(
  provided: Array<{ name: string; value: string }>,
  specs: ParameterSpec[]
): Array<{ key: string; value: string }> {
  const providedMap = new Map(provided.map((p) => [p.name, p.value]))
  const result: Array<{ key: string; value: string }> = []

  for (const spec of specs) {
    if (providedMap.has(spec.id)) {
      result.push({ key: spec.id, value: providedMap.get(spec.id)! })
    } else if (spec.default_value !== undefined && spec.default_value !== null) {
      result.push({ key: spec.id, value: spec.default_value })
    } else {
      throw new EngineError('PARAMETER_VALIDATION_FAILED', `Missing required parameter: ${spec.id}`)
    }
  }

  // Include extra parameters not in spec (pass through; no output validation per CONTEXT.md)
  for (const [name, value] of providedMap) {
    if (!specs.some((s) => s.id === name)) {
      result.push({ key: name, value })
    }
  }

  return result
}
```

### StateMachine Constructor Update for envProps/actionProps

```typescript
// Source: packages/engine/src/state-machine/state-machine.ts (current)
// Change: add ActionRepository and EnvironmentRepository for prop resolution

// In StateMachine constructor: add repos
constructor(
  instanceRepo: InstanceRepository,
  codeVersionRepo: CodeVersionRepository,
  settingsRepo: SettingsRepository,
  actionRepo: ActionRepository,            // NEW in Phase 4
  environmentRepo: EnvironmentRepository,  // NEW in Phase 4
  codeExecutor: CodeExecutor,
  callbacks?: StateMachineCallbacks
)

// In StateMachine.executeCode() — replace empty {} with resolved props:
const action = this.actionRepo.findByOid(instance.action_oid)
const environment = action ? this.environmentRepo.findByOid(action.environment_oid ?? '') : null
const envProps = environment ? flattenProperties(environment.action_property_specifications) : {}
const actionProps = action ? flattenProperties(action.property_specifications) : {}
```

### PythonWorkerPool.resize() Addition

```typescript
// Source: packages/engine/src/python-pool/pool.ts patterns
// New method: resize pool at runtime

resize(newSize: number): void {
  if (newSize <= 0) throw new Error('Pool size must be at least 1')
  const currentTotal = this.idleWorkers.length + this.busyWorkers.size

  if (newSize > currentTotal) {
    // Scale up: spawn new workers
    const toSpawn = newSize - currentTotal
    for (let i = 0; i < toSpawn; i++) {
      const worker = this.spawnWorker()
      this.serveOrEnqueue(worker)
    }
  } else if (newSize < currentTotal) {
    // Scale down: kill idle workers first (busy workers drain naturally)
    let toKill = currentTotal - newSize
    while (toKill > 0 && this.idleWorkers.length > 0) {
      const worker = this.idleWorkers.pop()!
      worker.dispose()
      toKill--
    }
    // Remaining busy workers: handled by release() — once they finish,
    // they are disposed instead of returned to idle if pool is over target
    // Track target so release() knows:
    this._targetPoolSize = newSize
  }
  this._targetPoolSize = newSize
}
```

### Execution Log Write Pattern

```typescript
// Source: LogRepository.insert() — packages/storage/src/repositories/log.repository.ts
// DataModelSpec.md §4.1 ExecutionLogEntry fields

private writeExecutionLog(instanceId: string, terminalState: string, instance: Instance): void {
  if (instance.is_logged) return  // Already logged (idempotent guard)

  const action = this.actionRepo.findByOid(instance.action_oid)
  const environment = this.environmentRepo.findByOid(instance.environment_oid)
  const logMaxSize = this.settingsRepo.getNumericValue('log_max_size') ?? 10000

  const completedAt = instance.completed_at ?? new Date().toISOString()
  const startedAt = instance.started_at ?? instance.created_at  // Fallback
  const durationMs = new Date(completedAt).getTime() - new Date(startedAt).getTime()

  const codeVersionsUsed: Record<string, number> = {}
  for (const pinned of instance.pinned_code_versions as Array<{ state: string; code_version_id: string }>) {
    const version = this.codeVersionRepo.findById(pinned.code_version_id)
    if (version) codeVersionsUsed[pinned.state] = version.version_number
  }

  this.logRepo.insert({
    runtime_action_instance_id: instanceId,
    action_oid: instance.action_oid,
    action_name: action?.local_id ?? instance.action_oid,
    environment_oid: instance.environment_oid,
    environment_name: environment?.local_id ?? '',
    workflow_instance_id: instance.workflow_instance_id,
    step_oid: instance.step_oid,
    input_parameters: instance.input_parameters,
    output_parameters: instance.output_parameters,
    states_executed: instance.states_with_code_executed,
    code_versions_used: codeVersionsUsed,
    started_at: startedAt,
    completed_at: completedAt,
    duration_ms: durationMs,
    final_status: terminalState as 'COMPLETED' | 'ABORTED' | 'STOPPED',
    error: instance.error ?? undefined,
  }, logMaxSize)

  this.instanceRepo.markLogged(instanceId)
}
```

---

## State of the Art

| Old Approach                                      | Current Approach                   | When Changed | Impact                                        |
| ------------------------------------------------- | ---------------------------------- | ------------ | --------------------------------------------- |
| Phase 4 plan 04-01 "build Python subprocess pool" | Pool fully built in Phase 3        | 2026-02-26   | Eliminates one full plan from Phase 4         |
| Empty envProps/actionProps ({}) in StateMachine   | Must resolve from repos in Phase 4 | Phase 4      | Python code now receives real properties      |
| `poolSize: readonly` in PythonWorkerPool          | Must be mutable for runtime resize | Phase 4      | Enables Management API pool resize in Phase 6 |

**Existing capabilities that Phase 4 should reuse without change:**

- `PythonWorkerPool` — complete; do not modify except to add `resize()` and fix `readonly poolSize`
- `StateMachine` — modify only to add `ActionRepository`/`EnvironmentRepository` constructor params and prop resolution in `executeCode()`
- `LogRepository.insert()` — complete; call it from the `onTerminal` callback
- `CodeVersionRepository.getActive()` — complete; this IS the Code Registry
- `InstanceRepository.create()`, `updateState()`, `markLogged()` — complete

---

## Open Questions

1. **Where to add ActionRepository/EnvironmentRepository to StateMachine**
   - What we know: StateMachine.executeCode() currently passes `envProps = {}` and `actionProps = {}` as placeholders
   - What's unclear: Whether to modify StateMachine's constructor signature (breaking) or pass them some other way
   - Recommendation: Modify the StateMachine constructor to add optional repo params with `?:` so Phase 3 tests don't break. Tests pass `undefined`, production passes real repos.

2. **Pool resize when busy workers exceed new target**
   - What we know: Idle workers are killed immediately; busy workers drain naturally
   - What's unclear: How to track "target size" vs "current size" when busy workers haven't finished yet
   - Recommendation: Add `_targetPoolSize` field to PythonWorkerPool alongside `poolSize`. The `release()` method checks `this.size > this._targetPoolSize` before returning a worker to idle (disposes instead).

3. **Execution log detail level (Claude's Discretion)**
   - What we know: `ExecutionLogEntry` fields from DataModelSpec.md §4.1 are defined; `LogRepository.insert()` accepts all required fields
   - What's unclear: Whether to store full state_history timing breakdown per-state (DataModelSpec's `StateExecutionRecord`) or just the list of states that ran code
   - Recommendation: Store only `states_with_code_executed` (already on the instance) as `states_executed`. The per-state timing in `StateExecutionRecord` requires significant additional tracking not yet built. Keep it simple: use what's already on the instance.

4. **Retry on Python exception vs crash: ambiguity in CONTEXT.md**
   - What we know: CONTEXT.md says "Python exception (unhandled runtime error): same as crash — retry once, then ABORT with traceback"
   - What's unclear: `RUNTIME_ERROR` comes from Python exceptions handled by sandbox_runner.py — the worker does NOT crash; it returns a clean JSON error response. Only `WORKER_CRASH` means the worker process actually died. Retrying `RUNTIME_ERROR` would re-run identical Python code that raised the same exception — wasted compute.
   - Recommendation: Retry only on `WORKER_CRASH` (actual subprocess death). Treat `RUNTIME_ERROR` as immediate failure (no retry) — it's deterministic. If the user intended "retry Python exceptions too," re-examine; but this is the technically correct interpretation.

---

## Sources

### Primary (HIGH confidence)

- Codebase direct inspection — `packages/engine/src/python-pool/pool.ts` (full PythonWorkerPool implementation)
- Codebase direct inspection — `packages/engine/src/state-machine/state-machine.ts` (StateMachine with CodeExecutor)
- Codebase direct inspection — `packages/storage/src/repositories/` (all 6 repositories)
- Codebase direct inspection — `packages/storage/src/types.ts` (Instance, Action, Environment, ExecutionLogInput shapes)
- `.TrajectoryActions/ExecutionEngineSpec.md` — authoritative spec for Phase 4 requirements
- `.TrajectoryActions/DataModelSpec.md` — ParameterSpecification, PropertySpecification, ExecutionLogEntry shapes
- `.TrajectoryActions/RESTProtocolSpec.md` — invoke request/response contract
- `.planning/phases/03-*/03-03-SUMMARY.md` — confirmed what Phase 3 built vs ROADMAP plan labels

### Secondary (MEDIUM confidence)

- WebSearch for worker pool patterns — confirmed custom pool is correct; no external library needed
- WebSearch for type coercion patterns — confirmed standard `Number()`, `Boolean()` coercion is all that's needed

### Tertiary (LOW confidence)

- None — all critical claims verified against codebase directly

---

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH — verified against package.json and existing code; no new dependencies
- Architecture: HIGH — verified against spec files and existing Phase 3 code
- Pitfalls: HIGH — identified from direct codebase analysis (hardcoded `{}` for envProps, unhandled promise rejection pattern, etc.)
- Open questions: MEDIUM — involve internal design choices; flagged for planner decision

**Research date:** 2026-02-26
**Valid until:** 2026-03-28 (stable — no external dependencies; architecture is internal)
