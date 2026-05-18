# Phase 6: Management API - Research

**Researched:** 2026-02-27
**Domain:** Express 5 REST API — management endpoint surface over existing repository/engine layer
**Confidence:** HIGH

## Summary

Phase 6 adds the `/management/v1/` router to the existing Express 5 server. The entire storage
layer (all six repositories), InstanceManager, and error infrastructure already exist and are
battle-tested. This phase is primarily about wiring routes to repositories — there is very little
novel infrastructure to build.

The only genuinely new capability is multipart file upload parsing for `.WFenvir`/`.WFaction`
packages. Multer is the standard library for this in Express and must be installed. Everything
else reuses patterns already established in Phase 5 (factory router, `validateBody`, the
`errorHandler`, `{data, meta}` envelope, `{error: {code, message, details}}` errors).

The management router should be registered on the app with no auth middleware (open by decision).
It follows the same `createXxxRouter(repos...)` factory pattern already used for the protocol and
commands routers.

**Primary recommendation:** Create `createManagementRouter(db, manager, ...)` following the exact
factory pattern from `createProtocolRouter`, mount at `/management/v1`, install `multer` for
upload parsing, and reuse existing repositories and error classes throughout.

## Standard Stack

### Core (already installed)

| Library             | Version   | Purpose                     | Why Standard                           |
| ------------------- | --------- | --------------------------- | -------------------------------------- |
| express             | 5.2.1     | HTTP server/router          | Already in use                         |
| better-sqlite3      | 12.6.2    | SQLite access               | Already in use — all repos built on it |
| @trajectory/storage | workspace | All 6 repositories + types  | All repos already written              |
| @trajectory/engine  | workspace | InstanceManager, poolStatus | Already in use                         |

### New Addition Required

| Library       | Version | Purpose                     | Why Standard                               |
| ------------- | ------- | --------------------------- | ------------------------------------------ |
| multer        | 2.x     | Multipart form-data parsing | De-facto standard for Express file uploads |
| @types/multer | 2.x     | TypeScript types for multer | Matches package version                    |

### Supporting (already installed)

| Library   | Version | Purpose                      | When to Use                   |
| --------- | ------- | ---------------------------- | ----------------------------- |
| supertest | 7.2.2   | Integration test HTTP client | All management endpoint tests |
| vitest    | 4.x     | Test runner                  | All tests in this phase       |

### Alternatives Considered

| Instead of | Could Use                                                      | Tradeoff                                                 |
| ---------- | -------------------------------------------------------------- | -------------------------------------------------------- |
| multer     | busboy directly                                                | Lower level, more code, same capability                  |
| multer     | formidable (3.5.4 — already in node_modules as transitive dep) | Multer integrates better with Express middleware pattern |
| multer     | Node 20 built-in streams                                       | Too low-level for this use case                          |

**Installation:**

```bash
npm install multer --workspace=packages/server
npm install --save-dev @types/multer --workspace=packages/server
```

## Architecture Patterns

### Recommended Project Structure

```
packages/server/src/
├── routes/
│   ├── protocol.ts          # existing — /trajectory/v1/
│   ├── commands.ts          # existing — /trajectory/v1/ SSE/commands
│   └── management.ts        # NEW — /management/v1/
├── middleware/
│   ├── auth.ts              # existing
│   └── error-handler.ts     # existing — reused unchanged
├── validation.ts            # existing — reused for JSON bodies
└── index.ts                 # existing — add management router mount
```

### Pattern 1: Factory Router (matches existing codebase)

**What:** `createManagementRouter` receives repositories as injected dependencies and returns an
Express Router. Matches the exact pattern of `createProtocolRouter` and `createCommandsRouter`.

**When to use:** Always — this is the established pattern in this codebase.

**Example:**

```typescript
// Source: packages/server/src/routes/protocol.ts (existing pattern)
import { Router } from 'express'
import type { ActionRepository, EnvironmentRepository, ... } from '@trajectory/storage'
import type { InstanceManager } from '@trajectory/engine'

export function createManagementRouter(
  db: BetterSqlite3.Database,
  manager: InstanceManager,
  environmentRepo: EnvironmentRepository,
  actionRepo: ActionRepository,
  codeVersionRepo: CodeVersionRepository,
  instanceRepo: InstanceRepository,
  logRepo: LogRepository,
  settingsRepo: SettingsRepository
): Router {
  const router = Router()
  // ... endpoints
  return router
}
```

**Registration in index.ts (no auth middleware — open by decision):**

```typescript
import { createManagementRouter } from './routes/management.js'
// Add new repos to startup:
const environmentRepo = new EnvironmentRepository(db)
const codeVersionRepo = new CodeVersionRepository(db)
const logRepo = new LogRepository(db)
// No auth wrapper:
app.use(
  '/management/v1',
  createManagementRouter(
    db,
    manager,
    environmentRepo,
    actionRepo,
    codeVersionRepo,
    instanceRepo,
    logRepo,
    settingsRepo
  )
)
```

### Pattern 2: Response Envelope

**What:** The phase 5 decision locked the envelope shape `{data, meta}` for single resources and
`{data: [...], meta: {total}}` for collections. Review of ManagementAPISpec.md shows the spec
uses bare objects (no envelope). The CONTEXT.md decision section does NOT address management
response shape explicitly, but declares "Same structured error format as Trajectory protocol" for
errors. The Claude's Discretion section explicitly lists "Response envelope structure (bare array
vs {data, total, ...})" as open.

**Recommendation:** Use the same `{data, meta}` envelope as the protocol router for consistency
with the existing codebase. The planner should decide the envelope approach and apply it
consistently across all 18 endpoints.

**Example patterns:**

```typescript
// Single resource:
res.status(200).json({ data: environment, meta: {} })

// Collection:
res.status(200).json({ data: environments, meta: { total: environments.length } })

// Paginated collection:
res.status(200).json({
  data: entries,
  meta: { total, page, page_size, total_pages },
})
```

### Pattern 3: Multipart Upload with Multer (memory storage)

**What:** Files are small JSON — keep in memory, no disk writes.

**When to use:** MGMT-02 upload endpoint only.

```typescript
// Source: multer docs, memory storage pattern
import multer from 'multer'

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB per file
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase()
    if (ext === '.wfenvir' || ext === '.wfaction') {
      cb(null, true)
    } else {
      cb(new Error('Only .WFenvir and .WFaction files are accepted'))
    }
  },
})

// Route handler — multer populates req.files as Express.Multer.File[]
router.post('/upload', upload.array('files'), (req, res, next) => {
  const files = req.files as Express.Multer.File[]
  // file.buffer contains JSON bytes, file.originalname contains filename
  for (const file of files) {
    const json = JSON.parse(file.buffer.toString('utf-8'))
    // process...
  }
})
```

### Pattern 4: Upload Transaction (all-or-nothing)

**What:** The decision requires all-or-nothing upload. Use `createTransactionHelper` already
exported from `@trajectory/storage`.

```typescript
// Source: packages/storage/src/transaction.ts (existing utility)
import { createTransactionHelper } from '@trajectory/storage'

const trx = createTransactionHelper(db)
const result = trx.transaction(() => {
  // all repo upserts here — if any throw, entire transaction rolls back
  const envResult = environmentRepo.upsert(envInput)
  for (const action of actions) {
    actionRepo.upsert(action)
  }
  // delete orphaned actions (full sync)
  const existingActionOids = actionRepo.findByEnvironment(envInput.oid).map((a) => a.oid)
  const incomingOids = new Set(actions.map((a) => a.oid))
  for (const oid of existingActionOids) {
    if (!incomingOids.has(oid)) {
      actionRepo.delete(oid)
    }
  }
  return diffSummary
})
```

### Pattern 5: Diff Summary Calculation

**What:** Re-upload returns a diff summary (added/removed/modified actions). Compute before the
transaction runs the final upsert, or derive from comparing incoming vs DB state.

```typescript
// Compute diff for a given environment OID
function computeActionDiff(
  existing: Action[],
  incoming: ActionInput[]
): { added: string[]; removed: string[]; modified: string[] } {
  const existingMap = new Map(existing.map((a) => [a.oid, a]))
  const incomingMap = new Map(incoming.map((a) => [a.oid, a]))

  const added = incoming.filter((a) => !existingMap.has(a.oid)).map((a) => a.local_id)
  const removed = existing.filter((a) => !incomingMap.has(a.oid)).map((a) => a.local_id)
  const modified = incoming
    .filter((a) => existingMap.has(a.oid) && existingMap.get(a.oid)!.version !== a.version)
    .map((a) => a.local_id)

  return { added, removed, modified }
}
```

### Pattern 6: Pagination (offset-based — Claude's Discretion)

**What:** LogRepository.query() already accepts `limit` and `offset`. Use offset-based pagination
with `page` and `page_size` query params (matches the ManagementAPISpec.md reference design).

```typescript
// Standard page-to-offset conversion
const page = Math.max(1, Number(req.query.page) || 1)
const page_size = Math.min(200, Math.max(1, Number(req.query.page_size) || 50))
const offset = (page - 1) * page_size
const { entries, total } = logRepo.query({ ...filters, limit: page_size, offset })
const total_pages = Math.ceil(total / page_size)
```

### Pattern 7: Sort Support (Claude's Discretion)

**What:** The decision locks `?sort=field&order=asc|desc`. The existing repositories use
hardcoded ORDER BY clauses. For management list endpoints that need sorting, build a dynamic
ORDER BY in the router (not a new repo method) for fields relevant to each list.

**Sorting is limited to safe field allowlists** — never interpolate raw user input into SQL.

```typescript
const SORTABLE_INSTANCE_FIELDS = new Set(['created_at', 'state', 'action_oid'])
const sort = SORTABLE_INSTANCE_FIELDS.has(req.query.sort as string)
  ? (req.query.sort as string)
  : 'created_at'
const order = req.query.order === 'asc' ? 'ASC' : 'DESC'
// Use in dynamic query built at route level
```

### Pattern 8: Enriched Responses (join via code)

**What:** Management responses include `action_name` and `environment_name` alongside OIDs. The
repositories do not perform SQL JOINs — enrichment is done in the route handler using existing
repo methods.

```typescript
// Enrich instance with names
const instance = instanceRepo.findById(id)
const action = actionRepo.findByOid(instance.action_oid)
const environment = environmentRepo.findByOid(instance.environment_oid)
// Add names to response:
{ ...instance, action_name: action?.local_id ?? 'Unknown',
  environment_name: environment?.local_id ?? 'Unknown' }
```

### Pattern 9: Dashboard Runtime Info

**What:** Container info requires process uptime and resource data. Use Node.js built-ins.

```typescript
// Source: Node.js built-in process module
const uptimeSeconds = Math.floor(process.uptime())
const startedAt = new Date(Date.now() - uptimeSeconds * 1000).toISOString()
const memUsage = process.memoryUsage()
// For DB size: fs.statSync(DB_PATH).size
// For Node version: process.version
// For Python version: from pool/worker (not directly accessible)
```

### Pattern 10: Code Test (Dry Run)

**What:** MGMT-12 needs to execute code without creating an instance. The PythonWorkerPool
`executeCode` method can be called directly. However, InstanceManager does not expose the pool
directly — this requires calling `pool.executeCode()` through the manager's internal executor,
or a new `testCode()` method on InstanceManager.

**Recommendation:** Add a `testCode(actionOid, state, sourceCode, testInputs)` method to
InstanceManager that acquires a pool worker and runs the code without creating an instance record.
This keeps the pool abstraction intact.

### Anti-Patterns to Avoid

- **Modifying existing repositories:** All repos already have the methods needed. Do not add
  management-specific queries to repos — handle complexity at the router level.
- **New error classes for management:** Reuse `NotFoundError`, `ValidationError` from
  `@trajectory/storage`. The existing `errorHandler` already handles them correctly.
- **String interpolation in SQL:** Never interpolate sort field or filter values directly. Use
  allowlists and parameterized queries.
- **Blocking the event loop with large file reads:** Use `multer.memoryStorage()` which gives a
  Buffer — parse synchronously (JSON.parse is fast for small files). No async file I/O needed.
- **Splitting the management router across multiple files before Phase 6 is complete:** Keep
  management.ts as one file with clear section comments (like the protocol router). Split later
  if needed.

## Don't Hand-Roll

| Problem                     | Don't Build               | Use Instead                                          | Why                                                                 |
| --------------------------- | ------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------- |
| Multipart file parsing      | Custom stream parsing     | multer                                               | Handles boundary parsing, file size limits, multiple files          |
| All-or-nothing transactions | Manual try/catch rollback | `createTransactionHelper` from `@trajectory/storage` | Already handles SQLite transaction semantics correctly              |
| Environment upsert          | Custom insert-or-update   | `EnvironmentRepository.upsert()`                     | Already implemented                                                 |
| Action upsert               | Custom insert-or-update   | `ActionRepository.upsert()`                          | Already implemented                                                 |
| Code version activate       | Manual flag flips         | `CodeVersionRepository.activate()`                   | Already handles deactivate-all + activate-one atomically            |
| Code version save+activate  | Two separate calls        | `CodeVersionRepository.saveAndActivate()`            | Already implemented as transaction                                  |
| Log pagination              | Custom count+query        | `LogRepository.query(filters)`                       | Returns `{entries, total}` — already supports pagination            |
| Error response shape        | Custom error objects      | `errorHandler` middleware                            | Already maps NotFoundError, ValidationError, EngineError            |
| Settings validation         | Custom validator          | `SettingsRepository.update()`                        | Already validates each key's constraints and throws ValidationError |

**Key insight:** The storage layer is remarkably complete. Most management endpoints reduce to
1-3 repository calls + response formatting. The temptation to add new repo methods should be
resisted — route-level code handles enrichment and composition.

## Common Pitfalls

### Pitfall 1: Express 5 Route Parameter Ambiguity

**What goes wrong:** The code endpoint has both `/:version_id` and `/active` as sub-paths of
`/code/:action_oid/:state/`. If `active` is registered as a named parameter, Express matches
GET `/code/oid/state/active` as `version_id = "active"` and 404s on UUID lookup.

**Why it happens:** Express route matching is order-dependent. If `/:version_id` is registered
before `/active`, the literal segment never matches.

**How to avoid:** Register the literal `/active` route BEFORE the parameterized `/:version_id`
route. In Express 5, path ordering within a router is respected.

```typescript
// Correct order:
router.get('/code/:action_oid/:state/active', ...)       // register FIRST
router.get('/code/:action_oid/:state/:version_id', ...)  // register SECOND
router.post('/code/:action_oid/:state/test', ...)        // register BEFORE /:version_id
router.post('/code/:action_oid/:state/:version_id/activate', ...) // register AFTER
```

**Warning signs:** Integration test for GET `/active` returns a version UUID not found error
instead of the active version.

### Pitfall 2: Upload All-or-Nothing vs. Partial Success

**What goes wrong:** If the upload processes multiple files and fails on file 2, file 1 changes
are committed — violating the all-or-nothing decision.

**Why it happens:** Each environment's upsert is done in a separate repo call without a wrapping
transaction.

**How to avoid:** Wrap the entire multi-file processing in a single `createTransactionHelper`
transaction. Validate ALL files first (parse JSON, check schema) before any DB writes. Return
errors immediately if any file fails validation.

**Warning signs:** A failed upload of a 2-file batch shows one environment updated but not the
other.

### Pitfall 3: Orphaned Action Deletion on Re-Upload

**What goes wrong:** Re-upload of an environment doesn't delete actions that exist in DB but are
absent from the new package — leaving ghost actions the console cannot remove.

**Why it happens:** Developer only upserts incoming actions without checking for deletions.

**How to avoid:** After upserting all incoming actions for an environment, compare the incoming
OID set against `actionRepo.findByEnvironment(envOid)` and delete any OIDs not in the incoming set.
This must happen inside the same transaction.

**Warning signs:** After re-upload with fewer actions, `/environments/:oid` still shows the old
action count.

### Pitfall 4: Delete Environment with Active Instances

**What goes wrong:** Deleting an environment that has actions with running instances leaves
instances pointing to non-existent action/environment records.

**Why it happens:** The foreign key is on `action_oid` in the instances table but instances is
not set up with CASCADE DELETE, and the validation is skipped.

**How to avoid:** Before deleting an environment, call `instanceRepo.countActive()` filtered to
the environment's actions. If count > 0, return 409 CONFLICT. Check:

```typescript
// Check each action in environment for active instances
const actions = actionRepo.findByEnvironment(envOid)
const hasActiveInstances = actions.some((action) =>
  instanceRepo.findByAction(action.oid).some((i) => i.completed_at === null)
)
if (hasActiveInstances) {
  res.status(409).json({
    error: {
      code: 'CONFLICT',
      message: 'Cannot delete environment with active instances',
      details: {},
    },
  })
  return
}
```

**Warning signs:** DELETE /environments/:oid returns 200 but instances table has records with
dangling action_oid.

### Pitfall 5: Deleting Active or Pinned Code Versions

**What goes wrong:** Deleting a code version that is currently active, or one that is pinned by
a running instance, corrupts the execution path for running instances.

**Why it happens:** The route handler calls `codeVersionRepo.findById()` but skips the
`is_active` check or doesn't check instance `pinned_code_versions`.

**How to avoid:**

1. Check `version.is_active === true` — return 409 if so.
2. Check all active instances' `pinned_code_versions` array for this version id — return 409 if
   any running instance references it.

```typescript
const version = codeVersionRepo.findById(versionId)
if (!version) return res.status(404)...
if (version.is_active) return res.status(409)...

const activeInstances = instanceRepo.findActive()
const isPinned = activeInstances.some(inst => {
  const pinned = inst.pinned_code_versions as Array<{id: string}>
  return pinned.some(p => p.id === versionId)
})
if (isPinned) return res.status(409)...
```

### Pitfall 6: Dashboard "Instances Completed Today" Requires Time-Scoped Query

**What goes wrong:** Dashboard spec shows `completed_today` count, but `InstanceRepository` has
no time-filtered count method. Developer either skips the field or makes N queries.

**Why it happens:** Existing repo doesn't have this query.

**How to avoid:** For the dashboard, use `LogRepository.query()` with `startDate` set to
midnight of today (UTC). The log already stores `completed_at` — completed instances log there.
Alternatively, query `instances` table directly with a dynamic SQL in the route handler.

```typescript
const todayMidnight = new Date()
todayMidnight.setUTCHours(0, 0, 0, 0)
const { total: completedToday } = logRepo.query({
  startDate: todayMidnight.toISOString(),
  finalStatus: 'COMPLETED',
  limit: 1, // we only need the count
})
```

### Pitfall 7: Python Version Not Accessible from Node.js

**What goes wrong:** Dashboard spec includes Python version in container info, but there's no
existing mechanism to read the Python version from the pool workers.

**Why it happens:** PythonWorkerPool doesn't expose Python version — workers are subprocesses.

**How to avoid:** Spawn a one-shot `python --version` command at server startup and cache the
result, OR omit Python version from the initial implementation and return `null`. The CONTEXT.md
says container info includes "Node.js version, Python version, DB path/size". If Python version
is required, cache it at startup.

```typescript
import { execSync } from 'node:child_process'
let pythonVersion: string | null = null
try {
  pythonVersion = execSync('python --version', { encoding: 'utf-8' }).trim()
} catch {
  pythonVersion = null
}
```

### Pitfall 8: multer and Express 5 Compatibility

**What goes wrong:** multer 1.x has known issues with Express 5's updated request handling.
multer 2.x was released specifically for Express 5 compatibility.

**Why it happens:** multer 1.x uses older Express internals.

**How to avoid:** Install multer 2.x (not 1.x). Verify package.json specifies `^2.0.0`.

**Warning signs:** File uploads result in empty `req.files` or middleware errors.

### Pitfall 9: createTestApp Pattern for Management Tests

**What goes wrong:** Management integration tests create managers without properly seeding test
data (environments, actions) before testing upload/browse endpoints.

**Why it happens:** The existing `seedTestAction` helper only creates one env+action pair, and
management tests need richer fixtures.

**How to avoid:** Create a management-specific test helper that seeds environments and actions
using the same `initializeDatabase(':memory:')` pattern from protocol.test.ts. Seed data
directly via repo calls before each test group.

## Code Examples

Verified patterns from official sources and existing codebase:

### Dashboard Container Info

```typescript
// Source: Node.js built-in process module (Node 20+)
import { statSync } from 'node:fs'

function getContainerInfo(dbPath: string) {
  const uptimeSeconds = Math.floor(process.uptime())
  return {
    uptime_seconds: uptimeSeconds,
    started_at: new Date(Date.now() - uptimeSeconds * 1000).toISOString(),
    node_version: process.version,
    db_path: dbPath,
    db_size_bytes: (() => {
      try {
        return statSync(dbPath).size
      } catch {
        return null
      }
    })(),
    memory_rss_bytes: process.memoryUsage().rss,
  }
}
```

### Multer Upload Handler

```typescript
// Source: multer 2.x documentation pattern, memory storage
import multer from 'multer'
import path from 'node:path'

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
})

router.post('/upload', upload.array('files'), (req, res, next) => {
  try {
    const files = req.files as Express.Multer.File[]
    if (!files || files.length === 0) {
      return void res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'No files provided', details: {} },
      })
    }

    // Validate extensions before any DB writes
    for (const file of files) {
      const ext = path.extname(file.originalname).toLowerCase()
      if (ext !== '.wfenvir' && ext !== '.wfaction') {
        return void res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: `Unsupported file type: ${file.originalname}`,
            details: {},
          },
        })
      }
    }

    // Parse JSON (may throw)
    const parsed = files.map((file) => ({
      filename: file.originalname,
      ext: path.extname(file.originalname).toLowerCase(),
      content: JSON.parse(file.buffer.toString('utf-8')) as unknown,
    }))

    // All-or-nothing transaction
    const results = trx.transaction(() => {
      return parsed.map(({ filename, ext, content }) => {
        if (ext === '.wfenvir') return processWFenvir(filename, content)
        return processWFaction(filename, content)
      })
    })

    res.status(200).json({ data: results, meta: {} })
  } catch (err) {
    next(err)
  }
})
```

### Code Version Route Registration Order

```typescript
// CRITICAL: literal paths before parameterized paths
// Source: Express 5 routing rules (order-dependent matching)

// /active must come before /:version_id
router.get('/code/:action_oid/:state/active', handlerGetActiveCode)
router.get('/code/:action_oid/:state/:version_id', handlerGetCodeById)

// /test must come before /:version_id sub-paths
router.post('/code/:action_oid/:state/test', handlerTestCode)
router.post('/code/:action_oid/:state/:version_id/activate', handlerActivateVersion)

router.post('/code/:action_oid/:state', handlerSaveCode)
router.delete('/code/:action_oid/:state/:version_id', handlerDeleteCode)
```

### Existing Error Handler Reuse

```typescript
// Source: packages/server/src/middleware/error-handler.ts (existing)
// The existing errorHandler already handles:
// - NotFoundError    -> 404 { error: { code: 'NOT_FOUND', message, details: {} } }
// - ValidationError  -> 400 { error: { code: 'VALIDATION_ERROR', message, details: {} } }
// - EngineError      -> mapped status codes
// - unknown errors   -> 500 { error: { code: 'INTERNAL_ERROR', ... } }
//
// Management routes call next(err) for all thrown errors — the shared errorHandler handles them.
// Management-specific conflicts (delete active version) use inline responses, not thrown errors,
// because they are expected control-flow rather than exceptions.
```

### Settings Update with Side Effect

```typescript
// After updating python_pool_size, call manager.resizePool()
router.put('/settings/:key', (req, res, next) => {
  try {
    const { key } = req.params
    const { value } = req.body as { value: string }
    const previousValue = settingsRepo.getValue(key)
    const updated = settingsRepo.update(key, value) // throws NotFoundError or ValidationError
    // Side effects:
    if (key === 'python_pool_size') {
      manager.resizePool(Number(value))
    }
    if (key === 'log_max_size') {
      logRepo.trimToSize(Number(value))
    }
    res.status(200).json({
      data: { ...updated, previous_value: previousValue },
      meta: {},
    })
  } catch (err) {
    next(err)
  }
})
```

## State of the Art

| Old Approach                  | Current Approach              | When Changed | Impact                              |
| ----------------------------- | ----------------------------- | ------------ | ----------------------------------- |
| multer 1.x (Express 4)        | multer 2.x (Express 5)        | 2024         | Breaking change; 2.x required       |
| Express 4 `app.param()`       | Express 5 direct `req.params` | 2024         | No impact, already using req.params |
| Manual transaction management | `createTransactionHelper`     | Phase 2      | Already in codebase                 |

**Deprecated/outdated:**

- multer 1.x: does not work with Express 5's updated request object — must use 2.x
- `express.urlencoded()` for file upload: wrong middleware — does not handle multipart

## Open Questions

1. **WFenvir JSON schema — exact field names for parsing**
   - What we know: DataModelSpec.md defines `StoredEnvironmentSpecification` with fields like
     `oid`, `local_id`, `version`, `last_modified_date`, `schemaVersion`,
     `action_property_specifications`, `value_property_specifications`,
     `resource_property_specifications`, `included_actions`.
   - What's unclear: The exact JSON shape that Trajectory MD produces for `.WFenvir` files —
     whether it wraps environments in a `MasterEnvironmentLibrary` container object, and what
     the top-level key is.
   - Recommendation: The ManagementAPISpec.md mentions `MasterEnvironmentLibrary` and
     `MasterActionLibrary` as the container types. Assume the JSON file IS the library (array of
     environments or actions), or has a single top-level key. Validate in test; adjust parsing
     if needed. The planner should note this as a parse-time concern.

2. **Python version in dashboard**
   - What we know: CONTEXT.md says container info includes Python version.
   - What's unclear: PythonWorkerPool does not expose this.
   - Recommendation: Cache at startup via `execSync('python --version')`, return null on failure.

3. **Management instances list — active vs history separation**
   - What we know: CONTEXT.md decision: "Separate active instances endpoint (currently running)
     and history endpoint (terminal instances)". But MGMT-13 is defined as single list endpoint
     with filters.
   - What's unclear: Whether MGMT-13 is one endpoint with a `?status=active|terminal` filter,
     or two endpoints.
   - Recommendation: Implement as single `/management/v1/instances` endpoint with a `?status=`
     filter parameter that accepts `active` (completed_at IS NULL) vs `terminal` (completed_at
     IS NOT NULL) as the primary filter. The existing `InstanceRepository.findActive()` and
     `findByStatus()` cover both cases.

4. **testCode() method on InstanceManager**
   - What we know: MGMT-12 dry-run needs pool access. InstanceManager.pool is private.
   - What's unclear: Whether to add `testCode()` to InstanceManager or expose pool differently.
   - Recommendation: Add `testCode(actionOid, state, sourceCode, testInputs, timeoutMs)` to
     InstanceManager. It acquires a worker, runs the code, releases the worker. No instance
     record is created.

## Sources

### Primary (HIGH confidence)

- Direct code review of `packages/server/src/index.ts` — Express app setup, router registration pattern
- Direct code review of `packages/server/src/routes/protocol.ts` — factory router pattern
- Direct code review of `packages/server/src/middleware/error-handler.ts` — error handling
- Direct code review of `packages/storage/src/repositories/*.ts` — all 6 repository APIs
- Direct code review of `packages/storage/src/transaction.ts` — transaction helper
- Direct code review of `packages/engine/src/instance-manager/instance-manager.ts` — manager API
- Direct code review of `packages/storage/src/migrations/001-initial-schema.ts` — full schema
- Direct code review of `.TrajectoryActions/ManagementAPISpec.md` — spec reference
- Direct code review of `.TrajectoryActions/DataModelSpec.md` — WF file data model
- Direct code review of `.planning/phases/06-management-api/06-CONTEXT.md` — locked decisions
- `node_modules/express/package.json` — version 5.2.1 confirmed
- `node_modules/better-sqlite3/package.json` — version 12.6.2 confirmed
- `node_modules/formidable/package.json` — 3.5.4 (transitive dep, not for direct use)

### Secondary (MEDIUM confidence)

- multer 2.x requirement for Express 5 — based on known breaking change in Express 5 and multer's
  documented Express 5 support in multer 2.x release notes (not directly verified via Context7)

### Tertiary (LOW confidence)

- Dashboard `completed_today` approach via LogRepository.query() — reasonable inference from
  existing API, not a coded requirement

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH — all core deps confirmed via package.json files; multer 2.x is MEDIUM
  (Express 5 compatibility claim not verified via Context7, but well-established community fact)
- Architecture patterns: HIGH — derived directly from existing codebase patterns
- Pitfalls: HIGH — derived from direct analysis of route ordering, transaction semantics,
  and schema constraints

**Research date:** 2026-02-27
**Valid until:** 2026-03-29 (stable — no fast-moving dependencies beyond multer version)
