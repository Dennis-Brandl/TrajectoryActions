import { useEffect, useState } from 'react'
import { Button } from '@trajectory/ui'

interface WelcomeSplashProps {
  onContinue: () => void
  /** Auto-dismiss timeout in seconds. Default 5. */
  timeoutSeconds?: number
}

export function WelcomeSplash({ onContinue, timeoutSeconds = 5 }: WelcomeSplashProps) {
  const [seconds, setSeconds] = useState(timeoutSeconds)

  useEffect(() => {
    if (seconds <= 0) {
      onContinue()
      return
    }
    const t = setTimeout(() => setSeconds((s) => s - 1), 1000)
    return () => clearTimeout(t)
  }, [seconds, onContinue])

  return (
    <div className="fixed inset-0 min-h-screen flex items-center justify-center p-6 bg-gradient-to-br from-slate-900 via-slate-950 to-black">
      <div className="w-full max-w-xl rounded-2xl border border-amber-500/20 bg-slate-900/85 p-8 text-center shadow-2xl">
        <img
          src="/TrajectorActionContainerSplashScreen.png"
          alt="Trajectory Workflow Action Container"
          className="mx-auto block w-full max-w-sm rounded-lg"
        />
        <div className="mt-6 space-y-3 text-sm leading-relaxed text-slate-300">
          <p>Execution system for Environment Actions, with code written in Python.</p>
          <p>
            Supports Opaque and Observable actions, with execution logs and Action Instance
            visibility.
          </p>
        </div>
        <div className="mt-7 flex flex-col items-center gap-2">
          <Button
            onClick={onContinue}
            className="bg-amber-400 px-7 py-2.5 font-semibold text-slate-900 hover:bg-amber-300"
          >
            Continue
          </Button>
          <p className="text-xs text-slate-500">
            Continuing automatically in {seconds} second{seconds === 1 ? '' : 's'}…
          </p>
        </div>
      </div>
    </div>
  )
}
