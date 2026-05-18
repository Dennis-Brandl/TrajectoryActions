# Phase 5: Trajectory REST Protocol - Context

**Gathered:** 2026-02-26
**Status:** Ready for planning

<domain>
## Phase Boundary

Implement the /trajectory/v1/ HTTP endpoint surface that workflow clients use to invoke actions, monitor progress via SSE, send state commands, and query capabilities. This phase builds Express routes on top of the Phase 4 InstanceManager. Management endpoints (package upload, code management, settings) belong to Phase 6.

</domain>

<decisions>
## Implementation Decisions

### Response shape

- Envelope wrapper on all responses: `{ "data": {...}, "meta": {...} }` for single resources, `{ "data": [...], "meta": { "total": N } }` for collections
- Invoke (POST) returns minimal 201: `{ "data": { "instance_id": "..." } }` — client GETs for full state
- Instance GET uses nested state object: `state: { current, previous, entered_at }` alongside flat `inputs`, `outputs`, `created_at`

### SSE streaming design

- Event types: `state_change`, `output`, `log` (stdout/stderr from Python), `heartbeat`
- Default heartbeat interval: 30 seconds (configurable per action at the environment level, not at the master action spec level — same action may be fast in one environment and long-running in another)
- Ring buffer: 256 events per instance for reconnection replay via Last-Event-ID
- Terminal state behavior: emit terminal event (completed/aborted), keep stream open ~5-10 seconds for client to process, then server closes

### Error taxonomy

- String error codes in every error response: `{ "error": { "code": "INVALID_STATE_TRANSITION", "message": "...", "details": {...} } }`
- Validation errors: single combined message string (not field-level detail)
- Python traceback exposure: configurable via settings — default off, operators enable per environment security needs
- No request_id tracking — instance_id is sufficient for tracing

### Request conventions

- CORS: configurable allowed origins via settings, default to `*`
- Action identification: `POST /trajectory/v1/actions/{action_oid}/invoke` with `environment_oid` in request body
- Authentication: simple API key via `X-API-Key` header, key stored in settings
- Strict request validation: reject unknown fields with 400 error

### Claude's Discretion

- Field naming convention (camelCase vs snake_case) — pick what fits the existing codebase
- Exact HTTP status code mapping for each error type
- SSE event payload structure (field names, what's included per event type)
- Rate limiting or request size limits if needed

</decisions>

<specifics>
## Specific Ideas

- Two classes of actions exist: fast-completing (seconds) and long-running (days/weeks for equipment monitoring or external event waiting). SSE and heartbeat design must accommodate both extremes.
- Action execution timeout is environment-dependent — the same action definition runs differently in different environments (e.g., email+response in one, database call in another). Timeout should be optional and configurable per action within its environment, not at the master action specification level.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

_Phase: 05-Trajectory-rest-protocol_
_Context gathered: 2026-02-26_
