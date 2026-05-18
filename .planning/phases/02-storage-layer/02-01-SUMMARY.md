---
phase: 02-storage-layer
plan: 01
subsystem: storage
tags: [sqlite, better-sqlite3, migrations, typescript, schema]
requires: [01-project-setup]
provides: [database-connection, schema-migrations, storage-types]
affects: [02-02, 03-engine, 04-protocol]
tech-stack:
  added:
    - better-sqlite3@^9
    - '@types/better-sqlite3'
  patterns:
    - constructor-injection for database instances (enables :memory: testing)
    - idempotent migration runner with _migrations meta-table
    - WAL + foreign_keys ON + synchronous NORMAL pragma trio
key-files:
  created:
    - packages/storage/src/database.ts
    - packages/storage/src/types.ts
    - packages/storage/src/migrations/runner.ts
    - packages/storage/src/migrations/001-initial-schema.ts
    - packages/storage/src/__tests__/database.test.ts
    - packages/storage/src/__tests__/migrations.test.ts
  modified:
    - packages/storage/src/index.ts
    - packages/storage/package.json
    - .gitignore
decisions:
  - id: db-no-singleton
    summary: openDatabase() factory, no module singleton — repos receive db via constructor injection
  - id: migration-transaction
    summary: runMigrations wraps all pending migrations in one db.transaction() for atomic rollback
  - id: partial-indexes
    summary: idx_code_versions_active and idx_instances_cleanup use WHERE clauses (partial indexes)
metrics:
  duration: 4min 27sec
  completed: 2026-02-25
---

# Phase 02 Plan 01: Storage Foundation Summary

**One-liner:** SQLite database foundation with better-sqlite3, WAL/FK pragmas, idempotent migration runner, full 6-table schema + indexes + settings seed, and 15 passing tests.

## What Was Built

### Core modules

**`packages/storage/src/database.ts`**
Exports `openDatabase(path)` — creates a `better-sqlite3` Database instance configured with:

- `journal_mode = WAL` (better concurrent read/write for Express + engine)
- `foreign_keys = ON` (referential integrity enforcement)
- `synchronous = NORMAL` (safe + performant balance)

No singleton — callers pass the instance to repositories, enabling `:memory:` databases in tests.

**`packages/storage/src/types.ts`**
Three layers of types for all 6 tables:

- **Row types** — raw SQLite shape (JSON fields as `string`, booleans as `number 0|1`)
- **Domain types** — what repositories return (JSON fields as `unknown[]`/`Record`, booleans as `boolean`)
- **Input types** — for creating/updating (auto-generated fields omitted)

Also exports `Visibility` and `FinalStatus` literal union types.

**`packages/storage/src/migrations/runner.ts`**
Exports `runMigrations(db, migrations[])`:

- Creates `_migrations` meta-table (if not exists)
- Reads already-applied migration names
- Sorts pending migrations by name (`001-` prefix ensures order)
- Applies each in a single `db.transaction()` — atomic rollback on failure
- Idempotent: safe to call repeatedly

**`packages/storage/src/migrations/001-initial-schema.ts`**
Initial migration creating the full schema:

| Table         | Key constraints                                                         |
| ------------- | ----------------------------------------------------------------------- |
| environments  | TEXT PK (OID), JSON columns default '[]'                                |
| actions       | FK environments ON DELETE CASCADE, CHECK visibility                     |
| code_versions | FK actions ON DELETE CASCADE, UNIQUE(action_oid, state, version_number) |
| instances     | FK actions + environments (NO CASCADE), CHECK visibility                |
| execution_log | INTEGER PK AUTOINCREMENT, CHECK final_status                            |
| settings      | CHECK value_type                                                        |

12 indexes created (partial indexes on code_versions_active and instances_cleanup).

4 default settings seeded: `log_max_size`, `python_pool_size`, `execution_timeout_ms`, `instance_retention_hours`.

**`packages/storage/src/index.ts`** (updated)
Re-exports all modules + `initializeDatabase(path)` convenience function that opens the DB and runs all migrations in one call — what `packages/server` will call on startup.

### Tests

15 tests across 2 files, all passing:

- **database.test.ts** (5 tests): instance creation, foreign_keys pragma, synchronous pragma, WAL mode on file DB, invalid path throws
- **migrations.test.ts** (10 tests): \_migrations table created, 6 tables exist, 12 indexes exist, 4 settings seeded with correct values, idempotency (second run adds no duplicates), \_migrations has 1 entry, FK cascade (env -> actions -> code_versions), no cascade on instances

## Decisions Made

| Decision                                             | Rationale                                                                                             |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| No module singleton in database.ts                   | Repositories receive `db` via constructor — enables `:memory:` testing without file cleanup           |
| Migration runner uses single transaction             | If migration 3 of 5 fails, none are recorded — prevents half-applied state                            |
| Partial indexes for active code versions and cleanup | Matches StorageSpec.md exactly; reduces index size for sparse filtered queries                        |
| `initializeDatabase()` convenience export            | Server startup needs one-liner; downstream packages should not need to know about migration internals |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `await import()` in synchronous test callback**

- **Found during:** Task 2 test execution
- **Issue:** database.test.ts WAL test used `await import('os')` inside a non-async `it()` callback, causing esbuild transform failure
- **Fix:** Changed to top-level static imports (`import { tmpdir } from 'os'`, etc.) and used a separate local variable for the temp file DB to avoid closing the suite-level `db` variable prematurely
- **Files modified:** `packages/storage/src/__tests__/database.test.ts`
- **Commit:** included in `865dfde`

## Next Phase Readiness

All downstream repositories (environment, action, code-version, instance, execution-log, settings) can now be built against:

- `openDatabase(path)` for connection factory
- `runMigrations(db, [initialMigration])` for schema setup
- `initializeDatabase(path)` for combined open + migrate
- All row types, domain types, and input types from `types.ts`

No blockers for Plan 02-02 (repository implementations).
