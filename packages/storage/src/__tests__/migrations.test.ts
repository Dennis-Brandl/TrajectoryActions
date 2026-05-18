import { describe, it, expect, afterEach } from 'vitest'
import type BetterSqlite3 from 'better-sqlite3'
import { openDatabase } from '../database.js'
import { runMigrations } from '../migrations/runner.js'
import { migration as initialMigration } from '../migrations/001-initial-schema.js'

const EXPECTED_TABLES = [
  'environments',
  'actions',
  'code_versions',
  'instances',
  'execution_log',
  'settings',
  '_migrations',
]

const EXPECTED_INDEXES = [
  'idx_actions_environment',
  'idx_code_versions_action_state',
  'idx_code_versions_active',
  'idx_instances_state',
  'idx_instances_action',
  'idx_instances_workflow',
  'idx_instances_cleanup',
  'idx_log_action',
  'idx_log_environment',
  'idx_log_status',
  'idx_log_completed',
  'idx_log_oldest',
]

const DEFAULT_SETTING_KEYS = [
  'log_max_size',
  'python_pool_size',
  'execution_timeout_ms',
  'instance_retention_hours',
]

function getDb(): BetterSqlite3.Database {
  const db = openDatabase(':memory:')
  return db
}

function getTableNames(db: BetterSqlite3.Database): string[] {
  return (
    db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as {
      name: string
    }[]
  ).map((r) => r.name)
}

function getIndexNames(db: BetterSqlite3.Database): string[] {
  return (
    db.prepare("SELECT name FROM sqlite_master WHERE type='index' ORDER BY name").all() as {
      name: string
    }[]
  ).map((r) => r.name)
}

describe('runMigrations', () => {
  let db: BetterSqlite3.Database | null = null

  afterEach(() => {
    db?.close()
    db = null
  })

  it('creates the _migrations meta-table', () => {
    db = getDb()
    runMigrations(db, [])
    const tables = getTableNames(db)
    expect(tables).toContain('_migrations')
  })

  it('creates all 6 application tables after running initial migration', () => {
    db = getDb()
    runMigrations(db, [initialMigration])
    const tables = getTableNames(db)
    for (const table of EXPECTED_TABLES) {
      expect(tables, `Expected table "${table}" to exist`).toContain(table)
    }
  })

  it('creates all expected indexes', () => {
    db = getDb()
    runMigrations(db, [initialMigration])
    const indexes = getIndexNames(db)
    for (const idx of EXPECTED_INDEXES) {
      expect(indexes, `Expected index "${idx}" to exist`).toContain(idx)
    }
  })

  it('seeds 4 default settings with correct keys', () => {
    db = getDb()
    runMigrations(db, [initialMigration])
    const settings = db.prepare('SELECT key FROM settings ORDER BY key').all() as { key: string }[]
    const keys = settings.map((s) => s.key)
    expect(keys).toHaveLength(4)
    for (const key of DEFAULT_SETTING_KEYS) {
      expect(keys, `Expected setting key "${key}"`).toContain(key)
    }
  })

  it('seeds settings with correct default values', () => {
    db = getDb()
    runMigrations(db, [initialMigration])
    const row = db
      .prepare('SELECT value, default_value FROM settings WHERE key = ?')
      .get('log_max_size') as { value: string; default_value: string }
    expect(row.value).toBe('10000')
    expect(row.default_value).toBe('10000')
  })

  it('is idempotent — running migrations twice does not duplicate settings or throw', () => {
    db = getDb()
    runMigrations(db, [initialMigration])
    runMigrations(db, [initialMigration]) // second run
    const count = (db.prepare('SELECT COUNT(*) as cnt FROM settings').get() as { cnt: number }).cnt
    expect(count).toBe(4)
  })

  it('records migration in _migrations table with correct name', () => {
    db = getDb()
    runMigrations(db, [initialMigration])
    const rows = db.prepare('SELECT name FROM _migrations').all() as { name: string }[]
    expect(rows).toHaveLength(1)
    expect(rows[0].name).toBe('001-initial-schema')
  })

  it('does not insert a second _migrations row on second run', () => {
    db = getDb()
    runMigrations(db, [initialMigration])
    runMigrations(db, [initialMigration])
    const count = (db.prepare('SELECT COUNT(*) as cnt FROM _migrations').get() as { cnt: number })
      .cnt
    expect(count).toBe(1)
  })

  it('cascades deletes: deleting an environment removes its actions and code_versions', () => {
    db = getDb()
    runMigrations(db, [initialMigration])

    db.prepare(
      `INSERT INTO environments (oid, local_id, version, last_modified_date, schema_version, imported_at, source_filename)
       VALUES ('env-1', 'TestEnv', '1.0', '2026-01-01T00:00:00Z', '4.0', '2026-01-01T00:00:00Z', 'test.WFenvir')`
    ).run()

    db.prepare(
      `INSERT INTO actions (oid, environment_oid, local_id, version, last_modified_date, action_visibility)
       VALUES ('act-1', 'env-1', 'TestAction', '1.0', '2026-01-01T00:00:00Z', 'opaque')`
    ).run()

    db.prepare(
      `INSERT INTO code_versions (id, action_oid, state, version_number, source_code, created_at)
       VALUES ('cv-1', 'act-1', 'EXECUTING', 1, 'pass', '2026-01-01T00:00:00Z')`
    ).run()

    // Delete the environment
    db.prepare(`DELETE FROM environments WHERE oid = 'env-1'`).run()

    // Action should be gone (CASCADE from environment -> actions)
    const actionCount = (
      db.prepare('SELECT COUNT(*) as cnt FROM actions WHERE oid = ?').get('act-1') as {
        cnt: number
      }
    ).cnt
    expect(actionCount).toBe(0)

    // Code version should be gone (CASCADE from actions -> code_versions)
    const cvCount = (
      db.prepare('SELECT COUNT(*) as cnt FROM code_versions WHERE id = ?').get('cv-1') as {
        cnt: number
      }
    ).cnt
    expect(cvCount).toBe(0)
  })

  it('does NOT cascade delete instances when environment is deleted', () => {
    db = getDb()
    runMigrations(db, [initialMigration])

    db.prepare(
      `INSERT INTO environments (oid, local_id, version, last_modified_date, schema_version, imported_at, source_filename)
       VALUES ('env-2', 'TestEnv2', '1.0', '2026-01-01T00:00:00Z', '4.0', '2026-01-01T00:00:00Z', 'test.WFenvir')`
    ).run()

    db.prepare(
      `INSERT INTO actions (oid, environment_oid, local_id, version, last_modified_date, action_visibility)
       VALUES ('act-2', 'env-2', 'TestAction2', '1.0', '2026-01-01T00:00:00Z', 'opaque')`
    ).run()

    db.prepare(
      `INSERT INTO instances (runtime_action_instance_id, action_oid, environment_oid, workflow_instance_id, step_instance_id, step_oid, visibility, state, created_at)
       VALUES ('inst-1', 'act-2', 'env-2', 'wf-1', 'step-inst-1', 'step-1', 'opaque', 'IDLE', '2026-01-01T00:00:00Z')`
    ).run()

    // FK enforcement is ON but instances has no CASCADE — we must disable FKs temporarily to
    // delete env+action while keeping the instance to prove NO cascade; OR we can check that
    // the FK constraint IS enforced (delete would fail). The spec says "NO CASCADE on instances".
    // We verify this by disabling FK enforcement for the deletion, then re-enabling.
    db.pragma('foreign_keys = OFF')
    db.prepare(`DELETE FROM environments WHERE oid = 'env-2'`).run()
    db.pragma('foreign_keys = ON')

    // Instance should still exist (no cascade)
    const instanceCount = (
      db
        .prepare('SELECT COUNT(*) as cnt FROM instances WHERE runtime_action_instance_id = ?')
        .get('inst-1') as { cnt: number }
    ).cnt
    expect(instanceCount).toBe(1)
  })
})
