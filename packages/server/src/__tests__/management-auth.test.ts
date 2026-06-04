import { describe, it, expect } from 'vitest'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
import cors from 'cors'
import request from 'supertest'
import {
  initializeDatabase,
  ActionRepository,
  InstanceRepository,
  SettingsRepository,
  EnvironmentRepository,
  CodeVersionRepository,
  LogRepository,
} from '@trajectory/storage'
import { InstanceManager } from '@trajectory/engine'
import { SseManager } from '../sse-manager.js'
import { createManagementRouter } from '../routes/management.js'
import { createApiKeyAuth } from '../middleware/auth.js'
import { errorHandler } from '../middleware/error-handler.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SCRIPT_PATH = path.resolve(__dirname, '../../../../python-sidecar/sandbox_runner.py')

// Mirrors the production wiring in index.ts: createApiKeyAuth in front of the
// management router. `apiKey === null` leaves auth open (no key configured).
function createAuthedApp(apiKey: string | null) {
  const db = initializeDatabase(':memory:')
  const environmentRepo = new EnvironmentRepository(db)
  const actionRepo = new ActionRepository(db)
  const codeVersionRepo = new CodeVersionRepository(db)
  const instanceRepo = new InstanceRepository(db)
  const logRepo = new LogRepository(db)
  const settingsRepo = new SettingsRepository(db)
  const sseManager = new SseManager()
  if (apiKey !== null) settingsRepo.update('api_key', apiKey)

  const manager = new InstanceManager(db, {
    scriptPath: SCRIPT_PATH,
    poolSize: 1,
    onStateChange: () => {},
    onTerminal: () => {},
    onError: () => {},
  })

  const app = express()
  app.use(cors({ origin: '*' }))
  app.use(express.json())
  app.use('/management/v1', createApiKeyAuth(settingsRepo))
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
      settingsRepo,
      sseManager
    )
  )
  app.use(errorHandler)
  return { app, manager }
}

describe('/management/v1 authentication', () => {
  it('allows access when no api_key is configured (open)', async () => {
    const { app, manager } = createAuthedApp(null)
    try {
      const res = await request(app).get('/management/v1/dashboard')
      expect(res.status).toBe(200)
    } finally {
      await manager.shutdown()
    }
  }, 30000)

  it('rejects a management request without the key when one is configured (401)', async () => {
    const { app, manager } = createAuthedApp('secret')
    try {
      const res = await request(app).get('/management/v1/dashboard')
      expect(res.status).toBe(401)
    } finally {
      await manager.shutdown()
    }
  }, 30000)

  it('rejects the code/test arbitrary-code-execution endpoint without the key (401)', async () => {
    const { app, manager } = createAuthedApp('secret')
    try {
      const res = await request(app)
        .post('/management/v1/code/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/EXECUTING/test')
        .send({ source_code: "import os; os.system('id')" })
      expect(res.status).toBe(401)
    } finally {
      await manager.shutdown()
    }
  }, 30000)

  it('allows a management request with the correct key (200)', async () => {
    const { app, manager } = createAuthedApp('secret')
    try {
      const res = await request(app).get('/management/v1/dashboard').set('X-API-Key', 'secret')
      expect(res.status).toBe(200)
    } finally {
      await manager.shutdown()
    }
  }, 30000)
})
