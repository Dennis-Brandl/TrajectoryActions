import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type BetterSqlite3 from 'better-sqlite3'
import { openDatabase } from '../database.js'
import { runMigrations } from '../migrations/runner.js'
import { migration as initialMigration } from '../migrations/001-initial-schema.js'
import { migration as actionTimeoutMigration } from '../migrations/002-action-timeout.js'
import { migration as lifecycleStateMigration } from '../migrations/003-lifecycle-state.js'
import { EnvironmentRepository } from '../repositories/environment.repository.js'
import { ActionRepository } from '../repositories/action.repository.js'
import type { ActionInput, EnvironmentInput } from '../types.js'

const TEST_ENV_INPUT: EnvironmentInput = {
  oid: 'env-parent-001',
  local_id: 'ParentEnv',
  version: '1.0.0',
  last_modified_date: '2026-01-01T00:00:00Z',
  description: 'Test parent environment',
  schema_version: '4.0',
  action_property_specifications: [],
  value_property_specifications: [],
  resource_property_specifications: [],
  source_filename: 'ParentEnv.WFenvir',
}

function makeActionInput(overrides: Partial<ActionInput> = {}): ActionInput {
  return {
    oid: 'act-test-001',
    environment_oid: 'env-parent-001',
    local_id: 'MixIngredients',
    version: '1.0.0',
    last_modified_date: '2026-01-15T10:00:00Z',
    description: 'Mixes kitchen ingredients',
    action_visibility: 'opaque',
    input_parameter_specifications: [{ id: 'input1', name: 'ingredient' }],
    output_parameter_specifications: [{ id: 'output1', name: 'mixture' }],
    property_specifications: [{ id: 'prop1', name: 'speed' }],
    ...overrides,
  }
}

describe('ActionRepository', () => {
  let db: BetterSqlite3.Database
  let envRepo: EnvironmentRepository
  let repo: ActionRepository

  beforeEach(() => {
    db = openDatabase(':memory:')
    runMigrations(db, [initialMigration, actionTimeoutMigration, lifecycleStateMigration])
    envRepo = new EnvironmentRepository(db)
    repo = new ActionRepository(db)

    // Create the parent environment that actions will be linked to
    envRepo.create(TEST_ENV_INPUT)
  })

  afterEach(() => {
    db.close()
  })

  describe('create', () => {
    it('creates action linked to env, OID preserved, JSON fields parsed', () => {
      const input = makeActionInput()
      const action = repo.create(input)

      expect(action.oid).toBe('act-test-001')
      expect(action.environment_oid).toBe('env-parent-001')
      expect(action.local_id).toBe('MixIngredients')
      expect(action.version).toBe('1.0.0')
      expect(action.action_visibility).toBe('opaque')
      // JSON arrays should be deserialized
      expect(Array.isArray(action.input_parameter_specifications)).toBe(true)
      expect(Array.isArray(action.output_parameter_specifications)).toBe(true)
      expect(Array.isArray(action.property_specifications)).toBe(true)
      expect(action.input_parameter_specifications).toEqual([{ id: 'input1', name: 'ingredient' }])
    })

    it('preserves OID exactly as provided', () => {
      const action = repo.create(makeActionInput({ oid: 'SNOWFLAKE-OID-99999' }))
      expect(action.oid).toBe('SNOWFLAKE-OID-99999')
    })

    it('handles null description', () => {
      const action = repo.create(makeActionInput({ description: null }))
      expect(action.description).toBeNull()
    })

    it('handles empty JSON arrays', () => {
      const action = repo.create(
        makeActionInput({
          input_parameter_specifications: [],
          output_parameter_specifications: [],
          property_specifications: [],
        })
      )
      expect(action.input_parameter_specifications).toEqual([])
      expect(action.output_parameter_specifications).toEqual([])
      expect(action.property_specifications).toEqual([])
    })

    it('supports observable action_visibility', () => {
      const action = repo.create(
        makeActionInput({ oid: 'act-obs', action_visibility: 'observable' })
      )
      expect(action.action_visibility).toBe('observable')
    })
  })

  describe('lifecycle state', () => {
    it('persists and returns the lifecycle state', () => {
      repo.create(makeActionInput({ oid: 'act-state-1', state: 'Approved' }))
      const row = repo.findByOid('act-state-1')!
      expect(row.state).toBe('Approved')
    })

    it('defaults state to Draft when not provided', () => {
      repo.create(makeActionInput({ oid: 'act-state-2' }))
      const row = repo.findByOid('act-state-2')!
      expect(row.state).toBe('Draft')
    })

    it('updates lifecycle state via update()', () => {
      repo.create(makeActionInput({ oid: 'act-state-3', state: 'InTest' }))
      const updated = repo.update('act-state-3', { state: 'InReview' })
      expect(updated!.state).toBe('InReview')
    })
  })

  describe('findByOid', () => {
    it('finds action, null for nonexistent', () => {
      repo.create(makeActionInput())

      const found = repo.findByOid('act-test-001')
      expect(found).not.toBeNull()
      expect(found!.oid).toBe('act-test-001')

      const notFound = repo.findByOid('nonexistent-oid')
      expect(notFound).toBeNull()
    })

    it('returns action with parsed JSON arrays', () => {
      repo.create(makeActionInput())
      const action = repo.findByOid('act-test-001')!
      expect(Array.isArray(action.input_parameter_specifications)).toBe(true)
      expect(action.output_parameter_specifications).toEqual([{ id: 'output1', name: 'mixture' }])
    })
  })

  describe('findByEnvironment', () => {
    it('returns only actions for specified environment, sorted by local_id', () => {
      // Create second environment
      envRepo.create({
        ...TEST_ENV_INPUT,
        oid: 'env-other-002',
        local_id: 'OtherEnv',
        source_filename: 'Other.WFenvir',
      })

      repo.create(
        makeActionInput({ oid: 'act-z', local_id: 'ZAction', environment_oid: 'env-parent-001' })
      )
      repo.create(
        makeActionInput({ oid: 'act-a', local_id: 'AAction', environment_oid: 'env-parent-001' })
      )
      repo.create(
        makeActionInput({
          oid: 'act-other',
          local_id: 'OtherAction',
          environment_oid: 'env-other-002',
        })
      )

      const envActions = repo.findByEnvironment('env-parent-001')
      expect(envActions).toHaveLength(2)
      expect(envActions[0].local_id).toBe('AAction')
      expect(envActions[1].local_id).toBe('ZAction')
    })

    it('returns empty array when environment has no actions', () => {
      envRepo.create({
        ...TEST_ENV_INPUT,
        oid: 'env-empty',
        local_id: 'EmptyEnv',
        source_filename: 'Empty.WFenvir',
      })
      const actions = repo.findByEnvironment('env-empty')
      expect(actions).toEqual([])
    })
  })

  describe('update', () => {
    it('updates description and action_visibility', () => {
      repo.create(makeActionInput())
      const updated = repo.update('act-test-001', {
        description: 'Updated description',
        action_visibility: 'observable',
      })

      expect(updated).not.toBeNull()
      expect(updated!.description).toBe('Updated description')
      expect(updated!.action_visibility).toBe('observable')
      // Other fields unchanged
      expect(updated!.oid).toBe('act-test-001')
      expect(updated!.local_id).toBe('MixIngredients')
    })

    it('updates JSON spec fields with correct round-trip', () => {
      repo.create(makeActionInput())
      const newSpecs = [{ id: 'new1', name: 'NewParam' }]
      const updated = repo.update('act-test-001', { input_parameter_specifications: newSpecs })
      expect(updated!.input_parameter_specifications).toEqual(newSpecs)
    })

    it('returns null for nonexistent OID', () => {
      const result = repo.update('nonexistent', { description: 'test' })
      expect(result).toBeNull()
    })
  })

  describe('delete', () => {
    it('deletes action and returns true', () => {
      repo.create(makeActionInput())
      const result = repo.delete('act-test-001')
      expect(result).toBe(true)
      expect(repo.findByOid('act-test-001')).toBeNull()
    })

    it('returns false when OID not found', () => {
      const result = repo.delete('nonexistent-oid')
      expect(result).toBe(false)
    })
  })

  describe('cascade from environment delete', () => {
    it('delete parent environment removes action', () => {
      repo.create(makeActionInput())
      envRepo.delete('env-parent-001')

      const found = repo.findByOid('act-test-001')
      expect(found).toBeNull()
    })
  })

  describe('cascade to code_versions', () => {
    it('deleting action removes its code_versions', () => {
      repo.create(makeActionInput())
      // Insert code version directly
      db.prepare(
        `
        INSERT INTO code_versions (id, action_oid, state, version_number, source_code, created_at)
        VALUES ('cv-cascade-001', 'act-test-001', 'EXECUTING', 1, 'pass', '2026-01-01T00:00:00Z')
      `
      ).run()

      repo.delete('act-test-001')

      const cvCount = (
        db
          .prepare('SELECT COUNT(*) AS cnt FROM code_versions WHERE id = ?')
          .get('cv-cascade-001') as { cnt: number }
      ).cnt
      expect(cvCount).toBe(0)
    })
  })

  describe('upsert', () => {
    it('creates action when OID does not exist', () => {
      const { action, created } = repo.upsert(makeActionInput())
      expect(created).toBe(true)
      expect(action.oid).toBe('act-test-001')
    })

    it('updates action when OID exists', () => {
      repo.create(makeActionInput())
      const { action, created } = repo.upsert(makeActionInput({ description: 'Re-uploaded spec' }))
      expect(created).toBe(false)
      expect(action.description).toBe('Re-uploaded spec')
    })

    it('preserves action OID through upsert', () => {
      const { action } = repo.upsert(makeActionInput({ oid: 'STABLE-OID-XYZ' }))
      expect(action.oid).toBe('STABLE-OID-XYZ')
    })
  })

  describe('count and countByEnvironment', () => {
    it('count returns 0 when no actions', () => {
      expect(repo.count()).toBe(0)
    })

    it('count returns correct total', () => {
      envRepo.create({
        ...TEST_ENV_INPUT,
        oid: 'env-extra',
        local_id: 'ExtraEnv',
        source_filename: 'Extra.WFenvir',
      })
      repo.create(makeActionInput({ oid: 'act-1', local_id: 'Act1' }))
      repo.create(makeActionInput({ oid: 'act-2', local_id: 'Act2' }))
      repo.create(makeActionInput({ oid: 'act-3', local_id: 'Act3', environment_oid: 'env-extra' }))
      expect(repo.count()).toBe(3)
    })

    it('countByEnvironment returns count for specific environment', () => {
      envRepo.create({
        ...TEST_ENV_INPUT,
        oid: 'env-extra2',
        local_id: 'ExtraEnv2',
        source_filename: 'Extra2.WFenvir',
      })
      repo.create(
        makeActionInput({ oid: 'act-e1', local_id: 'E1', environment_oid: 'env-parent-001' })
      )
      repo.create(
        makeActionInput({ oid: 'act-e2', local_id: 'E2', environment_oid: 'env-parent-001' })
      )
      repo.create(makeActionInput({ oid: 'act-e3', local_id: 'E3', environment_oid: 'env-extra2' }))

      expect(repo.countByEnvironment('env-parent-001')).toBe(2)
      expect(repo.countByEnvironment('env-extra2')).toBe(1)
      expect(repo.countByEnvironment('nonexistent')).toBe(0)
    })
  })

  describe('deleteByEnvironment', () => {
    it('deletes all actions for an environment and returns count', () => {
      repo.create(makeActionInput({ oid: 'act-d1', local_id: 'D1' }))
      repo.create(makeActionInput({ oid: 'act-d2', local_id: 'D2' }))
      const count = repo.deleteByEnvironment('env-parent-001')
      expect(count).toBe(2)
      expect(repo.countByEnvironment('env-parent-001')).toBe(0)
    })

    it('returns 0 when no actions for environment', () => {
      const count = repo.deleteByEnvironment('env-parent-001')
      expect(count).toBe(0)
    })
  })

  describe('findAll', () => {
    it('returns all actions sorted by local_id', () => {
      repo.create(makeActionInput({ oid: 'act-z2', local_id: 'ZetaAction' }))
      repo.create(makeActionInput({ oid: 'act-a2', local_id: 'AlphaAction' }))

      const all = repo.findAll()
      expect(all).toHaveLength(2)
      expect(all[0].local_id).toBe('AlphaAction')
      expect(all[1].local_id).toBe('ZetaAction')
    })
  })
})
