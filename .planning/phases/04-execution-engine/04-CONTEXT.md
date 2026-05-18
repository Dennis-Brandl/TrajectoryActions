# Phase 4: Execution Engine - Context

**Gathered:** 2026-02-26
**Status:** Ready for planning

<domain>
## Phase Boundary

The execution engine creates and drives action instances end-to-end — spawning Python workers from a managed pool, resolving parameters, executing code per state, handling timeouts and errors, and logging terminal outcomes. It bridges the state machine (Phase 3) and the REST protocol (Phase 5). The engine is internal machinery; the REST layer exposes it to callers.

</domain>

<decisions>
## Implementation Decisions

### Concurrency & queueing

- When all pool workers are busy, new invocations are queued (FIFO)
- Caller receives 201 immediately; instance starts in IDLE/queued state
- Queue is unbounded — all invocations eventually run
- Pool size is configurable via SettingsRepository, changeable at runtime (new workers spawn/drain on change)
- Strict FIFO ordering — no priority levels

### Parameter resolution

- Type coercion when possible: string '5' → int 5, 'true' → bool True; reject only truly incompatible types
- Missing required parameters use defaults if defined in action definition; reject only if no default exists
- Outputs merge forward across states — each state's outputs merge into a cumulative dict, later states can read and overwrite earlier outputs
- No output validation — whatever Python code puts in outputs is passed through as-is; action parameter definitions are informational only

### Failure & recovery behavior

- Worker crash (segfault, OOM): retry once on a fresh worker, then ABORT if it crashes again; pool spawns replacement worker
- Python exception (unhandled runtime error): same as crash — retry once, then ABORT with traceback
- ABORTING-state code always runs if it exists, even after crash/timeout — executed on a fresh worker to give the action a chance to clean up resources
- Instance timeout: existing Node.js-side timeout (request.timeout_ms + 5000ms grace) from Phase 3 applies

### Claude's Discretion

- Code pinning and hot-reload strategy (version snapshot timing, lookup mechanism)
- Execution log detail level (what goes in log entry vs. what stays on instance record)
- Exact queued-state representation in the state machine
- Worker assignment and pool drain mechanics when pool size changes

</decisions>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

_Phase: 04-execution-engine_
_Context gathered: 2026-02-26_
