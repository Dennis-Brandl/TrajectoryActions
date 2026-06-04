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

export { openDatabase, EXPECTED_TABLES, databaseSchemaStatus } from './database.js'
export type { BetterSqlite3Database } from './database.js'

export { runMigrations } from './migrations/runner.js'
export type { Migration } from './migrations/runner.js'

export { migration as initialMigration } from './migrations/001-initial-schema.js'
export { migration as actionTimeoutMigration } from './migrations/002-action-timeout.js'
export { migration as lifecycleStateMigration } from './migrations/003-lifecycle-state.js'
export { migration as apiKeySettingMigration } from './migrations/004-api-key-setting.js'

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

import { openDatabase, databaseSchemaStatus } from './database.js'
import { runMigrations } from './migrations/runner.js'
import { migration as initialMigration } from './migrations/001-initial-schema.js'
import { migration as actionTimeoutMigration } from './migrations/002-action-timeout.js'
import { migration as lifecycleStateMigration } from './migrations/003-lifecycle-state.js'
import { migration as apiKeySettingMigration } from './migrations/004-api-key-setting.js'
import type BetterSqlite3 from 'better-sqlite3'

/**
 * Convenience function for consumers (e.g. packages/server) to call on startup.
 * Opens the database and runs all migrations, returning the configured db instance.
 */
export function initializeDatabase(path: string): BetterSqlite3.Database {
  const db = openDatabase(path)
  runMigrations(db, [
    initialMigration,
    actionTimeoutMigration,
    lifecycleStateMigration,
    apiKeySettingMigration,
  ])

  // Permanent rule: a distributed app must guarantee its DB has all required
  // tables on startup. Migrations create them; verify and refuse to serve an
  // incomplete database (e.g. a corrupt/partial file whose _migrations table
  // claims everything is applied while the tables are actually missing).
  const { ok, missingTables } = databaseSchemaStatus(db)
  if (!ok) {
    throw new Error(
      `[storage] FATAL: schema verification failed after migrations — missing tables: ` +
        `${missingTables.join(', ')} (db: ${path}). Refusing to start with an incomplete database.`
    )
  }

  return db
}
