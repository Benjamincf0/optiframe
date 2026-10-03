import { Download, Share2, ChevronRight } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import PageHeader from '../components/PageHeader'
import StepProgress from '../components/StepProgress'

const RECAP_STEPS = [
  { label: 'Original photo', sub: 'Left + right lenses captured' },
  { label: 'Rectified', sub: 'Perspective corrected · 42.3 px/mm' },
  { label: 'Contour', sub: 'AI segmentation complete' },
  { label: 'Measurements', sub: 'L 44.2 × 36.8 mm · R 51.0 × 38.1 mm' },
  { label: 'Frame', sub: 'Bridge 18 mm · Rim offset 1.5 mm' },
]

export default function Export() {
  const navigate = useNavigate()

  return (
    <div className="page-container">
      <PageHeader title="Export" backTo="/frame" />
      <StepProgress current={6} />

      <div className="page-content">
        <p className="text-sm text-zinc-500 mb-5">
          Your frame is ready. Download the STL for printing or place an order.
        </p>

        {/* Primary download */}
        <div className="card p-5 mb-4">
          <div className="flex items-start justify-between mb-4">
            <div>
              <p className="text-base font-bold text-zinc-900">monture.stl</p>
              <p className="text-sm text-zinc-400 mt-0.5">Closed manifold mesh · ~4.2 g PETG</p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-zinc-100 flex items-center justify-center">
              <Download size={18} className="text-zinc-600" />
            </div>
          </div>
          <button className="w-full h-12 rounded-xl bg-zinc-900 text-white text-sm font-semibold flex items-center justify-center gap-2 active:scale-[0.98] transition-all">
            <Download size={15} />
            Download STL
          </button>
        </div>

        {/* Secondary exports */}
        <div className="card divide-y divide-zinc-100 mb-5">
          <button className="w-full px-4 py-3.5 flex items-center justify-between active:bg-zinc-50 transition-colors">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-zinc-100 flex items-center justify-center">
                <Download size={14} className="text-zinc-500" />
              </div>
              <div className="text-left">
                <p className="text-sm font-medium text-zinc-900">Left lens SVG (1:1)</p>
                <p className="text-xs text-zinc-400">For physical verification</p>
              </div>
            </div>
            <ChevronRight size={16} className="text-zinc-300" />
          </button>
          <button className="w-full px-4 py-3.5 flex items-center justify-between active:bg-zinc-50 transition-colors">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-zinc-100 flex items-center justify-center">
                <Download size={14} className="text-zinc-500" />
              </div>
              <div className="text-left">
                <p className="text-sm font-medium text-zinc-900">Right lens SVG (1:1)</p>
                <p className="text-xs text-zinc-400">For physical verification</p>
              </div>
            </div>
            <ChevronRight size={16} className="text-zinc-300" />
          </button>
          <button className="w-full px-4 py-3.5 flex items-center justify-between active:bg-zinc-50 transition-colors">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-zinc-100 flex items-center justify-center">
                <Share2 size={14} className="text-zinc-500" />
              </div>
              <div className="text-left">
                <p className="text-sm font-medium text-zinc-900">Share session</p>
                <p className="text-xs text-zinc-400">QR code + link with all parameters</p>
              </div>
            </div>
            <ChevronRight size={16} className="text-zinc-300" />
          </button>
        </div>

        {/* Step-by-step recap */}
        <p className="section-label mb-3">Summary</p>
        <div className="flex flex-col gap-1 mb-6">
          {RECAP_STEPS.map((step, i) => (
            <div key={step.label} className="flex items-start gap-3">
              <div className="flex flex-col items-center flex-shrink-0">
                <div className="w-6 h-6 rounded-full bg-zinc-900 flex items-center justify-center">
                  <span className="text-[10px] font-bold text-white">{i + 1}</span>
                </div>
                {i < RECAP_STEPS.length - 1 && <div className="w-px h-6 bg-zinc-200 mt-0.5" />}
              </div>
              <div className="pb-1 pt-0.5">
                <p className="text-sm font-semibold text-zinc-900">{step.label}</p>
                <p className="text-xs text-zinc-400 mt-0.5">{step.sub}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Order CTA */}
        <div className="card p-5 flex items-center justify-between">
          <div>
            <p className="text-base font-bold text-zinc-900">Get it printed</p>
            <p className="text-sm text-zinc-400 mt-0.5">Shipped to your door in PETG or PLA</p>
          </div>
          <button
            onClick={() => navigate('/order')}
            className="h-10 px-5 rounded-xl bg-zinc-900 text-white text-sm font-semibold active:scale-[0.98] transition-all"
          >
            Order
          </button>
        </div>
      </div>

      {/* No fixed BottomBar here — CTAs are inline */}
      <div className="pb-10" />
    </div>
  )
}
