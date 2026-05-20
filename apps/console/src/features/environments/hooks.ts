import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useCallback, useState } from 'react'
import { api } from '@/lib/api'
import { triggerDownload } from '@/lib/download'

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

export function useExportEnvironment(oid: string, localId: string) {
  const [isPending, setIsPending] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const run = useCallback(async () => {
    setIsPending(true)
    setError(null)
    try {
      const blob = await api.exportEnvironmentBundle(oid)
      triggerDownload(blob, `${localId}.WFenvirBundleX`)
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err))
      setError(e)
      throw e
    } finally {
      setIsPending(false)
    }
  }, [oid, localId])

  return { run, isPending, error }
}

export function useExportEnvironmentEnvirX(oid: string, localId: string) {
  const [isPending, setIsPending] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const run = useCallback(async () => {
    setIsPending(true)
    setError(null)
    try {
      const blob = await api.exportEnvironmentEnvirX(oid)
      triggerDownload(blob, `${localId}.WFenvirX`)
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err))
      setError(e)
      throw e
    } finally {
      setIsPending(false)
    }
  }, [oid, localId])

  return { run, isPending, error }
}

export function useGenerateEnvironmentReport(oid: string, localId: string) {
  const [isPending, setIsPending] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const run = useCallback(async () => {
    setIsPending(true)
    setError(null)
    try {
      const blob = await api.exportEnvironmentBundle(oid)

      // Lazy-load the heavy modules
      const [{ parseEnvirBundle }, { generateEnvironmentReportPDF }] = await Promise.all([
        import('@/lib/envir-bundle'),
        import('@/lib/pdf/environment-report'),
      ])

      const bundle = await parseEnvirBundle(blob)
      const pdfBlob = generateEnvironmentReportPDF(bundle)
      triggerDownload(pdfBlob, `${localId}-report.pdf`)
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)))
      throw err
    } finally {
      setIsPending(false)
    }
  }, [oid, localId])

  return { run, isPending, error }
}
