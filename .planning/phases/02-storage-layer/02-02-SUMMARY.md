---
phase: 02-storage-layer
plan: '02'
subsystem: storage-repositories
tags: [sqlite, better-sqlite3, repository-pattern, json-serialization, fk-cascade, tdd]

dependency-graph:
  requires: [02-01]
  provides: [EnvironmentRepository, ActionRepository, CodeVersionRepository]
  affects: [02-03, 03-engine, 04-management-api]

tech-stack:
  added: []
  patterns:
    - Constructor-injected database for testability with :memory: databases
    - Pre-compiled prepared statements for all queries
    - Private toRow/fromRow for JSON serialization boundaries
    - Dynamic field-map pattern for partial UPDATE operations
    - Transaction-wrapped activate() and saveAndActivate() for exclusivity guarantees

key-files:
  created:
    - packages/storage/src/repositories/environment.repository.ts
    - packages/storage/src/repositories/action.repository.ts
    - packages/storage/src/repositories/code-version.repository.ts
    - packages/storage/src/__tests__/environment.repository.test.ts
    - packages/storage/src/__tests__/action.repository.test.ts
    - packages/storage/src/__tests__/code-version.repository.test.ts
  modified:
    - packages/storage/src/index.ts

decisions:
  - id: json-field-map-update
    choice: Dynamic fieldMap pattern for partial UPDATE
    rationale: Type-safe dynamic UPDATE without raw string interpolation from user input; each field handler knows its JSON serialization needs
  - id: auto-increment-version-number
    choice: SELECT MAX(version_number) + 1 computed at INSERT time
    rationale: Atomic within better-sqlite3 synchronous API; simpler than triggers; aligns with SQLite unique constraint on (action_oid, state, version_number)
  - id: activate-transaction
    choice: db.transaction() wrapping deactivate-all + activate-one in activate()
    rationale: Prevents race window where zero versions are active; consistent with StorageSpec.md requirement for atomic code save + deactivate
  - id: node-crypto-uuid
    choice: randomUUID() from node:crypto (Node 20+ built-in)
    rationale: No external dependency; UUID v4 guaranteed; no uuid package needed

metrics:
  duration: ~5min
  completed: '2026-02-25'
  tests-added: 94
  tests-total-storage: 374
---

# Phase 2 Plan 02: Domain Repositories Summary

**One-liner:** Full CRUD repositories for environments, actions, and code versions using better-sqlite3 with JSON serialization, FK cascade verification, and exclusive activation via transactions.

## What Was Built

Three synchronous repository classes backed by a shared `BetterSqlite3.Database` instance. All repository constructors pre-compile prepared statements. JSON property specification arrays serialize on write and deserialize on read. OIDs are preserved verbatim.

### EnvironmentRepository (`environment.repository.ts`)

- `create`, `findByOid`, `findAll`, `update`, `delete`
- `findByLocalId`, `count`, `upsert`
- 3 JSON columns: `action_property_specifications`, `value_property_specifications`, `resource_property_specifications`
- `imported_at` auto-set to `new Date().toISOString()` on create
- `update` uses a dynamic fieldMap to build partial SET clauses safely

### ActionRepository (`action.repository.ts`)

- `create`, `findByOid`, `findByEnvironment`, `findAll`, `update`, `delete`
- `deleteByEnvironment`, `count`, `countByEnvironment`, `upsert`
- 3 JSON columns: `input_parameter_specifications`, `output_parameter_specifications`, `property_specifications`
- `findByEnvironment` and `findAll` both ordered by `local_id ASC`

### CodeVersionRepository (`code-version.repository.ts`)

- `save` — auto-increments `version_number` per `action_oid + state` pair starting at 1
- `activate` — transaction: deactivate all same action+state, then activate this one
- `deactivate`, `getActive`, `getVersionHistory`, `findById`, `findByAction`
- `deleteByAction`, `getLatestVersion`
- `saveAndActivate` — convenience: save then activate atomically in one transaction
- `getAllActiveVersions` — returns one active version per state for an action (for pinning at instance creation)
- `count`, `countByAction`
- IDs generated via `randomUUID()` from `node:crypto`

## Test Coverage

94 new tests across 3 test files, all using `:memory:` SQLite databases:

| File                            | Tests |
| ------------------------------- | ----- |
| environment.repository.test.ts  | 26    |
| action.repository.test.ts       | 25    |
| code-version.repository.test.ts | 43    |

Key scenarios covered:

- JSON round-trip: arrays in, arrays out after every read
- OID preservation: verbatim through create/upsert/update
- FK cascade: env delete -> actions deleted -> code_versions deleted
- Activation exclusivity: activating one version deactivates all others for same action+state
- Version auto-increment: isolated per action+state pair, starts at 1
- saveAndActivate atomicity: verified as single transaction
- getAllActiveVersions: useful for code pinning at instance creation time
- UUID v4 format validation for all code version IDs

## Deviations from Plan

None — plan executed exactly as written.

## Exports Added to index.ts

Per the plan instructions (only these three, not the concurrent agent's exports):

```typescript
export { EnvironmentRepository } from './repositories/environment.repository.js'
export { ActionRepository } from './repositories/action.repository.js'
export { CodeVersionRepository } from './repositories/code-version.repository.js'
```

## Commits

| Hash    | Description                                                        |
| ------- | ------------------------------------------------------------------ |
| e7f9fab | feat(02-02): EnvironmentRepository and ActionRepository with tests |
| 02c3501 | feat(02-02): CodeVersionRepository with tests and index.ts exports |

## Next Phase Readiness

- InstanceRepository (02-03, concurrent agent) — depends on environments and actions existing
- Engine package (Phase 3) — depends on all repositories being available
- Management API (Phase 4) — will use EnvironmentRepository and ActionRepository for package imports
- Code editor feature — will use `saveAndActivate` as the primary write path
