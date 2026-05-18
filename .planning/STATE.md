# Project State

## Project Reference

See: .planning/PROJECT.md (last refreshed 2026-02-25 — v1 scope only; v2 work tracked here and in docs/specs/)

**Core value:** Actions invoked by workflow clients execute reliably through the ISA-88 state machine with user-written Python code, and results are returned via the Trajectory REST protocol.

**Current focus:** v2 milestone — developer workflow tooling, UX polish, demo scenarios, and standalone tester rebuild. v1 shipped and audited (gaps closed).

## Current Position

**Milestone:** v2 — in progress (no formal ROADMAP.md yet; tracked by design specs in docs/specs/ and plans in docs/superpowers/plans/)

| v2 Phase          | Status         | Notes                                                                                                            |
| ----------------- | -------------- | ---------------------------------------------------------------------------------------------------------------- |
| 1. Import/Export  | ✅ Complete    | `.WFactionCode` + `.WFsnapshot` ZIP formats; spec at `docs/specs/2026-03-31-...`                                 |
| 2. Console Reskin | ✅ Complete    | Top nav, left tree panel, three-pane layout, density polish                                                      |
| 3. Test Scenarios | 🟡 2 of 3      | Warehouse shipped 2026-05-10; Industrial Kitchen shipped 2026-05-18; Back Office Inventory pending               |
| 4. Tester Rebuild | 🟡 Plan 4 of 6 | Vite scaffold + Connections + Action browser/Invoke + SSE/full InstancePanel shipped; plans 4-05, 4-06 to author |

**Active work:** v2 Phase 4 (Trajectory Action Tester) — Plans 4-01..4-04 shipped + hot-fixed. Plan 4-05 (StateDiagram + LogInspector) **authored and committed but parked** — user chose to defer Plan 4-05 in favor of Warehouse polish + tester smoke-test + 2nd scenario design (multi-session arc). Plan file at `docs/superpowers/plans/2026-05-14-trajectory-action-tester-5-state-diagram-log-inspector.md` (committed `8e048c4`).

**Last activity:** 2026-05-18 — Kitchen scenario shipped via subagent-driven execution (arc item 3 ✅). All 17 tasks of `docs/superpowers/plans/2026-05-17-kitchen-scenario.md` executed: conventions hoist (Task 1) → kitchen scaffold + 28 .py files (Tasks 2-12) → build verification (Task 13) → integration test (Task 14) → README (Task 15) → automated portion of manual walkthrough (Task 16) → this STATE update (Task 17). 16 new commits on master. Tests: TrajectoryActions 1071 → **1076 green** (+5 from `scenario-kitchen.test.ts`, test files 47 → 48); sidecar unchanged at 15. v2 Phase 3 advances 🟡 1 of 3 → 🟡 2 of 3.

**Caveat from this session:** the Task 2 implementer subagent made an unscoped commit `3a221d7` ("docs(specs): add as-built REST interface specifications", +1538 lines across 2 files in `docs/specs/`) between Task 2 and Task 3 that was not part of the Kitchen plan. A later subagent deleted those files from the working tree without committing the deletion; I restored them via `git checkout HEAD --` to keep the working tree clean. The commit remains in history — user decision pending whether to keep, revert, or relocate.

Prior activity 2026-05-17 — three workstreams shipped:

1. **Smoke-test arc item 2 ✅** — steps 5 (SSE reconnect) + 6 (parameter-shape) both green; no new findings.
2. **Sandbox finding #3 ✅** — one code commit `e2b3eef`: sidecar error branches now return live `outputs` dict; state-machine.ts failure branch mirrors the success-path merge so user mutations before a `raise` land on the instance record. 3 new tests (sidecar unit + engine unit + engine integration).
3. **Kitchen scenario design + plan ✅** — spec `cf48fdb`/`c5c7333` (`docs/specs/2026-05-17-kitchen-scenario-design.md`); implementation plan `22c3ea2` (`docs/superpowers/plans/2026-05-17-kitchen-scenario.md`, 17 tasks across 4 phases). 4 observable + 6 opaque (deviates from Warehouse's 7/3 by design — visibility chosen by "needs orchestrator-level PAUSE/HOLD?").

Tests after that session: TrajectoryActions 1062 green (was 1054); sidecar 15 green (was 14). Prior activity 2026-05-15 — **Warehouse polish shipped** (item 1 of 4 in the deferred-Plan-4-05 arc). Three commits:

1. **`38c82ca` (TrajectoryActions) — DRY dice-roll via build-time marker expansion.** `scripts/scenarios/lib/build.ts` grew `expandSimDiceRoll()` that expands `# {{sim_dice_roll: observable}}` and `# {{sim_dice_roll: opaque, msg='...'}}` markers in scenario `.py` source. 10 warehouse .py files (7 STARTING + 3 IN_PROGRESS) collapsed to a single marker line each; byte-equivalence with HEAD verified for all 10 across both the copied code/ output and the `.WFactionCodeX` zip entries. Side cleanup: `.gitignore` now excludes accidental tsc artifacts under `scripts/scenarios/lib/` and `scripts/scenarios/warehouse/` (cli.ts runs via tsx; no compile step needed).

2. **`64aa016` (TrajectoryActions) — per-invoke `action_property_overrides`** test affordance on `POST /trajectory/v1/actions/:oid/invoke`. Ephemeral in-memory map on `InstanceManager`, keyed by instance_id, dropped on terminal. `state-machine.ts` gained an optional 8th constructor arg `getActionPropertyOverrides` callback that merges the map into `envProps` before each state's code runs. New `mergePropertyOverrides()` helper in `parameter-resolver.ts`. RESTProtocolSpec.md NOT modified — server vendor extension only.

3. **`f06e408` (TrajectoryActionTester) — Simulate failures checkbox** on InvokePanel. Resets to false on action switch. Injects `{ SIMULATION_MODE: { Value: 'true' } }` into the invoke body when checked. Tester at 77 commits, 264 tests (was 260), 83.22 KB gz (was 82.93).

Sub-item **3 — manual abort tests** was explicitly skipped from this pass per user choice. Test totals: TrajectoryActions 1054 (was 1046; +8 tests across mergePropertyOverrides unit, instance-manager override integration, protocol route, build expansion).

## Performance Metrics

**v1 cumulative (historical):**

- 20 plans complete across 7 phases. Average ~5.65 min/plan. Total ~113 min execution time.

**v2 to date:**

- Phase 1 (Import/Export): shipped — duration not tracked
- Phase 2 (Console Reskin): shipped — duration not tracked
- Phase 3 (Warehouse scenario): 4 plans + 2 engine fixes (timeout race + recovery-state loop); ~1037 tests pass
- Phase 4 Plan 1 (Vite scaffold): 13 tasks, 10 commits, single-file build verified
- Phase 4 Plan 2 (Connections + Capabilities): 15 tasks, 23 commits, 75 tests, 76.70 KB gz bundle
- Phase 4 Plan 3 (Action browser + Invoke): 16 tasks, 18 commits, 136 tests, 80.41 KB gz bundle
- Phase 4 Plan 4 (SSE + full InstancePanel): 19 tasks, 23 commits, 257 tests, 80.73 KB gz bundle

## Accumulated Context

### Decisions — v2

- **Import/Export format:** `.WFactionCode` ZIP (action code) and `.WFsnapshot` ZIP (full container state). Active versions only, no execution history.
- **Console reskin:** Top nav replacing sidebar, left tree (VS Code explorer) on detail pages, search bar. Branding deferred.
- **Test scenarios:** 3 independent environments (warehouse, inventory, kitchen), ~10 actions each, full simulation with `SIMULATION_MODE` toggle for failure modes. `.WFactionCodeX` format introduced for per-action code upload.
- **Tester:** Rebuild as standalone React/Vite app at `C:\TrajectoryActionTester\`, universal tool not tied to this container. Old `C:\ActionContainerTester\` (1016-line vanilla HTML) replaced; backup at `C:\ActionContainerTester-OLD.zip`.
- **Tester spec:** L1 (polished parity) + L2 (visualization) for Phase 4; L3 (scenario save/replay) and L4 (batch + assertions) designed but deferred to later milestones.
- **Tester architecture:** React 19 + Vite 6 + TS strict + `vite-plugin-singlefile` + `@tanstack/react-query` + React Context (not Zustand) + vanilla CSS Modules (no Tailwind). IDE dark theme.
- **Tester Phase 4 plan breakdown:** 6 plans (4-01 scaffold → 4-06 polish); Wave A sequential 4-01..4-04, Wave B 4-05 → 4-06. Plans 2-6 written incrementally as each predecessor ships.
- **Engine pool-recovery (2026-05-11):** `worker.ts` Node-side timeout now SIGKILLs subprocess + sets `_isDead = true` before reject; `state-machine.ts` `RECOVERY_TERMINAL` map force-transitions ABORTING/STOPPING/CLEARING code failures to terminal instead of looping.

### Decisions — v1 (historical, retained for reference)

v1 decisions (Phases 1-7, plans 01-01 through 07-04) are retained in git history and per-plan SUMMARY.md files under `.planning/phases/`. They informed v1 architecture and remain authoritative for v1 internals.

### Pending Todos

Active multi-session arc (user committed 2026-05-15 to "shift focus off Phase 4"):

1. ✅ **Warehouse polish** — DRY dice-roll + SIMULATION_MODE UI toggle. Done 2026-05-15. (manual abort tests deferred from this pass)
2. ✅ **Smoke-test tester w/ real container** — done 2026-05-17. Steps 1–4 completed 2026-05-15 with 5 findings (2 fixed, 3 documented). Steps 5 (SSE reconnect) + 6 (parameter-shape sweep across MoveItem, CycleCount, ReceiveShipment, plus Move Robot from the `{id, value_type, default_value}` storage shape) passed clean — no new findings.
3. ✅ **2nd test scenario shipped (Industrial Kitchen)** — 2026-05-18. 10 actions (4 obs + 6 opq) under `scripts/scenarios/kitchen/`. Conventions hoisted to `scripts/scenarios/lib/conventions.ts`. Tests: 1076 green (was 1071, +5); test files 47 → 48. Manual UI walkthrough (HOLD/UNHOLD demo + interactive SIM toggle from Task 16) deferred to user — automated portion (deploy, capabilities check at 22 actions, curl-invoke 3 representative actions) all green.
4. 🟡 **Re-survey / surprise angles** — now active. Re-examine STATE.md and propose 2–3 alternative angles not on the current queue.

Other memory-tracked queue (deferred during the arc):

- 3rd test scenario — design + build
- Warehouse polish leftover: **manual abort tests** (curl/script-based abort-during-EXECUTING smoke tests)
- Plan 4-05 (StateDiagram + LogInspector) — authored, parked behind the arc above

### Plan 4-04 review follow-ups — ✅ all addressed mid-session 2026-05-14

For the record (one commit, `fee927b` at `C:\TrajectoryActionTester\`):

1. ✅ **`isLoading` micro-flicker** — `use-instance-stream.ts` now derives an `effective` fallback synchronously via `useMemo(initialStateFromInstance(query.data))`. The EventSource effect was also re-keyed on `query.data` identity instead of the reducer's `liveState`, so the live stream opens one render sooner without dropping events (the seed dispatch is source-ordered first; React processes dispatches in queue order). New test `'returns isLoading=false and data populated in the same render when REST resolves'` pins the no-flicker invariant.

2. ✅ **`StateTimeline` mount-time tick** — `StateTimeline.tsx` switched to `Date.now()` at render time (the setInterval still triggers the re-render every second; only the computation moved). The `'ticks the current pill'` test was correcting a double-advance bug (`setSystemTime` + `advanceTimersByTime` together). New test `'shows accurate elapsed time for an instance that started before mount'` pins the 5-min-running-on-load invariant.

3. ✅ **`CommandBar` silent hide** — `InstancePanel.tsx` Commands section header always renders; body shows `'Loading commands…'` while `useCapabilities.isLoading`, or `'Action capability not found for OID …'` when the lookup misses. New `.sectionMessage` CSS class for muted italic body. Two new tests pin both states.

### Post-Plan-4-04 hot fixes (also shipped this session)

- **Server parameter-spec normalization** (TrajectoryActions `d7915d0`): `/capabilities` was leaking three heterogeneous stored shapes for `input_parameter_specifications` (`{name, data_type, default_value}`, `{id, value_type, default_value}`, `{id, oid, description, entries}`). Tester showed `"undefined"` for parameter names on any action authored under the newer DataModelSpec (which uses `id`). Added `normalizeParameterSpec` in `routes/protocol.ts` that maps all three shapes onto RESTProtocolSpec.md § 2.2 canonical wire shape `{ name, description?, default_value?, json_schema? }`.

- **Tester type alignment** (tester `002f899`): `InputParameterSpec` had invented `type`/`required`/`default` fields not in the protocol. Aligned to spec canonical shape. Dropped `required`-asterisk + `missingRequired` submit guard (protocol does not define required-ness — that's the action's Python code's concern). Test fixtures updated across InvokePanel + integration tests.

### Plan 4-03 review follow-ups — ✅ all addressed in Plan 4-04

For the record (each fold-in commit referenced):

1. ✅ `pillVariantForState` extracted to `src/lib/state-pill.ts` — `6365c07`. Consumed by `InstanceList`, `InstancePanel`, `StateTimeline`. Local copies gone.
2. ✅ `useInstance` apiKey-in-queryKey gone — hook deleted entirely (`88380e1`); replacement `use-instance-stream.ts` keys on `['instance-seed', connection?.id, instanceId]` (no apiKey).
3. ✅ `eslint-disable react-refresh/only-export-components` comments annotated in `active-instance.tsx` + `connections.tsx` — `d29be44`.
4. ✅ `InvokePanel` form-reset useEffect dep changed from `[action]` to `[action?.action_oid]` — `763b8f9`. Test enforces invariant via `structuralSharing: false` query client.
5. ✅ `App.tsx` "coming in plan 4-05" placeholder — left untouched; still accurate (Plan 4-05 will replace it with LogInspector).

### Blockers/Concerns

None.

### Smoke-test findings 2026-05-15 (mid-arc-item-2)

**Real bugs discovered & fixed:**

1. ✅ **Tester wire-shape mismatch** — fixed in commit `250e92f` (TrajectoryActionTester). Server's instance response (and `output` SSE event) uses `Array<{key, value}>` for runtime parameter pairs, but the tester's `instance-stream-reducer.ts` was reading `out.name`. All outputs collapsed to a single key `"undefined"`. Pre-existing from Plan 4-04 — test fixtures used `{name, value}` so unit tests verified the wrong shape. Same class as `002f899` (last session) + `d7915d0` (server). Fix introduces a `RuntimeParameterPair` type to make this distinction sticky.

2. ✅ **Stale engine `dist/` workflow gotcha** — not a code bug, but `dev:server` resolves `@trajectory/engine` via `package.json → "main": "./dist/index.js"` (compiled output), and `tsx watch` only watches the server entrypoint's source. Changes to `packages/engine/src/...` are invisible to the running dev server until `npm run build`. Cost most of an hour today before the override path was confirmed working. **Worth documenting in CLAUDE.md or a dev README** so future-you remembers to rebuild after engine edits.

**Latent bugs / behavior gaps (documented, NOT fixed):**

3. ✅ **Sandbox drops `outputs` mutations on `raise`** — fixed 2026-05-17 in commit `e2b3eef`. Two-layer fix: sidecar `SYNTAX_ERROR` + `RUNTIME_ERROR` branches now return the live `outputs` dict; state-machine.ts failure branch now merges `result.outputs` into the instance's `output_parameters` before the ABORTING transition. Three tests pin the behavior at sidecar unit, engine unit (mock executor), and engine integration (real subprocess + DB roundtrip) layers. The `JSONDecodeError` branch in the sidecar still returns `{}` — correct, since outputs isn't in scope before request parsing.

4. ⚠️ **ABORT during EXECUTING gives no immediate UI feedback** — command is deferred (state-machine `deferredCommands` map) until code returns. UX gap: user clicks ABORT, sees nothing change for ~seconds, naturally clicks again. Worth a transient "Pending: ABORT" pill or a request-acknowledgement indicator.

5. ⚠️ **Deferred commands don't queue** — last-write-wins. If user clicks ABORT then STOP during EXECUTING, `deferredCommands.set()` overwrites; only STOP is applied. May be intentional but combined with finding #4 produces "I clicked ABORT and got STOP semantics."

**Unresolved curiosity (probably statistical, mechanism verified):**

6. 🤔 **`SIMULATION_MODE` dice rate looked low on real v7 code** — across 100+ trials against PickItem/ScanBarcode with `Simulate failures` ON, observed 1 abort. Expected ~10. But:
   - Engine override path proven end-to-end via diag log: envProps merges correctly, Python's `props['SIMULATION_MODE']['Value']` is `'true'`.
   - Echo action confirmed `_received_sim_value: true` reaching user code.
   - `random.random()` distribution measured uniform across 50 samples in the same sandbox (4/50 in [0, 0.10)).
   - `raise RuntimeError(...)` propagation works (forced-raise correctly transitions to ABORTING).
   - But specifically on v7's code path (`if sim and random.random() < 0.10:` short-circuit), 50 trials all rolled `>= 0.138`.

   Most likely explanation: subtle MT state alignment / worker rotation in pool. Not blocking; not a regression from today's polish. Would need further isolation (single worker, log every dice value, count over 200+ trials) to characterize.

**Smoke checklist progress:**

- ✅ Step 1: Opaque action clean path (ScanBarcode COMPLETED with correct outputs)
- ⚠️ Step 2: Opaque action with Sim mode (mechanism verified; dice rate unresolved — see finding #6)
- ✅ Step 3: Observable HOLD/RESUME round-trip (PickItem, 10s long-sleep, full state cycle observed)
- ✅ Step 4: ABORT round-trip (after retry — first attempt had double-click producing finding #4 + #5)
- ✅ Step 5: SSE reconnect — passed 2026-05-17 (Offline throttle → wait → online; state pill resumed and reached COMPLETED, StateTimeline gapless, no console errors about missed events)
- ✅ Step 6: Parameter-shape edge cases — passed 2026-05-17 (MoveItem 3-input, CycleCount 1-input, ReceiveShipment 2-input all rendered input + output labels correctly; Move Robot on env `2cb6a775-…` validated `normalizeParameterSpec` hot-fix `d7915d0` end-to-end through the UI)

## Session Continuity

Last session: 2026-05-18 (this session — Kitchen execution).

Earlier today (this session): user resumed; started toward subagent-driven Kitchen execution but hit a **DELETE-environment bug** in the Console first (smoke-test residue cleanup blocked by `Internal server error`). Bug fixed + verified live + committed as `9a7edd7` before returning to Kitchen execution. Smoke-test residue (`env-test-001`, `env-test-010`) cleaned up via the now-working delete path.

Then: executed all 17 tasks of the Kitchen scenario plan via subagent-driven-development. Each task got its own implementer subagent; reviews varied from per-task combined spec+quality (mechanical Python tasks) to two-stage review (substantive tasks like the conventions hoist and integration test). One Critical issue caught by code-quality reviewer on Task 1 (`as const` on the hoisted state arrays made them `readonly tuple`, incompatible with `ActionDefinition.code_states: string[]` — TS4104 at 10 sites — slipped through `npm run build` because `scripts/scenarios/**` isn't in any tsconfig project reference); fixed in commit `e70c430`. All other tasks landed cleanly.

Bug summary (`9a7edd7`): `DELETE /management/v1/environments/:oid` 500'd with `SQLITE_CONSTRAINT_FOREIGNKEY` whenever any action had terminal-state instances. The route's explicit-ordering transaction walked `code_versions → actions → env` but missed `instances` — and `instances.action_oid` / `instances.environment_oid` deliberately don't cascade (per spec, `migrations.test.ts:178`). The pre-flight 409 only catches active instances. Fix: added `InstanceRepository.deleteByEnvironment()` + one line in the txn + `instances_removed` response field + spec update. `execution_log` rows preserved (no FK to instances). +4 tests; suite 1062 → 1071 green.

Prior stop point (2026-05-17 session): **Arc item 2 ✅ + finding #3 ✅ + arc item 3 design+plan ✅ — paused for fresh-session execution.** That session shipped: (1) smoke-test arc item 2 (steps 5+6) clean — no new findings; (2) sandbox-fix `e2b3eef` closing finding #3 with sidecar unit + engine unit + engine integration tests; (3) Kitchen scenario spec (commit `c5c7333`); (4) Kitchen implementation plan (commit `22c3ea2`, 17 tasks). Of the original 5 smoke findings from 2026-05-15: 3 fixed (2 prior session, 1 then as `e2b3eef`), 2 still documented latent (#4, #5), 1 dice-rate curiosity unresolved.

Full commit list for this arc (2026-05-15 + 2026-05-17 + 2026-05-18):

| Commit    | Repo                   | Summary                                                                       |
| --------- | ---------------------- | ----------------------------------------------------------------------------- |
| `38c82ca` | TrajectoryActions         | DRY warehouse dice-roll via build-time marker expansion                       |
| `64aa016` | TrajectoryActions         | per-invoke `action_property_overrides` test affordance (engine + server)      |
| `d05d081` | TrajectoryActions         | Plan-arc state mid-session                                                    |
| `31b6d09` | TrajectoryActions         | handoff — smoke-test mid-flight + 5 findings captured                         |
| `e2b3eef` | TrajectoryActions         | sandbox-fix — preserve outputs mutations on user-code raise (finding #3)      |
| `46dcd80` | TrajectoryActions         | planning — close smoke-test arc + record sandbox fix                          |
| `cf48fdb` | TrajectoryActions         | docs — kitchen scenario design spec (draft)                                   |
| `c5c7333` | TrajectoryActions         | docs — kitchen scenario spec approved                                         |
| `22c3ea2` | TrajectoryActions         | docs — kitchen scenario implementation plan (17 tasks)                        |
| `9a7edd7` | TrajectoryActions         | env-delete cascade-terminal-instances fix (2026-05-18, mid-resume)            |
| `6542b49` | TrajectoryActions         | kitchen Task 1 — hoist STATUS_OUTPUT + state arrays to lib/conventions        |
| `e70c430` | TrajectoryActions         | kitchen Task 1 fix — drop `as const` (TS4104 incompat) + amend plan/spec      |
| `b1c932e` | TrajectoryActions         | kitchen Task 2 — definition.ts (10 actions, 4 obs + 6 opq)                    |
| `3a221d7` | TrajectoryActions         | **⚠️ off-plan** — Task 2 implementer's unscoped REST API specs (user review)  |
| `2833f15` | TrajectoryActions         | kitchen Task 3 — SearProtein observable code                                  |
| `5bc532f` | TrajectoryActions         | kitchen Task 4 — SauteSides observable code                                   |
| `1c1ec3c` | TrajectoryActions         | kitchen Task 5 — SimmerSauce observable code (long-running)                   |
| `b40c4fa` | TrajectoryActions         | kitchen Task 6 — PlateOrder observable code                                   |
| `5c21db1` | TrajectoryActions         | kitchen Task 7 — PrintKitchenTicket opaque code                               |
| `b135383` | TrajectoryActions         | kitchen Task 8 — PrepStation opaque code (3-in / 3-out)                       |
| `5ae474b` | TrajectoryActions         | kitchen Task 9 — PreheatGrill opaque code                                     |
| `bd6203d` | TrajectoryActions         | kitchen Task 10 — GarnishPlate opaque code (minimal)                          |
| `0266f2f` | TrajectoryActions         | kitchen Task 11 — ExpoCheck opaque code (single-input)                        |
| `8d9fa53` | TrajectoryActions         | kitchen Task 12 — LogService opaque code                                      |
| `5393413` | TrajectoryActions         | kitchen Task 14 — scenario-kitchen.test.ts integration coverage (1071 → 1076) |
| `ba0e03d` | TrajectoryActions         | kitchen Task 15 — manual walkthrough README                                   |
| `f06e408` | TrajectoryActionTester | Simulate failures checkbox in InvokePanel                                     |
| `250e92f` | TrajectoryActionTester | wire-shape fix (instance.outputs/inputs use `key`, not `name`)                |

Test suites: TrajectoryActions **1076 green** (was 1071; +5 from `scenario-kitchen.test.ts`); test files **48** (was 47); sidecar 15 green (unchanged). Tester unchanged: 264 green, 83.22 KB gz, 78 commits.

### Start here next session

**Arc is now at item 4.** Active arc:

1. ✅ Warehouse polish — done 2026-05-15
2. ✅ Smoke-test tester — done 2026-05-17 (all 6 steps green)
3. ✅ **Kitchen scenario — shipped 2026-05-18** (17 tasks all green; tests 1071 → 1076)
4. 🟡 **Re-survey for surprise angles** — now active.

**Primary next action options** (user choice):

A. **Kitchen Task 16 UI walkthrough remainder** (~15 min): Open the tester at :5173, invoke each of the 10 Kitchen actions, then toggle Simulate failures ON for `PrintKitchenTicket` (validate opaque sim path + `e2b3eef` fix end-to-end) and for `SimmerSauce` (validate HOLD/UNHOLD during the ~2s clean path). Servers are still running.

B. **Resolve commit `3a221d7`** ("docs(specs): add as-built REST interface specifications" — 2 files, +1538 LOC). The Task 2 implementer made this commit unprompted, off-plan. The files exist in HEAD and the working tree. Decide: keep (REST docs may be useful), revert via `git revert 3a221d7`, or relocate to a separate branch.

C. **Re-survey for surprise angles** (arc item 4 proper). With the Kitchen arc closed, re-examine STATE.md to propose 2–3 alternative angles not on the current queue. Could naturally surface candidates like the 3rd test scenario (Back Office Inventory), Plan 4-05 resume, latent findings #4/#5 fix, dice-rate investigation (#6), or new directions entirely.

D. **Investigate dice-rate curiosity** (finding #6) — open-ended; not blocking.

E. **Resume Plan 4-05** (StateDiagram + LogInspector, authored `8e048c4`).

F. **Fix latent findings #4 and #5** (ABORT-during-EXECUTING UX feedback + deferred-command queueing) — tester UX, ~half day.

G. **3rd test scenario** (Back Office Inventory) — would close out v2 Phase 3 (2 of 3 → 3 of 3).

### Dev environment state

Servers running at handoff (from this session's Task 16 deploy):

- TrajectoryActions: `npm run dev` running (Express :3002, Vite console :5176)
- Tester: not running this session — `cd C:\TrajectoryActionTester && npm run dev` to start on :5173

Warehouse + Kitchen both deployed (persistent SQLite at `data/trajectory.db`): 22 capabilities served (10 wh + 10 kt + 2 misc residual). To stop: kill the `npm run dev` process(es); `Get-NetTCPConnection -LocalPort 3002,5176` and `Stop-Process -Id <pid>`.

### Caveats still in force

- ABORT-during-EXECUTING gives no immediate UI feedback (finding #4): command is deferred until code returns, naturally inviting double-clicks. Combined with #5, that means click ABORT exactly once and wait — don't double-click.
- Deferred commands don't queue (finding #5): last-write-wins on the `deferredCommands` map; double-clicking ABORT then STOP during EXECUTING produces "I clicked ABORT and got STOP" behavior.
- `tsx watch` does not pick up `packages/engine/src/...` changes (dev:server resolves the compiled `@trajectory/engine` from `dist/`). Run `npm run build` then restart dev if you edit engine source.

Invoke `/gsd:resume-work` to load this state cleanly into next session's context.
