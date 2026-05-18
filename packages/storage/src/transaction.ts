import type BetterSqlite3 from 'better-sqlite3'

/**
 * Creates a transaction helper for cross-repository atomic operations.
 *
 * Returns two methods:
 * - `transaction(fn)` — wraps fn in a db.transaction and returns the result
 * - `inTransaction(fn)` — same, but passes { db } to the callback
 */
export function createTransactionHelper(db: BetterSqlite3.Database) {
  return {
    /**
     * Wraps a synchronous function in a SQLite transaction.
     * If fn throws, all changes are rolled back.
     */
    transaction<T>(fn: () => T): T {
      const wrapped = db.transaction(fn)
      return wrapped()
    },

    /**
     * Wraps a synchronous function in a SQLite transaction.
     * Passes { db } to the callback so it can run queries directly.
     * If fn throws, all changes are rolled back.
     */
    inTransaction<T>(fn: (trx: { db: BetterSqlite3.Database }) => T): T {
      const wrapped = db.transaction(() => fn({ db }))
      return wrapped()
    },
  }
}
