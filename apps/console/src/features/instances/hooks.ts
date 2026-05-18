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
