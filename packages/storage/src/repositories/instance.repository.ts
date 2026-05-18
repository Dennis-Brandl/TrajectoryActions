import { randomUUID } from 'crypto'
import type BetterSqlite3 from 'better-sqlite3'
import type { Instance, InstanceInput, InstanceRow } from '../types.js'

export class InstanceRepository {
  private readonly db: BetterSqlite3.Database

  // Prepared statements
  private readonly stmtInsert: BetterSqlite3.Statement
  private readonly stmtFindById: BetterSqlite3.Statement
  private readonly stmtFindByStatus: BetterSqlite3.Statement
  private readonly stmtFindActive: BetterSqlite3.Statement
  private readonly stmtFindByAction: BetterSqlite3.Statement
  private readonly stmtFindByWorkflow: BetterSqlite3.Statement
  private readonly stmtMarkLogged: BetterSqlite3.Statement
  private readonly stmtDeleteByEnvironment: BetterSqlite3.Statement
  private readonly stmtCount: BetterSqlite3.Statement
  private readonly stmtCountActive: BetterSqlite3.Statement

  constructor(db: BetterSqlite3.Database) {
    this.db = db

    this.stmtInsert = db.prepare(`
      INSERT INTO instances (
        runtime_action_instance_id, action_oid, environment_oid,
        workflow_instance_id, step_instance_id, step_oid,
        visibility, state,
        input_parameters, output_parameters, state_history,
        pinned_code_versions, states_with_code_executed,
        created_at, started_at, completed_at, error, traceback, is_logged
      ) VALUES (
        @runtime_action_instance_id, @action_oid, @environment_oid,
        @workflow_instance_id, @step_instance_id, @step_oid,
        @visibility, @state,
        @input_parameters, @output_parameters, @state_history,
        @pinned_code_versions, @states_with_code_executed,
        @created_at, @started_at, @completed_at, @error, @traceback, @is_logged
      )
    `)

    this.stmtFindById = db.prepare(`
      SELECT * FROM instances WHERE runtime_action_instance_id = ?
    `)

    this.stmtFindByStatus = db.prepare(`
      SELECT * FROM instances WHERE state = ? ORDER BY created_at DESC
    `)

    this.stmtFindActive = db.prepare(`
      SELECT * FROM instances WHERE completed_at IS NULL ORDER BY created_at DESC
    `)

    this.stmtFindByAction = db.prepare(`
      SELECT * FROM instances WHERE action_oid = ? ORDER BY created_at DESC
    `)

    this.stmtFindByWorkflow = db.prepare(`
      SELECT * FROM instances WHERE workflow_instance_id = ?
    `)

    this.stmtMarkLogged = db.prepare(`
      UPDATE instances SET is_logged = 1
      WHERE runtime_action_instance_id = ? AND is_logged = 0
    `)

    this.stmtDeleteByEnvironment = db.prepare(`
      DELETE FROM instances WHERE environment_oid = ?
    `)

    this.stmtCount = db.prepare(`
      SELECT COUNT(*) AS cnt FROM instances
    `)

    this.stmtCountActive = db.prepare(`
      SELECT COUNT(*) AS cnt FROM instances WHERE completed_at IS NULL
    `)
  }

  private fromRow(row: InstanceRow): Instance {
    return {
      runtime_action_instance_id: row.runtime_action_instance_id,
      action_oid: row.action_oid,
      environment_oid: row.environment_oid,
      workflow_instance_id: row.workflow_instance_id,
      step_instance_id: row.step_instance_id,
      step_oid: row.step_oid,
      visibility: row.visibility,
      state: row.state,
      input_parameters: JSON.parse(row.input_parameters) as unknown[],
      output_parameters: JSON.parse(row.output_parameters) as unknown[],
      state_history: JSON.parse(row.state_history) as unknown[],
      pinned_code_versions: JSON.parse(row.pinned_code_versions) as unknown[],
      states_with_code_executed: JSON.parse(row.states_with_code_executed) as unknown[],
      created_at: row.created_at,
      started_at: row.started_at,
      completed_at: row.completed_at,
      error: row.error,
      traceback: row.traceback,
      is_logged: row.is_logged === 1,
    }
  }

  create(input: InstanceInput): Instance {
    const created_at = new Date().toISOString()
    const initialHistory = JSON.stringify([{ state: input.state, timestamp: created_at }])

    const row: InstanceRow = {
      runtime_action_instance_id: randomUUID(),
      action_oid: input.action_oid,
      environment_oid: input.environment_oid,
      workflow_instance_id: input.workflow_instance_id,
      step_instance_id: input.step_instance_id,
      step_oid: input.step_oid,
      visibility: input.visibility,
      state: input.state,
      input_parameters: JSON.stringify(input.input_parameters),
      output_parameters: JSON.stringify(input.output_parameters),
      state_history: initialHistory,
      pinned_code_versions: JSON.stringify(input.pinned_code_versions),
      states_with_code_executed: JSON.stringify(input.states_with_code_executed),
      created_at,
      started_at: null,
      completed_at: null,
      error: null,
      traceback: null,
      is_logged: 0,
    }

    this.stmtInsert.run(row)
    return this.fromRow(row)
  }

  findById(id: string): Instance | null {
    const row = this.stmtFindById.get(id) as InstanceRow | undefined
    return row ? this.fromRow(row) : null
  }

  updateState(
    id: string,
    newState: string,
    updates?: {
      started_at?: string
      completed_at?: string
      error?: string | null
      traceback?: string | null
    }
  ): Instance | null {
    const doUpdate = this.db.transaction((): Instance | null => {
      const existing = this.stmtFindById.get(id) as InstanceRow | undefined
      if (!existing) return null

      const currentHistory = JSON.parse(existing.state_history) as unknown[]
      const newHistoryEntry = { state: newState, timestamp: new Date().toISOString() }
      const newHistory = JSON.stringify([...currentHistory, newHistoryEntry])

      const fields: string[] = ['state = ?', 'state_history = ?']
      const values: unknown[] = [newState, newHistory]

      if (updates?.started_at !== undefined) {
        fields.push('started_at = ?')
        values.push(updates.started_at)
      }
      if (updates?.completed_at !== undefined) {
        fields.push('completed_at = ?')
        values.push(updates.completed_at)
      }
      if (updates?.error !== undefined) {
        fields.push('error = ?')
        values.push(updates.error)
      }
      if (updates?.traceback !== undefined) {
        fields.push('traceback = ?')
        values.push(updates.traceback)
      }

      values.push(id)
      this.db
        .prepare(`UPDATE instances SET ${fields.join(', ')} WHERE runtime_action_instance_id = ?`)
        .run(...values)

      const updated = this.stmtFindById.get(id) as InstanceRow
      return this.fromRow(updated)
    })

    return doUpdate()
  }

  updateOutputParameters(id: string, outputParameters: unknown[]): Instance | null {
    const result = this.db
      .prepare(`UPDATE instances SET output_parameters = ? WHERE runtime_action_instance_id = ?`)
      .run(JSON.stringify(outputParameters), id)

    if (result.changes === 0) return null
    const row = this.stmtFindById.get(id) as InstanceRow
    return this.fromRow(row)
  }

  markStatesWithCodeExecuted(id: string, states: string[]): Instance | null {
    const result = this.db
      .prepare(
        `UPDATE instances SET states_with_code_executed = ? WHERE runtime_action_instance_id = ?`
      )
      .run(JSON.stringify(states), id)

    if (result.changes === 0) return null
    const row = this.stmtFindById.get(id) as InstanceRow
    return this.fromRow(row)
  }

  markLogged(id: string): boolean {
    const result = this.stmtMarkLogged.run(id)
    return result.changes > 0
  }

  findByStatus(state: string): Instance[] {
    const rows = this.stmtFindByStatus.all(state) as InstanceRow[]
    return rows.map((r) => this.fromRow(r))
  }

  findActive(): Instance[] {
    const rows = this.stmtFindActive.all() as InstanceRow[]
    return rows.map((r) => this.fromRow(r))
  }

  findByAction(actionOid: string): Instance[] {
    const rows = this.stmtFindByAction.all(actionOid) as InstanceRow[]
    return rows.map((r) => this.fromRow(r))
  }

  findByWorkflow(workflowInstanceId: string): Instance[] {
    const rows = this.stmtFindByWorkflow.all(workflowInstanceId) as InstanceRow[]
    return rows.map((r) => this.fromRow(r))
  }

  deleteByEnvironment(environmentOid: string): number {
    const result = this.stmtDeleteByEnvironment.run(environmentOid)
    return result.changes
  }

  cleanup(retentionHours: number): number {
    const threshold = new Date(Date.now() - retentionHours * 3600000).toISOString()
    const result = this.db
      .prepare(
        `DELETE FROM instances
         WHERE completed_at IS NOT NULL
           AND is_logged = 1
           AND completed_at < ?`
      )
      .run(threshold)
    return result.changes
  }

  count(): number {
    const result = this.stmtCount.get() as { cnt: number }
    return result.cnt
  }

  countActive(): number {
    const result = this.stmtCountActive.get() as { cnt: number }
    return result.cnt
  }

  findAll(limit?: number, offset?: number): Instance[] {
    let sql = `SELECT * FROM instances ORDER BY created_at DESC`
    const params: unknown[] = []

    if (limit !== undefined) {
      sql += ` LIMIT ?`
      params.push(limit)
      if (offset !== undefined) {
        sql += ` OFFSET ?`
        params.push(offset)
      }
    }

    const rows = this.db.prepare(sql).all(...params) as InstanceRow[]
    return rows.map((r) => this.fromRow(r))
  }
}
