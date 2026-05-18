# Action Container — Environment & Action Detail Redesign

**Date:** 2026-05-08
**Status:** Draft for review
**Scope:** Console UI (apps/console) + Management API (packages/server)

## Background

The Action Container console currently inherits a layout that mixes Workflow concerns (Value Properties, Resource Properties) with Action concerns. Action Container only edits actions and the code attached to ISA-88 / opaque states — it does not edit workflows. This design strips the workflow-only sections, introduces a right-side properties pane modeled on TrajectoryEditor's `PropertiesPanel`, and adds two missing actions (Clear Code, Cancel in editor).

## Goals

1. Mirror TrajectoryEditor's right-pane pattern so users moving between the two consoles get a consistent layout.
2. Keep the center pane focused on the primary artifact: the Actions table on the environment page, the Code Status table on the action page.
3. Remove sections that exist only because of shared types (Value Properties, Resource Properties) but have no Action Container use case.
4. Make it possible to wipe all code for a state in one click, and to cancel out of the inline code editor without saving.

## Non-goals

- No new dark/light mode work — toggle already exists at `apps/console/src/layout/TopNav.tsx:53-59`.
- No changes to the `EnvironmentDetail` API response shape. Value/Resource property fields stay in the type and on the wire; the console just stops rendering them.
- No changes to the workflow-editor side of TrajectoryEditor.
- No changes to instance views, log, dashboard, or settings routes.

## Architecture

### New: shared right-pane shell

A page-driven right pane modeled on TrajectoryEditor `src/components/properties/PropertiesPanel.tsx` and the host route's resize/collapse harness. Implemented as two new files plus a `Layout.tsx` integration.

**`apps/console/src/layout/RightPaneContext.tsx`** — context provider exposing:

```ts
interface RightPaneContextValue {
  header: { eyebrow: string; name: string } | null
  content: React.ReactNode | null
  setPane: (pane: { header; content } | null) => void
}
```

A page calls `setPane` from a `useEffect` to register its content. On unmount the effect returns a cleanup that calls `setPane(null)`. When `header` and `content` are both null, `Layout.tsx` does not render the pane.

**`apps/console/src/layout/RightPane.tsx`** — the visual shell:

- Sticky 12-line header showing `eyebrow` (uppercase tracked label, e.g. `ENVIRONMENT`) and `name` (semibold, truncated). Right side has a `PanelRight` collapse icon.
- Body is `overflow-y-auto`, takes children straight from context.
- Left edge is a 4px draggable resize handle; on `mousedown` starts a `mousemove` listener that updates a `ref`-stored width and rewrites `style.width`. On `mouseup` persists the final width to `localStorage` (avoids per-frame writes).
- Width state: `localStorage["console:rightPaneWidth"]` (number, default 360, clamped `[280, 640]`).
- Collapsed state: `localStorage["console:rightPaneCollapsed"]` (boolean). Collapsed pane renders a 28px gutter with a `PanelLeft` icon to expand. Width is preserved across collapse/expand.

**`apps/console/src/layout/Layout.tsx`** — render `<RightPane />` after `<main>`, inside the existing flex row. RightPane returns `null` when context has no content registered, so unaffected routes are unchanged.

### Pane registration helper

A small hook in the same context module:

```ts
function useRegisterRightPane(pane: { header; content } | null) {
  const { setPane } = useContext(RightPaneContext)
  useEffect(() => {
    setPane(pane)
    return () => setPane(null)
  }, [pane])
}
```

Pages compose section JSX, pass it through, and the pane re-renders on prop change. `pane` is recomputed each render but the effect dep is the object reference — pages should `useMemo` it on the relevant data.

## Page-level changes

### Environment detail page (`apps/console/src/features/environments/EnvironmentDetailPage.tsx`)

**Center retains:**

- Back link
- Header block (title, version chip, description, OID, imported/last-modified)

**Right pane receives, in order:**

1. Action Properties card (existing render, untouched styling)
2. Actions card (existing `ActionsTable`)

**Removed (deleted code, not hidden):**

- Value Properties card and the `value_property_specifications` rendering block
- Resource Properties card and the `resource_property_specifications` rendering block

**Pane header:** `{ eyebrow: 'ENVIRONMENT', name: '${local_id} v${version}' }`.

The destructure of `value_property_specifications` and `resource_property_specifications` from `data` is removed. The fields remain on the `EnvironmentDetail` type because they're returned by the backend; the console just stops rendering them. No type or API change.

### Action detail page (`apps/console/src/features/actions/ActionDetailPage.tsx`)

**Center retains:**

- Breadcrumb
- Header block (title, version chip, visibility badge, description, OID, environment link, last code update)
- Export/Import buttons
- **Code Status card** (the focal artifact for this page, now with a Clear Code action — see next section)

**Right pane receives, in order:**

1. Input Parameters card
2. Output Parameters card
3. Action Properties card (when `property_specifications.length > 0`)
4. Execution Settings card (the existing `TimeoutSection`)

**Pane header:** `{ eyebrow: 'ACTION', name: '${local_id} v${version}' }`.

### Code Status table — Clear Code column

In `CodeStatusSection` inside `ActionDetailPage.tsx`, replace the single Edit link in the Action column with two affordances when the state has code:

```
| State      | Code      | Action                |
| STARTING   | active    | Edit  ·  Clear Code   |
| EXECUTING  | no code   | Edit                  |
```

`Clear Code` is a button styled as a destructive text link (`text-destructive hover:underline`). Clicking opens a confirm dialog using the existing `Dialog` primitive from `@trajectory/ui` (same one `SaveDialog.tsx` uses). Confirm copy:

> **Delete all code for `<STATE>`?**
> This removes the active version and all version history for this state. This cannot be undone.
>
> [ Cancel ] [ Delete all versions ]

On confirm: call `useClearCode().mutate({ actionOid, state })`, invalidate the `action(oid)` query so Code Status, the diagram, and version history refresh.

### Inline code editor — Cancel button (`apps/console/src/features/code-editor/InlineCodeEditorPage.tsx`)

Add a `Cancel` button to the bottom action bar, left of `Save`:

```
[Cancel]  [Save]  [Test]  [History]
```

Cancel handler:

```ts
function handleCancel() {
  if (isDirty) {
    if (!confirm('Discard unsaved changes?')) return
  }
  navigate(`/actions/${actionOid}`)
}
```

`useNavigate` from `react-router`. The breadcrumb links in the param bar at top are left untouched — they navigate freely without the dirty check, matching their existing behavior.

## API & data layer changes

### New endpoint: `DELETE /management/v1/code/:action_oid/:state`

**Location:** `packages/server/src/routes/management.ts`, sibling to the existing `MGMT-11` handler at line 1022.

**Behavior:**

- Validate `action_oid` exists (404 if not, matching the existing per-version DELETE).
- Validate `state` is a known state for that action's visibility (400 if not, matching POST behavior).
- `DELETE FROM code_versions WHERE action_oid = ? AND state = ?` — single SQL, no per-row loop.
- Response: `{ data: { deleted_version_count: number }, meta: {} }`. HTTP 200.
- If the state had no code, `deleted_version_count: 0` — this is success, not 404. Idempotent.

**Repository:** add `clearCodeForState(action_oid, state): number` to `packages/storage/src/repositories/code-version.repository.ts`, returning the affected row count from `db.prepare(...).run(...).changes`.

**Test:** add a case to `packages/server/src/__tests__/management-code.test.ts` covering: (a) clears all versions including history, (b) returns count, (c) idempotent on empty state, (d) does not affect other states of the same action, (e) does not affect the same state on other actions.

### Frontend client (`apps/console/src/lib/api.ts`)

```ts
clearCode: (actionOid: string, state: string): Promise<{ deleted_version_count: number }> =>
  apiFetch(`/code/${actionOid}/${state}`, { method: 'DELETE' }),
```

### React Query mutation (`apps/console/src/features/actions/hooks.ts`)

```ts
export function useClearCode() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ actionOid, state }: { actionOid: string; state: string }) =>
      api.clearCode(actionOid, state),
    onSuccess: (_data, { actionOid }) => {
      qc.invalidateQueries({ queryKey: ['action', actionOid] })
      qc.invalidateQueries({ queryKey: ['codeVersions', actionOid] })
      qc.invalidateQueries({ queryKey: ['activeCode', actionOid] })
    },
  })
}
```

Match the precise `queryKey` shapes used elsewhere in `hooks.ts` at implementation time.

## Files touched

| File                                                               | Type                                                   |
| ------------------------------------------------------------------ | ------------------------------------------------------ |
| `apps/console/src/layout/RightPane.tsx`                            | NEW                                                    |
| `apps/console/src/layout/RightPaneContext.tsx`                     | NEW                                                    |
| `apps/console/src/layout/Layout.tsx`                               | edit — render RightPane, wrap in provider              |
| `apps/console/src/features/environments/EnvironmentDetailPage.tsx` | edit — register pane, delete Value/Resource Properties |
| `apps/console/src/features/actions/ActionDetailPage.tsx`           | edit — register pane, add Clear Code column            |
| `apps/console/src/features/code-editor/InlineCodeEditorPage.tsx`   | edit — add Cancel button + handler                     |
| `apps/console/src/lib/api.ts`                                      | edit — add `clearCode`                                 |
| `apps/console/src/features/actions/hooks.ts`                       | edit — add `useClearCode`                              |
| `packages/server/src/routes/management.ts`                         | edit — new DELETE route                                |
| `packages/storage/src/repositories/code-version.repository.ts`     | edit — add `clearCodeForState`                         |
| `packages/server/src/__tests__/management-code.test.ts`            | edit — add Clear Code tests                            |

## Testing

- **Manual UI walk-through** on dev server:
  - Environment page: pane shows Action Properties + Actions; Value/Resource sections gone; collapse/expand and resize persist across reload.
  - Action page: pane shows Input/Output/Action Properties/Execution Settings; Code Status stays center; Clear Code dialog appears, deletion clears the row's `active` badge and the diagram dot, and version history empties.
  - State editor: Cancel with no changes → instant nav to action page; Cancel with edits → confirm dialog, discard navigates, keep stays.
- **Backend test** in `management-code.test.ts` (5 cases listed above).
- **Type check + existing test suite** must still pass: `pnpm -w typecheck` and `pnpm -w test`.

## Out of scope / future

- Persistence of pane width per-page (current spec stores one width across all pages).
- Keyboard shortcut for collapse (`Cmd-\` etc.).
- Animated collapse transition.
- Migration of existing routes (Instances, Log, Settings, Dashboard) into the right-pane pattern — they don't currently need it.
- Surfacing the deleted-version-count in a toast — current spec just refreshes silently. Add later if useful.
