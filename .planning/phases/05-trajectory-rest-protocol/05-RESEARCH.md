# Phase 5: Trajectory REST Protocol - Research

**Researched:** 2026-02-26
**Domain:** Express 5 REST API + SSE streaming on top of Phase 4 InstanceManager
**Confidence:** HIGH

---

## Summary

Phase 4 delivered a fully functional `InstanceManager` with a clean public API: `invoke()`, `sendCommand()`, `getInstance()`, `getActiveInstances()`, `resizePool()`, `shutdown()`. Phase 5's job is to build Express routes that expose this API as the `/trajectory/v1/` HTTP surface. The server entry point (`packages/server/src/index.ts`) already has a stub Express 5 app with one health route — Phase 5 expands it into the full protocol.

The core technical challenges are (1) SSE streaming with per-instance event buses, ring-buffer replay on reconnect, and heartbeats, and (2) request validation that rejects unknown fields. The decisions lock down the response envelope shape, SSE event types, error taxonomy, and authentication pattern. What remains at Claude's discretion is field naming (snake_case is the clear choice given the existing codebase's all-snake_case data types), HTTP status code mapping, and SSE event payload structure.

The standard approach for SSE in Express 5 is: set `Content-Type: text/event-stream` + `Cache-Control: no-cache` + `Connection: keep-alive`, call `res.flushHeaders()` to push headers immediately, then use `res.write()` for each event formatted as `event: TYPE\nid: N\ndata: JSON\n\n`. Event buses are in-process `EventEmitter` instances keyed by instance ID, not a library. The ring buffer is a fixed-size array per instance capped at 256 events, shifted on overflow. Validation without a framework is sufficient given the small number of endpoints and the codebase's no-external-library philosophy.

**Primary recommendation:** Build the server in `packages/server/src/` with an `SseManager` class for the event bus/ring buffer, a `validateBody()` helper for strict request validation, and two `express.Router` modules (one per plan). No new npm packages are required beyond `morgan` and `cors`.

---

## Standard Stack

### Core (already installed)

| Library               | Version   | Purpose                              | Why Standard                       |
| --------------------- | --------- | ------------------------------------ | ---------------------------------- |
| `express`             | 5.2.1     | HTTP server, routing                 | Already installed; locked decision |
| `@types/express`      | 5.0.6     | Express 5 TypeScript types           | Already installed                  |
| `@trajectory/engine`  | workspace | InstanceManager and all engine types | Phase 4 complete                   |
| `@trajectory/storage` | workspace | initializeDatabase, types            | Phase 2 complete                   |

### Supporting (needs installation)

| Library         | Version | Purpose                     | When to Use                                |
| --------------- | ------- | --------------------------- | ------------------------------------------ |
| `cors`          | ^2.8.5  | CORS middleware             | REST-11: CORS enabled for all origins      |
| `@types/cors`   | ^2.8.17 | TypeScript types for cors   | Companion to cors                          |
| `morgan`        | ^1.10.0 | HTTP request logging        | REST-12: INFO-level request logs to stdout |
| `@types/morgan` | ^1.9.9  | TypeScript types for morgan | Companion to morgan                        |

### Alternatives Considered

| Instead of                        | Could Use              | Tradeoff                                                                                                                         |
| --------------------------------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `cors` package                    | Manual CORS headers    | cors has OPTIONS preflight handling; manual is error-prone for complex origin configs                                            |
| `morgan`                          | Manual request logging | morgan covers all standard log formats; writing a custom logger is waste                                                         |
| No validation library (hand-roll) | `zod` 4.x              | Zod is the ecosystem standard but adds a new dep; for 6 endpoints with simple shapes, hand-roll is fine. Zod is better at scale. |

**Installation:**

```bash
npm install cors morgan --workspace=packages/server
npm install --save-dev @types/cors @types/morgan --workspace=packages/server
```

---

## Architecture Patterns

### Recommended Project Structure

```
packages/server/src/
├── index.ts              # Entry point: wires InstanceManager, SseManager, mounts routers
├── sse-manager.ts        # SseManager class: event bus, ring buffer, heartbeat, broadcast
├── routes/
│   ├── protocol.ts       # Express Router: health, capabilities, invoke, instance GET/list, DELETE
│   └── commands.ts       # Express Router: command POST, SSE GET/events, error format
├── middleware/
│   ├── cors.ts           # CORS middleware factory (reads settings for allowed origins)
│   └── error-handler.ts  # 4-arg error handler middleware
└── validation.ts         # validateBody() strict request validation helper
```

### Pattern 1: Express 5 Router Modules

**What:** Each plan gets one `express.Router` module. The main `index.ts` mounts both routers under `/trajectory/v1`.

**When to use:** Whenever routes are logically grouped by plan — keeps plan 05-01 and 05-02 isolated and reviewable.

**Example:**

```typescript
// Source: expressjs.com/en/guide/routing.html — express.Router() pattern
// packages/server/src/routes/protocol.ts
import { Router } from 'express'
import type { InstanceManager } from '@trajectory/engine'

export function createProtocolRouter(manager: InstanceManager): Router {
  const router = Router()

  router.get('/health', (_req, res) => {
    res.json({
      data: { status: 'ok', pool: manager.poolStatus },
      meta: {},
    })
  })

  // ... other routes

  return router
}

// packages/server/src/index.ts
import { createProtocolRouter } from './routes/protocol.js'
app.use('/trajectory/v1', createProtocolRouter(manager))
```

### Pattern 2: Express 5 Async Error Propagation

**What:** Express 5 automatically catches thrown errors and rejected promises in async route handlers and forwards them to the error-handling middleware via `next(err)`. No try/catch needed in route bodies.

**When to use:** All async route handlers — the norm in Phase 5.

**Example (verified working — tested in this codebase):**

```typescript
// Source: expressjs.com/en/guide/error-handling.html — Express 5 auto-propagation
router.post('/actions/:action_oid/invoke', async (req, res) => {
  const result = await manager.invoke(req.body) // throws EngineError → auto next(err)
  res.status(201).json({ data: { instance_id: result.runtime_action_instance_id }, meta: {} })
})

// Error handler — MUST be defined LAST with exactly 4 args
// packages/server/src/middleware/error-handler.ts
import type { ErrorRequestHandler } from 'express'
import { EngineError, InvalidStateTransitionError } from '@trajectory/engine'

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof InvalidStateTransitionError) {
    return void res.status(409).json({
      error: { code: err.code, message: err.message, details: {} },
    })
  }
  if (err instanceof EngineError) {
    const status = ENGINE_ERROR_STATUS_MAP[err.code] ?? 500
    return void res.status(status).json({
      error: { code: err.code, message: err.message, details: {} },
    })
  }
  res.status(500).json({
    error: { code: 'INTERNAL_ERROR', message: 'Internal server error', details: {} },
  })
}
```

### Pattern 3: SSE Streaming with SseManager

**What:** A central `SseManager` class manages per-instance event buses (EventEmitters), ring buffers (256 events), heartbeat timers, and active connection sets. Routes subscribe to it; the engine's `onStateChange` callback publishes to it.

**When to use:** This is the only correct pattern for SSE in this architecture — SSE connections must survive across multiple state changes that fire from the state machine's async execution thread.

**SSE wire format (from MDN spec):**

```
event: state_change\n
id: 42\n
data: {"instance_id":"...","state":"EXECUTING","previous":"STARTING",...}\n
\n
```

- Each event field ends with `\n`
- Events are separated by a blank line (`\n\n`)
- The `id:` field enables Last-Event-ID reconnection

**SSE endpoint pattern (verified with Express 5):**

```typescript
// Source: masteringjs.io/tutorials/express/server-sent-events — core pattern
// Source: MDN Using server-sent events — event format
router.get('/instances/:id/events', (req, res) => {
  const instance = manager.getInstance(req.params.id)
  if (!instance) {
    return void res.status(404).json({
      error: { code: 'INSTANCE_NOT_FOUND', message: 'Instance not found', details: {} },
    })
  }

  // Set SSE headers and flush immediately
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // Prevent nginx proxy buffering
  })
  res.flushHeaders()

  // Replay missed events from ring buffer (Last-Event-ID support)
  const lastEventId = req.headers['last-event-id']
  if (lastEventId) {
    const missed = sseManager.getEventsSince(req.params.id, Number(lastEventId))
    for (const event of missed) {
      res.write(formatSseEvent(event))
    }
  }

  // Subscribe to new events
  const unsubscribe = sseManager.subscribe(req.params.id, (event) => {
    res.write(formatSseEvent(event))
  })

  // Handle client disconnect
  req.on('close', () => {
    unsubscribe()
  })
})

// SSE event formatter
function formatSseEvent(event: SseEvent): string {
  let msg = `event: ${event.type}\n`
  msg += `id: ${event.id}\n`
  msg += `data: ${JSON.stringify(event.data)}\n`
  msg += '\n'
  return msg
}
```

### Pattern 4: SseManager Class Design

**What:** Encapsulates all SSE state. Receives callbacks from InstanceManager (`onStateChange`, `onTerminal`). The route layer only calls `subscribe()`, `getEventsSince()`, and `publish()`.

**Ring buffer:** Fixed array of 256 entries per instance. When full, shift off the oldest. Events have monotonically increasing integer IDs per instance (not global). On reconnect, send all events with `id > lastEventId`.

**Heartbeat:** Single `setInterval` per active instance at 30 seconds. Cleared when the instance reaches terminal state after the 5-10 second linger.

**Terminal state linger:** After emitting the terminal event, keep the SSE bus alive for ~5 seconds (configurable), then remove the instance's bus. Active connections will receive the terminal event and can safely close.

```typescript
// packages/server/src/sse-manager.ts
export interface SseEvent {
  id: number // Per-instance monotonic counter
  type: 'state_change' | 'output' | 'log' | 'heartbeat'
  data: Record<string, unknown>
}

interface InstanceBus {
  buffer: SseEvent[] // Ring buffer, max 256 events
  nextId: number // Monotonically increasing counter
  listeners: Set<(event: SseEvent) => void>
  heartbeatTimer: NodeJS.Timeout
  terminalTimer?: NodeJS.Timeout
}

export class SseManager {
  private readonly buses = new Map<string, InstanceBus>()
  private readonly BUFFER_SIZE = 256
  private readonly HEARTBEAT_MS = 30_000
  private readonly TERMINAL_LINGER_MS = 7_000

  // Called by InstanceManager onStateChange callback
  publishStateChange(instanceId: string, state: string, previousState: string): void {
    this.publish(instanceId, 'state_change', { state, previous_state: previousState })
  }

  // Called by InstanceManager onTerminal callback — schedule bus teardown
  publishTerminal(instanceId: string, state: string): void {
    this.publishStateChange(instanceId, state, /* previous */ '')
    const bus = this.buses.get(instanceId)
    if (bus) {
      clearInterval(bus.heartbeatTimer)
      bus.terminalTimer = setTimeout(() => {
        this.buses.delete(instanceId)
      }, this.TERMINAL_LINGER_MS)
    }
  }

  subscribe(instanceId: string, listener: (event: SseEvent) => void): () => void {
    const bus = this.getOrCreateBus(instanceId)
    bus.listeners.add(listener)
    return () => bus.listeners.delete(listener)
  }

  getEventsSince(instanceId: string, afterId: number): SseEvent[] {
    const bus = this.buses.get(instanceId)
    if (!bus) return []
    return bus.buffer.filter((e) => e.id > afterId)
  }

  private publish(instanceId: string, type: SseEvent['type'], data: Record<string, unknown>): void {
    const bus = this.getOrCreateBus(instanceId)
    const event: SseEvent = { id: bus.nextId++, type, data }

    // Ring buffer: push and trim to max size
    bus.buffer.push(event)
    if (bus.buffer.length > this.BUFFER_SIZE) {
      bus.buffer.shift()
    }

    // Notify all active listeners
    for (const listener of bus.listeners) {
      listener(event)
    }
  }

  private getOrCreateBus(instanceId: string): InstanceBus {
    if (!this.buses.has(instanceId)) {
      const bus: InstanceBus = {
        buffer: [],
        nextId: 1,
        listeners: new Set(),
        heartbeatTimer: setInterval(() => {
          this.publish(instanceId, 'heartbeat', { timestamp: new Date().toISOString() })
        }, this.HEARTBEAT_MS),
      }
      this.buses.set(instanceId, bus)
    }
    return this.buses.get(instanceId)!
  }
}
```

### Pattern 5: Strict Request Validation (validateBody helper)

**What:** A reusable function that checks for required fields, wrong types, and unknown fields (rejecting them with 400). Does NOT use Zod or express-validator — keeps the pattern consistent with the codebase's no-external-validation philosophy.

**When to use:** All POST request body validation. Applied before the InstanceManager call.

**Example:**

```typescript
// packages/server/src/validation.ts
export interface FieldSpec {
  required?: boolean
  type?: 'string' | 'number' | 'array' | 'object'
}

export function validateBody(
  body: unknown,
  schema: Record<string, FieldSpec>
): { valid: true; data: Record<string, unknown> } | { valid: false; message: string } {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { valid: false, message: 'Request body must be a JSON object' }
  }

  const obj = body as Record<string, unknown>

  // Reject unknown fields (CONTEXT.md locked decision)
  for (const key of Object.keys(obj)) {
    if (!(key in schema)) {
      return { valid: false, message: `Unknown field: ${key}` }
    }
  }

  // Check required fields and types
  for (const [key, spec] of Object.entries(schema)) {
    if (spec.required && !(key in obj)) {
      return { valid: false, message: `Missing required field: ${key}` }
    }
    if (key in obj && spec.type) {
      const val = obj[key]
      const ok =
        spec.type === 'array'
          ? Array.isArray(val)
          : spec.type === 'object'
            ? typeof val === 'object' && val !== null && !Array.isArray(val)
            : typeof val === spec.type
      if (!ok) {
        return { valid: false, message: `Field '${key}' must be of type ${spec.type}` }
      }
    }
  }

  return { valid: true, data: obj }
}
```

### Pattern 6: CORS Middleware (configurable origins)

**What:** The `cors` package middleware, initialized from settings (`cors_allowed_origins` or defaulting to `*`). Applied globally as the first `app.use()`.

**Example:**

```typescript
// Source: expressjs/cors README — configurable origin
import cors from 'cors'

// Default to '*'; Phase 6 will add cors_allowed_origins setting
app.use(
  cors({
    origin: process.env.CORS_ORIGIN ?? '*',
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'X-API-Key', 'Last-Event-ID'],
    exposedHeaders: ['Content-Type'],
  })
)
```

### Pattern 7: API Key Authentication Middleware

**What:** Simple middleware checking `X-API-Key` header against the value in settings. Applied to all `/trajectory/v1/` routes. Returns 401 if key is missing or invalid. If settings has no API key configured, authentication is skipped (permissive default per spec).

**Example:**

```typescript
// Source: CONTEXT.md locked decision — "simple API key via X-API-Key header"
function createApiKeyMiddleware(settingsRepo: SettingsRepository) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const configuredKey = settingsRepo.getValue('api_key')
    if (!configuredKey) {
      // No key configured — open access (default per spec)
      return next()
    }
    const provided = req.headers['x-api-key']
    if (provided !== configuredKey) {
      res.status(401).json({
        error: { code: 'UNAUTHORIZED', message: 'Invalid or missing API key', details: {} },
      })
      return
    }
    next()
  }
}
```

Note: The settings migration (001-initial-schema.ts) doesn't currently include `api_key`. The server should read it gracefully — `getValue('api_key')` returns null if not present, which means open access.

### Pattern 8: Request Logging with Morgan

**What:** `morgan('dev')` for development, or a custom format for structured output. Applied as the first middleware after CORS.

**Example:**

```typescript
// Source: github.com/expressjs/morgan — dev format
import morgan from 'morgan'

// 'dev' format: METHOD URL STATUS response-time ms
// Outputs to stdout which is what REST-12 requires
app.use(morgan('dev'))
```

### Pattern 9: Index.ts Wiring

**What:** The `index.ts` entry point initializes the database, creates the `InstanceManager` with callbacks that publish to `SseManager`, and mounts all routers.

**Example:**

```typescript
// packages/server/src/index.ts
import express from 'express'
import cors from 'cors'
import morgan from 'morgan'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { initializeDatabase } from '@trajectory/storage'
import { InstanceManager } from '@trajectory/engine'
import { SseManager } from './sse-manager.js'
import { createProtocolRouter } from './routes/protocol.js'
import { createCommandsRouter } from './routes/commands.js'
import { errorHandler } from './middleware/error-handler.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DB_PATH =
  process.env.DB_PATH ?? path.join(__dirname, '..', '..', '..', 'data', 'trajectory.db')
const PORT = Number(process.env.PORT ?? 3001)

const db = initializeDatabase(DB_PATH)
const sseManager = new SseManager()

const manager = new InstanceManager(db, {
  scriptPath: path.join(__dirname, '..', '..', '..', 'python', 'sandbox_runner.py'),
  onStateChange: (instanceId, state, instance) => {
    sseManager.publishStateChange(instanceId, state, /* previous from history */ '')
  },
  onTerminal: (instanceId, state, _instance) => {
    sseManager.publishTerminal(instanceId, state)
  },
  onError: (instanceId, error) => {
    sseManager.publishError(instanceId, error.message)
  },
})

const app = express()
app.use(cors({ origin: '*' }))
app.use(morgan('dev'))
app.use(express.json())

app.use('/trajectory/v1', createProtocolRouter(manager))
app.use('/trajectory/v1', createCommandsRouter(manager, sseManager))

app.use(errorHandler)

app.listen(PORT, () => {
  console.log(`Trajectory Action Server listening on http://localhost:${PORT}`)
})
```

### Anti-Patterns to Avoid

- **Not calling `res.flushHeaders()` before writing SSE events:** The headers won't be sent until the first event, causing connection timeout with no output.
- **Using `res.end()` inside an SSE handler:** Closes the connection immediately; use only `res.write()` for events and let the client disconnect trigger cleanup.
- **Keeping a reference to `res` directly without cleanup:** Must remove the reference on `req.on('close')` or memory leaks on disconnect.
- **Heartbeat timer not cleared when instance terminates:** Timer fires indefinitely after the bus is cleaned up; always clear in the terminal handler.
- **Mounting error handler before routes:** Express calls middleware in order — the 4-arg error handler MUST be last.
- **Using `res.json()` with status in Express 5 the old way:** In Express 5 it's `res.status(201).json(...)`, never `res.json({...}, 201)`.
- **Async handler that writes SSE events after client disconnect:** Check `res.writableEnded` before `res.write()` to avoid EPIPE errors.

---

## Don't Hand-Roll

| Problem                 | Don't Build                      | Use Instead                   | Why                                                                          |
| ----------------------- | -------------------------------- | ----------------------------- | ---------------------------------------------------------------------------- |
| CORS preflight handling | Custom OPTIONS handler           | `cors` package                | Handles preflight, varies-by-origin correctly, multiple allowed-methods      |
| HTTP request logging    | Custom middleware with timestamp | `morgan`                      | 14 predefined tokens, dev/combined/tiny formats, configurable stream         |
| SSE library             | `better-sse`, `express-sse`      | Raw `res.write()`             | Only 1 SSE endpoint; library overhead adds complexity; raw write is 5 lines  |
| Ring buffer library     | `ringbufferjs`, etc.             | Plain `Array` with `.shift()` | 256-element buffer; library is unnecessary for this scale                    |
| Event bus library       | Redis pub/sub, socket.io         | In-process `EventEmitter`     | Single-process architecture; Redis adds an external dependency for zero gain |

**Key insight:** This is a single-process Node.js server. All SSE connections and state machine callbacks live in the same process, so in-memory EventEmitters are the correct, zero-dependency event bus. A library is overkill for one SSE endpoint type with 256 events max.

---

## Common Pitfalls

### Pitfall 1: SSE Connection Not Flushed Immediately

**What goes wrong:** Client connects to SSE endpoint but receives no response until the first event is emitted — which may be seconds or never for fast-completing actions.

**Why it happens:** HTTP responses buffer headers until `res.write()` or `res.end()` is called, OR until the buffer fills.

**How to avoid:** Always call `res.flushHeaders()` immediately after `res.set()`. This sends the `200 OK` with headers right away, establishing the SSE stream. Never skip this.

**Warning signs:** SSE connections show as "pending" in browser devtools for several seconds before data appears.

### Pitfall 2: Ring Buffer Has Wrong Semantics for Last-Event-ID

**What goes wrong:** Client sends `Last-Event-ID: 50`, but the ring buffer has already shifted out events 1–30. The server replays events 31–256. Client may have already seen some of these (31–50) and processes them again.

**Why it happens:** Ring buffer correctly returns `id > lastEventId`, but the buffer may not contain the full history back to `lastEventId`.

**How to avoid:** This is expected/acceptable behavior — SSE reconnection cannot guarantee no-duplicate delivery. The client must be idempotent for `state_change` events (state transitions are idempotent to apply). Document in comments that `getEventsSince()` returns events after `afterId` from the current buffer only.

**Warning signs:** Duplicate state transitions in client-side logs.

### Pitfall 3: Heartbeat Timer Leaks After Instance Termination

**What goes wrong:** An instance terminates. The terminal event fires, the SSE bus teardown is scheduled. But the heartbeat `setInterval` fires in between, creating one more event after the terminal. Worse, if teardown fails (timing edge), the timer fires indefinitely.

**Why it happens:** `clearInterval()` not called before `setTimeout()` for the linger period.

**How to avoid:** In `publishTerminal()`, always call `clearInterval(bus.heartbeatTimer)` before scheduling the teardown timer. The linger period only needs to keep the bus alive for listeners — heartbeats are not needed during linger.

**Warning signs:** `heartbeat` events arriving after `state_change` with `COMPLETED`/`ABORTED` state.

### Pitfall 4: EPIPE on Write After Client Disconnect

**What goes wrong:** Client disconnects, `req.on('close')` fires and unsubscribes. But an in-flight event was already handed to the listener before unsubscription. Calling `res.write()` after the connection closes throws `EPIPE` / `ERR_HTTP_HEADERS_SENT`.

**Why it happens:** Race between the close event and listener invocation.

**How to avoid:** Guard every `res.write()` call in the listener:

```typescript
const listener = (event: SseEvent) => {
  if (!res.writableEnded) {
    res.write(formatSseEvent(event))
  }
}
```

**Warning signs:** Uncaught `EPIPE` errors in server logs for SSE endpoints.

### Pitfall 5: Unknown Fields Not Rejected

**What goes wrong:** Client sends `{ "environment_oid": "...", "typo_field": "x" }`. Server ignores `typo_field` silently. Per CONTEXT.md, unknown fields must be rejected with 400.

**Why it happens:** Express's `express.json()` parses all fields without validation.

**How to avoid:** The `validateBody()` helper checks `Object.keys(body)` against the expected schema and returns 400 for any unrecognized key. Apply to all POST endpoints.

**Warning signs:** Clients with typos in field names receive 201/200 responses instead of 400.

### Pitfall 6: Instance Status Query Returns Stale Data

**What goes wrong:** Client polls `GET /instances/:id` and receives old state data because `InstanceManager.getInstance()` reads from SQLite but the state machine is still processing in-flight.

**Why it happens:** SQLite read is synchronous; the state machine updates SQLite on every transition. Actually this is NOT a problem — `better-sqlite3` is synchronous and readers see committed writes immediately in WAL mode.

**How to avoid:** No special handling needed. WAL mode ensures consistent reads. The state machine uses `updateState()` which is synchronous — after it returns, the next `findById()` reads the new state. No cache invalidation issues.

**Warning signs:** None expected; document this as a non-issue for the planner.

### Pitfall 7: State History Shape in Instance Response

**What goes wrong:** CONTEXT.md says instance GET returns `state: { current, previous, entered_at }` as a nested object, but the `Instance` domain type stores `state` as a flat string and `state_history` as an array. The route must construct the nested state object from `state_history`.

**Why it happens:** The storage model and the API response model differ.

**How to avoid:** In the instance GET route, transform the response:

```typescript
const instance = manager.getInstance(id)
const history = instance.state_history as Array<{ state: string; timestamp: string }>
const current = history[history.length - 1]
const previous = history[history.length - 2]

const response = {
  data: {
    instance_id: instance.runtime_action_instance_id,
    action_oid: instance.action_oid,
    state: {
      current: instance.state,
      previous: previous?.state ?? null,
      entered_at: current?.timestamp ?? instance.created_at,
    },
    inputs: instance.input_parameters,
    outputs: instance.output_parameters,
    created_at: instance.created_at,
  },
  meta: {},
}
```

**Warning signs:** API response with flat `state: "EXECUTING"` instead of nested state object.

### Pitfall 8: SSE Bus Created Before First Subscription

**What goes wrong:** `InstanceManager.onStateChange` fires immediately when the state machine starts (STARTING state). The `SseManager` creates the bus at first `publish()`. If a client subscribes to SSE before any state change, they may miss the initial `STARTING` event.

**Why it happens:** The bus is created lazily on first `publish()`, but the publish happens before the SSE route is called.

**How to avoid:** Pre-create the SSE bus in the `invoke()` path — or more simply, emit the initial state as the first ring-buffer event. Any client connecting after invoke() will see the first state in the ring buffer via `getEventsSince(id, 0)`. Since all events are replayed from event ID 1 on fresh connect (when `Last-Event-ID` is absent or 0), clients that connect after invoke() will see all prior events. The route should always replay the full buffer (from `afterId = 0`) on first connection.

**Warning signs:** Client connects to SSE endpoint and never receives the initial `state_change` event.

### Pitfall 9: Missing `environment_oid` in Invoke Request Body

**What goes wrong:** CONTEXT.md says `environment_oid` is in the request body, but `InstanceManager.invoke()` takes `InvokeRequest` which does NOT include `environment_oid` — the manager looks it up from the action definition. The route must NOT pass `environment_oid` to `invoke()` as a separate field.

**Why it happens:** CONTEXT.md mentions `environment_oid` in the body as context for future multi-environment routing, but the current `InstanceManager` derives it from the action's own `environment_oid`.

**How to avoid:** Accept `environment_oid` in the request body (required field per CONTEXT.md), validate it, but do not pass it to `invoke()` — or optionally validate that it matches the action's `environment_oid`. The route body schema is:

```typescript
// Required fields for POST /actions/:action_oid/invoke
{
  environment_oid: string,         // validated but used for route auth/context
  workflow_instance_id: string,
  step_instance_id: string,
  step_oid: string,
  input_parameters: array,
}
```

**Warning signs:** 500 errors when `invoke()` is called with extra fields it doesn't expect (TypeScript compile errors).

---

## Code Examples

### HTTP Status Code Mapping for Engine Errors

```typescript
// Recommended mapping — covers all engine error codes
// Source: CONTEXT.md error taxonomy + REST-10 requirement
const ENGINE_ERROR_STATUS_MAP: Record<string, number> = {
  ACTION_NOT_FOUND: 404,
  INSTANCE_NOT_FOUND: 404,
  INVALID_STATE_TRANSITION: 409, // State conflict
  PARAMETER_VALIDATION_FAILED: 400,
  EXECUTION_ERROR: 500,
  INVALID_COMMAND: 422, // Command understood but not processable
}
```

### SSE Event Payload Structures (Claude's Discretion)

Use snake_case throughout (consistent with the storage domain types).

```typescript
// state_change event
{
  type: 'state_change',
  data: {
    instance_id: string,
    state: string,           // new state (EXECUTING, PAUSED, etc.)
    previous_state: string,  // prior state
    timestamp: string,       // ISO 8601
  }
}

// output event — emitted when output_parameters changes
{
  type: 'output',
  data: {
    instance_id: string,
    outputs: Array<{ name: string; value: string }>,
    timestamp: string,
  }
}

// log event — stdout/stderr from Python execution
{
  type: 'log',
  data: {
    instance_id: string,
    stream: 'stdout' | 'stderr',
    message: string,
    timestamp: string,
  }
}

// heartbeat event
{
  type: 'heartbeat',
  data: {
    timestamp: string,
  }
}
```

### Instance GET Response Shape

```typescript
// GET /trajectory/v1/instances/:id
// CONTEXT.md: nested state object, flat inputs/outputs
{
  data: {
    instance_id: string,
    action_oid: string,
    environment_oid: string,
    workflow_instance_id: string,
    step_instance_id: string,
    step_oid: string,
    visibility: 'observable' | 'opaque',
    state: {
      current: string,           // e.g. "EXECUTING"
      previous: string | null,   // e.g. "STARTING"
      entered_at: string,        // ISO timestamp when current state was entered
    },
    inputs: Array<{ name: string; value: string }>,
    outputs: Array<{ name: string; value: string }>,
    created_at: string,
    started_at: string | null,
    completed_at: string | null,
    error: string | null,
  },
  meta: {}
}
```

### Capabilities Response Shape

```typescript
// GET /trajectory/v1/capabilities
// Returns all registered actions with parameters and supported commands
{
  data: [
    {
      action_oid: string,
      local_id: string,           // human-readable name
      version: string,
      description: string | null,
      visibility: 'observable' | 'opaque',
      input_parameters: Array<{
        name: string,
        type: string,
        required: boolean,
        default_value: string | null,
        description: string | null,
      }>,
      output_parameters: Array<{
        name: string,
        type: string,
        description: string | null,
      }>,
      supported_commands: string[],  // PAUSE/RESUME etc. based on visibility
    }
  ],
  meta: { total: number }
}
```

### Health Response Shape

```typescript
// GET /trajectory/v1/health
{
  data: {
    status: 'ok',
    timestamp: string,       // ISO 8601
    pool: {
      size: number,
      idle: number,
      busy: number,
      queued: number,
    }
  },
  meta: {}
}
```

### Command Endpoint

```typescript
// POST /trajectory/v1/instances/:id/command
// Request body
{ command: 'PAUSE' | 'RESUME' | 'HOLD' | 'UNHOLD' | 'ABORT' | 'STOP' | 'CLEAR' }

// Response 200 (accepted)
{ data: { instance_id: string, command: string, accepted: true }, meta: {} }

// Error 409 (invalid state transition)
{ error: { code: 'INVALID_STATE_TRANSITION', message: '...', details: { current_state: string, command: string } } }
```

### List Instances Response

```typescript
// GET /trajectory/v1/instances?workflow_instance_id=X&status=EXECUTING&action_oid=Y
{
  data: [/* same shape as single instance GET */],
  meta: { total: number }
}
```

---

## Field Naming Decision (Claude's Discretion → snake_case)

The entire codebase uses snake_case for all data fields:

- Storage types: `runtime_action_instance_id`, `action_oid`, `state_history`, `input_parameters`
- InstanceManager types: `InvokeRequest.action_oid`, `InvokeResult.runtime_action_instance_id`
- Instance domain type: all fields are snake_case

**Recommendation: Use snake_case throughout the REST API.** This is consistent with the existing codebase, avoids a camelCase-to-snake_case translation layer in routes, and matches what clients already see in the InvokeResult.

---

## State of the Art

| Old Approach                                               | Current Approach                       | When Changed | Impact                                 |
| ---------------------------------------------------------- | -------------------------------------- | ------------ | -------------------------------------- |
| Express 4 async errors need `express-async-errors` wrapper | Express 5 auto-propagates async throws | 5.x release  | No try/catch boilerplate in routes     |
| `app.del()` for DELETE routes                              | `app.delete()` only                    | Express 5    | Use `app.delete()` / `router.delete()` |
| `res.json({ data }, 201)`                                  | `res.status(201).json({ data })`       | Express 5    | Status must be set separately          |
| SSE requires `res.flush()` (deprecated)                    | `res.flushHeaders()` + `res.write()`   | Node.js 16+  | `flushHeaders()` is the stable API     |

**Express 5 confirmed working patterns (tested in this codebase):**

- `async` route handlers: errors auto-propagate to error handler ✓
- `app.delete()`: available ✓
- `res.set()` + `res.flushHeaders()` + `res.write()`: SSE pattern works ✓
- `express.Router()`: returns function as expected ✓

---

## Open Questions

1. **`api_key` setting not in current schema**
   - What we know: CONTEXT.md locks in `X-API-Key` authentication stored in settings; current `001-initial-schema.ts` seeds 4 settings (none is `api_key`)
   - What's unclear: Should Phase 5 add `api_key` to the settings table, or skip auth enforcement if the setting is missing?
   - Recommendation: Accept that `api_key` setting doesn't exist yet; `getValue('api_key')` returns null → open access. Phase 6 (Management API) adds the setting. Route can read it gracefully.

2. **`onStateChange` callback doesn't provide previous state**
   - What we know: `InstanceManagerOptions.onStateChange` signature is `(instanceId, state, instance) => void`. The `instance.state_history` array has the full history.
   - What's unclear: Should `SseManager.publishStateChange()` extract the previous state from `state_history`, or receive it as a separate argument?
   - Recommendation: Pass the `instance` to `SseManager` (or derive previous state from `state_history[-2]`). The `onStateChange` callback already receives the full `Instance` object — use `state_history`.

3. **Log events from Python stdout/stderr — routing to SSE**
   - What we know: `ExecutionLogger` and `SseManager` are separate concerns. Python stdout/stderr is captured in the worker (`PythonWorker`) and returned in the `SidecarResponse`.
   - What's unclear: The `SidecarResponse` stdout/stderr fields are currently available when code execution completes, but not streamed line-by-line during execution. SSE `log` events require streaming as Python prints.
   - Recommendation: For Phase 5, emit `log` events when state machine enters a new state (batch, not streaming). Real-time stdout streaming from Python requires significant PythonWorker changes (line buffering) — defer to a later phase. The `log` event type can emit the captured stdout/stderr from the `SidecarResponse` at state completion.

4. **`DELETE /instances/:id` vs `POST .../command ABORT`**
   - What we know: REST-09 says DELETE sends ABORT and terminates subprocess; REST-05 says POST command also handles ABORT.
   - What's unclear: What makes DELETE different from POST command ABORT? The spec says DELETE also "terminates subprocess if running" which maps to `pool.killWorker()`.
   - Recommendation: DELETE calls `sendCommand('ABORT')` (same as command POST), then also calls `pool.killWorker(instanceId)` for immediate subprocess termination. Command POST ABORT lets the state machine drive the ABORTING state normally (with cleanup code). DELETE is the "force kill" variant.

---

## Sources

### Primary (HIGH confidence)

- Codebase direct inspection — `packages/server/src/index.ts` (Express 5.2.1 stub confirmed)
- Codebase direct inspection — `packages/engine/src/instance-manager/` (InstanceManager API confirmed)
- Codebase direct inspection — `packages/storage/src/types.ts` (Instance domain type confirmed)
- Codebase direct inspection — `packages/storage/src/repositories/settings.repository.ts` (settings keys confirmed)
- Live test — Express 5 async error propagation verified in this codebase's node_modules
- Live test — Express 5 `app.delete()`, `Router()`, `res.flushHeaders()` confirmed available
- expressjs.com/en/guide/migrating-5.html — Express 5 breaking changes (res.status chain, app.delete)
- expressjs.com/en/guide/error-handling.html — 4-arg error handler, async propagation in Express 5
- developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events — SSE wire format (event/id/data/retry fields)

### Secondary (MEDIUM confidence)

- masteringjs.io/tutorials/express/server-sent-events — `res.set()` + `res.flushHeaders()` + `res.write()` SSE pattern (verified against Express docs)
- github.com/colinhacks/zod/releases — Zod 4.x is stable; opted to not add as dependency
- WebSearch: SSE `X-Accel-Buffering: no` header for nginx proxy (multiple consistent sources)
- WebSearch: heartbeat `: keep-alive\n\n` pattern and 15-30s interval recommendations

### Tertiary (LOW confidence)

- WebSearch: morgan 1.10.0 version — npm page blocked, inferred from GitHub README pattern; version is stable

---

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH — Express 5.2.1 installed and tested; cors/morgan are stable and well-known
- Architecture: HIGH — SSE pattern verified with live Express 5 test; router pattern from official docs
- SSE ring buffer: HIGH — simple array + shift pattern; no library needed for 256-event buffer
- Pitfalls: HIGH — identified from direct codebase analysis and SSE-specific patterns
- Open questions: MEDIUM — design choices flagged for planner with clear recommendations

**Research date:** 2026-02-26
**Valid until:** 2026-03-28 (stable — Express 5 and SSE protocol are stable; no fast-moving dependencies)
