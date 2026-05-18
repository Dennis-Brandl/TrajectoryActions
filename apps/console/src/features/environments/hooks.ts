import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'

export function useEnvironments() {
  return useQuery({
    queryKey: ['environments'],
    queryFn: () => api.environments(),
  })
}

export function useEnvironment(oid: string) {
  return useQuery({
    queryKey: ['environments', oid],
    queryFn: () => api.environment(oid),
    enabled: !!oid,
  })
}

export function useUploadPackage() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (file: File) => api.upload([file]),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['environments'] })
    },
  })
}

export function useDeleteEnvironment() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (oid: string) => api.deleteEnvironment(oid),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['environments'] })
      void queryClient.invalidateQueries({ queryKey: ['explorer-tree'] })
    },
  })
}
