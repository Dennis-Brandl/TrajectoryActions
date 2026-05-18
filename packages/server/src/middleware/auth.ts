import type { Request, Response, NextFunction } from 'express'
import type { SettingsRepository } from '@trajectory/storage'

// ============================================================
// API key authentication middleware
// ============================================================

/**
 * Creates Express middleware that enforces API key authentication.
 *
 * Behavior:
 *  - If 'api_key' is not configured in settings → open access (call next())
 *  - If configured → require X-API-Key header to match
 *  - Mismatch or missing header → 401 UNAUTHORIZED
 */
export function createApiKeyAuth(settingsRepo: SettingsRepository) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const configuredKey = settingsRepo.getValue('api_key')

    // No key configured — open access
    if (configuredKey === null) {
      next()
      return
    }

    const providedKey = req.headers['x-api-key']

    if (!providedKey || providedKey !== configuredKey) {
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
