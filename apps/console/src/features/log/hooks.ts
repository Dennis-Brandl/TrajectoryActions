import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { LogQueryParams } from '@/lib/types'

export function useLogEntries(params?: LogQueryParams) {
  return useQuery({
    queryKey: ['log', params],
    queryFn: () => api.logEntries(params),
  })
}

export function useLogEntry(id: number | null) {
  return useQuery({
    queryKey: ['log', id],
    queryFn: () => api.logEntry(id!),
    enabled: id !== null,
  })
}
