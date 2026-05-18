/**
 * Base error class for all storage-layer errors.
 * Carries a machine-readable `code` in addition to the human-readable message.
 */
export class StorageError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'StorageError'
    this.code = code
    // Restore prototype chain (required when extending built-in Error in TS)
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

/**
 * Thrown when a requested record does not exist.
 */
export class NotFoundError extends StorageError {
  readonly entity: string
  readonly id: string

  constructor(entity: string, id: string) {
    super('NOT_FOUND', `${entity} not found: ${id}`)
    this.name = 'NotFoundError'
    this.entity = entity
    this.id = id
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

/**
 * Thrown when a value fails validation constraints.
 */
export class ValidationError extends StorageError {
  readonly field: string

  constructor(field: string, message: string) {
    super('VALIDATION_ERROR', `Validation failed for '${field}': ${message}`)
    this.name = 'ValidationError'
    this.field = field
    Object.setPrototypeOf(this, new.target.prototype)
  }
}
