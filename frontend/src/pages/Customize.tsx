import { useNavigate } from 'react-router-dom'
import PageHeader from '../components/PageHeader'
import StepProgress from '../components/StepProgress'
import BottomBar from '../components/BottomBar'
import { useSession } from '../context/SessionContext'
import type { Pattern } from '../api/types'

const PATTERNS: { id: Pattern; label: string; emoji: string }[] = [
  { id: 'none', label: 'Smooth', emoji: '◻' },
  { id: 'woven', label: 'Woven', emoji: '⊞' },
  { id: 'honeycomb', label: 'Honeycomb', emoji: '⬡' },
  { id: 'brushed', label: 'Brushed', emoji: '〓' },
  { id: 'dots', label: 'Dots', emoji: '⁙' },
]

const COLORS = [
  { id: 'black', label: 'Matte black', hex: '#1a1a1a' },
  { id: 'tortoise', label: 'Tortoise', hex: '#7c4a1e' },
  { id: 'crystal', label: 'Crystal', hex: '#d4d4d4' },
  { id: 'navy', label: 'Navy', hex: '#1e3a5f' },
  { id: 'bone', label: 'Bone', hex: '#e8d8c0' },
  { id: 'olive', label: 'Olive', hex: '#6b7c3b' },
]

function Slider({
  label, value, min, max, step, unit, onChange,
}: {
  label: string; value: number; min: number; max: number; step: number; unit: string
  onChange: (v: number) => void
}) {
  return (
    <div className="py-3.5">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-zinc-700">{label}</span>
        <span className="text-sm font-semibold font-mono text-zinc-900">{value.toFixed(1)} {unit}</span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        className="w-full h-1.5 appearance-none bg-zinc-200 rounded-full outline-none cursor-pointer
          [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:h-5
          [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-zinc-900 [&::-webkit-slider-thumb]:cursor-pointer"
      />
      <div className="flex justify-between mt-1">
        <span className="text-[10px] text-zinc-400">{min} {unit}</span>
        <span className="text-[10px] text-zinc-400">{max} {unit}</span>
      </div>
    </div>
  )
}

export default function Customize() {
  const navigate = useNavigate()
  const { state, dispatch } = useSession()
  const c = state.customize

  function update(patch: Partial<typeof c>) {
    dispatch({ type: 'SET_CUSTOMIZE', customize: patch })
  }

  function updateParam(key: keyof typeof c.frameParams, val: number) {
    update({ frameParams: { ...c.frameParams, [key]: val } })
  }

  function proceed() {
    navigate('/generating')
  }

  const engravingError = c.engravingText.length > 8
    ? `${c.engravingText.length}/8 characters (max 8 fit on the tenon)`
    : null

  return (
    <div className="page-container">
      <PageHeader title="Customize" backTo="/face-scan" />
      <StepProgress current={4} />

      <div className="page-content">

        {/* Frame parameters */}
        <p className="section-label mb-1">Frame geometry</p>
        <div className="card px-4 divide-y divide-zinc-100 mb-5">
          <Slider label="Bridge width" value={c.frameParams.bridgeMm} min={12} max={30} step={0.5} unit="mm"
            onChange={v => updateParam('bridgeMm', v)} />
          <Slider label="Frame depth" value={c.frameParams.depthMm} min={3} max={8} step={0.5} unit="mm"
            onChange={v => updateParam('depthMm', v)} />
          <Slider label="Rim offset" value={c.frameParams.rimOffsetMm} min={0.5} max={3} step={0.1} unit="mm"
            onChange={v => updateParam('rimOffsetMm', v)} />
          <Slider label="Clip clearance" value={c.frameParams.clipClearanceMm} min={0.1} max={0.3} step={0.05} unit="mm"
            onChange={v => updateParam('clipClearanceMm', v)} />
        </div>

        {/* Surface pattern */}
        <p className="section-label mb-2">Surface pattern</p>
        <div className="grid grid-cols-5 gap-2 mb-5">
          {PATTERNS.map(p => (
            <button
              key={p.id}
              onClick={() => update({ pattern: p.id })}
              className={`flex flex-col items-center gap-1.5 py-3 rounded-xl border-2 transition-all ${
                c.pattern === p.id ? 'border-zinc-900 bg-zinc-50' : 'border-zinc-200 bg-white'
              }`}
            >
              <span className="text-xl leading-none">{p.emoji}</span>
              <span className="text-[10px] font-medium text-zinc-600">{p.label}</span>
            </button>
          ))}
        </div>

        {/* Color */}
        <p className="section-label mb-2">Filament color</p>
        <div className="card p-4 mb-5">
          <div className="grid grid-cols-6 gap-3 mb-3">
            {COLORS.map(col => (
              <button
                key={col.id}
                onClick={() => update({ color: col.id })}
                title={col.label}
                className="flex flex-col items-center gap-1.5"
              >
                <div
                  className={`w-9 h-9 rounded-full border-2 transition-all ${
                    c.color === col.id ? 'border-zinc-900 scale-110' : 'border-transparent'
                  }`}
                  style={{ backgroundColor: col.hex }}
                />
              </button>
            ))}
          </div>
          <p className="text-xs text-zinc-500 text-center">
            {COLORS.find(col => col.id === c.color)?.label}
          </p>
        </div>

        {/* Name engraving */}
        <p className="section-label mb-2">Engraving (optional)</p>
        <div className="card px-4 py-4 mb-2">
          <div className="relative">
            <input
              type="text"
              maxLength={8}
              placeholder="Up to 8 characters"
              value={c.engravingText}
              onChange={e => update({ engravingText: e.target.value })}
              className={`w-full h-12 px-4 pr-16 border rounded-xl text-sm text-zinc-900 placeholder:text-zinc-400 outline-none transition-colors ${
                engravingError ? 'border-red-300 focus:border-red-500' : 'border-zinc-200 focus:border-zinc-900'
              }`}
            />
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs text-zinc-400">
              {c.engravingText.length}/8
            </span>
          </div>
          {engravingError && <p className="text-xs text-red-500 mt-1.5">{engravingError}</p>}
          <p className="text-xs text-zinc-400 mt-2">
            Debossed 0.4 mm into the inner right arm. Fixed sans-serif font.
          </p>

          {/* Engraving preview */}
          {c.engravingText && (
            <div className="mt-3 bg-zinc-800 rounded-xl px-4 py-3 flex items-center justify-center">
              <span className="text-white font-mono tracking-widest text-sm select-none">
                {c.engravingText.toUpperCase()}
              </span>
            </div>
          )}
        </div>

        {/* Mini schematic preview */}
        <p className="section-label mb-2 mt-4">Preview</p>
        <div className="card p-5 flex items-center justify-center mb-2">
          <svg width="240" height="100" viewBox="0 0 240 100" fill="none">
            {/* Left rim */}
            <ellipse cx="68" cy="50" rx="52" ry="40" stroke="#1a1a1a" strokeWidth="4" fill={COLORS.find(col => col.id === c.color)?.hex ?? '#1a1a1a'} fillOpacity="0.15" />
            {/* Right rim */}
            <ellipse cx="172" cy="50" rx="52" ry="40" stroke="#1a1a1a" strokeWidth="4" fill={COLORS.find(col => col.id === c.color)?.hex ?? '#1a1a1a'} fillOpacity="0.15" />
            {/* Bridge */}
            <path d={`M${120 - c.frameParams.bridgeMm / 2},50 Q120,${50 - 8} ${120 + c.frameParams.bridgeMm / 2},50`}
              stroke="#1a1a1a" strokeWidth="3" fill="none" />
            {/* Left arm */}
            <line x1="16" y1="50" x2="2" y2="50" stroke="#1a1a1a" strokeWidth="3" strokeLinecap="round" />
            {/* Right arm */}
            <line x1="224" y1="50" x2="238" y2="50" stroke="#1a1a1a" strokeWidth="3" strokeLinecap="round" />
            {/* Bridge width label */}
            <text x="120" y="92" textAnchor="middle" fontSize="7" fill="#71717a" fontFamily="monospace">
              bridge {c.frameParams.bridgeMm.toFixed(1)} mm
            </text>
          </svg>
        </div>
      </div>

      <BottomBar
        label={engravingError ? 'Fix engraving to continue' : 'Generate frame'}
        onClick={engravingError ? undefined : proceed}
        disabled={!!engravingError}
      />
    </div>
  )
}
