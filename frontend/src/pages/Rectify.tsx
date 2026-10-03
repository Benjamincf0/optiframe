import { useState } from 'react'
import { AlertTriangle, CheckCircle2, RotateCcw } from 'lucide-react'
import PageHeader from '../components/PageHeader'
import StepProgress from '../components/StepProgress'
import BottomBar from '../components/BottomBar'

type Eye = 'left' | 'right'

export default function Rectify() {
  const [activeEye, setActiveEye] = useState<Eye>('left')

  // Simulated state — feature not yet implemented
  const scale = { left: '42.3 px/mm', right: '42.1 px/mm' }
  const angleWarning = false

  return (
    <div className="page-container">
      <PageHeader title="Rectify" backTo="/capture" />
      <StepProgress current={2} />

      <div className="page-content">
        <p className="text-sm text-zinc-500 mb-5">
          We detect the reference object and correct the perspective so the lens is seen from directly above.
        </p>

        {/* Eye tabs */}
        <div className="flex gap-2 mb-5">
          {(['left', 'right'] as Eye[]).map(eye => (
            <button
              key={eye}
              onClick={() => setActiveEye(eye)}
              className={`flex-1 h-10 rounded-xl text-sm font-semibold transition-all ${
                activeEye === eye ? 'bg-zinc-900 text-white' : 'bg-zinc-100 text-zinc-500'
              }`}
            >
              {eye.charAt(0).toUpperCase() + eye.slice(1)}
            </button>
          ))}
        </div>

        {/* Before / After */}
        <div className="grid grid-cols-2 gap-3 mb-5">
          <div>
            <p className="section-label mb-2">Original</p>
            <div className="aspect-square bg-zinc-100 rounded-xl flex items-center justify-center border border-zinc-200">
              <p className="text-xs text-zinc-400 text-center px-3">Original<br />photo</p>
            </div>
          </div>
          <div>
            <p className="section-label mb-2">Rectified</p>
            <div className="aspect-square bg-zinc-100 rounded-xl flex items-center justify-center border border-zinc-200 relative">
              <p className="text-xs text-zinc-400 text-center px-3">Top-down<br />view</p>
              {/* Detected polygon outline placeholder */}
              <div className="absolute inset-3 border-2 border-dashed border-blue-400 rounded-lg opacity-60" />
            </div>
          </div>
        </div>

        {/* Scale readout */}
        <div className="card divide-y divide-zinc-100 mb-4">
          <div className="px-4 py-3.5 flex items-center justify-between">
            <span className="text-sm text-zinc-500">Scale ({activeEye})</span>
            <span className="text-sm font-semibold text-zinc-900 font-mono">
              {scale[activeEye]}
            </span>
          </div>
          <div className="px-4 py-3.5 flex items-center justify-between">
            <span className="text-sm text-zinc-500">Reference detected</span>
            <span className="flex items-center gap-1.5 text-xs font-semibold text-zinc-900">
              <CheckCircle2 size={14} /> Credit card
            </span>
          </div>
          <div className="px-4 py-3.5 flex items-center justify-between">
            <span className="text-sm text-zinc-500">Homography quality</span>
            <span className="text-xs font-semibold text-zinc-900">Good</span>
          </div>
        </div>

        {/* Angle warning (conditionally shown) */}
        {angleWarning && (
          <div className="px-4 py-3.5 bg-amber-50 border border-amber-200 rounded-xl flex gap-3 mb-4">
            <AlertTriangle size={16} className="text-amber-600 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-amber-700">
              Reference object appears at more than 45° — measurement accuracy may be reduced. Consider retaking the photo.
            </p>
          </div>
        )}

        {/* Error state placeholder */}
        <div className="px-4 py-3.5 bg-red-50 border border-red-200 rounded-xl hidden">
          <p className="text-xs font-semibold text-red-800">Reference not found</p>
          <p className="text-xs text-red-700 mt-0.5">
            Ensure the reference object is fully visible and unobstructed, then retake the photo.
          </p>
        </div>

        {/* Retake */}
        <button className="w-full h-11 rounded-xl border border-zinc-200 text-sm font-medium text-zinc-600 flex items-center justify-center gap-2 active:bg-zinc-50 transition-colors">
          <RotateCcw size={14} />
          Retake this photo
        </button>
      </div>

      <BottomBar label="Continue to Segment" to="/segment" />
    </div>
  )
}
