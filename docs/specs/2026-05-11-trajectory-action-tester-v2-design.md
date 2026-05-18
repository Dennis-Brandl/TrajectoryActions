# Trajectory Action Tester v2 — Design Spec

**Date:** 2026-05-11
**Status:** Approved — ready for plan breakdown
**Phase:** v2 Phase 4 (and beyond — L3/L4 designed but deferred)
**Location:** `C:\TrajectoryActionTester\` (fresh Vite scaffold replacing the existing single-HTML version at `C:\ActionContainerTester\`)

---

## 1. Overview

A standalone single-file HTML React app that connects to any Trajectory Action Container REST implementation and lets a developer browse, invoke, monitor, and control action instances across one or more containers. Universal debugging tool — not coupled to this repo's container implementation.

The existing tester at `C:\ActionContainerTester\index.html` (1016-line single HTML file, plain JS) is functionally complete but architecturally a dead end. This rebuild is driven primarily by **UX polish and universal distribution**: external developers writing Trajectory-compatible containers in other languages should get a polished tester they can use against their own implementations.

---

## 2. Goals & Scope

The spec covers four layers. Phase 4 implements L1 + L2. L3 and L4 are designed-in so their architectural needs don't force a retrofit, but their implementation is deferred to later milestones.

### L1 — Polished Parity

- Multi-container connections persisted to `localStorage` (URL, optional name, optional API key).
- Action browser grouped by visibility (observable / opaque).
- Invoke form generated from the action's input parameter specs, with default-fill.
- SSE state monitoring with timeline of state transitions.
- ISA-88 command bar (state-aware enabling).
- Output display with key/value rendering.
- Error and traceback display on failure terminals.
- Single-file build artifact deliverable from `npm run build`.

### L2 — Visualization

- Live ISA-88 state diagram (top-down vertical) — observable and opaque variants matching `packages/engine/src/state-machine/states.ts` (observable: 14 states; opaque: 4 happy-path states + ABORTING / ABORTED / STOPPING reachable via commands).
- Click a past state in the diagram → RHS log inspector jumps to that state.
- Per-state collapsible log inspector with stdout, stderr, and traceback.
- Output deltas highlighted with brief flash as SSE events arrive.

### L3 — Scenario Save/Replay (designed, deferred)

- Save an invocation (action ref + input parameters + state-based command sequence + expected terminal) as JSON.
- Persist scenarios in `localStorage`; export/import as `.json` files for sharing.
- Replay against the active connection: invoke action, fire commands at scheduled state transitions, compare terminal + outputs to expectations.

### L4 — Batch + Assertions (designed, deferred)

- Run a scenario N times in parallel (with concurrency cap) or sequentially.
- Aggregate pass/fail based on assertion checks (terminal state match + partial output match).
- Per-iteration result table with drill-down to each instance's log.
- Export results as CSV.

### Success Criteria

1. Open the single HTML file → connect to any compliant container → invoke and monitor an action end-to-end without reading docs.
2. Watch state transitions and per-state log/output deltas in real time during EXECUTING.
3. Diagnose a failed action without leaving the tester (error summary, traceback, stderr all visible).
4. Architecture supports L3/L4 without retrofit.

---

## 3. Non-Goals

- **No action code authoring.** That belongs in the Trajectory management console.
- **No persistence beyond `localStorage`.** No server-side state, no shared sessions.
- **No per-invoke property overrides.** The Trajectory REST `/invoke` endpoint (current path `/trajectory/v1/...` in code) does not accept property overrides; the tester respects that. Users wanting different property values edit the environment via the management console.
- **No multi-user / collaboration features.** Single-user local tool.
- **No CI integration.** L4 batch runs are a manual testing aid, not a build-pipeline runner.
- **No state-history-contains or log-content-regex assertions** in the L4 model. JSON format reserves these keys for future expansion; only `terminal_state` and `outputs` checks are designed for now.

---

## 4. Architecture

### Tech Stack

- **React 19** — UI framework, matches Trajectory monorepo conventions.
- **Vite 6** with `vite-plugin-singlefile` — bundles all JS/CSS into one `dist/index.html`.
- **TypeScript strict** — same posture as the rest of the codebase.
- **`@tanstack/react-query`** — server-state caching for `/capabilities` and `/instances/:id` polled-fallback fetches.
- **React Context + `useReducer`** — client state (connections, active selection, scenarios, batch runs). Split into multiple contexts to keep re-render scope tight.
- **EventSource + plain React state** — SSE streams don't fit TanStack Query's request/response model; the `useInstanceStream` hook owns the EventSource lifecycle and reduces events into a typed shape.
- **Vanilla CSS Modules** — no Tailwind, no design-system library. Dark-by-default palette inspired by VS Code: `#1e1e1e` bg, `#252526` panels, `#d4d4d4` body, `#4ec9b0` primary accent.
- **Vitest + React Testing Library** — unit, hook, and component tests.
- **MSW (Mock Service Worker)** — used by one integration test that exercises the connect → invoke → SSE → terminal flow against a mock container.
- **ESLint flat config + Prettier** — mirroring the monorepo.

### Folder Layout

```
TrajectoryActionTester/
├── src/
│   ├── api/                # fetch wrappers, EventSource hook
│   ├── store/              # context + reducers
│   │   ├── connections.tsx
│   │   ├── active-instance.tsx
│   │   ├── scenarios.tsx   # L3
│   │   └── batch-runs.tsx  # L4
│   ├── components/         # generic primitives
│   │   ├── Button.tsx
│   │   ├── Modal.tsx
│   │   ├── TextInput.tsx
│   │   ├── Select.tsx
│   │   ├── Tree.tsx
│   │   ├── Pill.tsx
│   │   └── JsonView.tsx
│   ├── features/
│   │   ├── connection-bar/
│   │   ├── sidebar/
│   │   │   ├── ConnectionList.tsx
│   │   │   ├── ActionTree.tsx
│   │   │   ├── InstanceList.tsx
│   │   │   ├── ScenarioList.tsx     # L3
│   │   │   └── BatchRunsList.tsx    # L4
│   │   ├── invoke-panel/
│   │   ├── instance-panel/
│   │   │   ├── StateDiagram.tsx
│   │   │   ├── StateTimeline.tsx
│   │   │   ├── CommandBar.tsx
│   │   │   └── OutputsView.tsx
│   │   ├── log-inspector/
│   │   ├── scenario-panel/  # L3
│   │   └── batch-panel/     # L4
│   ├── lib/
│   │   ├── state-machine.ts   # ISA-88 constants, transition tables
│   │   ├── output-diff.ts
│   │   └── action-resolve.ts
│   ├── App.tsx
│   └── main.tsx
├── vite.config.ts
├── tsconfig.json
├── package.json
└── README.md
```

### Context Boundaries

Five independent contexts, each with its own reducer:

| Context                 | Scope                                             | Persistence                                    |
| ----------------------- | ------------------------------------------------- | ---------------------------------------------- |
| `ConnectionsContext`    | Saved connections, active connection ID           | `localStorage`                                 |
| `CapabilitiesContext`   | `/capabilities` cache per connection              | TanStack Query (memory)                        |
| `ActiveInstanceContext` | Currently-focused instance ID + selection mode    | Session only                                   |
| `ScenariosContext` (L3) | Saved scenarios                                   | `localStorage`                                 |
| `BatchRunsContext` (L4) | Batch configs (persisted) + in-memory run history | Configs to `localStorage`; results memory-only |

Persistence helper: a single `useLocalStoragePersist(key, state)` hook that mirrors a context's state slice into `localStorage` via `useEffect`. Restored on mount via lazy initial state.

---

## 5. Component Breakdown

### Three-Pane Layout (VS Code style)

```
┌──────────────────────────────────────────────────────────────────────┐
│  ConnectionBar                                                       │
├────────────┬─────────────────────────────────┬───────────────────────┤
│            │                                 │                       │
│  Sidebar   │           MainView              │     LogInspector      │
│            │                                 │                       │
│            │                                 │                       │
└────────────┴─────────────────────────────────┴───────────────────────┘
```

### Top Bar — `<ConnectionBar />`

- Indicator dot (green=connected / red=disconnected / amber=connecting) + active connection URL.
- Quick switcher dropdown — list of saved connections; click to switch active.
- "＋ Add connection" → opens `<ConnectionModal />`: URL + optional name + optional API key, persisted to `ConnectionsContext`.
- Inline edit/delete on each row in the dropdown.

### LHS — `<Sidebar />`

Up to five collapsible sections, each independently expand/collapse-able. L1+L2 ships sections 1–3; L3 and L4 add the remaining two.

1. **`<ConnectionList />`** — saved connections; active highlighted.
2. **`<ActionTree />`** — actions for the active connection, grouped by visibility. Click selects.
3. **`<InstanceList />`** — recent + active instances for the active connection. Color-coded by terminal (green=COMPLETED, red=ABORTED, amber=running). Capped at 50 most recent in memory.
4. **`<ScenarioList />`** (L3) — saved scenarios. Hidden until L3 ships.
5. **`<BatchRunsList />`** (L4) — saved batch configs. Hidden until L4 ships.

### Center — `<MainView />`

Switches between three modes based on `ActiveInstanceContext.mode`:

- **Action mode** — `<InvokePanel />`:
  - Action name + visibility pill.
  - Input parameter form with default-fill, type-aware inputs.
  - Read-only display of env + action property specs (informational).
  - "Invoke" button. On success: switches to instance mode for the new instance.
- **Instance mode** — `<InstancePanel />`:
  - Instance ID, current state pill, error summary if applicable.
  - `<StateDiagram />` (L2) — top-down ISA-88 diagram.
  - `<StateTimeline />` — horizontal pill row of history with per-state duration.
  - `<CommandBar />` — PAUSE/RESUME/HOLD/UNHOLD/ABORT/STOP/CLEAR buttons. Each button enabled iff the command is valid for the current state (state-machine table lookup).
  - `<OutputsView />` — live key/value list with delta highlighting (L2).
- **Scenario mode** (L3) — `<ScenarioPanel />`.
- **Batch mode** (L4) — `<BatchPanel />`.

### RHS — `<LogInspector />` (L2)

One collapsible row per state entered. Auto-expands the currently-EXECUTING state and the most-recent terminal state.

Row contents when expanded:

- **stdout** — monospace, scrollable, max-height ≈ 8 lines. Empty → "(no output)".
- **stderr** — monospace, scrollable, red text. Hidden when empty.
- **traceback** — only when present. Red, monospace.
- **Copy** button — copies stdout + stderr + traceback as a single block.

---

## 6. L2 Visualization Details

### Data Flow

A single `useInstanceStream(connection, instanceId)` hook owns the `EventSource` for an instance. The hook reduces SSE events into:

```ts
interface InstanceLiveState {
  instance_id: string
  current_state: string
  state_history: StateEntry[] // { state, entered_at, duration_ms, stdout, stderr, traceback, error?, outputs_after }
  outputs: Record<string, string>
  latest_error?: string
  latest_traceback?: string
  terminal: boolean
}
```

The hook deduplicates polled fetches (via TanStack Query for the initial fetch and on disconnect-reconnect) with the live stream.

All L2 components consume this shape from a context layer scoped to the active instance.

### State Diagram (`<StateDiagram />`)

- Inline SVG, hardcoded coordinates, top-down vertical layout.
- Two variants, sourced from `packages/engine/src/state-machine/states.ts` and `transitions.ts`:
  - **Observable** (14 nodes): STARTING → EXECUTING → COMPLETING → COMPLETED, plus PAUSING/PAUSED/UNPAUSING, HOLDING/HELD/UNHOLDING, ABORTING/ABORTED, STOPPING, CLEARING.
  - **Opaque** (4 happy-path nodes + 3 recovery): POSTED → RECEIVED → IN_PROGRESS → COMPLETED, with ABORTING / ABORTED / STOPPING reachable via ABORT or STOP commands from any active opaque state.
- Node states:
  - Current: bright filled background + 2px border.
  - Past (in history): muted fill, normal text.
  - Unvisited active: outline only.
  - Terminal (ABORTED, COMPLETED — the only `TERMINAL_STATES` in `states.ts`): rounded rectangle to visually distinguish.
- Click handler: emits selected state up; parent jumps RHS log inspector to that row.
- Re-implemented standalone — the console's `ObservableDiagram`/`OpaqueDiagram` are _not_ ported (decoupling).

### State Timeline (`<StateTimeline />`)

- Horizontal strip below the diagram.
- One pill per state-history entry, in chronological order.
- Pill: state name, duration in ms, error indicator if `error` present.
- Hover: tooltip with `entered_at` ISO timestamp + error summary if applicable.
- Click: jump RHS log inspector to that state's row.

### Output Deltas (`<OutputsView />`)

- One row per output key: `key`, `value`, "last changed at <state>".
- On SSE event with new outputs: diff against previous snapshot.
  - Changed value → amber background flash, fading over 1s.
  - New key → green background flash, fading over 1s.
  - Removed key → strike-through, then removed after 1s.
- Toggle "show raw JSON" → swaps friendly view for `<JsonView />`.

---

## 7. L3 — Scenario Save/Replay (deferred)

### Scenario JSON Format

```jsonc
{
  "format_version": "1.0",
  "name": "PickItem happy path",
  "created_at": "2026-05-11T14:23:00Z",
  "action_ref": {
    "action_oid": "act-wh-pick-001",
    "local_id": "PickItem",
    "version": "1.0.0",
    "environment_oid": "env-warehouse-001",
  },
  "input_parameters": [
    { "name": "shelf_location", "value": "BIN-A1" },
    { "name": "item_sku", "value": "SKU-1001" },
  ],
  "command_sequence": [
    { "wait_for_state": "EXECUTING", "delay_ms": 500, "command": "HOLD" },
    { "wait_for_state": "HELD", "delay_ms": 200, "command": "UNHOLD" },
  ],
  "expected": {
    "terminal_state": "COMPLETED",
    "outputs": { "status": "0" },
  },
}
```

- Commands are **state-based**: each step fires once `wait_for_state` is entered, after the optional `delay_ms`.
- `expected.outputs` is a **partial match** — only the listed keys are checked.

### Action Resolution at Replay

1. Match `action_ref.action_oid` against the active connection's `/capabilities`.
2. If no OID match, search by `local_id` + `version`. If found: run with a warning banner (`Original OID … not found; matched by name+version to …`).
3. If neither matches: refuse to run, display "Action not found in this connection".

### Persistence

- All scenarios in `localStorage["acT:scenarios:v1"]` (single JSON array).
- Per-scenario "Export" → file download as `.json`.
- "Import" → file picker, parse, add to list. Duplicate name → append " (imported)".

### UI

- LHS `<ScenarioList />` — name + last-run badge (✓/✗/—).
- Center `<ScenarioPanel />` — editor: name, action_ref (display + re-bind button), input params editor, command-sequence editor (add/remove/reorder rows), expected outputs editor. "Save" persists. "Run" starts replay.
- During replay: same `<InstancePanel />` as live invoke, plus a step checklist showing each command's status (pending → fired → done) and final terminal-match + outputs-diff result.

### Runner — `useScenarioRunner` Hook

- Inputs: scenario, active connection.
- POST `/invoke` with `input_parameters`.
- Subscribe to SSE.
- On each `state_change` event: scan pending command steps; if a step's `wait_for_state` matches, schedule `setTimeout(delay_ms)` then POST `/commands` with that command.
- On terminal: compute `pass = terminal_state matches AND every listed output matches`. Emit result with diff details.

---

## 8. L4 — Batch + Assertions (deferred)

### Batch Config JSON

```jsonc
{
  "format_version": "1.0",
  "name": "PickItem reliability ×50",
  "scenario_ref": "scn-pickitem-happy", // localStorage ID; portable form embeds scenario inline
  "iterations": 50,
  "execution": "parallel", // or "sequential"
  "concurrency": 2, // honored only for parallel
  "stop_on_first_failure": false,
}
```

### Assertion Model

Reuses the scenario `expected` shape:

- `terminal_state` — strict match.
- `outputs` — partial match (only listed keys, string equality).

Reserved-but-not-implemented keys (stub in JSON so format can grow):

- `state_history_contains`: `string[]`
- `log_contains`: `string[]`
- `duration_ms_max`: `number`

### Runner — `useBatchRunner` Hook

- Sequential mode: each iteration waits for prior's terminal before invoking next.
- Parallel mode: classic semaphore — at most `concurrency` running at once.
- `stop_on_first_failure` — if true, abort remaining iterations after first failure.
- Aggregates per-iteration: `{ iteration, instance_id, terminal_state, pass, output_diff, error? }`.
- Live progress: `done / total`, `pass / fail`, ETA based on average iteration time so far.

### Storage Discipline

- Saved batch _configs_: persisted to `localStorage["acT:batch-configs:v1"]`.
- Batch _run results_: **in-memory only**. Session-scoped. Otherwise localStorage bloats. CSV export is the artifact you save.

### UI

- LHS `<BatchRunsList />` — saved configs with last-run summary (`48/50 pass`).
- Center `<BatchPanel />` — config editor (scenario picker, iterations, parallel/sequential, concurrency, stop-on-fail toggle). "Run" → progress meter + sortable result table.
- Failed-iteration rows clickable → opens `<InstancePanel />` for that iteration's instance_id.
- "Export results" → CSV download.

---

## 9. Build & Distribution

### Single-File Output

- `vite-plugin-singlefile` inlines all JS, CSS, and assets into one `dist/index.html`.
- File opens via `file://` URL in any modern browser — no server required.
- Target bundle size: ≤ 200 KB gzipped (React + ReactDOM dominates).
- Version meta tag in `<head>` for debugging: `<meta name="acT-version" content="0.1.0">`.

### CORS

- Tester runs from `file://` or `localhost`. Containers must enable CORS (`Access-Control-Allow-Origin: *` or appropriately scoped).
- The Trajectory container does this today. External containers must too — call out in README.

### EventSource + Optional API Key

- Standard `EventSource` does not send custom headers.
- If a container gates SSE on auth, it must accept the API key via `?token=...` query string (in addition to or instead of `Authorization` header).
- The Trajectory container does not gate SSE on auth today, so this is theoretical for L1 but documented in README.

### Release Channel

- Recommend GitHub Releases: `index-v0.1.0.html` attached per release.
- Decision deferred until first ship. Spec just requires "single-file artifact published per version".

### Dev Workflow

| Command           | Effect                                             |
| ----------------- | -------------------------------------------------- |
| `npm run dev`     | Vite dev server on a free port; hot-reload.        |
| `npm run build`   | Single-file `dist/index.html`.                     |
| `npm run preview` | Serves the built artifact for a sanity smoke test. |
| `npm test`        | Vitest run, unit + component + integration.        |
| `npm run lint`    | ESLint flat config.                                |

---

## 10. Testing Strategy

### Unit Tests (Vitest)

- **Hooks:** `useInstanceStream` (SSE event reducer), `useScenarioRunner` (command scheduling logic), `useBatchRunner` (semaphore behavior, stop-on-fail).
- **Reducers:** each Context's reducer — connection CRUD + select, scenario CRUD, batch run lifecycle.
- **Helpers in `src/lib/`:** state-machine constants, output-diff computation, action-resolve fallback logic.

### Component Tests (Vitest + React Testing Library)

- `<InvokePanel />` — renders specs correctly, validates required inputs, submits with the right body shape.
- `<StateDiagram />` — highlights current state for both observable and opaque variants; click handler fires.
- `<LogInspector />` — expands on click, renders stdout/stderr/traceback, copy button writes to clipboard.
- `<OutputsView />` — flashes deltas when fed simulated SSE event sequences.
- `<CommandBar />` — buttons enable/disable correctly per current state.

### Integration Tests

- One end-to-end test using MSW to mock the container:
  - Connect to mock URL.
  - Browse capabilities, select an action.
  - Invoke with input parameters.
  - Mock streams SSE events: STARTING → EXECUTING → COMPLETING → COMPLETED with sample stdout and outputs.
  - Assert: state diagram highlights correctly at each step, log inspector populates, outputs row reflects values, instance ends in COMPLETED.

### No Browser E2E for Phase 4

- Single-file build is easy enough to smoke-test manually.
- Revisit Playwright/similar if L4 ships and we need regression coverage of the full tester.

### Coverage Target

- 70% line coverage for L1 + L2 implementation.
- L3 and L4 — hook-level unit tests only (their UIs aren't built yet).

---

## 11. Plan Breakdown for Phase 4

L1 + L2 implementation across six focused plans. Each plan should land as an atomic commit pair (implementation + tests).

| #    | Plan                                     | Deliverable                                                                                                                                                                                                                                                                                                        | Depends on |
| ---- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- |
| 4-01 | Vite scaffold + dev infra                | Fresh project at `C:\TrajectoryActionTester\`, TS strict, `vite-plugin-singlefile`, ESLint flat config, Vitest, README. Empty app shell rendering. Single-file build produces valid `dist/index.html`. The obsolete `C:\ActionContainerTester\` directory is removed.                                              | —          |
| 4-02 | Connection management + Capabilities API | `ConnectionsContext` (persisted via `useLocalStoragePersist`), add/edit/delete connection modal, TanStack Query fetch of `/capabilities`, `<ConnectionBar />` + `<ConnectionList />`, error states (network failure, 4xx, 5xx).                                                                                    | 4-01       |
| 4-03 | Action browser + Invoke (L1)             | `<ActionTree />` LHS, `<InvokePanel />` center, input form generation from specs, POST `/invoke`. After invoke, switches to a minimal "instance created" placeholder showing instance_id and current state polled once via `GET /instances/:id`. `<InstanceList />` LHS section starts tracking invoked instances. | 4-02       |
| 4-04 | Instance monitoring + SSE (L1)           | `useInstanceStream` hook with EventSource lifecycle, full `<InstancePanel />` center mode (replaces the 4-03 placeholder), `<StateTimeline />`, `<CommandBar />`, basic `<OutputsView />` without flash, error/traceback display.                                                                                  | 4-03       |
| 4-05 | State diagram + log inspector (L2)       | `<StateDiagram />` for observable + opaque variants (top-down SVG), `<LogInspector />` RHS pane, click-to-jump linkage between diagram/timeline and log rows.                                                                                                                                                      | 4-04       |
| 4-06 | Output deltas + polish (L2)              | Delta highlighting in `<OutputsView />`, raw-JSON toggle, theme polish pass, single-file build size budget check (≤ 200 KB gz), README pass, version meta tag.                                                                                                                                                     | 4-04       |

**Sequencing:**

- Wave A (strictly sequential): 4-01 → 4-02 → 4-03 → 4-04.
- Wave B: 4-05 and 4-06 share files (`OutputsView`, `InstancePanel`) so default to sequential 4-05 → 4-06. Parallel only if reviewer is willing to absorb merge effort.

**L3 (Scenario) and L4 (Batch) become separate phases in a later milestone** — roughly 3-4 plans each, designed in this spec.

---

## 12. Open Questions / Risks

1. **Release channel** — GitHub Releases vs `releases/` folder in repo. Decision deferred to first ship.
2. **API key conventions across third-party containers** — header name, query param name. The spec assumes `Authorization: Bearer <token>` for HTTP and `?token=<token>` for SSE; if a third-party container uses something else, the connection model needs to grow. Defer until we see one.
3. **Single-file bundle size at L3+L4** — adding scenario + batch panels may push past 200 KB gz. Re-measure when L3 lands; if over, consider code-splitting (single-file build supports it via inline chunks).
4. **Action-name conflicts during action_ref fallback** — two actions with the same `local_id` + `version` but different OIDs in the same connection: pick first match and warn, or refuse. Default: refuse with explicit error.
5. **Re-rendering at scale** — context-based state, when an instance receives 100+ SSE events, will cause `<OutputsView />` and `<LogInspector />` to re-render frequently. Mitigation if observed: memoize row components on `state_history` slice identity.

---

## 13. Decision Log

| Decision                                                                                         | Rationale                                                                                                                                                                |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Single-file HTML build (not dev-server or hosted)                                                | Preserves the existing tester's zero-install UX; matches "universal" goal for external users.                                                                            |
| Replace existing `C:\ActionContainerTester\` with fresh scaffold at `C:\TrajectoryActionTester\` | Clean slate; old HTML version doesn't share architecture. Project rename to Trajectory Action Tester applied at the same time.                                           |
| Three-pane VS Code layout                                                                        | LHS for navigation across connections + instances; RHS for log inspector at all times; supports L3/L4 navigation without retrofit.                                       |
| IDE dark theme                                                                                   | Developer tool aesthetic; matches expected audience (developers writing containers).                                                                                     |
| Multi-container connections in LHS                                                               | Supports comparing dev vs prod containers; per-connection action/instance history.                                                                                       |
| Vanilla CSS Modules (no Tailwind)                                                                | Minimize deps and bundle size; small app doesn't need utility-class framework.                                                                                           |
| React Context (no Zustand)                                                                       | Idiomatic React; multiple narrow contexts keep re-render scope tight; small persistence helper covers localStorage sync.                                                 |
| Keep TanStack Query                                                                              | Caching, dedup, retry, polling pause-on-hidden for `/capabilities` and fallback `/instances/:id` polling.                                                                |
| EventSource for SSE (not TanStack Query)                                                         | TanStack doesn't model long-lived streams well; raw EventSource + React state is the cleanest pattern.                                                                   |
| State-based commands in scenarios (not time-based)                                               | Robust to action duration variance; covers all observable transitions. Opaque actions with no observable state changes are an L3 edge case — re-evaluate when first hit. |
| In-memory batch run results                                                                      | Avoid localStorage bloat; CSV export is the persistence story.                                                                                                           |
| No per-invoke property overrides                                                                 | Not in Trajectory REST protocol today; scope kept lean. Workaround for now: edit env via management console.                                                             |
| Re-implement state diagrams (not port from console)                                              | Decoupling goal; console diagrams stay in console.                                                                                                                       |
