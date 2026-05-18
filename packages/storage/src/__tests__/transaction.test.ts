import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type BetterSqlite3 from 'better-sqlite3'
import { openDatabase } from '../database.js'
import { runMigrations } from '../migrations/runner.js'
import { migration as initialMigration } from '../migrations/001-initial-schema.js'
import { createTransactionHelper } from '../transaction.js'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createTransactionHelper', () => {
  let db: BetterSqlite3.Database

  beforeEach(() => {
    db = openDatabase(':memory:')
    runMigrations(db, [initialMigration])
  })

  afterEach(() => {
    db.close()
  })

  // -------------------------------------------------------------------------
  // transaction()
  // -------------------------------------------------------------------------

  describe('transaction()', () => {
    it('commits changes when fn succeeds', () => {
      const helper = createTransactionHelper(db)

      helper.transaction(() => {
        db.prepare(`UPDATE settings SET value = '9999' WHERE key = 'log_max_size'`).run()
      })

      const row = db.prepare(`SELECT value FROM settings WHERE key = 'log_max_size'`).get() as {
        value: string
      }
      expect(row.value).toBe('9999')
    })

    it('rolls back all changes if fn throws', () => {
      const helper = createTransactionHelper(db)

      expect(() => {
        helper.transaction(() => {
          db.prepare(`UPDATE settings SET value = '1234' WHERE key = 'log_max_size'`).run()
          db.prepare(`UPDATE settings SET value = '5678' WHERE key = 'python_pool_size'`).run()
          throw new Error('intentional failure')
        })
      }).toThrow('intentional failure')

      // Both changes should be rolled back
      const maxSize = db.prepare(`SELECT value FROM settings WHERE key = 'log_max_size'`).get() as {
        value: string
      }
      const poolSize = db
        .prepare(`SELECT value FROM settings WHERE key = 'python_pool_size'`)
        .get() as { value: string }

      expect(maxSize.value).toBe('10000') // default unchanged
      expect(poolSize.value).toBe('4') // default unchanged
    })

    it('returns the value returned by fn', () => {
      const helper = createTransactionHelper(db)
      const result = helper.transaction(() => 42)
      expect(result).toBe(42)
    })

    it('supports multiple operations in one transaction', () => {
      const helper = createTransactionHelper(db)

      helper.transaction(() => {
        db.prepare(`UPDATE settings SET value = '500' WHERE key = 'log_max_size'`).run()
        db.prepare(`UPDATE settings SET value = '2' WHERE key = 'python_pool_size'`).run()
        db.prepare(`UPDATE settings SET value = '5000' WHERE key = 'execution_timeout_ms'`).run()
      })

      const settings = db.prepare(`SELECT key, value FROM settings ORDER BY key`).all() as {
        key: string
        value: string
      }[]
      const map = Object.fromEntries(settings.map((s) => [s.key, s.value]))

      expect(map['log_max_size']).toBe('500')
      expect(map['python_pool_size']).toBe('2')
      expect(map['execution_timeout_ms']).toBe('5000')
    })
  })

  // -------------------------------------------------------------------------
  // inTransaction()
  // -------------------------------------------------------------------------

  describe('inTransaction()', () => {
    it('passes db to the callback', () => {
      const helper = createTransactionHelper(db)
      let receivedDb: BetterSqlite3.Database | undefined

      helper.inTransaction(({ db: trxDb }) => {
        receivedDb = trxDb
      })

      expect(receivedDb).toBe(db)
    })

    it('commits changes when fn succeeds', () => {
      const helper = createTransactionHelper(db)

      helper.inTransaction(({ db: trxDb }) => {
        trxDb.prepare(`UPDATE settings SET value = '7777' WHERE key = 'log_max_size'`).run()
      })

      const row = db.prepare(`SELECT value FROM settings WHERE key = 'log_max_size'`).get() as {
        value: string
      }
      expect(row.value).toBe('7777')
    })

    it('rolls back if fn throws', () => {
      const helper = createTransactionHelper(db)

      expect(() => {
        helper.inTransaction(({ db: trxDb }) => {
          trxDb.prepare(`UPDATE settings SET value = '999' WHERE key = 'log_max_size'`).run()
          throw new Error('rollback me')
        })
      }).toThrow('rollback me')

      const row = db.prepare(`SELECT value FROM settings WHERE key = 'log_max_size'`).get() as {
        value: string
      }
      expect(row.value).toBe('10000') // unchanged
    })

    it('returns the value returned by fn', () => {
      const helper = createTransactionHelper(db)
      const result = helper.inTransaction(() => 'hello')
      expect(result).toBe('hello')
    })
  })
})
