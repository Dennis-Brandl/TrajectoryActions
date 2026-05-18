---
phase: 05-Trajectory-rest-protocol
plan: 02
subsystem: api
tags: [express, sse, supertest, rest, commands, event-stream, integration-tests]

# Dependency graph
requires:
  - phase: 05-01
    provides: SseManager, createProtocolRouter, errorHandler, validateBody, server entry point
  - phase: 04-execution-engine
    provides: InstanceManager.sendCommand, InvalidStateTransitionError (409 mapping)

provides:
  - createCommandsRouter(): POST /instances/:id/command and GET /instances/:id/events endpoints
  - formatSseEvent(): SSE wire format renderer (event/id/data fields)
  - VALID_COMMANDS Set: all 7 state commands validated before sendCommand delegation
  - Last-Event-ID ring buffer replay on SSE reconnection via sseManager.getEventsSince()
  - protocol.test.ts: 27-test integration suite covering full /trajectory/v1/ endpoint surface

affects:
  - 06-management-api (same server infrastructure pattern, same Router factory pattern)

# Tech tracking
tech-stack:
  added: [supertest@^6, @types/supertest]
  patterns:
    - createCommandsRouter factory pattern (same as createProtocolRouter)
    - req.params.id cast to string to satisfy Express 5 ParamsDictionary string|string[] type
    - writableEnded guard on every res.write() to prevent EPIPE on client disconnect
    - return void res.status() pattern for early SSE 404 returns (consistent with error handler)
    - createTestApp() factory pattern for integration tests: fresh :memory: DB + InstanceManager per describe block

key-files:
  created:
    - packages/server/src/routes/commands.ts
    - packages/server/src/__tests__/protocol.test.ts
  modified:
    - packages/server/src/index.ts
    - packages/server/package.json
    - package-lock.json

key-decisions:
  - "req.params.id cast as string — Express 5 ParamsDictionary types params as string|string[], cast required at usage site"
  - "VALID_COMMANDS Set check before instance lookup — returns 422 INVALID_COMMAND before any DB query for unknown commands"
  - "SSE endpoint does not call res.end() — connection stays open until client disconnects or terminal linger closes bus"
  - "createTestApp() creates fresh InstanceManager per test — real Python pool, :memory: SQLite, poolSize:1 for test isolation"
  - "SSE test uses .timeout().catch() pattern — SSE stream doesn't close so supertest timeout is expected, content-type verified from partial response"

patterns-established:
  - "Router factory pattern: createCommandsRouter(manager, sseManager) returns Router — mirrors createProtocolRouter factory"
  - "All req.params values cast as string at top of handler to satisfy Express 5 type strictness"
  - "Integration test pattern: createTestApp() factory + seedTestAction() + manager.shutdown() in finally blocks with 30s timeout"
  - "SSE wire format: event:/id:/data: with double newline terminator formatted by formatSseEvent()"

# Metrics
duration: 8min
completed: 2026-02-27
---

# Phase 5 Plan 02: Trajectory REST Protocol Commands + SSE Summary

**Commands router with 7-command validation, SSE streaming with Last-Event-ID ring buffer replay, and 27-test integration suite covering the full /trajectory/v1/ REST surface**

## Performance

- **Duration:** 8 min
- **Started:** 2026-02-27T02:03:21Z
- **Completed:** 2026-02-27T02:11:00Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments

- Commands router handles all 7 state commands (PAUSE/RESUME/HOLD/UNHOLD/ABORT/STOP/CLEAR) with strict validation — 400 for missing/wrong-type body, 422 INVALID_COMMAND for unknown values, 404 for missing instance, 409 via error handler for invalid transitions
- SSE endpoint streams events in proper text/event-stream format with Last-Event-ID reconnection replay from ring buffer, writableEnded guards prevent EPIPE on client disconnect
- 27 integration tests cover all endpoint groups with real :memory: SQLite + InstanceManager (real Python pool, poolSize:1), totaling 814 passing tests (up from 760)

## Task Commits

1. **Task 1: Create commands router and mount in index.ts** - `ae32b48` (feat)
2. **Task 2: Write integration tests for full REST protocol** - `cbacaf8` (feat)

**Plan metadata:** (docs commit below)

## Files Created/Modified

- `packages/server/src/routes/commands.ts` - createCommandsRouter() factory: POST /instances/:id/command with 7-command validation + GET /instances/:id/events SSE streaming with Last-Event-ID
- `packages/server/src/__tests__/protocol.test.ts` - 27 integration tests: health (2), capabilities (3), invoke (4), instance GET (2), instance list (3), DELETE (2), command (5), SSE (2), error shapes (2), CORS (2)
- `packages/server/src/index.ts` - Added createCommandsRouter import and mount, removed TODO placeholders
- `packages/server/package.json` - Added supertest and @types/supertest devDependencies
- `package-lock.json` - Updated lockfile

## Decisions Made

- **req.params cast**: Express 5's `ParamsDictionary` types params as `string | string[]` — routes must cast `req.params.id as string` at usage site to satisfy TypeScript strict mode. Protocol.ts routes don't use explicit `Request` type annotations so they infer narrower types; commands.ts used explicit type annotations which triggered the error.
- **VALID_COMMANDS ordering**: Command value checked before instance lookup — avoids a DB query for typos/invalid commands, returns 422 immediately.
- **No res.end() in SSE handler**: Stream stays open until client disconnects (req.on('close')) or terminal linger period closes the bus. The connection lifecycle is driven by the client.
- **SSE test timeout strategy**: supertest's `.timeout().catch()` pattern handles the indefinitely-open SSE stream — Content-Type is verified from whatever response headers are received before timeout.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed Express 5 ParamsDictionary type error for req.params.id**

- **Found during:** Task 1 (compile step after creating commands.ts)
- **Issue:** `tsc --build` failed with 5 errors — `req.params.id` typed as `string | string[]` in Express 5's `ParamsDictionary`, but `manager.getInstance()`, `manager.sendCommand()`, and `sseManager.getEventsSince()` expect `string`
- **Fix:** Removed explicit `Request/Response` type annotations from route handlers (letting Express infer narrower types from route string) and added `const instanceId = req.params.id as string` at top of each handler
- **Files modified:** `packages/server/src/routes/commands.ts`
- **Verification:** `npm run build` passes cleanly with no type errors
- **Committed in:** ae32b48 (Task 1 commit, fix applied before commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - Bug)
**Impact on plan:** Type error in Express 5 params typing required cast pattern. No scope change. Pattern documented for future routers.

## Issues Encountered

- None beyond the Express 5 params type deviation documented above.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- All 12 REST requirements (REST-01 through REST-09, REST-05, REST-06/07) now implemented and integration tested
- Phase 5 is complete — both plans (05-01 infrastructure, 05-02 commands+SSE) delivered
- Phase 6 (management API: package upload, code management, settings) can start immediately
- Same server infrastructure pattern (Router factory, createTestApp, validateBody, errorHandler) proven and documented

---

_Phase: 05-Trajectory-rest-protocol_
_Completed: 2026-02-27_
