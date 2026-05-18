import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'

export function useEnvironments() {
  return useQuery({
    queryKey: ['environments'],
    queryFn: () => api.environments(),
  })
}

export function useEnvironmentDetail(oid: string | null) {
  return useQuery({
    queryKey: ['environments', oid],
    queryFn: () => api.environment(oid!),
    enabled: !!oid,
  })
}

export function useAction(oid: string | null) {
  return useQuery({
    queryKey: ['actions', oid],
    queryFn: () => api.action(oid!),
    enabled: !!oid,
  })
}

export function useCodeVersions(actionOid: string | null, state: string | null) {
  return useQuery({
    queryKey: ['code', actionOid, state],
    queryFn: () => api.codeVersions(actionOid!, state!),
    enabled: !!actionOid && !!state,
  })
}

export function useActiveCode(actionOid: string | null, state: string | null) {
  return useQuery({
    queryKey: ['code', actionOid, state, 'active'],
    queryFn: () => api.activeCode(actionOid!, state!),
    enabled: !!actionOid && !!state,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  })
}

export function useSaveCode() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      actionOid,
      state,
      code,
      description,
    }: {
      actionOid: string
      state: string
      code: string
      description?: string
    }) => api.saveCode(actionOid, state, code, description),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({
        queryKey: ['code', variables.actionOid, variables.state],
      })
      void queryClient.invalidateQueries({ queryKey: ['explorer-tree'] })
      void queryClient.invalidateQueries({ queryKey: ['environments'] })
      void queryClient.invalidateQueries({ queryKey: ['actions', variables.actionOid] })
    },
  })
}

export function useActivateVersion() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      actionOid,
      state,
      versionId,
    }: {
      actionOid: string
      state: string
      versionId: string
    }) => api.activateVersion(actionOid, state, versionId),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({
        queryKey: ['code', variables.actionOid, variables.state],
      })
      void queryClient.invalidateQueries({ queryKey: ['explorer-tree'] })
      void queryClient.invalidateQueries({ queryKey: ['environments'] })
      void queryClient.invalidateQueries({ queryKey: ['actions', variables.actionOid] })
    },
  })
}

export function useDeleteVersion() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      actionOid,
      state,
      versionId,
    }: {
      actionOid: string
      state: string
      versionId: string
    }) => api.deleteVersion(actionOid, state, versionId),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({
        queryKey: ['code', variables.actionOid, variables.state],
      })
      void queryClient.invalidateQueries({ queryKey: ['explorer-tree'] })
      void queryClient.invalidateQueries({ queryKey: ['environments'] })
      void queryClient.invalidateQueries({ queryKey: ['actions', variables.actionOid] })
    },
  })
}

export function useTestCode() {
  return useMutation({
    mutationFn: ({
      actionOid,
      state,
      code,
      inputs,
    }: {
      actionOid: string
      state: string
      code: string
      inputs: Record<string, string>
    }) => api.testCode(actionOid, state, code, inputs),
  })
}
