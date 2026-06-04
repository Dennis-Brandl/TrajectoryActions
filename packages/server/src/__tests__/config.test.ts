import { describe, it, expect } from 'vitest'
import { initializeDatabase, SettingsRepository } from '@trajectory/storage'
import { applyApiKeyFromEnv } from '../config.js'

describe('applyApiKeyFromEnv', () => {
  it('persists a non-empty ACTIONS_API_KEY as api_key', () => {
    const db = initializeDatabase(':memory:')
    const repo = new SettingsRepository(db)
    applyApiKeyFromEnv(repo, 'env-secret')
    expect(repo.getValue('api_key')).toBe('env-secret')
  })

  it('leaves api_key unchanged for undefined or empty values', () => {
    const db = initializeDatabase(':memory:')
    const repo = new SettingsRepository(db)
    applyApiKeyFromEnv(repo, undefined)
    expect(repo.getValue('api_key')).toBe('')
    applyApiKeyFromEnv(repo, '')
    expect(repo.getValue('api_key')).toBe('')
  })
})
