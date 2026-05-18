import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type BetterSqlite3 from 'better-sqlite3'
import { openDatabase } from '../database.js'
import { runMigrations } from '../migrations/runner.js'
import { migration as initialMigration } from '../migrations/001-initial-schema.js'
import { InstanceRepository } from '../repositories/instance.repository.js'
import type { InstanceInput } from '../types.js'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function setupDb(): BetterSqlite3.Database {
  const db = openDatabase(':memory:')
  runMigrations(db, [initialMigration])

  // Seed a test environment and action so FK constraints are satisfied
  db.prepare(
    `INSERT INTO environments (oid, local_id, version, last_modified_date, schema_version, imported_at, source_filename)
     VALUES ('env-test', 'TestEnv', '1.0', '2026-01-01T00:00:00Z', '4.0', '2026-01-01T00:00:00Z', 'test.WFenvir')`
  ).run()

  db.prepare(
    `INSERT INTO actions (oid, environment_oid, local_id, version, last_modified_date, action_visibility)
     VALUES ('act-test', 'env-test', 'TestAction', '1.0', '2026-01-01T00:00:00Z', 'opaque')`
  ).run()

  return db
}

function makeInput(overrides: Partial<InstanceInput> = {}): InstanceInput {
  return {
    runtime_action_instance_id: 'ignored-will-be-replaced',
    action_oid: 'act-test',
    environment_oid: 'env-test',
    workflow_instance_id: 'wf-001',
    step_instance_id: 'step-inst-001',
    step_oid: 'step-001',
    visibility: 'opaque',
    state: 'IDLE',
    input_parameters: [{ name: 'x', value: 42 }],
    output_parameters: [],
    state_history: [],
    pinned_code_versions: [],
    states_with_code_executed: [],
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('InstanceRepository', () => {
  let db: BetterSqlite3.Database
  let repo: InstanceRepository

  beforeEach(() => {
    db = setupDb()
    repo = new InstanceRepository(db)
  })

  afterEach(() => {
    db.close()
  })

  // -------------------------------------------------------------------------
  // create
  // -------------------------------------------------------------------------

  describe('create', () => {
    it('generates a UUID for runtime_action_instance_id', () => {
      const instance = repo.create(makeInput())
      expect(instance.runtime_action_instance_id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      )
    })

    it('ignores the input runtime_action_instance_id and generates a new one', () => {
      const instance = repo.create(makeInput({ runtime_action_instance_id: 'my-custom-id' }))
      expect(instance.runtime_action_instance_id).not.toBe('my-custom-id')
    })

    it('sets created_at to an ISO 8601 string', () => {
      const before = new Date().toISOString()
      const instance = repo.create(makeInput())
      const after = new Date().toISOString()
      expect(instance.created_at >= before).toBe(true)
      expect(instance.created_at <= after).toBe(true)
    })

    it('initializes state_history with the initial state', () => {
      const instance = repo.create(makeInput({ state: 'IDLE' }))
      expect(Array.isArray(instance.state_history)).toBe(true)
      expect(instance.state_history).toHaveLength(1)
      const entry = instance.state_history[0] as { state: string; timestamp: string }
      expect(entry.state).toBe('IDLE')
      expect(entry.timestamp).toBeDefined()
    })

    it('sets is_logged to false', () => {
      const instance = repo.create(makeInput())
      expect(instance.is_logged).toBe(false)
    })

    it('sets started_at, completed_at, error to null', () => {
      const instance = repo.create(makeInput())
      expect(instance.started_at).toBeNull()
      expect(instance.completed_at).toBeNull()
      expect(instance.error).toBeNull()
    })

    it('round-trips input_parameters as JSON array', () => {
      const params = [
        { name: 'temp', value: 100 },
        { name: 'pressure', value: 2.5 },
      ]
      const instance = repo.create(makeInput({ input_parameters: params }))
      expect(instance.input_parameters).toEqual(params)
    })

    it('stores the initial state', () => {
      const instance = repo.create(makeInput({ state: 'EXECUTING' }))
      expect(instance.state).toBe('EXECUTING')
    })
  })

  // -------------------------------------------------------------------------
  // findById
  // -------------------------------------------------------------------------

  describe('findById', () => {
    it('finds an existing instance', () => {
      const created = repo.create(makeInput())
      const found = repo.findById(created.runtime_action_instance_id)
      expect(found).not.toBeNull()
      expect(found!.runtime_action_instance_id).toBe(created.runtime_action_instance_id)
    })

    it('returns null for a nonexistent id', () => {
      const found = repo.findById('nonexistent-uuid')
      expect(found).toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // updateState
  // -------------------------------------------------------------------------

  describe('updateState', () => {
    it('changes the state', () => {
      const instance = repo.create(makeInput({ state: 'IDLE' }))
      const updated = repo.updateState(instance.runtime_action_instance_id, 'EXECUTING')
      expect(updated!.state).toBe('EXECUTING')
    })

    it('appends to state_history', () => {
      const instance = repo.create(makeInput({ state: 'IDLE' }))
      const updated = repo.updateState(instance.runtime_action_instance_id, 'EXECUTING')
      expect(updated!.state_history).toHaveLength(2)
      const last = updated!.state_history[1] as { state: string; timestamp: string }
      expect(last.state).toBe('EXECUTING')
    })

    it('sets started_at when provided', () => {
      const instance = repo.create(makeInput())
      const started = new Date().toISOString()
      const updated = repo.updateState(instance.runtime_action_instance_id, 'EXECUTING', {
        started_at: started,
      })
      expect(updated!.started_at).toBe(started)
    })

    it('sets completed_at when provided', () => {
      const instance = repo.create(makeInput())
      const completed = new Date().toISOString()
      const updated = repo.updateState(instance.runtime_action_instance_id, 'COMPLETE', {
        completed_at: completed,
      })
      expect(updated!.completed_at).toBe(completed)
    })

    it('sets error when provided', () => {
      const instance = repo.create(makeInput())
      const updated = repo.updateState(instance.runtime_action_instance_id, 'ABORTED', {
        error: 'Something went wrong',
      })
      expect(updated!.error).toBe('Something went wrong')
    })

    it('clears error when set to null', () => {
      const instance = repo.create(makeInput())
      // First set an error
      repo.updateState(instance.runtime_action_instance_id, 'ABORTED', { error: 'oops' })
      // Then clear it
      const updated = repo.updateState(instance.runtime_action_instance_id, 'IDLE', {
        error: null,
      })
      expect(updated!.error).toBeNull()
    })

    it('returns null for nonexistent id', () => {
      const result = repo.updateState('no-such-id', 'EXECUTING')
      expect(result).toBeNull()
    })

    it('accumulates multiple state transitions in history', () => {
      const instance = repo.create(makeInput({ state: 'IDLE' }))
      const id = instance.runtime_action_instance_id
      repo.updateState(id, 'EXECUTING')
      repo.updateState(id, 'COMPLETING')
      const final = repo.updateState(id, 'COMPLETE')
      expect(final!.state_history).toHaveLength(4) // IDLE + EXECUTING + COMPLETING + COMPLETE
    })
  })

  // -------------------------------------------------------------------------
  // updateOutputParameters
  // -------------------------------------------------------------------------

  describe('updateOutputParameters', () => {
    it('updates output_parameters with JSON round-trip', () => {
      const instance = repo.create(makeInput())
      const outputs = [{ name: 'result', value: 'done' }]
      const updated = repo.updateOutputParameters(instance.runtime_action_instance_id, outputs)
      expect(updated!.output_parameters).toEqual(outputs)
    })

    it('returns null for nonexistent id', () => {
      const result = repo.updateOutputParameters('no-such-id', [])
      expect(result).toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // markStatesWithCodeExecuted
  // -------------------------------------------------------------------------

  describe('markStatesWithCodeExecuted', () => {
    it('updates states_with_code_executed', () => {
      const instance = repo.create(makeInput())
      const updated = repo.markStatesWithCodeExecuted(instance.runtime_action_instance_id, [
        'EXECUTING',
        'COMPLETING',
      ])
      expect(updated!.states_with_code_executed).toEqual(['EXECUTING', 'COMPLETING'])
    })

    it('returns null for nonexistent id', () => {
      const result = repo.markStatesWithCodeExecuted('no-such-id', [])
      expect(result).toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // markLogged
  // -------------------------------------------------------------------------

  describe('markLogged', () => {
    it('sets is_logged to true and returns true', () => {
      const instance = repo.create(makeInput())
      const result = repo.markLogged(instance.runtime_action_instance_id)
      expect(result).toBe(true)

      const updated = repo.findById(instance.runtime_action_instance_id)
      expect(updated!.is_logged).toBe(true)
    })

    it('returns false if already logged (no second change)', () => {
      const instance = repo.create(makeInput())
      repo.markLogged(instance.runtime_action_instance_id)
      const result = repo.markLogged(instance.runtime_action_instance_id)
      expect(result).toBe(false)
    })

    it('returns false for nonexistent id', () => {
      const result = repo.markLogged('no-such-id')
      expect(result).toBe(false)
    })
  })

  // -------------------------------------------------------------------------
  // findByStatus
  // -------------------------------------------------------------------------

  describe('findByStatus', () => {
    it('returns only instances with matching state', () => {
      repo.create(makeInput({ state: 'IDLE' }))
      repo.create(makeInput({ state: 'IDLE' }))
      repo.create(makeInput({ state: 'EXECUTING' }))

      const idleInstances = repo.findByStatus('IDLE')
      expect(idleInstances).toHaveLength(2)
      for (const inst of idleInstances) {
        expect(inst.state).toBe('IDLE')
      }
    })

    it('returns empty array when no match', () => {
      repo.create(makeInput({ state: 'IDLE' }))
      const result = repo.findByStatus('COMPLETE')
      expect(result).toHaveLength(0)
    })
  })

  // -------------------------------------------------------------------------
  // findActive
  // -------------------------------------------------------------------------

  describe('findActive', () => {
    it('returns instances with no completed_at', () => {
      const a = repo.create(makeInput({ state: 'IDLE' }))
      const b = repo.create(makeInput({ state: 'EXECUTING' }))
      // Complete one of them
      repo.updateState(a.runtime_action_instance_id, 'COMPLETE', {
        completed_at: new Date().toISOString(),
      })

      const active = repo.findActive()
      const ids = active.map((i) => i.runtime_action_instance_id)
      expect(ids).not.toContain(a.runtime_action_instance_id)
      expect(ids).toContain(b.runtime_action_instance_id)
    })
  })

  // -------------------------------------------------------------------------
  // findByAction
  // -------------------------------------------------------------------------

  describe('findByAction', () => {
    it('returns only instances for the given action_oid', () => {
      // Add a second action
      db.prepare(
        `INSERT INTO actions (oid, environment_oid, local_id, version, last_modified_date, action_visibility)
         VALUES ('act-other', 'env-test', 'OtherAction', '1.0', '2026-01-01T00:00:00Z', 'opaque')`
      ).run()

      repo.create(makeInput({ action_oid: 'act-test' }))
      repo.create(makeInput({ action_oid: 'act-test' }))
      repo.create(makeInput({ action_oid: 'act-other' }))

      const results = repo.findByAction('act-test')
      expect(results).toHaveLength(2)
      for (const inst of results) {
        expect(inst.action_oid).toBe('act-test')
      }
    })
  })

  // -------------------------------------------------------------------------
  // findByWorkflow
  // -------------------------------------------------------------------------

  describe('findByWorkflow', () => {
    it('returns only instances for the given workflow_instance_id', () => {
      repo.create(makeInput({ workflow_instance_id: 'wf-A' }))
      repo.create(makeInput({ workflow_instance_id: 'wf-A' }))
      repo.create(makeInput({ workflow_instance_id: 'wf-B' }))

      const results = repo.findByWorkflow('wf-A')
      expect(results).toHaveLength(2)
      for (const inst of results) {
        expect(inst.workflow_instance_id).toBe('wf-A')
      }
    })
  })

  // -------------------------------------------------------------------------
  // cleanup
  // -------------------------------------------------------------------------

  describe('cleanup', () => {
    it('removes completed + logged instances past retention period', () => {
      const instance = repo.create(makeInput())
      const id = instance.runtime_action_instance_id

      // Set completed_at to 2 hours ago
      const twoHoursAgo = new Date(Date.now() - 2 * 3600000).toISOString()
      repo.updateState(id, 'COMPLETE', { completed_at: twoHoursAgo })
      repo.markLogged(id)

      // 1-hour retention — instance completed 2 hours ago should be deleted
      const deleted = repo.cleanup(1)
      expect(deleted).toBe(1)
      expect(repo.findById(id)).toBeNull()
    })

    it('does NOT remove an instance within retention period', () => {
      const instance = repo.create(makeInput())
      const id = instance.runtime_action_instance_id

      // Completed 1 hour ago but retention is 24 hours
      const oneHourAgo = new Date(Date.now() - 1 * 3600000).toISOString()
      repo.updateState(id, 'COMPLETE', { completed_at: oneHourAgo })
      repo.markLogged(id)

      const deleted = repo.cleanup(24) // 24-hour retention
      expect(deleted).toBe(0)
      expect(repo.findById(id)).not.toBeNull()
    })

    it('does NOT remove completed but unlogged instances', () => {
      const instance = repo.create(makeInput())
      const id = instance.runtime_action_instance_id

      // Completed 2 hours ago but NOT logged
      const twoHoursAgo = new Date(Date.now() - 2 * 3600000).toISOString()
      repo.updateState(id, 'COMPLETE', { completed_at: twoHoursAgo })
      // Do NOT call markLogged

      const deleted = repo.cleanup(1)
      expect(deleted).toBe(0)
      expect(repo.findById(id)).not.toBeNull()
    })

    it('does NOT remove active (non-completed) instances', () => {
      const instance = repo.create(makeInput({ state: 'EXECUTING' }))
      const id = instance.runtime_action_instance_id
      repo.markLogged(id)

      const deleted = repo.cleanup(0) // retention = 0 hours — would catch everything completed
      expect(deleted).toBe(0)
      expect(repo.findById(id)).not.toBeNull()
    })

    it('returns 0 when nothing to clean up', () => {
      repo.create(makeInput({ state: 'IDLE' }))
      const deleted = repo.cleanup(1)
      expect(deleted).toBe(0)
    })
  })

  // -------------------------------------------------------------------------
  // deleteByEnvironment
  // -------------------------------------------------------------------------

  describe('deleteByEnvironment', () => {
    it('deletes all instances for the given environment regardless of terminal state', () => {
      // Two terminal instances + one active, all under env-test
      const terminal1 = repo.create(makeInput())
      repo.updateState(terminal1.runtime_action_instance_id, 'COMPLETE', {
        completed_at: new Date().toISOString(),
      })
      const terminal2 = repo.create(makeInput())
      repo.updateState(terminal2.runtime_action_instance_id, 'ABORTED', {
        completed_at: new Date().toISOString(),
      })
      repo.create(makeInput({ state: 'EXECUTING' })) // still active

      const removed = repo.deleteByEnvironment('env-test')
      expect(removed).toBe(3)
      expect(repo.count()).toBe(0)
    })

    it('leaves instances belonging to other environments untouched', () => {
      // Seed a second environment + action so we can create instances against it
      db.prepare(
        `INSERT INTO environments (oid, local_id, version, last_modified_date, schema_version, imported_at, source_filename)
         VALUES ('env-other', 'OtherEnv', '1.0', '2026-01-01T00:00:00Z', '4.0', '2026-01-01T00:00:00Z', 'other.WFenvir')`
      ).run()
      db.prepare(
        `INSERT INTO actions (oid, environment_oid, local_id, version, last_modified_date, action_visibility)
         VALUES ('act-other', 'env-other', 'OtherAction', '1.0', '2026-01-01T00:00:00Z', 'opaque')`
      ).run()

      repo.create(makeInput()) // env-test
      const survivor = repo.create(
        makeInput({ action_oid: 'act-other', environment_oid: 'env-other' })
      )

      const removed = repo.deleteByEnvironment('env-test')
      expect(removed).toBe(1)
      expect(repo.findById(survivor.runtime_action_instance_id)).not.toBeNull()
      expect(repo.count()).toBe(1)
    })

    it('returns 0 when the environment has no instances', () => {
      expect(repo.deleteByEnvironment('env-test')).toBe(0)
    })
  })

  // -------------------------------------------------------------------------
  // count and countActive
  // -------------------------------------------------------------------------

  describe('count', () => {
    it('returns 0 when empty', () => {
      expect(repo.count()).toBe(0)
    })

    it('returns total instance count', () => {
      repo.create(makeInput())
      repo.create(makeInput())
      expect(repo.count()).toBe(2)
    })
  })

  describe('countActive', () => {
    it('returns only non-completed instances', () => {
      const a = repo.create(makeInput())
      repo.create(makeInput()) // stays active

      repo.updateState(a.runtime_action_instance_id, 'COMPLETE', {
        completed_at: new Date().toISOString(),
      })

      expect(repo.countActive()).toBe(1)
    })
  })

  // -------------------------------------------------------------------------
  // findAll
  // -------------------------------------------------------------------------

  describe('findAll', () => {
    it('returns all instances', () => {
      repo.create(makeInput())
      repo.create(makeInput())
      repo.create(makeInput())
      const all = repo.findAll()
      expect(all).toHaveLength(3)
    })

    it('supports limit', () => {
      repo.create(makeInput())
      repo.create(makeInput())
      repo.create(makeInput())
      const limited = repo.findAll(2)
      expect(limited).toHaveLength(2)
    })

    it('supports limit + offset', () => {
      repo.create(makeInput())
      repo.create(makeInput())
      repo.create(makeInput())
      const page2 = repo.findAll(2, 2)
      expect(page2).toHaveLength(1)
    })

    it('returns results ordered by created_at DESC', () => {
      // Create with explicit created_at values to ensure deterministic ordering.
      // We insert directly to control timestamps since the repo auto-sets created_at.
      const a = repo.create(makeInput())
      const b = repo.create(makeInput())
      const all = repo.findAll()

      // Both instances should be present
      const ids = all.map((i) => i.runtime_action_instance_id)
      expect(ids).toContain(a.runtime_action_instance_id)
      expect(ids).toContain(b.runtime_action_instance_id)

      // Verify that results are sorted descending by created_at
      for (let i = 1; i < all.length; i++) {
        expect(all[i - 1].created_at >= all[i].created_at).toBe(true)
      }
    })
  })
})
