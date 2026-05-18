import { useState, useRef } from 'react'
import { Button } from '@trajectory/ui'
import { api } from '@/lib/api'
import type { ImportCodeResult } from '@/lib/types'

interface ExportImportButtonsProps {
  actionOid: string
  onImportComplete: () => void
}

export function ExportImportButtons({ actionOid, onImportComplete }: ExportImportButtonsProps) {
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<ImportCodeResult | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  function handleExport() {
    window.location.href = api.exportActionCodeUrl(actionOid)
  }

  function handleImportClick() {
    fileInputRef.current?.click()
  }

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    setImporting(true)
    setImportResult(null)
    setImportError(null)

    try {
      const result = await api.importActionCode(actionOid, file)
      setImportResult(result)
      onImportComplete()
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Import failed')
    } finally {
      setImporting(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={handleExport}>
          Export Code
        </Button>
        <Button variant="outline" size="sm" onClick={handleImportClick} disabled={importing}>
          {importing ? 'Importing...' : 'Import Code'}
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".WFactionCode"
          className="hidden"
          onChange={handleFileSelected}
        />
      </div>

      {importResult && (
        <div className="rounded-md border border-green-200 bg-green-50 p-3 text-sm">
          <p className="font-medium text-green-800">Import successful</p>
          <p className="text-green-700">
            Imported: {importResult.imported_states.join(', ') || 'none'}
            {importResult.skipped_states.length > 0 &&
              ` | Skipped: ${importResult.skipped_states.join(', ')}`}
          </p>
        </div>
      )}

      {importError && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm">
          <p className="font-medium text-red-800">Import failed</p>
          <p className="text-red-700">{importError}</p>
        </div>
      )}
    </div>
  )
}
