# Management API — As-Built Specification

**Document type:** Reference + brief architecture notes
**Source of truth:** Implementation in `packages/server/src/` as of 2026-05-18
**Audience:** Console implementers (the React SPA in `apps/console`) and container maintainers

---

## 1. Overview

The Management API is the HTTP backend for the browser-based management console. It exposes everything needed to upload packages, browse environments and actions, edit and version Python code, monitor and command running instances, query the rolling execution log, manage settings, and import/export portable artifacts.

| Property                | Value                                                                                                                  |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Base URL                | `http://<host>:<port>/management/v1`                                                                                   |
| Default port            | `3001` (override with `PORT` env var)                                                                                  |
| Mount                   | `packages/server/src/index.ts` mounts `createManagementRouter(...)` under this prefix                                  |
| Authentication          | **None in v1** — the management router does not sit behind any auth middleware                                         |
| CORS                    | `origin: '*'`, methods `GET, POST, PUT, DELETE, OPTIONS`                                                               |
| Content type (request)  | `application/json` for body endpoints; `multipart/form-data` for `/upload`, `/actions/:oid/import`, `/snapshot/import` |
| Content type (response) | `application/json` for data endpoints; `application/zip` for export endpoints                                          |
| Endpoint count          | 25 (including the 4 export/import endpoints from the sub-router)                                                       |

### 1.1 Authentication posture

The router is mounted directly on `/management/v1` with no auth middleware. The API-key middleware that protects `/trajectory/v1` does **not** apply here. v2 will add API-key/OAuth2 auth per `PROJECT.md` "Out of Scope".

---

## 2. Architecture notes

Request flow through the Express stack:

```
HTTP request
  ↓
cors (allow *)
  ↓
morgan (request logging)
  ↓
express.json (body parsing)
  ↓
management router  (createManagementRouter factory)
  ↓
  export/import sub-router  (mounted first via router.use())
  ↓
handler:
  - validateBody(req.body, schema)                   ← strict for body endpoints
    OR ad-hoc field validation                       ← used by /upload, /code, /test
  - multer.memoryStorage                             ← only for upload/import endpoints
  - repositories: env, action, codeVersion,          ← @trajectory/storage
    instance, log, settings
  - txHelper.transaction(() => { ... })              ← multi-write atomicity
  - manager.poolStatus / testCode / sendCommand /    ← @trajectory/engine
    resizePool
  ↓
errorHandler (4-arg)                                 ← maps EngineError + storage errors
```

Key collaborators:

- **`InstanceManager`** (`@trajectory/engine`) — used for `poolStatus`, `getInstance`, `sendCommand`, `testCode`, and `resizePool` (called on `python_pool_size` setting change).
- **Repositories** (`@trajectory/storage`) — the management router takes seven repositories: `EnvironmentRepository`, `ActionRepository`, `CodeVersionRepository`, `InstanceRepository`, `LogRepository`, `SettingsRepository`, plus the raw `better-sqlite3` `Database` handle for ad-hoc queries on the instance-monitoring endpoints.
- **`txHelper.transaction`** (`@trajectory/storage`) — wraps multi-write operations (`/upload`, `/environments/:oid` delete, `/snapshot/import`, `/actions/:oid/import`) so they are all-or-nothing.
- **`multer.memoryStorage`** — file uploads stay in memory. `/upload` caps files at 10 MB each; `/snapshot/import` and `/actions/:oid/import` cap at 50 MB.
- **`JSZip`** — used to parse and emit ZIP archives for `.WFenvirX`, `.WFactionCodeX`, `.WFactionCode`, and `.WFsnapshot` formats.
- **`validateBody`** — applied to `/instances/:id/command` and `/settings/:key`. Other body endpoints (`/upload`, code save, code test, action timeout) use ad-hoc inline validation because their bodies are non-uniform (multipart, optional source code, etc.).
- **Python version cache** — captured once at first factory call via `python --version`, exposed in `/dashboard`.

### 2.1 Route-ordering caveats

Two endpoint groups mix literal and parameterized segments. Express matches in registration order, so the literal routes are registered **before** the parameterized ones:

- `/code/:action_oid/:state/active` and `/code/:action_oid/:state/test` are registered before `/code/:action_oid/:state/:version_id` and `/code/:action_oid/:state/:version_id/activate`.
- `/instances/active` and `/instances/history` are registered before `/instances/:id`.

If you add new endpoints under these prefixes, preserve the literal-first ordering.

---

## 3. Conventions

### 3.1 Response envelopes

**Success** — every JSON response carries `data` and `meta`:

```ts
interface SuccessEnvelope<T> {
  data: T
  meta: Record<string, unknown> // {}; pagination keys; { total }
}
```

**Error** — same shape as the Trajectory protocol:

```ts
interface ErrorEnvelope {
  error: {
    code: string // UPPER_SNAKE
    message: string
    details?: Record<string, unknown>
  }
}
```

### 3.2 HTTP status codes used

| Code | When                                                                    |
| ---- | ----------------------------------------------------------------------- |
| 200  | Successful read, update, or accepted command                            |
| 201  | New code version saved via `POST /code/:action_oid/:state`              |
| 400  | Bad input — body shape, unknown field, missing required, malformed file |
| 404  | Resource not found (env, action, instance, code version, log entry)     |
| 409  | Conflict — active instance blocks delete, version pinned, etc.          |
| 422  | Unknown command name (`INVALID_COMMAND`)                                |
| 500  | Unexpected error or sidecar failure                                     |

### 3.3 Error code catalog (this interface)

| Code                       | Status | Notes                                                     |
| -------------------------- | ------ | --------------------------------------------------------- |
| `VALIDATION_ERROR`         | 400    | Body shape, missing field, wrong type, bad file extension |
| `NOT_FOUND`                | 404    | Resource lookup miss                                      |
| `ACTION_NOT_FOUND`         | 404    | Used by `DELETE /code/:action_oid/:state`                 |
| `CONFLICT`                 | 409    | Delete blocked by active instance or pinned code version  |
| `INVALID_COMMAND`          | 422    | Command name not in allowed set                           |
| `INVALID_STATE_TRANSITION` | 409    | From engine; `details` carries `current_state`, `command` |
| `INTERNAL_ERROR`           | 500    | Fallback in `errorHandler`                                |

### 3.4 Pagination

List endpoints that support pagination (`/instances/history`, `/log`) accept these query params and return these meta fields:

| Query param | Default | Cap | Description                         |
| ----------- | ------- | --- | ----------------------------------- |
| `page`      | 1       | —   | 1-based page number; floored to ≥ 1 |
| `page_size` | 50      | 200 | Items per page; clamped to [1, 200] |

```ts
interface PaginationMeta {
  page: number
  page_size: number
  total: number // /instances/history uses 'total'
  total_entries?: number // /log uses 'total_entries'
  total_pages: number
}
```

### 3.5 Identifiers and timestamps

- **OIDs** are the upstream-authored snowflake identifiers preserved verbatim.
- **`runtime_action_instance_id`** is engine-generated.
- **Code version `id`** is a storage-generated identifier (string).
- All timestamps are ISO 8601 strings in UTC.

---

## 4. Endpoint reference

### 4.1 Dashboard

#### `GET /dashboard`

Aggregated container health snapshot for the console's landing view.

**Query parameters:**

| Name    | Type    | Default | Cap | Description                           |
| ------- | ------- | ------- | --- | ------------------------------------- |
| `count` | integer | 10      | 100 | How many recent log entries to inline |

**Response 200:**

```ts
interface DashboardResponse {
  data: {
    container: {
      uptime_seconds: number
      started_at: string
      node_version: string
      python_version: string | null
      db_path: string
      db_size_bytes: number | null
      memory_rss_bytes: number
    }
    python_pool: { size: number; idle: number; busy: number; queued: number }
    environments: { total_count: number; total_actions: number }
    instances: { active_count: number; completed_today: number; aborted_today: number }
    log: { total_entries: number; max_entries: number; oldest_entry_at: string | null }
    recent_log_entries: Array<{
      id: number
      runtime_action_instance_id: string
      action_name: string
      environment_name: string
      started_at: string | null
      completed_at: string | null
      duration_ms: number | null
      final_status: 'COMPLETED' | 'ABORTED' | 'FAILED' | string
      error: string | null
    }>
  }
  meta: Record<string, never>
}
```

`completed_today` and `aborted_today` are counted against UTC midnight.

---

### 4.2 Upload

#### `POST /upload`

Upload one or more environment/action packages. Accepts `.WFenvir`, `.WFenvirX`, `.WFaction`, `.WFactionCodeX`. All files are parsed first (fail-fast); DB writes happen in a single transaction.

**Request:** `multipart/form-data` with field name `files` (one or more).

| Extension        | Body type                             | Effect                                                         |
| ---------------- | ------------------------------------- | -------------------------------------------------------------- |
| `.WFenvir`       | JSON library file                     | Upserts environment + included actions; orphan actions removed |
| `.WFenvirX`      | ZIP wrapping `.WFenvir`               | Same as `.WFenvir`                                             |
| `.WFaction`      | JSON action file                      | Upserts a single action                                        |
| `.WFactionCodeX` | ZIP: `*.WFaction` + `code/<state>.py` | Upserts action and saves+activates code per state              |

File-size cap: **10 MB** each.

**Response 200:**

```ts
interface UploadResponse {
  data: {
    imported: Array<{
      type: 'environment' | 'action'
      oid: string
      local_id: string
      version: string
      actions_count?: number // present for environment type
      status: 'created' | 'updated'
    }>
    diff: {
      added: string[] // local_ids of new actions
      removed: string[] // local_ids of orphaned actions
      modified: string[] // local_ids whose version changed
    }
  }
  meta: Record<string, never>
}
```

**Errors:** `VALIDATION_ERROR` (400) for: no files, bad extension, malformed JSON, malformed ZIP, missing required fields, missing inner `.WFaction` in a `.WFactionCodeX`, missing inner `.WFenvir` in a `.WFenvirX`, unsupported `schemaVersion` (< 3.0).

---

### 4.3 Environments

#### `GET /environments`

List all environments enriched with `action_count`.

**Response 200:**

```ts
interface EnvironmentListResponse {
  data: Array<Environment & { action_count: number }>
  meta: { total: number }
}
```

---

#### `GET /environments/:oid`

Read one environment plus a summary of each of its actions.

**Response 200:**

```ts
interface EnvironmentDetailResponse {
  data: Environment & {
    actions: Array<{
      oid: string
      local_id: string
      version: string
      action_visibility: 'opaque' | 'observable'
      input_param_count: number
      output_param_count: number
      states_with_code: string[]
    }>
  }
  meta: Record<string, never>
}
```

**Errors:** `NOT_FOUND` (404).

---

#### `DELETE /environments/:oid`

Delete an environment and cascade through its actions, code versions, and terminal instance records. Refuses if any instance for any action under this environment is non-terminal.

**Response 200:**

```ts
interface EnvironmentDeleteResponse {
  data: {
    deleted: true
    environment_oid: string
    actions_removed: number
    code_versions_removed: number
    instances_removed: number
  }
  meta: Record<string, never>
}
```

**Errors:** `NOT_FOUND` (404), `CONFLICT` (409, message "Cannot delete environment with active instances").

---

### 4.4 Actions

#### `GET /actions/:oid`

Read one action enriched with environment name and a code summary.

**Response 200:**

```ts
interface ActionDetailResponse {
  data: Action & {
    environment_name: string
    code_summary: {
      states_with_code: string[]
      total_versions: number
      last_code_update: string | null
    }
  }
  meta: Record<string, never>
}
```

**Errors:** `NOT_FOUND` (404).

---

#### `PUT /actions/:oid/timeout`

Set the per-action execution timeout.

**Request body:**

```ts
interface ActionTimeoutRequest {
  timeout_seconds: number | null // null = use global default; 0 = disabled; positive int = seconds
}
```

```json
{ "timeout_seconds": 60 }
```

**Response 200:**

```ts
interface ActionTimeoutResponse {
  data: { oid: string; timeout_seconds: number | null }
}
```

**Errors:** `NOT_FOUND` (404), `VALIDATION_ERROR` (400).

---

### 4.5 Code management

The seven code endpoints operate on the (action_oid, state) tuple. A "state" is an ISA-88 state name like `RUNNING` or `HOLDING`.

#### `GET /code/:action_oid/:state`

List metadata for every code version saved against this action+state. Does **not** include `source_code`; use `/active` or `/:version_id` to read source.

**Response 200:**

```ts
interface CodeVersionListResponse {
  data: {
    action_oid: string
    state: string
    versions: Array<{
      id: string
      version_number: number
      is_active: boolean
      created_at: string
      created_by: string | null
      description: string | null
      code_size: number // bytes of source_code
    }>
  }
  meta: Record<string, never>
}
```

**Errors:** `NOT_FOUND` (404) if action does not exist.

---

#### `GET /code/:action_oid/:state/active`

Read the currently-active version including `source_code`.

**Response 200:**

```ts
interface CodeVersionResponse {
  data: {
    id: string
    action_oid: string
    state: string
    version_number: number
    is_active: boolean
    source_code: string
    created_at: string
    created_by: string | null
    description: string | null
  }
  meta: Record<string, never>
}
```

**Errors:** `NOT_FOUND` (404) — no active version for this action+state.

---

#### `GET /code/:action_oid/:state/:version_id`

Read a specific version by id. Validates that the version belongs to the (action_oid, state) tuple.

**Response 200:** same shape as `/active`.

**Errors:** `NOT_FOUND` (404).

---

#### `POST /code/:action_oid/:state`

Save a new code version. Saved versions are activated immediately (the existing active version becomes inactive but is retained for history).

**Request body:**

```ts
interface SaveCodeRequest {
  source_code: string // required
  description?: string | null // optional, free text
  created_by?: string | null // optional, attribution label
}
```

**Response 201:**

```ts
interface SaveCodeResponse {
  data: {
    id: string
    version_number: number
    is_active: true
    created_at: string
  }
  meta: Record<string, never>
}
```

**Errors:** `NOT_FOUND` (404) if action missing, `VALIDATION_ERROR` (400) for missing/non-string fields.

---

#### `POST /code/:action_oid/:state/:version_id/activate`

Mark a historical version as the active one. Atomic with respect to the existing active version.

**Response 200:**

```ts
interface ActivateCodeResponse {
  data: {
    id: string
    version_number: number
    is_active: true
    activated_at: string
  }
  meta: Record<string, never>
}
```

**Errors:** `NOT_FOUND` (404).

---

#### `DELETE /code/:action_oid/:state/:version_id`

Delete a single historical version. Refuses the active version and any version pinned by a still-running instance.

**Response 200:**

```ts
interface DeleteCodeVersionResponse {
  data: { deleted: true; id: string }
  meta: Record<string, never>
}
```

**Errors:** `NOT_FOUND` (404), `CONFLICT` (409, messages "Cannot delete the active version" or "Cannot delete version pinned by running instance").

---

#### `DELETE /code/:action_oid/:state`

Clear **all** versions for a state (active and history). Idempotent. Refuses if any version is pinned by a running instance.

**Response 200:**

```ts
interface ClearStateCodeResponse {
  data: { deleted_version_count: number }
  meta: Record<string, never>
}
```

**Errors:** `ACTION_NOT_FOUND` (404), `CONFLICT` (409).

---

#### `POST /code/:action_oid/:state/test`

Run a code snippet through the sidecar without persisting it. Has two modes:

- **Full execution** — request includes `source_code`; that snippet is run with the provided test inputs/props.
- **Syntax check** — `source_code` omitted; the currently active version's source is used.

**Request body:**

```ts
interface TestCodeRequest {
  source_code?: string // if omitted, uses active version
  test_inputs?: Record<string, string> // input parameter values
  test_props?: Record<string, unknown> // environment property values
  test_action_props?: Record<string, unknown> // action property values
  timeout_ms?: number
}
```

**Response 200:**

```ts
interface TestCodeResponse {
  data: {
    // shape returned verbatim by manager.testCode — see @trajectory/engine for canonical shape
    success: boolean
    outputs?: Array<{ name: string; value: string }>
    error?: string
    traceback?: string
    duration_ms?: number
    // additional fields per engine
  }
  meta: Record<string, never>
}
```

**Errors:** `NOT_FOUND` (404) if syntax-check mode and no active version exists, `VALIDATION_ERROR` (400) for non-string `source_code`.

---

### 4.6 Instance monitoring

#### `GET /instances/active`

List currently-running instances (`completed_at IS NULL`). No pagination — running set is bounded.

**Query parameters:**

| Name              | Type   | Notes                 |
| ----------------- | ------ | --------------------- |
| `environment_oid` | string | Filter by environment |
| `action_oid`      | string | Filter by action      |

**Response 200:**

```ts
interface ActiveInstanceListResponse {
  data: EnrichedInstance[]
  meta: { total: number }
}

interface EnrichedInstance {
  runtime_action_instance_id: string
  action_oid: string
  environment_oid: string
  workflow_instance_id: string
  step_instance_id: string
  step_oid: string
  visibility: 'opaque' | 'observable'
  state: string
  input_parameters: Array<{ name: string; value: string }>
  output_parameters: Array<{ name: string; value: string }>
  state_history: Array<{ state: string; timestamp: string }>
  pinned_code_versions: Array<{ state: string; code_version_id: string }>
  states_with_code_executed: string[]
  created_at: string
  started_at: string | null
  completed_at: string | null
  error: string | null
  traceback: string | null
  is_logged: boolean
  action_name: string // enriched
  environment_name: string // enriched
}
```

---

#### `GET /instances/history`

List terminal instances (`completed_at IS NOT NULL`) with pagination and sorting.

**Query parameters:**

| Name              | Type   | Default        | Cap | Notes                                                        |
| ----------------- | ------ | -------------- | --- | ------------------------------------------------------------ |
| `environment_oid` | string | —              | —   | Filter                                                       |
| `action_oid`      | string | —              | —   | Filter                                                       |
| `page`            | int    | 1              | —   | 1-based                                                      |
| `page_size`       | int    | 50             | 200 | Clamped to [1, 200]                                          |
| `sort`            | string | `completed_at` | —   | Allowed: `created_at`, `completed_at`, `state`, `action_oid` |
| `order`           | string | `desc`         | —   | `asc` or `desc`                                              |

Unknown `sort` values fall back to `completed_at`.

**Response 200:**

```ts
interface HistoryInstanceListResponse {
  data: EnrichedInstance[]
  meta: {
    total: number
    page: number
    page_size: number
    total_pages: number
  }
}
```

---

#### `GET /instances/:id`

Read one instance (storage row, not engine state) enriched with action and environment names.

**Response 200:**

```ts
interface InstanceDetailResponse {
  data: Instance & { action_name: string; environment_name: string }
  meta: Record<string, never>
}
```

**Errors:** `NOT_FOUND` (404).

---

#### `POST /instances/:id/command`

Send a state-machine command from the console. Identical command set and validation as the Trajectory protocol's command endpoint, with an additional optional `reason` field for audit purposes.

**Request body:**

```ts
interface ConsoleCommandRequest {
  command: 'PAUSE' | 'RESUME' | 'HOLD' | 'UNHOLD' | 'ABORT' | 'STOP' | 'CLEAR'
  reason?: string
}
```

**Response 200:**

```ts
interface ConsoleCommandResponse {
  data: { instance_id: string; command: string; accepted: true }
  meta: Record<string, never>
}
```

**Errors:** `VALIDATION_ERROR` (400), `INVALID_COMMAND` (422), `NOT_FOUND` (404), `INVALID_STATE_TRANSITION` (409).

---

### 4.7 Execution log

#### `GET /log`

Query the rolling execution log of terminal instance records.

**Query parameters:**

| Name              | Type   | Notes                                      |
| ----------------- | ------ | ------------------------------------------ |
| `action_name`     | string | Filter by `local_id`                       |
| `environment_oid` | string | Filter by environment                      |
| `status`          | string | One of `COMPLETED`, `ABORTED`, `FAILED`, … |
| `from`            | string | ISO 8601 — `completed_at >= from`          |
| `to`              | string | ISO 8601 — `completed_at <= to`            |
| `page`            | int    | Default 1                                  |
| `page_size`       | int    | Default 50, cap 200                        |

**Response 200:**

```ts
interface LogQueryResponse {
  data: LogEntry[]
  meta: {
    page: number
    page_size: number
    total_entries: number
    total_pages: number
    log_config: {
      max_entries: number
      current_entries: number
      oldest_entry_at: string | null
    }
  }
}

interface LogEntry {
  id: number
  runtime_action_instance_id: string
  action_name: string
  environment_name: string
  action_oid: string
  environment_oid: string
  started_at: string | null
  completed_at: string
  duration_ms: number | null
  final_status: 'COMPLETED' | 'ABORTED' | 'FAILED' | string
  error: string | null
  // …plus other fields persisted by LogRepository
}
```

---

#### `GET /log/:id`

Read one log entry by numeric id.

**Response 200:**

```ts
interface LogEntryResponse {
  data: LogEntry
  meta: Record<string, never>
}
```

**Errors:** `VALIDATION_ERROR` (400) if `id` is not a number, `NOT_FOUND` (404).

---

### 4.8 Settings

#### `GET /settings`

List all settings rows (key/value, plus any storage-layer metadata).

**Response 200:**

```ts
interface SettingsListResponse {
  data: Array<{
    key: string
    value: string
    // additional fields per SettingsRepository.getAll()
  }>
  meta: Record<string, never>
}
```

---

#### `PUT /settings/:key`

Update one setting's value. Has side effects for two known keys.

**Request body:**

```ts
interface SettingUpdateRequest {
  value: string
}
```

**Response 200:**

```ts
interface SettingUpdateResponse {
  data: {
    key: string
    value: string
    previous_value: string | null
    applied: true
  }
  meta: Record<string, never>
}
```

**Side effects by key:**

| Key                | Side effect                               |
| ------------------ | ----------------------------------------- |
| `python_pool_size` | Calls `manager.resizePool(Number(value))` |
| `log_max_size`     | Calls `logRepo.trimToSize(Number(value))` |

**Errors:** `VALIDATION_ERROR` (400), `NOT_FOUND` (404, from `SettingsRepository.update`).

---

### 4.9 Export / import

Provided by `createExportImportRouter`, mounted as a sub-router under `/management/v1`. All paths below are relative to `/management/v1`.

#### `GET /actions/:oid/export`

Download a single action as a `.WFactionCode` ZIP containing a manifest and one Python file per active state.

**Response 200:** `application/zip`, `Content-Disposition: attachment; filename="<local_id>.WFactionCode"`.

**ZIP contents:**

- `manifest.json` — action metadata + list of `code_files`
- `<state>.py` for each active code version

```ts
interface ActionExportManifest {
  format_version: '1.0'
  exported_at: string
  action: {
    oid: string
    local_id: string
    version: string
    action_visibility: 'opaque' | 'observable'
    description: string | null
    input_parameter_specifications: unknown[]
    output_parameter_specifications: unknown[]
    property_specifications: unknown[]
    timeout_seconds: number | null
  }
  code_files: Array<{ state: string; filename: string; description: string | null }>
}
```

**Errors:** `NOT_FOUND` (404).

---

#### `POST /actions/:oid/import`

Upload a `.WFactionCode` ZIP and apply its code files to an existing action. The manifest's `action.oid` must match the URL `:oid`. New code versions are saved and activated atomically.

**Request:** `multipart/form-data`, field name `file`. Cap: 50 MB.

**Response 200:**

```ts
interface ActionImportResponse {
  data: {
    action_oid: string
    imported_states: string[]
    skipped_states: string[] // states listed in manifest with no matching .py file
  }
  meta: Record<string, never>
}
```

**Errors:** `VALIDATION_ERROR` (400) — no file, missing manifest, OID mismatch. `NOT_FOUND` (404) — action does not exist.

---

#### `GET /snapshot/export`

Download a full container snapshot as a `.WFsnapshot` ZIP.

**Response 200:** `application/zip`, `Content-Disposition: attachment; filename="TrajectorySnapshot_<YYYY-MM-DD>.WFsnapshot"`.

**ZIP contents:**

- `manifest.json` — format version, container version, counts
- `settings.json` — `SettingsRepository.getAll()`
- `environments/<oid>.json` — environment in `.WFenvir` shape with `included_actions`
- `code/<action_oid>/<state>.py` — active source for every state

```ts
interface SnapshotManifest {
  format_version: '1.0'
  exported_at: string
  container_version: string // hard-coded '1.0.0' as of 2026-05-18
  environment_count: number
  action_count: number
  code_file_count: number
}
```

---

#### `POST /snapshot/import?confirm=true`

Replace all environments, actions, code, and settings with the contents of a `.WFsnapshot` ZIP. **Destructive.** Refuses without `?confirm=true`.

**Request:** `multipart/form-data`, field name `file`. Cap: 50 MB.

**Query:** `confirm=true` required.

**Behavior:**

1. Validate manifest `format_version === '1.0'`.
2. In one transaction: delete every existing environment (cascading to actions and code), then re-create from the snapshot, then re-apply settings (unknown keys silently skipped).

**Response 200:**

```ts
interface SnapshotImportResponse {
  data: {
    environments_imported: number
    actions_imported: number
    code_files_imported: number
    settings_imported: number
  }
  meta: Record<string, never>
}
```

**Errors:** `VALIDATION_ERROR` (400) — missing `?confirm=true`, no file, missing manifest, unsupported `format_version`, invalid/corrupted ZIP.

---

## 5. Multipart and ZIP transfer specifics

### 5.1 Multipart uploads

| Endpoint                    | Field name | Multiple? | File cap |
| --------------------------- | ---------- | --------- | -------- |
| `POST /upload`              | `files`    | yes       | 10 MB    |
| `POST /actions/:oid/import` | `file`     | no        | 50 MB    |
| `POST /snapshot/import`     | `file`     | no        | 50 MB    |

All uploads use `multer.memoryStorage` — files are buffered in memory, never written to disk.

### 5.2 Accepted file extensions for `/upload`

`.wfenvir`, `.wfenvirx`, `.wfaction`, `.wfactioncodex` (case-insensitive).

### 5.3 Schema version gating for environment libraries

`.WFenvir` / `.WFenvirX` library JSON may include `schemaVersion`. The rule is:

- Missing → defaulted to `"4.0"` (because real Trajectory MD env-library exports currently omit it).
- Present but not a string → `VALIDATION_ERROR`.
- Present and parseable as a number < 3.0 → `VALIDATION_ERROR` ("Unsupported schemaVersion").
- Otherwise accepted verbatim.

### 5.4 ZIP layouts at a glance

| Format           | Layout                                                                                         |
| ---------------- | ---------------------------------------------------------------------------------------------- |
| `.WFenvirX`      | One inner `*.WFenvir` or `*.WFenvirX` file (first match wins)                                  |
| `.WFactionCodeX` | One inner `*.WFaction` + `code/<state>.py` per state                                           |
| `.WFactionCode`  | `manifest.json` + `<state>.py` per active state                                                |
| `.WFsnapshot`    | `manifest.json` + `settings.json` + `environments/<oid>.json` + `code/<action_oid>/<state>.py` |

---

## 6. Appendix — Endpoint summary table

| Method | Path                                            | Purpose                              | Success |
| ------ | ----------------------------------------------- | ------------------------------------ | ------- |
| GET    | `/dashboard`                                    | Container health snapshot            | 200     |
| POST   | `/upload`                                       | Upload env/action packages           | 200     |
| GET    | `/environments`                                 | List environments                    | 200     |
| GET    | `/environments/:oid`                            | Read environment + action summaries  | 200     |
| DELETE | `/environments/:oid`                            | Delete env, cascade actions/code     | 200     |
| GET    | `/actions/:oid`                                 | Read action + code summary           | 200     |
| PUT    | `/actions/:oid/timeout`                         | Set per-action timeout               | 200     |
| GET    | `/code/:action_oid/:state`                      | List code-version metadata           | 200     |
| GET    | `/code/:action_oid/:state/active`               | Read active version (with source)    | 200     |
| GET    | `/code/:action_oid/:state/:version_id`          | Read specific version                | 200     |
| POST   | `/code/:action_oid/:state`                      | Save and activate new version        | 201     |
| POST   | `/code/:action_oid/:state/:version_id/activate` | Activate historical version          | 200     |
| DELETE | `/code/:action_oid/:state/:version_id`          | Delete single historical version     | 200     |
| DELETE | `/code/:action_oid/:state`                      | Clear all versions for state         | 200     |
| POST   | `/code/:action_oid/:state/test`                 | Run code in sidecar without saving   | 200     |
| GET    | `/instances/active`                             | List currently-running instances     | 200     |
| GET    | `/instances/history`                            | List terminal instances (paginated)  | 200     |
| GET    | `/instances/:id`                                | Read one instance (storage row)      | 200     |
| POST   | `/instances/:id/command`                        | Send command from console            | 200     |
| GET    | `/log`                                          | Query execution log                  | 200     |
| GET    | `/log/:id`                                      | Read one log entry                   | 200     |
| GET    | `/settings`                                     | List all settings                    | 200     |
| PUT    | `/settings/:key`                                | Update a setting (with side effects) | 200     |
| GET    | `/actions/:oid/export`                          | Download `.WFactionCode`             | 200     |
| POST   | `/actions/:oid/import`                          | Upload `.WFactionCode`               | 200     |
| GET    | `/snapshot/export`                              | Download `.WFsnapshot`               | 200     |
| POST   | `/snapshot/import?confirm=true`                 | Replace all data from snapshot       | 200     |
