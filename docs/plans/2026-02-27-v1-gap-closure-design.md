# V1 Gap Closure Design

**Date:** 2026-02-27
**Status:** Approved
**Scope:** Fix 6 gaps identified in v1 milestone audit

## Gaps Addressed

1. Wrong observable state names in code editor and action detail
2. Wrong opaque state names in code editor
3. Instance detail state timeline renders blank
4. Timeout cannot be disabled, no per-action override, UI shows ms
5. Test panel lacks human-readable parameter names
6. Code template lacks parameter/property definitions in comments

## 1. Visual State Machine Selector

Replace the state dropdown in the Code Editor page with a visual ISA-88 state machine diagram where each state is a clickable button.

### Layout

- Left panel widens from 264px to **450px** (`w-[450px]`)
- Two dropdowns remain: Environment and Action
- State dropdown removed entirely — replaced by the diagram
- Below the diagram: Save/Test buttons, then Version History
- Effective timeout displayed as a read-only badge below the action selector

### State Button Component

`<StateButton>` renders each state as a clickable rounded rectangle (~85px x ~36px):

- **Has code**: Light blue fill (`bg-sky-200 border-sky-400`) — matches the blue in the specification PNGs
- **No code**: Gray outline (`bg-gray-100 border-gray-300`)
- **Selected**: Ring highlight (`ring-2 ring-primary`) added to current fill
- **Terminal states** (COMPLETED, ABORTED): `opacity-60`, still clickable
- Label: state name in `text-[10px] font-medium`
- `onClick` calls `handleStateChange(stateName)`

### Observable Diagram

CSS absolute positioning inside a relative container (~420px x ~280px). States positioned to match the ObservableStates.png topology:

```
Row 0 (hold loop):   [UNHOLDING] <-- [HELD] <-- [HOLDING] ------------> [STOPPING]
                                                                             |
Row 1 (main flow):   [STARTING] --> [EXECUTING] --> [COMPLETING] --> [COMPLETED]
                                       |    ^
Row 2 (pause loop):  [UNPAUSING] <-- [PAUSED] <-- [PAUSING]
                                       |
Row 3 (abort/clear): [ABORTING]                                      [CLEARING]
```

Arrows: thin SVG lines with arrowheads between positioned state buttons.

Correct state names from engine `states.ts`:
`STARTING | EXECUTING | COMPLETING | COMPLETED | PAUSING | PAUSED | UNPAUSING | HOLDING | HELD | UNHOLDING | ABORTING | ABORTED | CLEARING | STOPPING`

### Opaque Diagram

Simpler layout (~420px x ~120px):

```
Row 0:  [POSTED] --> [RECEIVED] --> [IN PROGRESS]
            |                             |
Row 1:  [ABORTING]    [STOPPING] --> [COMPLETED]
```

Correct opaque state names from engine `states.ts`:
`POSTED | RECEIVED | IN_PROGRESS | COMPLETED | ABORTING | STOPPING`

### Code Status Data

`useAction(oid)` already returns `code_summary` with `has_active_version` per state. Used to determine `hasCode` prop on each `StateButton`:

```typescript
const statesWithCode = new Set(
  actionData?.code_summary?.filter((s) => s.has_active_version).map((s) => s.state) ?? []
)
```

No new API calls needed.

## 2. Timeout Control

### 2a. Database Schema Change

New migration (`002-action-timeout.ts`):

```sql
ALTER TABLE actions ADD COLUMN timeout_seconds INTEGER DEFAULT NULL;
```

Column semantics:

- `NULL` = use global default (from `execution_timeout_ms` setting)
- `0` = timeout disabled for this action
- `> 0` = custom timeout in seconds

### 2b. Global Setting Allows Disable

- `SettingsRepository` validation: `execution_timeout_ms` accepts `0` (disabled) or `>= 1000`
- Settings page displays value in **seconds** (divide by 1000 on load, multiply on save)
- Helper text: "0 = no timeout"

### 2c. Per-Action Timeout in Console

Action Detail page gains an "Execution Settings" section:

```
┌── Execution Settings ─────────────────────────┐
│                                                │
│  Timeout:  ( ) Use global default (60s)        │
│            ( ) Custom: [___] seconds           │
│            ( ) Disabled (no timeout)           │
│                                                │
│            [Save]                              │
└────────────────────────────────────────────────┘
```

Radio group:

- **Use global default**: `timeout_seconds = NULL`, shows current global value
- **Custom**: `timeout_seconds = N` (minimum 1)
- **Disabled**: `timeout_seconds = 0`

New management API endpoint: `PUT /management/v1/actions/:oid/timeout`

Request body: `{ timeout_seconds: number | null }`

### 2d. Engine Resolution Order

At invocation time:

1. Read `action.timeout_seconds`
2. If `NULL` → use global `execution_timeout_ms` setting
3. If `0` → no timeout (skip timer in pool)
4. If `> 0` → use `timeout_seconds * 1000` as timeout_ms

### 2e. Code Editor Visibility

Below the action selector, a read-only badge shows effective timeout:

```
Timeout: 60s (global default)
Timeout: disabled
Timeout: 120s (custom)
```

## 3. Test Panel Parameter Names

### 3a. Input Parameter Labels

Each input field shows:

- Primary label: parameter name (the `id` field — these are human-readable names in Trajectory data model)
- Secondary: `(value_type)` in parentheses
- Helper text: `description` if present, muted below the input

### 3b. Output Parameter Display

After test execution, outputs shown as a labeled table instead of raw JSON:

| Parameter            | Value  |
| -------------------- | ------ |
| result_concentration | "0.85" |
| batch_quality        | "PASS" |

Output keys mapped back to `output_parameter_specifications` for descriptions.

### 3c. Props Change

`TestPanel` receives additional props:

```typescript
interface TestPanelProps {
  actionOid: string
  state: string
  code: string
  inputParameters: InputParameterSpec[]
  outputParameters: OutputParameterSpec[] // NEW
  actionProperties: ActionPropertySpec[] // NEW
}
```

## 4. Code Template with Parameter Context

### Enhanced generateTemplate()

When no active code exists for a state, the auto-generated template includes full parameter and property definitions as comments:

```python
def execute(inputs, outputs, props, action_props):
    """
    State handler for MixReagent - EXECUTING

    Return True to advance to next state.
    Return False to trigger HOLD.
    """

    # -- Input Parameters ------------------------------------
    # inputs['temperature']    (string)  default: "25.0"  - Reactor temperature
    # inputs['pressure']       (number)  default: "101.3" - Chamber pressure
    # inputs['duration']       (number)  default: "300"   - Mix duration

    # -- Output Parameters -----------------------------------
    # outputs['concentration'] (string)  - Final reagent concentration
    # outputs['batch_id']      (string)  - Generated batch identifier

    # -- Action Properties -----------------------------------
    # action_props['reactor_config']['max_temp']  = "200"
    # action_props['reactor_config']['min_temp']  = "10"

    return True
```

Rules:

- Each section omitted if empty (no "none" placeholders)
- Input params: name, type, default, description — formatted as `inputs['name']` for copy-paste
- Output params: name, type, description — formatted as `outputs['name']`
- Action properties: nested group/entry format matching actual `action_props` dict
- Template only generated on 404 (no existing code) — existing code is never overwritten

## 5. State History Fix (UI-14)

Bug fix — type alignment:

- `StateHistoryEntry` in `types.ts` changes from `{ to_state, from_state, triggered_by, timestamp }` to `{ state: string, timestamp: string }`
- `InstanceDetailPage.tsx` renders `entry.state` instead of `entry.to_state`

## 6. Correct State Names

Fixed implicitly by building the visual diagram from the actual engine state names. The wrong `OBSERVABLE_CODE_STATES` and `OPAQUE_CODE_STATES` arrays are deleted — replaced by the diagram components which hardcode the correct states from `packages/engine/src/state-machine/states.ts`.

`ActionDetailPage.tsx` `CODE_STATES` array also corrected to match engine states.

## Files Affected

### New Files

- `apps/console/src/features/code-editor/StateDiagram.tsx` — visual state machine component
- `apps/console/src/features/code-editor/StateButton.tsx` — individual state button
- `apps/console/src/features/code-editor/ObservableDiagram.tsx` — observable layout
- `apps/console/src/features/code-editor/OpaqueDiagram.tsx` — opaque layout
- `packages/storage/src/migrations/002-action-timeout.ts` — schema migration

### Modified Files

- `apps/console/src/features/code-editor/CodeEditorPage.tsx` — layout change, remove state dropdown
- `apps/console/src/features/code-editor/TestPanel.tsx` — parameter labels, output table
- `apps/console/src/features/actions/ActionDetailPage.tsx` — correct state names, timeout section
- `apps/console/src/features/settings/SettingsPage.tsx` — seconds display, 0 = disabled
- `apps/console/src/features/instances/InstanceDetailPage.tsx` — entry.state fix
- `apps/console/src/lib/types.ts` — StateHistoryEntry fix, timeout types
- `apps/console/src/lib/api.ts` — timeout endpoint
- `packages/storage/src/repositories/settings.repository.ts` — allow 0 for timeout
- `packages/storage/src/repositories/action.repository.ts` — timeout_seconds field
- `packages/server/src/routes/management.ts` — timeout endpoint
- `packages/engine/src/instance-manager/instance-manager.ts` — timeout resolution
- `packages/engine/src/python-pool/pool.ts` — skip timer when timeout = 0

---

_Design approved: 2026-02-27_
