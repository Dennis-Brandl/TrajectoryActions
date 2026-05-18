# Warehouse Scenario — Phase 1 Scaffold Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the scenario generator infrastructure plus the warehouse environment scaffold with stub Python so the warehouse can be deployed, viewed in the console, and round-tripped via both `.WFenvir` (env-level) and `.WFactionCodeX` (per-action) upload paths. No real simulation logic yet — that's Phases 2-4.

**Architecture:** A TypeScript scenario definition under `scripts/scenarios/<scenario>/definition.ts` declares the env + actions; per-action Python source lives at `<scenario>/code/<action_local_id>/<state>.py`. A generator (`scripts/scenarios/lib/build.ts`) reads a definition + code files and emits both an env-level `.WFenvir` JSON and per-action `.WFactionCodeX` ZIPs (each containing an `action.WFaction` JSON + `code/<state>.py` files). An uploader (`upload.ts`) posts artifacts to a running container; a CLI (`cli.ts`) wraps both. Server-side, `/management/v1/upload` gains a fourth ZIP-handling branch for `.WFactionCodeX`.

**Tech Stack:** TypeScript 5, tsx, Express 5, JSZip, vitest + supertest, Python 3 sidecar.

**Spec:** `docs/specs/2026-05-08-warehouse-scenario-implementation-design.md`

---

## File Structure

| File                                                       | Role                                                                                                                                                                                                                      |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `package.json` (root)                                      | Add `jszip` to devDependencies so scripts/scenarios/ resolves it cleanly.                                                                                                                                                 |
| `.gitignore`                                               | Add `scripts/scenarios/dist/` so generated artifacts don't get committed.                                                                                                                                                 |
| `scripts/scenarios/lib/types.ts`                           | NEW. TypeScript types: `ScenarioDefinition`, `EnvironmentDefinition`, `ActionDefinition`, `ParameterSpec`, `PropertySpec`.                                                                                                |
| `scripts/scenarios/lib/build.ts`                           | NEW. `buildScenario(scenario, outDir)` — reads scenario, emits `.WFenvir` + `code/` + `actions/*.WFactionCodeX`.                                                                                                          |
| `scripts/scenarios/lib/upload.ts`                          | NEW. `uploadScenarioBulk`, `uploadScenarioPerAction`, `uploadActionPackage` — HTTP clients posting to a running server.                                                                                                   |
| `scripts/scenarios/cli.ts`                                 | NEW. CLI dispatcher: `list`/`build`/`upload`/`upload-actions`/`upload-action`/`deploy`.                                                                                                                                   |
| `scripts/scenarios/lib/__tests__/build.test.ts`            | NEW. Unit tests for `buildScenario` against synthetic fixtures.                                                                                                                                                           |
| `scripts/scenarios/warehouse/definition.ts`                | NEW. Warehouse env + 10 action declarations.                                                                                                                                                                              |
| `scripts/scenarios/warehouse/code/<action>/<state>.py`     | NEW × 34 (7 obs × 4 states + 3 opaque × 2 states). All stubs: `outputs['status'] = '0'`.                                                                                                                                  |
| `scripts/scenarios/warehouse/README.md`                    | NEW. Manual walkthrough — build, deploy, verify in console.                                                                                                                                                               |
| `packages/server/src/routes/management.ts`                 | EDIT. Add `.WFactionCodeX` to the accepted-extensions list and add a parsing branch that extracts the inner `.WFaction` + `code/*.py` and processes them via the existing `wfaction` upsert path plus code save+activate. |
| `packages/server/src/__tests__/management-upload.test.ts`  | NEW. Server-side coverage for the new `.WFactionCodeX` branch (5 cases).                                                                                                                                                  |
| `packages/server/src/__tests__/scenario-warehouse.test.ts` | NEW. End-to-end integration test exercising both upload paths + invocation of all 10 actions.                                                                                                                             |

Each file has a single responsibility:

- `types.ts` — shape of a scenario.
- `build.ts` — read scenario from disk, emit deployable artifacts.
- `upload.ts` — POST artifacts to a running container.
- `cli.ts` — argument parsing and dispatch.
- The warehouse content (`definition.ts` + Python files) is pure data.

---

## Task 1: Server-side `.WFactionCodeX` import branch

**Files:**

- Modify: `packages/server/src/routes/management.ts:231-294` (extension check + parsing branch)
- Modify: `packages/server/src/routes/management.ts:540-625` (post-validation processing loop — add a third branch for `wfactioncodex`)
- Create: `packages/server/src/__tests__/management-upload.test.ts`

- [ ] **Step 1: Read the existing parsing/dispatch code to understand the local context**

```
# Just inspection — no edit yet. Read the lines mentioned above to confirm the layout.
```

The handler currently dispatches by file extension at line 231 (`if (ext !== 'wfenvir' && ext !== 'wfenvirx' && ext !== 'wfaction')`), parses the file into a `parsed[]` array tagged with `type: 'wfenvir' | 'wfaction'`, then walks `parsed[]` inside a transaction (line ~540 onward) where each entry's type drives create/update logic. Your additions follow that exact shape: a new accepted extension `wfactioncodex`, a new parse branch that yields `type: 'wfactioncodex'` with the inner action JSON + code files attached, and a new processing branch that upserts the action and saves+activates each code version.

- [ ] **Step 2: Write the failing tests**

Create `packages/server/src/__tests__/management-upload.test.ts`:

```ts
/**
 * management-upload.test.ts — Coverage for the /upload endpoint's .WFactionCodeX branch.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
import cors from 'cors'
import request from 'supertest'
import JSZip from 'jszip'
import {
  initializeDatabase,
  ActionRepository,
  InstanceRepository,
  SettingsRepository,
  EnvironmentRepository,
  CodeVersionRepository,
  LogRepository,
} from '@trajectory/storage'
import type BetterSqlite3 from 'better-sqlite3'
import { InstanceManager } from '@trajectory/engine'
import { SseManager } from '../sse-manager.js'
import { createManagementRouter } from '../routes/management.js'
import { errorHandler } from '../middleware/error-handler.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const SCRIPT_PATH = path.resolve(__dirname, '../../../python-sidecar/sandbox_runner.py')

interface TestApp {
  app: express.Express
  manager: InstanceManager
  db: BetterSqlite3.Database
  environmentRepo: EnvironmentRepository
  actionRepo: ActionRepository
  codeVersionRepo: CodeVersionRepository
}

function createTestApp(): TestApp {
  const db = initializeDatabase(':memory:')
  const environmentRepo = new EnvironmentRepository(db)
  const actionRepo = new ActionRepository(db)
  const codeVersionRepo = new CodeVersionRepository(db)
  const instanceRepo = new InstanceRepository(db)
  const logRepo = new LogRepository(db)
  const settingsRepo = new SettingsRepository(db)
  const sseManager = new SseManager()

  const manager = new InstanceManager(db, {
    scriptPath: SCRIPT_PATH,
    poolSize: 1,
    onStateChange: () => {},
    onTerminal: () => {},
    onError: () => {},
  })

  const app = express()
  app.use(cors({ origin: '*', methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'] }))
  app.use(express.json())
  app.use(
    '/management/v1',
    createManagementRouter(
      db,
      ':memory:',
      manager,
      environmentRepo,
      actionRepo,
      codeVersionRepo,
      instanceRepo,
      logRepo,
      settingsRepo
    )
  )
  app.use(errorHandler)

  return { app, manager, db, environmentRepo, actionRepo, codeVersionRepo }
}

function buildActionWFactionCodeX(opts: {
  actionOid: string
  actionLocalId: string
  environmentOid: string
  visibility: 'observable' | 'opaque'
  states: Record<string, string>
}): Promise<Buffer> {
  const zip = new JSZip()
  zip.file(
    'action.WFaction',
    JSON.stringify({
      oid: opts.actionOid,
      local_id: opts.actionLocalId,
      version: '1.0.0',
      last_modified_date: '2026-05-09T00:00:00Z',
      environment_oid: opts.environmentOid,
      action_visibility: opts.visibility,
      input_parameter_specifications: [],
      output_parameter_specifications: [
        {
          id: 'status',
          value_type: 'literal',
          default_value: '0',
          description: '0=success, 1=simulated abort, 2=simulated timeout',
        },
      ],
      property_specifications: [],
    })
  )
  for (const [state, source] of Object.entries(opts.states)) {
    zip.file(`code/${state}.py`, source)
  }
  return zip.generateAsync({ type: 'nodebuffer' })
}

describe('MGMT-UPLOAD: .WFactionCodeX branch', () => {
  let testApp: TestApp

  beforeAll(() => {
    testApp = createTestApp()
  })

  afterAll(async () => {
    await testApp.manager.shutdown()
    testApp.db.close()
  })

  it('imports a new action with code from a .WFactionCodeX', async () => {
    const env = testApp.environmentRepo.save({
      oid: 'env-codex-1',
      local_id: 'CodexEnv1',
      version: '1.0.0',
      description: null,
      action_property_specifications: [],
      value_property_specifications: [],
      resource_property_specifications: [],
      schema_version: '4.0',
    })

    const buf = await buildActionWFactionCodeX({
      actionOid: 'act-codex-1',
      actionLocalId: 'CodexAction1',
      environmentOid: env.oid,
      visibility: 'observable',
      states: {
        STARTING: "outputs['status'] = '0'",
        EXECUTING: "outputs['status'] = '0'",
      },
    })

    const res = await request(testApp.app)
      .post('/management/v1/upload')
      .attach('files', buf, {
        filename: 'CodexAction1.WFactionCodeX',
        contentType: 'application/zip',
      })
      .expect(200)

    expect(res.body.data.imported).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'action',
          oid: 'act-codex-1',
          status: 'created',
        }),
      ])
    )

    const action = testApp.actionRepo.findByOid('act-codex-1')
    expect(action).not.toBeNull()
    expect(action?.action_visibility).toBe('observable')

    const startingActive = testApp.codeVersionRepo.getActive('act-codex-1', 'STARTING')
    expect(startingActive?.source_code).toBe("outputs['status'] = '0'")

    const executingActive = testApp.codeVersionRepo.getActive('act-codex-1', 'EXECUTING')
    expect(executingActive?.source_code).toBe("outputs['status'] = '0'")
  })

  it('rejects a .WFactionCodeX missing the action.WFaction entry', async () => {
    const zip = new JSZip()
    zip.file('code/STARTING.py', "outputs['status'] = '0'")
    const buf = await zip.generateAsync({ type: 'nodebuffer' })

    const res = await request(testApp.app)
      .post('/management/v1/upload')
      .attach('files', buf, {
        filename: 'NoAction.WFactionCodeX',
        contentType: 'application/zip',
      })
      .expect(400)

    expect(res.body.error.code).toBe('VALIDATION_ERROR')
    expect(res.body.error.message).toContain('action.WFaction')
  })

  it('upserts an existing action via .WFactionCodeX (re-upload increments versions)', async () => {
    const env = testApp.environmentRepo.save({
      oid: 'env-codex-2',
      local_id: 'CodexEnv2',
      version: '1.0.0',
      description: null,
      action_property_specifications: [],
      value_property_specifications: [],
      resource_property_specifications: [],
      schema_version: '4.0',
    })

    const buf1 = await buildActionWFactionCodeX({
      actionOid: 'act-codex-2',
      actionLocalId: 'CodexAction2',
      environmentOid: env.oid,
      visibility: 'observable',
      states: { STARTING: "outputs['status'] = '0'" },
    })

    await request(testApp.app)
      .post('/management/v1/upload')
      .attach('files', buf1, {
        filename: 'CodexAction2.WFactionCodeX',
        contentType: 'application/zip',
      })
      .expect(200)

    // Re-upload with updated code
    const buf2 = await buildActionWFactionCodeX({
      actionOid: 'act-codex-2',
      actionLocalId: 'CodexAction2',
      environmentOid: env.oid,
      visibility: 'observable',
      states: { STARTING: "outputs['status'] = '0'  # v2" },
    })

    const res = await request(testApp.app)
      .post('/management/v1/upload')
      .attach('files', buf2, {
        filename: 'CodexAction2.WFactionCodeX',
        contentType: 'application/zip',
      })
      .expect(200)

    expect(res.body.data.imported).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'action',
          oid: 'act-codex-2',
          status: 'updated',
        }),
      ])
    )

    const versions = testApp.codeVersionRepo.getVersionHistory('act-codex-2', 'STARTING')
    expect(versions.length).toBe(2)
    const active = testApp.codeVersionRepo.getActive('act-codex-2', 'STARTING')
    expect(active?.source_code).toBe("outputs['status'] = '0'  # v2")
  })

  it('imports an action without code/ folder (declaration-only ZIP)', async () => {
    const env = testApp.environmentRepo.save({
      oid: 'env-codex-3',
      local_id: 'CodexEnv3',
      version: '1.0.0',
      description: null,
      action_property_specifications: [],
      value_property_specifications: [],
      resource_property_specifications: [],
      schema_version: '4.0',
    })

    const buf = await buildActionWFactionCodeX({
      actionOid: 'act-codex-3',
      actionLocalId: 'CodexAction3',
      environmentOid: env.oid,
      visibility: 'opaque',
      states: {}, // no code files
    })

    await request(testApp.app)
      .post('/management/v1/upload')
      .attach('files', buf, {
        filename: 'CodexAction3.WFactionCodeX',
        contentType: 'application/zip',
      })
      .expect(200)

    const action = testApp.actionRepo.findByOid('act-codex-3')
    expect(action).not.toBeNull()
    expect(testApp.codeVersionRepo.getVersionHistory('act-codex-3', 'IN_PROGRESS')).toHaveLength(0)
  })

  it('rejects a corrupt ZIP', async () => {
    const buf = Buffer.from('not a zip')
    const res = await request(testApp.app)
      .post('/management/v1/upload')
      .attach('files', buf, {
        filename: 'Corrupt.WFactionCodeX',
        contentType: 'application/zip',
      })
      .expect(400)

    expect(res.body.error.code).toBe('VALIDATION_ERROR')
  })
})
```

- [ ] **Step 3: Run tests to confirm they fail**

```
npm test -- packages/server/src/__tests__/management-upload.test.ts
```

Expected: 5 failures, all because the route currently rejects the `wfactioncodex` extension at line 231.

- [ ] **Step 4: Implement the parsing branch**

In `packages/server/src/routes/management.ts`, change the extension validation at line 231 from:

```ts
if (ext !== 'wfenvir' && ext !== 'wfenvirx' && ext !== 'wfaction') {
```

to:

```ts
if (ext !== 'wfenvir' && ext !== 'wfenvirx' && ext !== 'wfaction' && ext !== 'wfactioncodex') {
```

Update the rejection message at line 235:

```ts
message: `Invalid file extension for "${file.originalname}". Expected .WFenvir, .WFenvirX, .WFaction, or .WFactionCodeX`,
```

Update the parsed-array tagged-union type around line 247:

```ts
type: 'wfenvir' | 'wfaction' | 'wfactioncodex'
```

For each entry, when needed (only on `wfactioncodex`), the parsed item also carries a `codeFiles` field:

```ts
const parsed: Array<
  | { file: Express.Multer.File; type: 'wfenvir'; data: Record<string, any>; schemaVersion: string }
  | { file: Express.Multer.File; type: 'wfaction'; data: Record<string, any> }
  | {
      file: Express.Multer.File
      type: 'wfactioncodex'
      data: Record<string, any>
      codeFiles: Array<{ state: string; source: string }>
    }
> = []
```

Add a new parsing branch immediately after the existing `wfaction` branch (around line 294, just before the `// ext === 'wfenvir' or 'wfenvirx'` comment):

```ts
if (ext === 'wfactioncodex') {
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(file.buffer)
  } catch {
    return void res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: `Failed to read ZIP archive in "${file.originalname}"`,
        details: { filename: file.originalname },
      },
    })
  }

  // Find the inner *.WFaction entry
  const actionEntry = Object.values(zip.files).find((entry) => {
    if (entry.dir) return false
    const innerExt = entry.name.split('.').pop()?.toLowerCase() ?? ''
    return innerExt === 'wfaction'
  })
  if (!actionEntry) {
    return void res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: `ZIP "${file.originalname}" contains no action.WFaction entry`,
        details: { filename: file.originalname },
      },
    })
  }

  let actionData: unknown
  try {
    actionData = JSON.parse(await actionEntry.async('text'))
  } catch {
    return void res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: `Failed to parse JSON in "${actionEntry.name}" of "${file.originalname}"`,
        details: { filename: file.originalname },
      },
    })
  }
  if (typeof actionData !== 'object' || actionData === null) {
    return void res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: `"${actionEntry.name}" must contain a JSON object in "${file.originalname}"`,
        details: { filename: file.originalname },
      },
    })
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const obj = actionData as Record<string, any>
  for (const field of ['oid', 'local_id', 'version', 'last_modified_date']) {
    if (obj[field] === undefined) {
      return void res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: `Missing required field "${field}" in action.WFaction of "${file.originalname}"`,
          details: { filename: file.originalname },
        },
      })
    }
  }

  // Collect code/*.py entries
  const codeFiles: Array<{ state: string; source: string }> = []
  for (const entry of Object.values(zip.files)) {
    if (entry.dir) continue
    const match = /^code\/([^/]+)\.py$/.exec(entry.name)
    if (!match) continue
    const state = match[1]!
    const source = await entry.async('text')
    codeFiles.push({ state, source })
  }

  parsed.push({ file, type: 'wfactioncodex', data: obj, codeFiles })
  continue
}
```

- [ ] **Step 5: Implement the processing branch**

Find the existing transaction loop. Inside it, where the `wfaction` branch lives (around line 595-622, after the `} else {` that opens the wfaction handler), refactor so wfaction-style upsert is reused for both bare wfaction and wfactioncodex. Replace the existing `else { // wfaction (standalone) ... }` block with:

```ts
          } else if (item.type === 'wfaction' || item.type === 'wfactioncodex') {
            // Both bare .WFaction and .WFactionCodeX upsert the action via the same path.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const actionData = item.data as Record<string, any>
            const actionInput = {
              oid: actionData['oid'] as string,
              environment_oid: (actionData['environment_oid'] as string | undefined) ?? '',
              local_id: actionData['local_id'] as string,
              version: actionData['version'] as string,
              last_modified_date: actionData['last_modified_date'] as string,
              action_visibility: (actionData['action_visibility'] ?? 'opaque') as
                | 'opaque'
                | 'observable',
              input_parameter_specifications: (actionData['input_parameter_specifications'] ??
                []) as unknown[],
              output_parameter_specifications: (actionData['output_parameter_specifications'] ??
                []) as unknown[],
              property_specifications: (actionData['property_specifications'] ?? []) as unknown[],
              description: (actionData['description'] as string | undefined) ?? null,
            }
            const { created: actionCreated } = actionRepo.upsert(actionInput)
            imported.push({
              type: 'action',
              oid: actionData['oid'] as string,
              local_id: actionData['local_id'] as string,
              version: actionData['version'] as string,
              status: actionCreated ? 'created' : 'updated',
            })

            // For .WFactionCodeX, also save+activate each code version.
            if (item.type === 'wfactioncodex') {
              for (const { state, source } of item.codeFiles) {
                const cv = codeVersionRepo.save({
                  action_oid: actionInput.oid,
                  state,
                  source_code: source,
                  created_by: 'import',
                  description: null,
                })
                codeVersionRepo.activate(cv.id)
              }
            }
          }
```

> The original `wfaction` branch was an `else` — change it to `else if` and add the new combined branch. The `wfenvir` branch above it stays unchanged.

- [ ] **Step 6: Run tests to verify they pass**

```
npm test -- packages/server/src/__tests__/management-upload.test.ts
```

Expected: 5/5 pass.

Also run the full server test suite to make sure no regressions:

```
npm test -- packages/server
```

Expected: previous test counts pass.

- [ ] **Step 7: Commit**

```
git add packages/server/src/routes/management.ts packages/server/src/__tests__/management-upload.test.ts
git commit -m "feat(management): accept .WFactionCodeX in /upload endpoint"
```

---

## Task 2: Scenario types module

**Files:**

- Create: `scripts/scenarios/lib/types.ts`

- [ ] **Step 1: Create the types file**

Write `scripts/scenarios/lib/types.ts`:

```ts
export type Visibility = 'observable' | 'opaque'

export interface ParameterSpec {
  id: string
  value_type: 'literal' | 'property'
  default_value: string
  description?: string
}

// Output params have no target_property_name in the Action Container — they're set
// by user code. Workflow-execution-only fields are intentionally absent.
export type OutputParameterSpec = ParameterSpec

export interface PropertyEntrySpec {
  name: string
  value: string
}

export interface PropertySpec {
  name: string
  entries: PropertyEntrySpec[]
}

export interface ResourcePropertySpec {
  name: string
  resource_type: string
  description?: string
}

export interface ActionDefinition {
  oid: string
  local_id: string
  version: string
  visibility: Visibility
  description?: string
  inputs: ParameterSpec[]
  outputs: OutputParameterSpec[]
  property_specifications?: PropertySpec[]
  /** States that have user code; the build step expects code/<local_id>/<state>.py for each. */
  code_states: string[]
  /** Optional per-action timeout, applied via PUT /management/v1/actions/{oid}/timeout. */
  timeout_seconds?: number | null
}

export interface EnvironmentDefinition {
  oid: string
  local_id: string
  version: string
  description?: string
  schemaVersion?: string
  action_property_specifications?: PropertySpec[]
  value_property_specifications?: PropertySpec[]
  resource_property_specifications?: ResourcePropertySpec[]
}

export interface ScenarioDefinition {
  /** Absolute path to this scenario's source root, used to resolve code/<action>/<state>.py.
   * Convention: set to dirname(fileURLToPath(import.meta.url)) in the definition file. */
  rootDir: string
  /** Library-level metadata for the .WFenvir wrapper. */
  library: {
    oid: string
    local_id: string
    version: string
  }
  environment: EnvironmentDefinition
  actions: ActionDefinition[]
}

export interface BuildResult {
  envFilePath: string
  codeFiles: Array<{ actionOid: string; actionLocalId: string; state: string; path: string }>
  actionPackages: Array<{ actionOid: string; actionLocalId: string; path: string }>
  actions: ActionDefinition[]
  scenario: ScenarioDefinition
}
```

- [ ] **Step 2: Verify type check**

Run from the repo root:

```
npx tsc --noEmit scripts/scenarios/lib/types.ts
```

Expected: clean. (If your tsconfig settings need tweaking, prefer adjusting `tsconfig.json` includes rather than fighting the compiler. But for a self-contained types file with no imports, plain `tsc --noEmit` should pass.)

- [ ] **Step 3: Commit**

```
git add scripts/scenarios/lib/types.ts
git commit -m "feat(scenarios): TypeScript types for scenario definitions"
```

---

## Task 3: Build pipeline (`build.ts`) + unit tests

**Files:**

- Modify: `package.json` (root) — add `jszip` to devDependencies
- Create: `scripts/scenarios/lib/build.ts`
- Create: `scripts/scenarios/lib/__tests__/build.test.ts`

- [ ] **Step 1: Add jszip to root devDependencies**

Edit `package.json` at the repo root, adding to `devDependencies`:

```json
"jszip": "^3.10.1"
```

(version pinned to match what packages/server already uses).

Then install:

```
npm install
```

Expected: `node_modules/jszip` resolves at the root.

- [ ] **Step 2: Write the failing tests**

Create `scripts/scenarios/lib/__tests__/build.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import JSZip from 'jszip'
import { buildScenario } from '../build'
import type { ScenarioDefinition } from '../types'

async function makeScenarioRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'scenario-build-'))
  await mkdir(path.join(root, 'code', 'ActionA'), { recursive: true })
  await mkdir(path.join(root, 'code', 'ActionB'), { recursive: true })
  await writeFile(path.join(root, 'code', 'ActionA', 'STARTING.py'), 'starting_a')
  await writeFile(path.join(root, 'code', 'ActionA', 'EXECUTING.py'), 'executing_a')
  await writeFile(path.join(root, 'code', 'ActionB', 'IN_PROGRESS.py'), 'in_progress_b')
  return root
}

function makeScenario(rootDir: string): ScenarioDefinition {
  return {
    rootDir,
    library: { oid: 'lib-test-1', local_id: 'TestLib', version: '1.0.0' },
    environment: {
      oid: 'env-test-1',
      local_id: 'TestEnv',
      version: '1.0.0',
      schemaVersion: '4.0',
      action_property_specifications: [
        { name: 'SIMULATION_MODE', entries: [{ name: 'Value', value: 'false' }] },
      ],
    },
    actions: [
      {
        oid: 'act-a',
        local_id: 'ActionA',
        version: '1.0.0',
        visibility: 'observable',
        inputs: [],
        outputs: [{ id: 'status', value_type: 'literal', default_value: '0' }],
        code_states: ['STARTING', 'EXECUTING'],
      },
      {
        oid: 'act-b',
        local_id: 'ActionB',
        version: '1.0.0',
        visibility: 'opaque',
        inputs: [],
        outputs: [{ id: 'status', value_type: 'literal', default_value: '0' }],
        code_states: ['IN_PROGRESS'],
      },
    ],
  }
}

describe('buildScenario', () => {
  let outDir: string

  beforeEach(async () => {
    outDir = await mkdtemp(path.join(tmpdir(), 'scenario-out-'))
  })

  it('writes a .WFenvir at <outDir>/<library.local_id>.WFenvir', async () => {
    const root = await makeScenarioRoot()
    const scenario = makeScenario(root)
    const result = await buildScenario(scenario, outDir)

    expect(result.envFilePath).toBe(path.join(outDir, 'TestLib.WFenvir'))
    const content = JSON.parse(await readFile(result.envFilePath, 'utf-8'))
    expect(content.oid).toBe('lib-test-1')
    expect(content.local_id).toBe('TestLib')
    expect(content.version).toBe('1.0.0')
    expect(content.last_modified_date).toBeDefined()
    expect(content.environment_specifications).toHaveLength(1)
    expect(content.environment_specifications[0].oid).toBe('env-test-1')
    expect(content.environment_specifications[0].included_actions).toHaveLength(2)
    expect(content.environment_specifications[0].included_actions[0].oid).toBe('act-a')
    expect(content.environment_specifications[0].included_actions[0].action_visibility).toBe(
      'observable'
    )
    expect(
      content.environment_specifications[0].included_actions[0].last_modified_date
    ).toBeDefined()

    await rm(root, { recursive: true })
  })

  it('copies python source from <rootDir>/code/<action>/<state>.py to <outDir>/code/...', async () => {
    const root = await makeScenarioRoot()
    const scenario = makeScenario(root)
    const result = await buildScenario(scenario, outDir)

    expect(result.codeFiles).toHaveLength(3) // 2 for ActionA + 1 for ActionB
    const startingA = path.join(outDir, 'code', 'ActionA', 'STARTING.py')
    expect(await readFile(startingA, 'utf-8')).toBe('starting_a')

    await rm(root, { recursive: true })
  })

  it('produces a .WFactionCodeX ZIP per action under actions/', async () => {
    const root = await makeScenarioRoot()
    const scenario = makeScenario(root)
    const result = await buildScenario(scenario, outDir)

    expect(result.actionPackages).toHaveLength(2)
    const actionAPackage = result.actionPackages.find((p) => p.actionLocalId === 'ActionA')
    expect(actionAPackage?.path).toBe(path.join(outDir, 'actions', 'ActionA.WFactionCodeX'))

    const buf = await readFile(actionAPackage!.path)
    const zip = await JSZip.loadAsync(buf)

    const actionWFaction = zip.file('action.WFaction')
    expect(actionWFaction).not.toBeNull()
    const actionJson = JSON.parse(await actionWFaction!.async('text'))
    expect(actionJson.oid).toBe('act-a')
    expect(actionJson.environment_oid).toBe('env-test-1')
    expect(actionJson.action_visibility).toBe('observable')

    const startingPy = zip.file('code/STARTING.py')
    expect(startingPy).not.toBeNull()
    expect(await startingPy!.async('text')).toBe('starting_a')

    const executingPy = zip.file('code/EXECUTING.py')
    expect(executingPy).not.toBeNull()

    await rm(root, { recursive: true })
  })

  it('throws when a declared code_state has no .py file', async () => {
    const root = await makeScenarioRoot()
    const scenario = makeScenario(root)
    // ActionA declares STARTING + EXECUTING; add a third state that has no file.
    scenario.actions[0]!.code_states.push('COMPLETING')

    await expect(buildScenario(scenario, outDir)).rejects.toThrow(/COMPLETING\.py/)

    await rm(root, { recursive: true })
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

```
npm test -- scripts/scenarios/lib/__tests__/build.test.ts
```

Expected: 4 failures, all because `../build` doesn't exist yet.

> **Note on vitest discovery:** the project's root `npm test` runs `vitest run`, which uses `vitest.config.ts` files in each workspace. `scripts/scenarios/` is not a workspace today, so vitest may not find this test file by default. If `npm test` doesn't pick it up, run `npx vitest run scripts/scenarios/lib/__tests__/build.test.ts` directly. If vitest still complains about config, create a minimal `scripts/scenarios/vitest.config.ts`:
>
> ```ts
> import { defineConfig } from 'vitest/config'
> export default defineConfig({ test: { name: 'scenarios', environment: 'node' } })
> ```
>
> Add this only if needed.

- [ ] **Step 4: Implement `build.ts`**

Create `scripts/scenarios/lib/build.ts`:

```ts
import { mkdir, readFile, writeFile, copyFile, access } from 'node:fs/promises'
import path from 'node:path'
import JSZip from 'jszip'
import type {
  ActionDefinition,
  BuildResult,
  EnvironmentDefinition,
  ScenarioDefinition,
} from './types'

const FIXED_TIMESTAMP = '2026-05-09T00:00:00Z'

function actionDeclaration(
  action: ActionDefinition,
  environmentOid: string
): Record<string, unknown> {
  return {
    oid: action.oid,
    local_id: action.local_id,
    version: action.version,
    last_modified_date: FIXED_TIMESTAMP,
    environment_oid: environmentOid,
    action_visibility: action.visibility,
    description: action.description ?? null,
    input_parameter_specifications: action.inputs,
    output_parameter_specifications: action.outputs,
    property_specifications: action.property_specifications ?? [],
  }
}

function envDeclaration(
  env: EnvironmentDefinition,
  actions: ActionDefinition[]
): Record<string, unknown> {
  return {
    oid: env.oid,
    local_id: env.local_id,
    version: env.version,
    last_modified_date: FIXED_TIMESTAMP,
    schemaVersion: env.schemaVersion ?? '4.0',
    description: env.description ?? null,
    action_property_specifications: env.action_property_specifications ?? [],
    value_property_specifications: env.value_property_specifications ?? [],
    resource_property_specifications: env.resource_property_specifications ?? [],
    included_actions: actions.map((a) => actionDeclaration(a, env.oid)),
  }
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}

export async function buildScenario(
  scenario: ScenarioDefinition,
  outDir: string
): Promise<BuildResult> {
  // 1. Verify all declared code files exist; collect contents.
  const codeContents: Array<{
    action: ActionDefinition
    state: string
    sourcePath: string
    source: string
  }> = []
  for (const action of scenario.actions) {
    for (const state of action.code_states) {
      const sourcePath = path.join(scenario.rootDir, 'code', action.local_id, `${state}.py`)
      if (!(await fileExists(sourcePath))) {
        throw new Error(`Missing code file for ${action.local_id}/${state}: expected ${sourcePath}`)
      }
      const source = await readFile(sourcePath, 'utf-8')
      codeContents.push({ action, state, sourcePath, source })
    }
  }

  await mkdir(outDir, { recursive: true })
  await mkdir(path.join(outDir, 'code'), { recursive: true })
  await mkdir(path.join(outDir, 'actions'), { recursive: true })

  // 2. Write the library-level .WFenvir
  const envFilePath = path.join(outDir, `${scenario.library.local_id}.WFenvir`)
  const envJson = {
    oid: scenario.library.oid,
    local_id: scenario.library.local_id,
    version: scenario.library.version,
    last_modified_date: FIXED_TIMESTAMP,
    environment_specifications: [envDeclaration(scenario.environment, scenario.actions)],
  }
  await writeFile(envFilePath, JSON.stringify(envJson, null, 2), 'utf-8')

  // 3. Copy each .py file to <outDir>/code/<action>/<state>.py
  const codeFiles: BuildResult['codeFiles'] = []
  for (const { action, state, sourcePath } of codeContents) {
    const destPath = path.join(outDir, 'code', action.local_id, `${state}.py`)
    await mkdir(path.dirname(destPath), { recursive: true })
    await copyFile(sourcePath, destPath)
    codeFiles.push({
      actionOid: action.oid,
      actionLocalId: action.local_id,
      state,
      path: destPath,
    })
  }

  // 4. Build per-action .WFactionCodeX ZIPs
  const actionPackages: BuildResult['actionPackages'] = []
  for (const action of scenario.actions) {
    const zip = new JSZip()
    zip.file(
      'action.WFaction',
      JSON.stringify(actionDeclaration(action, scenario.environment.oid), null, 2)
    )
    for (const { state, source } of codeContents.filter((c) => c.action.oid === action.oid)) {
      zip.file(`code/${state}.py`, source)
    }
    const buf = await zip.generateAsync({ type: 'nodebuffer' })
    const zipPath = path.join(outDir, 'actions', `${action.local_id}.WFactionCodeX`)
    await writeFile(zipPath, buf)
    actionPackages.push({
      actionOid: action.oid,
      actionLocalId: action.local_id,
      path: zipPath,
    })
  }

  return {
    envFilePath,
    codeFiles,
    actionPackages,
    actions: scenario.actions,
    scenario,
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

```
npm test -- scripts/scenarios/lib/__tests__/build.test.ts
```

(Or `npx vitest run scripts/scenarios/lib/__tests__/build.test.ts` if step 3 needed the override.)

Expected: 4/4 pass.

- [ ] **Step 6: Commit**

```
git add package.json package-lock.json scripts/scenarios/lib/build.ts scripts/scenarios/lib/__tests__/build.test.ts
git commit -m "feat(scenarios): build pipeline emits .WFenvir + per-action .WFactionCodeX"
```

---

## Task 4: Upload pipeline (`upload.ts`)

**Files:**

- Create: `scripts/scenarios/lib/upload.ts`

- [ ] **Step 1: Create `upload.ts`**

Write `scripts/scenarios/lib/upload.ts`:

```ts
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { BuildResult } from './types'

export interface UploadBulkResult {
  envImported: boolean
  codeUploaded: number
  codeFailed: Array<{ actionLocalId: string; state: string; error: string }>
  timeoutsSet: number
}

export interface UploadPerActionResult {
  actionsImported: number
  actionsFailed: Array<{ actionLocalId: string; error: string }>
  timeoutsSet: number
}

async function postFile(
  serverUrl: string,
  filePath: string,
  filename: string,
  contentType: string
): Promise<Response> {
  const buf = await readFile(filePath)
  const form = new FormData()
  // Node's FormData accepts Blob; build one from the buffer.
  const blob = new Blob([buf], { type: contentType })
  form.append('files', blob, filename)
  return fetch(`${serverUrl}/management/v1/upload`, { method: 'POST', body: form })
}

async function setTimeoutForAction(
  serverUrl: string,
  oid: string,
  timeout_seconds: number | null
): Promise<void> {
  const res = await fetch(`${serverUrl}/management/v1/actions/${oid}/timeout`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ timeout_seconds }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Failed to set timeout for ${oid}: ${res.status} ${text}`)
  }
}

export async function uploadScenarioBulk(
  build: BuildResult,
  serverUrl: string
): Promise<UploadBulkResult> {
  const result: UploadBulkResult = {
    envImported: false,
    codeUploaded: 0,
    codeFailed: [],
    timeoutsSet: 0,
  }

  // 1. POST .WFenvir
  const envRes = await postFile(
    serverUrl,
    build.envFilePath,
    path.basename(build.envFilePath),
    'application/json'
  )
  if (!envRes.ok) {
    const text = await envRes.text()
    throw new Error(`Env upload failed: ${envRes.status} ${text}`)
  }
  result.envImported = true

  // 2. POST each code file
  for (const cf of build.codeFiles) {
    const source = await readFile(cf.path, 'utf-8')
    const res = await fetch(`${serverUrl}/management/v1/code/${cf.actionOid}/${cf.state}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source_code: source, description: 'scenario import' }),
    })
    if (res.ok) {
      result.codeUploaded += 1
    } else {
      const text = await res.text()
      result.codeFailed.push({
        actionLocalId: cf.actionLocalId,
        state: cf.state,
        error: `${res.status} ${text}`,
      })
    }
  }

  // 3. Apply per-action timeouts
  for (const action of build.actions) {
    if (action.timeout_seconds !== undefined) {
      await setTimeoutForAction(serverUrl, action.oid, action.timeout_seconds)
      result.timeoutsSet += 1
    }
  }

  return result
}

export async function uploadScenarioPerAction(
  build: BuildResult,
  serverUrl: string
): Promise<UploadPerActionResult> {
  const result: UploadPerActionResult = {
    actionsImported: 0,
    actionsFailed: [],
    timeoutsSet: 0,
  }

  // First post a minimal env shell so action environment_oid references resolve.
  // We POST the same .WFenvir that build produced — re-importing is idempotent.
  const envRes = await postFile(
    serverUrl,
    build.envFilePath,
    path.basename(build.envFilePath),
    'application/json'
  )
  if (!envRes.ok) {
    const text = await envRes.text()
    throw new Error(`Env upload failed: ${envRes.status} ${text}`)
  }

  // Now post each .WFactionCodeX
  for (const pkg of build.actionPackages) {
    const res = await postFile(serverUrl, pkg.path, path.basename(pkg.path), 'application/zip')
    if (res.ok) {
      result.actionsImported += 1
    } else {
      const text = await res.text()
      result.actionsFailed.push({
        actionLocalId: pkg.actionLocalId,
        error: `${res.status} ${text}`,
      })
    }
  }

  // Apply per-action timeouts
  for (const action of build.actions) {
    if (action.timeout_seconds !== undefined) {
      await setTimeoutForAction(serverUrl, action.oid, action.timeout_seconds)
      result.timeoutsSet += 1
    }
  }

  return result
}

export async function uploadActionPackage(
  filePath: string,
  serverUrl: string
): Promise<{ ok: boolean; status: number; body: string }> {
  const res = await postFile(serverUrl, filePath, path.basename(filePath), 'application/zip')
  const body = await res.text()
  return { ok: res.ok, status: res.status, body }
}
```

- [ ] **Step 2: Verify type check**

```
npx tsc --noEmit scripts/scenarios/lib/upload.ts
```

Expected: clean.

- [ ] **Step 3: Commit**

```
git add scripts/scenarios/lib/upload.ts
git commit -m "feat(scenarios): upload pipeline (bulk + per-action paths)"
```

---

## Task 5: CLI entrypoint

**Files:**

- Create: `scripts/scenarios/cli.ts`

- [ ] **Step 1: Create `cli.ts`**

Write `scripts/scenarios/cli.ts`:

```ts
#!/usr/bin/env node
import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildScenario } from './lib/build'
import { uploadScenarioBulk, uploadScenarioPerAction, uploadActionPackage } from './lib/upload'
import type { ScenarioDefinition } from './lib/types'

const __filename = fileURLToPath(import.meta.url)
const SCENARIOS_DIR = path.dirname(__filename)
const DEFAULT_SERVER = 'http://localhost:3002'

interface ParsedArgs {
  command: string
  positional: string[]
  options: Record<string, string>
}

function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2)
  const command = args.shift() ?? ''
  const positional: string[] = []
  const options: Record<string, string> = {}
  for (let i = 0; i < args.length; i++) {
    const tok = args[i]!
    if (tok.startsWith('--')) {
      const key = tok.slice(2)
      const next = args[i + 1]
      if (next && !next.startsWith('--')) {
        options[key] = next
        i++
      } else {
        options[key] = 'true'
      }
    } else {
      positional.push(tok)
    }
  }
  return { command, positional, options }
}

async function loadScenario(name: string): Promise<ScenarioDefinition> {
  const definitionPath = path.join(SCENARIOS_DIR, name, 'definition.ts')
  // tsx imports .ts directly; use a file URL for cross-platform safety.
  const url = `file://${definitionPath.replaceAll('\\', '/')}`
  const mod = (await import(url)) as { scenario: ScenarioDefinition }
  if (!mod.scenario) {
    throw new Error(
      `${definitionPath} must export a const named 'scenario' of type ScenarioDefinition`
    )
  }
  return mod.scenario
}

async function listScenarios(): Promise<string[]> {
  const entries = await readdir(SCENARIOS_DIR, { withFileTypes: true })
  return entries
    .filter((e) => e.isDirectory() && e.name !== 'lib' && e.name !== 'dist')
    .map((e) => e.name)
}

async function main() {
  const { command, positional, options } = parseArgs(process.argv)
  const server = options['server'] ?? DEFAULT_SERVER

  if (command === 'list') {
    const names = await listScenarios()
    console.log(names.join('\n'))
    return
  }

  if (command === 'build') {
    const name = positional[0]
    if (!name) throw new Error('Usage: build <scenario>')
    const scenario = await loadScenario(name)
    const outDir = options['out'] ?? path.join(SCENARIOS_DIR, 'dist', name)
    const result = await buildScenario(scenario, outDir)
    console.log(`Built ${result.actions.length} actions`)
    console.log(`  env file:           ${result.envFilePath}`)
    console.log(`  code files:         ${result.codeFiles.length}`)
    console.log(`  .WFactionCodeX zips: ${result.actionPackages.length}`)
    return
  }

  if (command === 'upload') {
    const name = positional[0]
    if (!name) throw new Error('Usage: upload <scenario>')
    const scenario = await loadScenario(name)
    const outDir = options['out'] ?? path.join(SCENARIOS_DIR, 'dist', name)
    const build = await buildScenario(scenario, outDir)
    const result = await uploadScenarioBulk(build, server)
    console.log('Bulk upload result:', JSON.stringify(result, null, 2))
    if (result.codeFailed.length > 0) process.exit(1)
    return
  }

  if (command === 'upload-actions') {
    const name = positional[0]
    if (!name) throw new Error('Usage: upload-actions <scenario>')
    const scenario = await loadScenario(name)
    const outDir = options['out'] ?? path.join(SCENARIOS_DIR, 'dist', name)
    const build = await buildScenario(scenario, outDir)
    const result = await uploadScenarioPerAction(build, server)
    console.log('Per-action upload result:', JSON.stringify(result, null, 2))
    if (result.actionsFailed.length > 0) process.exit(1)
    return
  }

  if (command === 'upload-action') {
    const filePath = positional[0]
    if (!filePath) throw new Error('Usage: upload-action <path-to.WFactionCodeX>')
    const result = await uploadActionPackage(filePath, server)
    console.log(`status=${result.status} ok=${result.ok}`)
    console.log(result.body)
    if (!result.ok) process.exit(1)
    return
  }

  if (command === 'deploy') {
    const name = positional[0]
    if (!name) throw new Error('Usage: deploy <scenario>')
    const scenario = await loadScenario(name)
    const outDir = options['out'] ?? path.join(SCENARIOS_DIR, 'dist', name)
    const build = await buildScenario(scenario, outDir)
    const result = await uploadScenarioPerAction(build, server)
    console.log('Deploy result:', JSON.stringify(result, null, 2))
    if (result.actionsFailed.length > 0) process.exit(1)
    return
  }

  console.error(`Unknown command: ${command}`)
  console.error('Commands: list | build | upload | upload-actions | upload-action | deploy')
  process.exit(2)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
```

- [ ] **Step 2: Verify type check**

```
npx tsc --noEmit scripts/scenarios/cli.ts
```

Expected: clean.

- [ ] **Step 3: Commit**

```
git add scripts/scenarios/cli.ts
git commit -m "feat(scenarios): CLI entrypoint with build/upload/deploy commands"
```

---

## Task 6: Warehouse content (definition + stub Python + README)

**Files:**

- Create: `scripts/scenarios/warehouse/definition.ts`
- Create: `scripts/scenarios/warehouse/code/<action>/<state>.py` × 34
- Create: `scripts/scenarios/warehouse/README.md`
- Modify: `.gitignore`

- [ ] **Step 1: Update `.gitignore`**

Append to `.gitignore`:

```
# Scenario generator output
scripts/scenarios/dist/
```

- [ ] **Step 2: Create `scripts/scenarios/warehouse/definition.ts`**

Write the file with all 10 action declarations. Use this exact content:

```ts
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ScenarioDefinition, ParameterSpec } from '../lib/types'

const rootDir = dirname(fileURLToPath(import.meta.url))

const STATUS_OUTPUT: ParameterSpec = {
  id: 'status',
  value_type: 'literal',
  default_value: '0',
  description: '0=success, 1=simulated abort, 2=simulated timeout',
}

const OBSERVABLE_STATES = ['STARTING', 'EXECUTING', 'COMPLETING', 'ABORTING']
const OPAQUE_STATES = ['IN_PROGRESS', 'ABORTING']

export const scenario: ScenarioDefinition = {
  rootDir,
  library: {
    oid: 'lib-warehouse-001',
    local_id: 'WarehouseLibrary',
    version: '1.0.0',
  },
  environment: {
    oid: 'env-warehouse-001',
    local_id: 'AutomatedWarehouse',
    version: '1.0.0',
    schemaVersion: '4.0',
    description:
      'Automated warehouse simulation with 10 actions and SIMULATION_MODE failure injection.',
    action_property_specifications: [
      {
        name: 'SIMULATION_MODE',
        entries: [
          { name: 'Value', value: 'false' },
          {
            name: 'Description',
            value: 'When "true", actions inject random failures (~10% per execution)',
          },
        ],
      },
    ],
    value_property_specifications: [],
    resource_property_specifications: [],
  },
  actions: [
    {
      oid: 'act-wh-pick-001',
      local_id: 'PickItem',
      version: '1.0.0',
      visibility: 'observable',
      description: 'Retrieve an item from a warehouse shelf location',
      inputs: [
        { id: 'shelf_location', value_type: 'literal', default_value: 'BIN-A1' },
        { id: 'item_sku', value_type: 'literal', default_value: 'SKU-1001' },
        { id: 'quantity', value_type: 'literal', default_value: '1' },
      ],
      outputs: [
        { id: 'picked_quantity', value_type: 'literal', default_value: '0' },
        { id: 'pick_status', value_type: 'literal', default_value: '' },
        STATUS_OUTPUT,
      ],
      code_states: OBSERVABLE_STATES,
      timeout_seconds: 3,
    },
    {
      oid: 'act-wh-putaway-001',
      local_id: 'PutawayItem',
      version: '1.0.0',
      visibility: 'observable',
      description: 'Place an item onto a shelf location',
      inputs: [
        { id: 'shelf_location', value_type: 'literal', default_value: 'BIN-B2' },
        { id: 'item_sku', value_type: 'literal', default_value: 'SKU-2001' },
        { id: 'quantity', value_type: 'literal', default_value: '1' },
      ],
      outputs: [
        { id: 'stored_quantity', value_type: 'literal', default_value: '0' },
        STATUS_OUTPUT,
      ],
      code_states: OBSERVABLE_STATES,
      timeout_seconds: 3,
    },
    {
      oid: 'act-wh-move-001',
      local_id: 'MoveItem',
      version: '1.0.0',
      visibility: 'observable',
      description: 'Move an item between two shelf locations',
      inputs: [
        { id: 'from_location', value_type: 'literal', default_value: 'BIN-A1' },
        { id: 'to_location', value_type: 'literal', default_value: 'BIN-A2' },
        { id: 'item_sku', value_type: 'literal', default_value: 'SKU-1001' },
      ],
      outputs: [STATUS_OUTPUT],
      code_states: OBSERVABLE_STATES,
      timeout_seconds: 3,
    },
    {
      oid: 'act-wh-consolidate-001',
      local_id: 'ConsolidateOrder',
      version: '1.0.0',
      visibility: 'observable',
      description: 'Consolidate items into a customer order pallet',
      inputs: [
        { id: 'order_id', value_type: 'literal', default_value: 'ORD-9001' },
        { id: 'item_count', value_type: 'literal', default_value: '5' },
      ],
      outputs: [{ id: 'pallet_id', value_type: 'literal', default_value: '' }, STATUS_OUTPUT],
      code_states: OBSERVABLE_STATES,
      timeout_seconds: 3,
    },
    {
      oid: 'act-wh-cyclecount-001',
      local_id: 'CycleCount',
      version: '1.0.0',
      visibility: 'observable',
      description: 'Cycle-count items in a zone',
      inputs: [{ id: 'zone', value_type: 'literal', default_value: 'A' }],
      outputs: [
        { id: 'discrepancy_count', value_type: 'literal', default_value: '0' },
        STATUS_OUTPUT,
      ],
      code_states: OBSERVABLE_STATES,
      timeout_seconds: 3,
    },
    {
      oid: 'act-wh-receive-001',
      local_id: 'ReceiveShipment',
      version: '1.0.0',
      visibility: 'observable',
      description: 'Receive an inbound shipment',
      inputs: [
        { id: 'shipment_id', value_type: 'literal', default_value: 'SHP-1001' },
        { id: 'expected_count', value_type: 'literal', default_value: '50' },
      ],
      outputs: [{ id: 'received_count', value_type: 'literal', default_value: '0' }, STATUS_OUTPUT],
      code_states: OBSERVABLE_STATES,
      timeout_seconds: 3,
    },
    {
      oid: 'act-wh-ship-001',
      local_id: 'ShipOrder',
      version: '1.0.0',
      visibility: 'observable',
      description: 'Ship a consolidated order',
      inputs: [
        { id: 'order_id', value_type: 'literal', default_value: 'ORD-9001' },
        { id: 'carrier', value_type: 'literal', default_value: 'GROUND' },
      ],
      outputs: [{ id: 'tracking_number', value_type: 'literal', default_value: '' }, STATUS_OUTPUT],
      code_states: OBSERVABLE_STATES,
      timeout_seconds: 3,
    },
    {
      oid: 'act-wh-updateinv-001',
      local_id: 'UpdateInventoryDB',
      version: '1.0.0',
      visibility: 'opaque',
      description: 'Background DB update for inventory deltas',
      inputs: [
        { id: 'sku', value_type: 'literal', default_value: 'SKU-1001' },
        { id: 'delta', value_type: 'literal', default_value: '1' },
      ],
      outputs: [STATUS_OUTPUT],
      code_states: OPAQUE_STATES,
      timeout_seconds: 3,
    },
    {
      oid: 'act-wh-scan-001',
      local_id: 'ScanBarcode',
      version: '1.0.0',
      visibility: 'opaque',
      description: 'Scan a barcode and resolve to SKU',
      inputs: [{ id: 'barcode', value_type: 'literal', default_value: '0123456789012' }],
      outputs: [{ id: 'sku', value_type: 'literal', default_value: '' }, STATUS_OUTPUT],
      code_states: OPAQUE_STATES,
      timeout_seconds: 3,
    },
    {
      oid: 'act-wh-print-001',
      local_id: 'PrintLabel',
      version: '1.0.0',
      visibility: 'opaque',
      description: 'Print a shipping or shelf label',
      inputs: [
        { id: 'label_type', value_type: 'literal', default_value: 'shelf' },
        { id: 'content', value_type: 'literal', default_value: 'BIN-A1' },
      ],
      outputs: [STATUS_OUTPUT],
      code_states: OPAQUE_STATES,
      timeout_seconds: 3,
    },
  ],
}
```

- [ ] **Step 3: Create the 34 stub Python files**

Use a one-liner shell loop to create them. From the repo root, in PowerShell:

```powershell
$obs = @('PickItem','PutawayItem','MoveItem','ConsolidateOrder','CycleCount','ReceiveShipment','ShipOrder')
$obsStates = @('STARTING','EXECUTING','COMPLETING','ABORTING')
foreach ($a in $obs) {
  New-Item -ItemType Directory -Force -Path "scripts/scenarios/warehouse/code/$a" | Out-Null
  foreach ($s in $obsStates) {
    Set-Content -Path "scripts/scenarios/warehouse/code/$a/$s.py" -Value "outputs['status'] = '0'`n" -NoNewline
  }
}
$opaque = @('UpdateInventoryDB','ScanBarcode','PrintLabel')
$opaqueStates = @('IN_PROGRESS','ABORTING')
foreach ($a in $opaque) {
  New-Item -ItemType Directory -Force -Path "scripts/scenarios/warehouse/code/$a" | Out-Null
  foreach ($s in $opaqueStates) {
    Set-Content -Path "scripts/scenarios/warehouse/code/$a/$s.py" -Value "outputs['status'] = '0'`n" -NoNewline
  }
}
```

Or in bash:

```bash
for a in PickItem PutawayItem MoveItem ConsolidateOrder CycleCount ReceiveShipment ShipOrder; do
  for s in STARTING EXECUTING COMPLETING ABORTING; do
    mkdir -p "scripts/scenarios/warehouse/code/$a"
    printf "outputs['status'] = '0'\n" > "scripts/scenarios/warehouse/code/$a/$s.py"
  done
done
for a in UpdateInventoryDB ScanBarcode PrintLabel; do
  for s in IN_PROGRESS ABORTING; do
    mkdir -p "scripts/scenarios/warehouse/code/$a"
    printf "outputs['status'] = '0'\n" > "scripts/scenarios/warehouse/code/$a/$s.py"
  done
done
```

After running, verify the count is 34:

```
find scripts/scenarios/warehouse/code -name '*.py' | wc -l
```

Expected: 34. (7 actions × 4 states + 3 actions × 2 states = 28 + 6 = 34.)

> Why a stub of just `outputs['status'] = '0'`? Phase 1's verification is "all 10 actions complete with status=0". The stub satisfies that for every state. Phase 2-4 replace these with simulation-aware Python.

- [ ] **Step 4: Create README**

Write `scripts/scenarios/warehouse/README.md`:

````markdown
# Automated Warehouse Test Scenario — Manual Walkthrough

A self-contained scenario with 10 actions (7 observable + 3 opaque) for testing
the Action Container's full ISA-88 state machine. Includes a `SIMULATION_MODE`
toggle for failure injection (Phases 2-4 — Phase 1 stubs all states with
`outputs['status'] = '0'`).

## Build + deploy

```bash
# 1. Start the dev stack (server on :3002, console on :5176)
npm run dev

# 2. In another terminal, build + deploy the scenario
npx tsx scripts/scenarios/cli.ts deploy warehouse --server http://localhost:3002
```

`deploy` builds the artifacts under `scripts/scenarios/dist/warehouse/` and uploads
each action via the per-action `.WFactionCodeX` path (recommended).

## What you should see in the console

1. Navigate to the console (default `http://localhost:5176/`).
2. Open the **Explorer** panel. Expand `AutomatedWarehouse` — all 10 actions appear.
3. Click `PickItem`. The right pane shows:
   - Input Parameters: `shelf_location`, `item_sku`, `quantity`
   - Output Parameters: `picked_quantity`, `pick_status`, **`status`** (the cross-cutting one)
   - Action Properties (none on this action)
   - Execution Settings: timeout = 3 seconds
4. The center pane shows the Code Status table — `STARTING`, `EXECUTING`, `COMPLETING`,
   `ABORTING` rows all show `active` (the stub is loaded).
5. Open the code editor for `PickItem / EXECUTING` — see `outputs['status'] = '0'`.

## Invoke an action

Send a `POST /trajectory/v1/invoke` to the running server with the action's OID:

```bash
curl -X POST http://localhost:3002/trajectory/v1/invoke \
  -H 'Content-Type: application/json' \
  -d '{
    "action_oid": "act-wh-pick-001",
    "inputs": { "shelf_location": "BIN-A1", "item_sku": "SKU-1001", "quantity": "1" }
  }'
```

The response includes an `instance_id`. Poll `GET /trajectory/v1/instances/<id>` until
the state is terminal. Expected: `state: "COMPLETED"`, `outputs.status: "0"`.

## Per-action iteration loop

Edited `scripts/scenarios/warehouse/code/PickItem/EXECUTING.py`? Push just that
action without redeploying everything:

```bash
npx tsx scripts/scenarios/cli.ts build warehouse  # rebuild artifacts
npx tsx scripts/scenarios/cli.ts upload-action \
  scripts/scenarios/dist/warehouse/actions/PickItem.WFactionCodeX
```

The server upserts the action (idempotent) and saves+activates the new code as a
new version.

## Phase 1 vs later phases

Phase 1 (this scaffold) ships stubs that always set `status = '0'`. Phases 2-4
replace these with simulation-aware Python that reads
`props["SIMULATION_MODE"]["Value"]` and injects ~10% failures when set to `true`.
````

- [ ] **Step 5: Run the build to sanity-check**

```
npx tsx scripts/scenarios/cli.ts build warehouse
```

Expected output:

```
Built 10 actions
  env file:           <repo>/scripts/scenarios/dist/warehouse/WarehouseLibrary.WFenvir
  code files:         34
  .WFactionCodeX zips: 10
```

Verify the env file is valid JSON:

```
node --input-type=module -e "import('node:fs/promises').then(({readFile}) => readFile('scripts/scenarios/dist/warehouse/WarehouseLibrary.WFenvir', 'utf-8')).then(s => console.log(JSON.parse(s).environment_specifications[0].included_actions.length))"
```

Expected: `10`.

- [ ] **Step 6: Commit**

```
git add .gitignore scripts/scenarios/warehouse/
git commit -m "feat(scenarios): warehouse env scaffold with stub python"
```

---

## Task 7: Integration test (`scenario-warehouse.test.ts`)

**Files:**

- Create: `packages/server/src/__tests__/scenario-warehouse.test.ts`

- [ ] **Step 1: Write the test file**

Create `packages/server/src/__tests__/scenario-warehouse.test.ts`:

```ts
/**
 * scenario-warehouse.test.ts — End-to-end coverage for the warehouse scaffold.
 *
 * Exercises:
 *   - buildScenario() → artifact generation
 *   - /upload via .WFenvir (bulk env path)
 *   - /upload via .WFactionCodeX (per-action path)
 *   - /trajectory/v1/invoke each action with SIMULATION_MODE=false → status=0
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import express from 'express'
import cors from 'cors'
import http from 'node:http'
import {
  initializeDatabase,
  ActionRepository,
  InstanceRepository,
  SettingsRepository,
  EnvironmentRepository,
  CodeVersionRepository,
  LogRepository,
} from '@trajectory/storage'
import type BetterSqlite3 from 'better-sqlite3'
import { InstanceManager } from '@trajectory/engine'
import type { Instance } from '@trajectory/storage'
import { SseManager } from '../sse-manager.js'
import { createManagementRouter } from '../routes/management.js'
import { createProtocolRouter } from '../routes/protocol.js'
import { errorHandler } from '../middleware/error-handler.js'
import { buildScenario } from '../../../../scripts/scenarios/lib/build'
import {
  uploadScenarioBulk,
  uploadScenarioPerAction,
} from '../../../../scripts/scenarios/lib/upload'
import { scenario as warehouseScenario } from '../../../../scripts/scenarios/warehouse/definition'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const SCRIPT_PATH = path.resolve(__dirname, '../../../python-sidecar/sandbox_runner.py')

interface TestApp {
  serverUrl: string
  server: http.Server
  manager: InstanceManager
  db: BetterSqlite3.Database
  environmentRepo: EnvironmentRepository
  actionRepo: ActionRepository
  codeVersionRepo: CodeVersionRepository
}

async function startTestServer(): Promise<TestApp> {
  const db = initializeDatabase(':memory:')
  const environmentRepo = new EnvironmentRepository(db)
  const actionRepo = new ActionRepository(db)
  const codeVersionRepo = new CodeVersionRepository(db)
  const instanceRepo = new InstanceRepository(db)
  const logRepo = new LogRepository(db)
  const settingsRepo = new SettingsRepository(db)
  const sseManager = new SseManager()

  const manager = new InstanceManager(db, {
    scriptPath: SCRIPT_PATH,
    poolSize: 2,
    onStateChange: (instanceId: string, state: string, instance: Instance) => {
      const history = instance.state_history as Array<{ state: string; timestamp: string }>
      const prev = history.length >= 2 ? (history[history.length - 2]?.state ?? '') : ''
      sseManager.publishStateChange(instanceId, state, prev, instance)
    },
    onTerminal: (instanceId: string, state: string, instance: Instance) => {
      const history = instance.state_history as Array<{ state: string; timestamp: string }>
      const prev = history.length >= 2 ? (history[history.length - 2]?.state ?? '') : ''
      sseManager.publishTerminal(instanceId, state, prev, instance)
    },
    onError: (instanceId: string, error: Error) => {
      sseManager.publishError(instanceId, error.message)
    },
  })

  const app = express()
  app.use(cors({ origin: '*', methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'] }))
  app.use(express.json())
  app.use(
    '/management/v1',
    createManagementRouter(
      db,
      ':memory:',
      manager,
      environmentRepo,
      actionRepo,
      codeVersionRepo,
      instanceRepo,
      logRepo,
      settingsRepo
    )
  )
  app.use(
    '/trajectory/v1',
    createProtocolRouter(manager, actionRepo, instanceRepo, settingsRepo, sseManager)
  )
  app.use(errorHandler)

  const server = await new Promise<http.Server>((resolve) => {
    const s = app.listen(0, () => resolve(s))
  })
  const addr = server.address()
  if (!addr || typeof addr === 'string') throw new Error('server failed to bind')
  const serverUrl = `http://127.0.0.1:${addr.port}`

  return { serverUrl, server, manager, db, environmentRepo, actionRepo, codeVersionRepo }
}

async function awaitTerminal(
  serverUrl: string,
  instanceId: string,
  timeoutMs = 30_000
): Promise<{ state: string; outputs: Record<string, string> }> {
  const start = Date.now()
  const TERMINAL = new Set(['COMPLETED', 'ABORTED', 'STOPPED'])
  while (Date.now() - start < timeoutMs) {
    const res = await fetch(`${serverUrl}/trajectory/v1/instances/${instanceId}`)
    if (res.ok) {
      const body = (await res.json()) as {
        data: { state: string; outputs: Record<string, string> }
      }
      if (TERMINAL.has(body.data.state)) {
        return { state: body.data.state, outputs: body.data.outputs }
      }
    }
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error(`Instance ${instanceId} did not reach terminal in ${timeoutMs}ms`)
}

describe('scenario-warehouse: end-to-end', () => {
  let testApp: TestApp
  let outDir: string

  beforeAll(async () => {
    testApp = await startTestServer()
    outDir = await mkdtemp(path.join(tmpdir(), 'warehouse-build-'))
  }, 30_000)

  afterAll(async () => {
    await testApp.manager.shutdown()
    await new Promise<void>((resolve) => testApp.server.close(() => resolve()))
    testApp.db.close()
  })

  it('builds the warehouse scenario into deployable artifacts', async () => {
    const result = await buildScenario(warehouseScenario, outDir)
    expect(result.actions).toHaveLength(10)
    expect(result.codeFiles).toHaveLength(34)
    expect(result.actionPackages).toHaveLength(10)
  })

  it('imports the warehouse via the bulk .WFenvir + per-state code path', async () => {
    const result = await buildScenario(warehouseScenario, outDir)
    const upload = await uploadScenarioBulk(result, testApp.serverUrl)
    expect(upload.envImported).toBe(true)
    expect(upload.codeFailed).toEqual([])
    expect(upload.codeUploaded).toBe(34)
    expect(upload.timeoutsSet).toBe(10)

    // Verify each action exists with the right code count
    for (const action of result.actions) {
      const dbAction = testApp.actionRepo.findByOid(action.oid)
      expect(dbAction, `action ${action.local_id} not in DB`).not.toBeNull()
      const versions = result.codeFiles.filter((cf) => cf.actionOid === action.oid)
      for (const cf of versions) {
        const active = testApp.codeVersionRepo.getActive(action.oid, cf.state)
        expect(active, `${action.local_id}/${cf.state} has no active code`).not.toBeNull()
      }
    }
  })

  it('reimports the warehouse via the per-action .WFactionCodeX path (idempotent upsert)', async () => {
    const result = await buildScenario(warehouseScenario, outDir)
    const upload = await uploadScenarioPerAction(result, testApp.serverUrl)
    expect(upload.actionsFailed).toEqual([])
    expect(upload.actionsImported).toBe(10)
  })

  it('invokes each action with SIMULATION_MODE=false and gets status=0', async () => {
    // Each action × at least one happy-path invocation
    for (const action of warehouseScenario.actions) {
      // Build inputs from declared defaults
      const inputs: Record<string, string> = {}
      for (const inp of action.inputs) {
        inputs[inp.id] = inp.default_value
      }

      const invokeRes = await fetch(`${testApp.serverUrl}/trajectory/v1/invoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action_oid: action.oid, inputs }),
      })
      expect(invokeRes.status, `${action.local_id} invoke failed`).toBe(201)
      const body = (await invokeRes.json()) as { data: { instance_id: string } }
      const terminal = await awaitTerminal(testApp.serverUrl, body.data.instance_id)
      expect(terminal.state, `${action.local_id} ended in ${terminal.state}`).toBe('COMPLETED')
      expect(terminal.outputs.status, `${action.local_id} status`).toBe('0')
    }
  }, 90_000)
})
```

- [ ] **Step 2: Run the test**

```
npm test -- packages/server/src/__tests__/scenario-warehouse.test.ts
```

Expected: 4/4 pass.

> If the import path `'../../../../scripts/scenarios/lib/build'` doesn't resolve (TypeScript tsconfig restrictions), add `"include"` entries to `packages/server/tsconfig.json` covering `../../../scripts/scenarios/**/*.ts`. Verify the import compiles before running the test.

- [ ] **Step 3: Run the full test suite to confirm no regressions**

```
npm test
```

Expected: all tests pass (previous count + new tests).

- [ ] **Step 4: Commit**

```
git add packages/server/src/__tests__/scenario-warehouse.test.ts
git commit -m "test(scenarios): warehouse end-to-end integration test"
```

---

## Task 8: Manual smoke + final commit

**Files:** none modified directly (this is verification + cleanup).

- [ ] **Step 1: Start the dev stack**

In one terminal:

```
npm run dev
```

Wait for "server on :3002" and Vite ready messages.

- [ ] **Step 2: Deploy the warehouse**

In another terminal:

```
npx tsx scripts/scenarios/cli.ts deploy warehouse --server http://localhost:3002
```

Expected: `actionsImported: 10, actionsFailed: [], timeoutsSet: 10`.

- [ ] **Step 3: Open the console and walk through the README checklist**

Open `http://localhost:5176/` in a browser. Follow `scripts/scenarios/warehouse/README.md` "What you should see in the console" — verify each item visually:

- 10 actions appear under `AutomatedWarehouse`
- `PickItem` right pane shows the declared inputs/outputs including `status`
- Code Status table shows `active` for all 4 states
- Code editor for `PickItem / EXECUTING` shows `outputs['status'] = '0'`

- [ ] **Step 4: Curl-invoke one action**

```bash
curl -X POST http://localhost:3002/trajectory/v1/invoke \
  -H 'Content-Type: application/json' \
  -d '{"action_oid":"act-wh-pick-001","inputs":{"shelf_location":"BIN-A1","item_sku":"SKU-1001","quantity":"1"}}'
```

Note the `instance_id`, then:

```bash
curl http://localhost:3002/trajectory/v1/instances/<instance_id>
```

Expected: terminal `state: "COMPLETED"`, `outputs.status: "0"`.

- [ ] **Step 5: If anything's off, fix and recommit; otherwise nothing to commit**

If the manual walkthrough revealed an issue (e.g., a typo in the README, a missing field), fix and:

```
git add <fixed files>
git commit -m "chore(scenarios): manual-test cleanup"
```

If everything passes cleanly, no further commit needed.

- [ ] **Step 6: Stop the dev server**

Ctrl-C the dev server.

---

## Summary of expected commits

1. `feat(management): accept .WFactionCodeX in /upload endpoint`
2. `feat(scenarios): TypeScript types for scenario definitions`
3. `feat(scenarios): build pipeline emits .WFenvir + per-action .WFactionCodeX`
4. `feat(scenarios): upload pipeline (bulk + per-action paths)`
5. `feat(scenarios): CLI entrypoint with build/upload/deploy commands`
6. `feat(scenarios): warehouse env scaffold with stub python`
7. `test(scenarios): warehouse end-to-end integration test`
8. (optional) `chore(scenarios): manual-test cleanup`
