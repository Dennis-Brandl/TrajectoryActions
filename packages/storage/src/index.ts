export const STORAGE_VERSION = '0.0.1' as const

export { EnvironmentRepository } from './repositories/environment.repository.js'
export { ActionRepository } from './repositories/action.repository.js'
export { CodeVersionRepository } from './repositories/code-version.repository.js'
export { InstanceRepository } from './repositories/instance.repository.js'
export { LogRepository } from './repositories/log.repository.js'
export type { LogQueryFilters } from './repositories/log.repository.js'
export { SettingsRepository } from './repositories/settings.repository.js'
export { createTransactionHelper } from './transaction.js'
export { StorageError, NotFoundError, ValidationError } from './errors.js'

export { openDatabase } from './database.js'
export type { BetterSqlite3Database } from './database.js'

export { runMigrations } from './migrations/runner.js'
export type { Migration } from './migrations/runner.js'

export { migration as initialMigration } from './migrations/001-initial-schema.js'
export { migration as actionTimeoutMigration } from './migrations/002-action-timeout.js'
export { migration as lifecycleStateMigration } from './migrations/003-lifecycle-state.js'

export type {
  Visibility,
  FinalStatus,
  LifecycleState,
  // Row types
  EnvironmentRow,
  ActionRow,
  CodeVersionRow,
  InstanceRow,
  ExecutionLogRow,
  SettingRow,
  // Domain types
  Environment,
  Action,
  CodeVersion,
  Instance,
  ExecutionLogEntry,
  Setting,
  // Input types
  EnvironmentInput,
  ActionInput,
  CodeVersionInput,
  InstanceInput,
  ExecutionLogInput,
  SettingInput,
} from './types.js'

import { openDatabase } from './database.js'
import { runMigrations } from './migrations/runner.js'
import { migration as initialMigration } from './migrations/001-initial-schema.js'
import { migration as actionTimeoutMigration } from './migrations/002-action-timeout.js'
import { migration as lifecycleStateMigration } from './migrations/003-lifecycle-state.js'
import type BetterSqlite3 from 'better-sqlite3'

/**
 * Convenience function for consumers (e.g. packages/server) to call on startup.
 * Opens the database and runs all migrations, returning the configured db instance.
 */
export function initializeDatabase(path: string): BetterSqlite3.Database {
  const db = openDatabase(path)
  runMigrations(db, [initialMigration, actionTimeoutMigration, lifecycleStateMigration])
  return db
}
