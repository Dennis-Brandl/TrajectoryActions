import { cn } from '@trajectory/ui'

interface StateButtonProps {
  name: string
  hasCode: boolean
  isSelected: boolean
  isTerminal?: boolean
  onClick: (name: string) => void
}

export default function StateButton({
  name,
  hasCode,
  isSelected,
  isTerminal = false,
  onClick,
}: StateButtonProps) {
  return (
    <button
      type="button"
      onClick={() => onClick(name)}
      className={cn(
        'rounded-lg border px-2 py-1.5 text-[10px] font-medium leading-none transition-all',
        'min-w-[80px] text-center cursor-pointer',
        // Color fill based on code status
        hasCode
          ? 'bg-sky-200 border-sky-400 text-sky-900 hover:bg-sky-300'
          : 'bg-gray-100 border-gray-300 text-gray-600 hover:bg-gray-200',
        // Selected ring
        isSelected && 'ring-2 ring-primary ring-offset-1',
        // Terminal dimming
        isTerminal && !isSelected && 'opacity-60'
      )}
    >
      {name}
    </button>
  )
}
