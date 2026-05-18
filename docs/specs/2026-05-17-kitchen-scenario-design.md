# Industrial Kitchen Test Scenario — Design Spec

**Status**: Approved
**Date**: 2026-05-17
**Phase**: v2 Phase 3 (Environment 2 of 3)

---

## Goal

Create a self-contained "Industrial Kitchen" environment with 10 actions (4 observable, 6 opaque) that simulates a single-order lifecycle through a commercial kitchen. The scenario mirrors the Warehouse template's conventions so a familiar reader can recognize the shape immediately, but the action mix is deliberately different.

The primary purpose is **demo polish + authoring teaching example + thematic variety from Warehouse** — not engine-coverage. Engine-surface coverage that falls out (a long-running observable, a single-input observable, several status-only-output actions) is a happy bonus.

## Approach

The scenario follows one ticket end-to-end: ticket prints → station preps → grill preheats → protein sears → sides sauté → sauce simmers → plate is composed → garnish goes on → expediter checks → service is logged. Readers (engineering and non-engineering) can follow the arc top-to-bottom without prior context.

**Visibility split is 4 observable / 6 opaque** — different from Warehouse's 7/3. Observable is reserved for actions that have a genuine workflow-orchestration reason to support `PAUSE`/`HOLD` from outside the action (timing-critical or composition steps where the workflow may need to wait on a sibling). Anything that is fundamentally linear "the chef just does it" is opaque even if it produces multiple outputs. This rule is more semantically honest than slavishly mirroring Warehouse's 7/3, and it also gives opaque actions more variety in their inputs/outputs (which Warehouse's opaques don't really get — they're all status-only).

## Architecture

Mechanically a clone of the Warehouse pattern. No new infrastructure:

- `scripts/scenarios/kitchen/definition.ts` declares the library, environment, and 10 actions.
- `scripts/scenarios/kitchen/code/<ActionName>/<STATE>.py` holds the Python.
- `scripts/scenarios/kitchen/README.md` is the manual walkthrough.
- The CLI (`scripts/scenarios/cli.ts`) auto-discovers the scenario from the directory — no registration step.
- The `# {{sim_dice_roll: observable}}` and `# {{sim_dice_roll: opaque, msg='…'}}` markers (introduced by commit `38c82ca` for Warehouse) are reused verbatim.
- `STATUS_OUTPUT`, `OBSERVABLE_STATES`, `OPAQUE_STATES` constants — currently duplicated at the top of `warehouse/definition.ts` — are hoisted to a new `scripts/scenarios/lib/conventions.ts` and imported by both scenarios. See [Conventions hoist](#conventions-hoist) for the rationale.

## Environment Definition

```
Library local_id:  KitchenLibrary
Library OID:       lib-kitchen-001
Environment OID:   env-kitchen-001
Environment name:  Industrial Kitchen
Environment local_id: IndustrialKitchen
Version:           1.0.0
Schema version:    4.0
```

### Action Property Specifications

| Property          | Entries                                                                                               | Purpose                                                |
| ----------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `SIMULATION_MODE` | `Value`=`"false"`, `Description`=`"When 'true', actions inject random failures (~10% per execution)"` | Toggle for failure injection (same shape as Warehouse) |

### Value Property Specifications

None.

### Resource Property Specifications

None.

## Actions

### Observable Actions (4) — Full ISA-88 State Machine

Each observable action implements code for `STARTING`, `EXECUTING`, `COMPLETING`, `ABORTING`. The dice-roll marker goes in `STARTING.py`; `EXECUTING.py` reads `outputs['status']` and raises (status=1) or sleeps past timeout (status=2) accordingly. `COMPLETING.py` writes the success outputs. `ABORTING.py` sets the action's declared outputs to abort-state values (matching Warehouse's pattern — e.g., `pick_status='aborted'` rather than introducing undeclared output keys).

#### 1. SearProtein

**Purpose:** Pan-sear protein on the flat top; chef monitors internal temperature and can hold/abort.

| Field       | Value                                                           |
| ----------- | --------------------------------------------------------------- |
| OID         | `act-kt-sear-001`                                               |
| Local ID    | `SearProtein`                                                   |
| Visibility  | observable                                                      |
| Description | Sear a protein on the flat top to a target internal temperature |
| Timeout     | 3 seconds                                                       |

**Input Parameters:**

| ID                  | Type   | Default    | Description                                   |
| ------------------- | ------ | ---------- | --------------------------------------------- |
| `protein`           | string | `"ribeye"` | Cut of protein                                |
| `side`              | string | `"first"`  | Which side is being seared (`first`/`second`) |
| `target_internal_c` | number | `"54"`     | Target internal temperature, °C               |

**Output Parameters:**

| ID                | Type   | Default | Description                                                 |
| ----------------- | ------ | ------- | ----------------------------------------------------------- |
| `internal_temp_c` | number | `"0"`   | Measured internal temperature at sear-end                   |
| `sear_score`      | string | `""`    | Qualitative score (`"good"`, `"underseared"`, `"overdone"`) |
| `status`          | string | `"0"`   | `0`=success, `1`=simulated abort, `2`=simulated timeout     |

**Simulation logic:**

- `STARTING`: validate inputs (warn on empty), roll the dice via `# {{sim_dice_roll: observable}}`.
- `EXECUTING`: if `status=='1'`, raise `RuntimeError('SearProtein: pan overheated')`. If `status=='2'`, `time.sleep(60)` to force engine timeout. Else `time.sleep(random.uniform(0.05, 0.15))` and write `internal_temp_c` = target, `sear_score` = `"good"`.
- `COMPLETING`: ensure final outputs are present, set `status='0'` on the clean path.
- `ABORTING`: set declared outputs to abort-state values — `sear_score='aborted'`, `internal_temp_c='0'`.

#### 2. SauteSides

**Purpose:** Sauté vegetable sides with adjustable heat management.

| Field       | Value                                             |
| ----------- | ------------------------------------------------- |
| OID         | `act-kt-saute-001`                                |
| Local ID    | `SauteSides`                                      |
| Visibility  | observable                                        |
| Description | Sauté a vegetable side at a controlled heat level |
| Timeout     | 3 seconds                                         |

**Input Parameters:**

| ID           | Type   | Default         | Description        |
| ------------ | ------ | --------------- | ------------------ |
| `pan_id`     | string | `"PAN-3"`       | Pan identifier     |
| `vegetable`  | string | `"asparagus"`   | Vegetable to sauté |
| `heat_level` | string | `"medium-high"` | Burner level       |

**Output Parameters:**

| ID         | Type   | Default | Description                                                   |
| ---------- | ------ | ------- | ------------------------------------------------------------- |
| `doneness` | string | `""`    | Qualitative doneness (`"crisp-tender"`, `"soft"`, `"burned"`) |
| `status`   | string | `"0"`   | `0`=success, `1`=simulated abort, `2`=simulated timeout       |

**Simulation logic:**

- `STARTING`: validate inputs, dice roll.
- `EXECUTING`: abort = `RuntimeError('SauteSides: vegetables burned')`; timeout = lost flame (long sleep). Clean path sleeps `0.05–0.15s`, writes `doneness='crisp-tender'`.
- `COMPLETING`: ensure outputs present, `status='0'`.
- `ABORTING`: `doneness='aborted'`.

#### 3. SimmerSauce

**Purpose:** Long reduction of a sauce base; canonical demonstration of long-running observable behavior including pause/resume.

| Field       | Value                                                |
| ----------- | ---------------------------------------------------- |
| OID         | `act-kt-simmer-001`                                  |
| Local ID    | `SimmerSauce`                                        |
| Visibility  | observable                                           |
| Description | Reduce a sauce base to a target reduction percentage |
| Timeout     | 3 seconds                                            |

**Input Parameters:**

| ID                     | Type   | Default   | Description                                   |
| ---------------------- | ------ | --------- | --------------------------------------------- |
| `pot_id`               | string | `"POT-2"` | Pot identifier                                |
| `sauce_base`           | string | `"jus"`   | Liquid base (`"jus"`, `"cream"`, `"tomato"`)  |
| `reduction_target_pct` | number | `"40"`    | Target reduction percentage (lower = thicker) |

**Output Parameters:**

| ID                    | Type   | Default | Description                                             |
| --------------------- | ------ | ------- | ------------------------------------------------------- |
| `final_reduction_pct` | number | `"0"`   | Measured final reduction percentage                     |
| `status`              | string | `"0"`   | `0`=success, `1`=simulated abort, `2`=simulated timeout |

**Simulation logic:**

- `STARTING`: validate inputs, dice roll.
- `EXECUTING`: **`time.sleep(random.uniform(1.8, 2.4))`** on the clean path (longer than peers — stays under the 3s timeout but long enough to pause/resume from the tester). Abort = `RuntimeError('SimmerSauce: sauce broke / curdled')`; timeout = flameout (long sleep). Final clean output `final_reduction_pct` = `reduction_target_pct`.
- `COMPLETING`: ensure outputs present, `status='0'`.
- `ABORTING`: `final_reduction_pct='0'`.

This is the only action whose Python sleep is materially longer than its peers. Choice rationale: SimmerSauce is the natural pause/resume showcase, and the workflow narrative ("the sauce is reducing — wait for it") supports a longer wait. All other observables stay snappy (`0.05–0.15s`) to keep tests fast.

#### 4. PlateOrder

**Purpose:** Compose the plate from cooked components; expedites may pause if a component isn't ready.

| Field       | Value                                    |
| ----------- | ---------------------------------------- |
| OID         | `act-kt-plate-001`                       |
| Local ID    | `PlateOrder`                             |
| Visibility  | observable                               |
| Description | Compose the plate from cooked components |
| Timeout     | 3 seconds                                |

**Input Parameters:**

| ID           | Type   | Default                 | Description               |
| ------------ | ------ | ----------------------- | ------------------------- |
| `order_id`   | string | `"ORD-7001"`            | Order identifier          |
| `plate_id`   | string | `"PLT-1"`               | Plate identifier          |
| `components` | string | `"protein+sides+sauce"` | `+`-joined component list |

**Output Parameters:**

| ID          | Type   | Default | Description                                             |
| ----------- | ------ | ------- | ------------------------------------------------------- |
| `plated_at` | string | `""`    | ISO 8601 timestamp of plate completion                  |
| `status`    | string | `"0"`   | `0`=success, `1`=simulated abort, `2`=simulated timeout |

**Simulation logic:**

- `STARTING`: validate inputs, dice roll.
- `EXECUTING`: abort = `RuntimeError('PlateOrder: dropped plate')`; timeout = composition stalled. Clean path sets `plated_at` to current ISO timestamp.
- `COMPLETING`: ensure outputs present, `status='0'`.
- `ABORTING`: `plated_at=''` (declared output cleared).

### Opaque Actions (6) — Linear `IN_PROGRESS` → `ABORTING`

Each opaque action implements `IN_PROGRESS.py` and `ABORTING.py`. The dice-roll marker goes in `IN_PROGRESS.py`; opaque markers both set `outputs['status']` and `raise RuntimeError(...)` in the same call. `ABORTING.py` sets the action's declared outputs to abort-state values (same pattern as observables — no undeclared output keys).

#### 5. PrintKitchenTicket

**Purpose:** Print the order ticket on the kitchen printer (fire-and-forget).

| Field           | Value                                          |
| --------------- | ---------------------------------------------- |
| OID             | `act-kt-ticket-001`                            |
| Local ID        | `PrintKitchenTicket`                           |
| Visibility      | opaque                                         |
| Description     | Print the kitchen ticket for an incoming order |
| Timeout         | 3 seconds                                      |
| Dice-roll `msg` | `'printer offline'`                            |

**Inputs:** `ticket_id`=`"TKT-7001"`, `order_summary`=`"pasta-special-1x"`.

**Outputs:** `status`=`"0"`.

**Clean path:** brief sleep, set `status='0'`. **Failure path:** raise with the configured message.

#### 6. PrepStation

**Purpose:** Chef does mise en place — chops/portions an ingredient.

| Field           | Value                                          |
| --------------- | ---------------------------------------------- |
| OID             | `act-kt-prep-001`                              |
| Local ID        | `PrepStation`                                  |
| Visibility      | opaque                                         |
| Description     | Mise en place — portion and prep an ingredient |
| Timeout         | 3 seconds                                      |
| Dice-roll `msg` | `'ingredient spoilage detected'`               |

**Inputs:** `ingredient`=`"shallots"`, `quantity_grams`=`"120"`, `cut_style`=`"brunoise"`.

**Outputs:** `portions_ready`=`"0"`, `prep_notes`=`""`, `status`=`"0"`.

**Clean path:** sleep, set `portions_ready` = a derived value (e.g., quantity/30), `prep_notes` = `f"{cut_style} on {ingredient}"`, `status='0'`. **Failure path:** raise; the `portions_ready` and `prep_notes` mutations made before the dice roll are NOT preserved (marker is the first non-trivial code in the function), but the `status='1'` IS preserved on the ABORTED instance thanks to today's `e2b3eef` fix.

This action is the **3-in / 3-out opaque** showcase — demonstrating that opaque ≠ status-only. Useful as a teaching example of "the simplest visibility category isn't the simplest action shape".

#### 7. PreheatGrill

**Purpose:** Set the grill to a target temperature (fire-and-forget set; chef returns later).

| Field           | Value                                 |
| --------------- | ------------------------------------- |
| OID             | `act-kt-preheat-001`                  |
| Local ID        | `PreheatGrill`                        |
| Visibility      | opaque                                |
| Description     | Set the grill to a target temperature |
| Timeout         | 3 seconds                             |
| Dice-roll `msg` | `'igniter failed'`                    |

**Inputs:** `grill_id`=`"GRILL-1"`, `target_temp_c`=`"200"`.

**Outputs:** `status`=`"0"`.

**Clean path:** brief sleep, `status='0'`. **Failure path:** raise.

#### 8. GarnishPlate

**Purpose:** Final garnish on the plated order — quick linear action.

| Field           | Value                           |
| --------------- | ------------------------------- |
| OID             | `act-kt-garnish-001`            |
| Local ID        | `GarnishPlate`                  |
| Visibility      | opaque                          |
| Description     | Apply garnish to a plated order |
| Timeout         | 3 seconds                       |
| Dice-roll `msg` | `'garnish out of stock'`        |

**Inputs:** `plate_id`=`"PLT-1"`, `garnish`=`"chive"`.

**Outputs:** `status`=`"0"`.

The **minimal viable action** in the scenario — 2 inputs, 1 output (status-only). Teaching example: this is the smallest action that's still useful.

#### 9. ExpoCheck

**Purpose:** Expediter visually inspects the plate; pass/fail.

| Field           | Value                                  |
| --------------- | -------------------------------------- |
| OID             | `act-kt-expo-001`                      |
| Local ID        | `ExpoCheck`                            |
| Visibility      | opaque                                 |
| Description     | Expediter inspection of a plated order |
| Timeout         | 3 seconds                              |
| Dice-roll `msg` | `'plate rejected by expediter'`        |

**Inputs:** `ticket_id`=`"TKT-7001"`.

**Outputs:** `verdict`=`""`, `status`=`"0"`.

**Single-input action** — mirrors `CycleCount`'s shape from Warehouse but on the opaque side. Clean-path output: `verdict='pass'`. Failure: `verdict` stays empty (or `'rejected'` if we want to set it before raising — see [Open Questions](#open-questions)), `status='1'`.

#### 10. LogService

**Purpose:** Write a service-completed entry to the audit log.

| Field           | Value                                              |
| --------------- | -------------------------------------------------- |
| OID             | `act-kt-log-001`                                   |
| Local ID        | `LogService`                                       |
| Visibility      | opaque                                             |
| Description     | Record service completion in the kitchen audit log |
| Timeout         | 3 seconds                                          |
| Dice-roll `msg` | `'POS sync timeout'`                               |

**Inputs:** `order_id`=`"ORD-7001"`, `table_id`=`"TBL-12"`.

**Outputs:** `status`=`"0"`.

Mirrors `UpdateInventoryDB`'s role in Warehouse.

## Simulation Logic — Summary

| Aspect              | Behavior                                                                                                  |
| ------------------- | --------------------------------------------------------------------------------------------------------- |
| Trigger             | `props['SIMULATION_MODE']['Value'].lower() == 'true'`                                                     |
| Rate                | 10% per execution (one dice roll per state-with-a-marker)                                                 |
| Outcomes            | `outputs['status']='1'` (abort) or `outputs['status']='2'` (timeout), chosen uniformly when failure fires |
| Observable behavior | `STARTING.py` sets `status`; `EXECUTING.py` reacts (raise on `'1'`, `time.sleep(60)` on `'2'`)            |
| Opaque behavior     | `IN_PROGRESS.py` sets `status` AND raises immediately with the configured `msg`                           |
| Marker syntax       | `# {{sim_dice_roll: observable}}` / `# {{sim_dice_roll: opaque, msg='<context>'}}`                        |
| Expansion           | Build-time by `expandSimDiceRoll()` in `scripts/scenarios/lib/build.ts`                                   |

### Python `time.sleep` distribution

| Action(s)                      | Sleep range                  | Why                                                                    |
| ------------------------------ | ---------------------------- | ---------------------------------------------------------------------- |
| All except `SimmerSauce`       | `random.uniform(0.05, 0.15)` | Snappy demo, fast tests.                                               |
| `SimmerSauce` (EXECUTING only) | `random.uniform(1.8, 2.4)`   | Long-running observable; under 3s timeout, room for pause/resume demo. |

This is tighter than Warehouse's `0.5–1.5` distribution. Rationale: the Warehouse scenario-test suite already runs ~120s, dominated by per-action sleeps. Kitchen aims for ~30s total. If the tighter range turns out to make the scenario feel "instant" in the tester UI (and demo readability suffers), it can be widened — but the SimmerSauce action alone provides the slow-paced visual moment.

### Cross-reference to commit `e2b3eef` (finding #3)

The opaque simulated-abort path sets `outputs['status']='1'` and then immediately raises a `RuntimeError` in the same `execute()` call. Before commit `e2b3eef` (shipped 2026-05-17 earlier this session), that `status='1'` was silently dropped — the sandbox returned `outputs: {}` on the runtime-error branch, and the engine ignored `result.outputs` on `success: false`. The fix makes that pre-raise mutation persist on the ABORTED instance.

That means the Kitchen scenario's opaque failure-injection demo (e.g., `PrintKitchenTicket: simulated random abort (printer offline)` showing `outputs.status='1'` on the ABORTED instance) is **only achievable post-`e2b3eef`**. The Warehouse opaque sim path was technically miscoded against the older sandbox behavior — `status` was set but didn't appear. Kitchen will showcase the correct behavior end-to-end, and the README should call this out as part of the "what to watch in failure mode" notes.

## File Layout

```
scripts/scenarios/
├── lib/
│   ├── build.ts
│   ├── conventions.ts        ← NEW: STATUS_OUTPUT, OBSERVABLE_STATES, OPAQUE_STATES
│   ├── types.ts
│   └── upload.ts
├── kitchen/                  ← NEW
│   ├── README.md
│   ├── definition.ts
│   └── code/
│       ├── PrintKitchenTicket/{IN_PROGRESS,ABORTING}.py
│       ├── PrepStation/{IN_PROGRESS,ABORTING}.py
│       ├── PreheatGrill/{IN_PROGRESS,ABORTING}.py
│       ├── SearProtein/{STARTING,EXECUTING,COMPLETING,ABORTING}.py
│       ├── SauteSides/{STARTING,EXECUTING,COMPLETING,ABORTING}.py
│       ├── SimmerSauce/{STARTING,EXECUTING,COMPLETING,ABORTING}.py
│       ├── PlateOrder/{STARTING,EXECUTING,COMPLETING,ABORTING}.py
│       ├── GarnishPlate/{IN_PROGRESS,ABORTING}.py
│       ├── ExpoCheck/{IN_PROGRESS,ABORTING}.py
│       └── LogService/{IN_PROGRESS,ABORTING}.py
└── warehouse/                ← UPDATED: imports from lib/conventions
    └── definition.ts (use the hoisted constants)

packages/server/src/__tests__/
└── scenario-kitchen.test.ts  ← NEW: ~270 LOC, mirrors scenario-warehouse.test.ts
```

**Python file count:** 4 observables × 4 states + 6 opaques × 2 states = **28 `.py` files**.

## Build & Deploy

No CLI changes required — `loadScenario(name)` does a dynamic import of `<name>/definition.ts`, and `listScenarios()` auto-picks up new directories.

```bash
# Build artifacts
npx tsx scripts/scenarios/cli.ts build kitchen

# Deploy to a running server
npx tsx scripts/scenarios/cli.ts deploy kitchen --server http://localhost:3002
```

Per-action iteration (after editing one `.py` file):

```bash
npx tsx scripts/scenarios/cli.ts build kitchen
npx tsx scripts/scenarios/cli.ts upload-action \
  scripts/scenarios/dist/kitchen/actions/SimmerSauce.WFactionCodeX
```

## Test Integration

`packages/server/src/__tests__/scenario-kitchen.test.ts` is a direct port of `scenario-warehouse.test.ts` (~270 LOC). Five vitest cases:

1. `buildScenario()` produces the expected artifacts: 1 `.WFenvir` + 10 `.WFactionCodeX` files under `dist/kitchen/`.
2. Bulk upload via `.WFenvir` succeeds end-to-end through `/management/v1/upload-envir`.
3. Per-action upload via `.WFactionCodeX` is idempotent (upsert on re-upload).
4. Each of the 10 actions, invoked with `SIMULATION_MODE='false'`, reaches a terminal state with `status='0'`. Validates the **4 observable** lifecycles (`STARTING → EXECUTING → COMPLETING → COMPLETED`) and the **6 opaque** lifecycles (`POSTED → RECEIVED → IN_PROGRESS → COMPLETED`).
5. `SearProtein` invoked with `SIMULATION_MODE='true'` over N=50 trials produces at least 1 simulated abort (`status='1'`). Probabilistic; the assertion accepts any non-zero abort count over N=50.

Failure-injection action choice: `SearProtein` (the canonical observable, mirroring Warehouse's choice of `PickItem`). Could alternately be `SimmerSauce`, but Sear keeps per-trial latency short.

Expected impact on the full suite: TrajectoryActions test count goes from 1062 → **1067** (+5). Test file count: 47 → 48. Full suite duration adds ~30–60s for the new file.

## Conventions Hoist

`warehouse/definition.ts` currently declares three constants at the top:

```typescript
const STATUS_OUTPUT: ParameterSpec = {
  id: 'status',
  value_type: 'literal',
  default_value: '0',
  description: '0=success, 1=simulated abort, 2=simulated timeout',
}
const OBSERVABLE_STATES = ['STARTING', 'EXECUTING', 'COMPLETING', 'ABORTING']
const OPAQUE_STATES = ['IN_PROGRESS', 'ABORTING']
```

With Kitchen as the second scenario, these would be duplicated. The plan hoists them to `scripts/scenarios/lib/conventions.ts`:

```typescript
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

Both `warehouse/definition.ts` and `kitchen/definition.ts` import from this module. No behavior change for Warehouse; just a refactor to remove the about-to-be-duplicated literals. The build artifacts before and after must be byte-identical for Warehouse (verified by an additional test case in `scenario-warehouse.test.ts`, or by manual diff during the implementation plan).

## Open Questions

These are intentional discretion-points left for the implementation plan to resolve. Listed here so the implementer (or reviewer) doesn't trip on them.

1. **ExpoCheck failure-path `verdict`:** when the dice roll fires for `ExpoCheck`, should we set `outputs['verdict']='rejected'` before raising (so the ABORTED instance shows both `status='1'` and `verdict='rejected'`), or leave `verdict` empty and rely on the error message? Setting it before the raise gives a richer ABORTED record — and now works correctly thanks to `e2b3eef`. **Suggested default: set `verdict='rejected'` before raising; the design recommends it but the implementation plan can revisit.**

2. **`PrepStation` failure-path outputs:** same question as ExpoCheck but for `portions_ready` / `prep_notes`. The natural reading is to set partial values then raise (chef chopped some shallots before noticing spoilage), demonstrating the post-`e2b3eef` behavior. Suggested default: set partial values before raise.

3. **`SearProtein` ABORTED state's `internal_temp_c`:** on simulated abort, should ABORTING.py set `internal_temp_c` to a partial reading? Currently the design leaves it `"0"` (the default). The ABORTED instance will already have `status='1'` from STARTING. Suggested: leave at `"0"`; finer-grained semantics aren't worth the complexity.

## Explicit Non-Goals

To prevent scope creep during planning/execution:

- **No new engine features.** This scenario uses only existing engine surface.
- **No protocol changes.** `RESTProtocolSpec.md` is unchanged.
- **No new CLI commands.** The existing `build`/`upload`/`upload-action`/`deploy` cover Kitchen via auto-discovery.
- **No changes to Warehouse's behavior.** The `conventions.ts` hoist is a refactor — Warehouse's built artifacts must be byte-identical pre/post.
- **No tester UI changes.** Tester already renders any action returned by `/capabilities`; Kitchen will appear automatically after deploy.
- **No engine-coverage exotica.** Don't add an action with 10 inputs "just because" — the design above is the design.

## Validation Plan

After implementation:

1. `npx vitest run` — full suite, all green (1062 → 1067).
2. `npx tsx scripts/scenarios/cli.ts deploy kitchen --server http://localhost:3002` — clean deploy to a running server.
3. Capabilities endpoint should now report **26 actions** across `env-warehouse-001` (16, unchanged) and `env-kitchen-001` (10, new).
4. Manual tester walkthrough following the README: invoke each Kitchen action with defaults; confirm clean COMPLETED for all 10 with `SIMULATION_MODE='false'`.
5. Manual tester walkthrough with `SIMULATION_MODE='true'`: invoke each opaque action ~10× and confirm at least one ABORTED instance per action has `outputs.status='1'` correctly displayed (proves the `e2b3eef` cross-reference works end-to-end).
6. Build artifact diff: build Warehouse before and after the `conventions.ts` hoist, confirm byte-identical output.

---

_Next step after spec approval: invoke writing-plans skill to produce the implementation plan._
