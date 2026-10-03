const STEPS = ['Capture', 'Rectify', 'Segment', 'Measure', 'Frame', 'Export', 'Order']

interface StepProgressProps {
  current: number // 1-indexed
}

export default function StepProgress({ current }: StepProgressProps) {
  return (
    <div className="px-5 pt-3 pb-4">
      <div className="flex items-center gap-1">
        {STEPS.map((label, i) => {
          const step = i + 1
          const done = step < current
          const active = step === current
          return (
            <div key={label} className="flex items-center gap-1 flex-1 min-w-0">
              <div className="flex flex-col items-center gap-1 flex-1 min-w-0">
                <div
                  className={`h-1 w-full rounded-full transition-all ${
                    done ? 'bg-zinc-900' : active ? 'bg-zinc-900' : 'bg-zinc-200'
                  }`}
                />
                <span
                  className={`text-[10px] font-medium truncate ${
                    active ? 'text-zinc-900' : done ? 'text-zinc-400' : 'text-zinc-300'
                  }`}
                >
                  {label}
                </span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
