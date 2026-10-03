import { useState } from 'react'
import { Download, Camera, AlertTriangle } from 'lucide-react'
import PageHeader from '../components/PageHeader'
import StepProgress from '../components/StepProgress'
import BottomBar from '../components/BottomBar'

type Eye = 'left' | 'right'

function MetricCard({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div className="card px-4 py-4 flex flex-col gap-1">
      <p className="section-label">{label}</p>
      <div className="flex items-baseline gap-1">
        <span className="metric-value">{value}</span>
        <span className="metric-unit">{unit}</span>
      </div>
    </div>
  )
}

export default function Measure() {
  const [activeEye, setActiveEye] = useState<Eye>('left')

  const measurements = {
    left:  { A: '44.2', B: '36.8', perimeter: '127.4' },
    right: { A: '51.0', B: '38.1', perimeter: '145.2' },
  }

  const m = measurements[activeEye]

  // Flag if A or B differ > 5 mm
  const asymmetric =
    Math.abs(parseFloat(measurements.left.A) - parseFloat(measurements.right.A)) > 5 ||
    Math.abs(parseFloat(measurements.left.B) - parseFloat(measurements.right.B)) > 5

  return (
    <div className="page-container">
      <PageHeader title="Measure" backTo="/segment" />
      <StepProgress current={4} />

      <div className="page-content">
        <p className="text-sm text-zinc-500 mb-5">
          Dimensions computed from the segmented contour using the ISO 8624 boxing system.
        </p>

        {/* Asymmetry notice */}
        {asymmetric && (
          <div className="px-4 py-3.5 bg-blue-50 border border-blue-200 rounded-xl flex gap-3 mb-5">
            <AlertTriangle size={16} className="text-blue-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-semibold text-blue-800">Asymmetric pair</p>
              <p className="text-xs text-blue-700 mt-0.5">
                Left and right lenses differ by more than 5 mm — the frame will be generated to match each shape individually.
              </p>
            </div>
          </div>
        )}

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

        {/* Metrics */}
        <div className="grid grid-cols-2 gap-3 mb-3">
          <MetricCard label="Width (A)" value={m.A} unit="mm" />
          <MetricCard label="Height (B)" value={m.B} unit="mm" />
        </div>
        <div className="mb-5">
          <MetricCard label="Perimeter" value={m.perimeter} unit="mm" />
        </div>

        {/* Accuracy */}
        <div className="card px-4 py-3.5 flex items-center justify-between mb-5">
          <span className="text-sm text-zinc-500">Estimated accuracy</span>
          <span className="text-sm font-semibold text-zinc-900">± 0.5 mm</span>
        </div>

        {/* Contour preview with bounding box */}
        <div className="mb-5">
          <p className="section-label mb-2">Bounding box</p>
          <div className="aspect-square bg-zinc-100 rounded-2xl border border-zinc-200 flex items-center justify-center relative overflow-hidden">
            <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 100">
              {/* Lens contour */}
              <ellipse cx="50" cy="50" rx="34" ry="28" fill="none" stroke="#a1a1aa" strokeWidth="0.6" />
              {/* Bounding box */}
              <rect x="16" y="22" width="68" height="56" fill="none" stroke="#2563eb" strokeWidth="0.8" strokeDasharray="3 2" />
              {/* A dimension label */}
              <line x1="16" y1="84" x2="84" y2="84" stroke="#2563eb" strokeWidth="0.5" />
              <text x="50" y="90" textAnchor="middle" fontSize="5" fill="#2563eb" fontFamily="monospace">A = {m.A} mm</text>
              {/* B dimension label */}
              <line x1="90" y1="22" x2="90" y2="78" stroke="#2563eb" strokeWidth="0.5" />
              <text x="96" y="52" textAnchor="middle" fontSize="5" fill="#2563eb" transform="rotate(90 96 52)" fontFamily="monospace">B = {m.B} mm</text>
            </svg>
          </div>
        </div>

        {/* Export + repeatability */}
        <div className="flex gap-3 mb-4">
          <button className="flex-1 h-12 rounded-xl border border-zinc-200 text-sm font-medium text-zinc-700 flex items-center justify-center gap-2 active:bg-zinc-50 transition-colors">
            <Download size={14} />
            Export SVG (1:1)
          </button>
          <button className="flex-1 h-12 rounded-xl border border-zinc-200 text-sm font-medium text-zinc-700 flex items-center justify-center gap-2 active:bg-zinc-50 transition-colors">
            <Camera size={14} />
            Second shot
          </button>
        </div>

        {/* Side-by-side comparison (both lenses) */}
        <p className="section-label mb-2">Comparison</p>
        <div className="card divide-y divide-zinc-100 mb-4">
          {['A (width)', 'B (height)', 'Perimeter'].map((dim, i) => {
            const vals = [
              [measurements.left.A, measurements.right.A],
              [measurements.left.B, measurements.right.B],
              [measurements.left.perimeter, measurements.right.perimeter],
            ][i]
            return (
              <div key={dim} className="px-4 py-3.5 flex items-center justify-between">
                <span className="text-sm text-zinc-500">{dim}</span>
                <div className="flex items-center gap-4">
                  <span className="text-xs text-zinc-400">L <span className="text-zinc-900 font-mono font-semibold">{vals[0]}</span></span>
                  <span className="text-xs text-zinc-400">R <span className="text-zinc-900 font-mono font-semibold">{vals[1]}</span></span>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <BottomBar label="Continue to Frame Design" to="/frame" />
    </div>
  )
}
