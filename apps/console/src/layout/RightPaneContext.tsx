import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

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
 * has nothing to put in the pane. Pages should `useMemo` the payload on
 * the data it depends on so the effect doesn't re-run every render.
 */
export function useRegisterRightPane(payload: RightPanePayload | null): void {
  const { setPayload } = useRightPane()
  useEffect(() => {
    setPayload(payload)
    return () => setPayload(null)
  }, [payload, setPayload])
}
