# Action Container Detail Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move per-environment and per-action properties to a TrajectoryEditor-style right-side pane, delete workflow-only sections (Value/Resource Properties), add Clear Code action with new backend endpoint, and add Cancel button to the inline code editor.

**Architecture:** A `RightPaneContext` lets pages register pane content; a `RightPane` shell renders it with resize + collapse persisted to localStorage. The Code Status table on the action page gets a destructive `Clear Code` link backed by a new `DELETE /code/:action_oid/:state` endpoint that wipes all versions for a state.

**Tech Stack:** React 19, react-router 7, TanStack Query 5, TypeScript, Express 5, better-sqlite3, vitest + supertest. Console UI uses `@trajectory/ui` primitives (Dialog, Button, Input) and `lucide-react` icons.

**Spec:** `docs/specs/2026-05-08-action-container-detail-redesign-design.md`

---

## File Structure

| File                                                               | Role                                                                                                             |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `apps/console/src/layout/RightPaneContext.tsx`                     | NEW. Context + `useRegisterRightPane` hook for pages to register content.                                        |
| `apps/console/src/layout/RightPane.tsx`                            | NEW. Visual shell: header, scrollable body, resize handle, collapse. Reads context.                              |
| `apps/console/src/layout/Layout.tsx`                               | Wraps `<Outlet>` in `<RightPaneProvider>`; renders `<RightPane />` after `<main>`.                               |
| `apps/console/src/lib/api.ts`                                      | Adds `clearCode(actionOid, state)`.                                                                              |
| `apps/console/src/features/actions/hooks.ts`                       | Adds `useClearCode()` mutation.                                                                                  |
| `apps/console/src/features/environments/EnvironmentDetailPage.tsx` | Registers right pane (Action Properties + Actions); deletes Value/Resource sections.                             |
| `apps/console/src/features/actions/ActionDetailPage.tsx`           | Registers right pane (Input/Output/Action Props/Execution Settings); adds Clear Code column with confirm dialog. |
| `apps/console/src/features/code-editor/InlineCodeEditorPage.tsx`   | Adds Cancel button with dirty-check.                                                                             |
| `packages/storage/src/repositories/code-version.repository.ts`     | Adds `clearByActionAndState(action_oid, state) → number`.                                                        |
| `packages/server/src/routes/management.ts`                         | Adds DELETE `/code/:action_oid/:state` route.                                                                    |
| `packages/server/src/__tests__/management-code.test.ts`            | Adds 5 test cases for the new endpoint.                                                                          |

---

### Task 1: Backend — clearByActionAndState repository + DELETE route + tests

**Files:**

- Modify: `packages/storage/src/repositories/code-version.repository.ts`
- Modify: `packages/server/src/routes/management.ts`
- Modify: `packages/server/src/__tests__/management-code.test.ts`

- [ ] **Step 1: Add prepared statement and method to the repository**

In `packages/storage/src/repositories/code-version.repository.ts`, alongside the existing `stmtDeleteByAction` declaration (around line 14), add a new prepared statement:

```ts
private readonly stmtDeleteByActionState: BetterSqlite3.Statement
```

Initialize it inside the constructor next to the existing `stmtDeleteByAction = db.prepare(...)`:

```ts
this.stmtDeleteByActionState = db.prepare(`
  DELETE FROM code_versions WHERE action_oid = ? AND state = ?
`)
```

Add a public method below the existing `deleteByAction` method:

```ts
clearByActionAndState(actionOid: string, state: string): number {
  const result = this.stmtDeleteByActionState.run(actionOid, state)
  return result.changes
}
```

- [ ] **Step 2: Add the failing tests**

In `packages/server/src/__tests__/management-code.test.ts`, find the existing `describe('MGMT-11', ...)` block (DELETE per-version) and add a new `describe` block immediately after it:

```ts
describe('MGMT-CLEAR: DELETE /code/:action_oid/:state — Clear Code', () => {
  let testApp: TestApp

  beforeAll(() => {
    testApp = createTestApp()
  })

  afterAll(async () => {
    await testApp.manager.shutdown()
    testApp.db.close()
  })

  it('deletes all versions for a state and returns deleted_version_count', async () => {
    // Seed environment + action + 3 versions
    const env = testApp.environmentRepo.save({
      local_id: 'env-clear-1',
      version: '1.0.0',
      description: null,
      action_property_specifications: [],
      value_property_specifications: [],
      resource_property_specifications: [],
      schema_version: '1.0',
    })
    const action = testApp.actionRepo.save({
      environment_oid: env.oid,
      local_id: 'act-clear-1',
      version: '1.0.0',
      description: null,
      action_visibility: 'observable',
      input_parameter_specifications: [],
      output_parameter_specifications: [],
      property_specifications: [],
      schema_version: '1.0',
    })
    testApp.codeVersionRepo.save({ action_oid: action.oid, state: 'STARTING', source_code: 'a' })
    testApp.codeVersionRepo.save({ action_oid: action.oid, state: 'STARTING', source_code: 'b' })
    testApp.codeVersionRepo.saveAndActivate({
      action_oid: action.oid,
      state: 'STARTING',
      source_code: 'c',
    })

    const res = await request(testApp.app)
      .delete(`/management/v1/code/${action.oid}/STARTING`)
      .expect(200)

    expect(res.body.data.deleted_version_count).toBe(3)
    expect(testApp.codeVersionRepo.getVersionHistory(action.oid, 'STARTING')).toEqual([])
  })

  it('is idempotent on a state with no code (returns 0)', async () => {
    const env = testApp.environmentRepo.save({
      local_id: 'env-clear-2',
      version: '1.0.0',
      description: null,
      action_property_specifications: [],
      value_property_specifications: [],
      resource_property_specifications: [],
      schema_version: '1.0',
    })
    const action = testApp.actionRepo.save({
      environment_oid: env.oid,
      local_id: 'act-clear-2',
      version: '1.0.0',
      description: null,
      action_visibility: 'observable',
      input_parameter_specifications: [],
      output_parameter_specifications: [],
      property_specifications: [],
      schema_version: '1.0',
    })

    const res = await request(testApp.app)
      .delete(`/management/v1/code/${action.oid}/EXECUTING`)
      .expect(200)

    expect(res.body.data.deleted_version_count).toBe(0)
  })

  it('does not affect other states of the same action', async () => {
    const env = testApp.environmentRepo.save({
      local_id: 'env-clear-3',
      version: '1.0.0',
      description: null,
      action_property_specifications: [],
      value_property_specifications: [],
      resource_property_specifications: [],
      schema_version: '1.0',
    })
    const action = testApp.actionRepo.save({
      environment_oid: env.oid,
      local_id: 'act-clear-3',
      version: '1.0.0',
      description: null,
      action_visibility: 'observable',
      input_parameter_specifications: [],
      output_parameter_specifications: [],
      property_specifications: [],
      schema_version: '1.0',
    })
    testApp.codeVersionRepo.saveAndActivate({
      action_oid: action.oid,
      state: 'STARTING',
      source_code: 's',
    })
    testApp.codeVersionRepo.saveAndActivate({
      action_oid: action.oid,
      state: 'EXECUTING',
      source_code: 'e',
    })

    await request(testApp.app).delete(`/management/v1/code/${action.oid}/STARTING`).expect(200)

    expect(testApp.codeVersionRepo.getActive(action.oid, 'STARTING')).toBeNull()
    expect(testApp.codeVersionRepo.getActive(action.oid, 'EXECUTING')?.source_code).toBe('e')
  })

  it('does not affect the same state on other actions', async () => {
    const env = testApp.environmentRepo.save({
      local_id: 'env-clear-4',
      version: '1.0.0',
      description: null,
      action_property_specifications: [],
      value_property_specifications: [],
      resource_property_specifications: [],
      schema_version: '1.0',
    })
    const a1 = testApp.actionRepo.save({
      environment_oid: env.oid,
      local_id: 'a1',
      version: '1.0.0',
      description: null,
      action_visibility: 'observable',
      input_parameter_specifications: [],
      output_parameter_specifications: [],
      property_specifications: [],
      schema_version: '1.0',
    })
    const a2 = testApp.actionRepo.save({
      environment_oid: env.oid,
      local_id: 'a2',
      version: '1.0.0',
      description: null,
      action_visibility: 'observable',
      input_parameter_specifications: [],
      output_parameter_specifications: [],
      property_specifications: [],
      schema_version: '1.0',
    })
    testApp.codeVersionRepo.saveAndActivate({
      action_oid: a1.oid,
      state: 'STARTING',
      source_code: '1',
    })
    testApp.codeVersionRepo.saveAndActivate({
      action_oid: a2.oid,
      state: 'STARTING',
      source_code: '2',
    })

    await request(testApp.app).delete(`/management/v1/code/${a1.oid}/STARTING`).expect(200)

    expect(testApp.codeVersionRepo.getActive(a1.oid, 'STARTING')).toBeNull()
    expect(testApp.codeVersionRepo.getActive(a2.oid, 'STARTING')?.source_code).toBe('2')
  })

  it('returns 404 when action_oid does not exist', async () => {
    const res = await request(testApp.app)
      .delete('/management/v1/code/00000000-0000-0000-0000-000000000000/STARTING')
      .expect(404)

    expect(res.body.error).toBeDefined()
  })
})
```

> If the seed-call signatures (`environmentRepo.save`, `actionRepo.save`, `codeVersionRepo.save`) differ from the patterns above, copy the exact shape from a passing test elsewhere in the same file. Don't invent fields.

- [ ] **Step 3: Run tests to confirm they fail**

```
npm test -- packages/server/src/__tests__/management-code.test.ts
```

Expected: the 5 new tests fail with 404 (no route registered) or similar route-not-found symptom.

- [ ] **Step 4: Implement the route**

In `packages/server/src/routes/management.ts`, immediately **after** the `MGMT-11 (parameterized): DELETE /code/:action_oid/:state/:version_id` handler ends (around line 1076) and **before** the `MGMT-07: GET /code/:action_oid/:state` handler at line 1078, add:

```ts
// --------------------------------------------------------
// MGMT-CLEAR: DELETE /code/:action_oid/:state
// Wipes all versions (active + history) for a state. Idempotent.
// --------------------------------------------------------
router.delete('/code/:action_oid/:state', (req, res, next) => {
  try {
    const action_oid = req.params.action_oid as string
    const state = req.params.state as string

    const action = actionRepo.findByOid(action_oid)
    if (!action) {
      return res.status(404).json({
        error: { code: 'ACTION_NOT_FOUND', message: `Action not found: ${action_oid}` },
      })
    }

    const deleted_version_count = codeVersionRepo.clearByActionAndState(action_oid, state)

    res.status(200).json({
      data: { deleted_version_count },
      meta: {},
    })
  } catch (err) {
    next(err)
  }
})
```

> Route order matters in Express. Declaring this route **after** the 3-segment `/:action_oid/:state/:version_id` route ensures `DELETE /code/foo/bar/baz` still hits the version-specific handler first; this 2-segment route only matches when there's no `version_id`.

> Method names: confirm `actionRepo.findByOid` matches the helper used by the existing MGMT-11 handler at line 1023. If the existing handler uses a different lookup (e.g., `actionRepo.findById`, `actionRepo.get`), copy that exact name.

- [ ] **Step 5: Run tests to verify they pass**

```
npm test -- packages/server/src/__tests__/management-code.test.ts
```

Expected: all MGMT-CLEAR tests pass; no regressions in MGMT-07..12.

- [ ] **Step 6: Commit**

```
git add packages/storage/src/repositories/code-version.repository.ts packages/server/src/routes/management.ts packages/server/src/__tests__/management-code.test.ts
git commit -m "feat(management): DELETE /code/:oid/:state clears all versions"
```

---

### Task 2: Frontend — clearCode API client + useClearCode hook

**Files:**

- Modify: `apps/console/src/lib/api.ts`
- Modify: `apps/console/src/features/actions/hooks.ts`

- [ ] **Step 1: Add clearCode to the api client**

In `apps/console/src/lib/api.ts`, add this method to the `api` object **after** `deleteVersion` (around line 131) and **before** `testCode`:

```ts
  clearCode: (
    actionOid: string,
    state: string
  ): Promise<{ deleted_version_count: number }> =>
    apiFetch(`/code/${actionOid}/${state}`, { method: 'DELETE' }),
```

- [ ] **Step 2: Read the existing hooks.ts to find the exact query-key shape**

```
cat apps/console/src/features/actions/hooks.ts
```

Identify:

- The `useAction` query key (likely `['action', oid]`).
- Whether the file imports `useMutation` and `useQueryClient` from `@tanstack/react-query`. If not, you'll add them.

- [ ] **Step 3: Add the useClearCode mutation**

In `apps/console/src/features/actions/hooks.ts`, ensure the imports include:

```ts
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query'
```

(Adjust to add only what's missing.) Then add the mutation hook **after** `useUpdateActionTimeout`:

```ts
export function useClearCode() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ actionOid, state }: { actionOid: string; state: string }) =>
      api.clearCode(actionOid, state),
    onSuccess: (_data, { actionOid, state }) => {
      qc.invalidateQueries({ queryKey: ['action', actionOid] })
      qc.invalidateQueries({ queryKey: ['codeVersions', actionOid, state] })
      qc.invalidateQueries({ queryKey: ['activeCode', actionOid, state] })
    },
  })
}
```

> If the existing keys use a different shape (e.g., a single string key or different ordering), match what's already in `apps/console/src/features/code-editor/hooks.ts`. Inconsistent keys mean the cache won't refresh.

- [ ] **Step 4: Verify type check passes**

```
npm run build
```

Expected: clean build, no TS errors.

- [ ] **Step 5: Commit**

```
git add apps/console/src/lib/api.ts apps/console/src/features/actions/hooks.ts
git commit -m "feat(console): clearCode api client + useClearCode hook"
```

---

### Task 3: RightPaneContext

**Files:**

- Create: `apps/console/src/layout/RightPaneContext.tsx`

- [ ] **Step 1: Create the context module**

Write `apps/console/src/layout/RightPaneContext.tsx`:

```tsx
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

export interface RightPaneHeader {
  eyebrow: string
  name: string
}

export interface RightPanePayload {
  header: RightPaneHeader
  content: ReactNode
}

interface RightPaneContextValue {
  payload: RightPanePayload | null
  setPayload: (payload: RightPanePayload | null) => void
}

const RightPaneContext = createContext<RightPaneContextValue | null>(null)

export function RightPaneProvider({ children }: { children: ReactNode }) {
  const [payload, setPayload] = useState<RightPanePayload | null>(null)
  const value = useMemo(() => ({ payload, setPayload }), [payload])
  return <RightPaneContext.Provider value={value}>{children}</RightPaneContext.Provider>
}

export function useRightPane(): RightPaneContextValue {
  const ctx = useContext(RightPaneContext)
  if (!ctx) throw new Error('useRightPane must be used within RightPaneProvider')
  return ctx
}

/**
 * Register pane content for the current page. Pass `null` when the page
 * has nothing to put in the pane. Pass a memoized object otherwise — a
 * fresh object every render will re-trigger the effect harmlessly but
 * thrash the pane re-render.
 */
export function useRegisterRightPane(payload: RightPanePayload | null): void {
  const { setPayload } = useRightPane()
  useEffect(() => {
    setPayload(payload)
    return () => setPayload(null)
  }, [payload, setPayload])
}
```

- [ ] **Step 2: Verify type check passes**

```
npm run build
```

Expected: clean build.

- [ ] **Step 3: Commit**

```
git add apps/console/src/layout/RightPaneContext.tsx
git commit -m "feat(console): RightPaneContext + useRegisterRightPane"
```

---

### Task 4: RightPane shell component

**Files:**

- Create: `apps/console/src/layout/RightPane.tsx`

- [ ] **Step 1: Create the component**

Write `apps/console/src/layout/RightPane.tsx`:

```tsx
import { useCallback, useEffect, useRef, useState } from 'react'
import { PanelRight, PanelLeft } from 'lucide-react'
import { useRightPane } from './RightPaneContext'

const WIDTH_KEY = 'console:rightPaneWidth'
const COLLAPSED_KEY = 'console:rightPaneCollapsed'
const DEFAULT_WIDTH = 360
const MIN_WIDTH = 280
const MAX_WIDTH = 640

function readWidth(): number {
  if (typeof window === 'undefined') return DEFAULT_WIDTH
  const raw = window.localStorage.getItem(WIDTH_KEY)
  const parsed = raw ? parseInt(raw, 10) : NaN
  if (Number.isNaN(parsed)) return DEFAULT_WIDTH
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, parsed))
}

function readCollapsed(): boolean {
  if (typeof window === 'undefined') return false
  return window.localStorage.getItem(COLLAPSED_KEY) === '1'
}

export default function RightPane() {
  const { payload } = useRightPane()
  const [width, setWidth] = useState<number>(() => readWidth())
  const [collapsed, setCollapsed] = useState<boolean>(() => readCollapsed())
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null)

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      dragRef.current = { startX: e.clientX, startWidth: width }
      document.body.style.userSelect = 'none'

      const onMove = (ev: MouseEvent) => {
        if (!dragRef.current) return
        const dx = dragRef.current.startX - ev.clientX
        const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, dragRef.current.startWidth + dx))
        setWidth(next)
      }
      const onUp = () => {
        document.body.style.userSelect = ''
        if (dragRef.current) {
          window.localStorage.setItem(WIDTH_KEY, String(width))
        }
        dragRef.current = null
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    },
    [width]
  )

  // Persist width on every change after the drag (covers the final value)
  useEffect(() => {
    window.localStorage.setItem(WIDTH_KEY, String(width))
  }, [width])

  const toggleCollapsed = useCallback(() => {
    setCollapsed((c) => {
      const next = !c
      window.localStorage.setItem(COLLAPSED_KEY, next ? '1' : '0')
      return next
    })
  }, [])

  if (!payload) return null

  if (collapsed) {
    return (
      <div className="w-7 bg-[var(--side-panel)] border-l border-border shrink-0 flex items-start justify-center pt-2">
        <button
          onClick={toggleCollapsed}
          title="Show properties pane"
          className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
        >
          <PanelLeft size={14} />
        </button>
      </div>
    )
  }

  return (
    <aside
      className="relative bg-[var(--side-panel)] border-l border-border shrink-0 flex flex-col overflow-hidden"
      style={{ width }}
    >
      {/* Resize handle (left edge) */}
      <div
        onMouseDown={handleMouseDown}
        className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-primary/30 z-10"
        aria-label="Resize properties pane"
      />

      {/* Sticky header */}
      <div className="sticky top-0 z-20 h-12 px-3 flex items-center justify-between border-b border-border bg-[var(--side-panel)] shrink-0">
        <div className="flex flex-col min-w-0">
          <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {payload.header.eyebrow}
          </span>
          <span className="text-sm font-medium text-foreground truncate">
            {payload.header.name}
          </span>
        </div>
        <button
          onClick={toggleCollapsed}
          title="Hide properties pane"
          className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground shrink-0 ml-2"
        >
          <PanelRight size={14} />
        </button>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto p-3 space-y-4">{payload.content}</div>
    </aside>
  )
}
```

- [ ] **Step 2: Verify type check passes**

```
npm run build
```

Expected: clean build.

- [ ] **Step 3: Commit**

```
git add apps/console/src/layout/RightPane.tsx
git commit -m "feat(console): RightPane shell with resize + collapse"
```

---

### Task 5: Wire RightPane into Layout

**Files:**

- Modify: `apps/console/src/layout/Layout.tsx`

- [ ] **Step 1: Update Layout to render the pane**

Replace the entire contents of `apps/console/src/layout/Layout.tsx` with:

```tsx
import { Outlet } from 'react-router'
import TopNav from './TopNav'
import ActivityBar from './ActivityBar'
import SidePanel from './SidePanel'
import StatusBar from './StatusBar'
import RightPane from './RightPane'
import { RightPaneProvider } from './RightPaneContext'

export default function Layout() {
  return (
    <RightPaneProvider>
      <div className="flex flex-col h-screen bg-background">
        <TopNav />
        <div className="flex flex-1 overflow-hidden">
          <ActivityBar />
          <SidePanel />
          <main className="flex-1 overflow-auto p-6">
            <Outlet />
          </main>
          <RightPane />
        </div>
        <StatusBar />
      </div>
    </RightPaneProvider>
  )
}
```

- [ ] **Step 2: Start the dev server and verify base layout still works**

Check whether anything is using port 5173:

```
netstat -ano | findstr :5173
```

If something is using it, run dev on a free port:

```
npm run dev:console -- --port 5180
```

Otherwise:

```
npm run dev:console
```

Open the URL in a browser. Visit `/`, `/environments`, `/log`, `/settings`. Expected: no right pane visible (no page registers content yet), layout otherwise unchanged.

- [ ] **Step 3: Commit**

```
git add apps/console/src/layout/Layout.tsx
git commit -m "feat(console): wire RightPane into Layout"
```

---

### Task 6: EnvironmentDetailPage — register pane, delete Value/Resource sections

**Files:**

- Modify: `apps/console/src/features/environments/EnvironmentDetailPage.tsx`

- [ ] **Step 1: Update the file**

Replace the entire `EnvironmentDetailPage` default export with the version below. The `VisibilityBadge`, `CodeStatusBadge`, and `ActionsTable` helpers above the export are unchanged — keep them as-is. Only the `export default function EnvironmentDetailPage` body and its imports change.

Update the imports at the top of the file to add `useMemo`:

```tsx
import { useMemo } from 'react'
import { useParams, Link } from 'react-router'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useEnvironment } from './hooks'
import { formatTimestamp } from '@/lib/utils'
import { useRegisterRightPane } from '@/layout/RightPaneContext'
import type { ActionSummaryInEnvironment } from '@/lib/types'
```

Replace the `export default function EnvironmentDetailPage()` body with:

```tsx
export default function EnvironmentDetailPage() {
  const { oid } = useParams<{ oid: string }>()
  const { data, isLoading, isError, error } = useEnvironment(oid ?? '')

  const panePayload = useMemo(() => {
    if (!data) return null
    return {
      header: { eyebrow: 'ENVIRONMENT', name: `${data.local_id} v${data.version}` },
      content: (
        <>
          {data.action_property_specifications.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Action Properties</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {data.action_property_specifications.map((spec) => (
                    <div key={spec.name}>
                      <p className="font-medium text-sm mb-1">{spec.name}</p>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Property</TableHead>
                            <TableHead>Value</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {spec.entries.map((entry) => (
                            <TableRow key={entry.name}>
                              <TableCell className="font-medium text-sm">{entry.name}</TableCell>
                              <TableCell className="text-sm text-muted-foreground">
                                {entry.value}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">
                Actions{' '}
                <span className="text-muted-foreground font-normal text-sm">
                  ({data.actions.length})
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ActionsTable actions={data.actions} />
            </CardContent>
          </Card>
        </>
      ),
    }
  }, [data])

  useRegisterRightPane(panePayload)

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Link to="/environments" className="text-primary hover:underline text-sm">
            &larr; Environments
          </Link>
        </div>
        <div className="space-y-2">
          <div className="h-7 bg-muted rounded animate-pulse w-48" />
          <div className="h-4 bg-muted rounded animate-pulse w-64" />
        </div>
      </div>
    )
  }

  if (isError || !data) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Link to="/environments" className="text-primary hover:underline text-sm">
            &larr; Environments
          </Link>
        </div>
        <Card className="border-destructive">
          <CardContent className="pt-6">
            <p className="text-destructive font-medium">Failed to load environment</p>
            <p className="text-muted-foreground text-sm mt-1">
              {error instanceof Error ? error.message : 'Environment not found'}
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  const { local_id, version, description, imported_at, last_modified_date } = data

  return (
    <div className="space-y-6">
      <Link to="/environments" className="text-primary hover:underline text-sm">
        &larr; Environments
      </Link>

      <div className="space-y-1">
        <div className="flex items-baseline gap-3">
          <h2 className="text-2xl font-bold text-foreground">{local_id}</h2>
          <span className="text-sm text-muted-foreground font-medium bg-muted px-2 py-0.5 rounded">
            v{version}
          </span>
        </div>
        {description && <p className="text-muted-foreground">{description}</p>}
        <p className="font-mono text-xs text-muted-foreground" title={data.oid}>
          OID: {data.oid}
        </p>
        <div className="flex flex-wrap gap-4 text-xs text-muted-foreground pt-1">
          <span>Imported: {formatTimestamp(imported_at)}</span>
          {last_modified_date && <span>Last modified: {formatTimestamp(last_modified_date)}</span>}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify type check passes**

```
npm run build
```

Expected: clean build. The destructured `value_property_specifications`, `resource_property_specifications`, and `action_property_specifications` are no longer destructured from `data` (the latter is read inside `panePayload`); make sure no orphan references remain in the file.

- [ ] **Step 3: Manually verify in dev server**

```
npm run dev:console
```

Visit `/environments/<some-oid>`. Expected:

- Center shows back link, header (name, version, description, OID, dates) only.
- Right pane appears with header `ENVIRONMENT` / `<name> v<version>`.
- Right pane contains Action Properties (if any) + Actions table.
- No Value Properties or Resource Properties cards anywhere.
- Resize the pane by dragging its left edge; close + reopen browser; width persists.
- Click the collapse icon in the pane header; pane shrinks to ~28px gutter; click `PanelLeft` to expand again.

- [ ] **Step 4: Commit**

```
git add apps/console/src/features/environments/EnvironmentDetailPage.tsx
git commit -m "feat(console): move env props/actions to right pane; drop value/resource"
```

---

### Task 7: ActionDetailPage — register pane + Clear Code column with confirm dialog

**Files:**

- Modify: `apps/console/src/features/actions/ActionDetailPage.tsx`

- [ ] **Step 1: Update imports**

Add the following imports at the top of the file (merging with what's already there):

```tsx
import { useMemo, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@trajectory/ui'
import { useAction, useUpdateActionTimeout, useClearCode } from './hooks'
import { useRegisterRightPane } from '@/layout/RightPaneContext'
```

Make sure `useState` is in the React import list (it already is — leave the existing import if so, otherwise consolidate). `useClearCode` comes from the same `./hooks` file you edited in Task 2.

- [ ] **Step 2: Replace CodeStatusSection to add the Clear Code link**

Replace the existing `CodeStatusSection` function with:

```tsx
function CodeStatusSection({
  actionOid,
  statesWithCode,
  visibility,
  onClearState,
}: {
  actionOid: string
  statesWithCode: string[]
  visibility: 'observable' | 'opaque'
  onClearState: (state: string) => void
}) {
  const stateSet = new Set(statesWithCode)
  const applicableStates = visibility === 'opaque' ? OPAQUE_CODE_STATES : OBSERVABLE_CODE_STATES

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>State</TableHead>
          <TableHead>Code</TableHead>
          <TableHead>Action</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {applicableStates.map((state) => {
          const hasCode = stateSet.has(state)
          return (
            <TableRow key={state}>
              <TableCell className="font-mono text-sm">{state}</TableCell>
              <TableCell>
                {hasCode ? (
                  <span className="inline-flex items-center rounded px-2 py-0.5 text-xs font-medium bg-green-100 text-green-700">
                    active
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground">no code</span>
                )}
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-3">
                  <Link
                    to={`/actions/${actionOid}/code/${state}`}
                    className="text-xs text-primary hover:underline"
                  >
                    Edit
                  </Link>
                  {hasCode && (
                    <button
                      type="button"
                      onClick={() => onClearState(state)}
                      className="text-xs text-destructive hover:underline"
                    >
                      Clear Code
                    </button>
                  )}
                </div>
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}
```

- [ ] **Step 3: Replace the page body**

Replace the `export default function ActionDetailPage` body with:

```tsx
export default function ActionDetailPage() {
  const { oid } = useParams<{ oid: string }>()
  const { data, isLoading, isError, error, refetch } = useAction(oid ?? '')
  const clearCode = useClearCode()
  const [pendingClear, setPendingClear] = useState<string | null>(null)

  const panePayload = useMemo(() => {
    if (!data) return null
    return {
      header: { eyebrow: 'ACTION', name: `${data.local_id} v${data.version}` },
      content: (
        <>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">
                Input Parameters{' '}
                <span className="text-muted-foreground font-normal text-sm">
                  ({data.input_parameter_specifications.length})
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <InputParamsTable params={data.input_parameter_specifications} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">
                Output Parameters{' '}
                <span className="text-muted-foreground font-normal text-sm">
                  ({data.output_parameter_specifications.length})
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <OutputParamsTable params={data.output_parameter_specifications} />
            </CardContent>
          </Card>

          {data.property_specifications.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Action Properties</CardTitle>
              </CardHeader>
              <CardContent>
                <ActionPropertiesTable specs={data.property_specifications} />
              </CardContent>
            </Card>
          )}

          <TimeoutSection action={data} />
        </>
      ),
    }
  }, [data])

  useRegisterRightPane(panePayload)

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Link to="/environments" className="text-primary hover:underline text-sm">
            &larr; Environments
          </Link>
        </div>
        <div className="space-y-2">
          <div className="h-7 bg-muted rounded animate-pulse w-48" />
          <div className="h-4 bg-muted rounded animate-pulse w-64" />
        </div>
      </div>
    )
  }

  if (isError || !data) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Link to="/environments" className="text-primary hover:underline text-sm">
            &larr; Environments
          </Link>
        </div>
        <Card className="border-destructive">
          <CardContent className="pt-6">
            <p className="text-destructive font-medium">Failed to load action</p>
            <p className="text-muted-foreground text-sm mt-1">
              {error instanceof Error ? error.message : 'Action not found'}
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  const {
    local_id,
    version,
    description,
    action_visibility,
    environment_oid,
    environment_name,
    code_summary,
  } = data

  function confirmClear() {
    if (!pendingClear || !data) return
    clearCode.mutate(
      { actionOid: data.oid, state: pendingClear },
      {
        onSuccess: () => {
          setPendingClear(null)
          void refetch()
        },
      }
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-sm">
        <Link to="/environments" className="text-primary hover:underline">
          Environments
        </Link>
        <span className="text-muted-foreground">/</span>
        <Link to={`/environments/${environment_oid}`} className="text-primary hover:underline">
          {environment_name}
        </Link>
      </div>

      <div className="space-y-1">
        <div className="flex items-baseline gap-3 flex-wrap">
          <h2 className="text-2xl font-bold text-foreground">{local_id}</h2>
          <span className="text-sm text-muted-foreground font-medium bg-muted px-2 py-0.5 rounded">
            v{version}
          </span>
          <VisibilityBadge visibility={action_visibility} />
        </div>
        {description && <p className="text-muted-foreground">{description}</p>}
        <p className="font-mono text-xs text-muted-foreground" title={data.oid}>
          OID: {data.oid}
        </p>
        <p className="text-xs text-muted-foreground">
          Environment:{' '}
          <Link to={`/environments/${environment_oid}`} className="text-primary hover:underline">
            {environment_name}
          </Link>
        </p>
        {code_summary.last_code_update && (
          <p className="text-xs text-muted-foreground">
            Last code update: {formatTimestamp(code_summary.last_code_update)}
          </p>
        )}
      </div>

      <ExportImportButtons actionOid={data.oid} onImportComplete={() => void refetch()} />

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            Code Status{' '}
            <span className="text-muted-foreground font-normal text-sm">
              ({code_summary.states_with_code.length} states with code,{' '}
              {code_summary.total_versions} version
              {code_summary.total_versions !== 1 ? 's' : ''} total)
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <CodeStatusSection
            actionOid={data.oid}
            statesWithCode={code_summary.states_with_code}
            visibility={action_visibility}
            onClearState={(state) => setPendingClear(state)}
          />
        </CardContent>
      </Card>

      <Dialog
        open={pendingClear !== null}
        onOpenChange={(open) => {
          if (!open) setPendingClear(null)
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete all code for {pendingClear}?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This removes the active version and all version history for this state. This cannot be
            undone.
          </p>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPendingClear(null)}
              disabled={clearCode.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={confirmClear}
              disabled={clearCode.isPending}
            >
              {clearCode.isPending ? 'Deleting...' : 'Delete all versions'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
```

> Note: this removes the standalone `Input Parameters`, `Output Parameters`, `Action Properties`, and `Execution Settings (TimeoutSection)` cards from the center pane — they now live exclusively in the right pane. The supporting helper components (`InputParamsTable`, `OutputParamsTable`, `ActionPropertiesTable`, `TimeoutSection`) are still defined and used.

- [ ] **Step 4: Verify type check passes**

```
npm run build
```

Expected: clean build.

- [ ] **Step 5: Manually verify in dev server**

Visit `/actions/<oid>`. Expected:

- Center: breadcrumb, header, Export/Import, Code Status table only.
- Right pane: Input Parameters, Output Parameters, Action Properties (if non-empty), Execution Settings.
- Code Status table rows with code show `Edit · Clear Code` (Clear Code in destructive color).
- Click Clear Code on a state with code → modal opens with the listed copy → click `Delete all versions` → modal closes, the row's `active` badge becomes `no code`, the `Clear Code` link disappears from that row.
- Test idempotency: there should be no Clear Code button on a state that has no code.

- [ ] **Step 6: Commit**

```
git add apps/console/src/features/actions/ActionDetailPage.tsx
git commit -m "feat(console): action props to right pane; Clear Code with confirm"
```

---

### Task 8: InlineCodeEditorPage — Cancel button

**Files:**

- Modify: `apps/console/src/features/code-editor/InlineCodeEditorPage.tsx`

- [ ] **Step 1: Update imports and add Cancel button**

In `apps/console/src/features/code-editor/InlineCodeEditorPage.tsx`:

Replace `import { useParams, Link } from 'react-router'` with:

```tsx
import { useParams, Link, useNavigate } from 'react-router'
```

Inside the component, immediately after the `const { oid: actionOid, state } = useParams<{ oid: string; state: string }>()` line, add:

```tsx
const navigate = useNavigate()

function handleCancel() {
  if (isDirty) {
    const confirmed = window.confirm('Discard unsaved changes?')
    if (!confirmed) return
  }
  if (actionOid) navigate(`/actions/${actionOid}`)
}
```

> `isDirty` is declared further down. Hoisting the function inside the component but defined after the state declarations — TypeScript is fine with this because of variable hoisting for `function` declarations within a function body and the closure captures the live `isDirty` value at call time.

> If TS complains about ordering, move `handleCancel` to immediately after the `const [showSaveDialog, ...]` state hooks where `isDirty` is in scope. Either spot works at runtime.

In the action bar (currently `[Save]  [Test]  [History]`), find the JSX that renders those three buttons (around line 213-238) and add a Cancel button **before** Save. Replace this block:

```tsx
<div className="flex items-center gap-2">
  <Button
    size="sm"
    className="h-7 text-xs"
    onClick={() => setShowSaveDialog(true)}
    disabled={!canSave}
  >
    Save
  </Button>
  <Button
    size="sm"
    variant={showTestPanel ? 'default' : 'outline'}
    className="h-7 text-xs"
    onClick={() => setShowTestPanel((v) => !v)}
  >
    {showTestPanel ? 'Hide Test' : 'Test'}
  </Button>
  <Button
    size="sm"
    variant="outline"
    className="h-7 text-xs"
    onClick={() => setShowHistorySheet(true)}
  >
    History
  </Button>
</div>
```

with:

```tsx
<div className="flex items-center gap-2">
  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={handleCancel}>
    Cancel
  </Button>
  <Button
    size="sm"
    className="h-7 text-xs"
    onClick={() => setShowSaveDialog(true)}
    disabled={!canSave}
  >
    Save
  </Button>
  <Button
    size="sm"
    variant={showTestPanel ? 'default' : 'outline'}
    className="h-7 text-xs"
    onClick={() => setShowTestPanel((v) => !v)}
  >
    {showTestPanel ? 'Hide Test' : 'Test'}
  </Button>
  <Button
    size="sm"
    variant="outline"
    className="h-7 text-xs"
    onClick={() => setShowHistorySheet(true)}
  >
    History
  </Button>
</div>
```

- [ ] **Step 2: Verify type check passes**

```
npm run build
```

Expected: clean build.

- [ ] **Step 3: Manually verify in dev server**

Visit `/actions/<oid>/code/<state>` for a state with no existing code (so editor starts dirty with template):

1. Click `Cancel` → confirm dialog appears (`Discard unsaved changes?`) → click OK → navigates to `/actions/<oid>`.
2. Visit again → click `Cancel` → confirm dialog → click Cancel/Esc → stays on the editor, code preserved.
3. Visit a state with saved code that you haven't edited → click `Cancel` → no confirm dialog, navigates immediately.

- [ ] **Step 4: Commit**

```
git add apps/console/src/features/code-editor/InlineCodeEditorPage.tsx
git commit -m "feat(console): Cancel button in inline code editor"
```

---

### Task 9: Manual end-to-end verification

**Files:** none modified.

- [ ] **Step 1: Full backend test pass**

```
npm test
```

Expected: all tests pass, including the new MGMT-CLEAR cases.

- [ ] **Step 2: Full type check**

```
npm run build
```

Expected: clean build.

- [ ] **Step 3: Full UI walk-through with both servers**

Start the full dev stack:

```
npm run dev
```

Walk through every behavior the spec promises:

- **Environment page** (`/environments/<oid>`):
  - Right pane appears with header `ENVIRONMENT` / `<name> v<version>`.
  - Right pane contents: Action Properties (if any), then Actions table.
  - Center contents: back link, header block only.
  - **No** Value Properties card. **No** Resource Properties card.
  - Drag left edge of pane; width updates live; release; reload page; width persists.
  - Click `PanelRight` icon in header; pane collapses to thin gutter; click `PanelLeft` icon; pane re-expands at the previous width.

- **Action page** (`/actions/<oid>`):
  - Right pane header `ACTION` / `<name> v<version>`.
  - Right pane: Input Parameters, Output Parameters, Action Properties (when non-empty), Execution Settings.
  - Center: breadcrumb, header, Export/Import, Code Status — **only**.
  - Code Status rows with code show `Edit · Clear Code`; rows without code show only `Edit`.
  - Click `Clear Code` on a state with code → Dialog opens → click `Delete all versions` → row flips to `no code`, `Clear Code` link disappears, version history for that state empties.
  - Click `Clear Code` again on a different state → click Cancel → dialog closes, no change.

- **Inline code editor** (`/actions/<oid>/code/<state>`):
  - Cancel button appears left of Save.
  - With unsaved changes: clicking Cancel prompts `Discard unsaved changes?`. OK → navigates to action page. Cancel/Esc → stays.
  - Without changes: clicking Cancel navigates immediately, no prompt.

- **Other routes** (`/`, `/log`, `/settings`, `/instances`, `/code-editor`):
  - No right pane visible (no page registers content).
  - Layout otherwise unchanged.

- **Theme toggle** (already in TopNav):
  - Sun/Moon button in top right toggles dark/light. No change in this PR — verify it still works.

- [ ] **Step 4: Commit any remaining stragglers**

If anything was missed (e.g., an unused import flagged by lint), fix and commit:

```
npm run lint:fix
git add -A
git commit -m "chore: lint cleanup after redesign"
```

If lint is clean and no other changes exist, skip this step.

---

## Summary of commits expected

1. `feat(management): DELETE /code/:oid/:state clears all versions`
2. `feat(console): clearCode api client + useClearCode hook`
3. `feat(console): RightPaneContext + useRegisterRightPane`
4. `feat(console): RightPane shell with resize + collapse`
5. `feat(console): wire RightPane into Layout`
6. `feat(console): move env props/actions to right pane; drop value/resource`
7. `feat(console): action props to right pane; Clear Code with confirm`
8. `feat(console): Cancel button in inline code editor`
9. (optional) `chore: lint cleanup after redesign`
