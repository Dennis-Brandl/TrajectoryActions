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
