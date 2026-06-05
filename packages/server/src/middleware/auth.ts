import { timingSafeEqual } from 'node:crypto'
import type { Request, Response, NextFunction } from 'express'
import type { SettingsRepository } from '@trajectory/storage'

/** Constant-time string comparison (length-guarded — timingSafeEqual throws on length mismatch). */
function keysMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

// ============================================================
// API key authentication middleware
// ============================================================

/**
 * Creates Express middleware that enforces API key authentication.
 *
 * Behavior:
 *  - If 'api_key' is unset or empty → open access (call next())
 *  - If configured → require X-API-Key header to match (constant-time)
 *  - Mismatch or missing header → 401 UNAUTHORIZED
 */
export function createApiKeyAuth(settingsRepo: SettingsRepository) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const configuredKey = settingsRepo.getValue('api_key')

    // No key configured (missing row or empty string) — open access
    if (!configuredKey) {
      next()
      return
    }

    const providedKey = req.headers['x-api-key']

    if (typeof providedKey !== 'string' || !keysMatch(providedKey, configuredKey)) {
      res.status(401).json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Invalid or missing API key',
          details: {},
        },
      })
      return
    }

    next()
  }
}
