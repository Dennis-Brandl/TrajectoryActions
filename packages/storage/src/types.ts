// ============================================================
// Domain literal types
// ============================================================

export type Visibility = 'opaque' | 'observable'
export type FinalStatus = 'COMPLETED' | 'ABORTED' | 'STOPPED'
export type LifecycleState =
  | 'Draft'
  | 'InTest'
  | 'InReview'
  | 'Approved'
  | 'Effective'
  | 'Superseded'
  | 'Obsolete'

// ============================================================
// Row types — raw SQLite shapes (JSON fields as string,
// booleans as 0|1 integers)
// ============================================================

export interface EnvironmentRow {
  oid: string
  local_id: string
  version: string
  last_modified_date: string
  description: string | null
  schema_version: string
  action_property_specifications: string
  value_property_specifications: string
  resource_property_specifications: string
  imported_at: string
  source_filename: string
  state: string
}

export interface ActionRow {
  oid: string
  environment_oid: string
  local_id: string
  version: string
  last_modified_date: string
  description: string | null
  action_visibility: Visibility
  input_parameter_specifications: string
  output_parameter_specifications: string
  property_specifications: string
  timeout_seconds: number | null
  state: string
}

export interface CodeVersionRow {
  id: string
  action_oid: string
  state: string
  version_number: number
  source_code: string
  is_active: number // 0 | 1
  created_at: string
  created_by: string | null
  description: string | null
}

export interface InstanceRow {
  runtime_action_instance_id: string
  action_oid: string
  environment_oid: string
  workflow_instance_id: string
  step_instance_id: string
  step_oid: string
  visibility: Visibility
  state: string
  input_parameters: string
  output_parameters: string
  state_history: string
  pinned_code_versions: string
  states_with_code_executed: string
  created_at: string
  started_at: string | null
  completed_at: string | null
  error: string | null
  traceback: string | null
  is_logged: number // 0 | 1
}

export interface ExecutionLogRow {
  id: number
  runtime_action_instance_id: string
  action_oid: string
  action_name: string
  environment_oid: string
  environment_name: string
  workflow_instance_id: string
  step_oid: string
  input_parameters: string
  output_parameters: string
  states_executed: string
  code_versions_used: string
  started_at: string
  completed_at: string
  duration_ms: number
  final_status: FinalStatus
  error: string | null
}

export interface SettingRow {
  key: string
  value: string
  default_value: string
  description: string
  value_type: 'number' | 'string' | 'boolean'
}

// ============================================================
// Domain types — what repositories return (JSON fields as
// proper types, booleans as boolean)
// ============================================================

export interface Environment {
  oid: string
  local_id: string
  version: string
  last_modified_date: string
  description: string | null
  schema_version: string
  action_property_specifications: unknown[]
  value_property_specifications: unknown[]
  resource_property_specifications: unknown[]
  imported_at: string
  source_filename: string
  state: LifecycleState
}

export interface Action {
  oid: string
  environment_oid: string
  local_id: string
  version: string
  last_modified_date: string
  description: string | null
  action_visibility: Visibility
  input_parameter_specifications: unknown[]
  output_parameter_specifications: unknown[]
  property_specifications: unknown[]
  timeout_seconds: number | null // NULL = global default, 0 = disabled, >0 = custom seconds
  state: LifecycleState
}

export interface CodeVersion {
  id: string
  action_oid: string
  state: string
  version_number: number
  source_code: string
  is_active: boolean
  created_at: string
  created_by: string | null
  description: string | null
}

export interface Instance {
  runtime_action_instance_id: string
  action_oid: string
  environment_oid: string
  workflow_instance_id: string
  step_instance_id: string
  step_oid: string
  visibility: Visibility
  state: string
  input_parameters: unknown[]
  output_parameters: unknown[]
  state_history: unknown[]
  pinned_code_versions: unknown[]
  states_with_code_executed: unknown[]
  created_at: string
  started_at: string | null
  completed_at: string | null
  error: string | null
  /** Full Python traceback stored separately from the error summary (two-tier error detail) */
  traceback: string | null
  is_logged: boolean
}

export interface ExecutionLogEntry {
  id: number
  runtime_action_instance_id: string
  action_oid: string
  action_name: string
  environment_oid: string
  environment_name: string
  workflow_instance_id: string
  step_oid: string
  input_parameters: unknown[]
  output_parameters: unknown[]
  states_executed: unknown[]
  code_versions_used: Record<string, unknown>
  started_at: string
  completed_at: string
  duration_ms: number
  final_status: FinalStatus
  error: string | null
}

export interface Setting {
  key: string
  value: string
  default_value: string
  description: string
  value_type: 'number' | 'string' | 'boolean'
}

// ============================================================
// Input types — for creating/updating records
// ============================================================

/** All fields required except description; imported_at is auto-set by the repo */
export interface EnvironmentInput {
  oid: string
  local_id: string
  version: string
  last_modified_date: string
  description?: string | null
  schema_version: string
  action_property_specifications: unknown[]
  value_property_specifications: unknown[]
  resource_property_specifications: unknown[]
  source_filename: string
  state?: LifecycleState
}

/** All fields required except description */
export interface ActionInput {
  oid: string
  environment_oid: string
  local_id: string
  version: string
  last_modified_date: string
  description?: string | null
  action_visibility: Visibility
  input_parameter_specifications: unknown[]
  output_parameter_specifications: unknown[]
  property_specifications: unknown[]
  timeout_seconds?: number | null
  state?: LifecycleState
}

/** Omit id (auto UUID), version_number (auto-increment), is_active (default false), created_at (auto-set) */
export interface CodeVersionInput {
  action_oid: string
  state: string
  source_code: string
  created_by?: string | null
  description?: string | null
}

/** Omit created_at (auto), started_at/completed_at/error/is_logged (managed by repo) */
export interface InstanceInput {
  runtime_action_instance_id: string
  action_oid: string
  environment_oid: string
  workflow_instance_id: string
  step_instance_id: string
  step_oid: string
  visibility: Visibility
  state: string
  input_parameters: unknown[]
  output_parameters: unknown[]
  state_history: unknown[]
  pinned_code_versions: unknown[]
  states_with_code_executed: unknown[]
}

/** Omit id (autoincrement) */
export interface ExecutionLogInput {
  runtime_action_instance_id: string
  action_oid: string
  action_name: string
  environment_oid: string
  environment_name: string
  workflow_instance_id: string
  step_oid: string
  input_parameters: unknown[]
  output_parameters: unknown[]
  states_executed: unknown[]
  code_versions_used: Record<string, unknown>
  started_at: string
  completed_at: string
  duration_ms: number
  final_status: FinalStatus
  error?: string | null
}

/** Just key and value — other fields come from the existing row */
export interface SettingInput {
  key: string
  value: string
}
