export const ENGINE_VERSION = '0.0.1-engine' as const

// ============================================================
// State types and constants
// ============================================================

export type {
  ObservableState,
  OpaqueState,
  ActionState,
  Command,
  ClientCommand,
} from './state-machine/states.js'

export {
  OBSERVABLE_STATES,
  OPAQUE_STATES,
  ANY_ACTIVE_STATES,
  TERMINAL_STATES,
  isTerminal,
  isActiveState,
} from './state-machine/states.js'

// ============================================================
// Transition tables
// ============================================================

export {
  TRANSITION_TABLE,
  OPAQUE_TRANSITION_TABLE,
  AUTO_ADVANCE,
  OPAQUE_AUTO_ADVANCE,
  validateCommand,
} from './state-machine/transitions.js'

// ============================================================
// State machine
// ============================================================

export { StateMachine } from './state-machine/state-machine.js'
export type {
  CodeExecutor,
  CodeExecutionResult,
  StateMachineCallbacks,
} from './state-machine/state-machine.js'

// ============================================================
// Python worker pool
// ============================================================

export { PythonWorker } from './python-pool/worker.js'
export { PythonWorkerPool } from './python-pool/pool.js'
export type { SidecarRequest, SidecarResponse } from './python-pool/types.js'
export type { PythonWorkerPoolOptions } from './python-pool/pool.js'

// ============================================================
// Instance manager (Phase 4)
// ============================================================

export { ExecutionLogger } from './instance-manager/execution-logger.js'
export { resolveInputParameters, flattenProperties } from './instance-manager/parameter-resolver.js'
export { InstanceManager } from './instance-manager/instance-manager.js'
export type {
  InvokeRequest,
  InvokeResult,
  InstanceManagerOptions,
} from './instance-manager/types.js'

// ============================================================
// Error types
// ============================================================

export { EngineError, InvalidStateTransitionError, ExecutionError } from './errors.js'
