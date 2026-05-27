import Database from 'better-sqlite3'
import type BetterSqlite3 from 'better-sqlite3'

export type { Database as BetterSqlite3Database } from 'better-sqlite3'

/**
 * Opens a SQLite database at the given path and configures it with:
 * - WAL journal mode for better concurrent read/write performance
 * - Foreign keys ON to enforce referential integrity
 * - Synchronous NORMAL for a good balance of safety and performance
 *
 * Do NOT create a module-level singleton — pass this instance to repositories
 * via constructor injection. This enables :memory: databases in tests.
 */
export function openDatabase(path: string): BetterSqlite3.Database {
  const db = new Database(path, { timeout: 5000 })
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.pragma('synchronous = NORMAL')
  return db
}

/**
 * The tables the application requires once all migrations have run. The
 * canonical list lives here so the startup verification and the /health check
 * share one source of truth.
 */
export const EXPECTED_TABLES = [
  'environments',
  'actions',
  'code_versions',
  'instances',
  'execution_log',
  'settings',
  '_migrations',
] as const

/**
 * Permanent rule: a distributed app must guarantee its database has every
 * required table on startup. Returns whether all expected tables exist. Used by
 * initializeDatabase() (fail-fast) and the server's /health endpoint.
 */
export function databaseSchemaStatus(db: BetterSqlite3.Database): {
  ok: boolean
  missingTables: string[]
} {
  const existing = new Set(
    (
      db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]
    ).map((r) => r.name)
  )
  const missingTables = EXPECTED_TABLES.filter((t) => !existing.has(t))
  return { ok: missingTables.length === 0, missingTables }
}
