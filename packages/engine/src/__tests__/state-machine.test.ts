import { describe, it, expect, vi } from 'vitest'
import {
  initializeDatabase,
  InstanceRepository,
  CodeVersionRepository,
  SettingsRepository,
  ActionRepository,
  EnvironmentRepository,
} from '@trajectory/storage'
import type { Instance } from '@trajectory/storage'
import type BetterSqlite3 from 'better-sqlite3'
import { StateMachine } from '../state-machine/state-machine.js'
import type { CodeExecutor, CodeExecutionResult } from '../state-machine/state-machine.js'
import { InvalidStateTransitionError } from '../errors.js'

// ============================================================
// Test helpers
// ============================================================

/** Default successful code execution result */
function makeSuccessResult(overrides: Partial<CodeExecutionResult> = {}): CodeExecutionResult {
  return {
    success: true,
    outputs: {},
    return_value: true,
    execution_time_ms: 10,
    stdout_capture: '',
    stderr_capture: '',
    ...overrides,
  }
}

/** Default failed code execution result */
function makeFailureResult(overrides: Partial<CodeExecutionResult> = {}): CodeExecutionResult {
  return {
    success: false,
    outputs: {},
    return_value: null,
    error: 'Something went wrong',
    error_type: 'RUNTIME_ERROR',
    traceback:
      'Traceback (most recent call last):\n  File "test.py", line 1\nRuntimeError: Something went wrong',
    execution_time_ms: 5,
    stdout_capture: '',
    stderr_capture: '',
    ...overrides,
  }
}

interface TestDeps {
  db: BetterSqlite3.Database
  instanceRepo: InstanceRepository
  codeVersionRepo: CodeVersionRepository
  settingsRepo: SettingsRepository
  codeExecutor: ReturnType<typeof vi.fn<CodeExecutor>>
}

function createTestDeps(): TestDeps {
  const db = initializeDatabase(':memory:')
  const instanceRepo = new InstanceRepository(db)
  const codeVersionRepo = new CodeVersionRepository(db)
  const settingsRepo = new SettingsRepository(db)
  const codeExecutor = vi.fn<CodeExecutor>()

  // Default: always return success
  codeExecutor.mockResolvedValue(makeSuccessResult())

  return { db, instanceRepo, codeVersionRepo, settingsRepo, codeExecutor }
}

interface TestSetup {
  instanceId: string
  actionOid: string
  envOid: string
}

/**
 * Create an environment, action, and code versions, then create a test instance.
 * pinnedStates: array of state names that should have code pinned.
 * Returns the instance ID (auto-generated UUID from InstanceRepository).
 */
function createTestInstance(
  deps: TestDeps,
  options: {
    visibility?: 'observable' | 'opaque'
    initialState?: string
    pinnedStates?: string[]
  } = {}
): TestSetup {
  const { instanceRepo, codeVersionRepo, db } = deps
  const visibility = options.visibility ?? 'observable'
  const initialState = options.initialState ?? (visibility === 'observable' ? 'STARTING' : 'POSTED')
  const pinnedStates = options.pinnedStates ?? []

  // Create environment
  const envRepo = new EnvironmentRepository(db)
  const envOid = `env-${Date.now()}-${Math.random()}`
  envRepo.create({
    oid: envOid,
    local_id: 'test-env',
    version: '1.0',
    last_modified_date: new Date().toISOString(),
    schema_version: '1',
    action_property_specifications: [],
    value_property_specifications: [],
    resource_property_specifications: [],
    source_filename: 'test.json',
  })

  // Create action
  const actionRepo = new ActionRepository(db)
  const actionOid = `action-${Date.now()}-${Math.random()}`
  actionRepo.create({
    oid: actionOid,
    environment_oid: envOid,
    local_id: 'test-action',
    version: '1.0',
    last_modified_date: new Date().toISOString(),
    action_visibility: visibility,
    input_parameter_specifications: [],
    output_parameter_specifications: [],
    property_specifications: [],
  })

  // Create and activate code versions for pinned states
  const pinnedCodeVersions: Array<{ state: string; code_version_id: string }> = []
  for (const state of pinnedStates) {
    const cv = codeVersionRepo.saveAndActivate({
      action_oid: actionOid,
      state,
      source_code: `def execute(inputs, outputs, props, action_props):\n    return True`,
    })
    pinnedCodeVersions.push({ state, code_version_id: cv.id })
  }

  // Create instance with initial state
  const instance = instanceRepo.create({
    runtime_action_instance_id: `inst-${Date.now()}`,
    action_oid: actionOid,
    environment_oid: envOid,
    workflow_instance_id: 'wf-1',
    step_instance_id: 'step-1',
    step_oid: 'step-oid-1',
    visibility,
    state: initialState,
    input_parameters: [],
    output_parameters: [],
    state_history: [{ state: initialState, timestamp: new Date().toISOString() }],
    pinned_code_versions: pinnedCodeVersions,
    states_with_code_executed: [],
  })

  return { instanceId: instance.runtime_action_instance_id, actionOid, envOid }
}

function createSM(deps: TestDeps): StateMachine {
  return new StateMachine(
    deps.instanceRepo,
    deps.codeVersionRepo,
    deps.settingsRepo,
    deps.codeExecutor
  )
}

function createSMWithCallbacks(
  deps: TestDeps,
  callbacks: ConstructorParameters<typeof StateMachine>[4]
): StateMachine {
  return new StateMachine(
    deps.instanceRepo,
    deps.codeVersionRepo,
    deps.settingsRepo,
    deps.codeExecutor,
    callbacks
  )
}

/** Get the current state history for an instance */
function getStateHistory(
  deps: TestDeps,
  instanceId: string
): Array<{ state: string; timestamp: string }> {
  const instance = deps.instanceRepo.findById(instanceId)!
  return instance.state_history as Array<{ state: string; timestamp: string }>
}

/** Get the current state for an instance */
function getState(deps: TestDeps, instanceId: string): string {
  return deps.instanceRepo.findById(instanceId)!.state
}

// ============================================================
// Happy path tests (observable)
// ============================================================

describe('StateMachine - Observable happy path', () => {
  it('auto-advances STARTING -> EXECUTING -> COMPLETING -> COMPLETED when no code at any state', async () => {
    const deps = createTestDeps()
    const { instanceId } = createTestInstance(deps, { pinnedStates: [] })
    const sm = createSM(deps)

    await sm.startInstance(instanceId)

    const instance = deps.instanceRepo.findById(instanceId)!
    expect(instance.state).toBe('COMPLETED')

    const history = getStateHistory(deps, instanceId)
    // Initial state from create() + EXECUTING + COMPLETING + COMPLETED entries
    const states = history.map((h) => h.state)
    expect(states).toContain('STARTING')
    expect(states).toContain('EXECUTING')
    expect(states).toContain('COMPLETING')
    expect(states).toContain('COMPLETED')

    // completed_at should be set
    expect(instance.completed_at).not.toBeNull()
  })

  it('state_history timestamps are valid ISO 8601 and monotonically non-decreasing', async () => {
    const deps = createTestDeps()
    const { instanceId } = createTestInstance(deps, { pinnedStates: [] })
    const sm = createSM(deps)

    await sm.startInstance(instanceId)

    const history = getStateHistory(deps, instanceId)
    expect(history.length).toBeGreaterThanOrEqual(4)

    for (const entry of history) {
      // Valid ISO 8601
      expect(entry.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
      expect(new Date(entry.timestamp).getTime()).not.toBeNaN()
    }

    // Monotonically non-decreasing
    for (let i = 1; i < history.length; i++) {
      const prev = new Date(history[i - 1].timestamp).getTime()
      const curr = new Date(history[i].timestamp).getTime()
      expect(curr).toBeGreaterThanOrEqual(prev)
    }
  })

  it('code at EXECUTING runs, return_value true advances to COMPLETED', async () => {
    const deps = createTestDeps()
    const { instanceId } = createTestInstance(deps, { pinnedStates: ['EXECUTING'] })
    deps.codeExecutor.mockImplementation(async (_id, state) => {
      if (state === 'EXECUTING') {
        return makeSuccessResult({ outputs: { result: '42' }, return_value: true })
      }
      return makeSuccessResult()
    })
    const sm = createSM(deps)

    await sm.startInstance(instanceId)

    expect(getState(deps, instanceId)).toBe('COMPLETED')
    expect(deps.codeExecutor).toHaveBeenCalledTimes(1)
    expect(deps.codeExecutor).toHaveBeenCalledWith(
      instanceId,
      'EXECUTING',
      expect.any(String),
      expect.any(Object),
      expect.any(Object),
      expect.any(Object),
      expect.any(Object),
      expect.any(Number)
    )
  })

  it('code at STARTING, EXECUTING, COMPLETING — each runs once, codeExecutor called 3 times', async () => {
    const deps = createTestDeps()
    const { instanceId } = createTestInstance(deps, {
      pinnedStates: ['STARTING', 'EXECUTING', 'COMPLETING'],
    })
    deps.codeExecutor.mockResolvedValue(makeSuccessResult({ return_value: true }))
    const sm = createSM(deps)

    await sm.startInstance(instanceId)

    expect(getState(deps, instanceId)).toBe('COMPLETED')
    expect(deps.codeExecutor).toHaveBeenCalledTimes(3)

    const calledStates = deps.codeExecutor.mock.calls.map((c) => c[1])
    expect(calledStates).toContain('STARTING')
    expect(calledStates).toContain('EXECUTING')
    expect(calledStates).toContain('COMPLETING')
  })
})

// ============================================================
// Code-initiated HOLD test
// ============================================================

describe('StateMachine - Code-initiated HOLD', () => {
  it('return_value false in EXECUTING triggers HOLDING -> HELD', async () => {
    const deps = createTestDeps()
    const { instanceId } = createTestInstance(deps, { pinnedStates: ['EXECUTING'] })
    deps.codeExecutor.mockResolvedValue(makeSuccessResult({ return_value: false }))
    const sm = createSM(deps)

    await sm.startInstance(instanceId)

    expect(getState(deps, instanceId)).toBe('HELD')

    const history = getStateHistory(deps, instanceId)
    const states = history.map((h) => h.state)
    expect(states).toContain('STARTING')
    expect(states).toContain('EXECUTING')
    expect(states).toContain('HOLDING')
    expect(states).toContain('HELD')
    // Should NOT have proceeded to COMPLETING
    expect(states).not.toContain('COMPLETING')
    expect(states).not.toContain('COMPLETED')
  })
})

// ============================================================
// Error tests
// ============================================================

describe('StateMachine - Error path', () => {
  it('execution failure in EXECUTING triggers ABORTING -> ABORTED with two-tier error', async () => {
    const deps = createTestDeps()
    const { instanceId } = createTestInstance(deps, { pinnedStates: ['EXECUTING'] })
    deps.codeExecutor.mockResolvedValue(
      makeFailureResult({
        error: 'ValueError: bad input',
        error_type: 'RUNTIME_ERROR',
        traceback:
          'Traceback (most recent call last):\n  File "test.py", line 1\nValueError: bad input',
      })
    )
    const sm = createSM(deps)

    await sm.startInstance(instanceId)

    expect(getState(deps, instanceId)).toBe('ABORTED')

    const history = getStateHistory(deps, instanceId)
    const states = history.map((h) => h.state)
    expect(states).toContain('STARTING')
    expect(states).toContain('EXECUTING')
    expect(states).toContain('ABORTING')
    expect(states).toContain('ABORTED')

    const instance = deps.instanceRepo.findById(instanceId)!
    // error field: summary (error_type: message)
    expect(instance.error).toBe('RUNTIME_ERROR: ValueError: bad input')
    // traceback field: full Python traceback
    expect(instance.traceback).toContain('Traceback (most recent call last)')
    expect(instance.traceback).toContain('ValueError: bad input')
    // error and traceback are separate fields
    expect(instance.error).not.toContain('Traceback')
  })

  it('execution failure preserves outputs mutations made before raise (finding #3)', async () => {
    // Bug: previously the failure branch in handleCodeExecutionResult never read
    // result.outputs, so user code that set outputs['status']='1' then raised
    // would lose that status — only error/traceback survived. The instance's
    // output_parameters ended up empty, even though the sidecar reported what
    // the user code had achieved before failure.
    const deps = createTestDeps()
    const { instanceId } = createTestInstance(deps, { pinnedStates: ['EXECUTING'] })
    deps.codeExecutor.mockResolvedValue(
      makeFailureResult({
        outputs: { status: '1', progress: 'reached' },
        error: 'RuntimeError: boom',
        error_type: 'RUNTIME_ERROR',
      })
    )
    const sm = createSM(deps)

    await sm.startInstance(instanceId)

    expect(getState(deps, instanceId)).toBe('ABORTED')

    const instance = deps.instanceRepo.findById(instanceId)!
    const outputs = (instance.output_parameters as Array<{ key: string; value: unknown }>).reduce(
      (acc, p) => {
        acc[p.key] = String(p.value)
        return acc
      },
      {} as Record<string, string>
    )
    expect(outputs).toEqual({ status: '1', progress: 'reached' })

    // Error info still persisted as before (sanity).
    expect(instance.error).toBe('RUNTIME_ERROR: RuntimeError: boom')
  })

  it('ABORTING.py failure forces ABORTED — does not loop on itself', async () => {
    const deps = createTestDeps()
    const { instanceId } = createTestInstance(deps, {
      pinnedStates: ['EXECUTING', 'ABORTING'],
    })
    // Both EXECUTING and ABORTING fail. Without the recovery-state fix,
    // ABORTING.py failure re-enters ABORTING → executeCode fails again →
    // re-enter ABORTING → infinite loop until vitest test timeout.
    deps.codeExecutor.mockResolvedValue(
      makeFailureResult({
        error: 'KaBoom',
        error_type: 'RUNTIME_ERROR',
      })
    )
    const sm = createSM(deps)

    await sm.startInstance(instanceId)

    // Should reach ABORTED, not be stuck in ABORTING.
    expect(getState(deps, instanceId)).toBe('ABORTED')

    // ABORTING should appear exactly once in history (the one entry from
    // EXECUTING failure transition). A loop would produce many entries.
    const states = getStateHistory(deps, instanceId).map((h) => h.state)
    const aborting = states.filter((s) => s === 'ABORTING')
    expect(aborting.length).toBeLessThanOrEqual(2)
    expect(states[states.length - 1]).toBe('ABORTED')
  })
})

// ============================================================
// Command tests
// ============================================================

describe('StateMachine - Commands', () => {
  it('PAUSE from EXECUTING -> PAUSING -> PAUSED (no code)', async () => {
    const deps = createTestDeps()
    // Create instance already in EXECUTING state (no code at STARTING so it auto-advanced)
    const { instanceId } = createTestInstance(deps, {
      initialState: 'EXECUTING',
      pinnedStates: [],
    })
    const sm = createSM(deps)

    await sm.sendCommand(instanceId, 'PAUSE')

    expect(getState(deps, instanceId)).toBe('PAUSED')
    const states = getStateHistory(deps, instanceId).map((h) => h.state)
    expect(states).toContain('PAUSING')
    expect(states).toContain('PAUSED')
  })

  it('RESUME from PAUSED -> UNPAUSING -> EXECUTING (no code)', async () => {
    const deps = createTestDeps()
    const { instanceId } = createTestInstance(deps, {
      initialState: 'PAUSED',
      pinnedStates: [],
    })
    const sm = createSM(deps)

    await sm.sendCommand(instanceId, 'RESUME')

    // UNPAUSING -> EXECUTING (no code at EXECUTING so it auto-advances to COMPLETING -> COMPLETED)
    // Actually with no code at EXECUTING, it will advance all the way to COMPLETED
    expect(getState(deps, instanceId)).toBe('COMPLETED')
    const states = getStateHistory(deps, instanceId).map((h) => h.state)
    expect(states).toContain('UNPAUSING')
    expect(states).toContain('EXECUTING')
  })

  it('ABORT from EXECUTING -> ABORTING -> ABORTED', async () => {
    const deps = createTestDeps()
    const { instanceId } = createTestInstance(deps, {
      initialState: 'EXECUTING',
      pinnedStates: [],
    })
    const sm = createSM(deps)

    await sm.sendCommand(instanceId, 'ABORT')

    expect(getState(deps, instanceId)).toBe('ABORTED')
  })

  it('STOP from EXECUTING -> STOPPING -> COMPLETED', async () => {
    const deps = createTestDeps()
    const { instanceId } = createTestInstance(deps, {
      initialState: 'EXECUTING',
      pinnedStates: [],
    })
    const sm = createSM(deps)

    await sm.sendCommand(instanceId, 'STOP')

    expect(getState(deps, instanceId)).toBe('COMPLETED')
    const instance = deps.instanceRepo.findById(instanceId)!
    expect(instance.completed_at).not.toBeNull()
    const states = getStateHistory(deps, instanceId).map((h) => h.state)
    expect(states).toContain('STOPPING')
    expect(states).toContain('COMPLETED')
  })

  it('CLEAR from ABORTED -> CLEARING -> COMPLETED', async () => {
    const deps = createTestDeps()
    const { instanceId } = createTestInstance(deps, {
      initialState: 'ABORTED',
      pinnedStates: [],
    })
    const sm = createSM(deps)

    await sm.sendCommand(instanceId, 'CLEAR')

    expect(getState(deps, instanceId)).toBe('COMPLETED')
  })

  it('HOLD from EXECUTING -> HOLDING -> HELD (no code executing)', async () => {
    const deps = createTestDeps()
    const { instanceId } = createTestInstance(deps, {
      initialState: 'EXECUTING',
      pinnedStates: [],
    })
    const sm = createSM(deps)

    await sm.sendCommand(instanceId, 'HOLD')

    expect(getState(deps, instanceId)).toBe('HELD')
  })

  it('UNHOLD from HELD -> UNHOLDING -> EXECUTING (auto-advances to COMPLETED with no code)', async () => {
    const deps = createTestDeps()
    const { instanceId } = createTestInstance(deps, {
      initialState: 'HELD',
      pinnedStates: [],
    })
    const sm = createSM(deps)

    await sm.sendCommand(instanceId, 'UNHOLD')

    // UNHOLDING -> EXECUTING -> COMPLETING -> COMPLETED (no code)
    expect(getState(deps, instanceId)).toBe('COMPLETED')
    const states = getStateHistory(deps, instanceId).map((h) => h.state)
    expect(states).toContain('UNHOLDING')
    expect(states).toContain('EXECUTING')
  })

  it('PAUSE from STARTING throws InvalidStateTransitionError', async () => {
    const deps = createTestDeps()
    const { instanceId } = createTestInstance(deps, {
      initialState: 'STARTING',
      pinnedStates: [],
    })
    const sm = createSM(deps)

    await expect(sm.sendCommand(instanceId, 'PAUSE')).rejects.toThrow(InvalidStateTransitionError)
  })

  it('PAUSE from COMPLETED throws InvalidStateTransitionError', async () => {
    const deps = createTestDeps()
    const { instanceId } = createTestInstance(deps, {
      initialState: 'COMPLETED',
      pinnedStates: [],
    })
    const sm = createSM(deps)

    await expect(sm.sendCommand(instanceId, 'PAUSE')).rejects.toThrow(InvalidStateTransitionError)
  })
})

// ============================================================
// Deferred HOLD during code execution
// ============================================================

describe('StateMachine - Deferred HOLD during code execution', () => {
  it('HOLD sent while code is executing is deferred until code finishes, then applied', async () => {
    const deps = createTestDeps()
    const { instanceId } = createTestInstance(deps, { pinnedStates: ['EXECUTING'] })
    const sm = createSM(deps)

    // Create a promise that we can resolve manually to control code execution timing
    let resolveCodeExecution!: (result: CodeExecutionResult) => void
    const codeExecutionPromise = new Promise<CodeExecutionResult>((resolve) => {
      resolveCodeExecution = resolve
    })

    deps.codeExecutor.mockImplementation(async (_id, state) => {
      if (state === 'EXECUTING') {
        return codeExecutionPromise
      }
      return makeSuccessResult()
    })

    // Start instance (begins processing — code at EXECUTING starts executing)
    const startPromise = sm.startInstance(instanceId)

    // Wait a tick for the state machine to reach the code executor
    await new Promise((resolve) => setImmediate(resolve))

    // Verify that code is executing (instance in EXECUTING state)
    expect(getState(deps, instanceId)).toBe('EXECUTING')

    // Send HOLD while code is still executing — should be deferred immediately
    const holdPromise = sm.sendCommand(instanceId, 'HOLD')
    // sendCommand returns immediately (does not throw) because it's deferred
    await expect(holdPromise).resolves.toBeUndefined()

    // Instance is still in EXECUTING (deferred, not applied yet)
    expect(getState(deps, instanceId)).toBe('EXECUTING')

    // Now resolve the code execution with success
    resolveCodeExecution(makeSuccessResult({ return_value: true }))
    await startPromise

    // The deferred HOLD should have been applied after code finished
    // State should be HELD (not COMPLETING or COMPLETED)
    expect(getState(deps, instanceId)).toBe('HELD')

    const states = getStateHistory(deps, instanceId).map((h) => h.state)
    expect(states).toContain('STARTING')
    expect(states).toContain('EXECUTING')
    expect(states).toContain('HOLDING')
    expect(states).toContain('HELD')
    expect(states).not.toContain('COMPLETING')
    expect(states).not.toContain('COMPLETED')
  })
})

// ============================================================
// Opaque action tests
// ============================================================

describe('StateMachine - Opaque actions', () => {
  it('auto-advances POSTED -> RECEIVED -> IN_PROGRESS -> COMPLETED (no code)', async () => {
    const deps = createTestDeps()
    const { instanceId } = createTestInstance(deps, {
      visibility: 'opaque',
      pinnedStates: [],
    })
    const sm = createSM(deps)

    await sm.startInstance(instanceId)

    expect(getState(deps, instanceId)).toBe('COMPLETED')
    const states = getStateHistory(deps, instanceId).map((h) => h.state)
    expect(states).toContain('POSTED')
    expect(states).toContain('RECEIVED')
    expect(states).toContain('IN_PROGRESS')
    expect(states).toContain('COMPLETED')
  })

  it('opaque instance with code at IN_PROGRESS — code runs, advances to COMPLETED', async () => {
    const deps = createTestDeps()
    const { instanceId } = createTestInstance(deps, {
      visibility: 'opaque',
      pinnedStates: ['IN_PROGRESS'],
    })
    deps.codeExecutor.mockResolvedValue(makeSuccessResult({ return_value: true }))
    const sm = createSM(deps)

    await sm.startInstance(instanceId)

    expect(getState(deps, instanceId)).toBe('COMPLETED')
    expect(deps.codeExecutor).toHaveBeenCalledTimes(1)
    expect(deps.codeExecutor).toHaveBeenCalledWith(
      instanceId,
      'IN_PROGRESS',
      expect.any(String),
      expect.any(Object),
      expect.any(Object),
      expect.any(Object),
      expect.any(Object),
      expect.any(Number)
    )
  })
})

// ============================================================
// Callback tests
// ============================================================

describe('StateMachine - Callbacks', () => {
  it('onStateChange is called for each state entry', async () => {
    const deps = createTestDeps()
    const { instanceId } = createTestInstance(deps, { pinnedStates: [] })

    const onStateChange = vi.fn()
    const sm = createSMWithCallbacks(deps, { onStateChange })

    await sm.startInstance(instanceId)

    // Should be called for EXECUTING, COMPLETING, COMPLETED (and potentially STARTING terminal handling)
    expect(onStateChange).toHaveBeenCalled()

    // Verify it was called with the instance ID and valid state names
    for (const call of onStateChange.mock.calls) {
      const [calledId, state, instance] = call as [string, string, Instance]
      expect(calledId).toBe(instanceId)
      expect(typeof state).toBe('string')
      expect(instance).toHaveProperty('runtime_action_instance_id', instanceId)
    }

    // Should include at least EXECUTING, COMPLETING, COMPLETED
    const statesCalled = onStateChange.mock.calls.map((c) => (c as unknown[])[1] as string)
    expect(statesCalled).toContain('EXECUTING')
    expect(statesCalled).toContain('COMPLETING')
    expect(statesCalled).toContain('COMPLETED')
  })

  it('onTerminal is called when reaching COMPLETED', async () => {
    const deps = createTestDeps()
    const { instanceId } = createTestInstance(deps, { pinnedStates: [] })

    const onTerminal = vi.fn()
    const sm = createSMWithCallbacks(deps, { onTerminal })

    await sm.startInstance(instanceId)

    expect(onTerminal).toHaveBeenCalledTimes(1)
    const [calledId, state] = onTerminal.mock.calls[0] as [string, string, Instance]
    expect(calledId).toBe(instanceId)
    expect(state).toBe('COMPLETED')
  })

  it('onTerminal is called when reaching ABORTED', async () => {
    const deps = createTestDeps()
    const { instanceId } = createTestInstance(deps, { pinnedStates: ['EXECUTING'] })
    deps.codeExecutor.mockResolvedValue(makeFailureResult())

    const onTerminal = vi.fn()
    const sm = createSMWithCallbacks(deps, { onTerminal })

    await sm.startInstance(instanceId)

    expect(onTerminal).toHaveBeenCalledTimes(1)
    const [calledId, state] = onTerminal.mock.calls[0] as [string, string, Instance]
    expect(calledId).toBe(instanceId)
    expect(state).toBe('ABORTED')
  })
})
