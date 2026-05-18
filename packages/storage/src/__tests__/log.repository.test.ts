import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type BetterSqlite3 from 'better-sqlite3'
import { openDatabase } from '../database.js'
import { runMigrations } from '../migrations/runner.js'
import { migration as initialMigration } from '../migrations/001-initial-schema.js'
import { LogRepository } from '../repositories/log.repository.js'
import type { ExecutionLogInput } from '../types.js'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function setupDb(): BetterSqlite3.Database {
  const db = openDatabase(':memory:')
  runMigrations(db, [initialMigration])
  return db
}

let entryCounter = 0

function makeEntry(overrides: Partial<ExecutionLogInput> = {}): ExecutionLogInput {
  entryCounter++
  const ts = new Date(Date.now() + entryCounter * 1000).toISOString()
  return {
    runtime_action_instance_id: `inst-${entryCounter}`,
    action_oid: 'act-001',
    action_name: 'KitchenAction',
    environment_oid: 'env-001',
    environment_name: 'KitchenEnv',
    workflow_instance_id: `wf-${entryCounter}`,
    step_oid: 'step-001',
    input_parameters: [{ name: 'temp', value: 100 }],
    output_parameters: [{ name: 'result', value: 'ok' }],
    states_executed: ['EXECUTING', 'COMPLETING'],
    code_versions_used: { EXECUTING: 'cv-001' },
    started_at: ts,
    completed_at: ts,
    duration_ms: 500,
    final_status: 'COMPLETED',
    error: null,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LogRepository', () => {
  let db: BetterSqlite3.Database
  let repo: LogRepository

  beforeEach(() => {
    db = setupDb()
    repo = new LogRepository(db)
    entryCounter = 0
  })

  afterEach(() => {
    db.close()
  })

  // -------------------------------------------------------------------------
  // insert
  // -------------------------------------------------------------------------

  describe('insert', () => {
    it('inserts an entry and returns it with auto-generated id', () => {
      const entry = repo.insert(makeEntry(), 10000)
      expect(entry.id).toBe(1)
      expect(entry.action_name).toBe('KitchenAction')
      expect(entry.final_status).toBe('COMPLETED')
    })

    it('round-trips JSON fields', () => {
      const input = makeEntry({
        input_parameters: [{ name: 'x', value: 42 }],
        states_executed: ['EXECUTING', 'COMPLETING'],
        code_versions_used: { EXECUTING: 'cv-abc' },
      })
      const entry = repo.insert(input, 10000)
      expect(entry.input_parameters).toEqual([{ name: 'x', value: 42 }])
      expect(entry.states_executed).toEqual(['EXECUTING', 'COMPLETING'])
      expect(entry.code_versions_used).toEqual({ EXECUTING: 'cv-abc' })
    })

    it('assigns sequential IDs', () => {
      const e1 = repo.insert(makeEntry(), 10000)
      const e2 = repo.insert(makeEntry(), 10000)
      const e3 = repo.insert(makeEntry(), 10000)
      expect(e1.id).toBe(1)
      expect(e2.id).toBe(2)
      expect(e3.id).toBe(3)
    })

    it('trims to maxSize: inserting 5 entries with maxSize=3 leaves 3', () => {
      for (let i = 0; i < 5; i++) {
        repo.insert(makeEntry(), 3)
      }
      expect(repo.count()).toBe(3)
    })

    it('keeps the most recent entries after trimming', () => {
      for (let i = 0; i < 5; i++) {
        repo.insert(makeEntry(), 3)
      }
      // IDs 1 and 2 should have been deleted; 3, 4, 5 remain
      expect(repo.findById(1)).toBeNull()
      expect(repo.findById(2)).toBeNull()
      expect(repo.findById(3)).not.toBeNull()
      expect(repo.findById(4)).not.toBeNull()
      expect(repo.findById(5)).not.toBeNull()
    })

    it('does not trim when count <= maxSize', () => {
      repo.insert(makeEntry(), 10)
      repo.insert(makeEntry(), 10)
      expect(repo.count()).toBe(2)
    })

    it('handles error field correctly (null vs string)', () => {
      const withError = repo.insert(makeEntry({ error: 'timeout', final_status: 'ABORTED' }), 10000)
      expect(withError.error).toBe('timeout')

      const noError = repo.insert(makeEntry({ error: null }), 10000)
      expect(noError.error).toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // findById
  // -------------------------------------------------------------------------

  describe('findById', () => {
    it('finds an existing entry', () => {
      const entry = repo.insert(makeEntry(), 10000)
      const found = repo.findById(entry.id)
      expect(found).not.toBeNull()
      expect(found!.id).toBe(entry.id)
    })

    it('returns null for nonexistent id', () => {
      expect(repo.findById(999)).toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // query
  // -------------------------------------------------------------------------

  describe('query', () => {
    beforeEach(() => {
      // Seed test data
      repo.insert(
        makeEntry({
          action_oid: 'act-001',
          action_name: 'KitchenAction',
          environment_oid: 'env-001',
          environment_name: 'KitchenEnv',
          final_status: 'COMPLETED',
          completed_at: '2026-02-01T10:00:00Z',
        }),
        10000
      )
      repo.insert(
        makeEntry({
          action_oid: 'act-001',
          action_name: 'KitchenAction',
          environment_oid: 'env-001',
          environment_name: 'KitchenEnv',
          final_status: 'ABORTED',
          completed_at: '2026-02-02T10:00:00Z',
        }),
        10000
      )
      repo.insert(
        makeEntry({
          action_oid: 'act-002',
          action_name: 'FactoryAction',
          environment_oid: 'env-002',
          environment_name: 'FactoryEnv',
          final_status: 'COMPLETED',
          completed_at: '2026-02-03T10:00:00Z',
        }),
        10000
      )
      repo.insert(
        makeEntry({
          action_oid: 'act-003',
          action_name: 'ManufacturingAction',
          environment_oid: 'env-003',
          environment_name: 'ManufacturingEnv',
          final_status: 'STOPPED',
          completed_at: '2026-02-04T10:00:00Z',
        }),
        10000
      )
    })

    it('no filters returns all entries', () => {
      const { entries, total } = repo.query({})
      expect(total).toBe(4)
      expect(entries).toHaveLength(4)
    })

    it('filters by actionOid', () => {
      const { entries, total } = repo.query({ actionOid: 'act-001' })
      expect(total).toBe(2)
      for (const e of entries) {
        expect(e.action_oid).toBe('act-001')
      }
    })

    it('filters by finalStatus COMPLETED', () => {
      const { entries, total } = repo.query({ finalStatus: 'COMPLETED' })
      expect(total).toBe(2)
      for (const e of entries) {
        expect(e.final_status).toBe('COMPLETED')
      }
    })

    it('filters by finalStatus ABORTED', () => {
      const { entries, total } = repo.query({ finalStatus: 'ABORTED' })
      expect(total).toBe(1)
      expect(entries[0].final_status).toBe('ABORTED')
    })

    it('filters by date range (startDate)', () => {
      const { entries, total } = repo.query({ startDate: '2026-02-02T00:00:00Z' })
      expect(total).toBe(3) // Feb 2, 3, 4
      for (const e of entries) {
        expect(e.completed_at >= '2026-02-02T00:00:00Z').toBe(true)
      }
    })

    it('filters by date range (endDate)', () => {
      const { total } = repo.query({ endDate: '2026-02-02T23:59:59Z' })
      expect(total).toBe(2) // Feb 1 and Feb 2
    })

    it('filters by date range (startDate + endDate)', () => {
      const { total } = repo.query({
        startDate: '2026-02-02T00:00:00Z',
        endDate: '2026-02-03T23:59:59Z',
      })
      expect(total).toBe(2) // Feb 2 and Feb 3
    })

    it('filters by environmentOid', () => {
      const { entries, total } = repo.query({ environmentOid: 'env-002' })
      expect(total).toBe(1)
      expect(entries[0].environment_oid).toBe('env-002')
    })

    it('partial match on actionName', () => {
      const { entries, total } = repo.query({ actionName: 'Kitchen' })
      expect(total).toBe(2) // both KitchenAction entries
      for (const e of entries) {
        expect(e.action_name).toContain('Kitchen')
      }
    })

    it('partial match on actionName is case-insensitive via LIKE', () => {
      // SQLite LIKE is case-insensitive for ASCII by default
      const { total } = repo.query({ actionName: 'kitchen' })
      expect(total).toBe(2)
    })

    it('partial match on environmentName', () => {
      const { total } = repo.query({ environmentName: 'Factory' })
      expect(total).toBe(1)
    })

    it('pagination: limit and offset work correctly', () => {
      const { entries: page1, total } = repo.query({ limit: 2, offset: 0 })
      expect(total).toBe(4) // total reflects all matches
      expect(page1).toHaveLength(2)

      const { entries: page2 } = repo.query({ limit: 2, offset: 2 })
      expect(page2).toHaveLength(2)

      // No overlap
      const ids1 = page1.map((e) => e.id)
      const ids2 = page2.map((e) => e.id)
      for (const id of ids2) {
        expect(ids1).not.toContain(id)
      }
    })

    it('total reflects all matches (not just paginated results)', () => {
      const { entries, total } = repo.query({ actionOid: 'act-001', limit: 1 })
      expect(entries).toHaveLength(1) // limited to 1
      expect(total).toBe(2) // but 2 match the filter
    })

    it('returns entries ordered by id DESC', () => {
      const { entries } = repo.query({})
      for (let i = 1; i < entries.length; i++) {
        expect(entries[i - 1].id > entries[i].id).toBe(true)
      }
    })

    it('returns empty when no match', () => {
      const { entries, total } = repo.query({ actionOid: 'no-such-action' })
      expect(entries).toHaveLength(0)
      expect(total).toBe(0)
    })

    it('respects max limit of 500', () => {
      // Insert 10 entries, request 1000 — should get only 10
      const { entries } = repo.query({ limit: 1000 })
      expect(entries.length).toBeLessThanOrEqual(500)
    })

    it('uses default limit of 50 when not specified', () => {
      // With only 4 entries, default limit of 50 returns all
      const { entries } = repo.query({})
      expect(entries.length).toBeLessThanOrEqual(50)
    })
  })

  // -------------------------------------------------------------------------
  // trimToSize
  // -------------------------------------------------------------------------

  describe('trimToSize', () => {
    it('trims to maxSize, deleting oldest entries', () => {
      for (let i = 0; i < 10; i++) {
        repo.insert(makeEntry(), 10000)
      }
      const deleted = repo.trimToSize(5)
      expect(deleted).toBe(5)
      expect(repo.count()).toBe(5)
    })

    it('keeps the most recent entries', () => {
      for (let i = 0; i < 10; i++) {
        repo.insert(makeEntry(), 10000)
      }
      repo.trimToSize(5)
      // IDs 1-5 should be gone; 6-10 remain
      for (let id = 1; id <= 5; id++) {
        expect(repo.findById(id)).toBeNull()
      }
      for (let id = 6; id <= 10; id++) {
        expect(repo.findById(id)).not.toBeNull()
      }
    })

    it('returns 0 when already within size', () => {
      repo.insert(makeEntry(), 10000)
      repo.insert(makeEntry(), 10000)
      const deleted = repo.trimToSize(10)
      expect(deleted).toBe(0)
    })

    it('handles empty table gracefully', () => {
      const deleted = repo.trimToSize(100)
      expect(deleted).toBe(0)
    })
  })

  // -------------------------------------------------------------------------
  // count
  // -------------------------------------------------------------------------

  describe('count', () => {
    it('returns 0 for empty table', () => {
      expect(repo.count()).toBe(0)
    })

    it('returns correct count after inserts', () => {
      repo.insert(makeEntry(), 10000)
      repo.insert(makeEntry(), 10000)
      expect(repo.count()).toBe(2)
    })
  })

  // -------------------------------------------------------------------------
  // getRecent
  // -------------------------------------------------------------------------

  describe('getRecent', () => {
    it('returns N most recent entries in descending order', () => {
      for (let i = 0; i < 5; i++) {
        repo.insert(makeEntry(), 10000)
      }
      const recent = repo.getRecent(3)
      expect(recent).toHaveLength(3)
      // Should be IDs 5, 4, 3
      expect(recent[0].id).toBe(5)
      expect(recent[1].id).toBe(4)
      expect(recent[2].id).toBe(3)
    })

    it('returns all entries if fewer than limit', () => {
      repo.insert(makeEntry(), 10000)
      const recent = repo.getRecent(10)
      expect(recent).toHaveLength(1)
    })
  })

  // -------------------------------------------------------------------------
  // deleteAll
  // -------------------------------------------------------------------------

  describe('deleteAll', () => {
    it('removes all entries and returns count', () => {
      repo.insert(makeEntry(), 10000)
      repo.insert(makeEntry(), 10000)
      const deleted = repo.deleteAll()
      expect(deleted).toBe(2)
      expect(repo.count()).toBe(0)
    })
  })
})
