import express from 'express'
import cors from 'cors'
import morgan from 'morgan'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  initializeDatabase,
  databaseSchemaStatus,
  ActionRepository,
  InstanceRepository,
  SettingsRepository,
  EnvironmentRepository,
  CodeVersionRepository,
  LogRepository,
} from '@trajectory/storage'
import { InstanceManager } from '@trajectory/engine'
import { SseManager } from './sse-manager.js'
import { createProtocolRouter } from './routes/protocol.js'
import { createCommandsRouter } from './routes/commands.js'
import { createManagementRouter } from './routes/management.js'
import { createApiKeyAuth } from './middleware/auth.js'
import { errorHandler } from './middleware/error-handler.js'
import { applyApiKeyFromEnv } from './config.js'

// ============================================================
// ESM __dirname equivalent
// ============================================================

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// ============================================================
// Configuration
// ============================================================

const PORT = Number(process.env.PORT ?? 3001)
const HOST = process.env.HOST ?? '0.0.0.0'
// __dirname is packages/server/src (tsx) or packages/server/dist (compiled)
// Go up to packages/server/, then packages/, then project root
const PACKAGE_ROOT = path.resolve(__dirname, '..')
const PROJECT_ROOT = path.resolve(PACKAGE_ROOT, '..', '..')

const DB_PATH = process.env.DB_PATH ?? path.resolve(PROJECT_ROOT, 'data', 'trajectory.db')
const SIDECAR_SCRIPT =
  process.env.SIDECAR_SCRIPT ??
  path.resolve(PROJECT_ROOT, 'packages', 'python-sidecar', 'sandbox_runner.py')

// ============================================================
// Startup: database, repositories, managers
// ============================================================

const db = initializeDatabase(DB_PATH)

// Standalone repositories for protocol router (in addition to InstanceManager's internal repos)
const actionRepo = new ActionRepository(db)
const instanceRepo = new InstanceRepository(db)
const settingsRepo = new SettingsRepository(db)
const environmentRepo = new EnvironmentRepository(db)
const codeVersionRepo = new CodeVersionRepository(db)
const logRepo = new LogRepository(db)

// Optionally enable auth declaratively: if ACTIONS_API_KEY is set, persist it as
// the api_key setting so an exposed deployment requires it without manual UI steps.
applyApiKeyFromEnv(settingsRepo, process.env.ACTIONS_API_KEY)

// SSE event bus
const sseManager = new SseManager()

// InstanceManager wired with SseManager callbacks
const manager = new InstanceManager(db, {
  scriptPath: SIDECAR_SCRIPT,
  // sseManager satisfies PropertySsePublisher (structural typing — no explicit cast needed)
  sseManager,
  onStateChange: (instanceId, state, instance) => {
    const history = instance.state_history as Array<{ state: string; timestamp: string }>
    const previousState = history.length >= 2 ? (history[history.length - 2]?.state ?? null) : null
    sseManager.publishStateChange(instanceId, state, previousState, instance)
  },
  onTerminal: (instanceId, state, instance) => {
    const history = instance.state_history as Array<{ state: string; timestamp: string }>
    const previousState = history.length >= 2 ? (history[history.length - 2]?.state ?? null) : null
    sseManager.publishTerminal(instanceId, state, previousState, instance)
  },
  onError: (instanceId, error) => {
    sseManager.publishError(instanceId, error.message)
  },
})

// ============================================================
// Express application
// ============================================================

const app = express()

// --------------------------------------------------------
// Middleware (order matters)
// --------------------------------------------------------

app.use(
  cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'X-API-Key', 'Last-Event-ID'],
    exposedHeaders: ['Content-Type'],
  })
)

app.use(morgan('dev'))
app.use(express.json())

// Health/readiness: verifies DB connectivity AND that the schema is fully
// present. Unauthenticated so the container HEALTHCHECK can probe it. Returns
// 503 over an empty/incomplete database instead of a green TCP port.
app.get('/health', (_req, res) => {
  try {
    db.prepare('SELECT 1').get()
  } catch {
    return void res.status(503).json({ status: 'error', message: 'database connection failed' })
  }
  const { ok, missingTables } = databaseSchemaStatus(db)
  if (!ok) {
    return void res
      .status(503)
      .json({ status: 'error', message: 'database schema incomplete', missingTables })
  }
  return void res.json({ status: 'ok' })
})

// API key auth on all /trajectory/v1/ routes
app.use('/trajectory/v1', createApiKeyAuth(settingsRepo))

// --------------------------------------------------------
// Routers
// --------------------------------------------------------

app.use(
  '/trajectory/v1',
  createProtocolRouter(manager, actionRepo, instanceRepo, settingsRepo, sseManager, environmentRepo)
)

app.use('/trajectory/v1', createCommandsRouter(manager, sseManager))

// API key auth on all /management/v1/ routes (mirrors /trajectory/v1 above).
// Closes the unauthenticated management surface (incl. the code/test code-exec
// endpoint and snapshot import/export). Open only when no api_key is configured.
app.use('/management/v1', createApiKeyAuth(settingsRepo))

app.use(
  '/management/v1',
  createManagementRouter(
    db,
    DB_PATH,
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

// --------------------------------------------------------
// Error handler — must be LAST
// --------------------------------------------------------

app.use(errorHandler)

// ============================================================
// Listen
// ============================================================

app.listen(PORT, HOST, () => {
  console.log(`Trajectory Action Server listening on http://${HOST}:${PORT}`)
  console.log(`  Database: ${DB_PATH}`)
  console.log(`  Sidecar:  ${SIDECAR_SCRIPT}`)
  if (!settingsRepo.getValue('api_key')) {
    console.warn(
      '\n  WARNING: no api_key is configured — the management and REST APIs are UNAUTHENTICATED.\n' +
        '  Keep this bound to loopback (the docker compose default) or set ACTIONS_API_KEY before exposing it.\n'
    )
  }
})

// ============================================================
// Graceful shutdown
// ============================================================

process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down...')
  sseManager.shutdown()
  await manager.shutdown()
  process.exit(0)
})

process.on('SIGINT', async () => {
  console.log('SIGINT received, shutting down...')
  sseManager.shutdown()
  await manager.shutdown()
  process.exit(0)
})
