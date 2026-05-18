# Phase 3: State Machine and Python Sidecar - Research

**Researched:** 2026-02-25
**Domain:** TypeScript async state machine, Node.js child_process, Python stdin/stdout JSON protocol, Python exec() with capture
**Confidence:** HIGH (core APIs verified against official Node.js and Python 3.12 docs)

---

## Summary

Phase 3 builds two interlocked systems: (1) a TypeScript ISA-88 state machine that drives action instances through a 14-state observable lifecycle plus a 4-state opaque lifecycle, and (2) a Python sidecar subprocess pool that executes user code and returns results over a newline-delimited JSON protocol. Neither system requires third-party libraries beyond what is already in the project — the state machine is a plain TypeScript module in `packages/engine/`, the sidecar is a plain Python script in `packages/python-sidecar/`.

The state machine is best implemented as a table-driven engine: a transition table maps `(currentState, command)` to `nextState`, and a state-entry processor runs the same pipeline for every state transition (persist, emit SSE, check code, execute or auto-advance). The spec defines this pipeline precisely — the implementation work is translating it to TypeScript. The engine is async (Python execution is async, SSE emission is async, but SQLite via better-sqlite3 is synchronous and must remain so).

The Python sidecar implements a long-lived worker loop: read one JSON line from stdin, execute user code via `exec()` with `compile()`, capture stdout/stderr via `io.StringIO` + `contextlib.redirect_stdout/redirect_stderr`, write one JSON line to stdout, flush, repeat. The critical operational requirement is `python -u` (unbuffered mode) or `PYTHONUNBUFFERED=1` — without this, Python's block buffering will cause the Node.js parent to hang waiting for output that sits in Python's buffer.

**Primary recommendation:** Hand-roll the state machine as a TypeScript class using a Map-based transition table. Implement the Python worker as a `while True: readline / exec / print / flush` loop. Use Node.js `readline.createInterface` on `child.stdout` to split responses by line on the Node.js side. Spawn Python with `-u` flag to disable output buffering.

---

## Standard Stack

This phase introduces no new npm dependencies. The engine uses only Node.js built-ins plus `@trajectory/storage`. The Python sidecar uses only Python stdlib.

### Core (Engine — packages/engine/)

| Module                | Source            | Purpose                                         | Notes                                      |
| --------------------- | ----------------- | ----------------------------------------------- | ------------------------------------------ |
| `node:child_process`  | Node.js built-in  | Spawn Python subprocess workers                 | `spawn()` with `stdio: 'pipe'`             |
| `node:readline`       | Node.js built-in  | Split child stdout by newline for JSON protocol | `createInterface({ input: child.stdout })` |
| `node:events`         | Node.js built-in  | EventEmitter for state change events            | Already available                          |
| `@trajectory/storage` | Workspace package | Persist state transitions, read code versions   | Already in engine's dependencies           |

### Core (Sidecar — packages/python-sidecar/)

| Module       | Source        | Purpose                                      | Notes               |
| ------------ | ------------- | -------------------------------------------- | ------------------- |
| `sys`        | Python stdlib | `sys.stdin`, `sys.stdout`, unbuffered mode   | `import sys`        |
| `json`       | Python stdlib | `json.loads()` / `json.dumps()` for protocol | `import json`       |
| `io`         | Python stdlib | `io.StringIO()` for stdout/stderr capture    | `import io`         |
| `contextlib` | Python stdlib | `redirect_stdout` / `redirect_stderr`        | `import contextlib` |
| `traceback`  | Python stdlib | `traceback.format_exc()` for error reporting | `import traceback`  |

### Supporting (Engine)

| Module        | Source           | Purpose                        | Notes                         |
| ------------- | ---------------- | ------------------------------ | ----------------------------- |
| `node:crypto` | Node.js built-in | `randomUUID()` for request IDs | Already used in storage layer |

### Alternatives Considered

| Instead of                     | Could Use                | Tradeoff                                                                                                                                                                                      |
| ------------------------------ | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hand-rolled state machine      | XState, robot3           | Libraries add dependency + learning curve for a fully-specified problem. The spec defines the exact transition table — mapping it directly to a TypeScript Map is simpler and more debuggable |
| Hand-rolled Python worker      | python-shell npm package | python-shell abstracts the spawn but is an additional npm dep with its own abstractions; direct spawn gives precise control over the protocol                                                 |
| `readline` interface on stdout | Manual chunk buffering   | readline is Node.js built-in and handles the chunk-to-line splitting correctly; manual buffering is error-prone                                                                               |

**No new npm or pip packages required.** The `requirements.txt` in `packages/python-sidecar/` should remain empty (or document that stdlib is sufficient).

---

## Architecture Patterns

### Recommended Project Structure

```
packages/engine/src/
├── index.ts                     # Public exports (StateMachine, PythonWorkerPool, etc.)
├── state-machine/
│   ├── transitions.ts           # Transition table: Map<state, Map<command, nextState>>
│   ├── state-machine.ts         # StateMachine class — enterState(), sendCommand()
│   └── states.ts                # State and Command literal type unions
├── python-pool/
│   ├── worker.ts                # PythonWorker class — single subprocess + readline interface
│   └── pool.ts                  # PythonWorkerPool class — manages N workers
├── execution-engine.ts          # ActionExecutionEngine — creates instances, drives state machine
└── errors.ts                    # EngineError, InvalidStateTransitionError, etc.

packages/python-sidecar/
├── sandbox_runner.py            # The worker: read stdin → exec → write stdout
└── requirements.txt             # Empty (stdlib only)
```

### Pattern 1: Table-Driven State Machine

**What:** The transition table is a nested Map — `transitions.get(fromState)?.get(command)` returns the target state or `undefined` for invalid transitions.

**When to use:** All command validation and transition lookups.

```typescript
// Source: StateMachineSpec.md transition table + standard table-driven FSM pattern
type ObservableState =
  | 'STARTING'
  | 'EXECUTING'
  | 'COMPLETING'
  | 'COMPLETED'
  | 'PAUSING'
  | 'PAUSED'
  | 'UNPAUSING'
  | 'HOLDING'
  | 'HELD'
  | 'UNHOLDING'
  | 'ABORTING'
  | 'ABORTED'
  | 'CLEARING'
  | 'STOPPING'

type Command = 'PAUSE' | 'RESUME' | 'HOLD' | 'UNHOLD' | 'ABORT' | 'STOP' | 'CLEAR'

// "Any active" states per spec — ABORT and STOP are valid from all of these
const ANY_ACTIVE: ObservableState[] = [
  'STARTING',
  'EXECUTING',
  'COMPLETING',
  'PAUSING',
  'PAUSED',
  'UNPAUSING',
  'HOLDING',
  'HELD',
  'UNHOLDING',
]

// Auto-advance table: what state follows when there is no code (or code returns True)
const AUTO_ADVANCE: Partial<Record<ObservableState, ObservableState>> = {
  STARTING: 'EXECUTING',
  EXECUTING: 'COMPLETING',
  COMPLETING: 'COMPLETED',
  PAUSING: 'PAUSED',
  UNPAUSING: 'EXECUTING',
  HOLDING: 'HELD',
  UNHOLDING: 'EXECUTING',
  ABORTING: 'ABORTED',
  STOPPING: 'COMPLETED',
  CLEARING: 'COMPLETED',
}

// Command transition table: (fromState, command) -> toState
// ABORT and STOP build from ANY_ACTIVE dynamically
function buildTransitionTable(): Map<ObservableState, Map<Command, ObservableState>> {
  const table = new Map<ObservableState, Map<Command, ObservableState>>()

  const set = (from: ObservableState, cmd: Command, to: ObservableState) => {
    if (!table.has(from)) table.set(from, new Map())
    table.get(from)!.set(cmd, to)
  }

  set('EXECUTING', 'PAUSE', 'PAUSING')
  set('PAUSED', 'RESUME', 'UNPAUSING')
  // HOLD from any active (spec extension per CONTEXT.md)
  for (const state of ANY_ACTIVE) {
    set(state, 'HOLD', 'HOLDING')
  }
  set('HELD', 'UNHOLD', 'UNHOLDING')
  set('ABORTED', 'CLEAR', 'CLEARING')
  // ABORT and STOP from any active
  for (const state of ANY_ACTIVE) {
    set(state, 'ABORT', 'ABORTING')
    set(state, 'STOP', 'STOPPING')
  }

  return table
}
```

### Pattern 2: State Entry Processor (Async)

**What:** A single `enterState(instance, newState)` async function performs the full pipeline from StateMachineSpec.md §3.

**When to use:** Every state transition — both command-driven and auto-advance.

```typescript
// Source: StateMachineSpec.md §3 "State Entry Processing"
async function enterState(
  instance: Instance,
  newState: string,
  updates?: { error?: string }
): Promise<void> {
  // Step 1-3: Persist new state (storage is synchronous)
  const updated = instanceRepo.updateState(instance.runtime_action_instance_id, newState, updates)
  if (!updated) throw new EngineError('Instance not found during state transition')

  // Step 4: Emit SSE event (observable instances only)
  if (updated.visibility === 'observable') {
    sseEmitter.emit('state_change', updated)
  }

  // Step 5: Check for pinned code
  const pinnedCodeVersionId = getPinnedCodeVersionId(updated, newState)
  if (pinnedCodeVersionId) {
    const codeVersion = codeVersionRepo.findById(pinnedCodeVersionId)
    if (codeVersion) {
      // Acquire worker and execute
      const worker = await pool.acquire()
      try {
        const result = await worker.execute({
          instance: updated,
          sourceCode: codeVersion.source_code,
          timeoutMs: settings.execution_timeout_ms,
        })
        await handleExecutionResult(updated, newState, result)
      } finally {
        pool.release(worker)
      }
      return
    }
  }

  // No code: auto-advance
  const nextState = AUTO_ADVANCE[newState as ObservableState]
  if (nextState) {
    await enterState(updated, nextState)
  }
  // Terminal states (COMPLETED, ABORTED): handled by caller
}
```

### Pattern 3: Python Worker — Single Subprocess with readline

**What:** `PythonWorker` wraps a single `child_process.spawn()` instance. It uses `readline.createInterface` on stdout to receive one complete JSON response per line. It queues requests (one at a time per worker).

**When to use:** Each PythonWorker handles exactly one execution at a time.

```typescript
// Source: Node.js official docs — child_process.spawn(), readline.createInterface()
import { spawn, type ChildProcess } from 'node:child_process'
import { createInterface } from 'node:readline'

class PythonWorker {
  private process: ChildProcess
  private pendingResolve?: (result: SidecarResponse) => void
  private pendingReject?: (err: Error) => void
  private buffer = ''
  private executionCount = 0

  constructor(
    private readonly pythonPath: string,
    private readonly scriptPath: string
  ) {
    this.process = spawn(pythonPath, ['-u', scriptPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    // Use readline to split stdout by newline — handles chunk boundaries correctly
    const rl = createInterface({ input: this.process.stdout! })
    rl.on('line', (line) => {
      if (this.pendingResolve && line.trim()) {
        try {
          const response = JSON.parse(line) as SidecarResponse
          this.pendingResolve(response)
        } catch (err) {
          this.pendingReject?.(new Error(`Invalid JSON from worker: ${line}`))
        }
        this.pendingResolve = undefined
        this.pendingReject = undefined
      }
    })

    this.process.on('error', (err) => {
      this.pendingReject?.(err)
    })

    this.process.on('close', (code) => {
      if (this.pendingReject) {
        this.pendingReject(new Error(`Worker crashed with code ${code}`))
        this.pendingResolve = undefined
        this.pendingReject = undefined
      }
    })
  }

  async execute(request: SidecarRequest): Promise<SidecarResponse> {
    return new Promise((resolve, reject) => {
      this.pendingResolve = resolve
      this.pendingReject = reject

      const line = JSON.stringify(request) + '\n'
      this.process.stdin!.write(line)
      this.executionCount++
    })
  }

  kill(signal: 'SIGTERM' | 'SIGKILL' = 'SIGTERM'): void {
    this.process.kill(signal)
  }

  get isDead(): boolean {
    return this.process.killed || this.process.exitCode !== null
  }

  get executions(): number {
    return this.executionCount
  }
}
```

### Pattern 4: Python Worker Main Loop (sandbox_runner.py)

**What:** A `while True` loop that reads one JSON request line per iteration, executes the code, and writes one JSON response line. Critical: spawn with `python -u` or `PYTHONUNBUFFERED=1`.

**When to use:** This is the entire `sandbox_runner.py` implementation.

```python
# Source: Python 3.12 official docs — sys.stdin.readline(), exec(), traceback.format_exc(),
#         contextlib.redirect_stdout/redirect_stderr, io.StringIO
import sys
import json
import io
import contextlib
import traceback

MAX_OUTPUT_BYTES = 64 * 1024  # 64KB cap per CONTEXT.md

def run_user_code(source_code: str, inputs: dict, outputs: dict, props: dict, action_props: dict):
    """
    Compile and execute user code in an isolated namespace.
    Returns (return_value, stdout_capture, stderr_capture) on success.
    Raises on error (SyntaxError for compile failures, any Exception for runtime failures).
    """
    # Separate compile from exec to distinguish SYNTAX_ERROR from RUNTIME_ERROR
    code_obj = compile(source_code, '<action_code>', 'exec')

    stdout_buf = io.StringIO()
    stderr_buf = io.StringIO()

    namespace = {'__builtins__': __builtins__}

    with contextlib.redirect_stdout(stdout_buf), contextlib.redirect_stderr(stderr_buf):
        exec(code_obj, namespace)

    # Extract the execute() function from the namespace
    execute_fn = namespace.get('execute')
    if execute_fn is None or not callable(execute_fn):
        raise RuntimeError("User code must define a callable 'execute' function")

    # Call execute() — it may print more output
    with contextlib.redirect_stdout(stdout_buf), contextlib.redirect_stderr(stderr_buf):
        return_value = execute_fn(inputs, outputs, props, action_props)

    stdout_text = stdout_buf.getvalue()
    stderr_text = stderr_buf.getvalue()

    # Cap output to prevent memory issues
    if len(stdout_text.encode('utf-8')) > MAX_OUTPUT_BYTES:
        stdout_text = stdout_text[:MAX_OUTPUT_BYTES] + '\n[stdout truncated]'
    if len(stderr_text.encode('utf-8')) > MAX_OUTPUT_BYTES:
        stderr_text = stderr_text[:MAX_OUTPUT_BYTES] + '\n[stderr truncated]'

    return return_value, stdout_text, stderr_text


def main():
    import time
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue

        start_ms = time.time() * 1000

        try:
            request = json.loads(line)
        except json.JSONDecodeError as e:
            # Malformed request — write error and continue
            response = {
                'request_id': None,
                'success': False,
                'error_type': 'RUNTIME_ERROR',
                'error': f'Invalid JSON request: {e}',
                'traceback': '',
                'outputs': {},
                'return_value': None,
                'stdout_capture': '',
                'stderr_capture': '',
                'execution_time_ms': 0,
            }
            print(json.dumps(response), flush=True)
            continue

        request_id = request.get('request_id')
        outputs = dict(request.get('inputs', {}))  # Start with copy; code writes to outputs
        outputs = {}  # outputs starts empty; inputs is read-only
        inputs = request.get('inputs', {})
        props = request.get('environment_action_properties', {})
        action_props = request.get('action_properties', {})
        source_code = request.get('source_code', '')

        try:
            return_value, stdout_cap, stderr_cap = run_user_code(
                source_code, inputs, outputs, props, action_props
            )
            elapsed = time.time() * 1000 - start_ms
            response = {
                'request_id': request_id,
                'success': True,
                'outputs': outputs,
                'return_value': return_value,
                'execution_time_ms': round(elapsed),
                'stdout_capture': stdout_cap,
                'stderr_capture': stderr_cap,
            }
        except SyntaxError as e:
            elapsed = time.time() * 1000 - start_ms
            response = {
                'request_id': request_id,
                'success': False,
                'error_type': 'SYNTAX_ERROR',
                'error': f'{type(e).__name__}: {e}',
                'traceback': traceback.format_exc(),
                'outputs': {},
                'return_value': None,
                'execution_time_ms': round(elapsed),
                'stdout_capture': '',
                'stderr_capture': '',
            }
        except Exception as e:
            elapsed = time.time() * 1000 - start_ms
            response = {
                'request_id': request_id,
                'success': False,
                'error_type': 'RUNTIME_ERROR',
                'error': f'{type(e).__name__}: {e}',
                'traceback': traceback.format_exc(),
                'outputs': {},
                'return_value': None,
                'execution_time_ms': round(elapsed),
                'stdout_capture': '',
                'stderr_capture': '',
            }

        print(json.dumps(response), flush=True)


if __name__ == '__main__':
    main()
```

**Important:** The `outputs` dict passed to `execute()` must be mutable — user code writes to it. After `execute()` returns, the engine reads `outputs` from the namespace and sends it back in the response.

### Pattern 5: SIGTERM + SIGKILL Timeout Sequence

**What:** For ABORT/STOP mid-execution, kill the worker process. Per spec: SIGTERM, wait 5s, then SIGKILL. Spawn a replacement worker after kill.

```typescript
// Source: Node.js official docs — subprocess.kill(), 'close' event
async function killWorker(worker: PythonWorker, gracePeriodMs = 5000): Promise<void> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      worker.kill('SIGKILL') // Force kill after grace period
    }, gracePeriodMs)

    worker.process.on('close', () => {
      clearTimeout(timeout)
      resolve()
    })

    worker.kill('SIGTERM') // Graceful kill first
  })
}
```

**Windows note:** On Windows, SIGTERM behaves like SIGKILL (immediate termination). The two-stage sequence still works but the grace period is effectively skipped. This is acceptable since the container runs Linux.

### Pattern 6: Worker Recycling After N Executions

**What:** Per spec (default: 100 executions), replace workers to prevent memory leaks from user code. Pool tracks `worker.executions` and spawns replacement before releasing.

```typescript
// Source: ExecutionEngineSpec.md §2.1 "Workers are recycled after configurable executions"
const MAX_EXECUTIONS = 100 // From settings

async function releaseWorker(pool: PythonWorkerPool, worker: PythonWorker): Promise<void> {
  if (worker.executions >= MAX_EXECUTIONS || worker.isDead) {
    worker.kill()
    pool.spawnReplacement()
  } else {
    pool.returnToIdle(worker)
  }
}
```

### Pattern 7: Invalid State Transition Error

**What:** When a command is not valid for the current state, return a typed error. The error code matches what the REST protocol layer will surface.

```typescript
// Source: StateMachineSpec.md §4 "Command Processing"
export class InvalidStateTransitionError extends Error {
  readonly code = 'INVALID_STATE_TRANSITION' as const

  constructor(
    readonly currentState: string,
    readonly command: string
  ) {
    super(`Command '${command}' is not valid in state '${currentState}'`)
    this.name = 'InvalidStateTransitionError'
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

function validateCommand(
  transitionTable: Map<string, Map<string, string>>,
  currentState: string,
  command: string
): string {
  const nextState = transitionTable.get(currentState)?.get(command)
  if (!nextState) {
    throw new InvalidStateTransitionError(currentState, command)
  }
  return nextState
}
```

### Anti-Patterns to Avoid

- **Spawning Python with default buffering:** Without `python -u` or `PYTHONUNBUFFERED=1`, Python buffers stdout in block mode when piped. The Node.js parent will hang forever waiting for a response that sits in Python's 8KB buffer. Always spawn with `-u`.
- **Reading stdout with `.on('data')` without line-splitting:** The `data` event delivers arbitrary chunks. A single JSON response may arrive in 2+ chunks, or two responses may arrive in one chunk. Always use `readline.createInterface` to split by newline.
- **Calling `stdin.end()` after each request:** This signals EOF to Python (loop exits). For a long-lived worker, call `stdin.write(line + '\n')` only — never `.end()` until the worker is being retired.
- **Blocking the Node.js event loop in state transition logic:** better-sqlite3 is synchronous — state persistence is sync. Keep all persistence calls synchronous (no `await` around storage calls). The only async boundaries are Python execution and SSE emission.
- **Keeping Python traceback in workflow client error responses:** The two-tier error policy (CONTEXT.md) requires that only `error_type + message` goes to clients, while the full traceback is stored on the instance. Never forward `traceback` field to REST clients.
- **Using `async` functions with `db.transaction()`:** better-sqlite3 transactions are synchronous. This is already established from Phase 2 — don't add async wrappers around transaction calls.
- **Missing `flush=True` in Python print():** In the Python worker, every `print(json.dumps(response))` must include `flush=True`. Even with `-u` mode, the `flush=True` argument is belt-and-suspenders insurance.

---

## Don't Hand-Roll

| Problem                         | Don't Build                         | Use Instead                                               | Why                                                                                                                   |
| ------------------------------- | ----------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| stdout line-splitting           | Manual chunk buffer + indexOf('\n') | `readline.createInterface`                                | Built-in, handles all edge cases (partial lines, CRLF)                                                                |
| stdout/stderr capture in Python | `sys.stdout = my_obj` + restore     | `contextlib.redirect_stdout/redirect_stderr`              | Context managers are exception-safe; no risk of leaving sys.stdout broken if code throws                              |
| Syntax error detection          | Regex on source code                | `compile()` before `exec()`                               | `compile()` raises `SyntaxError` for structural problems vs `exec()` raising runtime errors — gives clean distinction |
| Full traceback string           | Manual exception formatting         | `traceback.format_exc()`                                  | Stdlib function that correctly formats the current exception including chain                                          |
| UUID for request IDs            | Random string                       | `uuid.uuid4()` (Python) / `crypto.randomUUID()` (Node.js) | Already used in the project                                                                                           |
| State machine library           | XState or similar                   | Hand-rolled Map-based table                               | The spec defines every transition precisely; a library adds abstractions that fight against the spec's explicit table |

**Key insight:** Both the state machine and the Python worker are fundamentally simple read-eval-print patterns. The complexity is in the edge cases (ABORT mid-execution, stdout capture, chunk buffering) — all of which have correct stdlib solutions.

---

## Common Pitfalls

### Pitfall 1: Python stdout Buffering (The Silent Hang)

**What goes wrong:** The Node.js parent writes a request to the Python worker's stdin, then waits on `readline`'s 'line' event indefinitely. The Python worker processed the request and wrote the response, but it's sitting in Python's 8KB block buffer. The parent never sees it.

**Why it happens:** When Python's stdout is connected to a pipe (not a TTY), Python automatically switches from line-buffering to block-buffering. A response of less than 8KB will sit in the buffer until the buffer fills or Python exits.

**How to avoid:** Always spawn Python with `python -u script.py` (the `-u` flag forces unbuffered binary mode for stdout/stderr). Additionally, always use `flush=True` in the Python `print()` call.

**Warning signs:** Node.js process hangs with no timeout error; the Python process is alive but not sending output; adding `sys.stdout.flush()` after the print fixes it.

---

### Pitfall 2: stdout 'data' Chunks Split Across JSON Boundaries

**What goes wrong:** A Python response of 3KB arrives in two `data` events: one with 2KB and one with 1KB. The first `JSON.parse()` attempt throws because the string is incomplete. Alternatively, two short responses arrive in a single `data` event as one chunk.

**Why it happens:** Node.js pipes deliver data in chunks. There is no guarantee that one `data` event = one line.

**How to avoid:** Use `readline.createInterface({ input: child.stdout })` and listen on the `'line'` event. readline handles all chunk boundary cases internally.

**Warning signs:** Intermittent `JSON.parse` errors in the worker that only happen with large responses or under load.

---

### Pitfall 3: Code-Initiated Hold vs True Auto-Advance

**What goes wrong:** Python code returns `False` from EXECUTING. The engine interprets this as auto-advance (proceeds to COMPLETING), instead of triggering the HOLD cycle.

**Why it happens:** `False` and falsy values in JavaScript/TypeScript can be silently coerced. If `return_value` is checked with `if (result.return_value)` instead of `=== true`, `False` will not trigger the HOLD path.

**How to avoid:** Use strict equality: `if (result.return_value === false)` to detect the hold signal. Per spec, `True` = advance, `False` = stay (trigger HOLD cycle in EXECUTING).

**Warning signs:** Instances skip the HOLD cycle and immediately complete despite user code returning `False`.

---

### Pitfall 4: ABORT During Code Execution — Worker State

**What goes wrong:** ABORT arrives while Python worker is mid-execution. The engine kills the subprocess, but the `pendingResolve/pendingReject` callbacks in the PythonWorker are never called. The promise from `worker.execute()` hangs forever.

**Why it happens:** When the subprocess is killed, the `'close'` event fires on the ChildProcess. If the `'close'` handler calls `pendingReject`, the promise resolves correctly. But if the `'close'` handler is not wired up to reject the pending promise, the caller awaits forever.

**How to avoid:** In `PythonWorker`, the `'close'` event handler must always call `pendingReject` if a pending promise exists. After killing, always spawn a replacement worker.

**Warning signs:** Instance gets stuck in ABORTING state without ever transitioning to ABORTED.

---

### Pitfall 5: `outputs` Dict Mutation — Shared Reference Issue

**What goes wrong:** The Python worker passes the `outputs` dict to `execute()`, the function modifies it, but the modifications are not captured in the response because the wrong dict was serialized.

**Why it happens:** If `outputs` is created inside `run_user_code` and passed to `execute()` by reference, mutations work. But if the caller passes in a copy or the function signature is wrong, the dict the function mutates is not the one that gets read.

**How to avoid:** In `sandbox_runner.py`, create `outputs = {}` locally and pass it to `execute()`. After `execute()` returns, serialize `outputs` in the response. The `execute()` function writes to this dict by reference — Python dicts are passed by reference.

**Warning signs:** All executions return empty `outputs` regardless of what user code sets.

---

### Pitfall 6: State History Append Race in Concurrent Instances

**What goes wrong:** Two instances are executing simultaneously. Both call `instanceRepo.updateState()` at the same time. One overwrites the other's state history.

**Why it happens:** `updateState()` in `InstanceRepository` (Phase 2) reads the current history, appends, and writes in a single `db.transaction()`. better-sqlite3 serializes all transactions — so concurrent calls will actually execute sequentially. This is NOT a race condition for the storage layer. However, if the engine double-calls `enterState` for the same instance (logic bug), the second call will overwrite.

**How to avoid:** Track in-progress transitions per instance with a `Set<instanceId>` in the engine. Reject duplicate `enterState` calls for the same instance. This is a guard, not a database concern.

**Warning signs:** State history has duplicate entries, or state transitions fire twice for one event.

---

### Pitfall 7: Mid-Execution HOLD vs PAUSE Semantics Difference

**What goes wrong:** HOLD arrives while EXECUTING code is running. The implementation immediately kills the worker (like ABORT/STOP), which is wrong. HOLD when code is running should let the current execution finish, then enter HOLDING.

**Why it happens:** ABORT and STOP kill the subprocess immediately (per spec). HOLD does NOT — it is a "graceful, like PAUSE" operation per CONTEXT.md.

**How to avoid:** When HOLD arrives mid-execution, set a `pendingHold` flag on the instance engine object. When the current `worker.execute()` promise resolves, check the flag and route to HOLDING instead of the normal auto-advance path. Do NOT kill the worker.

**Warning signs:** Instances HOLD but Python execution was interrupted; EXECUTING state code was not allowed to complete.

---

### Pitfall 8: Two-Tier Error Detail — Don't Mix Tiers

**What goes wrong:** The full Python traceback (stored on the instance) gets returned to workflow REST clients. Or conversely, only the error type code is stored and the full traceback is lost.

**Why it happens:** The engine has two distinct storage/communication paths: (1) instance.error field (full traceback for the console), (2) REST response / SSE error event (type + message only). It's easy to accidentally swap these.

**How to avoid:** Define the two tiers explicitly in the engine's error handling:

- `instance.error` = `error_type + ': ' + error + '\n' + traceback` (full detail)
- SSE `error` event payload = `{ error_type, message: error }` (no traceback)
- REST response (future Phase 4) = same as SSE (type + message)

**Warning signs:** Tracebacks appearing in workflow client responses; management console only showing error codes without stack traces.

---

## Code Examples

Verified patterns from official sources:

### Spawn Python Worker (Node.js)

```typescript
// Source: Node.js official docs — child_process.spawn()
// https://nodejs.org/api/child_process.html
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import path from 'node:path'

const SCRIPT_PATH = path.resolve(process.cwd(), 'packages/python-sidecar/sandbox_runner.py')

const worker = spawn('python3', ['-u', SCRIPT_PATH], {
  stdio: ['pipe', 'pipe', 'pipe'],
})

// Line-by-line reading — handles chunk boundaries correctly
const rl = createInterface({ input: worker.stdout! })
rl.on('line', (line) => {
  const response = JSON.parse(line)
  // ... dispatch to pending promise
})

// Send a request
const request = { request_id: 'req-001', source_code: '...', inputs: {}, outputs: {} }
worker.stdin!.write(JSON.stringify(request) + '\n')
```

### Python Worker Main Loop

```python
# Source: Python 3.12 official docs
# https://docs.python.org/3.12/library/sys.html
# https://docs.python.org/3.12/library/contextlib.html
# https://docs.python.org/3.12/library/traceback.html
import sys, json, io, contextlib, traceback, time

def main():
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        request = json.loads(line)
        # ... process request ...
        print(json.dumps(response), flush=True)  # flush=True is critical

if __name__ == '__main__':
    main()
```

### Capture stdout/stderr in Python

```python
# Source: Python 3.12 official docs — contextlib.redirect_stdout
# https://docs.python.org/3.12/library/contextlib.html#contextlib.redirect_stdout
import io, contextlib

stdout_buf = io.StringIO()
stderr_buf = io.StringIO()

with contextlib.redirect_stdout(stdout_buf), contextlib.redirect_stderr(stderr_buf):
    exec(code_obj, namespace)
    return_value = namespace['execute'](inputs, outputs, props, action_props)

stdout_text = stdout_buf.getvalue()
stderr_text = stderr_buf.getvalue()
```

### Compile Before Exec (Distinguish SYNTAX_ERROR)

```python
# Source: Python 3.12 official docs — built-in exec(), compile()
# https://docs.python.org/3.12/library/functions.html#exec
try:
    code_obj = compile(source_code, '<action_code>', 'exec')
except SyntaxError as e:
    # Error type: SYNTAX_ERROR
    return {'error_type': 'SYNTAX_ERROR', 'error': f'{type(e).__name__}: {e}',
            'traceback': traceback.format_exc()}

try:
    exec(code_obj, namespace)
    return_value = namespace['execute'](inputs, outputs, props, action_props)
except Exception as e:
    # Error type: RUNTIME_ERROR
    return {'error_type': 'RUNTIME_ERROR', 'error': f'{type(e).__name__}: {e}',
            'traceback': traceback.format_exc()}
```

### SIGTERM + SIGKILL Sequence

```typescript
// Source: Node.js official docs — subprocess.kill()
// https://nodejs.org/api/child_process.html#subprocesskillsignal
function killWithTimeout(proc: ChildProcess, gracePeriodMs = 5000): Promise<void> {
  return new Promise((resolve) => {
    let killed = false
    const timer = setTimeout(() => {
      if (!killed) {
        proc.kill('SIGKILL')
      }
    }, gracePeriodMs)

    proc.on('close', () => {
      killed = true
      clearTimeout(timer)
      resolve()
    })

    proc.kill('SIGTERM')
  })
}
```

### readline createInterface on child stdout

```typescript
// Source: Node.js official docs — readline.createInterface
// https://nodejs.org/api/readline.html#readlinecreateinterfaceoptions
import { createInterface } from 'node:readline'

const rl = createInterface({
  input: childProcess.stdout!,
  // Do NOT set terminal: true — we're not a TTY
})

rl.on('line', (line) => {
  // Each 'line' event delivers exactly one complete line (newline stripped)
  // This handles chunk boundaries transparently
  const parsed = JSON.parse(line)
})

rl.on('close', () => {
  // Child process stdout closed (worker exited)
})
```

### Instance.pinned_code_versions Shape

The `pinned_code_versions` field on an instance is stored as a JSON array in SQLite. Based on the spec's "pin active code versions at invoke time" requirement, the engine needs a structure to look up which code version to use for a given state:

```typescript
// Design choice for Phase 3 — not in prior specs, Claude's discretion
// Recommend: array of { state: string, code_version_id: string }
type PinnedCodeVersion = {
  state: string
  code_version_id: string
}
// Instance.pinned_code_versions: PinnedCodeVersion[]

// Lookup at runtime:
function getPinnedCodeVersion(instance: Instance, state: string): string | undefined {
  const pins = instance.pinned_code_versions as PinnedCodeVersion[]
  return pins.find((p) => p.state === state)?.code_version_id
}
```

The existing `InstanceRepository.markStatesWithCodeExecuted()` already handles the `states_with_code_executed` field. The engine will call this after each successful state code execution.

---

## State of the Art

| Old Approach                                      | Current Approach                          | When Changed                                | Impact                                                                              |
| ------------------------------------------------- | ----------------------------------------- | ------------------------------------------- | ----------------------------------------------------------------------------------- |
| `sys.stdout = StringIO()` + manual restore        | `contextlib.redirect_stdout()`            | Python 3.4                                  | Context manager is exception-safe — original stdout is restored even if code throws |
| Single-use Python subprocess per execution        | Long-lived subprocess pool with recycling | Common pattern since Python multiprocessing | Eliminates Python startup overhead (~200ms per execution)                           |
| Manual chunk buffering for subprocess stdout      | `readline.createInterface` on stream      | Node.js 0.1.x+ (readline is ancient)        | Built-in line splitting; no custom buffer management                                |
| Hardcoded state transition logic (if/else chains) | Table-driven Map lookup                   | N/A — design choice                         | Table is the spec; code matches spec exactly; trivial to audit                      |

**No deprecated approaches in use.** All patterns are from stable Python stdlib and Node.js built-in modules.

---

## Open Questions

1. **`pinned_code_versions` schema on Instance**
   - What we know: `Instance.pinned_code_versions` is `unknown[]` in the storage types. The engine must populate this at invoke time (pin active code versions for all states) and read it during execution.
   - What's unclear: The exact JSON shape of each element was not specified in prior phases. The storage layer treats it as opaque JSON.
   - Recommendation: Use `{ state: string, code_version_id: string }[]` — simple, unambiguous, matches the lookup pattern. Document this shape in the engine's types.

2. **Python executable path**
   - What we know: The spec says "Python 3.12+". In a Docker container, this is likely `python3` or `python`.
   - What's unclear: Whether the path should be hardcoded, read from settings, or discovered via PATH.
   - Recommendation: Use a setting `python_executable` defaulting to `'python3'`. The settings table already exists (Phase 2). Add a new migration or seed it as a default. On the Dockerfile side (Phase 5+), the container will have Python 3.12 at the standard path.

3. **SSE emission from the engine**
   - What we know: The state machine must "emit SSE state_change event" on each transition (StateMachineSpec.md §3, Step 4). SSE is the REST protocol concern (Phase 4 scope).
   - What's unclear: How the engine emits events that the server layer picks up. The engine package has no HTTP dependency.
   - Recommendation: The engine should use a simple EventEmitter interface (Node.js `EventEmitter` or a callback) that the server layer subscribes to. The engine emits domain events; the server translates them to SSE. For Phase 3, stub the emission as an EventEmitter — Phase 4 wires the SSE transport.

4. **Timeout error message format**
   - What we know: CONTEXT.md specifies "Detailed timeout errors: include timeout duration, elapsed time, and setting name (e.g., 'Execution timed out after 60s (default_timeout_ms setting)')".
   - What's unclear: Where the timeout is enforced — in the Node.js engine (via a `setTimeout` around `worker.execute()`) or in the Python worker (via Python signal timeout).
   - Recommendation: Enforce timeout in Node.js. Use a `Promise.race([worker.execute(req), timeoutPromise(timeoutMs)])`. When the timeout fires, call `killWorker()` on the Python process (SIGTERM then SIGKILL). Set the error type to `TIMEOUT` in the response.

---

## Sources

### Primary (HIGH confidence)

- Node.js v25.7.0 official docs — `child_process.spawn()`, `subprocess.kill()`, `'close'` vs `'exit'` events, `stdio: 'pipe'` behavior
  URL: https://nodejs.org/api/child_process.html

- Node.js v25.7.0 official docs — `readline.createInterface()`, `'line'` event, stream input
  URL: https://nodejs.org/api/readline.html

- Python 3.12 official docs — `exec()`, `compile()`, namespace isolation, `__builtins__` control
  URL: https://docs.python.org/3.12/library/functions.html#exec

- Python 3.12 official docs — `contextlib.redirect_stdout()`, `contextlib.redirect_stderr()`
  URL: https://docs.python.org/3.12/library/contextlib.html

- Python 3.12 official docs — `traceback.format_exc()`, `traceback.format_exception()`
  URL: https://docs.python.org/3.12/library/traceback.html

- Python 3.12 official docs — `sys.stdout` buffering behavior, `-u` flag, `PYTHONUNBUFFERED`
  URL: https://docs.python.org/3.12/library/sys.html

- StateMachineSpec.md — Complete state transition table, state entry processing pipeline, command processing, hold semantics (project spec, authoritative)

- ExecutionEngineSpec.md — Subprocess pool architecture, stdin/stdout JSON protocol schema, Python code API, timeout/kill sequence (project spec, authoritative)

### Secondary (MEDIUM confidence)

- Eli Bendersky — "Interacting with a long-running child process in Python" (2017, still accurate)
  URL: https://eli.thegreenplace.net/2017/interacting-with-a-long-running-child-process-in-python/
  Key finding: `-u` flag requirement for long-lived workers; `readline()` for line-by-line reading

- Python official docs — `SyntaxError` raised by `compile()` vs runtime exceptions raised by `exec()`
  URL: https://docs.python.org/3/tutorial/errors.html
  Confirmed: `compile()` catches syntax errors before execution, enabling SYNTAX_ERROR vs RUNTIME_ERROR distinction

### Tertiary (LOW confidence)

- WebSearch: Community patterns for Node.js + Python subprocess JSON IPC — consistent with official docs, not independently verified
- WebSearch: State machine library ecosystem search (XState, typescript-fsm, etc.) — confirmed no library is preferable to hand-rolling for this spec-driven problem

---

## Metadata

**Confidence breakdown:**

- Standard Stack: HIGH — No new dependencies needed; all tools are Node.js and Python stdlib, both verified against official docs
- Architecture (State Machine): HIGH — Directly derived from StateMachineSpec.md (authoritative project spec) + standard table-driven FSM pattern
- Architecture (Python Sidecar): HIGH — Core patterns verified against Python 3.12 and Node.js official docs; the `-u` flag requirement confirmed from Python docs and community sources
- Pitfalls: HIGH — stdout buffering (official Python docs), chunk splitting (Node.js stream behavior), ABORT mid-execution (spec-driven analysis), two-tier error (CONTEXT.md explicit decision)
- Code Examples: HIGH — All Node.js examples use official API shapes; all Python examples use stdlib APIs confirmed from Python 3.12 docs

**Research date:** 2026-02-25
**Valid until:** 2026-03-25 (30 days — Python 3.12 and Node.js LTS APIs are stable; spec is locked)
