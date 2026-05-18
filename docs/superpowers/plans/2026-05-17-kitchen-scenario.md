# Industrial Kitchen Test Scenario — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a 10-action "Industrial Kitchen" test scenario (4 observable + 6 opaque) under `scripts/scenarios/kitchen/`, hoist the shared `STATUS_OUTPUT` / state-list constants to a new `scripts/scenarios/lib/conventions.ts` so both scenarios import them, and pin behavior with a `scenario-kitchen.test.ts` integration test (~5 cases). No engine, protocol, or CLI changes.

**Architecture:** Mechanically a clone of the Warehouse scaffold (commit `8ac307f` and following). Each action's Python lives at `kitchen/code/<ActionName>/<STATE>.py`. Observable actions implement `STARTING` / `EXECUTING` / `COMPLETING` / `ABORTING`; opaque actions implement `IN_PROGRESS` / `ABORTING`. Build-time marker expansion (`scripts/scenarios/lib/build.ts`'s `expandSimDiceRoll()`) handles `# {{sim_dice_roll: observable}}` and `# {{sim_dice_roll: opaque, msg='…'}}` markers exactly as Warehouse does.

**Tech Stack:** TypeScript 5, tsx, vitest, Python 3 sidecar (existing — no version changes).

**Spec:** `docs/specs/2026-05-17-kitchen-scenario-design.md` (approved 2026-05-17).

---

## Conventions inherited from Warehouse (apply to every Python file below)

These patterns are not invented by this plan — they come from the existing Warehouse scenario (e.g., `scripts/scenarios/warehouse/code/PickItem/*.py`). Read them once; every task below uses them.

- **Observable STARTING.py:** permissive validation (print `WARN:` instead of raising on empty inputs), then `# {{sim_dice_roll: observable}}` as the last line. The dice roll's outputs flush to the engine when STARTING returns.
- **Observable EXECUTING.py:** read `outputs.get('status', '0')`. If `'1'`, `raise RuntimeError('<ActionName>: <failure context>')`. If `'2'`, `time.sleep(60)` to force the 3s engine timeout (worker is SIGKILLed; `status='2'` already persisted from STARTING). Clean path: `time.sleep(random.uniform(0.05, 0.15))` and return — does NOT write outputs (that's COMPLETING's job).
- **Observable COMPLETING.py:** write declared outputs from inputs; set `outputs['status']='0'`.
- **Observable ABORTING.py:** `pass` (with a comment block explaining the preserved status semantics). Status was set by STARTING; no need to overwrite.
- **Opaque IN_PROGRESS.py:** permissive validation, then `# {{sim_dice_roll: opaque, msg='<failure context>'}}` as the last non-clean-path line. The opaque marker both sets `status` AND raises in the same call. Clean path: brief sleep + write declared outputs + `outputs['status']='0'`.
- **Opaque ABORTING.py:** `pass` (with the same preserve-status comment block).

**Sleep distribution:** all Kitchen actions use `random.uniform(0.05, 0.15)` on the clean path EXCEPT `SimmerSauce`'s EXECUTING.py, which uses `random.uniform(1.8, 2.4)` (long-running observable showcase, stays under 3s timeout).

---

## File Structure

| File                                                                                     | Role                                                                                                              |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `scripts/scenarios/lib/conventions.ts`                                                   | **NEW.** Exported `STATUS_OUTPUT`, `OBSERVABLE_STATES`, `OPAQUE_STATES` — hoisted from `warehouse/definition.ts`. |
| `scripts/scenarios/warehouse/definition.ts`                                              | **EDIT.** Replace local constant declarations with imports from `../lib/conventions.js`.                          |
| `scripts/scenarios/kitchen/definition.ts`                                                | **NEW.** Library + environment + 10 action declarations.                                                          |
| `scripts/scenarios/kitchen/code/SearProtein/{STARTING,EXECUTING,COMPLETING,ABORTING}.py` | **NEW** ×4. Observable.                                                                                           |
| `scripts/scenarios/kitchen/code/SauteSides/{STARTING,EXECUTING,COMPLETING,ABORTING}.py`  | **NEW** ×4. Observable.                                                                                           |
| `scripts/scenarios/kitchen/code/SimmerSauce/{STARTING,EXECUTING,COMPLETING,ABORTING}.py` | **NEW** ×4. Observable, long-running EXECUTING.                                                                   |
| `scripts/scenarios/kitchen/code/PlateOrder/{STARTING,EXECUTING,COMPLETING,ABORTING}.py`  | **NEW** ×4. Observable.                                                                                           |
| `scripts/scenarios/kitchen/code/PrintKitchenTicket/{IN_PROGRESS,ABORTING}.py`            | **NEW** ×2. Opaque.                                                                                               |
| `scripts/scenarios/kitchen/code/PrepStation/{IN_PROGRESS,ABORTING}.py`                   | **NEW** ×2. Opaque (3-in / 3-out, biggest opaque).                                                                |
| `scripts/scenarios/kitchen/code/PreheatGrill/{IN_PROGRESS,ABORTING}.py`                  | **NEW** ×2. Opaque.                                                                                               |
| `scripts/scenarios/kitchen/code/GarnishPlate/{IN_PROGRESS,ABORTING}.py`                  | **NEW** ×2. Opaque (minimal).                                                                                     |
| `scripts/scenarios/kitchen/code/ExpoCheck/{IN_PROGRESS,ABORTING}.py`                     | **NEW** ×2. Opaque (single-input).                                                                                |
| `scripts/scenarios/kitchen/code/LogService/{IN_PROGRESS,ABORTING}.py`                    | **NEW** ×2. Opaque.                                                                                               |
| `scripts/scenarios/kitchen/README.md`                                                    | **NEW.** Manual walkthrough (mirror of `warehouse/README.md`).                                                    |
| `packages/server/src/__tests__/scenario-kitchen.test.ts`                                 | **NEW.** 5 integration test cases (mirror `scenario-warehouse.test.ts`).                                          |
| `.planning/STATE.md`                                                                     | **EDIT.** Record completion in the active arc.                                                                    |

**Python file count:** 4 obs × 4 states + 6 opq × 2 states = **28 `.py` files**.

---

## Phase A — Conventions hoist (Warehouse byte-identical)

### Task 1: Hoist `STATUS_OUTPUT` + state arrays to `lib/conventions.ts`

**Files:**

- Create: `scripts/scenarios/lib/conventions.ts`
- Modify: `scripts/scenarios/warehouse/definition.ts:1-15` (replace local constants with imports)

- [ ] **Step 1: Capture pre-refactor Warehouse build hash**

Run the existing Warehouse build and hash all output artifacts. Used as a regression baseline.

```bash
npx tsx scripts/scenarios/cli.ts build warehouse
cd scripts/scenarios/dist/warehouse
sha256sum WarehouseLibrary.WFenvir actions/*.WFactionCodeX > /tmp/warehouse-pre-hoist.sha256
cd ../../../..
cat /tmp/warehouse-pre-hoist.sha256
```

Expected: 11 hashes (1 `.WFenvir` + 10 `.WFactionCodeX`).

- [ ] **Step 2: Create `scripts/scenarios/lib/conventions.ts`**

```typescript
/**
 * conventions.ts — Shared constants for all scenarios.
 *
 * Hoisted from warehouse/definition.ts when kitchen/ was added (2026-05-17).
 * Both Warehouse and Kitchen import from here so the status output convention
 * and ISA-88 state lists stay in one place.
 */

import type { ParameterSpec } from './types.js'

export const STATUS_OUTPUT: ParameterSpec = {
  id: 'status',
  value_type: 'literal',
  default_value: '0',
  description: '0=success, 1=simulated abort, 2=simulated timeout',
}

export const OBSERVABLE_STATES = ['STARTING', 'EXECUTING', 'COMPLETING', 'ABORTING']
export const OPAQUE_STATES = ['IN_PROGRESS', 'ABORTING']
```

- [ ] **Step 3: Edit `warehouse/definition.ts` to import the hoisted constants**

Replace the top of `scripts/scenarios/warehouse/definition.ts` (lines ~1-15) — remove the three local constant declarations and add the import.

**Before** (lines 1-15):

```typescript
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ScenarioDefinition, ParameterSpec } from '../lib/types.js'

const rootDir = dirname(fileURLToPath(import.meta.url))

const STATUS_OUTPUT: ParameterSpec = {
  id: 'status',
  value_type: 'literal',
  default_value: '0',
  description: '0=success, 1=simulated abort, 2=simulated timeout',
}

const OBSERVABLE_STATES = ['STARTING', 'EXECUTING', 'COMPLETING', 'ABORTING']
const OPAQUE_STATES = ['IN_PROGRESS', 'ABORTING']
```

**After:**

```typescript
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ScenarioDefinition } from '../lib/types.js'
import { STATUS_OUTPUT, OBSERVABLE_STATES, OPAQUE_STATES } from '../lib/conventions.js'

const rootDir = dirname(fileURLToPath(import.meta.url))
```

Note: `ParameterSpec` is no longer imported from `types.js` here (only `STATUS_OUTPUT` used it locally). If TypeScript complains about other uses, restore the import.

- [ ] **Step 4: Type-check + run Warehouse test file**

```bash
npm run build                                                              # confirms tsc clean
npx vitest run packages/server/src/__tests__/scenario-warehouse.test.ts
```

Expected: build green, scenario-warehouse.test.ts all 5 cases green.

- [ ] **Step 5: Rebuild Warehouse + verify byte-identical**

```bash
rm -rf scripts/scenarios/dist/warehouse
npx tsx scripts/scenarios/cli.ts build warehouse
cd scripts/scenarios/dist/warehouse
sha256sum WarehouseLibrary.WFenvir actions/*.WFactionCodeX > /tmp/warehouse-post-hoist.sha256
diff /tmp/warehouse-pre-hoist.sha256 /tmp/warehouse-post-hoist.sha256
cd ../../../..
```

Expected: `diff` produces **no output** (artifacts byte-identical). If diff shows a mismatch, the refactor leaked a behavior change — DO NOT proceed; investigate.

- [ ] **Step 6: Commit**

```bash
git add scripts/scenarios/lib/conventions.ts scripts/scenarios/warehouse/definition.ts
git commit -m "refactor(scenarios): hoist STATUS_OUTPUT + state arrays to lib/conventions

Preparing for the kitchen scenario (2nd test environment) which uses
the same constants. Warehouse build artifacts verified byte-identical
pre/post hoist via sha256 diff."
```

---

## Phase B — Kitchen scaffold

### Task 2: `kitchen/definition.ts`

**Files:**

- Create: `scripts/scenarios/kitchen/definition.ts`

- [ ] **Step 1: Create the directory + file**

```bash
mkdir -p scripts/scenarios/kitchen
```

Create `scripts/scenarios/kitchen/definition.ts` with the full content:

```typescript
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ScenarioDefinition } from '../lib/types.js'
import { STATUS_OUTPUT, OBSERVABLE_STATES, OPAQUE_STATES } from '../lib/conventions.js'

const rootDir = dirname(fileURLToPath(import.meta.url))

export const scenario: ScenarioDefinition = {
  rootDir,
  library: {
    oid: 'lib-kitchen-001',
    local_id: 'KitchenLibrary',
    version: '1.0.0',
  },
  environment: {
    oid: 'env-kitchen-001',
    local_id: 'IndustrialKitchen',
    version: '1.0.0',
    schemaVersion: '4.0',
    description:
      'Industrial kitchen simulation: single-order lifecycle from ticket-arrival through service. 10 actions (4 observable + 6 opaque) with SIMULATION_MODE failure injection.',
    action_property_specifications: [
      {
        name: 'SIMULATION_MODE',
        entries: [
          { name: 'Value', value: 'false' },
          {
            name: 'Description',
            value: 'When "true", actions inject random failures (~10% per execution)',
          },
        ],
      },
    ],
    value_property_specifications: [],
    resource_property_specifications: [],
  },
  actions: [
    // ────────────── Observable (4) ──────────────
    {
      oid: 'act-kt-sear-001',
      local_id: 'SearProtein',
      version: '1.0.0',
      visibility: 'observable',
      description: 'Sear a protein on the flat top to a target internal temperature',
      inputs: [
        { id: 'protein', value_type: 'literal', default_value: 'ribeye' },
        { id: 'side', value_type: 'literal', default_value: 'first' },
        { id: 'target_internal_c', value_type: 'literal', default_value: '54' },
      ],
      outputs: [
        { id: 'internal_temp_c', value_type: 'literal', default_value: '0' },
        { id: 'sear_score', value_type: 'literal', default_value: '' },
        STATUS_OUTPUT,
      ],
      code_states: OBSERVABLE_STATES,
      timeout_seconds: 3,
    },
    {
      oid: 'act-kt-saute-001',
      local_id: 'SauteSides',
      version: '1.0.0',
      visibility: 'observable',
      description: 'Sauté a vegetable side at a controlled heat level',
      inputs: [
        { id: 'pan_id', value_type: 'literal', default_value: 'PAN-3' },
        { id: 'vegetable', value_type: 'literal', default_value: 'asparagus' },
        { id: 'heat_level', value_type: 'literal', default_value: 'medium-high' },
      ],
      outputs: [{ id: 'doneness', value_type: 'literal', default_value: '' }, STATUS_OUTPUT],
      code_states: OBSERVABLE_STATES,
      timeout_seconds: 3,
    },
    {
      oid: 'act-kt-simmer-001',
      local_id: 'SimmerSauce',
      version: '1.0.0',
      visibility: 'observable',
      description: 'Reduce a sauce base to a target reduction percentage',
      inputs: [
        { id: 'pot_id', value_type: 'literal', default_value: 'POT-2' },
        { id: 'sauce_base', value_type: 'literal', default_value: 'jus' },
        { id: 'reduction_target_pct', value_type: 'literal', default_value: '40' },
      ],
      outputs: [
        { id: 'final_reduction_pct', value_type: 'literal', default_value: '0' },
        STATUS_OUTPUT,
      ],
      code_states: OBSERVABLE_STATES,
      timeout_seconds: 3,
    },
    {
      oid: 'act-kt-plate-001',
      local_id: 'PlateOrder',
      version: '1.0.0',
      visibility: 'observable',
      description: 'Compose the plate from cooked components',
      inputs: [
        { id: 'order_id', value_type: 'literal', default_value: 'ORD-7001' },
        { id: 'plate_id', value_type: 'literal', default_value: 'PLT-1' },
        { id: 'components', value_type: 'literal', default_value: 'protein+sides+sauce' },
      ],
      outputs: [{ id: 'plated_at', value_type: 'literal', default_value: '' }, STATUS_OUTPUT],
      code_states: OBSERVABLE_STATES,
      timeout_seconds: 3,
    },
    // ────────────── Opaque (6) ──────────────
    {
      oid: 'act-kt-ticket-001',
      local_id: 'PrintKitchenTicket',
      version: '1.0.0',
      visibility: 'opaque',
      description: 'Print the kitchen ticket for an incoming order',
      inputs: [
        { id: 'ticket_id', value_type: 'literal', default_value: 'TKT-7001' },
        { id: 'order_summary', value_type: 'literal', default_value: 'pasta-special-1x' },
      ],
      outputs: [STATUS_OUTPUT],
      code_states: OPAQUE_STATES,
      timeout_seconds: 3,
    },
    {
      oid: 'act-kt-prep-001',
      local_id: 'PrepStation',
      version: '1.0.0',
      visibility: 'opaque',
      description: 'Mise en place — portion and prep an ingredient',
      inputs: [
        { id: 'ingredient', value_type: 'literal', default_value: 'shallots' },
        { id: 'quantity_grams', value_type: 'literal', default_value: '120' },
        { id: 'cut_style', value_type: 'literal', default_value: 'brunoise' },
      ],
      outputs: [
        { id: 'portions_ready', value_type: 'literal', default_value: '0' },
        { id: 'prep_notes', value_type: 'literal', default_value: '' },
        STATUS_OUTPUT,
      ],
      code_states: OPAQUE_STATES,
      timeout_seconds: 3,
    },
    {
      oid: 'act-kt-preheat-001',
      local_id: 'PreheatGrill',
      version: '1.0.0',
      visibility: 'opaque',
      description: 'Set the grill to a target temperature',
      inputs: [
        { id: 'grill_id', value_type: 'literal', default_value: 'GRILL-1' },
        { id: 'target_temp_c', value_type: 'literal', default_value: '200' },
      ],
      outputs: [STATUS_OUTPUT],
      code_states: OPAQUE_STATES,
      timeout_seconds: 3,
    },
    {
      oid: 'act-kt-garnish-001',
      local_id: 'GarnishPlate',
      version: '1.0.0',
      visibility: 'opaque',
      description: 'Apply garnish to a plated order',
      inputs: [
        { id: 'plate_id', value_type: 'literal', default_value: 'PLT-1' },
        { id: 'garnish', value_type: 'literal', default_value: 'chive' },
      ],
      outputs: [STATUS_OUTPUT],
      code_states: OPAQUE_STATES,
      timeout_seconds: 3,
    },
    {
      oid: 'act-kt-expo-001',
      local_id: 'ExpoCheck',
      version: '1.0.0',
      visibility: 'opaque',
      description: 'Expediter inspection of a plated order',
      inputs: [{ id: 'ticket_id', value_type: 'literal', default_value: 'TKT-7001' }],
      outputs: [{ id: 'verdict', value_type: 'literal', default_value: '' }, STATUS_OUTPUT],
      code_states: OPAQUE_STATES,
      timeout_seconds: 3,
    },
    {
      oid: 'act-kt-log-001',
      local_id: 'LogService',
      version: '1.0.0',
      visibility: 'opaque',
      description: 'Record service completion in the kitchen audit log',
      inputs: [
        { id: 'order_id', value_type: 'literal', default_value: 'ORD-7001' },
        { id: 'table_id', value_type: 'literal', default_value: 'TBL-12' },
      ],
      outputs: [STATUS_OUTPUT],
      code_states: OPAQUE_STATES,
      timeout_seconds: 3,
    },
  ],
}
```

- [ ] **Step 2: Type-check**

```bash
npm run build
```

Expected: tsc clean (no errors). Don't run vitest yet — there are no .py files, so any build attempt would fail at the file-read step.

- [ ] **Step 3: Commit**

```bash
git add scripts/scenarios/kitchen/definition.ts
git commit -m "feat(scenarios): kitchen scenario definition (10 actions, 4 obs + 6 opq)

Scaffold-only commit: no Python files yet, so build/upload not yet
runnable. Subsequent tasks add per-action Python under code/<Name>/."
```

---

### Task 3: `SearProtein` Python (observable)

**Files:**

- Create: `scripts/scenarios/kitchen/code/SearProtein/STARTING.py`
- Create: `scripts/scenarios/kitchen/code/SearProtein/EXECUTING.py`
- Create: `scripts/scenarios/kitchen/code/SearProtein/COMPLETING.py`
- Create: `scripts/scenarios/kitchen/code/SearProtein/ABORTING.py`

- [ ] **Step 1: Create the directory**

```bash
mkdir -p scripts/scenarios/kitchen/code/SearProtein
```

- [ ] **Step 2: Create `STARTING.py`**

```python
import random


def execute(inputs, outputs, props, action_props):
    if not str(inputs.get('protein', '')).strip():
        print('WARN: SearProtein STARTING: protein is empty')
    if not str(inputs.get('target_internal_c', '')).strip():
        print('WARN: SearProtein STARTING: target_internal_c is empty')

    # Simulation outcome dice roll. Decision flushes to the engine when this
    # function returns, so EXECUTING (and ABORTING after a kill) see the final value.
    # {{sim_dice_roll: observable}}
```

- [ ] **Step 3: Create `EXECUTING.py`**

```python
import random
import time


def execute(inputs, outputs, props, action_props):
    status = outputs.get('status', '0')
    if status == '1':
        raise RuntimeError('SearProtein: pan overheated')
    if status == '2':
        # Sleep past the 3s action timeout. Engine SIGKILLs the worker; status='2'
        # is already persisted from STARTING.
        time.sleep(60)
        return
    # Clean path: simulate the active sear.
    time.sleep(random.uniform(0.05, 0.15))
```

- [ ] **Step 4: Create `COMPLETING.py`**

```python
def execute(inputs, outputs, props, action_props):
    target = str(inputs.get('target_internal_c', '0'))
    outputs['internal_temp_c'] = target
    outputs['sear_score'] = 'good'
    outputs['status'] = '0'
```

- [ ] **Step 5: Create `ABORTING.py`**

```python
def execute(inputs, outputs, props, action_props):
    # Preserve status set by STARTING:
    #   0 → manual abort (user sent ABORT command during a clean run)
    #   1 → simulated random abort
    #   2 → simulated timeout
    pass
```

- [ ] **Step 6: Commit**

```bash
git add scripts/scenarios/kitchen/code/SearProtein/
git commit -m "feat(scenarios): kitchen SearProtein observable code"
```

---

### Task 4: `SauteSides` Python (observable)

**Files:**

- Create: `scripts/scenarios/kitchen/code/SauteSides/{STARTING,EXECUTING,COMPLETING,ABORTING}.py`

- [ ] **Step 1: Create the directory**

```bash
mkdir -p scripts/scenarios/kitchen/code/SauteSides
```

- [ ] **Step 2: Create `STARTING.py`**

```python
import random


def execute(inputs, outputs, props, action_props):
    if not str(inputs.get('pan_id', '')).strip():
        print('WARN: SauteSides STARTING: pan_id is empty')
    if not str(inputs.get('vegetable', '')).strip():
        print('WARN: SauteSides STARTING: vegetable is empty')

    # {{sim_dice_roll: observable}}
```

- [ ] **Step 3: Create `EXECUTING.py`**

```python
import random
import time


def execute(inputs, outputs, props, action_props):
    status = outputs.get('status', '0')
    if status == '1':
        raise RuntimeError('SauteSides: vegetables burned')
    if status == '2':
        time.sleep(60)
        return
    time.sleep(random.uniform(0.05, 0.15))
```

- [ ] **Step 4: Create `COMPLETING.py`**

```python
def execute(inputs, outputs, props, action_props):
    outputs['doneness'] = 'crisp-tender'
    outputs['status'] = '0'
```

- [ ] **Step 5: Create `ABORTING.py`**

```python
def execute(inputs, outputs, props, action_props):
    # Preserve status set by STARTING (0 manual / 1 sim abort / 2 sim timeout).
    pass
```

- [ ] **Step 6: Commit**

```bash
git add scripts/scenarios/kitchen/code/SauteSides/
git commit -m "feat(scenarios): kitchen SauteSides observable code"
```

---

### Task 5: `SimmerSauce` Python (observable, long-running)

**Files:**

- Create: `scripts/scenarios/kitchen/code/SimmerSauce/{STARTING,EXECUTING,COMPLETING,ABORTING}.py`

Note: `EXECUTING.py` sleeps `random.uniform(1.8, 2.4)` on the clean path (longer than other actions, but under the 3s timeout). This is the canonical long-running observable for pause/resume demos.

- [ ] **Step 1: Create the directory**

```bash
mkdir -p scripts/scenarios/kitchen/code/SimmerSauce
```

- [ ] **Step 2: Create `STARTING.py`**

```python
import random


def execute(inputs, outputs, props, action_props):
    if not str(inputs.get('pot_id', '')).strip():
        print('WARN: SimmerSauce STARTING: pot_id is empty')
    if not str(inputs.get('sauce_base', '')).strip():
        print('WARN: SimmerSauce STARTING: sauce_base is empty')

    # {{sim_dice_roll: observable}}
```

- [ ] **Step 3: Create `EXECUTING.py` (long-running clean path)**

```python
import random
import time


def execute(inputs, outputs, props, action_props):
    status = outputs.get('status', '0')
    if status == '1':
        raise RuntimeError('SimmerSauce: sauce broke / curdled')
    if status == '2':
        time.sleep(60)
        return
    # Long-running clean path: ~2 seconds (stays under 3s timeout, leaves room
    # for pause/resume demos from the tester UI).
    time.sleep(random.uniform(1.8, 2.4))
```

- [ ] **Step 4: Create `COMPLETING.py`**

```python
def execute(inputs, outputs, props, action_props):
    target = str(inputs.get('reduction_target_pct', '0'))
    outputs['final_reduction_pct'] = target
    outputs['status'] = '0'
```

- [ ] **Step 5: Create `ABORTING.py`**

```python
def execute(inputs, outputs, props, action_props):
    pass
```

- [ ] **Step 6: Commit**

```bash
git add scripts/scenarios/kitchen/code/SimmerSauce/
git commit -m "feat(scenarios): kitchen SimmerSauce observable code (long-running)"
```

---

### Task 6: `PlateOrder` Python (observable)

**Files:**

- Create: `scripts/scenarios/kitchen/code/PlateOrder/{STARTING,EXECUTING,COMPLETING,ABORTING}.py`

- [ ] **Step 1: Create the directory**

```bash
mkdir -p scripts/scenarios/kitchen/code/PlateOrder
```

- [ ] **Step 2: Create `STARTING.py`**

```python
import random


def execute(inputs, outputs, props, action_props):
    if not str(inputs.get('order_id', '')).strip():
        print('WARN: PlateOrder STARTING: order_id is empty')
    if not str(inputs.get('plate_id', '')).strip():
        print('WARN: PlateOrder STARTING: plate_id is empty')

    # {{sim_dice_roll: observable}}
```

- [ ] **Step 3: Create `EXECUTING.py`**

```python
import random
import time


def execute(inputs, outputs, props, action_props):
    status = outputs.get('status', '0')
    if status == '1':
        raise RuntimeError('PlateOrder: dropped plate')
    if status == '2':
        time.sleep(60)
        return
    time.sleep(random.uniform(0.05, 0.15))
```

- [ ] **Step 4: Create `COMPLETING.py`**

```python
from datetime import datetime, timezone


def execute(inputs, outputs, props, action_props):
    outputs['plated_at'] = datetime.now(timezone.utc).isoformat()
    outputs['status'] = '0'
```

- [ ] **Step 5: Create `ABORTING.py`**

```python
def execute(inputs, outputs, props, action_props):
    pass
```

- [ ] **Step 6: Commit**

```bash
git add scripts/scenarios/kitchen/code/PlateOrder/
git commit -m "feat(scenarios): kitchen PlateOrder observable code"
```

---

### Task 7: `PrintKitchenTicket` Python (opaque)

**Files:**

- Create: `scripts/scenarios/kitchen/code/PrintKitchenTicket/{IN_PROGRESS,ABORTING}.py`

- [ ] **Step 1: Create the directory**

```bash
mkdir -p scripts/scenarios/kitchen/code/PrintKitchenTicket
```

- [ ] **Step 2: Create `IN_PROGRESS.py`**

```python
import random
import time


def execute(inputs, outputs, props, action_props):
    if not str(inputs.get('ticket_id', '')).strip():
        print('WARN: PrintKitchenTicket IN_PROGRESS: ticket_id is empty')
    if not str(inputs.get('order_summary', '')).strip():
        print('WARN: PrintKitchenTicket IN_PROGRESS: order_summary is empty')

    # {{sim_dice_roll: opaque, msg='printer offline'}}

    # Clean path: brief print job.
    time.sleep(random.uniform(0.05, 0.15))
    outputs['status'] = '0'
```

- [ ] **Step 3: Create `ABORTING.py`**

```python
def execute(inputs, outputs, props, action_props):
    # Preserve status set by IN_PROGRESS:
    #   0 → manual abort
    #   1 → simulated random abort
    pass
```

- [ ] **Step 4: Commit**

```bash
git add scripts/scenarios/kitchen/code/PrintKitchenTicket/
git commit -m "feat(scenarios): kitchen PrintKitchenTicket opaque code"
```

---

### Task 8: `PrepStation` Python (opaque, 3-in / 3-out)

**Files:**

- Create: `scripts/scenarios/kitchen/code/PrepStation/{IN_PROGRESS,ABORTING}.py`

- [ ] **Step 1: Create the directory**

```bash
mkdir -p scripts/scenarios/kitchen/code/PrepStation
```

- [ ] **Step 2: Create `IN_PROGRESS.py`**

```python
import random
import time


def execute(inputs, outputs, props, action_props):
    if not str(inputs.get('ingredient', '')).strip():
        print('WARN: PrepStation IN_PROGRESS: ingredient is empty')
    if not str(inputs.get('quantity_grams', '')).strip():
        print('WARN: PrepStation IN_PROGRESS: quantity_grams is empty')

    # {{sim_dice_roll: opaque, msg='ingredient spoilage detected'}}

    # Clean path: portion the ingredient.
    time.sleep(random.uniform(0.05, 0.15))
    ingredient = str(inputs.get('ingredient', ''))
    cut_style = str(inputs.get('cut_style', ''))
    quantity_str = str(inputs.get('quantity_grams', '0'))
    try:
        portions = max(1, int(quantity_str) // 30)
    except ValueError:
        portions = 1
    outputs['portions_ready'] = str(portions)
    outputs['prep_notes'] = f'{cut_style} on {ingredient}' if cut_style else ingredient
    outputs['status'] = '0'
```

- [ ] **Step 3: Create `ABORTING.py`**

```python
def execute(inputs, outputs, props, action_props):
    pass
```

- [ ] **Step 4: Commit**

```bash
git add scripts/scenarios/kitchen/code/PrepStation/
git commit -m "feat(scenarios): kitchen PrepStation opaque code (3-in / 3-out)"
```

---

### Task 9: `PreheatGrill` Python (opaque)

**Files:**

- Create: `scripts/scenarios/kitchen/code/PreheatGrill/{IN_PROGRESS,ABORTING}.py`

- [ ] **Step 1: Create the directory**

```bash
mkdir -p scripts/scenarios/kitchen/code/PreheatGrill
```

- [ ] **Step 2: Create `IN_PROGRESS.py`**

```python
import random
import time


def execute(inputs, outputs, props, action_props):
    if not str(inputs.get('grill_id', '')).strip():
        print('WARN: PreheatGrill IN_PROGRESS: grill_id is empty')

    # {{sim_dice_roll: opaque, msg='igniter failed'}}

    time.sleep(random.uniform(0.05, 0.15))
    outputs['status'] = '0'
```

- [ ] **Step 3: Create `ABORTING.py`**

```python
def execute(inputs, outputs, props, action_props):
    pass
```

- [ ] **Step 4: Commit**

```bash
git add scripts/scenarios/kitchen/code/PreheatGrill/
git commit -m "feat(scenarios): kitchen PreheatGrill opaque code"
```

---

### Task 10: `GarnishPlate` Python (opaque, minimal)

**Files:**

- Create: `scripts/scenarios/kitchen/code/GarnishPlate/{IN_PROGRESS,ABORTING}.py`

- [ ] **Step 1: Create the directory**

```bash
mkdir -p scripts/scenarios/kitchen/code/GarnishPlate
```

- [ ] **Step 2: Create `IN_PROGRESS.py`**

```python
import random
import time


def execute(inputs, outputs, props, action_props):
    if not str(inputs.get('plate_id', '')).strip():
        print('WARN: GarnishPlate IN_PROGRESS: plate_id is empty')

    # {{sim_dice_roll: opaque, msg='garnish out of stock'}}

    time.sleep(random.uniform(0.05, 0.15))
    outputs['status'] = '0'
```

- [ ] **Step 3: Create `ABORTING.py`**

```python
def execute(inputs, outputs, props, action_props):
    pass
```

- [ ] **Step 4: Commit**

```bash
git add scripts/scenarios/kitchen/code/GarnishPlate/
git commit -m "feat(scenarios): kitchen GarnishPlate opaque code (minimal)"
```

---

### Task 11: `ExpoCheck` Python (opaque, single-input)

**Files:**

- Create: `scripts/scenarios/kitchen/code/ExpoCheck/{IN_PROGRESS,ABORTING}.py`

- [ ] **Step 1: Create the directory**

```bash
mkdir -p scripts/scenarios/kitchen/code/ExpoCheck
```

- [ ] **Step 2: Create `IN_PROGRESS.py`**

```python
import random
import time


def execute(inputs, outputs, props, action_props):
    if not str(inputs.get('ticket_id', '')).strip():
        print('WARN: ExpoCheck IN_PROGRESS: ticket_id is empty')

    # {{sim_dice_roll: opaque, msg='plate rejected by expediter'}}

    # Clean path: plate passes inspection.
    time.sleep(random.uniform(0.05, 0.15))
    outputs['verdict'] = 'pass'
    outputs['status'] = '0'
```

- [ ] **Step 3: Create `ABORTING.py`**

```python
def execute(inputs, outputs, props, action_props):
    pass
```

- [ ] **Step 4: Commit**

```bash
git add scripts/scenarios/kitchen/code/ExpoCheck/
git commit -m "feat(scenarios): kitchen ExpoCheck opaque code (single-input)"
```

---

### Task 12: `LogService` Python (opaque)

**Files:**

- Create: `scripts/scenarios/kitchen/code/LogService/{IN_PROGRESS,ABORTING}.py`

- [ ] **Step 1: Create the directory**

```bash
mkdir -p scripts/scenarios/kitchen/code/LogService
```

- [ ] **Step 2: Create `IN_PROGRESS.py`**

```python
import random
import time


def execute(inputs, outputs, props, action_props):
    if not str(inputs.get('order_id', '')).strip():
        print('WARN: LogService IN_PROGRESS: order_id is empty')

    # {{sim_dice_roll: opaque, msg='POS sync timeout'}}

    time.sleep(random.uniform(0.05, 0.15))
    outputs['status'] = '0'
```

- [ ] **Step 3: Create `ABORTING.py`**

```python
def execute(inputs, outputs, props, action_props):
    pass
```

- [ ] **Step 4: Commit**

```bash
git add scripts/scenarios/kitchen/code/LogService/
git commit -m "feat(scenarios): kitchen LogService opaque code"
```

---

### Task 13: Build verification (smoke check before tests)

**Files:** None (verification only).

- [ ] **Step 1: Build the Kitchen scenario**

```bash
rm -rf scripts/scenarios/dist/kitchen
npx tsx scripts/scenarios/cli.ts build kitchen
```

Expected output: build completes without error. Shows paths to `dist/kitchen/KitchenLibrary.WFenvir` and 10 entries under `dist/kitchen/actions/*.WFactionCodeX`.

- [ ] **Step 2: Verify artifact counts**

```bash
ls scripts/scenarios/dist/kitchen/KitchenLibrary.WFenvir
ls scripts/scenarios/dist/kitchen/actions/ | wc -l
ls scripts/scenarios/dist/kitchen/code/ | wc -l
```

Expected: `KitchenLibrary.WFenvir` exists; `actions/` contains 10 files; `code/` contains 10 directories.

- [ ] **Step 3: Spot-check one expanded Python file**

```bash
cat scripts/scenarios/dist/kitchen/code/SearProtein/STARTING.py
```

Expected: the `# {{sim_dice_roll: observable}}` marker has been expanded into the actual `sim = (...)`/`if sim and random.random() < 0.10:` block.

```bash
cat scripts/scenarios/dist/kitchen/code/PrintKitchenTicket/IN_PROGRESS.py
```

Expected: the `# {{sim_dice_roll: opaque, msg='printer offline'}}` marker has been expanded into the `sim = (...)` block PLUS a `raise RuntimeError(f'PrintKitchenTicket: simulated random {mode} (printer offline)')`.

No commit — this is a verification-only step. If anything fails, return to the relevant per-action task and fix.

---

## Phase C — Integration test

### Task 14: `scenario-kitchen.test.ts`

**Files:**

- Create: `packages/server/src/__tests__/scenario-kitchen.test.ts`

Direct port of `packages/server/src/__tests__/scenario-warehouse.test.ts` (~270 LOC). Use the Warehouse file as a copy-and-edit base.

- [ ] **Step 1: Copy the Warehouse test as a starting point**

```bash
cp packages/server/src/__tests__/scenario-warehouse.test.ts packages/server/src/__tests__/scenario-kitchen.test.ts
```

- [ ] **Step 2: Edit imports + scenario reference**

In `scenario-kitchen.test.ts`, replace the warehouse-specific imports:

**Before:**

```typescript
import { scenario as warehouseScenario } from '../../../../scripts/scenarios/warehouse/definition.js'
```

**After:**

```typescript
import { scenario as kitchenScenario } from '../../../../scripts/scenarios/kitchen/definition.js'
```

Then find-and-replace every occurrence of `warehouseScenario` → `kitchenScenario` throughout the file.

- [ ] **Step 3: Edit the env OID + library OID + counts**

The file currently asserts on Warehouse identifiers. Update them:

- `env-warehouse-001` → `env-kitchen-001`
- `lib-warehouse-001` → `lib-kitchen-001`
- `AutomatedWarehouse` (local_id) → `IndustrialKitchen`
- `WarehouseLibrary.WFenvir` (artifact filename) → `KitchenLibrary.WFenvir`

If the test file has an action-count assertion (e.g., `expect(actions).toHaveLength(10)`), 10 is still correct (Kitchen also has 10 actions).

- [ ] **Step 4: Update the action loop**

Locate the test case `'invokes each action with SIMULATION_MODE=false and gets status=0'`. The action list it iterates should be Kitchen's 10 OIDs:

```typescript
const KITCHEN_ACTIONS = [
  'act-kt-sear-001',
  'act-kt-saute-001',
  'act-kt-simmer-001',
  'act-kt-plate-001',
  'act-kt-ticket-001',
  'act-kt-prep-001',
  'act-kt-preheat-001',
  'act-kt-garnish-001',
  'act-kt-expo-001',
  'act-kt-log-001',
]
```

If Warehouse's test had a hardcoded list, replace it. If it derives from `warehouseScenario.actions`, change to `kitchenScenario.actions` and no list is needed.

- [ ] **Step 5: Update the failure-injection test**

The Warehouse test injects failures on `act-wh-pick-001` (PickItem). For Kitchen, switch to **`SearProtein`** (`act-kt-sear-001`) — keeps per-trial latency short. Find the test case `'PickItem injects failures with SIMULATION_MODE=true (probabilistic)'` and rename to `'SearProtein injects failures with SIMULATION_MODE=true (probabilistic)'`. Change the action OID accordingly.

If the test inspects specific error messages (e.g., "Crane obstruction"), update to the Kitchen failure narrative ("pan overheated" — but the test should ideally not pin the exact message, just check `status='1'` exists across N=50 trials).

- [ ] **Step 6: Update the SimmerSauce timeout (if test sets one)**

The Warehouse test's failure-injection test uses N=50 trials. Each trial waits for the action to reach terminal. With Kitchen's tighter sleep distribution (0.05–0.15s vs Warehouse's 0.5–1.5s), trials are faster. Test timeout (the third arg to `it(...)`) can stay at the same value (~120000ms) — it's an upper bound.

- [ ] **Step 7: Run the new test file in isolation**

```bash
npx vitest run packages/server/src/__tests__/scenario-kitchen.test.ts
```

Expected: 5 test cases, all pass. The full file should take ~30-60s (Kitchen sleeps are tighter than Warehouse's ~120s).

If any test fails, check:

- Are all 28 .py files in place? (`ls scripts/scenarios/kitchen/code/*/*.py | wc -l` should be 28.)
- Does the build artifact exist with correct names? (Re-run `npx tsx scripts/scenarios/cli.ts build kitchen` and inspect `dist/kitchen/`.)
- Did the find-and-replace miss any `warehouse`/`Warehouse` strings?

- [ ] **Step 8: Run the full TrajectoryActions test suite**

```bash
npx vitest run
```

Expected: **1067 tests pass** (was 1062, +5 from `scenario-kitchen.test.ts`). 48 test files pass (was 47). No regressions.

- [ ] **Step 9: Commit**

```bash
git add packages/server/src/__tests__/scenario-kitchen.test.ts
git commit -m "test(scenarios): scenario-kitchen integration coverage

Mirrors scenario-warehouse.test.ts: build artifacts, bulk upload,
per-action upload, all 10 actions invoke clean with SIM off, and
SearProtein injects failures with SIM on (N=50 probabilistic).

Tests: 1062 → 1067; test files 47 → 48."
```

---

## Phase D — Polish & validation

### Task 15: `kitchen/README.md`

**Files:**

- Create: `scripts/scenarios/kitchen/README.md`

Mirror `scripts/scenarios/warehouse/README.md`'s structure (manual walkthrough — build, deploy, what to see in the console, how to invoke via curl, per-action iteration loop, failure-mode notes). Concrete content below.

- [ ] **Step 1: Create the README**

````markdown
# Industrial Kitchen Test Scenario — Manual Walkthrough

A self-contained scenario with 10 actions (4 observable + 6 opaque) modelling a
commercial kitchen's single-order lifecycle: ticket → prep → cook → plate → serve.
Includes a `SIMULATION_MODE` toggle for failure injection (10% per execution).

## Build + deploy

```bash
# 1. Start the dev stack (server on :3002, console on :5176)
npm run dev

# 2. In another terminal, build + deploy the scenario
npx tsx scripts/scenarios/cli.ts deploy kitchen --server http://localhost:3002
```
````

`deploy` builds the artifacts under `scripts/scenarios/dist/kitchen/` and uploads
each action via the per-action `.WFactionCodeX` path.

## What you should see in the console

1. Navigate to `http://localhost:5176/`.
2. Open **Explorer** → expand `IndustrialKitchen` — all 10 actions appear.
3. Click `SearProtein`. The right pane shows:
   - Input Parameters: `protein`, `side`, `target_internal_c`
   - Output Parameters: `internal_temp_c`, `sear_score`, `status`
   - Action Properties (none on this action)
   - Execution Settings: timeout = 3 seconds
4. The center pane shows the Code Status table — `STARTING`, `EXECUTING`,
   `COMPLETING`, `ABORTING` all show `active`.

## Invoke an action

```bash
curl -X POST http://localhost:3002/trajectory/v1/actions/act-kt-sear-001/invoke \
  -H 'Content-Type: application/json' \
  -d '{
    "environment_oid": "env-kitchen-001",
    "workflow_instance_id": "wf-manual-test",
    "step_instance_id": "step-manual",
    "step_oid": "step-oid-manual",
    "input_parameters": [
      { "name": "protein", "value": "ribeye" },
      { "name": "side", "value": "first" },
      { "name": "target_internal_c", "value": "54" }
    ]
  }'
```

Expected: `state: "COMPLETED"`, `outputs.status: "0"`, `outputs.internal_temp_c: "54"`,
`outputs.sear_score: "good"`.

## Failure-mode notes

When `SIMULATION_MODE` is set to `true` (via env property on the environment),
each action has a ~10% chance of injecting a failure. Watch for:

- Opaque actions (e.g., `PrintKitchenTicket`) on failure: ABORTED instance shows
  `outputs.status='1'` AND the error message (`'PrintKitchenTicket: simulated
random abort (printer offline)'`). The `status` being preserved here depends
  on commit `e2b3eef` (sandbox outputs-on-raise fix) shipped 2026-05-17.
- Observable actions on failure: ABORTED instance shows `outputs.status='1'` or
  `'2'`. Status was set during STARTING (before EXECUTING raised), so it's
  visible regardless of the fix.

## Per-action iteration loop

Edited `scripts/scenarios/kitchen/code/SimmerSauce/EXECUTING.py`?

```bash
npx tsx scripts/scenarios/cli.ts build kitchen
npx tsx scripts/scenarios/cli.ts upload-action \
  scripts/scenarios/dist/kitchen/actions/SimmerSauce.WFactionCodeX
```

Server upserts the action (idempotent) and saves+activates the new code version.

## Action inventory

| #   | Action               | Visibility | Notable                                          |
| --- | -------------------- | ---------- | ------------------------------------------------ |
| 1   | `SearProtein`        | observable | 3-in / 3-out, dice roll on STARTING              |
| 2   | `SauteSides`         | observable | 3-in / 2-out                                     |
| 3   | `SimmerSauce`        | observable | long-running (~2s) — best for pause/resume demos |
| 4   | `PlateOrder`         | observable | sets `plated_at` ISO timestamp                   |
| 5   | `PrintKitchenTicket` | opaque     | status-only output                               |
| 6   | `PrepStation`        | opaque     | 3-in / 3-out — opaque ≠ status-only              |
| 7   | `PreheatGrill`       | opaque     | status-only                                      |
| 8   | `GarnishPlate`       | opaque     | minimal action (2-in / 1-out)                    |
| 9   | `ExpoCheck`          | opaque     | single-input                                     |
| 10  | `LogService`         | opaque     | status-only                                      |

````

- [ ] **Step 2: Commit**

```bash
git add scripts/scenarios/kitchen/README.md
git commit -m "docs(scenarios): kitchen scenario manual walkthrough README"
````

---

### Task 16: Manual end-to-end deploy & tester walkthrough

**Files:** None (validation only).

This task verifies the scenario works against a running container and the tester UI. Manual but quick.

- [ ] **Step 1: Start dev stack (if not already running)**

```bash
npm run dev  # TrajectoryActions server :3002 + console :5176
```

In a second terminal:

```bash
cd C:\TrajectoryActionTester && npm run dev  # tester :5173
```

- [ ] **Step 2: Deploy Kitchen**

```bash
npx tsx scripts/scenarios/cli.ts deploy kitchen --server http://localhost:3002
```

Expected: deploy succeeds, 10 `.WFactionCodeX` files uploaded with 200 responses.

- [ ] **Step 3: Verify capabilities**

```bash
curl -s http://localhost:3002/trajectory/v1/capabilities | jq '.meta.total'
```

Expected: 26 (Warehouse's 16 + Kitchen's 10).

- [ ] **Step 4: Tester walkthrough (manual)**

In the tester at `http://localhost:5173`:

1. Refresh the action browser; Kitchen actions appear under `env-kitchen-001`.
2. Invoke each of the 10 Kitchen actions with default inputs (Simulate failures = off).
   - All 10 should reach **COMPLETED** with `outputs.status='0'`.
   - SimmerSauce takes ~2s (the long-running one); others ~100ms.
3. Toggle Simulate failures **on** for `PrintKitchenTicket`. Invoke 5 times.
   - At least one should reach **ABORTED**.
   - Click that ABORTED instance; verify `outputs.status='1'` is visible AND
     the error text contains `'printer offline'`. This proves the opaque sim
     path + the `e2b3eef` (finding #3) fix working end-to-end.
4. Toggle Simulate failures **on** for `SimmerSauce`. Invoke; partway through,
   click **HOLD** (or pause from the UI). Confirm the state machine pauses
   mid-execute, then **UNHOLD**/resume; verify the action reaches COMPLETED.

If any step fails, note the failure mode and either fix forward or open a follow-up
finding in STATE.md. No commit at this step.

- [ ] **Step 5: Stop dev servers (optional, only if pausing the session)**

If continuing immediately, leave servers running. If ending the session, kill the
two `npm run dev` processes.

---

### Task 17: STATE.md update

**Files:**

- Modify: `.planning/STATE.md`

- [ ] **Step 1: Update arc state**

Find the active-arc section in STATE.md. Update the "Pending Todos" block:

**Before:**

```markdown
3. ⏳ **2nd test scenario design** — pick Back Office Inventory OR Industrial Kitchen; design ~10 actions like Warehouse; write phase plan(s). Advances v2 Phase 3 from 1 of 3 → 2 of 3.
```

**After:**

```markdown
3. ✅ **2nd test scenario shipped (Industrial Kitchen)** — 2026-05-17. 10 actions (4 obs + 6 opq) under `scripts/scenarios/kitchen/`. Conventions hoisted to `scripts/scenarios/lib/conventions.ts`. Tests: 1067 green (was 1062, +5). Advances v2 Phase 3 from 1 of 3 → 2 of 3.
```

Also update the **Current Position** table: v2 Phase 3 row from `🟡 1 of 3` → `🟡 2 of 3` (Back Office Inventory still pending → only ⅓ remaining).

Update the **Last activity** date and commits table to include the new Kitchen commits (run `git log --oneline -20` to see the commit hashes added during this plan execution).

- [ ] **Step 2: Commit**

```bash
git add .planning/STATE.md
git commit -m "chore(planning): kitchen scenario shipped — arc item 3 done

v2 Phase 3 now 2 of 3. 1067 TrajectoryActions tests green (was 1062);
4 observable + 6 opaque kitchen actions live; conventions hoisted
to lib/conventions.ts; integration test pins all 5 cases including
SearProtein sim-failure-injection at N=50."
```

---

## Self-review checklist (run after writing the plan)

The author of this plan should run these before handing off — they are not execution steps.

- [x] **Spec coverage:**
  - Goal & approach (single dish lifecycle, 4/6 split): covered by Phase B task structure + `kitchen/definition.ts` content.
  - Architecture (mirror Warehouse, CLI auto-discovery): no new infra; Tasks 13, 16 verify build/deploy.
  - Environment Definition (`lib-kitchen-001`, `env-kitchen-001`, etc.): in Task 2.
  - All 10 actions with inputs/outputs/visibility: Tasks 3-12.
  - Simulation logic + dice-roll markers: Tasks 3-12 use the spec's marker text verbatim.
  - File layout (28 .py + definition.ts + README + test): Tasks 2-12 cover .py + definition, Task 14 covers test, Task 15 covers README.
  - Conventions hoist: Phase A (Task 1).
  - Test integration (5 cases): Task 14.
  - Validation plan from spec: Task 16 (manual) + Task 14 (automated full suite).
- [x] **Placeholder scan:** No "TBD"/"TODO"/"fill in later" in any task. Failure-mode messages, OIDs, defaults, sleep ranges all concrete.
- [x] **Type/name consistency:**
  - All 10 action OIDs (`act-kt-sear-001`, …) appear identically in `definition.ts`, the test file's `KITCHEN_ACTIONS` array, and the README's table.
  - `STATUS_OUTPUT`, `OBSERVABLE_STATES`, `OPAQUE_STATES` defined once in Task 1, referenced unchanged in Task 2.
  - `KitchenLibrary` / `IndustrialKitchen` / `env-kitchen-001` consistent across `definition.ts`, README, and test edits.

---

## Open questions deferred to execution

These come from the spec's "Open Questions" section. The plan adopted the spec's suggested defaults; revisit during code review if a different choice is preferred:

1. **`ExpoCheck` failure-path `verdict`** — current Task 11 doesn't set `verdict` before the dice-roll raises (the raise happens at the marker, before the clean-path output writes). If the desired behavior is `verdict='rejected'` on simulated abort, the marker syntax doesn't support pre-raise mutations within the marker itself; a manual addition above the marker would be needed. Default adopted: leave `verdict` empty on failure; the error message carries the rejection signal.
2. **`PrepStation` partial outputs on failure** — same constraint as above. Default adopted: marker fires first, raising before any output writes; `portions_ready` and `prep_notes` stay at defaults on failure. (Note: the spec mentioned exercising the `e2b3eef` fix via partial outputs. The opaque marker already raises after setting `status='1'`, so the fix is exercised by `status` alone.)
3. **`SearProtein` ABORTED `internal_temp_c`** — current Task 3's ABORTING.py is `pass`. `internal_temp_c` stays at its default `'0'`. Matches Warehouse's pattern. Default adopted: no change.

If any of these should change, the affected task's code blocks need a small adjustment — flag it before that task executes.

---

_Plan complete. Ready for execution handoff._
