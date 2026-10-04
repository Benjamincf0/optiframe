import { useNavigate } from 'react-router-dom'
import PageHeader from '../components/PageHeader'
import StepProgress from '../components/StepProgress'
import BottomBar from '../components/BottomBar'
import FrameViewer from '../components/FrameViewer'
import { useSession } from '../context/SessionContext'
import type { Pattern } from '../api/types'

const FINISHES: { id: string; label: string; hex: string; pattern: Pattern; swatch: string }[] = [
  { id: 'black', label: 'Matte black', hex: '#1a1a1a', pattern: 'none', swatch: '#1a1a1a' },
  { id: 'tortoise', label: 'Tortoise weave', hex: '#7c4a1e', pattern: 'woven', swatch: 'repeating-linear-gradient(45deg, #5c3012 0 3px, #9b632b 3px 6px)' },
  { id: 'crystal', label: 'Crystal', hex: '#d4d4d4', pattern: 'none', swatch: '#d4d4d4' },
  { id: 'navy', label: 'Navy lines', hex: '#1e3a5f', pattern: 'brushed', swatch: 'repeating-linear-gradient(0deg, #1e3a5f 0 3px, #41658f 3px 5px)' },
  { id: 'bone', label: 'Bone dots', hex: '#e8d8c0', pattern: 'dots', swatch: 'radial-gradient(#9d8061 1.25px, transparent 1.75px), #e8d8c0' },
  { id: 'olive', label: 'Olive honeycomb', hex: '#6b7c3b', pattern: 'honeycomb', swatch: 'linear-gradient(30deg, #82934d 12%, transparent 12.5%, transparent 87%, #82934d 87.5%, #82934d), linear-gradient(150deg, #82934d 12%, transparent 12.5%, transparent 87%, #82934d 87.5%, #82934d), #6b7c3b' },
]

function Slider({
  label, value, min, max, step, unit, onChange,
}: {
  label: string; value: number; min: number; max: number; step: number; unit: string
  onChange: (v: number) => void
}) {
  return (
    <div className="py-2.5">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs font-medium text-zinc-700">{label}</span>
        <span className="text-xs font-semibold font-mono text-zinc-900">{value.toFixed(1)} {unit}</span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        className="w-full h-1.5 appearance-none bg-zinc-200 rounded-full outline-none cursor-pointer
          [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4
          [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-zinc-900 [&::-webkit-slider-thumb]:cursor-pointer"
      />
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
  const selectedFinish = FINISHES.find(finish => finish.id === c.color) ?? FINISHES[0]

  return (
    <div className="page-container">
      <PageHeader title="Customize" backTo="/face-scan" />
      <StepProgress current={4} />

      <div className="page-content pt-3">
        {/* Interactive 3D preview */}
        <p className="section-label mb-2">Preview</p>
        <div className="mb-4">
          <FrameViewer color={selectedFinish.hex} colorLabel={selectedFinish.label} pattern={selectedFinish.pattern}
            measurements={state.measurements} frameParams={c.frameParams} />
        </div>

        {/* A finish includes its colour and surface treatment. */}
        <p className="section-label mb-2">Choose a finish</p>
        <div className="grid grid-cols-3 gap-2 mb-4">
          {FINISHES.map(finish => (
            <button key={finish.id} onClick={() => update({ color: finish.id, pattern: finish.pattern })}
              className={`rounded-xl border-2 p-2 text-left transition-all ${c.color === finish.id ? 'border-zinc-900 bg-zinc-50' : 'border-zinc-200 bg-white'}`}>
              <span className="mb-1.5 block h-7 rounded-lg border border-black/10" style={{ background: finish.swatch, backgroundSize: finish.pattern === 'dots' ? '7px 7px' : undefined }} />
              <span className="block text-[10px] font-medium leading-tight text-zinc-700">{finish.label}</span>
            </button>
          ))}
        </div>

        {/* Name engraving */}
        <p className="section-label mb-2">Engraving (optional)</p>
        <div className="card px-3 py-3 mb-4">
          <div className="relative">
            <input
              type="text"
              maxLength={8}
              placeholder="Up to 8 characters"
              value={c.engravingText}
              onChange={e => update({ engravingText: e.target.value })}
              className={`w-full h-10 px-3 pr-14 border rounded-xl text-sm text-zinc-900 placeholder:text-zinc-400 outline-none transition-colors ${
                engravingError ? 'border-red-300 focus:border-red-500' : 'border-zinc-200 focus:border-zinc-900'
              }`}
            />
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs text-zinc-400">
              {c.engravingText.length}/8
            </span>
          </div>
          {engravingError && <p className="text-xs text-red-500 mt-1.5">{engravingError}</p>}
          <p className="text-[11px] text-zinc-400 mt-1.5">
            Debossed 0.4 mm into the inner right arm. Fixed sans-serif font.
          </p>

          {/* Engraving preview */}
          {c.engravingText && (
            <div className="mt-2 bg-zinc-800 rounded-xl px-4 py-2 flex items-center justify-center">
              <span className="text-white font-mono tracking-widest text-sm select-none">
                {c.engravingText.toUpperCase()}
              </span>
            </div>
          )}
        </div>

        {/* Frame parameters */}
        <p className="section-label mb-2">Frame geometry</p>
        <div className="card grid grid-cols-2 divide-x divide-y divide-zinc-100 overflow-hidden mb-2">
          <div className="px-3"><Slider label="Bridge width" value={c.frameParams.bridgeMm} min={12} max={30} step={0.5} unit="mm" onChange={v => updateParam('bridgeMm', v)} /></div>
          <div className="px-3"><Slider label="Frame depth" value={c.frameParams.depthMm} min={3} max={8} step={0.5} unit="mm" onChange={v => updateParam('depthMm', v)} /></div>
          <div className="px-3"><Slider label="Rim offset" value={c.frameParams.rimOffsetMm} min={0.5} max={3} step={0.1} unit="mm" onChange={v => updateParam('rimOffsetMm', v)} /></div>
          <div className="px-3"><Slider label="Clip clearance" value={c.frameParams.clipClearanceMm} min={0.1} max={0.3} step={0.05} unit="mm" onChange={v => updateParam('clipClearanceMm', v)} /></div>
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
