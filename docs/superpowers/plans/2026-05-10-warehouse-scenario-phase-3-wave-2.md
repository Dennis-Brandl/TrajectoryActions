# Warehouse Scenario — Phase 3 Wave 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace stub Python in 4 observable warehouse actions (`ConsolidateOrder`, `CycleCount`, `ReceiveShipment`, `ShipOrder`) with simulation-aware code following the Phase 2 wave-1 pattern (STARTING decides outcome via dice roll; EXECUTING branches on status; COMPLETING sets action-specific outputs; ABORTING preserves).

**Architecture:** Identical to Phase 2 wave 1 (commits `8d6f763`..`d628861`). STARTING-decides-outcome design avoids the SIGKILL-loses-outputs problem documented in Phase 1's design doc. SIMULATION_MODE stays `false` for all tests this phase — probabilistic injection deferred to Phase 4.

**Tech Stack:** Python 3 sandbox runner, vitest + supertest, TypeScript (test extension only).

**Spec:** `docs/specs/2026-05-08-warehouse-scenario-implementation-design.md` (Phase 3 row); `docs/superpowers/plans/2026-05-09-warehouse-scenario-phase-2-wave-1.md` (canonical pattern).

**Phase 3 carry-forward decisions** (from Phase 2 final review):

- **Comment style:** Use PickItem's verbose 3-line ABORTING comment as the canonical template for all wave-2 actions. Apply uniformly. Add the `# Sleep past the 3s action timeout...` comment to every EXECUTING.py's `time.sleep(60)` line for self-documentation.
- **DRY:** Continue verbatim duplication of the dice-roll logic across STARTING.py files. We'll evaluate factoring to a shared `_sim_utils.py` after Phase 4 ships the opaque actions; at that point we'll have all 10 simulation-aware files in hand.
- **Test variable:** Add a separate `WAVE_2_EXPECTED_OUTPUTS` const to the integration test. Keeps wave-1 and wave-2 expectations distinguishable in the diff. A renaming/merging cleanup can happen in Phase 4.

---

## File Structure

| File                                                                                            | Role                                                                                                    |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `scripts/scenarios/warehouse/code/ConsolidateOrder/{STARTING,EXECUTING,COMPLETING,ABORTING}.py` | EDIT × 4. COMPLETING sets `pallet_id = f"PALLET-{order_id}"`.                                           |
| `scripts/scenarios/warehouse/code/CycleCount/{STARTING,EXECUTING,COMPLETING,ABORTING}.py`       | EDIT × 4. COMPLETING sets `discrepancy_count = '0'`.                                                    |
| `scripts/scenarios/warehouse/code/ReceiveShipment/{STARTING,EXECUTING,COMPLETING,ABORTING}.py`  | EDIT × 4. COMPLETING sets `received_count = expected_count`.                                            |
| `scripts/scenarios/warehouse/code/ShipOrder/{STARTING,EXECUTING,COMPLETING,ABORTING}.py`        | EDIT × 4. COMPLETING sets `tracking_number = f"TRACK-{order_id}-{carrier}"`.                            |
| `packages/server/src/__tests__/scenario-warehouse.test.ts`                                      | EDIT. Add `WAVE_2_EXPECTED_OUTPUTS` const; extend the loop to assert per-action outputs for wave-2 too. |

16 Python file rewrites + ~10 lines of test additions.

---

## Canonical templates (used by each action)

**STARTING.py template** — `<ACTION>` and `<INPUT_FIELDS>` replaced per action:

```python
import random


def execute(inputs, outputs, props, action_props):
    # Permissive validation: warn but don't abort on empty inputs.
    if not str(inputs.get('<FIELD_1>', '')).strip():
        print('WARN: <ACTION> STARTING: <FIELD_1> is empty')
    # ... (one warn per field worth validating)

    # Simulation outcome dice roll. Decision flushes to the engine when this
    # function returns, so EXECUTING (and ABORTING after a kill) see the final value.
    sim = (
        props.get('SIMULATION_MODE', {}).get('Value', 'false').lower() == 'true'
    )
    if sim and random.random() < 0.10:
        mode = random.choice(['abort', 'timeout'])
        outputs['status'] = '1' if mode == 'abort' else '2'
```

**EXECUTING.py template:**

```python
import random
import time


def execute(inputs, outputs, props, action_props):
    status = outputs.get('status', '0')
    if status == '1':
        raise RuntimeError('<ACTION>: simulated random abort (<REASON>)')
    if status == '2':
        # Sleep past the 3s action timeout. Engine SIGKILLs the worker; status='2'
        # is already persisted from STARTING.
        time.sleep(60)
        return
    # Clean path: simulate brief work.
    time.sleep(random.uniform(0.5, 1.5))
```

**ABORTING.py template (uniform across all wave-2 actions):**

```python
def execute(inputs, outputs, props, action_props):
    # Preserve status set by STARTING:
    #   0 → manual abort (user sent ABORT command during a clean run)
    #   1 → simulated random abort
    #   2 → simulated timeout
    pass
```

**COMPLETING.py varies per action** — see individual tasks below.

---

## Task 1: ConsolidateOrder

**Files:** `scripts/scenarios/warehouse/code/ConsolidateOrder/{STARTING,EXECUTING,COMPLETING,ABORTING}.py`

ConsolidateOrder inputs: `order_id`, `item_count`. Outputs: `pallet_id`, `status`.

- [ ] **Step 1: Replace `STARTING.py`**

```python
import random


def execute(inputs, outputs, props, action_props):
    if not str(inputs.get('order_id', '')).strip():
        print('WARN: ConsolidateOrder STARTING: order_id is empty')

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
        raise RuntimeError('ConsolidateOrder: simulated random abort (missing item)')
    if status == '2':
        # Sleep past the 3s action timeout. Engine SIGKILLs the worker; status='2'
        # is already persisted from STARTING.
        time.sleep(60)
        return
    time.sleep(random.uniform(0.5, 1.5))
```

- [ ] **Step 3: Replace `COMPLETING.py`**

```python
def execute(inputs, outputs, props, action_props):
    order_id = str(inputs.get('order_id', ''))
    outputs['pallet_id'] = f'PALLET-{order_id}'
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

- [ ] **Step 5: Run the integration test**

```
npm test -- packages/server/src/__tests__/scenario-warehouse.test.ts
```

Expected: 4/4 pass.

- [ ] **Step 6: Commit**

```
git add scripts/scenarios/warehouse/code/ConsolidateOrder/
git commit -m "feat(scenarios): ConsolidateOrder simulation-aware Python (wave 2)"
```

---

## Task 2: CycleCount

**Files:** `scripts/scenarios/warehouse/code/CycleCount/{STARTING,EXECUTING,COMPLETING,ABORTING}.py`

CycleCount inputs: `zone`. Outputs: `discrepancy_count`, `status`.

- [ ] **Step 1: Replace `STARTING.py`**

```python
import random


def execute(inputs, outputs, props, action_props):
    if not str(inputs.get('zone', '')).strip():
        print('WARN: CycleCount STARTING: zone is empty')

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
        raise RuntimeError('CycleCount: simulated random abort (scanner failure)')
    if status == '2':
        # Sleep past the 3s action timeout. Engine SIGKILLs the worker; status='2'
        # is already persisted from STARTING.
        time.sleep(60)
        return
    time.sleep(random.uniform(0.5, 1.5))
```

- [ ] **Step 3: Replace `COMPLETING.py`**

```python
def execute(inputs, outputs, props, action_props):
    outputs['discrepancy_count'] = '0'
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

- [ ] **Step 5: Run the integration test**

```
npm test -- packages/server/src/__tests__/scenario-warehouse.test.ts
```

Expected: 4/4 pass.

- [ ] **Step 6: Commit**

```
git add scripts/scenarios/warehouse/code/CycleCount/
git commit -m "feat(scenarios): CycleCount simulation-aware Python (wave 2)"
```

---

## Task 3: ReceiveShipment

**Files:** `scripts/scenarios/warehouse/code/ReceiveShipment/{STARTING,EXECUTING,COMPLETING,ABORTING}.py`

ReceiveShipment inputs: `shipment_id`, `expected_count`. Outputs: `received_count`, `status`.

- [ ] **Step 1: Replace `STARTING.py`**

```python
import random


def execute(inputs, outputs, props, action_props):
    if not str(inputs.get('shipment_id', '')).strip():
        print('WARN: ReceiveShipment STARTING: shipment_id is empty')

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
        raise RuntimeError('ReceiveShipment: simulated random abort (damaged container)')
    if status == '2':
        # Sleep past the 3s action timeout. Engine SIGKILLs the worker; status='2'
        # is already persisted from STARTING.
        time.sleep(60)
        return
    time.sleep(random.uniform(0.5, 1.5))
```

- [ ] **Step 3: Replace `COMPLETING.py`**

```python
def execute(inputs, outputs, props, action_props):
    expected_count = str(inputs.get('expected_count', '0'))
    outputs['received_count'] = expected_count
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

- [ ] **Step 5: Run the integration test**

```
npm test -- packages/server/src/__tests__/scenario-warehouse.test.ts
```

Expected: 4/4 pass.

- [ ] **Step 6: Commit**

```
git add scripts/scenarios/warehouse/code/ReceiveShipment/
git commit -m "feat(scenarios): ReceiveShipment simulation-aware Python (wave 2)"
```

---

## Task 4: ShipOrder

**Files:** `scripts/scenarios/warehouse/code/ShipOrder/{STARTING,EXECUTING,COMPLETING,ABORTING}.py`

ShipOrder inputs: `order_id`, `carrier`. Outputs: `tracking_number`, `status`.

- [ ] **Step 1: Replace `STARTING.py`**

```python
import random


def execute(inputs, outputs, props, action_props):
    if not str(inputs.get('order_id', '')).strip():
        print('WARN: ShipOrder STARTING: order_id is empty')
    if not str(inputs.get('carrier', '')).strip():
        print('WARN: ShipOrder STARTING: carrier is empty')

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
        raise RuntimeError('ShipOrder: simulated random abort (carrier unavailable)')
    if status == '2':
        # Sleep past the 3s action timeout. Engine SIGKILLs the worker; status='2'
        # is already persisted from STARTING.
        time.sleep(60)
        return
    time.sleep(random.uniform(0.5, 1.5))
```

- [ ] **Step 3: Replace `COMPLETING.py`**

```python
def execute(inputs, outputs, props, action_props):
    order_id = str(inputs.get('order_id', ''))
    carrier = str(inputs.get('carrier', ''))
    outputs['tracking_number'] = f'TRACK-{order_id}-{carrier}'
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

- [ ] **Step 5: Run the integration test**

```
npm test -- packages/server/src/__tests__/scenario-warehouse.test.ts
```

Expected: 4/4 pass.

- [ ] **Step 6: Commit**

```
git add scripts/scenarios/warehouse/code/ShipOrder/
git commit -m "feat(scenarios): ShipOrder simulation-aware Python (wave 2)"
```

---

## Task 5: Integration test wave 2 output assertions

**Files:** `packages/server/src/__tests__/scenario-warehouse.test.ts`

- [ ] **Step 1: Open the file and find the wave-1 expected-outputs constant**

It currently looks like:

```ts
const WAVE_1_EXPECTED_OUTPUTS: Record<string, Record<string, string>> = {
  'act-wh-pick-001': { picked_quantity: '1', pick_status: 'success', status: '0' },
  'act-wh-putaway-001': { stored_quantity: '1', status: '0' },
  'act-wh-move-001': { status: '0' },
}
```

- [ ] **Step 2: Add a sibling constant for wave 2 below it**

```ts
const WAVE_2_EXPECTED_OUTPUTS: Record<string, Record<string, string>> = {
  'act-wh-consolidate-001': { pallet_id: 'PALLET-ORD-9001', status: '0' },
  'act-wh-cyclecount-001': { discrepancy_count: '0', status: '0' },
  'act-wh-receive-001': { received_count: '50', status: '0' },
  'act-wh-ship-001': { tracking_number: 'TRACK-ORD-9001-GROUND', status: '0' },
}
```

The values match the action defaults declared in `scripts/scenarios/warehouse/definition.ts`:

- ConsolidateOrder default `order_id='ORD-9001'` → `pallet_id='PALLET-ORD-9001'`
- ReceiveShipment default `expected_count='50'` → `received_count='50'`
- ShipOrder defaults `order_id='ORD-9001'`, `carrier='GROUND'` → `tracking_number='TRACK-ORD-9001-GROUND'`

- [ ] **Step 3: Extend the in-loop assertion to also check wave 2**

The existing inner block (added in Phase 2) looks like:

```ts
const expected = WAVE_1_EXPECTED_OUTPUTS[action.oid]
if (expected) {
  for (const [key, value] of Object.entries(expected)) {
    expect(terminal.outputs[key], `${action.local_id}.${key}`).toBe(value)
  }
}
```

Replace it with the merged version that checks BOTH waves:

```ts
const expected = WAVE_1_EXPECTED_OUTPUTS[action.oid] ?? WAVE_2_EXPECTED_OUTPUTS[action.oid]
if (expected) {
  for (const [key, value] of Object.entries(expected)) {
    expect(terminal.outputs[key], `${action.local_id}.${key}`).toBe(value)
  }
}
```

- [ ] **Step 4: Run the integration test**

```
npm test -- packages/server/src/__tests__/scenario-warehouse.test.ts
```

Expected: 4/4 pass. The new wave-2 assertions exercise the COMPLETING.py rewrites.

If a wave-2 assertion fails:

- Wrong value: check the action's COMPLETING.py — the formula may be off (e.g., `f'TRACK-{order_id}-{carrier}'` requires both fields present)
- `undefined`: COMPLETING didn't write the output (or wrote it under a different key)

- [ ] **Step 5: Run the full suite**

```
npm test
```

Expected: 1032 tests, all passing.

- [ ] **Step 6: Commit**

```
git add packages/server/src/__tests__/scenario-warehouse.test.ts
git commit -m "test(scenarios): wave 2 per-action output assertions"
```

---

## Task 6: Manual smoke + push

**Files:** none modified directly.

- [ ] **Step 1: Confirm dev server is up on :3002**

```
netstat -ano | findstr :3002
```

If nothing is listening, start the dev stack:

```
npm run dev
```

- [ ] **Step 2: Re-deploy the warehouse**

```
npx tsx scripts/scenarios/cli.ts deploy warehouse --server http://localhost:3002
```

Expected: `actionsImported: 10, actionsFailed: [], timeoutsSet: 10`.

- [ ] **Step 3: Curl-invoke each wave-2 action**

ConsolidateOrder:

```bash
curl -X POST http://localhost:3002/trajectory/v1/actions/act-wh-consolidate-001/invoke \
  -H 'Content-Type: application/json' \
  -d '{
    "environment_oid": "env-warehouse-001",
    "workflow_instance_id": "wf-p3-cons",
    "step_instance_id": "step-cons",
    "step_oid": "step-oid-cons",
    "input_parameters": [
      { "name": "order_id", "value": "ORD-9001" },
      { "name": "item_count", "value": "5" }
    ]
  }'
```

Then poll `GET /trajectory/v1/instances/<id>`. Expected: `state.current === 'COMPLETED'`, outputs include `pallet_id: 'PALLET-ORD-9001'` and `status: '0'`.

Repeat for the other three wave-2 actions with sensible defaults from `definition.ts`. Expected outputs:

- CycleCount → `discrepancy_count: '0', status: '0'`
- ReceiveShipment → `received_count: '50', status: '0'` (default `expected_count='50'`)
- ShipOrder → `tracking_number: 'TRACK-ORD-9001-GROUND', status: '0'`

- [ ] **Step 4: Push**

```
git push origin master
```

- [ ] **Step 5: Commit any straggler fixes from manual smoke (only if needed)**

If smoke uncovered an issue, fix and commit:

```
git add <fixed files>
git commit -m "fix(scenarios): wave 2 manual-smoke followup"
```

---

## Summary of expected commits

1. `feat(scenarios): ConsolidateOrder simulation-aware Python (wave 2)`
2. `feat(scenarios): CycleCount simulation-aware Python (wave 2)`
3. `feat(scenarios): ReceiveShipment simulation-aware Python (wave 2)`
4. `feat(scenarios): ShipOrder simulation-aware Python (wave 2)`
5. `test(scenarios): wave 2 per-action output assertions`
6. (optional) `fix(scenarios): wave 2 manual-smoke followup`
