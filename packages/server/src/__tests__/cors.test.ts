import { describe, it, expect } from 'vitest'
import express from 'express'
import cors from 'cors'
import request from 'supertest'
import { isOriginAllowed } from '../config.js'

describe('isOriginAllowed', () => {
  it('allows requests with no Origin (same-origin / non-browser)', () => {
    expect(isOriginAllowed(undefined, undefined)).toBe(true)
  })

  it('allows loopback origins by default', () => {
    expect(isOriginAllowed('http://localhost:3004', undefined)).toBe(true)
    expect(isOriginAllowed('http://127.0.0.1:3000', undefined)).toBe(true)
  })

  it('blocks arbitrary internet origins by default', () => {
    expect(isOriginAllowed('https://evil.example', undefined)).toBe(false)
  })

  it('honours an explicit ACTIONS_ALLOWED_ORIGINS allowlist', () => {
    expect(
      isOriginAllowed('https://app.example', 'https://app.example, https://other.example')
    ).toBe(true)
    expect(isOriginAllowed('http://localhost:3004', 'https://app.example')).toBe(false)
  })
})

describe('cors middleware integration', () => {
  function appWith(allowedEnv: string | undefined) {
    const app = express()
    app.use(cors({ origin: (origin, cb) => cb(null, isOriginAllowed(origin, allowedEnv)) }))
    app.get('/ping', (_req, res) => {
      res.json({ ok: true })
    })
    return app
  }

  it('does not echo Access-Control-Allow-Origin for an arbitrary origin', async () => {
    const res = await request(appWith(undefined)).get('/ping').set('Origin', 'https://evil.example')
    expect(res.headers['access-control-allow-origin']).toBeUndefined()
  })

  it('reflects a loopback origin', async () => {
    const res = await request(appWith(undefined))
      .get('/ping')
      .set('Origin', 'http://localhost:3004')
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3004')
  })
})
