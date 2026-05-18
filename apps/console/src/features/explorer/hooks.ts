import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { ActionSummaryInEnvironment } from '@/lib/types'

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
