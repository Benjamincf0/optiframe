import { useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'

interface PageHeaderProps {
  title: string
  backTo?: string
  right?: React.ReactNode
}

export default function PageHeader({ title, backTo, right }: PageHeaderProps) {
  const navigate = useNavigate()

  return (
    <div className="flex items-center justify-between px-5 pt-5 pb-2">
      <div className="flex items-center gap-3">
        {backTo && (
          <button
            onClick={() => navigate(backTo)}
            className="w-9 h-9 flex items-center justify-center rounded-full bg-zinc-100 active:bg-zinc-200 transition-colors"
          >
            <ArrowLeft size={18} className="text-zinc-700" />
          </button>
        )}
        <h1 className="text-xl font-bold text-zinc-900">{title}</h1>
      </div>
      {right && <div>{right}</div>}
    </div>
  )
}
