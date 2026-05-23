# Trajectory REST Protocol — As-Built Specification

**Document type:** Reference + brief architecture notes
**Source of truth:** Implementation in `packages/server/src/` as of 2026-05-18
**Audience:** Client implementers (Trajectory Mobile, Trajectory Action Tester, custom workflow clients) and container maintainers

---

## 1. Overview

The Trajectory REST protocol is the public HTTP interface that workflow clients use to discover actions, invoke instances, observe state, and send state-machine commands. It is the runtime contract between any Trajectory-compatible orchestrator and the Action Container.

| Property                | Value                                                                                                             |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Base URL                | `http://<host>:<port>/trajectory/v1`                                                                              |
| Default port            | `3001` (override with `PORT` env var)                                                                             |
| Mount                   | `packages/server/src/index.ts` mounts protocol + commands routers under this prefix                               |
| Authentication          | Optional API key (see §1.1)                                                                                       |
| CORS                    | `origin: '*'`, methods `GET, POST, PUT, DELETE, OPTIONS`, allowed headers include `X-API-Key` and `Last-Event-ID` |
| Content type (request)  | `application/json` for body endpoints                                                                             |
| Content type (response) | `application/json` for data endpoints, `text/event-stream` for SSE                                                |
| Endpoint count          | 11                                                                                                                |

### 1.1 Authentication

API-key authentication is conditional and middleware-driven:

- If the `api_key` setting is **unset** in the settings table → all requests pass through (open access).
- If `api_key` is **set** → requests must include header `X-API-Key: <value>`. Mismatch or missing header returns `401 UNAUTHORIZED`.

The middleware is applied only to `/trajectory/v1/*`; the management API at `/management/v1/*` is intentionally unauthenticated in v1. See `packages/server/src/middleware/auth.ts`.

---

## 2. Architecture notes

Request flow through the Express stack:

```
HTTP request
  ↓
cors (allow *, expose X-API-Key, Last-Event-ID)
  ↓
morgan (request logging)
  ↓
express.json (body parsing)
  ↓
createApiKeyAuth(settingsRepo)         ← only on /trajectory/v1
  ↓
protocol router  | commands router     ← created by factories in routes/
  ↓
handler:
  - validateBody(req.body, schema)     ← strict, rejects unknown fields
  - actionRepo / instanceRepo lookup   ← @trajectory/storage
  - manager.invoke / sendCommand / ... ← @trajectory/engine
  - sseManager.publish*                ← in-process per-instance event bus
  ↓
errorHandler (4-arg)                   ← maps EngineError + storage errors → HTTP
```

Key collaborators:

- **`InstanceManager`** (`@trajectory/engine`) — owns instance lifecycle, the Python sidecar pool, and state-machine transitions. Emits `onStateChange`, `onTerminal`, `onError` callbacks that the server forwards to `SseManager`.
- **Repositories** (`@trajectory/storage`) — `ActionRepository`, `InstanceRepository`, `SettingsRepository`. The server holds standalone references in addition to those owned by `InstanceManager`.
- **`SseManager`** (`packages/server/src/sse-manager.ts`) — per-instance event bus with a 256-event ring buffer, 30-second heartbeats, and a 7-second linger after terminal states for late subscribers.
- **`validateBody`** (`packages/server/src/validation.ts`) — single source of body validation for protocol handlers. Rejects unknown fields, enforces required fields, checks primitive types.

---

## 3. Conventions

### 3.1 Response envelopes

**Success** — every JSON response carries `data` and `meta`:

```ts
interface SuccessEnvelope<T> {
  data: T
  meta: Record<string, unknown> // {} when empty; { total } on lists; etc.
}
```

**Error** — `errorHandler` and inline error returns share one shape:

```ts
interface ErrorEnvelope {
  error: {
    code: string // machine-readable, UPPER_SNAKE
    message: string
    details: Record<string, unknown> // {} unless the code documents extras
  }
}
```

### 3.2 HTTP status codes used

| Code | When                                                                   |
| ---- | ---------------------------------------------------------------------- |
| 200  | Successful read or accepted command                                    |
| 201  | Instance created via `POST /actions/:oid/invoke`                       |
| 400  | Body shape invalid (`VALIDATION_ERROR`, `PARAMETER_VALIDATION_FAILED`) |
| 401  | API key required and missing/wrong                                     |
| 404  | Action or instance not found                                           |
| 409  | Invalid state-machine transition (`INVALID_STATE_TRANSITION`)          |
| 422  | Body well-formed but command name unknown (`INVALID_COMMAND`)          |
| 500  | Sidecar/execution failure or unexpected error                          |

### 3.3 Error code catalog (this interface)

| Code                          | Status | Source                     | Notes                                                                                |
| ----------------------------- | ------ | -------------------------- | ------------------------------------------------------------------------------------ |
| `VALIDATION_ERROR`            | 400    | `validateBody`, storage    | Body shape rejected; `message` names the field                                       |
| `UNAUTHORIZED`                | 401    | auth middleware            | Only when `api_key` setting is configured                                            |
| `ACTION_NOT_FOUND`            | 404    | engine                     | Invoked action OID not in storage                                                    |
| `INSTANCE_NOT_FOUND`          | 404    | engine, handlers           | Instance lookup miss                                                                 |
| `INVALID_STATE_TRANSITION`    | 409    | engine                     | `details` carries `current_state`, `command`                                         |
| `INVALID_COMMAND`             | 422    | commands router            | `details.command` echoes the rejected value                                          |
| `PARAMETER_VALIDATION_FAILED` | 400    | engine                     | Inputs failed action-spec validation                                                 |
| `EXECUTION_ERROR`             | 500    | engine                     | Sidecar crash or runtime error                                                       |
| `INTERNAL_ERROR`              | 500    | fallback in `errorHandler` | Unhandled exception                                                                  |
| `PROPERTY_NOT_FOUND`          | 404    | properties handler         | Property name does not match any spec in scope                                       |
| `AMBIGUOUS_PROPERTY`          | 409    | properties handler         | Name matches multiple environments; client must supply `environment_oid` query param |
| `PROPERTY_WRITE_ERROR`        | 500    | engine / sidecar           | `set_property` rejected by sandbox (unknown spec, type mismatch)                     |

### 3.4 Identifiers and timestamps

- **OIDs** (`action_oid`, `environment_oid`, `step_oid`) are immutable snowflake strings authored upstream in Trajectory MD; the container never generates or mutates them.
- **`runtime_action_instance_id`** is generated by the engine when an instance is created and returned as `instance_id` in responses.
- All timestamps in responses are ISO 8601 strings in UTC (e.g., `"2026-05-18T14:23:01.456Z"`).

### 3.5 Strict body validation

`validateBody` enforces three rules and short-circuits on the first failure:

1. Body must be a JSON object (not array, not null).
2. Any key not in the schema → `VALIDATION_ERROR` "Unknown field: …".
3. Missing required fields or wrong types → `VALIDATION_ERROR` with the offending field name.

Type checks are primitive only: `string`, `number`, `array`, `object`. Nested validation is the handler's responsibility.

---

## 4. Endpoint reference

### 4.1 Health and capability

#### `GET /health`

Liveness probe. Returns server status and Python pool state. No auth bypass — still subject to API-key check.

**Response 200:**

```ts
interface HealthResponse {
  data: {
    status: 'ok'
    timestamp: string // ISO 8601
    pool: {
      size: number
      idle: number
      busy: number
      queued: number
    }
  }
  meta: Record<string, never>
}
```

```json
{
  "data": {
    "status": "ok",
    "timestamp": "2026-05-18T14:23:01.456Z",
    "pool": { "size": 4, "idle": 3, "busy": 1, "queued": 0 }
  },
  "meta": {}
}
```

---

#### `GET /capabilities`

Lists all environments and the actions within each environment. Results are grouped by environment so clients can associate actions with their lifecycle state and action-level properties in one call. The container normalizes three heterogeneous parameter-spec shapes inherited from Trajectory MD into a single canonical wire form.

**Response 200:**

```ts
interface CapabilitiesResponse {
  data: {
    environments: EnvironmentCapability[]
  }
  meta: {
    total_environments: number
    total_actions: number
  }
}

interface EnvironmentCapability {
  environment_oid: string
  environment_name: string
  environment_state: LifecycleState
  action_properties: ActionPropertySpec[]
  actions: ActionCapability[]
}

interface ActionPropertySpec {
  name: string
  oid?: string
  description?: string
  entries: Array<{ name: string; value: string }>
}

interface ActionCapability {
  action_oid: string
  action_name: string
  action_state: LifecycleState
  visibility: 'observable' | 'opaque'
  input_parameters: ParameterSpec[]
  output_parameters: ParameterSpec[]
  supported_commands: SupportedCommand[]
}

type LifecycleState =
  | 'Draft'
  | 'InTest'
  | 'InReview'
  | 'Approved'
  | 'Effective'
  | 'Superseded'
  | 'Obsolete'
type SupportedCommand = 'PAUSE' | 'RESUME' | 'HOLD' | 'UNHOLD' | 'ABORT' | 'STOP' | 'CLEAR'
```

```json
{
  "data": {
    "environments": [
      {
        "environment_oid": "env-1",
        "environment_name": "Warehouse Cell A",
        "environment_state": "Effective",
        "action_properties": [
          {
            "name": "conveyor_speed",
            "oid": "prop-cs-01",
            "description": "Current conveyor belt speed (mm/s)",
            "entries": [{ "name": "value", "value": "450" }]
          }
        ],
        "actions": [
          {
            "action_oid": "act-abc",
            "action_name": "PickAndPlace",
            "action_state": "Effective",
            "visibility": "observable",
            "input_parameters": [
              { "name": "source", "description": "Source bin ID", "default_value": "A1" },
              { "name": "destination", "default_value": "B2" }
            ],
            "output_parameters": [{ "name": "duration_ms" }],
            "supported_commands": ["PAUSE", "RESUME", "HOLD", "UNHOLD", "ABORT", "STOP", "CLEAR"]
          }
        ]
      }
    ]
  },
  "meta": { "total_environments": 1, "total_actions": 1 }
}
```

---

### 4.2 Action invocation

#### `POST /actions/:action_oid/invoke`

Create and start an action instance. Returns the new `instance_id` immediately; observe lifecycle via `GET /instances/:id` or the SSE stream.

**Path:** `action_oid` — OID of the action to invoke.

**Request body:**

```ts
interface InvokeRequest {
  environment_oid: string // required
  workflow_instance_id: string // required
  step_instance_id: string // required
  step_oid: string // required
  input_parameters: Array<{ name: string; value: string }> // required
  timeout_ms?: number // optional override
  action_property_overrides?: Record<string, Record<string, string>> // test/dev affordance
}
```

```json
{
  "environment_oid": "env-1",
  "workflow_instance_id": "wf-001",
  "step_instance_id": "step-001",
  "step_oid": "step-pick",
  "input_parameters": [
    { "name": "source", "value": "A1" },
    { "name": "destination", "value": "B2" }
  ]
}
```

**Response 201:**

```ts
interface InvokeResponse {
  data: { instance_id: string }
  meta: Record<string, never>
}
```

```json
{ "data": { "instance_id": "ai-9k2x" }, "meta": {} }
```

**Errors:** `VALIDATION_ERROR` (400), `ACTION_NOT_FOUND` (404), `PARAMETER_VALIDATION_FAILED` (400), `EXECUTION_ERROR` (500).

---

### 4.3 Instance read

#### `GET /instances/:id`

Read a single instance's current state, history checkpoints, and parameter values.

**Path:** `id` — the `runtime_action_instance_id`.

**Response 200:**

```ts
interface InstanceResponse {
  data: {
    instance_id: string
    action_oid: string
    environment_oid: string
    workflow_instance_id: string
    step_instance_id: string
    step_oid: string
    visibility: 'opaque' | 'observable'
    state: {
      current: string // ISA-88 state name
      previous: string | null
      entered_at: string // ISO 8601
    }
    inputs: Array<{ name: string; value: string }>
    outputs: Array<{ name: string; value: string }>
    created_at: string
    started_at: string | null
    completed_at: string | null
    error: string | null
  }
  meta: Record<string, never>
}
```

**Errors:** `INSTANCE_NOT_FOUND` (404).

---

#### `GET /instances`

List instances with optional filtering. Filters are evaluated in this precedence order:

1. `workflow_instance_id` — return all instances for the workflow (then secondary-filter by `action_oid` if both are present).
2. `action_oid` (alone) — return all instances of that action.
3. `status=active` — return only currently-running instances.
4. `status=<other>` — return instances matching that final status.
5. No filter — return the 100 most recent instances.

**Query parameters:**

| Name                   | Type   | Notes                                                |
| ---------------------- | ------ | ---------------------------------------------------- |
| `workflow_instance_id` | string | Highest-priority filter                              |
| `action_oid`           | string | Standalone or as secondary to `workflow_instance_id` |
| `status`               | string | `active` or one of the storage's status values       |

**Response 200:**

```ts
interface InstanceListResponse {
  data: InstanceResponse['data'][] // same shape as single read
  meta: { total: number }
}
```

---

#### `DELETE /instances/:id`

Cancel an instance. Idempotent on terminal instances (the engine decides what is honored).

**Response 200:**

```ts
interface CancelResponse {
  data: { instance_id: string; cancelled: true }
  meta: Record<string, never>
}
```

**Errors:** `INSTANCE_NOT_FOUND` (404), `EXECUTION_ERROR` (500).

---

### 4.4 State-machine commands

#### `POST /instances/:id/command`

Send an ISA-88 state-machine command to a running instance.

**Path:** `id` — instance id.

**Request body:**

```ts
interface CommandRequest {
  command: 'PAUSE' | 'RESUME' | 'HOLD' | 'UNHOLD' | 'ABORT' | 'STOP' | 'CLEAR'
}
```

```json
{ "command": "PAUSE" }
```

**Response 200:**

```ts
interface CommandResponse {
  data: { instance_id: string; command: string; accepted: true }
  meta: Record<string, never>
}
```

**Errors:**

- `VALIDATION_ERROR` (400) — body shape wrong.
- `INVALID_COMMAND` (422) — command not in the allowed set; `details.command` echoes the rejected value.
- `INSTANCE_NOT_FOUND` (404).
- `INVALID_STATE_TRANSITION` (409) — current state does not allow the command; `details` includes `current_state` and `command`.

---

#### `GET /instances/:id/events`

Subscribe to a Server-Sent Events stream of lifecycle events for one instance. See §5 for the SSE protocol details.

**Response (success):** `200 OK`, `Content-Type: text/event-stream`. Body is the stream of events described in §5.

**Errors:** `INSTANCE_NOT_FOUND` (404) is returned as JSON before headers flush.

---

### 4.5 Properties

Action properties are environment-level named records mutated by action code at runtime via `set_property`. They represent shared state that persists across action instances within an environment (e.g., a sensor calibration offset updated by one action and consumed by another). Clients can enumerate current property values and subscribe to live changes without polling.

#### `GET /properties`

List all action properties across all environments, grouped by environment.

**Response 200:**

```ts
interface PropertiesListResponse {
  data: {
    environments: Array<{
      environment_oid: string
      environment_name: string
      properties: Array<{
        name: string
        oid?: string
        description?: string
        entries: Array<{ name: string; value: string }>
      }>
    }>
  }
  meta: { total_environments: number; total_properties: number }
}
```

```json
{
  "data": {
    "environments": [
      {
        "environment_oid": "env-1",
        "environment_name": "Warehouse Cell A",
        "properties": [
          {
            "name": "conveyor_speed",
            "oid": "prop-cs-01",
            "description": "Current conveyor belt speed (mm/s)",
            "entries": [{ "name": "value", "value": "450" }]
          }
        ]
      }
    ]
  },
  "meta": { "total_environments": 1, "total_properties": 1 }
}
```

---

#### `GET /properties/:id`

Read a single property by its outer name. If the same property name appears in multiple environments, the request is ambiguous and returns 409 unless the client supplies `?environment_oid=` to disambiguate.

**Path:** `id` — the property name (e.g., `conveyor_speed`).

**Query parameters:**

| Name              | Type   | Notes                                                      |
| ----------------- | ------ | ---------------------------------------------------------- |
| `environment_oid` | string | Required when the name exists in more than one environment |

**Response 200:**

```ts
interface PropertyResponse {
  data: {
    name: string
    oid?: string
    description?: string
    environment_oid: string
    environment_name: string
    entries: Array<{ name: string; value: string }>
  }
  meta: Record<string, never>
}
```

```json
{
  "data": {
    "name": "conveyor_speed",
    "oid": "prop-cs-01",
    "description": "Current conveyor belt speed (mm/s)",
    "environment_oid": "env-1",
    "environment_name": "Warehouse Cell A",
    "entries": [{ "name": "value", "value": "450" }]
  },
  "meta": {}
}
```

**Errors:**

- `PROPERTY_NOT_FOUND` (404) — no property with that name exists in any in-scope environment.
- `AMBIGUOUS_PROPERTY` (409) — name matches properties in multiple environments; client must add `?environment_oid=<oid>`.

---

#### `GET /properties/:id/events`

Subscribe to a Server-Sent Events stream of `property` events for the named property. Emits one event each time action code calls `set_property` for this property. See §5 for SSE connection and wire-format details.

**Path:** `id` — the property name.

**Query parameters:**

| Name              | Type   | Notes                                                      |
| ----------------- | ------ | ---------------------------------------------------------- |
| `environment_oid` | string | Required when the name exists in more than one environment |

**Response (success):** `200 OK`, `Content-Type: text/event-stream`. Body is a stream of `property` events (see §5.4).

**Errors:**

- `PROPERTY_NOT_FOUND` (404) — returned as JSON before headers flush.
- `AMBIGUOUS_PROPERTY` (409) — returned as JSON before headers flush.

---

## 5. SSE streaming

### 5.1 Connection

Open with a standard `EventSource` or any HTTP/1.1 client that holds the connection open. Response headers:

```
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
X-Accel-Buffering: no
```

### 5.2 Reconnection with `Last-Event-ID`

On reconnect, the client may send `Last-Event-ID: <integer>`. The server replays every buffered event with `id > Last-Event-ID` before subscribing the client to live events. The ring buffer holds the **last 256 events per instance**; events older than that are dropped silently.

If the instance has already reached a terminal state more than 7 seconds before reconnect, its bus is gone and no replay occurs (the bus is destroyed `TERMINAL_LINGER_MS = 7_000` after the terminal event).

### 5.3 Event wire format

Each event uses the standard SSE framing:

```
event: <type>
id: <integer>
data: <JSON>

```

(Blank line terminates the event.) Event ids are monotonically increasing per instance starting at 0.

### 5.4 Event types

```ts
type SseEventType = 'state_change' | 'output' | 'log' | 'heartbeat' | 'property'
```

#### `state_change`

Emitted on every state-machine transition.

```json
{
  "instance_id": "ai-9k2x",
  "state": "RUNNING",
  "previous_state": "IDLE",
  "timestamp": "2026-05-18T14:23:01.456Z"
}
```

#### `output`

Emitted alongside `state_change` whenever the instance's accumulated `output_parameters` is non-empty.

```json
{
  "instance_id": "ai-9k2x",
  "outputs": [{ "name": "duration_ms", "value": "1240" }],
  "timestamp": "2026-05-18T14:23:01.456Z"
}
```

#### `log`

Emitted for runtime errors surfaced by the engine.

```json
{
  "instance_id": "ai-9k2x",
  "stream": "stderr",
  "message": "Traceback (most recent call last): ...",
  "timestamp": "2026-05-18T14:23:01.456Z"
}
```

#### `heartbeat`

Emitted every 30 seconds while the instance is non-terminal. Stops at terminal state.

```json
{ "timestamp": "2026-05-18T14:23:31.456Z" }
```

#### `property`

Emitted on the `GET /properties/:id/events` SSE stream whenever action code calls `set_property` for the subscribed property. Not emitted on instance event streams.

```ts
interface PropertyEvent {
  type: 'property'
  id: number
  data: {
    environment_oid: string
    property_name: string
    entries: Array<{ name: string; value: string }>
    changed_entries: string[]
    source: 'action_code'
    source_action_oid?: string
    source_instance_id?: string
    timestamp: string
  }
}
```

```json
{
  "environment_oid": "env-1",
  "property_name": "conveyor_speed",
  "entries": [{ "name": "value", "value": "520" }],
  "changed_entries": ["value"],
  "source": "action_code",
  "source_action_oid": "act-abc",
  "source_instance_id": "ai-9k2x",
  "timestamp": "2026-05-18T14:23:05.123Z"
}
```

### 5.5 Terminal handling

When the engine reports a terminal state:

1. A final `state_change` (and `output` if applicable) is published.
2. The heartbeat timer is cleared.
3. The bus is destroyed after a 7-second linger so late `Last-Event-ID` replays still succeed.

---

## 6. Appendix — Endpoint summary table

| Method | Path                          | Purpose                    | Auth      | Success |
| ------ | ----------------------------- | -------------------------- | --------- | ------- |
| GET    | `/health`                     | Liveness + pool status     | API key\* | 200     |
| GET    | `/capabilities`               | Action catalog             | API key\* | 200     |
| POST   | `/actions/:action_oid/invoke` | Create and start instance  | API key\* | 201     |
| GET    | `/instances/:id`              | Read instance              | API key\* | 200     |
| GET    | `/instances`                  | List instances (filtered)  | API key\* | 200     |
| DELETE | `/instances/:id`              | Cancel instance            | API key\* | 200     |
| POST   | `/instances/:id/command`      | Send state-machine command | API key\* | 200     |
| GET    | `/instances/:id/events`       | SSE event stream           | API key\* | 200     |
| GET    | `/properties`                 | List all properties        | API key\* | 200     |
| GET    | `/properties/:id`             | Read single property       | API key\* | 200     |
| GET    | `/properties/:id/events`      | SSE stream for a property  | API key\* | 200     |

\*API key required only when the `api_key` setting is configured.
