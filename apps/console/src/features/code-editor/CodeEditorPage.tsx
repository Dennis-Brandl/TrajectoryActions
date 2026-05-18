import { useState, useEffect, useCallback } from 'react'
import { useSearchParams } from 'react-router'
import Editor from '@monaco-editor/react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@trajectory/ui'
import { Button } from '@trajectory/ui'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useEnvironments, useEnvironmentDetail, useAction, useActiveCode } from './hooks'
import SaveDialog from './SaveDialog'
import VersionHistory from './VersionHistory'
import TestPanel from './TestPanel'
import { api } from '@/lib/api'
import ObservableDiagram from './ObservableDiagram'
import OpaqueDiagram from './OpaqueDiagram'
import { generateTemplate } from './templates'

export default function CodeEditorPage() {
  const [searchParams, setSearchParams] = useSearchParams()

  // Selections
  const [selectedEnvOid, setSelectedEnvOid] = useState<string | null>(searchParams.get('env'))
  const [selectedActionOid, setSelectedActionOid] = useState<string | null>(
    searchParams.get('action')
  )
  const [selectedState, setSelectedState] = useState<string | null>(searchParams.get('state'))

  // Editor state
  const [editorCode, setEditorCode] = useState<string>('')
  const [viewingVersionId, setViewingVersionId] = useState<string | null>(null)
  const [isDirty, setIsDirty] = useState(false)
  const [showTestPanel, setShowTestPanel] = useState(false)
  const [showSaveDialog, setShowSaveDialog] = useState(false)

  // Queries
  const { data: envsData } = useEnvironments()
  const { data: envDetail } = useEnvironmentDetail(selectedEnvOid)
  const { data: actionData } = useAction(selectedActionOid)
  const {
    data: activeCode,
    isError: activeCodeError,
    isSuccess: activeCodeSuccess,
  } = useActiveCode(selectedActionOid, selectedState)

  // Sync URL params when selections change
  useEffect(() => {
    const params: Record<string, string> = {}
    if (selectedEnvOid) params['env'] = selectedEnvOid
    if (selectedActionOid) params['action'] = selectedActionOid
    if (selectedState) params['state'] = selectedState
    setSearchParams(params, { replace: true })
  }, [selectedEnvOid, selectedActionOid, selectedState, setSearchParams])

  // Load active code when query succeeds (only when not viewing a historical version)
  // viewingVersionId intentionally excluded — we don't want to reload when user is reading old code
  useEffect(() => {
    if (activeCodeSuccess && activeCode && viewingVersionId === null) {
      setEditorCode(activeCode.source_code)
      setIsDirty(false)
    }
  }, [activeCodeSuccess, activeCode, viewingVersionId])

  // Generate template when no active code exists (404)
  useEffect(() => {
    if (activeCodeError && selectedActionOid && selectedState) {
      const actionName = actionData?.local_id ?? selectedActionOid
      const template = generateTemplate(actionName, selectedState, actionData)
      setEditorCode(template)
      setIsDirty(true)
      setViewingVersionId(null)
    }
  }, [activeCodeError, selectedActionOid, selectedState, actionData])

  // Derive which states have code (for diagram highlighting)
  const statesWithCode = new Set(actionData?.code_summary?.states_with_code ?? [])

  // Handlers
  function handleEnvChange(oid: string) {
    setSelectedEnvOid(oid)
    setSelectedActionOid(null)
    setSelectedState(null)
    setEditorCode('')
    setIsDirty(false)
    setViewingVersionId(null)
  }

  function handleActionChange(oid: string) {
    setSelectedActionOid(oid)
    setSelectedState(null)
    setEditorCode('')
    setIsDirty(false)
    setViewingVersionId(null)
  }

  function handleStateChange(state: string) {
    setSelectedState(state)
    setEditorCode('')
    setIsDirty(false)
    setViewingVersionId(null)
  }

  // When user selects a version from the history panel
  const handleSelectVersion = useCallback(
    async (versionId: string) => {
      if (!selectedActionOid || !selectedState) return

      // If it's the active version, go back to editing mode
      if (versionId === activeCode?.id) {
        setViewingVersionId(null)
        if (activeCode) {
          setEditorCode(activeCode.source_code)
          setIsDirty(false)
        }
        return
      }

      // Otherwise load the historical version read-only
      try {
        const version = await api.codeVersion(selectedActionOid, selectedState, versionId)
        setEditorCode(version.source_code)
        setViewingVersionId(versionId)
        setIsDirty(false)
      } catch {
        // Silently fail — version fetch errors are rare
      }
    },
    [selectedActionOid, selectedState, activeCode]
  )

  function handleEditThisVersion() {
    // Copy the historical code into edit mode (user can save as new version)
    setViewingVersionId(null)
    setIsDirty(true)
  }

  function handleBackToActive() {
    setViewingVersionId(null)
    if (activeCode) {
      setEditorCode(activeCode.source_code)
      setIsDirty(false)
    } else {
      setEditorCode('')
      setIsDirty(false)
    }
  }

  const isReadOnly = viewingVersionId !== null
  const canSave = !isReadOnly && editorCode.length > 0

  return (
    <div className="flex gap-4 h-[calc(100vh-8rem)]">
      {/* Left panel */}
      <div className="w-[450px] shrink-0 flex flex-col gap-3 overflow-y-auto pb-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Code Editor</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* Environment selector */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Environment</label>
              <Select value={selectedEnvOid ?? ''} onValueChange={handleEnvChange}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Select environment" />
                </SelectTrigger>
                <SelectContent>
                  {(envsData?.environments ?? []).map((env) => (
                    <SelectItem key={env.oid} value={env.oid} className="text-xs">
                      {env.local_id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Action selector */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Action</label>
              <Select
                value={selectedActionOid ?? ''}
                onValueChange={handleActionChange}
                disabled={!selectedEnvOid}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder={selectedEnvOid ? 'Select action' : '—'} />
                </SelectTrigger>
                <SelectContent>
                  {(envDetail?.actions ?? []).map((action) => (
                    <SelectItem key={action.oid} value={action.oid} className="text-xs">
                      {action.local_id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Timeout badge (read-only) */}
            {actionData && (
              <div className="text-xs text-muted-foreground">
                Timeout:{' '}
                {actionData.timeout_seconds === null
                  ? 'global default'
                  : actionData.timeout_seconds === 0
                    ? 'disabled'
                    : `${actionData.timeout_seconds}s (custom)`}
              </div>
            )}

            {/* Visual state diagram — replaces dropdown */}
            {selectedActionOid && actionData && (
              <div className="border rounded-md p-1 bg-muted/20">
                {actionData.action_visibility === 'opaque' ? (
                  <OpaqueDiagram
                    statesWithCode={statesWithCode}
                    selectedState={selectedState}
                    onSelectState={handleStateChange}
                  />
                ) : (
                  <ObservableDiagram
                    statesWithCode={statesWithCode}
                    selectedState={selectedState}
                    onSelectState={handleStateChange}
                  />
                )}
              </div>
            )}

            {/* Action buttons */}
            {selectedActionOid && selectedState && (
              <div className="flex flex-col gap-2 pt-1">
                <Button
                  size="sm"
                  className="w-full h-8 text-xs"
                  onClick={() => setShowSaveDialog(true)}
                  disabled={!canSave}
                >
                  Save Version
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full h-8 text-xs"
                  onClick={() => setShowTestPanel((v) => !v)}
                >
                  {showTestPanel ? 'Hide Test' : 'Test Code'}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Version history */}
        {selectedActionOid && selectedState && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Version History
              </CardTitle>
            </CardHeader>
            <CardContent className="px-3 pb-3 pt-0">
              <VersionHistory
                actionOid={selectedActionOid}
                state={selectedState}
                activeVersionId={viewingVersionId}
                onSelectVersion={(id) => void handleSelectVersion(id)}
              />
            </CardContent>
          </Card>
        )}
      </div>

      {/* Main editor area */}
      <div className="flex-1 flex flex-col gap-0 min-w-0">
        {/* Status bar */}
        {(isDirty || viewingVersionId) && (
          <div className="flex items-center gap-3 px-3 py-1.5 rounded-t bg-muted text-xs border border-border border-b-0">
            {viewingVersionId ? (
              <>
                <span className="text-yellow-600 font-medium">Viewing old version (read-only)</span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 text-xs px-2"
                  onClick={handleEditThisVersion}
                >
                  Edit this version
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 text-xs px-2"
                  onClick={handleBackToActive}
                >
                  Back to active
                </Button>
              </>
            ) : (
              <span className="text-orange-600 font-medium">Unsaved changes</span>
            )}
          </div>
        )}

        {/* Monaco editor */}
        <div
          className={`border border-border overflow-hidden ${showTestPanel ? '' : 'flex-1'} ${isDirty || viewingVersionId ? 'rounded-b' : 'rounded'}`}
          style={showTestPanel ? { height: '55%' } : { flex: 1 }}
        >
          {selectedActionOid && selectedState ? (
            <Editor
              height="100%"
              language="python"
              value={editorCode}
              onChange={(v) => {
                if (!isReadOnly) {
                  setEditorCode(v ?? '')
                  setIsDirty(true)
                }
              }}
              theme="vs-dark"
              options={{
                minimap: { enabled: false },
                fontSize: 14,
                tabSize: 4,
                wordWrap: 'on',
                automaticLayout: true,
                readOnly: isReadOnly,
                scrollBeyondLastLine: false,
              }}
            />
          ) : (
            <div className="h-full flex items-center justify-center bg-[#1e1e1e] min-h-[400px]">
              <p className="text-sm text-gray-500">
                Select an environment, action, and state to start editing
              </p>
            </div>
          )}
        </div>

        {/* Test panel */}
        {showTestPanel && selectedActionOid && selectedState && (
          <div className="flex-1 overflow-y-auto mt-3">
            <TestPanel
              actionOid={selectedActionOid}
              state={selectedState}
              code={editorCode}
              inputParameters={actionData?.input_parameter_specifications ?? []}
              outputParameters={actionData?.output_parameter_specifications ?? []}
            />
          </div>
        )}
      </div>

      {/* Save dialog */}
      {selectedActionOid && selectedState && (
        <SaveDialog
          open={showSaveDialog}
          onOpenChange={setShowSaveDialog}
          actionOid={selectedActionOid}
          state={selectedState}
          code={editorCode}
          onSaved={() => {
            setIsDirty(false)
          }}
        />
      )}
    </div>
  )
}
