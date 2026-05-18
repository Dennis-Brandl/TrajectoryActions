# Phase 7: Management Console - Research

**Researched:** 2026-02-27
**Domain:** React 19 SPA — admin console with routing, server state, Monaco editor, file upload
**Confidence:** HIGH

## Summary

Phase 7 builds a browser-based management console as a React 19 SPA using the existing Vite 6 scaffold
in `apps/console`. The scaffold already has React 19, react-dom, and Vite configured with a proxy
to localhost:3001. What is missing is: routing (React Router v7), server state (TanStack Query v5),
a component library (shadcn/ui + Tailwind CSS v4), Monaco editor for Python code editing, and a
file upload zone for .WFenvir/.WFaction packages.

The standard stack for this domain in 2026 is React Router v7 (declarative mode) + TanStack Query v5

- shadcn/ui (built on Radix UI + Tailwind CSS v4) + @monaco-editor/react + react-dropzone. This is
  a well-established combination with verified React 19 support. Auto-refresh polling (2s and 5s) is
  handled natively by TanStack Query's `refetchInterval` option without additional libraries.

The primary complexity points are: (1) Monaco editor requires Vite worker configuration, (2) shadcn/ui
requires path alias setup in both `tsconfig.json` and `vite.config.ts`, and (3) react-dropzone's
`accept` prop requires MIME types as keys, which is tricky for proprietary extensions like `.WFenvir`.

**Primary recommendation:** Use declarative mode React Router v7 with BrowserRouter + TanStack Query v5
for all server state + shadcn/ui for components + @monaco-editor/react with `vite-plugin-monaco-editor`
for the code editor.

## Standard Stack

### Core (install these)

| Library               | Version                  | Purpose                                     | Why Standard                                       |
| --------------------- | ------------------------ | ------------------------------------------- | -------------------------------------------------- |
| react-router          | 7.x (latest 7.13.1)      | Client-side routing, URL params, navigation | Required by UI-01; v7 is current stable            |
| @tanstack/react-query | 5.x (latest 5.90.x)      | Server state, caching, polling, mutations   | Required by UI-01; industry standard for API data  |
| tailwindcss           | 4.x (4.2)                | Utility CSS                                 | Required for shadcn/ui                             |
| @tailwindcss/vite     | 4.x                      | Tailwind v4 Vite plugin                     | v4 uses plugin instead of PostCSS                  |
| shadcn/ui (CLI)       | latest                   | Copies component source into project        | Zero-runtime component library over Radix+Tailwind |
| @monaco-editor/react  | 4.x (@next for React 19) | Monaco editor React wrapper                 | No webpack config needed; works with Vite          |
| react-dropzone        | 15.x                     | Drag-and-drop file upload zone              | Hook-based, React 19 compatible                    |

### Supporting

| Library                        | Version | Purpose                                      | When to Use                           |
| ------------------------------ | ------- | -------------------------------------------- | ------------------------------------- |
| @tanstack/react-query-devtools | 5.x     | Dev-time query inspection                    | During development only               |
| @tanstack/react-table          | 8.x     | Headless table logic                         | Used internally by shadcn data-table  |
| @types/node                    | latest  | Node types for `path.resolve` in vite.config | Required for path alias setup         |
| vite-plugin-monaco-editor      | 1.x     | Handles Monaco worker bundling in Vite       | Prevents ESM worker resolution errors |

### Alternatives Considered

| Instead of     | Could Use                    | Tradeoff                                                                               |
| -------------- | ---------------------------- | -------------------------------------------------------------------------------------- |
| shadcn/ui      | MUI / Ant Design             | shadcn is copy-into-project (no bundle overhead, fully customizable); MUI is heavier   |
| shadcn/ui      | Headless UI + raw Tailwind   | shadcn adds 50+ pre-built components; faster for this scope                            |
| react-dropzone | Custom `<input type="file">` | react-dropzone handles drag events, file rejection, MIME validation; custom is fragile |
| TanStack Query | SWR / Zustand                | TQ v5 is explicitly required (UI-01); SWR has less mutation support                    |

**Installation:**

```bash
# In apps/console directory:
npm install react-router
npm install @tanstack/react-query @tanstack/react-query-devtools
npm install tailwindcss @tailwindcss/vite
npm install react-dropzone
npm install @monaco-editor/react@next
npm install vite-plugin-monaco-editor
npm install @tanstack/react-table
npm install -D @types/node

# Then init shadcn (after tsconfig path aliases are set up):
npx shadcn@latest init

# Add shadcn components as needed:
npx shadcn@latest add button card dialog select table tabs input label badge
```

## Architecture Patterns

### Recommended Project Structure

```
apps/console/src/
├── main.tsx              # QueryClientProvider + BrowserRouter wrap
├── App.tsx               # Routes definition
├── components/           # Shared reusable UI (shadcn components go here via CLI)
│   └── ui/               # shadcn-generated components
├── lib/                  # Utility functions, api client
│   └── api.ts            # Typed fetch wrappers for /management/v1/* endpoints
├── features/             # Feature folders (one per page/domain)
│   ├── dashboard/        # UI-03
│   │   ├── DashboardPage.tsx
│   │   └── hooks.ts      # useQuery for /management/v1/dashboard
│   ├── environments/     # UI-04, UI-05, UI-06
│   │   ├── EnvironmentsPage.tsx
│   │   ├── EnvironmentDetailPage.tsx
│   │   ├── UploadDialog.tsx
│   │   └── hooks.ts
│   ├── actions/          # UI-07
│   │   ├── ActionDetailPage.tsx
│   │   └── hooks.ts
│   ├── code-editor/      # UI-08 through UI-12
│   │   ├── CodeEditorPage.tsx
│   │   ├── VersionHistory.tsx
│   │   ├── TestPanel.tsx
│   │   └── hooks.ts
│   ├── instances/        # UI-13, UI-14
│   │   ├── InstancesPage.tsx
│   │   ├── InstanceDetailPage.tsx
│   │   └── hooks.ts
│   ├── log/              # UI-15
│   │   ├── LogPage.tsx
│   │   └── hooks.ts
│   └── settings/         # UI-16
│       ├── SettingsPage.tsx
│       └── hooks.ts
└── layout/
    ├── Layout.tsx         # Sidebar + Outlet wrapper
    └── Sidebar.tsx        # NavLink-based navigation
```

### Pattern 1: React Router v7 Declarative Mode with Layout Route

Use `<BrowserRouter>` in `main.tsx`. Define a layout route (no path) that renders the sidebar
layout with `<Outlet>`, and nest all page routes under it.

```tsx
// Source: https://reactrouter.com/start/declarative/routing
// main.tsx
import { BrowserRouter } from 'react-router'
import { QueryClientProvider } from '@tanstack/react-query'

const queryClient = new QueryClient()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={queryClient}>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </QueryClientProvider>
)

// App.tsx
import { Routes, Route } from 'react-router'
import Layout from './layout/Layout'

export default function App() {
  return (
    <Routes>
      {/* Layout route — no path, renders sidebar */}
      <Route element={<Layout />}>
        <Route index element={<DashboardPage />} />
        <Route path="environments" element={<EnvironmentsPage />} />
        <Route path="environments/:oid" element={<EnvironmentDetailPage />} />
        <Route path="actions/:oid" element={<ActionDetailPage />} />
        <Route path="code-editor" element={<CodeEditorPage />} />
        <Route path="instances" element={<InstancesPage />} />
        <Route path="instances/:id" element={<InstanceDetailPage />} />
        <Route path="log" element={<LogPage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
    </Routes>
  )
}

// layout/Layout.tsx
import { Outlet } from 'react-router'
import Sidebar from './Sidebar'

export default function Layout() {
  return (
    <div className="flex h-screen">
      <Sidebar />
      <main className="flex-1 overflow-auto p-6">
        <Outlet />
      </main>
    </div>
  )
}
```

### Pattern 2: TanStack Query for Server State with Auto-Refresh

Each feature's `hooks.ts` exports typed `useQuery` hooks. Polling pages use `refetchInterval`.

```tsx
// Source: https://tanstack.com/query/v5/docs/framework/react/quick-start
// features/dashboard/hooks.ts
import { useQuery } from '@tanstack/react-query'

export function useDashboard() {
  return useQuery({
    queryKey: ['dashboard'],
    queryFn: async () => {
      const res = await fetch('/management/v1/dashboard')
      if (!res.ok) throw new Error('Failed to fetch dashboard')
      return res.json() as Promise<DashboardData>
    },
    refetchInterval: 5000, // 5-second auto-refresh (UI-03)
  })
}

// features/instances/hooks.ts — 2-second refresh (UI-13)
export function useActiveInstances() {
  return useQuery({
    queryKey: ['instances', 'active'],
    queryFn: () => fetch('/management/v1/instances/active').then((r) => r.json()),
    refetchInterval: 2000,
  })
}
```

### Pattern 3: TanStack Query Mutation with Cache Invalidation

```tsx
// Source: https://tanstack.com/query/v5/docs/framework/react/guides/mutations
import { useMutation, useQueryClient } from '@tanstack/react-query'

export function useUploadPackage() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData()
      formData.append('package', file)
      // DO NOT set Content-Type header — browser sets it with boundary automatically
      const res = await fetch('/management/v1/upload', {
        method: 'POST',
        body: formData,
      })
      if (!res.ok) throw new Error('Upload failed')
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['environments'] })
    },
  })
}
```

### Pattern 4: Monaco Editor with Python (Vite Worker Setup)

The `@monaco-editor/react` library handles CDN loading by default. To avoid Vite ESM worker
resolution issues and enable offline use, use `vite-plugin-monaco-editor`.

```tsx
// Source: https://github.com/suren-atoyan/monaco-react
// vite.config.ts — ADD to existing config
import monacoEditorPlugin from 'vite-plugin-monaco-editor'

export default defineConfig({
  plugins: [react(), tailwindcss(), monacoEditorPlugin({})],
  // ...existing proxy config
})

// features/code-editor/CodeEditorPage.tsx
import Editor from '@monaco-editor/react'

function CodeEditor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Editor
      height="60vh"
      language="python"
      value={value}
      onChange={(v) => onChange(v ?? '')}
      theme="vs-dark"
      options={{
        minimap: { enabled: false },
        fontSize: 14,
        lineNumbers: 'on',
        wordWrap: 'on',
      }}
    />
  )
}
```

### Pattern 5: File Upload with react-dropzone for Custom Extensions

`.WFenvir` and `.WFaction` are proprietary extensions. The `accept` prop requires MIME type keys.
Use `application/octet-stream` with the extensions listed. If the file picker validation is
unreliable (known issue with custom types), validate extension client-side in `onDrop`.

```tsx
// Source: https://react-dropzone.js.org/
import { useDropzone } from 'react-dropzone'

function UploadZone({ onFileAccepted }: { onFileAccepted: (f: File) => void }) {
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: {
      'application/octet-stream': ['.WFenvir', '.WFaction'],
    },
    maxFiles: 1,
    onDrop: (acceptedFiles, rejectedFiles) => {
      const file = acceptedFiles[0]
      // Validate extension client-side as safety net for custom MIME types
      if (file && (file.name.endsWith('.WFenvir') || file.name.endsWith('.WFaction'))) {
        onFileAccepted(file)
      }
    },
  })

  return (
    <div
      {...getRootProps()}
      className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer
        ${isDragActive ? 'border-blue-500 bg-blue-50' : 'border-gray-300'}`}
    >
      <input {...getInputProps()} />
      <p>
        {isDragActive
          ? 'Drop the file here'
          : 'Drag .WFenvir or .WFaction file here, or click to select'}
      </p>
    </div>
  )
}
```

### Pattern 6: shadcn/ui Data Table with Pagination and Filtering

```tsx
// Source: https://ui.shadcn.com/docs/components/radix/data-table
import {
  useReactTable,
  getCoreRowModel,
  getPaginationRowModel,
  getFilteredRowModel,
} from '@tanstack/react-table'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

// Column definitions in columns.tsx, DataTable in data-table.tsx
// Filtering: column.setFilterValue(input)
// Pagination: table.previousPage() / table.nextPage()
```

### Pattern 7: NavLink Active State in Sidebar

```tsx
// Source: https://reactrouter.com/start/declarative/routing
import { NavLink } from 'react-router'

function Sidebar() {
  const navItems = [
    { to: '/', label: 'Dashboard', icon: LayoutDashboard },
    { to: '/environments', label: 'Environments', icon: Package },
    { to: '/code-editor', label: 'Code Editor', icon: Code },
    { to: '/instances', label: 'Instances', icon: Activity },
    { to: '/log', label: 'Execution Log', icon: ScrollText },
    { to: '/settings', label: 'Settings', icon: Settings },
  ]

  return (
    <nav className="w-64 h-screen bg-gray-900 text-white p-4">
      {navItems.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          end={to === '/'}
          className={({ isActive }) =>
            `flex items-center gap-3 p-3 rounded-lg mb-1 ${
              isActive ? 'bg-blue-600' : 'hover:bg-gray-700'
            }`
          }
        >
          <Icon size={18} />
          {label}
        </NavLink>
      ))}
    </nav>
  )
}
```

### Anti-Patterns to Avoid

- **Using `useEffect` + `setInterval` for polling:** TanStack Query's `refetchInterval` handles this, including pause-on-hidden-tab, error backoff, and cache invalidation.
- **Setting `Content-Type: multipart/form-data` manually:** The browser must set this (it includes the boundary). Manually setting it breaks uploads.
- **Importing Monaco directly without worker setup:** Will fail in Vite's ESM environment. Use `vite-plugin-monaco-editor` or manual `?worker` imports.
- **Fetching data in components directly:** Use the `features/*/hooks.ts` pattern so query keys are consistent and cache invalidation works.
- **Framework mode React Router for this project:** The existing scaffold uses Vite with a simple config; framework mode requires `react-router.config.ts` and restructures the app. Declarative mode is the right choice here.

## Don't Hand-Roll

| Problem                    | Don't Build                           | Use Instead                                 | Why                                                      |
| -------------------------- | ------------------------------------- | ------------------------------------------- | -------------------------------------------------------- |
| Sidebar active nav state   | Custom active class logic             | `NavLink` className callback                | NavLink tracks route match automatically                 |
| 2s/5s auto-polling         | `useEffect` + `setInterval`           | `refetchInterval` in `useQuery`             | TQ handles pause, cleanup, error states                  |
| File drag-and-drop         | Raw drag events                       | `react-dropzone`                            | Browser drag API is complex; dropzone handles all cases  |
| Table pagination/filtering | Custom state                          | `@tanstack/react-table` + shadcn data-table | Column definitions, row models, filter state are complex |
| Monaco Vite bundling       | Custom `?worker` imports per language | `vite-plugin-monaco-editor`                 | Worker paths differ between dev and prod                 |
| API typing                 | `any` everywhere                      | Typed `api.ts` with typed fetch functions   | Catches response shape mismatches at compile time        |
| Upload progress            | Custom XMLHttpRequest                 | useMutation `isPending` + shadcn progress   | Sufficient for single-file upload                        |

**Key insight:** The management console's complexity is in wiring many endpoints to many pages. Every minute spent on infrastructure (polling, tables, file upload) is a minute not spent on correctness. The standard stack eliminates all of that infrastructure.

## Common Pitfalls

### Pitfall 1: shadcn/ui Init Fails with "No import alias found"

**What goes wrong:** `npx shadcn@latest init` fails with "No import alias found in your tsconfig.json".
**Why it happens:** shadcn CLI inspects `tsconfig.json` for paths. The existing `tsconfig.json` has no `baseUrl` or `paths`. Also, the path value must be `"./src/*"` not `"src/*"`.
**How to avoid:** Before running `npx shadcn@latest init`, add to `tsconfig.json` compilerOptions:

```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": { "@/*": ["./src/*"] }
  }
}
```

And add the alias to `vite.config.ts`:

```typescript
import path from 'path'
resolve: { alias: { "@": path.resolve(__dirname, "./src") } }
```

**Warning signs:** `shadcn init` exits immediately with a config error.

### Pitfall 2: Monaco Editor Fails in Vite with Worker Errors

**What goes wrong:** Console shows `Could not resolve "monaco-editor/esm/vs/editor/editor.worker"` or the editor loads blank.
**Why it happens:** Vite's ESM resolution doesn't automatically bundle Monaco's web workers. `@monaco-editor/react` by default loads Monaco from CDN — this works in dev but can fail in builds.
**How to avoid:** Install `vite-plugin-monaco-editor` and add it to `vite.config.ts` plugins. This bundles workers correctly for both dev and production.
**Warning signs:** Blank editor panel or network errors for `.worker.js` files in browser DevTools.

### Pitfall 3: react-dropzone Rejects Custom File Extensions

**What goes wrong:** `.WFenvir` files are rejected even with `accept` configured.
**Why it happens:** The `accept` prop keys must be valid MIME types. Custom extensions without registered MIME types get mapped to `application/octet-stream`, but browser MIME detection varies by OS and browser.
**How to avoid:** Use `accept: { 'application/octet-stream': ['.WFenvir', '.WFaction'] }` AND add client-side extension validation in the `onDrop` callback as a safety net. If using the File System Access API dialog (default), set `useFsAccessApi: false` to use the classic file input which has better extension filtering.
**Warning signs:** `onDropRejected` fires for valid files; check the rejection reason.

### Pitfall 4: React Router NavLink "/" Matches All Routes

**What goes wrong:** The Dashboard nav item stays active on all pages because "/" matches every path.
**Why it happens:** Without `end` prop, NavLink "/" matches any path starting with "/".
**How to avoid:** Add `end` prop to the root route NavLink: `<NavLink to="/" end ...>`.
**Warning signs:** Dashboard item always highlighted in the sidebar.

### Pitfall 5: TanStack Query Defaults Cause Unexpected Refetches

**What goes wrong:** Forms flicker or data resets when the user returns to the browser tab.
**Why it happens:** Default `staleTime: 0` and `refetchOnWindowFocus: true` cause immediate background refetch on focus.
**How to avoid:** For pages where stale data is acceptable (settings, code editor with unsaved changes), override:

```typescript
useQuery({ ..., staleTime: 30_000, refetchOnWindowFocus: false })
```

For polling pages (instances, dashboard), the defaults plus `refetchInterval` are correct.
**Warning signs:** Unsaved editor content is overwritten when user alt-tabs back.

### Pitfall 6: Tailwind v4 + shadcn/ui February 2026 Radix Change

**What goes wrong:** After adding shadcn components, you may see peer dependency warnings about `@radix-ui/*` packages.
**Why it happens:** In February 2026, shadcn migrated `new-york` style to use unified `radix-ui` package.
**How to avoid:** Use the `new-york` style during `shadcn init` (it's the default) and run `npx shadcn@latest migrate radix` if upgrading existing installs.
**Warning signs:** Peer dependency warnings for multiple `@radix-ui/react-*` packages.

### Pitfall 7: tsconfig `verbatimModuleSyntax: false` Conflict with shadcn Imports

**What goes wrong:** shadcn-generated files may use `import type` syntax which is fine, but other imports may fail TypeScript checks.
**Why it happens:** The existing tsconfig has `verbatimModuleSyntax: false` — this is intentional (already decided). shadcn components work fine with this setting.
**How to avoid:** No action needed; this is already handled by the existing tsconfig decision.
**Warning signs:** Not expected to trigger.

## Code Examples

Verified patterns from official sources:

### TanStack Query Provider Setup (main.tsx)

```tsx
// Source: https://tanstack.com/query/v5/docs/framework/react/quick-start
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { BrowserRouter } from 'react-router'
import ReactDOM from 'react-dom/client'
import App from './App'

const queryClient = new QueryClient()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={queryClient}>
    <BrowserRouter>
      <App />
    </BrowserRouter>
    <ReactQueryDevtools initialIsOpen={false} />
  </QueryClientProvider>
)
```

### API Layer Pattern (lib/api.ts)

```typescript
// Typed fetch wrapper — no external library, just typed fetch
const BASE = '/management/v1'

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, init)
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: { message: res.statusText } }))
    throw new Error(err?.error?.message ?? `HTTP ${res.status}`)
  }
  return res.json() as Promise<T>
}

export const api = {
  dashboard: () => apiFetch<DashboardResponse>('/dashboard'),
  environments: () => apiFetch<EnvironmentsResponse>('/environments'),
  environment: (oid: string) => apiFetch<EnvironmentDetail>(`/environments/${oid}`),
  // ... etc
}
```

### Polling Query Pattern (2s refresh for instances)

```typescript
// Source: https://tanstack.com/query/v5/docs/framework/react/reference/useQuery
import { useQuery } from '@tanstack/react-query'

export function useActiveInstances() {
  return useQuery({
    queryKey: ['instances', 'active'],
    queryFn: () => api.activeInstances(),
    refetchInterval: 2000, // UI-13: 2-second auto-refresh
    staleTime: 0, // Always consider stale for live data
  })
}
```

### shadcn Component Installation Pattern

```bash
# Source: https://ui.shadcn.com/docs/installation/vite
npx shadcn@latest add card
npx shadcn@latest add dialog
npx shadcn@latest add table
npx shadcn@latest add select
npx shadcn@latest add tabs
npx shadcn@latest add input
npx shadcn@latest add badge
npx shadcn@latest add button
npx shadcn@latest add label
npx shadcn@latest add separator
```

### Monaco Editor Controlled Value

```tsx
// Source: https://github.com/suren-atoyan/monaco-react
import Editor from '@monaco-editor/react'

function PythonEditor({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <Editor
      height="60vh"
      language="python"
      value={value}
      onChange={(v) => onChange(v ?? '')}
      theme="vs-dark"
      options={{
        minimap: { enabled: false },
        fontSize: 14,
        tabSize: 4,
        wordWrap: 'on',
        automaticLayout: true,
      }}
    />
  )
}
```

### Code Save Flow (new version with description)

```tsx
// UI-09: Save creates new version with description dialog
function CodeSaveDialog({ onSave }: { onSave: (description: string) => void }) {
  const [desc, setDesc] = useState('')
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button>Save New Version</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Save Version</DialogTitle>
        </DialogHeader>
        <Input
          placeholder="Version description..."
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
        />
        <DialogFooter>
          <Button onClick={() => onSave(desc)}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

### Instance Command Button (Pause/Abort/Stop)

```tsx
// UI-14: POST /management/v1/instances/:id/command
const commandMutation = useMutation({
  mutationFn: ({ id, command }: { id: string; command: 'pause' | 'abort' | 'stop' }) =>
    api.instanceCommand(id, command),
  onSuccess: () => queryClient.invalidateQueries({ queryKey: ['instances', instanceId] }),
})
```

## State of the Art

| Old Approach                            | Current Approach                     | When Changed                | Impact                                                     |
| --------------------------------------- | ------------------------------------ | --------------------------- | ---------------------------------------------------------- |
| `react-router-dom` package              | `react-router` package (v7+)         | React Router v7 (late 2024) | Single package replaces separate dom/native split          |
| Tailwind v3 with PostCSS config         | Tailwind v4 with `@tailwindcss/vite` | Jan 2025                    | Zero PostCSS config needed; `@import "tailwindcss"` in CSS |
| `cacheTime` in React Query              | `gcTime` in TanStack Query v5        | TQ v5 (Oct 2023)            | Renamed for clarity                                        |
| `@radix-ui/react-*` individual packages | unified `radix-ui` package           | shadcn Feb 2026             | Cleaner package.json for new-york style                    |
| `keepPreviousData` in RQ v4             | `placeholderData` in TQ v5           | TQ v5                       | Merged option                                              |

**Deprecated/outdated:**

- `react-router-dom`: Replaced by `react-router` in v7. Still works as an alias but use the primary package.
- `tailwind.config.js`: Not needed in Tailwind v4. Configuration moves to CSS `@theme` directive.
- PostCSS configuration for Tailwind: Not needed with `@tailwindcss/vite` plugin.
- `@monaco-editor/react` without `@next` tag: Does not support React 19. Use `@monaco-editor/react@next`.

## Open Questions

1. **Monaco editor @next stability**
   - What we know: `@monaco-editor/react@next` (v4.7.0-rc.0) adds React 19 support
   - What's unclear: Whether this RC is stable enough for production; no GA release confirmed
   - Recommendation: Use `@next` tag since React 19 is required. Monitor for GA release. The library is well-maintained and RC versions are typically stable.

2. **react-dropzone MIME type for .WFenvir/.WFaction**
   - What we know: `application/octet-stream` with extension array is the correct approach, but has known reliability issues with custom types across OS/browser combos
   - What's unclear: Whether the server validates file type independently (it does — Phase 6 management API parses JSON content, not MIME)
   - Recommendation: Use MIME accept + client-side extension validation in `onDrop`. The server is the real guard; client filtering is UX only.

3. **shadcn tsconfig interaction with existing workspace tsconfig**
   - What we know: The existing `tsconfig.json` extends `../../tsconfig.base.json` which uses `NodeNext` moduleResolution. The console's own tsconfig overrides to `Bundler`.
   - What's unclear: Whether `shadcn init` correctly handles the `extends` chain when reading paths
   - Recommendation: Add `baseUrl` and `paths` directly to `apps/console/tsconfig.json` (not the base), since shadcn reads the local file. Verify with `npx shadcn@latest init` output.

## Sources

### Primary (HIGH confidence)

- https://reactrouter.com/start/declarative/installation — React Router v7 declarative mode setup
- https://reactrouter.com/start/declarative/routing — Layout routes, Outlet, NavLink, useParams
- https://reactrouter.com/start/modes — Mode selection guidance
- https://tanstack.com/query/v5/docs/framework/react/quick-start — TQ v5 setup pattern
- https://tanstack.com/query/v5/docs/framework/react/guides/mutations — useMutation pattern
- https://ui.shadcn.com/docs/installation/vite — shadcn/ui Vite installation
- https://ui.shadcn.com/docs/changelog/2026-02-radix-ui — February 2026 radix-ui migration
- https://ui.shadcn.com/docs/components/radix/data-table — Data table with TanStack Table
- https://tailwindcss.com/docs/installation — Tailwind v4 installation (v4.2 current)
- https://github.com/suren-atoyan/monaco-react — @monaco-editor/react usage and React 19 support

### Secondary (MEDIUM confidence)

- https://github.com/vdesjs/vite-plugin-monaco-editor — vite-plugin-monaco-editor (v1.1.0, last release 2022 but functional)
- https://react-dropzone.js.org/ — react-dropzone v15 hook usage
- https://github.com/react-dropzone/react-dropzone/issues/1265 — Custom extension accept workaround

### Tertiary (LOW confidence)

- WebSearch results for folder structure patterns — confirmed by multiple credible sources but not a single authoritative reference
- vite-plugin-monaco-editor maintenance status — last tagged release July 2022, but npm downloads remain high; functional but not actively developed

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH — all libraries verified against official docs and npmjs; versions confirmed
- Architecture: HIGH — React Router and TanStack Query patterns from official docs; folder structure from well-established community consensus
- Pitfalls: HIGH for known bugs (NavLink end, MIME issues, shadcn alias); MEDIUM for TQ defaults behavior

**Research date:** 2026-02-27
**Valid until:** 2026-03-27 (30 days — stable libraries, though @monaco-editor/react@next GA may land sooner)
