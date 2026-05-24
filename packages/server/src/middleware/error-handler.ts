import type { ErrorRequestHandler } from 'express'
import { EngineError, InvalidStateTransitionError } from '@trajectory/engine'
import { NotFoundError, ValidationError } from '@trajectory/storage'

// ============================================================
// HTTP status mapping for engine error codes
// ============================================================

const ENGINE_ERROR_STATUS_MAP: Record<string, number> = {
  ACTION_NOT_FOUND: 404,
  INSTANCE_NOT_FOUND: 404,
  INVALID_STATE_TRANSITION: 409,
  PARAMETER_VALIDATION_FAILED: 400,
  EXECUTION_ERROR: 500,
  PROPERTY_WRITE_ERROR: 500,
  INVALID_COMMAND: 422,
}

// ============================================================
// Express 4-argument error handler
// ============================================================

export const errorHandler: ErrorRequestHandler = (err, _req, res, next) => {
  // next is required as 4th param so Express recognises this as an error handler
  void next

  // InvalidStateTransitionError (subclass of EngineError) — must be checked first
  if (err instanceof InvalidStateTransitionError) {
    return void res.status(409).json({
      error: {
        code: err.code,
        message: err.message,
        details: {
          current_state: err.currentState,
          command: err.command,
        },
      },
    })
  }

  // Generic EngineError
  if (err instanceof EngineError) {
    const status = ENGINE_ERROR_STATUS_MAP[err.code] ?? 500
    return void res.status(status).json({
      error: {
        code: err.code,
        message: err.message,
        details: {},
      },
    })
  }

  // Storage NotFoundError
  if (err instanceof NotFoundError) {
    return void res.status(404).json({
      error: {
        code: 'NOT_FOUND',
        message: err.message,
        details: {},
      },
    })
  }

  // Storage ValidationError
  if (err instanceof ValidationError) {
    return void res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: err.message,
        details: {},
      },
    })
  }

  // Unknown error — log and return generic 500
  console.error('Unhandled error:', err)
  return void res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
      details: {},
    },
  })
}
