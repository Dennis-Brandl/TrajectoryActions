import { describe, it, expect, afterEach } from 'vitest'
import type BetterSqlite3 from 'better-sqlite3'
import { openDatabase, databaseSchemaStatus, EXPECTED_TABLES } from '../database.js'
import { runMigrations } from '../migrations/runner.js'
import { migration as initialMigration } from '../migrations/001-initial-schema.js'
import { initializeDatabase } from '../index.js'

// Verifies the permanent rule: a distributed app must guarantee its database has
// every required table on startup. databaseSchemaStatus() backs both the
// initializeDatabase() fail-fast check and the server's /health endpoint.
describe('databaseSchemaStatus', () => {
  let db: BetterSqlite3.Database | null = null
  afterEach(() => {
    db?.close()
    db = null
  })

  it('reports ok with no missing tables after migrations', () => {
    db = openDatabase(':memory:')
    runMigrations(db, [initialMigration])
    const status = databaseSchemaStatus(db)
    expect(status.ok).toBe(true)
    expect(status.missingTables).toEqual([])
  })

  it('lists every expected table when the database is empty', () => {
    db = openDatabase(':memory:')
    const status = databaseSchemaStatus(db)
    expect(status.ok).toBe(false)
    expect(status.missingTables.sort()).toEqual([...EXPECTED_TABLES].sort())
  })

  it('detects a single dropped table', () => {
    db = openDatabase(':memory:')
    runMigrations(db, [initialMigration])
    db.exec('DROP TABLE settings')
    const status = databaseSchemaStatus(db)
    expect(status.ok).toBe(false)
    expect(status.missingTables).toContain('settings')
  })
})

describe('initializeDatabase', () => {
  it('returns a db whose schema verifies as complete', () => {
    const db = initializeDatabase(':memory:')
    try {
      expect(databaseSchemaStatus(db).ok).toBe(true)
    } finally {
      db.close()
    }
  })
})
