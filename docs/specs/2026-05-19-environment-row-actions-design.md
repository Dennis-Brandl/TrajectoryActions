# Action Container — Environment Row Dropdown (Export / Delete / PDF) + Metadata Line

**Date:** 2026-05-19
**Status:** Draft for review (rev. 2 — bundle format)
**Scope:** Console UI (apps/console) + Management API (packages/server)

## Background

Each environment in the console's left tree (`apps/console/src/features/explorer/TreeNode.tsx` — `EnvironmentNode`) currently renders a single-line row with a chevron, the env's `local_id`, an action count, and a hover-revealed `Trash2` button that calls the existing `DELETE /environments/:oid` endpoint after a `window.confirm`.

Trajectory Editor uses a richer pattern on each top-level workflow row in `LibraryItem.tsx`: a kebab (`MoreHorizontal`) icon opens a Radix `DropdownMenu` with the row's actions, and a small secondary line under the workflow name shows version and state in muted micro-type. This design lifts that pattern into the Action Container console for environments, replacing the standalone trash button with a dropdown that exposes three actions — Export, Delete, Generate PDF report — and adds a second line showing the env's version and import freshness.

### Format constraints discovered during design

The existing import/export ecosystem (used by both this container and Trajectory Editor) treats env metadata and per-action code as separate files:

- `.WFenvir` (JSON) — env library: `{ local_id, oid, version, last_modified_date, schemaVersion, environment_specifications: [{ ..., included_actions: [...] }] }`. **No code.**
- `.WFenvirX` (ZIP) — a wrapper containing one inner `.WFenvir` JSON. **No code.**
- `.WFactionCodeX` (ZIP) — one action's `*.WFaction` JSON plus `code/<STATE>.py` files. **No env metadata.**

The existing upload handler at `POST /management/v1/environments/upload` accepts multiple files in a single request and links them by OID. To re-import a complete env + code, today's user must select one `.WFenvirX` plus N `.WFactionCodeX` files at once.

For this feature we introduce a new bundle extension that is a single self-contained file the user can re-upload to reinstate the env, its actions, and their code in one click.

## Goals

1. Mirror Trajectory Editor's `MoreHorizontal` + Radix `DropdownMenu` row-action pattern so users moving between consoles get a consistent affordance.
2. Add a per-environment export endpoint that emits a new `.WFenvirBundle` ZIP — a single-file round-trip artifact containing both env metadata and all action code. Extend the existing upload handler to accept the new extension.
3. Generate a single-document PDF report listing each action in the environment with its parameters and the active code segment for each state. Generation runs in the browser via `jsPDF` (same library Trajectory Editor uses).
4. Display `[v{version}] imported {MM/DD}` under the env name. No schema change — values come from existing `EnvironmentSummary` fields.
5. Preserve the existing delete UX (`window.confirm` + `useDeleteEnvironment` + error bubble to parent).

## Non-goals

- No new `status` field on `Environment`. The line under the env name uses existing `version` and `last_modified_date` / `imported_at` only.
- No syntax highlighting, TOC links, diagrams, or branding in the PDF. The user's word is "simple".
- No Editor-style Rename / Duplicate menu items.
- No refactor of the existing `.WFsnapshot` exporter to share the new helper.
- No bulk "export all environments" (snapshot already covers that case).
- No replacement of `window.confirm` with a Radix `AlertDialog`.
- No new shared component lifted to `@trajectory/ui`. Everything new stays in `apps/console`.

## UI

### Env row layout

```
▸ WarehouseV3                          12  ⋯
  [v4] imported 5/10
```

Two-line row. Line 1 keeps the existing layout — chevron, name (truncated, flex-1), action_count (when collapsed), and a hover-revealed kebab icon (`MoreHorizontal` from `lucide-react`) using `opacity-0 group-hover:opacity-100` per the Editor pattern. Line 2 (new) renders the metadata in `text-[10px] text-muted-foreground`, indented to align with the name's left edge, always visible.

- **Date source:** `last_modified_date` if present, else `imported_at`.
- **Format:** `MM/DD`, with `MM/DD/YY` only when the year differs from the current year. Formatted via a local helper in `TreeNode.tsx`; we do not extend `formatTimestamp` in `apps/console/src/lib/utils.ts`.
- **Click target for navigation** is line 1 only. Line 2 has `cursor: default` and does not propagate clicks.
- The kebab `<button>` calls `e.stopPropagation()` so opening the menu does not also navigate.

### Dropdown menu

Sourced from `@trajectory/ui` (`DropdownMenu`, `DropdownMenuTrigger`, `DropdownMenuContent`, `DropdownMenuItem`, `DropdownMenuSeparator`). `DropdownMenuContent align="end"`. Item order:

| Item                | Icon (lucide-react) | On select                                                                                         |
| ------------------- | ------------------- | ------------------------------------------------------------------------------------------------- |
| Export environment  | `Download`          | `useExportEnvironment(oid, localId).run()` — downloads `<localId>.WFenvirBundle`.                 |
| Generate PDF report | `FileText`          | `useGenerateEnvironmentReport(oid, localId).run()` — fetches the same bundle, parses, builds PDF. |
| — separator —       |                     |                                                                                                   |
| Delete environment  | `Trash2`            | Same `window.confirm` + `useDeleteEnvironment` flow as today. Item uses `variant="destructive"`.  |

While either of the two work-doing items is pending, the corresponding item renders disabled with its label suffixed " — Working…". On error, the message bubbles through the existing `EnvironmentNode` callback (see [Error surfacing](#error-surfacing)).

### Component file

`apps/console/src/features/explorer/TreeNode.tsx` — replace the body of `EnvironmentNode` (current lines 31–95). The exported `EnvironmentNode` props change only by renaming the `onDeleteError` callback to `onActionError` (it now surfaces Export and PDF errors too). The single caller — `apps/console/src/features/explorer/ExplorerPanel.tsx` — gets a one-line rename.

## Server

### New route

`GET /management/v1/environments/:oid/export-bundle` in `packages/server/src/routes/export-import.ts`, adjacent to the existing snapshot and per-action exports.

- **Auth:** matches the existing `/management/v1/*` posture — the management router is mounted without `createApiKeyAuth` in `packages/server/src/index.ts`, so this route is unauthenticated like its siblings.
- **Response:** `200` with `Content-Type: application/zip` and `Content-Disposition: attachment; filename="<local_id>.WFenvirBundle"` (filename URL-encoded for safety). `404` if env not found.
- **Body:** binary ZIP buffer.

### `.WFenvirBundle` ZIP layout

A new bundle extension. The inner files are deliberately the same shapes the existing upload handler already understands for `.WFenvir` JSON and `.WFactionCodeX` ZIPs — this lets us reuse most of the existing import code.

```
<local_id>.WFenvirBundle/
├── manifest.json
├── <local_id>.WFenvir
└── code/
    └── <action_oid>/
        ├── STARTING.py
        ├── EXECUTING.py
        └── ...
```

- **`manifest.json`** (bundle metadata, distinct from the inner `.WFenvir`):
  ```json
  {
    "format": "WFenvirBundle",
    "format_version": 1,
    "exported_at": "2026-05-19T17:04:22.000Z",
    "container_version": "0.0.1",
    "environment_oid": "...",
    "environment_local_id": "WarehouseV3",
    "action_count": 12,
    "code_file_count": 47
  }
  ```
- **`<local_id>.WFenvir`** — the env library JSON in the **existing** wire shape the upload handler already parses: `{ local_id, oid, version, last_modified_date, schemaVersion, environment_specifications: [{ ..., included_actions: [{ ..., input_parameter_specifications, output_parameter_specifications, ... }] }] }`. Exactly one env in the array. Field set matches the per-env entry the existing `.WFsnapshot` exporter already emits (lines 206–228 in `export-import.ts`).
- **`code/<action_oid>/<STATE>.py`** — only the **active code version** per state, raw Python source. Directory key is the action's OID (matches one of the `included_actions[].oid` values in the inner `.WFenvir`).

### Shared export helper

New module-internal helper inside `export-import.ts`:

```ts
async function buildEnvironmentBundle(
  envOid: string,
  environmentRepo: EnvironmentRepository,
  actionRepo: ActionRepository,
  codeVersionRepo: CodeVersionRepository
): Promise<{ buffer: Buffer; filename: string }>
```

Internally it composes the inner `.WFenvir` JSON the same way the existing `.WFsnapshot` exporter builds its per-env entry, then walks active code versions per action to drop `.py` files under `code/<action_oid>/`. Returns the ZIP buffer and the filename to use in `Content-Disposition`. The existing `.WFsnapshot` exporter is **not** refactored to call this helper in this pass.

### Upload-handler extension

`POST /management/v1/environments/upload` (in `packages/server/src/routes/management.ts`) currently accepts `.WFenvir`, `.WFenvirX`, `.WFaction`, `.WFactionCodeX` via a `ParsedFile` discriminated union. We add a new variant:

```ts
| {
    file: Express.Multer.File
    type: 'wfenvirbundle'
    data: Record<string, unknown>  // the inner .WFenvir JSON object (library shape)
    schemaVersion: string
    codeByActionOid: Record<string, Array<{ state: string; source: string }>>
  }
```

Parsing branch (mirrors the existing `.WFenvirX` branch, plus code collection):

1. Unzip the outer bundle with `JSZip.loadAsync(file.buffer)`.
2. Find the inner `*.WFenvir` entry using the same name-suffix check as `.WFenvirX` → parse as JSON, validate the same required fields (`local_id`, `oid`, `version`, `last_modified_date`, `environment_specifications`).
3. Walk every `code/<action_oid>/<state>.py` entry; group sources by action OID into `codeByActionOid`.
4. Push one `ParsedFile` of type `'wfenvirbundle'` carrying the parsed env-library JSON, schema version, and the code map.

The existing transaction code (which loops over parsed files and writes envs, actions, and code) gets one new branch: when it sees a `'wfenvirbundle'` parsed file, it:

1. Processes the inner env JSON exactly like the existing `'wfenvir'` / `'wfenvirx'` branch (upsert env, upsert actions).
2. For each upserted action, looks up `codeByActionOid[action.oid]`. If the array exists, creates initial code versions (one per state) for that action — mirrors the logic in the existing `'wfactioncodex'` branch.

The extension allowlist at the top of the handler (currently `wfenvir | wfenvirx | wfaction | wfactioncodex`) gains `wfenvirbundle`. The validation error message updates to mention the new extension.

### Tests

New file `packages/server/src/__tests__/environment-bundle.test.ts`. Cases:

1. **Happy path export.** Export a seeded env; bundle contains `manifest.json` with `format: "WFenvirBundle"` + correct counts, an inner `<local_id>.WFenvir` whose `environment_specifications[0]` has the expected env + `included_actions`, and one `code/<oid>/<STATE>.py` per state-with-code. Counts in `manifest` match file contents.
2. **Empty env (zero actions).** Bundle is still valid; `manifest.action_count` and `code_file_count` are 0; the `code/` folder is empty or absent.
3. **Unknown env oid.** 404 with the standard error envelope.
4. **Round-trip.** Export env → `DELETE /management/v1/environments/:oid` → `POST /management/v1/environments/upload` with the exported `.WFenvirBundle` buffer. After upload, the env exists with the same `local_id`, the same number of actions with matching `local_id` and `action_visibility`, and each action's active code per state is byte-equal to the original source.
5. **Upload extension allowlist.** `.WFenvirBundle` is accepted; the existing extensions still work; an invalid extension still 400s.
6. **Malformed bundle.** Upload of a ZIP without an inner `*.WFenvir` returns 400 with a clear error message naming the file.
7. **Round-trip without code.** Export → delete → re-upload an env that had zero authored code; env + actions return with no code versions; no spurious code rows.

## Client

### New + edited files

| Path                                                   | Status  | Purpose                                                                                                                    |
| ------------------------------------------------------ | ------- | -------------------------------------------------------------------------------------------------------------------------- |
| `apps/console/src/features/explorer/TreeNode.tsx`      | edit    | New row layout, dropdown wiring, `onDeleteError` → `onActionError` rename, date helper.                                    |
| `apps/console/src/features/explorer/ExplorerPanel.tsx` | edit    | Pass renamed callback (`onActionError` instead of `onDeleteError`).                                                        |
| `apps/console/src/features/environments/hooks.ts`      | edit    | Add `useExportEnvironment` and `useGenerateEnvironmentReport`.                                                             |
| `apps/console/src/lib/envir-bundle.ts`                 | **new** | `parseEnvirBundle(blob): Promise<EnvirBundle>` using `jszip`.                                                              |
| `apps/console/src/lib/pdf/environment-report.ts`       | **new** | `generateEnvironmentReportPDF(bundle: EnvirBundle): Blob` using `jspdf`. Pure function — no fetch logic inside.            |
| `apps/console/src/lib/download.ts`                     | **new** | `triggerDownload(blob, filename): void` — `URL.createObjectURL` + temp `<a>`.                                              |
| `apps/console/package.json`                            | edit    | Add `jspdf` and `jszip` as direct **dependencies**. (`jszip` is currently only in the workspace root's `devDependencies`.) |

### Types

The parsed bundle shape is derived from the `.WFenvirBundle` layout. Since the inner `.WFenvir` JSON uses the existing wire shape, most field definitions reuse the protocol's existing parameter-spec shape (`id` + `value_type` + `default_value` per `apps/console/src/lib/types.ts` `InputParameterSpec`).

```ts
// apps/console/src/lib/envir-bundle.ts
export interface BundleManifest {
  format: 'WFenvirBundle'
  format_version: number
  exported_at: string
  container_version: string
  environment_oid: string
  environment_local_id: string
  action_count: number
  code_file_count: number
}

// Subset of fields the PDF needs from the inner .WFenvir's
// environment_specifications[0]. Additional fields the server emits are
// tolerated and ignored.
export interface BundleEnvironment {
  oid: string
  local_id: string
  version: string
  description: string | null
  last_modified_date: string | null
  action_property_specifications: Array<{
    id: string
    value_type: string
    default_value: string
    description: string | null
  }>
}

// Subset of fields the PDF needs per included_action.
export interface BundleAction {
  oid: string
  local_id: string
  version: string
  action_visibility: 'observable' | 'opaque'
  description: string | null
  input_parameter_specifications: Array<{
    id: string
    value_type: string
    default_value: string
    description: string | null
  }>
  output_parameter_specifications: Array<{
    id: string
    value_type: string
    default_value: string
    description: string | null
  }>
}

export interface BundleActionEntry {
  record: BundleAction
  code: Record<string, string> // state name → Python source for the active version
}

export interface EnvirBundle {
  manifest: BundleManifest
  environment: BundleEnvironment
  actions: BundleActionEntry[]
}
```

Only `useGenerateEnvironmentReport` calls `parseEnvirBundle`; `useExportEnvironment` writes the raw blob straight to disk without parsing. The exact field set the server emits inside `<local_id>.WFenvir` is whatever `buildEnvironmentBundle` chooses — the shape above is the minimum the PDF needs; extra fields are accepted and ignored.

### Hook contracts

```ts
// apps/console/src/features/environments/hooks.ts
export function useExportEnvironment(
  oid: string,
  localId: string
): {
  run: () => Promise<void>
  isPending: boolean
  error: Error | null
}
// 1. fetch GET /management/v1/environments/:oid/export-bundle → Blob
// 2. triggerDownload(blob, `${localId}.WFenvirBundle`)

export function useGenerateEnvironmentReport(
  oid: string,
  localId: string
): {
  run: () => Promise<void>
  isPending: boolean
  error: Error | null
}
// 1. fetch GET /management/v1/environments/:oid/export-bundle → Blob
// 2. parseEnvirBundle(blob) → EnvirBundle
// 3. generateEnvironmentReportPDF(bundle) → Blob
// 4. triggerDownload(blob, `${localId}-report.pdf`)
```

Both hooks are imperative (no React Query mutation) — `useState` + `useCallback` only. The shared shape lets `EnvironmentNode` render uniform disabled / "Working…" states.

### Lazy loading

Both `jspdf` and `jszip` are loaded lazily via dynamic `import()` inside the hooks (e.g., `const { default: JSZip } = await import('jszip')`). Vite splits them into a separate chunk that only downloads on first menu use. This keeps the initial `apps/console` bundle weight unchanged for users who never open the menu.

### Error surfacing

`EnvironmentNode` accepts a renamed `onActionError(message: string)` prop. All three actions (Export, PDF, Delete) call this on failure. The parent — currently the Explorer panel — renders the message in whatever surface it already uses for delete errors (no new toast system).

## PDF content

A4 portrait, single document, page numbers in footer. Built-in `Helvetica` for prose (sizes: 18 title, 12 section headers, 10 body, 8 footer/small) and built-in `Courier` for code (size 8).

### Page 1 — environment cover

- Title: `<env.local_id>` (18 pt).
- Subtitle line: `v{version} · imported {full date} · {action_count} actions`.
- `description` (if non-empty), wrapped.
- Section "Environment action properties" — table with columns `name | data_type | default_value`. If the env has no `environment_action_properties`, render `(none)`.
- Section "Actions" — compact numbered list `1. <local_id>   observable|opaque`. No code or parameters here; this is the overview.

### Per-action pages

One section per action, starting on a new page only when the remaining page height is below ~80 mm; otherwise the section flows continuously.

Per action:

1. Header: `<local_id>` (12 pt, left) and `observable|opaque` (10 pt, right).
2. Description (if any), wrapped.
3. "Input parameters" — table `name | description | default`. `(no input parameters)` if empty.
4. "Output parameters" — table `name | description`. `(no output parameters)` if empty.
5. "Code segments" — for each state in `states_with_code`, a sub-header `▸ <STATE>` followed by the active code source in `Courier 8`. `(no code segments authored)` if the action has no code.

### Page-break / wrap behavior

- Code blocks may break across pages. Continuation pages render a sub-header `<local_id> › <STATE> (continued)`.
- Lines longer than the page width hard-wrap (PDF can't scroll). A subtle continuation marker `↵` indicates the wrap.
- A small grey strip at the top of every page after the cover: `<env.local_id> · v{version} · page X of Y`.
- Footer of every page: generation timestamp in ISO local time.
- Tables use thin (0.2 mm) horizontal row dividers, no background fills, so the document prints cleanly in monochrome.

### Filename

`<local_id>-report.pdf`. The browser's default download location.

## Testing

### Server (vitest)

`packages/server/src/__tests__/environment-bundle.test.ts` — covers the 7 cases listed in [Server § Tests](#tests).

### Client (vitest)

- `apps/console/src/lib/envir-bundle.test.ts` — feeds a hand-built ZIP fixture into `parseEnvirBundle`; asserts the returned `EnvirBundle` shape; rejects malformed archives (missing `manifest.json`, missing inner `*.WFenvir`, `environment_specifications` empty or non-array).
- `apps/console/src/lib/pdf/environment-report.test.ts` — feeds a synthetic `EnvirBundle` into `generateEnvironmentReportPDF`; asserts the returned Blob has the `%PDF-` magic header and a non-trivial size. We don't pixel-snapshot the output. For text-presence checks we use jsPDF's `output('arraybuffer')` and check that key strings (env local_id, action local_ids) appear in the raw bytes.
- `apps/console/src/features/explorer/TreeNode.test.tsx` — env row renders the two-line layout, dropdown opens with three items in the expected order, Delete still triggers the `window.confirm` flow and `useDeleteEnvironment.mutateAsync`. The two hook-bound items render disabled "Working…" while `isPending`.

### Manual smoke (post-merge)

- Deploy Kitchen env via the existing upload path, then export via the new menu item, delete the env, re-upload the exported `.WFenvirBundle`, confirm the 10 Kitchen actions return with intact code (curl `/capabilities` count + spot-check one action's code).
- Generate the Kitchen PDF; eyeball all 10 actions with parameters and code segments rendered. Confirm long code wraps cleanly and the per-page header is correct.

## Acceptance criteria

1. `EnvironmentNode` renders the two-line row with the metadata line under the name.
2. The hover-revealed kebab opens a Radix `DropdownMenu` with three items: Export environment, Generate PDF report, Delete environment.
3. `GET /management/v1/environments/:oid/export-bundle` returns a `.WFenvirBundle` ZIP matching the documented layout.
4. The exported `.WFenvirBundle` round-trips through `POST /management/v1/environments/upload` — after delete + re-upload, the env returns with the same actions and byte-equal active code per state.
5. Generate PDF report produces a single-document PDF listing each action's parameters and code segments per the [PDF content](#pdf-content) layout.
6. Existing delete UX is preserved (`window.confirm`, error bubble, no surprise behavior).
7. `tsc -b` clean. Vitest server + client suites pass with the new tests added.
8. Initial `apps/console` bundle size is unchanged for users who never open the menu (lazy-loaded `jspdf` + `jszip`).

## Risks

1. **Bundle weight.** `jspdf` + `jszip` are not trivial. Mitigated by lazy `import()` inside the hooks; verified by `npm run build --workspace=@trajectory/console` showing the main chunk unchanged and a new lazy chunk created.
2. **jsPDF Unicode.** Built-in fonts are WinAnsi only — non-Latin characters in code or descriptions get rendered as `?`. Documented as a known limitation for this iteration.
3. **Large environments.** A 50-action env with ~10 KB code per state could produce a 5–10 MB PDF held in browser memory. Acceptable for current scenarios; we revisit if it becomes a real problem.
4. **Extension allowlist regex.** Existing extension check uses `ext === 'wfenvir' | 'wfenvirx' | ...`. Adding `'wfenvirbundle'` is a literal compare so no overlap risk. The detection branch inside the parser must be ordered so `wfenvirbundle` is checked before any prefix-match logic if introduced later.
5. **Round-trip OID identity.** The bundle preserves env + action OIDs. If a re-upload happens while a previous instance of the env still exists (the user forgot to delete), the upload upserts in place — same behavior as today's `.WFenvirX` upload. Documented as expected.
6. **Two-line row height regression.** Tree gets taller per env; could affect scroll feel with many envs. Eyeball with Warehouse + Kitchen both deployed and adjust line-height if needed.

## File touch list

**Server:**

- `packages/server/src/routes/export-import.ts` — add `GET /environments/:oid/export-bundle` route + `buildEnvironmentBundle` helper.
- `packages/server/src/routes/management.ts` — extend upload extension allowlist to include `wfenvirbundle`; add `'wfenvirbundle'` branch to the `ParsedFile` union + parsing loop + transaction loop.
- `packages/server/src/__tests__/environment-bundle.test.ts` — **new**.

**Client:**

- `apps/console/package.json` — add `jspdf` + `jszip` deps.
- `apps/console/src/features/explorer/TreeNode.tsx` — rewrite `EnvironmentNode`.
- `apps/console/src/features/explorer/ExplorerPanel.tsx` — rename `onDeleteError` → `onActionError` at the callsite.
- `apps/console/src/features/environments/hooks.ts` — add `useExportEnvironment`, `useGenerateEnvironmentReport`.
- `apps/console/src/lib/envir-bundle.ts` — **new**.
- `apps/console/src/lib/pdf/environment-report.ts` — **new**.
- `apps/console/src/lib/download.ts` — **new**.
- `apps/console/src/lib/envir-bundle.test.ts` — **new**.
- `apps/console/src/lib/pdf/environment-report.test.ts` — **new**.
- `apps/console/src/features/explorer/TreeNode.test.tsx` — **new** (or extend existing).
