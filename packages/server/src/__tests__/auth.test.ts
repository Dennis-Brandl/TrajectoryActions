import { describe, it, expect } from 'vitest'
import express from 'express'
import request from 'supertest'
import { createApiKeyAuth } from '../middleware/auth.js'

// Build a tiny app whose only protected route is /ping, with a fake settings
// repo returning the given api_key value.
function appWith(configuredKey: string | null) {
  const settingsRepo = {
    getValue: (k: string) => (k === 'api_key' ? configuredKey : null),
  } as unknown as Parameters<typeof createApiKeyAuth>[0]
  const app = express()
  app.use(createApiKeyAuth(settingsRepo))
  app.get('/ping', (_req, res) => {
    res.json({ ok: true })
  })
  return app
}

describe('createApiKeyAuth', () => {
  it('allows access when no api_key row exists (null = open)', async () => {
    const res = await request(appWith(null)).get('/ping')
    expect(res.status).toBe(200)
  })

  it('allows access when api_key is an empty string (open)', async () => {
    const res = await request(appWith('')).get('/ping')
    expect(res.status).toBe(200)
  })

  it('rejects when a key is configured and no header is sent', async () => {
    const res = await request(appWith('secret')).get('/ping')
    expect(res.status).toBe(401)
  })

  it('rejects a wrong key', async () => {
    const res = await request(appWith('secret')).get('/ping').set('X-API-Key', 'nope')
    expect(res.status).toBe(401)
  })

  it('rejects a key of a different length without throwing', async () => {
    const res = await request(appWith('secret')).get('/ping').set('X-API-Key', 'secret-longer')
    expect(res.status).toBe(401)
  })

  it('accepts the correct key', async () => {
    const res = await request(appWith('secret')).get('/ping').set('X-API-Key', 'secret')
    expect(res.status).toBe(200)
  })
})
