/**
 * Base error class for all engine-layer errors.
 * Carries a machine-readable `code` in addition to the human-readable message.
 */
export class EngineError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'EngineError'
    this.code = code
    // Restore prototype chain (required when extending built-in Error in TS)
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

/**
 * Thrown when a state command is not valid for the instance's current state.
 * Maps to HTTP 409 INVALID_STATE_TRANSITION.
 */
export class InvalidStateTransitionError extends EngineError {
  readonly currentState: string
  readonly command: string

  constructor(currentState: string, command: string) {
    super(
      'INVALID_STATE_TRANSITION',
      `Command '${command}' is not valid in state '${currentState}'`
    )
    this.name = 'InvalidStateTransitionError'
    this.currentState = currentState
    this.command = command
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

/**
 * Thrown when Python code execution fails (runtime error, timeout, worker crash, etc.).
 * The errorType field carries one of: SYNTAX_ERROR, RUNTIME_ERROR, TIMEOUT, WORKER_CRASH.
 */
export class ExecutionError extends EngineError {
  readonly errorType?: string

  constructor(message: string, cause?: Error, errorType?: string) {
    super('EXECUTION_ERROR', message)
    this.name = 'ExecutionError'
    this.errorType = errorType
    if (cause) {
      this.cause = cause
    }
    Object.setPrototypeOf(this, new.target.prototype)
  }
}
