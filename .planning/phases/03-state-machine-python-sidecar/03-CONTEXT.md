# Phase 3: State Machine and Python Sidecar - Context

**Gathered:** 2026-02-25
**Status:** Ready for planning

<domain>
## Phase Boundary

The ISA-88 state machine drives action instances through their full observable and opaque state lifecycle, and the Python sidecar subprocess correctly executes user code and returns results over the stdin/stdout JSON protocol. The state transition table, command processing, JSON protocol, and Python code API are defined in StateMachineSpec.md and ExecutionEngineSpec.md.

</domain>

<decisions>
## Implementation Decisions

### Python sandbox boundaries

- Full Python access — user code can import anything installed in the container (stdlib, pip packages, everything)
- Unrestricted filesystem and network access — actions can read/write files, call APIs, talk to databases; the container is the security boundary
- Target Python 3.12+
- Code validation before execution: Claude's discretion (whether to check for `execute()` function existence and signature, or let natural Python errors surface)

### Hold retry strategy

- Manual UNHOLD only — when code returns False (code-initiated hold), the instance stays HELD until a workflow client or operator explicitly sends UNHOLD; no auto-retry timer
- HOLD command accepted from any active state (not just EXECUTING) — extends the spec diagram to match ABORT's flexibility
- When HOLD arrives during code execution: let current code finish first (graceful, like PAUSE), then transition to HOLDING
- Indefinite hold duration — no automatic timeout; instance stays HELD until explicitly UNHOLD'd or ABORT'd

### Error and output capture

- Two-tier error detail: full Python traceback stored on the instance (visible in management console), but workflow clients only see exception type + message
- stdout/stderr capture capped at a reasonable size (e.g., 64KB) to prevent memory issues from chatty code
- Detailed timeout errors: include timeout duration, elapsed time, and setting name (e.g., "Execution timed out after 60s (default_timeout_ms setting)")
- Distinct error types in sidecar responses: SYNTAX_ERROR, RUNTIME_ERROR, TIMEOUT, WORKER_CRASH — enables callers to handle different failures differently

### Claude's Discretion

- Code validation approach in sandbox_runner.py (check for execute() existence/signature vs natural errors)
- Exact stdout/stderr capture limit (suggested ~64KB)
- Internal error type classification logic

</decisions>

<specifics>
## Specific Ideas

- HOLD from any active state mirrors ABORT's "from any active" design — consistent command model
- Hold behavior is intentionally manual-only to keep the engine simple and give workflow clients full control over retry timing
- Error type classification (SYNTAX_ERROR, RUNTIME_ERROR, TIMEOUT, WORKER_CRASH) should be typed codes in the JSON protocol response, not just string messages

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

_Phase: 03-state-machine-python-sidecar_
_Context gathered: 2026-02-25_
