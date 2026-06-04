import type { SettingsRepository } from '@trajectory/storage'

/**
 * If ACTIONS_API_KEY is provided (non-empty), persist it as the `api_key`
 * setting so exposed deployments can require authentication declaratively via
 * the environment. An empty/undefined value leaves the stored key untouched.
 */
export function applyApiKeyFromEnv(
  settingsRepo: SettingsRepository,
  apiKey: string | undefined
): void {
  if (apiKey && apiKey.length > 0) {
    settingsRepo.update('api_key', apiKey)
  }
}

/**
 * CORS origin policy. Returns true when the request Origin is allowed:
 *  - no Origin (same-origin / non-browser clients) → allowed
 *  - if ACTIONS_ALLOWED_ORIGINS is set (comma-separated) → only those origins
 *  - otherwise (default) → loopback origins only (localhost / 127.0.0.1 / ::1),
 *    which keeps local tooling (e.g. the Action Tester) working while blocking
 *    drive-by requests from arbitrary internet sites.
 */
export function isOriginAllowed(
  origin: string | undefined,
  allowedEnv: string | undefined
): boolean {
  if (!origin) return true
  const allowlist = (allowedEnv ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  if (allowlist.length > 0) return allowlist.includes(origin)
  try {
    const hostname = new URL(origin).hostname
    return (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '::1' ||
      hostname === '[::1]'
    )
  } catch {
    return false
  }
}
