import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@trajectory/ui'
import { Button } from '@trajectory/ui'
import { Input } from '@trajectory/ui'
import { Label } from '@trajectory/ui'
import { useSaveCode } from './hooks'

interface SaveDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  actionOid: string
  state: string
  code: string
  onSaved: () => void
}

export default function SaveDialog({
  open,
  onOpenChange,
  actionOid,
  state,
  code,
  onSaved,
}: SaveDialogProps) {
  const [description, setDescription] = useState('')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const saveMutation = useSaveCode()

  async function handleSave() {
    setErrorMsg(null)
    try {
      await saveMutation.mutateAsync({
        actionOid,
        state,
        code,
        description: description.trim() || undefined,
      })
      setDescription('')
      onOpenChange(false)
      onSaved()
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Save failed')
    }
  }

  function handleOpenChange(open: boolean) {
    if (!open) {
      setDescription('')
      setErrorMsg(null)
    }
    onOpenChange(open)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Save Version</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="save-description" className="text-sm">
              Description <span className="text-muted-foreground font-normal">(optional)</span>
            </Label>
            <Input
              id="save-description"
              placeholder="Describe this version..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !saveMutation.isPending) {
                  void handleSave()
                }
              }}
              autoFocus
            />
          </div>

          {errorMsg && <p className="text-sm text-destructive">{errorMsg}</p>}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleOpenChange(false)}
            disabled={saveMutation.isPending}
          >
            Cancel
          </Button>
          <Button size="sm" onClick={() => void handleSave()} disabled={saveMutation.isPending}>
            {saveMutation.isPending ? 'Saving...' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
