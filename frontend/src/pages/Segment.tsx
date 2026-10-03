import { useState } from 'react'
import { RefreshCw, RotateCcw, SlidersHorizontal } from 'lucide-react'
import PageHeader from '../components/PageHeader'
import StepProgress from '../components/StepProgress'
import BottomBar from '../components/BottomBar'

type Eye = 'left' | 'right'
type Status = 'idle' | 'processing' | 'done' | 'error'

export default function Segment() {
  const [activeEye, setActiveEye] = useState<Eye>('left')
  const [status] = useState<Status>('done')

  return (
    <div className="page-container">
      <PageHeader title="Segment" backTo="/rectify" />
      <StepProgress current={3} />

      <div className="page-content">
        <p className="text-sm text-zinc-500 mb-5">
          The AI model traces the exact contour of each lens, handling transparency, reflections, and low contrast edges.
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

        {/* Contour preview */}
        <div className="mb-5">
          <p className="section-label mb-2">Contour overlay</p>
          <div className="aspect-square bg-zinc-100 rounded-2xl flex items-center justify-center border border-zinc-200 relative overflow-hidden">
            {status === 'processing' && (
              <div className="flex flex-col items-center gap-3">
                <div className="w-8 h-8 border-2 border-zinc-300 border-t-zinc-900 rounded-full animate-spin" />
                <p className="text-sm text-zinc-500">Running segmentation…</p>
              </div>
            )}

            {status === 'done' && (
              <>
                {/* Rectified image placeholder */}
                <div className="absolute inset-0 bg-zinc-100" />
                {/* Contour overlay */}
                <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none">
                  <ellipse
                    cx="50" cy="50" rx="34" ry="28"
                    fill="none"
                    stroke="#22c55e"
                    strokeWidth="0.8"
                    strokeDasharray="none"
                  />
                </svg>
                <p className="relative text-xs text-zinc-400">Rectified image + contour</p>
              </>
            )}

            {status === 'error' && (
              <div className="flex flex-col items-center gap-3 px-8 text-center">
                <p className="text-sm font-medium text-zinc-700">Lens not found</p>
                <p className="text-xs text-zinc-400">
                  Ensure the lens is on a plain background with no objects overlapping it.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Model info */}
        <div className="card divide-y divide-zinc-100 mb-4">
          <div className="px-4 py-3.5 flex items-center justify-between">
            <span className="text-sm text-zinc-500">Model</span>
            <span className="text-sm font-semibold text-zinc-900">SAM (ONNX, in-browser)</span>
          </div>
          <div className="px-4 py-3.5 flex items-center justify-between">
            <span className="text-sm text-zinc-500">Points in contour</span>
            <span className="text-sm font-semibold text-zinc-900 font-mono">—</span>
          </div>
          <div className="px-4 py-3.5 flex items-center justify-between">
            <span className="text-sm text-zinc-500">Confidence</span>
            <span className="text-sm font-semibold text-zinc-900">—</span>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-3 mb-4">
          <button className="flex-1 h-11 rounded-xl border border-zinc-200 text-sm font-medium text-zinc-600 flex items-center justify-center gap-2 active:bg-zinc-50 transition-colors">
            <RefreshCw size={14} />
            Re-run
          </button>
          <button className="flex-1 h-11 rounded-xl border border-zinc-200 text-sm font-medium text-zinc-600 flex items-center justify-center gap-2 active:bg-zinc-50 transition-colors">
            <SlidersHorizontal size={14} />
            Adjust manually
          </button>
        </div>

        <button className="w-full h-11 rounded-xl border border-zinc-200 text-sm font-medium text-zinc-600 flex items-center justify-center gap-2 active:bg-zinc-50 transition-colors">
          <RotateCcw size={14} />
          Retake photo
        </button>
      </div>

      <BottomBar label="Continue to Measure" to="/measure" />
    </div>
  )
}
