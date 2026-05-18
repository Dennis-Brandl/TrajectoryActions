# Warehouse Scenario — Phase 2 Wave 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace stub Python in 3 observable warehouse actions (`PickItem`, `PutawayItem`, `MoveItem`) with simulation-aware code that supports the cross-cutting `status` output (0/1/2 = clean/abort/timeout). SIMULATION_MODE remains `false` for all tests this phase — probabilistic injection coverage is deferred to Phase 4.

**Architecture:** Phase 1 found that outputs only flush to the engine at end of `execute()`, so `status='2'` set in EXECUTING before a long sleep is lost on the SIGKILL that fires when the timeout trips. Resolution: STARTING decides the simulation outcome (rolls dice, sets `status` to 0/1/2) and returns normally so the value flushes. EXECUTING reads the pre-set status and acts: `status==='1'` → raise to abort; `status==='2'` → sleep past the timeout; otherwise simulate brief work. COMPLETING sets the action-specific outputs and confirms status=0. ABORTING preserves whatever STARTING set — manual aborts (user ABORT) leave status at 0, so the workflow can distinguish via the (status, terminal-state) tuple.

**Tech Stack:** Python 3 sandbox runner, vitest + supertest, TypeScript (test extension only).

**Spec:** `docs/specs/2026-05-08-warehouse-scenario-implementation-design.md` (Phase 2 row) and `docs/specs/2026-04-01-warehouse-scenario-design.md` (per-action semantics).

---

## File Structure

| File                                                                                       | Role                                                                                                                                               |
| ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/scenarios/warehouse/code/PickItem/STARTING.py`                                    | EDIT. Permissive input validation + simulation outcome dice roll.                                                                                  |
| `scripts/scenarios/warehouse/code/PickItem/EXECUTING.py`                                   | EDIT. Branch on status: raise / long-sleep / brief-work.                                                                                           |
| `scripts/scenarios/warehouse/code/PickItem/COMPLETING.py`                                  | EDIT. Set `picked_quantity`, `pick_status`, `status='0'`.                                                                                          |
| `scripts/scenarios/warehouse/code/PickItem/ABORTING.py`                                    | EDIT. Pass — preserve STARTING's status decision.                                                                                                  |
| `scripts/scenarios/warehouse/code/PutawayItem/{STARTING,EXECUTING,COMPLETING,ABORTING}.py` | EDIT × 4. Same pattern as PickItem; COMPLETING sets `stored_quantity`.                                                                             |
| `scripts/scenarios/warehouse/code/MoveItem/{STARTING,EXECUTING,COMPLETING,ABORTING}.py`    | EDIT × 4. Same pattern; COMPLETING just sets `status='0'` (no action-specific outputs beyond status).                                              |
| `packages/server/src/__tests__/scenario-warehouse.test.ts`                                 | EDIT. Extend the "invokes each action with SIMULATION_MODE=false and gets status=0" test to also assert per-action outputs for the wave 1 actions. |

12 Python files rewritten. The Phase 1 stub `def execute(inputs, outputs, props, action_props): outputs['status'] = '0'` is replaced with a proper state-specific implementation in each.

---

## Common Python helpers (referenced from each action's per-state file)

There's no shared Python module — the sandbox loads each `.py` file fresh. The simulation logic appears in every STARTING.py and EXECUTING.py with the action name as the only differentiator. This is intentional — DRY is sacrificed for clarity (each file is self-contained and editable in the Code Editor without surprise).

The shared shape of STARTING.py is:

```python
import random

def execute(inputs, outputs, props, action_props):
    # Permissive validation: warn on bad input, don't abort.
    # (Per-action validation goes here — see each task.)

    # Simulation outcome dice roll.
    sim = props.get('SIMULATION_MODE', {}).get('Value', 'false').lower() == 'true'
    if sim and random.random() < 0.10:
        mode = random.choice(['abort', 'timeout'])
        outputs['status'] = '1' if mode == 'abort' else '2'
    # else: leave status at the default '0' (declared in the action spec)
```

The shared shape of EXECUTING.py is:

```python
import random
import time

def execute(inputs, outputs, props, action_props):
    status = outputs.get('status', '0')
    if status == '1':
        # Planned simulated abort — set in STARTING.
        raise RuntimeError('<ACTION_NAME>: simulated random abort')
    if status == '2':
        # Planned simulated timeout — set in STARTING. Sleep past the 3s action timeout.
        time.sleep(60)
        return  # SIGKILL fires before this returns; status was already flushed in STARTING.
    # Clean path: simulate brief work.
    time.sleep(random.uniform(0.5, 1.5))
```

The shared shape of ABORTING.py is:

```python
def execute(inputs, outputs, props, action_props):
    # Preserve status set by STARTING:
    #   0 → manual abort (user sent ABORT command during a clean run)
    #   1 → simulated random abort
    #   2 → simulated timeout
    pass
```

COMPLETING.py is action-specific.

---

## Task 1: PickItem code

**Files:**

- Modify: `scripts/scenarios/warehouse/code/PickItem/STARTING.py`
- Modify: `scripts/scenarios/warehouse/code/PickItem/EXECUTING.py`
- Modify: `scripts/scenarios/warehouse/code/PickItem/COMPLETING.py`
- Modify: `scripts/scenarios/warehouse/code/PickItem/ABORTING.py`

PickItem inputs: `shelf_location`, `item_sku`, `quantity`. Outputs: `picked_quantity`, `pick_status`, `status`.

- [ ] **Step 1: Replace `STARTING.py`**

```python
import random


def execute(inputs, outputs, props, action_props):
    # Permissive validation: warn but don't abort on empty inputs.
    if not str(inputs.get('shelf_location', '')).strip():
        print('WARN: PickItem STARTING: shelf_location is empty')
    if not str(inputs.get('item_sku', '')).strip():
        print('WARN: PickItem STARTING: item_sku is empty')

    # Simulation outcome dice roll. Decision flushes to the engine when this
    # function returns, so EXECUTING (and ABORTING after a kill) see the final value.
    sim = (
        props.get('SIMULATION_MODE', {}).get('Value', 'false').lower() == 'true'
    )
    if sim and random.random() < 0.10:
        mode = random.choice(['abort', 'timeout'])
        outputs['status'] = '1' if mode == 'abort' else '2'
```

- [ ] **Step 2: Replace `EXECUTING.py`**

```python
import random
import time


def execute(inputs, outputs, props, action_props):
    status = outputs.get('status', '0')
    if status == '1':
        raise RuntimeError('PickItem: simulated random abort (crane obstruction)')
    if status == '2':
        # Sleep past the 3s action timeout. Engine SIGKILLs the worker; status='2'
        # is already persisted from STARTING.
        time.sleep(60)
        return
    # Clean path: simulate brief crane movement.
    time.sleep(random.uniform(0.5, 1.5))
```

- [ ] **Step 3: Replace `COMPLETING.py`**

```python
def execute(inputs, outputs, props, action_props):
    quantity = str(inputs.get('quantity', '0'))
    outputs['picked_quantity'] = quantity
    outputs['pick_status'] = 'success'
    outputs['status'] = '0'
```

- [ ] **Step 4: Replace `ABORTING.py`**

```python
def execute(inputs, outputs, props, action_props):
    # Preserve status set by STARTING:
    #   0 → manual abort (user sent ABORT command during a clean run)
    #   1 → simulated random abort
    #   2 → simulated timeout
    pass
```

- [ ] **Step 5: Rebuild and re-run the integration test for the warehouse**

```
npm test -- packages/server/src/__tests__/scenario-warehouse.test.ts
```

Expected: 4/4 pass. The "invokes each action … and gets status=0" test still passes for PickItem because SIMULATION_MODE defaults to `false`, so the dice roll never fires and the flow is `STARTING (status=0) → EXECUTING (sleep 0.5-1.5s) → COMPLETING (sets outputs)`.

If a test fails, debug before moving on. Common issues:

- `props` shape mismatch — confirm by adding `print(f"DEBUG props: {props}")` to STARTING.py and re-running.
- `outputs` defaults — the engine seeds `outputs` from the action spec's `default_value`. PickItem declares `status` default `'0'`, so `outputs.get('status', '0')` should always find `'0'` on a clean run.

- [ ] **Step 6: Commit**

```
git add scripts/scenarios/warehouse/code/PickItem/
git commit -m "feat(scenarios): PickItem simulation-aware Python (wave 1)"
```

---

## Task 2: PutawayItem code

**Files:**

- Modify: `scripts/scenarios/warehouse/code/PutawayItem/STARTING.py`
- Modify: `scripts/scenarios/warehouse/code/PutawayItem/EXECUTING.py`
- Modify: `scripts/scenarios/warehouse/code/PutawayItem/COMPLETING.py`
- Modify: `scripts/scenarios/warehouse/code/PutawayItem/ABORTING.py`

PutawayItem inputs: `shelf_location`, `item_sku`, `quantity`. Outputs: `stored_quantity`, `status`.

- [ ] **Step 1: Replace `STARTING.py`**

```python
import random


def execute(inputs, outputs, props, action_props):
    if not str(inputs.get('shelf_location', '')).strip():
        print('WARN: PutawayItem STARTING: shelf_location is empty')
    if not str(inputs.get('item_sku', '')).strip():
        print('WARN: PutawayItem STARTING: item_sku is empty')

    sim = (
        props.get('SIMULATION_MODE', {}).get('Value', 'false').lower() == 'true'
    )
    if sim and random.random() < 0.10:
        mode = random.choice(['abort', 'timeout'])
        outputs['status'] = '1' if mode == 'abort' else '2'
```

- [ ] **Step 2: Replace `EXECUTING.py`**

```python
import random
import time


def execute(inputs, outputs, props, action_props):
    status = outputs.get('status', '0')
    if status == '1':
        raise RuntimeError('PutawayItem: simulated random abort (shelf full)')
    if status == '2':
        time.sleep(60)
        return
    time.sleep(random.uniform(0.5, 1.5))
```

- [ ] **Step 3: Replace `COMPLETING.py`**

```python
def execute(inputs, outputs, props, action_props):
    quantity = str(inputs.get('quantity', '0'))
    outputs['stored_quantity'] = quantity
    outputs['status'] = '0'
```

- [ ] **Step 4: Replace `ABORTING.py`**

```python
def execute(inputs, outputs, props, action_props):
    # Preserve status set by STARTING (0 manual / 1 simulated abort / 2 simulated timeout).
    pass
```

- [ ] **Step 5: Re-run the integration test**

```
npm test -- packages/server/src/__tests__/scenario-warehouse.test.ts
```

Expected: 4/4 pass.

- [ ] **Step 6: Commit**

```
git add scripts/scenarios/warehouse/code/PutawayItem/
git commit -m "feat(scenarios): PutawayItem simulation-aware Python (wave 1)"
```

---

## Task 3: MoveItem code

**Files:**

- Modify: `scripts/scenarios/warehouse/code/MoveItem/STARTING.py`
- Modify: `scripts/scenarios/warehouse/code/MoveItem/EXECUTING.py`
- Modify: `scripts/scenarios/warehouse/code/MoveItem/COMPLETING.py`
- Modify: `scripts/scenarios/warehouse/code/MoveItem/ABORTING.py`

MoveItem inputs: `from_location`, `to_location`, `item_sku`. Outputs: `status` only.

- [ ] **Step 1: Replace `STARTING.py`**

```python
import random


def execute(inputs, outputs, props, action_props):
    if not str(inputs.get('from_location', '')).strip():
        print('WARN: MoveItem STARTING: from_location is empty')
    if not str(inputs.get('to_location', '')).strip():
        print('WARN: MoveItem STARTING: to_location is empty')

    sim = (
        props.get('SIMULATION_MODE', {}).get('Value', 'false').lower() == 'true'
    )
    if sim and random.random() < 0.10:
        mode = random.choice(['abort', 'timeout'])
        outputs['status'] = '1' if mode == 'abort' else '2'
```

- [ ] **Step 2: Replace `EXECUTING.py`**

```python
import random
import time


def execute(inputs, outputs, props, action_props):
    status = outputs.get('status', '0')
    if status == '1':
        raise RuntimeError('MoveItem: simulated random abort (path blocked)')
    if status == '2':
        time.sleep(60)
        return
    time.sleep(random.uniform(0.5, 1.5))
```

- [ ] **Step 3: Replace `COMPLETING.py`**

```python
def execute(inputs, outputs, props, action_props):
    outputs['status'] = '0'
```

- [ ] **Step 4: Replace `ABORTING.py`**

```python
def execute(inputs, outputs, props, action_props):
    # Preserve status set by STARTING (0 manual / 1 simulated abort / 2 simulated timeout).
    pass
```

- [ ] **Step 5: Re-run the integration test**

```
npm test -- packages/server/src/__tests__/scenario-warehouse.test.ts
```

Expected: 4/4 pass.

- [ ] **Step 6: Commit**

```
git add scripts/scenarios/warehouse/code/MoveItem/
git commit -m "feat(scenarios): MoveItem simulation-aware Python (wave 1)"
```

---

## Task 4: Integration test wave 1 output assertions

**Files:**

- Modify: `packages/server/src/__tests__/scenario-warehouse.test.ts`

The existing Test 4 ("invokes each action with SIMULATION_MODE=false and gets status=0") already loops all 10 actions and asserts `state==='COMPLETED'` plus `outputs.status==='0'`. Phase 2 extends this to ALSO assert per-action outputs for the wave 1 actions, so a regression in one of the new COMPLETING.py files is caught loudly.

- [ ] **Step 1: Read the existing test 4 to find the loop**

Open `packages/server/src/__tests__/scenario-warehouse.test.ts` and find the `it('invokes each action with SIMULATION_MODE=false and gets status=0', ...)` block. It contains a `for (const action of warehouseScenario.actions)` loop with assertions:

```ts
expect(terminal.state, `${action.local_id} ended in ${terminal.state}`).toBe('COMPLETED')
expect(terminal.outputs.status, `${action.local_id} status`).toBe('0')
```

- [ ] **Step 2: Add the wave-1 expected outputs map and per-action assertion**

**Above** the `for` loop body (so the map is in scope), add:

```ts
const WAVE_1_EXPECTED_OUTPUTS: Record<string, Record<string, string>> = {
  'act-wh-pick-001': { picked_quantity: '1', pick_status: 'success', status: '0' },
  'act-wh-putaway-001': { stored_quantity: '1', status: '0' },
  'act-wh-move-001': { status: '0' },
}
```

(Quantities are `'1'` because the action specs declare `quantity` default `'1'`.)

**After** the existing two assertions inside the loop, add:

```ts
const expected = WAVE_1_EXPECTED_OUTPUTS[action.oid]
if (expected) {
  for (const [key, value] of Object.entries(expected)) {
    expect(terminal.outputs[key], `${action.local_id}.${key}`).toBe(value)
  }
}
```

The wave 1 actions get extra per-output assertions; the other 7 actions still only get the `state` and `status` checks (their COMPLETING.py is still the stub from Phase 1).

- [ ] **Step 3: Run the integration test**

```
npm test -- packages/server/src/__tests__/scenario-warehouse.test.ts
```

Expected: 4/4 pass. The new per-output assertions exercise the wave 1 COMPLETING.py rewrites.

If they fail with the wrong output value, the action's COMPLETING.py is wrong — debug there before moving on. If they fail with `undefined`, the action's COMPLETING didn't set the output (or the output didn't survive the round-trip — check test code conversion of the array-shaped outputs).

- [ ] **Step 4: Run the full suite to confirm no regressions**

```
npm test
```

Expected: previous total + 0 (no new tests, just stricter assertions). All green.

- [ ] **Step 5: Commit**

```
git add packages/server/src/__tests__/scenario-warehouse.test.ts
git commit -m "test(scenarios): wave 1 per-action output assertions"
```

---

## Task 5: Manual smoke + final verification

**Files:** none modified.

- [ ] **Step 1: Confirm dev server is running**

If the dev server isn't already up:

```
npm run dev
```

Wait for "server on :3002" message.

If it IS up (e.g., from Phase 1 manual smoke), it will hot-reload as the Python files were last edited via the API in Phase 1. To pick up the new wave 1 code, re-deploy:

- [ ] **Step 2: Re-deploy the warehouse**

```
npx tsx scripts/scenarios/cli.ts deploy warehouse --server http://localhost:3002
```

Expected: `actionsImported: 10, actionsFailed: [], timeoutsSet: 10`.

This re-uploads all 10 actions including the wave 1 rewrites. Each `.WFactionCodeX` upload upserts the action and saves+activates new code versions. The previously-active stubs are deactivated.

- [ ] **Step 3: Curl-invoke each wave 1 action**

PickItem:

```bash
curl -X POST http://localhost:3002/trajectory/v1/actions/act-wh-pick-001/invoke \
  -H 'Content-Type: application/json' \
  -d '{
    "environment_oid": "env-warehouse-001",
    "workflow_instance_id": "wf-phase2-pick",
    "step_instance_id": "step-pick",
    "step_oid": "step-oid-pick",
    "input_parameters": [
      { "name": "shelf_location", "value": "BIN-A1" },
      { "name": "item_sku", "value": "SKU-1001" },
      { "name": "quantity", "value": "5" }
    ]
  }'
```

Note the returned `instance_id`, then poll:

```bash
curl http://localhost:3002/trajectory/v1/instances/<instance_id>
```

Expected: `state.current === 'COMPLETED'`, `outputs` contains `{ key: 'picked_quantity', value: '5' }`, `{ key: 'pick_status', value: 'success' }`, `{ key: 'status', value: '0' }`.

PutawayItem (substitute `act-wh-putaway-001` and inputs `shelf_location`, `item_sku`, `quantity` with default values). Expect `outputs.stored_quantity === '1'`, `status === '0'`.

MoveItem (substitute `act-wh-move-001`, inputs `from_location`, `to_location`, `item_sku`). Expect `outputs.status === '0'`.

- [ ] **Step 4: Open the console and inspect a wave 1 action's code**

Browse to the dev console (default `http://localhost:5176/`). Click `PickItem` in the explorer. Open the code editor for `EXECUTING` — the code should now show the simulation-aware version (status branching on '1', '2', or default), not the Phase 1 stub. Same for `STARTING`, `COMPLETING`, `ABORTING`.

- [ ] **Step 5: If all checks pass, no further commit needed**

If any manual check failed, debug, fix, and commit:

```
git add <fixed files>
git commit -m "fix(scenarios): wave 1 manual-smoke followup"
```

---

## Summary of expected commits

1. `feat(scenarios): PickItem simulation-aware Python (wave 1)`
2. `feat(scenarios): PutawayItem simulation-aware Python (wave 1)`
3. `feat(scenarios): MoveItem simulation-aware Python (wave 1)`
4. `test(scenarios): wave 1 per-action output assertions`
5. (optional) `fix(scenarios): wave 1 manual-smoke followup`
