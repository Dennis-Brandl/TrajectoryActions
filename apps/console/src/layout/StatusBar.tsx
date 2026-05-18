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
      <span>Trajectory Action Container v1.0.0</span>
    </footer>
  )
}
