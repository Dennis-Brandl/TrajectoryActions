import { useState, useCallback } from 'react'
import { useDropzone } from 'react-dropzone'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@trajectory/ui'
import { useUploadPackage } from './hooks'
import type { UploadResult } from '@/lib/types'

interface UploadDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

type UploadState = 'idle' | 'drag-active' | 'uploading' | 'success' | 'error'

const ALLOWED_EXTENSIONS = ['.WFenvir', '.WFenvirX', '.WFaction']

function hasAllowedExtension(filename: string): boolean {
  return ALLOWED_EXTENSIONS.some((ext) => filename.endsWith(ext))
}

export default function UploadDialog({ open, onOpenChange }: UploadDialogProps) {
  const [uploadState, setUploadState] = useState<UploadState>('idle')
  const [result, setResult] = useState<UploadResult | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const uploadMutation = useUploadPackage()

  const onDrop = useCallback(
    async (acceptedFiles: File[]) => {
      const file = acceptedFiles[0]
      if (!file) return

      // Client-side extension validation
      if (!hasAllowedExtension(file.name)) {
        setErrorMessage(
          `Invalid file type: "${file.name}". Only .WFenvir, .WFenvirX, and .WFaction files are accepted.`
        )
        setUploadState('error')
        return
      }

      setUploadState('uploading')
      setErrorMessage(null)
      setResult(null)

      try {
        const uploadResult = await uploadMutation.mutateAsync(file)
        setResult(uploadResult)
        setUploadState('success')
      } catch (err) {
        setErrorMessage(err instanceof Error ? err.message : 'Upload failed')
        setUploadState('error')
      }
    },
    [uploadMutation]
  )

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    // Accept is a hint for OS file picker; we validate extension in onDrop.
    // .WFenvirX is bucketed under application/zip (it really is a ZIP) so Chromium
    // registers it as its own filter entry instead of folding it into the .WFenvir line.
    accept: {
      'application/octet-stream': ['.WFenvir', '.WFaction'],
      'application/zip': ['.WFenvirX'],
    },
    maxFiles: 1,
    disabled: uploadState === 'uploading',
  })

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      // Reset state on close
      setUploadState('idle')
      setResult(null)
      setErrorMessage(null)
    }
    onOpenChange(next)
  }

  const activeState: UploadState = isDragActive ? 'drag-active' : uploadState

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Upload Package</DialogTitle>
          <DialogDescription>
            Drop a .WFenvir, .WFenvirX, or .WFaction file to import it into the Trajectory Action
            Container.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Drop zone */}
          <div
            {...getRootProps()}
            className={[
              'border-2 border-dashed rounded-lg p-10 text-center cursor-pointer transition-colors',
              activeState === 'drag-active'
                ? 'border-primary bg-primary/5'
                : activeState === 'uploading'
                  ? 'border-muted bg-muted/30 cursor-not-allowed'
                  : activeState === 'success'
                    ? 'border-green-400 bg-green-50'
                    : activeState === 'error'
                      ? 'border-destructive bg-destructive/5'
                      : 'border-muted-foreground/30 hover:border-primary/50 hover:bg-primary/5',
            ].join(' ')}
          >
            <input {...getInputProps()} />

            {activeState === 'drag-active' && (
              <p className="text-primary font-medium">Release to upload...</p>
            )}

            {activeState === 'idle' && (
              <div className="space-y-2">
                <p className="text-muted-foreground font-medium">Drag &amp; drop a package here</p>
                <p className="text-muted-foreground text-sm">or click to select a file</p>
                <p className="text-xs text-muted-foreground/70 mt-2">
                  Supported: .WFenvir, .WFenvirX, .WFaction
                </p>
              </div>
            )}

            {activeState === 'uploading' && (
              <div className="space-y-2">
                <div className="h-6 w-6 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
                <p className="text-muted-foreground text-sm">Uploading...</p>
              </div>
            )}

            {activeState === 'success' && result && (
              <div className="space-y-3 text-left">
                <p className="text-green-700 font-medium text-center">Import successful</p>
                {result.imported.length > 0 && (
                  <ul className="text-sm space-y-1">
                    {result.imported.map((item) => (
                      <li key={item.oid} className="flex items-center gap-2">
                        <span
                          className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ${
                            item.status === 'created'
                              ? 'bg-green-100 text-green-700'
                              : 'bg-blue-100 text-blue-700'
                          }`}
                        >
                          {item.status}
                        </span>
                        <span className="text-foreground">
                          {item.type === 'environment'
                            ? `Environment: ${item.local_id} v${item.version}`
                            : `Action: ${item.local_id} v${item.version}`}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {result.errors.length > 0 && (
                  <ul className="text-sm space-y-1 mt-2">
                    {result.errors.map((e, i) => (
                      <li key={i} className="text-destructive text-xs">
                        {e.filename}: {e.error}
                      </li>
                    ))}
                  </ul>
                )}
                <button
                  onClick={() => {
                    setUploadState('idle')
                    setResult(null)
                  }}
                  className="text-xs text-primary underline mt-2"
                >
                  Upload another
                </button>
              </div>
            )}

            {activeState === 'error' && (
              <div className="space-y-2">
                <p className="text-destructive font-medium">Upload failed</p>
                {errorMessage && <p className="text-destructive/80 text-sm">{errorMessage}</p>}
                <button
                  onClick={() => {
                    setUploadState('idle')
                    setErrorMessage(null)
                  }}
                  className="text-xs text-primary underline mt-2"
                >
                  Try again
                </button>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
