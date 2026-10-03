import { useParams, useNavigate } from 'react-router-dom'
import { Download, X } from 'lucide-react'
import PageHeader from '../components/PageHeader'

const STATUS_STEPS = [
  { id: 'received', label: 'Received', description: 'We got your order and STL file.' },
  { id: 'printing', label: 'Printing', description: 'Your frame is being printed.' },
  { id: 'shipped', label: 'Shipped', description: 'On its way to you.' },
  { id: 'delivered', label: 'Delivered', description: 'Enjoy your frames.' },
]

// Simulated current status
const CURRENT = 'received'

export default function OrderStatus() {
  const { id } = useParams()
  const navigate = useNavigate()
  const currentIndex = STATUS_STEPS.findIndex(s => s.id === CURRENT)

  return (
    <div className="page-container">
      <PageHeader title="Order" backTo="/" />

      <div className="page-content pt-2">
        {/* Order ID */}
        <div className="mb-6">
          <p className="section-label mb-1">Order ID</p>
          <p className="text-xl font-bold font-mono text-zinc-900">{id}</p>
          <p className="text-xs text-zinc-400 mt-1">Confirmation sent to your email</p>
        </div>

        {/* Frame preview */}
        <div className="card p-4 flex items-center gap-4 mb-6">
          <div className="w-20 h-16 bg-zinc-100 rounded-xl flex items-center justify-center flex-shrink-0">
            <svg width="56" height="40" viewBox="0 0 200 90" fill="none">
              <ellipse cx="58" cy="45" rx="42" ry="35" stroke="#3f3f46" strokeWidth="4" />
              <ellipse cx="142" cy="45" rx="42" ry="35" stroke="#3f3f46" strokeWidth="4" />
              <line x1="100" y1="38" x2="100" y2="52" stroke="#3f3f46" strokeWidth="4" />
              <line x1="16" y1="45" x2="2" y2="45" stroke="#3f3f46" strokeWidth="4" strokeLinecap="round" />
              <line x1="184" y1="45" x2="198" y2="45" stroke="#3f3f46" strokeWidth="4" strokeLinecap="round" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-bold text-zinc-900">Custom OptiFrame</p>
            <p className="text-xs text-zinc-400 mt-0.5">PETG · Matte black</p>
            <p className="text-xs text-zinc-400">L 44.2×36.8 · R 51.0×38.1 mm</p>
          </div>
        </div>

        {/* Status tracker */}
        <p className="section-label mb-4">Status</p>
        <div className="flex flex-col gap-0 mb-6">
          {STATUS_STEPS.map((step, i) => {
            const done = i < currentIndex
            const active = i === currentIndex
            const upcoming = i > currentIndex

            return (
              <div key={step.id} className="flex items-start gap-4">
                {/* Timeline */}
                <div className="flex flex-col items-center">
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 transition-all ${
                      done
                        ? 'bg-zinc-900'
                        : active
                        ? 'bg-zinc-900 ring-4 ring-zinc-200'
                        : 'bg-zinc-200'
                    }`}
                  >
                    {done ? (
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                        <path d="M2 6l3 3 5-5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    ) : (
                      <div className={`w-2.5 h-2.5 rounded-full ${active ? 'bg-white' : 'bg-zinc-400'}`} />
                    )}
                  </div>
                  {i < STATUS_STEPS.length - 1 && (
                    <div className={`w-px h-10 mt-0.5 ${i < currentIndex ? 'bg-zinc-900' : 'bg-zinc-200'}`} />
                  )}
                </div>

                {/* Text */}
                <div className="pt-1 pb-8">
                  <p className={`text-sm font-semibold ${upcoming ? 'text-zinc-400' : 'text-zinc-900'}`}>
                    {step.label}
                    {active && (
                      <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full bg-zinc-900 text-white text-[10px] font-semibold">
                        Now
                      </span>
                    )}
                  </p>
                  <p className={`text-xs mt-0.5 ${upcoming ? 'text-zinc-300' : 'text-zinc-500'}`}>
                    {step.description}
                  </p>
                </div>
              </div>
            )
          })}
        </div>

        {/* Estimated delivery */}
        <div className="card px-4 py-3.5 flex items-center justify-between mb-5">
          <span className="text-sm text-zinc-500">Estimated delivery</span>
          <span className="text-sm font-semibold text-zinc-900">Oct 10 – 14</span>
        </div>

        {/* Download STL again */}
        <button className="w-full h-12 rounded-xl border border-zinc-200 text-sm font-medium text-zinc-700 flex items-center justify-center gap-2 mb-3 active:bg-zinc-50 transition-colors">
          <Download size={15} />
          Re-download STL
        </button>

        {/* Cancel — only in Received status */}
        {CURRENT === 'received' && (
          <button className="w-full h-12 rounded-xl border border-red-200 text-sm font-medium text-red-600 flex items-center justify-center gap-2 mb-6 active:bg-red-50 transition-colors">
            <X size={15} />
            Cancel order
          </button>
        )}

        {/* Start again */}
        <button
          onClick={() => navigate('/')}
          className="w-full h-12 rounded-xl bg-zinc-900 text-white text-sm font-semibold active:scale-[0.98] transition-all"
        >
          Make another pair
        </button>
      </div>
    </div>
  )
}
