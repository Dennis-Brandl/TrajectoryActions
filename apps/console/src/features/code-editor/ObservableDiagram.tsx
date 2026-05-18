import StateButton from './StateButton'

interface DiagramProps {
  statesWithCode: Set<string>
  selectedState: string | null
  onSelectState: (state: string) => void
}

const TERMINAL = new Set(['COMPLETED', 'ABORTED'])

export default function ObservableDiagram({
  statesWithCode,
  selectedState,
  onSelectState,
}: DiagramProps) {
  function btn(name: string) {
    return (
      <StateButton
        name={name}
        hasCode={statesWithCode.has(name)}
        isSelected={selectedState === name}
        isTerminal={TERMINAL.has(name)}
        onClick={onSelectState}
      />
    )
  }

  // Arrow helpers
  const arrowR = <span className="text-gray-400 text-xs leading-none px-0.5">&rarr;</span>
  const arrowL = <span className="text-gray-400 text-xs leading-none px-0.5">&larr;</span>
  const arrowD = (
    <div className="flex justify-center">
      <span className="text-gray-400 text-xs leading-none">&darr;</span>
    </div>
  )

  return (
    <div className="space-y-1 py-2">
      {/* Row 0: Hold loop + Stopping */}
      <div className="flex items-center gap-0.5 justify-center">
        {btn('UNHOLDING')}
        {arrowL}
        {btn('HELD')}
        {arrowL}
        {btn('HOLDING')}
        <span className="flex-1" />
        {btn('STOPPING')}
      </div>

      {/* Vertical arrows connecting hold loop to main flow */}
      <div className="flex items-center px-1">
        <div className="flex-1" />
        <div className="w-[80px]" />
        <div className="px-0.5" />
        <div className="w-[80px]" />
        <div className="px-0.5" />
        <div className="w-[80px] flex justify-center">
          <span className="text-gray-400 text-xs">&darr;</span>
        </div>
      </div>

      {/* Row 1: Main flow */}
      <div className="flex items-center gap-0.5 justify-center">
        {btn('STARTING')}
        {arrowR}
        {btn('EXECUTING')}
        {arrowR}
        {btn('COMPLETING')}
        {arrowR}
        {btn('COMPLETED')}
      </div>

      {/* Vertical arrows connecting main flow to pause loop */}
      {arrowD}

      {/* Row 2: Pause loop */}
      <div className="flex items-center gap-0.5 justify-center">
        {btn('UNPAUSING')}
        {arrowL}
        {btn('PAUSED')}
        {arrowL}
        {btn('PAUSING')}
      </div>

      {/* Vertical arrow to abort */}
      {arrowD}

      {/* Row 3: Abort + Clear */}
      <div className="flex items-center gap-0.5 justify-center">
        {btn('ABORTING')}
        {arrowR}
        {btn('ABORTED')}
        <span className="flex-1" />
        {btn('CLEARING')}
      </div>
    </div>
  )
}
