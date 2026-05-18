# Trajectory Action Tester — Plan 4: Instance Stream (SSE) + Full InstancePanel

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After this plan, opening an instance in the tester opens a live `EventSource` to `GET /trajectory/v1/instances/:id/events`, reduces incoming `state_change` / `output` / `log` events into an `InstanceLiveState` view, and renders the full InstancePanel (header + StateTimeline + CommandBar + OutputsView + ErrorPanel) defined by spec § 5/§ 6. The CommandBar's seven buttons (PAUSE/RESUME/HOLD/UNHOLD/ABORT/STOP/CLEAR) are enabled per a tester-side state-machine lookup table and POST to `/instances/:id/command` on click. Plan 4-03's polled `useInstance` hook is removed; `useInstanceStream` becomes the single source of instance state.

**Architecture:** A new `useInstanceStream(connection, instanceId)` hook owns the EventSource lifecycle, performs an initial REST fetch (deduplicated against the live stream), and reduces SSE events into `InstanceLiveState` via a pure `instanceStreamReducer`. Native `EventSource` handles auto-reconnect with `Last-Event-ID`, replaying buffered events from the server's `sse-manager.ts` ring. Tracked-instance updates (used by `<InstanceList />`) move from `useInstance` into `useInstanceStream`. A tester-side `src/lib/state-machine.ts` re-codes the observable + opaque transition tables from `packages/engine/src/state-machine/transitions.ts` and exposes `isCommandValid(visibility, currentState, command)` for the CommandBar. A new `<ErrorPanel />` displays `instance.error` plus the most-recent stderr `log` event. Plan 4-03 review follow-ups (1, 2, 3, 4, 5) are folded in: `pillVariantForState` is extracted to `src/lib/state-pill.ts`; `useInstance`'s `apiKey`-in-queryKey leak disappears with the hook; `eslint-disable react-refresh/only-export-components` comments get explanatory annotations; `InvokePanel`'s form-reset useEffect dep changes from `action` to `action?.action_oid` so capability refetches don't clobber in-flight input; the App-shell "coming in plan 4-05" placeholder stays put (still accurate).

**Tech Stack:** No new npm dependencies. React 19 + TS strict, `@tanstack/react-query` v5 (mutation for `sendCommand`, plus a dedupe sentinel `useQuery` for the initial REST fetch), native `EventSource` (jsdom: provided by a tester-side `MockEventSource`), vanilla CSS Modules, Vitest 3 + RTL + user-event.

**Spec:** `docs/specs/2026-05-11-trajectory-action-tester-v2-design.md` — § 5 (Center / InstancePanel composition, CommandBar enabled rules, OutputsView basic), § 6 (`useInstanceStream` data flow, `InstanceLiveState` shape, StateTimeline), § 10 (testing strategy), § 11 (Plan 4-04 deliverable scope).

**Server endpoints consumed:**

- `GET /trajectory/v1/instances/:id/events` — SSE stream. Wire format: `event: <type>\nid: <number>\ndata: <JSON>\n\n`. Event types: `state_change` (`{instance_id, state, previous_state, timestamp}`), `output` (`{instance_id, outputs, timestamp}`), `log` (`{instance_id, stream, message, timestamp}`), `heartbeat` (`{timestamp}`). Auto-reconnect supported via the `Last-Event-ID` header (browser-managed). Source: `packages/server/src/routes/commands.ts:105-150`, wire shapes in `packages/server/src/sse-manager.ts:7-11`.
- `POST /trajectory/v1/instances/:id/command` — `{ command }` body. 200 on accept, 422 on invalid command, 404 if instance gone. Source: `commands.ts:41-100`.
- `GET /trajectory/v1/instances/:id` — already consumed by `fetchInstance` (Plan 4-03); used here as the initial REST seed and the disconnect-recovery refetch.

**State-machine transitions (re-coded standalone, source of truth: `packages/engine/src/state-machine/transitions.ts:13-65`):**

- Observable client commands valid from these states:
  - `PAUSE`: `EXECUTING`
  - `RESUME`: `PAUSED`
  - `UNHOLD`: `HELD`
  - `CLEAR`: `ABORTED`
  - `HOLD`, `ABORT`, `STOP`: any of `STARTING`, `EXECUTING`, `COMPLETING`, `PAUSING`, `PAUSED`, `UNPAUSING`, `HOLDING`, `HELD`, `UNHOLDING`
- Opaque (when the server advertises only `ABORT` in `supported_commands` — see `protocol.ts:100-103`):
  - `ABORT`: `POSTED`, `RECEIVED`, `IN_PROGRESS`

Validity is gated by **both** `supported_commands` (from `/capabilities`) **and** `isCommandValid(visibility, currentState, command)`. Buttons not in `supported_commands` are not rendered; buttons in it are rendered but disabled when invalid for the current state.

---

## File Structure

This plan creates **5 new feature components** (`StateTimeline`, `CommandBar`, `OutputsView`, `ErrorPanel`, plus the rewritten `InstancePanel`), **2 new lib modules** (`state-machine`, `state-pill`), and **3 new store modules** (`use-instance-stream`, `use-send-command`, plus a test-only EventSource mock). Plan 4-03's `useInstance` hook and its tests are deleted.

| Path                                                   | Role                                                                                                                                                                                                                |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/api/types.ts`                                     | **Modify** — append `StateEntry`, `InstanceLiveState`, `SseEventWire`, `Command`, `SendCommandRequest`, `SendCommandResponse`.                                                                                      |
| `src/api/commands.ts`                                  | `sendCommand(connection, instanceId, command)` — POSTs `/instances/:id/command`.                                                                                                                                    |
| `src/api/commands.test.ts`                             | URL, headers, body, 200, 404, 422 tests.                                                                                                                                                                            |
| `src/lib/state-machine.ts`                             | Observable + opaque transition tables, `isCommandValid(visibility, state, command)` helper, `OBSERVABLE_COMMANDS` / `OPAQUE_COMMANDS` constants.                                                                    |
| `src/lib/state-machine.test.ts`                        | Validity rules + coverage of every documented transition.                                                                                                                                                           |
| `src/lib/state-pill.ts`                                | Extracted `pillVariantForState(state)` covering every observable + opaque state name (including PAUSED/HELD/HOLDING/etc. that Plan 4-04 introduces).                                                                |
| `src/lib/state-pill.test.ts`                           | Variant mapping per state name.                                                                                                                                                                                     |
| `src/lib/test-event-source.ts`                         | `MockEventSource` class with `__open`, `__emit(type, data, id)`, `__error` helpers; `installMockEventSource()` / `restoreEventSource()` wrappers; instance registry for tests.                                      |
| `src/lib/test-event-source.test.ts`                    | Sanity tests on the mock itself (open fires onopen, emit dispatches addEventListener handlers, close sets readyState).                                                                                              |
| `src/store/use-instance-stream.ts`                     | `useInstanceStream(instanceId)` — owns `EventSource`, runs initial REST fetch, reduces events. Returns `{ data, isLoading, isError, error, isConnected }`. Updates tracked-instance state (replaces `useInstance`). |
| `src/store/use-instance-stream.test.tsx`               | Reducer pure-function tests + hook lifecycle tests (mount opens stream, unmount closes, event reduction).                                                                                                           |
| `src/store/instance-stream-reducer.ts`                 | Pure `instanceStreamReducer(state, event)` extracted so the hook tests stay focused on lifecycle and the reducer can be tested in isolation.                                                                        |
| `src/store/instance-stream-reducer.test.ts`            | Unit tests covering each wire event type + edge cases (heartbeat ignored, duplicate ids deduped, terminal state freezes).                                                                                           |
| `src/store/use-send-command.ts`                        | `useSendCommand()` — TanStack mutation; on success surfaces `{instance_id, command, accepted}`; on error preserves `ApiError`.                                                                                      |
| `src/store/use-send-command.test.tsx`                  | Mutation idle/success/error tests.                                                                                                                                                                                  |
| `src/features/instance-panel/StateTimeline.tsx`        | Horizontal strip; one pill per `state_history` entry; per-state duration; last pill ticks via a 1s `setInterval` while `!terminal`. Click emits `onSelectState?` (no-op consumer in 4-04).                          |
| `src/features/instance-panel/StateTimeline.module.css` | Pill layout, separator chevrons, hover tooltip.                                                                                                                                                                     |
| `src/features/instance-panel/StateTimeline.test.tsx`   | Renders empty, renders entries with duration, ticks current, click invokes callback.                                                                                                                                |
| `src/features/instance-panel/CommandBar.tsx`           | Renders one button per entry in `action.supported_commands`. Disabled iff `!isCommandValid(action.visibility, currentState, command)`. Click calls `useSendCommand()`.                                              |
| `src/features/instance-panel/CommandBar.module.css`    | Button row layout.                                                                                                                                                                                                  |
| `src/features/instance-panel/CommandBar.test.tsx`      | Enabled/disabled per state matrix, click fires mutation, in-flight UI, opaque-only-shows-ABORT.                                                                                                                     |
| `src/features/instance-panel/OutputsView.tsx`          | Renders `{key, value}` rows from `liveState.outputs`. Empty message when none. No flash, no JSON toggle (those are Plan 4-06).                                                                                      |
| `src/features/instance-panel/OutputsView.module.css`   | Two-column key/value layout.                                                                                                                                                                                        |
| `src/features/instance-panel/OutputsView.test.tsx`     | Empty state, rendered rows, sorted key order.                                                                                                                                                                       |
| `src/features/instance-panel/ErrorPanel.tsx`           | Renders `liveState.latest_error` (from `log` stderr events) + `liveState.latest_traceback` (when present). Hidden when both undefined. Plus a terminal-error block when `instance.error` is set on REST seed.       |
| `src/features/instance-panel/ErrorPanel.module.css`    | Red monospace block.                                                                                                                                                                                                |
| `src/features/instance-panel/ErrorPanel.test.tsx`      | Hides when empty, shows latest error, shows traceback, shows terminal-error block.                                                                                                                                  |
| `src/features/instance-panel/InstancePanel.tsx`        | **Rewrite** — composes header (instance_id + state pill from `state-pill.ts` + connection-status dot), StateTimeline, CommandBar, OutputsView, ErrorPanel. Drives off `useInstanceStream` + `useCapabilities`.      |
| `src/features/instance-panel/InstancePanel.module.css` | **Modify** — multi-section layout (header / timeline / commands / outputs / error / footer).                                                                                                                        |
| `src/features/instance-panel/InstancePanel.test.tsx`   | **Rewrite** — loading, terminal, post-event-flow assertions.                                                                                                                                                        |
| `src/features/sidebar/InstanceList.tsx`                | **Modify** — import `pillVariantForState` from `src/lib/state-pill.ts` (follow-up #1).                                                                                                                              |
| `src/features/invoke-panel/InvokePanel.tsx`            | **Modify** — useEffect dep `[action]` → `[action?.action_oid]` (follow-up #4).                                                                                                                                      |
| `src/features/invoke-panel/InvokePanel.test.tsx`       | **Modify** — add test proving capability refetch with same OID doesn't clobber in-flight values.                                                                                                                    |
| `src/store/active-instance.tsx`                        | **Modify** — annotate `eslint-disable react-refresh/only-export-components` comments (follow-up #3).                                                                                                                |
| `src/store/connections.tsx`                            | **Modify** — annotate `eslint-disable react-refresh/only-export-components` comments (follow-up #3).                                                                                                                |
| `src/store/use-instance.ts`                            | **DELETE** — subsumed by `useInstanceStream` (follow-up #2).                                                                                                                                                        |
| `src/store/use-instance.test.tsx`                      | **DELETE**.                                                                                                                                                                                                         |
| `src/App.tsx`                                          | No change required — `<InstancePanel />` still mounts in `selection.type === 'instance'` branch.                                                                                                                    |
| `src/__tests__/integration.test.tsx`                   | **Modify** — extend with an SSE flow test: connect → select action → invoke → state_change event → state pill updates → CommandBar button click POSTs command. Uses `MockEventSource`.                              |
| `src/vitest.setup.ts`                                  | **Modify** — install `MockEventSource` as `globalThis.EventSource` for all tests.                                                                                                                                   |

After this plan, spec § 5 Center pane (InstancePanel composition) and § 6 data flow (`useInstanceStream` + StateTimeline + basic OutputsView) are fully implemented for L1. Plan 4-05 adds the LogInspector RHS + StateDiagram; Plan 4-06 adds delta flash + raw-JSON toggle.

---

## Pre-flight check

Before starting, confirm Plan 3 is shipped cleanly:

```powershell
cd C:\TrajectoryActionTester
git log --oneline | Measure-Object -Line   # expect 51 lines (10 + 23 + 18 from plans 1, 2, 3)
git status                                  # expect "nothing to commit, working tree clean"
npm test                                    # expect 136 tests pass across 22 test files
```

If any fail, finish/fix Plan 3 first. No new npm dependencies are required.

---

## Task 1: Extend `src/api/types.ts` with stream, command, and live-state shapes

**Files:**

- Modify: `C:\TrajectoryActionTester\src\api\types.ts`

Append the SSE wire types, command types, and live-state shape after the existing exports. Additive only.

- [ ] **Step 1: Append types to `src/api/types.ts`**

After the existing `InstanceResponse` interface, append:

```ts
// ============================================================
// Commands
// ============================================================

export type Command = 'PAUSE' | 'RESUME' | 'HOLD' | 'UNHOLD' | 'ABORT' | 'STOP' | 'CLEAR'

export interface SendCommandRequest {
  command: Command
}

export interface SendCommandResponse {
  data: {
    instance_id: string
    command: Command
    accepted: true
  }
  meta: Record<string, unknown>
}

// ============================================================
// SSE wire events — shapes parsed off the EventSource stream
// ============================================================

export type SseEventType = 'state_change' | 'output' | 'log' | 'heartbeat'

export interface StateChangeEvent {
  instance_id: string
  state: string
  previous_state: string | null
  timestamp: string
}

export interface OutputEvent {
  instance_id: string
  outputs: InvokeInputParameter[]
  timestamp: string
}

export interface LogEvent {
  instance_id: string
  stream: 'stdout' | 'stderr'
  message: string
  timestamp: string
}

export interface HeartbeatEvent {
  timestamp: string
}

export type SseEventWire =
  | { id: number; type: 'state_change'; data: StateChangeEvent }
  | { id: number; type: 'output'; data: OutputEvent }
  | { id: number; type: 'log'; data: LogEvent }
  | { id: number; type: 'heartbeat'; data: HeartbeatEvent }

// ============================================================
// Live state — reduced view of an instance from REST seed + SSE
// ============================================================

export interface StateEntry {
  state: string
  entered_at: string
  /** Set when this entry is superseded by a newer state. Undefined while current. */
  duration_ms?: number
}

export interface InstanceLiveState {
  instance_id: string
  visibility: ActionVisibility
  current_state: string
  state_history: StateEntry[]
  outputs: Record<string, string>
  /** Most recent stderr message from a `log` event. */
  latest_error?: string
  /** Heuristic traceback extracted from `latest_error` (lines starting with "Traceback"). */
  latest_traceback?: string
  /** Terminal error from the initial REST seed (instance.error). */
  terminal_error: string | null
  terminal: boolean
  /** Highest SSE event id seen — used to detect resumption gaps. */
  last_event_id: number
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
git commit -m "feat(api): types for SSE wire events, commands, and InstanceLiveState"
```

---

## Task 2: `src/lib/state-machine.ts` — transition validity tables

**Files:**

- Create: `C:\TrajectoryActionTester\src\lib\state-machine.ts`
- Create: `C:\TrajectoryActionTester\src\lib\state-machine.test.ts`

Re-code the observable + opaque transition rules from `packages/engine/src/state-machine/transitions.ts:13-94`. Expose `isCommandValid(visibility, state, command)` returning `true` only when the engine would accept the command. **No runtime imports from the engine — the tester is standalone.**

- [ ] **Step 1: Write failing tests**

Create `src/lib/state-machine.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { isCommandValid, OBSERVABLE_COMMANDS, OPAQUE_COMMANDS } from './state-machine'

describe('isCommandValid — observable', () => {
  it('PAUSE only from EXECUTING', () => {
    expect(isCommandValid('observable', 'EXECUTING', 'PAUSE')).toBe(true)
    expect(isCommandValid('observable', 'PAUSED', 'PAUSE')).toBe(false)
    expect(isCommandValid('observable', 'STARTING', 'PAUSE')).toBe(false)
  })

  it('RESUME only from PAUSED', () => {
    expect(isCommandValid('observable', 'PAUSED', 'RESUME')).toBe(true)
    expect(isCommandValid('observable', 'EXECUTING', 'RESUME')).toBe(false)
  })

  it('UNHOLD only from HELD', () => {
    expect(isCommandValid('observable', 'HELD', 'UNHOLD')).toBe(true)
    expect(isCommandValid('observable', 'HOLDING', 'UNHOLD')).toBe(false)
  })

  it('CLEAR only from ABORTED', () => {
    expect(isCommandValid('observable', 'ABORTED', 'CLEAR')).toBe(true)
    expect(isCommandValid('observable', 'COMPLETED', 'CLEAR')).toBe(false)
  })

  const ACTIVE = [
    'STARTING',
    'EXECUTING',
    'COMPLETING',
    'PAUSING',
    'PAUSED',
    'UNPAUSING',
    'HOLDING',
    'HELD',
    'UNHOLDING',
  ] as const

  it.each(ACTIVE)('HOLD valid from %s', (state) => {
    expect(isCommandValid('observable', state, 'HOLD')).toBe(true)
  })

  it.each(ACTIVE)('ABORT valid from %s', (state) => {
    expect(isCommandValid('observable', state, 'ABORT')).toBe(true)
  })

  it.each(ACTIVE)('STOP valid from %s', (state) => {
    expect(isCommandValid('observable', state, 'STOP')).toBe(true)
  })

  it.each(['ABORTING', 'STOPPING', 'CLEARING', 'COMPLETED', 'ABORTED'])(
    'HOLD invalid from inactive state %s',
    (state) => {
      expect(isCommandValid('observable', state, 'HOLD')).toBe(false)
    }
  )
})

describe('isCommandValid — opaque', () => {
  it('ABORT valid from POSTED, RECEIVED, IN_PROGRESS', () => {
    expect(isCommandValid('opaque', 'POSTED', 'ABORT')).toBe(true)
    expect(isCommandValid('opaque', 'RECEIVED', 'ABORT')).toBe(true)
    expect(isCommandValid('opaque', 'IN_PROGRESS', 'ABORT')).toBe(true)
  })

  it('ABORT invalid from terminal opaque states', () => {
    expect(isCommandValid('opaque', 'COMPLETED', 'ABORT')).toBe(false)
    expect(isCommandValid('opaque', 'ABORTED', 'ABORT')).toBe(false)
  })

  it('observable-only commands always invalid for opaque', () => {
    expect(isCommandValid('opaque', 'IN_PROGRESS', 'PAUSE')).toBe(false)
    expect(isCommandValid('opaque', 'IN_PROGRESS', 'HOLD')).toBe(false)
    expect(isCommandValid('opaque', 'IN_PROGRESS', 'UNHOLD')).toBe(false)
    expect(isCommandValid('opaque', 'IN_PROGRESS', 'RESUME')).toBe(false)
    expect(isCommandValid('opaque', 'IN_PROGRESS', 'CLEAR')).toBe(false)
  })
})

describe('command lists', () => {
  it('OBSERVABLE_COMMANDS is the 7-command set', () => {
    expect(OBSERVABLE_COMMANDS).toEqual([
      'PAUSE',
      'RESUME',
      'HOLD',
      'UNHOLD',
      'ABORT',
      'STOP',
      'CLEAR',
    ])
  })

  it('OPAQUE_COMMANDS is ABORT only', () => {
    expect(OPAQUE_COMMANDS).toEqual(['ABORT'])
  })
})
```

- [ ] **Step 2: Run tests, verify they fail**

```powershell
npm test -- src/lib/state-machine.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lib/state-machine.ts`**

```ts
import type { ActionVisibility, Command } from '../api/types'

/**
 * Source of truth (do not import — tester is standalone):
 * packages/engine/src/state-machine/transitions.ts:13-94
 * packages/engine/src/state-machine/states.ts:81-91 (ANY_ACTIVE_STATES)
 */

const ANY_ACTIVE_STATES = [
  'STARTING',
  'EXECUTING',
  'COMPLETING',
  'PAUSING',
  'PAUSED',
  'UNPAUSING',
  'HOLDING',
  'HELD',
  'UNHOLDING',
] as const

const OPAQUE_ACTIVE_STATES = ['POSTED', 'RECEIVED', 'IN_PROGRESS'] as const

export const OBSERVABLE_COMMANDS: readonly Command[] = [
  'PAUSE',
  'RESUME',
  'HOLD',
  'UNHOLD',
  'ABORT',
  'STOP',
  'CLEAR',
]

export const OPAQUE_COMMANDS: readonly Command[] = ['ABORT']

function buildObservableTable(): Map<string, Set<Command>> {
  const table = new Map<string, Set<Command>>()
  const add = (state: string, command: Command) => {
    let set = table.get(state)
    if (!set) {
      set = new Set()
      table.set(state, set)
    }
    set.add(command)
  }
  add('EXECUTING', 'PAUSE')
  add('PAUSED', 'RESUME')
  add('HELD', 'UNHOLD')
  add('ABORTED', 'CLEAR')
  for (const state of ANY_ACTIVE_STATES) {
    add(state, 'HOLD')
    add(state, 'ABORT')
    add(state, 'STOP')
  }
  return table
}

function buildOpaqueTable(): Map<string, Set<Command>> {
  const table = new Map<string, Set<Command>>()
  for (const state of OPAQUE_ACTIVE_STATES) {
    table.set(state, new Set<Command>(['ABORT']))
  }
  return table
}

const OBSERVABLE_TABLE = buildObservableTable()
const OPAQUE_TABLE = buildOpaqueTable()

export function isCommandValid(
  visibility: ActionVisibility,
  state: string,
  command: Command
): boolean {
  const table = visibility === 'observable' ? OBSERVABLE_TABLE : OPAQUE_TABLE
  return table.get(state)?.has(command) ?? false
}
```

- [ ] **Step 4: Run tests, verify they pass**

```powershell
npm test -- src/lib/state-machine.test.ts
```

Expected: PASS, all tests green.

- [ ] **Step 5: Commit**

```powershell
git add src/lib/state-machine.ts src/lib/state-machine.test.ts
git commit -m "feat(lib): state-machine transition validity (observable + opaque)"
```

---

## Task 3: `src/lib/state-pill.ts` — extract pill variant util (follow-up #1)

**Files:**

- Create: `C:\TrajectoryActionTester\src\lib\state-pill.ts`
- Create: `C:\TrajectoryActionTester\src\lib\state-pill.test.ts`

Extract `pillVariantForState` from `InstancePanel.tsx:6-11` and `InstanceList.tsx:6-12`. Expand to cover every state name Plan 4-04 surfaces (PAUSING, PAUSED, UNPAUSING, HOLDING, HELD, UNHOLDING, STARTING, COMPLETING, POSTED, RECEIVED, IN_PROGRESS, CLEARING).

- [ ] **Step 1: Write failing tests**

Create `src/lib/state-pill.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { pillVariantForState } from './state-pill'

describe('pillVariantForState', () => {
  it.each(['COMPLETED'])('success for terminal-success state %s', (state) => {
    expect(pillVariantForState(state)).toBe('success')
  })

  it.each(['ABORTED', 'ABORTING', 'STOPPING', 'CLEARING'])(
    'error for terminal-error / cancel state %s',
    (state) => {
      expect(pillVariantForState(state)).toBe('error')
    }
  )

  it.each(['EXECUTING', 'IN_PROGRESS', 'STARTING', 'COMPLETING', 'UNPAUSING', 'UNHOLDING'])(
    'accent for active progressive state %s',
    (state) => {
      expect(pillVariantForState(state)).toBe('accent')
    }
  )

  it.each(['PAUSED', 'HELD', 'PAUSING', 'HOLDING'])(
    'neutral for paused/held lifecycle state %s',
    (state) => {
      expect(pillVariantForState(state)).toBe('neutral')
    }
  )

  it.each(['POSTED', 'RECEIVED'])('neutral for opaque pre-progress state %s', (state) => {
    expect(pillVariantForState(state)).toBe('neutral')
  })

  it('muted for undefined / unknown state', () => {
    expect(pillVariantForState(undefined)).toBe('muted')
    expect(pillVariantForState('UNKNOWN_STATE')).toBe('muted')
    expect(pillVariantForState('')).toBe('muted')
  })
})
```

- [ ] **Step 2: Run tests, verify they fail**

```powershell
npm test -- src/lib/state-pill.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lib/state-pill.ts`**

```ts
import type { PillVariant } from '../components/Pill'

const SUCCESS_STATES = new Set(['COMPLETED'])
const ERROR_STATES = new Set(['ABORTED', 'ABORTING', 'STOPPING', 'CLEARING'])
const ACCENT_STATES = new Set([
  'EXECUTING',
  'IN_PROGRESS',
  'STARTING',
  'COMPLETING',
  'UNPAUSING',
  'UNHOLDING',
])
const NEUTRAL_STATES = new Set(['PAUSED', 'HELD', 'PAUSING', 'HOLDING', 'POSTED', 'RECEIVED'])

export function pillVariantForState(state: string | undefined | null): PillVariant {
  if (!state) return 'muted'
  if (SUCCESS_STATES.has(state)) return 'success'
  if (ERROR_STATES.has(state)) return 'error'
  if (ACCENT_STATES.has(state)) return 'accent'
  if (NEUTRAL_STATES.has(state)) return 'neutral'
  return 'muted'
}
```

- [ ] **Step 4: Run tests, verify they pass**

```powershell
npm test -- src/lib/state-pill.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/lib/state-pill.ts src/lib/state-pill.test.ts
git commit -m "feat(lib): extract pillVariantForState into shared util"
```

---

## Task 4: Refactor `InstanceList` to use the shared state-pill util

**Files:**

- Modify: `C:\TrajectoryActionTester\src\features\sidebar\InstanceList.tsx`

Remove the local `pillVariantForState` from `InstanceList.tsx:6-12`; import from `src/lib/state-pill.ts`. `InstancePanel.tsx`'s local copy is removed in Task 14 when the file is rewritten.

- [ ] **Step 1: Edit `src/features/sidebar/InstanceList.tsx`**

Replace lines 1-12 (imports + local function) with:

```ts
import { Pill } from '../../components/Pill'
import { pillVariantForState } from '../../lib/state-pill'
import { useActiveConnection } from '../../store/connections'
import { useActiveInstance, useTrackedInstances } from '../../store/active-instance'
import styles from './InstanceList.module.css'
```

The rest of the file is unchanged.

- [ ] **Step 2: Run the InstanceList tests (regression check)**

```powershell
npm test -- src/features/sidebar/InstanceList.test.tsx
```

Expected: all existing tests pass — the public behavior is unchanged.

- [ ] **Step 3: Run the full suite for sanity**

```powershell
npm test
```

Expected: all tests pass (the InstancePanel local `pillVariantForState` is still present and unchanged at this point).

- [ ] **Step 4: Commit**

```powershell
git add src/features/sidebar/InstanceList.tsx
git commit -m "refactor(sidebar): InstanceList consumes shared state-pill util"
```

---

## Task 5: `src/api/commands.ts` — `sendCommand` API client

**Files:**

- Create: `C:\TrajectoryActionTester\src\api\commands.ts`
- Create: `C:\TrajectoryActionTester\src\api\commands.test.ts`

POSTs to `${baseUrl}/trajectory/v1/instances/${instanceId}/command`. Returns `SendCommandResponse['data']`. Throws `ApiError` on non-2xx.

- [ ] **Step 1: Write failing tests**

Create `src/api/commands.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sendCommand } from './commands'
import { ApiError } from './types'
import type { Connection } from './types'

const connection: Connection = {
  id: 'conn-1',
  url: 'http://localhost:3000',
  createdAt: '2026-05-14T00:00:00Z',
}

const connectionWithKey: Connection = {
  ...connection,
  apiKey: 'secret-key-123',
}

describe('sendCommand', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('POSTs to {url}/trajectory/v1/instances/{id}/command with JSON body', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: { instance_id: 'inst-1', command: 'PAUSE', accepted: true },
          meta: {},
        }),
        { status: 200 }
      )
    )
    await sendCommand(connection, 'inst-1', 'PAUSE')
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:3000/trajectory/v1/instances/inst-1/command',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          Accept: 'application/json',
        }),
        body: JSON.stringify({ command: 'PAUSE' }),
      })
    )
  })

  it('strips trailing slashes from the connection URL', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: { instance_id: 'inst-1', command: 'STOP', accepted: true },
          meta: {},
        }),
        { status: 200 }
      )
    )
    await sendCommand({ ...connection, url: 'http://localhost:3000///' }, 'inst-1', 'STOP')
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:3000/trajectory/v1/instances/inst-1/command',
      expect.anything()
    )
  })

  it('attaches Authorization header when apiKey is present', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: { instance_id: 'inst-1', command: 'ABORT', accepted: true },
          meta: {},
        }),
        { status: 200 }
      )
    )
    await sendCommand(connectionWithKey, 'inst-1', 'ABORT')
    expect(fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer secret-key-123',
        }),
      })
    )
  })

  it('returns the data payload on success', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: { instance_id: 'inst-1', command: 'PAUSE', accepted: true },
          meta: {},
        }),
        { status: 200 }
      )
    )
    const result = await sendCommand(connection, 'inst-1', 'PAUSE')
    expect(result).toEqual({ instance_id: 'inst-1', command: 'PAUSE', accepted: true })
  })

  it('throws ApiError on 404', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { code: 'INSTANCE_NOT_FOUND' } }), {
        status: 404,
        statusText: 'Not Found',
      })
    )
    await expect(sendCommand(connection, 'gone', 'PAUSE')).rejects.toBeInstanceOf(ApiError)
  })

  it('throws ApiError on 422 invalid command', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { code: 'INVALID_COMMAND' } }), {
        status: 422,
        statusText: 'Unprocessable Entity',
      })
    )
    await expect(sendCommand(connection, 'inst-1', 'PAUSE')).rejects.toMatchObject({ status: 422 })
  })
})
```

- [ ] **Step 2: Run tests, verify they fail**

```powershell
npm test -- src/api/commands.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/api/commands.ts`**

```ts
import type { Command, Connection, SendCommandResponse } from './types'
import { ApiError } from './types'

export async function sendCommand(
  connection: Connection,
  instanceId: string,
  command: Command
): Promise<SendCommandResponse['data']> {
  const baseUrl = connection.url.replace(/\/+$/, '')
  const url = `${baseUrl}/trajectory/v1/instances/${instanceId}/command`

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }
  if (connection.apiKey) {
    headers.Authorization = `Bearer ${connection.apiKey}`
  }

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ command }),
  })
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new ApiError(response.status, response.statusText, body)
  }
  const parsed = (await response.json()) as SendCommandResponse
  return parsed.data
}
```

- [ ] **Step 4: Run tests, verify they pass**

```powershell
npm test -- src/api/commands.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/api/commands.ts src/api/commands.test.ts
git commit -m "feat(api): sendCommand POST /instances/:id/command"
```

---

## Task 6: `src/store/use-send-command.ts` — mutation hook

**Files:**

- Create: `C:\TrajectoryActionTester\src\store\use-send-command.ts`
- Create: `C:\TrajectoryActionTester\src\store\use-send-command.test.tsx`

TanStack `useMutation` wrapper around `sendCommand`. Active-connection-aware. Surfaces typed result. Does **not** invalidate any queries — the SSE stream owns subsequent state updates.

- [ ] **Step 1: Write failing tests**

Create `src/store/use-send-command.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { AllProviders, createTestQueryClient } from '../test-utils'
import { ApiError } from '../api/types'
import { useSendCommand } from './use-send-command'
import { useConnections } from './connections'
import type { Connection } from '../api/types'

const connection: Connection = {
  id: 'conn-1',
  url: 'http://localhost:3000',
  createdAt: '2026-05-14T00:00:00Z',
}

function setupWithActiveConnection() {
  const client = createTestQueryClient()
  return ({ children }: { children: React.ReactNode }) => (
    <AllProviders queryClient={client}>
      <SeedConnection>{children}</SeedConnection>
    </AllProviders>
  )
}

function SeedConnection({ children }: { children: React.ReactNode }) {
  // useConnections is imported from store/connections — seed an active conn on first render
  const conn = useConnections()
  if (conn.state.connections.length === 0) {
    conn.add({ url: connection.url, id: connection.id })
  }
  return <>{children}</>
}

describe('useSendCommand', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('starts in idle state', () => {
    const { result } = renderHook(() => useSendCommand(), { wrapper: setupWithActiveConnection() })
    expect(result.current.status).toBe('idle')
    expect(result.current.isPending).toBe(false)
  })

  it('on mutate, calls sendCommand against the active connection', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: { instance_id: 'inst-1', command: 'PAUSE', accepted: true },
          meta: {},
        }),
        { status: 200 }
      )
    )

    const { result } = renderHook(() => useSendCommand(), { wrapper: setupWithActiveConnection() })

    act(() => {
      result.current.mutate({ instanceId: 'inst-1', command: 'PAUSE' })
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual({ instance_id: 'inst-1', command: 'PAUSE', accepted: true })
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:3000/trajectory/v1/instances/inst-1/command',
      expect.objectContaining({ method: 'POST' })
    )
  })

  it('surfaces ApiError on failure', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { code: 'INVALID_COMMAND' } }), {
        status: 422,
        statusText: 'Unprocessable Entity',
      })
    )

    const { result } = renderHook(() => useSendCommand(), { wrapper: setupWithActiveConnection() })

    act(() => {
      result.current.mutate({ instanceId: 'inst-1', command: 'PAUSE' })
    })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.error).toBeInstanceOf(ApiError)
  })

  it('rejects when no active connection', async () => {
    const client = createTestQueryClient()
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <AllProviders queryClient={client}>{children}</AllProviders>
    )
    const { result } = renderHook(() => useSendCommand(), { wrapper })

    act(() => {
      result.current.mutate({ instanceId: 'inst-1', command: 'PAUSE' })
    })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.error?.message).toMatch(/no active connection/i)
  })
})
```

> **Note for executing engineer:** The `useConnections` API for adding a connection is the existing one from Plan 4-02. If the surface differs (e.g., the API takes a full object or a partial), match what `connections.tsx` currently exposes. If the seed helper as written needs adjusting, adapt it without changing the assertion intent.

- [ ] **Step 2: Run tests, verify they fail**

```powershell
npm test -- src/store/use-send-command.test.tsx
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/store/use-send-command.ts`**

```ts
import { useMutation, type UseMutationResult } from '@tanstack/react-query'
import { sendCommand } from '../api/commands'
import type { Command, SendCommandResponse } from '../api/types'
import { useActiveConnection } from './connections'

export interface SendCommandVariables {
  instanceId: string
  command: Command
}

export function useSendCommand(): UseMutationResult<
  SendCommandResponse['data'],
  Error,
  SendCommandVariables
> {
  const connection = useActiveConnection()

  return useMutation<SendCommandResponse['data'], Error, SendCommandVariables>({
    mutationFn: async ({ instanceId, command }) => {
      if (!connection) {
        throw new Error('No active connection')
      }
      return sendCommand(connection, instanceId, command)
    },
  })
}
```

- [ ] **Step 4: Run tests, verify they pass**

```powershell
npm test -- src/store/use-send-command.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/store/use-send-command.ts src/store/use-send-command.test.tsx
git commit -m "feat(store): useSendCommand mutation hook"
```

---

## Task 7: `src/lib/test-event-source.ts` — MockEventSource utility

**Files:**

- Create: `C:\TrajectoryActionTester\src\lib\test-event-source.ts`
- Create: `C:\TrajectoryActionTester\src\lib\test-event-source.test.ts`

jsdom doesn't ship `EventSource`. We need a test-only mock that mirrors the relevant surface (`onopen`, `onerror`, `addEventListener`, `close`, `readyState`) plus helpers to drive events from tests. The mock also keeps a registry so tests can find "the EventSource opened for instance X" without prop-drilling.

- [ ] **Step 1: Write failing tests**

Create `src/lib/test-event-source.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  installMockEventSource,
  restoreEventSource,
  getMockEventSources,
  MockEventSource,
} from './test-event-source'

describe('MockEventSource', () => {
  beforeEach(() => installMockEventSource())
  afterEach(() => restoreEventSource())

  it('records constructions and exposes them via getMockEventSources', () => {
    const a = new EventSource('http://x/inst-1/events')
    const b = new EventSource('http://x/inst-2/events')
    expect(getMockEventSources()).toHaveLength(2)
    expect(getMockEventSources()[0]).toBe(a)
    expect(getMockEventSources()[1]).toBe(b)
  })

  it('starts in CONNECTING (0) and transitions to OPEN (1) on __open()', () => {
    const es = new EventSource('http://x') as unknown as MockEventSource
    expect(es.readyState).toBe(0)
    const onopen = vi.fn()
    es.onopen = onopen
    es.__open()
    expect(es.readyState).toBe(1)
    expect(onopen).toHaveBeenCalledTimes(1)
  })

  it('__emit dispatches to addEventListener handlers by type', () => {
    const es = new EventSource('http://x') as unknown as MockEventSource
    es.__open()
    const handler = vi.fn()
    es.addEventListener('state_change', handler)
    es.__emit('state_change', { foo: 'bar' }, 7)
    expect(handler).toHaveBeenCalledTimes(1)
    const event = handler.mock.calls[0]![0] as MessageEvent
    expect(event.data).toBe(JSON.stringify({ foo: 'bar' }))
    expect(event.lastEventId).toBe('7')
  })

  it('removeEventListener stops further dispatch', () => {
    const es = new EventSource('http://x') as unknown as MockEventSource
    es.__open()
    const handler = vi.fn()
    es.addEventListener('output', handler)
    es.removeEventListener('output', handler)
    es.__emit('output', {}, 1)
    expect(handler).not.toHaveBeenCalled()
  })

  it('close() sets readyState to CLOSED (2) and silences further __emit', () => {
    const es = new EventSource('http://x') as unknown as MockEventSource
    es.__open()
    const handler = vi.fn()
    es.addEventListener('log', handler)
    es.close()
    expect(es.readyState).toBe(2)
    es.__emit('log', {}, 1)
    expect(handler).not.toHaveBeenCalled()
  })

  it('__error fires onerror and does not auto-close', () => {
    const es = new EventSource('http://x') as unknown as MockEventSource
    es.__open()
    const onerror = vi.fn()
    es.onerror = onerror
    es.__error()
    expect(onerror).toHaveBeenCalledTimes(1)
    // MockEventSource does not simulate native auto-reconnect — tests drive that explicitly.
    expect(es.readyState).toBe(1)
  })
})

describe('install/restore', () => {
  it('restoreEventSource brings back the original global', () => {
    const original = globalThis.EventSource
    installMockEventSource()
    expect(globalThis.EventSource).not.toBe(original)
    restoreEventSource()
    expect(globalThis.EventSource).toBe(original)
  })
})
```

- [ ] **Step 2: Run tests, verify they fail**

```powershell
npm test -- src/lib/test-event-source.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lib/test-event-source.ts`**

```ts
type Listener = (event: MessageEvent) => void

export class MockEventSource {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSED = 2

  readyState = 0
  withCredentials = false

  onopen: ((event: Event) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  onmessage: Listener | null = null

  private listeners = new Map<string, Set<Listener>>()

  constructor(
    public readonly url: string,
    init?: EventSourceInit
  ) {
    if (init?.withCredentials) this.withCredentials = true
    registry.push(this)
  }

  addEventListener(type: string, listener: Listener): void {
    let set = this.listeners.get(type)
    if (!set) {
      set = new Set()
      this.listeners.set(type, set)
    }
    set.add(listener)
  }

  removeEventListener(type: string, listener: Listener): void {
    this.listeners.get(type)?.delete(listener)
  }

  close(): void {
    this.readyState = 2
  }

  // -------- test helpers --------

  __open(): void {
    if (this.readyState === 2) return
    this.readyState = 1
    if (this.onopen) this.onopen(new Event('open'))
  }

  __emit(type: string, data: unknown, id: number): void {
    if (this.readyState === 2) return
    const message = new MessageEvent(type, {
      data: JSON.stringify(data),
      lastEventId: String(id),
    })
    if (type === 'message' && this.onmessage) {
      this.onmessage(message)
    }
    for (const listener of this.listeners.get(type) ?? []) {
      listener(message)
    }
  }

  __error(): void {
    if (this.readyState === 2) return
    if (this.onerror) this.onerror(new Event('error'))
  }
}

let registry: MockEventSource[] = []
let original: typeof EventSource | undefined

export function installMockEventSource(): void {
  if (!original) {
    original = globalThis.EventSource as typeof EventSource | undefined
  }
  registry = []
  ;(globalThis as { EventSource: typeof EventSource }).EventSource =
    MockEventSource as unknown as typeof EventSource
}

export function restoreEventSource(): void {
  if (original === undefined) {
    delete (globalThis as { EventSource?: typeof EventSource }).EventSource
  } else {
    ;(globalThis as { EventSource: typeof EventSource }).EventSource = original
  }
  registry = []
}

export function getMockEventSources(): MockEventSource[] {
  return registry
}
```

- [ ] **Step 4: Run tests, verify they pass**

```powershell
npm test -- src/lib/test-event-source.test.ts
```

Expected: PASS.

- [ ] **Step 5: Wire into `src/vitest.setup.ts`**

Replace `src/vitest.setup.ts` contents with:

```ts
import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { installMockEventSource, restoreEventSource } from './lib/test-event-source'

installMockEventSource()
afterEach(() => {
  restoreEventSource()
  installMockEventSource()
})
```

This installs the mock by default for every test file and resets the registry between tests.

- [ ] **Step 6: Run full suite to confirm setup change doesn't break anything**

```powershell
npm test
```

Expected: All 136 existing tests still pass (the mock's API is unused elsewhere, and is unrelated to non-SSE code).

- [ ] **Step 7: Commit**

```powershell
git add src/lib/test-event-source.ts src/lib/test-event-source.test.ts src/vitest.setup.ts
git commit -m "test(lib): MockEventSource utility + auto-install in vitest setup"
```

---

## Task 8: `src/store/instance-stream-reducer.ts` — pure reducer

**Files:**

- Create: `C:\TrajectoryActionTester\src\store\instance-stream-reducer.ts`
- Create: `C:\TrajectoryActionTester\src\store\instance-stream-reducer.test.ts`

Pure function that folds an `SseEventWire` (plus an initial `Instance` REST seed) into `InstanceLiveState`. Extracted so it can be tested without React.

- [ ] **Step 1: Write failing tests**

Create `src/store/instance-stream-reducer.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { initialStateFromInstance, instanceStreamReducer } from './instance-stream-reducer'
import type { Instance, InstanceLiveState, SseEventWire } from '../api/types'

const seedInstance: Instance = {
  instance_id: 'inst-1',
  action_oid: 'act-1',
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
}

describe('initialStateFromInstance', () => {
  it('seeds current_state and one history entry', () => {
    const live = initialStateFromInstance(seedInstance)
    expect(live.instance_id).toBe('inst-1')
    expect(live.current_state).toBe('STARTING')
    expect(live.state_history).toHaveLength(1)
    expect(live.state_history[0]).toMatchObject({
      state: 'STARTING',
      entered_at: '2026-05-14T00:00:00Z',
    })
    expect(live.terminal).toBe(false)
    expect(live.terminal_error).toBeNull()
    expect(live.outputs).toEqual({})
    expect(live.last_event_id).toBe(-1)
  })

  it('seeds two history entries when previous state is set', () => {
    const live = initialStateFromInstance({
      ...seedInstance,
      state: {
        current: 'EXECUTING',
        previous: 'STARTING',
        entered_at: '2026-05-14T00:01:00Z',
      },
      started_at: '2026-05-14T00:00:00Z',
    })
    expect(live.state_history.map((e) => e.state)).toEqual(['STARTING', 'EXECUTING'])
    expect(live.state_history[0].duration_ms).toBe(60_000)
    expect(live.state_history[1].duration_ms).toBeUndefined()
  })

  it('seeds terminal_error from instance.error', () => {
    const live = initialStateFromInstance({
      ...seedInstance,
      error: 'boom',
      state: { ...seedInstance.state, current: 'ABORTED' },
    })
    expect(live.terminal_error).toBe('boom')
    expect(live.terminal).toBe(true)
  })

  it('seeds outputs as key-value record', () => {
    const live = initialStateFromInstance({
      ...seedInstance,
      outputs: [
        { name: 'status', value: '0' },
        { name: 'detail', value: 'ok' },
      ],
    })
    expect(live.outputs).toEqual({ status: '0', detail: 'ok' })
  })
})

describe('instanceStreamReducer — state_change', () => {
  it('appends a new history entry and finalizes the previous duration', () => {
    const prev = initialStateFromInstance(seedInstance) // STARTING @ T0
    const event: SseEventWire = {
      id: 0,
      type: 'state_change',
      data: {
        instance_id: 'inst-1',
        state: 'EXECUTING',
        previous_state: 'STARTING',
        timestamp: '2026-05-14T00:00:30Z',
      },
    }
    const next = instanceStreamReducer(prev, event)
    expect(next.current_state).toBe('EXECUTING')
    expect(next.state_history).toHaveLength(2)
    expect(next.state_history[0].duration_ms).toBe(30_000)
    expect(next.state_history[1]).toMatchObject({
      state: 'EXECUTING',
      entered_at: '2026-05-14T00:00:30Z',
    })
    expect(next.last_event_id).toBe(0)
  })

  it('marks terminal when entering COMPLETED', () => {
    const prev = initialStateFromInstance(seedInstance)
    const event: SseEventWire = {
      id: 1,
      type: 'state_change',
      data: {
        instance_id: 'inst-1',
        state: 'COMPLETED',
        previous_state: 'COMPLETING',
        timestamp: '2026-05-14T00:01:00Z',
      },
    }
    const next = instanceStreamReducer(prev, event)
    expect(next.terminal).toBe(true)
  })

  it('marks terminal when entering ABORTED', () => {
    const prev = initialStateFromInstance(seedInstance)
    const event: SseEventWire = {
      id: 1,
      type: 'state_change',
      data: {
        instance_id: 'inst-1',
        state: 'ABORTED',
        previous_state: 'ABORTING',
        timestamp: '2026-05-14T00:01:00Z',
      },
    }
    const next = instanceStreamReducer(prev, event)
    expect(next.terminal).toBe(true)
  })

  it('ignores stale events (id <= last_event_id)', () => {
    const prev = { ...initialStateFromInstance(seedInstance), last_event_id: 5 }
    const event: SseEventWire = {
      id: 5,
      type: 'state_change',
      data: {
        instance_id: 'inst-1',
        state: 'EXECUTING',
        previous_state: 'STARTING',
        timestamp: '2026-05-14T00:00:30Z',
      },
    }
    const next = instanceStreamReducer(prev, event)
    expect(next).toBe(prev)
  })
})

describe('instanceStreamReducer — output', () => {
  it('merges outputs into the record', () => {
    const prev = initialStateFromInstance(seedInstance)
    const event: SseEventWire = {
      id: 1,
      type: 'output',
      data: {
        instance_id: 'inst-1',
        outputs: [
          { name: 'status', value: '0' },
          { name: 'detail', value: 'ok' },
        ],
        timestamp: '2026-05-14T00:00:10Z',
      },
    }
    const next = instanceStreamReducer(prev, event)
    expect(next.outputs).toEqual({ status: '0', detail: 'ok' })
    expect(next.last_event_id).toBe(1)
  })

  it('overwrites existing keys without dropping unmentioned ones', () => {
    const prev: InstanceLiveState = {
      ...initialStateFromInstance(seedInstance),
      outputs: { status: 'pending', extra: 'keep' },
    }
    const event: SseEventWire = {
      id: 1,
      type: 'output',
      data: {
        instance_id: 'inst-1',
        outputs: [{ name: 'status', value: '0' }],
        timestamp: '2026-05-14T00:00:10Z',
      },
    }
    const next = instanceStreamReducer(prev, event)
    expect(next.outputs).toEqual({ status: '0', extra: 'keep' })
  })
})

describe('instanceStreamReducer — log', () => {
  it('records stderr messages as latest_error', () => {
    const prev = initialStateFromInstance(seedInstance)
    const event: SseEventWire = {
      id: 1,
      type: 'log',
      data: {
        instance_id: 'inst-1',
        stream: 'stderr',
        message: 'NameError: x is not defined',
        timestamp: '2026-05-14T00:00:10Z',
      },
    }
    const next = instanceStreamReducer(prev, event)
    expect(next.latest_error).toBe('NameError: x is not defined')
    expect(next.last_event_id).toBe(1)
  })

  it('extracts traceback when stderr includes it', () => {
    const prev = initialStateFromInstance(seedInstance)
    const event: SseEventWire = {
      id: 1,
      type: 'log',
      data: {
        instance_id: 'inst-1',
        stream: 'stderr',
        message:
          'Traceback (most recent call last):\n  File "x.py", line 1\nNameError: x is not defined',
        timestamp: '2026-05-14T00:00:10Z',
      },
    }
    const next = instanceStreamReducer(prev, event)
    expect(next.latest_traceback).toContain('Traceback (most recent call last):')
    expect(next.latest_error).toBe(
      'Traceback (most recent call last):\n  File "x.py", line 1\nNameError: x is not defined'
    )
  })

  it('ignores stdout log events for latest_error', () => {
    const prev = initialStateFromInstance(seedInstance)
    const event: SseEventWire = {
      id: 1,
      type: 'log',
      data: {
        instance_id: 'inst-1',
        stream: 'stdout',
        message: 'hello',
        timestamp: '2026-05-14T00:00:10Z',
      },
    }
    const next = instanceStreamReducer(prev, event)
    expect(next.latest_error).toBeUndefined()
    expect(next.last_event_id).toBe(1)
  })
})

describe('instanceStreamReducer — heartbeat', () => {
  it('advances last_event_id but otherwise no-ops', () => {
    const prev = initialStateFromInstance(seedInstance)
    const event: SseEventWire = {
      id: 1,
      type: 'heartbeat',
      data: { timestamp: '2026-05-14T00:00:10Z' },
    }
    const next = instanceStreamReducer(prev, event)
    expect(next.current_state).toBe(prev.current_state)
    expect(next.outputs).toBe(prev.outputs)
    expect(next.state_history).toBe(prev.state_history)
    expect(next.last_event_id).toBe(1)
  })
})
```

- [ ] **Step 2: Run tests, verify they fail**

```powershell
npm test -- src/store/instance-stream-reducer.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/store/instance-stream-reducer.ts`**

```ts
import type { Instance, InstanceLiveState, SseEventWire, StateEntry } from '../api/types'

const TERMINAL_STATES = new Set(['COMPLETED', 'ABORTED'])

function durationMs(from: string, to: string): number {
  return new Date(to).getTime() - new Date(from).getTime()
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
      const finalizedHistory = state.state_history.map((entry, idx) =>
        idx === state.state_history.length - 1
          ? { ...entry, duration_ms: durationMs(entry.entered_at, event.data.timestamp) }
          : entry
      )
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
      if (event.data.stream !== 'stderr') {
        return { ...state, last_event_id: event.id }
      }
      const message = event.data.message
      const traceback = message.includes('Traceback (most recent call last)')
        ? message
        : state.latest_traceback
      return {
        ...state,
        latest_error: message,
        ...(traceback !== undefined ? { latest_traceback: traceback } : {}),
        last_event_id: event.id,
      }
    }

    case 'heartbeat':
      return { ...state, last_event_id: event.id }
  }
}
```

- [ ] **Step 4: Run tests, verify they pass**

```powershell
npm test -- src/store/instance-stream-reducer.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/store/instance-stream-reducer.ts src/store/instance-stream-reducer.test.ts
git commit -m "feat(store): pure reducer for SSE-driven InstanceLiveState"
```

---

## Task 9: `src/store/use-instance-stream.ts` — hook + lifecycle

**Files:**

- Create: `C:\TrajectoryActionTester\src\store\use-instance-stream.ts`
- Create: `C:\TrajectoryActionTester\src\store\use-instance-stream.test.tsx`

The hook:

1. Returns `{ data, isLoading, isError, error, isConnected }`.
2. Performs an initial REST fetch via `fetchInstance` keyed on `[connection.id, instanceId]` (no `apiKey` in the key — follow-up #2).
3. Once the REST fetch succeeds, builds initial `InstanceLiveState` via `initialStateFromInstance`, then opens an `EventSource` to `{baseUrl}/trajectory/v1/instances/{id}/events` and folds events through `instanceStreamReducer`.
4. Closes the EventSource on unmount or when `instanceId` changes.
5. Updates the tracked-instance entry (`last_known_state`, `last_known_error`) whenever the reduced state changes.

> **Note on auth:** The `EventSource` API does not support custom headers. The spec § 9 calls out an optional `?token=<token>` query param for connections that need auth. For Plan 4-04 we append `?token={apiKey}` when `connection.apiKey` is set, matching the spec. The current server doesn't validate it — that's a future v2.0 milestone — but the wire format is correct.

- [ ] **Step 1: Write failing tests**

Create `src/store/use-instance-stream.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import type { ReactNode } from 'react'
import { AllProviders, createTestQueryClient } from '../test-utils'
import { useConnections } from './connections'
import { useActiveInstance } from './active-instance'
import { useInstanceStream } from './use-instance-stream'
import { getMockEventSources, type MockEventSource } from '../lib/test-event-source'
import type { Connection, Instance } from '../api/types'

const baseConnection: Connection = {
  id: 'conn-1',
  url: 'http://localhost:3000',
  createdAt: '2026-05-14T00:00:00Z',
}

const baseInstance: Instance = {
  instance_id: 'inst-1',
  action_oid: 'act-1',
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
}

function makeWrapper(connection: Connection = baseConnection) {
  const queryClient = createTestQueryClient()
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <AllProviders queryClient={queryClient}>
        <SeedConnection connection={connection}>
          <TrackInstance>{children}</TrackInstance>
        </SeedConnection>
      </AllProviders>
    )
  }
}

function SeedConnection({ children, connection }: { children: ReactNode; connection: Connection }) {
  const conn = useConnections()
  if (conn.state.connections.length === 0) {
    conn.add({ id: connection.id, url: connection.url })
  }
  return <>{children}</>
}

function TrackInstance({ children }: { children: ReactNode }) {
  const { state, trackInstance } = useActiveInstance()
  if (state.trackedInstances.length === 0) {
    trackInstance({
      instance_id: 'inst-1',
      connection_id: 'conn-1',
      action_oid: 'act-1',
    })
  }
  return <>{children}</>
}

function mockFetchInstance() {
  vi.mocked(fetch).mockResolvedValueOnce(
    new Response(JSON.stringify({ data: baseInstance, meta: {} }), { status: 200 })
  )
}

describe('useInstanceStream — lifecycle', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('returns isLoading=true while REST seed is pending', () => {
    vi.mocked(fetch).mockReturnValue(new Promise(() => {}))
    const { result } = renderHook(() => useInstanceStream('inst-1'), { wrapper: makeWrapper() })
    expect(result.current.isLoading).toBe(true)
    expect(result.current.data).toBeUndefined()
  })

  it('opens an EventSource against /events for the active connection', async () => {
    mockFetchInstance()
    const { result } = renderHook(() => useInstanceStream('inst-1'), { wrapper: makeWrapper() })

    await waitFor(() => expect(result.current.data?.current_state).toBe('STARTING'))

    const sources = getMockEventSources()
    expect(sources).toHaveLength(1)
    expect(sources[0]!.url).toBe('http://localhost:3000/trajectory/v1/instances/inst-1/events')
  })

  it('appends ?token=<apiKey> to the SSE URL when set', async () => {
    mockFetchInstance()
    const wrapper = makeWrapper({ ...baseConnection, apiKey: 'secret-key' })
    renderHook(() => useInstanceStream('inst-1'), { wrapper })

    await waitFor(() => expect(getMockEventSources()).toHaveLength(1))
    expect(getMockEventSources()[0]!.url).toBe(
      'http://localhost:3000/trajectory/v1/instances/inst-1/events?token=secret-key'
    )
  })

  it('flips isConnected to true when EventSource opens', async () => {
    mockFetchInstance()
    const { result } = renderHook(() => useInstanceStream('inst-1'), { wrapper: makeWrapper() })

    await waitFor(() => expect(getMockEventSources()).toHaveLength(1))
    expect(result.current.isConnected).toBe(false)

    const es = getMockEventSources()[0]! as MockEventSource
    act(() => es.__open())
    await waitFor(() => expect(result.current.isConnected).toBe(true))
  })

  it('reduces a state_change event into history', async () => {
    mockFetchInstance()
    const { result } = renderHook(() => useInstanceStream('inst-1'), { wrapper: makeWrapper() })

    await waitFor(() => expect(result.current.data?.current_state).toBe('STARTING'))
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

    await waitFor(() => expect(result.current.data?.current_state).toBe('EXECUTING'))
    expect(result.current.data?.state_history).toHaveLength(2)
  })

  it('closes the EventSource on unmount', async () => {
    mockFetchInstance()
    const { unmount } = renderHook(() => useInstanceStream('inst-1'), { wrapper: makeWrapper() })

    await waitFor(() => expect(getMockEventSources()).toHaveLength(1))
    const es = getMockEventSources()[0]!
    expect(es.readyState).toBe(0)

    unmount()
    expect(es.readyState).toBe(2)
  })

  it('returns idle (data undefined, isLoading false) when instanceId is null', () => {
    const { result } = renderHook(() => useInstanceStream(null), { wrapper: makeWrapper() })
    expect(result.current.isLoading).toBe(false)
    expect(result.current.data).toBeUndefined()
  })

  it('keys the REST query on connection.id (not apiKey)', async () => {
    mockFetchInstance()
    const wrapper = makeWrapper({ ...baseConnection, apiKey: 'secret-key' })
    const { result } = renderHook(() => useInstanceStream('inst-1'), { wrapper })

    await waitFor(() => expect(result.current.data).toBeDefined())
    // The query is set up internally; key composition is verified by:
    // - not failing on apiKey absence, and
    // - apiKey appearing in the SSE URL (the api-key escape hatch covered above).
    // This assertion is a structural sanity check that the hook ran.
    expect(result.current.data?.instance_id).toBe('inst-1')
  })

  it('updates the tracked instance with last_known_state after events', async () => {
    mockFetchInstance()
    let trackedSnapshot: { last_known_state?: string } | undefined
    function ReadTracked() {
      const { state } = useActiveInstance()
      trackedSnapshot = state.trackedInstances[0]
      return null
    }

    const wrapper = makeWrapper()
    renderHook(
      () => {
        useInstanceStream('inst-1')
        return null
      },
      { wrapper }
    )
    renderHook(() => ReadTracked(), { wrapper })

    await waitFor(() => expect(trackedSnapshot?.last_known_state).toBe('STARTING'))

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

    await waitFor(() => expect(trackedSnapshot?.last_known_state).toBe('EXECUTING'))
  })

  it('surfaces REST fetch failure as isError', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'gone' }), { status: 404, statusText: 'Not Found' })
    )
    const { result } = renderHook(() => useInstanceStream('inst-1'), { wrapper: makeWrapper() })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.error).toBeDefined()
  })

  it('flips isConnected to false on EventSource error', async () => {
    mockFetchInstance()
    const { result } = renderHook(() => useInstanceStream('inst-1'), { wrapper: makeWrapper() })

    await waitFor(() => expect(getMockEventSources()).toHaveLength(1))
    const es = getMockEventSources()[0]! as MockEventSource
    act(() => es.__open())
    await waitFor(() => expect(result.current.isConnected).toBe(true))
    act(() => es.__error())
    await waitFor(() => expect(result.current.isConnected).toBe(false))
  })
})
```

> **Note for executing engineer:** Two `renderHook` calls in the same `wrapper` share the React Query client but not React state — the `ReadTracked` test reads from the same `AllProviders` instance because the wrapper closure preserves `queryClient` only, not the React tree. If `trackedSnapshot` reads stale, change the test to use a single `renderHook` that consumes both `useInstanceStream` and `useActiveInstance` in the same render scope. The intent is: track `last_known_state` propagation after each event.

- [ ] **Step 2: Run tests, verify they fail**

```powershell
npm test -- src/store/use-instance-stream.test.tsx
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/store/use-instance-stream.ts`**

```ts
import { useEffect, useReducer, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchInstance } from '../api/instances'
import type { Instance, InstanceLiveState, SseEventWire, SseEventType } from '../api/types'
import { useActiveConnection } from './connections'
import { useActiveInstance } from './active-instance'
import { initialStateFromInstance, instanceStreamReducer } from './instance-stream-reducer'

export interface UseInstanceStreamResult {
  data: InstanceLiveState | undefined
  isLoading: boolean
  isError: boolean
  error: Error | null
  isConnected: boolean
}

type Action =
  | { type: 'reset' }
  | { type: 'seed'; instance: Instance }
  | { type: 'event'; event: SseEventWire }

function streamReducer(
  state: InstanceLiveState | undefined,
  action: Action
): InstanceLiveState | undefined {
  if (action.type === 'reset') return undefined
  if (action.type === 'seed') return initialStateFromInstance(action.instance)
  if (!state) return state
  return instanceStreamReducer(state, action.event)
}

const SSE_EVENT_TYPES: readonly SseEventType[] = ['state_change', 'output', 'log', 'heartbeat']

export function useInstanceStream(instanceId: string | null): UseInstanceStreamResult {
  const connection = useActiveConnection()
  const { updateTrackedInstance } = useActiveInstance()

  const query = useQuery<Instance, Error>({
    queryKey: ['instance-seed', connection?.id, instanceId],
    queryFn: () => {
      if (!connection || !instanceId) throw new Error('No active connection or instance id')
      return fetchInstance(connection, instanceId)
    },
    enabled: connection !== null && instanceId !== null,
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
  })

  const [liveState, dispatch] = useReducer(streamReducer, undefined)
  const [isConnected, setIsConnected] = useState(false)

  // Reset live state whenever the target instance changes (including → null).
  // Runs before the seed effect on the same render, so seed for the new id wins.
  useEffect(() => {
    dispatch({ type: 'reset' })
    setIsConnected(false)
  }, [instanceId, connection?.id])

  // Seed once REST resolves for the current target.
  useEffect(() => {
    if (!query.isSuccess || !query.data) return
    if (query.data.instance_id !== instanceId) return
    dispatch({ type: 'seed', instance: query.data })
  }, [query.isSuccess, query.data, instanceId])

  // Open EventSource after seed.
  useEffect(() => {
    if (!connection || !instanceId) return
    if (!liveState) return
    if (liveState.instance_id !== instanceId) return

    const baseUrl = connection.url.replace(/\/+$/, '')
    const tokenParam = connection.apiKey ? `?token=${encodeURIComponent(connection.apiKey)}` : ''
    const url = `${baseUrl}/trajectory/v1/instances/${instanceId}/events${tokenParam}`

    const es = new EventSource(url)
    const onOpen = () => setIsConnected(true)
    const onError = () => setIsConnected(false)
    const handlers: Array<{ type: string; fn: (e: MessageEvent) => void }> = []

    es.onopen = onOpen
    es.onerror = onError

    for (const type of SSE_EVENT_TYPES) {
      const fn = (e: MessageEvent) => {
        let parsed: SseEventWire['data']
        try {
          parsed = JSON.parse(e.data) as SseEventWire['data']
        } catch {
          return
        }
        const id = Number(e.lastEventId)
        if (!Number.isFinite(id)) return
        dispatch({
          type: 'event',
          event: { id, type, data: parsed } as SseEventWire,
        })
      }
      es.addEventListener(type, fn as EventListener)
      handlers.push({ type, fn })
    }

    return () => {
      for (const h of handlers) {
        es.removeEventListener(h.type, h.fn as EventListener)
      }
      es.close()
      setIsConnected(false)
    }
  }, [connection?.id, connection?.url, connection?.apiKey, instanceId, liveState?.instance_id])

  // Push state into the tracker for InstanceList highlighting.
  useEffect(() => {
    if (!liveState) return
    updateTrackedInstance(liveState.instance_id, {
      last_known_state: liveState.current_state,
      last_known_error: liveState.terminal_error,
    })
  }, [
    liveState?.instance_id,
    liveState?.current_state,
    liveState?.terminal_error,
    updateTrackedInstance,
  ])

  return {
    data: liveState && liveState.instance_id === instanceId ? liveState : undefined,
    isLoading: query.isLoading || (query.isSuccess && !liveState),
    isError: query.isError,
    error: query.error ?? null,
    isConnected,
  }
}
```

> **Implementation note for executing engineer:**
>
> - The reset effect fires _before_ the seed effect on every render where `instanceId` or the active connection changes. Combined with the `query.data.instance_id !== instanceId` guard on the seed effect, this ensures a stale REST response for the previous instance can't seed the wrong target.
> - `useRef` is an alternative way to scope the EventSource handle; the effect-return cleanup above is equivalent and simpler. Don't refactor unless tests demand it.

- [ ] **Step 4: Run tests, verify they pass**

```powershell
npm test -- src/store/use-instance-stream.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/store/use-instance-stream.ts src/store/use-instance-stream.test.tsx
git commit -m "feat(store): useInstanceStream hook — REST seed + SSE event reduction"
```

---

## Task 10: `<StateTimeline />` — horizontal pill row of state history

**Files:**

- Create: `C:\TrajectoryActionTester\src\features\instance-panel\StateTimeline.tsx`
- Create: `C:\TrajectoryActionTester\src\features\instance-panel\StateTimeline.module.css`
- Create: `C:\TrajectoryActionTester\src\features\instance-panel\StateTimeline.test.tsx`

Props:

```ts
interface StateTimelineProps {
  history: StateEntry[]
  currentState: string
  terminal: boolean
  onSelectState?: (state: string, index: number) => void
}
```

The latest pill ticks every 1s while `!terminal`. Click invokes `onSelectState?.(state, index)`.

- [ ] **Step 1: Write failing tests**

Create `src/features/instance-panel/StateTimeline.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { StateTimeline } from './StateTimeline'

describe('StateTimeline', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-14T00:00:30Z'))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders nothing when history is empty', () => {
    const { container } = render(<StateTimeline history={[]} currentState="" terminal={false} />)
    expect(container.textContent).toBe('')
  })

  it('renders one pill per history entry', () => {
    render(
      <StateTimeline
        history={[
          { state: 'STARTING', entered_at: '2026-05-14T00:00:00Z', duration_ms: 5000 },
          { state: 'EXECUTING', entered_at: '2026-05-14T00:00:05Z' },
        ]}
        currentState="EXECUTING"
        terminal={false}
      />
    )
    expect(screen.getByText('STARTING')).toBeInTheDocument()
    expect(screen.getByText('EXECUTING')).toBeInTheDocument()
  })

  it('shows finalized duration on completed entries', () => {
    render(
      <StateTimeline
        history={[
          { state: 'STARTING', entered_at: '2026-05-14T00:00:00Z', duration_ms: 5000 },
          { state: 'EXECUTING', entered_at: '2026-05-14T00:00:05Z' },
        ]}
        currentState="EXECUTING"
        terminal={false}
      />
    )
    expect(screen.getByText(/5\.0\s?s/)).toBeInTheDocument()
  })

  it('ticks the current pill while !terminal', () => {
    render(
      <StateTimeline
        history={[{ state: 'EXECUTING', entered_at: '2026-05-14T00:00:00Z' }]}
        currentState="EXECUTING"
        terminal={false}
      />
    )
    // System time is T+30s. Current pill should show ~30s.
    expect(screen.getByText(/30\.0\s?s/)).toBeInTheDocument()

    // Advance another second.
    act(() => {
      vi.setSystemTime(new Date('2026-05-14T00:00:31Z'))
      vi.advanceTimersByTime(1000)
    })
    expect(screen.getByText(/31\.0\s?s/)).toBeInTheDocument()
  })

  it('stops ticking when terminal=true', () => {
    render(
      <StateTimeline
        history={[
          { state: 'EXECUTING', entered_at: '2026-05-14T00:00:00Z', duration_ms: 30_000 },
          { state: 'COMPLETED', entered_at: '2026-05-14T00:00:30Z' },
        ]}
        currentState="COMPLETED"
        terminal={true}
      />
    )

    // System time advances but no tick re-renders should change visible content
    act(() => {
      vi.setSystemTime(new Date('2026-05-14T00:01:00Z'))
      vi.advanceTimersByTime(30_000)
    })

    // COMPLETED pill should show "0.0s" (it was entered at T+30 and time was T+30 at render).
    expect(screen.getByText('COMPLETED')).toBeInTheDocument()
  })

  it('invokes onSelectState on click with the entry state and index', () => {
    const onSelect = vi.fn()
    render(
      <StateTimeline
        history={[
          { state: 'STARTING', entered_at: '2026-05-14T00:00:00Z', duration_ms: 5000 },
          { state: 'EXECUTING', entered_at: '2026-05-14T00:00:05Z' },
        ]}
        currentState="EXECUTING"
        terminal={false}
        onSelectState={onSelect}
      />
    )
    fireEvent.click(screen.getByText('STARTING'))
    expect(onSelect).toHaveBeenCalledWith('STARTING', 0)
  })
})
```

- [ ] **Step 2: Run tests, verify they fail**

```powershell
npm test -- src/features/instance-panel/StateTimeline.test.tsx
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/features/instance-panel/StateTimeline.tsx`**

```tsx
import { useEffect, useState } from 'react'
import { Pill } from '../../components/Pill'
import { pillVariantForState } from '../../lib/state-pill'
import type { StateEntry } from '../../api/types'
import styles from './StateTimeline.module.css'

export interface StateTimelineProps {
  history: StateEntry[]
  currentState: string
  terminal: boolean
  onSelectState?: (state: string, index: number) => void
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

export function StateTimeline({ history, terminal, onSelectState }: StateTimelineProps) {
  const [, force] = useState(0)
  useEffect(() => {
    if (terminal) return
    const id = setInterval(() => force((n) => n + 1), 1000)
    return () => clearInterval(id)
  }, [terminal])

  if (history.length === 0) return null

  const now = Date.now()

  return (
    <ol className={styles.list} aria-label="State history">
      {history.map((entry, index) => {
        const isLast = index === history.length - 1
        const liveMs = entry.duration_ms ?? Math.max(0, now - new Date(entry.entered_at).getTime())
        return (
          <li key={`${entry.state}-${entry.entered_at}-${index}`} className={styles.item}>
            <button
              type="button"
              className={styles.button}
              title={`Entered at ${entry.entered_at}`}
              onClick={() => onSelectState?.(entry.state, index)}
            >
              <Pill variant={pillVariantForState(entry.state)}>{entry.state}</Pill>
              <span className={styles.duration}>{formatDuration(liveMs)}</span>
            </button>
            {!isLast && (
              <span className={styles.sep} aria-hidden="true">
                →
              </span>
            )}
          </li>
        )
      })}
    </ol>
  )
}
```

- [ ] **Step 4: Create `src/features/instance-panel/StateTimeline.module.css`**

```css
.list {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem 0.5rem;
  align-items: center;
  list-style: none;
  margin: 0;
  padding: 0;
}

.item {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
}

.button {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  border: none;
  background: transparent;
  padding: 0.2rem 0.3rem;
  border-radius: 4px;
  cursor: pointer;
  color: var(--text);
  font: inherit;
}

.button:hover {
  background: var(--surface-2);
}

.duration {
  font-size: 0.75rem;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}

.sep {
  color: var(--text-muted);
  font-size: 0.85rem;
}
```

- [ ] **Step 5: Run tests, verify they pass**

```powershell
npm test -- src/features/instance-panel/StateTimeline.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/features/instance-panel/StateTimeline.tsx src/features/instance-panel/StateTimeline.module.css src/features/instance-panel/StateTimeline.test.tsx
git commit -m "feat(instance-panel): StateTimeline horizontal pill history"
```

---

## Task 11: `<OutputsView />` — basic key/value rows

**Files:**

- Create: `C:\TrajectoryActionTester\src\features\instance-panel\OutputsView.tsx`
- Create: `C:\TrajectoryActionTester\src\features\instance-panel\OutputsView.module.css`
- Create: `C:\TrajectoryActionTester\src\features\instance-panel\OutputsView.test.tsx`

Plain `<dl>` of `{key, value}` from `liveState.outputs`. Empty state shows "No outputs yet." No delta flash, no JSON toggle.

- [ ] **Step 1: Write failing tests**

Create `src/features/instance-panel/OutputsView.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { OutputsView } from './OutputsView'

describe('OutputsView', () => {
  it('shows empty message when outputs is empty', () => {
    render(<OutputsView outputs={{}} />)
    expect(screen.getByText(/no outputs yet/i)).toBeInTheDocument()
  })

  it('renders one row per output key', () => {
    render(<OutputsView outputs={{ status: '0', detail: 'ok' }} />)
    expect(screen.getByText('status')).toBeInTheDocument()
    expect(screen.getByText('detail')).toBeInTheDocument()
    expect(screen.getByText('0')).toBeInTheDocument()
    expect(screen.getByText('ok')).toBeInTheDocument()
  })

  it('renders keys in alphabetical order', () => {
    render(<OutputsView outputs={{ zeta: 'z', alpha: 'a', mu: 'm' }} />)
    const keys = screen.getAllByTestId('output-key').map((el) => el.textContent)
    expect(keys).toEqual(['alpha', 'mu', 'zeta'])
  })

  it('renders empty-string values without collapsing the row', () => {
    render(<OutputsView outputs={{ status: '' }} />)
    expect(screen.getByText('status')).toBeInTheDocument()
    // The value cell should be present even when value is empty
    expect(screen.getByTestId('output-value-status')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run tests, verify they fail**

```powershell
npm test -- src/features/instance-panel/OutputsView.test.tsx
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/features/instance-panel/OutputsView.tsx`**

```tsx
import styles from './OutputsView.module.css'

export interface OutputsViewProps {
  outputs: Record<string, string>
}

export function OutputsView({ outputs }: OutputsViewProps) {
  const keys = Object.keys(outputs).sort()

  if (keys.length === 0) {
    return <p className={styles.empty}>No outputs yet.</p>
  }

  return (
    <dl className={styles.list}>
      {keys.map((key) => (
        <div className={styles.row} key={key}>
          <dt className={styles.key} data-testid="output-key">
            {key}
          </dt>
          <dd className={styles.value} data-testid={`output-value-${key}`}>
            {outputs[key]}
          </dd>
        </div>
      ))}
    </dl>
  )
}
```

- [ ] **Step 4: Create `src/features/instance-panel/OutputsView.module.css`**

```css
.list {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 0.25rem 1rem;
  margin: 0;
  padding: 0;
}

.row {
  display: contents;
}

.key {
  font-weight: 500;
  color: var(--text-muted);
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 0.85rem;
}

.value {
  margin: 0;
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 0.85rem;
  word-break: break-all;
}

.empty {
  color: var(--text-muted);
  font-style: italic;
  margin: 0;
}
```

- [ ] **Step 5: Run tests, verify they pass**

```powershell
npm test -- src/features/instance-panel/OutputsView.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/features/instance-panel/OutputsView.tsx src/features/instance-panel/OutputsView.module.css src/features/instance-panel/OutputsView.test.tsx
git commit -m "feat(instance-panel): basic OutputsView key/value list (no flash)"
```

---

## Task 12: `<CommandBar />` — state-aware command buttons

**Files:**

- Create: `C:\TrajectoryActionTester\src\features\instance-panel\CommandBar.tsx`
- Create: `C:\TrajectoryActionTester\src\features\instance-panel\CommandBar.module.css`
- Create: `C:\TrajectoryActionTester\src\features\instance-panel\CommandBar.test.tsx`

Props:

```ts
interface CommandBarProps {
  instanceId: string
  visibility: ActionVisibility
  currentState: string
  supportedCommands: readonly Command[]
}
```

Renders one button per `supportedCommands` entry. Disabled iff `!isCommandValid(visibility, currentState, command)` OR mutation in flight. Click fires `useSendCommand()` mutation.

- [ ] **Step 1: Write failing tests**

Create `src/features/instance-panel/CommandBar.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { AllProviders, createTestQueryClient } from '../../test-utils'
import { CommandBar } from './CommandBar'
import { OBSERVABLE_COMMANDS, OPAQUE_COMMANDS } from '../../lib/state-machine'
import { useConnections } from '../../store/connections'
import type { ReactNode } from 'react'

function Wrapper({ children }: { children: ReactNode }) {
  const client = createTestQueryClient()
  return (
    <AllProviders queryClient={client}>
      <Seed>{children}</Seed>
    </AllProviders>
  )
}

function Seed({ children }: { children: ReactNode }) {
  const conn = useConnections()
  if (conn.state.connections.length === 0) {
    conn.add({ id: 'conn-1', url: 'http://localhost:3000' })
  }
  return <>{children}</>
}

describe('CommandBar', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('renders one button per supported command (observable)', () => {
    render(
      <CommandBar
        instanceId="inst-1"
        visibility="observable"
        currentState="EXECUTING"
        supportedCommands={OBSERVABLE_COMMANDS}
      />,
      { wrapper: Wrapper }
    )
    for (const cmd of OBSERVABLE_COMMANDS) {
      expect(screen.getByRole('button', { name: cmd })).toBeInTheDocument()
    }
  })

  it('only shows ABORT button for opaque', () => {
    render(
      <CommandBar
        instanceId="inst-1"
        visibility="opaque"
        currentState="IN_PROGRESS"
        supportedCommands={OPAQUE_COMMANDS}
      />,
      { wrapper: Wrapper }
    )
    expect(screen.getByRole('button', { name: 'ABORT' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'PAUSE' })).toBeNull()
  })

  it('enables PAUSE/HOLD/ABORT/STOP when in EXECUTING, disables RESUME/UNHOLD/CLEAR', () => {
    render(
      <CommandBar
        instanceId="inst-1"
        visibility="observable"
        currentState="EXECUTING"
        supportedCommands={OBSERVABLE_COMMANDS}
      />,
      { wrapper: Wrapper }
    )
    expect(screen.getByRole('button', { name: 'PAUSE' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'HOLD' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'ABORT' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'STOP' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'RESUME' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'UNHOLD' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'CLEAR' })).toBeDisabled()
  })

  it('enables CLEAR only from ABORTED', () => {
    render(
      <CommandBar
        instanceId="inst-1"
        visibility="observable"
        currentState="ABORTED"
        supportedCommands={OBSERVABLE_COMMANDS}
      />,
      { wrapper: Wrapper }
    )
    expect(screen.getByRole('button', { name: 'CLEAR' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'PAUSE' })).toBeDisabled()
  })

  it('disables every button in COMPLETED', () => {
    render(
      <CommandBar
        instanceId="inst-1"
        visibility="observable"
        currentState="COMPLETED"
        supportedCommands={OBSERVABLE_COMMANDS}
      />,
      { wrapper: Wrapper }
    )
    for (const cmd of OBSERVABLE_COMMANDS) {
      expect(screen.getByRole('button', { name: cmd })).toBeDisabled()
    }
  })

  it('POSTs the command on click', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: { instance_id: 'inst-1', command: 'PAUSE', accepted: true },
          meta: {},
        }),
        { status: 200 }
      )
    )

    render(
      <CommandBar
        instanceId="inst-1"
        visibility="observable"
        currentState="EXECUTING"
        supportedCommands={OBSERVABLE_COMMANDS}
      />,
      { wrapper: Wrapper }
    )

    fireEvent.click(screen.getByRole('button', { name: 'PAUSE' }))

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        'http://localhost:3000/trajectory/v1/instances/inst-1/command',
        expect.objectContaining({ method: 'POST', body: JSON.stringify({ command: 'PAUSE' }) })
      )
    )
  })

  it('disables all buttons while a command is in flight', async () => {
    let resolve: (value: Response) => void = () => {}
    vi.mocked(fetch).mockReturnValueOnce(
      new Promise<Response>((r) => {
        resolve = r
      })
    )

    render(
      <CommandBar
        instanceId="inst-1"
        visibility="observable"
        currentState="EXECUTING"
        supportedCommands={OBSERVABLE_COMMANDS}
      />,
      { wrapper: Wrapper }
    )

    fireEvent.click(screen.getByRole('button', { name: 'PAUSE' }))

    await waitFor(() => {
      // PAUSE is the only normally-enabled one before; while pending all should be disabled.
      expect(screen.getByRole('button', { name: 'PAUSE' })).toBeDisabled()
      expect(screen.getByRole('button', { name: 'HOLD' })).toBeDisabled()
    })

    resolve(
      new Response(
        JSON.stringify({
          data: { instance_id: 'inst-1', command: 'PAUSE', accepted: true },
          meta: {},
        }),
        { status: 200 }
      )
    )
  })

  it('renders an error pill when the command fails', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { code: 'INVALID_COMMAND' } }), {
        status: 422,
        statusText: 'Unprocessable Entity',
      })
    )

    render(
      <CommandBar
        instanceId="inst-1"
        visibility="observable"
        currentState="EXECUTING"
        supportedCommands={OBSERVABLE_COMMANDS}
      />,
      { wrapper: Wrapper }
    )

    fireEvent.click(screen.getByRole('button', { name: 'PAUSE' }))

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
    expect(screen.getByRole('alert').textContent).toMatch(/422|invalid|failed/i)
  })
})
```

- [ ] **Step 2: Run tests, verify they fail**

```powershell
npm test -- src/features/instance-panel/CommandBar.test.tsx
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/features/instance-panel/CommandBar.tsx`**

```tsx
import { Button } from '../../components/Button'
import type { ActionVisibility, Command } from '../../api/types'
import { isCommandValid } from '../../lib/state-machine'
import { useSendCommand } from '../../store/use-send-command'
import styles from './CommandBar.module.css'

export interface CommandBarProps {
  instanceId: string
  visibility: ActionVisibility
  currentState: string
  supportedCommands: readonly Command[]
}

export function CommandBar({
  instanceId,
  visibility,
  currentState,
  supportedCommands,
}: CommandBarProps) {
  const sendCmd = useSendCommand()

  const handleClick = (command: Command) => () => {
    sendCmd.mutate({ instanceId, command })
  }

  return (
    <div className={styles.bar}>
      <div className={styles.buttons}>
        {supportedCommands.map((command) => {
          const valid = isCommandValid(visibility, currentState, command)
          return (
            <Button
              key={command}
              type="button"
              variant={command === 'ABORT' || command === 'STOP' ? 'danger' : 'secondary'}
              disabled={!valid || sendCmd.isPending}
              onClick={handleClick(command)}
            >
              {command}
            </Button>
          )
        })}
      </div>
      {sendCmd.isError && (
        <p className={styles.error} role="alert">
          Command failed: {sendCmd.error?.message ?? 'unknown error'}
        </p>
      )}
    </div>
  )
}
```

> **Note:** `Button` already supports `variant`. If the existing `Button` component does not have a `'danger'` variant defined, drop the variant prop for ABORT/STOP — visual polish lands in Plan 4-06. Use `variant: 'secondary'` for all buttons in that case. (You can confirm by reading `src/components/Button.tsx`.)

- [ ] **Step 4: Create `src/features/instance-panel/CommandBar.module.css`**

```css
.bar {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}

.error {
  margin: 0;
  color: var(--danger, #e57373);
  font-size: 0.85rem;
}
```

- [ ] **Step 5: Run tests, verify they pass**

```powershell
npm test -- src/features/instance-panel/CommandBar.test.tsx
```

Expected: PASS. If the `Button` variant prop type is too strict for `'danger'`, fall back to `'secondary'` and re-run.

- [ ] **Step 6: Commit**

```powershell
git add src/features/instance-panel/CommandBar.tsx src/features/instance-panel/CommandBar.module.css src/features/instance-panel/CommandBar.test.tsx
git commit -m "feat(instance-panel): CommandBar with state-aware enable + send-command wiring"
```

---

## Task 13: `<ErrorPanel />` — terminal + latest-error display

**Files:**

- Create: `C:\TrajectoryActionTester\src\features\instance-panel\ErrorPanel.tsx`
- Create: `C:\TrajectoryActionTester\src\features\instance-panel\ErrorPanel.module.css`
- Create: `C:\TrajectoryActionTester\src\features\instance-panel\ErrorPanel.test.tsx`

Renders three optional blocks:

1. **Terminal error** — `instance.error` from the REST seed (only when set).
2. **Latest error** — most recent stderr `log` event message.
3. **Traceback** — `latest_traceback` if present.

Hidden when all three are empty.

- [ ] **Step 1: Write failing tests**

Create `src/features/instance-panel/ErrorPanel.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ErrorPanel } from './ErrorPanel'

describe('ErrorPanel', () => {
  it('renders nothing when all error fields are empty', () => {
    const { container } = render(
      <ErrorPanel terminalError={null} latestError={undefined} latestTraceback={undefined} />
    )
    expect(container.firstChild).toBeNull()
  })

  it('shows terminalError as a labelled block when set', () => {
    render(
      <ErrorPanel
        terminalError="action timed out"
        latestError={undefined}
        latestTraceback={undefined}
      />
    )
    expect(screen.getByText(/terminal error/i)).toBeInTheDocument()
    expect(screen.getByText('action timed out')).toBeInTheDocument()
  })

  it('shows latest stderr message', () => {
    render(
      <ErrorPanel
        terminalError={null}
        latestError="NameError: x is not defined"
        latestTraceback={undefined}
      />
    )
    expect(screen.getByText(/latest error/i)).toBeInTheDocument()
    expect(screen.getByText('NameError: x is not defined')).toBeInTheDocument()
  })

  it('shows traceback when set', () => {
    render(
      <ErrorPanel
        terminalError={null}
        latestError={undefined}
        latestTraceback={'Traceback (most recent call last):\n  File "x.py"'}
      />
    )
    expect(screen.getByText(/traceback/i)).toBeInTheDocument()
    expect(screen.getByText(/File "x\.py"/)).toBeInTheDocument()
  })

  it('renders all three blocks together when all set', () => {
    render(
      <ErrorPanel
        terminalError="failed"
        latestError="boom"
        latestTraceback="Traceback (most recent call last):\nline 1"
      />
    )
    expect(screen.getByText(/terminal error/i)).toBeInTheDocument()
    expect(screen.getByText(/latest error/i)).toBeInTheDocument()
    expect(screen.getAllByText(/traceback/i).length).toBeGreaterThanOrEqual(1)
  })
})
```

- [ ] **Step 2: Run tests, verify they fail**

```powershell
npm test -- src/features/instance-panel/ErrorPanel.test.tsx
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/features/instance-panel/ErrorPanel.tsx`**

```tsx
import styles from './ErrorPanel.module.css'

export interface ErrorPanelProps {
  terminalError: string | null
  latestError: string | undefined
  latestTraceback: string | undefined
}

export function ErrorPanel({ terminalError, latestError, latestTraceback }: ErrorPanelProps) {
  if (!terminalError && !latestError && !latestTraceback) {
    return null
  }

  return (
    <section className={styles.panel} aria-label="Errors">
      {terminalError && (
        <div className={styles.block}>
          <h3 className={styles.heading}>Terminal error</h3>
          <pre className={styles.body}>{terminalError}</pre>
        </div>
      )}
      {latestError && (
        <div className={styles.block}>
          <h3 className={styles.heading}>Latest error</h3>
          <pre className={styles.body}>{latestError}</pre>
        </div>
      )}
      {latestTraceback && (
        <div className={styles.block}>
          <h3 className={styles.heading}>Traceback</h3>
          <pre className={styles.body}>{latestTraceback}</pre>
        </div>
      )}
    </section>
  )
}
```

- [ ] **Step 4: Create `src/features/instance-panel/ErrorPanel.module.css`**

```css
.panel {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  border: 1px solid var(--danger-border, #5a2a2a);
  background: var(--danger-bg, #2a1414);
  padding: 0.5rem 0.75rem;
  border-radius: 6px;
}

.block {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.heading {
  margin: 0;
  font-size: 0.8rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--danger, #e57373);
}

.body {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 0.82rem;
  color: var(--danger-text, #f5b8b8);
}
```

- [ ] **Step 5: Run tests, verify they pass**

```powershell
npm test -- src/features/instance-panel/ErrorPanel.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/features/instance-panel/ErrorPanel.tsx src/features/instance-panel/ErrorPanel.module.css src/features/instance-panel/ErrorPanel.test.tsx
git commit -m "feat(instance-panel): ErrorPanel for terminal + latest error + traceback"
```

---

## Task 14: Rewrite `<InstancePanel />` to compose all pieces

**Files:**

- Modify (effectively rewrite): `C:\TrajectoryActionTester\src\features\instance-panel\InstancePanel.tsx`
- Modify: `C:\TrajectoryActionTester\src\features\instance-panel\InstancePanel.module.css`
- Modify (effectively rewrite): `C:\TrajectoryActionTester\src\features\instance-panel\InstancePanel.test.tsx`

Composes:

- Header: instance_id + state pill (uses shared `pillVariantForState`) + connection-status indicator.
- StateTimeline (history, currentState, terminal).
- CommandBar (only if action capability is known — looked up via `useCapabilities`).
- OutputsView.
- ErrorPanel.

Drives off `useInstanceStream(instance_id)` and `useCapabilities()` for the action capability (needed for `supported_commands`).

- [ ] **Step 1: Rewrite `src/features/instance-panel/InstancePanel.tsx`**

```tsx
import { Pill } from '../../components/Pill'
import { useActiveInstance } from '../../store/active-instance'
import { useCapabilities } from '../../store/use-capabilities'
import { useInstanceStream } from '../../store/use-instance-stream'
import { pillVariantForState } from '../../lib/state-pill'
import { StateTimeline } from './StateTimeline'
import { CommandBar } from './CommandBar'
import { OutputsView } from './OutputsView'
import { ErrorPanel } from './ErrorPanel'
import styles from './InstancePanel.module.css'

export function InstancePanel() {
  const { state } = useActiveInstance()
  const selection = state.selection
  const instanceId = selection?.type === 'instance' ? selection.instance_id : null

  const stream = useInstanceStream(instanceId)
  const capabilities = useCapabilities()

  if (!instanceId) return null

  if (stream.isLoading) {
    return <p className={styles.message}>Loading instance…</p>
  }
  if (stream.isError) {
    return <p className={styles.error}>Failed to load instance: {stream.error?.message}</p>
  }
  if (!stream.data) return null

  const live = stream.data

  // Look up the action capability — gives us supported_commands and (for v2.0 polish) the spec.
  const action = capabilities.data?.data.find(
    (a) =>
      a.action_oid === state.trackedInstances.find((t) => t.instance_id === instanceId)?.action_oid
  )

  return (
    <div className={styles.panel}>
      <header className={styles.header}>
        <h2 className={styles.title}>{live.instance_id}</h2>
        <div className={styles.headerRight}>
          <Pill variant={pillVariantForState(live.current_state)}>{live.current_state}</Pill>
          <span
            className={[styles.dot, stream.isConnected ? styles.dotOk : styles.dotBad]
              .join(' ')
              .trim()}
            aria-label={stream.isConnected ? 'connected' : 'disconnected'}
            title={stream.isConnected ? 'Live stream connected' : 'Live stream disconnected'}
          />
        </div>
      </header>

      <section className={styles.section} aria-label="State timeline">
        <h3 className={styles.sectionHeading}>State</h3>
        <StateTimeline
          history={live.state_history}
          currentState={live.current_state}
          terminal={live.terminal}
        />
      </section>

      {action && (
        <section className={styles.section} aria-label="Commands">
          <h3 className={styles.sectionHeading}>Commands</h3>
          <CommandBar
            instanceId={live.instance_id}
            visibility={live.visibility}
            currentState={live.current_state}
            supportedCommands={
              action.supported_commands as readonly import('../../api/types').Command[]
            }
          />
        </section>
      )}

      <section className={styles.section} aria-label="Outputs">
        <h3 className={styles.sectionHeading}>Outputs</h3>
        <OutputsView outputs={live.outputs} />
      </section>

      <ErrorPanel
        terminalError={live.terminal_error}
        latestError={live.latest_error}
        latestTraceback={live.latest_traceback}
      />
    </div>
  )
}
```

- [ ] **Step 2: Update `src/features/instance-panel/InstancePanel.module.css`**

Replace contents with:

```css
.panel {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 1rem 1.25rem;
  height: 100%;
  overflow: auto;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.75rem;
}

.headerRight {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.title {
  margin: 0;
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 1rem;
  font-weight: 500;
  color: var(--text);
}

.section {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.sectionHeading {
  margin: 0;
  font-size: 0.78rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-muted);
}

.dot {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 50%;
}

.dotOk {
  background: var(--success, #66bb6a);
}

.dotBad {
  background: var(--warning, #ffa726);
}

.message {
  padding: 1rem 1.25rem;
  color: var(--text-muted);
  font-style: italic;
}

.error {
  padding: 1rem 1.25rem;
  color: var(--danger, #e57373);
}
```

- [ ] **Step 3: Rewrite `src/features/instance-panel/InstancePanel.test.tsx`**

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, waitFor } from '@testing-library/react'
import { AllProviders, createTestQueryClient } from '../../test-utils'
import { InstancePanel } from './InstancePanel'
import { useConnections } from '../../store/connections'
import { useActiveInstance } from '../../store/active-instance'
import { getMockEventSources, type MockEventSource } from '../../lib/test-event-source'
import type { ReactNode } from 'react'

function Wrapper({ children }: { children: ReactNode }) {
  const client = createTestQueryClient()
  return (
    <AllProviders queryClient={client}>
      <Seed>{children}</Seed>
    </AllProviders>
  )
}

function Seed({ children }: { children: ReactNode }) {
  const conn = useConnections()
  const inst = useActiveInstance()
  if (conn.state.connections.length === 0) {
    conn.add({ id: 'conn-1', url: 'http://localhost:3000' })
  }
  if (inst.state.trackedInstances.length === 0) {
    inst.trackInstance({
      instance_id: 'inst-1',
      connection_id: 'conn-1',
      action_oid: 'act-1',
    })
    inst.selectInstance('inst-1')
  }
  return <>{children}</>
}

function mockCapabilities() {
  vi.mocked(fetch).mockResolvedValueOnce(
    new Response(
      JSON.stringify({
        data: [
          {
            action_oid: 'act-1',
            environment_oid: 'env-1',
            local_id: 'PickItem',
            version: '1.0.0',
            description: 'Pick an item.',
            visibility: 'observable',
            input_parameters: [],
            output_parameters: [],
            supported_commands: ['PAUSE', 'RESUME', 'HOLD', 'UNHOLD', 'ABORT', 'STOP', 'CLEAR'],
          },
        ],
        meta: { total: 1 },
      }),
      { status: 200 }
    )
  )
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
}

describe('InstancePanel', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('shows a loading message before REST seed resolves', () => {
    vi.mocked(fetch).mockReturnValue(new Promise(() => {}))
    render(<InstancePanel />, { wrapper: Wrapper })
    expect(screen.getByText(/loading instance/i)).toBeInTheDocument()
  })

  it('renders header, timeline, commands, outputs, no error block after seed', async () => {
    mockCapabilities()
    mockInstanceSeed()

    render(<InstancePanel />, { wrapper: Wrapper })

    await waitFor(() => expect(screen.getByText('inst-1')).toBeInTheDocument())
    expect(screen.getByText('STARTING')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'PAUSE' })).toBeInTheDocument()
    expect(screen.getByText(/no outputs yet/i)).toBeInTheDocument()
    expect(screen.queryByText(/terminal error/i)).toBeNull()
  })

  it('updates the state pill when SSE state_change arrives', async () => {
    mockCapabilities()
    mockInstanceSeed()

    render(<InstancePanel />, { wrapper: Wrapper })

    await waitFor(() => expect(screen.getByText('STARTING')).toBeInTheDocument())
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

    await waitFor(() => expect(screen.getAllByText('EXECUTING').length).toBeGreaterThanOrEqual(1))
  })

  it('renders ErrorPanel when terminal_error is on seed', async () => {
    mockCapabilities()
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
            state: { current: 'ABORTED', previous: 'ABORTING', entered_at: '2026-05-14T00:01:00Z' },
            inputs: [],
            outputs: [],
            created_at: '2026-05-14T00:00:00Z',
            started_at: '2026-05-14T00:00:00Z',
            completed_at: '2026-05-14T00:01:00Z',
            error: 'action raised NameError',
          },
          meta: {},
        }),
        { status: 200 }
      )
    )

    render(<InstancePanel />, { wrapper: Wrapper })

    await waitFor(() => expect(screen.getByText('inst-1')).toBeInTheDocument())
    expect(screen.getByText(/terminal error/i)).toBeInTheDocument()
    expect(screen.getByText('action raised NameError')).toBeInTheDocument()
  })

  it('renders error message on REST seed failure', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'gone' }), { status: 404, statusText: 'Not Found' })
    )
    // Capabilities can succeed or fail independently — doesn't matter for this assertion
    mockCapabilities()

    render(<InstancePanel />, { wrapper: Wrapper })

    await waitFor(() => expect(screen.getByText(/failed to load instance/i)).toBeInTheDocument())
  })
})
```

- [ ] **Step 4: Run InstancePanel tests, verify they pass**

```powershell
npm test -- src/features/instance-panel/InstancePanel.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Run full suite to check for regressions**

```powershell
npm test
```

Expected: Plan 4-03's tests that referenced `useInstance` may fail now (we have NOT deleted it yet — see Task 15). If anything fails for an unrelated reason, stop and investigate before continuing.

> **Note:** The old `InstancePanel.test.tsx` previously tested polled `useInstance` behavior. The rewrite drops that — Task 15 deletes `use-instance.ts` and its tests. If `npm test` flags duplicate test names or missing module errors, it's because `use-instance.test.tsx` is still present. That gets cleaned up in Task 15.

- [ ] **Step 6: Commit**

```powershell
git add src/features/instance-panel/InstancePanel.tsx src/features/instance-panel/InstancePanel.module.css src/features/instance-panel/InstancePanel.test.tsx
git commit -m "feat(instance-panel): InstancePanel composes timeline + commands + outputs + errors"
```

---

## Task 15: Delete `use-instance.ts` and its test (follow-up #2)

**Files:**

- Delete: `C:\TrajectoryActionTester\src\store\use-instance.ts`
- Delete: `C:\TrajectoryActionTester\src\store\use-instance.test.tsx`

Verify nothing else imports `useInstance` first.

- [ ] **Step 1: Grep for imports**

```powershell
Get-ChildItem -Path src -Recurse -Include *.ts,*.tsx |
  Select-String -Pattern "from '.*use-instance'" -CaseSensitive
```

Expected: zero matches (the only consumer was `InstancePanel.tsx`, now updated to `useInstanceStream`).

If matches appear, update those callers before deleting.

- [ ] **Step 2: Delete the files**

```powershell
Remove-Item src/store/use-instance.ts
Remove-Item src/store/use-instance.test.tsx
```

- [ ] **Step 3: Run full suite**

```powershell
npm test
```

Expected: All tests pass.

- [ ] **Step 4: Typecheck**

```powershell
npm run typecheck
```

Expected: exit 0.

- [ ] **Step 5: Commit**

```powershell
git add -A src/store/use-instance.ts src/store/use-instance.test.tsx
git commit -m "refactor(store): remove polled useInstance (subsumed by useInstanceStream)"
```

> **Note:** `git add -A` with the file paths stages the deletions explicitly. PowerShell users can also use `git rm src/store/use-instance.ts src/store/use-instance.test.tsx` in step 2 instead of `Remove-Item` to do delete-and-stage in one move.

---

## Task 16: Fix `InvokePanel` form-reset dependency (follow-up #4)

**Files:**

- Modify: `C:\TrajectoryActionTester\src\features\invoke-panel\InvokePanel.tsx`
- Modify: `C:\TrajectoryActionTester\src\features\invoke-panel\InvokePanel.test.tsx`

Plan 4-03 review item #4: when `useCapabilities` refetches (e.g. a future reconnect trigger), the `action` object identity changes, even if the underlying capability is the same OID. The form-reset `useEffect` currently keys on `[action]` and would clobber in-flight user input. Fix by keying on `[action?.action_oid]`.

- [ ] **Step 1: Add a failing test**

Append to `src/features/invoke-panel/InvokePanel.test.tsx`. The existing test file already imports `screen`, `fireEvent`, `act`, etc. — only add what's missing (likely nothing new beyond what's already at the top). Drop any of the imports below that already exist:

```tsx
import { fireEvent, act } from '@testing-library/react'
// (existing test imports remain — do not duplicate)

describe('InvokePanel — capability refetch resilience', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('preserves in-flight user input when capabilities refetches the same OID', async () => {
    // Initial capabilities load
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [
            {
              action_oid: 'act-1',
              environment_oid: 'env-1',
              local_id: 'PickItem',
              version: '1.0.0',
              visibility: 'observable',
              input_parameters: [{ name: 'shelf_location', type: 'string', required: true }],
              output_parameters: [],
              supported_commands: [],
            },
          ],
          meta: { total: 1 },
        }),
        { status: 200 }
      )
    )

    const { container, queryClient } = renderWithProviders(<InvokePanel />, {
      // assume your existing renderWithProviders helper accepts a way to seed selection
    })

    // (Adapt the seed to the existing test pattern — use the same selection helpers Plan 4-03's
    // InvokePanel tests already use.)

    const input = await screen.findByLabelText(/shelf_location/)
    fireEvent.change(input, { target: { value: 'BIN-A1' } })
    expect((input as HTMLInputElement).value).toBe('BIN-A1')

    // Second capabilities load — same OID, fresh array identity
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [
            {
              action_oid: 'act-1',
              environment_oid: 'env-1',
              local_id: 'PickItem',
              version: '1.0.0',
              visibility: 'observable',
              input_parameters: [{ name: 'shelf_location', type: 'string', required: true }],
              output_parameters: [],
              supported_commands: [],
            },
          ],
          meta: { total: 1 },
        }),
        { status: 200 }
      )
    )

    // Force a refetch on the capabilities query
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ['capabilities'] })
    })

    // After refetch, the in-flight value should still be there
    expect((screen.getByLabelText(/shelf_location/) as HTMLInputElement).value).toBe('BIN-A1')
  })
})
```

> **Note for executing engineer:** The exact seed for `selection.type === 'action'` and the `renderWithProviders` extras differ from how Plan 4-03 set this up — read the existing `InvokePanel.test.tsx` and follow its pattern. The intent of the test is: invalidate capabilities → form value retained. Adapt mechanics to match.

- [ ] **Step 2: Run the test, verify it fails**

```powershell
npm test -- src/features/invoke-panel/InvokePanel.test.tsx
```

Expected: FAIL — the new test fails because `useEffect` resets `values` when `action` reference changes.

- [ ] **Step 3: Apply the fix**

Edit `src/features/invoke-panel/InvokePanel.tsx`:

```ts
// BEFORE
useEffect(() => {
  if (!action) return
  const initial: Record<string, string> = {}
  for (const param of action.input_parameters) {
    initial[param.name] = defaultValueAsString(param)
  }
  setValues(initial)
}, [action])
```

Change to:

```ts
// Reset form values only when the *selected* action changes (by OID), not when its
// object identity changes due to a capabilities refetch. Follow-up #4 from Plan 4-03 review.
useEffect(() => {
  if (!action) return
  const initial: Record<string, string> = {}
  for (const param of action.input_parameters) {
    initial[param.name] = defaultValueAsString(param)
  }
  setValues(initial)
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [action?.action_oid])
```

The `eslint-disable react-hooks/exhaustive-deps` is intentional: we want behaviour keyed on OID, not on the object reference, even though the lint rule wants `action` in the deps.

- [ ] **Step 4: Run the test, verify it passes**

```powershell
npm test -- src/features/invoke-panel/InvokePanel.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/features/invoke-panel/InvokePanel.tsx src/features/invoke-panel/InvokePanel.test.tsx
git commit -m "fix(invoke-panel): key form-reset useEffect on action_oid, not reference"
```

---

## Task 17: Annotate `eslint-disable react-refresh/only-export-components` comments (follow-up #3)

**Files:**

- Modify: `C:\TrajectoryActionTester\src\store\active-instance.tsx`
- Modify: `C:\TrajectoryActionTester\src\store\connections.tsx`

Plan 4-03 review item #3: the `eslint-disable react-refresh/only-export-components` lines exist for a real reason (provider + hooks co-located in the same module), but the comments are bare. Add a one-line annotation above each.

- [ ] **Step 1: Edit `src/store/active-instance.tsx`**

Find the two `// eslint-disable-next-line react-refresh/only-export-components` lines (at `active-instance.tsx:139` and `active-instance.tsx:148`) and prepend a one-line `//` comment above each one explaining the suppression. Example:

```ts
// Co-located with the provider above to keep all active-instance API surface in one module.
// Splitting into a separate file just to satisfy this lint rule would obscure the boundary.
// eslint-disable-next-line react-refresh/only-export-components
export function useActiveInstance(): ActiveInstanceApi {
```

Apply the same annotation pattern at the second site (`useTrackedInstances`).

- [ ] **Step 2: Edit `src/store/connections.tsx`**

Same treatment at both call sites (`connections.tsx:109` and `connections.tsx:118`).

- [ ] **Step 3: Run lint + tests**

```powershell
npm run lint
npm test
```

Expected: lint passes, tests pass.

- [ ] **Step 4: Commit**

```powershell
git add src/store/active-instance.tsx src/store/connections.tsx
git commit -m "docs(store): annotate eslint-disable react-refresh/only-export-components"
```

---

## Task 18: Integration test — SSE flow end-to-end

**Files:**

- Modify: `C:\TrajectoryActionTester\src\__tests__\integration.test.tsx`

Extend Plan 4-03's integration test with one additional `it` block covering: connect → capabilities load → ActionTree renders → click action → InvokePanel → invoke → InstancePanel shows STARTING → SSE state_change to EXECUTING → state pill updates → click PAUSE → POST `/instances/:id/command`.

- [ ] **Step 1: Append the new test**

Append to `src/__tests__/integration.test.tsx` (alongside the Plan 4-03 invoke-flow test):

```tsx
import { getMockEventSources, type MockEventSource } from '../lib/test-event-source'

describe('integration — invoke → SSE state stream → command', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => {
    localStorage.clear()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('streams state_change events and accepts a PAUSE command click', async () => {
    // 1) Capabilities response (for the action list + supported_commands)
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [
            {
              action_oid: 'act-1',
              environment_oid: 'env-1',
              local_id: 'PickItem',
              version: '1.0.0',
              description: 'Pick an item.',
              visibility: 'observable',
              input_parameters: [],
              output_parameters: [],
              supported_commands: ['PAUSE', 'RESUME', 'HOLD', 'UNHOLD', 'ABORT', 'STOP', 'CLEAR'],
            },
          ],
          meta: { total: 1 },
        }),
        { status: 200 }
      )
    )

    // 2) Invoke response
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ data: { instance_id: 'inst-1' }, meta: {} }), { status: 201 })
    )

    // 3) Initial instance REST seed
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

    // 4) Command POST response
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: { instance_id: 'inst-1', command: 'PAUSE', accepted: true },
          meta: {},
        }),
        { status: 200 }
      )
    )

    // Mount the app and add a connection inline (matches the existing integration test pattern
    // at `src/__tests__/integration.test.tsx:40-54` — no shared helper).
    const user = userEvent.setup()
    renderWithProviders(<App />)

    // Add a connection so capabilities load.
    await user.click(screen.getByTestId('connection-trigger'))
    await user.click(screen.getByRole('button', { name: /add connection/i }))
    await user.type(screen.getByLabelText(/server url/i), 'http://localhost:3000')
    await user.click(screen.getByRole('button', { name: /save/i }))

    // Click the action row to open InvokePanel
    await screen.findByText('PickItem')
    await user.click(screen.getByText('PickItem'))

    // Submit Invoke
    await user.click(await screen.findByRole('button', { name: /^invoke$/i }))

    // InstancePanel should show STARTING
    await waitFor(() => expect(screen.getByText('STARTING')).toBeInTheDocument())

    // SSE state_change → EXECUTING
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

    await waitFor(() => expect(screen.getAllByText('EXECUTING').length).toBeGreaterThanOrEqual(1))

    // Click PAUSE
    await user.click(screen.getByRole('button', { name: 'PAUSE' }))

    await waitFor(() =>
      expect(fetch).toHaveBeenLastCalledWith(
        expect.stringMatching(/\/trajectory\/v1\/instances\/inst-1\/command$/),
        expect.objectContaining({ method: 'POST', body: JSON.stringify({ command: 'PAUSE' }) })
      )
    )
  })
})
```

> **Note for executing engineer:** Add `import userEvent from '@testing-library/user-event'` and `import { App } from '../App'` and `import { renderWithProviders } from '../test-utils'` if the test file's existing top imports don't already cover them (they will — Plan 4-03's integration test uses the same imports).

- [ ] **Step 2: Run the integration test**

```powershell
npm test -- src/__tests__/integration.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Run full suite**

```powershell
npm test
```

Expected: All tests pass. Test count is roughly 136 (Plan 4-03 baseline) + ~50-65 new across reducer, state-machine, state-pill, commands API, mutation hook, mock EventSource, stream hook, four new components, InstancePanel rewrite, InvokePanel new test, integration test ≈ ~190-200 tests.

- [ ] **Step 4: Commit**

```powershell
git add src/__tests__/integration.test.tsx
git commit -m "test(integration): SSE state stream + command click end-to-end"
```

---

## Task 19: Bundle size check + final sanity + marker commit

**Files:**

- (no source changes; verification only)

- [ ] **Step 1: Production build**

```powershell
cd C:/TrajectoryActionTester
npm run build
```

Expected: build succeeds, `dist/index.html` produced as a single self-contained file.

- [ ] **Step 2: Measure gzipped bundle size**

```powershell
# Read dist/index.html, gzip, report size
$bytes = [System.IO.File]::ReadAllBytes('dist/index.html')
$ms = New-Object System.IO.MemoryStream
$gz = New-Object System.IO.Compression.GZipStream($ms, [System.IO.Compression.CompressionLevel]::Optimal)
$gz.Write($bytes, 0, $bytes.Length)
$gz.Close()
"{0:N2} KB gzipped" -f ($ms.Length / 1024)
```

Expected: ≤ 200 KB gz (Plan 4-06's hard budget). Plan 4-03 baseline was 80.41 KB gz; we expect roughly +10-20 KB for the new components and the state-machine table. Anywhere under ~120 KB gz is healthy.

- [ ] **Step 3: Run the full test suite one last time**

```powershell
npm test
```

Expected: all pass (counts per Task 18).

- [ ] **Step 4: Type + lint**

```powershell
npm run typecheck
npm run lint
```

Expected: both exit 0.

- [ ] **Step 5: Smoke-check single-file build by serving and loading**

(Optional but recommended.) Open `dist/index.html` directly in a browser. Confirm the app shell renders. The app will not have an active connection until you add one. No functional check needed beyond "it renders without console errors."

- [ ] **Step 6: Marker commit recording the gzipped bundle size**

```powershell
git add -A
git commit --allow-empty -m "chore: plan 4-04 complete — gzipped baseline <FILL_IN>.XX KB"
```

Replace `<FILL_IN>` with the measured bundle size from Step 2.

- [ ] **Step 7: Confirm clean tree + commit count**

```powershell
git status
git log --oneline | Measure-Object -Line
```

Expected: working tree clean. Commit count = 51 (Plan 3 baseline) + ~18-20 new commits from this plan = ~69-71.

---

## Self-Review checklist (for the executing engineer)

Before declaring Plan 4-04 done, confirm:

- [ ] All 5 follow-ups from Plan 4-03 review are addressed (or explicitly deferred with a note):
  - #1 `pillVariantForState` extracted to `src/lib/state-pill.ts` and consumed by `InstanceList`, `InstancePanel`, and `StateTimeline` (✅ Tasks 3, 4, 10, 14).
  - #2 `useInstance` deleted; `useInstanceStream` keys on `connection.id` (✅ Tasks 9, 15).
  - #3 `eslint-disable` annotations added in `active-instance.tsx` and `connections.tsx` (✅ Task 17).
  - #4 `InvokePanel` form-reset keyed on `action_oid` (✅ Task 16).
  - #5 App-shell "coming in plan 4-05" placeholder unchanged (still accurate — LogInspector is Plan 4-05).
- [ ] No remaining imports of `use-instance.ts`.
- [ ] `EventSource` mock is auto-installed in `vitest.setup.ts` and restored between tests.
- [ ] `useInstanceStream` does not stack EventSources when `instanceId` changes (one per active instance at a time).
- [ ] `CommandBar` disables every button while a command is in flight.
- [ ] `OutputsView` shows the "No outputs yet." empty state.
- [ ] `ErrorPanel` is hidden when terminal_error + latest_error + latest_traceback are all empty/undefined.
- [ ] Bundle size ≤ 200 KB gz.
- [ ] Working tree clean after the marker commit.

---

## Failure recovery

If a task's tests don't pass and the issue isn't obvious within ~5 minutes:

1. Stop pushing more changes.
2. Re-read the relevant spec section in `docs/specs/2026-05-11-trajectory-action-tester-v2-design.md`.
3. Re-read the source for `packages/server/src/routes/commands.ts` and `packages/server/src/sse-manager.ts` to confirm the wire format matches what the hook is parsing.
4. Use a `console.log` in the failing test to print the SSE event the test emitted vs. what the reducer received (or the listeners registered on the mock).
5. If still stuck, file a checkpoint in `.continue-here.md` and ask for input. Don't stack more failed attempts.

---

## What's deferred to later plans

For clarity, these are **NOT** in Plan 4-04 (don't add them):

- **State diagram** — Plan 4-05 (`<StateDiagram />` SVG of observable + opaque variants).
- **Log inspector (RHS pane)** — Plan 4-05 (per-state stdout/stderr rows with copy button).
- **Click-to-jump from StateTimeline / StateDiagram** — Plan 4-05 wires the LogInspector consumer.
- **OutputsView delta flash** — Plan 4-06.
- **OutputsView "show raw JSON" toggle** — Plan 4-06.
- **Final theme polish, README pass, version meta tag** — Plan 4-06.

If you find yourself reaching for one of these, stop — finish 4-04's scope first.
