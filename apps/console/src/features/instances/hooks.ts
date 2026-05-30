import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { LogQueryParams } from '@/lib/types'

export function useActiveInstances() {
  return useQuery({
    queryKey: ['instances', 'active'],
    queryFn: () => api.activeInstances(),
    refetchInterval: 2000, // UI-13: 2-second auto-refresh
  })
}

export function useHistoryInstances(params?: LogQueryParams) {
  return useQuery({
    queryKey: ['instances', 'history', params],
    queryFn: () => api.historyInstances(params),
  })
}

export function useInstance(id: string) {
  return useQuery({
    queryKey: ['instances', id],
    queryFn: () => api.instance(id),
    refetchInterval: 2000, // UI-14: 2-second auto-refresh for live monitoring
    enabled: !!id,
  })
}

export function useInstanceCommand() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, command }: { id: string; command: string }) =>
      api.instanceCommand(id, command),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['instances'] })
    },
  })
}

/**
 * Force-delete an instance row. Used by the "Delete instance" button on the
 * instance detail page to clean up rows stuck in non-terminal states (e.g.
 * ABORTING) so the owning environment can be deleted. Invalidates the
 * `['instances']` and `['environments']` query trees so the active/history
 * lists and the env-detail action-instance counts both refresh.
 */
export function useDeleteInstance() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.deleteInstance(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['instances'] })
      void queryClient.invalidateQueries({ queryKey: ['environments'] })
    },
  })
}
