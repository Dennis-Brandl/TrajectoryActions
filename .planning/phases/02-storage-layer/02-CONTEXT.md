# Phase 2: Storage Layer - Context

**Gathered:** 2026-02-25
**Status:** Ready for planning

<domain>
## Phase Boundary

A fully functional SQLite persistence layer with all six repositories (Environment, Action, CodeVersion, Instance, Log, Settings), a migration system, and transaction support. Every other package depends on this for reliable data access. Schema and infrastructure are defined in StorageSpec.md — this phase builds exactly that, plus the behavioral decisions captured below.

</domain>

<decisions>
## Implementation Decisions

### Re-upload delta handling

- When an environment is re-uploaded, actions that were in the previous version but are NOT in the new package are cascade-deleted (actions + their code versions)
- When an existing action is updated via re-upload (same OID, new specs), all existing code versions are preserved — only the action specs (parameters, properties, description) are updated
- Upload response includes a detailed diff: lists of added actions, removed actions, and updated actions with what changed — not just a summary
- If re-upload would delete actions that have running instances: proceed with the upload but skip deleting those actions; return a warning listing what couldn't be removed; operator can clean up later

### Settings constraints and side effects

- `python_pool_size`: any positive integer (>= 1), no upper cap — trust the operator
- `python_pool_size` changes take effect immediately — pool scales up (spawn new workers) or down (drain excess workers after they finish current work)
- `execution_timeout_ms`: minimum floor of 1000ms enforced; prevents sub-second timeouts that would kill every execution
- `instance_retention_hours`: when reduced, trigger an immediate cleanup pass — instances beyond the new retention are purged right away, don't wait for the 15-minute cycle
- `log_max_size`: per StorageSpec, excess entries trimmed immediately on setting reduction (already specified)

### Code preservation on delete/update

- When an environment is deleted via MGMT-05, archive all code versions to a single JSON file before cascade-delete: `/data/archives/{timestamp}_{oid}_{localId}.json`
- Archive format: one JSON file per environment containing all actions and all their code versions
- Re-upload does NOT archive removed actions — re-upload is an intentional update, and the original package file is already in `/data/uploads/`
- Archives auto-cleanup after 30 days — a cleanup job removes archive files older than 30 days to prevent long-term accumulation

### Claude's Discretion

- Repository method signatures and return types
- Error handling patterns (custom error types, error codes)
- Migration file naming convention beyond "numbered TypeScript files"
- Dev-time database file location and reset workflow
- Test data seeding strategy
- Archive JSON schema structure

</decisions>

<specifics>
## Specific Ideas

- Re-upload should feel like a "smart update" — preserve work (code versions) but respect the new package definition as the source of truth for structure
- Settings changes should feel responsive — no "restart required" friction for the operator
- Code archives are a safety net, not a feature — simple JSON dump is fine, no need for fancy export format

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

_Phase: 02-storage-layer_
_Context gathered: 2026-02-25_
