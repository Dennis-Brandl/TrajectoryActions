# Phase 6: Management API - Context

**Gathered:** 2026-02-27
**Status:** Ready for planning

<domain>
## Phase Boundary

Complete /management/v1/ endpoint surface for the console — package upload (.WFenvir/.WFaction), environment/action browsing, code version management, instance monitoring, execution log querying, dashboard, and settings CRUD. This is the backend that Phase 7's React console will call.

</domain>

<decisions>
## Implementation Decisions

### Package upload behavior

- Re-upload of existing package (same OID) performs upsert and returns a diff summary showing what changed (added/removed/modified actions)
- All-or-nothing transaction — if any action in a package fails validation, the entire upload is rejected with detailed errors
- Strict schema validation — validate structure, required fields, OID format, parameter types; reject anything malformed with specific error messages
- Re-upload is a full sync — actions present in the DB but absent from the new package are deleted (not orphaned)

### Code management workflow

- Dry-run supports two modes: syntax check only (default, no body needed), or full execution with test inputs/props if provided in the request body
- Rollback reactivates the old version directly (flips the active flag) — no new version row created; version history is not append-only for rollbacks
- Code list endpoint returns metadata only (version number, date, active flag, code size); separate GET endpoint fetches full source for a single version
- Cannot delete the currently active version — must activate another version first, then delete

### Dashboard & monitoring data

- Container info includes runtime info (uptime, Node.js version, Python version, DB path/size) plus resource usage (memory, CPU load, open connections)
- Separate active instances endpoint (currently running) and history endpoint (terminal instances) — not a unified list
- Instance and log responses are enriched with environment_name and action_name alongside IDs — console doesn't need extra lookups
- Recent log entries on dashboard are configurable — accepts optional count/timeframe params, defaults to last 10

### Response conventions

- Same structured error format as Trajectory protocol: {code, message, details} — consistent across the entire server, one error handler
- Management API is open / no auth — internal-only behind network boundary
- List endpoints support client-controlled sorting: ?sort=field&order=asc|desc
- Same error format — no extended fields for management; validation errors use the details field

### Claude's Discretion

- Pagination style (offset-based vs cursor-based)
- Exact query parameter names for filtering
- Response envelope structure (bare array vs {data, total, ...})
- Upload file parsing implementation details

</decisions>

<specifics>
## Specific Ideas

- Diff summary on re-upload should clearly show added/removed/modified actions so the console can display a meaningful confirmation
- Dashboard should feel operational — uptime, pool health, recent activity at a glance
- Enriched responses (names alongside IDs) to minimize round-trips from the console

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

_Phase: 06-management-api_
_Context gathered: 2026-02-27_
