import type BetterSqlite3 from 'better-sqlite3'
import type {
  ExecutionLogEntry,
  ExecutionLogInput,
  ExecutionLogRow,
  FinalStatus,
} from '../types.js'

// ---------------------------------------------------------------------------
// Query filter types
// ---------------------------------------------------------------------------

export interface LogQueryFilters {
  actionOid?: string
  actionName?: string
  environmentOid?: string
  environmentName?: string
  finalStatus?: FinalStatus
  startDate?: string
  endDate?: string
  limit?: number
  offset?: number
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

export class LogRepository {
  private readonly db: BetterSqlite3.Database

  // Prepared statements for fixed queries
  private readonly stmtInsert: BetterSqlite3.Statement
  private readonly stmtFindById: BetterSqlite3.Statement
  private readonly stmtCount: BetterSqlite3.Statement
  private readonly stmtCountAll: BetterSqlite3.Statement
  private readonly stmtDeleteAll: BetterSqlite3.Statement
  private readonly stmtGetRecent: BetterSqlite3.Statement

  constructor(db: BetterSqlite3.Database) {
    this.db = db

    this.stmtInsert = db.prepare(`
      INSERT INTO execution_log (
        runtime_action_instance_id, action_oid, action_name,
        environment_oid, environment_name, workflow_instance_id, step_oid,
        input_parameters, output_parameters, states_executed, code_versions_used,
        started_at, completed_at, duration_ms, final_status, error
      ) VALUES (
        @runtime_action_instance_id, @action_oid, @action_name,
        @environment_oid, @environment_name, @workflow_instance_id, @step_oid,
        @input_parameters, @output_parameters, @states_executed, @code_versions_used,
        @started_at, @completed_at, @duration_ms, @final_status, @error
      )
    `)

    this.stmtFindById = db.prepare(`
      SELECT * FROM execution_log WHERE id = ?
    `)

    this.stmtCount = db.prepare(`
      SELECT COUNT(*) AS cnt FROM execution_log
    `)

    // Alias for internal use in trimming
    this.stmtCountAll = db.prepare(`
      SELECT COUNT(*) AS cnt FROM execution_log
    `)

    this.stmtDeleteAll = db.prepare(`
      DELETE FROM execution_log
    `)

    this.stmtGetRecent = db.prepare(`
      SELECT * FROM execution_log ORDER BY id DESC LIMIT ?
    `)
  }

  private fromRow(row: ExecutionLogRow): ExecutionLogEntry {
    return {
      id: row.id,
      runtime_action_instance_id: row.runtime_action_instance_id,
      action_oid: row.action_oid,
      action_name: row.action_name,
      environment_oid: row.environment_oid,
      environment_name: row.environment_name,
      workflow_instance_id: row.workflow_instance_id,
      step_oid: row.step_oid,
      input_parameters: JSON.parse(row.input_parameters) as unknown[],
      output_parameters: JSON.parse(row.output_parameters) as unknown[],
      states_executed: JSON.parse(row.states_executed) as unknown[],
      code_versions_used: JSON.parse(row.code_versions_used) as Record<string, unknown>,
      started_at: row.started_at,
      completed_at: row.completed_at,
      duration_ms: row.duration_ms,
      final_status: row.final_status,
      error: row.error,
    }
  }

  private toRow(input: ExecutionLogInput): Omit<ExecutionLogRow, 'id'> {
    return {
      runtime_action_instance_id: input.runtime_action_instance_id,
      action_oid: input.action_oid,
      action_name: input.action_name,
      environment_oid: input.environment_oid,
      environment_name: input.environment_name,
      workflow_instance_id: input.workflow_instance_id,
      step_oid: input.step_oid,
      input_parameters: JSON.stringify(input.input_parameters),
      output_parameters: JSON.stringify(input.output_parameters),
      states_executed: JSON.stringify(input.states_executed),
      code_versions_used: JSON.stringify(input.code_versions_used),
      started_at: input.started_at,
      completed_at: input.completed_at,
      duration_ms: input.duration_ms,
      final_status: input.final_status,
      error: input.error ?? null,
    }
  }

  /**
   * Insert a log entry and trim to maxSize in a single transaction.
   * Returns the created entry.
   */
  insert(input: ExecutionLogInput, maxSize: number): ExecutionLogEntry {
    const doInsert = this.db.transaction((): ExecutionLogEntry => {
      // INSERT
      const row = this.toRow(input)
      const result = this.stmtInsert.run(row)
      const insertedId = result.lastInsertRowid as number

      // Trim: count current entries
      const countResult = this.stmtCountAll.get() as { cnt: number }
      const currentCount = countResult.cnt

      if (currentCount > maxSize) {
        const excess = currentCount - maxSize
        this.db
          .prepare(
            `DELETE FROM execution_log
             WHERE id IN (
               SELECT id FROM execution_log ORDER BY id ASC LIMIT ?
             )`
          )
          .run(excess)
      }

      // Return the entry we just inserted (may have been trimmed if maxSize = 0, but that's edge case)
      const inserted = this.stmtFindById.get(insertedId) as ExecutionLogRow | undefined
      if (!inserted) {
        // Entry was trimmed away (maxSize 0 edge case) — reconstruct from input
        const reconstructed: ExecutionLogRow = { id: insertedId as number, ...row }
        return this.fromRow(reconstructed)
      }
      return this.fromRow(inserted)
    })

    return doInsert()
  }

  findById(id: number): ExecutionLogEntry | null {
    const row = this.stmtFindById.get(id) as ExecutionLogRow | undefined
    return row ? this.fromRow(row) : null
  }

  /**
   * Dynamic query with optional filters and pagination.
   * Returns { entries, total } for pagination support.
   */
  query(filters: LogQueryFilters): { entries: ExecutionLogEntry[]; total: number } {
    const whereClauses: string[] = []
    const params: unknown[] = []

    if (filters.actionOid !== undefined) {
      whereClauses.push('action_oid = ?')
      params.push(filters.actionOid)
    }
    if (filters.actionName !== undefined) {
      whereClauses.push('action_name LIKE ?')
      params.push(`%${filters.actionName}%`)
    }
    if (filters.environmentOid !== undefined) {
      whereClauses.push('environment_oid = ?')
      params.push(filters.environmentOid)
    }
    if (filters.environmentName !== undefined) {
      whereClauses.push('environment_name LIKE ?')
      params.push(`%${filters.environmentName}%`)
    }
    if (filters.finalStatus !== undefined) {
      whereClauses.push('final_status = ?')
      params.push(filters.finalStatus)
    }
    if (filters.startDate !== undefined) {
      whereClauses.push('completed_at >= ?')
      params.push(filters.startDate)
    }
    if (filters.endDate !== undefined) {
      whereClauses.push('completed_at <= ?')
      params.push(filters.endDate)
    }

    const whereClause = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : ''

    // Count query (no LIMIT/OFFSET)
    const countSql = `SELECT COUNT(*) AS cnt FROM execution_log ${whereClause}`
    const countResult = this.db.prepare(countSql).get(...params) as { cnt: number }
    const total = countResult.cnt

    // Paginated query
    const limit = Math.min(filters.limit ?? 50, 500)
    const offset = filters.offset ?? 0
    const rowSql = `
      SELECT * FROM execution_log
      ${whereClause}
      ORDER BY id DESC
      LIMIT ?
      OFFSET ?
    `
    const rowParams = [...params, limit, offset]
    const rows = this.db.prepare(rowSql).all(...rowParams) as ExecutionLogRow[]
    const entries = rows.map((r) => this.fromRow(r))

    return { entries, total }
  }

  /**
   * Trim the log to maxSize entries (keeps the most recent).
   * Returns the number of deleted entries.
   */
  trimToSize(maxSize: number): number {
    const doTrim = this.db.transaction((): number => {
      const countResult = this.stmtCountAll.get() as { cnt: number }
      const currentCount = countResult.cnt

      if (currentCount <= maxSize) return 0

      const excess = currentCount - maxSize
      const result = this.db
        .prepare(
          `DELETE FROM execution_log
           WHERE id IN (
             SELECT id FROM execution_log ORDER BY id ASC LIMIT ?
           )`
        )
        .run(excess)
      return result.changes
    })

    return doTrim()
  }

  count(): number {
    const result = this.stmtCount.get() as { cnt: number }
    return result.cnt
  }

  getRecent(limit: number): ExecutionLogEntry[] {
    const rows = this.stmtGetRecent.all(limit) as ExecutionLogRow[]
    return rows.map((r) => this.fromRow(r))
  }

  deleteAll(): number {
    const result = this.stmtDeleteAll.run()
    return result.changes
  }
}
