# Trajectory Action Tester — Plan 3: Action Browser + Invoke

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After this plan, a user with an active connection can browse the container's actions (grouped by observable/opaque) in the LHS sidebar, click one to open an Invoke panel in the center, fill in input parameters (form generated from `input_parameters` specs), hit Invoke, and see a minimal "instance created" placeholder showing the new `instance_id` plus the current state polled once from `GET /instances/:id`. Invoked instances also accumulate in a new "Instances" sidebar section, capped at 50 most-recent per connection.

**Architecture:** A new `ActiveInstanceContext` owns the center-pane view mode — `null` (idle), `{type: 'action', action_oid}` (Invoke panel), or `{type: 'instance', instance_id}` (instance view) — plus an in-memory list of tracked instances keyed by `connection_id`. Two new API clients (`invokeAction`, `fetchInstance`) talk to `/trajectory/v1/actions/:oid/invoke` and `/trajectory/v1/instances/:id` respectively. Auto-generated UUIDs supply `workflow_instance_id`/`step_instance_id`/`step_oid` (the tester is not a workflow client; these are filler values). `useInvoke` is a TanStack Query mutation that, on success, tracks the new instance and flips selection to `{type:'instance'}`. `useInstance` is a single-shot query (no refetchInterval — Plan 4-04 adds SSE for live updates). The Sidebar shell grows two more `<Section>` mounts (ActionTree below Connections, InstanceList below ActionTree) without restructuring.

**Tech Stack:** No new npm dependencies. Reuses everything from Plans 1-2: React 19 + TS strict, `@tanstack/react-query` v5, vanilla CSS Modules, Vitest 3 + RTL + user-event. `crypto.randomUUID()` for filler IDs.

**Spec:** `docs/specs/2026-05-11-trajectory-action-tester-v2-design.md` — § 2 (L1 goals: action browser + invoke), § 4 (ActiveInstanceContext scope), § 5 (LHS sections 2-3 + Center action/instance modes), § 10 (testing strategy).

**Server endpoints consumed:** `POST /trajectory/v1/actions/:action_oid/invoke` (see `packages/server/src/routes/protocol.ts:88-157`) and `GET /trajectory/v1/instances/:id` (see `protocol.ts:162-180`; response shape from `formatInstanceResponse` at `protocol.ts:16-41`).

---

## File Structure

This plan creates **2 new feature subdirectories** (`src/features/invoke-panel/`, `src/features/instance-panel/`) and adds new files to existing ones.

| Path                                                   | Role                                                                                                                                                                                                                              |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/api/types.ts`                                     | **Modify** — add `Instance`, `InvokeRequestBody`, `InvokeResponse`, `InvokeInputParameter` types.                                                                                                                                 |
| `src/api/invoke.ts`                                    | `invokeAction(connection, actionOid, body)` — POSTs to `/trajectory/v1/actions/:oid/invoke`, returns `instance_id`.                                                                                                                 |
| `src/api/invoke.test.ts`                               | Tests for `invokeAction` (URL, headers, body, success, error).                                                                                                                                                                    |
| `src/api/instances.ts`                                 | `fetchInstance(connection, instanceId)` — GETs `/trajectory/v1/instances/:id`, returns `Instance`.                                                                                                                                  |
| `src/api/instances.test.ts`                            | Tests for `fetchInstance` (URL, headers, 200, 404, 500).                                                                                                                                                                          |
| `src/store/active-instance.tsx`                        | `ActiveInstanceContext`, `ActiveInstanceProvider`, `useActiveInstance`, `useTrackedInstances` hooks + reducer.                                                                                                                    |
| `src/store/active-instance.test.tsx`                   | Reducer tests (select action, select instance, clear, track new, update tracked, cap at 50) + provider tests.                                                                                                                     |
| `src/store/use-invoke.ts`                              | `useInvoke()` — TanStack mutation; on success calls `trackInstance` + flips selection to `{type:'instance'}`.                                                                                                                     |
| `src/store/use-invoke.test.tsx`                        | Mutation tests with mocked fetch (idle, success → tracking + selection, error → no tracking).                                                                                                                                     |
| `src/store/use-instance.ts`                            | `useInstance(instanceId)` — single-shot `useQuery` against the active connection, keyed by `[connId, instId]`.                                                                                                                    |
| `src/store/use-instance.test.tsx`                      | Query tests (404 surface, 200 returns data, no refetchInterval).                                                                                                                                                                  |
| `src/components/Pill.tsx`                              | Small inline-block badge — used for visibility ("observable"/"opaque") and state names.                                                                                                                                           |
| `src/components/Pill.module.css`                       | Pill styles (variants: neutral, accent, success, error, muted).                                                                                                                                                                   |
| `src/components/Pill.test.tsx`                         | Render + variant class tests.                                                                                                                                                                                                     |
| `src/features/sidebar/Sidebar.tsx`                     | **Modify** — add two `<Section>` mounts: `<ActionTree />` titled "Actions", `<InstanceList />` titled "Instances".                                                                                                                |
| `src/features/sidebar/ActionTree.tsx`                  | Lists active connection's actions grouped by `visibility`. Click selects (sets `{type:'action'}`). Active row highlighted.                                                                                                        |
| `src/features/sidebar/ActionTree.module.css`           | Group headers + row styles.                                                                                                                                                                                                       |
| `src/features/sidebar/ActionTree.test.tsx`             | Groups by visibility, click-to-select, active highlight, empty/loading/error states.                                                                                                                                              |
| `src/features/sidebar/InstanceList.tsx`                | Renders `trackedInstances` for active connection. Click selects (sets `{type:'instance'}`). Color-coded by state.                                                                                                                 |
| `src/features/sidebar/InstanceList.module.css`         | Row styles + state color tokens.                                                                                                                                                                                                  |
| `src/features/sidebar/InstanceList.test.tsx`           | Renders empty + tracked list, color-codes state, click selects.                                                                                                                                                                   |
| `src/features/invoke-panel/InvokePanel.tsx`            | Center pane when `selection.type === 'action'`. Generates form from `input_parameters`, calls `useInvoke`.                                                                                                                        |
| `src/features/invoke-panel/InvokePanel.module.css`     | Panel layout + form styles.                                                                                                                                                                                                       |
| `src/features/invoke-panel/InvokePanel.test.tsx`       | Renders form, fills defaults, validates required fields, invokes on submit, shows error on failure.                                                                                                                               |
| `src/features/instance-panel/InstancePanel.tsx`        | Center pane when `selection.type === 'instance'`. Shows `instance_id` + current state + loading/error.                                                                                                                            |
| `src/features/instance-panel/InstancePanel.module.css` | Panel layout.                                                                                                                                                                                                                     |
| `src/features/instance-panel/InstancePanel.test.tsx`   | Loading state, success state with data, 404 state, error state.                                                                                                                                                                   |
| `src/App.tsx`                                          | **Modify** — wrap in `<ActiveInstanceProvider>`, replace center placeholder with mode-switcher (idle/InvokePanel/InstancePanel).                                                                                                  |
| `src/test-utils.tsx`                                   | **Modify** — `AllProviders` now wraps `ActiveInstanceProvider` inside `ConnectionsProvider`.                                                                                                                                      |
| `src/__tests__/integration.test.tsx`                   | **Modify** — extend with one more `it` block covering the full flow: connect → capabilities load → ActionTree renders → click action → InvokePanel → submit → invoke fires → instance tracked → InstancePanel shows polled state. |

After this plan, the spec § 4 + § 5 surface for L1 connection + browse + invoke is fully implemented, except for SSE state monitoring (Plan 4-04).

---

## Pre-flight check

Before starting, confirm Plan 2 is shipped cleanly:

```powershell
cd C:\TrajectoryActionTester
git log --oneline | Measure-Object -Line   # expect ~33 lines (10 from Plan 1 + 23 from Plan 2)
git status                                  # expect "nothing to commit, working tree clean"
npm test                                    # expect 75 tests pass across 13 test files
```

If any fail, finish/fix Plan 2 first.

No new npm dependencies are required.

---

## Task 1: Extend API types with Instance + Invoke shapes

**Files:**

- Modify: `C:\TrajectoryActionTester\src\api\types.ts`

Add four new exports at the bottom of the existing `types.ts`. Keep the existing exports (Connection, ApiError, CapabilitiesResponse, etc.) untouched — additive only.

- [ ] **Step 1: Append types to `src/api/types.ts`**

After the existing `CapabilitiesResponse` interface and `ApiError` class, add:

```ts
// ============================================================
// Invoke / Instance — request and response shapes
// ============================================================

export interface InvokeInputParameter {
  name: string
  value: string
}

export interface InvokeRequestBody {
  environment_oid: string
  workflow_instance_id: string
  step_instance_id: string
  step_oid: string
  input_parameters: InvokeInputParameter[]
  timeout_ms?: number
}

export interface InvokeResponse {
  data: { instance_id: string }
  meta: Record<string, unknown>
}

export interface InstanceStateSummary {
  current: string
  previous: string | null
  entered_at: string
}

export interface Instance {
  instance_id: string
  action_oid: string
  environment_oid: string
  workflow_instance_id: string
  step_instance_id: string
  step_oid: string
  visibility: ActionVisibility
  state: InstanceStateSummary
  inputs: InvokeInputParameter[]
  outputs: InvokeInputParameter[]
  created_at: string
  started_at: string | null
  completed_at: string | null
  error: string | null
}

export interface InstanceResponse {
  data: Instance
  meta: Record<string, unknown>
}
```

These match the server response shapes in `packages/server/src/routes/protocol.ts:16-41` (formatInstanceResponse) and `protocol.ts:148-153` (invoke response).

- [ ] **Step 2: Sanity-run typecheck**

```powershell
cd C:/TrajectoryActionTester
npm run typecheck
```

Expected: exit 0. No tests added in this task — types are exercised by downstream tasks.

- [ ] **Step 3: Commit**

```powershell
git add src/api/types.ts
git commit -m "feat(api): types for invoke + instance response shapes"
```

---

## Task 2: `invokeAction` API client

**Files:**

- Create: `C:\TrajectoryActionTester\src\api\invoke.ts`
- Create: `C:\TrajectoryActionTester\src\api\invoke.test.ts`

POSTs to `${baseUrl}/trajectory/v1/actions/${action_oid}/invoke` with the request body. Returns `InvokeResponse['data']` (i.e., `{ instance_id }`). Adds `Authorization: Bearer ${apiKey}` when apiKey is set, matching `fetchCapabilities`. Throws `ApiError` on non-2xx.

- [ ] **Step 1: Write failing tests**

Create `src/api/invoke.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from './types'
import type { Connection, InvokeRequestBody } from './types'
import { invokeAction } from './invoke'

const baseConnection: Connection = {
  id: 'conn-1',
  url: 'http://localhost:3000',
  createdAt: '2026-05-13T00:00:00Z',
}

const baseBody: InvokeRequestBody = {
  environment_oid: 'env-1',
  workflow_instance_id: 'wf-1',
  step_instance_id: 'step-1',
  step_oid: 'step-oid-1',
  input_parameters: [{ name: 'item_sku', value: 'SKU-1001' }],
}

describe('invokeAction', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('POSTs to {url}/trajectory/v1/actions/{oid}/invoke with JSON body', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ data: { instance_id: 'inst-1' }, meta: {} }), {
        status: 201,
      })
    )
    await invokeAction(baseConnection, 'act-1', baseBody)
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:3000/trajectory/v1/actions/act-1/invoke',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          Accept: 'application/json',
        }),
        body: JSON.stringify(baseBody),
      })
    )
  })

  it('strips trailing slashes from the connection URL', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ data: { instance_id: 'inst-1' }, meta: {} }), {
        status: 201,
      })
    )
    await invokeAction({ ...baseConnection, url: 'http://localhost:3000/' }, 'act-1', baseBody)
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:3000/trajectory/v1/actions/act-1/invoke',
      expect.anything()
    )
  })

  it('adds Authorization: Bearer when apiKey is present', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ data: { instance_id: 'inst-1' }, meta: {} }), {
        status: 201,
      })
    )
    await invokeAction({ ...baseConnection, apiKey: 'sek' }, 'act-1', baseBody)
    expect(fetch).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer sek' }),
      })
    )
  })

  it('returns the parsed { instance_id } on 201', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ data: { instance_id: 'inst-42' }, meta: {} }), {
        status: 201,
      })
    )
    const result = await invokeAction(baseConnection, 'act-1', baseBody)
    expect(result).toEqual({ instance_id: 'inst-42' })
  })

  it('throws ApiError on non-2xx with status, statusText, body', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response('bad params', { status: 400, statusText: 'Bad Request' })
    )
    try {
      await invokeAction(baseConnection, 'act-1', baseBody)
      throw new Error('expected to throw')
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError)
      const apiErr = err as ApiError
      expect(apiErr.status).toBe(400)
      expect(apiErr.statusText).toBe('Bad Request')
      expect(apiErr.body).toContain('bad params')
    }
  })
})
```

- [ ] **Step 2: Run the test and verify it fails**

```powershell
cd C:/TrajectoryActionTester
npm test -- invoke
```

Expected: 5 tests fail because `./invoke` does not export `invokeAction`.

- [ ] **Step 3: Implement the client**

Create `src/api/invoke.ts`:

```ts
import type { Connection, InvokeRequestBody, InvokeResponse } from './types'
import { ApiError } from './types'

export async function invokeAction(
  connection: Connection,
  actionOid: string,
  body: InvokeRequestBody
): Promise<InvokeResponse['data']> {
  const baseUrl = connection.url.replace(/\/+$/, '')
  const url = `${baseUrl}/trajectory/v1/actions/${actionOid}/invoke`

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }
  if (connection.apiKey) {
    headers.Authorization = `Bearer ${connection.apiKey}`
  }

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    const responseBody = await response.text().catch(() => '')
    throw new ApiError(response.status, response.statusText, responseBody)
  }
  const parsed = (await response.json()) as InvokeResponse
  return parsed.data
}
```

- [ ] **Step 4: Run the test and verify it passes**

```powershell
npm test -- invoke
```

Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```powershell
git add src/api/invoke.ts src/api/invoke.test.ts
git commit -m "feat(api): invokeAction client"
```

---

## Task 3: `fetchInstance` API client

**Files:**

- Create: `C:\TrajectoryActionTester\src\api\instances.ts`
- Create: `C:\TrajectoryActionTester\src\api\instances.test.ts`

GETs `${baseUrl}/trajectory/v1/instances/${instance_id}`. Returns the `Instance` (server's `data` field). Throws `ApiError` on non-2xx (including 404).

- [ ] **Step 1: Write failing tests**

Create `src/api/instances.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from './types'
import type { Connection, Instance } from './types'
import { fetchInstance } from './instances'

const baseConnection: Connection = {
  id: 'conn-1',
  url: 'http://localhost:3000',
  createdAt: '2026-05-13T00:00:00Z',
}

const sampleInstance: Instance = {
  instance_id: 'inst-1',
  action_oid: 'act-1',
  environment_oid: 'env-1',
  workflow_instance_id: 'wf-1',
  step_instance_id: 'step-1',
  step_oid: 'step-oid-1',
  visibility: 'observable',
  state: { current: 'EXECUTING', previous: 'STARTING', entered_at: '2026-05-13T00:00:01Z' },
  inputs: [{ name: 'item_sku', value: 'SKU-1001' }],
  outputs: [],
  created_at: '2026-05-13T00:00:00Z',
  started_at: '2026-05-13T00:00:00Z',
  completed_at: null,
  error: null,
}

describe('fetchInstance', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('GETs {url}/trajectory/v1/instances/{id} with Accept JSON', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ data: sampleInstance, meta: {} }), { status: 200 })
    )
    await fetchInstance(baseConnection, 'inst-1')
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:3000/trajectory/v1/instances/inst-1',
      expect.objectContaining({ headers: expect.objectContaining({ Accept: 'application/json' }) })
    )
  })

  it('strips trailing slashes from the connection URL', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ data: sampleInstance, meta: {} }), { status: 200 })
    )
    await fetchInstance({ ...baseConnection, url: 'http://localhost:3000///' }, 'inst-1')
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:3000/trajectory/v1/instances/inst-1',
      expect.anything()
    )
  })

  it('adds Authorization: Bearer when apiKey is present', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ data: sampleInstance, meta: {} }), { status: 200 })
    )
    await fetchInstance({ ...baseConnection, apiKey: 'sek' }, 'inst-1')
    expect(fetch).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer sek' }),
      })
    )
  })

  it('returns the parsed Instance on 200', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ data: sampleInstance, meta: {} }), { status: 200 })
    )
    const result = await fetchInstance(baseConnection, 'inst-1')
    expect(result).toEqual(sampleInstance)
  })

  it('throws ApiError(404) when the instance does not exist', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { code: 'INSTANCE_NOT_FOUND', message: 'gone' } }), {
        status: 404,
        statusText: 'Not Found',
      })
    )
    try {
      await fetchInstance(baseConnection, 'gone')
      throw new Error('expected to throw')
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError)
      expect((err as ApiError).status).toBe(404)
    }
  })

  it('throws ApiError on 5xx', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response('boom', { status: 500 }))
    await expect(fetchInstance(baseConnection, 'inst-1')).rejects.toBeInstanceOf(ApiError)
  })
})
```

- [ ] **Step 2: Run the test and verify it fails**

```powershell
npm test -- instances
```

Expected: 6 tests fail.

- [ ] **Step 3: Implement the client**

Create `src/api/instances.ts`:

```ts
import type { Connection, Instance, InstanceResponse } from './types'
import { ApiError } from './types'

export async function fetchInstance(connection: Connection, instanceId: string): Promise<Instance> {
  const baseUrl = connection.url.replace(/\/+$/, '')
  const url = `${baseUrl}/trajectory/v1/instances/${instanceId}`

  const headers: Record<string, string> = { Accept: 'application/json' }
  if (connection.apiKey) {
    headers.Authorization = `Bearer ${connection.apiKey}`
  }

  const response = await fetch(url, { headers })
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new ApiError(response.status, response.statusText, body)
  }
  const parsed = (await response.json()) as InstanceResponse
  return parsed.data
}
```

- [ ] **Step 4: Run the test and verify it passes**

```powershell
npm test -- instances
```

Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```powershell
git add src/api/instances.ts src/api/instances.test.ts
git commit -m "feat(api): fetchInstance client"
```

---

## Task 4: Pill primitive

**Files:**

- Create: `C:\TrajectoryActionTester\src\components\Pill.tsx`
- Create: `C:\TrajectoryActionTester\src\components\Pill.module.css`
- Create: `C:\TrajectoryActionTester\src\components\Pill.test.tsx`

Tiny rounded-rectangle badge for visibility ("observable"/"opaque"), state names ("EXECUTING", "COMPLETED"), and similar short labels. Five variants: `neutral` (default), `accent`, `success`, `error`, `muted`.

- [ ] **Step 1: Write failing tests**

Create `src/components/Pill.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Pill } from './Pill'

describe('Pill', () => {
  it('renders its children', () => {
    render(<Pill>observable</Pill>)
    expect(screen.getByText('observable')).toBeInTheDocument()
  })

  it('applies the neutral variant class by default', () => {
    render(<Pill>x</Pill>)
    expect(screen.getByText('x').className).toMatch(/neutral/)
  })

  it('applies the success variant class when variant=success', () => {
    render(<Pill variant="success">done</Pill>)
    expect(screen.getByText('done').className).toMatch(/success/)
  })

  it('applies the error variant class when variant=error', () => {
    render(<Pill variant="error">err</Pill>)
    expect(screen.getByText('err').className).toMatch(/error/)
  })
})
```

- [ ] **Step 2: Run the test and verify it fails**

```powershell
npm test -- Pill
```

Expected: 4 tests fail.

- [ ] **Step 3: Implement Pill**

Create `src/components/Pill.tsx`:

```tsx
import type { ReactNode } from 'react'
import styles from './Pill.module.css'

export type PillVariant = 'neutral' | 'accent' | 'success' | 'error' | 'muted'

export interface PillProps {
  variant?: PillVariant
  children: ReactNode
}

export function Pill({ variant = 'neutral', children }: PillProps) {
  return <span className={[styles.pill, styles[variant]].join(' ')}>{children}</span>
}
```

Create `src/components/Pill.module.css`:

```css
.pill {
  display: inline-flex;
  align-items: center;
  padding: 1px 6px;
  border-radius: 9999px;
  font-size: var(--acT-fs-sm);
  font-weight: 500;
  line-height: 1.4;
  border: 1px solid transparent;
}

.neutral {
  background: var(--acT-panel-alt);
  color: var(--acT-text-subtle);
  border-color: var(--acT-divider);
}

.accent {
  background: var(--acT-accent-bg);
  color: var(--acT-accent);
  border-color: var(--acT-accent);
}

.success {
  background: rgba(78, 201, 176, 0.15);
  color: var(--acT-success);
  border-color: var(--acT-success);
}

.error {
  background: rgba(244, 135, 113, 0.15);
  color: var(--acT-error);
  border-color: var(--acT-error);
}

.muted {
  background: transparent;
  color: var(--acT-text-muted);
  border-color: var(--acT-divider);
}
```

- [ ] **Step 4: Run the test and verify it passes**

```powershell
npm test -- Pill
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```powershell
git add src/components/Pill.tsx src/components/Pill.module.css src/components/Pill.test.tsx
git commit -m "feat(components): Pill primitive (5 variants)"
```

---

## Task 5: ActiveInstanceContext (selection + trackedInstances)

**Files:**

- Create: `C:\TrajectoryActionTester\src\store\active-instance.tsx`
- Create: `C:\TrajectoryActionTester\src\store\active-instance.test.tsx`

Owns two things: the center-pane selection (`null` | action OID | instance id) and an in-memory list of tracked instances per connection. State is session-only — no localStorage. The reducer caps tracked instances at 50 most recent per connection when a new one is added.

- [ ] **Step 1: Write failing tests**

Create `src/store/active-instance.test.tsx`:

```tsx
import { act, render, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import {
  ActiveInstanceProvider,
  activeInstanceReducer,
  useActiveInstance,
  useTrackedInstances,
  type TrackedInstance,
} from './active-instance'

const wrapper = ({ children }: { children: ReactNode }) => (
  <ActiveInstanceProvider>{children}</ActiveInstanceProvider>
)

function makeTracked(overrides: Partial<TrackedInstance> = {}): TrackedInstance {
  return {
    instance_id: 'inst-1',
    connection_id: 'conn-1',
    action_oid: 'act-1',
    invoked_at: '2026-05-13T00:00:00Z',
    ...overrides,
  }
}

describe('activeInstanceReducer', () => {
  it('selectAction sets selection to {type:"action", action_oid}', () => {
    const next = activeInstanceReducer(
      { selection: null, trackedInstances: [] },
      { type: 'selectAction', action_oid: 'act-1' }
    )
    expect(next.selection).toEqual({ type: 'action', action_oid: 'act-1' })
  })

  it('selectInstance sets selection to {type:"instance", instance_id}', () => {
    const next = activeInstanceReducer(
      { selection: null, trackedInstances: [] },
      { type: 'selectInstance', instance_id: 'inst-1' }
    )
    expect(next.selection).toEqual({ type: 'instance', instance_id: 'inst-1' })
  })

  it('clearSelection sets selection to null', () => {
    const next = activeInstanceReducer(
      { selection: { type: 'action', action_oid: 'a' }, trackedInstances: [] },
      { type: 'clearSelection' }
    )
    expect(next.selection).toBeNull()
  })

  it('trackInstance prepends a new entry', () => {
    const initial = { selection: null, trackedInstances: [makeTracked({ instance_id: 'old' })] }
    const next = activeInstanceReducer(initial, {
      type: 'trackInstance',
      instance: makeTracked({ instance_id: 'new' }),
    })
    expect(next.trackedInstances).toHaveLength(2)
    expect(next.trackedInstances[0].instance_id).toBe('new')
    expect(next.trackedInstances[1].instance_id).toBe('old')
  })

  it('trackInstance caps the list at 50 most-recent PER CONNECTION', () => {
    const existing: TrackedInstance[] = Array.from({ length: 50 }, (_, i) =>
      makeTracked({ instance_id: `c1-${i}`, connection_id: 'conn-1' })
    )
    const other: TrackedInstance[] = Array.from({ length: 5 }, (_, i) =>
      makeTracked({ instance_id: `c2-${i}`, connection_id: 'conn-2' })
    )
    const initial = { selection: null, trackedInstances: [...existing, ...other] }
    const next = activeInstanceReducer(initial, {
      type: 'trackInstance',
      instance: makeTracked({ instance_id: 'c1-new', connection_id: 'conn-1' }),
    })
    const c1Count = next.trackedInstances.filter((t) => t.connection_id === 'conn-1').length
    const c2Count = next.trackedInstances.filter((t) => t.connection_id === 'conn-2').length
    expect(c1Count).toBe(50)
    expect(c2Count).toBe(5)
    expect(next.trackedInstances[0].instance_id).toBe('c1-new')
    expect(next.trackedInstances.find((t) => t.instance_id === 'c1-49')).toBeUndefined()
  })

  it('updateTrackedInstance updates last_known_state + last_known_error on an existing entry', () => {
    const initial = {
      selection: null,
      trackedInstances: [makeTracked({ instance_id: 'inst-1' })],
    }
    const next = activeInstanceReducer(initial, {
      type: 'updateTrackedInstance',
      instance_id: 'inst-1',
      patch: { last_known_state: 'COMPLETED', last_known_error: null },
    })
    expect(next.trackedInstances[0].last_known_state).toBe('COMPLETED')
    expect(next.trackedInstances[0].last_known_error).toBeNull()
  })

  it('updateTrackedInstance is a no-op for an unknown instance_id', () => {
    const initial = {
      selection: null,
      trackedInstances: [makeTracked({ instance_id: 'inst-1' })],
    }
    const next = activeInstanceReducer(initial, {
      type: 'updateTrackedInstance',
      instance_id: 'unknown',
      patch: { last_known_state: 'COMPLETED' },
    })
    expect(next.trackedInstances).toEqual(initial.trackedInstances)
  })
})

describe('ActiveInstanceProvider', () => {
  afterEach(() => {
    // Session-only state — no persistence to clean up.
  })

  it('exposes empty initial state', () => {
    const { result } = renderHook(() => useActiveInstance(), { wrapper })
    expect(result.current.state.selection).toBeNull()
    expect(result.current.state.trackedInstances).toEqual([])
  })

  it('selectAction / selectInstance / clearSelection update selection', () => {
    const { result } = renderHook(() => useActiveInstance(), { wrapper })
    act(() => result.current.selectAction('act-1'))
    expect(result.current.state.selection).toEqual({ type: 'action', action_oid: 'act-1' })
    act(() => result.current.selectInstance('inst-1'))
    expect(result.current.state.selection).toEqual({ type: 'instance', instance_id: 'inst-1' })
    act(() => result.current.clearSelection())
    expect(result.current.state.selection).toBeNull()
  })

  it('trackInstance generates an invoked_at timestamp', () => {
    const { result } = renderHook(() => useActiveInstance(), { wrapper })
    act(() =>
      result.current.trackInstance({
        instance_id: 'inst-1',
        connection_id: 'conn-1',
        action_oid: 'act-1',
      })
    )
    const tracked = result.current.state.trackedInstances[0]
    expect(tracked.instance_id).toBe('inst-1')
    expect(new Date(tracked.invoked_at).toString()).not.toBe('Invalid Date')
  })

  it("useTrackedInstances(connection_id) returns only that connection's tracked list", () => {
    const { result } = renderHook(
      () => {
        const api = useActiveInstance()
        const c1 = useTrackedInstances('conn-1')
        const c2 = useTrackedInstances('conn-2')
        return { api, c1, c2 }
      },
      { wrapper }
    )
    act(() => {
      result.current.api.trackInstance({
        instance_id: 'i1',
        connection_id: 'conn-1',
        action_oid: 'act-1',
      })
      result.current.api.trackInstance({
        instance_id: 'i2',
        connection_id: 'conn-2',
        action_oid: 'act-2',
      })
    })
    expect(result.current.c1.map((t) => t.instance_id)).toEqual(['i1'])
    expect(result.current.c2.map((t) => t.instance_id)).toEqual(['i2'])
  })

  it('throws when useActiveInstance is called outside the provider', () => {
    function Consumer() {
      useActiveInstance()
      return null
    }
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<Consumer />)).toThrow(/ActiveInstanceProvider/)
    spy.mockRestore()
  })
})
```

- [ ] **Step 2: Run the test and verify it fails**

```powershell
npm test -- active-instance.test
```

Expected: tests fail — module does not exist.

- [ ] **Step 3: Implement the context**

Create `src/store/active-instance.tsx`:

```tsx
import { createContext, useCallback, useContext, useMemo, useReducer, type ReactNode } from 'react'

export interface TrackedInstance {
  instance_id: string
  connection_id: string
  action_oid: string
  invoked_at: string
  last_known_state?: string
  last_known_error?: string | null
}

export type Selection =
  | { type: 'action'; action_oid: string }
  | { type: 'instance'; instance_id: string }
  | null

export interface ActiveInstanceState {
  selection: Selection
  trackedInstances: TrackedInstance[]
}

export type ActiveInstanceAction =
  | { type: 'selectAction'; action_oid: string }
  | { type: 'selectInstance'; instance_id: string }
  | { type: 'clearSelection' }
  | { type: 'trackInstance'; instance: TrackedInstance }
  | {
      type: 'updateTrackedInstance'
      instance_id: string
      patch: Partial<
        Omit<TrackedInstance, 'instance_id' | 'connection_id' | 'action_oid' | 'invoked_at'>
      >
    }

const INITIAL_STATE: ActiveInstanceState = { selection: null, trackedInstances: [] }

const PER_CONNECTION_CAP = 50

export function activeInstanceReducer(
  state: ActiveInstanceState,
  action: ActiveInstanceAction
): ActiveInstanceState {
  switch (action.type) {
    case 'selectAction':
      return { ...state, selection: { type: 'action', action_oid: action.action_oid } }
    case 'selectInstance':
      return { ...state, selection: { type: 'instance', instance_id: action.instance_id } }
    case 'clearSelection':
      return { ...state, selection: null }
    case 'trackInstance': {
      const incoming = action.instance
      // Prepend, then for the incoming connection only, drop the oldest if we exceed the cap.
      const prepended = [incoming, ...state.trackedInstances]
      const sameConn = prepended.filter((t) => t.connection_id === incoming.connection_id)
      if (sameConn.length <= PER_CONNECTION_CAP) {
        return { ...state, trackedInstances: prepended }
      }
      // Keep the first PER_CONNECTION_CAP of this connection's entries; drop the oldest extras.
      const keepIds = new Set(sameConn.slice(0, PER_CONNECTION_CAP).map((t) => t.instance_id))
      const filtered = prepended.filter(
        (t) => t.connection_id !== incoming.connection_id || keepIds.has(t.instance_id)
      )
      return { ...state, trackedInstances: filtered }
    }
    case 'updateTrackedInstance': {
      const idx = state.trackedInstances.findIndex((t) => t.instance_id === action.instance_id)
      if (idx === -1) return state
      const updated = { ...state.trackedInstances[idx], ...action.patch }
      const list = [...state.trackedInstances]
      list[idx] = updated
      return { ...state, trackedInstances: list }
    }
    default: {
      const _exhaustive: never = action
      void _exhaustive
      return state
    }
  }
}

export interface ActiveInstanceApi {
  state: ActiveInstanceState
  selectAction: (action_oid: string) => void
  selectInstance: (instance_id: string) => void
  clearSelection: () => void
  trackInstance: (
    instance: Omit<TrackedInstance, 'invoked_at'> & { invoked_at?: string }
  ) => TrackedInstance
  updateTrackedInstance: (
    instance_id: string,
    patch: Partial<
      Omit<TrackedInstance, 'instance_id' | 'connection_id' | 'action_oid' | 'invoked_at'>
    >
  ) => void
}

const ActiveInstanceContext = createContext<ActiveInstanceApi | null>(null)

export function ActiveInstanceProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(activeInstanceReducer, INITIAL_STATE)

  const selectAction = useCallback<ActiveInstanceApi['selectAction']>((action_oid) => {
    dispatch({ type: 'selectAction', action_oid })
  }, [])

  const selectInstance = useCallback<ActiveInstanceApi['selectInstance']>((instance_id) => {
    dispatch({ type: 'selectInstance', instance_id })
  }, [])

  const clearSelection = useCallback<ActiveInstanceApi['clearSelection']>(() => {
    dispatch({ type: 'clearSelection' })
  }, [])

  const trackInstance = useCallback<ActiveInstanceApi['trackInstance']>((instance) => {
    const full: TrackedInstance = {
      ...instance,
      invoked_at: instance.invoked_at ?? new Date().toISOString(),
    }
    dispatch({ type: 'trackInstance', instance: full })
    return full
  }, [])

  const updateTrackedInstance = useCallback<ActiveInstanceApi['updateTrackedInstance']>(
    (instance_id, patch) => {
      dispatch({ type: 'updateTrackedInstance', instance_id, patch })
    },
    []
  )

  const value = useMemo<ActiveInstanceApi>(
    () => ({
      state,
      selectAction,
      selectInstance,
      clearSelection,
      trackInstance,
      updateTrackedInstance,
    }),
    [state, selectAction, selectInstance, clearSelection, trackInstance, updateTrackedInstance]
  )

  return <ActiveInstanceContext.Provider value={value}>{children}</ActiveInstanceContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useActiveInstance(): ActiveInstanceApi {
  const ctx = useContext(ActiveInstanceContext)
  if (!ctx) {
    throw new Error('useActiveInstance must be used within an ActiveInstanceProvider')
  }
  return ctx
}

// eslint-disable-next-line react-refresh/only-export-components
export function useTrackedInstances(connection_id: string | undefined | null): TrackedInstance[] {
  const { state } = useActiveInstance()
  if (!connection_id) return []
  return state.trackedInstances.filter((t) => t.connection_id === connection_id)
}
```

- [ ] **Step 4: Run the test and verify it passes**

```powershell
npm test -- active-instance.test
```

Expected: all reducer and provider tests pass.

- [ ] **Step 5: Commit**

```powershell
git add src/store/active-instance.tsx src/store/active-instance.test.tsx
git commit -m "feat(store): ActiveInstanceContext (selection + tracked instances)"
```

---

## Task 6: Update `test-utils.tsx` to include ActiveInstanceProvider

**Files:**

- Modify: `C:\TrajectoryActionTester\src\test-utils.tsx`

Wrap `AllProviders` to mount `ActiveInstanceProvider` inside `ConnectionsProvider`. Downstream tests (Tasks 8-15) need both providers via `renderWithProviders`.

- [ ] **Step 1: Update test-utils.tsx**

Replace the `AllProviders` body with:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, type RenderOptions, type RenderResult } from '@testing-library/react'
import type { ReactElement, ReactNode } from 'react'
import { ConnectionsProvider } from './store/connections'
import { ActiveInstanceProvider } from './store/active-instance'

export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  })
}

interface ProvidersProps {
  children: ReactNode
  queryClient?: QueryClient
}

export function AllProviders({ children, queryClient }: ProvidersProps) {
  const client = queryClient ?? createTestQueryClient()
  return (
    <QueryClientProvider client={client}>
      <ConnectionsProvider>
        <ActiveInstanceProvider>{children}</ActiveInstanceProvider>
      </ConnectionsProvider>
    </QueryClientProvider>
  )
}

export function renderWithProviders(
  ui: ReactElement,
  options: Omit<RenderOptions, 'wrapper'> & { queryClient?: QueryClient } = {}
): RenderResult & { queryClient: QueryClient } {
  const queryClient = options.queryClient ?? createTestQueryClient()
  const result = render(ui, {
    wrapper: ({ children }) => <AllProviders queryClient={queryClient}>{children}</AllProviders>,
    ...options,
  })
  return { ...result, queryClient }
}
```

- [ ] **Step 2: Sanity-run all tests**

```powershell
cd C:/TrajectoryActionTester
npm test
```

Expected: all tests that previously passed still pass. (No tests rely on the ABSENCE of `ActiveInstanceProvider`, so adding it as a parent should be benign.) Test count unchanged.

- [ ] **Step 3: Commit**

```powershell
git add src/test-utils.tsx
git commit -m "chore(test): renderWithProviders wraps ActiveInstanceProvider"
```

---

## Task 7: `useInvoke` mutation hook

**Files:**

- Create: `C:\TrajectoryActionTester\src\store\use-invoke.ts`
- Create: `C:\TrajectoryActionTester\src\store\use-invoke.test.tsx`

A TanStack Query mutation wrapping `invokeAction`. On success: calls `trackInstance` with the new instance_id + the active connection + the invoking action OID, then `selectInstance(instance_id)` to flip the center view. On error: returns the ApiError via the mutation result; no tracking.

The hook also auto-generates `workflow_instance_id`, `step_instance_id`, `step_oid` per invoke (via `crypto.randomUUID()`) — callers only supply `environment_oid` (from the action) + `input_parameters`.

- [ ] **Step 1: Write failing tests**

Create `src/store/use-invoke.test.tsx`:

```tsx
import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { AllProviders, createTestQueryClient } from '../test-utils'
import { useConnections } from './connections'
import { useActiveInstance } from './active-instance'
import { useInvoke } from './use-invoke'

function makeWrapper() {
  const queryClient = createTestQueryClient()
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <AllProviders queryClient={queryClient}>{children}</AllProviders>
  )
  return { Wrapper, queryClient }
}

describe('useInvoke', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    localStorage.clear()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('is idle until invoked', () => {
    const { Wrapper } = makeWrapper()
    const { result } = renderHook(() => useInvoke(), { wrapper: Wrapper })
    expect(result.current.isIdle).toBe(true)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('on success: POSTs invoke, tracks the new instance, and selects it', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ data: { instance_id: 'inst-99' }, meta: {} }), {
        status: 201,
      })
    )

    const { Wrapper } = makeWrapper()
    const { result } = renderHook(
      () => {
        const connections = useConnections()
        const active = useActiveInstance()
        const invoke = useInvoke()
        return { connections, active, invoke }
      },
      { wrapper: Wrapper }
    )

    result.current.connections.addConnection({ url: 'http://localhost:3000' })

    result.current.invoke.mutate({
      action_oid: 'act-1',
      environment_oid: 'env-1',
      input_parameters: [{ name: 'k', value: 'v' }],
    })

    await waitFor(() => expect(result.current.invoke.isSuccess).toBe(true))

    // Tracked + selected.
    const tracked = result.current.active.state.trackedInstances
    expect(tracked).toHaveLength(1)
    expect(tracked[0].instance_id).toBe('inst-99')
    expect(tracked[0].action_oid).toBe('act-1')
    expect(result.current.active.state.selection).toEqual({
      type: 'instance',
      instance_id: 'inst-99',
    })

    // Fetch was POST with auto-generated IDs and the right body shape.
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:3000/trajectory/v1/actions/act-1/invoke',
      expect.objectContaining({ method: 'POST' })
    )
    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string)
    expect(body.environment_oid).toBe('env-1')
    expect(body.input_parameters).toEqual([{ name: 'k', value: 'v' }])
    expect(body.workflow_instance_id).toMatch(/^[0-9a-f-]{36}$/i)
    expect(body.step_instance_id).toMatch(/^[0-9a-f-]{36}$/i)
    expect(body.step_oid).toMatch(/^[0-9a-f-]{36}$/i)
  })

  it('on error: does NOT track and does NOT change selection', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response('bad params', { status: 400, statusText: 'Bad Request' })
    )

    const { Wrapper } = makeWrapper()
    const { result } = renderHook(
      () => {
        const connections = useConnections()
        const active = useActiveInstance()
        const invoke = useInvoke()
        return { connections, active, invoke }
      },
      { wrapper: Wrapper }
    )

    result.current.connections.addConnection({ url: 'http://localhost:3000' })
    result.current.invoke.mutate({
      action_oid: 'act-1',
      environment_oid: 'env-1',
      input_parameters: [],
    })

    await waitFor(() => expect(result.current.invoke.isError).toBe(true))
    expect(result.current.active.state.trackedInstances).toEqual([])
    expect(result.current.active.state.selection).toBeNull()
  })

  it('throws when invoked with no active connection', async () => {
    const { Wrapper } = makeWrapper()
    const { result } = renderHook(() => useInvoke(), { wrapper: Wrapper })
    result.current.mutate({
      action_oid: 'act-1',
      environment_oid: 'env-1',
      input_parameters: [],
    })
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.error?.message).toMatch(/no active connection/i)
  })
})
```

- [ ] **Step 2: Run the test and verify it fails**

```powershell
npm test -- use-invoke.test
```

Expected: tests fail — module does not exist.

- [ ] **Step 3: Implement the hook**

Create `src/store/use-invoke.ts`:

```ts
import { useMutation, type UseMutationResult } from '@tanstack/react-query'
import { invokeAction } from '../api/invoke'
import type { InvokeInputParameter } from '../api/types'
import { useActiveConnection } from './connections'
import { useActiveInstance } from './active-instance'

export interface InvokeArgs {
  action_oid: string
  environment_oid: string
  input_parameters: InvokeInputParameter[]
}

export interface InvokeResultData {
  instance_id: string
}

export function useInvoke(): UseMutationResult<InvokeResultData, Error, InvokeArgs> {
  const connection = useActiveConnection()
  const { trackInstance, selectInstance } = useActiveInstance()

  return useMutation<InvokeResultData, Error, InvokeArgs>({
    mutationFn: async (args) => {
      if (!connection) throw new Error('No active connection')
      return invokeAction(connection, args.action_oid, {
        environment_oid: args.environment_oid,
        workflow_instance_id: crypto.randomUUID(),
        step_instance_id: crypto.randomUUID(),
        step_oid: crypto.randomUUID(),
        input_parameters: args.input_parameters,
      })
    },
    onSuccess: (data, args) => {
      if (!connection) return
      trackInstance({
        instance_id: data.instance_id,
        connection_id: connection.id,
        action_oid: args.action_oid,
      })
      selectInstance(data.instance_id)
    },
  })
}
```

- [ ] **Step 4: Run the test and verify it passes**

```powershell
npm test -- use-invoke.test
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```powershell
git add src/store/use-invoke.ts src/store/use-invoke.test.tsx
git commit -m "feat(store): useInvoke mutation hook (tracks + selects on success)"
```

---

## Task 8: `useInstance` query hook

**Files:**

- Create: `C:\TrajectoryActionTester\src\store\use-instance.ts`
- Create: `C:\TrajectoryActionTester\src\store\use-instance.test.tsx`

Single-shot query (no refetch interval) for `fetchInstance`. Keyed by `['instance', connection?.id, instanceId]`. Disabled when either is null. On success, also writes the polled state back into the tracked-instance list via `updateTrackedInstance` so the InstanceList sidebar can color-code it.

- [ ] **Step 1: Write failing tests**

Create `src/store/use-instance.test.tsx`:

```tsx
import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { AllProviders, createTestQueryClient } from '../test-utils'
import { useConnections } from './connections'
import { useActiveInstance } from './active-instance'
import { useInstance } from './use-instance'

function makeWrapper() {
  const queryClient = createTestQueryClient()
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <AllProviders queryClient={queryClient}>{children}</AllProviders>
  )
  return { Wrapper, queryClient }
}

const sampleInstance = {
  instance_id: 'inst-1',
  action_oid: 'act-1',
  environment_oid: 'env-1',
  workflow_instance_id: 'wf-1',
  step_instance_id: 'step-1',
  step_oid: 'step-oid-1',
  visibility: 'observable',
  state: { current: 'EXECUTING', previous: 'STARTING', entered_at: '2026-05-13T00:00:01Z' },
  inputs: [],
  outputs: [],
  created_at: '2026-05-13T00:00:00Z',
  started_at: '2026-05-13T00:00:00Z',
  completed_at: null,
  error: null,
}

describe('useInstance', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    localStorage.clear()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('is idle when no connection is active or no instance_id is given', () => {
    const { Wrapper } = makeWrapper()
    const { result } = renderHook(() => useInstance(null), { wrapper: Wrapper })
    expect(result.current.fetchStatus).toBe('idle')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('fetches and returns the instance on 200', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ data: sampleInstance, meta: {} }), { status: 200 })
    )

    const { Wrapper } = makeWrapper()
    const { result } = renderHook(
      () => {
        const connections = useConnections()
        const instance = useInstance('inst-1')
        return { connections, instance }
      },
      { wrapper: Wrapper }
    )

    result.current.connections.addConnection({ url: 'http://localhost:3000' })

    await waitFor(() => expect(result.current.instance.isSuccess).toBe(true))
    expect(result.current.instance.data).toEqual(sampleInstance)
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:3000/trajectory/v1/instances/inst-1',
      expect.anything()
    )
  })

  it('writes polled state back into the tracked instance', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: { ...sampleInstance, state: { ...sampleInstance.state, current: 'COMPLETED' } },
          meta: {},
        }),
        { status: 200 }
      )
    )

    const { Wrapper } = makeWrapper()
    const { result } = renderHook(
      () => {
        const connections = useConnections()
        const active = useActiveInstance()
        const instance = useInstance('inst-1')
        return { connections, active, instance }
      },
      { wrapper: Wrapper }
    )

    const c = result.current.connections.addConnection({ url: 'http://localhost:3000' })
    result.current.active.trackInstance({
      instance_id: 'inst-1',
      connection_id: c.id,
      action_oid: 'act-1',
    })

    await waitFor(() => expect(result.current.instance.isSuccess).toBe(true))
    await waitFor(() => {
      const tracked = result.current.active.state.trackedInstances[0]
      expect(tracked.last_known_state).toBe('COMPLETED')
    })
  })

  it('surfaces 404 as isError', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response('not found', { status: 404 }))
    const { Wrapper } = makeWrapper()
    const { result } = renderHook(
      () => {
        const connections = useConnections()
        const instance = useInstance('inst-missing')
        return { connections, instance }
      },
      { wrapper: Wrapper }
    )
    result.current.connections.addConnection({ url: 'http://localhost:3000' })
    await waitFor(() => expect(result.current.instance.isError).toBe(true))
  })
})
```

- [ ] **Step 2: Run the test and verify it fails**

```powershell
npm test -- use-instance.test
```

Expected: tests fail — module does not exist.

- [ ] **Step 3: Implement the hook**

Create `src/store/use-instance.ts`:

```ts
import { useEffect } from 'react'
import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { fetchInstance } from '../api/instances'
import type { Instance } from '../api/types'
import { useActiveConnection } from './connections'
import { useActiveInstance } from './active-instance'

export function useInstance(instanceId: string | null): UseQueryResult<Instance, Error> {
  const connection = useActiveConnection()
  const { updateTrackedInstance } = useActiveInstance()

  const query = useQuery<Instance, Error>({
    queryKey: ['instance', connection?.id, connection?.url, connection?.apiKey, instanceId],
    queryFn: () => {
      if (!connection || !instanceId) throw new Error('No active connection or instance id')
      return fetchInstance(connection, instanceId)
    },
    enabled: connection !== null && instanceId !== null,
  })

  useEffect(() => {
    if (!query.isSuccess || !query.data) return
    updateTrackedInstance(query.data.instance_id, {
      last_known_state: query.data.state.current,
      last_known_error: query.data.error,
    })
  }, [query.isSuccess, query.data, updateTrackedInstance])

  return query
}
```

- [ ] **Step 4: Run the test and verify it passes**

```powershell
npm test -- use-instance.test
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```powershell
git add src/store/use-instance.ts src/store/use-instance.test.tsx
git commit -m "feat(store): useInstance query hook (writes polled state to tracker)"
```

---

## Task 9: ActionTree sidebar section

**Files:**

- Create: `C:\TrajectoryActionTester\src\features\sidebar\ActionTree.tsx`
- Create: `C:\TrajectoryActionTester\src\features\sidebar\ActionTree.module.css`
- Create: `C:\TrajectoryActionTester\src\features\sidebar\ActionTree.test.tsx`

Reads `useCapabilities()` for the active connection. Groups results by `visibility` (observable first, opaque second). Each action is a clickable row showing `local_id` plus a `<Pill>` of its visibility. Click selects (`selectAction(action_oid)`) and highlights the row when `selection.type === 'action' && selection.action_oid === c.action_oid`. Renders idle / loading / error / empty states.

- [ ] **Step 1: Write failing tests**

Create `src/features/sidebar/ActionTree.test.tsx`:

```tsx
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '../../test-utils'
import { ActionTree } from './ActionTree'

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('fetch', vi.fn())
})
afterEach(() => {
  localStorage.clear()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function seedConnection() {
  localStorage.setItem(
    'acT:connections:v1',
    JSON.stringify({
      connections: [{ id: 'c1', url: 'http://localhost:3000', createdAt: '2026-05-13T00:00:00Z' }],
      activeConnectionId: 'c1',
    })
  )
}

const sampleCapabilities = {
  data: [
    {
      action_oid: 'act-pick',
      environment_oid: 'env-1',
      local_id: 'PickItem',
      version: '1.0.0',
      visibility: 'observable',
      input_parameters: [],
      output_parameters: [],
      supported_commands: ['PAUSE'],
    },
    {
      action_oid: 'act-scan',
      environment_oid: 'env-1',
      local_id: 'ScanBarcode',
      version: '1.0.0',
      visibility: 'opaque',
      input_parameters: [],
      output_parameters: [],
      supported_commands: ['ABORT'],
    },
  ],
  meta: { total: 2 },
}

describe('ActionTree', () => {
  it('shows an idle prompt when no connection is active', () => {
    renderWithProviders(<ActionTree />)
    expect(screen.getByText(/no active connection/i)).toBeInTheDocument()
  })

  it('shows a loading state while fetching', async () => {
    seedConnection()
    vi.mocked(fetch).mockReturnValueOnce(new Promise(() => {}))
    renderWithProviders(<ActionTree />)
    expect(await screen.findByText(/loading/i)).toBeInTheDocument()
  })

  it('shows an empty state when the active connection reports zero actions', async () => {
    seedConnection()
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ data: [], meta: { total: 0 } }), { status: 200 })
    )
    renderWithProviders(<ActionTree />)
    await waitFor(() => expect(screen.getByText(/no actions/i)).toBeInTheDocument())
  })

  it('shows an error state when capabilities fetch fails', async () => {
    seedConnection()
    vi.mocked(fetch).mockResolvedValueOnce(new Response('boom', { status: 500 }))
    renderWithProviders(<ActionTree />)
    await waitFor(() => expect(screen.getByText(/failed to load actions/i)).toBeInTheDocument())
  })

  it('groups by visibility with Observable first then Opaque', async () => {
    seedConnection()
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify(sampleCapabilities), { status: 200 })
    )
    renderWithProviders(<ActionTree />)
    await waitFor(() => expect(screen.getByText('PickItem')).toBeInTheDocument())

    const observableHeading = screen.getByText(/^observable$/i)
    const opaqueHeading = screen.getByText(/^opaque$/i)
    expect(observableHeading.compareDocumentPosition(opaqueHeading)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    )
  })

  it('click on a row selects the action and highlights it', async () => {
    const user = userEvent.setup()
    seedConnection()
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify(sampleCapabilities), { status: 200 })
    )
    renderWithProviders(<ActionTree />)
    await waitFor(() => expect(screen.getByText('PickItem')).toBeInTheDocument())
    const row = screen.getByTestId('action-row-act-pick')
    await user.click(row)
    expect(row.className).toMatch(/active/i)
  })
})
```

- [ ] **Step 2: Run the test and verify it fails**

```powershell
npm test -- ActionTree
```

Expected: 6 tests fail.

- [ ] **Step 3: Implement ActionTree**

Create `src/features/sidebar/ActionTree.tsx`:

```tsx
import { useMemo } from 'react'
import { Pill } from '../../components/Pill'
import { useActiveInstance } from '../../store/active-instance'
import { useCapabilities } from '../../store/use-capabilities'
import { useActiveConnection } from '../../store/connections'
import type { ActionCapability } from '../../api/types'
import styles from './ActionTree.module.css'

function groupByVisibility(actions: ActionCapability[]): {
  observable: ActionCapability[]
  opaque: ActionCapability[]
} {
  const observable: ActionCapability[] = []
  const opaque: ActionCapability[] = []
  for (const a of actions) {
    if (a.visibility === 'observable') observable.push(a)
    else opaque.push(a)
  }
  return { observable, opaque }
}

export function ActionTree() {
  const connection = useActiveConnection()
  const capabilities = useCapabilities()
  const { state, selectAction } = useActiveInstance()

  const grouped = useMemo(
    () => groupByVisibility(capabilities.data?.data ?? []),
    [capabilities.data]
  )

  if (!connection) {
    return <p className={styles.message}>No active connection.</p>
  }
  if (capabilities.isPending && capabilities.fetchStatus === 'fetching') {
    return <p className={styles.message}>Loading actions…</p>
  }
  if (capabilities.isError) {
    return <p className={styles.error}>Failed to load actions.</p>
  }
  if ((capabilities.data?.data.length ?? 0) === 0) {
    return <p className={styles.message}>No actions on this container.</p>
  }

  const renderRow = (a: ActionCapability) => {
    const isActive =
      state.selection?.type === 'action' && state.selection.action_oid === a.action_oid
    return (
      <li key={a.action_oid}>
        <button
          type="button"
          data-testid={`action-row-${a.action_oid}`}
          className={[styles.row, isActive ? styles.rowActive : ''].join(' ').trim()}
          onClick={() => selectAction(a.action_oid)}
        >
          <span className={styles.label}>{a.local_id}</span>
          <Pill variant={a.visibility === 'observable' ? 'accent' : 'muted'}>{a.visibility}</Pill>
        </button>
      </li>
    )
  }

  return (
    <div className={styles.tree}>
      {grouped.observable.length > 0 && (
        <div className={styles.group}>
          <h4 className={styles.groupHeader}>Observable</h4>
          <ul className={styles.list}>{grouped.observable.map(renderRow)}</ul>
        </div>
      )}
      {grouped.opaque.length > 0 && (
        <div className={styles.group}>
          <h4 className={styles.groupHeader}>Opaque</h4>
          <ul className={styles.list}>{grouped.opaque.map(renderRow)}</ul>
        </div>
      )}
    </div>
  )
}
```

Create `src/features/sidebar/ActionTree.module.css`:

```css
.tree {
  display: flex;
  flex-direction: column;
  gap: var(--acT-pad-sm);
}

.message {
  font-size: var(--acT-fs-sm);
  color: var(--acT-text-muted);
  padding: var(--acT-pad-sm);
}

.error {
  font-size: var(--acT-fs-sm);
  color: var(--acT-error);
  padding: var(--acT-pad-sm);
}

.group {
  display: flex;
  flex-direction: column;
}

.groupHeader {
  font-size: var(--acT-fs-sm);
  font-weight: 600;
  color: var(--acT-text-subtle);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 4px var(--acT-pad-sm);
  margin: 0;
}

.list {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 1px;
  margin: 0;
  padding: 0;
}

.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--acT-pad-sm);
  width: 100%;
  background: transparent;
  border: 0;
  color: var(--acT-text);
  text-align: left;
  cursor: pointer;
  padding: var(--acT-pad-sm) var(--acT-pad);
  font: inherit;
  border-radius: var(--acT-radius);
}

.row:hover {
  background: var(--acT-panel-alt);
}

.rowActive {
  background: var(--acT-accent-bg);
}

.label {
  font-size: var(--acT-fs-base);
  font-weight: 500;
}
```

- [ ] **Step 4: Run the test and verify it passes**

```powershell
npm test -- ActionTree
```

Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```powershell
git add src/features/sidebar/ActionTree.tsx src/features/sidebar/ActionTree.module.css src/features/sidebar/ActionTree.test.tsx
git commit -m "feat(sidebar): ActionTree grouped by visibility with click-to-select"
```

---

## Task 10: InvokePanel center pane

**Files:**

- Create: `C:\TrajectoryActionTester\src\features\invoke-panel\InvokePanel.tsx`
- Create: `C:\TrajectoryActionTester\src\features\invoke-panel\InvokePanel.module.css`
- Create: `C:\TrajectoryActionTester\src\features\invoke-panel\InvokePanel.test.tsx`

Reads the current selection. When `selection.type === 'action'`, looks up the action in `useCapabilities().data` (the cache from Plan 2). Renders a form with one TextInput per input parameter (default-fills with `param.default` if present, otherwise empty). On submit: calls `useInvoke().mutate({ action_oid, environment_oid, input_parameters: [{name, value}, ...] })`. While the mutation is pending, disables the Invoke button. On error: shows the ApiError message inline.

When `selection.type !== 'action'` (i.e., the panel mounts but selection isn't an action — shouldn't normally happen since App switches by mode), shows nothing — App's mode router is the source of truth.

- [ ] **Step 1: Write failing tests**

Create `src/features/invoke-panel/InvokePanel.test.tsx`:

```tsx
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useEffect } from 'react'
import { renderWithProviders } from '../../test-utils'
import { useActiveInstance } from '../../store/active-instance'
import { InvokePanel } from './InvokePanel'

const sampleCapabilities = {
  data: [
    {
      action_oid: 'act-pick',
      environment_oid: 'env-1',
      local_id: 'PickItem',
      version: '1.0.0',
      description: 'Pick an item from a shelf',
      visibility: 'observable',
      input_parameters: [
        { name: 'item_sku', type: 'string', required: true },
        { name: 'quantity', type: 'string', default: '1' },
      ],
      output_parameters: [{ name: 'status', type: 'string' }],
      supported_commands: ['PAUSE'],
    },
  ],
  meta: { total: 1 },
}

function seedConnectionAndSelection() {
  localStorage.setItem(
    'acT:connections:v1',
    JSON.stringify({
      connections: [{ id: 'c1', url: 'http://localhost:3000', createdAt: '2026-05-13T00:00:00Z' }],
      activeConnectionId: 'c1',
    })
  )
}

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('fetch', vi.fn())
})
afterEach(() => {
  localStorage.clear()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

// A tiny harness that pre-selects the action via the context, then mounts the panel.
function TestHarness() {
  const { selectAction } = useActiveInstance()
  useEffect(() => {
    selectAction('act-pick')
  }, [selectAction])
  return <InvokePanel />
}

async function renderWithActionSelected() {
  seedConnectionAndSelection()
  vi.mocked(fetch).mockResolvedValueOnce(
    new Response(JSON.stringify(sampleCapabilities), { status: 200 })
  )
  const utils = renderWithProviders(<TestHarness />)
  // Wait for capabilities to load via TestHarness side-effect.
  await waitFor(() => expect(screen.getByText('PickItem')).toBeInTheDocument())
  return utils
}

describe('InvokePanel', () => {
  it('shows nothing useful when no action is selected', () => {
    renderWithProviders(<InvokePanel />)
    // No crash; nothing user-actionable in the panel.
    expect(screen.queryByRole('button', { name: /invoke/i })).not.toBeInTheDocument()
  })

  it('renders the action name + description once selected and capabilities load', async () => {
    await renderWithActionSelected()
    expect(screen.getByText('Pick an item from a shelf')).toBeInTheDocument()
  })

  it('renders one input field per input_parameter, default-filled', async () => {
    await renderWithActionSelected()
    const skuInput = screen.getByLabelText(/item_sku/i)
    const qtyInput = screen.getByLabelText(/quantity/i)
    expect(skuInput).toHaveValue('')
    expect(qtyInput).toHaveValue('1')
  })

  it('disables Invoke while a required input is empty', async () => {
    const user = userEvent.setup()
    await renderWithActionSelected()
    const invokeBtn = screen.getByRole('button', { name: /invoke/i })
    // item_sku is required and empty → button disabled.
    expect(invokeBtn).toBeDisabled()
    await user.type(screen.getByLabelText(/item_sku/i), 'SKU-1001')
    expect(invokeBtn).not.toBeDisabled()
  })

  it('submits invoke with {action_oid, environment_oid, input_parameters}', async () => {
    const user = userEvent.setup()
    await renderWithActionSelected()
    // Queue the invoke response AFTER the capabilities mock has been consumed.
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ data: { instance_id: 'inst-1' }, meta: {} }), { status: 201 })
    )
    await user.type(screen.getByLabelText(/item_sku/i), 'SKU-1001')
    await user.click(screen.getByRole('button', { name: /invoke/i }))
    await waitFor(() => {
      const calls = vi.mocked(fetch).mock.calls
      const invokeCall = calls.find(([url]) => String(url).includes('/invoke'))
      expect(invokeCall).toBeDefined()
      const body = JSON.parse(invokeCall![1]!.body as string)
      expect(body.environment_oid).toBe('env-1')
      expect(body.input_parameters).toEqual([
        { name: 'item_sku', value: 'SKU-1001' },
        { name: 'quantity', value: '1' },
      ])
    })
  })

  it('shows the error message inline on invoke failure', async () => {
    const user = userEvent.setup()
    await renderWithActionSelected()
    // Queue the failure AFTER the capabilities mock has been consumed.
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response('bad', { status: 400, statusText: 'Bad Request' })
    )
    await user.type(screen.getByLabelText(/item_sku/i), 'SKU-1001')
    await user.click(screen.getByRole('button', { name: /invoke/i }))
    await waitFor(() => expect(screen.getByText(/invoke failed/i)).toBeInTheDocument())
  })
})
```

- [ ] **Step 2: Run the test and verify it fails**

```powershell
npm test -- InvokePanel
```

Expected: tests fail — module does not exist.

- [ ] **Step 3: Implement InvokePanel**

Create `src/features/invoke-panel/InvokePanel.tsx`:

```tsx
import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react'
import { Button } from '../../components/Button'
import { Pill } from '../../components/Pill'
import { TextInput } from '../../components/TextInput'
import { useActiveInstance } from '../../store/active-instance'
import { useCapabilities } from '../../store/use-capabilities'
import { useInvoke } from '../../store/use-invoke'
import type { ActionCapability, InputParameterSpec } from '../../api/types'
import styles from './InvokePanel.module.css'

function defaultValueAsString(spec: InputParameterSpec): string {
  if (spec.default === undefined) return ''
  return String(spec.default)
}

export function InvokePanel() {
  const { state } = useActiveInstance()
  const capabilities = useCapabilities()
  const invoke = useInvoke()

  const selection = state.selection
  const action: ActionCapability | undefined = useMemo(() => {
    if (selection?.type !== 'action') return undefined
    return capabilities.data?.data.find((a) => a.action_oid === selection.action_oid)
  }, [selection, capabilities.data])

  const [values, setValues] = useState<Record<string, string>>({})

  // Reset form values when the selected action changes (or when its specs first arrive).
  useEffect(() => {
    if (!action) return
    const initial: Record<string, string> = {}
    for (const param of action.input_parameters) {
      initial[param.name] = defaultValueAsString(param)
    }
    setValues(initial)
  }, [action])

  if (!action) return null

  const handleChange = (name: string) => (e: ChangeEvent<HTMLInputElement>) => {
    setValues((prev) => ({ ...prev, [name]: e.target.value }))
  }

  const missingRequired = action.input_parameters.some(
    (p) => p.required && (values[p.name] ?? '').trim() === ''
  )

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (missingRequired) return
    invoke.mutate({
      action_oid: action.action_oid,
      environment_oid: action.environment_oid,
      input_parameters: action.input_parameters.map((p) => ({
        name: p.name,
        value: values[p.name] ?? '',
      })),
    })
  }

  const submitDisabled = missingRequired || invoke.isPending

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <h2 className={styles.title}>{action.local_id}</h2>
        <Pill variant={action.visibility === 'observable' ? 'accent' : 'muted'}>
          {action.visibility}
        </Pill>
      </div>
      {action.description && <p className={styles.description}>{action.description}</p>}

      <form onSubmit={handleSubmit} className={styles.form}>
        {action.input_parameters.length === 0 && (
          <p className={styles.muted}>No input parameters.</p>
        )}
        {action.input_parameters.map((param) => (
          <TextInput
            key={param.name}
            label={`${param.name}${param.required ? ' *' : ''}`}
            value={values[param.name] ?? ''}
            onChange={handleChange(param.name)}
            {...(param.description ? { helper: param.description } : {})}
          />
        ))}
        <div className={styles.actions}>
          <Button type="submit" variant="primary" disabled={submitDisabled}>
            {invoke.isPending ? 'Invoking…' : 'Invoke'}
          </Button>
        </div>
      </form>

      {invoke.isError && (
        <p className={styles.error}>Invoke failed: {invoke.error?.message ?? 'unknown error'}</p>
      )}
    </div>
  )
}
```

Create `src/features/invoke-panel/InvokePanel.module.css`:

```css
.panel {
  display: flex;
  flex-direction: column;
  gap: var(--acT-pad);
  max-width: 640px;
}

.header {
  display: flex;
  align-items: center;
  gap: var(--acT-pad-sm);
}

.title {
  font-size: 18px;
  font-weight: 600;
  color: var(--acT-text);
  margin: 0;
}

.description {
  color: var(--acT-text-subtle);
  font-size: var(--acT-fs-base);
  margin: 0;
}

.form {
  display: flex;
  flex-direction: column;
  gap: var(--acT-pad);
  margin-top: var(--acT-pad-sm);
}

.muted {
  color: var(--acT-text-muted);
  font-size: var(--acT-fs-sm);
}

.actions {
  display: flex;
  justify-content: flex-end;
}

.error {
  color: var(--acT-error);
  font-size: var(--acT-fs-sm);
}
```

- [ ] **Step 4: Run the test and verify it passes**

```powershell
npm test -- InvokePanel
```

Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```powershell
git add src/features/invoke-panel/InvokePanel.tsx src/features/invoke-panel/InvokePanel.module.css src/features/invoke-panel/InvokePanel.test.tsx
git commit -m "feat(invoke-panel): form-generated InvokePanel with mutation"
```

---

## Task 11: InstancePanel placeholder

**Files:**

- Create: `C:\TrajectoryActionTester\src\features\instance-panel\InstancePanel.tsx`
- Create: `C:\TrajectoryActionTester\src\features\instance-panel\InstancePanel.module.css`
- Create: `C:\TrajectoryActionTester\src\features\instance-panel\InstancePanel.test.tsx`

Reads the current selection. When `selection.type === 'instance'`, calls `useInstance(instance_id)`. Shows: instance_id, action_oid, visibility, current state (as a `<Pill>`), entered_at timestamp, and error (if any). Plan 4-04 will replace this minimal view with the full `<InstancePanel />` from spec § 5 (StateDiagram + StateTimeline + CommandBar + OutputsView).

- [ ] **Step 1: Write failing tests**

Create `src/features/instance-panel/InstancePanel.test.tsx`:

```tsx
import { screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useEffect } from 'react'
import { renderWithProviders } from '../../test-utils'
import { useActiveInstance } from '../../store/active-instance'
import { InstancePanel } from './InstancePanel'

const sampleInstance = {
  instance_id: 'inst-1',
  action_oid: 'act-pick',
  environment_oid: 'env-1',
  workflow_instance_id: 'wf-1',
  step_instance_id: 'step-1',
  step_oid: 'step-oid-1',
  visibility: 'observable',
  state: { current: 'EXECUTING', previous: 'STARTING', entered_at: '2026-05-13T00:00:01Z' },
  inputs: [],
  outputs: [],
  created_at: '2026-05-13T00:00:00Z',
  started_at: '2026-05-13T00:00:00Z',
  completed_at: null,
  error: null,
}

function seedConnection() {
  localStorage.setItem(
    'acT:connections:v1',
    JSON.stringify({
      connections: [{ id: 'c1', url: 'http://localhost:3000', createdAt: '2026-05-13T00:00:00Z' }],
      activeConnectionId: 'c1',
    })
  )
}

function TestHarness({ instanceId }: { instanceId: string }) {
  const { selectInstance } = useActiveInstance()
  useEffect(() => {
    selectInstance(instanceId)
  }, [instanceId, selectInstance])
  return <InstancePanel />
}

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('fetch', vi.fn())
})
afterEach(() => {
  localStorage.clear()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('InstancePanel', () => {
  it('renders nothing when no instance is selected', () => {
    renderWithProviders(<InstancePanel />)
    expect(screen.queryByText(/instance/i)).not.toBeInTheDocument()
  })

  it('shows loading state while fetching', () => {
    seedConnection()
    vi.mocked(fetch).mockReturnValueOnce(new Promise(() => {}))
    renderWithProviders(<TestHarness instanceId="inst-1" />)
    expect(screen.getByText(/loading instance/i)).toBeInTheDocument()
  })

  it('shows instance_id, action_oid, visibility, current state on success', async () => {
    seedConnection()
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ data: sampleInstance, meta: {} }), { status: 200 })
    )
    renderWithProviders(<TestHarness instanceId="inst-1" />)
    await waitFor(() => expect(screen.getByText('inst-1')).toBeInTheDocument())
    expect(screen.getByText('act-pick')).toBeInTheDocument()
    expect(screen.getByText('observable')).toBeInTheDocument()
    expect(screen.getByText('EXECUTING')).toBeInTheDocument()
  })

  it('shows the error message when the instance has terminal error', async () => {
    seedConnection()
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            ...sampleInstance,
            state: { ...sampleInstance.state, current: 'ABORTED' },
            error: 'oops',
          },
          meta: {},
        }),
        { status: 200 }
      )
    )
    renderWithProviders(<TestHarness instanceId="inst-1" />)
    await waitFor(() => expect(screen.getByText(/oops/)).toBeInTheDocument())
  })

  it('shows a fetch error when the instance API returns 404', async () => {
    seedConnection()
    vi.mocked(fetch).mockResolvedValueOnce(new Response('not found', { status: 404 }))
    renderWithProviders(<TestHarness instanceId="inst-missing" />)
    await waitFor(() => expect(screen.getByText(/failed to load instance/i)).toBeInTheDocument())
  })
})
```

- [ ] **Step 2: Run the test and verify it fails**

```powershell
npm test -- InstancePanel
```

Expected: tests fail — module does not exist.

- [ ] **Step 3: Implement InstancePanel**

Create `src/features/instance-panel/InstancePanel.tsx`:

```tsx
import { Pill } from '../../components/Pill'
import { useActiveInstance } from '../../store/active-instance'
import { useInstance } from '../../store/use-instance'
import styles from './InstancePanel.module.css'

function pillVariantForState(state: string): 'success' | 'error' | 'accent' | 'neutral' {
  if (state === 'COMPLETED') return 'success'
  if (state === 'ABORTED' || state === 'STOPPING' || state === 'ABORTING') return 'error'
  if (state === 'EXECUTING' || state === 'IN_PROGRESS') return 'accent'
  return 'neutral'
}

export function InstancePanel() {
  const { state } = useActiveInstance()
  const selection = state.selection
  const instanceId = selection?.type === 'instance' ? selection.instance_id : null
  const query = useInstance(instanceId)

  if (!instanceId) return null

  if (query.isPending && query.fetchStatus !== 'idle') {
    return <p className={styles.message}>Loading instance…</p>
  }
  if (query.isError) {
    return <p className={styles.error}>Failed to load instance: {query.error?.message}</p>
  }
  if (!query.data) return null

  const instance = query.data

  return (
    <div className={styles.panel}>
      <header className={styles.header}>
        <h2 className={styles.title}>{instance.instance_id}</h2>
        <Pill variant={pillVariantForState(instance.state.current)}>{instance.state.current}</Pill>
      </header>

      <dl className={styles.meta}>
        <div className={styles.metaRow}>
          <dt className={styles.metaKey}>Action</dt>
          <dd className={styles.metaValue}>{instance.action_oid}</dd>
        </div>
        <div className={styles.metaRow}>
          <dt className={styles.metaKey}>Visibility</dt>
          <dd className={styles.metaValue}>{instance.visibility}</dd>
        </div>
        <div className={styles.metaRow}>
          <dt className={styles.metaKey}>State entered</dt>
          <dd className={styles.metaValue}>{instance.state.entered_at}</dd>
        </div>
      </dl>

      {instance.error && <p className={styles.terminalError}>{instance.error}</p>}

      <p className={styles.muted}>
        Live state monitoring (SSE) and command buttons arrive in plan 4-04.
      </p>
    </div>
  )
}
```

Create `src/features/instance-panel/InstancePanel.module.css`:

```css
.panel {
  display: flex;
  flex-direction: column;
  gap: var(--acT-pad);
  max-width: 640px;
}

.header {
  display: flex;
  align-items: center;
  gap: var(--acT-pad-sm);
}

.title {
  font-size: 18px;
  font-weight: 600;
  color: var(--acT-text);
  margin: 0;
  font-family: var(--acT-mono);
}

.meta {
  display: flex;
  flex-direction: column;
  gap: var(--acT-pad-sm);
  margin: 0;
}

.metaRow {
  display: grid;
  grid-template-columns: 120px 1fr;
  gap: var(--acT-pad-sm);
}

.metaKey {
  color: var(--acT-text-subtle);
  font-size: var(--acT-fs-sm);
}

.metaValue {
  color: var(--acT-text);
  font-size: var(--acT-fs-base);
  font-family: var(--acT-mono);
  margin: 0;
}

.message {
  color: var(--acT-text-muted);
  font-size: var(--acT-fs-sm);
}

.error {
  color: var(--acT-error);
  font-size: var(--acT-fs-sm);
}

.terminalError {
  color: var(--acT-error);
  background: rgba(244, 135, 113, 0.08);
  padding: var(--acT-pad-sm) var(--acT-pad);
  border-radius: var(--acT-radius);
  font-family: var(--acT-mono);
  font-size: var(--acT-fs-sm);
}

.muted {
  color: var(--acT-text-muted);
  font-size: var(--acT-fs-sm);
  font-style: italic;
}
```

- [ ] **Step 4: Run the test and verify it passes**

```powershell
npm test -- InstancePanel
```

Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```powershell
git add src/features/instance-panel/InstancePanel.tsx src/features/instance-panel/InstancePanel.module.css src/features/instance-panel/InstancePanel.test.tsx
git commit -m "feat(instance-panel): minimal placeholder showing polled state"
```

---

## Task 12: InstanceList sidebar section

**Files:**

- Create: `C:\TrajectoryActionTester\src\features\sidebar\InstanceList.tsx`
- Create: `C:\TrajectoryActionTester\src\features\sidebar\InstanceList.module.css`
- Create: `C:\TrajectoryActionTester\src\features\sidebar\InstanceList.test.tsx`

Uses `useActiveConnection()` + `useTrackedInstances(connection.id)`. Each tracked instance is a clickable row showing `instance_id` (truncated to first 8 chars) + a `<Pill>` of `last_known_state ?? '—'`. Click selects (`selectInstance(instance_id)`) and the active row gets a highlight.

- [ ] **Step 1: Write failing tests**

Create `src/features/sidebar/InstanceList.test.tsx`:

```tsx
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useEffect } from 'react'
import { renderWithProviders } from '../../test-utils'
import { useActiveInstance } from '../../store/active-instance'
import { InstanceList } from './InstanceList'

function seedConnection() {
  localStorage.setItem(
    'acT:connections:v1',
    JSON.stringify({
      connections: [{ id: 'c1', url: 'http://localhost:3000', createdAt: '2026-05-13T00:00:00Z' }],
      activeConnectionId: 'c1',
    })
  )
}

function HarnessWithTracked({ count }: { count: number }) {
  const { trackInstance } = useActiveInstance()
  useEffect(() => {
    for (let i = 0; i < count; i++) {
      trackInstance({
        instance_id: `instance-id-${i}`,
        connection_id: 'c1',
        action_oid: `act-${i}`,
        last_known_state: i === 0 ? 'COMPLETED' : 'EXECUTING',
      })
    }
  }, [count, trackInstance])
  return <InstanceList />
}

beforeEach(() => {
  localStorage.clear()
})
afterEach(() => {
  localStorage.clear()
})

describe('InstanceList', () => {
  it('shows an idle prompt when no connection is active', () => {
    renderWithProviders(<InstanceList />)
    expect(screen.getByText(/no active connection/i)).toBeInTheDocument()
  })

  it('shows an empty state when no instances are tracked yet', () => {
    seedConnection()
    renderWithProviders(<InstanceList />)
    expect(screen.getByText(/no instances yet/i)).toBeInTheDocument()
  })

  it('renders one row per tracked instance for the active connection', () => {
    seedConnection()
    renderWithProviders(<HarnessWithTracked count={3} />)
    expect(screen.getByTestId('instance-row-instance-id-0')).toBeInTheDocument()
    expect(screen.getByTestId('instance-row-instance-id-1')).toBeInTheDocument()
    expect(screen.getByTestId('instance-row-instance-id-2')).toBeInTheDocument()
  })

  it('truncates instance_id to its first 8 characters in the row', () => {
    seedConnection()
    renderWithProviders(<HarnessWithTracked count={1} />)
    expect(screen.getByText('instance')).toBeInTheDocument()
  })

  it('click on a row selects the instance and highlights it', async () => {
    const user = userEvent.setup()
    seedConnection()
    renderWithProviders(<HarnessWithTracked count={2} />)
    const row = screen.getByTestId('instance-row-instance-id-1')
    await user.click(row)
    expect(row.className).toMatch(/active/i)
  })

  it('shows the last_known_state in a state pill', () => {
    seedConnection()
    renderWithProviders(<HarnessWithTracked count={2} />)
    expect(screen.getByText('COMPLETED')).toBeInTheDocument()
    expect(screen.getAllByText('EXECUTING').length).toBeGreaterThanOrEqual(1)
  })
})
```

- [ ] **Step 2: Run the test and verify it fails**

```powershell
npm test -- InstanceList
```

Expected: 6 tests fail.

- [ ] **Step 3: Implement InstanceList**

Create `src/features/sidebar/InstanceList.tsx`:

```tsx
import { Pill, type PillVariant } from '../../components/Pill'
import { useActiveConnection } from '../../store/connections'
import { useActiveInstance, useTrackedInstances } from '../../store/active-instance'
import styles from './InstanceList.module.css'

function pillVariantForState(s: string | undefined): PillVariant {
  if (!s) return 'muted'
  if (s === 'COMPLETED') return 'success'
  if (s === 'ABORTED' || s === 'STOPPING' || s === 'ABORTING') return 'error'
  if (s === 'EXECUTING' || s === 'IN_PROGRESS') return 'accent'
  return 'neutral'
}

export function InstanceList() {
  const connection = useActiveConnection()
  const tracked = useTrackedInstances(connection?.id)
  const { state, selectInstance } = useActiveInstance()

  if (!connection) {
    return <p className={styles.message}>No active connection.</p>
  }
  if (tracked.length === 0) {
    return <p className={styles.message}>No instances yet. Invoke an action to start.</p>
  }

  return (
    <ul className={styles.list}>
      {tracked.map((t) => {
        const isActive =
          state.selection?.type === 'instance' && state.selection.instance_id === t.instance_id
        const stateLabel = t.last_known_state ?? '—'
        return (
          <li key={t.instance_id}>
            <button
              type="button"
              data-testid={`instance-row-${t.instance_id}`}
              className={[styles.row, isActive ? styles.rowActive : ''].join(' ').trim()}
              onClick={() => selectInstance(t.instance_id)}
            >
              <span className={styles.id}>{t.instance_id.slice(0, 8)}</span>
              <Pill variant={pillVariantForState(t.last_known_state)}>{stateLabel}</Pill>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
```

Create `src/features/sidebar/InstanceList.module.css`:

```css
.message {
  font-size: var(--acT-fs-sm);
  color: var(--acT-text-muted);
  padding: var(--acT-pad-sm);
}

.list {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 1px;
  margin: 0;
  padding: 0;
}

.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--acT-pad-sm);
  width: 100%;
  background: transparent;
  border: 0;
  color: var(--acT-text);
  text-align: left;
  cursor: pointer;
  padding: var(--acT-pad-sm) var(--acT-pad);
  font: inherit;
  border-radius: var(--acT-radius);
}

.row:hover {
  background: var(--acT-panel-alt);
}

.rowActive {
  background: var(--acT-accent-bg);
}

.id {
  font-size: var(--acT-fs-base);
  font-family: var(--acT-mono);
  color: var(--acT-text);
}
```

- [ ] **Step 4: Run the test and verify it passes**

```powershell
npm test -- InstanceList
```

Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```powershell
git add src/features/sidebar/InstanceList.tsx src/features/sidebar/InstanceList.module.css src/features/sidebar/InstanceList.test.tsx
git commit -m "feat(sidebar): InstanceList with click-to-select and state pills"
```

---

## Task 13: Wire ActionTree + InstanceList into Sidebar

**Files:**

- Modify: `C:\TrajectoryActionTester\src\features\sidebar\Sidebar.tsx`

Add two more `<Section>` mounts after Connections.

- [ ] **Step 1: Update Sidebar.tsx**

Replace `src/features/sidebar/Sidebar.tsx` with:

```tsx
import { useState, type ReactNode } from 'react'
import { ActionTree } from './ActionTree'
import { ConnectionList } from './ConnectionList'
import { InstanceList } from './InstanceList'
import styles from './Sidebar.module.css'

interface SectionProps {
  title: string
  defaultOpen?: boolean
  children: ReactNode
}

function Section({ title, defaultOpen = true, children }: SectionProps) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className={styles.section}>
      <button
        type="button"
        className={styles.header}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className={styles.caret} aria-hidden>
          {open ? '▾' : '▸'}
        </span>
        <span className={styles.title}>{title}</span>
      </button>
      {open && <div className={styles.body}>{children}</div>}
    </section>
  )
}

export function Sidebar() {
  return (
    <nav className={styles.sidebar} aria-label="Sidebar">
      <Section title="Connections">
        <ConnectionList />
      </Section>
      <Section title="Actions">
        <ActionTree />
      </Section>
      <Section title="Instances">
        <InstanceList />
      </Section>
    </nav>
  )
}
```

- [ ] **Step 2: Run the full suite**

```powershell
cd C:/TrajectoryActionTester
npm test
```

Expected: all previously-passing tests still pass. No new tests added in this task (the sections are exercised in the integration test in Task 15).

- [ ] **Step 3: Commit**

```powershell
git add src/features/sidebar/Sidebar.tsx
git commit -m "feat(sidebar): mount Actions and Instances sections"
```

---

## Task 14: Wire `<App />` to switch center view by selection mode

**Files:**

- Modify: `C:\TrajectoryActionTester\src\App.tsx`
- Modify: `C:\TrajectoryActionTester\src\App.test.tsx`

`<App />` previously rendered a static placeholder in the main pane. Now it wraps in `<ActiveInstanceProvider>` and switches the main pane by `selection.type`:

- `null` → "Select an action from the sidebar" placeholder
- `'action'` → `<InvokePanel />`
- `'instance'` → `<InstancePanel />`

- [ ] **Step 1: Update App.tsx**

Replace `src/App.tsx` with:

```tsx
import { ConnectionBar } from './features/connection-bar/ConnectionBar'
import { InvokePanel } from './features/invoke-panel/InvokePanel'
import { InstancePanel } from './features/instance-panel/InstancePanel'
import { Sidebar } from './features/sidebar/Sidebar'
import { ActiveInstanceProvider, useActiveInstance } from './store/active-instance'
import { ConnectionsProvider } from './store/connections'
import styles from './App.module.css'

function MainView() {
  const { state } = useActiveInstance()
  if (state.selection?.type === 'action') return <InvokePanel />
  if (state.selection?.type === 'instance') return <InstancePanel />
  return (
    <p className={styles.placeholder}>Select an action or instance from the sidebar to begin.</p>
  )
}

export function App() {
  return (
    <ConnectionsProvider>
      <ActiveInstanceProvider>
        <div className={styles.shell}>
          <header className={styles.header} role="banner">
            <ConnectionBar />
          </header>
          <aside className={styles.sidebar}>
            <Sidebar />
          </aside>
          <main className={styles.main}>
            <MainView />
          </main>
          <aside className={styles.inspector} aria-label="Inspector">
            <p className={styles.placeholder}>Log inspector — coming in plan 4-05.</p>
          </aside>
        </div>
      </ActiveInstanceProvider>
    </ConnectionsProvider>
  )
}
```

- [ ] **Step 2: Update App.test.tsx**

Replace `src/App.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import { App } from './App'
import { renderWithProviders } from './test-utils'

describe('App shell', () => {
  it('renders the three-pane shell landmarks', () => {
    renderWithProviders(<App />)
    expect(screen.getByRole('banner')).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: /sidebar/i })).toBeInTheDocument()
    expect(screen.getByRole('main')).toBeInTheDocument()
    expect(screen.getByRole('complementary', { name: /inspector/i })).toBeInTheDocument()
  })

  it('shows the Connections sidebar section', () => {
    renderWithProviders(<App />)
    expect(screen.getByRole('button', { name: /connections/i, expanded: true })).toBeInTheDocument()
  })

  it('shows the Actions sidebar section', () => {
    renderWithProviders(<App />)
    expect(screen.getByRole('button', { name: /^actions$/i, expanded: true })).toBeInTheDocument()
  })

  it('shows the Instances sidebar section', () => {
    renderWithProviders(<App />)
    expect(screen.getByRole('button', { name: /^instances$/i, expanded: true })).toBeInTheDocument()
  })

  it('main pane defaults to the idle placeholder', () => {
    renderWithProviders(<App />)
    expect(screen.getByText(/select an action or instance from the sidebar/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 3: Run the full suite**

```powershell
cd C:/TrajectoryActionTester
npm test
```

Expected: all suites pass. App-shell test count is now 5 (was 3 after Plan 2 fixes).

- [ ] **Step 4: Commit**

```powershell
git add src/App.tsx src/App.test.tsx
git commit -m "feat(app): wire ActiveInstanceProvider + selection-driven center view"
```

---

## Task 15: Integration test — invoke flow end-to-end

**Files:**

- Modify: `C:\TrajectoryActionTester\src\__tests__\integration.test.tsx`

Add one more `it` block covering the full happy path beyond Plan 2's "add connection → capabilities loaded": click an action in the sidebar, see the InvokePanel, fill the form, click Invoke, observe InstancePanel showing the polled state, and the new instance appearing in the InstanceList.

- [ ] **Step 1: Append a new test to the existing describe block**

Open `src/__tests__/integration.test.tsx`. Inside the existing `describe('Integration: add a connection and load capabilities', ...)` block (after the existing tests), add:

```tsx
it('full happy path: connect → browse → select action → invoke → instance shown', async () => {
  // 1. /capabilities returns one action.
  vi.mocked(fetch).mockResolvedValueOnce(
    new Response(
      JSON.stringify({
        data: [
          {
            action_oid: 'act-pick',
            environment_oid: 'env-1',
            local_id: 'PickItem',
            version: '1.0.0',
            description: 'Pick an item',
            visibility: 'observable',
            input_parameters: [{ name: 'sku', type: 'string', required: true }],
            output_parameters: [],
            supported_commands: ['PAUSE'],
          },
        ],
        meta: { total: 1 },
      }),
      { status: 200 }
    )
  )
  // 2. /invoke returns a new instance_id.
  vi.mocked(fetch).mockResolvedValueOnce(
    new Response(JSON.stringify({ data: { instance_id: 'inst-42' }, meta: {} }), {
      status: 201,
    })
  )
  // 3. /instances/inst-42 returns the polled instance shape.
  vi.mocked(fetch).mockResolvedValueOnce(
    new Response(
      JSON.stringify({
        data: {
          instance_id: 'inst-42',
          action_oid: 'act-pick',
          environment_oid: 'env-1',
          workflow_instance_id: 'wf',
          step_instance_id: 'step',
          step_oid: 'step-oid',
          visibility: 'observable',
          state: {
            current: 'COMPLETED',
            previous: 'COMPLETING',
            entered_at: '2026-05-13T00:00:02Z',
          },
          inputs: [{ name: 'sku', value: 'SKU-1001' }],
          outputs: [{ name: 'status', value: '0' }],
          created_at: '2026-05-13T00:00:00Z',
          started_at: '2026-05-13T00:00:00Z',
          completed_at: '2026-05-13T00:00:02Z',
          error: null,
        },
        meta: {},
      }),
      { status: 200 }
    )
  )

  const user = userEvent.setup()
  renderWithProviders(<App />)

  // Add the connection.
  await user.click(screen.getByTestId('connection-trigger'))
  await user.click(screen.getByRole('button', { name: /add connection/i }))
  await user.type(screen.getByLabelText(/server url/i), 'http://localhost:3000')
  await user.click(screen.getByRole('button', { name: /save/i }))

  // Wait for capabilities to load → ActionTree shows PickItem.
  await waitFor(() => expect(screen.getByText('PickItem')).toBeInTheDocument())

  // Click the action — InvokePanel mounts in the main pane.
  await user.click(screen.getByTestId('action-row-act-pick'))
  expect(screen.getByText(/pick an item/i)).toBeInTheDocument()

  // Fill the required input, submit.
  await user.type(screen.getByLabelText(/^sku/i), 'SKU-1001')
  await user.click(screen.getByRole('button', { name: /invoke/i }))

  // InstancePanel renders with the polled state.
  await waitFor(() => expect(screen.getByText('inst-42')).toBeInTheDocument())
  expect(screen.getByText('COMPLETED')).toBeInTheDocument()

  // Sidebar Instances section now lists the new instance.
  expect(screen.getByTestId('instance-row-inst-42')).toBeInTheDocument()
})
```

- [ ] **Step 2: Run the integration test**

```powershell
cd C:/TrajectoryActionTester
npm test -- integration
```

Expected: 3 tests pass (2 from Plan 2 + 1 new).

- [ ] **Step 3: Run the full suite**

```powershell
npm test
```

Expected: all tests across the project pass.

- [ ] **Step 4: Commit**

```powershell
git add src/__tests__/integration.test.tsx
git commit -m "test: integration test for connect -> select action -> invoke -> instance shown"
```

---

## Task 16: Final sanity check + bundle-size sanity

**Files:**

- (no new files — verification + marker commit)

Mirror of Plan 2's Task 15.

- [ ] **Step 1: Run every npm script**

```powershell
cd C:/TrajectoryActionTester
npm run lint
npm run typecheck
npm test
npm run build
```

Expected: all four exit 0. Capture the gzipped size from the build output.

- [ ] **Step 2: Confirm preview command works**

```powershell
npm run preview
```

Expected: serves on `http://localhost:4173/` (or auto-promotes to next free port). Curl to confirm 200. Stop with Ctrl+C.

- [ ] **Step 3: Bundle-size check**

Compare to Plan 2 baseline of 76.70 KB gz. Plan 3 adds: 2 API clients (~3 KB), 2 hooks (~2 KB), 1 context (~2 KB), 1 primitive (~1 KB), 4 features (~8 KB), CSS for all of the above. Rough budget: under 100 KB gz total. Spec budget is 200 KB gz — comfortable margin.

If gzipped exceeds 110 KB, that's still inside the spec budget but warrants a diff inspection.

- [ ] **Step 4: Confirm clean tree**

```powershell
git status
```

Expected: "nothing to commit, working tree clean".

- [ ] **Step 5: Confirm sensible commit history**

```powershell
git log --oneline 1ca2f93..HEAD
```

Expected: roughly 14 commits (one per task + a few sub-commits for review fixes if any).

- [ ] **Step 6: Marker commit**

```powershell
git commit --allow-empty -m "chore: plan 4-03 complete — gzipped baseline <NN.NN> KB"
```

Replace `<NN.NN>` with the actual gzipped KB from Step 3.

---

## Self-Review checklist (for the executing engineer)

Sanity-check against spec § 4 + § 5 + § 11 plan 4-03 deliverables:

- ✅ `<ActionTree />` LHS grouped by visibility — Task 9.
- ✅ `<InvokePanel />` center with form generated from `input_parameters` — Task 10.
- ✅ POST `/invoke` — Tasks 2 + 7.
- ✅ After invoke, minimal "instance created" placeholder showing instance_id + polled state — Task 11.
- ✅ `<InstanceList />` LHS section tracking invoked instances — Task 12.
- ✅ Selection-driven center view (idle / action / instance) — Task 14.
- ✅ Integration test covers full flow — Task 15.
- ✅ Single-file build still works — Task 16.

What's NOT in this plan and is handled later:

- `useInstanceStream` SSE hook (Plan 4-04)
- Full `<InstancePanel />` with StateDiagram + StateTimeline + CommandBar + OutputsView (Plan 4-04)
- `<StateDiagram />` and log inspector RHS pane (Plan 4-05)
- Output deltas, bundle-size gate, polish (Plan 4-06)

---

## Failure recovery

If any task fails partway:

1. `git status` — see what's changed since the last commit.
2. If the partial change is broken: `git reset --hard HEAD` to revert.
3. Re-read the task's steps and re-run them.

If a test hangs: TanStack Query mutation/query cleanup is usually the culprit. Confirm `renderWithProviders` is used (which gives a fresh client per call with `gcTime: 0`).

If `react-refresh/only-export-components` lint warning fires unexpectedly: the eslint-disable-next-line comments in `connections.tsx` and `active-instance.tsx` cover known cases. New non-component exports from a `.tsx` file should get the same disable comment.

If a fetch assertion fails because the URL has multiple trailing slashes: the API clients all use `replace(/\/+$/, '')` which strips them — confirm with the existing tests in `capabilities.test.ts` and `invoke.test.ts`.
