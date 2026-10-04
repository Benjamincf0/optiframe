import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Download, AlertTriangle, CheckCircle2, RotateCcw } from 'lucide-react'
import PageHeader from '../components/PageHeader'
import StepProgress from '../components/StepProgress'
import BottomBar from '../components/BottomBar'
import { useSession } from '../context/SessionContext'
import { exportContourSVG } from '../lib/svgExport'

type Eye = 'left' | 'right'

export default function Measurements() {
  const navigate = useNavigate()
  const { state } = useSession()
  const [activeEye, setActiveEye] = useState<Eye>('left')

  const m = state.measurements
  if (!m) {
    navigate('/capture')
    return null
  }

  const lens = m[activeEye]

  // Bounding box for drawing
  const contour = lens.contour_mm
  const xs = contour.map(p => p[0])
  const ys = contour.map(p => p[1])
  const minX = Math.min(...xs), maxX = Math.max(...xs)
  const minY = Math.min(...ys), maxY = Math.max(...ys)
  const pad = 4
  const vbW = (maxX - minX) + pad * 2
  const vbH = (maxY - minY) + pad * 2

  const svgPts = contour
    // Contour coordinates use y-up; SVG/image coordinates use y-down.
    .map(([x, y]) => `${x - minX + pad},${maxY - y + pad}`)
    .join(' ')

  return (
    <div className="page-container">
      <PageHeader title="Measurements" backTo="/capture" />
      <StepProgress current={2} />

      <div className="page-content">
        {/* Asymmetry notice */}
        {m.asymmetric && (
          <div className="px-4 py-3.5 bg-blue-50 border border-blue-200 rounded-xl flex gap-3 mb-4">
            <AlertTriangle size={15} className="text-blue-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-semibold text-blue-800">Asymmetric pair detected</p>
              <p className="text-xs text-blue-700 mt-0.5">
                Left and right lenses differ by more than 5 mm. The frame will fit each shape independently — this is not an error.
              </p>
            </div>
          </div>
        )}

        {/* Warnings */}
        {m.warnings.map((w, i) => (
          <div key={i} className="px-4 py-3.5 bg-amber-50 border border-amber-200 rounded-xl flex gap-3 mb-3">
            <AlertTriangle size={15} className="text-amber-600 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-amber-700">{w.message}</p>
          </div>
        ))}

        {/* Eye tabs */}
        <div className="flex gap-2 mb-5">
          {(['left', 'right'] as Eye[]).map(eye => (
            <button
              key={eye}
              onClick={() => setActiveEye(eye)}
              className={`flex-1 h-10 rounded-xl text-sm font-semibold transition-all flex items-center justify-center gap-1.5 ${
                activeEye === eye ? 'bg-zinc-900 text-white' : 'bg-zinc-100 text-zinc-500'
              }`}
            >
              <CheckCircle2 size={13} />
              {eye.charAt(0).toUpperCase() + eye.slice(1)}
            </button>
          ))}
        </div>

        {/* Metrics */}
        <div className="grid grid-cols-3 gap-2 mb-4">
          {[
            { label: 'Width (A)', value: lens.A, unit: 'mm' },
            { label: 'Height (B)', value: lens.B, unit: 'mm' },
            { label: 'Perimeter', value: lens.perimeter, unit: 'mm' },
          ].map(m => (
            <div key={m.label} className="card px-3 py-3.5">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-400 mb-1">{m.label}</p>
              <div className="flex items-baseline gap-0.5">
                <span className="text-2xl font-bold tracking-tight text-zinc-900">{m.value.toFixed(1)}</span>
                <span className="text-xs text-zinc-400">{m.unit}</span>
              </div>
            </div>
          ))}
        </div>

        {/* Accuracy */}
        <div className="card px-4 py-3.5 flex items-center justify-between mb-4">
          <span className="text-sm text-zinc-500">Estimated accuracy</span>
          <span className="text-sm font-semibold text-zinc-900">±{lens.accuracy_mm.toFixed(1)} mm</span>
        </div>

        {/* Contour visualization */}
        <div className="mb-4">
          <p className="section-label mb-2">Contour diagram</p>
          <div className="card p-3">
            {lens.rectified_image ? (
              <div className="relative aspect-square rounded-xl overflow-hidden bg-zinc-100">
                <img
                  src={lens.rectified_image}
                  alt="Rectified lens"
                  className="absolute inset-0 w-full h-full object-contain"
                />
                <svg
                  className="absolute inset-0 w-full h-full"
                  viewBox={`0 0 ${vbW} ${vbH}`}
                  preserveAspectRatio="xMidYMid meet"
                >
                  <polygon points={svgPts} fill="none" stroke="#22c55e" strokeWidth="0.8" />
                  <rect x={pad} y={pad} width={lens.A} height={lens.B}
                    fill="none" stroke="#2563eb" strokeWidth="0.5" strokeDasharray="2 1" />
                </svg>
              </div>
            ) : (
              <div className="aspect-square bg-zinc-50 rounded-xl flex items-center justify-center relative">
                <svg className="w-full h-full" viewBox={`0 0 ${vbW} ${vbH}`}>
                  <polygon points={svgPts} fill="#f4f4f5" stroke="#22c55e" strokeWidth="0.8" />
                  <rect x={pad} y={pad} width={lens.A} height={lens.B}
                    fill="none" stroke="#2563eb" strokeWidth="0.5" strokeDasharray="2 1" />
                  <text x={pad + lens.A / 2} y={vbH - 0.5} textAnchor="middle" fontSize="3" fill="#2563eb" fontFamily="monospace">
                    A = {lens.A.toFixed(1)} mm
                  </text>
                </svg>
              </div>
            )}
          </div>
        </div>

        {/* Comparison table */}
        <p className="section-label mb-2">Left vs. right</p>
        <div className="card divide-y divide-zinc-100 mb-4">
          {[['Width (A)', m.left.A, m.right.A], ['Height (B)', m.left.B, m.right.B], ['Perimeter', m.left.perimeter, m.right.perimeter]] .map(([label, lv, rv]) => (
            <div key={label as string} className="px-4 py-3 flex items-center justify-between">
              <span className="text-sm text-zinc-500">{label}</span>
              <div className="flex gap-5">
                <span className="text-xs text-zinc-400">L <span className="text-zinc-900 font-mono font-semibold">{(lv as number).toFixed(1)}</span></span>
                <span className="text-xs text-zinc-400">R <span className="text-zinc-900 font-mono font-semibold">{(rv as number).toFixed(1)}</span></span>
              </div>
            </div>
          ))}
        </div>

        {/* Export */}
        <div className="flex gap-3 mb-4">
          {(['left', 'right'] as Eye[]).map(eye => (
            <button
              key={eye}
              onClick={() => exportContourSVG(m[eye].contour_mm, eye, m[eye].A, m[eye].B)}
              className="flex-1 h-11 rounded-xl border border-zinc-200 text-xs font-medium text-zinc-700 flex items-center justify-center gap-1.5 active:bg-zinc-50 transition-colors"
            >
              <Download size={13} />
              {eye.charAt(0).toUpperCase() + eye.slice(1)} SVG (1:1)
            </button>
          ))}
        </div>

        <button
          onClick={() => navigate('/capture')}
          className="w-full h-11 rounded-xl border border-zinc-200 text-sm font-medium text-zinc-600 flex items-center justify-center gap-2 active:bg-zinc-50 transition-colors"
        >
          <RotateCcw size={14} />
          Retake photos
        </button>
      </div>

      <BottomBar label="Continue to face scan" to="/face-scan" />
    </div>
  )
}
