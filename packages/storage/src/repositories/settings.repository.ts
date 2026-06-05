import type BetterSqlite3 from 'better-sqlite3'
import type { Setting, SettingRow } from '../types.js'
import { NotFoundError, ValidationError } from '../errors.js'

const KNOWN_KEYS = new Set([
  'python_pool_size',
  'execution_timeout_ms',
  'instance_retention_hours',
  'log_max_size',
  'api_key',
])

function validateValue(key: string, value: string): void {
  const num = Number(value)

  switch (key) {
    case 'python_pool_size':
      if (!Number.isInteger(num) || num < 1) {
        throw new ValidationError(key, 'must be an integer >= 1')
      }
      break

    case 'execution_timeout_ms':
      if (!Number.isInteger(num) || (num !== 0 && num < 1000)) {
        throw new ValidationError(key, 'must be 0 (disabled) or an integer >= 1000')
      }
      break

    case 'instance_retention_hours':
      if (isNaN(num) || num <= 0) {
        throw new ValidationError(key, 'must be a positive number')
      }
      break

    case 'log_max_size':
      if (!Number.isInteger(num) || num < 1) {
        throw new ValidationError(key, 'must be a positive integer')
      }
      break

    case 'api_key':
      // Any string is accepted; empty string means "open access" (no auth required).
      break

    default:
      throw new NotFoundError('Setting', key)
  }
}

export class SettingsRepository {
  private readonly db: BetterSqlite3.Database

  // Prepared statements
  private readonly stmtGet: BetterSqlite3.Statement
  private readonly stmtGetAll: BetterSqlite3.Statement
  private readonly stmtUpdate: BetterSqlite3.Statement
  private readonly stmtReset: BetterSqlite3.Statement
  private readonly stmtResetAll: BetterSqlite3.Statement

  constructor(db: BetterSqlite3.Database) {
    this.db = db

    this.stmtGet = db.prepare(`
      SELECT * FROM settings WHERE key = ?
    `)

    this.stmtGetAll = db.prepare(`
      SELECT * FROM settings ORDER BY key ASC
    `)

    this.stmtUpdate = db.prepare(`
      UPDATE settings SET value = ? WHERE key = ?
    `)

    this.stmtReset = db.prepare(`
      UPDATE settings SET value = default_value WHERE key = ?
    `)

    this.stmtResetAll = db.prepare(`
      UPDATE settings SET value = default_value
    `)
  }

  private fromRow(row: SettingRow): Setting {
    return {
      key: row.key,
      value: row.value,
      default_value: row.default_value,
      description: row.description,
      value_type: row.value_type,
    }
  }

  get(key: string): Setting | null {
    const row = this.stmtGet.get(key) as SettingRow | undefined
    return row ? this.fromRow(row) : null
  }

  getAll(): Setting[] {
    const rows = this.stmtGetAll.all() as SettingRow[]
    return rows.map((r) => this.fromRow(r))
  }

  getValue(key: string): string | null {
    const row = this.stmtGet.get(key) as SettingRow | undefined
    return row ? row.value : null
  }

  getNumericValue(key: string): number | null {
    const row = this.stmtGet.get(key) as SettingRow | undefined
    if (!row) return null
    const num = Number(row.value)
    return isNaN(num) ? null : num
  }

  update(key: string, value: string): Setting {
    // Check if key exists (also handles unknown keys via validation)
    if (!KNOWN_KEYS.has(key)) {
      throw new NotFoundError('Setting', key)
    }

    // Validate the value for known keys
    validateValue(key, value)

    const result = this.stmtUpdate.run(value, key)
    if (result.changes === 0) {
      throw new NotFoundError('Setting', key)
    }

    const row = this.stmtGet.get(key) as SettingRow
    return this.fromRow(row)
  }

  reset(key: string): Setting {
    const existing = this.stmtGet.get(key) as SettingRow | undefined
    if (!existing) {
      throw new NotFoundError('Setting', key)
    }

    this.stmtReset.run(key)
    const row = this.stmtGet.get(key) as SettingRow
    return this.fromRow(row)
  }

  resetAll(): Setting[] {
    this.stmtResetAll.run()
    const rows = this.stmtGetAll.all() as SettingRow[]
    return rows.map((r) => this.fromRow(r))
  }
}
