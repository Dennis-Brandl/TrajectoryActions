import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'

export type PanelId = 'explorer' | 'instances' | 'search'
type Theme = 'dark' | 'light'

interface PanelContextValue {
  activePanel: PanelId | null
  setActivePanel: (panel: PanelId | null) => void
  togglePanel: (panel: PanelId) => void
  theme: Theme
  toggleTheme: () => void
  codeFilterActive: boolean
  toggleCodeFilter: () => void
  searchQuery: string
  setSearchQuery: (q: string) => void
}

const PanelContext = createContext<PanelContextValue | null>(null)

function getInitialTheme(): Theme {
  const stored = localStorage.getItem('trajectory-theme')
  if (stored === 'light' || stored === 'dark') return stored
  return 'dark'
}

function getInitialPanel(): PanelId | null {
  const stored = localStorage.getItem('trajectory-active-panel')
  if (stored === 'explorer' || stored === 'instances' || stored === 'search') return stored
  return 'explorer'
}

function getInitialCodeFilter(): boolean {
  return localStorage.getItem('trajectory-code-filter') === 'true'
}

export function PanelProvider({ children }: { children: ReactNode }) {
  const [activePanel, setActivePanelState] = useState<PanelId | null>(getInitialPanel)
  const [theme, setTheme] = useState<Theme>(getInitialTheme)
  const [codeFilterActive, setCodeFilterActive] = useState(getInitialCodeFilter)
  const [searchQuery, setSearchQuery] = useState('')

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    localStorage.setItem('trajectory-theme', theme)
  }, [theme])

  useEffect(() => {
    if (activePanel) {
      localStorage.setItem('trajectory-active-panel', activePanel)
    } else {
      localStorage.removeItem('trajectory-active-panel')
    }
  }, [activePanel])

  useEffect(() => {
    localStorage.setItem('trajectory-code-filter', String(codeFilterActive))
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
        searchQuery,
        setSearchQuery,
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
