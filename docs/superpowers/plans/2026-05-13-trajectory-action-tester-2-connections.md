# Trajectory Action Tester — Plan 2: Connections + Capabilities

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plug the empty top bar and sidebar from Plan 1 into a working connection-management layer that adds/edits/deletes containers, persists them in `localStorage`, fetches each container's `GET /trajectory/v1/capabilities`, and surfaces success/failure as a status dot. After this plan, a user can open the app, click "+ Add connection", point at a running Trajectory Action Container, see the dot turn green, and switch between multiple saved containers.

**Architecture:** `ConnectionsContext` (one `useReducer` + a tiny persistence hook) owns the list of saved connections and the active selection; state mirrors to `localStorage["acT:connections:v1"]` and rehydrates via lazy initial state on mount. TanStack Query owns the per-connection `/capabilities` cache, keyed by connection ID. Three feature components — `<ConnectionBar />` (top), `<Sidebar />` containing `<ConnectionList />` (LHS), `<ConnectionModal />` (form popup) — plus three CSS-Modules primitives (`<Button />`, `<TextInput />`, `<Modal />`) make up the UI. No routing; the Sidebar's accordion shell holds only the Connections section today but is structured so Plan 4-03 drops the ActionTree in as section 2 without restructuring.

**Tech Stack:** React 19 + TypeScript strict, `@tanstack/react-query` v5, vanilla CSS Modules, Vitest 3, `@testing-library/react` + `@testing-library/user-event`. No new npm dependencies.

**Spec:** `docs/specs/2026-05-11-trajectory-action-tester-v2-design.md` — §4 (Context Boundaries), §5 (Three-Pane Layout / ConnectionBar / Sidebar), §10 (Testing Strategy).

**Server endpoint consumed:** `GET /trajectory/v1/capabilities` — returns `{ data: ActionCapability[], meta: { total: number } }`. See `packages/server/src/routes/protocol.ts:88-110` in the Trajectory monorepo for the canonical response shape.

---

## File Structure

This plan creates **3 new directories** (`src/api/`, `src/store/`, `src/components/`, `src/features/connection-bar/`, `src/features/sidebar/`) and modifies the existing `App.tsx`/`App.module.css`/`App.test.tsx`. The Plan 1 `.gitkeep` placeholders inside `src/api/`, `src/store/`, `src/components/`, `src/features/` are deleted as real files take their place.

| Path                                                     | Role                                                                                                                                                                            |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/api/types.ts`                                       | Shared API types — `Connection`, `CapabilitiesResponse`, `ActionCapability`, `ApiError`.                                                                                        |
| `src/api/capabilities.ts`                                | `fetchCapabilities(connection)` — single function wrapping `fetch` against `/trajectory/v1/capabilities`.                                                                         |
| `src/api/capabilities.test.ts`                           | Tests for `fetchCapabilities` with `vi.stubGlobal('fetch', ...)`.                                                                                                               |
| `src/store/use-local-storage-persist.ts`                 | `useLocalStoragePersist` write-side hook + `loadLocalStorage` lazy-read helper.                                                                                                 |
| `src/store/use-local-storage-persist.test.tsx`           | Hook tests covering persist, load, malformed JSON fallback.                                                                                                                     |
| `src/store/connections.tsx`                              | `ConnectionsContext`, `ConnectionsProvider`, `useConnections`, `useActiveConnection`, reducer + types.                                                                          |
| `src/store/connections.test.tsx`                         | Reducer tests + provider round-trip persistence test.                                                                                                                           |
| `src/store/use-capabilities.ts`                          | `useCapabilities()` — TanStack Query wrapping `fetchCapabilities` keyed by active connection.                                                                                   |
| `src/store/use-capabilities.test.tsx`                    | Hook test with mocked fetch + QueryClient wrapper.                                                                                                                              |
| `src/components/Button.tsx`                              | Generic `<button>` with variants (primary/secondary/danger) + size (md/sm).                                                                                                     |
| `src/components/Button.module.css`                       | Button styles.                                                                                                                                                                  |
| `src/components/Button.test.tsx`                         | Button click + disabled tests.                                                                                                                                                  |
| `src/components/TextInput.tsx`                           | Labeled text input + optional helper text + error styling.                                                                                                                      |
| `src/components/TextInput.module.css`                    | Input styles.                                                                                                                                                                   |
| `src/components/TextInput.test.tsx`                      | Input change + label association tests.                                                                                                                                         |
| `src/components/Modal.tsx`                               | Backdrop + dialog with close-on-escape and close-on-backdrop-click.                                                                                                             |
| `src/components/Modal.module.css`                        | Modal styles.                                                                                                                                                                   |
| `src/components/Modal.test.tsx`                          | Open/close behavior, escape key, backdrop click.                                                                                                                                |
| `src/features/connection-bar/ConnectionBar.tsx`          | Top bar — status dot + active label + dropdown switcher + "+ Add" button.                                                                                                       |
| `src/features/connection-bar/ConnectionBar.module.css`   | Top bar styles (replaces existing `.header` shell styles for content beyond placeholder).                                                                                       |
| `src/features/connection-bar/ConnectionBar.test.tsx`     | Status colors, dropdown open/close, switch active, delete from dropdown.                                                                                                        |
| `src/features/connection-bar/ConnectionModal.tsx`        | Add/edit form — URL (required), name (optional), API key (optional, masked).                                                                                                    |
| `src/features/connection-bar/ConnectionModal.module.css` | Modal form styles.                                                                                                                                                              |
| `src/features/connection-bar/ConnectionModal.test.tsx`   | Form validation + submit + edit-mode prefills.                                                                                                                                  |
| `src/features/sidebar/Sidebar.tsx`                       | Collapsible-section accordion shell + `<ConnectionList />` as section 1.                                                                                                        |
| `src/features/sidebar/Sidebar.module.css`                | Accordion section styles.                                                                                                                                                       |
| `src/features/sidebar/ConnectionList.tsx`                | List of saved connections (active row highlighted) — click selects.                                                                                                             |
| `src/features/sidebar/ConnectionList.module.css`         | Row styles.                                                                                                                                                                     |
| `src/features/sidebar/ConnectionList.test.tsx`           | Render + click-to-select + active highlight.                                                                                                                                    |
| `src/App.tsx`                                            | **Modified** — wrap `<App />` body in `<ConnectionsProvider>`, render `<ConnectionBar />` in header, `<Sidebar />` in LHS, drop placeholder text.                               |
| `src/App.module.css`                                     | **Modified** — drop `.dot`/`.title`/`.placeholder` (moved to ConnectionBar) and shell padding tweaks.                                                                           |
| `src/App.test.tsx`                                       | **Modified** — assertions updated for new shell content; wraps with `QueryClientProvider` + provider.                                                                           |
| `src/__tests__/integration.test.tsx`                     | End-to-end test: add connection → mock fetch → capabilities loaded → status green.                                                                                              |
| `src/test-utils.tsx`                                     | `renderWithProviders` helper — wraps a tree in `QueryClientProvider` (fresh client) + `ConnectionsProvider`. Used by all component/integration tests that need either provider. |

After this plan the existing `.gitkeep` placeholders at `src/api/.gitkeep`, `src/store/.gitkeep`, `src/components/.gitkeep`, `src/features/.gitkeep` (created in Plan 1 Task 11) become redundant. Leave them in place; later plans (4-03 → 4-06) add more files alongside.

---

## Pre-flight check

Before starting, confirm Plan 1 finished cleanly:

```powershell
cd C:\TrajectoryActionTester
git log --oneline | Measure-Object -Line   # expect ~10 lines
git status                                  # expect "nothing to commit, working tree clean"
npm test                                    # expect 2 tests pass
```

If any of these fail, finish Plan 1 first (its Task 13 is the verification gate).

No new npm dependencies are required for this plan — all libraries (`@tanstack/react-query`, `@testing-library/user-event`, MSW) are already in `package.json`. `crypto.randomUUID()` is a Web Platform API available in jsdom 24+ and all modern browsers (no `uuid` package needed).

---

## Task 1: `useLocalStoragePersist` hook

**Files:**

- Create: `C:\TrajectoryActionTester\src\store\use-local-storage-persist.ts`
- Create: `C:\TrajectoryActionTester\src\store\use-local-storage-persist.test.tsx`

The hook has two pieces: a write-side `useLocalStoragePersist(key, value)` that mirrors a serializable value into `localStorage` whenever it changes, and a sibling pure function `loadLocalStorage(key, fallback)` used by `useReducer`'s lazy-init function. Both must swallow exceptions (quota errors, JSON-parse errors, `localStorage` unavailable in private-mode) and return the fallback rather than throwing — silent failure is the right behavior for a developer tool where corrupted state should never crash the app.

- [ ] **Step 1: Write failing tests**

Create `src/store/use-local-storage-persist.test.tsx`:

```tsx
import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { loadLocalStorage, useLocalStoragePersist } from './use-local-storage-persist'

describe('loadLocalStorage', () => {
  afterEach(() => {
    localStorage.clear()
  })

  it('returns the fallback when the key is missing', () => {
    expect(loadLocalStorage('missing', { foo: 'bar' })).toEqual({ foo: 'bar' })
  })

  it('returns the stored value when the key exists and parses', () => {
    localStorage.setItem('present', JSON.stringify({ foo: 'baz' }))
    expect(loadLocalStorage('present', { foo: 'bar' })).toEqual({ foo: 'baz' })
  })

  it('returns the fallback when stored JSON is malformed', () => {
    localStorage.setItem('garbled', '{this is not json')
    expect(loadLocalStorage('garbled', { foo: 'bar' })).toEqual({ foo: 'bar' })
  })
})

describe('useLocalStoragePersist', () => {
  afterEach(() => {
    localStorage.clear()
  })

  it('writes the current value on mount', () => {
    renderHook(() => useLocalStoragePersist('mount-key', { n: 1 }))
    expect(JSON.parse(localStorage.getItem('mount-key') ?? 'null')).toEqual({ n: 1 })
  })

  it('writes the new value when it changes', () => {
    const { rerender } = renderHook(
      ({ v }: { v: number }) => useLocalStoragePersist('change-key', { n: v }),
      {
        initialProps: { v: 1 },
      }
    )
    rerender({ v: 2 })
    expect(JSON.parse(localStorage.getItem('change-key') ?? 'null')).toEqual({ n: 2 })
  })

  it('swallows errors when localStorage throws', () => {
    const original = Storage.prototype.setItem
    Storage.prototype.setItem = () => {
      throw new Error('quota exceeded')
    }
    try {
      // Should not throw.
      renderHook(() => useLocalStoragePersist('throw-key', { n: 1 }))
    } finally {
      Storage.prototype.setItem = original
    }
  })
})
```

- [ ] **Step 2: Run the test and verify it fails**

```powershell
npm test -- use-local-storage-persist
```

Expected: 5 tests fail with "Cannot find module './use-local-storage-persist'" or similar.

- [ ] **Step 3: Implement the hook**

Create `src/store/use-local-storage-persist.ts`:

```ts
import { useEffect } from 'react'

export function useLocalStoragePersist<T>(key: string, value: T): void {
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value))
    } catch {
      // localStorage may throw on quota exceeded, in private browsing on
      // some browsers, or when serialization fails. Persistence is a
      // best-effort convenience here — swallow and move on.
    }
  }, [key, value])
}

export function loadLocalStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (raw === null) return fallback
    const parsed = JSON.parse(raw) as unknown
    if (parsed === null || typeof parsed !== 'object') return fallback
    return parsed as T
  } catch {
    return fallback
  }
}
```

- [ ] **Step 4: Run the test and verify it passes**

```powershell
npm test -- use-local-storage-persist
```

Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```powershell
git add src/store/use-local-storage-persist.ts src/store/use-local-storage-persist.test.tsx
git commit -m "feat(store): useLocalStoragePersist write-side hook + loader"
```

---

## Task 2: API types and `fetchCapabilities` client

**Files:**

- Create: `C:\TrajectoryActionTester\src\api\types.ts`
- Create: `C:\TrajectoryActionTester\src\api\capabilities.ts`
- Create: `C:\TrajectoryActionTester\src\api\capabilities.test.ts`

`Connection` is the shape persisted in `localStorage` — `id` (uuid), `url`, optional `name`, optional `apiKey`, plus `createdAt`. `CapabilitiesResponse` mirrors the server response wrapper `{ data, meta }` from `protocol.ts:106-109`. `ApiError` is the typed Error subclass thrown for non-2xx responses so consumers can branch on `status`.

- [ ] **Step 1: Create the types file**

Create `src/api/types.ts`:

```ts
export interface Connection {
  id: string
  url: string
  name?: string
  apiKey?: string
  createdAt: string
}

export type ActionVisibility = 'observable' | 'opaque'

export interface InputParameterSpec {
  name: string
  type: string
  required?: boolean
  default?: string | number | boolean
  description?: string
}

export interface OutputParameterSpec {
  name: string
  type: string
  description?: string
}

export interface ActionCapability {
  action_oid: string
  environment_oid: string
  local_id: string
  version: string
  description?: string
  visibility: ActionVisibility
  input_parameters: InputParameterSpec[]
  output_parameters: OutputParameterSpec[]
  supported_commands: string[]
}

export interface CapabilitiesResponse {
  data: ActionCapability[]
  meta: { total: number }
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly statusText: string,
    public readonly body: string
  ) {
    super(`HTTP ${status} ${statusText}`)
    this.name = 'ApiError'
  }
}
```

- [ ] **Step 2: Write failing tests for the client**

Create `src/api/capabilities.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from './types'
import { fetchCapabilities } from './capabilities'
import type { Connection } from './types'

const baseConnection: Connection = {
  id: 'conn-1',
  url: 'http://localhost:3000',
  createdAt: '2026-05-13T00:00:00Z',
}

describe('fetchCapabilities', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('hits {url}/trajectory/v1/capabilities with Accept JSON', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ data: [], meta: { total: 0 } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )
    await fetchCapabilities(baseConnection)
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:3000/trajectory/v1/capabilities',
      expect.objectContaining({ headers: expect.objectContaining({ Accept: 'application/json' }) })
    )
  })

  it('strips a trailing slash from the connection URL', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ data: [], meta: { total: 0 } }), { status: 200 })
    )
    await fetchCapabilities({ ...baseConnection, url: 'http://localhost:3000/' })
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:3000/trajectory/v1/capabilities',
      expect.anything()
    )
  })

  it('adds Authorization: Bearer when apiKey is present', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ data: [], meta: { total: 0 } }), { status: 200 })
    )
    await fetchCapabilities({ ...baseConnection, apiKey: 'secret-token' })
    expect(fetch).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer secret-token' }),
      })
    )
  })

  it('returns the parsed body on 200', async () => {
    const body = {
      data: [
        {
          action_oid: 'act-1',
          environment_oid: 'env-1',
          local_id: 'PickItem',
          version: '1.0.0',
          visibility: 'observable',
          input_parameters: [],
          output_parameters: [],
          supported_commands: ['PAUSE'],
        },
      ],
      meta: { total: 1 },
    }
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(body), { status: 200 }))
    const result = await fetchCapabilities(baseConnection)
    expect(result).toEqual(body)
  })

  it('throws ApiError on non-2xx', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response('Internal Server Error', { status: 500, statusText: 'Internal Server Error' })
    )
    await expect(fetchCapabilities(baseConnection)).rejects.toBeInstanceOf(ApiError)
  })

  it('exposes status, statusText, and body on ApiError', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response('not found body', { status: 404, statusText: 'Not Found' })
    )
    try {
      await fetchCapabilities(baseConnection)
      throw new Error('expected to throw')
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError)
      const apiErr = err as ApiError
      expect(apiErr.status).toBe(404)
      expect(apiErr.statusText).toBe('Not Found')
      expect(apiErr.body).toContain('not found body')
    }
  })
})
```

- [ ] **Step 3: Run the test and verify it fails**

```powershell
npm test -- capabilities
```

Expected: 6 tests fail because `./capabilities` does not export `fetchCapabilities` yet.

- [ ] **Step 4: Implement the client**

Create `src/api/capabilities.ts`:

```ts
import type { CapabilitiesResponse, Connection } from './types'
import { ApiError } from './types'

export async function fetchCapabilities(connection: Connection): Promise<CapabilitiesResponse> {
  const baseUrl = connection.url.replace(/\/+$/, '')
  const url = `${baseUrl}/trajectory/v1/capabilities`

  const headers: Record<string, string> = { Accept: 'application/json' }
  if (connection.apiKey) {
    headers.Authorization = `Bearer ${connection.apiKey}`
  }

  const response = await fetch(url, { headers })
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new ApiError(response.status, response.statusText, body)
  }
  return (await response.json()) as CapabilitiesResponse
}
```

- [ ] **Step 5: Run the test and verify it passes**

```powershell
npm test -- capabilities
```

Expected: 6 tests pass.

- [ ] **Step 6: Commit**

```powershell
git add src/api/types.ts src/api/capabilities.ts src/api/capabilities.test.ts
git commit -m "feat(api): types + fetchCapabilities client with ApiError"
```

---

## Task 3: ConnectionsContext with reducer + persistence

**Files:**

- Create: `C:\TrajectoryActionTester\src\store\connections.tsx`
- Create: `C:\TrajectoryActionTester\src\store\connections.test.tsx`

One `useReducer` owns `{ connections: Connection[], activeConnectionId: string | null }`. Adding a connection auto-selects it if no current selection. Deleting the active connection falls back to the first remaining connection (or `null` if list empties). The reducer is pure — `crypto.randomUUID()` and `Date.now()` are passed in via the action payload for new connections, not generated inside the reducer, so reducer tests stay deterministic. The Provider component generates them and dispatches.

- [ ] **Step 1: Write failing reducer + provider tests**

Create `src/store/connections.test.tsx`:

```tsx
import { act, render, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ReactNode } from 'react'
import {
  ConnectionsProvider,
  STORAGE_KEY,
  connectionsReducer,
  useActiveConnection,
  useConnections,
} from './connections'
import type { Connection } from '../api/types'

const wrapper = ({ children }: { children: ReactNode }) => (
  <ConnectionsProvider>{children}</ConnectionsProvider>
)

const sampleConnection: Connection = {
  id: 'conn-1',
  url: 'http://localhost:3000',
  name: 'Local dev',
  createdAt: '2026-05-13T00:00:00Z',
}

describe('connectionsReducer', () => {
  it('adds a connection and auto-selects it when none is active', () => {
    const next = connectionsReducer(
      { connections: [], activeConnectionId: null },
      { type: 'add', connection: sampleConnection }
    )
    expect(next.connections).toEqual([sampleConnection])
    expect(next.activeConnectionId).toBe('conn-1')
  })

  it('adds a second connection without changing the active selection', () => {
    const second: Connection = { ...sampleConnection, id: 'conn-2', url: 'http://other' }
    const next = connectionsReducer(
      { connections: [sampleConnection], activeConnectionId: 'conn-1' },
      { type: 'add', connection: second }
    )
    expect(next.connections).toHaveLength(2)
    expect(next.activeConnectionId).toBe('conn-1')
  })

  it('updates an existing connection by id', () => {
    const next = connectionsReducer(
      { connections: [sampleConnection], activeConnectionId: 'conn-1' },
      { type: 'update', id: 'conn-1', patch: { name: 'Renamed', apiKey: 'sek' } }
    )
    expect(next.connections[0].name).toBe('Renamed')
    expect(next.connections[0].apiKey).toBe('sek')
    expect(next.connections[0].url).toBe('http://localhost:3000')
  })

  it('deletes a connection and falls back to first remaining when active was removed', () => {
    const second: Connection = { ...sampleConnection, id: 'conn-2' }
    const next = connectionsReducer(
      { connections: [sampleConnection, second], activeConnectionId: 'conn-1' },
      { type: 'delete', id: 'conn-1' }
    )
    expect(next.connections).toEqual([second])
    expect(next.activeConnectionId).toBe('conn-2')
  })

  it('clears active selection when the last connection is deleted', () => {
    const next = connectionsReducer(
      { connections: [sampleConnection], activeConnectionId: 'conn-1' },
      { type: 'delete', id: 'conn-1' }
    )
    expect(next.connections).toEqual([])
    expect(next.activeConnectionId).toBeNull()
  })

  it('explicitly selects a connection', () => {
    const second: Connection = { ...sampleConnection, id: 'conn-2' }
    const next = connectionsReducer(
      { connections: [sampleConnection, second], activeConnectionId: 'conn-1' },
      { type: 'select', id: 'conn-2' }
    )
    expect(next.activeConnectionId).toBe('conn-2')
  })

  it('allows clearing the active selection with select null', () => {
    const next = connectionsReducer(
      { connections: [sampleConnection], activeConnectionId: 'conn-1' },
      { type: 'select', id: null }
    )
    expect(next.activeConnectionId).toBeNull()
  })
})

describe('ConnectionsProvider', () => {
  afterEach(() => {
    localStorage.clear()
  })

  it('exposes empty initial state to consumers', () => {
    const { result } = renderHook(() => useConnections(), { wrapper })
    expect(result.current.state.connections).toEqual([])
    expect(result.current.state.activeConnectionId).toBeNull()
  })

  it('rehydrates from localStorage on mount', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ connections: [sampleConnection], activeConnectionId: 'conn-1' })
    )
    const { result } = renderHook(() => useConnections(), { wrapper })
    expect(result.current.state.connections).toEqual([sampleConnection])
    expect(result.current.state.activeConnectionId).toBe('conn-1')
  })

  it('persists changes back to localStorage', () => {
    const { result } = renderHook(() => useConnections(), { wrapper })
    act(() => {
      result.current.addConnection({ url: 'http://localhost:3000', name: 'Local' })
    })
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as {
      connections: Connection[]
      activeConnectionId: string | null
    }
    expect(stored.connections).toHaveLength(1)
    expect(stored.connections[0].name).toBe('Local')
    expect(stored.activeConnectionId).toBe(stored.connections[0].id)
  })

  it('addConnection generates an id and createdAt', () => {
    const { result } = renderHook(() => useConnections(), { wrapper })
    act(() => {
      result.current.addConnection({ url: 'http://x' })
    })
    const added = result.current.state.connections[0]
    expect(added.id).toMatch(/^[0-9a-f-]{36}$/i)
    expect(new Date(added.createdAt).toString()).not.toBe('Invalid Date')
  })

  it('useActiveConnection returns null when nothing is selected', () => {
    const { result } = renderHook(() => useActiveConnection(), { wrapper })
    expect(result.current).toBeNull()
  })

  it('useActiveConnection returns the active connection object', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ connections: [sampleConnection], activeConnectionId: 'conn-1' })
    )
    const { result } = renderHook(() => useActiveConnection(), { wrapper })
    expect(result.current).toEqual(sampleConnection)
  })

  it('throws when useConnections is called outside the provider', () => {
    function Consumer() {
      useConnections()
      return null
    }
    // Suppress React's expected error output for this negative test.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<Consumer />)).toThrow(/ConnectionsProvider/)
    spy.mockRestore()
  })
})
```

- [ ] **Step 2: Run the test and verify it fails**

```powershell
npm test -- connections.test
```

Expected: all tests fail because `./connections` does not export anything yet.

- [ ] **Step 3: Implement the reducer + provider**

Create `src/store/connections.tsx`:

```tsx
import { createContext, useCallback, useContext, useMemo, useReducer, type ReactNode } from 'react'
import type { Connection } from '../api/types'
import { loadLocalStorage, useLocalStoragePersist } from './use-local-storage-persist'

export const STORAGE_KEY = 'acT:connections:v1'

export interface ConnectionsState {
  connections: Connection[]
  activeConnectionId: string | null
}

export type ConnectionsAction =
  | { type: 'add'; connection: Connection }
  | { type: 'update'; id: string; patch: Partial<Omit<Connection, 'id' | 'createdAt'>> }
  | { type: 'delete'; id: string }
  | { type: 'select'; id: string | null }

const INITIAL_STATE: ConnectionsState = { connections: [], activeConnectionId: null }

export function connectionsReducer(
  state: ConnectionsState,
  action: ConnectionsAction
): ConnectionsState {
  switch (action.type) {
    case 'add': {
      const list = [...state.connections, action.connection]
      return {
        connections: list,
        activeConnectionId: state.activeConnectionId ?? action.connection.id,
      }
    }
    case 'update': {
      return {
        ...state,
        connections: state.connections.map((c) =>
          c.id === action.id ? { ...c, ...action.patch } : c
        ),
      }
    }
    case 'delete': {
      const filtered = state.connections.filter((c) => c.id !== action.id)
      const nextActive =
        state.activeConnectionId === action.id
          ? (filtered[0]?.id ?? null)
          : state.activeConnectionId
      return { connections: filtered, activeConnectionId: nextActive }
    }
    case 'select': {
      return { ...state, activeConnectionId: action.id }
    }
  }
}

export interface ConnectionsApi {
  state: ConnectionsState
  addConnection: (fields: { url: string; name?: string; apiKey?: string }) => Connection
  updateConnection: (id: string, patch: Partial<Omit<Connection, 'id' | 'createdAt'>>) => void
  deleteConnection: (id: string) => void
  selectConnection: (id: string | null) => void
}

const ConnectionsContext = createContext<ConnectionsApi | null>(null)

export function ConnectionsProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(connectionsReducer, INITIAL_STATE, (initial) =>
    loadLocalStorage(STORAGE_KEY, initial)
  )

  useLocalStoragePersist(STORAGE_KEY, state)

  const addConnection = useCallback<ConnectionsApi['addConnection']>((fields) => {
    const connection: Connection = {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      url: fields.url,
      ...(fields.name !== undefined && { name: fields.name }),
      ...(fields.apiKey !== undefined && { apiKey: fields.apiKey }),
    }
    dispatch({ type: 'add', connection })
    return connection
  }, [])

  const updateConnection = useCallback<ConnectionsApi['updateConnection']>((id, patch) => {
    dispatch({ type: 'update', id, patch })
  }, [])

  const deleteConnection = useCallback<ConnectionsApi['deleteConnection']>((id) => {
    dispatch({ type: 'delete', id })
  }, [])

  const selectConnection = useCallback<ConnectionsApi['selectConnection']>((id) => {
    dispatch({ type: 'select', id })
  }, [])

  const value = useMemo<ConnectionsApi>(
    () => ({ state, addConnection, updateConnection, deleteConnection, selectConnection }),
    [state, addConnection, updateConnection, deleteConnection, selectConnection]
  )

  return <ConnectionsContext.Provider value={value}>{children}</ConnectionsContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useConnections(): ConnectionsApi {
  const ctx = useContext(ConnectionsContext)
  if (!ctx) {
    throw new Error('useConnections must be used within a ConnectionsProvider')
  }
  return ctx
}

// eslint-disable-next-line react-refresh/only-export-components
export function useActiveConnection(): Connection | null {
  const { state } = useConnections()
  return state.connections.find((c) => c.id === state.activeConnectionId) ?? null
}
```

Notes:

- `useReducer`'s third arg is the lazy-init function; it receives `INITIAL_STATE` and returns the rehydrated state from `localStorage`. This avoids reading `localStorage` on every render.
- The two `eslint-disable-next-line` comments are required because `react-refresh/only-export-components` warns when a `.tsx` file exports non-component functions (the hooks). The disable scopes to that one line.

- [ ] **Step 4: Run the test and verify it passes**

```powershell
npm test -- connections.test
```

Expected: all reducer and provider tests pass.

- [ ] **Step 5: Commit**

```powershell
git add src/store/connections.tsx src/store/connections.test.tsx
git commit -m "feat(store): ConnectionsContext with reducer + localStorage persistence"
```

---

## Task 4: Test helper — `renderWithProviders`

**Files:**

- Create: `C:\TrajectoryActionTester\src\test-utils.tsx`

A reusable render helper that wraps a tree in `QueryClientProvider` (fresh client per test) and `ConnectionsProvider`. Centralized here so every component/integration test can opt in without copy-pasting boilerplate.

- [ ] **Step 1: Create the helper (no test required — verified by downstream usage)**

Create `src/test-utils.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, type RenderOptions, type RenderResult } from '@testing-library/react'
import type { ReactElement, ReactNode } from 'react'
import { ConnectionsProvider } from './store/connections'

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
      <ConnectionsProvider>{children}</ConnectionsProvider>
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

- [ ] **Step 2: Sanity-check by running existing tests (no new behavior)**

```powershell
npm test
```

Expected: all previously-passing tests still pass (Task 1-3 + Plan 1's App tests). No new tests added in this task.

- [ ] **Step 3: Commit**

```powershell
git add src/test-utils.tsx
git commit -m "chore(test): renderWithProviders helper (Query + Connections)"
```

---

## Task 5: `useCapabilities` hook

**Files:**

- Create: `C:\TrajectoryActionTester\src\store\use-capabilities.ts`
- Create: `C:\TrajectoryActionTester\src\store\use-capabilities.test.tsx`

A thin wrapper around TanStack Query's `useQuery`, keyed by `['capabilities', activeConnectionId]`. Disabled when no connection is active. Returns the standard Query result shape, so consumers branch on `.isPending`, `.isError`, `.isSuccess`, `.data`, `.error`.

- [ ] **Step 1: Write failing tests**

Create `src/store/use-capabilities.test.tsx`:

```tsx
import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { AllProviders, createTestQueryClient } from '../test-utils'
import { useConnections } from './connections'
import { useCapabilities } from './use-capabilities'

function makeWrapper() {
  const queryClient = createTestQueryClient()
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <AllProviders queryClient={queryClient}>{children}</AllProviders>
  )
  return { Wrapper, queryClient }
}

describe('useCapabilities', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    localStorage.clear()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('is idle when no connection is active', () => {
    const { Wrapper } = makeWrapper()
    const { result } = renderHook(() => useCapabilities(), { wrapper: Wrapper })
    expect(result.current.isPending).toBe(true)
    expect(result.current.fetchStatus).toBe('idle')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('fetches capabilities for the active connection and returns data on success', async () => {
    const responseBody = { data: [], meta: { total: 0 } }
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify(responseBody), { status: 200 })
    )

    const { Wrapper } = makeWrapper()
    const { result } = renderHook(
      () => {
        const connections = useConnections()
        const capabilities = useCapabilities()
        return { connections, capabilities }
      },
      { wrapper: Wrapper }
    )

    // Add connection -> becomes active -> query fires.
    result.current.connections.addConnection({ url: 'http://localhost:3000' })

    await waitFor(() => expect(result.current.capabilities.isSuccess).toBe(true))
    expect(result.current.capabilities.data).toEqual(responseBody)
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:3000/trajectory/v1/capabilities',
      expect.anything()
    )
  })

  it('surfaces network failures as isError', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError('Failed to fetch'))

    const { Wrapper } = makeWrapper()
    const { result } = renderHook(
      () => {
        const connections = useConnections()
        const capabilities = useCapabilities()
        return { connections, capabilities }
      },
      { wrapper: Wrapper }
    )

    result.current.connections.addConnection({ url: 'http://unreachable' })
    await waitFor(() => expect(result.current.capabilities.isError).toBe(true))
    expect(result.current.capabilities.error).toBeInstanceOf(TypeError)
  })

  it('surfaces 5xx as isError', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response('boom', { status: 500, statusText: 'Internal Server Error' })
    )

    const { Wrapper } = makeWrapper()
    const { result } = renderHook(
      () => {
        const connections = useConnections()
        const capabilities = useCapabilities()
        return { connections, capabilities }
      },
      { wrapper: Wrapper }
    )

    result.current.connections.addConnection({ url: 'http://err' })
    await waitFor(() => expect(result.current.capabilities.isError).toBe(true))
  })
})
```

- [ ] **Step 2: Run the test and verify it fails**

```powershell
npm test -- use-capabilities
```

Expected: tests fail because `./use-capabilities` does not exist.

- [ ] **Step 3: Implement the hook**

Create `src/store/use-capabilities.ts`:

```ts
import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { fetchCapabilities } from '../api/capabilities'
import type { CapabilitiesResponse } from '../api/types'
import { useActiveConnection } from './connections'

export function useCapabilities(): UseQueryResult<CapabilitiesResponse, Error> {
  const connection = useActiveConnection()
  return useQuery({
    queryKey: ['capabilities', connection?.id],
    queryFn: () => {
      if (!connection) throw new Error('No active connection')
      return fetchCapabilities(connection)
    },
    enabled: connection !== null,
  })
}
```

- [ ] **Step 4: Run the test and verify it passes**

```powershell
npm test -- use-capabilities
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```powershell
git add src/store/use-capabilities.ts src/store/use-capabilities.test.tsx
git commit -m "feat(store): useCapabilities hook (TanStack Query keyed by connection)"
```

---

## Task 6: Button primitive

**Files:**

- Create: `C:\TrajectoryActionTester\src\components\Button.tsx`
- Create: `C:\TrajectoryActionTester\src\components\Button.module.css`
- Create: `C:\TrajectoryActionTester\src\components\Button.test.tsx`

Three variants (primary, secondary, danger) and two sizes (md, sm). Forwards all native button props except `className` (composes its own). Type prop defaults to `button` (not `submit`) — preventing accidental form submissions.

- [ ] **Step 1: Write failing tests**

Create `src/components/Button.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Button } from './Button'

describe('Button', () => {
  it('renders its children as the label', () => {
    render(<Button>Save</Button>)
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument()
  })

  it('defaults type to "button" to prevent implicit form submission', () => {
    render(<Button>Cancel</Button>)
    expect(screen.getByRole('button')).toHaveAttribute('type', 'button')
  })

  it('respects an explicit type prop', () => {
    render(<Button type="submit">Submit</Button>)
    expect(screen.getByRole('button')).toHaveAttribute('type', 'submit')
  })

  it('calls onClick when clicked', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(<Button onClick={onClick}>Click me</Button>)
    await user.click(screen.getByRole('button'))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('does not fire onClick when disabled', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(
      <Button disabled onClick={onClick}>
        Click me
      </Button>
    )
    await user.click(screen.getByRole('button'))
    expect(onClick).not.toHaveBeenCalled()
  })

  it('applies the danger variant class', () => {
    render(<Button variant="danger">Delete</Button>)
    // CSS modules in test mode use non-scoped class names.
    expect(screen.getByRole('button').className).toMatch(/danger/)
  })
})
```

- [ ] **Step 2: Run the test and verify it fails**

```powershell
npm test -- Button
```

Expected: 6 tests fail.

- [ ] **Step 3: Implement Button**

Create `src/components/Button.tsx`:

```tsx
import type { ButtonHTMLAttributes } from 'react'
import styles from './Button.module.css'

export type ButtonVariant = 'primary' | 'secondary' | 'danger'
export type ButtonSize = 'md' | 'sm'

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> {
  variant?: ButtonVariant
  size?: ButtonSize
}

export function Button({
  variant = 'secondary',
  size = 'md',
  type = 'button',
  children,
  ...rest
}: ButtonProps) {
  const className = [styles.button, styles[variant], styles[size]].join(' ')
  return (
    <button {...rest} type={type} className={className}>
      {children}
    </button>
  )
}
```

Create `src/components/Button.module.css`:

```css
.button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--acT-pad-sm);
  border: 1px solid transparent;
  border-radius: var(--acT-radius);
  cursor: pointer;
  font: inherit;
  line-height: 1;
  transition:
    background-color 0.12s ease,
    border-color 0.12s ease;
}

.button:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.md {
  padding: 6px 12px;
  font-size: var(--acT-fs-base);
}

.sm {
  padding: 3px 8px;
  font-size: var(--acT-fs-sm);
}

.primary {
  background: var(--acT-accent-bg);
  color: var(--acT-accent);
  border-color: var(--acT-accent);
}

.primary:hover:not(:disabled) {
  background: var(--acT-accent);
  color: var(--acT-bg);
}

.secondary {
  background: var(--acT-panel-alt);
  color: var(--acT-text);
  border-color: var(--acT-divider);
}

.secondary:hover:not(:disabled) {
  border-color: var(--acT-text-subtle);
}

.danger {
  background: transparent;
  color: var(--acT-error);
  border-color: transparent;
}

.danger:hover:not(:disabled) {
  background: rgba(244, 135, 113, 0.12);
}
```

- [ ] **Step 4: Run the test and verify it passes**

```powershell
npm test -- Button
```

Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```powershell
git add src/components/Button.tsx src/components/Button.module.css src/components/Button.test.tsx
git commit -m "feat(components): Button primitive (3 variants, 2 sizes)"
```

---

## Task 7: TextInput primitive

**Files:**

- Create: `C:\TrajectoryActionTester\src\components\TextInput.tsx`
- Create: `C:\TrajectoryActionTester\src\components\TextInput.module.css`
- Create: `C:\TrajectoryActionTester\src\components\TextInput.test.tsx`

A labeled text input. Renders `<label>` linked to the input via generated id (using `useId`) if no explicit `id` prop is given. Optional `error` string flips the input to error styling and shows the error message below. Optional `helper` shows below when no error. Forwards native `input` props.

- [ ] **Step 1: Write failing tests**

Create `src/components/TextInput.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { TextInput } from './TextInput'

describe('TextInput', () => {
  it('associates the label with the input via for/id', () => {
    render(<TextInput label="Server URL" defaultValue="" />)
    const input = screen.getByLabelText('Server URL')
    expect(input).toBeInTheDocument()
    expect(input.tagName).toBe('INPUT')
  })

  it('respects an explicit id', () => {
    render(<TextInput id="my-id" label="Name" />)
    expect(screen.getByLabelText('Name').id).toBe('my-id')
  })

  it('fires onChange when typing', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<TextInput label="URL" onChange={onChange} />)
    await user.type(screen.getByLabelText('URL'), 'http')
    expect(onChange).toHaveBeenCalled()
  })

  it('renders helper text when provided and no error', () => {
    render(<TextInput label="URL" helper="e.g. http://localhost:3000" />)
    expect(screen.getByText('e.g. http://localhost:3000')).toBeInTheDocument()
  })

  it('renders error text in place of helper when error is set', () => {
    render(<TextInput label="URL" helper="hint" error="Invalid URL" />)
    expect(screen.queryByText('hint')).not.toBeInTheDocument()
    expect(screen.getByText('Invalid URL')).toBeInTheDocument()
  })

  it('applies aria-invalid when error is set', () => {
    render(<TextInput label="URL" error="bad" />)
    expect(screen.getByLabelText('URL')).toHaveAttribute('aria-invalid', 'true')
  })
})
```

- [ ] **Step 2: Run the test and verify it fails**

```powershell
npm test -- TextInput
```

Expected: 6 tests fail.

- [ ] **Step 3: Implement TextInput**

Create `src/components/TextInput.tsx`:

```tsx
import { useId, type InputHTMLAttributes } from 'react'
import styles from './TextInput.module.css'

export interface TextInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'className'> {
  label: string
  helper?: string
  error?: string
}

export function TextInput({ label, helper, error, id, type = 'text', ...rest }: TextInputProps) {
  const generatedId = useId()
  const inputId = id ?? generatedId

  return (
    <div className={styles.field}>
      <label htmlFor={inputId} className={styles.label}>
        {label}
      </label>
      <input
        {...rest}
        id={inputId}
        type={type}
        className={[styles.input, error ? styles.invalid : ''].join(' ').trim()}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={error || helper ? `${inputId}-msg` : undefined}
      />
      {(error ?? helper) && (
        <p id={`${inputId}-msg`} className={error ? styles.error : styles.helper}>
          {error ?? helper}
        </p>
      )}
    </div>
  )
}
```

Create `src/components/TextInput.module.css`:

```css
.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.label {
  font-size: var(--acT-fs-sm);
  color: var(--acT-text-subtle);
}

.input {
  background: var(--acT-bg);
  color: var(--acT-text);
  border: 1px solid var(--acT-divider);
  border-radius: var(--acT-radius);
  padding: 6px 10px;
  font: inherit;
  font-size: var(--acT-fs-base);
}

.input:focus {
  outline: none;
  border-color: var(--acT-accent);
}

.invalid {
  border-color: var(--acT-error);
}

.invalid:focus {
  border-color: var(--acT-error);
}

.helper {
  font-size: var(--acT-fs-sm);
  color: var(--acT-text-muted);
}

.error {
  font-size: var(--acT-fs-sm);
  color: var(--acT-error);
}
```

- [ ] **Step 4: Run the test and verify it passes**

```powershell
npm test -- TextInput
```

Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```powershell
git add src/components/TextInput.tsx src/components/TextInput.module.css src/components/TextInput.test.tsx
git commit -m "feat(components): TextInput primitive with label, helper, and error"
```

---

## Task 8: Modal primitive

**Files:**

- Create: `C:\TrajectoryActionTester\src\components\Modal.tsx`
- Create: `C:\TrajectoryActionTester\src\components\Modal.module.css`
- Create: `C:\TrajectoryActionTester\src\components\Modal.test.tsx`

A backdrop + centered dialog. Renders into a portal (using `createPortal` to `document.body`) so the modal is not clipped by an ancestor's `overflow: hidden`. Closes on Escape and on backdrop click. The dialog itself stops click propagation so clicks inside don't trigger close. Renders nothing when `open` is `false`. Uses `role="dialog"` and `aria-modal="true"` for accessibility; consumer provides the title via `aria-labelledby` through `titleId`.

- [ ] **Step 1: Write failing tests**

Create `src/components/Modal.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Modal } from './Modal'

describe('Modal', () => {
  it('renders nothing when open is false', () => {
    const onClose = vi.fn()
    render(
      <Modal open={false} onClose={onClose} titleId="t">
        <h2 id="t">Hidden</h2>
        <p>body</p>
      </Modal>
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('renders children inside a dialog when open', () => {
    const onClose = vi.fn()
    render(
      <Modal open onClose={onClose} titleId="t">
        <h2 id="t">My Title</h2>
        <p>body</p>
      </Modal>
    )
    const dialog = screen.getByRole('dialog')
    expect(dialog).toBeInTheDocument()
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAttribute('aria-labelledby', 't')
    expect(screen.getByText('My Title')).toBeInTheDocument()
  })

  it('calls onClose when Escape is pressed', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(
      <Modal open onClose={onClose} titleId="t">
        <h2 id="t">x</h2>
      </Modal>
    )
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('calls onClose when the backdrop is clicked', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(
      <Modal open onClose={onClose} titleId="t">
        <h2 id="t">x</h2>
      </Modal>
    )
    const backdrop = screen.getByTestId('modal-backdrop')
    await user.click(backdrop)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('does NOT call onClose when the dialog body is clicked', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(
      <Modal open onClose={onClose} titleId="t">
        <h2 id="t">x</h2>
        <p>body</p>
      </Modal>
    )
    await user.click(screen.getByText('body'))
    expect(onClose).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the test and verify it fails**

```powershell
npm test -- Modal
```

Expected: 5 tests fail.

- [ ] **Step 3: Implement Modal**

Create `src/components/Modal.tsx`:

```tsx
import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import styles from './Modal.module.css'

export interface ModalProps {
  open: boolean
  onClose: () => void
  titleId: string
  children: ReactNode
}

export function Modal({ open, onClose, titleId, children }: ModalProps) {
  useEffect(() => {
    if (!open) return
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('keydown', handleKey)
    }
  }, [open, onClose])

  if (!open) return null

  return createPortal(
    <div className={styles.backdrop} data-testid="modal-backdrop" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={styles.dialog}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>,
    document.body
  )
}
```

Create `src/components/Modal.module.css`:

```css
.backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}

.dialog {
  background: var(--acT-panel);
  color: var(--acT-text);
  border: 1px solid var(--acT-divider);
  border-radius: var(--acT-radius);
  padding: var(--acT-pad-lg);
  min-width: 360px;
  max-width: 480px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
}
```

- [ ] **Step 4: Run the test and verify it passes**

```powershell
npm test -- Modal
```

Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```powershell
git add src/components/Modal.tsx src/components/Modal.module.css src/components/Modal.test.tsx
git commit -m "feat(components): Modal primitive (portal, escape, backdrop click)"
```

---

## Task 9: ConnectionModal — add/edit form

**Files:**

- Create: `C:\TrajectoryActionTester\src\features\connection-bar\ConnectionModal.tsx`
- Create: `C:\TrajectoryActionTester\src\features\connection-bar\ConnectionModal.module.css`
- Create: `C:\TrajectoryActionTester\src\features\connection-bar\ConnectionModal.test.tsx`

Single modal that handles both "Add" and "Edit" modes — switches based on whether `editingId` prop is provided. URL is required (validated as a non-empty parseable URL); Name and API Key are optional. Submits via `useConnections().addConnection` (add) or `updateConnection` (edit). On submit it calls `onClose()`. On Cancel it just calls `onClose()`. Form state is local React state — no form library.

URL validation: must be non-empty and `new URL(value)` must not throw, AND protocol must be `http:` or `https:`. Anything else shows error text.

- [ ] **Step 1: Write failing tests**

Create `src/features/connection-bar/ConnectionModal.test.tsx`:

```tsx
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { renderWithProviders } from '../../test-utils'
import { ConnectionModal } from './ConnectionModal'

describe('ConnectionModal — add mode', () => {
  beforeEach(() => {
    localStorage.clear()
  })
  afterEach(() => {
    localStorage.clear()
  })

  it('renders three fields in add mode', () => {
    renderWithProviders(<ConnectionModal open onClose={() => {}} />)
    expect(screen.getByLabelText(/server url/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/name/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/api key/i)).toBeInTheDocument()
  })

  it('disables Save until URL is provided', async () => {
    const user = userEvent.setup()
    renderWithProviders(<ConnectionModal open onClose={() => {}} />)
    const save = screen.getByRole('button', { name: /save/i })
    expect(save).toBeDisabled()
    await user.type(screen.getByLabelText(/server url/i), 'http://localhost:3000')
    expect(save).not.toBeDisabled()
  })

  it('shows a validation error for an unparseable URL', async () => {
    const user = userEvent.setup()
    renderWithProviders(<ConnectionModal open onClose={() => {}} />)
    await user.type(screen.getByLabelText(/server url/i), 'not-a-url')
    await user.click(screen.getByRole('button', { name: /save/i }))
    expect(screen.getByText(/must be a valid http\(s\) url/i)).toBeInTheDocument()
  })

  it('rejects ftp:// URLs', async () => {
    const user = userEvent.setup()
    renderWithProviders(<ConnectionModal open onClose={() => {}} />)
    await user.type(screen.getByLabelText(/server url/i), 'ftp://example.com')
    await user.click(screen.getByRole('button', { name: /save/i }))
    expect(screen.getByText(/must be a valid http\(s\) url/i)).toBeInTheDocument()
  })

  it('calls onClose after a successful add', async () => {
    const user = userEvent.setup()
    let closed = false
    renderWithProviders(
      <ConnectionModal
        open
        onClose={() => {
          closed = true
        }}
      />
    )
    await user.type(screen.getByLabelText(/server url/i), 'http://localhost:3000')
    await user.type(screen.getByLabelText(/name/i), 'Local dev')
    await user.click(screen.getByRole('button', { name: /save/i }))
    expect(closed).toBe(true)
  })

  it('Cancel calls onClose without saving', async () => {
    const user = userEvent.setup()
    let closed = false
    renderWithProviders(
      <ConnectionModal
        open
        onClose={() => {
          closed = true
        }}
      />
    )
    await user.type(screen.getByLabelText(/server url/i), 'http://localhost:3000')
    await user.click(screen.getByRole('button', { name: /cancel/i }))
    expect(closed).toBe(true)
    expect(localStorage.getItem('acT:connections:v1')).toMatch(/"connections":\[\]/)
  })
})

describe('ConnectionModal — edit mode', () => {
  beforeEach(() => {
    localStorage.setItem(
      'acT:connections:v1',
      JSON.stringify({
        connections: [
          {
            id: 'conn-1',
            url: 'http://localhost:3000',
            name: 'Local dev',
            apiKey: 'sekret',
            createdAt: '2026-05-13T00:00:00Z',
          },
        ],
        activeConnectionId: 'conn-1',
      })
    )
  })
  afterEach(() => {
    localStorage.clear()
  })

  it('prefills the form with the existing connection', () => {
    renderWithProviders(<ConnectionModal open onClose={() => {}} editingId="conn-1" />)
    expect(screen.getByLabelText(/server url/i)).toHaveValue('http://localhost:3000')
    expect(screen.getByLabelText(/name/i)).toHaveValue('Local dev')
    expect(screen.getByLabelText(/api key/i)).toHaveValue('sekret')
  })

  it('updates the connection on save', async () => {
    const user = userEvent.setup()
    let closed = false
    renderWithProviders(
      <ConnectionModal
        open
        onClose={() => {
          closed = true
        }}
        editingId="conn-1"
      />
    )
    const nameInput = screen.getByLabelText(/name/i)
    await user.clear(nameInput)
    await user.type(nameInput, 'Production')
    await user.click(screen.getByRole('button', { name: /save/i }))
    expect(closed).toBe(true)
    const stored = JSON.parse(localStorage.getItem('acT:connections:v1') ?? 'null')
    expect(stored.connections[0].name).toBe('Production')
  })
})
```

- [ ] **Step 2: Run the test and verify it fails**

```powershell
npm test -- ConnectionModal
```

Expected: tests fail because the module does not exist.

- [ ] **Step 3: Implement ConnectionModal**

Create `src/features/connection-bar/ConnectionModal.tsx`:

```tsx
import { useId, useState, type FormEvent } from 'react'
import { Button } from '../../components/Button'
import { Modal } from '../../components/Modal'
import { TextInput } from '../../components/TextInput'
import { useConnections } from '../../store/connections'
import styles from './ConnectionModal.module.css'

export interface ConnectionModalProps {
  open: boolean
  onClose: () => void
  editingId?: string
}

function validateUrl(value: string): string | undefined {
  if (!value.trim()) return 'URL is required'
  try {
    const parsed = new URL(value)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return 'URL must be a valid http(s) URL'
    }
  } catch {
    return 'URL must be a valid http(s) URL'
  }
  return undefined
}

export function ConnectionModal({ open, onClose, editingId }: ConnectionModalProps) {
  const { state, addConnection, updateConnection } = useConnections()
  const existing = editingId ? state.connections.find((c) => c.id === editingId) : null

  const [url, setUrl] = useState(existing?.url ?? '')
  const [name, setName] = useState(existing?.name ?? '')
  const [apiKey, setApiKey] = useState(existing?.apiKey ?? '')
  const [submitted, setSubmitted] = useState(false)

  const urlError = submitted ? validateUrl(url) : undefined
  const isAddMode = !existing
  const titleId = useId()

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSubmitted(true)
    const error = validateUrl(url)
    if (error) return
    const trimmedName = name.trim()
    const trimmedKey = apiKey.trim()
    if (existing) {
      updateConnection(existing.id, {
        url,
        name: trimmedName || undefined,
        apiKey: trimmedKey || undefined,
      })
    } else {
      addConnection({
        url,
        ...(trimmedName ? { name: trimmedName } : {}),
        ...(trimmedKey ? { apiKey: trimmedKey } : {}),
      })
    }
    onClose()
  }

  const saveDisabled = url.trim().length === 0

  return (
    <Modal open={open} onClose={onClose} titleId={titleId}>
      <form onSubmit={handleSubmit} className={styles.form}>
        <h2 id={titleId} className={styles.title}>
          {isAddMode ? 'Add connection' : 'Edit connection'}
        </h2>
        <TextInput
          label="Server URL"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="http://localhost:3000"
          helper="Base URL of the Trajectory Action Container REST endpoint."
          {...(urlError ? { error: urlError } : {})}
          autoFocus
        />
        <TextInput
          label="Name (optional)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Local dev"
        />
        <TextInput
          label="API key (optional)"
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          helper="Sent as 'Authorization: Bearer <key>' if provided."
        />
        <div className={styles.actions}>
          <Button onClick={onClose} variant="secondary">
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={saveDisabled}>
            Save
          </Button>
        </div>
      </form>
    </Modal>
  )
}
```

Create `src/features/connection-bar/ConnectionModal.module.css`:

```css
.form {
  display: flex;
  flex-direction: column;
  gap: var(--acT-pad);
}

.title {
  font-size: var(--acT-fs-md);
  font-weight: 600;
  color: var(--acT-text);
  margin-bottom: 4px;
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--acT-pad-sm);
  margin-top: var(--acT-pad);
}
```

- [ ] **Step 4: Run the test and verify it passes**

```powershell
npm test -- ConnectionModal
```

Expected: 8 tests pass.

- [ ] **Step 5: Commit**

```powershell
git add src/features/connection-bar/ConnectionModal.tsx src/features/connection-bar/ConnectionModal.module.css src/features/connection-bar/ConnectionModal.test.tsx
git commit -m "feat(connection-bar): ConnectionModal add/edit form with URL validation"
```

---

## Task 10: ConnectionBar — top bar with status + dropdown

**Files:**

- Create: `C:\TrajectoryActionTester\src\features\connection-bar\ConnectionBar.tsx`
- Create: `C:\TrajectoryActionTester\src\features\connection-bar\ConnectionBar.module.css`
- Create: `C:\TrajectoryActionTester\src\features\connection-bar\ConnectionBar.test.tsx`

Status dot color: amber when `useCapabilities` is in-flight (`isFetching`), green when `isSuccess`, red when `isError`, grey when there is no active connection. Clicking the trigger opens a dropdown listing all saved connections — each row has the connection label, a small "Edit" button that opens `ConnectionModal` in edit mode, and a "Delete" button. Bottom row of the dropdown is "+ Add connection" which opens `ConnectionModal` in add mode. Clicking a connection row (anywhere but its action buttons) sets it active and closes the dropdown. The dropdown closes when clicking outside it. State for `showAddModal`, `editingId`, `dropdownOpen` is local to this component.

- [ ] **Step 1: Write failing tests**

Create `src/features/connection-bar/ConnectionBar.test.tsx`:

```tsx
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '../../test-utils'
import { ConnectionBar } from './ConnectionBar'

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('fetch', vi.fn())
})
afterEach(() => {
  localStorage.clear()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const okResponse = () =>
  new Response(JSON.stringify({ data: [], meta: { total: 0 } }), { status: 200 })

describe('ConnectionBar', () => {
  it('shows "No connection" label and grey dot when nothing is configured', () => {
    renderWithProviders(<ConnectionBar />)
    expect(screen.getByText(/no connection/i)).toBeInTheDocument()
    const dot = screen.getByTestId('connection-status-dot')
    expect(dot.className).toMatch(/disconnected|idle/i)
  })

  it('opens the Add modal from the "+ Add connection" entry in the empty dropdown', async () => {
    const user = userEvent.setup()
    renderWithProviders(<ConnectionBar />)
    await user.click(screen.getByTestId('connection-trigger'))
    await user.click(screen.getByRole('button', { name: /add connection/i }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('turns the dot green after a successful capabilities fetch', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(okResponse())
    const user = userEvent.setup()
    localStorage.setItem(
      'acT:connections:v1',
      JSON.stringify({
        connections: [
          {
            id: 'c1',
            url: 'http://localhost:3000',
            name: 'Local',
            createdAt: '2026-05-13T00:00:00Z',
          },
        ],
        activeConnectionId: 'c1',
      })
    )
    renderWithProviders(<ConnectionBar />)
    await waitFor(() => {
      expect(screen.getByTestId('connection-status-dot').className).toMatch(/connected/i)
    })
    expect(screen.getByText(/local/i)).toBeInTheDocument()
    void user // user not needed here but kept to demonstrate setup pattern
  })

  it('turns the dot red on a fetch failure', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError('Failed to fetch'))
    localStorage.setItem(
      'acT:connections:v1',
      JSON.stringify({
        connections: [{ id: 'c1', url: 'http://nope', createdAt: '2026-05-13T00:00:00Z' }],
        activeConnectionId: 'c1',
      })
    )
    renderWithProviders(<ConnectionBar />)
    await waitFor(() => {
      expect(screen.getByTestId('connection-status-dot').className).toMatch(/disconnected/i)
    })
  })

  it('switches active connection when a dropdown row is clicked', async () => {
    vi.mocked(fetch).mockResolvedValue(okResponse())
    const user = userEvent.setup()
    localStorage.setItem(
      'acT:connections:v1',
      JSON.stringify({
        connections: [
          { id: 'c1', url: 'http://a', name: 'Alpha', createdAt: '2026-05-13T00:00:00Z' },
          { id: 'c2', url: 'http://b', name: 'Beta', createdAt: '2026-05-13T00:00:00Z' },
        ],
        activeConnectionId: 'c1',
      })
    )
    renderWithProviders(<ConnectionBar />)
    await user.click(screen.getByTestId('connection-trigger'))
    await user.click(screen.getByText('Beta'))
    // After selection the trigger label should now read Beta.
    expect(screen.getByTestId('connection-trigger')).toHaveTextContent(/beta/i)
  })

  it('deletes a connection from the dropdown', async () => {
    vi.mocked(fetch).mockResolvedValue(okResponse())
    const user = userEvent.setup()
    localStorage.setItem(
      'acT:connections:v1',
      JSON.stringify({
        connections: [
          { id: 'c1', url: 'http://a', name: 'Alpha', createdAt: '2026-05-13T00:00:00Z' },
          { id: 'c2', url: 'http://b', name: 'Beta', createdAt: '2026-05-13T00:00:00Z' },
        ],
        activeConnectionId: 'c1',
      })
    )
    renderWithProviders(<ConnectionBar />)
    await user.click(screen.getByTestId('connection-trigger'))
    const betaRow = screen.getByTestId('connection-row-c2')
    await user.click(betaRow.querySelector('[data-testid="delete-c2"]') as HTMLElement)
    expect(screen.queryByText('Beta')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the test and verify it fails**

```powershell
npm test -- ConnectionBar
```

Expected: tests fail because the module does not exist.

- [ ] **Step 3: Implement ConnectionBar**

Create `src/features/connection-bar/ConnectionBar.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react'
import { Button } from '../../components/Button'
import { useConnections } from '../../store/connections'
import { useCapabilities } from '../../store/use-capabilities'
import type { Connection } from '../../api/types'
import { ConnectionModal } from './ConnectionModal'
import styles from './ConnectionBar.module.css'

type DotStatus = 'idle' | 'connecting' | 'connected' | 'disconnected'

function connectionLabel(c: Connection | null): string {
  if (!c) return 'No connection'
  return c.name?.trim() ? c.name : c.url
}

export function ConnectionBar() {
  const { state, selectConnection, deleteConnection } = useConnections()
  const capabilities = useCapabilities()

  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [showAddModal, setShowAddModal] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  const rootRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!dropdownOpen) return
    const handleClickOutside = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [dropdownOpen])

  const active = state.connections.find((c) => c.id === state.activeConnectionId) ?? null

  let status: DotStatus
  if (!active) status = 'idle'
  else if (capabilities.isFetching) status = 'connecting'
  else if (capabilities.isError) status = 'disconnected'
  else if (capabilities.isSuccess) status = 'connected'
  else status = 'connecting'

  const handleRowSelect = (id: string) => {
    selectConnection(id)
    setDropdownOpen(false)
  }

  return (
    <div className={styles.bar} ref={rootRef}>
      <button
        type="button"
        className={styles.trigger}
        data-testid="connection-trigger"
        onClick={() => setDropdownOpen((open) => !open)}
        aria-haspopup="menu"
        aria-expanded={dropdownOpen}
      >
        <span
          className={[styles.dot, styles[status]].join(' ')}
          data-testid="connection-status-dot"
          aria-label={`status: ${status}`}
        />
        <span className={styles.label}>{connectionLabel(active)}</span>
        <span className={styles.caret} aria-hidden>
          ▾
        </span>
      </button>
      <span className={styles.title}>Trajectory Action Tester</span>

      {dropdownOpen && (
        <div className={styles.dropdown} role="menu">
          {state.connections.length === 0 && <p className={styles.empty}>No connections yet.</p>}
          {state.connections.map((c) => (
            <div
              key={c.id}
              data-testid={`connection-row-${c.id}`}
              className={[styles.row, c.id === state.activeConnectionId ? styles.rowActive : '']
                .join(' ')
                .trim()}
            >
              <button
                type="button"
                className={styles.rowSelect}
                onClick={() => handleRowSelect(c.id)}
              >
                <span className={styles.rowLabel}>{connectionLabel(c)}</span>
                <span className={styles.rowUrl}>{c.url}</span>
              </button>
              <div className={styles.rowActions}>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setEditingId(c.id)
                    setDropdownOpen(false)
                  }}
                >
                  Edit
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  data-testid={`delete-${c.id}`}
                  onClick={() => deleteConnection(c.id)}
                >
                  Delete
                </Button>
              </div>
            </div>
          ))}
          <div className={styles.addRow}>
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                setShowAddModal(true)
                setDropdownOpen(false)
              }}
            >
              + Add connection
            </Button>
          </div>
        </div>
      )}

      <ConnectionModal open={showAddModal} onClose={() => setShowAddModal(false)} />
      <ConnectionModal
        open={editingId !== null}
        onClose={() => setEditingId(null)}
        {...(editingId !== null ? { editingId } : {})}
      />
    </div>
  )
}
```

Create `src/features/connection-bar/ConnectionBar.module.css`:

```css
.bar {
  display: flex;
  align-items: center;
  gap: var(--acT-pad);
  position: relative;
  width: 100%;
}

.trigger {
  display: flex;
  align-items: center;
  gap: var(--acT-pad-sm);
  background: var(--acT-bg);
  color: var(--acT-text);
  border: 1px solid var(--acT-divider);
  border-radius: var(--acT-radius);
  padding: 4px 10px;
  font: inherit;
  font-size: var(--acT-fs-base);
  cursor: pointer;
}

.trigger:hover {
  border-color: var(--acT-text-subtle);
}

.dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  display: inline-block;
}

.dot.idle {
  background: var(--acT-text-muted);
}

.dot.connecting {
  background: var(--acT-dot-connecting);
}

.dot.connected {
  background: var(--acT-dot-connected);
}

.dot.disconnected {
  background: var(--acT-dot-disconnected);
}

.label {
  font-weight: 500;
}

.caret {
  color: var(--acT-text-subtle);
  font-size: 10px;
}

.title {
  margin-left: auto;
  color: var(--acT-text-subtle);
  font-size: var(--acT-fs-sm);
}

.dropdown {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  min-width: 320px;
  background: var(--acT-panel);
  border: 1px solid var(--acT-divider);
  border-radius: var(--acT-radius);
  padding: var(--acT-pad-sm);
  display: flex;
  flex-direction: column;
  gap: 2px;
  z-index: 50;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
}

.empty {
  color: var(--acT-text-muted);
  font-size: var(--acT-fs-sm);
  padding: var(--acT-pad-sm) var(--acT-pad);
}

.row {
  display: flex;
  align-items: center;
  border-radius: var(--acT-radius);
  padding: 2px;
}

.row:hover {
  background: var(--acT-panel-alt);
}

.rowActive {
  background: var(--acT-accent-bg);
}

.rowSelect {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  background: transparent;
  border: 0;
  color: var(--acT-text);
  cursor: pointer;
  padding: var(--acT-pad-sm) var(--acT-pad);
  font: inherit;
}

.rowLabel {
  font-weight: 500;
  font-size: var(--acT-fs-base);
}

.rowUrl {
  font-size: var(--acT-fs-sm);
  color: var(--acT-text-muted);
}

.rowActions {
  display: flex;
  gap: 4px;
  padding-right: var(--acT-pad-sm);
}

.addRow {
  display: flex;
  justify-content: flex-end;
  padding: var(--acT-pad-sm);
  border-top: 1px solid var(--acT-divider);
  margin-top: 4px;
}
```

- [ ] **Step 4: Run the test and verify it passes**

```powershell
npm test -- ConnectionBar
```

Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```powershell
git add src/features/connection-bar/ConnectionBar.tsx src/features/connection-bar/ConnectionBar.module.css src/features/connection-bar/ConnectionBar.test.tsx
git commit -m "feat(connection-bar): status dot + dropdown switcher + add/edit/delete"
```

---

## Task 11: ConnectionList — sidebar section

**Files:**

- Create: `C:\TrajectoryActionTester\src\features\sidebar\ConnectionList.tsx`
- Create: `C:\TrajectoryActionTester\src\features\sidebar\ConnectionList.module.css`
- Create: `C:\TrajectoryActionTester\src\features\sidebar\ConnectionList.test.tsx`

Renders each saved connection as a clickable row. Active row gets a highlight class. Click selects via `selectConnection`. When the list is empty shows a muted placeholder.

- [ ] **Step 1: Write failing tests**

Create `src/features/sidebar/ConnectionList.test.tsx`:

```tsx
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { renderWithProviders } from '../../test-utils'
import { ConnectionList } from './ConnectionList'

beforeEach(() => {
  localStorage.clear()
})
afterEach(() => {
  localStorage.clear()
})

describe('ConnectionList', () => {
  it('shows a placeholder when no connections exist', () => {
    renderWithProviders(<ConnectionList />)
    expect(screen.getByText(/no connections yet/i)).toBeInTheDocument()
  })

  it('renders one row per saved connection', () => {
    localStorage.setItem(
      'acT:connections:v1',
      JSON.stringify({
        connections: [
          { id: 'a', url: 'http://a', name: 'Alpha', createdAt: '2026-05-13T00:00:00Z' },
          { id: 'b', url: 'http://b', name: 'Beta', createdAt: '2026-05-13T00:00:00Z' },
        ],
        activeConnectionId: 'a',
      })
    )
    renderWithProviders(<ConnectionList />)
    expect(screen.getByText('Alpha')).toBeInTheDocument()
    expect(screen.getByText('Beta')).toBeInTheDocument()
  })

  it('highlights the active row', () => {
    localStorage.setItem(
      'acT:connections:v1',
      JSON.stringify({
        connections: [
          { id: 'a', url: 'http://a', name: 'Alpha', createdAt: '2026-05-13T00:00:00Z' },
          { id: 'b', url: 'http://b', name: 'Beta', createdAt: '2026-05-13T00:00:00Z' },
        ],
        activeConnectionId: 'b',
      })
    )
    renderWithProviders(<ConnectionList />)
    const betaRow = screen.getByTestId('sidebar-conn-b')
    expect(betaRow.className).toMatch(/active/i)
  })

  it('selects a connection on click', async () => {
    const user = userEvent.setup()
    localStorage.setItem(
      'acT:connections:v1',
      JSON.stringify({
        connections: [
          { id: 'a', url: 'http://a', name: 'Alpha', createdAt: '2026-05-13T00:00:00Z' },
          { id: 'b', url: 'http://b', name: 'Beta', createdAt: '2026-05-13T00:00:00Z' },
        ],
        activeConnectionId: 'a',
      })
    )
    renderWithProviders(<ConnectionList />)
    await user.click(screen.getByText('Beta'))
    const betaRow = screen.getByTestId('sidebar-conn-b')
    expect(betaRow.className).toMatch(/active/i)
  })
})
```

- [ ] **Step 2: Run the test and verify it fails**

```powershell
npm test -- ConnectionList
```

Expected: tests fail because the module does not exist.

- [ ] **Step 3: Implement ConnectionList**

Create `src/features/sidebar/ConnectionList.tsx`:

```tsx
import { useConnections } from '../../store/connections'
import styles from './ConnectionList.module.css'

export function ConnectionList() {
  const { state, selectConnection } = useConnections()

  if (state.connections.length === 0) {
    return <p className={styles.empty}>No connections yet. Add one from the top bar.</p>
  }

  return (
    <ul className={styles.list}>
      {state.connections.map((c) => {
        const isActive = c.id === state.activeConnectionId
        const label = c.name?.trim() ? c.name : c.url
        return (
          <li key={c.id}>
            <button
              type="button"
              data-testid={`sidebar-conn-${c.id}`}
              className={[styles.row, isActive ? styles.rowActive : ''].join(' ').trim()}
              onClick={() => selectConnection(c.id)}
            >
              <span className={styles.label}>{label}</span>
              <span className={styles.url}>{c.url}</span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
```

Create `src/features/sidebar/ConnectionList.module.css`:

```css
.empty {
  font-size: var(--acT-fs-sm);
  color: var(--acT-text-muted);
  padding: var(--acT-pad-sm);
}

.list {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.row {
  width: 100%;
  background: transparent;
  border: 0;
  color: var(--acT-text);
  text-align: left;
  display: flex;
  flex-direction: column;
  padding: var(--acT-pad-sm) var(--acT-pad);
  border-radius: var(--acT-radius);
  cursor: pointer;
  font: inherit;
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

.url {
  font-size: var(--acT-fs-sm);
  color: var(--acT-text-muted);
}
```

- [ ] **Step 4: Run the test and verify it passes**

```powershell
npm test -- ConnectionList
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```powershell
git add src/features/sidebar/ConnectionList.tsx src/features/sidebar/ConnectionList.module.css src/features/sidebar/ConnectionList.test.tsx
git commit -m "feat(sidebar): ConnectionList with active highlight + click-to-select"
```

---

## Task 12: Sidebar shell — collapsible-section accordion

**Files:**

- Create: `C:\TrajectoryActionTester\src\features\sidebar\Sidebar.tsx`
- Create: `C:\TrajectoryActionTester\src\features\sidebar\Sidebar.module.css`

A thin shell that renders one or more collapsible sections. Plan 2 only mounts the Connections section. Plan 4-03 will add ActionTree and InstanceList sections to this same component. Each section has a clickable header (caret + title) and a collapsible body. Default expanded.

This task does not introduce a new dedicated test file — the Sidebar shell is exercised by the integration test in Task 14 (rendering the full App). Keeping individual section open/close as local React state means no logic worth a separate unit test.

- [ ] **Step 1: Implement Sidebar shell**

Create `src/features/sidebar/Sidebar.tsx`:

```tsx
import { useState, type ReactNode } from 'react'
import { ConnectionList } from './ConnectionList'
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
    </nav>
  )
}
```

Create `src/features/sidebar/Sidebar.module.css`:

```css
.sidebar {
  display: flex;
  flex-direction: column;
  gap: var(--acT-pad-sm);
  height: 100%;
}

.section {
  display: flex;
  flex-direction: column;
}

.header {
  display: flex;
  align-items: center;
  gap: 4px;
  background: transparent;
  border: 0;
  color: var(--acT-text-subtle);
  font: inherit;
  font-size: var(--acT-fs-sm);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 6px var(--acT-pad-sm);
  cursor: pointer;
}

.header:hover {
  color: var(--acT-text);
}

.caret {
  width: 10px;
  display: inline-block;
}

.title {
  font-weight: 600;
}

.body {
  padding: 0 var(--acT-pad-sm);
}
```

- [ ] **Step 2: Run all tests and verify nothing regressed**

```powershell
npm test
```

Expected: all previously-passing tests still pass. No new tests added.

- [ ] **Step 3: Commit**

```powershell
git add src/features/sidebar/Sidebar.tsx src/features/sidebar/Sidebar.module.css
git commit -m "feat(sidebar): accordion shell mounting ConnectionList"
```

---

## Task 13: Wire `<App />` to providers + new features

**Files:**

- Modify: `C:\TrajectoryActionTester\src\App.tsx`
- Modify: `C:\TrajectoryActionTester\src\App.module.css`
- Modify: `C:\TrajectoryActionTester\src\App.test.tsx`

`<App />` previously rendered a static three-pane shell with placeholder text in each pane and a static dot in the header. Now it wraps its body in `<ConnectionsProvider>`, renders `<ConnectionBar />` in the header, `<Sidebar />` in the LHS pane, and removes the placeholder text from the header and sidebar. The main and inspector panes keep their placeholders for now (filled by Plans 4-03 and 4-05 respectively).

`<App.test.tsx>` was a smoke test asserting four landmark roles plus the title in the header. After this task the title still renders, but inside the new bar. Update assertions:

- Banner: still present (`<header role="banner">`).
- Banner contains "Trajectory Action Tester" (now lives in `<ConnectionBar />`).
- Banner contains a connection trigger button.
- Sidebar landmark still present (now `<nav aria-label="Sidebar">`; landmark role is `navigation`, not `complementary`).
- Sidebar shows the "Connections" section header.
- Main and Inspector landmarks still present with their placeholders.

- [ ] **Step 1: Update App.tsx**

Replace the entire file `src/App.tsx` with:

```tsx
import { ConnectionBar } from './features/connection-bar/ConnectionBar'
import { Sidebar } from './features/sidebar/Sidebar'
import { ConnectionsProvider } from './store/connections'
import styles from './App.module.css'

export function App() {
  return (
    <ConnectionsProvider>
      <div className={styles.shell}>
        <header className={styles.header} role="banner">
          <ConnectionBar />
        </header>
        <aside className={styles.sidebar}>
          <Sidebar />
        </aside>
        <main className={styles.main}>
          <p className={styles.placeholder}>
            Select an action from the sidebar to begin — actions arrive in plan 4-03.
          </p>
        </main>
        <aside className={styles.inspector} aria-label="Inspector">
          <p className={styles.placeholder}>Log inspector — coming in plan 4-05.</p>
        </aside>
      </div>
    </ConnectionsProvider>
  )
}
```

- [ ] **Step 2: Update App.module.css**

Replace the existing `.dot` and `.title` rules with no-op (delete them); keep the rest. The new file `src/App.module.css`:

```css
.shell {
  display: grid;
  grid-template-rows: auto 1fr;
  grid-template-columns: 240px 1fr 320px;
  grid-template-areas:
    'header header header'
    'sidebar main inspector';
  height: 100%;
}

.header {
  grid-area: header;
  display: flex;
  align-items: center;
  gap: var(--acT-pad-sm);
  background: var(--acT-panel-alt);
  border-bottom: 1px solid var(--acT-border);
  padding: var(--acT-pad) var(--acT-pad-lg);
}

.sidebar {
  grid-area: sidebar;
  background: var(--acT-panel);
  border-right: 1px solid var(--acT-divider);
  padding: var(--acT-pad);
  overflow-y: auto;
}

.main {
  grid-area: main;
  background: var(--acT-bg);
  padding: var(--acT-pad-lg);
  overflow-y: auto;
}

.inspector {
  grid-area: inspector;
  background: var(--acT-panel);
  border-left: 1px solid var(--acT-divider);
  padding: var(--acT-pad);
  overflow-y: auto;
}

.placeholder {
  color: var(--acT-text-muted);
  font-size: var(--acT-fs-sm);
}
```

Note: The sidebar `<aside>` no longer has an explicit `aria-label`; the inner `<nav aria-label="Sidebar">` (rendered by `Sidebar.tsx`) provides the landmark name. ARIA-wise the `<nav>` is now the navigation landmark; the `<aside>` is still complementary but unnamed — that's fine because we don't query for it in tests anymore.

- [ ] **Step 3: Update App.test.tsx**

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

  it('shows the app title in the header', () => {
    renderWithProviders(<App />)
    expect(screen.getByRole('banner')).toHaveTextContent(/Trajectory Action Tester/i)
  })

  it('shows the Connections sidebar section', () => {
    renderWithProviders(<App />)
    expect(screen.getByRole('button', { name: /connections/i, expanded: true })).toBeInTheDocument()
  })

  it('shows the No-connection state when nothing is configured', () => {
    renderWithProviders(<App />)
    // ConnectionBar trigger reads "No connection".
    expect(screen.getByTestId('connection-trigger')).toHaveTextContent(/no connection/i)
  })
})
```

Note: `renderWithProviders` itself wraps in `<ConnectionsProvider>`, but `<App />` ALSO wraps in `<ConnectionsProvider>`. React Context handles nesting safely (the inner provider wins for its subtree). The duplicate is intentional — `<App />` must own its provider for production use, and tests use `renderWithProviders` for the `QueryClient`.

- [ ] **Step 4: Run the test and verify everything passes**

```powershell
npm test
```

Expected: all tests across the project pass (Tasks 1-12 + updated App tests + Plan 1's existing tests).

- [ ] **Step 5: Commit**

```powershell
git add src/App.tsx src/App.module.css src/App.test.tsx
git commit -m "feat(app): wire ConnectionsProvider, ConnectionBar, and Sidebar into shell"
```

---

## Task 14: Integration test — add connection → capabilities loaded

**Files:**

- Create: `C:\TrajectoryActionTester\src\__tests__\integration.test.tsx`

End-to-end test from the user's perspective: the app opens with no connections, the user clicks "+ Add connection" from the dropdown, fills in a URL, submits, and observes the status dot turn green once the mocked `/capabilities` request resolves.

- [ ] **Step 1: Create the integration test directory and file**

Create `src/__tests__/integration.test.tsx`:

```tsx
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../App'
import { renderWithProviders } from '../test-utils'

describe('Integration: add a connection and load capabilities', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => {
    localStorage.clear()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('happy path: no connections → add → green dot, sidebar shows the connection, capabilities cached', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [
            {
              action_oid: 'act-1',
              environment_oid: 'env-1',
              local_id: 'PickItem',
              version: '1.0.0',
              visibility: 'observable',
              input_parameters: [],
              output_parameters: [],
              supported_commands: ['PAUSE', 'RESUME'],
            },
          ],
          meta: { total: 1 },
        }),
        { status: 200 }
      )
    )

    const user = userEvent.setup()
    renderWithProviders(<App />)

    // 1. Initial empty state.
    expect(screen.getByTestId('connection-trigger')).toHaveTextContent(/no connection/i)
    expect(screen.getByText(/no connections yet/i)).toBeInTheDocument()

    // 2. Open the dropdown, click "Add connection".
    await user.click(screen.getByTestId('connection-trigger'))
    await user.click(screen.getByRole('button', { name: /add connection/i }))

    // 3. Fill in URL + name, submit.
    await user.type(screen.getByLabelText(/server url/i), 'http://localhost:3000')
    await user.type(screen.getByLabelText(/name/i), 'Local dev')
    await user.click(screen.getByRole('button', { name: /save/i }))

    // 4. Modal closes, capabilities fetch fires.
    await waitFor(() => {
      expect(screen.getByTestId('connection-status-dot').className).toMatch(/connected/i)
    })

    // 5. Sidebar + bar both reflect the new connection name.
    // "Local dev" appears in both the ConnectionBar trigger label and the
    // Sidebar ConnectionList row — assert at least one match.
    const matches = await screen.findAllByText(/local dev/i)
    expect(matches.length).toBeGreaterThan(0)
  })

  it('shows red dot when /capabilities returns 500', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response('boom', { status: 500, statusText: 'Internal Server Error' })
    )

    const user = userEvent.setup()
    renderWithProviders(<App />)

    await user.click(screen.getByTestId('connection-trigger'))
    await user.click(screen.getByRole('button', { name: /add connection/i }))
    await user.type(screen.getByLabelText(/server url/i), 'http://localhost:3000')
    await user.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => {
      expect(screen.getByTestId('connection-status-dot').className).toMatch(/disconnected/i)
    })
  })
})
```

- [ ] **Step 2: Run the integration test**

```powershell
npm test -- integration
```

Expected: 2 tests pass.

- [ ] **Step 3: Run the full suite one more time**

```powershell
npm test
```

Expected: every test in the project passes. Console should be free of React warnings about missing keys, act() complaints, or Provider context errors.

- [ ] **Step 4: Commit**

```powershell
git add src/__tests__/integration.test.tsx
git commit -m "test: integration test for add connection -> capabilities loaded -> green dot"
```

---

## Task 15: Final sanity check + bundle-size sanity

**Files:**

- (no new files — running verification)

Mirrors Plan 1's Task 13 plus a quick bundle-size check to make sure the L1 dependencies haven't pushed us off-budget.

- [ ] **Step 1: Confirm every npm script succeeds**

```powershell
npm run lint
npm run typecheck
npm test
npm run build
```

Expected: all four exit code 0. Lint clean (warnings allowed but should ideally be zero — the two `eslint-disable-next-line` comments in `src/store/connections.tsx` are intentional). Typecheck clean. All tests pass. Build emits `dist/index.html`.

- [ ] **Step 2: Confirm preview command works**

```powershell
npm run preview
```

Expected: serves the built `dist/` on `http://localhost:4173/`. Open it manually — the empty three-pane shell now has a real top bar with a grey dot and "No connection" label, and a "Connections" section in the sidebar that says "No connections yet". Stop with Ctrl+C.

- [ ] **Step 3: Measure gzipped bundle size**

Vite's build output prints both raw and gzipped size. Grab those numbers from Step 1's `npm run build` output. Confirm:

- Raw `dist/index.html` is under 400 KB (Plan 1 baseline: 222.83 KB).
- Gzipped is under 130 KB (Plan 1 baseline: 69.46 KB; spec §9 target is ≤ 200 KB gz — well under).

If gzipped exceeds 130 KB, that's still inside the spec budget but warrants a look at the diff (a single feature plan shouldn't add more than ~60 KB gz; if it did, something heavy got pulled in unintentionally).

- [ ] **Step 4: Confirm git tree is clean**

```powershell
git status
```

Expected: "nothing to commit, working tree clean".

- [ ] **Step 5: Confirm commit history is sensible**

```powershell
git log --oneline
```

Expected: ~14 new commits on top of Plan 1's 10. Each task ended with a checkpoint commit.

- [ ] **Step 6: Empty marker commit recording the new baseline**

```powershell
git commit --allow-empty -m "chore: plan 4-02 complete — gzipped baseline <NN.NN> KB"
```

Replace `<NN.NN>` with the actual gzipped KB from Step 3.

---

## Self-Review checklist (for the executing engineer)

After all tasks complete, sanity-check against `docs/specs/2026-05-11-trajectory-action-tester-v2-design.md` § 4 + § 5:

- ✅ `ConnectionsContext` with localStorage persistence — confirmed by `connections.test.tsx` round-trip test.
- ✅ `CapabilitiesContext` cache per connection via TanStack Query — confirmed by `useCapabilities` keying on `connection.id`.
- ✅ Multi-connection switching — confirmed by `ConnectionBar.test.tsx` `switches active connection` test.
- ✅ Add / edit / delete connection — `ConnectionModal` add + edit modes + `ConnectionBar` delete row button.
- ✅ Status dot four states (idle / connecting / connected / disconnected) — confirmed in `ConnectionBar.test.tsx` and dot CSS.
- ✅ `<ConnectionBar />` top bar with quick switcher — implemented in `ConnectionBar.tsx`.
- ✅ `<ConnectionList />` LHS sidebar section — implemented in `ConnectionList.tsx`, mounted via `Sidebar.tsx`.
- ✅ Error states (network failure, 4xx, 5xx) — covered in `useCapabilities` tests (network + 5xx) and `fetchCapabilities` tests (404).
- ✅ Single-file build still works — Plan 1's Task 13 still passes plus this plan's Task 15.

What's NOT in this plan and is handled later:

- ActionTree (Plan 4-03)
- InvokePanel + InstanceList (Plan 4-03)
- `useInstanceStream` SSE hook (Plan 4-04)
- StateDiagram + LogInspector (Plan 4-05)
- Output deltas + polish (Plan 4-06)

---

## Failure recovery

If any task fails partway:

1. `git status` — see what's changed since the last commit.
2. If the partial change is broken: `git reset --hard HEAD` to revert.
3. Re-read the task's steps and re-run them.

If `npm test` hangs: TanStack Query's default `gcTime: 5min` can hold cached promises. `createTestQueryClient` in `test-utils.tsx` overrides this to `gcTime: 0` so tests don't hang waiting for cache cleanup. If a new test hangs, ensure it uses `renderWithProviders` (which uses `createTestQueryClient`) rather than wrapping in a fresh `QueryClientProvider` with default options.

If `react-refresh/only-export-components` lint warning fires unexpectedly: the two `eslint-disable-next-line` comments in `connections.tsx` cover the known cases (the two hook exports). If you add another non-component export from any `.tsx` file, add the same disable comment immediately above it.
