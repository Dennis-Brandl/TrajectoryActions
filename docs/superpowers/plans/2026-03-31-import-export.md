# Import/Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add action code export/import (`.WFactionCode` ZIP) and container snapshot export/import (`.WFsnapshot` ZIP) to the Trajectory Action Container.

**Architecture:** Four new management API endpoints handle ZIP creation/parsing server-side using `jszip`. The backend builds ZIPs in memory and streams them as downloads; imports accept multipart uploads. The console adds export/import buttons on ActionDetailPage and a snapshot section on SettingsPage.

**Tech Stack:** jszip (ZIP handling), Express + multer (upload), React + React Query (UI), supertest + vitest (tests)

---

## File Structure

### New Files

| File                                                        | Responsibility                                                  |
| ----------------------------------------------------------- | --------------------------------------------------------------- |
| `packages/server/src/routes/export-import.ts`               | All 4 export/import route handlers (action code + snapshot)     |
| `packages/server/src/__tests__/export-import.test.ts`       | Integration tests for all 4 endpoints                           |
| `apps/console/src/features/actions/ExportImportButtons.tsx` | Export/Import Code buttons + import dialog for ActionDetailPage |
| `apps/console/src/features/settings/SnapshotSection.tsx`    | Export/Import Snapshot section with confirmation dialog         |

### Modified Files

| File                                                     | Change                                                       |
| -------------------------------------------------------- | ------------------------------------------------------------ |
| `packages/server/package.json`                           | Add `jszip` dependency                                       |
| `packages/server/src/routes/management.ts`               | Mount export-import sub-router                               |
| `apps/console/src/lib/api.ts`                            | Add 4 new API methods (export/import action code + snapshot) |
| `apps/console/src/lib/types.ts`                          | Add `ImportCodeResult` and `ImportSnapshotResult` types      |
| `apps/console/src/features/actions/ActionDetailPage.tsx` | Add `<ExportImportButtons>` component                        |
| `apps/console/src/features/settings/SettingsPage.tsx`    | Add `<SnapshotSection>` component                            |

---

## Task 1: Install jszip dependency

**Files:**

- Modify: `packages/server/package.json`

- [ ] **Step 1: Install jszip**

```bash
cd packages/server && npm install jszip
```

- [ ] **Step 2: Verify it resolves**

```bash
cd /c/TrajectoryActions && node -e "import('jszip').then(m => console.log('jszip', typeof m.default))"
```

Expected: `jszip function`

- [ ] **Step 3: Commit**

```bash
git add packages/server/package.json package-lock.json
git commit -m "chore: add jszip dependency to server package"
```

---

## Task 2: Action Code Export endpoint

**Files:**

- Create: `packages/server/src/routes/export-import.ts`
- Modify: `packages/server/src/routes/management.ts` (mount the sub-router)

- [ ] **Step 1: Write the failing test**

Create `packages/server/src/__tests__/export-import.test.ts`:

```typescript
/**
 * export-import.test.ts — Integration tests for action code and snapshot
 * export/import endpoints.
 */

import { describe, it, expect } from 'vitest'
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
import type { Instance } from '@trajectory/storage'
import { SseManager } from '../sse-manager.js'
import { createManagementRouter } from '../routes/management.js'
import { errorHandler } from '../middleware/error-handler.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const SCRIPT_PATH = path.resolve(__dirname, '../../../../python-sidecar/sandbox_runner.py')

interface TestApp {
  app: express.Express
  manager: InstanceManager
  db: BetterSqlite3.Database
  environmentRepo: EnvironmentRepository
  actionRepo: ActionRepository
  codeVersionRepo: CodeVersionRepository
  instanceRepo: InstanceRepository
  logRepo: LogRepository
  settingsRepo: SettingsRepository
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
    onStateChange: (instanceId: string, state: string, instance: Instance) => {
      const history = instance.state_history as Array<{ state: string; timestamp: string }>
      const prev = history.length >= 2 ? (history[history.length - 2]?.state ?? '') : ''
      sseManager.publishStateChange(instanceId, state, prev, instance)
    },
    onTerminal: (instanceId: string, state: string, instance: Instance) => {
      const history = instance.state_history as Array<{ state: string; timestamp: string }>
      const prev = history.length >= 2 ? (history[history.length - 2]?.state ?? '') : ''
      sseManager.publishStateChange(instanceId, state, prev, instance)
    },
  })

  const app = express()
  app.use(cors())
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

  return {
    app,
    manager,
    db,
    environmentRepo,
    actionRepo,
    codeVersionRepo,
    instanceRepo,
    logRepo,
    settingsRepo,
  }
}

/** Seed an environment + action + active code for testing */
function seedActionWithCode(t: TestApp) {
  t.environmentRepo.upsert({
    oid: 'env-test-001',
    local_id: 'TestEnv',
    version: '1.0.0',
    last_modified_date: '2026-01-01T00:00:00Z',
    schema_version: '4.0',
    action_property_specifications: [],
    value_property_specifications: [],
    resource_property_specifications: [],
    source_filename: 'test.WFenvir',
  })

  t.actionRepo.upsert({
    oid: 'act-test-001',
    environment_oid: 'env-test-001',
    local_id: 'TestAction',
    version: '1.0.0',
    last_modified_date: '2026-01-01T00:00:00Z',
    action_visibility: 'observable',
    input_parameter_specifications: [{ name: 'item_id', data_type: 'string' }],
    output_parameter_specifications: [{ name: 'result', data_type: 'string' }],
    property_specifications: [],
  })

  // Create and activate code for EXECUTING state
  const cv1 = t.codeVersionRepo.create({
    action_oid: 'act-test-001',
    state: 'EXECUTING',
    source_code: 'print("executing")',
    description: 'Main logic',
  })
  t.codeVersionRepo.activate(cv1.id)

  // Create and activate code for ABORTING state
  const cv2 = t.codeVersionRepo.create({
    action_oid: 'act-test-001',
    state: 'ABORTING',
    source_code: 'print("aborting")',
    description: 'Cleanup',
  })
  t.codeVersionRepo.activate(cv2.id)
}

describe('Action Code Export — GET /management/v1/actions/:oid/export', () => {
  it('returns a valid .WFactionCode ZIP with manifest and .py files', async () => {
    const t = createTestApp()
    try {
      seedActionWithCode(t)

      const res = await request(t.app).get('/management/v1/actions/act-test-001/export').expect(200)

      // Check content-type and disposition
      expect(res.headers['content-type']).toContain('application/zip')
      expect(res.headers['content-disposition']).toContain('TestAction.WFactionCode')

      // Parse ZIP
      const zip = await JSZip.loadAsync(res.body)
      const fileNames = Object.keys(zip.files).sort()
      expect(fileNames).toEqual(['ABORTING.py', 'EXECUTING.py', 'manifest.json'])

      // Check manifest
      const manifest = JSON.parse(await zip.file('manifest.json')!.async('string'))
      expect(manifest.format_version).toBe('1.0')
      expect(manifest.action.oid).toBe('act-test-001')
      expect(manifest.action.local_id).toBe('TestAction')
      expect(manifest.action.action_visibility).toBe('observable')
      expect(manifest.code_files).toHaveLength(2)

      // Check Python files
      const executing = await zip.file('EXECUTING.py')!.async('string')
      expect(executing).toBe('print("executing")')
      const aborting = await zip.file('ABORTING.py')!.async('string')
      expect(aborting).toBe('print("aborting")')
    } finally {
      await t.manager.shutdown()
    }
  }, 30_000)

  it('returns 404 for unknown action', async () => {
    const t = createTestApp()
    try {
      const res = await request(t.app)
        .get('/management/v1/actions/act-nonexistent/export')
        .expect(404)

      expect(res.body.error.code).toBe('NOT_FOUND')
    } finally {
      await t.manager.shutdown()
    }
  }, 30_000)

  it('returns ZIP with only manifest when action has no code', async () => {
    const t = createTestApp()
    try {
      seedActionWithCode(t)
      // Remove all code versions to simulate no-code scenario
      t.codeVersionRepo.deleteByAction('act-test-001')

      const res = await request(t.app).get('/management/v1/actions/act-test-001/export').expect(200)

      const zip = await JSZip.loadAsync(res.body)
      const fileNames = Object.keys(zip.files)
      expect(fileNames).toEqual(['manifest.json'])

      const manifest = JSON.parse(await zip.file('manifest.json')!.async('string'))
      expect(manifest.code_files).toHaveLength(0)
    } finally {
      await t.manager.shutdown()
    }
  }, 30_000)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/server/src/__tests__/export-import.test.ts --reporter=verbose`
Expected: FAIL — route does not exist yet (404 or module not found)

- [ ] **Step 3: Create the export-import route module with action export**

Create `packages/server/src/routes/export-import.ts`:

```typescript
import { Router } from 'express'
import JSZip from 'jszip'
import multer from 'multer'
import type {
  ActionRepository,
  CodeVersionRepository,
  EnvironmentRepository,
  SettingsRepository,
} from '@trajectory/storage'
import { createTransactionHelper } from '@trajectory/storage'
import type BetterSqlite3 from 'better-sqlite3'

export function createExportImportRouter(
  db: BetterSqlite3.Database,
  environmentRepo: EnvironmentRepository,
  actionRepo: ActionRepository,
  codeVersionRepo: CodeVersionRepository,
  settingsRepo: SettingsRepository
): Router {
  const router = Router()
  const txHelper = createTransactionHelper(db)

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB for snapshots
  })

  // --------------------------------------------------------
  // GET /actions/:oid/export — Download .WFactionCode ZIP
  // --------------------------------------------------------
  router.get('/actions/:oid/export', (req, res, next) => {
    try {
      const action = actionRepo.findByOid(req.params.oid)
      if (!action) {
        return void res.status(404).json({
          error: { code: 'NOT_FOUND', message: `Action not found: ${req.params.oid}` },
        })
      }

      // Gather active code versions for this action
      const allVersions = codeVersionRepo.findByAction(action.oid)
      const activeVersions = allVersions.filter((v) => v.is_active)

      // Build manifest
      const manifest = {
        format_version: '1.0',
        exported_at: new Date().toISOString(),
        action: {
          oid: action.oid,
          local_id: action.local_id,
          version: action.version,
          action_visibility: action.action_visibility,
          description: action.description,
          input_parameter_specifications: action.input_parameter_specifications,
          output_parameter_specifications: action.output_parameter_specifications,
          property_specifications: action.property_specifications,
          timeout_seconds: action.timeout_seconds,
        },
        code_files: activeVersions.map((v) => ({
          state: v.state,
          filename: `${v.state}.py`,
          description: v.description,
        })),
      }

      // Build ZIP
      const zip = new JSZip()
      zip.file('manifest.json', JSON.stringify(manifest, null, 2))
      for (const v of activeVersions) {
        zip.file(`${v.state}.py`, v.source_code)
      }

      zip
        .generateAsync({ type: 'nodebuffer' })
        .then((buf) => {
          const filename = `${action.local_id}.WFactionCode`
          res.set({
            'Content-Type': 'application/zip',
            'Content-Disposition': `attachment; filename="${filename}"`,
            'Content-Length': String(buf.length),
          })
          res.send(buf)
        })
        .catch(next)
    } catch (err) {
      next(err)
    }
  })

  return router
}
```

- [ ] **Step 4: Mount the sub-router in management.ts**

In `packages/server/src/routes/management.ts`, add import at the top:

```typescript
import { createExportImportRouter } from './export-import.js'
```

After the `const router = Router()` line (~line 87), mount the sub-router:

```typescript
// Mount export/import sub-router
router.use(createExportImportRouter(db, environmentRepo, actionRepo, codeVersionRepo, settingsRepo))
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run packages/server/src/__tests__/export-import.test.ts --reporter=verbose`
Expected: All 3 tests PASS

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/routes/export-import.ts packages/server/src/routes/management.ts packages/server/src/__tests__/export-import.test.ts
git commit -m "feat(api): action code export endpoint (GET /actions/:oid/export)"
```

---

## Task 3: Action Code Import endpoint

**Files:**

- Modify: `packages/server/src/routes/export-import.ts`
- Modify: `packages/server/src/__tests__/export-import.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `packages/server/src/__tests__/export-import.test.ts`:

```typescript
describe('Action Code Import — POST /management/v1/actions/:oid/import', () => {
  /** Helper: build a .WFactionCode ZIP buffer */
  async function buildActionCodeZip(manifest: object, codeFiles: Record<string, string>) {
    const zip = new JSZip()
    zip.file('manifest.json', JSON.stringify(manifest, null, 2))
    for (const [name, code] of Object.entries(codeFiles)) {
      zip.file(name, code)
    }
    return zip.generateAsync({ type: 'nodebuffer' })
  }

  it('imports code files as new active versions', async () => {
    const t = createTestApp()
    try {
      seedActionWithCode(t)

      const manifest = {
        format_version: '1.0',
        exported_at: '2026-01-01T00:00:00Z',
        action: { oid: 'act-test-001', local_id: 'TestAction' },
        code_files: [
          { state: 'EXECUTING', filename: 'EXECUTING.py', description: 'Updated logic' },
        ],
      }
      const zipBuf = await buildActionCodeZip(manifest, {
        'EXECUTING.py': 'print("updated executing")',
      })

      const res = await request(t.app)
        .post('/management/v1/actions/act-test-001/import')
        .attach('file', zipBuf, 'TestAction.WFactionCode')
        .expect(200)

      expect(res.body.data.imported_states).toEqual(['EXECUTING'])
      expect(res.body.data.skipped_states).toEqual([])

      // Verify the new version is active
      const active = t.codeVersionRepo.getActive('act-test-001', 'EXECUTING')
      expect(active).not.toBeNull()
      expect(active!.source_code).toBe('print("updated executing")')

      // Verify ABORTING was not touched
      const abortActive = t.codeVersionRepo.getActive('act-test-001', 'ABORTING')
      expect(abortActive!.source_code).toBe('print("aborting")')
    } finally {
      await t.manager.shutdown()
    }
  }, 30_000)

  it('rejects import when manifest action OID does not match URL', async () => {
    const t = createTestApp()
    try {
      seedActionWithCode(t)

      const manifest = {
        format_version: '1.0',
        action: { oid: 'act-WRONG-oid', local_id: 'TestAction' },
        code_files: [],
      }
      const zipBuf = await buildActionCodeZip(manifest, {})

      const res = await request(t.app)
        .post('/management/v1/actions/act-test-001/import')
        .attach('file', zipBuf, 'TestAction.WFactionCode')
        .expect(400)

      expect(res.body.error.code).toBe('VALIDATION_ERROR')
      expect(res.body.error.message).toContain('does not match')
    } finally {
      await t.manager.shutdown()
    }
  }, 30_000)

  it('returns 404 for unknown action', async () => {
    const t = createTestApp()
    try {
      const manifest = {
        format_version: '1.0',
        action: { oid: 'act-nonexistent', local_id: 'X' },
        code_files: [],
      }
      const zipBuf = await buildActionCodeZip(manifest, {})

      await request(t.app)
        .post('/management/v1/actions/act-nonexistent/import')
        .attach('file', zipBuf, 'X.WFactionCode')
        .expect(404)
    } finally {
      await t.manager.shutdown()
    }
  }, 30_000)

  it('rejects upload with no file', async () => {
    const t = createTestApp()
    try {
      seedActionWithCode(t)

      await request(t.app).post('/management/v1/actions/act-test-001/import').expect(400)
    } finally {
      await t.manager.shutdown()
    }
  }, 30_000)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run packages/server/src/__tests__/export-import.test.ts --reporter=verbose`
Expected: New import tests FAIL (404 — route not defined)

- [ ] **Step 3: Implement the import endpoint**

Append to `packages/server/src/routes/export-import.ts`, inside `createExportImportRouter` before the `return router`:

```typescript
// --------------------------------------------------------
// POST /actions/:oid/import — Upload .WFactionCode ZIP
// --------------------------------------------------------
router.post('/actions/:oid/import', upload.single('file'), (req, res, next) => {
  try {
    const file = req.file
    if (!file) {
      return void res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'No file provided' },
      })
    }

    const action = actionRepo.findByOid(req.params.oid)
    if (!action) {
      return void res.status(404).json({
        error: { code: 'NOT_FOUND', message: `Action not found: ${req.params.oid}` },
      })
    }

    JSZip.loadAsync(file.buffer)
      .then(async (zip) => {
        // Read and validate manifest
        const manifestFile = zip.file('manifest.json')
        if (!manifestFile) {
          return void res.status(400).json({
            error: { code: 'VALIDATION_ERROR', message: 'ZIP missing manifest.json' },
          })
        }

        const manifest = JSON.parse(await manifestFile.async('string'))

        if (manifest.action?.oid !== req.params.oid) {
          return void res.status(400).json({
            error: {
              code: 'VALIDATION_ERROR',
              message: `Manifest action OID "${manifest.action?.oid}" does not match target "${req.params.oid}"`,
            },
          })
        }

        // Import code files
        const importedStates: string[] = []
        const skippedStates: string[] = []

        const codeEntries = (manifest.code_files ?? []) as Array<{
          state: string
          filename: string
          description?: string
        }>

        txHelper.transaction(() => {
          for (const entry of codeEntries) {
            const pyFile = zip.file(entry.filename)
            if (!pyFile) {
              skippedStates.push(entry.state)
              continue
            }
            // We need synchronous access — pyFile.async is async so we collected
            // the source above. Let's restructure to collect all sources first.
            // This will be handled by the outer async flow.
          }
        })

        // Collect all source code first (async), then do DB writes in transaction
        const sources: Array<{ state: string; source: string; description: string | null }> = []
        for (const entry of codeEntries) {
          const pyFile = zip.file(entry.filename)
          if (!pyFile) {
            skippedStates.push(entry.state)
            continue
          }
          const source = await pyFile.async('string')
          sources.push({
            state: entry.state,
            source,
            description: entry.description ?? null,
          })
        }

        // Write to DB in a transaction
        txHelper.transaction(() => {
          for (const { state, source, description } of sources) {
            const cv = codeVersionRepo.create({
              action_oid: action.oid,
              state,
              source_code: source,
              created_by: 'import',
              description,
            })
            codeVersionRepo.activate(cv.id)
            importedStates.push(state)
          }
        })

        res.status(200).json({
          data: {
            action_oid: action.oid,
            imported_states: importedStates,
            skipped_states: skippedStates,
          },
          meta: {},
        })
      })
      .catch(next)
  } catch (err) {
    next(err)
  }
})
```

Note: Remove the first empty `txHelper.transaction` block — the code above shows the final clean version. The actual implementation collects sources async first, then writes in a single transaction.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/server/src/__tests__/export-import.test.ts --reporter=verbose`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/routes/export-import.ts packages/server/src/__tests__/export-import.test.ts
git commit -m "feat(api): action code import endpoint (POST /actions/:oid/import)"
```

---

## Task 4: Snapshot Export endpoint

**Files:**

- Modify: `packages/server/src/routes/export-import.ts`
- Modify: `packages/server/src/__tests__/export-import.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/server/src/__tests__/export-import.test.ts`:

```typescript
describe('Snapshot Export — GET /management/v1/snapshot/export', () => {
  it('returns a valid .WFsnapshot ZIP with environments, code, and settings', async () => {
    const t = createTestApp()
    try {
      seedActionWithCode(t)

      const res = await request(t.app).get('/management/v1/snapshot/export').expect(200)

      expect(res.headers['content-type']).toContain('application/zip')
      expect(res.headers['content-disposition']).toContain('.WFsnapshot')

      const zip = await JSZip.loadAsync(res.body)
      const fileNames = Object.keys(zip.files).sort()

      // Should contain manifest, settings, environment JSON, and code files
      expect(fileNames).toContain('manifest.json')
      expect(fileNames).toContain('settings.json')
      expect(fileNames).toContain('environments/env-test-001.json')
      expect(fileNames).toContain('code/act-test-001/EXECUTING.py')
      expect(fileNames).toContain('code/act-test-001/ABORTING.py')

      // Check manifest counts
      const manifest = JSON.parse(await zip.file('manifest.json')!.async('string'))
      expect(manifest.format_version).toBe('1.0')
      expect(manifest.environment_count).toBe(1)
      expect(manifest.action_count).toBe(1)
      expect(manifest.code_file_count).toBe(2)

      // Check environment JSON includes actions
      const envJson = JSON.parse(await zip.file('environments/env-test-001.json')!.async('string'))
      expect(envJson.oid).toBe('env-test-001')
      expect(envJson.included_actions).toHaveLength(1)
      expect(envJson.included_actions[0].oid).toBe('act-test-001')
    } finally {
      await t.manager.shutdown()
    }
  }, 30_000)

  it('returns a valid ZIP even with empty database', async () => {
    const t = createTestApp()
    try {
      const res = await request(t.app).get('/management/v1/snapshot/export').expect(200)

      const zip = await JSZip.loadAsync(res.body)
      const manifest = JSON.parse(await zip.file('manifest.json')!.async('string'))
      expect(manifest.environment_count).toBe(0)
      expect(manifest.action_count).toBe(0)
      expect(manifest.code_file_count).toBe(0)
    } finally {
      await t.manager.shutdown()
    }
  }, 30_000)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run packages/server/src/__tests__/export-import.test.ts --reporter=verbose`
Expected: Snapshot export tests FAIL (404)

- [ ] **Step 3: Implement snapshot export**

Add to `packages/server/src/routes/export-import.ts`, inside `createExportImportRouter` before `return router`:

```typescript
// --------------------------------------------------------
// GET /snapshot/export — Download .WFsnapshot ZIP
// --------------------------------------------------------
router.get('/snapshot/export', (req, res, next) => {
  try {
    const environments = environmentRepo.findAll()
    const settings = settingsRepo.getAll()

    let totalActions = 0
    let totalCodeFiles = 0

    const zip = new JSZip()

    // Settings
    zip.file('settings.json', JSON.stringify(settings, null, 2))

    // Environments (with included actions in .WFenvir shape)
    for (const env of environments) {
      const actions = actionRepo.findByEnvironment(env.oid)
      totalActions += actions.length

      const envJson = {
        oid: env.oid,
        local_id: env.local_id,
        version: env.version,
        last_modified_date: env.last_modified_date,
        description: env.description,
        schemaVersion: env.schema_version,
        action_property_specifications: env.action_property_specifications,
        value_property_specifications: env.value_property_specifications,
        resource_property_specifications: env.resource_property_specifications,
        included_actions: actions.map((a) => ({
          oid: a.oid,
          local_id: a.local_id,
          version: a.version,
          last_modified_date: a.last_modified_date,
          description: a.description,
          action_visibility: a.action_visibility,
          input_parameter_specifications: a.input_parameter_specifications,
          output_parameter_specifications: a.output_parameter_specifications,
          property_specifications: a.property_specifications,
          timeout_seconds: a.timeout_seconds,
        })),
      }

      zip.file(`environments/${env.oid}.json`, JSON.stringify(envJson, null, 2))

      // Active code per action
      for (const action of actions) {
        const allVersions = codeVersionRepo.findByAction(action.oid)
        const activeVersions = allVersions.filter((v) => v.is_active)
        for (const v of activeVersions) {
          zip.file(`code/${action.oid}/${v.state}.py`, v.source_code)
          totalCodeFiles++
        }
      }
    }

    // Manifest
    const manifest = {
      format_version: '1.0',
      exported_at: new Date().toISOString(),
      container_version: '1.0.0',
      environment_count: environments.length,
      action_count: totalActions,
      code_file_count: totalCodeFiles,
    }
    zip.file('manifest.json', JSON.stringify(manifest, null, 2))

    zip
      .generateAsync({ type: 'nodebuffer' })
      .then((buf) => {
        const date = new Date().toISOString().slice(0, 10)
        const filename = `TrajectorySnapshot_${date}.WFsnapshot`
        res.set({
          'Content-Type': 'application/zip',
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Content-Length': String(buf.length),
        })
        res.send(buf)
      })
      .catch(next)
  } catch (err) {
    next(err)
  }
})
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/server/src/__tests__/export-import.test.ts --reporter=verbose`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/routes/export-import.ts packages/server/src/__tests__/export-import.test.ts
git commit -m "feat(api): snapshot export endpoint (GET /snapshot/export)"
```

---

## Task 5: Snapshot Import endpoint

**Files:**

- Modify: `packages/server/src/routes/export-import.ts`
- Modify: `packages/server/src/__tests__/export-import.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `packages/server/src/__tests__/export-import.test.ts`:

```typescript
describe('Snapshot Import — POST /management/v1/snapshot/import', () => {
  /** Helper: export a snapshot from a seeded app */
  async function exportSnapshot(t: TestApp): Promise<Buffer> {
    const res = await request(t.app).get('/management/v1/snapshot/export').expect(200)
    return res.body
  }

  it('requires ?confirm=true query parameter', async () => {
    const t = createTestApp()
    try {
      seedActionWithCode(t)
      const snapBuf = await exportSnapshot(t)

      const res = await request(t.app)
        .post('/management/v1/snapshot/import')
        .attach('file', snapBuf, 'snapshot.WFsnapshot')
        .expect(400)

      expect(res.body.error.message).toContain('confirm=true')
    } finally {
      await t.manager.shutdown()
    }
  }, 30_000)

  it('fully replaces container state from snapshot', async () => {
    const t = createTestApp()
    try {
      seedActionWithCode(t)
      const snapBuf = await exportSnapshot(t)

      // Add a second environment that should be wiped on import
      t.environmentRepo.upsert({
        oid: 'env-extra-999',
        local_id: 'ExtraEnv',
        version: '1.0.0',
        last_modified_date: '2026-01-01T00:00:00Z',
        schema_version: '4.0',
        action_property_specifications: [],
        value_property_specifications: [],
        resource_property_specifications: [],
        source_filename: 'extra.WFenvir',
      })

      // Import snapshot (should restore to just the original env)
      const res = await request(t.app)
        .post('/management/v1/snapshot/import?confirm=true')
        .attach('file', snapBuf, 'snapshot.WFsnapshot')
        .expect(200)

      expect(res.body.data.environments_imported).toBe(1)
      expect(res.body.data.actions_imported).toBe(1)
      expect(res.body.data.code_files_imported).toBe(2)

      // Verify extra environment was deleted
      const allEnvs = t.environmentRepo.findAll()
      expect(allEnvs).toHaveLength(1)
      expect(allEnvs[0].oid).toBe('env-test-001')

      // Verify code was restored
      const active = t.codeVersionRepo.getActive('act-test-001', 'EXECUTING')
      expect(active).not.toBeNull()
      expect(active!.source_code).toBe('print("executing")')
    } finally {
      await t.manager.shutdown()
    }
  }, 30_000)

  it('returns 400 for invalid ZIP', async () => {
    const t = createTestApp()
    try {
      const res = await request(t.app)
        .post('/management/v1/snapshot/import?confirm=true')
        .attach('file', Buffer.from('not a zip'), 'bad.WFsnapshot')
        .expect(400)

      expect(res.body.error.code).toBe('VALIDATION_ERROR')
    } finally {
      await t.manager.shutdown()
    }
  }, 30_000)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run packages/server/src/__tests__/export-import.test.ts --reporter=verbose`
Expected: Snapshot import tests FAIL

- [ ] **Step 3: Implement snapshot import**

Add to `packages/server/src/routes/export-import.ts`, inside `createExportImportRouter` before `return router`:

```typescript
// --------------------------------------------------------
// POST /snapshot/import?confirm=true — Upload .WFsnapshot ZIP
// --------------------------------------------------------
router.post('/snapshot/import', upload.single('file'), (req, res, next) => {
  try {
    if (req.query.confirm !== 'true') {
      return void res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Destructive operation requires ?confirm=true query parameter',
        },
      })
    }

    const file = req.file
    if (!file) {
      return void res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'No file provided' },
      })
    }

    JSZip.loadAsync(file.buffer)
      .then(async (zip) => {
        // Validate manifest exists
        const manifestFile = zip.file('manifest.json')
        if (!manifestFile) {
          return void res.status(400).json({
            error: { code: 'VALIDATION_ERROR', message: 'ZIP missing manifest.json' },
          })
        }

        const manifest = JSON.parse(await manifestFile.async('string'))
        if (manifest.format_version !== '1.0') {
          return void res.status(400).json({
            error: {
              code: 'VALIDATION_ERROR',
              message: `Unsupported format version: ${manifest.format_version}`,
            },
          })
        }

        // Collect all environment JSON files
        const envFiles = zip.file(/^environments\/.*\.json$/)
        const envDataList: Array<{ filename: string; data: Record<string, unknown> }> = []
        for (const f of envFiles) {
          const raw = await f.async('string')
          envDataList.push({ filename: f.name, data: JSON.parse(raw) })
        }

        // Collect all code files
        const codeFiles = zip.file(/^code\/.*\.py$/)
        const codeDataList: Array<{
          actionOid: string
          state: string
          source: string
        }> = []
        for (const f of codeFiles) {
          // Path: code/<action_oid>/<STATE>.py
          const parts = f.name.split('/')
          const actionOid = parts[1]
          const state = parts[2].replace('.py', '')
          const source = await f.async('string')
          codeDataList.push({ actionOid, state, source })
        }

        // Collect settings
        let settingsData: Array<{ key: string; value: string }> = []
        const settingsFile = zip.file('settings.json')
        if (settingsFile) {
          const raw = JSON.parse(await settingsFile.async('string'))
          if (Array.isArray(raw)) {
            settingsData = raw.map((s: { key: string; value: string }) => ({
              key: s.key,
              value: s.value,
            }))
          }
        }

        // Full replace in a single transaction
        let environmentsImported = 0
        let actionsImported = 0
        let codeFilesImported = 0
        let settingsImported = 0

        txHelper.transaction(() => {
          // 1. Delete all existing data (order matters for FK constraints)
          //    code_versions → actions → environments
          const existingEnvs = environmentRepo.findAll()
          for (const env of existingEnvs) {
            const actions = actionRepo.findByEnvironment(env.oid)
            for (const action of actions) {
              codeVersionRepo.deleteByAction(action.oid)
              actionRepo.delete(action.oid)
            }
            environmentRepo.delete(env.oid)
          }

          // 2. Re-create environments and actions from snapshot
          for (const { data } of envDataList) {
            environmentRepo.upsert({
              oid: data.oid as string,
              local_id: data.local_id as string,
              version: data.version as string,
              last_modified_date: data.last_modified_date as string,
              schema_version: (data.schemaVersion as string) ?? '4.0',
              description: (data.description as string) ?? null,
              action_property_specifications:
                (data.action_property_specifications as unknown[]) ?? [],
              value_property_specifications:
                (data.value_property_specifications as unknown[]) ?? [],
              resource_property_specifications:
                (data.resource_property_specifications as unknown[]) ?? [],
              source_filename: 'snapshot-import',
            })
            environmentsImported++

            const includedActions = (data.included_actions as Array<Record<string, unknown>>) ?? []
            for (const act of includedActions) {
              actionRepo.upsert({
                oid: act.oid as string,
                environment_oid: data.oid as string,
                local_id: act.local_id as string,
                version: act.version as string,
                last_modified_date: act.last_modified_date as string,
                description: (act.description as string) ?? null,
                action_visibility: (act.action_visibility as 'opaque' | 'observable') ?? 'opaque',
                input_parameter_specifications:
                  (act.input_parameter_specifications as unknown[]) ?? [],
                output_parameter_specifications:
                  (act.output_parameter_specifications as unknown[]) ?? [],
                property_specifications: (act.property_specifications as unknown[]) ?? [],
                timeout_seconds: (act.timeout_seconds as number | null) ?? null,
              })
              actionsImported++
            }
          }

          // 3. Create and activate code versions
          for (const { actionOid, state, source } of codeDataList) {
            const cv = codeVersionRepo.create({
              action_oid: actionOid,
              state,
              source_code: source,
              created_by: 'snapshot-import',
              description: 'Imported from snapshot',
            })
            codeVersionRepo.activate(cv.id)
            codeFilesImported++
          }

          // 4. Apply settings
          for (const { key, value } of settingsData) {
            try {
              settingsRepo.update({ key, value })
              settingsImported++
            } catch {
              // Skip unknown settings keys silently
            }
          }
        })

        res.status(200).json({
          data: {
            environments_imported: environmentsImported,
            actions_imported: actionsImported,
            code_files_imported: codeFilesImported,
            settings_imported: settingsImported,
          },
          meta: {},
        })
      })
      .catch((err) => {
        // JSZip parse failure = invalid ZIP
        if (err instanceof Error && err.message.includes('not a valid zip')) {
          return void res.status(400).json({
            error: { code: 'VALIDATION_ERROR', message: 'Invalid ZIP file' },
          })
        }
        // Other JSZip errors (corrupted, etc.)
        if (
          err instanceof Error &&
          (err.message.includes('Corrupted') || err.message.includes('End of data'))
        ) {
          return void res.status(400).json({
            error: { code: 'VALIDATION_ERROR', message: 'Invalid or corrupted ZIP file' },
          })
        }
        next(err)
      })
  } catch (err) {
    next(err)
  }
})
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/server/src/__tests__/export-import.test.ts --reporter=verbose`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/routes/export-import.ts packages/server/src/__tests__/export-import.test.ts
git commit -m "feat(api): snapshot import endpoint (POST /snapshot/import)"
```

---

## Task 6: Console API client methods

**Files:**

- Modify: `apps/console/src/lib/api.ts`
- Modify: `apps/console/src/lib/types.ts`

- [ ] **Step 1: Add types**

Append to `apps/console/src/lib/types.ts`:

```typescript
// ---- Import/Export ----

export interface ImportCodeResult {
  action_oid: string
  imported_states: string[]
  skipped_states: string[]
}

export interface ImportSnapshotResult {
  environments_imported: number
  actions_imported: number
  code_files_imported: number
  settings_imported: number
}
```

- [ ] **Step 2: Add API methods**

Add to the `api` object in `apps/console/src/lib/api.ts`:

```typescript
  // ---- Export/Import ----
  exportActionCode: (oid: string): string => `${BASE}/actions/${oid}/export`,

  importActionCode: async (oid: string, file: File): Promise<ImportCodeResult> => {
    const formData = new FormData()
    formData.append('file', file)
    return apiFetch(`/actions/${oid}/import`, {
      method: 'POST',
      body: formData,
    })
  },

  exportSnapshotUrl: (): string => `${BASE}/snapshot/export`,

  importSnapshot: async (file: File): Promise<ImportSnapshotResult> => {
    const formData = new FormData()
    formData.append('file', file)
    return apiFetch(`/snapshot/import?confirm=true`, {
      method: 'POST',
      body: formData,
    })
  },
```

- [ ] **Step 3: Add the new type imports**

Update the import block at the top of `api.ts` to include `ImportCodeResult` and `ImportSnapshotResult`.

- [ ] **Step 4: Commit**

```bash
git add apps/console/src/lib/api.ts apps/console/src/lib/types.ts
git commit -m "feat(console): add API client methods for export/import"
```

---

## Task 7: Export/Import buttons on ActionDetailPage

**Files:**

- Create: `apps/console/src/features/actions/ExportImportButtons.tsx`
- Modify: `apps/console/src/features/actions/ActionDetailPage.tsx`

- [ ] **Step 1: Create ExportImportButtons component**

Create `apps/console/src/features/actions/ExportImportButtons.tsx`:

```tsx
import { useState, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'
import type { ImportCodeResult } from '@/lib/types'

interface ExportImportButtonsProps {
  actionOid: string
  actionLocalId: string
  onImportComplete: () => void
}

export function ExportImportButtons({
  actionOid,
  actionLocalId,
  onImportComplete,
}: ExportImportButtonsProps) {
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<ImportCodeResult | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  function handleExport() {
    // Direct download via browser navigation
    window.location.href = api.exportActionCode(actionOid)
  }

  function handleImportClick() {
    fileInputRef.current?.click()
  }

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    setImporting(true)
    setImportResult(null)
    setImportError(null)

    try {
      const result = await api.importActionCode(actionOid, file)
      setImportResult(result)
      onImportComplete()
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Import failed')
    } finally {
      setImporting(false)
      // Reset file input so same file can be re-selected
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={handleExport}>
          Export Code
        </Button>
        <Button variant="outline" size="sm" onClick={handleImportClick} disabled={importing}>
          {importing ? 'Importing...' : 'Import Code'}
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".WFactionCode"
          className="hidden"
          onChange={handleFileSelected}
        />
      </div>

      {importResult && (
        <div className="rounded-md border border-green-200 bg-green-50 p-3 text-sm">
          <p className="font-medium text-green-800">Import successful</p>
          <p className="text-green-700">
            Imported: {importResult.imported_states.join(', ') || 'none'}
            {importResult.skipped_states.length > 0 &&
              ` | Skipped: ${importResult.skipped_states.join(', ')}`}
          </p>
        </div>
      )}

      {importError && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm">
          <p className="font-medium text-red-800">Import failed</p>
          <p className="text-red-700">{importError}</p>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Add ExportImportButtons to ActionDetailPage**

In `apps/console/src/features/actions/ActionDetailPage.tsx`:

Add import at the top:

```typescript
import { ExportImportButtons } from './ExportImportButtons'
```

Find the action header section (where the action name, visibility badge, and OID are rendered) and add `<ExportImportButtons>` after it. The component needs `actionOid`, `actionLocalId`, and `onImportComplete` (which should call `refetch` from the `useAction` hook to refresh code status).

The exact placement: after the header `<div>` containing the action name and badges, before the first `<Card>`. Pass `onImportComplete={() => refetch()}` where `refetch` comes from the existing `useAction` hook (check if it returns a refetch function — if not, use `queryClient.invalidateQueries`).

- [ ] **Step 3: Verify it renders**

Run: `npm run dev:console` and navigate to any action detail page.
Expected: "Export Code" and "Import Code" buttons appear below the header.

- [ ] **Step 4: Commit**

```bash
git add apps/console/src/features/actions/ExportImportButtons.tsx apps/console/src/features/actions/ActionDetailPage.tsx
git commit -m "feat(console): export/import code buttons on Action Detail page"
```

---

## Task 8: Snapshot section on Settings page

**Files:**

- Create: `apps/console/src/features/settings/SnapshotSection.tsx`
- Modify: `apps/console/src/features/settings/SettingsPage.tsx`

- [ ] **Step 1: Create SnapshotSection component**

Create `apps/console/src/features/settings/SnapshotSection.tsx`:

```tsx
import { useState, useRef } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'
import type { ImportSnapshotResult } from '@/lib/types'

export function SnapshotSection() {
  const [importing, setImporting] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [importResult, setImportResult] = useState<ImportSnapshotResult | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  function handleExport() {
    window.location.href = api.exportSnapshotUrl()
  }

  function handleImportClick() {
    fileInputRef.current?.click()
  }

  function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setSelectedFile(file)
    setShowConfirm(true)
    setImportResult(null)
    setImportError(null)
  }

  async function handleConfirmImport() {
    if (!selectedFile) return

    setImporting(true)
    setShowConfirm(false)

    try {
      const result = await api.importSnapshot(selectedFile)
      setImportResult(result)
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Import failed')
    } finally {
      setImporting(false)
      setSelectedFile(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  function handleCancelImport() {
    setShowConfirm(false)
    setSelectedFile(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Container Snapshot</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Export or import a full container snapshot including all environments, actions, active
          code, and settings.
        </p>

        <div className="flex gap-2">
          <Button variant="outline" onClick={handleExport}>
            Export Snapshot
          </Button>
          <Button variant="outline" onClick={handleImportClick} disabled={importing}>
            {importing ? 'Importing...' : 'Import Snapshot'}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".WFsnapshot"
            className="hidden"
            onChange={handleFileSelected}
          />
        </div>

        {showConfirm && (
          <div className="rounded-md border border-yellow-300 bg-yellow-50 p-4 space-y-3">
            <p className="font-medium text-yellow-800">Warning: Destructive operation</p>
            <p className="text-sm text-yellow-700">
              Importing a snapshot will <strong>replace all existing data</strong> — environments,
              actions, code versions, and settings will be overwritten.
            </p>
            <p className="text-sm text-yellow-700">
              File: <strong>{selectedFile?.name}</strong>
            </p>
            <div className="flex gap-2">
              <Button variant="destructive" size="sm" onClick={handleConfirmImport}>
                Confirm Import
              </Button>
              <Button variant="outline" size="sm" onClick={handleCancelImport}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {importResult && (
          <div className="rounded-md border border-green-200 bg-green-50 p-3 text-sm">
            <p className="font-medium text-green-800">Import successful</p>
            <p className="text-green-700">
              Imported {importResult.environments_imported} environments,{' '}
              {importResult.actions_imported} actions, {importResult.code_files_imported} code
              files, {importResult.settings_imported} settings
            </p>
          </div>
        )}

        {importError && (
          <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm">
            <p className="font-medium text-red-800">Import failed</p>
            <p className="text-red-700">{importError}</p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 2: Add SnapshotSection to SettingsPage**

In `apps/console/src/features/settings/SettingsPage.tsx`:

Add import at the top:

```typescript
import { SnapshotSection } from './SnapshotSection'
```

Add `<SnapshotSection />` at the bottom of the page content, after the existing settings cards (before the closing fragment/div of the page).

- [ ] **Step 3: Verify it renders**

Run: `npm run dev:console` and navigate to the Settings page.
Expected: "Container Snapshot" card appears at the bottom with Export/Import buttons.

- [ ] **Step 4: Commit**

```bash
git add apps/console/src/features/settings/SnapshotSection.tsx apps/console/src/features/settings/SettingsPage.tsx
git commit -m "feat(console): snapshot export/import section on Settings page"
```

---

## Task 9: Full integration verification

**Files:** None (verification only)

- [ ] **Step 1: Run full test suite**

```bash
npm test
```

Expected: All existing tests + new export-import tests pass.

- [ ] **Step 2: Run lint and format check**

```bash
npm run lint && npm run format:check
```

Expected: No errors. Fix any lint/format issues before continuing.

- [ ] **Step 3: Build check**

```bash
npm run build
```

Expected: TypeScript compiles without errors.

- [ ] **Step 4: Manual smoke test**

Start dev server: `npm run dev`

1. Navigate to an Action Detail page — verify Export/Import buttons appear
2. Click "Export Code" — verify `.WFactionCode` ZIP downloads
3. Click "Import Code" — select the just-exported file — verify success message
4. Navigate to Settings page — verify Snapshot section appears
5. Click "Export Snapshot" — verify `.WFsnapshot` ZIP downloads
6. Click "Import Snapshot" — select a file — verify confirmation dialog appears — confirm — verify success

- [ ] **Step 5: Commit any fixes**

```bash
git add -A
git commit -m "fix: address lint/format/type issues from import-export implementation"
```
