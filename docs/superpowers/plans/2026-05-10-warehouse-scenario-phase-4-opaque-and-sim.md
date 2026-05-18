# Warehouse Scenario — Phase 4 Opaque Actions + Sim Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace stub Python in 3 opaque warehouse actions (`UpdateInventoryDB`, `ScanBarcode`, `PrintLabel`) with simulation-aware code, plus add the deferred probabilistic `SIMULATION_MODE=true` integration test (50 PickItem invocations, assert 1 ≤ failures ≤ 49). Closes the warehouse scenario delivery.

**Architecture:** Opaque actions only have IN_PROGRESS + ABORTING — no STARTING. The dice-roll decision lives at the start of IN_PROGRESS. Both simulated abort and "simulated timeout" raise immediately after setting `status` to `'1'` or `'2'` respectively (true timeout via SIGKILL isn't reproducible in the 2-state flow; observable actions still exercise the real SIGKILL path for that test surface). HOLD remains observable-only. Verbatim duplication of the dice-roll block continues across all 10 actions; a DRY refactor is deferred.

**Tech Stack:** Python 3 sandbox runner, vitest + supertest, TypeScript (test extensions only).

**Spec:** `docs/specs/2026-05-08-warehouse-scenario-implementation-design.md` (Phase 4 row); Phase 2 + 3 plans for the observable-action canonical pattern.

---

## File Structure

| File                                                                           | Role                                                                    |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| `scripts/scenarios/warehouse/code/UpdateInventoryDB/{IN_PROGRESS,ABORTING}.py` | EDIT × 2. IN_PROGRESS does dice roll + simulate work; ABORTING is pass. |
| `scripts/scenarios/warehouse/code/ScanBarcode/{IN_PROGRESS,ABORTING}.py`       | EDIT × 2. IN_PROGRESS additionally sets `sku` from `barcode` input.     |
| `scripts/scenarios/warehouse/code/PrintLabel/{IN_PROGRESS,ABORTING}.py`        | EDIT × 2. IN_PROGRESS sets only `status='0'`.                           |
| `packages/server/src/__tests__/scenario-warehouse.test.ts`                     | EDIT. Add wave-3 expected outputs + new probabilistic SIM-mode test.    |

6 Python file rewrites + ~50 lines of test additions.

---

## Canonical templates

**IN_PROGRESS template:**

```python
import random
import time


def execute(inputs, outputs, props, action_props):
    # Permissive validation: warn but don't abort on empty inputs.
    # (per-action: see each task)

    # Simulation outcome dice roll. Opaque actions can't reproduce the
    # real SIGKILL-path timeout (no STARTING for outputs to flush before
    # EXECUTING sleeps), so a "simulated timeout" here raises immediately
    # after setting status='2'. To the workflow, the observable behavior
    # (status + ABORTED state) is identical.
    sim = (
        props.get('SIMULATION_MODE', {}).get('Value', 'false').lower() == 'true'
    )
    if sim and random.random() < 0.10:
        mode = random.choice(['abort', 'timeout'])
        outputs['status'] = '1' if mode == 'abort' else '2'
        raise RuntimeError(f'<ACTION>: simulated random <MODE> (<REASON>)')

    # Clean path: simulate brief work.
    time.sleep(random.uniform(0.5, 1.5))

    # <action-specific outputs go here>

    outputs['status'] = '0'
```

**ABORTING template:**

```python
def execute(inputs, outputs, props, action_props):
    # Preserve status set by IN_PROGRESS:
    #   0 → manual abort (user sent ABORT command during a clean run)
    #   1 → simulated random abort
    #   2 → simulated "timeout" (immediate raise; real SIGKILL not exercised
    #       in opaque flow because there's no STARTING-flush window)
    pass
```

---

## Task 1: UpdateInventoryDB

**Files:** `scripts/scenarios/warehouse/code/UpdateInventoryDB/{IN_PROGRESS,ABORTING}.py`

UpdateInventoryDB inputs: `sku`, `delta`. Outputs: `status` only.

- [ ] **Step 1: Replace `IN_PROGRESS.py`**

```python
import random
import time


def execute(inputs, outputs, props, action_props):
    if not str(inputs.get('sku', '')).strip():
        print('WARN: UpdateInventoryDB IN_PROGRESS: sku is empty')
    if not str(inputs.get('delta', '')).strip():
        print('WARN: UpdateInventoryDB IN_PROGRESS: delta is empty')

    # Opaque actions: dice roll happens here (no STARTING). 'timeout' raises
    # immediately after setting status='2' — see plan for rationale.
    sim = (
        props.get('SIMULATION_MODE', {}).get('Value', 'false').lower() == 'true'
    )
    if sim and random.random() < 0.10:
        mode = random.choice(['abort', 'timeout'])
        outputs['status'] = '1' if mode == 'abort' else '2'
        raise RuntimeError(
            f'UpdateInventoryDB: simulated random {mode} (db connection lost)'
        )

    # Clean path: simulate brief DB write.
    time.sleep(random.uniform(0.5, 1.5))
    outputs['status'] = '0'
```

- [ ] **Step 2: Replace `ABORTING.py`**

```python
def execute(inputs, outputs, props, action_props):
    # Preserve status set by IN_PROGRESS:
    #   0 → manual abort (user sent ABORT command during a clean run)
    #   1 → simulated random abort
    #   2 → simulated "timeout" (immediate raise; real SIGKILL not exercised
    #       in opaque flow because there's no STARTING-flush window)
    pass
```

- [ ] **Step 3: Run integration test**

```
npm test -- packages/server/src/__tests__/scenario-warehouse.test.ts
```

Expected: 4/4 pass.

- [ ] **Step 4: Commit**

```
git add scripts/scenarios/warehouse/code/UpdateInventoryDB/
git commit -m "feat(scenarios): UpdateInventoryDB simulation-aware Python (wave 3 opaque)"
```

---

## Task 2: ScanBarcode

**Files:** `scripts/scenarios/warehouse/code/ScanBarcode/{IN_PROGRESS,ABORTING}.py`

ScanBarcode inputs: `barcode`. Outputs: `sku`, `status`.

- [ ] **Step 1: Replace `IN_PROGRESS.py`**

```python
import random
import time


def execute(inputs, outputs, props, action_props):
    if not str(inputs.get('barcode', '')).strip():
        print('WARN: ScanBarcode IN_PROGRESS: barcode is empty')

    sim = (
        props.get('SIMULATION_MODE', {}).get('Value', 'false').lower() == 'true'
    )
    if sim and random.random() < 0.10:
        mode = random.choice(['abort', 'timeout'])
        outputs['status'] = '1' if mode == 'abort' else '2'
        raise RuntimeError(
            f'ScanBarcode: simulated random {mode} (scanner offline)'
        )

    # Clean path: simulate brief scan + resolve.
    time.sleep(random.uniform(0.5, 1.5))
    barcode = str(inputs.get('barcode', ''))
    # Deterministic mapping: SKU = "SKU-" + last 4 digits of barcode (or empty).
    outputs['sku'] = f'SKU-{barcode[-4:]}' if len(barcode) >= 4 else ''
    outputs['status'] = '0'
```

- [ ] **Step 2: Replace `ABORTING.py`**

```python
def execute(inputs, outputs, props, action_props):
    # Preserve status set by IN_PROGRESS:
    #   0 → manual abort (user sent ABORT command during a clean run)
    #   1 → simulated random abort
    #   2 → simulated "timeout" (immediate raise; real SIGKILL not exercised
    #       in opaque flow because there's no STARTING-flush window)
    pass
```

- [ ] **Step 3: Run integration test**

```
npm test -- packages/server/src/__tests__/scenario-warehouse.test.ts
```

Expected: 4/4 pass.

- [ ] **Step 4: Commit**

```
git add scripts/scenarios/warehouse/code/ScanBarcode/
git commit -m "feat(scenarios): ScanBarcode simulation-aware Python (wave 3 opaque)"
```

---

## Task 3: PrintLabel

**Files:** `scripts/scenarios/warehouse/code/PrintLabel/{IN_PROGRESS,ABORTING}.py`

PrintLabel inputs: `label_type`, `content`. Outputs: `status` only.

- [ ] **Step 1: Replace `IN_PROGRESS.py`**

```python
import random
import time


def execute(inputs, outputs, props, action_props):
    if not str(inputs.get('label_type', '')).strip():
        print('WARN: PrintLabel IN_PROGRESS: label_type is empty')
    if not str(inputs.get('content', '')).strip():
        print('WARN: PrintLabel IN_PROGRESS: content is empty')

    sim = (
        props.get('SIMULATION_MODE', {}).get('Value', 'false').lower() == 'true'
    )
    if sim and random.random() < 0.10:
        mode = random.choice(['abort', 'timeout'])
        outputs['status'] = '1' if mode == 'abort' else '2'
        raise RuntimeError(
            f'PrintLabel: simulated random {mode} (printer offline)'
        )

    # Clean path: simulate brief print job.
    time.sleep(random.uniform(0.5, 1.5))
    outputs['status'] = '0'
```

- [ ] **Step 2: Replace `ABORTING.py`**

```python
def execute(inputs, outputs, props, action_props):
    # Preserve status set by IN_PROGRESS:
    #   0 → manual abort (user sent ABORT command during a clean run)
    #   1 → simulated random abort
    #   2 → simulated "timeout" (immediate raise; real SIGKILL not exercised
    #       in opaque flow because there's no STARTING-flush window)
    pass
```

- [ ] **Step 3: Run integration test**

```
npm test -- packages/server/src/__tests__/scenario-warehouse.test.ts
```

Expected: 4/4 pass.

- [ ] **Step 4: Commit**

```
git add scripts/scenarios/warehouse/code/PrintLabel/
git commit -m "feat(scenarios): PrintLabel simulation-aware Python (wave 3 opaque)"
```

---

## Task 4: Test extensions — wave-3 assertions + SIM-mode probabilistic test

**Files:** `packages/server/src/__tests__/scenario-warehouse.test.ts`

Two additions to the existing test file:

1. Add `WAVE_3_EXPECTED_OUTPUTS` for the opaque actions; extend the in-loop assertion fallthrough to include it.
2. Add a new `it()` block: probabilistic SIM-mode coverage on PickItem (50 sequential invocations).

- [ ] **Step 1: Add the wave-3 expected outputs constant**

Find the existing wave-2 constant in `packages/server/src/__tests__/scenario-warehouse.test.ts`:

```ts
const WAVE_2_EXPECTED_OUTPUTS: Record<string, Record<string, string>> = {
  'act-wh-consolidate-001': { pallet_id: 'PALLET-ORD-9001', status: '0' },
  'act-wh-cyclecount-001': { discrepancy_count: '0', status: '0' },
  'act-wh-receive-001': { received_count: '50', status: '0' },
  'act-wh-ship-001': { tracking_number: 'TRACK-ORD-9001-GROUND', status: '0' },
}
```

Add a sibling constant directly below it:

```ts
const WAVE_3_EXPECTED_OUTPUTS: Record<string, Record<string, string>> = {
  'act-wh-updateinv-001': { status: '0' },
  // ScanBarcode: default barcode '0123456789012' → sku = 'SKU-' + last 4 = 'SKU-9012'
  'act-wh-scan-001': { sku: 'SKU-9012', status: '0' },
  'act-wh-print-001': { status: '0' },
}
```

- [ ] **Step 2: Extend the in-loop assertion fallthrough**

Find the existing fallthrough:

```ts
const expected = WAVE_1_EXPECTED_OUTPUTS[action.oid] ?? WAVE_2_EXPECTED_OUTPUTS[action.oid]
```

Change to include wave 3:

```ts
const expected =
  WAVE_1_EXPECTED_OUTPUTS[action.oid] ??
  WAVE_2_EXPECTED_OUTPUTS[action.oid] ??
  WAVE_3_EXPECTED_OUTPUTS[action.oid]
```

- [ ] **Step 3: Add the SIM-mode probabilistic test**

After the existing `it('invokes each action with SIMULATION_MODE=false ...')` test, add a new test:

```ts
it('PickItem injects failures with SIMULATION_MODE=true (probabilistic)', async () => {
  // Toggle SIMULATION_MODE to 'true' on the env directly via the repository.
  // (No dedicated property-update API endpoint; upsert through the repo is the path.)
  const env = testApp.environmentRepo.findByOid('env-warehouse-001')
  if (!env) throw new Error('warehouse env missing — Test 2 should have imported it')

  const patchedProps = env.action_property_specifications.map((spec) =>
    spec.name === 'SIMULATION_MODE'
      ? {
          ...spec,
          entries: spec.entries.map((e) => (e.name === 'Value' ? { ...e, value: 'true' } : e)),
        }
      : spec
  )

  testApp.environmentRepo.upsert({
    ...env,
    action_property_specifications: patchedProps,
  })

  // Verify the toggle took effect.
  const reloaded = testApp.environmentRepo.findByOid('env-warehouse-001')
  const simEntry = reloaded?.action_property_specifications
    .find((s) => s.name === 'SIMULATION_MODE')
    ?.entries.find((e) => e.name === 'Value')
  expect(simEntry?.value).toBe('true')

  let failureCount = 0
  let successCount = 0
  const ITERATIONS = 50

  for (let i = 0; i < ITERATIONS; i++) {
    const invokeRes = await fetch(
      `${testApp.serverUrl}/trajectory/v1/actions/act-wh-pick-001/invoke`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          environment_oid: 'env-warehouse-001',
          workflow_instance_id: `wf-sim-mode-${i}`,
          step_instance_id: `step-sim-${i}`,
          step_oid: `step-oid-sim-${i}`,
          input_parameters: [
            { name: 'shelf_location', value: 'BIN-A1' },
            { name: 'item_sku', value: 'SKU-1001' },
            { name: 'quantity', value: '1' },
          ],
        }),
      }
    )
    expect(invokeRes.status).toBe(201)
    const body = (await invokeRes.json()) as { data: { instance_id: string } }

    const terminal = await awaitTerminal(testApp.serverUrl, body.data.instance_id, 10_000)
    if (terminal.state === 'COMPLETED') successCount += 1
    else failureCount += 1
  }

  // Reset SIMULATION_MODE to 'false' so subsequent test runs aren't poisoned.
  // (vitest's `it` blocks share testApp via beforeAll; restoring state is good hygiene.)
  testApp.environmentRepo.upsert({
    ...env,
    action_property_specifications: env.action_property_specifications,
  })

  // At 10% failure rate over 50 trials, expected ~5 failures, sigma ~2.1.
  // Assert at least 1 and not all to confirm injection works without flaking.
  expect(failureCount, `failures=${failureCount} successes=${successCount}`).toBeGreaterThanOrEqual(
    1
  )
  expect(failureCount, `failures=${failureCount} successes=${successCount}`).toBeLessThan(
    ITERATIONS
  )
}, 180_000)
```

> The test sets a 180s vitest timeout. Expected runtime is ~60-90s (50 invocations × ~1s clean + ~5 failure cycles × ~3s for SIGKILL on observable timeout path). The margin handles slow CI.

> The `EnvironmentRepository.upsert` signature must match what the codebase expects. If the upsert API requires fields the test isn't passing (e.g., `last_modified_date`), pass them too — they're already in `env` from the `findByOid` read. If upsert returns errors instead of mutating, the test will fail at the verify step (Step 2) and you'll see the actual call signature.

- [ ] **Step 4: Run the integration test**

```
npm test -- packages/server/src/__tests__/scenario-warehouse.test.ts
```

Expected: 5/5 pass (4 existing + 1 new SIM-mode test). The probabilistic test should finish in 60-120s.

If the SIM-mode test fails at the upsert step, debug by reading the `EnvironmentRepository` source at `packages/storage/src/repositories/environment.repository.ts` to find the exact upsert signature.

If the SIM-mode test fails at the assertion (`failureCount >= 1` is false), the toggle isn't reaching Python. Add a `console.log` of `env.action_property_specifications` after the reload to verify the toggle landed in the DB.

- [ ] **Step 5: Run the full suite**

```
npm test
```

Expected: 1033 tests (1032 previous + 1 new). All passing.

- [ ] **Step 6: Commit**

```
git add packages/server/src/__tests__/scenario-warehouse.test.ts
git commit -m "test(scenarios): wave 3 assertions + SIMULATION_MODE=true probabilistic test"
```

---

## Task 5: Manual smoke + push

**Files:** none modified directly.

- [ ] **Step 1: Ensure dev server is up on :3002**

```
netstat -ano | findstr :3002
```

If nothing is listening: `npm run dev`.

- [ ] **Step 2: Re-deploy the warehouse**

```
npx tsx scripts/scenarios/cli.ts deploy warehouse --server http://localhost:3002
```

Expected: `actionsImported: 10, actionsFailed: [], timeoutsSet: 10`.

- [ ] **Step 3: Curl-invoke each wave-3 opaque action**

UpdateInventoryDB:

```bash
curl -X POST http://localhost:3002/trajectory/v1/actions/act-wh-updateinv-001/invoke \
  -H 'Content-Type: application/json' \
  -d '{
    "environment_oid": "env-warehouse-001",
    "workflow_instance_id": "wf-p4-inv",
    "step_instance_id": "step-inv",
    "step_oid": "step-oid-inv",
    "input_parameters": [
      { "name": "sku", "value": "SKU-1001" },
      { "name": "delta", "value": "1" }
    ]
  }'
```

Poll the returned instance_id. Expected: `state.current === 'COMPLETED'`, outputs `status: '0'`.

ScanBarcode: substitute oid `act-wh-scan-001`, single input `barcode: '0123456789012'`. Expected outputs: `sku: 'SKU-9012', status: '0'`.

PrintLabel: substitute oid `act-wh-print-001`, inputs `label_type: 'shelf'`, `content: 'BIN-A1'`. Expected outputs: `status: '0'`.

- [ ] **Step 4: Push**

```
git push origin master
```

- [ ] **Step 5: Optional fixup**

If smoke uncovered an issue, fix and commit:

```
git add <fixed files>
git commit -m "fix(scenarios): wave 3 manual-smoke followup"
git push origin master
```

---

## Summary of expected commits

1. `feat(scenarios): UpdateInventoryDB simulation-aware Python (wave 3 opaque)`
2. `feat(scenarios): ScanBarcode simulation-aware Python (wave 3 opaque)`
3. `feat(scenarios): PrintLabel simulation-aware Python (wave 3 opaque)`
4. `test(scenarios): wave 3 assertions + SIMULATION_MODE=true probabilistic test`
5. (optional) `fix(scenarios): wave 3 manual-smoke followup`
