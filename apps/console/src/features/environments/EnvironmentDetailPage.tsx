import { useMemo } from 'react'
import { useParams, Link } from 'react-router'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useEnvironment } from './hooks'
import { formatTimestamp } from '@/lib/utils'
import type { ActionSummaryInEnvironment } from '@/lib/types'
import { useRegisterRightPane } from '@/layout/RightPaneContext'

function VisibilityBadge({ visibility }: { visibility: 'observable' | 'opaque' }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${
        visibility === 'observable'
          ? 'bg-blue-50 text-blue-700 border-blue-200'
          : 'bg-gray-100 text-gray-600 border-gray-200'
      }`}
    >
      {visibility}
    </span>
  )
}

function CodeStatusBadge({ states }: { states: string[] }) {
  if (states.length === 0) {
    return <span className="text-xs text-muted-foreground">None</span>
  }
  return (
    <div className="flex flex-wrap gap-1">
      {states.map((s) => (
        <span
          key={s}
          className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium bg-green-100 text-green-700"
        >
          {s}
        </span>
      ))}
    </div>
  )
}

function ActionsTable({ actions }: { actions: ActionSummaryInEnvironment[] }) {
  if (actions.length === 0) {
    return (
      <p className="text-muted-foreground text-xs text-center py-3">
        No actions in this environment
      </p>
    )
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="h-7">Name</TableHead>
          <TableHead className="h-7">Visibility</TableHead>
          <TableHead className="h-7 text-center">Inputs</TableHead>
          <TableHead className="h-7 text-center">Outputs</TableHead>
          <TableHead className="h-7">Code Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {actions.map((action) => (
          <TableRow key={action.oid}>
            <TableCell className="py-1">
              <Link
                to={`/actions/${action.oid}`}
                className="text-xs font-medium hover:underline text-primary"
              >
                {action.local_id}
              </Link>
              <p className="font-mono text-xs text-muted-foreground mt-0.5">v{action.version}</p>
            </TableCell>
            <TableCell className="py-1 text-xs">
              <VisibilityBadge visibility={action.action_visibility} />
            </TableCell>
            <TableCell className="py-1 text-center text-xs text-muted-foreground">
              {action.input_param_count}
            </TableCell>
            <TableCell className="py-1 text-center text-xs text-muted-foreground">
              {action.output_param_count}
            </TableCell>
            <TableCell className="py-1 text-xs">
              <CodeStatusBadge states={action.states_with_code} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

export default function EnvironmentDetailPage() {
  const { oid } = useParams<{ oid: string }>()
  const { data, isLoading, isError, error } = useEnvironment(oid ?? '')

  const panePayload = useMemo(() => {
    if (!data) return null
    return {
      header: { eyebrow: 'ENVIRONMENT', name: `${data.local_id} v${data.version}` },
      content: (
        <>
          {data.action_property_specifications.length > 0 && (
            <Card className="py-2 gap-1">
              <CardHeader className="pb-0 px-3">
                <CardTitle className="text-sm">Action Properties</CardTitle>
              </CardHeader>
              <CardContent className="px-3">
                <div className="space-y-2">
                  {data.action_property_specifications.map((spec) => (
                    <div key={spec.name}>
                      <p className="font-medium text-xs mb-0.5">{spec.name}</p>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="h-7">Property</TableHead>
                            <TableHead className="h-7">Value</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {spec.entries.map((entry) => (
                            <TableRow key={entry.name}>
                              <TableCell className="font-medium text-xs py-1">
                                {entry.name}
                              </TableCell>
                              <TableCell className="text-xs text-muted-foreground py-1">
                                {entry.value}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          <Card className="py-2 gap-1">
            <CardHeader className="pb-0 px-3">
              <CardTitle className="text-sm">
                Actions{' '}
                <span className="text-muted-foreground font-normal text-sm">
                  ({data.actions.length})
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="px-3">
              <ActionsTable actions={data.actions} />
            </CardContent>
          </Card>
        </>
      ),
    }
  }, [data])

  useRegisterRightPane(panePayload)

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Link to="/environments" className="text-primary hover:underline text-sm">
            &larr; Environments
          </Link>
        </div>
        <div className="space-y-2">
          <div className="h-7 bg-muted rounded animate-pulse w-48" />
          <div className="h-4 bg-muted rounded animate-pulse w-64" />
        </div>
      </div>
    )
  }

  if (isError || !data) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Link to="/environments" className="text-primary hover:underline text-sm">
            &larr; Environments
          </Link>
        </div>
        <Card className="border-destructive">
          <CardContent className="pt-6">
            <p className="text-destructive font-medium">Failed to load environment</p>
            <p className="text-muted-foreground text-sm mt-1">
              {error instanceof Error ? error.message : 'Environment not found'}
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  const { local_id, version, description, imported_at, last_modified_date } = data

  return (
    <div className="space-y-6">
      <Link to="/environments" className="text-primary hover:underline text-sm">
        &larr; Environments
      </Link>

      <div className="space-y-1">
        <div className="flex items-baseline gap-3">
          <h2 className="text-2xl font-bold text-foreground">{local_id}</h2>
          <span className="text-sm text-muted-foreground font-medium bg-muted px-2 py-0.5 rounded">
            v{version}
          </span>
        </div>
        {description && <p className="text-muted-foreground">{description}</p>}
        <p className="font-mono text-xs text-muted-foreground" title={data.oid}>
          OID: {data.oid}
        </p>
        <div className="flex flex-wrap gap-4 text-xs text-muted-foreground pt-1">
          <span>Imported: {formatTimestamp(imported_at)}</span>
          {last_modified_date && <span>Last modified: {formatTimestamp(last_modified_date)}</span>}
        </div>
      </div>
    </div>
  )
}
