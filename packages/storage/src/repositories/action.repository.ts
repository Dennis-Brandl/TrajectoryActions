import type BetterSqlite3 from 'better-sqlite3'
import type { Action, ActionInput, ActionRow } from '../types.js'

export class ActionRepository {
  private readonly db: BetterSqlite3.Database

  // Prepared statements
  private readonly stmtInsert: BetterSqlite3.Statement
  private readonly stmtFindByOid: BetterSqlite3.Statement
  private readonly stmtFindByEnvironment: BetterSqlite3.Statement
  private readonly stmtFindAll: BetterSqlite3.Statement
  private readonly stmtDelete: BetterSqlite3.Statement
  private readonly stmtDeleteByEnvironment: BetterSqlite3.Statement
  private readonly stmtCount: BetterSqlite3.Statement
  private readonly stmtCountByEnvironment: BetterSqlite3.Statement

  constructor(db: BetterSqlite3.Database) {
    this.db = db

    this.stmtInsert = db.prepare(`
      INSERT INTO actions (
        oid, environment_oid, local_id, version, last_modified_date, description,
        action_visibility, input_parameter_specifications,
        output_parameter_specifications, property_specifications, timeout_seconds,
        state
      ) VALUES (
        @oid, @environment_oid, @local_id, @version, @last_modified_date, @description,
        @action_visibility, @input_parameter_specifications,
        @output_parameter_specifications, @property_specifications, @timeout_seconds,
        @state
      )
    `)

    this.stmtFindByOid = db.prepare(`
      SELECT * FROM actions WHERE oid = ?
    `)

    this.stmtFindByEnvironment = db.prepare(`
      SELECT * FROM actions WHERE environment_oid = ? ORDER BY local_id ASC
    `)

    this.stmtFindAll = db.prepare(`
      SELECT * FROM actions ORDER BY local_id ASC
    `)

    this.stmtDelete = db.prepare(`
      DELETE FROM actions WHERE oid = ?
    `)

    this.stmtDeleteByEnvironment = db.prepare(`
      DELETE FROM actions WHERE environment_oid = ?
    `)

    this.stmtCount = db.prepare(`
      SELECT COUNT(*) AS cnt FROM actions
    `)

    this.stmtCountByEnvironment = db.prepare(`
      SELECT COUNT(*) AS cnt FROM actions WHERE environment_oid = ?
    `)
  }

  private toRow(input: ActionInput): ActionRow {
    return {
      oid: input.oid,
      environment_oid: input.environment_oid,
      local_id: input.local_id,
      version: input.version,
      last_modified_date: input.last_modified_date,
      description: input.description ?? null,
      action_visibility: input.action_visibility,
      input_parameter_specifications: JSON.stringify(input.input_parameter_specifications),
      output_parameter_specifications: JSON.stringify(input.output_parameter_specifications),
      property_specifications: JSON.stringify(input.property_specifications),
      timeout_seconds: input.timeout_seconds ?? null,
      state: input.state ?? 'Draft',
    }
  }

  private fromRow(row: ActionRow): Action {
    return {
      oid: row.oid,
      environment_oid: row.environment_oid,
      local_id: row.local_id,
      version: row.version,
      last_modified_date: row.last_modified_date,
      description: row.description,
      action_visibility: row.action_visibility,
      input_parameter_specifications: JSON.parse(row.input_parameter_specifications) as unknown[],
      output_parameter_specifications: JSON.parse(row.output_parameter_specifications) as unknown[],
      property_specifications: JSON.parse(row.property_specifications) as unknown[],
      timeout_seconds: row.timeout_seconds,
      state: row.state as Action['state'],
    }
  }

  create(input: ActionInput): Action {
    const row = this.toRow(input)
    this.stmtInsert.run(row)
    return this.fromRow(row)
  }

  findByOid(oid: string): Action | null {
    const row = this.stmtFindByOid.get(oid) as ActionRow | undefined
    return row ? this.fromRow(row) : null
  }

  findByEnvironment(environmentOid: string): Action[] {
    const rows = this.stmtFindByEnvironment.all(environmentOid) as ActionRow[]
    return rows.map((r) => this.fromRow(r))
  }

  findAll(): Action[] {
    const rows = this.stmtFindAll.all() as ActionRow[]
    return rows.map((r) => this.fromRow(r))
  }

  update(oid: string, input: Partial<ActionInput>): Action | null {
    const existing = this.stmtFindByOid.get(oid) as ActionRow | undefined
    if (!existing) return null

    const fields: string[] = []
    const values: unknown[] = []

    const fieldMap: Record<string, () => void> = {
      environment_oid: () => {
        fields.push('environment_oid = ?')
        values.push(input.environment_oid)
      },
      local_id: () => {
        fields.push('local_id = ?')
        values.push(input.local_id)
      },
      version: () => {
        fields.push('version = ?')
        values.push(input.version)
      },
      last_modified_date: () => {
        fields.push('last_modified_date = ?')
        values.push(input.last_modified_date)
      },
      description: () => {
        fields.push('description = ?')
        values.push(input.description ?? null)
      },
      action_visibility: () => {
        fields.push('action_visibility = ?')
        values.push(input.action_visibility)
      },
      input_parameter_specifications: () => {
        fields.push('input_parameter_specifications = ?')
        values.push(JSON.stringify(input.input_parameter_specifications))
      },
      output_parameter_specifications: () => {
        fields.push('output_parameter_specifications = ?')
        values.push(JSON.stringify(input.output_parameter_specifications))
      },
      property_specifications: () => {
        fields.push('property_specifications = ?')
        values.push(JSON.stringify(input.property_specifications))
      },
      timeout_seconds: () => {
        fields.push('timeout_seconds = ?')
        values.push(input.timeout_seconds ?? null)
      },
      state: () => {
        fields.push('state = ?')
        values.push(input.state ?? 'Draft')
      },
    }

    for (const key of Object.keys(input) as (keyof ActionInput)[]) {
      if (key === 'oid') continue
      if (key in fieldMap) {
        fieldMap[key]()
      }
    }

    if (fields.length === 0) {
      return this.fromRow(existing)
    }

    values.push(oid)
    const stmt = this.db.prepare(`UPDATE actions SET ${fields.join(', ')} WHERE oid = ?`)
    stmt.run(...values)

    const updated = this.stmtFindByOid.get(oid) as ActionRow
    return this.fromRow(updated)
  }

  delete(oid: string): boolean {
    const result = this.stmtDelete.run(oid)
    return result.changes > 0
  }

  deleteByEnvironment(environmentOid: string): number {
    const result = this.stmtDeleteByEnvironment.run(environmentOid)
    return result.changes
  }

  count(): number {
    const result = this.stmtCount.get() as { cnt: number }
    return result.cnt
  }

  countByEnvironment(environmentOid: string): number {
    const result = this.stmtCountByEnvironment.get(environmentOid) as { cnt: number }
    return result.cnt
  }

  upsert(input: ActionInput): { action: Action; created: boolean } {
    const existing = this.stmtFindByOid.get(input.oid) as ActionRow | undefined

    if (!existing) {
      const action = this.create(input)
      return { action, created: true }
    }

    // Update all fields
    const updatedAction = this.update(input.oid, input)
    return { action: updatedAction!, created: false }
  }
}
