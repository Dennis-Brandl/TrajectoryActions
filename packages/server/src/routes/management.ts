import { Router } from 'express'
import { execSync } from 'node:child_process'
import { statSync } from 'node:fs'
import multer from 'multer'
import JSZip from 'jszip'
import type BetterSqlite3 from 'better-sqlite3'
import { createExportImportRouter } from './export-import.js'
import type { InstanceManager } from '@trajectory/engine'
import type {
  EnvironmentRepository,
  ActionRepository,
  CodeVersionRepository,
  InstanceRepository,
  LogRepository,
  SettingsRepository,
  FinalStatus,
} from '@trajectory/storage'
import { createTransactionHelper } from '@trajectory/storage'
import type { LogQueryFilters } from '@trajectory/storage'
import { validateBody } from '../validation.js'

// ============================================================
// Python version cache (set once on first factory call)
// ============================================================

let cachedPythonVersion: string | null = null

// ============================================================
// Management router factory
// ============================================================

/**
 * createManagementRouter — Express Router with all /management/v1/ endpoints.
 *
 * Endpoints (plan 06-01):
 *   GET  /dashboard                     — MGMT-01
 *   POST /upload                        — MGMT-02
 *   GET  /environments                  — MGMT-03
 *   GET  /environments/:oid             — MGMT-04
 *   DELETE /environments/:oid           — MGMT-05
 *   GET  /actions/:oid                  — MGMT-06
 *   PUT  /actions/:oid/timeout           — per-action timeout
 *
 * Endpoints (plan 06-02):
 *   GET  /code/:action_oid/:state                          — MGMT-07
 *   GET  /code/:action_oid/:state/active                   — MGMT-08
 *   GET  /code/:action_oid/:state/:version_id              — MGMT-08
 *   POST /code/:action_oid/:state                          — MGMT-09
 *   POST /code/:action_oid/:state/:version_id/activate     — MGMT-10
 *   DELETE /code/:action_oid/:state/:version_id            — MGMT-11
 *   POST /code/:action_oid/:state/test                     — MGMT-12
 *
 * Endpoints (plan 06-03):
 *   GET  /instances/active              — MGMT-13a
 *   GET  /instances/history             — MGMT-13b
 *   GET  /instances/:id                 — MGMT-14
 *   POST /instances/:id/command         — MGMT-15
 *   GET  /log                           — MGMT-16
 *   GET  /log/:id                       — MGMT-17
 *   GET  /settings                      — MGMT-18
 *   PUT  /settings/:key                 — MGMT-18
 */
export function createManagementRouter(
  db: BetterSqlite3.Database,
  dbPath: string,
  manager: InstanceManager,
  environmentRepo: EnvironmentRepository,
  actionRepo: ActionRepository,
  codeVersionRepo: CodeVersionRepository,
  instanceRepo: InstanceRepository,
  logRepo: LogRepository,
  settingsRepo: SettingsRepository
): Router {
  // Cache python version on first factory call
  if (cachedPythonVersion === null) {
    try {
      cachedPythonVersion = execSync('python --version', { encoding: 'utf-8' }).trim()
    } catch {
      /* null */
    }
  }

  // Multer with memory storage, 10 MB limit
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
  })

  const router = Router()
  const txHelper = createTransactionHelper(db)

  // Mount export/import sub-router
  router.use(
    createExportImportRouter(db, environmentRepo, actionRepo, codeVersionRepo, settingsRepo)
  )

  // --------------------------------------------------------
  // MGMT-01: GET /dashboard
  // --------------------------------------------------------
  router.get('/dashboard', (req, res, next) => {
    try {
      const uptimeSeconds = Math.floor(process.uptime())
      const startedAt = new Date(Date.now() - uptimeSeconds * 1000).toISOString()

      // DB size
      let dbSizeBytes: number | null = null
      if (dbPath && dbPath !== ':memory:') {
        try {
          dbSizeBytes = statSync(dbPath).size
        } catch {
          /* null */
        }
      }

      // Pool status
      const poolStatus = manager.poolStatus

      // Environments / actions
      const totalEnvironments = environmentRepo.count()
      const totalActions = actionRepo.count()

      // Instances
      const activeInstances = instanceRepo.countActive()

      // Completed / aborted today
      const todayMidnightUtc = new Date()
      todayMidnightUtc.setUTCHours(0, 0, 0, 0)
      const todayStr = todayMidnightUtc.toISOString()

      const completedTodayResult = logRepo.query({
        finalStatus: 'COMPLETED',
        startDate: todayStr,
      })
      const completedToday = completedTodayResult.total

      const abortedTodayResult = logRepo.query({
        finalStatus: 'ABORTED',
        startDate: todayStr,
      })
      const abortedToday = abortedTodayResult.total

      // Log info
      const totalLogEntries = logRepo.count()
      const maxLogEntries = settingsRepo.getNumericValue('log_max_size')
      const oldestEntryResult = logRepo.query({ limit: 1 })
      const oldestEntry =
        oldestEntryResult.entries.length > 0
          ? oldestEntryResult.entries[oldestEntryResult.entries.length - 1]
          : null
      const oldestEntryAt = oldestEntry ? oldestEntry.completed_at : null

      // Recent log entries
      const countParam = req.query['count']
      const recentCount = Math.min(
        Math.max(1, parseInt(typeof countParam === 'string' ? countParam : '10', 10) || 10),
        100
      )
      const recentEntries = logRepo.getRecent(recentCount)
      const recentLogEntries = recentEntries.map((e) => ({
        id: e.id,
        runtime_action_instance_id: e.runtime_action_instance_id,
        action_name: e.action_name,
        environment_name: e.environment_name,
        started_at: e.started_at,
        completed_at: e.completed_at,
        duration_ms: e.duration_ms,
        final_status: e.final_status,
        error: e.error,
      }))

      res.status(200).json({
        data: {
          container: {
            uptime_seconds: uptimeSeconds,
            started_at: startedAt,
            node_version: process.version,
            python_version: cachedPythonVersion,
            db_path: dbPath,
            db_size_bytes: dbSizeBytes,
            memory_rss_bytes: process.memoryUsage().rss,
          },
          python_pool: {
            size: poolStatus.size,
            idle: poolStatus.idle,
            busy: poolStatus.busy,
            queued: poolStatus.queued,
          },
          environments: {
            total_count: totalEnvironments,
            total_actions: totalActions,
          },
          instances: {
            active_count: activeInstances,
            completed_today: completedToday,
            aborted_today: abortedToday,
          },
          log: {
            total_entries: totalLogEntries,
            max_entries: maxLogEntries,
            oldest_entry_at: oldestEntryAt,
          },
          recent_log_entries: recentLogEntries,
        },
        meta: {},
      })
    } catch (err) {
      next(err)
    }
  })

  // --------------------------------------------------------
  // MGMT-02: POST /upload
  // --------------------------------------------------------
  router.post('/upload', upload.array('files'), async (req, res, next) => {
    try {
      const files = req.files as Express.Multer.File[] | undefined

      if (!files || files.length === 0) {
        return void res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'No files provided',
            details: {},
          },
        })
      }

      // Validate file extensions
      for (const file of files) {
        const ext = file.originalname.split('.').pop()?.toLowerCase() ?? ''
        if (
          ext !== 'wfenvir' &&
          ext !== 'wfenvirx' &&
          ext !== 'wfaction' &&
          ext !== 'wfactioncodex' &&
          ext !== 'wfenvirbundle'
        ) {
          return void res.status(400).json({
            error: {
              code: 'VALIDATION_ERROR',
              message: `Invalid file extension for "${file.originalname}". Expected .WFenvir, .WFenvirX, .WFaction, .WFactionCodeX, or .WFenvirBundle`,
              details: { filename: file.originalname },
            },
          })
        }
      }

      // Parse all files first (fail-fast before any DB writes).
      // .WFenvir / .WFenvirX carry library-format JSON ({ …, environment_specifications: [...] })
      // and flatten to one ParsedFile entry per environment.
      type ParsedFile =
        | {
            file: Express.Multer.File
            type: 'wfenvir'
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            data: any
            schemaVersion?: string
          }
        | {
            file: Express.Multer.File
            type: 'wfaction'
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            data: any
          }
        | {
            file: Express.Multer.File
            type: 'wfactioncodex'
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            data: any
            codeFiles: Array<{ state: string; source: string }>
          }
        | {
            file: Express.Multer.File
            type: 'wfenvirbundle'
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            data: any // the inner .WFenvir JSON object (library shape)
            schemaVersion: string
            codeByActionOid: Record<string, Array<{ state: string; source: string }>>
          }

      const parsed: ParsedFile[] = []
      for (const file of files) {
        const ext = file.originalname.split('.').pop()?.toLowerCase() ?? ''

        if (ext === 'wfaction') {
          let data: unknown
          try {
            data = JSON.parse(file.buffer.toString('utf-8'))
          } catch {
            return void res.status(400).json({
              error: {
                code: 'VALIDATION_ERROR',
                message: `Failed to parse JSON in file "${file.originalname}"`,
                details: { filename: file.originalname },
              },
            })
          }
          if (typeof data !== 'object' || data === null) {
            return void res.status(400).json({
              error: {
                code: 'VALIDATION_ERROR',
                message: `File "${file.originalname}" must contain a JSON object`,
                details: { filename: file.originalname },
              },
            })
          }
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const obj = data as Record<string, any>
          for (const field of ['oid', 'local_id', 'version', 'last_modified_date']) {
            if (obj[field] === undefined) {
              return void res.status(400).json({
                error: {
                  code: 'VALIDATION_ERROR',
                  message: `Missing required field "${field}" in .WFaction file "${file.originalname}"`,
                  details: { filename: file.originalname },
                },
              })
            }
          }
          parsed.push({ file, type: 'wfaction', data: obj })
          continue
        }

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
          const codexObj = actionData as Record<string, any>
          for (const field of ['oid', 'local_id', 'version', 'last_modified_date']) {
            if (codexObj[field] === undefined) {
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

          parsed.push({ file, type: 'wfactioncodex', data: codexObj, codeFiles })
          continue
        }

        if (ext === 'wfenvirbundle') {
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

          // Find the inner *.WFenvir entry
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
          // schemaVersion is optional. When present, gate against legacy 2.0/below;
          // when absent, default to "4.0" (mirrors the .WFenvirX branch).
          const rawSchemaVersion = lib['schemaVersion'] as unknown
          let schemaVersion: string
          if (rawSchemaVersion === undefined) {
            schemaVersion = '4.0'
          } else if (typeof rawSchemaVersion !== 'string') {
            return void res.status(400).json({
              error: {
                code: 'VALIDATION_ERROR',
                message: `schemaVersion must be a string in "${file.originalname}"`,
                details: { filename: file.originalname, schemaVersion: rawSchemaVersion },
              },
            })
          } else {
            const ver = parseFloat(rawSchemaVersion)
            if (Number.isNaN(ver) || ver < 3.0) {
              return void res.status(400).json({
                error: {
                  code: 'VALIDATION_ERROR',
                  message: `Unsupported schemaVersion "${rawSchemaVersion}" in "${file.originalname}". Minimum accepted version is "3.0".`,
                  details: { filename: file.originalname, schemaVersion: rawSchemaVersion },
                },
              })
            }
            schemaVersion = rawSchemaVersion
          }

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

          parsed.push({ file, type: 'wfenvirbundle', data: lib, schemaVersion, codeByActionOid })
          continue
        }

        // ext === 'wfenvir' (bare library JSON) or 'wfenvirx' (ZIP wrapping library JSON)
        let libraryJson: string
        if (ext === 'wfenvirx') {
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
          // First inner *.WFenvir or *.WFenvirX entry wins (matches TrajectoryEditor behavior).
          const innerEntry = Object.values(zip.files).find((entry) => {
            if (entry.dir) return false
            const innerExt = entry.name.split('.').pop()?.toLowerCase() ?? ''
            return innerExt === 'wfenvir' || innerExt === 'wfenvirx'
          })
          if (!innerEntry) {
            return void res.status(400).json({
              error: {
                code: 'VALIDATION_ERROR',
                message: `ZIP "${file.originalname}" contains no .WFenvir entry`,
                details: { filename: file.originalname },
              },
            })
          }
          libraryJson = await innerEntry.async('text')
        } else {
          libraryJson = file.buffer.toString('utf-8')
        }

        let libData: unknown
        try {
          libData = JSON.parse(libraryJson)
        } catch {
          return void res.status(400).json({
            error: {
              code: 'VALIDATION_ERROR',
              message: `Failed to parse JSON in file "${file.originalname}"`,
              details: { filename: file.originalname },
            },
          })
        }
        if (typeof libData !== 'object' || libData === null) {
          return void res.status(400).json({
            error: {
              code: 'VALIDATION_ERROR',
              message: `File "${file.originalname}" must contain a JSON object`,
              details: { filename: file.originalname },
            },
          })
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const lib = libData as Record<string, any>

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
                message: `Missing required field "${field}" in environment library "${file.originalname}"`,
                details: { filename: file.originalname },
              },
            })
          }
        }

        // schemaVersion is optional. When present, gate against legacy 2.0/below;
        // when absent (real TrajectoryEditor env-library exports omit it today), default to "4.0".
        const rawSchemaVersion = lib['schemaVersion'] as unknown
        let schemaVersion: string
        if (rawSchemaVersion === undefined) {
          schemaVersion = '4.0'
        } else if (typeof rawSchemaVersion !== 'string') {
          return void res.status(400).json({
            error: {
              code: 'VALIDATION_ERROR',
              message: `schemaVersion must be a string in "${file.originalname}"`,
              details: { filename: file.originalname, schemaVersion: rawSchemaVersion },
            },
          })
        } else {
          const ver = parseFloat(rawSchemaVersion)
          if (Number.isNaN(ver) || ver < 3.0) {
            return void res.status(400).json({
              error: {
                code: 'VALIDATION_ERROR',
                message: `Unsupported schemaVersion "${rawSchemaVersion}" in "${file.originalname}". Minimum accepted version is "3.0".`,
                details: { filename: file.originalname, schemaVersion: rawSchemaVersion },
              },
            })
          }
          schemaVersion = rawSchemaVersion
        }

        if (!Array.isArray(lib['environment_specifications'])) {
          return void res.status(400).json({
            error: {
              code: 'VALIDATION_ERROR',
              message: `"environment_specifications" must be an array in "${file.originalname}"`,
              details: { filename: file.originalname },
            },
          })
        }

        const envSpecs = lib['environment_specifications'] as unknown[]
        for (let idx = 0; idx < envSpecs.length; idx++) {
          const envSpec = envSpecs[idx]
          if (typeof envSpec !== 'object' || envSpec === null) {
            return void res.status(400).json({
              error: {
                code: 'VALIDATION_ERROR',
                message: `Each environment_specifications entry must be an object in "${file.originalname}"`,
                details: { filename: file.originalname, index: idx },
              },
            })
          }
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const env = envSpec as Record<string, any>

          for (const field of ['oid', 'local_id', 'version', 'last_modified_date']) {
            if (env[field] === undefined) {
              return void res.status(400).json({
                error: {
                  code: 'VALIDATION_ERROR',
                  message: `Missing required field "${field}" in environment_specifications[${idx}] of "${file.originalname}"`,
                  details: { filename: file.originalname, index: idx },
                },
              })
            }
          }
          if (!Array.isArray(env['included_actions'])) {
            return void res.status(400).json({
              error: {
                code: 'VALIDATION_ERROR',
                message: `"included_actions" must be an array in environment_specifications[${idx}] of "${file.originalname}"`,
                details: { filename: file.originalname, index: idx },
              },
            })
          }
          for (const action of env['included_actions'] as unknown[]) {
            if (typeof action !== 'object' || action === null) {
              return void res.status(400).json({
                error: {
                  code: 'VALIDATION_ERROR',
                  message: `Each included_action must be an object in environment_specifications[${idx}] of "${file.originalname}"`,
                  details: { filename: file.originalname, index: idx },
                },
              })
            }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const act = action as Record<string, any>
            for (const field of ['oid', 'local_id', 'version', 'last_modified_date']) {
              if (act[field] === undefined) {
                return void res.status(400).json({
                  error: {
                    code: 'VALIDATION_ERROR',
                    message: `Missing required action field "${field}" in environment_specifications[${idx}] of "${file.originalname}"`,
                    details: { filename: file.originalname, index: idx },
                  },
                })
              }
            }
          }

          parsed.push({
            file,
            type: 'wfenvir',
            data: env,
            schemaVersion: schemaVersion as string,
          })
        }
      }

      // All-or-nothing transaction
      type ImportSummary = {
        type: string
        oid: string
        local_id: string
        version: string
        actions_count?: number
        status: 'created' | 'updated'
      }

      type DiffSummary = {
        added: string[]
        removed: string[]
        modified: string[]
      }

      const imported: ImportSummary[] = []
      const diffs: DiffSummary[] = []

      // Helper: upsert one env spec + its actions; return the list of upserted action OIDs.
      // Used by both the wfenvir branch and the new wfenvirbundle branch.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const processEnvSpec = (
        envData: Record<string, any>,
        schemaVersion: string,
        sourceFilename: string
      ): string[] => {
        // Get existing actions for diff computation (before upsert)
        const existingActions = actionRepo.findByEnvironment(envData['oid'] as string)
        const existingActionMap = new Map(existingActions.map((a) => [a.oid, a]))

        // Upsert environment
        const envInput = {
          oid: envData['oid'] as string,
          local_id: envData['local_id'] as string,
          version: envData['version'] as string,
          last_modified_date: envData['last_modified_date'] as string,
          schema_version: schemaVersion,
          action_property_specifications: (envData['action_property_specifications'] ??
            []) as unknown[],
          value_property_specifications: (envData['value_property_specifications'] ??
            []) as unknown[],
          resource_property_specifications: (envData['resource_property_specifications'] ??
            []) as unknown[],
          source_filename: sourceFilename,
          description: (envData['description'] as string | undefined) ?? null,
        }

        const { created: envCreated } = environmentRepo.upsert(envInput)

        // Upsert each included action
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const includedActions = (envData['included_actions'] ?? []) as Record<string, any>[]
        const incomingActionOids = new Set<string>()

        for (const action of includedActions) {
          const actionOid = action['oid'] as string
          incomingActionOids.add(actionOid)

          const actionInput = {
            oid: actionOid,
            environment_oid: envData['oid'] as string,
            local_id: action['local_id'] as string,
            version: action['version'] as string,
            last_modified_date: action['last_modified_date'] as string,
            action_visibility: (action['action_visibility'] ?? 'opaque') as 'opaque' | 'observable',
            input_parameter_specifications: (action['input_parameter_specifications'] ??
              []) as unknown[],
            output_parameter_specifications: (action['output_parameter_specifications'] ??
              []) as unknown[],
            property_specifications: (action['property_specifications'] ?? []) as unknown[],
            description: (action['description'] as string | undefined) ?? null,
          }
          actionRepo.upsert(actionInput)
        }

        // Delete orphaned actions (in DB but not in incoming package)
        for (const existingAction of existingActions) {
          if (!incomingActionOids.has(existingAction.oid)) {
            codeVersionRepo.deleteByAction(existingAction.oid)
            actionRepo.delete(existingAction.oid)
          }
        }

        // Compute diff
        const diff: DiffSummary = { added: [], removed: [], modified: [] }
        for (const action of includedActions) {
          const actionOid = action['oid'] as string
          const localId = action['local_id'] as string
          if (!existingActionMap.has(actionOid)) {
            diff.added.push(localId)
          } else {
            const existing = existingActionMap.get(actionOid)!
            if (existing.version !== (action['version'] as string)) {
              diff.modified.push(localId)
            }
          }
        }
        for (const [oid, existing] of existingActionMap) {
          if (!incomingActionOids.has(oid)) {
            diff.removed.push(existing.local_id)
          }
        }

        diffs.push(diff)
        imported.push({
          type: 'environment',
          oid: envData['oid'] as string,
          local_id: envData['local_id'] as string,
          version: envData['version'] as string,
          actions_count: includedActions.length,
          status: envCreated ? 'created' : 'updated',
        })

        return [...incomingActionOids]
      }

      txHelper.transaction(() => {
        for (const item of parsed) {
          if (item.type === 'wfenvir') {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const envData = item.data as Record<string, any>
            processEnvSpec(envData, item.schemaVersion as string, item.file.originalname)
          } else if (item.type === 'wfenvirbundle') {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const lib = item.data as Record<string, any>
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const envSpecs = (lib['environment_specifications'] ?? []) as Record<string, any>[]
            for (const envData of envSpecs) {
              const upsertedActionOids = processEnvSpec(
                envData,
                item.schemaVersion,
                item.file.originalname
              )
              // Create code versions for any actions that have code in the bundle
              for (const actionOid of upsertedActionOids) {
                const codeFiles = item.codeByActionOid[actionOid] ?? []
                for (const cf of codeFiles) {
                  codeVersionRepo.saveAndActivate({
                    action_oid: actionOid,
                    state: cf.state,
                    source_code: cf.source,
                    created_by: 'import',
                    description: 'imported from .WFenvirBundle',
                  })
                }
              }
            }
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
                codeVersionRepo.saveAndActivate({
                  action_oid: actionInput.oid,
                  state,
                  source_code: source,
                  created_by: 'import',
                  description: null,
                })
              }
            }
          }
        }
      })

      // Combine diffs
      const combinedDiff: DiffSummary = {
        added: diffs.flatMap((d) => d.added),
        removed: diffs.flatMap((d) => d.removed),
        modified: diffs.flatMap((d) => d.modified),
      }

      res.status(200).json({
        data: {
          imported,
          diff: combinedDiff,
        },
        meta: {},
      })
    } catch (err) {
      next(err)
    }
  })

  // --------------------------------------------------------
  // MGMT-03: GET /environments
  // --------------------------------------------------------
  router.get('/environments', (_req, res, next) => {
    try {
      const environments = environmentRepo.findAll()
      const enriched = environments.map((env) => ({
        ...env,
        action_count: actionRepo.countByEnvironment(env.oid),
      }))
      res.status(200).json({
        data: enriched,
        meta: { total: enriched.length },
      })
    } catch (err) {
      next(err)
    }
  })

  // --------------------------------------------------------
  // MGMT-04: GET /environments/:oid
  // --------------------------------------------------------
  router.get('/environments/:oid', (req, res, next) => {
    try {
      const oid = req.params.oid as string
      const env = environmentRepo.findByOid(oid)
      if (!env) {
        return void res.status(404).json({
          error: {
            code: 'NOT_FOUND',
            message: 'Environment not found',
            details: {},
          },
        })
      }

      const actions = actionRepo.findByEnvironment(oid)
      const actionSummaries = actions.map((action) => {
        const codeVersions = codeVersionRepo.findByAction(action.oid)
        const statesWithCode = [...new Set(codeVersions.map((cv) => cv.state))]
        return {
          oid: action.oid,
          local_id: action.local_id,
          version: action.version,
          action_visibility: action.action_visibility,
          input_param_count: action.input_parameter_specifications.length,
          output_param_count: action.output_parameter_specifications.length,
          states_with_code: statesWithCode,
        }
      })

      res.status(200).json({
        data: {
          ...env,
          actions: actionSummaries,
        },
        meta: {},
      })
    } catch (err) {
      next(err)
    }
  })

  // --------------------------------------------------------
  // MGMT-05: DELETE /environments/:oid
  // --------------------------------------------------------
  router.delete('/environments/:oid', (req, res, next) => {
    try {
      const oid = req.params.oid as string

      // Check environment exists
      const env = environmentRepo.findByOid(oid)
      if (!env) {
        return void res.status(404).json({
          error: {
            code: 'NOT_FOUND',
            message: 'Environment not found',
            details: {},
          },
        })
      }

      // Check for active instances
      const actions = actionRepo.findByEnvironment(oid)
      for (const action of actions) {
        const instances = instanceRepo.findByAction(action.oid)
        const hasActive = instances.some((i) => i.completed_at === null)
        if (hasActive) {
          return void res.status(409).json({
            error: {
              code: 'CONFLICT',
              message: 'Cannot delete environment with active instances',
              details: {},
            },
          })
        }
      }

      // Delete in transaction with explicit ordering
      let actionsRemoved = 0
      let codeVersionsRemoved = 0
      let instancesRemoved = 0

      txHelper.transaction(() => {
        // Fetch action list before any deletions
        const actionList = actionRepo.findByEnvironment(oid)

        // Delete code versions for each action first
        for (const action of actionList) {
          codeVersionsRemoved += codeVersionRepo.deleteByAction(action.oid)
        }

        // instances.action_oid / instances.environment_oid have no ON DELETE CASCADE
        // (by spec — see migrations.test.ts "does NOT cascade delete instances").
        // Active instances were already rejected above (409); terminal records get cleaned
        // up here so the action delete below doesn't trip the FK constraint.
        instancesRemoved = instanceRepo.deleteByEnvironment(oid)

        // Delete all actions for the environment
        actionsRemoved = actionRepo.deleteByEnvironment(oid)

        // Delete the environment itself
        environmentRepo.delete(oid)
      })

      res.status(200).json({
        data: {
          deleted: true,
          environment_oid: oid,
          actions_removed: actionsRemoved,
          code_versions_removed: codeVersionsRemoved,
          instances_removed: instancesRemoved,
        },
        meta: {},
      })
    } catch (err) {
      next(err)
    }
  })

  // --------------------------------------------------------
  // MGMT-06: GET /actions/:oid
  // --------------------------------------------------------
  router.get('/actions/:oid', (req, res, next) => {
    try {
      const oid = req.params.oid as string
      const action = actionRepo.findByOid(oid)
      if (!action) {
        return void res.status(404).json({
          error: {
            code: 'NOT_FOUND',
            message: 'Action not found',
            details: {},
          },
        })
      }

      // Enrich with environment name
      const environment = environmentRepo.findByOid(action.environment_oid)
      const environmentName = environment?.local_id ?? 'Unknown'

      // Code summary
      const codeVersions = codeVersionRepo.findByAction(oid)
      const statesWithCode = [...new Set(codeVersions.map((cv) => cv.state))]
      const totalVersions = codeVersions.length
      const lastCodeUpdate =
        codeVersions.length > 0
          ? codeVersions.reduce((latest, cv) => (cv.created_at > latest.created_at ? cv : latest))
              .created_at
          : null

      res.status(200).json({
        data: {
          ...action,
          environment_name: environmentName,
          code_summary: {
            states_with_code: statesWithCode,
            total_versions: totalVersions,
            last_code_update: lastCodeUpdate,
          },
        },
        meta: {},
      })
    } catch (err) {
      next(err)
    }
  })

  // --------------------------------------------------------
  // PUT /actions/:oid/timeout — set per-action timeout
  // --------------------------------------------------------
  router.put('/actions/:oid/timeout', (req, res, next) => {
    try {
      const actionOid = req.params.oid as string
      const action = actionRepo.findByOid(actionOid)
      if (!action) {
        return void res.status(404).json({
          error: { code: 'NOT_FOUND', message: `Action not found: ${actionOid}` },
        })
      }

      const { timeout_seconds } = req.body as { timeout_seconds: number | null }

      // Validate: null (global default), 0 (disabled), or positive integer
      if (timeout_seconds !== null) {
        if (
          typeof timeout_seconds !== 'number' ||
          !Number.isInteger(timeout_seconds) ||
          timeout_seconds < 0
        ) {
          return void res.status(400).json({
            error: {
              code: 'VALIDATION_ERROR',
              message: 'timeout_seconds must be null, 0, or a positive integer',
            },
          })
        }
      }

      actionRepo.update(actionOid, { timeout_seconds })

      const updated = actionRepo.findByOid(actionOid)
      res.json({ data: { oid: actionOid, timeout_seconds: updated?.timeout_seconds ?? null } })
    } catch (err) {
      next(err)
    }
  })

  // --------------------------------------------------------
  // Code management endpoints (MGMT-07 through MGMT-12)
  //
  // CRITICAL: literal paths (/active, /test) MUST be registered
  // BEFORE parameterized paths (/:version_id) to prevent Express
  // from treating "active" or "test" as a version_id value.
  // --------------------------------------------------------

  // MGMT-08 (literal): GET /code/:action_oid/:state/active
  router.get('/code/:action_oid/:state/active', (req, res, next) => {
    try {
      const action_oid = req.params.action_oid as string
      const state = req.params.state as string

      const version = codeVersionRepo.getActive(action_oid, state)
      if (!version) {
        return void res.status(404).json({
          error: {
            code: 'NOT_FOUND',
            message: 'No active code version for this action+state',
            details: {},
          },
        })
      }

      res.status(200).json({ data: version, meta: {} })
    } catch (err) {
      next(err)
    }
  })

  // MGMT-12 (literal): POST /code/:action_oid/:state/test
  router.post('/code/:action_oid/:state/test', async (req, res, next) => {
    try {
      const action_oid = req.params.action_oid as string
      const state = req.params.state as string

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const body = (req.body ?? {}) as Record<string, any>

      let sourceCode: string

      if (body['source_code'] !== undefined) {
        // Full execution mode: source_code provided in body
        if (typeof body['source_code'] !== 'string') {
          return void res.status(400).json({
            error: {
              code: 'VALIDATION_ERROR',
              message: 'source_code must be a string',
              details: {},
            },
          })
        }
        sourceCode = body['source_code'] as string
      } else {
        // Syntax check mode: use active version's source code
        const activeVersion = codeVersionRepo.getActive(action_oid, state)
        if (!activeVersion) {
          return void res.status(404).json({
            error: {
              code: 'NOT_FOUND',
              message: 'No active code version for this action+state',
              details: {},
            },
          })
        }
        sourceCode = activeVersion.source_code
      }

      const testInputs =
        body['test_inputs'] !== undefined
          ? (body['test_inputs'] as Record<string, string>)
          : undefined
      const testProps =
        body['test_props'] !== undefined
          ? (body['test_props'] as Record<string, unknown>)
          : undefined
      const testActionProps =
        body['test_action_props'] !== undefined
          ? (body['test_action_props'] as Record<string, unknown>)
          : undefined
      const timeoutMs =
        body['timeout_ms'] !== undefined ? (body['timeout_ms'] as number) : undefined

      const testResult = await manager.testCode(
        sourceCode,
        testInputs,
        testProps,
        testActionProps,
        timeoutMs
      )

      res.status(200).json({ data: testResult, meta: {} })
    } catch (err) {
      next(err)
    }
  })

  // MGMT-08 (parameterized): GET /code/:action_oid/:state/:version_id
  router.get('/code/:action_oid/:state/:version_id', (req, res, next) => {
    try {
      const action_oid = req.params.action_oid as string
      const state = req.params.state as string
      const version_id = req.params.version_id as string

      const version = codeVersionRepo.findById(version_id)
      if (!version || version.action_oid !== action_oid || version.state !== state) {
        return void res.status(404).json({
          error: {
            code: 'NOT_FOUND',
            message: 'Code version not found',
            details: {},
          },
        })
      }

      res.status(200).json({ data: version, meta: {} })
    } catch (err) {
      next(err)
    }
  })

  // MGMT-10 (parameterized): POST /code/:action_oid/:state/:version_id/activate
  router.post('/code/:action_oid/:state/:version_id/activate', (req, res, next) => {
    try {
      const action_oid = req.params.action_oid as string
      const state = req.params.state as string
      const version_id = req.params.version_id as string

      const version = codeVersionRepo.findById(version_id)
      if (!version || version.action_oid !== action_oid || version.state !== state) {
        return void res.status(404).json({
          error: {
            code: 'NOT_FOUND',
            message: 'Code version not found',
            details: {},
          },
        })
      }

      codeVersionRepo.activate(version_id)

      res.status(200).json({
        data: {
          id: version_id,
          version_number: version.version_number,
          is_active: true,
          activated_at: new Date().toISOString(),
        },
        meta: {},
      })
    } catch (err) {
      next(err)
    }
  })

  // MGMT-11 (parameterized): DELETE /code/:action_oid/:state/:version_id
  router.delete('/code/:action_oid/:state/:version_id', (req, res, next) => {
    try {
      const action_oid = req.params.action_oid as string
      const state = req.params.state as string
      const version_id = req.params.version_id as string

      const version = codeVersionRepo.findById(version_id)
      if (!version || version.action_oid !== action_oid || version.state !== state) {
        return void res.status(404).json({
          error: {
            code: 'NOT_FOUND',
            message: 'Code version not found',
            details: {},
          },
        })
      }

      // Cannot delete the active version
      if (version.is_active) {
        return void res.status(409).json({
          error: {
            code: 'CONFLICT',
            message: 'Cannot delete the active version',
            details: {},
          },
        })
      }

      // Cannot delete a version pinned by a running instance
      const activeInstances = instanceRepo.findActive()
      const isPinned = activeInstances.some((inst) => {
        const pinned = inst.pinned_code_versions as Array<{
          state: string
          code_version_id: string
        }>
        return pinned.some((p) => p.code_version_id === version_id)
      })
      if (isPinned) {
        return void res.status(409).json({
          error: {
            code: 'CONFLICT',
            message: 'Cannot delete version pinned by running instance',
            details: {},
          },
        })
      }

      db.prepare('DELETE FROM code_versions WHERE id = ?').run(version_id)

      res.status(200).json({ data: { deleted: true, id: version_id }, meta: {} })
    } catch (err) {
      next(err)
    }
  })

  // --------------------------------------------------------
  // MGMT-CLEAR: DELETE /code/:action_oid/:state
  // Wipes all versions (active + history) for a state. Idempotent.
  // --------------------------------------------------------
  router.delete('/code/:action_oid/:state', (req, res, next) => {
    try {
      const action_oid = req.params.action_oid as string
      const state = req.params.state as string

      const action = actionRepo.findByOid(action_oid)
      if (!action) {
        return void res.status(404).json({
          error: {
            code: 'ACTION_NOT_FOUND',
            message: `Action not found: ${action_oid}`,
            details: {},
          },
        })
      }

      // Guard: refuse if any version-to-be-cleared is pinned by a running instance
      const versionsForState = codeVersionRepo.getVersionHistory(action_oid, state)
      if (versionsForState.length > 0) {
        const versionIds = new Set(versionsForState.map((v) => v.id))
        const activeInstances = instanceRepo.findActive()
        const isPinned = activeInstances.some((inst) => {
          const pinned = inst.pinned_code_versions as Array<{
            state: string
            code_version_id: string
          }>
          return pinned.some((p) => versionIds.has(p.code_version_id))
        })
        if (isPinned) {
          return void res.status(409).json({
            error: {
              code: 'CONFLICT',
              message: 'Cannot clear code: one or more versions are pinned by a running instance',
              details: {},
            },
          })
        }
      }

      const deleted_version_count = codeVersionRepo.clearByActionAndState(action_oid, state)

      res.status(200).json({
        data: { deleted_version_count },
        meta: {},
      })
    } catch (err) {
      next(err)
    }
  })

  // MGMT-07: GET /code/:action_oid/:state  (list versions — metadata only)
  router.get('/code/:action_oid/:state', (req, res, next) => {
    try {
      const action_oid = req.params.action_oid as string
      const state = req.params.state as string

      // Validate action exists
      const action = actionRepo.findByOid(action_oid)
      if (!action) {
        return void res.status(404).json({
          error: {
            code: 'NOT_FOUND',
            message: 'Action not found',
            details: {},
          },
        })
      }

      const versions = codeVersionRepo.getVersionHistory(action_oid, state)
      const metadata = versions.map((v) => ({
        id: v.id,
        version_number: v.version_number,
        is_active: v.is_active,
        created_at: v.created_at,
        created_by: v.created_by,
        description: v.description,
        code_size: v.source_code.length,
      }))

      res.status(200).json({
        data: { action_oid, state, versions: metadata },
        meta: {},
      })
    } catch (err) {
      next(err)
    }
  })

  // MGMT-09: POST /code/:action_oid/:state  (save new version)
  router.post('/code/:action_oid/:state', (req, res, next) => {
    try {
      const action_oid = req.params.action_oid as string
      const state = req.params.state as string

      // Validate action exists
      const action = actionRepo.findByOid(action_oid)
      if (!action) {
        return void res.status(404).json({
          error: {
            code: 'NOT_FOUND',
            message: 'Action not found',
            details: {},
          },
        })
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const body = (req.body ?? {}) as Record<string, any>

      if (body['source_code'] === undefined || body['source_code'] === null) {
        return void res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'source_code is required',
            details: {},
          },
        })
      }

      if (typeof body['source_code'] !== 'string') {
        return void res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'source_code must be a string',
            details: {},
          },
        })
      }

      if (
        body['description'] !== undefined &&
        body['description'] !== null &&
        typeof body['description'] !== 'string'
      ) {
        return void res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'description must be a string',
            details: {},
          },
        })
      }

      if (
        body['created_by'] !== undefined &&
        body['created_by'] !== null &&
        typeof body['created_by'] !== 'string'
      ) {
        return void res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'created_by must be a string',
            details: {},
          },
        })
      }

      const saved = codeVersionRepo.saveAndActivate({
        action_oid,
        state,
        source_code: body['source_code'] as string,
        description: (body['description'] as string | undefined) ?? undefined,
        created_by: (body['created_by'] as string | undefined) ?? undefined,
      })

      res.status(201).json({
        data: {
          id: saved.id,
          version_number: saved.version_number,
          is_active: saved.is_active,
          created_at: saved.created_at,
        },
        meta: {},
      })
    } catch (err) {
      next(err)
    }
  })

  // --------------------------------------------------------
  // Instance monitoring endpoints (MGMT-13 through MGMT-15)
  //
  // CRITICAL: literal paths (/active, /history) MUST be registered
  // BEFORE parameterized paths (/:id) to prevent Express from treating
  // "active" or "history" as an instance id value.
  // --------------------------------------------------------

  // MGMT-13a: GET /instances/active (currently running instances — completed_at IS NULL)
  router.get('/instances/active', (req, res, next) => {
    try {
      const environmentOid = req.query['environment_oid'] as string | undefined
      const actionOid = req.query['action_oid'] as string | undefined

      // Build dynamic query for active instances with optional filters
      const whereClauses: string[] = ['completed_at IS NULL']
      const params: unknown[] = []

      if (actionOid) {
        whereClauses.push('action_oid = ?')
        params.push(actionOid)
      }
      if (environmentOid) {
        whereClauses.push('environment_oid = ?')
        params.push(environmentOid)
      }

      const where = `WHERE ${whereClauses.join(' AND ')}`
      const rows = db
        .prepare(`SELECT * FROM instances ${where} ORDER BY created_at DESC`)
        .all(...params) as Array<{
        runtime_action_instance_id: string
        action_oid: string
        environment_oid: string
        workflow_instance_id: string
        step_instance_id: string
        step_oid: string
        visibility: string
        state: string
        input_parameters: string
        output_parameters: string
        state_history: string
        pinned_code_versions: string
        states_with_code_executed: string
        created_at: string
        started_at: string | null
        completed_at: string | null
        error: string | null
        traceback: string | null
        is_logged: number
      }>

      // Parse JSON fields and enrich with names
      const enrichedInstances = rows.map((row) => {
        const action = actionRepo.findByOid(row.action_oid)
        const env = environmentRepo.findByOid(row.environment_oid)
        return {
          runtime_action_instance_id: row.runtime_action_instance_id,
          action_oid: row.action_oid,
          environment_oid: row.environment_oid,
          workflow_instance_id: row.workflow_instance_id,
          step_instance_id: row.step_instance_id,
          step_oid: row.step_oid,
          visibility: row.visibility,
          state: row.state,
          input_parameters: JSON.parse(row.input_parameters) as unknown[],
          output_parameters: JSON.parse(row.output_parameters) as unknown[],
          state_history: JSON.parse(row.state_history) as unknown[],
          pinned_code_versions: JSON.parse(row.pinned_code_versions) as unknown[],
          states_with_code_executed: JSON.parse(row.states_with_code_executed) as unknown[],
          created_at: row.created_at,
          started_at: row.started_at,
          completed_at: row.completed_at,
          error: row.error,
          traceback: row.traceback,
          is_logged: row.is_logged === 1,
          action_name: action?.local_id ?? 'Unknown',
          environment_name: env?.local_id ?? 'Unknown',
        }
      })

      res.status(200).json({
        data: enrichedInstances,
        meta: { total: enrichedInstances.length },
      })
    } catch (err) {
      next(err)
    }
  })

  // MGMT-13b: GET /instances/history (terminal instances — completed_at IS NOT NULL)
  router.get('/instances/history', (req, res, next) => {
    try {
      const environmentOid = req.query['environment_oid'] as string | undefined
      const actionOid = req.query['action_oid'] as string | undefined

      // Pagination
      const page = Math.max(1, Number(req.query['page']) || 1)
      const pageSize = Math.min(200, Math.max(1, Number(req.query['page_size']) || 50))

      // Sorting
      const SORTABLE_FIELDS = new Set(['created_at', 'completed_at', 'state', 'action_oid'])
      const sortField = SORTABLE_FIELDS.has(req.query['sort'] as string)
        ? (req.query['sort'] as string)
        : 'completed_at'
      const sortOrder = req.query['order'] === 'asc' ? 'ASC' : 'DESC'

      // Build WHERE clause
      const whereClauses: string[] = ['completed_at IS NOT NULL']
      const params: unknown[] = []

      if (actionOid) {
        whereClauses.push('action_oid = ?')
        params.push(actionOid)
      }
      if (environmentOid) {
        whereClauses.push('environment_oid = ?')
        params.push(environmentOid)
      }

      const where = `WHERE ${whereClauses.join(' AND ')}`

      // Count query
      const countResult = db
        .prepare(`SELECT COUNT(*) AS cnt FROM instances ${where}`)
        .get(...params) as { cnt: number }
      const total = countResult.cnt

      // Paginated select
      const offset = (page - 1) * pageSize
      const rows = db
        .prepare(
          `SELECT * FROM instances ${where} ORDER BY ${sortField} ${sortOrder} LIMIT ? OFFSET ?`
        )
        .all(...params, pageSize, offset) as Array<{
        runtime_action_instance_id: string
        action_oid: string
        environment_oid: string
        workflow_instance_id: string
        step_instance_id: string
        step_oid: string
        visibility: string
        state: string
        input_parameters: string
        output_parameters: string
        state_history: string
        pinned_code_versions: string
        states_with_code_executed: string
        created_at: string
        started_at: string | null
        completed_at: string | null
        error: string | null
        traceback: string | null
        is_logged: number
      }>

      // Parse JSON fields and enrich with names
      const enrichedInstances = rows.map((row) => {
        const action = actionRepo.findByOid(row.action_oid)
        const env = environmentRepo.findByOid(row.environment_oid)
        return {
          runtime_action_instance_id: row.runtime_action_instance_id,
          action_oid: row.action_oid,
          environment_oid: row.environment_oid,
          workflow_instance_id: row.workflow_instance_id,
          step_instance_id: row.step_instance_id,
          step_oid: row.step_oid,
          visibility: row.visibility,
          state: row.state,
          input_parameters: JSON.parse(row.input_parameters) as unknown[],
          output_parameters: JSON.parse(row.output_parameters) as unknown[],
          state_history: JSON.parse(row.state_history) as unknown[],
          pinned_code_versions: JSON.parse(row.pinned_code_versions) as unknown[],
          states_with_code_executed: JSON.parse(row.states_with_code_executed) as unknown[],
          created_at: row.created_at,
          started_at: row.started_at,
          completed_at: row.completed_at,
          error: row.error,
          traceback: row.traceback,
          is_logged: row.is_logged === 1,
          action_name: action?.local_id ?? 'Unknown',
          environment_name: env?.local_id ?? 'Unknown',
        }
      })

      res.status(200).json({
        data: enrichedInstances,
        meta: {
          total,
          page,
          page_size: pageSize,
          total_pages: Math.ceil(total / pageSize),
        },
      })
    } catch (err) {
      next(err)
    }
  })

  // MGMT-14: GET /instances/:id (management detail view)
  router.get('/instances/:id', (req, res, next) => {
    try {
      const id = req.params.id as string
      const instance = instanceRepo.findById(id)
      if (!instance) {
        return void res.status(404).json({
          error: {
            code: 'NOT_FOUND',
            message: 'Instance not found',
            details: {},
          },
        })
      }

      const action = actionRepo.findByOid(instance.action_oid)
      const env = environmentRepo.findByOid(instance.environment_oid)

      res.status(200).json({
        data: {
          ...instance,
          action_name: action?.local_id ?? 'Unknown',
          environment_name: env?.local_id ?? 'Unknown',
        },
        meta: {},
      })
    } catch (err) {
      next(err)
    }
  })

  // MGMT-15: POST /instances/:id/command (from console)
  router.post('/instances/:id/command', async (req, res, next) => {
    try {
      const id = req.params.id as string

      const validation = validateBody(req.body, {
        command: { required: true, type: 'string' },
        reason: { required: false, type: 'string' },
      })
      if (!validation.valid) {
        return void res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: validation.message,
            details: {},
          },
        })
      }

      const command = validation.data['command'] as string

      // Validate command before instance lookup
      const VALID_COMMANDS = new Set([
        'PAUSE',
        'RESUME',
        'HOLD',
        'UNHOLD',
        'ABORT',
        'STOP',
        'CLEAR',
      ])
      if (!VALID_COMMANDS.has(command)) {
        return void res.status(422).json({
          error: {
            code: 'INVALID_COMMAND',
            message: `Unknown command: ${command}`,
            details: { command },
          },
        })
      }

      // Check instance exists
      const instance = manager.getInstance(id)
      if (!instance) {
        return void res.status(404).json({
          error: {
            code: 'NOT_FOUND',
            message: 'Instance not found',
            details: {},
          },
        })
      }

      // Delegate to InstanceManager (InvalidStateTransitionError -> 409 via errorHandler)
      await manager.sendCommand(id, command)

      res.status(200).json({
        data: {
          instance_id: id,
          command,
          accepted: true,
        },
        meta: {},
      })
    } catch (err) {
      next(err)
    }
  })

  // --------------------------------------------------------
  // Log endpoints (MGMT-16 through MGMT-17)
  // --------------------------------------------------------

  // MGMT-16: GET /log (query log entries)
  router.get('/log', (req, res, next) => {
    try {
      // Pagination
      const page = Math.max(1, Number(req.query['page']) || 1)
      const pageSize = Math.min(200, Math.max(1, Number(req.query['page_size']) || 50))

      // Build filters
      const filters: LogQueryFilters = {}
      if (req.query['action_name']) filters.actionName = req.query['action_name'] as string
      if (req.query['environment_oid'])
        filters.environmentOid = req.query['environment_oid'] as string
      if (req.query['status']) filters.finalStatus = req.query['status'] as FinalStatus
      if (req.query['from']) filters.startDate = req.query['from'] as string
      if (req.query['to']) filters.endDate = req.query['to'] as string
      filters.limit = pageSize
      filters.offset = (page - 1) * pageSize

      const { entries, total } = logRepo.query(filters)
      const totalPages = Math.ceil(total / pageSize)

      // Build log_config section
      const maxEntries = settingsRepo.getNumericValue('log_max_size')
      const currentEntries = logRepo.count()

      // Get oldest entry timestamp
      const oldestQuery = logRepo.query({ limit: 1, offset: Math.max(0, currentEntries - 1) })
      const oldestEntryAt =
        oldestQuery.entries.length > 0 ? oldestQuery.entries[0].completed_at : null

      res.status(200).json({
        data: entries,
        meta: {
          page,
          page_size: pageSize,
          total_entries: total,
          total_pages: totalPages,
          log_config: {
            max_entries: maxEntries,
            current_entries: currentEntries,
            oldest_entry_at: oldestEntryAt,
          },
        },
      })
    } catch (err) {
      next(err)
    }
  })

  // MGMT-17: GET /log/:id (single entry)
  router.get('/log/:id', (req, res, next) => {
    try {
      const id = Number(req.params.id as string)
      if (isNaN(id)) {
        return void res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Log entry id must be a number',
            details: {},
          },
        })
      }

      const entry = logRepo.findById(id)
      if (!entry) {
        return void res.status(404).json({
          error: {
            code: 'NOT_FOUND',
            message: 'Log entry not found',
            details: {},
          },
        })
      }

      res.status(200).json({ data: entry, meta: {} })
    } catch (err) {
      next(err)
    }
  })

  // --------------------------------------------------------
  // Settings endpoints (MGMT-18)
  // --------------------------------------------------------

  // MGMT-18: GET /settings (list all)
  router.get('/settings', (_req, res, next) => {
    try {
      const settings = settingsRepo.getAll()
      res.status(200).json({ data: settings, meta: {} })
    } catch (err) {
      next(err)
    }
  })

  // MGMT-18: PUT /settings/:key (update)
  router.put('/settings/:key', async (req, res, next) => {
    try {
      const key = req.params.key as string

      const validation = validateBody(req.body, {
        value: { required: true, type: 'string' },
      })
      if (!validation.valid) {
        return void res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: validation.message,
            details: {},
          },
        })
      }

      const value = validation.data['value'] as string

      // Capture previous value before update
      const previousValue = settingsRepo.getValue(key)

      // Update — throws NotFoundError (404) or ValidationError (400) if invalid
      settingsRepo.update(key, value)

      // Apply side effects
      if (key === 'python_pool_size') {
        manager.resizePool(Number(value))
      } else if (key === 'log_max_size') {
        logRepo.trimToSize(Number(value))
      }

      res.status(200).json({
        data: {
          key,
          value,
          previous_value: previousValue,
          applied: true,
        },
        meta: {},
      })
    } catch (err) {
      next(err)
    }
  })

  return router
}
