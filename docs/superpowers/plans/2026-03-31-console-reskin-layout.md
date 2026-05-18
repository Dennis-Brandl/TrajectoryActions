# Console Reskin: Layout Shell + Explorer + Theme — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the sidebar navigation with a VS Code-style IDE layout: activity bar, collapsible tree panel (Environment > Action > State), top nav bar, status bar, and dark/light theme toggle.

**Architecture:** The Layout component is rebuilt from a sidebar+content flex layout into a 4-zone grid: TopNav, ActivityBar, SidePanel, MainContent, and StatusBar. A React context (PanelContext) manages which panel is active and theme state, persisted to localStorage. The Explorer panel fetches environment/action data via existing APIs and renders a 3-level collapsible tree. Instances and Search panels are placeholder stubs in this plan (filled in Plan B).

**Tech Stack:** React 19, React Router 7, TanStack React Query, TailwindCSS 4 (dark mode via `class` strategy), lucide-react icons, localStorage persistence

**Spec:** `docs/specs/2026-03-31-console-reskin-design.md`

---

## File Structure

### New Files

| File                                                           | Responsibility                                                                   |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `apps/console/src/layout/PanelContext.tsx`                     | React context: active panel, theme, code filter toggle; localStorage persistence |
| `apps/console/src/layout/TopNav.tsx`                           | Top bar: brand, page tabs (Dashboard/Log/Settings), search input, theme toggle   |
| `apps/console/src/layout/ActivityBar.tsx`                      | Vertical icon strip: Explorer/Instances/Search icons with active indicator       |
| `apps/console/src/layout/SidePanel.tsx`                        | Collapsible container that renders the active panel content                      |
| `apps/console/src/layout/StatusBar.tsx`                        | Bottom bar: environment/action counts, version                                   |
| `apps/console/src/features/explorer/ExplorerPanel.tsx`         | Tree panel: header with upload + filter toggle, renders tree nodes               |
| `apps/console/src/features/explorer/TreeNode.tsx`              | Recursive tree node for environments, actions, and states                        |
| `apps/console/src/features/explorer/hooks.ts`                  | `useExplorerData()` — fetches all environments with actions for tree             |
| `apps/console/src/features/instances-panel/InstancesPanel.tsx` | Placeholder panel for activity bar                                               |
| `apps/console/src/features/search-panel/SearchPanel.tsx`       | Placeholder panel for activity bar                                               |

### Modified Files

| File                                 | Change                                                           |
| ------------------------------------ | ---------------------------------------------------------------- |
| `apps/console/src/layout/Layout.tsx` | Replace sidebar layout with new 4-zone IDE layout                |
| `apps/console/src/App.tsx`           | Wrap with PanelProvider; keep all existing routes for now        |
| `apps/console/src/main.tsx`          | Initialize dark class on `<html>` before render                  |
| `apps/console/src/index.css`         | Add activity-bar/side-panel CSS custom properties for dark/light |

### Removed Files

| File                                  | Reason                              |
| ------------------------------------- | ----------------------------------- |
| `apps/console/src/layout/Sidebar.tsx` | Replaced by ActivityBar + SidePanel |

---

### Task 1: Theme Context and Dark Mode Initialization

**Files:**

- Create: `apps/console/src/layout/PanelContext.tsx`
- Modify: `apps/console/src/main.tsx`
- Modify: `apps/console/src/index.css`

- [ ] **Step 1: Create PanelContext**

Create `apps/console/src/layout/PanelContext.tsx`:

```tsx
import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'

type PanelId = 'explorer' | 'instances' | 'search'
type Theme = 'dark' | 'light'

interface PanelContextValue {
  activePanel: PanelId | null
  setActivePanel: (panel: PanelId | null) => void
  togglePanel: (panel: PanelId) => void
  theme: Theme
  toggleTheme: () => void
  codeFilterActive: boolean
  toggleCodeFilter: () => void
}

const PanelContext = createContext<PanelContextValue | null>(null)

function getInitialTheme(): Theme {
  const stored = localStorage.getItem('Trajectory-theme')
  if (stored === 'light' || stored === 'dark') return stored
  return 'dark'
}

function getInitialPanel(): PanelId | null {
  const stored = localStorage.getItem('Trajectory-active-panel')
  if (stored === 'explorer' || stored === 'instances' || stored === 'search') return stored
  return 'explorer'
}

function getInitialCodeFilter(): boolean {
  return localStorage.getItem('Trajectory-code-filter') === 'true'
}

export function PanelProvider({ children }: { children: ReactNode }) {
  const [activePanel, setActivePanelState] = useState<PanelId | null>(getInitialPanel)
  const [theme, setTheme] = useState<Theme>(getInitialTheme)
  const [codeFilterActive, setCodeFilterActive] = useState(getInitialCodeFilter)

  // Sync theme to <html> class
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    localStorage.setItem('Trajectory-theme', theme)
  }, [theme])

  // Persist panel state
  useEffect(() => {
    if (activePanel) {
      localStorage.setItem('Trajectory-active-panel', activePanel)
    } else {
      localStorage.removeItem('Trajectory-active-panel')
    }
  }, [activePanel])

  // Persist code filter
  useEffect(() => {
    localStorage.setItem('Trajectory-code-filter', String(codeFilterActive))
  }, [codeFilterActive])

  function setActivePanel(panel: PanelId | null) {
    setActivePanelState(panel)
  }

  function togglePanel(panel: PanelId) {
    setActivePanelState((prev) => (prev === panel ? null : panel))
  }

  function toggleTheme() {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'))
  }

  function toggleCodeFilter() {
    setCodeFilterActive((prev) => !prev)
  }

  return (
    <PanelContext.Provider
      value={{
        activePanel,
        setActivePanel,
        togglePanel,
        theme,
        toggleTheme,
        codeFilterActive,
        toggleCodeFilter,
      }}
    >
      {children}
    </PanelContext.Provider>
  )
}

export function usePanelContext(): PanelContextValue {
  const ctx = useContext(PanelContext)
  if (!ctx) throw new Error('usePanelContext must be used within PanelProvider')
  return ctx
}
```

- [ ] **Step 2: Initialize dark class in main.tsx before React render**

Modify `apps/console/src/main.tsx` — add this block before the `createRoot` call:

```tsx
// Apply theme before first render to avoid flash
const savedTheme = localStorage.getItem('Trajectory-theme')
if (savedTheme !== 'light') {
  document.documentElement.classList.add('dark')
}
```

- [ ] **Step 3: Add IDE-specific CSS custom properties**

Append to `apps/console/src/index.css`, before the `@layer base` block:

```css
/* IDE layout depth layers */
:root {
  --activity-bar: oklch(0.96 0 0);
  --side-panel: oklch(0.975 0 0);
  --status-bar: oklch(0.96 0 0);
}

.dark {
  --activity-bar: oklch(0.115 0 0);
  --side-panel: oklch(0.145 0 0);
  --status-bar: oklch(0.115 0 0);
}
```

- [ ] **Step 4: Wrap App with PanelProvider**

Modify `apps/console/src/App.tsx` — add import and wrap:

```tsx
import { PanelProvider } from './layout/PanelContext'
```

Wrap the `<Routes>` block:

```tsx
export default function App() {
  return (
    <PanelProvider>
      <Routes>
        <Route element={<Layout />}>{/* ... existing routes unchanged ... */}</Route>
      </Routes>
    </PanelProvider>
  )
}
```

- [ ] **Step 5: Verify the app renders with dark mode**

Run: `npm run dev:console`
Expected: Console loads with dark background. No visual changes yet (sidebar still visible), but dark mode is applied via the `.dark` class on `<html>`.

- [ ] **Step 6: Commit**

```bash
git add apps/console/src/layout/PanelContext.tsx apps/console/src/main.tsx apps/console/src/index.css apps/console/src/App.tsx
git commit -m "feat(console): add PanelContext for theme and panel state management"
```

---

### Task 2: Top Navigation Bar

**Files:**

- Create: `apps/console/src/layout/TopNav.tsx`

- [ ] **Step 1: Create TopNav component**

Create `apps/console/src/layout/TopNav.tsx`:

```tsx
import { NavLink } from 'react-router'
import { Sun, Moon } from 'lucide-react'
import { usePanelContext } from './PanelContext'
import { cn } from '@/lib/utils'

const navItems = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/log', label: 'Log', end: false },
  { to: '/settings', label: 'Settings', end: false },
]

export default function TopNav() {
  const { theme, toggleTheme } = usePanelContext()

  return (
    <header className="flex items-center h-10 px-3 bg-[var(--activity-bar)] border-b border-border shrink-0">
      {/* Brand */}
      <span className="text-sm font-bold text-primary mr-6">Trajectory</span>

      {/* Page tabs */}
      <nav className="flex items-center gap-0.5">
        {navItems.map(({ to, label, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              cn(
                'px-3 py-1.5 text-xs font-medium rounded-t transition-colors',
                isActive
                  ? 'bg-background text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              )
            }
          >
            {label}
          </NavLink>
        ))}
      </nav>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Search (visual placeholder — functional in Plan B) */}
      <div className="flex items-center gap-2 px-3 py-1 rounded bg-muted text-muted-foreground text-xs w-48">
        <span className="opacity-50">Search...</span>
      </div>

      {/* Theme toggle */}
      <button
        onClick={toggleTheme}
        className="ml-3 p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
        title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
      >
        {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
      </button>
    </header>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/console/src/layout/TopNav.tsx
git commit -m "feat(console): TopNav component with page tabs and theme toggle"
```

---

### Task 3: Activity Bar

**Files:**

- Create: `apps/console/src/layout/ActivityBar.tsx`

- [ ] **Step 1: Create ActivityBar component**

Create `apps/console/src/layout/ActivityBar.tsx`:

```tsx
import { FolderTree, Play, Search } from 'lucide-react'
import { usePanelContext } from './PanelContext'
import { cn } from '@/lib/utils'

type PanelId = 'explorer' | 'instances' | 'search'

const items: { id: PanelId; icon: typeof FolderTree; label: string }[] = [
  { id: 'explorer', icon: FolderTree, label: 'Explorer' },
  { id: 'instances', icon: Play, label: 'Instances' },
  { id: 'search', icon: Search, label: 'Search' },
]

export default function ActivityBar() {
  const { activePanel, togglePanel } = usePanelContext()

  return (
    <div className="flex flex-col items-center w-10 bg-[var(--activity-bar)] border-r border-border shrink-0 pt-2 gap-1">
      {items.map(({ id, icon: Icon, label }) => {
        const isActive = activePanel === id
        return (
          <button
            key={id}
            onClick={() => togglePanel(id)}
            title={label}
            className={cn(
              'relative flex items-center justify-center w-8 h-8 rounded transition-colors',
              isActive ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {isActive && (
              <div className="absolute left-0 top-1 bottom-1 w-0.5 bg-primary rounded-r" />
            )}
            <Icon size={18} />
          </button>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/console/src/layout/ActivityBar.tsx
git commit -m "feat(console): ActivityBar component with Explorer/Instances/Search icons"
```

---

### Task 4: Status Bar

**Files:**

- Create: `apps/console/src/layout/StatusBar.tsx`

- [ ] **Step 1: Create StatusBar component**

Create `apps/console/src/layout/StatusBar.tsx`:

```tsx
import { useDashboard } from '@/features/dashboard/hooks'

export default function StatusBar() {
  const { data } = useDashboard()

  return (
    <footer className="flex items-center h-6 px-3 bg-[var(--status-bar)] border-t border-border text-[10px] text-muted-foreground shrink-0">
      <span>
        {data
          ? `${data.environments.total_count} environments | ${data.environments.total_actions} actions`
          : 'Loading...'}
      </span>
      <div className="flex-1" />
      <span>Trajectory v1.0.0</span>
    </footer>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/console/src/layout/StatusBar.tsx
git commit -m "feat(console): StatusBar component with environment/action counts"
```

---

### Task 5: Side Panel Container + Placeholder Panels

**Files:**

- Create: `apps/console/src/layout/SidePanel.tsx`
- Create: `apps/console/src/features/instances-panel/InstancesPanel.tsx`
- Create: `apps/console/src/features/search-panel/SearchPanel.tsx`

- [ ] **Step 1: Create placeholder InstancesPanel**

Create `apps/console/src/features/instances-panel/InstancesPanel.tsx`:

```tsx
export default function InstancesPanel() {
  return (
    <div className="p-3 text-xs text-muted-foreground">
      <p className="uppercase tracking-wide text-[10px] font-medium mb-2">Instances</p>
      <p>Active and recent instances will appear here.</p>
    </div>
  )
}
```

- [ ] **Step 2: Create placeholder SearchPanel**

Create `apps/console/src/features/search-panel/SearchPanel.tsx`:

```tsx
export default function SearchPanel() {
  return (
    <div className="p-3 text-xs text-muted-foreground">
      <p className="uppercase tracking-wide text-[10px] font-medium mb-2">Search</p>
      <p>Search across environments, actions, and states.</p>
    </div>
  )
}
```

- [ ] **Step 3: Create SidePanel container**

Create `apps/console/src/layout/SidePanel.tsx`:

```tsx
import { usePanelContext } from './PanelContext'
import ExplorerPanel from '@/features/explorer/ExplorerPanel'
import InstancesPanel from '@/features/instances-panel/InstancesPanel'
import SearchPanel from '@/features/search-panel/SearchPanel'

export default function SidePanel() {
  const { activePanel } = usePanelContext()

  if (!activePanel) return null

  return (
    <div className="w-56 bg-[var(--side-panel)] border-r border-border shrink-0 overflow-y-auto">
      {activePanel === 'explorer' && <ExplorerPanel />}
      {activePanel === 'instances' && <InstancesPanel />}
      {activePanel === 'search' && <SearchPanel />}
    </div>
  )
}
```

Note: This will fail to compile until ExplorerPanel exists (Task 7). That's fine — we'll create a placeholder first.

- [ ] **Step 4: Create placeholder ExplorerPanel (temporary)**

Create `apps/console/src/features/explorer/ExplorerPanel.tsx`:

```tsx
export default function ExplorerPanel() {
  return (
    <div className="p-3 text-xs text-muted-foreground">
      <p className="uppercase tracking-wide text-[10px] font-medium mb-2">Explorer</p>
      <p>Loading tree...</p>
    </div>
  )
}
```

- [ ] **Step 5: Commit**

```bash
git add apps/console/src/layout/SidePanel.tsx apps/console/src/features/instances-panel/InstancesPanel.tsx apps/console/src/features/search-panel/SearchPanel.tsx apps/console/src/features/explorer/ExplorerPanel.tsx
git commit -m "feat(console): SidePanel container with placeholder panels"
```

---

### Task 6: Assemble New Layout and Remove Sidebar

**Files:**

- Modify: `apps/console/src/layout/Layout.tsx`
- Delete: `apps/console/src/layout/Sidebar.tsx`

- [ ] **Step 1: Rewrite Layout.tsx**

Replace the entire contents of `apps/console/src/layout/Layout.tsx`:

```tsx
import { Outlet } from 'react-router'
import TopNav from './TopNav'
import ActivityBar from './ActivityBar'
import SidePanel from './SidePanel'
import StatusBar from './StatusBar'

export default function Layout() {
  return (
    <div className="flex flex-col h-screen bg-background">
      <TopNav />
      <div className="flex flex-1 overflow-hidden">
        <ActivityBar />
        <SidePanel />
        <main className="flex-1 overflow-auto p-6">
          <Outlet />
        </main>
      </div>
      <StatusBar />
    </div>
  )
}
```

- [ ] **Step 2: Delete Sidebar.tsx**

```bash
git rm apps/console/src/layout/Sidebar.tsx
```

- [ ] **Step 3: Verify the app renders**

Run: `npm run dev:console`
Expected: The console now shows:

- Dark top nav bar with "Trajectory", Dashboard/Log/Settings tabs, search placeholder, theme toggle
- Activity bar on the left with 3 icons
- Side panel (showing "Explorer" placeholder) next to the activity bar
- Main content area rendering the current page
- Status bar at the bottom
- Clicking activity bar icons switches/collapses the panel
- Theme toggle switches between dark and light

- [ ] **Step 4: Commit**

```bash
git add apps/console/src/layout/Layout.tsx
git commit -m "feat(console): assemble IDE layout — top nav, activity bar, side panel, status bar"
```

---

### Task 7: Explorer Data Hook

**Files:**

- Create: `apps/console/src/features/explorer/hooks.ts`

- [ ] **Step 1: Create useExplorerData hook**

Create `apps/console/src/features/explorer/hooks.ts`:

```tsx
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { EnvironmentSummary, ActionSummaryInEnvironment } from '@/lib/types'

export interface ExplorerEnvironment {
  oid: string
  local_id: string
  actions: ExplorerAction[]
}

export interface ExplorerAction {
  oid: string
  local_id: string
  environment_oid: string
  action_visibility: 'observable' | 'opaque'
  states_with_code: string[]
}

/**
 * Fetches all environments, then for each environment fetches its detail
 * (which includes actions with code status). Returns a flat tree-ready structure.
 */
export function useExplorerData() {
  // Step 1: get all environments
  const envQuery = useQuery({
    queryKey: ['environments'],
    queryFn: () => api.environments(),
  })

  // Step 2: for each environment, get its detail (includes actions with code summary)
  const envOids = envQuery.data?.environments.map((e) => e.oid) ?? []

  const detailQueries = useQuery({
    queryKey: ['explorer-tree', envOids],
    queryFn: async () => {
      const details = await Promise.all(envOids.map((oid) => api.environment(oid)))
      return details
    },
    enabled: envOids.length > 0,
  })

  // Build tree data
  const tree: ExplorerEnvironment[] = (detailQueries.data ?? []).map((detail) => ({
    oid: detail.oid,
    local_id: detail.local_id,
    actions: (detail.actions ?? []).map((a: ActionSummaryInEnvironment) => ({
      oid: a.oid,
      local_id: a.local_id,
      environment_oid: detail.oid,
      action_visibility: a.action_visibility,
      states_with_code: a.states_with_code,
    })),
  }))

  return {
    tree,
    isLoading: envQuery.isLoading || detailQueries.isLoading,
    isError: envQuery.isError || detailQueries.isError,
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/console/src/features/explorer/hooks.ts
git commit -m "feat(console): useExplorerData hook for explorer tree"
```

---

### Task 8: Tree Node Component

**Files:**

- Create: `apps/console/src/features/explorer/TreeNode.tsx`

- [ ] **Step 1: Create TreeNode component**

Create `apps/console/src/features/explorer/TreeNode.tsx`:

```tsx
import { useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { ChevronRight, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { usePanelContext } from '@/layout/PanelContext'
import type { ExplorerAction } from './hooks'

// ISA-88 states per visibility
const OBSERVABLE_STATES = [
  'STARTING',
  'EXECUTING',
  'COMPLETING',
  'COMPLETED',
  'PAUSING',
  'PAUSED',
  'UNPAUSING',
  'HOLDING',
  'HELD',
  'UNHOLDING',
  'ABORTING',
  'ABORTED',
  'CLEARING',
  'STOPPING',
]

const OPAQUE_STATES = ['POSTED', 'RECEIVED', 'IN_PROGRESS', 'COMPLETED', 'ABORTING', 'STOPPING']

// ---- Environment Node ----

export function EnvironmentNode({
  oid,
  localId,
  actions,
  actionCount,
}: {
  oid: string
  localId: string
  actions: ExplorerAction[]
  actionCount: number
}) {
  const [expanded, setExpanded] = useState(false)
  const navigate = useNavigate()
  const params = useParams()
  const Chevron = expanded ? ChevronDown : ChevronRight

  return (
    <div>
      <div
        className="flex items-center gap-1 px-2 py-0.5 cursor-pointer hover:bg-muted/50 text-xs"
        onClick={() => setExpanded(!expanded)}
        onDoubleClick={() => void navigate(`/environments/${oid}`)}
      >
        <Chevron size={12} className="text-muted-foreground shrink-0" />
        <span className="font-medium text-foreground truncate">{localId}</span>
        {!expanded && (
          <span className="ml-auto text-[10px] text-muted-foreground">{actionCount}</span>
        )}
      </div>
      {expanded &&
        actions.map((action) => (
          <ActionNode key={action.oid} action={action} currentActionOid={params.oid} />
        ))}
    </div>
  )
}

// ---- Action Node ----

function ActionNode({
  action,
  currentActionOid,
}: {
  action: ExplorerAction
  currentActionOid?: string
}) {
  const [expanded, setExpanded] = useState(false)
  const navigate = useNavigate()
  const { codeFilterActive } = usePanelContext()
  const isSelected = currentActionOid === action.oid
  const Chevron = expanded ? ChevronDown : ChevronRight

  const applicableStates = action.action_visibility === 'opaque' ? OPAQUE_STATES : OBSERVABLE_STATES

  const statesWithCodeSet = new Set(action.states_with_code)

  const visibleStates = codeFilterActive
    ? applicableStates.filter((s) => statesWithCodeSet.has(s))
    : applicableStates

  return (
    <div>
      <div
        className={cn(
          'flex items-center gap-1 pl-5 pr-2 py-0.5 cursor-pointer hover:bg-muted/50 text-xs',
          isSelected && !expanded && 'bg-primary/10 text-primary'
        )}
        onClick={() => setExpanded(!expanded)}
        onDoubleClick={() => void navigate(`/actions/${action.oid}`)}
      >
        <Chevron size={12} className="text-muted-foreground shrink-0" />
        <span
          className={cn('truncate', isSelected ? 'font-medium text-primary' : 'text-foreground')}
        >
          {action.local_id}
        </span>
        {!expanded && (
          <span className="ml-auto text-[10px] text-muted-foreground">
            {action.states_with_code.length}
          </span>
        )}
      </div>
      {expanded &&
        visibleStates.map((state) => (
          <StateNode
            key={state}
            actionOid={action.oid}
            state={state}
            hasCode={statesWithCodeSet.has(state)}
          />
        ))}
    </div>
  )
}

// ---- State Node ----

function StateNode({
  actionOid,
  state,
  hasCode,
}: {
  actionOid: string
  state: string
  hasCode: boolean
}) {
  const navigate = useNavigate()
  const params = useParams()
  // Match both /actions/:oid (action detail) and /actions/:oid/code/:state (future)
  const isSelected = params.oid === actionOid && params.state === state

  return (
    <div
      className={cn(
        'flex items-center gap-1.5 pl-9 pr-2 py-0.5 cursor-pointer hover:bg-muted/50 text-xs',
        isSelected && 'bg-primary/10 border-l-2 border-primary'
      )}
      onClick={() => void navigate(`/code-editor?action=${actionOid}&state=${state}`)}
    >
      <span
        className={cn(
          'w-1.5 h-1.5 rounded-full shrink-0',
          hasCode ? 'bg-green-500' : 'bg-muted-foreground/30'
        )}
      />
      <span className={cn('truncate', hasCode ? 'text-foreground' : 'text-muted-foreground')}>
        {state}
      </span>
    </div>
  )
}
```

Note: The StateNode currently navigates to `/code-editor?action=...&state=...` (the existing code editor route pattern). This will be updated to `/actions/:oid/code/:state` in Plan B when the inline code editor is implemented.

- [ ] **Step 2: Commit**

```bash
git add apps/console/src/features/explorer/TreeNode.tsx
git commit -m "feat(console): TreeNode components for Environment/Action/State hierarchy"
```

---

### Task 9: Full Explorer Panel

**Files:**

- Modify: `apps/console/src/features/explorer/ExplorerPanel.tsx`

- [ ] **Step 1: Replace placeholder ExplorerPanel with full implementation**

Replace the entire contents of `apps/console/src/features/explorer/ExplorerPanel.tsx`:

```tsx
import { useRef } from 'react'
import { Upload, Filter } from 'lucide-react'
import { usePanelContext } from '@/layout/PanelContext'
import { useExplorerData } from './hooks'
import { EnvironmentNode } from './TreeNode'
import { useUploadPackage } from '@/features/environments/hooks'
import { cn } from '@/lib/utils'

export default function ExplorerPanel() {
  const { tree, isLoading, isError } = useExplorerData()
  const { codeFilterActive, toggleCodeFilter } = usePanelContext()
  const uploadMutation = useUploadPackage()
  const fileInputRef = useRef<HTMLInputElement>(null)

  function handleUploadClick() {
    fileInputRef.current?.click()
  }

  function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    uploadMutation.mutate(file)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-border shrink-0">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium flex-1">
          Explorer
        </span>
        <button
          onClick={handleUploadClick}
          className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          title="Import .WFenvir file"
        >
          <Upload size={12} />
        </button>
        <button
          onClick={toggleCodeFilter}
          className={cn(
            'p-1 rounded transition-colors',
            codeFilterActive
              ? 'bg-primary/20 text-primary'
              : 'text-muted-foreground hover:text-foreground hover:bg-muted'
          )}
          title={codeFilterActive ? 'Showing states with code only' : 'Show all states'}
        >
          <Filter size={12} />
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".WFenvir,.WFaction"
          className="hidden"
          onChange={handleFileSelected}
        />
      </div>

      {/* Tree */}
      <div className="flex-1 overflow-y-auto py-1">
        {isLoading && <p className="px-3 py-2 text-xs text-muted-foreground">Loading...</p>}
        {isError && <p className="px-3 py-2 text-xs text-destructive">Failed to load</p>}
        {!isLoading &&
          !isError &&
          tree.map((env) => (
            <EnvironmentNode
              key={env.oid}
              oid={env.oid}
              localId={env.local_id}
              actions={env.actions}
              actionCount={env.actions.length}
            />
          ))}
        {!isLoading && !isError && tree.length === 0 && (
          <div className="px-3 py-4 text-xs text-muted-foreground text-center">
            <p>No environments yet.</p>
            <button onClick={handleUploadClick} className="mt-2 text-primary hover:underline">
              Import a .WFenvir file
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify the explorer works**

Run: `npm run dev:console`
Expected: The explorer panel shows the environment/action/state tree. Clicking environments/actions expands them. States show green/gray dots. The filter toggle hides no-code states. The upload button opens a file picker.

- [ ] **Step 3: Commit**

```bash
git add apps/console/src/features/explorer/ExplorerPanel.tsx
git commit -m "feat(console): full Explorer panel with 3-level tree, code filter, and upload"
```

---

### Task 10: Build Verification and Cleanup

**Files:** None (verification only)

- [ ] **Step 1: Build check**

```bash
npm run build
```

Expected: TypeScript compiles without errors.

- [ ] **Step 2: Lint check**

```bash
npm run lint
```

Expected: No errors. Fix any issues.

- [ ] **Step 3: Run full test suite**

```bash
npm test
```

Expected: All existing tests pass. No tests broken by layout changes (layout components are purely visual — no existing unit tests to break).

- [ ] **Step 4: Format check on changed files**

```bash
npx prettier --check apps/console/src/layout/ apps/console/src/features/explorer/ apps/console/src/features/instances-panel/ apps/console/src/features/search-panel/ apps/console/src/App.tsx apps/console/src/main.tsx apps/console/src/index.css
```

Expected: All matched files use Prettier code style. Fix any issues.

- [ ] **Step 5: Commit any fixes**

```bash
git add -A
git commit -m "fix: lint and format issues from console reskin"
```
