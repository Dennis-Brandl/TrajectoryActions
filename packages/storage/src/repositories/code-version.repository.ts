import { randomUUID } from 'node:crypto'
import type BetterSqlite3 from 'better-sqlite3'
import type { CodeVersion, CodeVersionInput, CodeVersionRow } from '../types.js'

export class CodeVersionRepository {
  private readonly db: BetterSqlite3.Database

  // Prepared statements
  private readonly stmtInsert: BetterSqlite3.Statement
  private readonly stmtFindById: BetterSqlite3.Statement
  private readonly stmtGetActive: BetterSqlite3.Statement
  private readonly stmtGetVersionHistory: BetterSqlite3.Statement
  private readonly stmtFindByAction: BetterSqlite3.Statement
  private readonly stmtDeleteByAction: BetterSqlite3.Statement
  private readonly stmtDeleteByActionState: BetterSqlite3.Statement
  private readonly stmtGetLatestVersion: BetterSqlite3.Statement
  private readonly stmtGetAllActiveVersions: BetterSqlite3.Statement
  private readonly stmtCount: BetterSqlite3.Statement
  private readonly stmtCountByAction: BetterSqlite3.Statement
  private readonly stmtMaxVersionNumber: BetterSqlite3.Statement
  private readonly stmtDeactivateAll: BetterSqlite3.Statement
  private readonly stmtActivateOne: BetterSqlite3.Statement
  private readonly stmtDeactivateOne: BetterSqlite3.Statement

  constructor(db: BetterSqlite3.Database) {
    this.db = db

    this.stmtInsert = db.prepare(`
      INSERT INTO code_versions (
        id, action_oid, state, version_number, source_code,
        is_active, created_at, created_by, description
      ) VALUES (
        @id, @action_oid, @state, @version_number, @source_code,
        @is_active, @created_at, @created_by, @description
      )
    `)

    this.stmtFindById = db.prepare(`
      SELECT * FROM code_versions WHERE id = ?
    `)

    this.stmtGetActive = db.prepare(`
      SELECT * FROM code_versions
      WHERE action_oid = ? AND state = ? AND is_active = 1
      LIMIT 1
    `)

    this.stmtGetVersionHistory = db.prepare(`
      SELECT * FROM code_versions
      WHERE action_oid = ? AND state = ?
      ORDER BY version_number DESC
    `)

    this.stmtFindByAction = db.prepare(`
      SELECT * FROM code_versions
      WHERE action_oid = ?
      ORDER BY state ASC, version_number DESC
    `)

    this.stmtDeleteByAction = db.prepare(`
      DELETE FROM code_versions WHERE action_oid = ?
    `)

    this.stmtDeleteByActionState = db.prepare(`
      DELETE FROM code_versions WHERE action_oid = ? AND state = ?
    `)

    this.stmtGetLatestVersion = db.prepare(`
      SELECT * FROM code_versions
      WHERE action_oid = ? AND state = ?
      ORDER BY version_number DESC
      LIMIT 1
    `)

    this.stmtGetAllActiveVersions = db.prepare(`
      SELECT * FROM code_versions
      WHERE action_oid = ? AND is_active = 1
      ORDER BY state ASC
    `)

    this.stmtCount = db.prepare(`
      SELECT COUNT(*) AS cnt FROM code_versions
    `)

    this.stmtCountByAction = db.prepare(`
      SELECT COUNT(*) AS cnt FROM code_versions WHERE action_oid = ?
    `)

    this.stmtMaxVersionNumber = db.prepare(`
      SELECT MAX(version_number) AS max_ver
      FROM code_versions
      WHERE action_oid = ? AND state = ?
    `)

    this.stmtDeactivateAll = db.prepare(`
      UPDATE code_versions SET is_active = 0 WHERE action_oid = ? AND state = ?
    `)

    this.stmtActivateOne = db.prepare(`
      UPDATE code_versions SET is_active = 1 WHERE id = ?
    `)

    this.stmtDeactivateOne = db.prepare(`
      UPDATE code_versions SET is_active = 0 WHERE id = ?
    `)
  }

  private fromRow(row: CodeVersionRow): CodeVersion {
    return {
      id: row.id,
      action_oid: row.action_oid,
      state: row.state,
      version_number: row.version_number,
      source_code: row.source_code,
      is_active: row.is_active === 1,
      created_at: row.created_at,
      created_by: row.created_by,
      description: row.description,
    }
  }

  save(input: CodeVersionInput): CodeVersion {
    const id = randomUUID()
    const created_at = new Date().toISOString()

    // Auto-compute version_number: MAX for this action+state + 1 (start at 1)
    const maxRow = this.stmtMaxVersionNumber.get(input.action_oid, input.state) as {
      max_ver: number | null
    }
    const version_number = (maxRow.max_ver ?? 0) + 1

    const row = {
      id,
      action_oid: input.action_oid,
      state: input.state,
      version_number,
      source_code: input.source_code,
      is_active: 0,
      created_at,
      created_by: input.created_by ?? null,
      description: input.description ?? null,
    }

    this.stmtInsert.run(row)

    return this.fromRow(row as CodeVersionRow)
  }

  activate(id: string): CodeVersion | null {
    const activateTx = this.db.transaction(() => {
      const row = this.stmtFindById.get(id) as CodeVersionRow | undefined
      if (!row) return null

      // Deactivate all versions for the same action+state
      this.stmtDeactivateAll.run(row.action_oid, row.state)

      // Activate this version
      this.stmtActivateOne.run(id)

      // Return the updated row
      return this.stmtFindById.get(id) as CodeVersionRow
    })

    const result = activateTx() as CodeVersionRow | null
    return result ? this.fromRow(result) : null
  }

  deactivate(id: string): CodeVersion | null {
    const existing = this.stmtFindById.get(id) as CodeVersionRow | undefined
    if (!existing) return null

    this.stmtDeactivateOne.run(id)
    const updated = this.stmtFindById.get(id) as CodeVersionRow
    return this.fromRow(updated)
  }

  getActive(actionOid: string, state: string): CodeVersion | null {
    const row = this.stmtGetActive.get(actionOid, state) as CodeVersionRow | undefined
    return row ? this.fromRow(row) : null
  }

  getVersionHistory(actionOid: string, state: string): CodeVersion[] {
    const rows = this.stmtGetVersionHistory.all(actionOid, state) as CodeVersionRow[]
    return rows.map((r) => this.fromRow(r))
  }

  findById(id: string): CodeVersion | null {
    const row = this.stmtFindById.get(id) as CodeVersionRow | undefined
    return row ? this.fromRow(row) : null
  }

  findByAction(actionOid: string): CodeVersion[] {
    const rows = this.stmtFindByAction.all(actionOid) as CodeVersionRow[]
    return rows.map((r) => this.fromRow(r))
  }

  deleteByAction(actionOid: string): number {
    const result = this.stmtDeleteByAction.run(actionOid)
    return result.changes
  }

  clearByActionAndState(actionOid: string, state: string): number {
    const result = this.stmtDeleteByActionState.run(actionOid, state)
    return result.changes
  }

  getLatestVersion(actionOid: string, state: string): CodeVersion | null {
    const row = this.stmtGetLatestVersion.get(actionOid, state) as CodeVersionRow | undefined
    return row ? this.fromRow(row) : null
  }

  saveAndActivate(input: CodeVersionInput): CodeVersion {
    const saveAndActivateTx = this.db.transaction(() => {
      const saved = this.save(input)

      // Deactivate all versions for same action+state
      this.stmtDeactivateAll.run(saved.action_oid, saved.state)

      // Activate this new version
      this.stmtActivateOne.run(saved.id)

      return this.stmtFindById.get(saved.id) as CodeVersionRow
    })

    const row = saveAndActivateTx() as CodeVersionRow
    return this.fromRow(row)
  }

  getAllActiveVersions(actionOid: string): CodeVersion[] {
    const rows = this.stmtGetAllActiveVersions.all(actionOid) as CodeVersionRow[]
    return rows.map((r) => this.fromRow(r))
  }

  count(): number {
    const result = this.stmtCount.get() as { cnt: number }
    return result.cnt
  }

  countByAction(actionOid: string): number {
    const result = this.stmtCountByAction.get(actionOid) as { cnt: number }
    return result.cnt
  }
}
