import type { Migration } from './runner.js'

export const migration: Migration = {
  name: '001-initial-schema',

  up(db) {
    // --------------------------------------------------------
    // 1. environments
    // --------------------------------------------------------
    db.exec(`
      CREATE TABLE environments (
        oid TEXT PRIMARY KEY,
        local_id TEXT NOT NULL,
        version TEXT NOT NULL,
        last_modified_date TEXT NOT NULL,
        description TEXT,
        schema_version TEXT NOT NULL,
        action_property_specifications TEXT NOT NULL DEFAULT '[]',
        value_property_specifications TEXT NOT NULL DEFAULT '[]',
        resource_property_specifications TEXT NOT NULL DEFAULT '[]',
        imported_at TEXT NOT NULL,
        source_filename TEXT NOT NULL
      )
    `)

    // --------------------------------------------------------
    // 2. actions
    // --------------------------------------------------------
    db.exec(`
      CREATE TABLE actions (
        oid TEXT PRIMARY KEY,
        environment_oid TEXT NOT NULL,
        local_id TEXT NOT NULL,
        version TEXT NOT NULL,
        last_modified_date TEXT NOT NULL,
        description TEXT,
        action_visibility TEXT NOT NULL CHECK(action_visibility IN ('opaque', 'observable')),
        input_parameter_specifications TEXT NOT NULL DEFAULT '[]',
        output_parameter_specifications TEXT NOT NULL DEFAULT '[]',
        property_specifications TEXT NOT NULL DEFAULT '[]',
        FOREIGN KEY (environment_oid) REFERENCES environments(oid) ON DELETE CASCADE
      )
    `)

    db.exec(`CREATE INDEX idx_actions_environment ON actions(environment_oid)`)

    // --------------------------------------------------------
    // 3. code_versions
    // --------------------------------------------------------
    db.exec(`
      CREATE TABLE code_versions (
        id TEXT PRIMARY KEY,
        action_oid TEXT NOT NULL,
        state TEXT NOT NULL,
        version_number INTEGER NOT NULL,
        source_code TEXT NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        created_by TEXT,
        description TEXT,
        FOREIGN KEY (action_oid) REFERENCES actions(oid) ON DELETE CASCADE,
        UNIQUE (action_oid, state, version_number)
      )
    `)

    db.exec(`CREATE INDEX idx_code_versions_action_state ON code_versions(action_oid, state)`)
    db.exec(`
      CREATE INDEX idx_code_versions_active ON code_versions(action_oid, state, is_active)
        WHERE is_active = 1
    `)

    // --------------------------------------------------------
    // 4. instances
    // --------------------------------------------------------
    db.exec(`
      CREATE TABLE instances (
        runtime_action_instance_id TEXT PRIMARY KEY,
        action_oid TEXT NOT NULL,
        environment_oid TEXT NOT NULL,
        workflow_instance_id TEXT NOT NULL,
        step_instance_id TEXT NOT NULL,
        step_oid TEXT NOT NULL,
        visibility TEXT NOT NULL CHECK(visibility IN ('opaque', 'observable')),
        state TEXT NOT NULL,
        input_parameters TEXT NOT NULL DEFAULT '[]',
        output_parameters TEXT NOT NULL DEFAULT '[]',
        state_history TEXT NOT NULL DEFAULT '[]',
        pinned_code_versions TEXT NOT NULL DEFAULT '[]',
        states_with_code_executed TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        started_at TEXT,
        completed_at TEXT,
        error TEXT,
        traceback TEXT,
        is_logged INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (action_oid) REFERENCES actions(oid),
        FOREIGN KEY (environment_oid) REFERENCES environments(oid)
      )
    `)

    db.exec(`CREATE INDEX idx_instances_state ON instances(state)`)
    db.exec(`CREATE INDEX idx_instances_action ON instances(action_oid)`)
    db.exec(`CREATE INDEX idx_instances_workflow ON instances(workflow_instance_id)`)
    db.exec(`
      CREATE INDEX idx_instances_cleanup ON instances(completed_at, is_logged)
        WHERE completed_at IS NOT NULL
    `)

    // --------------------------------------------------------
    // 5. execution_log
    // --------------------------------------------------------
    db.exec(`
      CREATE TABLE execution_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        runtime_action_instance_id TEXT NOT NULL,
        action_oid TEXT NOT NULL,
        action_name TEXT NOT NULL,
        environment_oid TEXT NOT NULL,
        environment_name TEXT NOT NULL,
        workflow_instance_id TEXT NOT NULL,
        step_oid TEXT NOT NULL,
        input_parameters TEXT NOT NULL DEFAULT '[]',
        output_parameters TEXT NOT NULL DEFAULT '[]',
        states_executed TEXT NOT NULL DEFAULT '[]',
        code_versions_used TEXT NOT NULL DEFAULT '{}',
        started_at TEXT NOT NULL,
        completed_at TEXT NOT NULL,
        duration_ms INTEGER NOT NULL,
        final_status TEXT NOT NULL CHECK(final_status IN ('COMPLETED', 'ABORTED', 'STOPPED')),
        error TEXT
      )
    `)

    db.exec(`CREATE INDEX idx_log_action ON execution_log(action_name)`)
    db.exec(`CREATE INDEX idx_log_environment ON execution_log(environment_oid)`)
    db.exec(`CREATE INDEX idx_log_status ON execution_log(final_status)`)
    db.exec(`CREATE INDEX idx_log_completed ON execution_log(completed_at)`)
    db.exec(`CREATE INDEX idx_log_oldest ON execution_log(id ASC)`)

    // --------------------------------------------------------
    // 6. settings
    // --------------------------------------------------------
    db.exec(`
      CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        default_value TEXT NOT NULL,
        description TEXT NOT NULL,
        value_type TEXT NOT NULL CHECK(value_type IN ('number', 'string', 'boolean'))
      )
    `)

    // Seed default settings
    const insertSetting = db.prepare(
      'INSERT INTO settings (key, value, default_value, description, value_type) VALUES (?, ?, ?, ?, ?)'
    )

    insertSetting.run(
      'log_max_size',
      '10000',
      '10000',
      'Maximum execution log entries before rollover',
      'number'
    )
    insertSetting.run('python_pool_size', '4', '4', 'Number of Python subprocess workers', 'number')
    insertSetting.run(
      'execution_timeout_ms',
      '60000',
      '60000',
      'Default timeout for Python code execution per state (ms)',
      'number'
    )
    insertSetting.run(
      'instance_retention_hours',
      '24',
      '24',
      'Hours to retain completed instance records before cleanup',
      'number'
    )
  },
}
