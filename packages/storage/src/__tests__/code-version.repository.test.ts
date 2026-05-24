import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type BetterSqlite3 from 'better-sqlite3'
import { openDatabase } from '../database.js'
import { runMigrations } from '../migrations/runner.js'
import { migration as initialMigration } from '../migrations/001-initial-schema.js'
import { migration as actionTimeoutMigration } from '../migrations/002-action-timeout.js'
import { migration as lifecycleStateMigration } from '../migrations/003-lifecycle-state.js'
import { EnvironmentRepository } from '../repositories/environment.repository.js'
import { ActionRepository } from '../repositories/action.repository.js'
import { CodeVersionRepository } from '../repositories/code-version.repository.js'
import type { CodeVersionInput, EnvironmentInput, ActionInput } from '../types.js'

const TEST_ENV: EnvironmentInput = {
  oid: 'env-cv-test-001',
  local_id: 'CVTestEnv',
  version: '1.0.0',
  last_modified_date: '2026-01-01T00:00:00Z',
  description: null,
  schema_version: '4.0',
  action_property_specifications: [],
  value_property_specifications: [],
  resource_property_specifications: [],
  source_filename: 'CVTestEnv.WFenvir',
}

const TEST_ACTION: ActionInput = {
  oid: 'act-cv-test-001',
  environment_oid: 'env-cv-test-001',
  local_id: 'CVTestAction',
  version: '1.0.0',
  last_modified_date: '2026-01-01T00:00:00Z',
  description: null,
  action_visibility: 'opaque',
  input_parameter_specifications: [],
  output_parameter_specifications: [],
  property_specifications: [],
}

function makeCVInput(overrides: Partial<CodeVersionInput> = {}): CodeVersionInput {
  return {
    action_oid: 'act-cv-test-001',
    state: 'EXECUTING',
    source_code: 'def execute(context):\n    pass',
    created_by: 'test-user',
    description: 'Test version',
    ...overrides,
  }
}

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

describe('CodeVersionRepository', () => {
  let db: BetterSqlite3.Database
  let repo: CodeVersionRepository

  beforeEach(() => {
    db = openDatabase(':memory:')
    runMigrations(db, [initialMigration, actionTimeoutMigration, lifecycleStateMigration])

    const envRepo = new EnvironmentRepository(db)
    const actionRepo = new ActionRepository(db)
    envRepo.create(TEST_ENV)
    actionRepo.create(TEST_ACTION)

    repo = new CodeVersionRepository(db)
  })

  afterEach(() => {
    db.close()
  })

  describe('save', () => {
    it('creates version with auto-incrementing version_number starting at 1', () => {
      const cv = repo.save(makeCVInput())
      expect(cv.version_number).toBe(1)
      expect(cv.action_oid).toBe('act-cv-test-001')
      expect(cv.state).toBe('EXECUTING')
      expect(cv.source_code).toBe('def execute(context):\n    pass')
      expect(cv.is_active).toBe(false)
      expect(cv.created_by).toBe('test-user')
      expect(cv.description).toBe('Test version')
    })

    it('second save increments version_number to 2 for same action+state', () => {
      repo.save(makeCVInput())
      const cv2 = repo.save(makeCVInput({ source_code: 'def execute(context):\n    return {}' }))
      expect(cv2.version_number).toBe(2)
    })

    it('third save increments version_number to 3', () => {
      repo.save(makeCVInput())
      repo.save(makeCVInput())
      const cv3 = repo.save(makeCVInput())
      expect(cv3.version_number).toBe(3)
    })

    it('version_number starts at 1 for new state of same action', () => {
      repo.save(makeCVInput({ state: 'EXECUTING' }))
      repo.save(makeCVInput({ state: 'EXECUTING' }))
      const completingCv = repo.save(makeCVInput({ state: 'COMPLETING' }))
      expect(completingCv.version_number).toBe(1)
    })

    it('sets created_at as ISO 8601 string', () => {
      const before = new Date().toISOString()
      const cv = repo.save(makeCVInput())
      const after = new Date().toISOString()
      expect(cv.created_at >= before).toBe(true)
      expect(cv.created_at <= after).toBe(true)
    })

    it('generates UUID format id', () => {
      const cv = repo.save(makeCVInput())
      expect(cv.id).toMatch(UUID_V4_PATTERN)
    })

    it('handles null created_by and description', () => {
      const cv = repo.save(makeCVInput({ created_by: null, description: null }))
      expect(cv.created_by).toBeNull()
      expect(cv.description).toBeNull()
    })
  })

  describe('activate', () => {
    it('activates a code version, is_active becomes true', () => {
      const cv = repo.save(makeCVInput())
      expect(cv.is_active).toBe(false)

      const activated = repo.activate(cv.id)
      expect(activated).not.toBeNull()
      expect(activated!.is_active).toBe(true)
      expect(activated!.id).toBe(cv.id)
    })

    it('activating one deactivates all others for same action+state', () => {
      const cv1 = repo.save(makeCVInput())
      const cv2 = repo.save(makeCVInput())
      const cv3 = repo.save(makeCVInput())

      // Activate version 1 first
      repo.activate(cv1.id)

      // Now activate version 2 — version 1 should be deactivated
      repo.activate(cv2.id)

      expect(repo.findById(cv1.id)!.is_active).toBe(false)
      expect(repo.findById(cv2.id)!.is_active).toBe(true)
      expect(repo.findById(cv3.id)!.is_active).toBe(false)
    })

    it('returns null for nonexistent id', () => {
      const result = repo.activate('nonexistent-id')
      expect(result).toBeNull()
    })

    it('activation is exclusive: activating v3 deactivates v1 and v2', () => {
      const cv1 = repo.save(makeCVInput())
      const cv2 = repo.save(makeCVInput())
      const cv3 = repo.save(makeCVInput())

      // Activate all three in sequence, final state should be only cv3 active
      repo.activate(cv1.id)
      repo.activate(cv2.id)
      repo.activate(cv3.id)

      expect(repo.findById(cv1.id)!.is_active).toBe(false)
      expect(repo.findById(cv2.id)!.is_active).toBe(false)
      expect(repo.findById(cv3.id)!.is_active).toBe(true)
    })

    it('activating version for one state does not affect other states', () => {
      const execCv = repo.save(makeCVInput({ state: 'EXECUTING' }))
      const compCv = repo.save(makeCVInput({ state: 'COMPLETING' }))

      repo.activate(execCv.id)
      // Should not affect COMPLETING state
      expect(repo.findById(compCv.id)!.is_active).toBe(false)
    })
  })

  describe('deactivate', () => {
    it('deactivates an active version', () => {
      const cv = repo.save(makeCVInput())
      repo.activate(cv.id)
      expect(repo.findById(cv.id)!.is_active).toBe(true)

      const deactivated = repo.deactivate(cv.id)
      expect(deactivated).not.toBeNull()
      expect(deactivated!.is_active).toBe(false)
    })

    it('returns null for nonexistent id', () => {
      const result = repo.deactivate('nonexistent-id')
      expect(result).toBeNull()
    })

    it('deactivating already-inactive version returns it with is_active false', () => {
      const cv = repo.save(makeCVInput())
      const result = repo.deactivate(cv.id)
      expect(result).not.toBeNull()
      expect(result!.is_active).toBe(false)
    })
  })

  describe('getActive', () => {
    it('returns null when no active version', () => {
      repo.save(makeCVInput())
      const active = repo.getActive('act-cv-test-001', 'EXECUTING')
      expect(active).toBeNull()
    })

    it('returns the active version after activation', () => {
      const cv = repo.save(makeCVInput())
      repo.activate(cv.id)

      const active = repo.getActive('act-cv-test-001', 'EXECUTING')
      expect(active).not.toBeNull()
      expect(active!.id).toBe(cv.id)
      expect(active!.is_active).toBe(true)
    })

    it('returns null for different state even if other state is active', () => {
      const cv = repo.save(makeCVInput({ state: 'EXECUTING' }))
      repo.activate(cv.id)

      const active = repo.getActive('act-cv-test-001', 'COMPLETING')
      expect(active).toBeNull()
    })

    it('returns null after deactivation', () => {
      const cv = repo.save(makeCVInput())
      repo.activate(cv.id)
      repo.deactivate(cv.id)

      const active = repo.getActive('act-cv-test-001', 'EXECUTING')
      expect(active).toBeNull()
    })
  })

  describe('getVersionHistory', () => {
    it('returns all versions for action+state in descending version_number order', () => {
      repo.save(makeCVInput({ source_code: 'v1' }))
      repo.save(makeCVInput({ source_code: 'v2' }))
      repo.save(makeCVInput({ source_code: 'v3' }))

      const history = repo.getVersionHistory('act-cv-test-001', 'EXECUTING')
      expect(history).toHaveLength(3)
      expect(history[0].version_number).toBe(3)
      expect(history[1].version_number).toBe(2)
      expect(history[2].version_number).toBe(1)
    })

    it('returns empty array when no versions for state', () => {
      const history = repo.getVersionHistory('act-cv-test-001', 'COMPLETING')
      expect(history).toEqual([])
    })

    it('only returns versions for the specified state', () => {
      repo.save(makeCVInput({ state: 'EXECUTING' }))
      repo.save(makeCVInput({ state: 'COMPLETING' }))

      const execHistory = repo.getVersionHistory('act-cv-test-001', 'EXECUTING')
      expect(execHistory).toHaveLength(1)
      expect(execHistory[0].state).toBe('EXECUTING')
    })
  })

  describe('findById', () => {
    it('returns code version by id', () => {
      const cv = repo.save(makeCVInput())
      const found = repo.findById(cv.id)
      expect(found).not.toBeNull()
      expect(found!.id).toBe(cv.id)
    })

    it('returns null for nonexistent id', () => {
      const result = repo.findById('nonexistent-id')
      expect(result).toBeNull()
    })
  })

  describe('findByAction', () => {
    it('returns versions across all states ordered by state ASC, version_number DESC', () => {
      repo.save(makeCVInput({ state: 'EXECUTING', source_code: 'exec-v1' }))
      repo.save(makeCVInput({ state: 'EXECUTING', source_code: 'exec-v2' }))
      repo.save(makeCVInput({ state: 'COMPLETING', source_code: 'comp-v1' }))

      const versions = repo.findByAction('act-cv-test-001')
      expect(versions).toHaveLength(3)
      // Ordered by state ASC, then version_number DESC within each state
      expect(versions[0].state).toBe('COMPLETING')
      expect(versions[1].state).toBe('EXECUTING')
      expect(versions[1].version_number).toBe(2)
      expect(versions[2].state).toBe('EXECUTING')
      expect(versions[2].version_number).toBe(1)
    })

    it('returns empty array when no versions for action', () => {
      const versions = repo.findByAction('nonexistent-action')
      expect(versions).toEqual([])
    })
  })

  describe('saveAndActivate', () => {
    it('saves and activates in one call', () => {
      const cv = repo.saveAndActivate(makeCVInput())
      expect(cv.is_active).toBe(true)
      expect(cv.version_number).toBe(1)
    })

    it('saveAndActivate deactivates previous active version', () => {
      const cv1 = repo.saveAndActivate(makeCVInput({ source_code: 'v1' }))
      const cv2 = repo.saveAndActivate(makeCVInput({ source_code: 'v2' }))

      expect(repo.findById(cv1.id)!.is_active).toBe(false)
      expect(repo.findById(cv2.id)!.is_active).toBe(true)
    })

    it('saveAndActivate auto-increments version_number', () => {
      const cv1 = repo.saveAndActivate(makeCVInput())
      const cv2 = repo.saveAndActivate(makeCVInput())
      expect(cv1.version_number).toBe(1)
      expect(cv2.version_number).toBe(2)
    })

    it('getActive returns the saveAndActivate result', () => {
      const cv = repo.saveAndActivate(makeCVInput())
      const active = repo.getActive('act-cv-test-001', 'EXECUTING')
      expect(active).not.toBeNull()
      expect(active!.id).toBe(cv.id)
    })
  })

  describe('getAllActiveVersions', () => {
    it('returns empty array when no active versions', () => {
      repo.save(makeCVInput({ state: 'EXECUTING' }))
      const actives = repo.getAllActiveVersions('act-cv-test-001')
      expect(actives).toEqual([])
    })

    it('returns active versions for all states of an action', () => {
      const execCv = repo.saveAndActivate(makeCVInput({ state: 'EXECUTING' }))
      const compCv = repo.saveAndActivate(makeCVInput({ state: 'COMPLETING' }))

      const actives = repo.getAllActiveVersions('act-cv-test-001')
      expect(actives).toHaveLength(2)
      const ids = actives.map((cv) => cv.id)
      expect(ids).toContain(execCv.id)
      expect(ids).toContain(compCv.id)
    })

    it('returns only active version per state', () => {
      // Save 2 versions for EXECUTING, activate only the second
      const exec1 = repo.save(makeCVInput({ state: 'EXECUTING' }))
      const exec2 = repo.save(makeCVInput({ state: 'EXECUTING' }))
      repo.activate(exec2.id)

      const actives = repo.getAllActiveVersions('act-cv-test-001')
      expect(actives).toHaveLength(1)
      expect(actives[0].id).toBe(exec2.id)
      expect(actives.some((cv) => cv.id === exec1.id)).toBe(false)
    })
  })

  describe('getLatestVersion', () => {
    it('returns the version with highest version_number', () => {
      repo.save(makeCVInput({ source_code: 'v1' }))
      repo.save(makeCVInput({ source_code: 'v2' }))
      repo.save(makeCVInput({ source_code: 'v3' }))

      const latest = repo.getLatestVersion('act-cv-test-001', 'EXECUTING')
      expect(latest).not.toBeNull()
      expect(latest!.version_number).toBe(3)
      expect(latest!.source_code).toBe('v3')
    })

    it('returns null when no versions for action+state', () => {
      const latest = repo.getLatestVersion('act-cv-test-001', 'COMPLETING')
      expect(latest).toBeNull()
    })
  })

  describe('cascade delete', () => {
    it('deleting parent action removes all code_versions', () => {
      repo.save(makeCVInput({ state: 'EXECUTING' }))
      repo.save(makeCVInput({ state: 'COMPLETING' }))
      expect(repo.countByAction('act-cv-test-001')).toBe(2)

      db.prepare('DELETE FROM actions WHERE oid = ?').run('act-cv-test-001')

      expect(repo.countByAction('act-cv-test-001')).toBe(0)
      expect(repo.count()).toBe(0)
    })
  })

  describe('deleteByAction', () => {
    it('deletes all code versions for an action and returns count', () => {
      repo.save(makeCVInput({ state: 'EXECUTING' }))
      repo.save(makeCVInput({ state: 'COMPLETING' }))
      const count = repo.deleteByAction('act-cv-test-001')
      expect(count).toBe(2)
      expect(repo.countByAction('act-cv-test-001')).toBe(0)
    })

    it('returns 0 when no versions for action', () => {
      const count = repo.deleteByAction('nonexistent-action')
      expect(count).toBe(0)
    })
  })

  describe('count and countByAction', () => {
    it('count returns 0 when no code versions', () => {
      expect(repo.count()).toBe(0)
    })

    it('count returns total across all actions and states', () => {
      repo.save(makeCVInput({ state: 'EXECUTING' }))
      repo.save(makeCVInput({ state: 'EXECUTING' }))
      repo.save(makeCVInput({ state: 'COMPLETING' }))
      expect(repo.count()).toBe(3)
    })

    it('countByAction returns count for specific action', () => {
      repo.save(makeCVInput({ state: 'EXECUTING' }))
      repo.save(makeCVInput({ state: 'COMPLETING' }))
      expect(repo.countByAction('act-cv-test-001')).toBe(2)
      expect(repo.countByAction('nonexistent')).toBe(0)
    })
  })

  describe('UUID format', () => {
    it('saved version.id matches UUID v4 pattern', () => {
      const cv = repo.save(makeCVInput())
      expect(cv.id).toMatch(UUID_V4_PATTERN)
    })

    it('each saved version gets a unique UUID', () => {
      const cv1 = repo.save(makeCVInput())
      const cv2 = repo.save(makeCVInput())
      const cv3 = repo.save(makeCVInput())
      const ids = new Set([cv1.id, cv2.id, cv3.id])
      expect(ids.size).toBe(3)
    })
  })
})
