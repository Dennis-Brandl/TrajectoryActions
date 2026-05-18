# Requirements: Trajectory Action Container

**Defined:** 2026-02-25
**Core Value:** Actions invoked by workflow clients execute reliably through the ISA-88 state machine with user-written Python code, and results are returned via the Trajectory REST protocol.

## v1 Requirements

### Project Setup

- [x] **SETUP-01**: Monorepo workspace with `packages/server`, `packages/engine`, `packages/storage`, `apps/console`, `python/` sidecar per ArchitectureSpec.md
- [x] **SETUP-02**: Shared TypeScript config (`tsconfig.base.json`) and Vitest workspace config
- [x] **SETUP-03**: Dev mode with Vite proxy — console on port 5173 proxies API calls to Express on port 3001

### Storage

- [x] **STORE-01**: SQLite database connection via better-sqlite3 with WAL mode and foreign key enforcement
- [x] **STORE-02**: Migration system with `_migrations` meta-table and numbered migration files
- [x] **STORE-03**: Initial migration creates all 6 tables (environments, actions, code_versions, instances, execution_log, settings) per StorageSpec.md
- [x] **STORE-04**: EnvironmentRepository — CRUD for Master Environment Specifications with immutable OID preservation
- [x] **STORE-05**: ActionRepository — CRUD for Master Action Specifications linked to parent environments via foreign key
- [x] **STORE-06**: CodeVersionRepository — versioned Python code per action+state with auto-increment version numbers, active version management, rollback
- [x] **STORE-07**: InstanceRepository — create, update state, query active/completed instances, cleanup completed instances after retention period
- [x] **STORE-08**: LogRepository — insert execution log entries, query with filtering (action, environment, status, date range), pagination
- [x] **STORE-09**: SettingsRepository — key/value CRUD with 4 default settings seeded on first start
- [x] **STORE-10**: Transaction wrapping for critical operations (package import, code save, state transitions, log insert)

### State Machine

- [x] **SM-01**: Generic ISA-88 state machine implementation with configurable transition table
- [x] **SM-02**: Observable action states — STARTING, EXECUTING, COMPLETING, COMPLETED, PAUSING, PAUSED, UNPAUSING, HOLDING, HELD, UNHOLDING, ABORTING, ABORTED, STOPPING, CLEARING
- [x] **SM-03**: Opaque action states — POSTED, RECEIVED, IN_PROGRESS, COMPLETED
- [x] **SM-04**: State entry processing — update state, append history, persist, emit events, check for code, execute or auto-advance
- [x] **SM-05**: Command validation — reject invalid commands for current state with INVALID_STATE_TRANSITION error
- [x] **SM-06**: PAUSE/RESUME command flow — EXECUTING → PAUSING → PAUSED → UNPAUSING → EXECUTING
- [x] **SM-07**: HOLD/UNHOLD command flow — EXECUTING → HOLDING → HELD → UNHOLDING → EXECUTING
- [x] **SM-08**: Code-initiated hold — Python code returns False from EXECUTING triggers HOLD cycle
- [x] **SM-09**: ABORT from any active state — transitions through ABORTING (with optional cleanup code) to ABORTED
- [x] **SM-10**: STOP from any active state — transitions through STOPPING (with optional code) to COMPLETED
- [x] **SM-11**: CLEAR command — ABORTED → CLEARING → COMPLETED
- [x] **SM-12**: Auto-advance for states without pinned code per transition table in StateMachineSpec.md

### Execution Engine

- [x] **ENG-01**: Instance Manager — creates Runtime Action Instances from invoke requests, pins code versions, walks state machine
- [x] **ENG-02**: Code Registry — resolves active code version per action+state, supports hot-reload (new instances get latest, running keep pinned)
- [x] **ENG-03**: Python subprocess pool — configurable pool size, long-lived workers, one execution at a time per worker, crash recovery, worker recycling
- [x] **ENG-04**: stdin/stdout JSON protocol between Node.js and Python — request sends action_oid, state, source_code, inputs, props; response returns success, outputs, return_value
- [x] **ENG-05**: Python code API — `def execute(inputs, outputs, props, action_props) -> bool` with output accumulation across states
- [x] **ENG-06**: Parameter resolution — inputs from invoke request, environment action properties, action-level properties flattened to dicts
- [x] **ENG-07**: Timeout handling — SIGTERM then SIGKILL after 5s, transition to ABORTING, replacement worker spawned
- [x] **ENG-08**: Error handling — Python exceptions cause ABORTING transition with error recorded on instance
- [x] **ENG-09**: Concurrent instances — multiple independent state machines, one worker per active execution, queuing when pool exhausted
- [x] **ENG-10**: Execution logging — write log entry when instance reaches terminal state (COMPLETED, ABORTED, STOPPED)

### Trajectory REST Protocol

- [x] **REST-01**: Health endpoint — `GET /trajectory/v1/health` returns server status and Python pool health
- [x] **REST-02**: Capabilities endpoint — `GET /trajectory/v1/capabilities` returns all actions with parameters and supported commands
- [x] **REST-03**: Invoke endpoint — `POST /trajectory/v1/actions/:action_oid/invoke` validates action, creates instance, returns 201 with instance_id, begins async execution
- [x] **REST-04**: Instance status — `GET /trajectory/v1/instances/:id` returns current state, history, output parameters
- [x] **REST-05**: State command — `POST /trajectory/v1/instances/:id/command` validates and processes PAUSE/RESUME/HOLD/UNHOLD/ABORT/STOP/CLEAR
- [x] **REST-06**: SSE event stream — `GET /trajectory/v1/instances/:id/events` with state_change, output, progress, error events, 30s heartbeat
- [x] **REST-07**: SSE reconnection — Last-Event-ID header support with per-instance ring buffer (256 events)
- [x] **REST-08**: List instances — `GET /trajectory/v1/instances` with optional filters (workflow_instance_id, status, action_oid)
- [x] **REST-09**: Cancel instance — `DELETE /trajectory/v1/instances/:id` sends ABORT, terminates subprocess if running
- [x] **REST-10**: Standard error responses — error format with code/message/details for all error codes (400/404/409/422/500/503)
- [x] **REST-11**: CORS enabled for all origins with appropriate headers
- [x] **REST-12**: Request logging — INFO-level HTTP request logs to stdout

### Management API

- [x] **MGMT-01**: Dashboard summary — `GET /management/v1/dashboard` returns container info, pool status, environment/instance/log counts, recent entries
- [x] **MGMT-02**: Package upload — `POST /management/v1/upload` multipart form, parses .WFenvir/.WFaction JSON, stores with OID preservation, handles re-upload (update)
- [x] **MGMT-03**: Environment list — `GET /management/v1/environments` returns all environments with action counts
- [x] **MGMT-04**: Environment detail — `GET /management/v1/environments/:oid` returns full specs including properties and action list
- [x] **MGMT-05**: Environment delete — `DELETE /management/v1/environments/:oid` with validation (no active instances)
- [x] **MGMT-06**: Action detail — `GET /management/v1/actions/:oid` returns full spec with parameters, properties, and code summary
- [x] **MGMT-07**: Code version list — `GET /management/v1/code/:action_oid/:state` returns all versions
- [x] **MGMT-08**: Code source retrieval — `GET /management/v1/code/:action_oid/:state/:version_id` and `/active` endpoint
- [x] **MGMT-09**: Code save — `POST /management/v1/code/:action_oid/:state` creates new active version, deactivates previous
- [x] **MGMT-10**: Code rollback — `POST /management/v1/code/:action_oid/:state/:version_id/activate`
- [x] **MGMT-11**: Code delete — `DELETE /management/v1/code/:action_oid/:state/:version_id` with validation (not active, not pinned)
- [x] **MGMT-12**: Code test — `POST /management/v1/code/:action_oid/:state/test` dry-run execution with test inputs
- [x] **MGMT-13**: Instance list (management view) — `GET /management/v1/instances` with filters and enriched fields
- [x] **MGMT-14**: Instance detail (management view) — `GET /management/v1/instances/:id` with full state history and pinned versions
- [x] **MGMT-15**: Instance command (from console) — `POST /management/v1/instances/:id/command`
- [x] **MGMT-16**: Log query — `GET /management/v1/log` with filtering, pagination, log config info
- [x] **MGMT-17**: Log entry detail — `GET /management/v1/log/:id`
- [x] **MGMT-18**: Settings CRUD — `GET /management/v1/settings` and `PUT /management/v1/settings/:key` with validation

### Management Console

- [x] **UI-01**: React SPA with Vite build, React Router v7, TanStack Query for server state
- [x] **UI-02**: Sidebar navigation layout with Dashboard, Environments, Code Editor, Instances, Execution Log, Settings pages
- [x] **UI-03**: Dashboard page — status cards (uptime, pool, instances, log), recent activity table, 5-second auto-refresh
- [x] **UI-04**: Environments list page — environment cards with OID, version, action count, import date; upload button
- [x] **UI-05**: Upload dialog — drag-and-drop zone for .WFenvir/.WFaction files with import result display
- [x] **UI-06**: Environment detail page — properties display (action, value, resource), actions table with visibility and code status
- [x] **UI-07**: Action detail page — input/output parameter tables, action properties, code status per state with edit links
- [x] **UI-08**: Code editor page — environment/action/state selector dropdowns, Monaco editor with Python syntax, version history list
- [x] **UI-09**: Code save flow — save button creates new version with description dialog, new version becomes active immediately
- [x] **UI-10**: Code test panel — test inputs pre-populated from action defaults, execute via test endpoint, display results
- [x] **UI-11**: Code rollback — activate previous version from version history
- [x] **UI-12**: Code template — auto-generated template when no code exists for a state, includes available inputs/props
- [x] **UI-13**: Instances list page — filterable table with state indicators (colored dots), auto-refresh every 2 seconds
- [x] **UI-14**: Instance detail page — state timeline visualization, parameters, pinned versions, command buttons (Pause/Abort/Stop), 2s auto-refresh
- [x] **UI-15**: Execution log page — filterable/paginated table, expandable row or detail view with full execution record
- [x] **UI-16**: Settings page — form inputs for all settings, save/reset buttons, container info display

### Python Sidecar

- [x] **PY-01**: `sandbox_runner.py` — subprocess entry point that reads JSON from stdin, executes user code, writes JSON to stdout
- [x] **PY-02**: Python code template — `def execute(inputs, outputs, props, action_props) -> bool` with output accumulation
- [x] **PY-03**: stdout/stderr capture — print() output captured separately from JSON protocol
- [x] **PY-04**: Error reporting — exceptions caught with traceback, returned as error response via JSON protocol

## v2 Requirements

### Deferred Infrastructure

- **DOCKER-01**: Multi-stage Dockerfile (console build, server build, production image with Python)
- **DOCKER-02**: Docker Compose with named volume, environment variables, health check, restart policy
- **DOCKER-03**: Graceful shutdown — SIGTERM handling, connection draining, instance abort, pool cleanup
- **DOCKER-04**: Container health check endpoint returning healthy/degraded/unhealthy

### Deferred Features

- **SAND-01**: Sandbox policy — Python import allowlist, restricted filesystem (read-only /tmp), no network access
- **LOG-01**: Rolling log trim mechanics — insert-and-trim after each log entry, trim on max_size setting change
- **AUTH-01**: API keys for REST protocol access
- **AUTH-02**: OAuth2 for management console

## Out of Scope

| Feature                              | Reason                                    |
| ------------------------------------ | ----------------------------------------- |
| Multi-container orchestration        | v2.0 — single container sufficient for v1 |
| Package pull from Trajectory MD server | v3.0 — manual upload only for v1          |
| pip package installation in sandbox  | v3.0 — restricted imports for v1          |
| PostgreSQL / clustering              | v4.0 — SQLite handles moderate throughput |
| Horizontal scaling                   | v4.0 — single instance for v1             |
| WebSocket push updates for console   | Polling sufficient for v1                 |
| Mobile management app                | Browser console only                      |
| Authentication (REST + console)      | v2.0 — no auth for v1                     |

## Traceability

| Requirement | Phase   | Status   |
| ----------- | ------- | -------- |
| SETUP-01    | Phase 1 | Complete |
| SETUP-02    | Phase 1 | Complete |
| SETUP-03    | Phase 1 | Complete |
| STORE-01    | Phase 2 | Complete |
| STORE-02    | Phase 2 | Complete |
| STORE-03    | Phase 2 | Complete |
| STORE-04    | Phase 2 | Complete |
| STORE-05    | Phase 2 | Complete |
| STORE-06    | Phase 2 | Complete |
| STORE-07    | Phase 2 | Complete |
| STORE-08    | Phase 2 | Complete |
| STORE-09    | Phase 2 | Complete |
| STORE-10    | Phase 2 | Complete |
| SM-01       | Phase 3 | Complete |
| SM-02       | Phase 3 | Complete |
| SM-03       | Phase 3 | Complete |
| SM-04       | Phase 3 | Complete |
| SM-05       | Phase 3 | Complete |
| SM-06       | Phase 3 | Complete |
| SM-07       | Phase 3 | Complete |
| SM-08       | Phase 3 | Complete |
| SM-09       | Phase 3 | Complete |
| SM-10       | Phase 3 | Complete |
| SM-11       | Phase 3 | Complete |
| SM-12       | Phase 3 | Complete |
| ENG-01      | Phase 4 | Complete |
| ENG-02      | Phase 4 | Complete |
| ENG-03      | Phase 4 | Complete |
| ENG-04      | Phase 4 | Complete |
| ENG-05      | Phase 4 | Complete |
| ENG-06      | Phase 4 | Complete |
| ENG-07      | Phase 4 | Complete |
| ENG-08      | Phase 4 | Complete |
| ENG-09      | Phase 4 | Complete |
| ENG-10      | Phase 4 | Complete |
| REST-01     | Phase 5 | Complete |
| REST-02     | Phase 5 | Complete |
| REST-03     | Phase 5 | Complete |
| REST-04     | Phase 5 | Complete |
| REST-05     | Phase 5 | Complete |
| REST-06     | Phase 5 | Complete |
| REST-07     | Phase 5 | Complete |
| REST-08     | Phase 5 | Complete |
| REST-09     | Phase 5 | Complete |
| REST-10     | Phase 5 | Complete |
| REST-11     | Phase 5 | Complete |
| REST-12     | Phase 5 | Complete |
| MGMT-01     | Phase 6 | Complete |
| MGMT-02     | Phase 6 | Complete |
| MGMT-03     | Phase 6 | Complete |
| MGMT-04     | Phase 6 | Complete |
| MGMT-05     | Phase 6 | Complete |
| MGMT-06     | Phase 6 | Complete |
| MGMT-07     | Phase 6 | Complete |
| MGMT-08     | Phase 6 | Complete |
| MGMT-09     | Phase 6 | Complete |
| MGMT-10     | Phase 6 | Complete |
| MGMT-11     | Phase 6 | Complete |
| MGMT-12     | Phase 6 | Complete |
| MGMT-13     | Phase 6 | Complete |
| MGMT-14     | Phase 6 | Complete |
| MGMT-15     | Phase 6 | Complete |
| MGMT-16     | Phase 6 | Complete |
| MGMT-17     | Phase 6 | Complete |
| MGMT-18     | Phase 6 | Complete |
| UI-01       | Phase 7 | Complete |
| UI-02       | Phase 7 | Complete |
| UI-03       | Phase 7 | Complete |
| UI-04       | Phase 7 | Complete |
| UI-05       | Phase 7 | Complete |
| UI-06       | Phase 7 | Complete |
| UI-07       | Phase 7 | Complete |
| UI-08       | Phase 7 | Complete |
| UI-09       | Phase 7 | Complete |
| UI-10       | Phase 7 | Complete |
| UI-11       | Phase 7 | Complete |
| UI-12       | Phase 7 | Complete |
| UI-13       | Phase 7 | Complete |
| UI-14       | Phase 7 | Complete |
| UI-15       | Phase 7 | Complete |
| UI-16       | Phase 7 | Complete |
| PY-01       | Phase 3 | Complete |
| PY-02       | Phase 3 | Complete |
| PY-03       | Phase 3 | Complete |
| PY-04       | Phase 3 | Complete |

**Coverage:**

- v1 requirements: 85 total
- Mapped to phases: 85
- Unmapped: 0

---

_Requirements defined: 2026-02-25_
_Last updated: 2026-02-27 — Phase 7 requirements (UI-01–UI-16) marked Complete — all v1 requirements complete_
