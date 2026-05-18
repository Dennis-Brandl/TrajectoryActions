import { useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { ChevronRight, ChevronDown, Trash2 } from 'lucide-react'
import { cn } from '@trajectory/ui'
import { usePanelContext } from '@/layout/PanelContext'
import { useDeleteEnvironment } from '@/features/environments/hooks'
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
  onDeleteError,
}: {
  oid: string
  localId: string
  actions: ExplorerAction[]
  actionCount: number
  onDeleteError?: (message: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const navigate = useNavigate()
  const params = useParams()
  const deleteMutation = useDeleteEnvironment()
  const Chevron = expanded ? ChevronDown : ChevronRight

  async function handleDelete(e: React.MouseEvent) {
    e.stopPropagation()
    const confirmed = window.confirm(
      `Delete environment "${localId}"?\n\nThis will permanently remove the environment, all of its actions, and every saved code version. This cannot be undone.`
    )
    if (!confirmed) return
    try {
      await deleteMutation.mutateAsync(oid)
    } catch (err) {
      onDeleteError?.(err instanceof Error ? err.message : 'Delete failed')
    }
  }

  return (
    <div>
      <div
        className="group flex items-center gap-1 px-2 py-0.5 cursor-pointer hover:bg-muted/50 text-xs"
        onClick={() => {
          setExpanded(!expanded)
          void navigate(`/environments/${oid}`)
        }}
      >
        <Chevron size={12} className="text-muted-foreground shrink-0" />
        <span className="font-medium text-foreground truncate flex-1">{localId}</span>
        {!expanded && (
          <span className="text-[10px] text-muted-foreground group-hover:hidden">
            {actionCount}
          </span>
        )}
        <button
          type="button"
          onClick={(e) => void handleDelete(e)}
          disabled={deleteMutation.isPending}
          className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive disabled:opacity-50 disabled:cursor-wait transition-opacity shrink-0"
          title={`Delete environment "${localId}"`}
        >
          <Trash2 size={12} />
        </button>
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
        onClick={() => {
          setExpanded(!expanded)
          void navigate(`/actions/${action.oid}`)
        }}
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
  const isSelected = params.oid === actionOid && params.state === state

  return (
    <div
      className={cn(
        'flex items-center gap-1.5 pl-9 pr-2 py-0.5 cursor-pointer hover:bg-muted/50 text-xs',
        isSelected && 'bg-primary/10 border-l-2 border-primary'
      )}
      onClick={() => void navigate(`/actions/${actionOid}/code/${state}`)}
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
