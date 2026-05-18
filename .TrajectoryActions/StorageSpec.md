# Trajectory Action Container — Storage Specification

## Overview

All persistent data is stored in a single SQLite database at `/data/database.sqlite` within the Docker container. The database is accessed via `better-sqlite3` (synchronous API, no ORM). Uploaded package files are archived under `/data/uploads/`.

---

## 1. SQLite Schema

### 1.1 Environments Table

Stores Master Environment Specifications with immutable OIDs from Trajectory MD.

```sql
CREATE TABLE environments (
  oid TEXT PRIMARY KEY,               -- Immutable snowflake OID from Trajectory MD
  local_id TEXT NOT NULL,             -- Human-readable identifier
  version TEXT NOT NULL,              -- Semantic version
  last_modified_date TEXT NOT NULL,   -- ISO 8601 from Trajectory MD
  description TEXT,                   -- Optional description
  schema_version TEXT NOT NULL,       -- Schema version (e.g., "4.0")

  -- Stored as JSON strings
  action_property_specifications TEXT NOT NULL DEFAULT '[]',
  value_property_specifications TEXT NOT NULL DEFAULT '[]',
  resource_property_specifications TEXT NOT NULL DEFAULT '[]',

  -- Import metadata
  imported_at TEXT NOT NULL,          -- ISO 8601 when uploaded to container
  source_filename TEXT NOT NULL       -- Original upload filename
);
```

### 1.2 Actions Table

Stores Master Action Specifications, each linked to a parent environment.

```sql
CREATE TABLE actions (
  oid TEXT PRIMARY KEY,               -- Immutable snowflake OID from Trajectory MD
  environment_oid TEXT NOT NULL,      -- Parent environment (FK)
  local_id TEXT NOT NULL,             -- Human-readable action name
  version TEXT NOT NULL,              -- Semantic version
  last_modified_date TEXT NOT NULL,   -- ISO 8601 from Trajectory MD
  description TEXT,                   -- Optional description
  action_visibility TEXT NOT NULL CHECK(action_visibility IN ('opaque', 'observable')),

  -- Stored as JSON strings
  input_parameter_specifications TEXT NOT NULL DEFAULT '[]',
  output_parameter_specifications TEXT NOT NULL DEFAULT '[]',
  property_specifications TEXT NOT NULL DEFAULT '[]',

  FOREIGN KEY (environment_oid) REFERENCES environments(oid) ON DELETE CASCADE
);

CREATE INDEX idx_actions_environment ON actions(environment_oid);
```

### 1.3 Code Versions Table

Stores versioned Python code for each action+state combination.

```sql
CREATE TABLE code_versions (
  id TEXT PRIMARY KEY,                -- UUID v4
  action_oid TEXT NOT NULL,           -- Master Action OID (FK)
  state TEXT NOT NULL,                -- State name (e.g., "EXECUTING")
  version_number INTEGER NOT NULL,    -- Auto-increment per action+state
  source_code TEXT NOT NULL,          -- Python source code
  is_active INTEGER NOT NULL DEFAULT 0, -- Boolean: active version for new instances
  created_at TEXT NOT NULL,           -- ISO 8601
  created_by TEXT,                    -- Optional author
  description TEXT,                   -- Optional version note

  FOREIGN KEY (action_oid) REFERENCES actions(oid) ON DELETE CASCADE,
  UNIQUE (action_oid, state, version_number)
);

CREATE INDEX idx_code_versions_action_state ON code_versions(action_oid, state);
CREATE INDEX idx_code_versions_active ON code_versions(action_oid, state, is_active)
  WHERE is_active = 1;
```

### 1.4 Instances Table

Stores active and recently completed Runtime Action Instances.

```sql
CREATE TABLE instances (
  runtime_action_instance_id TEXT PRIMARY KEY, -- Server-generated UUID v4
  action_oid TEXT NOT NULL,           -- Master Action OID
  environment_oid TEXT NOT NULL,      -- Parent environment OID
  workflow_instance_id TEXT NOT NULL, -- From invoke request
  step_instance_id TEXT NOT NULL,     -- From invoke request
  step_oid TEXT NOT NULL,             -- From invoke request
  visibility TEXT NOT NULL CHECK(visibility IN ('opaque', 'observable')),
  state TEXT NOT NULL,                -- Current state machine state

  -- Stored as JSON strings
  input_parameters TEXT NOT NULL DEFAULT '[]',
  output_parameters TEXT NOT NULL DEFAULT '[]',
  state_history TEXT NOT NULL DEFAULT '[]',
  pinned_code_versions TEXT NOT NULL DEFAULT '[]',
  states_with_code_executed TEXT NOT NULL DEFAULT '[]',

  -- Timing
  created_at TEXT NOT NULL,           -- ISO 8601
  started_at TEXT,
  completed_at TEXT,

  -- Metadata
  error TEXT,                         -- Error message if failed
  is_logged INTEGER NOT NULL DEFAULT 0, -- Whether log entry has been written

  FOREIGN KEY (action_oid) REFERENCES actions(oid),
  FOREIGN KEY (environment_oid) REFERENCES environments(oid)
);

CREATE INDEX idx_instances_state ON instances(state);
CREATE INDEX idx_instances_action ON instances(action_oid);
CREATE INDEX idx_instances_workflow ON instances(workflow_instance_id);
CREATE INDEX idx_instances_cleanup ON instances(completed_at, is_logged)
  WHERE completed_at IS NOT NULL;
```

### 1.5 Execution Log Table

Rolling log of completed action instance records.

```sql
CREATE TABLE execution_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  runtime_action_instance_id TEXT NOT NULL,
  action_oid TEXT NOT NULL,
  action_name TEXT NOT NULL,          -- Denormalized for query convenience
  environment_oid TEXT NOT NULL,
  environment_name TEXT NOT NULL,     -- Denormalized for query convenience
  workflow_instance_id TEXT NOT NULL,
  step_oid TEXT NOT NULL,

  -- Parameter snapshots (JSON strings)
  input_parameters TEXT NOT NULL DEFAULT '[]',
  output_parameters TEXT NOT NULL DEFAULT '[]',

  -- Execution details (JSON strings)
  states_executed TEXT NOT NULL DEFAULT '[]',
  code_versions_used TEXT NOT NULL DEFAULT '{}',

  -- Timing
  started_at TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  duration_ms INTEGER NOT NULL,

  -- Result
  final_status TEXT NOT NULL CHECK(final_status IN ('COMPLETED', 'ABORTED', 'STOPPED')),
  error TEXT                          -- Error message if aborted
);

CREATE INDEX idx_log_action ON execution_log(action_name);
CREATE INDEX idx_log_environment ON execution_log(environment_oid);
CREATE INDEX idx_log_status ON execution_log(final_status);
CREATE INDEX idx_log_completed ON execution_log(completed_at);
CREATE INDEX idx_log_oldest ON execution_log(id ASC);  -- For rollover deletion
```

### 1.6 Settings Table

Key/value configuration store.

```sql
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  default_value TEXT NOT NULL,
  description TEXT NOT NULL,
  value_type TEXT NOT NULL CHECK(value_type IN ('number', 'string', 'boolean'))
);

-- Seed default values
INSERT INTO settings (key, value, default_value, description, value_type) VALUES
  ('log_max_size', '10000', '10000', 'Maximum execution log entries before rollover', 'number'),
  ('python_pool_size', '4', '4', 'Number of Python subprocess workers', 'number'),
  ('execution_timeout_ms', '60000', '60000', 'Default timeout for Python code execution per state (ms)', 'number'),
  ('instance_retention_hours', '24', '24', 'Hours to retain completed instance records before cleanup', 'number');
```

---

## 2. Rolling Log Mechanics

### 2.1 Insert and Trim

After each log entry insert:

```sql
-- Count current entries
SELECT COUNT(*) AS cnt FROM execution_log;

-- If cnt > max_log_size, delete excess (oldest first)
DELETE FROM execution_log
WHERE id IN (
  SELECT id FROM execution_log
  ORDER BY id ASC
  LIMIT :excess_count
);
```

Where `excess_count = cnt - max_log_size`.

### 2.2 Trim on Setting Change

If `log_max_size` is reduced below the current entry count, excess entries are trimmed immediately by the same deletion logic.

### 2.3 Performance

- The `id ASC` index ensures efficient deletion of oldest entries
- Trimming is done in a single transaction (atomic)
- For typical workloads (< 100 inserts/second), trimming adds negligible latency

---

## 3. Instance Cleanup

Completed instances are retained in the `instances` table for `instance_retention_hours` (default: 24) to allow status queries from workflow clients.

Cleanup runs periodically (every 15 minutes):

```sql
DELETE FROM instances
WHERE completed_at IS NOT NULL
  AND is_logged = 1
  AND completed_at < datetime('now', :retention_interval);
```

Active (non-completed) instances are never cleaned up — they persist until they reach a terminal state.

---

## 4. Package Upload Storage

Uploaded `.WFenvir` and `.WFaction` files are archived under `/data/uploads/`:

```
/data/uploads/
├── 2026-02-21T09-00-00Z_KitchenEnv.WFenvir
├── 2026-02-22T14-30-00Z_FactoryFloor.WFenvir
└── 2026-02-22T14-30-00Z_ManufacturingActions.WFaction
```

Files are prefixed with the upload timestamp to prevent filename collisions. The archive is for reference only — the SQLite database is the source of truth. Archive files can be deleted without affecting operation.

---

## 5. Docker Volume

All persistent data lives under `/data`:

```
/data/
├── database.sqlite           # SQLite database (all tables above)
└── uploads/                  # Archived package files
```

This directory is a Docker volume mount, ensuring data persists across container restarts:

```yaml
volumes:
  - trajectory-data:/data
```

### 5.1 Backup

To backup the container's data:

1. Copy `/data/database.sqlite` while the container is running (SQLite supports concurrent reads)
2. Or stop the container and copy the entire `/data` directory

### 5.2 Migration

The database uses a migration system. Each migration is a numbered TypeScript file:

```typescript
// migrations/001-initial.ts
export function up(db: Database): void {
  db.exec(`CREATE TABLE environments (...)`)
  db.exec(`CREATE TABLE actions (...)`)
  // ... all tables
}
```

On startup, the server checks which migrations have been applied and runs any pending ones. A `migrations` meta-table tracks applied migrations:

```sql
CREATE TABLE IF NOT EXISTS _migrations (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL
);
```

---

## 6. Data Integrity

### 6.1 Foreign Key Enforcement

```sql
PRAGMA foreign_keys = ON;
```

Enabled on every database connection. Cascading deletes ensure:

- Deleting an environment deletes its actions and their code versions
- Instance records are NOT cascade-deleted (they reference action_oid but shouldn't be lost if an environment is removed)

### 6.2 Transaction Wrapping

Critical operations are wrapped in transactions:

- Package import (environment + actions in one transaction)
- Code version save + deactivate previous (one transaction)
- Log insert + trim (one transaction)
- Instance state transition + history append (one transaction)

### 6.3 WAL Mode

```sql
PRAGMA journal_mode = WAL;
```

Write-Ahead Logging is enabled for better concurrent read/write performance (the Express server reads while the engine writes).
