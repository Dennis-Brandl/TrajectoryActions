# Trajectory Action Tester — Plan 5: StateDiagram + LogInspector (L2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land spec § 6's L2 visualization layer on top of Plan 4-04's live stream — an inline-SVG `<StateDiagram />` (observable 14-node + opaque 4-happy + 3-recovery variants), a RHS `<LogInspector />` pane with one collapsible row per state entered (stdout / stderr / traceback / Copy), and click-to-jump linkage that ties diagram pills + timeline pills + log rows together via a shared `selectedStateIndex`. The SSE reducer is extended so `log` events attach to **the current state-history entry** (per-state logs, not just a global latest-error) and `state_change` events snapshot outputs into the just-finalized entry's `outputs_after`.

**Architecture:** A new `ActiveInstanceStreamProvider` wraps both MainView and the RHS inspector, calling `useInstanceStream(instanceId)` exactly once and providing the result via context — so the existing `<InstancePanel />` and the new `<LogInspector />` share a single EventSource. `selectedStateIndex` joins the existing `ActiveInstanceContext` (which already owns `selection` + `trackedInstances`); diagram-click and timeline-click both dispatch `selectStateIndex(n)`, and `<LogInspector />` reacts by expanding + scrolling to that row. `StateDiagram` and its variant tables/coordinates live in a new `src/lib/diagram-layout.ts` (re-coded standalone per spec § 6 — no imports from the engine, same discipline as `state-machine.ts` in Plan 4-04). The reducer's `state_change` arm finalizes the previous entry's `duration_ms` AND its `outputs_after`; its `log` arm now mutates the current entry's `stdout`/`stderr`/`traceback`/`error` fields (appending for stdout/stderr, replacing for traceback/error).

**Tech Stack:** No new npm dependencies. React 19 + TS strict, vanilla CSS Modules, Vitest 3 + RTL + user-event. Inline SVG for the diagram (no `d3`, no `react-flow`). `navigator.clipboard.writeText` for the Copy button (jsdom polyfill via test setup).

**Spec:** `docs/specs/2026-05-11-trajectory-action-tester-v2-design.md` — § 5 (LogInspector row contents, auto-expand behavior), § 6 (StateEntry shape with stdout/stderr/traceback/error/outputs_after, StateDiagram variants + node visual states + click handler, click-to-jump linkage), § 11 (Plan 4-05 deliverable scope).

**State-machine source of truth (re-coded standalone, NOT imported):**

- Observable transitions: `packages/engine/src/state-machine/transitions.ts:13-65` in TrajectoryActions (same source Plan 4-04's `src/lib/state-machine.ts` already mirrors).
- Observable states (14): STARTING, EXECUTING, COMPLETING, COMPLETED, PAUSING, PAUSED, UNPAUSING, HOLDING, HELD, UNHOLDING, ABORTING, ABORTED, CLEARING, STOPPING.
- Opaque states (4 happy + 3 recovery = 7): POSTED, RECEIVED, IN_PROGRESS, COMPLETED, ABORTING, ABORTED, STOPPING.
- `TERMINAL_STATES` (already known to the tester): COMPLETED, ABORTED.

---

## File Structure

This plan creates **5 new feature/lib files** (`diagram-layout.ts`, `StateDiagram`, `LogInspector`), **1 new context module** (`instance-stream-context.tsx`), and modifies **5 existing files** (types, reducer, active-instance context, InstancePanel, App).

| Path                                                  | Role                                                                                                                                                                                                                                                                               |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/api/types.ts`                                    | **Modify** — extend `StateEntry` with `stdout?: string`, `stderr?: string`, `traceback?: string`, `error?: string`, `outputs_after?: Record<string, string>`. Keep existing fields.                                                                                                |
| `src/store/instance-stream-reducer.ts`                | **Modify** — `state_change` arm now also writes `outputs_after` onto the previous entry. `log` arm attaches stream contents to the current (last) state entry instead of (or in addition to) the global `latest_*` fields.                                                         |
| `src/store/instance-stream-reducer.test.ts`           | **Modify** — extend with tests covering per-state log accumulation, outputs_after capture, multi-state log sequences.                                                                                                                                                              |
| `src/store/active-instance.tsx`                       | **Modify** — add `selectedStateIndex: number \| null` to state, `selectStateIndex(idx \| null)` action + API method. Reducer + provider + hook unchanged otherwise.                                                                                                                |
| `src/store/active-instance.test.tsx`                  | **Modify** — add reducer + provider tests for the new selectedStateIndex action.                                                                                                                                                                                                   |
| `src/store/instance-stream-context.tsx`               | `ActiveInstanceStreamProvider` + `useActiveInstanceStream()`. Provider calls `useInstanceStream(instanceId)` where instanceId is derived from `useActiveInstance().state.selection`. Throws when consumed outside provider.                                                        |
| `src/store/instance-stream-context.test.tsx`          | Provider + hook tests. Lifecycle: provider mount opens one EventSource; multiple consumers see the same state; outside-provider consumption throws.                                                                                                                                |
| `src/lib/diagram-layout.ts`                           | Re-coded standalone tables: `OBSERVABLE_DIAGRAM` and `OPAQUE_DIAGRAM`, each `{ width, height, nodes: DiagramNode[], edges: DiagramEdge[] }`. Hardcoded coordinates per spec § 6. Plus `getDiagramForVisibility(visibility)` selector.                                              |
| `src/lib/diagram-layout.test.ts`                      | Unit tests: every documented state is present in the right variant; node count matches spec (observable 14, opaque 7); edges cover all SC-auto + client-command transitions enumerated below.                                                                                      |
| `src/features/instance-panel/StateDiagram.tsx`        | Inline-SVG renderer. Props: `{ visibility, currentState, history, terminal, onSelectState }`. Computes per-node visual state (current / past / unvisited / terminal) from `history.map(e => e.state)`. Click on a node calls `onSelectState(state, indexInHistory \| null)`.       |
| `src/features/instance-panel/StateDiagram.module.css` | Node fill/stroke per visual state, edge stroke, terminal rounded-rectangle styling, hover affordance.                                                                                                                                                                              |
| `src/features/instance-panel/StateDiagram.test.tsx`   | Observable variant renders 14 nodes; opaque renders 7. Nodes have correct visual class per status. Click on a past-state node fires `onSelectState(state, indexOfFirstOccurrenceInHistory)`. Click on an unvisited node fires `onSelectState(state, null)`.                        |
| `src/features/instance-panel/InstancePanel.tsx`       | **Modify** — switch from `useInstanceStream(instanceId)` to `useActiveInstanceStream()`. Mount `<StateDiagram />` above `<StateTimeline />` inside the "State" section. Wire diagram + timeline click handlers to `selectStateIndex` via `useActiveInstance()`.                    |
| `src/features/instance-panel/InstancePanel.test.tsx`  | **Modify** — wrap test renders in `<ActiveInstanceStreamProvider>` so `useActiveInstanceStream` resolves. Add assertion that StateDiagram renders alongside StateTimeline.                                                                                                         |
| `src/features/log-inspector/LogInspector.tsx`         | RHS-pane component. Reads `useActiveInstanceStream()`. Renders one `<LogRow>` per `state_history` entry. Auto-expands: (a) the currently-EXECUTING (= last non-terminal) entry, (b) the last entry when `terminal === true`, (c) entries matching `selectedStateIndex`.            |
| `src/features/log-inspector/LogInspector.module.css`  | Pane layout, row layout (header + collapsible body), monospace blocks, scrollable code sections.                                                                                                                                                                                   |
| `src/features/log-inspector/LogInspector.test.tsx`    | Empty state (no instance selected → "Select an instance to see logs."). Renders a row per history entry. Auto-expand of EXECUTING. Click row toggles expand. `selectedStateIndex` from context expands+scrolls. Copy button calls `navigator.clipboard.writeText` with the bundle. |
| `src/App.tsx`                                         | **Modify** — wrap the main+inspector area in `<ActiveInstanceStreamProvider>`. Replace the `<p>Log inspector — coming in plan 4-05.</p>` placeholder with `<LogInspector />`.                                                                                                      |
| `src/App.test.tsx`                                    | **Modify** — assert the placeholder is gone; LogInspector mounts.                                                                                                                                                                                                                  |
| `src/vitest.setup.ts`                                 | **Modify** — install a jsdom `navigator.clipboard.writeText` stub (Vitest spy) so LogInspector's Copy button tests don't blow up.                                                                                                                                                  |
| `src/__tests__/integration.test.tsx`                  | **Modify** — append one `describe` block covering: invoke → STARTING → SSE state_change → SSE `log` (stderr w/ traceback) under EXECUTING → LogInspector row shows the log; then click the STARTING timeline pill → LogInspector expands STARTING row.                             |

After this plan, spec § 5 (RHS LogInspector) and § 6 (StateDiagram + click-to-jump linkage) are fully implemented for L2. Plan 4-06 handles the remaining L2 polish (OutputsView delta flash, raw-JSON toggle, version meta tag, single-file budget check).

---

## Pre-flight check

Before starting, confirm the tester repo is at a clean baseline:

```powershell
cd C:\TrajectoryActionTester
git log --oneline | Measure-Object -Line   # expect 76 lines (74 Plan 4-04 + 2 hot fixes)
git status                                   # expect "nothing to commit, working tree clean"
npm test                                     # expect 260 tests pass across 32 test files
```

If any fail, finish/fix prior work first. No new npm dependencies are required.

---

## Task 1: Extend `StateEntry` type with per-state log/error/outputs fields

**Files:**

- Modify: `C:\TrajectoryActionTester\src\api\types.ts`

Per spec § 6 line 225, the `StateEntry` shape includes `stdout`, `stderr`, `traceback`, `error?`, `outputs_after`. The current type only has `state`, `entered_at`, `duration_ms?`. Append the new fields as optional so existing reducer code paths that don't yet set them keep working.

- [ ] **Step 1: Edit `src/api/types.ts`**

Find the existing `StateEntry` block (introduced in Plan 4-04 Task 1):

```ts
export interface StateEntry {
  state: string
  entered_at: string
  /** Set when this entry is superseded by a newer state. Undefined while current. */
  duration_ms?: number
}
```

Replace with:

```ts
export interface StateEntry {
  state: string
  entered_at: string
  /** Set when this entry is superseded by a newer state. Undefined while current. */
  duration_ms?: number
  /** stdout accumulated by `log` events while this state was current. */
  stdout?: string
  /** stderr accumulated by `log` events while this state was current. */
  stderr?: string
  /** Traceback extracted from stderr (any line starting with `Traceback (most recent call last)`). */
  traceback?: string
  /** Short error summary for this state — currently mirrors the last stderr message containing a traceback. */
  error?: string
  /** Outputs snapshot captured when this state was superseded. Undefined while current. */
  outputs_after?: Record<string, string>
}
```

- [ ] **Step 2: Typecheck**

```powershell
cd C:/TrajectoryActionTester
npm run typecheck
```

Expected: exit 0.

- [ ] **Step 3: Commit**

```powershell
git add src/api/types.ts
git commit -m "feat(api): StateEntry gains stdout/stderr/traceback/error/outputs_after"
```

---

## Task 2: Extend `instanceStreamReducer` to capture per-state logs + outputs_after

**Files:**

- Modify: `C:\TrajectoryActionTester\src\store\instance-stream-reducer.ts`
- Modify: `C:\TrajectoryActionTester\src\store\instance-stream-reducer.test.ts`

Two behavior changes inside the reducer:

1. **`state_change`**: when finalizing the previous entry's `duration_ms`, also set `outputs_after` to the **current** `state.outputs` (snapshot at the moment the state transitioned). This freezes the outputs-as-of-this-state into the history.
2. **`log`**: instead of writing to global `latest_error`/`latest_traceback` only, append to the last state entry's `stdout` (when `stream === 'stdout'`) or `stderr` (when `stream === 'stderr'`). When stderr contains `Traceback (most recent call last)`, also set `traceback` and `error` on that entry. Keep the global `latest_error`/`latest_traceback` for the existing `ErrorPanel` consumer (which shows the most recent error across all states).

- [ ] **Step 1: Write failing tests — append to `src/store/instance-stream-reducer.test.ts`**

Append after the existing tests:

```ts
describe('instanceStreamReducer — log attaches to current state entry', () => {
  it('appends stdout to the last state entry', () => {
    const prev = initialStateFromInstance(seedInstance)
    const event: SseEventWire = {
      id: 0,
      type: 'log',
      data: {
        instance_id: 'inst-1',
        stream: 'stdout',
        message: 'hello world',
        timestamp: '2026-05-14T00:00:05Z',
      },
    }
    const next = instanceStreamReducer(prev, event)
    const lastEntry = next.state_history[next.state_history.length - 1]
    expect(lastEntry.stdout).toBe('hello world')
  })

  it('concatenates multiple stdout events with newline separators', () => {
    let state = initialStateFromInstance(seedInstance)
    state = instanceStreamReducer(state, {
      id: 0,
      type: 'log',
      data: {
        instance_id: 'inst-1',
        stream: 'stdout',
        message: 'line 1',
        timestamp: '2026-05-14T00:00:01Z',
      },
    })
    state = instanceStreamReducer(state, {
      id: 1,
      type: 'log',
      data: {
        instance_id: 'inst-1',
        stream: 'stdout',
        message: 'line 2',
        timestamp: '2026-05-14T00:00:02Z',
      },
    })
    const lastEntry = state.state_history[state.state_history.length - 1]
    expect(lastEntry.stdout).toBe('line 1\nline 2')
  })

  it('appends stderr to the last state entry', () => {
    const prev = initialStateFromInstance(seedInstance)
    const event: SseEventWire = {
      id: 0,
      type: 'log',
      data: {
        instance_id: 'inst-1',
        stream: 'stderr',
        message: 'warning: deprecation',
        timestamp: '2026-05-14T00:00:05Z',
      },
    }
    const next = instanceStreamReducer(prev, event)
    const lastEntry = next.state_history[next.state_history.length - 1]
    expect(lastEntry.stderr).toBe('warning: deprecation')
    expect(lastEntry.traceback).toBeUndefined()
    expect(lastEntry.error).toBeUndefined()
  })

  it('sets traceback + error on the state entry when stderr includes a Python traceback', () => {
    const prev = initialStateFromInstance(seedInstance)
    const message =
      'Traceback (most recent call last):\n  File "x.py", line 1\nNameError: x is not defined'
    const next = instanceStreamReducer(prev, {
      id: 0,
      type: 'log',
      data: {
        instance_id: 'inst-1',
        stream: 'stderr',
        message,
        timestamp: '2026-05-14T00:00:05Z',
      },
    })
    const lastEntry = next.state_history[next.state_history.length - 1]
    expect(lastEntry.stderr).toBe(message)
    expect(lastEntry.traceback).toBe(message)
    expect(lastEntry.error).toBe('NameError: x is not defined')
  })

  it('keeps the global latest_error / latest_traceback in sync (for ErrorPanel consumer)', () => {
    const prev = initialStateFromInstance(seedInstance)
    const message = 'Traceback (most recent call last):\n  File "x.py"\nValueError: bad input'
    const next = instanceStreamReducer(prev, {
      id: 0,
      type: 'log',
      data: {
        instance_id: 'inst-1',
        stream: 'stderr',
        message,
        timestamp: '2026-05-14T00:00:05Z',
      },
    })
    expect(next.latest_error).toBe(message)
    expect(next.latest_traceback).toBe(message)
  })

  it('keeps logs attached to the state they happened in across state_change', () => {
    let state = initialStateFromInstance(seedInstance) // history: [STARTING]
    // log under STARTING
    state = instanceStreamReducer(state, {
      id: 0,
      type: 'log',
      data: {
        instance_id: 'inst-1',
        stream: 'stdout',
        message: 'in STARTING',
        timestamp: '2026-05-14T00:00:01Z',
      },
    })
    // state_change to EXECUTING
    state = instanceStreamReducer(state, {
      id: 1,
      type: 'state_change',
      data: {
        instance_id: 'inst-1',
        state: 'EXECUTING',
        previous_state: 'STARTING',
        timestamp: '2026-05-14T00:00:30Z',
      },
    })
    // log under EXECUTING
    state = instanceStreamReducer(state, {
      id: 2,
      type: 'log',
      data: {
        instance_id: 'inst-1',
        stream: 'stdout',
        message: 'in EXECUTING',
        timestamp: '2026-05-14T00:00:31Z',
      },
    })

    expect(state.state_history).toHaveLength(2)
    expect(state.state_history[0].state).toBe('STARTING')
    expect(state.state_history[0].stdout).toBe('in STARTING')
    expect(state.state_history[1].state).toBe('EXECUTING')
    expect(state.state_history[1].stdout).toBe('in EXECUTING')
  })
})

describe('instanceStreamReducer — state_change captures outputs_after', () => {
  it('snapshots outputs onto the just-finalized entry when state changes', () => {
    let state: InstanceLiveState = {
      ...initialStateFromInstance(seedInstance),
      outputs: { status: '0', detail: 'ok' },
    }
    state = instanceStreamReducer(state, {
      id: 0,
      type: 'state_change',
      data: {
        instance_id: 'inst-1',
        state: 'EXECUTING',
        previous_state: 'STARTING',
        timestamp: '2026-05-14T00:00:30Z',
      },
    })
    expect(state.state_history[0].outputs_after).toEqual({ status: '0', detail: 'ok' })
    // The new entry is still current — no outputs_after yet.
    expect(state.state_history[1].outputs_after).toBeUndefined()
  })

  it('captures an empty outputs snapshot when no outputs are set', () => {
    const prev = initialStateFromInstance(seedInstance) // outputs = {}
    const next = instanceStreamReducer(prev, {
      id: 0,
      type: 'state_change',
      data: {
        instance_id: 'inst-1',
        state: 'EXECUTING',
        previous_state: 'STARTING',
        timestamp: '2026-05-14T00:00:30Z',
      },
    })
    expect(next.state_history[0].outputs_after).toEqual({})
  })
})
```

- [ ] **Step 2: Run tests, verify the new cases fail**

```powershell
cd C:/TrajectoryActionTester
npm test -- src/store/instance-stream-reducer.test.ts
```

Expected: existing 14 tests pass; 8 new tests fail.

- [ ] **Step 3: Update `src/store/instance-stream-reducer.ts`**

Replace the existing `case 'log'` block AND `case 'state_change'` block. The full updated function:

```ts
import type { Instance, InstanceLiveState, SseEventWire, StateEntry } from '../api/types'

const TERMINAL_STATES = new Set(['COMPLETED', 'ABORTED'])

function durationMs(from: string, to: string): number {
  return new Date(to).getTime() - new Date(from).getTime()
}

/** Extract the short message after the traceback header (or return full text). */
function summarizeTraceback(message: string): string {
  const lines = message.split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!.trim()
    if (line.length > 0 && !line.startsWith('File "') && !line.startsWith('Traceback')) {
      return line
    }
  }
  return message
}

export function initialStateFromInstance(instance: Instance): InstanceLiveState {
  const history: StateEntry[] = []
  if (instance.state.previous) {
    const previousEnteredAt =
      instance.started_at ?? instance.created_at ?? instance.state.entered_at
    history.push({
      state: instance.state.previous,
      entered_at: previousEnteredAt,
      duration_ms: durationMs(previousEnteredAt, instance.state.entered_at),
    })
  }
  history.push({
    state: instance.state.current,
    entered_at: instance.state.entered_at,
  })

  const outputs: Record<string, string> = {}
  for (const out of instance.outputs) {
    outputs[out.name] = out.value
  }

  return {
    instance_id: instance.instance_id,
    visibility: instance.visibility,
    current_state: instance.state.current,
    state_history: history,
    outputs,
    terminal_error: instance.error,
    terminal: TERMINAL_STATES.has(instance.state.current),
    last_event_id: -1,
  }
}

export function instanceStreamReducer(
  state: InstanceLiveState,
  event: SseEventWire
): InstanceLiveState {
  if (event.id <= state.last_event_id) return state

  switch (event.type) {
    case 'state_change': {
      // Finalize the previous (last) entry: duration_ms + outputs_after snapshot.
      const lastIdx = state.state_history.length - 1
      const finalizedHistory = state.state_history.map((entry, idx) => {
        if (idx !== lastIdx) return entry
        return {
          ...entry,
          duration_ms: durationMs(entry.entered_at, event.data.timestamp),
          outputs_after: { ...state.outputs },
        }
      })
      return {
        ...state,
        current_state: event.data.state,
        state_history: [
          ...finalizedHistory,
          { state: event.data.state, entered_at: event.data.timestamp },
        ],
        terminal: TERMINAL_STATES.has(event.data.state),
        last_event_id: event.id,
      }
    }

    case 'output': {
      const merged = { ...state.outputs }
      for (const out of event.data.outputs) {
        merged[out.name] = out.value
      }
      return { ...state, outputs: merged, last_event_id: event.id }
    }

    case 'log': {
      const isStderr = event.data.stream === 'stderr'
      const isStdout = event.data.stream === 'stdout'
      const message = event.data.message

      // Attach to the current (last) entry.
      const lastIdx = state.state_history.length - 1
      const updatedHistory = state.state_history.map((entry, idx) => {
        if (idx !== lastIdx) return entry
        const next: StateEntry = { ...entry }
        if (isStdout) {
          next.stdout = entry.stdout ? `${entry.stdout}\n${message}` : message
        }
        if (isStderr) {
          next.stderr = entry.stderr ? `${entry.stderr}\n${message}` : message
          if (message.includes('Traceback (most recent call last)')) {
            next.traceback = message
            next.error = summarizeTraceback(message)
          }
        }
        return next
      })

      // Keep global latest_error/latest_traceback in sync for ErrorPanel.
      const globalUpdates: Partial<InstanceLiveState> = {}
      if (isStderr) {
        globalUpdates.latest_error = message
        if (message.includes('Traceback (most recent call last)')) {
          globalUpdates.latest_traceback = message
        }
      }

      return {
        ...state,
        state_history: updatedHistory,
        ...globalUpdates,
        last_event_id: event.id,
      }
    }

    case 'heartbeat':
      return { ...state, last_event_id: event.id }

    default: {
      const _exhaustive: never = event
      void _exhaustive
      return state
    }
  }
}
```

- [ ] **Step 4: Run tests, verify all pass**

```powershell
npm test -- src/store/instance-stream-reducer.test.ts
```

Expected: 22 tests pass (14 existing + 8 new).

- [ ] **Step 5: Run full suite to confirm no regression**

```powershell
npm test
```

Expected: still green (~262 tests; previously 260 + 2 from this task… actually the 8 new are all in one file so exact count grows by 8 → 268). Adjust expectation when running: at least `260 + 8 = 268`.

- [ ] **Step 6: Commit**

```powershell
git add src/store/instance-stream-reducer.ts src/store/instance-stream-reducer.test.ts
git commit -m "feat(store): per-state log accumulation + outputs_after snapshots"
```

---

## Task 3: Add `selectedStateIndex` to `ActiveInstanceContext`

**Files:**

- Modify: `C:\TrajectoryActionTester\src\store\active-instance.tsx`
- Modify: `C:\TrajectoryActionTester\src\store\active-instance.test.tsx`

Add a new piece of selection state — `selectedStateIndex: number | null` — used to coordinate click-to-jump between StateDiagram, StateTimeline, and LogInspector. Selecting a different instance resets it to `null`.

- [ ] **Step 1: Write failing tests — append to `src/store/active-instance.test.tsx`**

Append at the end of the file (inside the existing `describe('activeInstanceReducer', () => { ... })` if present, or as a sibling):

```ts
describe('selectedStateIndex', () => {
  it('initialises to null', () => {
    const initial = activeInstanceReducer(undefined as unknown as ActiveInstanceState, {
      type: 'clearSelection',
    })
    // The reducer should accept the action and the initial state has selectedStateIndex null.
    // (If the reducer code path on undefined state is awkward, this test can be replaced by
    // a provider-render assertion below.)
    expect(initial.selectedStateIndex ?? null).toBe(null)
  })

  it('selectStateIndex sets the index', () => {
    const prev: ActiveInstanceState = {
      selection: null,
      trackedInstances: [],
      selectedStateIndex: null,
    }
    const next = activeInstanceReducer(prev, { type: 'selectStateIndex', index: 2 })
    expect(next.selectedStateIndex).toBe(2)
  })

  it('selectStateIndex with null clears the index', () => {
    const prev: ActiveInstanceState = {
      selection: null,
      trackedInstances: [],
      selectedStateIndex: 3,
    }
    const next = activeInstanceReducer(prev, { type: 'selectStateIndex', index: null })
    expect(next.selectedStateIndex).toBeNull()
  })

  it('selectInstance resets selectedStateIndex to null', () => {
    const prev: ActiveInstanceState = {
      selection: null,
      trackedInstances: [],
      selectedStateIndex: 5,
    }
    const next = activeInstanceReducer(prev, { type: 'selectInstance', instance_id: 'inst-2' })
    expect(next.selectedStateIndex).toBeNull()
  })

  it('selectAction does NOT reset selectedStateIndex', () => {
    // Selecting an action is a different concern from focusing on a log row,
    // but: clicking an action navigates away from the instance view, so resetting
    // would be defensible. Conservative choice: only reset on instance change.
    const prev: ActiveInstanceState = {
      selection: null,
      trackedInstances: [],
      selectedStateIndex: 5,
    }
    const next = activeInstanceReducer(prev, { type: 'selectAction', action_oid: 'act-1' })
    expect(next.selectedStateIndex).toBe(5)
  })

  it('provider exposes selectStateIndex method', () => {
    function Probe() {
      const { state, selectStateIndex } = useActiveInstance()
      return (
        <div>
          <span data-testid="idx">{state.selectedStateIndex ?? 'null'}</span>
          <button onClick={() => selectStateIndex(7)}>set</button>
          <button onClick={() => selectStateIndex(null)}>clear</button>
        </div>
      )
    }
    render(
      <ActiveInstanceProvider>
        <Probe />
      </ActiveInstanceProvider>
    )
    expect(screen.getByTestId('idx').textContent).toBe('null')
    fireEvent.click(screen.getByText('set'))
    expect(screen.getByTestId('idx').textContent).toBe('7')
    fireEvent.click(screen.getByText('clear'))
    expect(screen.getByTestId('idx').textContent).toBe('null')
  })
})
```

> **Note:** Add `import { render, screen, fireEvent } from '@testing-library/react'` and `ActiveInstanceProvider`, `useActiveInstance` to the imports at the top of the file if not already there. The existing test file should already have most of these — verify before adding duplicates.

- [ ] **Step 2: Run tests, verify they fail**

```powershell
npm test -- src/store/active-instance.test.tsx
```

Expected: 6 new tests fail with TypeScript errors / undefined property access.

- [ ] **Step 3: Update `src/store/active-instance.tsx`**

Add `selectedStateIndex` to the state shape, action types, reducer arms, and provider API. The full updated relevant sections:

```ts
export interface ActiveInstanceState {
  selection: Selection
  trackedInstances: TrackedInstance[]
  selectedStateIndex: number | null
}

export type ActiveInstanceAction =
  | { type: 'selectAction'; action_oid: string }
  | { type: 'selectInstance'; instance_id: string }
  | { type: 'clearSelection' }
  | { type: 'trackInstance'; instance: TrackedInstance }
  | {
      type: 'updateTrackedInstance'
      instance_id: string
      patch: Partial<
        Omit<TrackedInstance, 'instance_id' | 'connection_id' | 'action_oid' | 'invoked_at'>
      >
    }
  | { type: 'selectStateIndex'; index: number | null }

const INITIAL_STATE: ActiveInstanceState = {
  selection: null,
  trackedInstances: [],
  selectedStateIndex: null,
}
```

Add a reducer arm before the existing `default`:

```ts
    case 'selectStateIndex':
      return { ...state, selectedStateIndex: action.index }
```

And update the existing `selectInstance` arm to reset:

```ts
    case 'selectInstance':
      return {
        ...state,
        selection: { type: 'instance', instance_id: action.instance_id },
        selectedStateIndex: null,
      }
```

(Leave `selectAction` unchanged — it does NOT reset selectedStateIndex.)

Add to the API surface:

```ts
export interface ActiveInstanceApi {
  state: ActiveInstanceState
  selectAction: (action_oid: string) => void
  selectInstance: (instance_id: string) => void
  clearSelection: () => void
  trackInstance: (
    instance: Omit<TrackedInstance, 'invoked_at'> & { invoked_at?: string }
  ) => TrackedInstance
  updateTrackedInstance: (
    instance_id: string,
    patch: Partial<
      Omit<TrackedInstance, 'instance_id' | 'connection_id' | 'action_oid' | 'invoked_at'>
    >
  ) => void
  selectStateIndex: (index: number | null) => void
}
```

And in the provider:

```ts
const selectStateIndex = useCallback<ActiveInstanceApi['selectStateIndex']>((index) => {
  dispatch({ type: 'selectStateIndex', index })
}, [])
```

Add it to the `useMemo` value object and its dep array.

- [ ] **Step 4: Run tests, verify all pass**

```powershell
npm test -- src/store/active-instance.test.tsx
```

Expected: all tests pass (existing 12 + 6 new = 18).

- [ ] **Step 5: Run full suite**

```powershell
npm test
```

Expected: still green.

- [ ] **Step 6: Commit**

```powershell
git add src/store/active-instance.tsx src/store/active-instance.test.tsx
git commit -m "feat(store): selectedStateIndex in ActiveInstanceContext for click-to-jump"
```

---

## Task 4: `ActiveInstanceStreamProvider` + `useActiveInstanceStream`

**Files:**

- Create: `C:\TrajectoryActionTester\src\store\instance-stream-context.tsx`
- Create: `C:\TrajectoryActionTester\src\store\instance-stream-context.test.tsx`

Lift `useInstanceStream(instanceId)` to a context so InstancePanel (MainView) and LogInspector (RHS aside) share a single EventSource. The provider derives `instanceId` from `useActiveInstance().state.selection`.

- [ ] **Step 1: Write failing tests at `src/store/instance-stream-context.test.tsx`**

```tsx
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { AllProviders, createTestQueryClient } from '../test-utils'
import { useActiveInstance } from './active-instance'
import { useEffect } from 'react'
import { ActiveInstanceStreamProvider, useActiveInstanceStream } from './instance-stream-context'
import { getMockEventSources } from '../lib/test-event-source'

function seedConnection() {
  localStorage.setItem(
    'acT:connections:v1',
    JSON.stringify({
      connections: [{ id: 'c1', url: 'http://localhost:3000', createdAt: '2026-05-14T00:00:00Z' }],
      activeConnectionId: 'c1',
    })
  )
}

function makeWrapper() {
  const queryClient = createTestQueryClient()
  seedConnection()
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <AllProviders queryClient={queryClient}>
        <ActiveInstanceStreamProvider>{children}</ActiveInstanceStreamProvider>
      </AllProviders>
    )
  }
}

function SelectInstance() {
  const { trackInstance, selectInstance } = useActiveInstance()
  useEffect(() => {
    trackInstance({
      instance_id: 'inst-1',
      connection_id: 'c1',
      action_oid: 'act-1',
    })
    selectInstance('inst-1')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return null
}

describe('ActiveInstanceStreamProvider + useActiveInstanceStream', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => {
    localStorage.clear()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('returns isLoading=false and data=undefined when no instance is selected', () => {
    const { result } = renderHook(() => useActiveInstanceStream(), { wrapper: makeWrapper() })
    expect(result.current.data).toBeUndefined()
    expect(result.current.isLoading).toBe(false)
  })

  it('returns the stream result when an instance is selected', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            instance_id: 'inst-1',
            action_oid: 'act-1',
            environment_oid: 'env-1',
            workflow_instance_id: 'wf-1',
            step_instance_id: 'step-1',
            step_oid: 'stepoid-1',
            visibility: 'observable',
            state: {
              current: 'STARTING',
              previous: null,
              entered_at: '2026-05-14T00:00:00Z',
            },
            inputs: [],
            outputs: [],
            created_at: '2026-05-14T00:00:00Z',
            started_at: '2026-05-14T00:00:00Z',
            completed_at: null,
            error: null,
          },
          meta: {},
        }),
        { status: 200 }
      )
    )

    const wrapper = makeWrapper()
    const { result } = renderHook(
      () => {
        return useActiveInstanceStream()
      },
      {
        wrapper: ({ children }) => (
          <>
            {/* Tree wrapper: AllProviders + StreamProvider + SelectInstance side-effect + children */}
            {wrapper({
              children: (
                <>
                  <SelectInstance />
                  {children}
                </>
              ),
            } as unknown as ReactNode)}
          </>
        ),
      }
    )

    await waitFor(() => expect(result.current.data?.current_state).toBe('STARTING'))
  })

  it('opens exactly one EventSource for the selected instance even when multiple consumers call useActiveInstanceStream', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            instance_id: 'inst-1',
            action_oid: 'act-1',
            environment_oid: 'env-1',
            workflow_instance_id: 'wf-1',
            step_instance_id: 'step-1',
            step_oid: 'stepoid-1',
            visibility: 'observable',
            state: {
              current: 'STARTING',
              previous: null,
              entered_at: '2026-05-14T00:00:00Z',
            },
            inputs: [],
            outputs: [],
            created_at: '2026-05-14T00:00:00Z',
            started_at: '2026-05-14T00:00:00Z',
            completed_at: null,
            error: null,
          },
          meta: {},
        }),
        { status: 200 }
      )
    )

    function MultiConsumer() {
      useActiveInstanceStream()
      useActiveInstanceStream()
      useActiveInstanceStream()
      return null
    }

    const wrapper = makeWrapper()
    renderHook(() => null, {
      wrapper: ({ children }) =>
        wrapper({
          children: (
            <>
              <SelectInstance />
              <MultiConsumer />
              {children}
            </>
          ),
        } as unknown as ReactNode),
    })

    await waitFor(() => expect(getMockEventSources().length).toBe(1))
  })

  it('throws when used outside the provider', () => {
    expect(() => {
      // renderHook with no wrapper at all (no provider in scope).
      renderHook(() => useActiveInstanceStream())
    }).toThrow(/ActiveInstanceStreamProvider/i)
  })
})
```

> **Note for executing engineer:** the wrapper composition above is mechanical-only — adapt to whatever pattern works cleanly with `renderHook`'s wrapper signature in this repo (look at `use-instance-stream.test.tsx`'s `makeWrapper` for the established pattern). The intent is: provider mounted → useActiveInstanceStream returns data; same provider → only one EventSource regardless of consumer count; no provider → hook throws.

- [ ] **Step 2: Run tests, verify FAIL**

```powershell
npm test -- src/store/instance-stream-context.test.tsx
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/store/instance-stream-context.tsx`**

```tsx
import { createContext, useContext, type ReactNode } from 'react'
import { useActiveInstance } from './active-instance'
import { useInstanceStream, type UseInstanceStreamResult } from './use-instance-stream'

const ActiveInstanceStreamContext = createContext<UseInstanceStreamResult | null>(null)

export function ActiveInstanceStreamProvider({ children }: { children: ReactNode }) {
  const { state } = useActiveInstance()
  const instanceId = state.selection?.type === 'instance' ? state.selection.instance_id : null
  const stream = useInstanceStream(instanceId)
  return (
    <ActiveInstanceStreamContext.Provider value={stream}>
      {children}
    </ActiveInstanceStreamContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components -- Co-located with the
// provider so consumers import one module; splitting just for HMR would scatter the API.
export function useActiveInstanceStream(): UseInstanceStreamResult {
  const value = useContext(ActiveInstanceStreamContext)
  if (!value) {
    throw new Error('useActiveInstanceStream must be used inside an ActiveInstanceStreamProvider')
  }
  return value
}
```

- [ ] **Step 4: Run tests, verify they pass**

```powershell
npm test -- src/store/instance-stream-context.test.tsx
```

Expected: 4/4 pass.

- [ ] **Step 5: Commit**

```powershell
git add src/store/instance-stream-context.tsx src/store/instance-stream-context.test.tsx
git commit -m "feat(store): ActiveInstanceStreamProvider — shared EventSource via context"
```

---

## Task 5: Wire `App.tsx` to provide the stream + mount `<LogInspector />` placeholder

**Files:**

- Modify: `C:\TrajectoryActionTester\src\App.tsx`
- Modify: `C:\TrajectoryActionTester\src\App.test.tsx`

Drop the "coming in plan 4-05" placeholder and wrap MainView + inspector in `ActiveInstanceStreamProvider`. At this task, the inspector aside still shows a placeholder string `Select an instance to see logs.` — Task 10 replaces that with the real `<LogInspector />`. Keeping App wiring as a separate task lets the rest of the plan build behind the provider boundary without breaking the existing visual until LogInspector is ready.

- [ ] **Step 1: Edit `src/App.tsx`**

The existing structure (from Plan 4-04):

```tsx
export function App() {
  return (
    <ConnectionsProvider>
      <ActiveInstanceProvider>
        <div className={styles.shell}>
          <header className={styles.header} role="banner">
            <ConnectionBar />
          </header>
          <aside className={styles.sidebar}>
            <Sidebar />
          </aside>
          <main className={styles.main}>
            <MainView />
          </main>
          <aside className={styles.inspector} aria-label="Inspector">
            <p className={styles.placeholder}>Log inspector — coming in plan 4-05.</p>
          </aside>
        </div>
      </ActiveInstanceProvider>
    </ConnectionsProvider>
  )
}
```

Replace with (the wrapper provider added; placeholder text updated; mount point ready for Task 10):

```tsx
import { ActiveInstanceStreamProvider } from './store/instance-stream-context'
// (existing imports above this stay)

export function App() {
  return (
    <ConnectionsProvider>
      <ActiveInstanceProvider>
        <ActiveInstanceStreamProvider>
          <div className={styles.shell}>
            <header className={styles.header} role="banner">
              <ConnectionBar />
            </header>
            <aside className={styles.sidebar}>
              <Sidebar />
            </aside>
            <main className={styles.main}>
              <MainView />
            </main>
            <aside className={styles.inspector} aria-label="Inspector">
              <p className={styles.placeholder}>Select an instance to see logs.</p>
            </aside>
          </div>
        </ActiveInstanceStreamProvider>
      </ActiveInstanceProvider>
    </ConnectionsProvider>
  )
}
```

- [ ] **Step 2: Update `src/App.test.tsx`**

The existing test that asserts "Log inspector — coming in plan 4-05" must update. Find that assertion and change to:

```ts
expect(screen.getByText(/select an instance to see logs/i)).toBeInTheDocument()
```

If the test relied on `screen.queryByText('Log inspector — coming in plan 4-05')` being present, swap. Other App tests should be unchanged.

- [ ] **Step 3: Run tests**

```powershell
cd C:/TrajectoryActionTester
npm test -- src/App.test.tsx
npm test
```

Expected: App tests green; full suite green.

- [ ] **Step 4: Commit**

```powershell
git add src/App.tsx src/App.test.tsx
git commit -m "feat(app): mount ActiveInstanceStreamProvider + placeholder for LogInspector"
```

---

## Task 6: Refactor `<InstancePanel />` to consume `useActiveInstanceStream()`

**Files:**

- Modify: `C:\TrajectoryActionTester\src\features\instance-panel\InstancePanel.tsx`
- Modify: `C:\TrajectoryActionTester\src\features\instance-panel\InstancePanel.test.tsx`

Switch from `useInstanceStream(instanceId)` to `useActiveInstanceStream()`. Behaviour is identical (the provider derives the same `instanceId`); the change is purely consumer-side so InstancePanel and LogInspector can share one stream.

- [ ] **Step 1: Edit `src/features/instance-panel/InstancePanel.tsx`**

Find the existing imports + hook usage:

```tsx
import { useInstanceStream } from '../../store/use-instance-stream'
// ...
const stream = useInstanceStream(instanceId)
```

Replace with:

```tsx
import { useActiveInstanceStream } from '../../store/instance-stream-context'
// ...
const stream = useActiveInstanceStream()
```

The rest of the component (`if (stream.isLoading)`, `stream.data`, etc.) is unchanged because `useActiveInstanceStream()` returns the same `UseInstanceStreamResult` shape.

You can also remove the `instanceId` local variable derivation from selection if it's only used to pass to the (now removed) `useInstanceStream` call. The selection-based "if no instance return null" guard can switch to checking `stream.data?.instance_id` or keep the `instanceId` derivation — your call. Recommended: keep the existing guard pattern unchanged (still readable; `useActiveInstanceStream` returns `data: undefined` when no instance is selected, matching what we want).

- [ ] **Step 2: Update `src/features/instance-panel/InstancePanel.test.tsx`**

The test `Wrapper` must wrap in `<ActiveInstanceStreamProvider>` so `useActiveInstanceStream` resolves:

```tsx
import { ActiveInstanceStreamProvider } from '../../store/instance-stream-context'

function Wrapper({ children }: { children: ReactNode }) {
  const client = createTestQueryClient()
  seedConnection()
  return (
    <AllProviders queryClient={client}>
      <Seed>
        <ActiveInstanceStreamProvider>{children}</ActiveInstanceStreamProvider>
      </Seed>
    </AllProviders>
  )
}
```

(The `Seed` component must run BEFORE `ActiveInstanceStreamProvider` mounts so that the provider sees the seeded selection on its first render — order matters here. If the existing structure has `Seed` wrapping `children`, this nesting is correct.)

- [ ] **Step 3: Run tests**

```powershell
npm test -- src/features/instance-panel/InstancePanel.test.tsx
```

Expected: 7/7 pass (the same tests Plan 4-04 + post-ship fixes left us with).

- [ ] **Step 4: Full suite**

```powershell
npm test
```

Expected: still green.

- [ ] **Step 5: Commit**

```powershell
git add src/features/instance-panel/InstancePanel.tsx src/features/instance-panel/InstancePanel.test.tsx
git commit -m "refactor(instance-panel): consume useActiveInstanceStream from context"
```

---

## Task 7: Build `src/lib/diagram-layout.ts` — node + edge tables for both variants

**Files:**

- Create: `C:\TrajectoryActionTester\src\lib\diagram-layout.ts`
- Create: `C:\TrajectoryActionTester\src\lib\diagram-layout.test.ts`

Pure-data module: variant-specific `{ width, height, nodes, edges }` tables. No React, no rendering — just the layout data the `<StateDiagram />` component will iterate over.

- [ ] **Step 1: Write failing tests at `src/lib/diagram-layout.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import {
  OBSERVABLE_DIAGRAM,
  OPAQUE_DIAGRAM,
  getDiagramForVisibility,
  type DiagramNode,
  type DiagramEdge,
} from './diagram-layout'

describe('OBSERVABLE_DIAGRAM', () => {
  it('contains all 14 observable states', () => {
    const states = OBSERVABLE_DIAGRAM.nodes.map((n) => n.state).sort()
    expect(states).toEqual(
      [
        'ABORTED',
        'ABORTING',
        'CLEARING',
        'COMPLETED',
        'COMPLETING',
        'EXECUTING',
        'HELD',
        'HOLDING',
        'PAUSED',
        'PAUSING',
        'STARTING',
        'STOPPING',
        'UNHOLDING',
        'UNPAUSING',
      ].sort()
    )
  })

  it('marks COMPLETED and ABORTED as terminal', () => {
    const completed = OBSERVABLE_DIAGRAM.nodes.find((n) => n.state === 'COMPLETED')!
    const aborted = OBSERVABLE_DIAGRAM.nodes.find((n) => n.state === 'ABORTED')!
    expect(completed.terminal).toBe(true)
    expect(aborted.terminal).toBe(true)
    const nonTerminal = OBSERVABLE_DIAGRAM.nodes.filter((n) => !n.terminal)
    expect(nonTerminal.map((n) => n.state).sort()).toEqual(
      [
        'ABORTING',
        'CLEARING',
        'COMPLETING',
        'EXECUTING',
        'HELD',
        'HOLDING',
        'PAUSED',
        'PAUSING',
        'STARTING',
        'STOPPING',
        'UNHOLDING',
        'UNPAUSING',
      ].sort()
    )
  })

  it('has all required SC-auto edges on the happy path', () => {
    const findEdge = (from: string, to: string) =>
      OBSERVABLE_DIAGRAM.edges.find((e) => e.from === from && e.to === to)
    expect(findEdge('STARTING', 'EXECUTING')).toBeDefined()
    expect(findEdge('EXECUTING', 'COMPLETING')).toBeDefined()
    expect(findEdge('COMPLETING', 'COMPLETED')).toBeDefined()
  })

  it('has pause / hold / abort / stop / clear edges', () => {
    const findEdge = (from: string, to: string) =>
      OBSERVABLE_DIAGRAM.edges.find((e) => e.from === from && e.to === to)
    // Pause sub-loop
    expect(findEdge('EXECUTING', 'PAUSING')).toBeDefined()
    expect(findEdge('PAUSING', 'PAUSED')).toBeDefined()
    expect(findEdge('PAUSED', 'UNPAUSING')).toBeDefined()
    expect(findEdge('UNPAUSING', 'EXECUTING')).toBeDefined()
    // Hold sub-loop
    expect(findEdge('EXECUTING', 'HOLDING')).toBeDefined()
    expect(findEdge('HOLDING', 'HELD')).toBeDefined()
    expect(findEdge('HELD', 'UNHOLDING')).toBeDefined()
    expect(findEdge('UNHOLDING', 'EXECUTING')).toBeDefined()
    // Abort + Clear
    expect(findEdge('EXECUTING', 'ABORTING')).toBeDefined()
    expect(findEdge('ABORTING', 'ABORTED')).toBeDefined()
    expect(findEdge('ABORTED', 'CLEARING')).toBeDefined()
    expect(findEdge('CLEARING', 'COMPLETED')).toBeDefined()
    // Stop
    expect(findEdge('EXECUTING', 'STOPPING')).toBeDefined()
    expect(findEdge('STOPPING', 'COMPLETED')).toBeDefined()
  })

  it('every node has a numeric x, y position', () => {
    for (const node of OBSERVABLE_DIAGRAM.nodes) {
      expect(typeof node.x).toBe('number')
      expect(typeof node.y).toBe('number')
      expect(Number.isFinite(node.x)).toBe(true)
      expect(Number.isFinite(node.y)).toBe(true)
    }
  })
})

describe('OPAQUE_DIAGRAM', () => {
  it('contains the 7 opaque states (4 happy + 3 recovery)', () => {
    const states = OPAQUE_DIAGRAM.nodes.map((n) => n.state).sort()
    expect(states).toEqual(
      ['ABORTED', 'ABORTING', 'COMPLETED', 'IN_PROGRESS', 'POSTED', 'RECEIVED', 'STOPPING'].sort()
    )
  })

  it('has happy-path + recovery edges', () => {
    const findEdge = (from: string, to: string) =>
      OPAQUE_DIAGRAM.edges.find((e) => e.from === from && e.to === to)
    expect(findEdge('POSTED', 'RECEIVED')).toBeDefined()
    expect(findEdge('RECEIVED', 'IN_PROGRESS')).toBeDefined()
    expect(findEdge('IN_PROGRESS', 'COMPLETED')).toBeDefined()
    expect(findEdge('IN_PROGRESS', 'ABORTING')).toBeDefined()
    expect(findEdge('ABORTING', 'ABORTED')).toBeDefined()
    expect(findEdge('IN_PROGRESS', 'STOPPING')).toBeDefined()
    expect(findEdge('STOPPING', 'COMPLETED')).toBeDefined()
  })

  it('marks COMPLETED and ABORTED as terminal', () => {
    expect(OPAQUE_DIAGRAM.nodes.find((n) => n.state === 'COMPLETED')!.terminal).toBe(true)
    expect(OPAQUE_DIAGRAM.nodes.find((n) => n.state === 'ABORTED')!.terminal).toBe(true)
  })
})

describe('getDiagramForVisibility', () => {
  it('returns OBSERVABLE_DIAGRAM for observable', () => {
    expect(getDiagramForVisibility('observable')).toBe(OBSERVABLE_DIAGRAM)
  })
  it('returns OPAQUE_DIAGRAM for opaque', () => {
    expect(getDiagramForVisibility('opaque')).toBe(OPAQUE_DIAGRAM)
  })
})
```

- [ ] **Step 2: Run tests, verify FAIL (module not found)**

```powershell
npm test -- src/lib/diagram-layout.test.ts
```

- [ ] **Step 3: Implement `src/lib/diagram-layout.ts`**

```ts
import type { ActionVisibility } from '../api/types'

export interface DiagramNode {
  state: string
  x: number
  y: number
  width?: number
  height?: number
  terminal?: boolean
}

export interface DiagramEdge {
  from: string
  to: string
  /** Optional label shown along the edge (e.g. command name). */
  label?: string
  /**
   * Optional control points for a curved or stepped path. If omitted, the
   * renderer draws a straight line from `from`'s anchor to `to`'s anchor.
   */
  via?: Array<{ x: number; y: number }>
}

export interface DiagramLayout {
  width: number
  height: number
  nodes: readonly DiagramNode[]
  edges: readonly DiagramEdge[]
}

// Default node footprint — the renderer can override per-node if needed.
const NODE_W = 96
const NODE_H = 36

// ------------------------------------------------------------------
// Observable layout: 500 × 660 canvas, 5 columns (40, 160, 280, 400, ...),
// laid out top-down with the happy path centered and recovery on the right.
// Coordinates are approximate — Plan 4-06 may tighten visual alignment.
// ------------------------------------------------------------------

export const OBSERVABLE_DIAGRAM: DiagramLayout = {
  width: 500,
  height: 660,
  nodes: [
    // Main column (x = 240)
    { state: 'STARTING', x: 240, y: 40, width: NODE_W, height: NODE_H },
    { state: 'EXECUTING', x: 240, y: 140, width: NODE_W, height: NODE_H },
    { state: 'COMPLETING', x: 240, y: 460, width: NODE_W, height: NODE_H },
    { state: 'COMPLETED', x: 240, y: 580, width: NODE_W, height: NODE_H, terminal: true },
    { state: 'STOPPING', x: 240, y: 350, width: NODE_W, height: NODE_H },
    // Pause column (x = 80)
    { state: 'PAUSING', x: 80, y: 200, width: NODE_W, height: NODE_H },
    { state: 'PAUSED', x: 80, y: 270, width: NODE_W, height: NODE_H },
    { state: 'UNPAUSING', x: 80, y: 340, width: NODE_W, height: NODE_H },
    // Hold column (x = 400)
    { state: 'HOLDING', x: 400, y: 200, width: NODE_W, height: NODE_H },
    { state: 'HELD', x: 400, y: 270, width: NODE_W, height: NODE_H },
    { state: 'UNHOLDING', x: 400, y: 340, width: NODE_W, height: NODE_H },
    // Recovery column (x = 380) — Abort / Clear (placed below hold column)
    { state: 'ABORTING', x: 380, y: 420, width: NODE_W, height: NODE_H },
    { state: 'ABORTED', x: 380, y: 490, width: NODE_W, height: NODE_H, terminal: true },
    { state: 'CLEARING', x: 380, y: 560, width: NODE_W, height: NODE_H },
  ],
  edges: [
    // Happy path (SC)
    { from: 'STARTING', to: 'EXECUTING', label: 'SC' },
    { from: 'EXECUTING', to: 'COMPLETING', label: 'SC' },
    { from: 'COMPLETING', to: 'COMPLETED', label: 'SC' },
    // Pause sub-loop
    { from: 'EXECUTING', to: 'PAUSING', label: 'PAUSE' },
    { from: 'PAUSING', to: 'PAUSED', label: 'SC' },
    { from: 'PAUSED', to: 'UNPAUSING', label: 'RESUME' },
    { from: 'UNPAUSING', to: 'EXECUTING', label: 'SC' },
    // Hold sub-loop
    { from: 'EXECUTING', to: 'HOLDING', label: 'HOLD' },
    { from: 'HOLDING', to: 'HELD', label: 'SC' },
    { from: 'HELD', to: 'UNHOLDING', label: 'UNHOLD' },
    { from: 'UNHOLDING', to: 'EXECUTING', label: 'SC' },
    // Abort path
    { from: 'EXECUTING', to: 'ABORTING', label: 'ABORT' },
    { from: 'ABORTING', to: 'ABORTED', label: 'SC' },
    { from: 'ABORTED', to: 'CLEARING', label: 'CLEAR' },
    { from: 'CLEARING', to: 'COMPLETED', label: 'SC' },
    // Stop path
    { from: 'EXECUTING', to: 'STOPPING', label: 'STOP' },
    { from: 'STOPPING', to: 'COMPLETED', label: 'SC' },
  ],
}

// ------------------------------------------------------------------
// Opaque layout: 380 × 540 canvas, two columns (happy left, recovery right).
// ------------------------------------------------------------------

export const OPAQUE_DIAGRAM: DiagramLayout = {
  width: 380,
  height: 540,
  nodes: [
    { state: 'POSTED', x: 140, y: 40, width: NODE_W, height: NODE_H },
    { state: 'RECEIVED', x: 140, y: 140, width: NODE_W, height: NODE_H },
    { state: 'IN_PROGRESS', x: 140, y: 240, width: NODE_W, height: NODE_H },
    { state: 'COMPLETED', x: 140, y: 460, width: NODE_W, height: NODE_H, terminal: true },
    { state: 'ABORTING', x: 280, y: 240, width: NODE_W, height: NODE_H },
    { state: 'ABORTED', x: 280, y: 340, width: NODE_W, height: NODE_H, terminal: true },
    { state: 'STOPPING', x: 280, y: 440, width: NODE_W, height: NODE_H },
  ],
  edges: [
    { from: 'POSTED', to: 'RECEIVED', label: 'SC' },
    { from: 'RECEIVED', to: 'IN_PROGRESS', label: 'SC' },
    { from: 'IN_PROGRESS', to: 'COMPLETED', label: 'SC' },
    { from: 'IN_PROGRESS', to: 'ABORTING', label: 'ABORT' },
    { from: 'ABORTING', to: 'ABORTED', label: 'SC' },
    { from: 'IN_PROGRESS', to: 'STOPPING', label: 'STOP' },
    { from: 'STOPPING', to: 'COMPLETED', label: 'SC' },
  ],
}

export function getDiagramForVisibility(visibility: ActionVisibility): DiagramLayout {
  return visibility === 'observable' ? OBSERVABLE_DIAGRAM : OPAQUE_DIAGRAM
}
```

- [ ] **Step 4: Run tests, verify they pass**

```powershell
npm test -- src/lib/diagram-layout.test.ts
```

Expected: all 9 tests pass.

- [ ] **Step 5: Commit**

```powershell
git add src/lib/diagram-layout.ts src/lib/diagram-layout.test.ts
git commit -m "feat(lib): diagram-layout tables for observable + opaque state machines"
```

---

## Task 8: Build `<StateDiagram />` component

**Files:**

- Create: `C:\TrajectoryActionTester\src\features\instance-panel\StateDiagram.tsx`
- Create: `C:\TrajectoryActionTester\src\features\instance-panel\StateDiagram.module.css`
- Create: `C:\TrajectoryActionTester\src\features\instance-panel\StateDiagram.test.tsx`

Inline-SVG renderer. Reads `getDiagramForVisibility(visibility)` to pick the variant. Computes per-node visual status from the `history.map(e => e.state)` set + the `currentState`. Click on a node calls `onSelectState(state, indexInHistory | null)`.

- [ ] **Step 1: Write failing tests**

Create `src/features/instance-panel/StateDiagram.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { StateDiagram } from './StateDiagram'
import type { StateEntry } from '../../api/types'

const historyExecuting: StateEntry[] = [
  { state: 'STARTING', entered_at: '2026-05-14T00:00:00Z', duration_ms: 5_000 },
  { state: 'EXECUTING', entered_at: '2026-05-14T00:00:05Z' },
]

describe('StateDiagram — observable', () => {
  it('renders 14 nodes for the observable variant', () => {
    render(
      <StateDiagram
        visibility="observable"
        currentState="EXECUTING"
        history={historyExecuting}
        terminal={false}
      />
    )
    // Each node is a clickable element with the state name as accessible label.
    const states = [
      'STARTING',
      'EXECUTING',
      'COMPLETING',
      'COMPLETED',
      'PAUSING',
      'PAUSED',
      'UNPAUSING',
      'HOLDING',
      'HELD',
      'UNHOLDING',
      'ABORTING',
      'ABORTED',
      'CLEARING',
      'STOPPING',
    ]
    for (const s of states) {
      expect(screen.getByLabelText(`state ${s}`)).toBeInTheDocument()
    }
  })

  it('marks the current state node with the data-status="current" attribute', () => {
    render(
      <StateDiagram
        visibility="observable"
        currentState="EXECUTING"
        history={historyExecuting}
        terminal={false}
      />
    )
    expect(screen.getByLabelText('state EXECUTING')).toHaveAttribute('data-status', 'current')
  })

  it('marks past states (in history but not current) as "past"', () => {
    render(
      <StateDiagram
        visibility="observable"
        currentState="EXECUTING"
        history={historyExecuting}
        terminal={false}
      />
    )
    expect(screen.getByLabelText('state STARTING')).toHaveAttribute('data-status', 'past')
  })

  it('marks unvisited active states as "unvisited"', () => {
    render(
      <StateDiagram
        visibility="observable"
        currentState="EXECUTING"
        history={historyExecuting}
        terminal={false}
      />
    )
    expect(screen.getByLabelText('state PAUSING')).toHaveAttribute('data-status', 'unvisited')
    expect(screen.getByLabelText('state HOLDING')).toHaveAttribute('data-status', 'unvisited')
  })

  it('marks terminal states (COMPLETED, ABORTED) with data-terminal="true"', () => {
    render(
      <StateDiagram
        visibility="observable"
        currentState="EXECUTING"
        history={historyExecuting}
        terminal={false}
      />
    )
    expect(screen.getByLabelText('state COMPLETED')).toHaveAttribute('data-terminal', 'true')
    expect(screen.getByLabelText('state ABORTED')).toHaveAttribute('data-terminal', 'true')
    expect(screen.getByLabelText('state EXECUTING')).not.toHaveAttribute('data-terminal', 'true')
  })

  it('click on a past-state node calls onSelectState with the first occurrence index', () => {
    const onSelect = vi.fn()
    render(
      <StateDiagram
        visibility="observable"
        currentState="EXECUTING"
        history={historyExecuting}
        terminal={false}
        onSelectState={onSelect}
      />
    )
    fireEvent.click(screen.getByLabelText('state STARTING'))
    expect(onSelect).toHaveBeenCalledWith('STARTING', 0)
  })

  it('click on an unvisited node calls onSelectState with null index', () => {
    const onSelect = vi.fn()
    render(
      <StateDiagram
        visibility="observable"
        currentState="EXECUTING"
        history={historyExecuting}
        terminal={false}
        onSelectState={onSelect}
      />
    )
    fireEvent.click(screen.getByLabelText('state PAUSING'))
    expect(onSelect).toHaveBeenCalledWith('PAUSING', null)
  })
})

describe('StateDiagram — opaque', () => {
  it('renders 7 nodes for the opaque variant', () => {
    render(
      <StateDiagram
        visibility="opaque"
        currentState="IN_PROGRESS"
        history={[
          { state: 'POSTED', entered_at: '2026-05-14T00:00:00Z', duration_ms: 1_000 },
          { state: 'RECEIVED', entered_at: '2026-05-14T00:00:01Z', duration_ms: 1_000 },
          { state: 'IN_PROGRESS', entered_at: '2026-05-14T00:00:02Z' },
        ]}
        terminal={false}
      />
    )
    for (const s of [
      'POSTED',
      'RECEIVED',
      'IN_PROGRESS',
      'COMPLETED',
      'ABORTING',
      'ABORTED',
      'STOPPING',
    ]) {
      expect(screen.getByLabelText(`state ${s}`)).toBeInTheDocument()
    }
  })
})
```

- [ ] **Step 2: Run tests, verify FAIL (module not found)**

```powershell
npm test -- src/features/instance-panel/StateDiagram.test.tsx
```

- [ ] **Step 3: Implement `src/features/instance-panel/StateDiagram.tsx`**

```tsx
import { useMemo } from 'react'
import type { ActionVisibility, StateEntry } from '../../api/types'
import { getDiagramForVisibility, type DiagramNode } from '../../lib/diagram-layout'
import styles from './StateDiagram.module.css'

export interface StateDiagramProps {
  visibility: ActionVisibility
  currentState: string
  history: StateEntry[]
  terminal: boolean
  onSelectState?: (state: string, indexInHistory: number | null) => void
}

type NodeStatus = 'current' | 'past' | 'unvisited'

function statusFor(
  nodeState: string,
  currentState: string,
  visitedStates: Set<string>
): NodeStatus {
  if (nodeState === currentState) return 'current'
  if (visitedStates.has(nodeState)) return 'past'
  return 'unvisited'
}

function firstHistoryIndex(history: StateEntry[], state: string): number | null {
  for (let i = 0; i < history.length; i++) {
    if (history[i]!.state === state) return i
  }
  return null
}

export function StateDiagram({
  visibility,
  currentState,
  history,
  onSelectState,
}: StateDiagramProps) {
  const layout = getDiagramForVisibility(visibility)
  const visitedStates = useMemo(() => new Set(history.map((e) => e.state)), [history])

  const nodeRect = (n: DiagramNode) => {
    const w = n.width ?? 96
    const h = n.height ?? 36
    return { x: n.x - w / 2, y: n.y - h / 2, w, h }
  }

  return (
    <svg
      className={styles.svg}
      viewBox={`0 0 ${layout.width} ${layout.height}`}
      role="img"
      aria-label={`State machine diagram (${visibility})`}
    >
      {/* Edges */}
      <g className={styles.edges}>
        {layout.edges.map((e) => {
          const from = layout.nodes.find((n) => n.state === e.from)
          const to = layout.nodes.find((n) => n.state === e.to)
          if (!from || !to) return null
          return (
            <line
              key={`${e.from}->${e.to}`}
              x1={from.x}
              y1={from.y}
              x2={to.x}
              y2={to.y}
              className={styles.edge}
            />
          )
        })}
      </g>

      {/* Nodes */}
      <g className={styles.nodes}>
        {layout.nodes.map((n) => {
          const { x, y, w, h } = nodeRect(n)
          const status = statusFor(n.state, currentState, visitedStates)
          const rx = n.terminal ? 12 : 4
          const onClick = onSelectState
            ? () => {
                const idx = firstHistoryIndex(history, n.state)
                onSelectState(n.state, idx)
              }
            : undefined
          return (
            <g
              key={n.state}
              role="button"
              aria-label={`state ${n.state}`}
              data-status={status}
              data-terminal={n.terminal ? 'true' : 'false'}
              className={styles.node}
              onClick={onClick}
              tabIndex={onClick ? 0 : -1}
            >
              <rect x={x} y={y} width={w} height={h} rx={rx} className={styles.nodeRect} />
              <text x={n.x} y={n.y + 5} textAnchor="middle" className={styles.nodeText}>
                {n.state}
              </text>
            </g>
          )
        })}
      </g>
    </svg>
  )
}
```

- [ ] **Step 4: Create `src/features/instance-panel/StateDiagram.module.css`**

```css
.svg {
  width: 100%;
  height: auto;
  display: block;
  font-family: var(--acT-font);
  font-size: var(--acT-fs-sm);
}

.edge {
  stroke: var(--acT-divider);
  stroke-width: 1;
  fill: none;
}

.node {
  cursor: pointer;
}

.nodeRect {
  fill: var(--acT-panel-alt);
  stroke: var(--acT-divider);
  stroke-width: 1;
}

.node[data-status='current'] .nodeRect {
  fill: var(--acT-accent-bg);
  stroke: var(--acT-accent);
  stroke-width: 2;
}

.node[data-status='past'] .nodeRect {
  fill: var(--acT-panel);
  stroke: var(--acT-divider);
}

.node[data-status='unvisited'] .nodeRect {
  fill: transparent;
  stroke: var(--acT-divider);
}

.node[data-terminal='true'] .nodeRect {
  /* terminal styling — rx already raised in JSX; emphasize border */
  stroke-width: 2;
}

.nodeText {
  fill: var(--acT-text);
  pointer-events: none;
}

.node[data-status='unvisited'] .nodeText {
  fill: var(--acT-text-muted);
}

.node:hover .nodeRect {
  stroke: var(--acT-accent);
}
```

- [ ] **Step 5: Run tests, verify they pass**

```powershell
npm test -- src/features/instance-panel/StateDiagram.test.tsx
```

Expected: all 8 tests pass.

- [ ] **Step 6: Commit**

```powershell
git add src/features/instance-panel/StateDiagram.tsx src/features/instance-panel/StateDiagram.module.css src/features/instance-panel/StateDiagram.test.tsx
git commit -m "feat(instance-panel): StateDiagram SVG (observable + opaque variants)"
```

---

## Task 9: Wire `<StateDiagram />` + `<StateTimeline />` click handlers in `<InstancePanel />`

**Files:**

- Modify: `C:\TrajectoryActionTester\src\features\instance-panel\InstancePanel.tsx`
- Modify: `C:\TrajectoryActionTester\src\features\instance-panel\InstancePanel.test.tsx`

Mount `<StateDiagram />` above `<StateTimeline />` inside the "State" section. Both call `selectStateIndex(idx)` from `useActiveInstance()` on click.

- [ ] **Step 1: Edit `src/features/instance-panel/InstancePanel.tsx`**

Add the import at the top:

```tsx
import { StateDiagram } from './StateDiagram'
```

Replace the existing "State timeline" section with:

```tsx
<section className={styles.section} aria-label="State timeline">
  <h3 className={styles.sectionHeading}>State</h3>
  <StateDiagram
    visibility={live.visibility}
    currentState={live.current_state}
    history={live.state_history}
    terminal={live.terminal}
    onSelectState={(_state, index) => selectStateIndex(index)}
  />
  <StateTimeline
    history={live.state_history}
    terminal={live.terminal}
    onSelectState={(_state, index) => selectStateIndex(index)}
  />
</section>
```

And destructure `selectStateIndex` from `useActiveInstance()`:

```tsx
const { state, selectStateIndex } = useActiveInstance()
```

- [ ] **Step 2: Update `src/features/instance-panel/InstancePanel.test.tsx`**

Add an assertion in the "renders header, timeline, commands, outputs" test that the StateDiagram is present:

```tsx
expect(screen.getByLabelText(/state machine diagram/i)).toBeInTheDocument()
```

Add a new test that verifies click-to-jump:

```tsx
import { fireEvent } from '@testing-library/react'
// ... (add to existing imports if not present)

it('clicking a timeline pill updates ActiveInstanceContext.selectedStateIndex', async () => {
  mockCapabilities()
  mockInstanceSeed()

  // Probe the context state alongside the panel
  function Probe() {
    const { state } = useActiveInstance()
    return <span data-testid="probe-idx">{state.selectedStateIndex ?? 'null'}</span>
  }

  render(
    <>
      <InstancePanel />
      <Probe />
    </>,
    { wrapper: Wrapper }
  )

  await waitFor(() => expect(screen.getByText('inst-1')).toBeInTheDocument())
  // Timeline shows one pill for STARTING (current).
  expect(screen.getByTestId('probe-idx').textContent).toBe('null')

  // Click the STARTING pill text (the StateTimeline button contains a Pill with the state name).
  fireEvent.click(screen.getByText('STARTING'))
  expect(screen.getByTestId('probe-idx').textContent).toBe('0')
})
```

Note: the StateDiagram click test for the same flow is covered by Task 8's component tests.

- [ ] **Step 3: Run tests**

```powershell
npm test -- src/features/instance-panel/InstancePanel.test.tsx
```

Expected: 9/9 pass (7 existing + 1 new diagram-present + 1 new click-to-jump). The two original click-test counts may differ; adapt to whatever the file's count was before this task.

- [ ] **Step 4: Full suite**

```powershell
npm test
```

Expected: still green.

- [ ] **Step 5: Commit**

```powershell
git add src/features/instance-panel/InstancePanel.tsx src/features/instance-panel/InstancePanel.test.tsx
git commit -m "feat(instance-panel): mount StateDiagram + wire click-to-jump via selectStateIndex"
```

---

## Task 10: Build `<LogInspector />` component

**Files:**

- Create: `C:\TrajectoryActionTester\src\features\log-inspector\LogInspector.tsx`
- Create: `C:\TrajectoryActionTester\src\features\log-inspector\LogInspector.module.css`
- Create: `C:\TrajectoryActionTester\src\features\log-inspector\LogInspector.test.tsx`
- Modify: `C:\TrajectoryActionTester\src\App.tsx` (mount the component)
- Modify: `C:\TrajectoryActionTester\src\vitest.setup.ts` (clipboard polyfill)

Reads `useActiveInstanceStream()` for the live data and `useActiveInstance()` for `selectedStateIndex`. Renders one collapsible row per `state_history` entry. Header shows state pill + duration. Auto-expands the current EXECUTING entry (or last entry when terminal), plus any entry matching `selectedStateIndex`. Body shows stdout (mono, max-height 8 lines via CSS, `(no output)` when empty), stderr (red, hidden when empty), traceback (red, when present), Copy button (copies stdout + stderr + traceback as a single block via `navigator.clipboard.writeText`).

- [ ] **Step 1: Add clipboard polyfill to `src/vitest.setup.ts`**

Find the existing setup file content (after Task 7's MockEventSource install) and add at the bottom:

```ts
// jsdom does not provide navigator.clipboard. Install a writeable spy so
// components calling writeText() work in tests without throwing.
import { vi } from 'vitest'
if (!('clipboard' in navigator)) {
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
    configurable: true,
  })
}
```

- [ ] **Step 2: Write failing tests at `src/features/log-inspector/LogInspector.test.tsx`**

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useEffect, type ReactNode } from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { AllProviders, createTestQueryClient } from '../../test-utils'
import { LogInspector } from './LogInspector'
import { useActiveInstance } from '../../store/active-instance'
import { ActiveInstanceStreamProvider } from '../../store/instance-stream-context'
import { getMockEventSources, type MockEventSource } from '../../lib/test-event-source'

function seedConnection() {
  localStorage.setItem(
    'acT:connections:v1',
    JSON.stringify({
      connections: [{ id: 'c1', url: 'http://localhost:3000', createdAt: '2026-05-14T00:00:00Z' }],
      activeConnectionId: 'c1',
    })
  )
}

function Wrapper({ children }: { children: ReactNode }) {
  const client = createTestQueryClient()
  seedConnection()
  return (
    <AllProviders queryClient={client}>
      <Seed>
        <ActiveInstanceStreamProvider>{children}</ActiveInstanceStreamProvider>
      </Seed>
    </AllProviders>
  )
}

function Seed({ children }: { children: ReactNode }) {
  const { trackInstance, selectInstance } = useActiveInstance()
  useEffect(() => {
    trackInstance({ instance_id: 'inst-1', connection_id: 'c1', action_oid: 'act-1' })
    selectInstance('inst-1')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return <>{children}</>
}

function mockInstanceSeed() {
  vi.mocked(fetch).mockResolvedValueOnce(
    new Response(
      JSON.stringify({
        data: {
          instance_id: 'inst-1',
          action_oid: 'act-1',
          environment_oid: 'env-1',
          workflow_instance_id: 'wf-1',
          step_instance_id: 'step-1',
          step_oid: 'stepoid-1',
          visibility: 'observable',
          state: {
            current: 'STARTING',
            previous: null,
            entered_at: '2026-05-14T00:00:00Z',
          },
          inputs: [],
          outputs: [],
          created_at: '2026-05-14T00:00:00Z',
          started_at: '2026-05-14T00:00:00Z',
          completed_at: null,
          error: null,
        },
        meta: {},
      }),
      { status: 200 }
    )
  )
}

describe('LogInspector', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => {
    localStorage.clear()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('renders an empty-state message when no instance is selected', () => {
    // Render outside the Seed so no selection happens
    const client = createTestQueryClient()
    seedConnection()
    render(
      <AllProviders queryClient={client}>
        <ActiveInstanceStreamProvider>
          <LogInspector />
        </ActiveInstanceStreamProvider>
      </AllProviders>
    )
    expect(screen.getByText(/select an instance/i)).toBeInTheDocument()
  })

  it('renders one row per state-history entry', async () => {
    mockInstanceSeed()
    render(<LogInspector />, { wrapper: Wrapper })
    await waitFor(() => expect(screen.getByText('STARTING')).toBeInTheDocument())
    // Only one row at seed time
    expect(screen.getAllByRole('group', { name: /state log/i })).toHaveLength(1)
  })

  it('auto-expands the current (non-terminal) state row showing (no output) when stdout is empty', async () => {
    mockInstanceSeed()
    render(<LogInspector />, { wrapper: Wrapper })
    await waitFor(() => expect(screen.getByText('STARTING')).toBeInTheDocument())
    // The current state row is expanded by default → its body is visible.
    expect(screen.getByText(/\(no output\)/i)).toBeInTheDocument()
  })

  it('renders stdout content after a log SSE event arrives', async () => {
    mockInstanceSeed()
    render(<LogInspector />, { wrapper: Wrapper })

    await waitFor(() => expect(screen.getByText('STARTING')).toBeInTheDocument())
    const es = getMockEventSources()[0]! as MockEventSource
    es.__open()
    es.__emit(
      'log',
      {
        instance_id: 'inst-1',
        stream: 'stdout',
        message: 'hello from action',
        timestamp: '2026-05-14T00:00:05Z',
      },
      0
    )

    await waitFor(() => expect(screen.getByText('hello from action')).toBeInTheDocument())
  })

  it('renders stderr in a separate block', async () => {
    mockInstanceSeed()
    render(<LogInspector />, { wrapper: Wrapper })

    await waitFor(() => expect(screen.getByText('STARTING')).toBeInTheDocument())
    const es = getMockEventSources()[0]! as MockEventSource
    es.__open()
    es.__emit(
      'log',
      {
        instance_id: 'inst-1',
        stream: 'stderr',
        message: 'deprecation warning',
        timestamp: '2026-05-14T00:00:05Z',
      },
      0
    )

    await waitFor(() => expect(screen.getByText('deprecation warning')).toBeInTheDocument())
  })

  it('Copy button copies stdout + stderr + traceback as a single block', async () => {
    mockInstanceSeed()
    render(<LogInspector />, { wrapper: Wrapper })

    await waitFor(() => expect(screen.getByText('STARTING')).toBeInTheDocument())
    const es = getMockEventSources()[0]! as MockEventSource
    es.__open()
    es.__emit(
      'log',
      {
        instance_id: 'inst-1',
        stream: 'stdout',
        message: 'out-line',
        timestamp: '2026-05-14T00:00:05Z',
      },
      0
    )
    es.__emit(
      'log',
      {
        instance_id: 'inst-1',
        stream: 'stderr',
        message: 'Traceback (most recent call last):\n  File "x.py"\nValueError: x',
        timestamp: '2026-05-14T00:00:06Z',
      },
      1
    )

    await waitFor(() => expect(screen.getByText('out-line')).toBeInTheDocument())

    const copyBtn = screen.getByRole('button', { name: /copy/i })
    fireEvent.click(copyBtn)

    expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1)
    const arg = (navigator.clipboard.writeText as ReturnType<typeof vi.fn>).mock.calls[0]![0]
    expect(arg).toContain('out-line')
    expect(arg).toContain('ValueError: x')
  })

  it('expands the row matching selectedStateIndex from context', async () => {
    mockInstanceSeed()

    function Probe() {
      const { selectStateIndex } = useActiveInstance()
      return (
        <button data-testid="probe-select-0" onClick={() => selectStateIndex(0)}>
          select 0
        </button>
      )
    }

    render(
      <>
        <LogInspector />
        <Probe />
      </>,
      { wrapper: Wrapper }
    )

    await waitFor(() => expect(screen.getByText('STARTING')).toBeInTheDocument())
    // Initially the STARTING row is the current one and auto-expanded.
    // Click to "select 0" (still STARTING — no-op visually but verifies the wiring).
    fireEvent.click(screen.getByTestId('probe-select-0'))
    expect(screen.getByText(/\(no output\)/i)).toBeInTheDocument()
  })
})
```

> **Note:** The `aria-label` on each row should be e.g. `state log STARTING` so the `getAllByRole('group', { name: /state log/i })` assertion finds them. Adjust between implementation and tests if needed.

- [ ] **Step 3: Run tests, verify FAIL (module not found)**

```powershell
npm test -- src/features/log-inspector/LogInspector.test.tsx
```

- [ ] **Step 4: Implement `src/features/log-inspector/LogInspector.tsx`**

```tsx
import { useEffect, useMemo, useRef, useState } from 'react'
import { Pill } from '../../components/Pill'
import { Button } from '../../components/Button'
import { pillVariantForState } from '../../lib/state-pill'
import { useActiveInstance } from '../../store/active-instance'
import { useActiveInstanceStream } from '../../store/instance-stream-context'
import type { StateEntry } from '../../api/types'
import styles from './LogInspector.module.css'

function formatDuration(ms: number | undefined): string {
  if (ms == null) return ''
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function buildCopyBundle(entry: StateEntry): string {
  const parts: string[] = []
  parts.push(`### ${entry.state} (entered ${entry.entered_at})`)
  parts.push('--- stdout ---')
  parts.push(entry.stdout ?? '(no output)')
  if (entry.stderr) {
    parts.push('--- stderr ---')
    parts.push(entry.stderr)
  }
  if (entry.traceback) {
    parts.push('--- traceback ---')
    parts.push(entry.traceback)
  }
  return parts.join('\n')
}

interface LogRowProps {
  entry: StateEntry
  index: number
  expanded: boolean
  onToggle: () => void
}

function LogRow({ entry, index, expanded, onToggle }: LogRowProps) {
  const stdout = entry.stdout
  const stderr = entry.stderr
  const traceback = entry.traceback

  const handleCopy = () => {
    void navigator.clipboard.writeText(buildCopyBundle(entry))
  }

  return (
    <div
      role="group"
      aria-label={`state log ${entry.state}`}
      data-state-index={index}
      className={styles.row}
    >
      <button
        type="button"
        className={styles.rowHeader}
        onClick={onToggle}
        aria-expanded={expanded}
      >
        <span className={styles.rowCaret} aria-hidden="true">
          {expanded ? '▾' : '▸'}
        </span>
        <Pill variant={pillVariantForState(entry.state)}>{entry.state}</Pill>
        <span className={styles.rowDuration}>{formatDuration(entry.duration_ms)}</span>
      </button>
      {expanded && (
        <div className={styles.rowBody}>
          <div className={styles.section}>
            <span className={styles.sectionLabel}>stdout</span>
            <pre className={styles.stdout}>{stdout ?? '(no output)'}</pre>
          </div>
          {stderr && (
            <div className={styles.section}>
              <span className={styles.sectionLabel}>stderr</span>
              <pre className={styles.stderr}>{stderr}</pre>
            </div>
          )}
          {traceback && (
            <div className={styles.section}>
              <span className={styles.sectionLabel}>traceback</span>
              <pre className={styles.stderr}>{traceback}</pre>
            </div>
          )}
          <div className={styles.rowActions}>
            <Button variant="secondary" size="sm" onClick={handleCopy}>
              Copy
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

export function LogInspector() {
  const stream = useActiveInstanceStream()
  const { state } = useActiveInstance()

  const history = stream.data?.state_history ?? []
  const terminal = stream.data?.terminal ?? false
  const selectedIdx = state.selectedStateIndex
  const lastIdx = history.length - 1

  const autoExpandedIdx: number | null = useMemo(() => {
    if (history.length === 0) return null
    // Both "currently executing" and "most-recent terminal" reduce to "last entry".
    return lastIdx
  }, [history.length, lastIdx])

  const [manuallyExpanded, setManuallyExpanded] = useState<Set<number>>(new Set())
  // When selectedIdx changes, add it to manually-expanded so the row pops open.
  useEffect(() => {
    if (selectedIdx == null) return
    setManuallyExpanded((prev) => {
      if (prev.has(selectedIdx)) return prev
      const next = new Set(prev)
      next.add(selectedIdx)
      return next
    })
  }, [selectedIdx])

  const rowRefs = useRef<Map<number, HTMLDivElement | null>>(new Map())
  useEffect(() => {
    if (selectedIdx == null) return
    const el = rowRefs.current.get(selectedIdx)
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [selectedIdx])

  if (!stream.data) {
    return <p className={styles.empty}>Select an instance to see logs.</p>
  }

  const isExpanded = (idx: number): boolean => {
    if (manuallyExpanded.has(idx)) return true
    if (autoExpandedIdx === idx) return true
    if (selectedIdx === idx) return true
    // Terminal mode auto-expands the last entry (= autoExpandedIdx). No extra rule.
    void terminal
    return false
  }

  const toggle = (idx: number) => {
    setManuallyExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(idx)) {
        next.delete(idx)
      } else {
        next.add(idx)
      }
      return next
    })
  }

  return (
    <div className={styles.panel} aria-label="Log inspector">
      {history.map((entry, idx) => (
        <div
          key={`${entry.state}-${entry.entered_at}-${idx}`}
          ref={(el) => {
            if (el) rowRefs.current.set(idx, el)
            else rowRefs.current.delete(idx)
          }}
        >
          <LogRow
            entry={entry}
            index={idx}
            expanded={isExpanded(idx)}
            onToggle={() => toggle(idx)}
          />
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 5: Create `src/features/log-inspector/LogInspector.module.css`**

```css
.panel {
  display: flex;
  flex-direction: column;
  gap: var(--acT-pad-sm);
  padding: var(--acT-pad);
  height: 100%;
  overflow-y: auto;
}

.empty {
  padding: var(--acT-pad) var(--acT-pad-lg);
  color: var(--acT-text-muted);
  font-style: italic;
}

.row {
  border: 1px solid var(--acT-divider);
  border-radius: var(--acT-radius);
  background: var(--acT-panel);
}

.rowHeader {
  display: flex;
  align-items: center;
  gap: var(--acT-pad-sm);
  width: 100%;
  border: none;
  background: transparent;
  padding: var(--acT-pad-sm) var(--acT-pad);
  cursor: pointer;
  color: var(--acT-text);
  font: inherit;
  text-align: left;
}

.rowHeader:hover {
  background: var(--acT-panel-alt);
}

.rowCaret {
  color: var(--acT-text-muted);
  width: 12px;
  display: inline-block;
}

.rowDuration {
  font-size: var(--acT-fs-sm);
  color: var(--acT-text-muted);
  margin-left: auto;
  font-variant-numeric: tabular-nums;
}

.rowBody {
  display: flex;
  flex-direction: column;
  gap: var(--acT-pad-sm);
  padding: var(--acT-pad-sm) var(--acT-pad) var(--acT-pad) var(--acT-pad);
  border-top: 1px solid var(--acT-divider);
}

.section {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.sectionLabel {
  font-size: var(--acT-fs-sm);
  color: var(--acT-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.stdout {
  margin: 0;
  font-family: var(--acT-mono);
  font-size: var(--acT-fs-sm);
  color: var(--acT-text);
  max-height: 12em; /* ≈ 8 lines + padding */
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
}

.stderr {
  margin: 0;
  font-family: var(--acT-mono);
  font-size: var(--acT-fs-sm);
  color: var(--acT-error);
  max-height: 12em;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
}

.rowActions {
  display: flex;
  justify-content: flex-end;
}
```

- [ ] **Step 6: Mount `<LogInspector />` in `src/App.tsx`**

Replace the `<p className={styles.placeholder}>Select an instance to see logs.</p>` placeholder (from Task 5) with:

```tsx
<LogInspector />
```

And add the import:

```tsx
import { LogInspector } from './features/log-inspector/LogInspector'
```

(The empty-state placeholder text moves from App.tsx into LogInspector itself — LogInspector returns that text when no instance is selected.)

- [ ] **Step 7: Update `src/App.test.tsx`**

The test from Task 5 that checks for "Select an instance to see logs" still passes — LogInspector renders that text when there's no selected instance.

- [ ] **Step 8: Run tests**

```powershell
npm test -- src/features/log-inspector/LogInspector.test.tsx
```

Expected: 7/7 pass.

- [ ] **Step 9: Full suite**

```powershell
npm test
```

Expected: still green (Plan 4-04 baseline + this plan's additions = roughly 290+ tests).

- [ ] **Step 10: Commit**

```powershell
git add src/features/log-inspector/LogInspector.tsx src/features/log-inspector/LogInspector.module.css src/features/log-inspector/LogInspector.test.tsx src/App.tsx src/App.test.tsx src/vitest.setup.ts
git commit -m "feat(log-inspector): collapsible per-state log rows + click-to-jump + Copy"
```

---

## Task 11: Integration test — log accumulation + click-to-jump end-to-end

**Files:**

- Modify: `C:\TrajectoryActionTester\src\__tests__\integration.test.tsx`

Append one new describe block that drives the full Plan 4-05 surface: invoke → STARTING → SSE state_change to EXECUTING → SSE `log` (stderr w/ traceback) under EXECUTING → LogInspector EXECUTING row shows the traceback. Then click the STARTING timeline pill → LogInspector STARTING row expands.

- [ ] **Step 1: Append test to `src/__tests__/integration.test.tsx`**

```tsx
describe('integration — log stream + click-to-jump', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => {
    localStorage.clear()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('accumulates per-state logs and supports timeline click-to-jump', async () => {
    // 1) capabilities
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [
            {
              action_oid: 'act-pick',
              environment_oid: 'env-1',
              local_id: 'PickItem',
              version: '1.0.0',
              visibility: 'observable',
              input_parameters: [],
              output_parameters: [],
              supported_commands: ['PAUSE'],
            },
          ],
          meta: { total: 1 },
        }),
        { status: 200 }
      )
    )
    // 2) invoke
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ data: { instance_id: 'inst-1' }, meta: {} }), {
        status: 201,
      })
    )
    // 3) instance seed
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            instance_id: 'inst-1',
            action_oid: 'act-pick',
            environment_oid: 'env-1',
            workflow_instance_id: 'wf-1',
            step_instance_id: 'step-1',
            step_oid: 'stepoid-1',
            visibility: 'observable',
            state: { current: 'STARTING', previous: null, entered_at: '2026-05-14T00:00:00Z' },
            inputs: [],
            outputs: [],
            created_at: '2026-05-14T00:00:00Z',
            started_at: '2026-05-14T00:00:00Z',
            completed_at: null,
            error: null,
          },
          meta: {},
        }),
        { status: 200 }
      )
    )

    const user = userEvent.setup()
    renderWithProviders(<App />)

    // Add a connection inline.
    await user.click(screen.getByTestId('connection-trigger'))
    await user.click(screen.getByRole('button', { name: /add connection/i }))
    await user.type(screen.getByLabelText(/server url/i), 'http://localhost:3000')
    await user.click(screen.getByRole('button', { name: /save/i }))

    // Select the action, invoke.
    await screen.findByText('PickItem')
    await user.click(screen.getByText('PickItem'))
    await user.click(await screen.findByRole('button', { name: /^invoke$/i }))

    // InstancePanel shows STARTING; LogInspector has one row.
    await waitFor(() => expect(screen.getAllByText('STARTING').length).toBeGreaterThanOrEqual(1))

    const es = getMockEventSources()[0]! as MockEventSource
    act(() => es.__open())
    act(() =>
      es.__emit(
        'state_change',
        {
          instance_id: 'inst-1',
          state: 'EXECUTING',
          previous_state: 'STARTING',
          timestamp: '2026-05-14T00:00:30Z',
        },
        0
      )
    )
    act(() =>
      es.__emit(
        'log',
        {
          instance_id: 'inst-1',
          stream: 'stderr',
          message: 'Traceback (most recent call last):\n  File "x.py"\nValueError: bad input',
          timestamp: '2026-05-14T00:00:31Z',
        },
        1
      )
    )

    // EXECUTING row is auto-expanded (it's the current state). Traceback text visible.
    await waitFor(() => expect(screen.getByText(/ValueError: bad input/)).toBeInTheDocument())

    // Click the STARTING timeline pill to jump back.
    // Plan 4-04's StateTimeline pill text is "STARTING" inside a button.
    const startingPill = screen
      .getAllByText('STARTING')
      .find((el) => el.closest('button')?.title?.startsWith('Entered at'))
    expect(startingPill).toBeDefined()
    await user.click(startingPill!)

    // The STARTING row in LogInspector now visible/expanded — "(no output)" placeholder.
    await waitFor(() =>
      expect(screen.getAllByText(/\(no output\)/i).length).toBeGreaterThanOrEqual(1)
    )
  })
})
```

- [ ] **Step 2: Run integration tests**

```powershell
npm test -- src/__tests__/integration.test.tsx
```

Expected: all integration tests pass (existing Plan 4-04 + this new one).

- [ ] **Step 3: Full suite**

```powershell
npm test
```

Expected: still green.

- [ ] **Step 4: Commit**

```powershell
git add src/__tests__/integration.test.tsx
git commit -m "test(integration): per-state log stream + click-to-jump end-to-end"
```

---

## Task 12: Bundle size + marker commit

- [ ] **Step 1: Production build**

```powershell
cd C:/TrajectoryActionTester
npm run build
```

Expected: build succeeds, `dist/index.html` produced.

- [ ] **Step 2: Measure gzipped bundle size**

```powershell
$bytes = [System.IO.File]::ReadAllBytes('dist/index.html')
$ms = New-Object System.IO.MemoryStream
$gz = New-Object System.IO.Compression.GZipStream($ms, [System.IO.Compression.CompressionLevel]::Optimal)
$gz.Write($bytes, 0, $bytes.Length)
$gz.Close()
"{0:N2} KB gzipped" -f ($ms.Length / 1024)
```

Expected: under 200 KB gz (Plan 4-06's hard budget). Plan 4-04 + post-ship was 82.93 KB gz; expect +5–10 KB for StateDiagram + LogInspector.

- [ ] **Step 3: Full sanity sweep**

```powershell
npm test
npm run typecheck
npm run lint
```

Expected: all pass; lint may carry pre-existing warnings (unchanged from prior state).

- [ ] **Step 4: Marker commit**

```powershell
git commit --allow-empty -m "chore: plan 4-05 complete — gzipped baseline <FILL_IN>.XX KB"
```

Replace `<FILL_IN>` with the measured bundle size from Step 2.

- [ ] **Step 5: Confirm clean state**

```powershell
git status
git log --oneline | Measure-Object -Line
```

Expected: working tree clean. Commit count = 76 (Plan 4-04 + hot fixes) + ~14 new commits from this plan = ~90.

---

## Self-Review checklist (for the executing engineer)

Before declaring Plan 4-05 done, confirm:

- [ ] `StateEntry` carries the spec § 6 fields (`stdout?`, `stderr?`, `traceback?`, `error?`, `outputs_after?`).
- [ ] `log` SSE events attach to the current (last) `state_history` entry — verify via the reducer's "logs attached to the state they happened in across state_change" test.
- [ ] `outputs_after` is snapshotted onto the just-finalized entry on `state_change`.
- [ ] `latest_error` / `latest_traceback` global fields still update (ErrorPanel consumer unchanged).
- [ ] `selectedStateIndex` lives in `ActiveInstanceContext`; resets on `selectInstance`.
- [ ] `ActiveInstanceStreamProvider` mounted in `App.tsx`; exactly one `EventSource` per instance even with multiple consumers.
- [ ] `<InstancePanel />` consumes `useActiveInstanceStream()` (not `useInstanceStream` directly).
- [ ] `<StateDiagram />` renders both variants; node visual status reflects current/past/unvisited/terminal; click emits `(state, indexInHistory | null)`.
- [ ] `<LogInspector />` renders one row per state-history entry; auto-expands current/terminal; click-to-jump expansion via `selectedStateIndex`; Copy button writes a single block to `navigator.clipboard`.
- [ ] "Log inspector — coming in plan 4-05" placeholder gone from `App.tsx`.
- [ ] Bundle ≤ 200 KB gz.
- [ ] Working tree clean after marker commit.

---

## Failure recovery

If a task's tests don't pass and the issue isn't obvious within ~5 minutes:

1. Stop pushing more changes.
2. Re-read the relevant spec section in `docs/specs/2026-05-11-trajectory-action-tester-v2-design.md`.
3. Re-read the source for `packages/server/src/sse-manager.ts` to confirm the wire shape — `log` events have `{ instance_id, stream, message, timestamp }`.
4. For LogInspector layout / focus-trap weirdness, add a `screen.debug()` call to see the current DOM.
5. If still stuck after two attempts, file a checkpoint and ask for input. Don't stack more failed attempts.

---

## What's deferred to later plans

For clarity, these are **NOT** in Plan 4-05 (don't add them):

- **OutputsView delta flash** — Plan 4-06.
- **OutputsView "show raw JSON" toggle** — Plan 4-06.
- **Final theme polish / diagram-layout tuning** — Plan 4-06 (the coordinates in `diagram-layout.ts` are functional but not pretty; iterate visually then).
- **Bundle size budget enforcement (≤ 200 KB hard fail)** — Plan 4-06.
- **README pass + version meta tag** — Plan 4-06.
- **Per-state-row error styling on the timeline** — Plan 4-06 polish.

If you find yourself reaching for one of these, stop — finish 4-05's scope first.
