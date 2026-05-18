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
