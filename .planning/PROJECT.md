# Trajectory Action Container

## What This Is

A Docker-containerized Action Server that implements the Trajectory REST protocol (`/trajectory/v1/`). It receives action invocation requests from Trajectory Mobile (or any Trajectory-compatible workflow client), executes actions using user-editable Python code organized by ISA-88 state, and returns results via REST/SSE. Includes a browser-based management console for uploading environment/action packages, editing Python code, monitoring instances, and viewing execution logs.

This is the missing runtime piece of the Trajectory ecosystem — Trajectory MD authors actions, this container executes them, and Trajectory Mobile orchestrates the workflows.

## Core Value

Actions invoked by workflow clients execute reliably through the ISA-88 state machine with user-written Python code, and results are returned via the Trajectory REST protocol.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] Trajectory REST protocol server — all `/trajectory/v1/` endpoints (health, capabilities, invoke, status, command, SSE events, list, cancel)
- [ ] Python action code execution — sandboxed CPython subprocesses execute user-written Python functions per configured state
- [ ] ISA-88 state machine engine — full state machine for observable and opaque action instances per StateMachineSpec.md
- [ ] Environment & action management — upload `.WFenvir` and `.WFaction` packages; OIDs preserved exactly as authored in Trajectory MD
- [ ] Management console — React SPA for environment browsing, code editing with versioning, instance monitoring, log viewing, and configuration
- [ ] Rolling execution log — fixed-size configurable log of action instance lifecycle records
- [ ] Hot-reload with versioning — code changes take effect for new instances; running instances keep pinned versions; all versions tracked for rollback
- [ ] Docker deployment — single-port container with volume-mounted persistent storage
- [ ] SQLite storage layer — environments, actions, code versions, instances, execution log, settings with migration system
- [ ] Management API — full `/management/v1/` endpoints for console backend (dashboard, upload, environments, actions, code, instances, log, settings)
- [ ] SSE event streaming — per-instance event streams with reconnection support via Last-Event-ID
- [ ] Python subprocess pool — configurable pool of long-lived workers with crash recovery and recycling
- [ ] Parameter resolution — input parameters from invoke requests, output accumulation across states, environment and action property passing
- [ ] Concurrent instance support — multiple independent action instances running simultaneously with isolated state machines

### Out of Scope

- Authentication on management console or REST protocol — v2.0 (API keys, OAuth2)
- Multi-container orchestration — v2.0
- Package pull from Trajectory MD server — v3.0 (manual upload only for v1)
- pip package installation by users in sandbox — v3.0
- Clustering with shared state (PostgreSQL) — v4.0
- Horizontal scaling — v4.0
- Real-time WebSocket updates for console — future enhancement (polling sufficient for v1)
- Mobile app for management — browser-only console

## Context

- **Ecosystem position**: Trajectory MD (authoring, complete) → Action Container (runtime, this project) → Trajectory Mobile (orchestration, nearly complete)
- **Protocol compatibility**: Must implement the exact Trajectory REST protocol as defined from the client perspective in Trajectory Mobile's RESTProtocolSpec.md
- **OID integrity**: Environment and action OIDs are immutable snowflake identifiers authored in Trajectory MD — the container must preserve them verbatim and never generate or modify them
- **ISA-88 state machine**: Inherited from the Trajectory ecosystem, defined in StateMachineSpec.md — observable actions have full state support (pause/resume, hold/unhold, abort, stop); opaque actions have a simplified linear flow
- **Package format**: `.WFenvir` (environment libraries) and `.WFaction` (action libraries) are JSON files structured per the Trajectory MD data model
- **Nine authoritative specification documents** in `.TrajectoryActions/` define every aspect of implementation: Architecture, Data Model, State Machine, REST Protocol, Management API, Management Console, Execution Engine, Storage, and Docker

## Constraints

- **Tech stack**: Node.js 20 LTS (Alpine) + TypeScript 5.x + Express 5.x server, React 19.x + Vite 6.x console, CPython 3.12+ sidecar, SQLite via better-sqlite3, Monaco Editor for code editing — per ArchitectureSpec.md
- **Single container**: All components (server, console, Python pool, SQLite) run in one Docker container with a single exposed port (default 3000)
- **Package structure**: Monorepo with `packages/server`, `packages/engine`, `packages/storage`, `apps/console`, and `python/` sidecar — per ArchitectureSpec.md
- **Dependency direction**: server → engine → storage; console is independent (built separately, served as static files); python sidecar is spawned by engine
- **SQLite synchronous API**: Uses better-sqlite3 (not async) for simpler code and excellent performance
- **No ORM**: Repository pattern with direct SQL via better-sqlite3
- **Specs are authoritative**: The 9 specification documents are the definitive source of truth — build exactly what they define

## Key Decisions

| Decision                         | Rationale                                                                                  | Outcome   |
| -------------------------------- | ------------------------------------------------------------------------------------------ | --------- |
| Node.js + TypeScript server      | Matches Trajectory MD codebase, excellent async I/O for SSE, native child_process for Python | — Pending |
| Python sidecar (not embedded)    | Real CPython for full compatibility, subprocess isolation for sandboxing, crash isolation  | — Pending |
| SQLite (not PostgreSQL)          | Zero-config, suitable for single-container moderate throughput, trivial backup             | — Pending |
| Monaco Editor for code editing   | Same as VS Code, developer familiarity, excellent Python support                           | — Pending |
| Specs as source of truth         | 9 detailed specs already authored — no design discovery needed, build to spec              | — Pending |
| Roadmap follows dependency order | Natural build order dictated by package dependencies (storage → engine → server → console) | — Pending |

---

_Last updated: 2026-02-25 after initialization_
