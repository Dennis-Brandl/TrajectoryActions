import { NavLink } from 'react-router'
import { Sun, Moon, Search } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { usePanelContext } from './PanelContext'
import { api } from '@/lib/api'
import { cn } from '@trajectory/ui'

const navItems = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/log', label: 'Log', end: false },
  { to: '/settings', label: 'Settings', end: false },
]

export default function TopNav() {
  const { theme, toggleTheme, searchQuery, setSearchQuery, setActivePanel } = usePanelContext()

  // Fetch the externally-reachable REST URL from the server itself rather
  // than deriving it from window.location.origin. The console runs on a
  // different port than the REST API (Vite :5176 in dev, nginx :3003 in
  // Docker), so window.location.origin used to show the console's URL —
  // which doesn't serve the REST API root (`Cannot GET /`) and isn't the
  // address workflow authors should be copying into action_server_specifications.
  // See server/src/routes/management.ts → `GET /server-info`.
  const { data: serverInfo } = useQuery({
    queryKey: ['server-info'],
    queryFn: () => api.serverInfo(),
    staleTime: Infinity, // The bound URL doesn't change for the life of the process.
  })
  // Display the BASE URL only (no `/trajectory/v1/` suffix). Every consumer
  // — TrajectoryActionTester (`packages/.../api/*.ts: connection.url + '/trajectory/v1/...'`)
  // and TrajectoryRuntime (`ActionApiClient: serverUri + '/trajectory/v1/...'`) —
  // takes the base URL and appends the protocol path itself; pasting in a URL
  // that already ends in `/trajectory/v1/` produces a double-prefix 404.
  // protocol_path is still returned by the API for tooltips/docs but is NOT
  // part of what the user should copy.
  const serverUrl = serverInfo
    ? serverInfo.rest_base_url
    : // Pre-fetch fallback: synthesize a base-only URL from the current
      // origin so the header never renders empty. The server-info value
      // replaces it once the query resolves (typically within a frame on
      // local dev). Still wrong-port in dev (shows console's port), but
      // at least it's the right SHAPE (no /trajectory/v1/ suffix).
      window.location.origin

  return (
    <header className="flex items-center h-10 px-3 bg-[var(--activity-bar)] border-b border-border shrink-0">
      <div className="flex items-center gap-2 mr-6">
        <img src="/ic_launcher_round.png" alt="Trajectory" className="h-6 w-6 object-contain" />
        <span className="text-sm font-semibold text-foreground">Trajectory Action Container</span>
        <span className="text-xs text-muted-foreground">v{__APP_VERSION__}</span>
      </div>
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
      <div
        className="ml-4 flex items-center gap-1.5 text-xs text-muted-foreground"
        title="REST base URL. Paste this as-is into an env's action_server_specifications, or into the TrajectoryActionTester connection URL. Do NOT append /trajectory/v1/ — clients add the protocol path themselves."
      >
        <span className="text-muted-foreground/70">Server:</span>
        <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-foreground">
          {serverUrl}
        </code>
      </div>
      <div className="flex-1" />
      <div className="flex items-center gap-2 px-2 py-1 rounded bg-muted text-muted-foreground text-xs w-48 focus-within:ring-1 focus-within:ring-primary">
        <Search size={12} className="shrink-0" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onFocus={() => setActivePanel('search')}
          placeholder="Search..."
          className="flex-1 bg-transparent outline-none text-foreground placeholder:text-muted-foreground"
        />
      </div>
      <a
        href="/help.html"
        target="_blank"
        rel="noopener noreferrer"
        className="ml-2 px-2 py-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors text-xs font-medium"
        title="Open the help guide"
      >
        Help
      </a>
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
