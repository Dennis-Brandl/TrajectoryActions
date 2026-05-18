import type BetterSqlite3 from 'better-sqlite3'

export interface Migration {
  name: string
  up: (db: BetterSqlite3.Database) => void
}

/**
 * Runs all unapplied migrations against the given database.
 *
 * - Creates the _migrations meta-table if it does not exist
 * - Reads already-applied migration names
 * - Sorts migrations by name (string comparison — 001- prefix ensures order)
 * - Applies each unapplied migration and records it in _migrations
 * - Wraps all apply steps in a single transaction so a failure rolls back everything
 */
export function runMigrations(db: BetterSqlite3.Database, migrations: Migration[]): void {
  // Create meta-table if it doesn't exist
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL
    )
  `)

  // Read already-applied migrations
  const applied = new Set(
    (db.prepare('SELECT name FROM _migrations').all() as { name: string }[]).map((r) => r.name)
  )

  // Sort by name (001- prefix keeps chronological order)
  const pending = [...migrations]
    .sort((a, b) => a.name.localeCompare(b.name))
    .filter((m) => !applied.has(m.name))

  if (pending.length === 0) return

  const insertMigration = db.prepare('INSERT INTO _migrations (name, applied_at) VALUES (?, ?)')

  // Apply all pending migrations in a single transaction
  const applyAll = db.transaction(() => {
    for (const migration of pending) {
      migration.up(db)
      insertMigration.run(migration.name, new Date().toISOString())
    }
  })

  applyAll()
}
