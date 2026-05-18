/**
 * types.ts — JSON protocol types for the Node.js <-> Python sidecar communication.
 *
 * These interfaces match the ExecutionEngineSpec.md §2.2 JSON protocol exactly.
 * Requests flow from PythonWorker -> sandbox_runner.py via stdin.
 * Responses flow from sandbox_runner.py -> PythonWorker via stdout.
 */

/**
 * Request sent to the Python sidecar worker over stdin (newline-delimited JSON).
 */
export interface SidecarRequest {
  request_id: string
  action_oid: string
  action_name: string
  state: string
  source_code: string
  inputs: Record<string, string>
  outputs: Record<string, string>
  environment_action_properties: Record<string, Record<string, string>>
  action_properties: Record<string, Record<string, string>>
  timeout_ms: number
}

/**
 * Response received from the Python sidecar worker over stdout (newline-delimited JSON).
 */
export interface SidecarResponse {
  request_id: string
  success: boolean
  outputs: Record<string, string>
  return_value: boolean | null
  execution_time_ms: number
  stdout_capture: string
  stderr_capture: string
  // Error fields (present when success is false)
  error?: string
  error_type?: 'SYNTAX_ERROR' | 'RUNTIME_ERROR' | 'TIMEOUT' | 'WORKER_CRASH'
  traceback?: string
}
