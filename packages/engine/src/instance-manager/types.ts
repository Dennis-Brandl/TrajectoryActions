import type { Instance } from '@trajectory/storage'

export interface PropertyMutation {
  spec_name: string
  entry_name: string
  value: string
}

/**
 * Minimal structural interface for publishing property SSE events.
 * Declared in engine so InstanceManager can depend on it without importing from
 * the server package (which would violate the engine → server layering boundary).
 * SseManager (packages/server) satisfies this interface implicitly via TS structural typing.
 */
export interface PropertySsePublisher {
  publishProperty(
    envOid: string,
    propertyName: string,
    data: {
      entries: Array<{ name: string; value: string }>
      changed_entries: string[]
      source: 'action_code'
      source_action_oid?: string
      source_instance_id?: string
    }
  ): void
}

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
  /**
   * Optional SSE publisher for property mutation events.
   * When provided, applyPropertyMutations() will call publishProperty() for
   * each modified spec after code execution completes.
   * Uses the PropertySsePublisher structural interface to avoid importing from
   * the server package (layering boundary: engine must not import from server).
   */
  sseManager?: PropertySsePublisher
}
