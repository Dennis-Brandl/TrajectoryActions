# Warehouse Scenario — Implementation Design

**Status:** Draft for review
**Date:** 2026-05-08
**Builds on:** `docs/specs/2026-04-01-warehouse-scenario-design.md` (scenario semantics)
**Scope:** Generator infrastructure + first scenario (Automated Warehouse). First concrete v2 Phase 3 deliverable.

## Background

The 2026-04-01 spec defines the warehouse scenario's intent — 10 actions, simulation logic per state, failure injection. This document covers the **implementation approach**: how scenario sources are organized, how artifacts are generated and uploaded, the cross-cutting `status` output parameter, and the tests that verify it.

The infrastructure built here is meant to be reused for the other two planned scenarios (Back Office Inventory, Industrial Kitchen) and any future test libraries.

## Goals

1. Reusable generator that takes a TypeScript scenario definition and produces an importable `.WFenvir` JSON file plus a folder of Python source files.
2. Companion uploader that posts the generated artifacts to a running container.
3. Single CLI binary entrypoint covering build, upload, deploy (= build + upload), and list operations.
4. Warehouse scenario delivered end-to-end in 4 phases: scaffold, observable wave 1, observable wave 2, opaque actions + final integration coverage.

## Non-goals

- The other two scenarios (Back Office Inventory, Industrial Kitchen). Designed and built in later milestones.
- Real (non-simulated) failure semantics. Status codes 1 and 2 represent simulated failures only; real-world failure codes can extend the scheme later.
- Replacing the existing `.WFactionCode` (per-action code-only ZIP, per `packages/server/src/routes/export-import.ts:29-89`). That format imports code into an _already-existing_ action and stays in place for round-trip workflows. The new `.WFactionCodeX` format defined below is its self-contained sibling.

## File formats

This scenario delivery uses three formats, two of which already exist in the codebase. The third (`.WFactionCodeX`) is new.

| Format               | Status   | Carries                                                                | Used for                                                                                           |
| -------------------- | -------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `.WFenvir`           | Existing | Environment + action declarations (JSON, no code)                      | Bulk env import via `/management/v1/upload`                                                        |
| `.WFenvirX`          | Existing | ZIP wrapping a `.WFenvir`                                              | Same as above, compressed                                                                          |
| `.WFaction`          | Existing | Single action declaration (JSON)                                       | Single-action import via `/management/v1/upload` (line 235)                                        |
| `.WFactionCode`      | Existing | ZIP: `manifest.json` (code-only metadata) + `<state>.py` files at root | Round-trip code-only export/import for an _existing_ action (`POST /actions/:oid/import`)          |
| **`.WFactionCodeX`** | **NEW**  | ZIP: full `.WFaction` JSON + `code/<state>.py` folder                  | Self-contained per-action package — creates-or-updates the action AND loads its code in one upload |

### `.WFactionCodeX` structure

```
PickItem.WFactionCodeX  (ZIP)
├── action.WFaction          # the full action declaration JSON
└── code/
    ├── STARTING.py
    ├── EXECUTING.py
    ├── COMPLETING.py
    └── ABORTING.py
```

`action.WFaction` is the same JSON shape the existing `/upload` endpoint already accepts as a bare `.WFaction` file (see `packages/server/src/routes/management.ts:286` for the validator's required-fields list). Wrapping it in a ZIP alongside a `code/` folder gives us a self-contained, deployable per-action package — the natural unit when you're iterating on a single action's behavior.

Difference from existing `.WFactionCode`:

| Aspect          | `.WFactionCode` (existing)                                                                      | `.WFactionCodeX` (new)                                       |
| --------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| JSON content    | `manifest.json` — metadata only (format_version, exported_at, action summary, code_files index) | `action.WFaction` — full action declaration                  |
| Code layout     | `<state>.py` at ZIP root                                                                        | `code/<state>.py` in subfolder                               |
| Upload endpoint | `POST /actions/:oid/import` (action must already exist)                                         | `POST /management/v1/upload` (creates the action if missing) |
| Use case        | Round-trip code edits for a known action                                                        | First-class per-action delivery + iteration                  |

## Status output parameter (cross-cutting)

Every action declares an output parameter:

```
{ id: 'status', value_type: 'literal', default_value: '0', description: '0=success, 1=simulated abort, 2=simulated timeout' }
```

Code conventions:

| Code | Meaning           | Where set                                                                                                      |
| ---- | ----------------- | -------------------------------------------------------------------------------------------------------------- |
| `0`  | Normal exit       | COMPLETING (observable) or end of IN_PROGRESS (opaque). Default value in the spec is also 0.                   |
| `1`  | Simulated abort   | Set in EXECUTING / IN_PROGRESS just before raising the simulated-failure exception. ABORTING preserves it.     |
| `2`  | Simulated timeout | Set in EXECUTING / IN_PROGRESS immediately before the deliberate long sleep that exceeds the action's timeout. |

HOLD does NOT set non-zero `status`. HOLD is a recoverable delay; after UNHOLD the action resumes and completes with `status=0`.

## Architecture

### File layout

```
scripts/scenarios/
├── cli.ts                     # entrypoint: tsx scripts/scenarios/cli.ts <cmd> <scenario>
├── lib/
│   ├── types.ts               # TS types for ScenarioDefinition / ActionDefinition / etc.
│   ├── build.ts               # scenario → .WFenvir + code/<action>/<state>.py
│   └── upload.ts              # POST .WFenvir + per-state code to running server
├── warehouse/
│   ├── definition.ts          # exports the warehouse ScenarioDefinition
│   ├── code/                  # Python source organized as <action_local_id>/<state>.py
│   │   ├── PickItem/
│   │   │   ├── STARTING.py
│   │   │   ├── EXECUTING.py
│   │   │   ├── COMPLETING.py
│   │   │   └── ABORTING.py
│   │   └── ... (9 more action folders)
│   └── README.md              # manual test walkthrough
└── dist/                      # generator output (gitignored)
    └── warehouse/
        ├── warehouse.WFenvir              # env + all 10 action declarations (no code)
        ├── code/<action>/<state>.py       # flat python source (for inspection/diff)
        └── actions/                       # per-action self-contained ZIPs
            ├── PickItem.WFactionCodeX
            ├── PutawayItem.WFactionCodeX
            └── ... (8 more)
```

The TypeScript scenario definition references actions by `local_id`. The build step verifies that for each action × declared `code_state`, a matching `.py` file exists under `code/<action.local_id>/<state>.py`. Missing files are an error — the generator does not stub them silently.

The build emits BOTH the env-level `.WFenvir` AND per-action `.WFactionCodeX` files. The first is for "deploy this whole environment cleanly to a fresh container"; the second is for "I just edited one action's STARTING.py, push that one." Both routes are valid; the integration test exercises both.

### CLI

```
npx tsx scripts/scenarios/cli.ts <command> [args] [options]

Commands:
  list                              List available scenarios under scripts/scenarios/
  build <scenario>                  Generate .WFenvir + code/ + actions/*.WFactionCodeX into dist/<scenario>/
  upload <scenario>                 Bulk-upload: post .WFenvir, then post each action's code via the bare API
  upload-actions <scenario>         Per-action upload: post each .WFactionCodeX file (works for fresh or existing containers)
  upload-action <path-to.WFactionCodeX>   Upload a single .WFactionCodeX file (the iteration loop)
  deploy <scenario>                 Build, then upload-actions (combined; recommended for full scenario deploy)

Options:
  --server <url>                    Server URL (default: http://localhost:3002)
  --out <path>                      Output directory for build (default: scripts/scenarios/dist/<scenario>)
```

`build`, `upload`, `uploadActions`, and `uploadAction` are also exposed as plain functions from `lib/build.ts` and `lib/upload.ts` so the integration test can call them directly without spawning the CLI.

The two upload paths exist because they cover different flows:

- **`upload` (bulk)** — POST one `.WFenvir`, then loop POSTing code per state. Closer to what the management API was originally designed for; single env transaction; if a code POST fails, the env still landed.
- **`upload-actions` (per-action ZIPs)** — POST each `.WFactionCodeX` separately. Self-contained per action; you can ship one action update without touching the others; failure of one action's import doesn't affect the rest. **Recommended path for the warehouse scenario** because each action is independent.

`upload-action <file>` is the developer ergonomics command: edited one Python file, regenerate that action's `.WFactionCodeX`, and push it.

### TypeScript scenario types (`lib/types.ts`)

```ts
export type Visibility = 'observable' | 'opaque'

export interface ParameterSpec {
  id: string
  value_type: 'literal' | 'property'
  default_value: string
  description?: string
}

// Output params have no target_property_name in this codebase — they're set by code
// directly. (Workflow execution-only fields are intentionally absent.)
export type OutputParameterSpec = ParameterSpec

export interface PropertyEntrySpec {
  name: string
  value: string
}
export interface PropertySpec {
  name: string
  entries: PropertyEntrySpec[]
}

export interface ActionDefinition {
  oid: string
  local_id: string
  version: string
  visibility: Visibility
  description?: string
  inputs: ParameterSpec[]
  outputs: OutputParameterSpec[]
  property_specifications?: PropertySpec[]
  /** States that have user code; the build step expects code/<local_id>/<state>.py for each. */
  code_states: string[]
  /** Optional per-action timeout, applied via PUT /management/v1/actions/{oid}/timeout. */
  timeout_seconds?: number | null
}

export interface ResourcePropertySpec {
  name: string
  resource_type: string
  description?: string
}

export interface EnvironmentDefinition {
  oid: string
  local_id: string
  version: string
  description?: string
  schemaVersion?: string
  action_property_specifications?: PropertySpec[]
  value_property_specifications?: PropertySpec[]
  resource_property_specifications?: ResourcePropertySpec[]
}

export interface ScenarioDefinition {
  /** Absolute path to this scenario's source root, used to resolve code/<action>/<state>.py.
   * Convention: set to dirname(fileURLToPath(import.meta.url)) in the definition file. */
  rootDir: string
  environment: EnvironmentDefinition
  actions: ActionDefinition[]
}
```

### Build pipeline (`lib/build.ts`)

`buildScenario(scenario, outDir): Promise<BuildResult>`:

1. For each `action` × `state` in `action.code_states`, read `<rootDir>/code/<action.local_id>/<state>.py`. Throw if missing.
2. Construct the `.WFenvir` JSON envelope:
   ```json
   {
     "environment_specifications": [
       {
         "oid": "...",
         "local_id": "...",
         "version": "...",
         "schemaVersion": "4.0",
         "action_property_specifications": [...],
         "value_property_specifications": [...],
         "resource_property_specifications": [...],
         "included_actions": [
           {
             "oid": "...",
             "local_id": "...",
             "version": "...",
             "action_visibility": "observable",
             "input_parameter_specifications": [...],
             "output_parameter_specifications": [...],
             "property_specifications": [...]
           },
           ...
         ]
       }
     ]
   }
   ```
3. Write `<outDir>/<scenario>.WFenvir`.
4. Copy each `.py` source verbatim to `<outDir>/code/<action.local_id>/<state>.py`.
5. **Build per-action `.WFactionCodeX` ZIPs** (uses `jszip`, already a dep at `packages/server`):
   - For each action, construct an `action.WFaction` JSON containing the action declaration alone (same fields as one entry in `included_actions`, plus an `environment_oid` reference).
   - Bundle into a ZIP: `action.WFaction` at root, `code/<state>.py` for each state.
   - Write `<outDir>/actions/<action.local_id>.WFactionCodeX`.
6. Return:
   ```ts
   {
     envFilePath: string,
     codeFiles: Array<{ actionOid, actionLocalId, state, path }>,
     actionPackages: Array<{ actionOid, actionLocalId, path /* .WFactionCodeX */ }>,
     actions: ActionDefinition[],
   }
   ```

Pure transformation — same input → same output bytes. No timestamps in the WFenvir or per-action JSON.

> The exact field names (`schemaVersion`, `action_visibility`, `included_actions`, `input_parameter_specifications`, etc.) match what `packages/server/src/routes/management.ts` upload validation expects. Verified by reading the validator at lines 361-465.

### Upload pipelines (`lib/upload.ts`)

Two functions, both async and both returning structured results so the integration test can assert on them.

**`uploadScenarioBulk(buildResult, serverUrl)`** — env-first, code-after path:

1. POST `buildResult.envFilePath` to `${serverUrl}/management/v1/upload` (multipart, field `files`).
2. For each `codeFile`: read source, POST `{ source_code, description }` to `${serverUrl}/management/v1/code/${actionOid}/${state}`. Surface per-file errors but continue.
3. For each action with `timeout_seconds`: PUT `${serverUrl}/management/v1/actions/${actionOid}/timeout`.
4. Return `{ envImported: bool, codeUploaded: number, codeFailed: Array<{...}>, timeoutsSet: number }`.

**`uploadScenarioPerAction(buildResult, serverUrl)`** — per-action `.WFactionCodeX` path (recommended):

1. POST each `actionPackage.path` to `${serverUrl}/management/v1/upload` (multipart). The endpoint detects `.WFactionCodeX`, extracts the inner `action.WFaction` to upsert the action, then saves+activates each `code/<state>.py` as the active code for its state.
2. For each action with `timeout_seconds`: PUT timeout.
3. Return `{ actionsImported: number, actionsFailed: Array<{...}>, timeoutsSet: number }`.

**`uploadActionPackage(filePath, serverUrl)`** — single-file convenience for the iteration loop. Same logic as one iteration of `uploadScenarioPerAction`'s loop.

### Server-side support for `.WFactionCodeX`

The existing `/management/v1/upload` endpoint at `packages/server/src/routes/management.ts:200-650` accepts `.WFenvir`, `.WFenvirX`, and `.WFaction`. It needs a fourth branch for `.WFactionCodeX`:

1. Add `.WFactionCodeX` to the accepted-extensions list at line 235.
2. Add a ZIP-handling branch (mirrors the `.WFenvirX` branch at line 311):
   - Open ZIP via JSZip
   - Look for `action.WFaction` (or any `*.WFaction`) entry — fail with VALIDATION_ERROR if missing
   - Parse JSON and run the same required-fields validation already used for bare `.WFaction`
   - Look for `code/*.py` entries — collect each as `{ state: filename-without-extension, source }`
3. Inside the existing transaction (line 510 area):
   - Upsert the action via the same path used for bare `.WFaction`
   - For each collected code file, save+activate via `codeVersionRepo.save` + `activate` (matches the existing `/actions/:oid/import` logic at `packages/server/src/routes/export-import.ts:155-168`)
4. Return the same `imported` summary the bare `.WFaction` path returns, with an additional `code_versions_loaded` count.

This is meaningful new server work (~80-120 lines, similar in shape to the existing `.WFactionCode` import). Flagged in the Phasing table — Phase 1 includes the server change so per-action upload works end-to-end from scaffold onwards.

### How simulated failure works in Python

The Python state's signature is fixed by the sandbox at `packages/python-sidecar/sandbox_runner.py:23`:

```python
def execute(inputs, outputs, props, action_props):
    ...
```

- **`props`** comes from `request["environment_action_properties"]` (`sandbox_runner.py:124`) — the env's **Action Properties** (`env.action_property_specifications`). Visible in the Environment detail page's right pane.
- **`action_props`** comes from `request["action_properties"]` (`sandbox_runner.py:125`) — the action's own **Action Properties** (`action.property_specifications`). Visible in the Action detail page's right pane.

Shape (verified by `packages/python-sidecar/test_sandbox_runner.py:264-277`): nested dict, `props[<property_name>][<entry_name>] → value`.

**`SIMULATION_MODE` is therefore declared on `env.action_property_specifications`** — NOT `value_property_specifications`, which is workflow-execution-only and was deliberately dropped from the Action Container UI. It's a single-entry property:

```ts
{
  name: 'SIMULATION_MODE',
  entries: [{ name: 'Value', value: 'false' }],  // toggleable
}
```

The action reads it:

```python
def execute(inputs, outputs, props, action_props):
    sim = props.get('SIMULATION_MODE', {}).get('Value', 'false').lower() == 'true'
    if sim and random.random() < 0.10:
        mode = random.choice(['abort', 'hold', 'timeout'])  # 'hold' filtered out for opaque
        if mode == 'abort':
            outputs['status'] = '1'
            raise RuntimeError(f'{ACTION_NAME}: simulated random abort')
        elif mode == 'timeout':
            outputs['status'] = '2'
            time.sleep(60)  # exceeds the 3s action timeout
        elif mode == 'hold':
            print('Triggering simulated HOLD via outputs marker')
            outputs['_simulated_hold'] = 'true'  # caller logic detects and HOLDs
    # normal path...
    outputs['status'] = '0'
```

> Remaining implementation detail to verify in Phase 1: **output persistence on timeout SIGKILL.** For `status=2` simulated-timeout to surface to the caller, the engine must persist outputs progressively (not just at terminal state). If outputs are only persisted at terminal, we set `status=2` in ABORTING instead of EXECUTING.

### Action timeouts for the simulated timeout

Default scenario timeout: `3` seconds (set per-action via `timeout_seconds: 3` in the definition; uploader applies via PUT). Simulated timeout sleeps 60s — guaranteed to trip the 3s limit, leaving a comfortable margin under the test's 60s vitest timeout.

## Phasing

| Phase                        | Scope                                                                                                                                                                                                                                                                                                                                                                                            | Verification                                                                                                                                                                                                                                                                                                                                                     |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1: Scaffold**              | Generator infra (`cli.ts`, `lib/*`, types), warehouse `definition.ts` with all 10 action specs, **stub** Python files (each just `outputs['status'] = '0'`), per-action `.WFactionCodeX` ZIP emission, **server-side `.WFactionCodeX` import branch in `/upload`** (`packages/server/src/routes/management.ts`) with vitest coverage, README walkthrough draft. `.gitignore` update for `dist/`. | Build + upload-actions to running server. All 10 actions visible in console explorer. Each action's right pane shows declared inputs/outputs and active code (the stub) for each state. Invoke each via Trajectory REST protocol → completes with `status=0`. Both `upload` (bulk) and `upload-actions` (per-action ZIP) paths verified in the integration test. |
| **2: Observable wave 1**     | Replace stub code for `PickItem`, `PutawayItem`, `MoveItem` with full simulation-aware Python. Per-action integration test.                                                                                                                                                                                                                                                                      | Integration test in `packages/server/src/__tests__/scenario-warehouse.test.ts` covering these 3 actions with SIMULATION_MODE=false (deterministic 0).                                                                                                                                                                                                            |
| **3: Observable wave 2**     | `ConsolidateOrder`, `CycleCount`, `ReceiveShipment`, `ShipOrder`. Same pattern.                                                                                                                                                                                                                                                                                                                  | Test extended to cover wave 2.                                                                                                                                                                                                                                                                                                                                   |
| **4: Opaque + sim coverage** | `UpdateInventoryDB`, `ScanBarcode`, `PrintLabel` (IN_PROGRESS + ABORTING). Final integration test: import + invoke all 10 actions with SIMULATION_MODE=false (deterministic 0). One probabilistic test running PickItem 50 times with SIMULATION_MODE=true and asserting `1 ≤ failures ≤ 49`. README walkthrough finalized.                                                                      | Full warehouse imports, all 10 invocations succeed in deterministic mode. Sim mode test passes.                                                                                                                                                                                                                                                                  |

## Testing

### Manual test (`scripts/scenarios/warehouse/README.md`)

Walks the user through:

1. `npm run dev` (server + console).
2. `npx tsx scripts/scenarios/cli.ts deploy warehouse --server http://localhost:3002`.
3. Open the console, expand "Automated Warehouse" in the explorer — all 10 actions visible.
4. Inspect `PickItem`: right pane shows Input Parameters (shelf_location, item_sku, quantity) and Output Parameters including `status`. Action Properties shows `SIMULATION_MODE`.
5. Open the code editor for `PickItem / EXECUTING` — Python visible.
6. Invoke via curl or the Trajectory Action Tester with default inputs.
7. Toggle `SIMULATION_MODE` value to `true` via the management API; invoke 20 times; observe variance in `status` outputs.

### Integration test (`packages/server/src/__tests__/scenario-warehouse.test.ts`)

Uses `createTestApp()` from the existing test infrastructure (real Python pool, `:memory:` DB):

- **`builds and imports the warehouse scenario via bulk env upload`**: call `buildScenario()`, then upload `.WFenvir` via supertest to `/management/v1/upload`. Assert: 1 env imported, 10 actions land with correct `local_id`s.
- **`posts code for every action × state via bare API`**: for each generated `.py`, POST to `/management/v1/code/{oid}/{state}`. Assert each returns 201; cross-check `code_summary.states_with_code` per action via `GET /actions/{oid}`.
- **`imports a single action via .WFactionCodeX upload`**: build the warehouse, take `dist/warehouse/actions/PickItem.WFactionCodeX`, POST to `/management/v1/upload`. Assert: action exists and all its declared states have active code. Repeat the upload (idempotent upsert) — assert no duplicate, code versions increment.
- **`imports all 10 actions in a fresh container via .WFactionCodeX path`**: starting from a clean `:memory:` DB (NO prior env upload), POST each `.WFactionCodeX` in turn. Assert all 10 actions land with code. (Note: the env itself isn't created by this path — actions need their `environment_oid` to point at an existing env. So this test first uploads a minimal `.WFenvir` with the env shell + empty `included_actions: []`, then loads each action's `.WFactionCodeX`.)
- **`each action completes with status=0 in deterministic mode`** (SIMULATION_MODE=false): invoke each action via `/trajectory/v1/invoke`, await terminal SSE event with a 30s timeout, assert terminal state is `COMPLETED` (or opaque equivalent) and outputs include `status: '0'`.
- **`PickItem injects failures in simulation mode`**: SIMULATION_MODE=true, invoke 50 sequential PickItem calls. Assert `failureCount >= 1 && failureCount < 50`. Skipped on CI by default (slow). Vitest timeout 60s.

## Files touched / created

| File                                                       | Type                                                              |
| ---------------------------------------------------------- | ----------------------------------------------------------------- |
| `scripts/scenarios/cli.ts`                                 | NEW                                                               |
| `scripts/scenarios/lib/types.ts`                           | NEW                                                               |
| `scripts/scenarios/lib/build.ts`                           | NEW (env JSON + `.WFactionCodeX` ZIPs via JSZip)                  |
| `scripts/scenarios/lib/upload.ts`                          | NEW (bulk + per-action paths)                                     |
| `scripts/scenarios/warehouse/definition.ts`                | NEW                                                               |
| `scripts/scenarios/warehouse/code/<action>/<state>.py`     | NEW × ~34 (7 obs × 4 states + 3 opaque × 2 states)                |
| `scripts/scenarios/warehouse/README.md`                    | NEW                                                               |
| `.gitignore`                                               | edit — add `scripts/scenarios/dist/`                              |
| `packages/server/src/routes/management.ts`                 | edit — accept `.WFactionCodeX`, parse + upsert action + load code |
| `packages/server/src/__tests__/management-upload.test.ts`  | edit (or new) — server-side coverage for the new branch           |
| `packages/server/src/__tests__/scenario-warehouse.test.ts` | NEW                                                               |

## Risks

1. **Output persistence on SIGKILL.** If outputs aren't persisted progressively, the simulated-timeout flow sets `status=2` from ABORTING (after the kill) using a side-channel (e.g., reading the action-instance's last `props['_pending_status']`). Phase 1 verifies and the design adapts if needed.
2. **`schemaVersion` value.** The existing test fixture uses `"4.0"`. The upload validator rejects entries without `schemaVersion` post-fix in commit `c5c2ea3`. Verify the actual accepted value(s) by reading the validator before fixing on `"4.0"`.
3. **`.WFactionCodeX` server branch — environment_oid resolution.** A bare `.WFaction` (and its `.WFactionCodeX` wrapper) carries an `environment_oid` referencing an env that should already exist. If the env is missing, the import fails. The `upload-actions` flow first uploads a minimal env (or uses an env loaded earlier) so this is not a problem in practice, but the integration test must cover the "missing env" failure path with a clear error message.
4. **Concurrency starving the Python pool in tests.** Pool size in tests is 1-2; the 50-iteration sim test is sequential, not parallel — no risk.

## Open questions

None. Status code scheme, generator architecture, definition file format (TypeScript), CLI binary, and `.WFactionCodeX` format all confirmed by user.
