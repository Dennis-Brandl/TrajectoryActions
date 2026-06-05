import { describe, it, expect } from 'vitest'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
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
import { errorHandler } from '../middleware/error-handler.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SCRIPT_PATH = path.resolve(__dirname, '../../../../python-sidecar/sandbox_runner.py')

// Management router WITHOUT auth, so we exercise the settings handlers' own
// redaction logic in isolation.
function createMgmtApp() {
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
      settingsRepo,
      sseManager
    )
  )
  app.use(errorHandler)
  return { app, manager, settingsRepo }
}

describe('settings api_key redaction', () => {
  it('masks the api_key value in GET /settings and reports configured', async () => {
    const { app, manager, settingsRepo } = createMgmtApp()
    try {
      settingsRepo.update('api_key', 'topsecret')
      const res = await request(app).get('/management/v1/settings')
      expect(res.status).toBe(200)
      const item = (res.body.data as Array<Record<string, unknown>>).find(
        (s) => s.key === 'api_key'
      )
      expect(item).toBeDefined()
      expect(item!.value).not.toBe('topsecret')
      expect(item!.configured).toBe(true)
      // the secret must not appear anywhere in the response
      expect(JSON.stringify(res.body)).not.toContain('topsecret')
    } finally {
      await manager.shutdown()
    }
  }, 30000)

  it('reports configured=false when api_key is empty', async () => {
    const { app, manager } = createMgmtApp()
    try {
      const res = await request(app).get('/management/v1/settings')
      const item = (res.body.data as Array<Record<string, unknown>>).find(
        (s) => s.key === 'api_key'
      )
      expect(item!.configured).toBe(false)
    } finally {
      await manager.shutdown()
    }
  }, 30000)

  it('does not echo the api_key value in the PUT response', async () => {
    const { app, manager } = createMgmtApp()
    try {
      const res = await request(app)
        .put('/management/v1/settings/api_key')
        .send({ value: 'brand-new-secret' })
      expect(res.status).toBe(200)
      expect(JSON.stringify(res.body)).not.toContain('brand-new-secret')
    } finally {
      await manager.shutdown()
    }
  }, 30000)
})
