# Environment Row Dropdown (Export / Delete / PDF) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a kebab-icon dropdown to every environment row in the console's left tree with three actions (Export → `.WFenvirBundleX`, Generate PDF report, Delete), plus a metadata line `[v{version}] imported {MM/DD}` under the env name. Introduce a new `.WFenvirBundleX` ZIP format that is round-trippable through the existing upload endpoint.

**Architecture:** One new server route in `createExportImportRouter` (`GET /environments/:oid/export-bundle`) backed by a `buildEnvironmentBundle` helper that mirrors how the existing `.WFsnapshot` exporter composes per-env JSON + per-action code. One new branch in the upload handler (`'wfenvirbundlex'`) parses the bundle and reuses the existing env-upsert + code-creation logic from the `'wfenvirx'` and `'wfactioncodex'` branches. Client-side, two lazy-loaded modules (`envir-bundle.ts` for parsing, `pdf/environment-report.ts` for jsPDF generation), two imperative hooks (`useExportEnvironment`, `useGenerateEnvironmentReport`), and a rewrite of `EnvironmentNode` to use `@trajectory/ui`'s `DropdownMenu` primitives.

**Tech Stack:** TypeScript 5, Express, JSZip (server), Vitest (server + client), React 19, `@trajectory/ui` DropdownMenu (Radix), `jspdf` (new — client, lazy), `jszip` (promoted — client, lazy).

**Spec:** `docs/specs/2026-05-19-environment-row-actions-design.md` (rev. 2 — bundle format).

---

## Conventions for every Task below

- **TDD strict:** Write the failing test first, run it to confirm it fails for the expected reason, then implement, then re-run.
- **Server tests** live under `packages/server/src/__tests__/` and use vitest (`npm test --workspace=@trajectory/server` to run a single suite, or `npm test` at repo root for all).
- **Client tests** live next to their unit (`*.test.ts(x)` siblings) and use vitest with happy-dom / jsdom env where the unit needs it.
- **Commit at every passing task boundary.** Message style: `feat(server): …`, `feat(console): …`, `test(server): …`. Match existing log style.
- **Path conventions on Windows:** use forward slashes in commits / commands when possible; PowerShell tolerates them. For paths with spaces, quote.
- **No engine source edits** — the server's `tsx watch` dev resolves `@trajectory/engine` from `dist/`. If you DO need to edit engine source mid-plan, run `npm run build` to refresh dist.

---

## File Structure

| File                                                       | Role                                                                                                                             |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `packages/server/src/routes/export-import.ts`              | **EDIT.** Add `GET /environments/:oid/export-bundle` route + `buildEnvironmentBundle` helper.                                    |
| `packages/server/src/routes/management.ts`                 | **EDIT.** Allowlist `wfenvirbundlex`; add `'wfenvirbundlex'` ParsedFile variant + parsing branch + transaction-loop branch.      |
| `packages/server/src/__tests__/environment-bundle.test.ts` | **NEW.** 7 cases: happy-path export, empty env, 404, round-trip with code, allowlist, malformed bundle, round-trip without code. |
| `apps/console/package.json`                                | **EDIT.** Add `jspdf` + `jszip` as direct dependencies.                                                                          |
| `apps/console/src/lib/download.ts`                         | **NEW.** `triggerDownload(blob, filename)` helper.                                                                               |
| `apps/console/src/lib/envir-bundle.ts`                     | **NEW.** `parseEnvirBundle(blob)` + type definitions.                                                                            |
| `apps/console/src/lib/envir-bundle.test.ts`                | **NEW.** Parse fixture + malformed-archive cases.                                                                                |
| `apps/console/src/lib/pdf/environment-report.ts`           | **NEW.** `generateEnvironmentReportPDF(bundle): Blob`.                                                                           |
| `apps/console/src/lib/pdf/environment-report.test.ts`      | **NEW.** PDF magic + content-presence assertions.                                                                                |
| `apps/console/src/features/environments/hooks.ts`          | **EDIT.** Add `useExportEnvironment` and `useGenerateEnvironmentReport`.                                                         |
| `apps/console/src/features/explorer/TreeNode.tsx`          | **EDIT.** Rewrite `EnvironmentNode` body (two-line row + dropdown + callback rename).                                            |
| `apps/console/src/features/explorer/TreeNode.test.tsx`     | **NEW** (or extend if exists). Row layout + dropdown + delete-confirm + working-state.                                           |
| `apps/console/src/features/explorer/ExplorerPanel.tsx`     | **EDIT.** Rename `onDeleteError` → `onActionError` callsite.                                                                     |

---

## Phase A — Server: bundle export + upload support

### Task A1: Add `GET /environments/:oid/export-bundle` (happy path + 404)

**Files:**

- Modify: `packages/server/src/routes/export-import.ts` (add route + helper near end of `createExportImportRouter`)
- Create: `packages/server/src/__tests__/environment-bundle.test.ts`

- [ ] **Step 1: Write the failing test (happy path + 404)**

Create `packages/server/src/__tests__/environment-bundle.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import JSZip from 'jszip'
import Database from 'better-sqlite3'
import { createManagementRouter } from '../routes/management.js'
import {
  EnvironmentRepository,
  ActionRepository,
  CodeVersionRepository,
  SettingsRepository,
  InstanceRepository,
  runMigrations,
} from '@trajectory/storage'
import { InstanceManager } from '@trajectory/engine'

interface TestHarness {
  app: express.Express
  db: Database.Database
  manager: InstanceManager
  envOid: string
  actionOids: string[]
}

async function seedKitchenLite(harness: TestHarness): Promise<void> {
  // Seed one env with 2 observable actions, each with 2 code states.
  // Reuse the same upload path other suites use:
  const envPayload = {
    local_id: 'KitchenLite',
    oid: '11111111-1111-1111-1111-111111111111',
    version: '1',
    last_modified_date: '2026-05-19T00:00:00.000Z',
    schemaVersion: '4.0',
    environment_specifications: [
      {
        oid: '22222222-2222-2222-2222-222222222222',
        local_id: 'KitchenLite',
        version: '1',
        last_modified_date: '2026-05-19T00:00:00.000Z',
        description: null,
        action_property_specifications: [],
        value_property_specifications: [],
        resource_property_specifications: [],
        included_actions: [
          {
            oid: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
            local_id: 'Boil',
            version: '1',
            last_modified_date: '2026-05-19T00:00:00.000Z',
            description: null,
            action_visibility: 'observable',
            input_parameter_specifications: [
              { id: 'temp', value_type: 'number', default_value: '100', description: null },
            ],
            output_parameter_specifications: [
              { id: 'status', value_type: 'string', default_value: '0', description: null },
            ],
            property_specifications: [],
            timeout_seconds: null,
          },
          {
            oid: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
            local_id: 'Chop',
            version: '1',
            last_modified_date: '2026-05-19T00:00:00.000Z',
            description: null,
            action_visibility: 'opaque',
            input_parameter_specifications: [],
            output_parameter_specifications: [
              { id: 'status', value_type: 'string', default_value: '0', description: null },
            ],
            property_specifications: [],
            timeout_seconds: null,
          },
        ],
      },
    ],
  }
  await request(harness.app)
    .post('/management/v1/environments/upload')
    .attach('files', Buffer.from(JSON.stringify(envPayload)), 'KitchenLite.WFenvir')
    .expect(200)

  // Attach a tiny piece of code to Boil/STARTING via the actions endpoint.
  // Pattern copied from existing scenario tests.
  await request(harness.app)
    .post('/management/v1/actions/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/code')
    .send({ state: 'STARTING', source_code: '# Boil STARTING\noutputs["status"] = "0"\n' })
    .expect(201)
  await request(harness.app)
    .post('/management/v1/actions/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/code')
    .send({ state: 'EXECUTING', source_code: '# Boil EXECUTING\nimport time\ntime.sleep(0.01)\n' })
    .expect(201)

  harness.envOid = '22222222-2222-2222-2222-222222222222'
  harness.actionOids = [
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  ]
}

async function createHarness(): Promise<TestHarness> {
  const db = new Database(':memory:')
  runMigrations(db)
  const environmentRepo = new EnvironmentRepository(db)
  const actionRepo = new ActionRepository(db)
  const codeVersionRepo = new CodeVersionRepository(db)
  const settingsRepo = new SettingsRepository(db)
  const instanceRepo = new InstanceRepository(db)
  const manager = new InstanceManager(
    environmentRepo,
    actionRepo,
    codeVersionRepo,
    settingsRepo,
    instanceRepo
  )
  const app = express()
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
      settingsRepo,
      instanceRepo
    )
  )
  return { app, db, manager, envOid: '', actionOids: [] }
}

describe('environment-bundle export', () => {
  let harness: TestHarness

  beforeEach(async () => {
    harness = await createHarness()
    await seedKitchenLite(harness)
  })

  afterEach(async () => {
    await harness.manager.shutdown()
    harness.db.close()
  })

  it('returns 404 for unknown env oid', async () => {
    const res = await request(harness.app).get(
      '/management/v1/environments/99999999-9999-9999-9999-999999999999/export-bundle'
    )
    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('NOT_FOUND')
  })

  it('emits a valid .WFenvirBundleX ZIP with manifest + inner .WFenvir + code', async () => {
    const res = await request(harness.app)
      .get(`/management/v1/environments/${harness.envOid}/export-bundle`)
      .responseType('blob')

    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/application\/zip/)
    expect(res.headers['content-disposition']).toContain('.WFenvirBundleX')

    const zip = await JSZip.loadAsync(res.body)
    // Manifest
    const manifestEntry = zip.file('manifest.json')
    expect(manifestEntry).not.toBeNull()
    const manifest = JSON.parse(await manifestEntry!.async('text'))
    expect(manifest.format).toBe('WFenvirBundleX')
    expect(manifest.format_version).toBe(1)
    expect(manifest.environment_oid).toBe(harness.envOid)
    expect(manifest.environment_local_id).toBe('KitchenLite')
    expect(manifest.action_count).toBe(2)
    expect(manifest.code_file_count).toBe(2)

    // Inner .WFenvir
    const innerEntry = zip.file('KitchenLite.WFenvir')
    expect(innerEntry).not.toBeNull()
    const innerJson = JSON.parse(await innerEntry!.async('text'))
    expect(innerJson.environment_specifications).toHaveLength(1)
    expect(innerJson.environment_specifications[0].included_actions).toHaveLength(2)

    // Code files at code/<oid>/<STATE>.py
    const boilStarting = zip.file(`code/${harness.actionOids[0]}/STARTING.py`)
    const boilExecuting = zip.file(`code/${harness.actionOids[0]}/EXECUTING.py`)
    expect(boilStarting).not.toBeNull()
    expect(boilExecuting).not.toBeNull()
    expect(await boilStarting!.async('text')).toContain('# Boil STARTING')
  })
})
```

- [ ] **Step 2: Run test to verify it fails for the right reason**

Run:

```bash
npm test --workspace=@trajectory/server -- environment-bundle
```

Expected: the 404 test passes (the route returns 404 because it doesn't exist yet — Express returns its default 404 with HTML, so adjust if needed). The happy-path test fails because the response is a 404 HTML page, not a ZIP. Both failures should be due to missing route, not anything else.

If the 404 test passes by accident (Express HTML response includes "NOT_FOUND"-ish text), tighten the assertion to inspect `res.body.error.code` only — which will fail when the route is absent because the body is HTML. That's the failure we want.

- [ ] **Step 3: Implement `buildEnvironmentBundle` + the route**

In `packages/server/src/routes/export-import.ts`, add this helper function inside `createExportImportRouter` (after the existing helpers, before `return router`):

```typescript
async function buildEnvironmentBundle(envOid: string): Promise<{
  buffer: Buffer
  filename: string
  manifest: {
    format: 'WFenvirBundleX'
    format_version: 1
    exported_at: string
    container_version: string
    environment_oid: string
    environment_local_id: string
    action_count: number
    code_file_count: number
  }
} | null> {
  const env = environmentRepo.findByOid(envOid)
  if (!env) return null

  const actions = actionRepo.findByEnvironment(env.oid)

  // Inner .WFenvir JSON — mirrors the per-env entry in the snapshot exporter.
  const innerEnvJson = {
    local_id: env.local_id,
    oid: env.oid,
    version: env.version,
    last_modified_date: env.last_modified_date,
    schemaVersion: env.schema_version ?? '4.0',
    environment_specifications: [
      {
        oid: env.oid,
        local_id: env.local_id,
        version: env.version,
        last_modified_date: env.last_modified_date,
        description: env.description,
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
      },
    ],
  }

  const zip = new JSZip()
  zip.file(`${env.local_id}.WFenvir`, JSON.stringify(innerEnvJson, null, 2))

  let codeFileCount = 0
  for (const action of actions) {
    const allVersions = codeVersionRepo.findByAction(action.oid)
    const activeVersions = allVersions.filter((v) => v.is_active)
    for (const v of activeVersions) {
      zip.file(`code/${action.oid}/${v.state}.py`, v.source_code)
      codeFileCount++
    }
  }

  const manifest = {
    format: 'WFenvirBundleX' as const,
    format_version: 1 as const,
    exported_at: new Date().toISOString(),
    container_version: '1.0.0',
    environment_oid: env.oid,
    environment_local_id: env.local_id,
    action_count: actions.length,
    code_file_count: codeFileCount,
  }
  zip.file('manifest.json', JSON.stringify(manifest, null, 2))

  const buffer = await zip.generateAsync({ type: 'nodebuffer' })
  const filename = `${env.local_id}.WFenvirBundleX`
  return { buffer, filename, manifest }
}
```

Add the route just after the existing `/snapshot/import` definition:

```typescript
// --------------------------------------------------------
// GET /environments/:oid/export-bundle — Download .WFenvirBundleX ZIP
// --------------------------------------------------------
router.get('/environments/:oid/export-bundle', (req, res, next) => {
  const oid = req.params.oid as string
  buildEnvironmentBundle(oid)
    .then((result) => {
      if (!result) {
        return void res.status(404).json({
          error: { code: 'NOT_FOUND', message: `Environment not found: ${oid}` },
        })
      }
      res.set({
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(result.filename)}"`,
        'Content-Length': String(result.buffer.length),
      })
      res.send(result.buffer)
    })
    .catch(next)
})
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
npm test --workspace=@trajectory/server -- environment-bundle
```

Expected: both 404 and happy-path tests pass.

- [ ] **Step 5: Run full server test suite to confirm no regressions**

```bash
npm test --workspace=@trajectory/server
```

Expected: total green count = prior baseline + 2.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/routes/export-import.ts \
        packages/server/src/__tests__/environment-bundle.test.ts
git commit -m "feat(server): add GET /environments/:oid/export-bundle for .WFenvirBundleX download"
```

---

### Task A2: Add empty-env case

**Files:**

- Modify: `packages/server/src/__tests__/environment-bundle.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `describe('environment-bundle export', ...)`:

```typescript
it('emits a valid bundle for an empty env (zero actions)', async () => {
  // Seed a second env with no actions
  const emptyEnvPayload = {
    local_id: 'EmptyLite',
    oid: '33333333-3333-3333-3333-333333333333',
    version: '1',
    last_modified_date: '2026-05-19T00:00:00.000Z',
    schemaVersion: '4.0',
    environment_specifications: [
      {
        oid: '44444444-4444-4444-4444-444444444444',
        local_id: 'EmptyLite',
        version: '1',
        last_modified_date: '2026-05-19T00:00:00.000Z',
        description: null,
        action_property_specifications: [],
        value_property_specifications: [],
        resource_property_specifications: [],
        included_actions: [],
      },
    ],
  }
  await request(harness.app)
    .post('/management/v1/environments/upload')
    .attach('files', Buffer.from(JSON.stringify(emptyEnvPayload)), 'EmptyLite.WFenvir')
    .expect(200)

  const res = await request(harness.app)
    .get('/management/v1/environments/44444444-4444-4444-4444-444444444444/export-bundle')
    .responseType('blob')

  expect(res.status).toBe(200)
  const zip = await JSZip.loadAsync(res.body)
  const manifest = JSON.parse(await zip.file('manifest.json')!.async('text'))
  expect(manifest.action_count).toBe(0)
  expect(manifest.code_file_count).toBe(0)

  // No code files should exist
  const codeEntries = Object.keys(zip.files).filter((n) => n.startsWith('code/'))
  expect(codeEntries).toHaveLength(0)
})
```

- [ ] **Step 2: Run test (should already pass if Task A1's impl handles zero actions correctly)**

```bash
npm test --workspace=@trajectory/server -- environment-bundle
```

Expected: 3 passing tests. If the empty-env case fails, fix `buildEnvironmentBundle` to handle the zero-action case — the existing implementation should already do so (loops over `actions` array, runs zero iterations).

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/__tests__/environment-bundle.test.ts
git commit -m "test(server): cover .WFenvirBundleX export of empty environment"
```

---

### Task A3: Upload-handler extension — `'wfenvirbundlex'` parsing branch

**Files:**

- Modify: `packages/server/src/routes/management.ts` (lines around 228–270 — extension allowlist; lines around 250–270 — `ParsedFile` union; lines around 393+ — parsing-loop)

- [ ] **Step 1: Write the failing test (allowlist + malformed bundle)**

Append to `packages/server/src/__tests__/environment-bundle.test.ts`:

```typescript
it('rejects upload with no inner .WFenvir entry', async () => {
  // Build a malformed bundle: ZIP missing the inner .WFenvir
  const zip = new JSZip()
  zip.file('manifest.json', JSON.stringify({ format: 'WFenvirBundleX', format_version: 1 }))
  zip.file('code/abc/STARTING.py', '# orphan')
  const buf = await zip.generateAsync({ type: 'nodebuffer' })

  const res = await request(harness.app)
    .post('/management/v1/environments/upload')
    .attach('files', buf, 'Malformed.WFenvirBundleX')

  expect(res.status).toBe(400)
  expect(res.body.error.message).toMatch(/inner|envir|missing/i)
})

it('accepts .WFenvirBundleX through the upload allowlist', async () => {
  // Use the exported bundle from a seeded env as input.
  const exportRes = await request(harness.app)
    .get(`/management/v1/environments/${harness.envOid}/export-bundle`)
    .responseType('blob')
  expect(exportRes.status).toBe(200)

  // Delete the env so the upload re-creates it
  await request(harness.app).delete(`/management/v1/environments/${harness.envOid}`).expect(200)

  const uploadRes = await request(harness.app)
    .post('/management/v1/environments/upload')
    .attach('files', exportRes.body, 'KitchenLite.WFenvirBundleX')

  expect(uploadRes.status).toBe(200)
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test --workspace=@trajectory/server -- environment-bundle
```

Expected: both new tests fail because the extension is not in the allowlist (400 with `VALIDATION_ERROR` and a message about valid extensions).

- [ ] **Step 3: Extend the extension allowlist**

In `packages/server/src/routes/management.ts`, find the validation around lines 228–245 and update:

```typescript
// Before
if (ext !== 'wfenvir' && ext !== 'wfenvirx' && ext !== 'wfaction' && ext !== 'wfactioncodex') {
  return void res.status(400).json({
    error: {
      code: 'VALIDATION_ERROR',
      message: `Invalid file extension for "${file.originalname}". Expected .WFenvir, .WFenvirX, .WFaction, or .WFactionCodeX`,
      details: { filename: file.originalname },
    },
  })
}

// After
if (
  ext !== 'wfenvir' &&
  ext !== 'wfenvirx' &&
  ext !== 'wfaction' &&
  ext !== 'wfactioncodex' &&
  ext !== 'wfenvirbundlex'
) {
  return void res.status(400).json({
    error: {
      code: 'VALIDATION_ERROR',
      message: `Invalid file extension for "${file.originalname}". Expected .WFenvir, .WFenvirX, .WFaction, .WFactionCodeX, or .WFenvirBundleX`,
      details: { filename: file.originalname },
    },
  })
}
```

- [ ] **Step 4: Extend the `ParsedFile` discriminated union**

In `management.ts`, find the `type ParsedFile = ...` declaration (around lines 250–270) and add the new variant:

```typescript
type ParsedFile =
  | { file: Express.Multer.File; type: 'wfenvir'; data: any; schemaVersion?: string }
  | { file: Express.Multer.File; type: 'wfaction'; data: any }
  | {
      file: Express.Multer.File
      type: 'wfactioncodex'
      data: any
      codeFiles: Array<{ state: string; source: string }>
    }
  | {
      file: Express.Multer.File
      type: 'wfenvirbundlex'
      data: any // the inner .WFenvir JSON object (library shape)
      schemaVersion: string
      codeByActionOid: Record<string, Array<{ state: string; source: string }>>
    }
```

- [ ] **Step 5: Add the parsing branch**

After the existing `wfactioncodex` branch (around line 393), add:

```typescript
if (ext === 'wfenvirbundlex') {
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

  // Find the inner *.WFenvir entry (same logic as the .WFenvirX branch)
  const innerEntry = Object.values(zip.files).find((entry) => {
    if (entry.dir) return false
    const innerExt = entry.name.split('.').pop()?.toLowerCase() ?? ''
    return innerExt === 'wfenvir'
  })
  if (!innerEntry) {
    return void res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: `Bundle "${file.originalname}" has no inner *.WFenvir entry`,
        details: { filename: file.originalname },
      },
    })
  }

  let libData: unknown
  try {
    libData = JSON.parse(await innerEntry.async('text'))
  } catch {
    return void res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: `Failed to parse inner .WFenvir JSON in "${file.originalname}"`,
        details: { filename: file.originalname },
      },
    })
  }
  if (typeof libData !== 'object' || libData === null) {
    return void res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: `Inner .WFenvir in "${file.originalname}" must contain a JSON object`,
        details: { filename: file.originalname },
      },
    })
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lib = libData as Record<string, any>

  // Validate the same required fields as .WFenvirX
  const libRequired = [
    'local_id',
    'oid',
    'version',
    'last_modified_date',
    'environment_specifications',
  ]
  for (const field of libRequired) {
    if (lib[field] === undefined) {
      return void res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: `Missing required field "${field}" in inner .WFenvir of "${file.originalname}"`,
          details: { filename: file.originalname },
        },
      })
    }
  }
  const schemaVersion = typeof lib['schemaVersion'] === 'string' ? lib['schemaVersion'] : '4.0'

  // Collect code files grouped by action OID
  const codeByActionOid: Record<string, Array<{ state: string; source: string }>> = {}
  for (const entry of Object.values(zip.files)) {
    if (entry.dir) continue
    const match = /^code\/([^/]+)\/([^/]+)\.py$/.exec(entry.name)
    if (!match) continue
    const actionOid = match[1]!
    const state = match[2]!
    const source = await entry.async('text')
    ;(codeByActionOid[actionOid] ??= []).push({ state, source })
  }

  parsed.push({ file, type: 'wfenvirbundlex', data: lib, schemaVersion, codeByActionOid })
  continue
}
```

- [ ] **Step 6: Run tests — malformed should pass, allowlist test still fails on the transaction loop**

```bash
npm test --workspace=@trajectory/server -- environment-bundle
```

Expected: the malformed-bundle test passes (400 with "no inner \*.WFenvir"). The allowlist test still fails because the parsed file is pushed but the transaction loop has no `'wfenvirbundlex'` branch yet — the upload returns 200 with empty imported summary (silent no-op), so `expect(uploadRes.status).toBe(200)` passes accidentally but the round-trip data check (Task A4) will catch it.

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/routes/management.ts \
        packages/server/src/__tests__/environment-bundle.test.ts
git commit -m "feat(server): parse .WFenvirBundleX uploads (allowlist + ParsedFile + extraction)"
```

---

### Task A4: Upload-handler — transaction-loop branch for `'wfenvirbundlex'`

**Files:**

- Modify: `packages/server/src/routes/management.ts` (transaction-loop section around line 538+)

- [ ] **Step 1: Write the failing round-trip test**

Append to `environment-bundle.test.ts`:

```typescript
it('round-trips: export → delete → re-upload restores env + actions + code', async () => {
  // Export bundle
  const exportRes = await request(harness.app)
    .get(`/management/v1/environments/${harness.envOid}/export-bundle`)
    .responseType('blob')
  expect(exportRes.status).toBe(200)

  // Capture original code text for byte-equal comparison after round-trip
  const beforeZip = await JSZip.loadAsync(exportRes.body)
  const beforeStarting = await beforeZip
    .file(`code/${harness.actionOids[0]}/STARTING.py`)!
    .async('text')

  // Delete the env
  await request(harness.app).delete(`/management/v1/environments/${harness.envOid}`).expect(200)

  // Re-upload
  const uploadRes = await request(harness.app)
    .post('/management/v1/environments/upload')
    .attach('files', exportRes.body, 'KitchenLite.WFenvirBundleX')
  expect(uploadRes.status).toBe(200)

  // Verify env exists and has the same shape
  const envRes = await request(harness.app)
    .get(`/management/v1/environments/${harness.envOid}`)
    .expect(200)
  expect(envRes.body.local_id).toBe('KitchenLite')
  expect(envRes.body.actions).toHaveLength(2)

  // Verify code byte-equality for one state on one action
  const codeRes = await request(harness.app)
    .get(`/management/v1/actions/${harness.actionOids[0]}/code/STARTING`)
    .expect(200)
  expect(codeRes.body.source_code).toBe(beforeStarting)
})

it('round-trips an env with no code (no spurious code rows)', async () => {
  // Boil + Chop currently both have code attached. Delete code from Boil/STARTING.
  // (Skipping for brevity if no code-delete endpoint exists — see fallback below.)
  // Instead: seed a fresh env with no code attached, then round-trip.

  const noCodeEnv = {
    local_id: 'NoCode',
    oid: '55555555-5555-5555-5555-555555555555',
    version: '1',
    last_modified_date: '2026-05-19T00:00:00.000Z',
    schemaVersion: '4.0',
    environment_specifications: [
      {
        oid: '66666666-6666-6666-6666-666666666666',
        local_id: 'NoCode',
        version: '1',
        last_modified_date: '2026-05-19T00:00:00.000Z',
        description: null,
        action_property_specifications: [],
        value_property_specifications: [],
        resource_property_specifications: [],
        included_actions: [
          {
            oid: '77777777-7777-7777-7777-777777777777',
            local_id: 'Silent',
            version: '1',
            last_modified_date: '2026-05-19T00:00:00.000Z',
            description: null,
            action_visibility: 'opaque',
            input_parameter_specifications: [],
            output_parameter_specifications: [],
            property_specifications: [],
            timeout_seconds: null,
          },
        ],
      },
    ],
  }
  await request(harness.app)
    .post('/management/v1/environments/upload')
    .attach('files', Buffer.from(JSON.stringify(noCodeEnv)), 'NoCode.WFenvir')
    .expect(200)

  const exportRes = await request(harness.app)
    .get('/management/v1/environments/66666666-6666-6666-6666-666666666666/export-bundle')
    .responseType('blob')
  expect(exportRes.status).toBe(200)

  await request(harness.app)
    .delete('/management/v1/environments/66666666-6666-6666-6666-666666666666')
    .expect(200)

  const uploadRes = await request(harness.app)
    .post('/management/v1/environments/upload')
    .attach('files', exportRes.body, 'NoCode.WFenvirBundleX')
  expect(uploadRes.status).toBe(200)

  // Verify env exists and action has no states_with_code
  const envRes = await request(harness.app)
    .get('/management/v1/environments/66666666-6666-6666-6666-666666666666')
    .expect(200)
  expect(envRes.body.actions[0].states_with_code).toEqual([])
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test --workspace=@trajectory/server -- environment-bundle
```

Expected: both round-trip tests fail. The first fails because re-uploaded env may exist but the GET on code endpoint returns 404 (no code created). The second may fail similarly.

- [ ] **Step 3: Add the transaction-loop branch**

In `management.ts`, find the loop that processes `parsed` files into the database (after parsing, inside the transaction). The existing structure is around lines 538+ where it iterates `for (const p of parsed)` and switches on `p.type`. Add the new branch alongside `'wfenvir'`/`'wfenvirx'`/`'wfaction'`/`'wfactioncodex'`:

> Implementation note: the existing `'wfenvirx'` branch already processes `environment_specifications[]` and `included_actions[]`. Refactor the env-processing block of `'wfenvirx'` into a local helper `processEnvLibrary(lib, schemaVersion)` returning a list of upserted `{ actionOid, action }` records, then call it from both `'wfenvirx'` and the new `'wfenvirbundlex'` branch. The `'wfenvirbundlex'` branch additionally creates initial code versions from `codeByActionOid`.

Concrete plan (the actual storage API is `codeVersionRepo.saveAndActivate(input: CodeVersionInput)` where `CodeVersionInput = { action_oid, state, source_code, created_by?, description? }` — verified against `packages/storage/src/repositories/code-version.repository.ts:212` and `packages/storage/src/types.ts:233`):

**Step 5a — extract a `processEnvLibrary` helper from the existing `'wfenvirx'` branch.** Find the body of the `'wfenvirx'` branch in the transaction loop. Move the inner env-spec/action-spec upsert loop into a local closure named `processEnvLibrary(lib, schemaVersion)` that returns the array of `{ actionOid: string }` it upserted (keep the existing side effects on imported counts intact). Replace the inlined body in the `'wfenvirx'` branch with a call to this helper. This refactor is a no-op for `'wfenvirx'` behavior — the existing tests in `management.test.ts` and the scenario suites will catch any regression.

**Step 5b — add the `'wfenvirbundlex'` branch using the helper:**

```typescript
if (p.type === 'wfenvirbundlex') {
  const upserted = processEnvLibrary(p.data, p.schemaVersion)
  for (const { actionOid } of upserted) {
    const codeFiles = p.codeByActionOid[actionOid] ?? []
    for (const cf of codeFiles) {
      codeVersionRepo.saveAndActivate({
        action_oid: actionOid,
        state: cf.state,
        source_code: cf.source,
        description: 'imported from .WFenvirBundleX',
      })
    }
  }
  // Mirror the existing branches' imported-summary tracking (incrementing
  // environments_imported / actions_imported / code_files_imported counters
  // wired into the response payload).
  continue
}
```

> Verify the imported-summary response fields by reading what `'wfenvirx'` and `'wfactioncodex'` push into the response; mirror that exactly so the bundle round-trip surfaces in the same UI affordances.

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test --workspace=@trajectory/server -- environment-bundle
```

Expected: all 7 environment-bundle tests pass.

- [ ] **Step 5: Run full server suite to confirm no regressions on the existing `'wfenvirx'` branch**

```bash
npm test --workspace=@trajectory/server
```

Expected: prior baseline + 7 new = full green count.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/routes/management.ts \
        packages/server/src/__tests__/environment-bundle.test.ts
git commit -m "feat(server): import .WFenvirBundleX uploads (env + actions + code round-trip)"
```

---

## Phase B — Client libraries

### Task B1: Add deps + download helper

**Files:**

- Modify: `apps/console/package.json`
- Create: `apps/console/src/lib/download.ts`

- [ ] **Step 1: Add `jspdf` and `jszip` deps**

In `apps/console/package.json`, add to `dependencies` (alphabetical order, near `class-variance-authority`):

```json
"jspdf": "^2.5.2",
"jszip": "^3.10.1",
```

- [ ] **Step 2: Install**

```bash
npm install
```

Expected: 2 new packages added (jspdf + jszip). `jszip` may already be present transitively but we want it as a direct console dep.

- [ ] **Step 3: Verify build still passes**

```bash
npm run build --workspace=@trajectory/console
```

Expected: clean build.

- [ ] **Step 4: Create `apps/console/src/lib/download.ts`**

```typescript
export function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
```

- [ ] **Step 5: Commit**

```bash
git add apps/console/package.json apps/console/src/lib/download.ts package-lock.json
git commit -m "feat(console): add jspdf + jszip deps and download helper"
```

---

### Task B2: `envir-bundle.ts` — types + parser

**Files:**

- Create: `apps/console/src/lib/envir-bundle.ts`
- Create: `apps/console/src/lib/envir-bundle.test.ts`

- [ ] **Step 1: Write failing test**

Create `apps/console/src/lib/envir-bundle.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import JSZip from 'jszip'
import { parseEnvirBundle, type EnvirBundle } from './envir-bundle'

async function buildFixtureBundle(): Promise<Blob> {
  const zip = new JSZip()
  zip.file(
    'manifest.json',
    JSON.stringify({
      format: 'WFenvirBundleX',
      format_version: 1,
      exported_at: '2026-05-19T00:00:00.000Z',
      container_version: '1.0.0',
      environment_oid: 'env-oid',
      environment_local_id: 'TestEnv',
      action_count: 1,
      code_file_count: 1,
    })
  )
  zip.file(
    'TestEnv.WFenvir',
    JSON.stringify({
      local_id: 'TestEnv',
      oid: 'env-oid',
      version: '1',
      environment_specifications: [
        {
          oid: 'env-oid',
          local_id: 'TestEnv',
          version: '1',
          description: null,
          last_modified_date: null,
          action_property_specifications: [],
          included_actions: [
            {
              oid: 'action-oid',
              local_id: 'TestAction',
              version: '1',
              description: null,
              action_visibility: 'observable',
              input_parameter_specifications: [],
              output_parameter_specifications: [],
            },
          ],
        },
      ],
    })
  )
  zip.file('code/action-oid/STARTING.py', '# starting code\n')
  const blob = await zip.generateAsync({ type: 'blob' })
  return blob
}

describe('parseEnvirBundle', () => {
  it('parses manifest + inner .WFenvir + code into EnvirBundle', async () => {
    const blob = await buildFixtureBundle()
    const bundle: EnvirBundle = await parseEnvirBundle(blob)

    expect(bundle.manifest.format).toBe('WFenvirBundleX')
    expect(bundle.manifest.environment_oid).toBe('env-oid')

    expect(bundle.environment.local_id).toBe('TestEnv')

    expect(bundle.actions).toHaveLength(1)
    expect(bundle.actions[0].record.local_id).toBe('TestAction')
    expect(bundle.actions[0].code.STARTING).toBe('# starting code\n')
  })

  it('throws on missing manifest.json', async () => {
    const zip = new JSZip()
    zip.file('TestEnv.WFenvir', '{}')
    const blob = await zip.generateAsync({ type: 'blob' })
    await expect(parseEnvirBundle(blob)).rejects.toThrow(/manifest\.json/)
  })

  it('throws on missing inner .WFenvir', async () => {
    const zip = new JSZip()
    zip.file('manifest.json', JSON.stringify({ format: 'WFenvirBundleX', format_version: 1 }))
    const blob = await zip.generateAsync({ type: 'blob' })
    await expect(parseEnvirBundle(blob)).rejects.toThrow(/\.WFenvir/)
  })

  it('throws on empty environment_specifications array', async () => {
    const zip = new JSZip()
    zip.file('manifest.json', JSON.stringify({ format: 'WFenvirBundleX', format_version: 1 }))
    zip.file('Empty.WFenvir', JSON.stringify({ environment_specifications: [] }))
    const blob = await zip.generateAsync({ type: 'blob' })
    await expect(parseEnvirBundle(blob)).rejects.toThrow(/environment/i)
  })
})
```

- [ ] **Step 2: Run test (fails — file doesn't exist)**

```bash
npm test --workspace=@trajectory/console -- envir-bundle
```

Expected: failure with module-not-found error.

- [ ] **Step 3: Implement `apps/console/src/lib/envir-bundle.ts`**

```typescript
import JSZip from 'jszip'

export interface BundleManifest {
  format: 'WFenvirBundleX'
  format_version: number
  exported_at: string
  container_version: string
  environment_oid: string
  environment_local_id: string
  action_count: number
  code_file_count: number
}

export interface BundleParameterSpec {
  id: string
  value_type: string
  default_value: string
  description: string | null
}

export interface BundleEnvironment {
  oid: string
  local_id: string
  version: string
  description: string | null
  last_modified_date: string | null
  action_property_specifications: BundleParameterSpec[]
}

export interface BundleAction {
  oid: string
  local_id: string
  version: string
  action_visibility: 'observable' | 'opaque'
  description: string | null
  input_parameter_specifications: BundleParameterSpec[]
  output_parameter_specifications: BundleParameterSpec[]
}

export interface BundleActionEntry {
  record: BundleAction
  code: Record<string, string>
}

export interface EnvirBundle {
  manifest: BundleManifest
  environment: BundleEnvironment
  actions: BundleActionEntry[]
}

export async function parseEnvirBundle(blob: Blob): Promise<EnvirBundle> {
  const buffer = await blob.arrayBuffer()
  const zip = await JSZip.loadAsync(buffer)

  // 1) Manifest
  const manifestEntry = zip.file('manifest.json')
  if (!manifestEntry) {
    throw new Error('Bundle is missing manifest.json')
  }
  const manifest = JSON.parse(await manifestEntry.async('text')) as BundleManifest

  // 2) Inner .WFenvir
  const innerEntry = Object.values(zip.files).find((entry) => {
    if (entry.dir) return false
    if (entry.name === 'manifest.json') return false
    return entry.name.toLowerCase().endsWith('.wfenvir')
  })
  if (!innerEntry) {
    throw new Error('Bundle has no inner *.WFenvir entry')
  }
  const lib = JSON.parse(await innerEntry.async('text')) as {
    environment_specifications: Array<Record<string, unknown>>
  }
  if (
    !Array.isArray(lib.environment_specifications) ||
    lib.environment_specifications.length === 0
  ) {
    throw new Error('Inner .WFenvir has empty or missing environment_specifications')
  }
  const envSpec = lib.environment_specifications[0] as BundleEnvironment & {
    included_actions: BundleAction[]
  }

  // 3) Code files
  const codeByActionOid: Record<string, Record<string, string>> = {}
  for (const entry of Object.values(zip.files)) {
    if (entry.dir) continue
    const match = /^code\/([^/]+)\/([^/]+)\.py$/.exec(entry.name)
    if (!match) continue
    const [, actionOid, state] = match
    ;(codeByActionOid[actionOid!] ??= {})[state!] = await entry.async('text')
  }

  // 4) Assemble action entries
  const actions: BundleActionEntry[] = (envSpec.included_actions ?? []).map((a) => ({
    record: a,
    code: codeByActionOid[a.oid] ?? {},
  }))

  return {
    manifest,
    environment: {
      oid: envSpec.oid,
      local_id: envSpec.local_id,
      version: envSpec.version,
      description: envSpec.description,
      last_modified_date: envSpec.last_modified_date,
      action_property_specifications: envSpec.action_property_specifications ?? [],
    },
    actions,
  }
}
```

- [ ] **Step 4: Run test (should pass)**

```bash
npm test --workspace=@trajectory/console -- envir-bundle
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/console/src/lib/envir-bundle.ts apps/console/src/lib/envir-bundle.test.ts
git commit -m "feat(console): add parseEnvirBundle + types for .WFenvirBundleX"
```

---

### Task B3: `pdf/environment-report.ts` — jsPDF generator

**Files:**

- Create: `apps/console/src/lib/pdf/environment-report.ts`
- Create: `apps/console/src/lib/pdf/environment-report.test.ts`

- [ ] **Step 1: Write failing test**

Create `apps/console/src/lib/pdf/environment-report.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { generateEnvironmentReportPDF } from './environment-report'
import type { EnvirBundle } from '../envir-bundle'

const FIXTURE: EnvirBundle = {
  manifest: {
    format: 'WFenvirBundleX',
    format_version: 1,
    exported_at: '2026-05-19T00:00:00.000Z',
    container_version: '1.0.0',
    environment_oid: 'env-oid',
    environment_local_id: 'KitchenLite',
    action_count: 2,
    code_file_count: 2,
  },
  environment: {
    oid: 'env-oid',
    local_id: 'KitchenLite',
    version: '1',
    description: 'Test env description',
    last_modified_date: '2026-05-19T00:00:00.000Z',
    action_property_specifications: [
      { id: 'PRINTER_HOST', value_type: 'string', default_value: '10.0.0.5', description: null },
    ],
  },
  actions: [
    {
      record: {
        oid: 'boil-oid',
        local_id: 'Boil',
        version: '1',
        action_visibility: 'observable',
        description: 'Boils water',
        input_parameter_specifications: [
          {
            id: 'temperature',
            value_type: 'number',
            default_value: '100',
            description: 'Target temp',
          },
        ],
        output_parameter_specifications: [
          { id: 'status', value_type: 'string', default_value: '0', description: null },
        ],
      },
      code: {
        STARTING: '# Boil STARTING\noutputs["status"] = "0"\n',
        EXECUTING: '# Boil EXECUTING\nimport time\ntime.sleep(0.01)\n',
      },
    },
    {
      record: {
        oid: 'chop-oid',
        local_id: 'Chop',
        version: '1',
        action_visibility: 'opaque',
        description: null,
        input_parameter_specifications: [],
        output_parameter_specifications: [
          { id: 'status', value_type: 'string', default_value: '0', description: null },
        ],
      },
      code: {},
    },
  ],
}

describe('generateEnvironmentReportPDF', () => {
  it('returns a Blob with PDF magic bytes', async () => {
    const blob = generateEnvironmentReportPDF(FIXTURE)
    expect(blob.type).toBe('application/pdf')
    expect(blob.size).toBeGreaterThan(1000)

    const buf = new Uint8Array(await blob.arrayBuffer())
    expect(String.fromCharCode(buf[0], buf[1], buf[2], buf[3], buf[4])).toBe('%PDF-')
  })

  it('embeds env local_id and action local_ids in the PDF stream', async () => {
    const blob = generateEnvironmentReportPDF(FIXTURE)
    const text = await blob.text()
    // jsPDF text streams are not always plain ASCII but env names are typically searchable.
    expect(text).toContain('KitchenLite')
    expect(text).toContain('Boil')
    expect(text).toContain('Chop')
  })

  it('handles actions with no code segments without throwing', async () => {
    const noCode: EnvirBundle = {
      ...FIXTURE,
      actions: [{ ...FIXTURE.actions[1]! }],
    }
    expect(() => generateEnvironmentReportPDF(noCode)).not.toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test --workspace=@trajectory/console -- environment-report
```

Expected: module-not-found failure.

- [ ] **Step 3: Implement `apps/console/src/lib/pdf/environment-report.ts`**

```typescript
import { jsPDF } from 'jspdf'
import type { EnvirBundle, BundleAction, BundleParameterSpec } from '../envir-bundle'

const PAGE_MARGIN = 15 // mm
const LINE_HEIGHT_BODY = 5
const LINE_HEIGHT_CODE = 3.5
const PAGE_W = 210 // A4 mm
const PAGE_H = 297
const CONTENT_W = PAGE_W - PAGE_MARGIN * 2
const PAGE_BREAK_THRESHOLD = 80 // mm — start a new page if less remains

export function generateEnvironmentReportPDF(bundle: EnvirBundle): Blob {
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' })
  const generatedAt = new Date().toISOString()

  let y = renderCover(pdf, bundle)
  y = ensureNewPage(pdf, y)

  for (const action of bundle.actions) {
    y = renderAction(pdf, y, action)
  }

  renderHeadersAndFooters(pdf, bundle, generatedAt)

  const arrayBuffer = pdf.output('arraybuffer')
  return new Blob([arrayBuffer], { type: 'application/pdf' })
}

function renderCover(pdf: jsPDF, bundle: EnvirBundle): number {
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(18)
  pdf.text(bundle.environment.local_id, PAGE_MARGIN, PAGE_MARGIN + 6)

  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(10)
  const dateStr = bundle.environment.last_modified_date ?? bundle.manifest.exported_at
  pdf.text(
    `v${bundle.environment.version} · imported ${formatDate(dateStr)} · ${bundle.actions.length} actions`,
    PAGE_MARGIN,
    PAGE_MARGIN + 13
  )

  let y = PAGE_MARGIN + 22
  if (bundle.environment.description) {
    const lines = pdf.splitTextToSize(bundle.environment.description, CONTENT_W) as string[]
    for (const line of lines) {
      pdf.text(line, PAGE_MARGIN, y)
      y += LINE_HEIGHT_BODY
    }
    y += 2
  }

  // Environment action properties table
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(12)
  pdf.text('Environment action properties', PAGE_MARGIN, y)
  y += 6
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(10)
  if (bundle.environment.action_property_specifications.length === 0) {
    pdf.text('(none)', PAGE_MARGIN, y)
    y += LINE_HEIGHT_BODY
  } else {
    y = renderParamTable(pdf, y, bundle.environment.action_property_specifications, [
      'name',
      'data_type',
      'default',
    ])
  }
  y += 4

  // Actions overview
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(12)
  pdf.text(`Actions (${bundle.actions.length})`, PAGE_MARGIN, y)
  y += 6
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(10)
  for (let i = 0; i < bundle.actions.length; i++) {
    const a = bundle.actions[i]!
    pdf.text(`${i + 1}. ${a.record.local_id}`, PAGE_MARGIN, y)
    pdf.text(a.record.action_visibility, PAGE_MARGIN + 70, y)
    y += LINE_HEIGHT_BODY
    if (y > PAGE_H - PAGE_MARGIN - 10) {
      pdf.addPage()
      y = PAGE_MARGIN
    }
  }
  return y
}

function renderAction(
  pdf: jsPDF,
  yIn: number,
  action: { record: BundleAction; code: Record<string, string> }
): number {
  let y = yIn
  if (y > PAGE_H - PAGE_MARGIN - PAGE_BREAK_THRESHOLD) {
    pdf.addPage()
    y = PAGE_MARGIN
  }

  // Header line: name + visibility
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(12)
  pdf.text(action.record.local_id, PAGE_MARGIN, y)
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(10)
  pdf.text(action.record.action_visibility, PAGE_W - PAGE_MARGIN - 25, y)
  y += 6

  // Description
  if (action.record.description) {
    const lines = pdf.splitTextToSize(action.record.description, CONTENT_W) as string[]
    for (const line of lines) {
      pdf.text(line, PAGE_MARGIN, y)
      y += LINE_HEIGHT_BODY
    }
    y += 2
  }

  // Input params
  pdf.setFont('helvetica', 'bold')
  pdf.text('Input parameters', PAGE_MARGIN, y)
  y += 5
  pdf.setFont('helvetica', 'normal')
  if (action.record.input_parameter_specifications.length === 0) {
    pdf.text('(no input parameters)', PAGE_MARGIN, y)
    y += LINE_HEIGHT_BODY
  } else {
    y = renderParamTable(pdf, y, action.record.input_parameter_specifications, [
      'name',
      'description',
      'default',
    ])
  }
  y += 3

  // Output params
  pdf.setFont('helvetica', 'bold')
  pdf.text('Output parameters', PAGE_MARGIN, y)
  y += 5
  pdf.setFont('helvetica', 'normal')
  if (action.record.output_parameter_specifications.length === 0) {
    pdf.text('(no output parameters)', PAGE_MARGIN, y)
    y += LINE_HEIGHT_BODY
  } else {
    y = renderParamTable(pdf, y, action.record.output_parameter_specifications, [
      'name',
      'description',
    ])
  }
  y += 3

  // Code segments
  pdf.setFont('helvetica', 'bold')
  const states = Object.keys(action.code)
  pdf.text(
    `Code segments (${states.length} state${states.length === 1 ? '' : 's'} with code)`,
    PAGE_MARGIN,
    y
  )
  y += 5
  pdf.setFont('helvetica', 'normal')
  if (states.length === 0) {
    pdf.text('(no code segments authored)', PAGE_MARGIN, y)
    y += LINE_HEIGHT_BODY
  } else {
    for (const state of states) {
      y = renderCodeBlock(pdf, y, action.record.local_id, state, action.code[state]!)
      y += 2
    }
  }
  y += 5
  return y
}

function renderParamTable(
  pdf: jsPDF,
  yIn: number,
  rows: BundleParameterSpec[],
  columns: string[]
): number {
  let y = yIn
  // Compute column widths proportional to content area
  const colW = columns.length === 3 ? [50, 80, 50] : [60, 120]
  const startX = PAGE_MARGIN

  // Header row
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(9)
  for (let i = 0; i < columns.length; i++) {
    pdf.text(columns[i]!, startX + sum(colW.slice(0, i)), y)
  }
  y += 4
  pdf.setDrawColor(180)
  pdf.setLineWidth(0.2)
  pdf.line(startX, y - 2, startX + sum(colW), y - 2)

  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(9)
  for (const row of rows) {
    const cells = columns.map((c) => {
      if (c === 'name') return row.id
      if (c === 'data_type' || c === 'value_type') return row.value_type
      if (c === 'default') return row.default_value
      if (c === 'description') return row.description ?? ''
      return ''
    })
    // Wrap each cell to its column width
    const wrapped = cells.map((text, i) => pdf.splitTextToSize(text, colW[i]! - 2) as string[])
    const maxLines = Math.max(...wrapped.map((w) => w.length))
    for (let line = 0; line < maxLines; line++) {
      for (let col = 0; col < columns.length; col++) {
        const lineText = wrapped[col]![line] ?? ''
        pdf.text(lineText, startX + sum(colW.slice(0, col)), y)
      }
      y += 4
      if (y > PAGE_H - PAGE_MARGIN - 10) {
        pdf.addPage()
        y = PAGE_MARGIN
      }
    }
    pdf.line(startX, y - 2, startX + sum(colW), y - 2)
  }
  pdf.setFontSize(10)
  return y + 2
}

function renderCodeBlock(
  pdf: jsPDF,
  yIn: number,
  actionLocalId: string,
  state: string,
  source: string
): number {
  let y = yIn

  // State sub-header
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(10)
  pdf.text(`▸ ${state}`, PAGE_MARGIN, y)
  y += LINE_HEIGHT_BODY

  pdf.setFont('courier', 'normal')
  pdf.setFontSize(8)
  const lines = source.split('\n')
  for (const line of lines) {
    // Hard-wrap long lines to page width
    const wrapped = pdf.splitTextToSize(line.length === 0 ? ' ' : line, CONTENT_W) as string[]
    for (const wline of wrapped) {
      if (y > PAGE_H - PAGE_MARGIN - 10) {
        pdf.addPage()
        y = PAGE_MARGIN
        pdf.setFont('helvetica', 'italic')
        pdf.setFontSize(8)
        pdf.text(`${actionLocalId} › ${state} (continued)`, PAGE_MARGIN, y)
        y += LINE_HEIGHT_BODY
        pdf.setFont('courier', 'normal')
        pdf.setFontSize(8)
      }
      pdf.text(wline, PAGE_MARGIN, y)
      y += LINE_HEIGHT_CODE
    }
  }
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(10)
  return y
}

function renderHeadersAndFooters(pdf: jsPDF, bundle: EnvirBundle, generatedAt: string): void {
  const total = pdf.getNumberOfPages()
  for (let i = 1; i <= total; i++) {
    pdf.setPage(i)
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(8)
    pdf.setTextColor(140)
    if (i > 1) {
      pdf.text(
        `${bundle.environment.local_id} · v${bundle.environment.version} · page ${i} of ${total}`,
        PAGE_MARGIN,
        8
      )
    }
    pdf.text(`Generated ${generatedAt}`, PAGE_MARGIN, PAGE_H - 6)
    pdf.setTextColor(0)
  }
}

function ensureNewPage(pdf: jsPDF, y: number): number {
  if (y > PAGE_H - PAGE_MARGIN - PAGE_BREAK_THRESHOLD) {
    pdf.addPage()
    return PAGE_MARGIN
  }
  return y
}

function formatDate(iso: string): string {
  // ISO date → "MM/DD/YYYY"
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return iso
    return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`
  } catch {
    return iso
  }
}

function sum(arr: number[]): number {
  let s = 0
  for (const n of arr) s += n
  return s
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test --workspace=@trajectory/console -- environment-report
```

Expected: all 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/console/src/lib/pdf/environment-report.ts \
        apps/console/src/lib/pdf/environment-report.test.ts
git commit -m "feat(console): add generateEnvironmentReportPDF (jsPDF-based)"
```

---

## Phase C — Client hooks

### Task C1: `useExportEnvironment`

**Files:**

- Modify: `apps/console/src/features/environments/hooks.ts`

- [ ] **Step 1: Read the existing `hooks.ts` to understand the API client pattern**

Run:

```bash
cat apps/console/src/features/environments/hooks.ts
```

Look for: how existing hooks like `useDeleteEnvironment` form URLs, whether there's a shared `apiClient` / `fetch` wrapper that prepends `/management/v1`, and what the React Query patterns look like.

- [ ] **Step 2: Add `useExportEnvironment`**

Append to `hooks.ts` (after the existing exports). Adjust the fetch base path to match the existing helper:

```typescript
import { useCallback, useState } from 'react'
import { triggerDownload } from '@/lib/download'

// Use whatever URL base the existing hooks use. If a helper exists (e.g.,
// `mgmtFetch` or `apiClient`), use that. The implementation below assumes
// a plain absolute path that vite proxies to the server.
const MGMT_BASE = '/management/v1'

export function useExportEnvironment(oid: string, localId: string) {
  const [isPending, setIsPending] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const run = useCallback(async () => {
    setIsPending(true)
    setError(null)
    try {
      const res = await fetch(`${MGMT_BASE}/environments/${oid}/export-bundle`)
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error?.message ?? `Export failed: HTTP ${res.status}`)
      }
      const blob = await res.blob()
      triggerDownload(blob, `${localId}.WFenvirBundleX`)
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)))
      throw err
    } finally {
      setIsPending(false)
    }
  }, [oid, localId])

  return { run, isPending, error }
}
```

- [ ] **Step 3: Smoke-check via build**

```bash
npm run build --workspace=@trajectory/console
```

Expected: clean build.

- [ ] **Step 4: Commit**

```bash
git add apps/console/src/features/environments/hooks.ts
git commit -m "feat(console): add useExportEnvironment hook"
```

---

### Task C2: `useGenerateEnvironmentReport`

**Files:**

- Modify: `apps/console/src/features/environments/hooks.ts`

- [ ] **Step 1: Add the hook with lazy imports of jspdf + jszip**

Append to `hooks.ts`:

```typescript
export function useGenerateEnvironmentReport(oid: string, localId: string) {
  const [isPending, setIsPending] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const run = useCallback(async () => {
    setIsPending(true)
    setError(null)
    try {
      const res = await fetch(`${MGMT_BASE}/environments/${oid}/export-bundle`)
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error?.message ?? `Report fetch failed: HTTP ${res.status}`)
      }
      const blob = await res.blob()

      // Lazy-load the two heavy modules
      const [{ parseEnvirBundle }, { generateEnvironmentReportPDF }] = await Promise.all([
        import('@/lib/envir-bundle'),
        import('@/lib/pdf/environment-report'),
      ])

      const bundle = await parseEnvirBundle(blob)
      const pdfBlob = generateEnvironmentReportPDF(bundle)
      triggerDownload(pdfBlob, `${localId}-report.pdf`)
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)))
      throw err
    } finally {
      setIsPending(false)
    }
  }, [oid, localId])

  return { run, isPending, error }
}
```

- [ ] **Step 2: Verify lazy chunks materialize in build**

```bash
npm run build --workspace=@trajectory/console
```

Expected: clean build. The Vite output should now show one additional async chunk (or two) containing `jspdf` and `jszip` — the main `index-*.js` should NOT have grown by their full weight. Eyeball the chunk listing; rough guideline: main chunk size should be within ±10 KB gz of the prior build.

- [ ] **Step 3: Commit**

```bash
git add apps/console/src/features/environments/hooks.ts
git commit -m "feat(console): add useGenerateEnvironmentReport hook with lazy jspdf+jszip"
```

---

## Phase D — UI integration

### Task D1: Rewrite `EnvironmentNode` (two-line row + dropdown)

**Files:**

- Modify: `apps/console/src/features/explorer/TreeNode.tsx`
- Create: `apps/console/src/features/explorer/TreeNode.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/console/src/features/explorer/TreeNode.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { EnvironmentNode } from './TreeNode'

vi.mock('@/features/environments/hooks', () => ({
  useDeleteEnvironment: () => ({
    mutateAsync: vi.fn().mockResolvedValue({}),
    isPending: false,
  }),
  useExportEnvironment: () => ({ run: vi.fn().mockResolvedValue(undefined), isPending: false, error: null }),
  useGenerateEnvironmentReport: () => ({ run: vi.fn().mockResolvedValue(undefined), isPending: false, error: null }),
}))

function renderWithProviders(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>
  )
}

describe('EnvironmentNode', () => {
  beforeEach(() => {
    vi.spyOn(window, 'confirm').mockImplementation(() => true)
  })

  const baseProps = {
    oid: 'env-oid',
    localId: 'TestEnv',
    actions: [],
    actionCount: 5,
    version: '3',
    lastModifiedDate: '2026-05-10T00:00:00.000Z',
    onActionError: vi.fn(),
  }

  it('renders the two-line row with name + version/date metadata', () => {
    renderWithProviders(<EnvironmentNode {...baseProps} />)
    expect(screen.getByText('TestEnv')).toBeInTheDocument()
    expect(screen.getByText(/\[v3\]/)).toBeInTheDocument()
    expect(screen.getByText(/imported 5\/10/)).toBeInTheDocument()
  })

  it('opens a dropdown menu with three items when the kebab is clicked', async () => {
    renderWithProviders(<EnvironmentNode {...baseProps} />)
    const trigger = screen.getByRole('button', { name: /environment actions/i })
    fireEvent.click(trigger)
    await waitFor(() => {
      expect(screen.getByText('Export Envir Package')).toBeInTheDocument()
      expect(screen.getByText('Generate PDF report')).toBeInTheDocument()
      expect(screen.getByText('Delete environment')).toBeInTheDocument()
    })
  })

  it('clicking Delete confirms then triggers the mutation', async () => {
    const { container } = renderWithProviders(<EnvironmentNode {...baseProps} />)
    fireEvent.click(screen.getByRole('button', { name: /environment actions/i }))
    await waitFor(() => screen.getByText('Delete environment'))
    fireEvent.click(screen.getByText('Delete environment'))
    expect(window.confirm).toHaveBeenCalledWith(
      expect.stringContaining('Delete environment "TestEnv"')
    )
  })
})
```

- [ ] **Step 2: Run test (fails — props/menu don't exist yet)**

```bash
npm test --workspace=@trajectory/console -- TreeNode
```

Expected: failures on props (`version`, `lastModifiedDate`, `onActionError`) and menu items not found.

- [ ] **Step 3: Rewrite `EnvironmentNode` body in `TreeNode.tsx`**

Replace lines 31–95 with:

```typescript
import { useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { ChevronRight, ChevronDown, MoreHorizontal, Download, FileText, Trash2 } from 'lucide-react'
import {
  cn,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@trajectory/ui'
import { usePanelContext } from '@/layout/PanelContext'
import {
  useDeleteEnvironment,
  useExportEnvironment,
  useGenerateEnvironmentReport,
} from '@/features/environments/hooks'
import type { ExplorerAction } from './hooks'

// ... existing OBSERVABLE_STATES / OPAQUE_STATES arrays unchanged ...

export function EnvironmentNode({
  oid,
  localId,
  actions,
  actionCount,
  version,
  lastModifiedDate,
  onActionError,
}: {
  oid: string
  localId: string
  actions: ExplorerAction[]
  actionCount: number
  version: string
  lastModifiedDate: string | null
  onActionError?: (message: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const navigate = useNavigate()
  const params = useParams()
  const deleteMutation = useDeleteEnvironment()
  const exportHook = useExportEnvironment(oid, localId)
  const reportHook = useGenerateEnvironmentReport(oid, localId)
  const Chevron = expanded ? ChevronDown : ChevronRight

  async function handleDelete() {
    const confirmed = window.confirm(
      `Delete environment "${localId}"?\n\nThis will permanently remove the environment, all of its actions, and every saved code version. This cannot be undone.`
    )
    if (!confirmed) return
    try {
      await deleteMutation.mutateAsync(oid)
    } catch (err) {
      onActionError?.(err instanceof Error ? err.message : 'Delete failed')
    }
  }

  async function handleExport() {
    try {
      await exportHook.run()
    } catch (err) {
      onActionError?.(err instanceof Error ? err.message : 'Export failed')
    }
  }

  async function handleReport() {
    try {
      await reportHook.run()
    } catch (err) {
      onActionError?.(err instanceof Error ? err.message : 'PDF report failed')
    }
  }

  const busyExport = exportHook.isPending
  const busyReport = reportHook.isPending
  const busyDelete = deleteMutation.isPending

  return (
    <div>
      <div
        className="group flex items-center gap-1 px-2 py-0.5 cursor-pointer hover:bg-muted/50 text-xs"
        onClick={() => {
          setExpanded(!expanded)
          void navigate(`/environments/${oid}`)
        }}
      >
        <Chevron size={12} className="text-muted-foreground shrink-0" />
        <span className="font-medium text-foreground truncate flex-1">{localId}</span>
        {!expanded && (
          <span className="text-[10px] text-muted-foreground group-hover:hidden">
            {actionCount}
          </span>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              onClick={(e) => e.stopPropagation()}
              aria-label="Environment actions"
              className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground transition-opacity shrink-0"
            >
              <MoreHorizontal size={14} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
            <DropdownMenuItem disabled={busyExport} onSelect={handleExport}>
              <Download size={14} className="mr-2" />
              {busyExport ? 'Export Envir Package — Working…' : 'Export Envir Package'}
            </DropdownMenuItem>
            <DropdownMenuItem disabled={busyReport} onSelect={handleReport}>
              <FileText size={14} className="mr-2" />
              {busyReport ? 'Generate PDF report — Working…' : 'Generate PDF report'}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              disabled={busyDelete}
              variant="destructive"
              onSelect={handleDelete}
            >
              <Trash2 size={14} className="mr-2" />
              {busyDelete ? 'Delete environment — Working…' : 'Delete environment'}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div
        className="pl-5 pr-2 text-[10px] text-muted-foreground"
        style={{ cursor: 'default' }}
      >
        [v{version}] imported {formatShortDate(lastModifiedDate)}
      </div>
      {expanded &&
        actions.map((action) => (
          <ActionNode key={action.oid} action={action} currentActionOid={params.oid} />
        ))}
    </div>
  )
}

function formatShortDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const m = d.getMonth() + 1
  const day = d.getDate()
  const now = new Date()
  if (d.getFullYear() === now.getFullYear()) return `${m}/${day}`
  return `${m}/${day}/${String(d.getFullYear()).slice(2)}`
}
```

> `DropdownMenuItem` from `@trajectory/ui` accepts `variant: 'default' | 'destructive'` (verified against `C:/Trajectory/TrajectoryEditor/packages/ui/src/primitives/dropdown-menu.tsx:46–54`). The styling for `destructive` is wired through Tailwind via the `data-variant="destructive"` selector emitted by the primitive.

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test --workspace=@trajectory/console -- TreeNode
```

Expected: all 3 tests pass.

- [ ] **Step 5: Build to confirm no TypeScript regressions**

```bash
npm run build --workspace=@trajectory/console
```

Expected: clean. If `ExplorerPanel.tsx` (the caller) still passes `onDeleteError`, the build will fail with "Property 'onDeleteError' does not exist" — that's Task D2's signal. For now, accept the failure and move to D2 immediately.

- [ ] **Step 6: Commit (do not commit yet if build fails — wait for D2)**

If build is clean: commit. Otherwise, defer to D2.

```bash
git add apps/console/src/features/explorer/TreeNode.tsx \
        apps/console/src/features/explorer/TreeNode.test.tsx
git commit -m "feat(console): two-line env row with dropdown actions (Export / PDF / Delete)"
```

---

### Task D2: Update `ExplorerPanel.tsx` callsite

**Files:**

- Modify: `apps/console/src/features/explorer/ExplorerPanel.tsx`

- [ ] **Step 1: Locate the `EnvironmentNode` props passed by `ExplorerPanel`**

```bash
grep -n "EnvironmentNode" apps/console/src/features/explorer/ExplorerPanel.tsx
```

- [ ] **Step 2: Rename `onDeleteError` → `onActionError` and pass `version` + `lastModifiedDate`**

In `ExplorerPanel.tsx`, find the JSX where `<EnvironmentNode ...>` is rendered. Update:

```tsx
// Before
<EnvironmentNode
  oid={env.oid}
  localId={env.local_id}
  actions={...}
  actionCount={...}
  onDeleteError={setErrorMessage}
/>

// After
<EnvironmentNode
  oid={env.oid}
  localId={env.local_id}
  actions={...}
  actionCount={...}
  version={env.version}
  lastModifiedDate={env.last_modified_date}
  onActionError={setErrorMessage}
/>
```

(The exact `env.*` field names match `EnvironmentSummary` in `apps/console/src/lib/types.ts`. Verify by reading lines 83–94 of that file.)

- [ ] **Step 3: Build to confirm**

```bash
npm run build --workspace=@trajectory/console
```

Expected: clean.

- [ ] **Step 4: Run full client suite**

```bash
npm test --workspace=@trajectory/console
```

Expected: prior baseline + 4 new (envir-bundle ×4 + environment-report ×3 + TreeNode ×3 = +10).

- [ ] **Step 5: Commit (combined D1 + D2 if D1 was deferred, else just D2)**

```bash
git add apps/console/src/features/explorer/
git commit -m "feat(console): wire ExplorerPanel to renamed onActionError + new env metadata"
```

---

## Phase E — Full verification + manual smoke

### Task E1: Run full repo build + test, then manual smoke

**Files:** none (verification only)

- [ ] **Step 1: Clean rebuild and full test**

```bash
npm run build
npm test
```

Expected: green build, green tests. Total test count = prior baseline (1076 client+server + 15 sidecar) + at least 17 new (7 server bundle + 4 envir-bundle + 3 environment-report + 3 TreeNode).

- [ ] **Step 2: Restart dev servers**

If `npm run dev` is already running, kill it (only the processes under `C:\Trajectory\TrajectoryActions`, NOT sibling Trajectory apps — per `tasks/lessons.md`). Then:

```bash
npm run dev
```

Wait for Express :3002 + Vite :5176 to come up.

- [ ] **Step 3: Manual UI walkthrough**

Open `http://localhost:5176`. In the left tree, hover over an env row (Warehouse or Kitchen). Verify:

1. **Two-line layout** — env name on line 1; `[v{version}] imported {MM/DD}` on line 2 in muted micro-type.
2. **Kebab visible on hover** at the right edge of line 1, hidden otherwise.
3. **Clicking the kebab opens a dropdown** with three items in order: Export Envir Package, Generate PDF report, ―separator―, Delete environment.
4. **Export** downloads `<localId>.WFenvirBundleX`. Open the ZIP in any tool; verify `manifest.json` + `<localId>.WFenvir` + `code/<oid>/<STATE>.py` entries match the env's content.
5. **Generate PDF report** downloads `<localId>-report.pdf`. Open it; verify the cover page lists actions, each action shows parameters + code segments, page numbers are correct.
6. **Delete** still prompts via `window.confirm`, errors still surface in whatever UI the panel uses for delete errors.

- [ ] **Step 4: Round-trip smoke**

1. Export Kitchen env.
2. Click Delete on Kitchen env (confirm). Kitchen disappears.
3. Drag the downloaded `KitchenLite.WFenvirBundleX` (well, `Kitchen-something.WFenvirBundleX`) onto the upload affordance in the console.
4. Verify the env reappears with all 10 actions and code intact (spot-check one action's code via the action detail view).

- [ ] **Step 5: Optional — STATE.md update**

If you maintain `.planning/STATE.md` for the project, append a one-paragraph entry under "Last activity" describing what shipped (this feature + bundle format + tests count).

- [ ] **Step 6: Final commit (if anything was touched in Step 5) and PR**

```bash
git log --oneline -20  # confirm the commit chain
```

The branch is ready for PR. Suggested PR title: `feat: per-environment export bundle + PDF report + tree-row dropdown`.

---

## Self-review (post-write)

This section is for the plan author — leave it intact for the implementer to read.

**Spec coverage:** Goals 1–5 from spec map to: G1 → D1; G2 → A1–A4; G3 → B3, C2; G4 → D1; G5 → D1 (preserved `window.confirm` + delete mutation). Acceptance criteria 1–8 → A1–A4 (criteria 3, 4, 7), B1–B3 (criterion 5), D1 (criteria 1, 2, 6), C2 + E1 (criterion 8).

**Placeholder scan:** no TBD/TODO/etc. The `codeVersionRepo.saveAndActivate` signature in Task A4 and the `DropdownMenuItem` `variant` prop in Task D1 were both verified during plan-writing against the actual source files — call shapes and prop types in the plan are correct.

**Type consistency:** `EnvirBundle`, `BundleManifest`, `BundleAction`, `BundleEnvironment`, `BundleActionEntry`, `BundleParameterSpec` are defined once (B2) and consumed unchanged in B3, C2. Hook return shapes match between hooks.ts (C1, C2) and TreeNode.tsx (D1).

**Scope check:** 12 tasks across 5 phases. Server: 4 tasks (A1–A4). Client: 5 tasks (B1–B3, C1–C2). UI: 2 tasks (D1–D2). Verification: 1 task (E1). Each task is one TDD cycle + commit. Fits a single PR.
