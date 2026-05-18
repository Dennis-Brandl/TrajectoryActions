import type { Instance } from '@trajectory/storage'

export interface InvokeRequest {
  action_oid: string
  workflow_instance_id: string
  step_instance_id: string
  step_oid: string
  input_parameters: Array<{ name: string; value: string }>
  timeout_ms?: number // Optional per-invocation override
  /**
   * Test/dev affordance: override entries in the environment's
   * `action_property_specifications` for this single invocation only.
   * Stored ephemerally on InstanceManager; cleared when the instance reaches
   * a terminal state. Shape mirrors `flattenProperties()` output —
   * `Record<spec_name, Record<entry_name, value>>`.
   *
   * Example: `{ SIMULATION_MODE: { Value: 'true' } }` flips the env-level
   * SIMULATION_MODE.Value to 'true' just for this instance's state code.
   * Use cases: manual failure-injection during development; production
   * workflow clients should not send this field.
   */
  action_property_overrides?: Record<string, Record<string, string>>
}

export interface InvokeResult {
  runtime_action_instance_id: string
  action_oid: string
  status: string
  created_at: string
  sse_endpoint?: string // Only for observable actions
}

export interface InstanceManagerOptions {
  pythonPath?: string // Default 'python'
  scriptPath: string // Path to sandbox_runner.py
  poolSize?: number // Override settings default
  onStateChange?: (instanceId: string, state: string, instance: Instance) => void
  onTerminal?: (instanceId: string, state: string, instance: Instance) => void
  onError?: (instanceId: string, error: Error) => void
}
