import type {
  DashboardResponse,
  EnvironmentsResponse,
  EnvironmentSummary,
  EnvironmentDetail,
  DeleteEnvironmentResult,
  UploadResult,
  ActionDetail,
  CodeVersionsResponse,
  CodeVersion,
  SaveCodeResult,
  ActivateVersionResult,
  DeleteVersionResult,
  ClearCodeResult,
  CodeTestResult,
  ActiveInstancesResponse,
  ActiveInstance,
  HistoryInstancesResponse,
  HistoryInstance,
  InstanceDetail,
  LogEntriesResponse,
  LogEntry,
  LogEntryDetail,
  LogConfig,
  SettingsResponse,
  SettingItem,
  UpdateSettingResult,
  LogQueryParams,
  ImportCodeResult,
  ImportSnapshotResult,
} from './types'

const BASE = '/management/v1'

interface ApiEnvelope<T> {
  data: T
  meta: Record<string, unknown>
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, init)
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: { message: res.statusText } }))
    throw new Error(err?.error?.message ?? `HTTP ${res.status}`)
  }
  const json: ApiEnvelope<T> = await res.json()
  return json.data
}

async function apiFetchRaw<T>(path: string, init?: RequestInit): Promise<ApiEnvelope<T>> {
  const res = await fetch(`${BASE}${path}`, init)
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: { message: res.statusText } }))
    throw new Error(err?.error?.message ?? `HTTP ${res.status}`)
  }
  return res.json() as Promise<ApiEnvelope<T>>
}

export const api = {
  // ---- Dashboard ----
  dashboard: (): Promise<DashboardResponse> => apiFetch('/dashboard'),

  // ---- Upload ----
  upload: async (files: File[]): Promise<UploadResult> => {
    const formData = new FormData()
    for (const file of files) {
      formData.append('files', file)
    }
    // Do NOT set Content-Type — browser sets multipart boundary automatically
    const data = await apiFetch<{ imported: UploadResult['imported']; diff: unknown }>('/upload', {
      method: 'POST',
      body: formData,
    })
    return { imported: data.imported, errors: [] }
  },

  // ---- Environments ----
  environments: async (): Promise<EnvironmentsResponse> => {
    const data = await apiFetch<EnvironmentSummary[]>('/environments')
    return { environments: data }
  },

  environment: (oid: string): Promise<EnvironmentDetail> => apiFetch(`/environments/${oid}`),

  deleteEnvironment: (oid: string): Promise<DeleteEnvironmentResult> =>
    apiFetch(`/environments/${oid}`, { method: 'DELETE' }),

  // ---- Actions ----
  action: (oid: string): Promise<ActionDetail> => apiFetch(`/actions/${oid}`),

  updateActionTimeout: (oid: string, timeout_seconds: number | null) =>
    apiFetch<{ oid: string; timeout_seconds: number | null }>(`/actions/${oid}/timeout`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ timeout_seconds }),
    }),

  // ---- Code Versions ----
  codeVersions: (actionOid: string, state: string): Promise<CodeVersionsResponse> =>
    apiFetch(`/code/${actionOid}/${state}`),

  activeCode: (actionOid: string, state: string): Promise<CodeVersion> =>
    apiFetch(`/code/${actionOid}/${state}/active`),

  codeVersion: (actionOid: string, state: string, versionId: string): Promise<CodeVersion> =>
    apiFetch(`/code/${actionOid}/${state}/${versionId}`),

  saveCode: (
    actionOid: string,
    state: string,
    code: string,
    description?: string
  ): Promise<SaveCodeResult> =>
    apiFetch(`/code/${actionOid}/${state}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source_code: code, description }),
    }),

  activateVersion: (
    actionOid: string,
    state: string,
    versionId: string
  ): Promise<ActivateVersionResult> =>
    apiFetch(`/code/${actionOid}/${state}/${versionId}/activate`, { method: 'POST' }),

  deleteVersion: (
    actionOid: string,
    state: string,
    versionId: string
  ): Promise<DeleteVersionResult> =>
    apiFetch(`/code/${actionOid}/${state}/${versionId}`, { method: 'DELETE' }),

  clearCode: (actionOid: string, state: string): Promise<ClearCodeResult> =>
    apiFetch(`/code/${actionOid}/${state}`, { method: 'DELETE' }),

  testCode: (
    actionOid: string,
    state: string,
    code: string,
    inputs: Record<string, string>
  ): Promise<CodeTestResult> =>
    apiFetch(`/code/${actionOid}/${state}/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source_code: code, test_inputs: inputs }),
    }),

  // ---- Instances ----
  activeInstances: async (): Promise<ActiveInstancesResponse> => {
    const raw = await apiFetchRaw<ActiveInstance[]>('/instances/active')
    return { instances: raw.data, total_count: (raw.meta.total as number) ?? 0 }
  },

  historyInstances: async (params?: LogQueryParams): Promise<HistoryInstancesResponse> => {
    const query = params
      ? '?' + new URLSearchParams(params as Record<string, string>).toString()
      : ''
    const raw = await apiFetchRaw<HistoryInstance[]>(`/instances/history${query}`)
    return { instances: raw.data, total: (raw.meta.total as number) ?? 0 }
  },

  instance: (id: string): Promise<InstanceDetail> => apiFetch(`/instances/${id}`),

  instanceCommand: (id: string, command: string): Promise<void> =>
    apiFetch(`/instances/${id}/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command }),
    }),

  // ---- Execution Log ----
  logEntries: async (params?: LogQueryParams): Promise<LogEntriesResponse> => {
    const query = params
      ? '?' + new URLSearchParams(params as Record<string, string>).toString()
      : ''
    const raw = await apiFetchRaw<LogEntry[]>(`/log${query}`)
    const meta = raw.meta as {
      page?: number
      page_size?: number
      total_entries?: number
      total_pages?: number
      log_config?: LogConfig
    }
    return {
      entries: raw.data,
      pagination: {
        page: meta.page ?? 1,
        page_size: meta.page_size ?? 50,
        total_entries: meta.total_entries ?? 0,
        total_pages: meta.total_pages ?? 1,
      },
      log_config: meta.log_config ?? { max_entries: 0, current_entries: 0, oldest_entry_at: null },
    }
  },

  logEntry: (id: number): Promise<LogEntryDetail> => apiFetch(`/log/${id}`),

  // ---- Settings ----
  settings: async (): Promise<SettingsResponse> => {
    const data = await apiFetch<SettingItem[]>('/settings')
    return { settings: data }
  },

  updateSetting: (key: string, value: string): Promise<UpdateSettingResult> =>
    apiFetch(`/settings/${key}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value }),
    }),

  // ---- Export/Import ----
  exportActionCodeUrl: (oid: string): string => `${BASE}/actions/${oid}/export`,

  importActionCode: async (oid: string, file: File): Promise<ImportCodeResult> => {
    const formData = new FormData()
    formData.append('file', file)
    return apiFetch(`/actions/${oid}/import`, {
      method: 'POST',
      body: formData,
    })
  },

  exportSnapshotUrl: (): string => `${BASE}/snapshot/export`,

  importSnapshot: async (file: File): Promise<ImportSnapshotResult> => {
    const formData = new FormData()
    formData.append('file', file)
    return apiFetch(`/snapshot/import?confirm=true`, {
      method: 'POST',
      body: formData,
    })
  },
}
