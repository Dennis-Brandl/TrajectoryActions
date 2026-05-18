# Roadmap: Trajectory Action Container

## Overview

Build a Docker-containerized Action Server from the ground up following its natural dependency chain: persistent storage first, then the ISA-88 state machine and Python execution sidecar, then the engine that drives instances through states, then the Trajectory REST protocol that workflow clients invoke, then the management API and browser console that operators use to configure and monitor the system. Each phase delivers a complete, independently verifiable capability that unlocks the next.

## Phases

**Phase Numbering:**

- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Project Setup** - Monorepo scaffolding, TypeScript configs, dev server proxy
- [x] **Phase 2: Storage Layer** - SQLite database, migrations, all six repositories
- [x] **Phase 3: State Machine and Python Sidecar** - ISA-88 state engine and CPython subprocess runner
- [x] **Phase 4: Execution Engine** - Instance manager, code registry, subprocess pool, parameter resolution
- [x] **Phase 5: Trajectory REST Protocol** - All /trajectory/v1/ endpoints, SSE streaming
- [x] **Phase 6: Management API** - All /management/v1/ endpoints, package upload, code management
- [x] **Phase 7: Management Console** - React SPA with Monaco editor, full browser-based operator UI

## Phase Details

### Phase 1: Project Setup

**Goal**: The monorepo workspace exists with all packages scaffolded, shared TypeScript configuration in place, and the dev server proxy running so console and server co-develop on separate ports.
**Depends on**: Nothing (first phase)
**Requirements**: SETUP-01, SETUP-02, SETUP-03
**Success Criteria** (what must be TRUE):

1. Running `npm install` at the repo root installs all workspace packages without errors
2. Running `npm run build` compiles all TypeScript packages (server, engine, storage, console) without type errors
3. Running `npm run dev` starts both the Express server on port 3001 and Vite console on port 5173, with console API calls proxied to the server
4. Each package has its own tsconfig that extends the shared base, and Vitest runs workspace-wide with `npm test`
   **Plans**: 2 plans in 2 waves

Plans:

- [x] 01-01-PLAN.md — Monorepo scaffold: root workspace config, shared tsconfig, all four packages with tsconfigs and stubs, Vitest workspace config, Python sidecar directory
- [x] 01-02-PLAN.md — Dev tooling: Express 5 server stub with health endpoint, Vite proxy, ESLint + Prettier, husky + lint-staged, concurrently dev script, GitHub Actions CI

### Phase 2: Storage Layer

**Goal**: A fully functional SQLite persistence layer exists with all six repositories, a migration system, and transaction support so that every other package has reliable data access.
**Depends on**: Phase 1
**Requirements**: STORE-01, STORE-02, STORE-03, STORE-04, STORE-05, STORE-06, STORE-07, STORE-08, STORE-09, STORE-10
**Success Criteria** (what must be TRUE):

1. Running the server for the first time creates the SQLite database file with all six tables and seeds default settings automatically
2. Environments and actions can be created, read, updated, and deleted through repositories while preserving their original OIDs exactly
3. Code versions can be saved, activated, deactivated, and queried per action+state with monotonically increasing version numbers
4. Instances can be created, have their state updated, be queried by status, and be cleaned up after a retention period
5. Log entries can be inserted and queried with filtering by action, environment, status, and date range with pagination
   **Plans**: 3 plans in 2 waves

Plans:

- [x] 02-01-PLAN.md — Database foundation: better-sqlite3 setup, WAL mode, foreign keys, migration runner, initial schema with all 6 tables, shared types
- [x] 02-02-PLAN.md — Core repositories: EnvironmentRepository, ActionRepository, CodeVersionRepository with full CRUD and tests
- [x] 02-03-PLAN.md — Runtime repositories: InstanceRepository, LogRepository, SettingsRepository, transaction helpers, error types, and tests

### Phase 3: State Machine and Python Sidecar

**Goal**: The ISA-88 state machine drives action instances through their full observable and opaque state lifecycle, and the Python sidecar subprocess correctly executes user code and returns results over the stdin/stdout JSON protocol.
**Depends on**: Phase 1
**Requirements**: SM-01, SM-02, SM-03, SM-04, SM-05, SM-06, SM-07, SM-08, SM-09, SM-10, SM-11, SM-12, PY-01, PY-02, PY-03, PY-04
**Success Criteria** (what must be TRUE):

1. An observable action instance advances through STARTING, EXECUTING, COMPLETING, COMPLETED in the happy path, auto-advancing states that have no user code
2. Sending PAUSE to an executing instance correctly cycles it through PAUSING, PAUSED, and back to EXECUTING on RESUME without losing progress
3. Sending ABORT from any active state drives the instance through ABORTING to ABORTED; sending CLEAR then produces COMPLETED
4. Python code invoked via sandbox_runner.py receives inputs and props, executes the `execute()` function, and returns its outputs and return value as JSON; uncaught exceptions return a structured error with traceback
5. Invalid state commands (e.g., PAUSE on a COMPLETED instance) are rejected with an INVALID_STATE_TRANSITION error
   **Plans**: 3 plans in 2 waves

Plans:

- [x] 03-01-PLAN.md — ISA-88 state machine: transition table, StateMachine class, enterState/sendCommand, auto-advance, deferred-HOLD, two-tier error detail
- [x] 03-02-PLAN.md — Python sidecar: sandbox_runner.py, JSON protocol, compile()+exec(), stdout/stderr capture, 14 Python tests
- [x] 03-03-PLAN.md — Python worker pool: PythonWorker, PythonWorkerPool with crash recovery/recycling, CodeExecutor bridge, E2E integration test

### Phase 4: Execution Engine

**Goal**: The execution engine creates and drives action instances end-to-end — spawning Python workers from a managed pool, resolving parameters, executing code per state, handling timeouts and errors, and logging terminal outcomes.
**Depends on**: Phase 2, Phase 3
**Requirements**: ENG-01, ENG-02, ENG-03, ENG-04, ENG-05, ENG-06, ENG-07, ENG-08, ENG-09, ENG-10
**Success Criteria** (what must be TRUE):

1. Invoking an action creates a Runtime Action Instance, pins the active code versions at invocation time, and begins executing it asynchronously through the state machine
2. Multiple concurrent instances run independently — each gets its own pool worker when available, and excess requests queue until a worker is free
3. A Python worker that crashes or times out (SIGTERM then SIGKILL after 5s) causes the instance to transition to ABORTING, and a replacement worker is spawned to restore pool capacity
4. New code saved to the registry takes effect for instances created after the save, while already-running instances continue with their pinned versions
5. When an instance reaches a terminal state (COMPLETED, ABORTED), a log entry is written to the execution log
   **Plans**: 2 plans in 2 waves

Plans:

- [x] 04-01-PLAN.md — Foundation: instance-manager types, parameter resolver, execution logger, StateMachine property resolution, PythonWorkerPool resize
- [x] 04-02-PLAN.md — InstanceManager orchestrator: invoke/sendCommand/getInstance, retrying executor, code pinning, integration tests

### Phase 5: Trajectory REST Protocol

**Goal**: Workflow clients can invoke actions, monitor their progress via SSE, and control them with state commands through the fully implemented /trajectory/v1/ endpoint surface.
**Depends on**: Phase 4
**Requirements**: REST-01, REST-02, REST-03, REST-04, REST-05, REST-06, REST-07, REST-08, REST-09, REST-10, REST-11, REST-12
**Success Criteria** (what must be TRUE):

1. A client can POST to invoke an action and immediately receive a 201 with an instance_id, then GET instance status to see the current state and output parameters
2. A client can connect to the SSE event stream for an instance and receive state_change, output, and heartbeat events in real time; reconnecting with Last-Event-ID receives missed events from the ring buffer
3. A client can send PAUSE, RESUME, HOLD, UNHOLD, ABORT, STOP, and CLEAR commands to a running instance and observe the state transition
4. GET /trajectory/v1/capabilities returns all registered actions with their parameters and supported commands
5. All error conditions return structured JSON with code, message, and details fields; CORS headers are present on all responses
   **Plans**: 2 plans in 2 waves

Plans:

- [x] 05-01-PLAN.md — Infrastructure and core protocol: SseManager, validation, error handler, auth middleware, protocol router (health, capabilities, invoke, instance GET/list, DELETE), server wiring
- [x] 05-02-PLAN.md — Commands and SSE: command POST endpoint, SSE event stream with Last-Event-ID reconnection, integration tests for full protocol surface

### Phase 6: Management API

**Goal**: The management backend exposes a complete /management/v1/ endpoint surface that lets the console upload packages, browse environments and actions, manage code versions, monitor instances, query the execution log, and configure settings.
**Depends on**: Phase 4
**Requirements**: MGMT-01, MGMT-02, MGMT-03, MGMT-04, MGMT-05, MGMT-06, MGMT-07, MGMT-08, MGMT-09, MGMT-10, MGMT-11, MGMT-12, MGMT-13, MGMT-14, MGMT-15, MGMT-16, MGMT-17, MGMT-18
**Success Criteria** (what must be TRUE):

1. Uploading a .WFenvir or .WFaction file stores the environment and all its actions with their original OIDs preserved; re-uploading the same package updates it without duplicating records
2. The dashboard endpoint returns container info, pool status, and counts of environments, active instances, and recent log entries
3. Code for any action+state can be retrieved, saved as a new version, rolled back to a previous version, and dry-run tested — all through the API
4. The instance and log endpoints return filterable, paginated results enriched with action and environment names
5. All four settings can be read and updated via the settings endpoints with validation rejecting unknown keys or invalid values
   **Plans**: 3 plans in 3 waves

Plans:

- [x] 06-01-PLAN.md — Package upload and environment/action endpoints: multer setup, upload parsing with all-or-nothing transaction, environment CRUD, action detail, dashboard
- [x] 06-02-PLAN.md — Code management endpoints: list versions, retrieve active/specific, save+activate, rollback, delete with guards, dry-run test, testCode() on InstanceManager
- [x] 06-03-PLAN.md — Instance, log, and settings endpoints: instance list with filtering/pagination/enrichment, instance detail, console commands, log query with pagination, settings CRUD with side effects

### Phase 7: Management Console

**Goal**: Operators can use a browser-based React SPA to import packages, browse environments and actions, write and test Python code with Monaco editor, monitor running instances, review execution logs, and configure the container — without touching the API directly.
**Depends on**: Phase 6
**Requirements**: UI-01, UI-02, UI-03, UI-04, UI-05, UI-06, UI-07, UI-08, UI-09, UI-10, UI-11, UI-12, UI-13, UI-14, UI-15, UI-16
**Success Criteria** (what must be TRUE):

1. Dragging a .WFenvir or .WFaction file onto the upload dialog imports the package and immediately shows the new environment and its actions in the sidebar
2. Opening the code editor for an action+state shows the current code in Monaco with Python syntax highlighting; saving creates a new version and the version history list updates
3. The instances list auto-refreshes every 2 seconds with colored state indicators; opening an instance detail shows the full state timeline and active command buttons
4. The execution log page displays a filterable, paginated table; expanding a row shows the full execution record
5. All six pages (Dashboard, Environments, Code Editor, Instances, Execution Log, Settings) are reachable from the sidebar and render without errors
   **Plans**: 4 plans in 2 waves

Plans:

- [x] 07-01-PLAN.md — SPA foundation: install deps (React Router v7, TanStack Query v5, Tailwind v4, shadcn/ui, Monaco), configure build tooling, API layer with types, routing with layout and sidebar, Dashboard page with auto-refresh
- [x] 07-02-PLAN.md — Environment and action pages: Environments list with cards, drag-and-drop upload dialog, Environment detail with properties and actions table, Action detail with parameters and code status
- [x] 07-03-PLAN.md — Code editor: Monaco editor with Python syntax, environment/action/state selectors, version history with rollback, save-with-description flow, test panel with inputs/results, template generation
- [x] 07-04-PLAN.md — Instances, log, and settings: Instances list with 2s auto-refresh and state indicators, Instance detail with timeline and command buttons, filterable paginated Execution Log with expandable rows, Settings form with save/reset

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3 -> 4 -> 5 -> 6 -> 7

Note: Phase 3 depends only on Phase 1 (not Phase 2), so Phases 2 and 3 can be worked in parallel if desired. Phase 4 requires both Phase 2 and Phase 3 complete.

| Phase                               | Plans Complete | Status   | Completed  |
| ----------------------------------- | -------------- | -------- | ---------- |
| 1. Project Setup                    | 2/2            | Complete | 2026-02-25 |
| 2. Storage Layer                    | 3/3            | Complete | 2026-02-25 |
| 3. State Machine and Python Sidecar | 3/3            | Complete | 2026-02-26 |
| 4. Execution Engine                 | 2/2            | Complete | 2026-02-26 |
| 5. Trajectory REST Protocol           | 2/2            | Complete | 2026-02-27 |
| 6. Management API                   | 3/3            | Complete | 2026-02-27 |
| 7. Management Console               | 4/4            | Complete | 2026-02-27 |
