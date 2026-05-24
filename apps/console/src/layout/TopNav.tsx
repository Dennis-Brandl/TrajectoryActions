import { NavLink } from 'react-router'
import { Sun, Moon, Search } from 'lucide-react'
import { usePanelContext } from './PanelContext'
import { cn } from '@trajectory/ui'

const navItems = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/log', label: 'Log', end: false },
  { to: '/settings', label: 'Settings', end: false },
]

export default function TopNav() {
  const { theme, toggleTheme, searchQuery, setSearchQuery, setActivePanel } = usePanelContext()
  const serverUrl = `${window.location.origin}/trajectory/v1/`

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
        title="Register this URL in TrajectoryRuntime to invoke actions on this server"
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
