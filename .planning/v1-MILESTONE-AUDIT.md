---
milestone: v1
audited: 2026-02-27
status: gaps_found
scores:
  requirements: 79/85
  phases: 7/7
  integration: 20/23
  flows: 3/5
gaps:
  requirements:
    - 'UI-08: Code editor state selector shows wrong state names (EXECUTE→EXECUTING, COMPLETE→COMPLETED, RESUMING→UNPAUSING, plus phantom RESETTING/STOPPED)'
    - 'UI-08: Code editor OPAQUE_CODE_STATES uses observable-style names (STARTING/STOPPING/ABORTING/CLEARING) instead of actual opaque states (POSTED/RECEIVED/IN_PROGRESS)'
    - 'UI-10: Test panel shows param.id (OID) without human-readable name for input/output parameters'
    - 'UI-12: Code template does not include input parameter definitions, output parameter definitions, or action property definitions in comments'
    - 'UI-14: Instance detail state timeline renders blank — server sends {state, timestamp} but console expects {to_state, from_state, triggered_by, timestamp}'
    - 'ENG-07: Execution timeout cannot be disabled (minimum 1000ms enforced); no per-action timeout override; UI shows ms instead of seconds'
  integration:
    - 'Code editor OBSERVABLE_CODE_STATES mismatch: 5 wrong names vs engine states.ts — code saved to wrong state names will never execute'
    - 'StateHistoryEntry type mismatch: storage writes {state, timestamp}, console types.ts declares {to_state, from_state, triggered_by, timestamp}'
    - 'ActionDetailPage CODE_STATES has same wrong names as CodeEditorPage'
    - 'Timeout system has no disable path (0 = off) and no per-action granularity — blocks testing workflows'
  flows:
    - 'Code Authoring Flow: breaks at step 3 — wrong state names in dropdown'
    - 'Instance Control Flow: partial — commands work, state timeline display blank'
    - 'Testing Flow: timeout cannot be disabled, making long-running test executions impossible'
tech_debt:
  - phase: 07-management-console
    items:
      - 'vite-plugin-monaco-editor skipped — Monaco uses CDN loading, no local worker bundling'
      - 'db_size_bytes omitted from Settings Container Info — not in DashboardResponse TypeScript type'
      - "management.test.ts has incorrect SCRIPT_PATH (4 levels up) — tests pass only because they don't execute Python"
  - phase: 05-Trajectory-rest-protocol
    items:
      - 'cancelInstance not re-exported from @trajectory/engine index.ts (works via class type but not individually importable)'
  - phase: 03-state-machine-python-sidecar
    items:
      - 'Vitest discovers both src/ and dist/ test files — doubles test count in engine package'
---

# v1 Milestone Audit Report

## Overview

All 7 phases completed across 19 plans with 85 requirements mapped. Six gaps found: two critical console bugs (wrong state names, broken timeline), plus timeout control limitations, missing opaque states, test panel UX issues, and insufficient code template context.

## Requirements Coverage

| Phase                      | Requirements       | Satisfied | Partial | Unsatisfied |
| -------------------------- | ------------------ | --------- | ------- | ----------- |
| 1. Project Setup           | SETUP-01–03        | 3         | 0       | 0           |
| 2. Storage Layer           | STORE-01–10        | 10        | 0       | 0           |
| 3. State Machine + Sidecar | SM-01–12, PY-01–04 | 16        | 0       | 0           |
| 4. Execution Engine        | ENG-01–10          | 9         | 1       | 0           |
| 5. REST Protocol           | REST-01–12         | 12        | 0       | 0           |
| 6. Management API          | MGMT-01–18         | 18        | 0       | 0           |
| 7. Management Console      | UI-01–16           | 12        | 0       | 4           |
| **Total**                  | **85**             | **78**    | **1**   | **6**       |

### Unsatisfied Requirements

**UI-08: Code editor page** — State selector dropdown presents wrong ISA-88 state names. Code saved to these states will never be found by the state machine at execution time.

| Console State | Correct Engine State | Status  |
| ------------- | -------------------- | ------- |
| `EXECUTE`     | `EXECUTING`          | WRONG   |
| `COMPLETE`    | `COMPLETED`          | WRONG   |
| `RESUMING`    | `UNPAUSING`          | WRONG   |
| `RESETTING`   | _(does not exist)_   | PHANTOM |
| `STOPPED`     | _(does not exist)_   | PHANTOM |
| _(missing)_   | `EXECUTING`          | MISSING |
| _(missing)_   | `COMPLETED`          | MISSING |
| _(missing)_   | `UNPAUSING`          | MISSING |

Files affected:

- `apps/console/src/features/code-editor/CodeEditorPage.tsx` lines 21–38 (`OBSERVABLE_CODE_STATES`)
- `apps/console/src/features/actions/ActionDetailPage.tsx` lines 16–31 (`CODE_STATES`)

**UI-14: Instance detail page** — State timeline visualization renders blank state names because the server-provided `state_history` entries have shape `{ state: string, timestamp: string }` but the console's `StateHistoryEntry` type expects `{ to_state: string, from_state: string | null, triggered_by: string, timestamp: string }`.

Files affected:

- `apps/console/src/lib/types.ts` lines 283–288 (`StateHistoryEntry` interface)
- `apps/console/src/features/instances/InstanceDetailPage.tsx` lines 92, 99 (references `entry.to_state`)

**UI-08: Code editor — opaque action states wrong** — `OPAQUE_CODE_STATES` uses observable-style state names (`STARTING`, `STOPPING`, `ABORTING`, `CLEARING`) instead of the actual opaque states defined in the engine (`POSTED`, `RECEIVED`, `IN_PROGRESS`, `COMPLETED`). Opaque actions cannot have code authored for their real states.

Actual opaque states (engine `states.ts`): `POSTED | RECEIVED | IN_PROGRESS | COMPLETED`
Console presents: `STARTING | STOPPING | ABORTING | CLEARING` (these are observable states)

Files affected:

- `apps/console/src/features/code-editor/CodeEditorPage.tsx` line 41 (`OPAQUE_CODE_STATES`)
- `apps/console/src/features/actions/ActionDetailPage.tsx` line 160 (opaque state subset)

**UI-10: Test panel missing parameter names** — The code test panel (`TestPanel.tsx`) shows `param.id` (OID) as the input field label but no human-readable parameter name. Output parameters are not labeled at all in test results — outputs are dumped as raw JSON without mapping back to output parameter names/descriptions.

Files affected:

- `apps/console/src/features/code-editor/TestPanel.tsx` line 58 (uses `param.id` only)
- `apps/console/src/features/code-editor/TestPanel.tsx` lines 108–115 (raw JSON dump for outputs)

**UI-12: Code template lacks parameter/property context** — When generating the auto-template for a state with no code, or when using the test panel, the editor does not include input parameter definitions, output parameter definitions, or action property definitions as comments. Developers editing code have no visibility into what parameters are available without navigating to the action detail page.

Files affected:

- `apps/console/src/features/code-editor/CodeEditorPage.tsx` `generateTemplate()` function (line 43)
- `apps/console/src/features/code-editor/TestPanel.tsx` (no parameter context in test flow)

**ENG-07 / UI-16: Timeout control insufficient** — The execution timeout system has three gaps:

1. **Cannot disable timeout**: `SettingsRepository` enforces `execution_timeout_ms >= 1000` — there is no way to set `0` to disable the timeout entirely, which is required for testing long-running actions
2. **No per-action timeout**: Timeout is a global setting only. No mechanism to override timeout at the action level (e.g., from environment detail or action properties). Testing a slow action requires changing the global setting for all actions.
3. **UI shows milliseconds**: Settings page displays `execution_timeout_ms` with unit label "ms per state" — should present the value in seconds for human readability

Files affected:

- `packages/storage/src/repositories/settings.repository.ts` lines 22–24 (minimum 1000 enforced)
- `packages/engine/src/python-pool/pool.ts` line 205 (timeout always applied)
- `apps/console/src/features/settings/SettingsPage.tsx` lines 29–33 (ms unit label)
- No per-action timeout field exists in storage schema, action properties, or management API

## Phase Status

| Phase                      | Plans | Status   | Verification                           |
| -------------------------- | ----- | -------- | -------------------------------------- |
| 1. Project Setup           | 2/2   | Complete | No VERIFICATION.md (verifier disabled) |
| 2. Storage Layer           | 3/3   | Complete | No VERIFICATION.md (verifier disabled) |
| 3. State Machine + Sidecar | 3/3   | Complete | No VERIFICATION.md (verifier disabled) |
| 4. Execution Engine        | 2/2   | Complete | No VERIFICATION.md (verifier disabled) |
| 5. REST Protocol           | 2/2   | Complete | No VERIFICATION.md (verifier disabled) |
| 6. Management API          | 3/3   | Complete | No VERIFICATION.md (verifier disabled) |
| 7. Management Console      | 4/4   | Complete | No VERIFICATION.md (verifier disabled) |

## Cross-Phase Integration

### Connected (20/23)

| Connection                                           | Status    |
| ---------------------------------------------------- | --------- |
| Storage → Engine (all 6 repositories)                | CONNECTED |
| Engine → Server (InstanceManager)                    | CONNECTED |
| SSE callbacks (onStateChange, onTerminal, onError)   | CONNECTED |
| Settings → Pool resize (manager.resizePool)          | CONNECTED |
| Settings → Log trim (logRepo.trimToSize)             | CONNECTED |
| Console api.ts → Server routes (22 endpoints)        | CONNECTED |
| Vite proxy (/trajectory, /management)                  | CONNECTED |
| Package import → environment/action storage          | CONNECTED |
| Code save → CodeVersionRepository.saveAndActivate    | CONNECTED |
| Invoke → InstanceManager → StateMachine → Python     | CONNECTED |
| StateMachine → InstanceRepository state updates      | CONNECTED |
| Terminal → ExecutionLogger → LogRepository           | CONNECTED |
| Command → InstanceManager.sendCommand → StateMachine | CONNECTED |
| SSE stream → SseManager ring buffer → client         | CONNECTED |
| Dashboard → poolStatus + repo counts                 | CONNECTED |
| Upload → multer → transaction → repos                | CONNECTED |
| Code test → testCode() → PythonWorkerPool            | CONNECTED |
| Auth middleware → /trajectory/v1/ routes               | CONNECTED |
| TypeScript project refs (storage→engine→server)      | CONNECTED |
| npm workspace symlinks (@trajectory/\*)              | CONNECTED |

### Broken (3/23)

1. **Code editor state names → engine state machine** — Console presents wrong states; code saved to them is unreachable
2. **Instance state_history shape → console type** — Server returns `{state, timestamp}`, console expects `{to_state, from_state, triggered_by, timestamp}`
3. **Action detail CODE_STATES → engine states** — Same mismatch as code editor

## E2E User Flows

| Flow                | Status   | Break Point                                                                              |
| ------------------- | -------- | ---------------------------------------------------------------------------------------- |
| Package Import      | COMPLETE | —                                                                                        |
| Code Authoring      | BROKEN   | Step 3: wrong state names in dropdown → code unreachable; opaque states also wrong       |
| Code Testing        | BROKEN   | No parameter context in editor; test panel lacks param names; timeout cannot be disabled |
| Action Invocation   | COMPLETE | —                                                                                        |
| Instance Control    | PARTIAL  | Commands work; state timeline renders blank                                              |
| Settings Management | PARTIAL  | Works but timeout lacks disable option and per-action granularity                        |

## Tech Debt

### Phase 7: Management Console

- vite-plugin-monaco-editor skipped — Monaco uses CDN loading instead of local worker bundling
- `db_size_bytes` omitted from Settings Container Info — not in `DashboardResponse` TypeScript type
- `management.test.ts` SCRIPT_PATH incorrect (4 levels up) — tests pass because they don't actually execute Python

### Phase 5: Trajectory REST Protocol

- `cancelInstance` not re-exported from `@trajectory/engine` index.ts — works via class type but not individually importable

### Phase 3: State Machine + Sidecar

- Vitest discovers both `src/` and `dist/` test files, effectively doubling the engine test count

### Design Note: Management API Authentication

`/management/v1/` routes have no auth middleware. This is **intentional per requirements** — AUTH-01/AUTH-02 are explicitly deferred to v2. Not a gap.

## Conclusion

Six gaps identified across two categories:

**Critical bugs (code won't work):**

1. Wrong observable state names in code editor/action detail (code saved to wrong states is unreachable)
2. Wrong opaque state names in code editor (observable names used instead of actual opaque states)
3. Instance detail state timeline renders blank (shape mismatch)

**Usability gaps (features incomplete):** 4. Timeout cannot be disabled and has no per-action override — blocks testing workflows 5. Test panel lacks human-readable parameter names for inputs and outputs 6. Code template doesn't include parameter/property definitions as comments — developers have no context

The server, engine, storage, and Python sidecar layers are fully integrated and working correctly. All gaps are in the console (Phase 7) and timeout system (Phase 4/Settings).

---

_Audited: 2026-02-27_
_Milestone: v1_
