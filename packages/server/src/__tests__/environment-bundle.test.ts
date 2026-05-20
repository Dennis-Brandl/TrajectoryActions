/**
 * environment-bundle.test.ts — Integration tests for the
 * GET /environments/:oid/export-bundle endpoint.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
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

interface TestHarness {
  app: express.Express
  db: BetterSqlite3.Database
  manager: InstanceManager
  envOid: string
  actionOids: string[]
}

function createHarness(): TestHarness {
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
      sseManager.publishTerminal(instanceId, state, prev, instance)
    },
    onError: (instanceId: string, error: Error) => {
      sseManager.publishError(instanceId, error.message)
    },
  })

  const app = express()
  app.use(
    cors({
      origin: '*',
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    })
  )
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

  return { app, db, manager, envOid: '', actionOids: [] }
}

async function seedKitchenLite(harness: TestHarness): Promise<void> {
  // Upload one environment with 2 actions via the bulk upload endpoint.
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
    .post('/management/v1/upload')
    .attach('files', Buffer.from(JSON.stringify(envPayload)), 'KitchenLite.WFenvir')
    .expect(200)

  // Attach code to the Boil action via POST /management/v1/code/:action_oid/:state
  await request(harness.app)
    .post('/management/v1/code/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/STARTING')
    .send({ source_code: '# Boil STARTING\noutputs["status"] = "0"\n' })
    .expect(201)

  await request(harness.app)
    .post('/management/v1/code/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/EXECUTING')
    .send({ source_code: '# Boil EXECUTING\nimport time\ntime.sleep(0.01)\n' })
    .expect(201)

  harness.envOid = '22222222-2222-2222-2222-222222222222'
  harness.actionOids = [
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  ]
}

describe('environment-bundle export', () => {
  let harness: TestHarness

  beforeEach(async () => {
    harness = createHarness()
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

  it('emits a valid .WFenvirBundle ZIP with manifest + inner .WFenvir + code', async () => {
    const res = await request(harness.app)
      .get(`/management/v1/environments/${harness.envOid}/export-bundle`)
      .responseType('blob')

    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/application\/zip/)
    expect(res.headers['content-disposition']).toBe(
      'attachment; filename="KitchenLite.WFenvirBundle"'
    )

    const zip = await JSZip.loadAsync(res.body as Buffer)

    const manifestEntry = zip.file('manifest.json')
    expect(manifestEntry).not.toBeNull()
    const manifest = JSON.parse(await manifestEntry!.async('text'))
    expect(manifest.format).toBe('WFenvirBundle')
    expect(manifest.format_version).toBe(1)
    expect(manifest.environment_oid).toBe(harness.envOid)
    expect(manifest.environment_local_id).toBe('KitchenLite')
    expect(manifest.action_count).toBe(2)
    expect(manifest.code_file_count).toBe(2)

    const innerEntry = zip.file('KitchenLite.WFenvir')
    expect(innerEntry).not.toBeNull()
    const innerJson = JSON.parse(await innerEntry!.async('text'))
    // Top-level library fields the upload handler requires
    expect(innerJson.oid).toBe(harness.envOid)
    expect(innerJson.local_id).toBe('KitchenLite')
    expect(innerJson.version).toBe('1')
    expect(innerJson.last_modified_date).toBeTruthy()
    expect(innerJson.schemaVersion).toBe('4.0')
    expect(innerJson.environment_specifications).toHaveLength(1)

    // Inner env spec
    const envSpec = innerJson.environment_specifications[0]
    expect(envSpec.oid).toBe(harness.envOid)
    expect(envSpec.local_id).toBe('KitchenLite')
    expect(envSpec.included_actions).toHaveLength(2)

    // Spot-check one included action's parameter specs round-tripped
    const boil = envSpec.included_actions.find((a: { local_id: string }) => a.local_id === 'Boil')
    expect(boil).toBeTruthy()
    expect(boil.input_parameter_specifications).toHaveLength(1)
    expect(boil.input_parameter_specifications[0].id).toBe('temp')

    const boilStarting = zip.file(`code/${harness.actionOids[0]}/STARTING.py`)
    const boilExecuting = zip.file(`code/${harness.actionOids[0]}/EXECUTING.py`)
    expect(boilStarting).not.toBeNull()
    expect(boilExecuting).not.toBeNull()
    expect(await boilStarting!.async('text')).toContain('# Boil STARTING')

    // Chop has no code — no code files for it
    const chopFile = zip.file(`code/${harness.actionOids[1]}/STARTING.py`)
    expect(chopFile).toBeNull()
  })
})
