import type BetterSqlite3 from 'better-sqlite3'
import type { Environment, EnvironmentInput, EnvironmentRow } from '../types.js'

export class EnvironmentRepository {
  private readonly db: BetterSqlite3.Database

  // Prepared statements
  private readonly stmtInsert: BetterSqlite3.Statement
  private readonly stmtFindByOid: BetterSqlite3.Statement
  private readonly stmtFindAll: BetterSqlite3.Statement
  private readonly stmtDelete: BetterSqlite3.Statement
  private readonly stmtFindByLocalId: BetterSqlite3.Statement
  private readonly stmtCount: BetterSqlite3.Statement

  constructor(db: BetterSqlite3.Database) {
    this.db = db

    this.stmtInsert = db.prepare(`
      INSERT INTO environments (
        oid, local_id, version, last_modified_date, description,
        schema_version, action_property_specifications,
        value_property_specifications, resource_property_specifications,
        imported_at, source_filename
      ) VALUES (
        @oid, @local_id, @version, @last_modified_date, @description,
        @schema_version, @action_property_specifications,
        @value_property_specifications, @resource_property_specifications,
        @imported_at, @source_filename
      )
    `)

    this.stmtFindByOid = db.prepare(`
      SELECT * FROM environments WHERE oid = ?
    `)

    this.stmtFindAll = db.prepare(`
      SELECT * FROM environments ORDER BY local_id ASC
    `)

    this.stmtDelete = db.prepare(`
      DELETE FROM environments WHERE oid = ?
    `)

    this.stmtFindByLocalId = db.prepare(`
      SELECT * FROM environments WHERE local_id = ?
    `)

    this.stmtCount = db.prepare(`
      SELECT COUNT(*) AS cnt FROM environments
    `)
  }

  private toRow(
    input: EnvironmentInput
  ): Omit<EnvironmentRow, 'imported_at'> & { imported_at: string } {
    return {
      oid: input.oid,
      local_id: input.local_id,
      version: input.version,
      last_modified_date: input.last_modified_date,
      description: input.description ?? null,
      schema_version: input.schema_version,
      action_property_specifications: JSON.stringify(input.action_property_specifications),
      value_property_specifications: JSON.stringify(input.value_property_specifications),
      resource_property_specifications: JSON.stringify(input.resource_property_specifications),
      imported_at: new Date().toISOString(),
      source_filename: input.source_filename,
    }
  }

  private fromRow(row: EnvironmentRow): Environment {
    return {
      oid: row.oid,
      local_id: row.local_id,
      version: row.version,
      last_modified_date: row.last_modified_date,
      description: row.description,
      schema_version: row.schema_version,
      action_property_specifications: JSON.parse(row.action_property_specifications) as unknown[],
      value_property_specifications: JSON.parse(row.value_property_specifications) as unknown[],
      resource_property_specifications: JSON.parse(
        row.resource_property_specifications
      ) as unknown[],
      imported_at: row.imported_at,
      source_filename: row.source_filename,
    }
  }

  create(input: EnvironmentInput): Environment {
    const row = this.toRow(input)
    this.stmtInsert.run(row)
    return this.fromRow(row as EnvironmentRow)
  }

  findByOid(oid: string): Environment | null {
    const row = this.stmtFindByOid.get(oid) as EnvironmentRow | undefined
    return row ? this.fromRow(row) : null
  }

  findAll(): Environment[] {
    const rows = this.stmtFindAll.all() as EnvironmentRow[]
    return rows.map((r) => this.fromRow(r))
  }

  update(oid: string, input: Partial<EnvironmentInput>): Environment | null {
    const existing = this.stmtFindByOid.get(oid) as EnvironmentRow | undefined
    if (!existing) return null

    // Build SET clause dynamically from provided fields
    const fields: string[] = []
    const values: unknown[] = []

    const fieldMap: Record<string, () => void> = {
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
      schema_version: () => {
        fields.push('schema_version = ?')
        values.push(input.schema_version)
      },
      action_property_specifications: () => {
        fields.push('action_property_specifications = ?')
        values.push(JSON.stringify(input.action_property_specifications))
      },
      value_property_specifications: () => {
        fields.push('value_property_specifications = ?')
        values.push(JSON.stringify(input.value_property_specifications))
      },
      resource_property_specifications: () => {
        fields.push('resource_property_specifications = ?')
        values.push(JSON.stringify(input.resource_property_specifications))
      },
      source_filename: () => {
        fields.push('source_filename = ?')
        values.push(input.source_filename)
      },
    }

    for (const key of Object.keys(input) as (keyof EnvironmentInput)[]) {
      if (key === 'oid') continue
      if (key in fieldMap) {
        fieldMap[key]()
      }
    }

    if (fields.length === 0) {
      return this.fromRow(existing)
    }

    values.push(oid)
    const stmt = this.db.prepare(`UPDATE environments SET ${fields.join(', ')} WHERE oid = ?`)
    stmt.run(...values)

    const updated = this.stmtFindByOid.get(oid) as EnvironmentRow
    return this.fromRow(updated)
  }

  delete(oid: string): boolean {
    const result = this.stmtDelete.run(oid)
    return result.changes > 0
  }

  findByLocalId(localId: string): Environment | null {
    const row = this.stmtFindByLocalId.get(localId) as EnvironmentRow | undefined
    return row ? this.fromRow(row) : null
  }

  count(): number {
    const result = this.stmtCount.get() as { cnt: number }
    return result.cnt
  }

  upsert(input: EnvironmentInput): { environment: Environment; created: boolean } {
    const existing = this.stmtFindByOid.get(input.oid) as EnvironmentRow | undefined

    if (!existing) {
      const environment = this.create(input)
      return { environment, created: true }
    }

    // Update all fields
    const updatedEnv = this.update(input.oid, input)
    return { environment: updatedEnv!, created: false }
  }
}
