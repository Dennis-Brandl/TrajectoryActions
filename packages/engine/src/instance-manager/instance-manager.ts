import type BetterSqlite3 from 'better-sqlite3'
import type { Instance } from '@trajectory/storage'
import {
  InstanceRepository,
  ActionRepository,
  EnvironmentRepository,
  CodeVersionRepository,
  LogRepository,
  SettingsRepository,
} from '@trajectory/storage'
import { EngineError } from '../errors.js'
import { PythonWorkerPool } from '../python-pool/pool.js'
import { StateMachine } from '../state-machine/state-machine.js'
import type { CodeExecutor, CodeExecutionResult } from '../state-machine/state-machine.js'
import { ExecutionLogger } from './execution-logger.js'
import { resolveInputParameters } from './parameter-resolver.js'
import type {
  InvokeRequest,
  InvokeResult,
  InstanceManagerOptions,
  PropertyMutation,
  PropertySsePublisher,
} from './types.js'

// ============================================================
// States that are exempt from retry (ABORTING/STOPPING/CLEARING)
// ============================================================

const RETRY_EXEMPT_STATES = new Set(['ABORTING', 'STOPPING', 'CLEARING'])

// ============================================================
// InstanceManager — central orchestrator for Phase 4
// ============================================================

/**
 * InstanceManager wires together PythonWorkerPool, StateMachine, ExecutionLogger,
 * and parameter resolution into a single public API for the REST protocol (Phase 5).
 *
 * Public API:
 *   - invoke()            — create instance, start async execution, return InvokeResult
 *   - sendCommand()       — delegate to StateMachine.sendCommand()
 *   - getInstance()       — current instance state from repository
 *   - getActiveInstances() — all non-terminal instances
 *   - resizePool()        — runtime pool size change
 *   - shutdown()          — graceful pool shutdown
 */
export class InstanceManager {
  private readonly instanceRepo: InstanceRepository
  private readonly actionRepo: ActionRepository
  private readonly environmentRepo: EnvironmentRepository
  private readonly codeVersionRepo: CodeVersionRepository
  private readonly logRepo: LogRepository
  private readonly settingsRepo: SettingsRepository
  private readonly executionLogger: ExecutionLogger
  private readonly pool: PythonWorkerPool
  private readonly stateMachine: StateMachine
  private readonly callbacks: Pick<
    InstanceManagerOptions,
    'onStateChange' | 'onTerminal' | 'onError'
  >
  /**
   * Optional SSE publisher for property mutation events.
   * Uses the PropertySsePublisher structural interface to avoid importing
   * from the server package (layering boundary: engine must not import from server).
   * The actual SseManager from packages/server satisfies this interface implicitly.
   */
  private readonly sseManager?: PropertySsePublisher
  /**
   * Per-invoke `action_property_overrides`, keyed by runtime instance id.
   * Set in `invoke()` when the caller supplies overrides; deleted in the
   * `onTerminal` callback to bound memory growth.
   */
  private readonly actionPropertyOverrides = new Map<
    string,
    Record<string, Record<string, string>>
  >()

  constructor(db: BetterSqlite3.Database, options: InstanceManagerOptions) {
    // Create all repositories from the shared db connection
    this.instanceRepo = new InstanceRepository(db)
    this.actionRepo = new ActionRepository(db)
    this.environmentRepo = new EnvironmentRepository(db)
    this.codeVersionRepo = new CodeVersionRepository(db)
    this.logRepo = new LogRepository(db)
    this.settingsRepo = new SettingsRepository(db)

    // Build ExecutionLogger from repos
    this.executionLogger = new ExecutionLogger(
      this.actionRepo,
      this.environmentRepo,
      this.codeVersionRepo,
      this.logRepo,
      this.settingsRepo,
      this.instanceRepo
    )

    // Stash callback references for use in invoke()'s fire-and-forget path
    this.callbacks = {
      onStateChange: options.onStateChange,
      onTerminal: options.onTerminal,
      onError: options.onError,
    }

    // Stash optional SSE publisher for property mutation events
    this.sseManager = options.sseManager

    // Determine pool size: SettingsRepository setting > options.poolSize > default 4
    let poolSize: number
    try {
      poolSize = this.settingsRepo.getNumericValue('python_pool_size') ?? options.poolSize ?? 4
    } catch {
      poolSize = options.poolSize ?? 4
    }

    // Create Python worker pool
    this.pool = new PythonWorkerPool({
      pythonPath: options.pythonPath ?? 'python',
      scriptPath: options.scriptPath,
      poolSize,
    })

    // Build the retrying code executor that wraps pool.executeCode
    const retryingExecutor = this.makeRetryingExecutor()

    // Create StateMachine with all repos, retrying executor, and event hooks
    this.stateMachine = new StateMachine(
      this.instanceRepo,
      this.codeVersionRepo,
      this.settingsRepo,
      retryingExecutor,
      {
        onStateChange: (instanceId, state, instance) => {
          this.callbacks.onStateChange?.(instanceId, state, instance)
        },
        onTerminal: (instanceId, state, instance) => {
          // Write execution log entry on every terminal state
          try {
            this.executionLogger.writeLog(instanceId, state, instance)
          } catch (err) {
            console.error(`ExecutionLogger.writeLog failed for instance ${instanceId}:`, err)
          }
          // Drop any per-invoke action_property_overrides for this instance.
          this.actionPropertyOverrides.delete(instanceId)
          this.callbacks.onTerminal?.(instanceId, state, instance)
        },
        onError: (instanceId, error) => {
          this.callbacks.onError?.(instanceId, error)
        },
        onPropertyMutations: (instanceId, environmentOid, actionOid, mutations) => {
          this.applyPropertyMutations(environmentOid, actionOid, instanceId, mutations)
        },
      },
      this.actionRepo,
      this.environmentRepo,
      (instanceId) => this.actionPropertyOverrides.get(instanceId)
    )
  }

  // ============================================================
  // Private: retrying code executor
  // ============================================================

  /**
   * Wraps pool.executeCode with one retry on WORKER_CRASH or RUNTIME_ERROR,
   * unless the current state is exempt (ABORTING, STOPPING, CLEARING).
   */
  private makeRetryingExecutor(): CodeExecutor {
    return async (
      instanceId: string,
      state: string,
      sourceCode: string,
      inputs: Record<string, string>,
      outputs: Record<string, string>,
      envProps: Record<string, unknown>,
      actionProps: Record<string, unknown>,
      timeoutMs: number
    ): Promise<CodeExecutionResult> => {
      const result = await this.pool.executeCode(
        instanceId,
        state,
        sourceCode,
        inputs,
        outputs,
        envProps,
        actionProps,
        timeoutMs
      )

      // If execution failed, consider retry
      if (
        !result.success &&
        (result.error_type === 'WORKER_CRASH' || result.error_type === 'RUNTIME_ERROR') &&
        !RETRY_EXEMPT_STATES.has(state)
      ) {
        // Retry once on a fresh worker
        return this.pool.executeCode(
          instanceId,
          state,
          sourceCode,
          inputs,
          outputs,
          envProps,
          actionProps,
          timeoutMs
        )
      }

      return result
    }
  }

  // ============================================================
  // Private: apply property mutations from sidecar
  // ============================================================

  /**
   * Persist property mutations to environment storage and publish SSE events.
   * Called by the StateMachine's onPropertyMutations callback after each code execution.
   *
   * @param environment_oid - OID of the environment to update
   * @param source_action_oid - OID of the action whose code emitted the mutations
   * @param source_instance_id - runtime_action_instance_id of the executing instance
   * @param mutations - list of {spec_name, entry_name, value} mutations from the sidecar
   */
  private applyPropertyMutations(
    environment_oid: string,
    source_action_oid: string,
    source_instance_id: string,
    mutations: PropertyMutation[]
  ): void {
    if (mutations.length === 0) return

    const env = this.environmentRepo.findByOid(environment_oid)
    if (!env) return

    const specs = env.action_property_specifications as Array<{
      name: string
      oid?: string
      description?: string
      entries: Array<{ name: string; value: string }>
    }>

    // Apply each mutation: update existing entry or append a new one
    const touchedSpecNames = new Set<string>()
    for (const m of mutations) {
      const spec = specs.find((s) => s.name === m.spec_name)
      if (!spec) continue
      const entry = spec.entries.find((e) => e.name === m.entry_name)
      if (entry) {
        entry.value = m.value
      } else {
        spec.entries.push({ name: m.entry_name, value: m.value })
      }
      touchedSpecNames.add(m.spec_name)
    }

    // Persist the updated specs to storage
    this.environmentRepo.update(environment_oid, { action_property_specifications: specs })

    // Publish one SSE event per touched spec
    if (this.sseManager) {
      for (const specName of touchedSpecNames) {
        const spec = specs.find((s) => s.name === specName)!
        const changedEntries = [
          ...new Set(mutations.filter((m) => m.spec_name === specName).map((m) => m.entry_name)),
        ]
        this.sseManager.publishProperty(environment_oid, specName, {
          entries: spec.entries,
          changed_entries: changedEntries,
          source: 'action_code',
          source_action_oid,
          source_instance_id,
        })
      }
    }
  }

  // ============================================================
  // Private: pin code versions at invocation time
  // ============================================================

  /**
   * Snapshots all currently active code versions for the given action.
   * Returns one entry per active version: { state, code_version_id }.
   */
  private pinCodeVersions(actionOid: string): Array<{ state: string; code_version_id: string }> {
    const activeVersions = this.codeVersionRepo.getAllActiveVersions(actionOid)
    return activeVersions.map((v) => ({
      state: v.state,
      code_version_id: v.id,
    }))
  }

  // ============================================================
  // Public API
  // ============================================================

  /**
   * Create a new runtime instance, start async execution, and return InvokeResult
   * immediately (fire-and-forget pattern — does NOT await startInstance).
   */
  async invoke(request: InvokeRequest): Promise<InvokeResult> {
    // 1. Validate action exists
    const action = this.actionRepo.findByOid(request.action_oid)
    if (!action) {
      throw new EngineError('ACTION_NOT_FOUND', `Action not found: ${request.action_oid}`)
    }

    // 2. Resolve input parameters (applies defaults, validates required fields)
    const resolvedInputs = resolveInputParameters(
      request.input_parameters,
      action.input_parameter_specifications
    )

    // 3. Pin active code versions at invocation time
    const pinnedVersions = this.pinCodeVersions(request.action_oid)

    // 4. Create instance in storage
    // NOTE: InstanceRepository.create() generates its own UUID internally;
    // the runtime_action_instance_id field in InstanceInput is ignored.
    const instance = this.instanceRepo.create({
      runtime_action_instance_id: 'placeholder', // Overridden by repo
      action_oid: request.action_oid,
      environment_oid: action.environment_oid,
      workflow_instance_id: request.workflow_instance_id,
      step_instance_id: request.step_instance_id,
      step_oid: request.step_oid,
      visibility: action.action_visibility,
      state: action.action_visibility === 'observable' ? 'STARTING' : 'POSTED',
      input_parameters: resolvedInputs,
      output_parameters: [],
      state_history: [], // InstanceRepository.create() builds initial history itself
      pinned_code_versions: pinnedVersions,
      states_with_code_executed: [],
    })

    const instanceId = instance.runtime_action_instance_id

    // 4b. Stash per-invoke action_property_overrides so the state machine can
    //     merge them into envProps each time it runs code for this instance.
    //     Cleared in the onTerminal callback.
    if (
      request.action_property_overrides &&
      Object.keys(request.action_property_overrides).length > 0
    ) {
      this.actionPropertyOverrides.set(instanceId, request.action_property_overrides)
    }

    // 5. Start async execution — fire-and-forget (do NOT await)
    this.stateMachine.startInstance(instanceId).catch((err) => {
      console.error(`State machine error for instance ${instanceId}:`, err)
      this.callbacks.onError?.(instanceId, err instanceof Error ? err : new Error(String(err)))
    })

    // 6. Return InvokeResult immediately with the actual instance UUID
    const result: InvokeResult = {
      runtime_action_instance_id: instanceId,
      action_oid: request.action_oid,
      status: instance.state,
      created_at: instance.created_at,
    }

    if (action.action_visibility === 'observable') {
      result.sse_endpoint = `/trajectory/v1/instances/${instanceId}/events`
    }

    return result
  }

  /**
   * Send a client command to a running instance.
   * Delegates to StateMachine.sendCommand().
   */
  async sendCommand(instanceId: string, command: string): Promise<void> {
    await this.stateMachine.sendCommand(instanceId, command)
  }

  /**
   * Get the current state of a specific instance.
   */
  getInstance(instanceId: string): Instance | null {
    return this.instanceRepo.findById(instanceId)
  }

  /**
   * Get all instances that have not yet reached a terminal state.
   */
  getActiveInstances(): Instance[] {
    return this.instanceRepo.findActive()
  }

  /**
   * Resize the Python worker pool at runtime.
   * Growing: spawns new workers immediately.
   * Shrinking: drains idle workers; busy workers finish naturally.
   */
  resizePool(newSize: number): void {
    this.pool.resize(newSize)
  }

  /**
   * Force-cancel an instance: sends ABORT command through the state machine
   * then kills the worker process. Used by DELETE /instances/:id for immediate
   * termination semantics.
   */
  async cancelInstance(instanceId: string): Promise<void> {
    // Send ABORT command through state machine (may throw if already terminal)
    try {
      await this.sendCommand(instanceId, 'ABORT')
    } catch {
      // Instance may already be in terminal state — that's fine for cancel
    }
    // Force-kill the subprocess if still running
    await this.pool.killWorker(instanceId)
  }

  /**
   * Dry-run code execution without creating an instance record.
   * Acquires a pool worker, runs the provided source code, releases the worker.
   * Used by MGMT-12 code test endpoint.
   *
   * NOTE: Calls this.pool.executeCode() directly, intentionally bypassing the
   * retrying executor. Dry-run failures should return the error immediately to
   * the caller — retry is not appropriate for test/validation runs.
   */
  async testCode(
    sourceCode: string,
    testInputs?: Record<string, string>,
    testProps?: Record<string, unknown>,
    testActionProps?: Record<string, unknown>,
    timeoutMs?: number
  ): Promise<{
    success: boolean
    outputs?: Record<string, string>
    return_value?: unknown
    stdout?: string
    stderr?: string
    error?: string
    error_type?: string
    execution_time_ms: number
  }> {
    let effectiveTimeout: number
    try {
      effectiveTimeout =
        timeoutMs ?? this.settingsRepo.getNumericValue('execution_timeout_ms') ?? 60000
    } catch {
      effectiveTimeout = timeoutMs ?? 60000
    }
    const startTime = Date.now()
    const result = await this.pool.executeCode(
      `test-${Date.now()}`, // synthetic instanceId
      'TEST', // synthetic state
      sourceCode,
      testInputs ?? {},
      {}, // empty outputs accumulator
      testProps ?? {},
      testActionProps ?? {},
      effectiveTimeout
    )
    const execution_time_ms = Date.now() - startTime

    if (result.success) {
      return {
        success: true,
        outputs: result.outputs ?? {},
        return_value: result.return_value,
        stdout: result.stdout_capture ?? '',
        stderr: result.stderr_capture ?? '',
        execution_time_ms,
      }
    }
    return {
      success: false,
      error: result.error ?? 'Unknown error',
      error_type: result.error_type,
      stdout: result.stdout_capture ?? '',
      stderr: result.stderr_capture ?? '',
      execution_time_ms,
    }
  }

  /**
   * Gracefully shut down the Python worker pool.
   */
  async shutdown(): Promise<void> {
    await this.pool.shutdown()
  }

  // ============================================================
  // Getters
  // ============================================================

  /** Current target pool size */
  get poolSize(): number {
    return this.pool.targetPoolSize
  }

  /** Current pool status snapshot */
  get poolStatus(): { size: number; idle: number; busy: number; queued: number } {
    return {
      size: this.pool.size,
      idle: this.pool.idleCount,
      busy: this.pool.busyCount,
      queued: this.pool.queueLength,
    }
  }
}
