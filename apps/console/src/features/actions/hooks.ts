import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'

export function useAction(oid: string) {
  return useQuery({
    queryKey: ['actions', oid],
    queryFn: () => api.action(oid),
    enabled: !!oid,
  })
}

export function useUpdateActionTimeout() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ oid, timeout_seconds }: { oid: string; timeout_seconds: number | null }) =>
      api.updateActionTimeout(oid, timeout_seconds),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['actions', variables.oid] })
    },
  })
}

export function useClearCode() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ actionOid, state }: { actionOid: string; state: string }) =>
      api.clearCode(actionOid, state),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({
        queryKey: ['code', variables.actionOid, variables.state],
      })
      void queryClient.invalidateQueries({
        queryKey: ['code', variables.actionOid, variables.state, 'active'],
      })
      void queryClient.invalidateQueries({ queryKey: ['explorer-tree'] })
      void queryClient.invalidateQueries({ queryKey: ['environments'] })
      void queryClient.invalidateQueries({ queryKey: ['actions', variables.actionOid] })
    },
  })
}
