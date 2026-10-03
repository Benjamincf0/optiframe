import { useNavigate } from 'react-router-dom'

interface BottomBarProps {
  label: string
  to?: string
  onClick?: () => void
  disabled?: boolean
  secondary?: {
    label: string
    to?: string
    onClick?: () => void
  }
}

export default function BottomBar({ label, to, onClick, disabled, secondary }: BottomBarProps) {
  const navigate = useNavigate()

  const handlePrimary = () => {
    if (disabled) return
    if (onClick) onClick()
    else if (to) navigate(to)
  }

  const handleSecondary = () => {
    if (secondary?.onClick) secondary.onClick()
    else if (secondary?.to) navigate(secondary.to)
  }

  return (
    <div className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[430px] bg-white border-t border-zinc-100 px-5 py-4 pb-8 flex flex-col gap-2">
      <button
        onClick={handlePrimary}
        disabled={disabled}
        className={`w-full h-14 rounded-2xl text-base font-semibold transition-all ${
          disabled
            ? 'bg-zinc-100 text-zinc-400 cursor-not-allowed'
            : 'bg-zinc-900 text-white active:scale-[0.98] active:bg-zinc-800'
        }`}
      >
        {label}
      </button>
      {secondary && (
        <button
          onClick={handleSecondary}
          className="w-full h-11 rounded-2xl text-sm font-medium text-zinc-500 active:bg-zinc-50 transition-colors"
        >
          {secondary.label}
        </button>
      )}
    </div>
  )
}
