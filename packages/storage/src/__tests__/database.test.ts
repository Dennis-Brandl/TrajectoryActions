import { describe, it, expect, afterEach } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { unlinkSync } from 'fs'
import type BetterSqlite3 from 'better-sqlite3'
import { openDatabase } from '../database.js'

describe('openDatabase', () => {
  let db: BetterSqlite3.Database | null = null

  afterEach(() => {
    db?.close()
    db = null
  })

  it('returns a database instance for :memory:', () => {
    db = openDatabase(':memory:')
    expect(db).toBeDefined()
    expect(db.open).toBe(true)
  })

  it('enables foreign keys (foreign_keys = 1)', () => {
    db = openDatabase(':memory:')
    const result = db.pragma('foreign_keys') as { foreign_keys: number }[]
    expect(result).toEqual([{ foreign_keys: 1 }])
  })

  it('sets synchronous = NORMAL (synchronous = 1)', () => {
    db = openDatabase(':memory:')
    const result = db.pragma('synchronous') as { synchronous: number }[]
    // NORMAL = 1
    expect(result).toEqual([{ synchronous: 1 }])
  })

  it('sets WAL journal mode on a file-based database', () => {
    // :memory: databases return "memory" for journal_mode, so we need a temp file
    const tmpFile = join(tmpdir(), `trajectory-test-${Date.now()}.sqlite`)
    let fileDb: BetterSqlite3.Database | null = null
    try {
      fileDb = openDatabase(tmpFile)
      const result = fileDb.pragma('journal_mode') as { journal_mode: string }[]
      expect(result).toEqual([{ journal_mode: 'wal' }])
    } finally {
      fileDb?.close()
      // Clean up temp files
      for (const suffix of ['', '-wal', '-shm', '-journal']) {
        try {
          unlinkSync(tmpFile + suffix)
        } catch {
          // ignore missing files
        }
      }
    }
  })

  it('throws when given an invalid path', () => {
    expect(() => {
      openDatabase('/nonexistent/deeply/nested/path/db.sqlite')
    }).toThrow()
  })
})
