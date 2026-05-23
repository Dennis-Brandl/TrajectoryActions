import type { Instance } from '@trajectory/storage'
import type { InstanceRepository } from '@trajectory/storage'
import type { CodeVersionRepository } from '@trajectory/storage'
import type { SettingsRepository } from '@trajectory/storage'
import type { ActionRepository } from '@trajectory/storage'
import type { EnvironmentRepository } from '@trajectory/storage'
import { EngineError } from '../errors.js'
import { AUTO_ADVANCE, OPAQUE_AUTO_ADVANCE, validateCommand } from './transitions.js'
import { isTerminal } from './states.js'
import {
  flattenProperties,
  mergePropertyOverrides,
} from '../instance-manager/parameter-resolver.js'

/**
 * Callback used by InstanceManager to expose per-invoke `action_property_overrides`
 * to the state machine. Returns the override map for the given instance, or
 * `undefined` if none was set at invoke time.
 *
 * Overrides are merged into the env-level flattened props before each state's
 * code executes (see `processCurrentState` env-props construction).
 */
export type GetActionPropertyOverrides = (
  instanceId: string
) => Record<string, Record<string, string>> | undefined

/**
 * Recovery states that must NOT loop on their own failure. If code in
 * ABORTING/STOPPING/CLEARING throws, we cannot transition back into the
 * same state — that's an infinite loop. Force the terminal directly.
 */
const RECOVERY_TERMINAL = new Map<string, string>([
  ['ABORTING', 'ABORTED'],
  ['STOPPING', 'COMPLETED'],
  ['CLEARING', 'COMPLETED'],
])

// ============================================================
// Supporting types
// ============================================================

/**
 * Result returned by the code executor callback after running Python code.
 */
export interface CodeExecutionResult {
  success: boolean
  outputs: Record<string, string>
  return_value: boolean | null
  error?: string
  error_type?: string
  traceback?: string
  execution_time_ms: number
  stdout_capture: string
  stderr_capture: string
  /** Property mutations emitted by the Python sidecar (via trajectory.set_property). */
  property_mutations?: Array<{ spec_name: string; entry_name: string; value: string }>
}

/**
 * Injectable callback for running Python code in a state.
 * In production: PythonWorkerPool (Plan 03-02/03-03).
 * In tests: vi.fn() returning configurable results.
 */
export type CodeExecutor = (
  instanceId: string,
  state: string,
  sourceCode: string,
  inputs: Record<string, string>,
  outputs: Record<string, string>,
  envProps: Record<string, unknown>,
  actionProps: Record<string, unknown>,
  timeoutMs: number
) => Promise<CodeExecutionResult>

/**
 * Optional event hooks for the state machine.
 * Used for SSE emission (Phase 5) and logging.
 */
export interface StateMachineCallbacks {
  onStateChange?: (instanceId: string, state: string, instance: Instance) => void
  onTerminal?: (instanceId: string, state: string, instance: Instance) => void
  onError?: (instanceId: string, error: Error) => void
  /**
   * Called after each code execution when the sidecar returned property_mutations.
   * InstanceManager uses this to persist mutations to storage and publish SSE.
   */
  onPropertyMutations?: (
    instanceId: string,
    environmentOid: string,
    actionOid: string,
    mutations: Array<{ spec_name: string; entry_name: string; value: string }>
  ) => void
}

// ============================================================
// StateMachine class
// ============================================================

export class StateMachine {
  private readonly instanceRepo: InstanceRepository
  private readonly codeVersionRepo: CodeVersionRepository
  private readonly settingsRepo: SettingsRepository
  private readonly codeExecutor: CodeExecutor
  private readonly callbacks?: StateMachineCallbacks
  private readonly actionRepo?: ActionRepository
  private readonly environmentRepo?: EnvironmentRepository
  private readonly getActionPropertyOverrides?: GetActionPropertyOverrides

  /** Instance IDs currently executing Python code */
  private readonly executingInstances = new Set<string>()

  /** Deferred commands: command that arrived during code execution, to apply after code finishes */
  private readonly deferredCommands = new Map<string, string>()

  constructor(
    instanceRepo: InstanceRepository,
    codeVersionRepo: CodeVersionRepository,
    settingsRepo: SettingsRepository,
    codeExecutor: CodeExecutor,
    callbacks?: StateMachineCallbacks,
    actionRepo?: ActionRepository, // NEW — optional for backwards compat
    environmentRepo?: EnvironmentRepository, // NEW — optional for backwards compat
    getActionPropertyOverrides?: GetActionPropertyOverrides // NEW — per-invoke property overrides
  ) {
    this.instanceRepo = instanceRepo
    this.codeVersionRepo = codeVersionRepo
    this.settingsRepo = settingsRepo
    this.codeExecutor = codeExecutor
    this.callbacks = callbacks
    this.actionRepo = actionRepo
    this.environmentRepo = environmentRepo
    this.getActionPropertyOverrides = getActionPropertyOverrides
  }

  // ============================================================
  // Public API
  // ============================================================

  /**
   * Kick off the state machine pipeline for an instance that has already been created
   * with its initial state. Processes the current state without creating a duplicate
   * state_history entry.
   */
  async startInstance(instanceId: string): Promise<void> {
    await this.processCurrentState(instanceId)
  }

  /**
   * Validate and execute a client command against the current state.
   * Supports deferred commands (HOLD/STOP/ABORT) while code is executing.
   */
  async sendCommand(instanceId: string, command: string): Promise<void> {
    const instance = this.instanceRepo.findById(instanceId)
    if (!instance) {
      throw new EngineError('INSTANCE_NOT_FOUND', `Instance not found: ${instanceId}`)
    }

    // validateCommand throws InvalidStateTransitionError if invalid
    const targetState = validateCommand(instance.state, command, instance.visibility)

    // Deferred command check: if code is executing, defer HOLD/STOP/ABORT
    if (
      (command === 'HOLD' || command === 'STOP' || command === 'ABORT') &&
      this.executingInstances.has(instanceId)
    ) {
      this.deferredCommands.set(instanceId, command)
      return
    }

    await this.enterState(instanceId, targetState)
  }

  // ============================================================
  // Core pipeline
  // ============================================================

  /**
   * Persist a new state and run the state-entry pipeline:
   * 1. Persist state change via instanceRepo.updateState()
   * 2. Emit onStateChange callback
   * 3. Process the newly entered state (look up code, execute or auto-advance)
   */
  async enterState(
    instanceId: string,
    newState: string,
    updates?: {
      started_at?: string
      completed_at?: string
      error?: string
      traceback?: string
    }
  ): Promise<void> {
    // 1-3. Persist state and append to state_history
    const updatedInstance = this.instanceRepo.updateState(instanceId, newState, updates)
    if (!updatedInstance) {
      throw new EngineError(
        'INSTANCE_NOT_FOUND',
        `Instance not found during state transition: ${instanceId}`
      )
    }

    // 4. Emit state change callback (for SSE emission in Phase 5)
    this.callbacks?.onStateChange?.(instanceId, newState, updatedInstance)

    // 5-8. Process the new state (code lookup + execute or auto-advance)
    await this.processCurrentState(instanceId)
  }

  // ============================================================
  // Private: state processing logic
  // ============================================================

  /**
   * Core state processing logic.
   * Reads the instance, looks up pinned code for the current state,
   * and either executes the code or auto-advances to the next state.
   */
  private async processCurrentState(instanceId: string): Promise<void> {
    const instance = this.instanceRepo.findById(instanceId)
    if (!instance) {
      throw new EngineError(
        'INSTANCE_NOT_FOUND',
        `Instance not found in processCurrentState: ${instanceId}`
      )
    }

    const currentState = instance.state
    const visibility = instance.visibility

    // Terminal state handling: emit onTerminal and stop
    if (isTerminal(currentState)) {
      // Set completed_at if not already set (for states that don't pass it in updates)
      if (!instance.completed_at) {
        this.instanceRepo.updateState(instanceId, currentState, {
          completed_at: new Date().toISOString(),
        })
        const finalInstance = this.instanceRepo.findById(instanceId)!
        this.callbacks?.onTerminal?.(instanceId, currentState, finalInstance)
      } else {
        this.callbacks?.onTerminal?.(instanceId, currentState, instance)
      }
      return
    }

    // Look up pinned code version for this state
    const pinnedCodeVersions = instance.pinned_code_versions as Array<{
      state: string
      code_version_id: string
    }>
    const pinnedEntry = pinnedCodeVersions.find((entry) => entry.state === currentState)
    const codeVersion = pinnedEntry
      ? this.codeVersionRepo.findById(pinnedEntry.code_version_id)
      : null

    if (codeVersion) {
      // Code found: execute it
      await this.executeCode(
        instanceId,
        currentState,
        codeVersion.source_code,
        visibility,
        instance
      )
    } else {
      // No code: auto-advance to next state
      await this.autoAdvance(instanceId, currentState, visibility, instance)
    }
  }

  /**
   * Execute Python code for the current state.
   * Handles success (return_value true/false) and failure (exceptions).
   */
  private async executeCode(
    instanceId: string,
    state: string,
    sourceCode: string,
    visibility: string,
    instance: Instance
  ): Promise<void> {
    // Per-action timeout takes precedence over global setting
    let timeoutMs: number
    if (this.actionRepo) {
      const action = this.actionRepo.findByOid(instance.action_oid)
      if (action && action.timeout_seconds !== null && action.timeout_seconds !== undefined) {
        // Per-action: 0 = disabled, >0 = seconds * 1000
        timeoutMs = action.timeout_seconds === 0 ? 0 : action.timeout_seconds * 1000
      } else {
        // Fall back to global setting
        timeoutMs = this.settingsRepo.getNumericValue('execution_timeout_ms') ?? 60000
      }
    } else {
      timeoutMs = this.settingsRepo.getNumericValue('execution_timeout_ms') ?? 60000
    }

    // Parse inputs and outputs as Record<string, string>
    const inputs = this.parseParametersAsRecord(instance.input_parameters)
    const outputs = this.parseParametersAsRecord(instance.output_parameters)

    // Resolve envProps and actionProps from repos when provided (Phase 4+)
    // Falls back to empty objects when repos are not provided (Phase 3 tests unaffected)
    let envProps: Record<string, unknown> = {}
    let actionProps: Record<string, unknown> = {}
    if (this.actionRepo && this.environmentRepo) {
      const action = this.actionRepo.findByOid(instance.action_oid)
      if (action) {
        actionProps = flattenProperties(action.property_specifications)
        const environment = this.environmentRepo.findByOid(action.environment_oid)
        if (environment) {
          envProps = flattenProperties(environment.action_property_specifications)
        }
      }
    }

    // Apply per-invoke action_property_overrides (test/dev affordance):
    // overrides win over both env action_property_specifications and any
    // entries the action contributed. Stored ephemerally on InstanceManager.
    const overrides = this.getActionPropertyOverrides?.(instanceId)
    if (overrides && Object.keys(overrides).length > 0) {
      envProps = mergePropertyOverrides(
        envProps as Record<string, Record<string, string>>,
        overrides
      )
    }

    // Track that this instance is executing code (for deferred command support)
    this.executingInstances.add(instanceId)

    let result: CodeExecutionResult
    try {
      result = await this.codeExecutor(
        instanceId,
        state,
        sourceCode,
        inputs,
        outputs,
        envProps,
        actionProps,
        timeoutMs
      )
    } finally {
      this.executingInstances.delete(instanceId)
    }

    // Handle deferred command (HOLD/STOP/ABORT that arrived during code execution)
    if (this.deferredCommands.has(instanceId)) {
      const deferredCommand = this.deferredCommands.get(instanceId)!
      this.deferredCommands.delete(instanceId)
      await this.sendCommand(instanceId, deferredCommand)
      return
    }

    // Notify InstanceManager of any property mutations from this execution.
    // Called regardless of success/failure so partial mutations on error paths
    // are still applied (matches Python sidecar behavior).
    if (
      this.callbacks?.onPropertyMutations &&
      result.property_mutations &&
      result.property_mutations.length > 0
    ) {
      this.callbacks.onPropertyMutations(
        instanceId,
        instance.environment_oid,
        instance.action_oid,
        result.property_mutations
      )
    }

    if (result.success) {
      // Update output parameters with code results
      if (Object.keys(result.outputs).length > 0) {
        const currentInstance = this.instanceRepo.findById(instanceId)
        if (currentInstance) {
          const currentOutputs = this.parseParametersAsRecord(currentInstance.output_parameters)
          const mergedOutputs = { ...currentOutputs, ...result.outputs }
          this.instanceRepo.updateOutputParameters(
            instanceId,
            Object.entries(mergedOutputs).map(([k, v]) => ({ key: k, value: v }))
          )
        }
      }

      // Mark this state as having code executed
      const updatedInstance = this.instanceRepo.findById(instanceId)
      if (updatedInstance) {
        const statesExecuted = updatedInstance.states_with_code_executed as string[]
        if (!statesExecuted.includes(state)) {
          this.instanceRepo.markStatesWithCodeExecuted(instanceId, [...statesExecuted, state])
        }
      }

      if (result.return_value === false && state === 'EXECUTING') {
        // Code-initiated HOLD: return_value false in EXECUTING triggers HOLDING -> HELD
        await this.enterState(instanceId, 'HOLDING')
        return
      }

      // Success with return_value true (or non-false): auto-advance
      await this.autoAdvance(instanceId, state, visibility, instance)
    } else {
      // Persist any outputs the user code set before the raise. User code that
      // does `outputs['status']='1'; raise RuntimeError(...)` recorded partial
      // progress that callers want to see alongside the error; without this
      // merge the dict reaches the engine via the sidecar but never lands on
      // the instance record.
      if (Object.keys(result.outputs).length > 0) {
        const currentInstance = this.instanceRepo.findById(instanceId)
        if (currentInstance) {
          const currentOutputs = this.parseParametersAsRecord(currentInstance.output_parameters)
          const mergedOutputs = { ...currentOutputs, ...result.outputs }
          this.instanceRepo.updateOutputParameters(
            instanceId,
            Object.entries(mergedOutputs).map(([k, v]) => ({ key: k, value: v }))
          )
        }
      }

      // Execution failure: two-tier error detail per CONTEXT.md
      // error field: summary (error_type: message)
      // traceback field: full Python traceback (separate from summary)
      const errorSummary = result.error_type
        ? `${result.error_type}: ${result.error ?? 'Execution failed'}`
        : (result.error ?? 'Execution failed')

      // Persist error summary and traceback on the current state's instance record
      // (updateState is called by enterState for ABORTING, but we store the traceback here)
      this.instanceRepo.updateState(instanceId, state, {
        error: errorSummary,
        traceback: result.traceback ?? null,
      })

      // Recovery-state failure must NOT re-enter the same state — that would
      // create an infinite loop (ABORTING.py fails → enterState(ABORTING) →
      // ABORTING.py fails → ...). Force-transition to the terminal instead.
      const forcedTerminal = RECOVERY_TERMINAL.get(state)
      if (forcedTerminal) {
        await this.enterState(instanceId, forcedTerminal, { error: errorSummary })
        return
      }

      // Non-recovery state failure: transition to ABORTING (then ABORTING -> ABORTED via auto-advance)
      await this.enterState(instanceId, 'ABORTING', { error: errorSummary })
    }
  }

  /**
   * Auto-advance to the next state based on the auto-advance table.
   * If there is no next state (terminal or wait-states like PAUSED/HELD), stop.
   */
  private async autoAdvance(
    instanceId: string,
    currentState: string,
    visibility: string,
    instance: Instance
  ): Promise<void> {
    const autoAdvanceMap = visibility === 'opaque' ? OPAQUE_AUTO_ADVANCE : AUTO_ADVANCE
    const nextState = autoAdvanceMap.get(currentState)

    if (nextState) {
      // Set started_at on first transition from STARTING/POSTED
      const updates: { started_at?: string } = {}
      if (currentState === 'STARTING' || currentState === 'POSTED') {
        updates.started_at = instance.started_at ?? new Date().toISOString()
      }
      await this.enterState(
        instanceId,
        nextState,
        Object.keys(updates).length ? updates : undefined
      )
    }
    // If no next state: wait-state (PAUSED, HELD) or terminal (should not happen here since
    // processCurrentState handles terminal states before calling autoAdvance)
  }

  /**
   * Parse an instance's parameters array into a Record<string, string> for the code executor.
   * Handles both array-of-{key,value} and plain objects.
   */
  private parseParametersAsRecord(params: unknown[]): Record<string, string> {
    const result: Record<string, string> = {}
    for (const p of params) {
      if (p && typeof p === 'object' && 'key' in p && 'value' in p) {
        const param = p as { key: string; value: unknown }
        result[param.key] = String(param.value)
      }
    }
    return result
  }
}
