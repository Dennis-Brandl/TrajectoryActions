import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type BetterSqlite3 from 'better-sqlite3'
import { openDatabase } from '../database.js'
import { runMigrations } from '../migrations/runner.js'
import { migration as initialMigration } from '../migrations/001-initial-schema.js'
import { EnvironmentRepository } from '../repositories/environment.repository.js'
import type { EnvironmentInput } from '../types.js'

function makeEnvInput(overrides: Partial<EnvironmentInput> = {}): EnvironmentInput {
  return {
    oid: 'env-test-001',
    local_id: 'KitchenEnv',
    version: '1.0.0',
    last_modified_date: '2026-01-15T10:00:00Z',
    description: 'A test kitchen environment',
    schema_version: '4.0',
    action_property_specifications: [{ id: 'prop1', name: 'Temperature' }],
    value_property_specifications: [{ id: 'val1', name: 'SetPoint' }],
    resource_property_specifications: [{ id: 'res1', name: 'Oven' }],
    source_filename: 'KitchenEnv.WFenvir',
    ...overrides,
  }
}

describe('EnvironmentRepository', () => {
  let db: BetterSqlite3.Database
  let repo: EnvironmentRepository

  beforeEach(() => {
    db = openDatabase(':memory:')
    runMigrations(db, [initialMigration])
    repo = new EnvironmentRepository(db)
  })

  afterEach(() => {
    db.close()
  })

  describe('create', () => {
    it('creates environment and returns it with parsed JSON arrays', () => {
      const input = makeEnvInput()
      const env = repo.create(input)

      expect(env.oid).toBe('env-test-001')
      expect(env.local_id).toBe('KitchenEnv')
      expect(env.version).toBe('1.0.0')
      expect(env.description).toBe('A test kitchen environment')
      expect(env.schema_version).toBe('4.0')
      expect(env.source_filename).toBe('KitchenEnv.WFenvir')
      // JSON arrays should be deserialized
      expect(Array.isArray(env.action_property_specifications)).toBe(true)
      expect(Array.isArray(env.value_property_specifications)).toBe(true)
      expect(Array.isArray(env.resource_property_specifications)).toBe(true)
      expect(env.action_property_specifications).toEqual([{ id: 'prop1', name: 'Temperature' }])
    })

    it('preserves OID exactly as provided', () => {
      const input = makeEnvInput({ oid: 'EXACT-OID-12345' })
      const env = repo.create(input)
      expect(env.oid).toBe('EXACT-OID-12345')
    })

    it('sets imported_at automatically as ISO 8601 string', () => {
      const before = new Date().toISOString()
      const env = repo.create(makeEnvInput())
      const after = new Date().toISOString()
      expect(env.imported_at >= before).toBe(true)
      expect(env.imported_at <= after).toBe(true)
    })

    it('handles null description', () => {
      const env = repo.create(makeEnvInput({ description: null }))
      expect(env.description).toBeNull()
    })

    it('handles empty arrays for property specifications', () => {
      const env = repo.create(
        makeEnvInput({
          action_property_specifications: [],
          value_property_specifications: [],
          resource_property_specifications: [],
        })
      )
      expect(env.action_property_specifications).toEqual([])
      expect(env.value_property_specifications).toEqual([])
      expect(env.resource_property_specifications).toEqual([])
    })
  })

  describe('findByOid', () => {
    it('returns created environment', () => {
      repo.create(makeEnvInput())
      const env = repo.findByOid('env-test-001')
      expect(env).not.toBeNull()
      expect(env!.oid).toBe('env-test-001')
    })

    it('returns null for nonexistent OID', () => {
      const env = repo.findByOid('nonexistent-oid')
      expect(env).toBeNull()
    })

    it('returns environment with parsed JSON arrays', () => {
      repo.create(makeEnvInput())
      const env = repo.findByOid('env-test-001')!
      expect(Array.isArray(env.action_property_specifications)).toBe(true)
      expect(env.action_property_specifications).toEqual([{ id: 'prop1', name: 'Temperature' }])
    })
  })

  describe('findAll', () => {
    it('returns empty array when no environments', () => {
      expect(repo.findAll()).toEqual([])
    })

    it('returns all environments sorted by local_id ASC', () => {
      repo.create(makeEnvInput({ oid: 'env-z', local_id: 'ZFactory' }))
      repo.create(makeEnvInput({ oid: 'env-a', local_id: 'AKitchen' }))
      repo.create(makeEnvInput({ oid: 'env-m', local_id: 'MWarehouse' }))

      const all = repo.findAll()
      expect(all).toHaveLength(3)
      expect(all[0].local_id).toBe('AKitchen')
      expect(all[1].local_id).toBe('MWarehouse')
      expect(all[2].local_id).toBe('ZFactory')
    })
  })

  describe('update', () => {
    it('updates description and verifies other fields unchanged', () => {
      repo.create(makeEnvInput())
      const updated = repo.update('env-test-001', { description: 'Updated description' })

      expect(updated).not.toBeNull()
      expect(updated!.description).toBe('Updated description')
      // Other fields unchanged
      expect(updated!.oid).toBe('env-test-001')
      expect(updated!.local_id).toBe('KitchenEnv')
      expect(updated!.version).toBe('1.0.0')
    })

    it('updates JSON fields with correct round-trip', () => {
      repo.create(makeEnvInput())
      const newSpecs = [
        { id: 'newProp', name: 'Humidity' },
        { id: 'newProp2', name: 'Pressure' },
      ]
      const updated = repo.update('env-test-001', { action_property_specifications: newSpecs })

      expect(updated!.action_property_specifications).toEqual(newSpecs)
      // Other JSON fields unchanged
      expect(updated!.value_property_specifications).toEqual([{ id: 'val1', name: 'SetPoint' }])
    })

    it('returns null for nonexistent OID', () => {
      const result = repo.update('nonexistent', { description: 'test' })
      expect(result).toBeNull()
    })

    it('returns current env when no fields provided', () => {
      repo.create(makeEnvInput())
      const updated = repo.update('env-test-001', {})
      expect(updated).not.toBeNull()
      expect(updated!.oid).toBe('env-test-001')
    })
  })

  describe('delete', () => {
    it('deletes environment and returns true', () => {
      repo.create(makeEnvInput())
      const result = repo.delete('env-test-001')
      expect(result).toBe(true)
      expect(repo.findByOid('env-test-001')).toBeNull()
    })

    it('returns false when OID not found', () => {
      const result = repo.delete('nonexistent-oid')
      expect(result).toBe(false)
    })
  })

  describe('cascade delete', () => {
    it('deleting environment cascade-deletes its actions', () => {
      repo.create(makeEnvInput())
      // Insert action directly via SQL to avoid needing ActionRepository
      db.prepare(
        `
        INSERT INTO actions (oid, environment_oid, local_id, version, last_modified_date, action_visibility)
        VALUES ('act-001', 'env-test-001', 'TestAction', '1.0', '2026-01-01T00:00:00Z', 'opaque')
      `
      ).run()

      repo.delete('env-test-001')

      const actionCount = (
        db.prepare('SELECT COUNT(*) AS cnt FROM actions WHERE oid = ?').get('act-001') as {
          cnt: number
        }
      ).cnt
      expect(actionCount).toBe(0)
    })

    it('deleting environment cascade-deletes actions AND their code_versions', () => {
      repo.create(makeEnvInput())
      db.prepare(
        `
        INSERT INTO actions (oid, environment_oid, local_id, version, last_modified_date, action_visibility)
        VALUES ('act-002', 'env-test-001', 'AnotherAction', '1.0', '2026-01-01T00:00:00Z', 'opaque')
      `
      ).run()
      db.prepare(
        `
        INSERT INTO code_versions (id, action_oid, state, version_number, source_code, created_at)
        VALUES ('cv-001', 'act-002', 'EXECUTING', 1, 'pass', '2026-01-01T00:00:00Z')
      `
      ).run()

      repo.delete('env-test-001')

      const cvCount = (
        db.prepare('SELECT COUNT(*) AS cnt FROM code_versions WHERE id = ?').get('cv-001') as {
          cnt: number
        }
      ).cnt
      expect(cvCount).toBe(0)
    })
  })

  describe('upsert', () => {
    it('creates a new record when OID does not exist', () => {
      const { environment, created } = repo.upsert(makeEnvInput())
      expect(created).toBe(true)
      expect(environment.oid).toBe('env-test-001')
    })

    it('updates existing record when OID exists', () => {
      repo.create(makeEnvInput())
      const { environment, created } = repo.upsert(makeEnvInput({ description: 'Re-uploaded' }))
      expect(created).toBe(false)
      expect(environment.description).toBe('Re-uploaded')
    })

    it('returns the updated environment after re-upload', () => {
      repo.create(makeEnvInput({ version: '1.0.0' }))
      const { environment } = repo.upsert(makeEnvInput({ version: '2.0.0' }))
      expect(environment.version).toBe('2.0.0')
    })
  })

  describe('count', () => {
    it('returns 0 when no environments', () => {
      expect(repo.count()).toBe(0)
    })

    it('returns correct count after creates', () => {
      repo.create(makeEnvInput({ oid: 'env-1', local_id: 'Env1' }))
      repo.create(makeEnvInput({ oid: 'env-2', local_id: 'Env2' }))
      repo.create(makeEnvInput({ oid: 'env-3', local_id: 'Env3' }))
      expect(repo.count()).toBe(3)
    })

    it('decrements after delete', () => {
      repo.create(makeEnvInput())
      expect(repo.count()).toBe(1)
      repo.delete('env-test-001')
      expect(repo.count()).toBe(0)
    })
  })

  describe('findByLocalId', () => {
    it('finds environment by local_id', () => {
      repo.create(makeEnvInput())
      const env = repo.findByLocalId('KitchenEnv')
      expect(env).not.toBeNull()
      expect(env!.oid).toBe('env-test-001')
    })

    it('returns null for nonexistent local_id', () => {
      const env = repo.findByLocalId('NonExistentEnv')
      expect(env).toBeNull()
    })
  })
})
