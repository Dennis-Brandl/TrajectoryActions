import StateButton from './StateButton'

interface DiagramProps {
  statesWithCode: Set<string>
  selectedState: string | null
  onSelectState: (state: string) => void
}

const TERMINAL = new Set(['COMPLETED'])

export default function OpaqueDiagram({
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

  const arrowR = <span className="text-gray-400 text-xs leading-none px-0.5">&rarr;</span>

  return (
    <div className="space-y-1 py-2">
      {/* Row 0: Main flow */}
      <div className="flex items-center gap-0.5 justify-center">
        {btn('POSTED')}
        {arrowR}
        {btn('RECEIVED')}
        {arrowR}
        {btn('IN_PROGRESS')}
      </div>

      {/* Vertical arrows */}
      <div className="flex justify-center">
        <span className="text-gray-400 text-xs">&darr;</span>
      </div>

      {/* Row 1: Terminal + error paths */}
      <div className="flex items-center gap-0.5 justify-center">
        {btn('ABORTING')}
        <span className="flex-1" />
        {btn('STOPPING')}
        {arrowR}
        {btn('COMPLETED')}
      </div>
    </div>
  )
}
