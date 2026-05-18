import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type BetterSqlite3 from 'better-sqlite3'
import { openDatabase } from '../database.js'
import { runMigrations } from '../migrations/runner.js'
import { migration as initialMigration } from '../migrations/001-initial-schema.js'
import { SettingsRepository } from '../repositories/settings.repository.js'
import { NotFoundError, ValidationError } from '../errors.js'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SettingsRepository', () => {
  let db: BetterSqlite3.Database
  let repo: SettingsRepository

  beforeEach(() => {
    db = openDatabase(':memory:')
    runMigrations(db, [initialMigration])
    repo = new SettingsRepository(db)
  })

  afterEach(() => {
    db.close()
  })

  // -------------------------------------------------------------------------
  // getAll
  // -------------------------------------------------------------------------

  describe('getAll', () => {
    it('returns all 4 default settings', () => {
      const settings = repo.getAll()
      expect(settings).toHaveLength(4)
    })

    it('returns settings ordered by key ASC', () => {
      const settings = repo.getAll()
      const keys = settings.map((s) => s.key)
      expect(keys).toEqual([...keys].sort())
    })

    it('includes all expected keys', () => {
      const settings = repo.getAll()
      const keys = settings.map((s) => s.key)
      expect(keys).toContain('log_max_size')
      expect(keys).toContain('python_pool_size')
      expect(keys).toContain('execution_timeout_ms')
      expect(keys).toContain('instance_retention_hours')
    })
  })

  // -------------------------------------------------------------------------
  // get
  // -------------------------------------------------------------------------

  describe('get', () => {
    it('returns a specific setting by key', () => {
      const setting = repo.get('log_max_size')
      expect(setting).not.toBeNull()
      expect(setting!.key).toBe('log_max_size')
      expect(setting!.value).toBe('10000')
      expect(setting!.default_value).toBe('10000')
    })

    it('returns null for an unknown key', () => {
      const setting = repo.get('nonexistent_key')
      expect(setting).toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // getValue
  // -------------------------------------------------------------------------

  describe('getValue', () => {
    it('returns just the value string', () => {
      const value = repo.getValue('python_pool_size')
      expect(value).toBe('4')
    })

    it('returns null for unknown key', () => {
      const value = repo.getValue('no_such_key')
      expect(value).toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // getNumericValue
  // -------------------------------------------------------------------------

  describe('getNumericValue', () => {
    it('returns a parsed number', () => {
      const value = repo.getNumericValue('execution_timeout_ms')
      expect(value).toBe(60000)
      expect(typeof value).toBe('number')
    })

    it('returns null for unknown key', () => {
      const value = repo.getNumericValue('no_such_key')
      expect(value).toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // update
  // -------------------------------------------------------------------------

  describe('update', () => {
    it('changes the value and returns the updated setting', () => {
      const updated = repo.update('log_max_size', '5000')
      expect(updated.value).toBe('5000')
      expect(updated.key).toBe('log_max_size')
    })

    it('persists the change (subsequent get returns updated value)', () => {
      repo.update('log_max_size', '7500')
      const setting = repo.get('log_max_size')
      expect(setting!.value).toBe('7500')
    })

    it('does not change default_value', () => {
      repo.update('log_max_size', '5000')
      const setting = repo.get('log_max_size')
      expect(setting!.default_value).toBe('10000')
    })

    // --- python_pool_size validation ---
    describe('python_pool_size validation', () => {
      it('rejects 0', () => {
        expect(() => repo.update('python_pool_size', '0')).toThrow(ValidationError)
      })

      it('rejects -1', () => {
        expect(() => repo.update('python_pool_size', '-1')).toThrow(ValidationError)
      })

      it('rejects non-numeric value', () => {
        expect(() => repo.update('python_pool_size', 'abc')).toThrow(ValidationError)
      })

      it('rejects fractional number', () => {
        expect(() => repo.update('python_pool_size', '1.5')).toThrow(ValidationError)
      })

      it('accepts 1', () => {
        expect(() => repo.update('python_pool_size', '1')).not.toThrow()
        expect(repo.getValue('python_pool_size')).toBe('1')
      })

      it('accepts 100', () => {
        expect(() => repo.update('python_pool_size', '100')).not.toThrow()
        expect(repo.getValue('python_pool_size')).toBe('100')
      })
    })

    // --- execution_timeout_ms validation ---
    describe('execution_timeout_ms validation', () => {
      it('rejects 999', () => {
        expect(() => repo.update('execution_timeout_ms', '999')).toThrow(ValidationError)
      })

      it('accepts 0 (disabled)', () => {
        expect(() => repo.update('execution_timeout_ms', '0')).not.toThrow()
        expect(repo.getValue('execution_timeout_ms')).toBe('0')
      })

      it('rejects fractional', () => {
        expect(() => repo.update('execution_timeout_ms', '1000.5')).toThrow(ValidationError)
      })

      it('accepts 1000', () => {
        expect(() => repo.update('execution_timeout_ms', '1000')).not.toThrow()
        expect(repo.getValue('execution_timeout_ms')).toBe('1000')
      })

      it('accepts 60000', () => {
        expect(() => repo.update('execution_timeout_ms', '60000')).not.toThrow()
      })
    })

    // --- instance_retention_hours validation ---
    describe('instance_retention_hours validation', () => {
      it('rejects 0', () => {
        expect(() => repo.update('instance_retention_hours', '0')).toThrow(ValidationError)
      })

      it('rejects -1', () => {
        expect(() => repo.update('instance_retention_hours', '-1')).toThrow(ValidationError)
      })

      it('accepts 1', () => {
        expect(() => repo.update('instance_retention_hours', '1')).not.toThrow()
      })

      it('accepts 0.5 (fractional hours)', () => {
        expect(() => repo.update('instance_retention_hours', '0.5')).not.toThrow()
        expect(repo.getValue('instance_retention_hours')).toBe('0.5')
      })
    })

    // --- log_max_size validation ---
    describe('log_max_size validation', () => {
      it('rejects 0', () => {
        expect(() => repo.update('log_max_size', '0')).toThrow(ValidationError)
      })

      it('rejects -1', () => {
        expect(() => repo.update('log_max_size', '-1')).toThrow(ValidationError)
      })

      it('rejects fractional', () => {
        expect(() => repo.update('log_max_size', '100.5')).toThrow(ValidationError)
      })

      it('accepts 1', () => {
        expect(() => repo.update('log_max_size', '1')).not.toThrow()
      })

      it('accepts 100000', () => {
        expect(() => repo.update('log_max_size', '100000')).not.toThrow()
      })
    })

    // --- unknown key ---
    describe('unknown key', () => {
      it('throws NotFoundError', () => {
        expect(() => repo.update('no_such_key', '42')).toThrow(NotFoundError)
      })
    })
  })

  // -------------------------------------------------------------------------
  // reset
  // -------------------------------------------------------------------------

  describe('reset', () => {
    it('resets value to default_value', () => {
      repo.update('log_max_size', '5000')
      const reset = repo.reset('log_max_size')
      expect(reset.value).toBe('10000') // back to default
    })

    it('throws NotFoundError for unknown key', () => {
      expect(() => repo.reset('no_such_key')).toThrow(NotFoundError)
    })
  })

  // -------------------------------------------------------------------------
  // resetAll
  // -------------------------------------------------------------------------

  describe('resetAll', () => {
    it('resets all 4 settings to their default values', () => {
      // Change a few settings
      repo.update('log_max_size', '5000')
      repo.update('python_pool_size', '8')

      const allReset = repo.resetAll()
      expect(allReset).toHaveLength(4)

      for (const setting of allReset) {
        expect(setting.value).toBe(setting.default_value)
      }
    })
  })
})
