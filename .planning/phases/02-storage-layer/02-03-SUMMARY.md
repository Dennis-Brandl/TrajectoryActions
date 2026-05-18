---
phase: 02-storage-layer
plan: 03
subsystem: database
tags: [better-sqlite3, sqlite, repositories, transactions, error-handling]

# Dependency graph
requires:
  - phase: 02-01
    provides: database connection, schema migrations, type definitions for all tables
  - phase: 02-02
    provides: EnvironmentRepository, ActionRepository, CodeVersionRepository as patterns
provides:
  - InstanceRepository — full ISA-88 instance lifecycle management (create, state transitions, cleanup)
  - LogRepository — rolling execution log with insert+trim and dynamic filtered queries
  - SettingsRepository — settings CRUD with per-key validation constraints
  - createTransactionHelper — atomic cross-repository operation wrapper
  - StorageError, NotFoundError, ValidationError — structured storage error types
affects:
  - 03-engine (depends on InstanceRepository for state machine persistence)
  - 04-management-api (depends on LogRepository + SettingsRepository for management endpoints)
  - Any future phase that handles instance lifecycle or log queries

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Constructor-injected db with pre-compiled prepared statements for all fixed queries
    - Dynamic SQL with parameterized placeholders (safe, never string-interpolated values)
    - db.transaction() for multi-step atomic operations (state update + history append, insert + trim)
    - fromRow/toRow private helpers for JSON column serialization/deserialization
    - Custom error hierarchy: StorageError > NotFoundError | ValidationError

key-files:
  created:
    - packages/storage/src/errors.ts
    - packages/storage/src/repositories/instance.repository.ts
    - packages/storage/src/repositories/log.repository.ts
    - packages/storage/src/repositories/settings.repository.ts
    - packages/storage/src/transaction.ts
    - packages/storage/src/__tests__/instance.repository.test.ts
    - packages/storage/src/__tests__/log.repository.test.ts
    - packages/storage/src/__tests__/settings.repository.test.ts
    - packages/storage/src/__tests__/transaction.test.ts
  modified:
    - packages/storage/src/index.ts

key-decisions:
  - 'State history is append-only JSON array; updateState reads existing history and appends new entry in a transaction — never truncates'
  - 'cleanup() builds ISO threshold in JS (not SQLite datetime()) for testability and cross-platform consistency'
  - 'LogRepository.query() uses dynamic SQL with parameterized placeholders (not pre-compiled) since WHERE clause varies by filter combination'
  - 'SettingsRepository validates via KNOWN_KEYS set + per-key switch; unknown keys throw NotFoundError (not ValidationError)'
  - 'createTransactionHelper provides both transaction() and inTransaction() for flexibility: some callers prefer closure style, others need db reference'

patterns-established:
  - 'Transaction pattern: db.transaction(() => { ... })() for atomic multi-step operations'
  - 'Rolling trim: COUNT then DELETE oldest LIMIT excess — consistent with StorageSpec.md §2.1'
  - "Error hierarchy: StorageError base with code property; NotFoundError('entity', 'id'); ValidationError('field', 'message')"
  - 'Test helpers: makeInput() factory + beforeEach :memory: db + runMigrations for fast isolated tests'

# Metrics
duration: 6min
completed: 2026-02-25
---

# Phase 2 Plan 03: Runtime Repositories Summary

**InstanceRepository with ISA-88 state history tracking, LogRepository with rolling trim, SettingsRepository with per-key validation, transaction helper, and structured error types — 460 storage tests passing**

## Performance

- **Duration:** 6 min
- **Started:** 2026-02-25T20:00:58Z
- **Completed:** 2026-02-25T20:07:11Z
- **Tasks:** 2
- **Files modified:** 10 (9 created + 1 modified)

## Accomplishments

- InstanceRepository handles complete ISA-88 lifecycle: UUID creation, state transitions with append-only history, output updates, mark-logged, multi-filter queries, and retention-based cleanup (completed + logged + past threshold)
- LogRepository provides rolling execution log: insert with automatic trim to maxSize in one transaction, dynamic query builder supporting 7 filter types with pagination (total + page), trimToSize for immediate compaction
- SettingsRepository enforces domain constraints per StorageSpec.md: python_pool_size >= 1, execution_timeout_ms >= 1000ms, instance_retention_hours > 0 (fractional OK), log_max_size >= 1 (integer)
- Custom error types (StorageError/NotFoundError/ValidationError) with machine-readable codes exported from package root
- Transaction helper wraps db.transaction() for cross-repository atomic operations

## Task Commits

Each task was committed atomically:

1. **Task 1: InstanceRepository, SettingsRepository, error types, and tests** - `c59c6dc` (feat)
2. **Task 2: LogRepository, transaction helpers, final exports, and tests** - `5f9a2d8` (feat)

**Plan metadata:** (this SUMMARY + STATE.md)

## Files Created/Modified

- `packages/storage/src/errors.ts` — StorageError base + NotFoundError + ValidationError with codes
- `packages/storage/src/repositories/instance.repository.ts` — Full instance lifecycle, 14 methods
- `packages/storage/src/repositories/log.repository.ts` — Rolling log with dynamic query builder
- `packages/storage/src/repositories/settings.repository.ts` — Settings CRUD with per-key validation
- `packages/storage/src/transaction.ts` — createTransactionHelper factory
- `packages/storage/src/index.ts` — Added 9 new exports (repositories, errors, transaction helper)
- `packages/storage/src/__tests__/instance.repository.test.ts` — 42 tests
- `packages/storage/src/__tests__/log.repository.test.ts` — 35 tests
- `packages/storage/src/__tests__/settings.repository.test.ts` — 36 tests
- `packages/storage/src/__tests__/transaction.test.ts` — 8 tests

## Decisions Made

- **State history is append-only in a transaction:** `updateState` reads the current `state_history` JSON, appends `{ state, timestamp }`, and writes it back atomically. This guarantees no concurrent modification can lose a transition.
- **Cleanup threshold built in JS, not SQLite:** `new Date(Date.now() - retentionHours * 3600000).toISOString()` keeps the logic testable without mocking SQLite's `datetime()` function.
- **Dynamic SQL for log queries:** `LogRepository.query()` cannot use a pre-compiled statement since the WHERE clause changes with every filter combination. Values are always parameterized (`?` placeholders), so there is no SQL injection risk.
- **SettingsRepository distinguishes unknown vs. invalid:** Unknown keys throw `NotFoundError` at the start (before validation), so callers get a clear "key not found" vs. "value invalid" signal.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed brittle findAll ordering test**

- **Found during:** Task 1 (InstanceRepository tests)
- **Issue:** Test asserted `all[0].id === b.id` and `all[1].id === a.id` when both instances were created in the same millisecond — ORDER BY created_at DESC was non-deterministic for equal timestamps
- **Fix:** Changed test to verify (a) both IDs are present and (b) results are sorted descending by created_at for any run
- **Files modified:** `packages/storage/src/__tests__/instance.repository.test.ts`
- **Verification:** Test passes consistently across multiple runs

**2. [Rule 1 - Bug] Fixed TypeScript error in LogRepository edge-case path**

- **Found during:** Task 2 build (tsc --build)
- **Issue:** `{ id: insertedId, ...this.fromRow({ id: insertedId, ...row }) }` caused TS2783 "id is specified more than once"
- **Fix:** Constructed `const reconstructed: ExecutionLogRow = { id: insertedId as number, ...row }` then passed to `fromRow()`
- **Files modified:** `packages/storage/src/repositories/log.repository.ts`
- **Verification:** `npm run build` exits 0

**3. [Rule 1 - Bug] Fixed ESLint no-unused-vars in log test**

- **Found during:** Task 2 pre-commit hook
- **Issue:** Two tests destructured `entries` from `repo.query()` but only used `total`
- **Fix:** Changed `const { entries, total }` to `const { total }` in both tests
- **Files modified:** `packages/storage/src/__tests__/log.repository.test.ts`
- **Verification:** ESLint passes, pre-commit hook succeeds

---

**Total deviations:** 3 auto-fixed (all Rule 1 bugs — test correctness, type safety, lint)
**Impact on plan:** All fixes necessary for correctness. No scope creep.

## Issues Encountered

None beyond the auto-fixed items above.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- All 6 repositories complete and exported from `@trajectory/storage`
- `initializeDatabase(path)` convenience function tested and working
- Engine (Phase 3) can now import `InstanceRepository`, `LogRepository`, `SettingsRepository`, `createTransactionHelper` for state machine persistence
- Management API (Phase 4) can import `LogRepository` for log queries, `SettingsRepository` for settings endpoints
- Custom error types enable consistent error handling across the engine and API layers

---

_Phase: 02-storage-layer_
_Completed: 2026-02-25_
