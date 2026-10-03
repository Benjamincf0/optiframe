import { useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import PageHeader from '../components/PageHeader'
import StepProgress from '../components/StepProgress'
import BottomBar from '../components/BottomBar'

interface SliderProps {
  label: string
  value: number
  min: number
  max: number
  step: number
  unit: string
  onChange: (v: number) => void
}

function Slider({ label, value, min, max, step, unit, onChange }: SliderProps) {
  return (
    <div className="py-3.5">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-zinc-700">{label}</span>
        <span className="text-sm font-semibold font-mono text-zinc-900">
          {value.toFixed(1)} {unit}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        className="w-full h-1.5 appearance-none bg-zinc-200 rounded-full outline-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-zinc-900"
      />
      <div className="flex justify-between mt-1">
        <span className="text-[10px] text-zinc-400">{min} {unit}</span>
        <span className="text-[10px] text-zinc-400">{max} {unit}</span>
      </div>
    </div>
  )
}

export default function FrameDesign() {
  const [bridgeWidth, setBridgeWidth] = useState(18)
  const [frameDepth, setFrameDepth] = useState(5)
  const [rimOffset, setRimOffset] = useState(1.5)
  const [clipClearance, setClipClearance] = useState(0.2)

  return (
    <div className="page-container">
      <PageHeader title="Frame Design" backTo="/measure" />
      <StepProgress current={5} />

      <div className="page-content">
        <p className="text-sm text-zinc-500 mb-5">
          Configure the frame parameters. The 3D model updates automatically.
        </p>

        {/* 3D preview */}
        <div className="mb-5">
          <p className="section-label mb-2">3D Preview</p>
          <div className="aspect-[4/3] bg-zinc-100 rounded-2xl border border-zinc-200 flex flex-col items-center justify-center gap-3 relative overflow-hidden">
            {/* Fake 3D frame wireframe (decorative placeholder) */}
            <svg className="w-48 opacity-70" viewBox="0 0 200 90" fill="none">
              {/* Left rim */}
              <ellipse cx="58" cy="45" rx="42" ry="35" stroke="#3f3f46" strokeWidth="3" fill="none" />
              {/* Right rim */}
              <ellipse cx="142" cy="45" rx="42" ry="35" stroke="#3f3f46" strokeWidth="3" fill="none" />
              {/* Bridge */}
              <path d="M100 38 Q100 30 100 38" stroke="#3f3f46" strokeWidth="3" fill="none" />
              <line x1="100" y1="38" x2="100" y2="52" stroke="#3f3f46" strokeWidth="3" />
              {/* Left temple tenon */}
              <line x1="16" y1="45" x2="2" y2="45" stroke="#3f3f46" strokeWidth="3" strokeLinecap="round" />
              {/* Right temple tenon */}
              <line x1="184" y1="45" x2="198" y2="45" stroke="#3f3f46" strokeWidth="3" strokeLinecap="round" />
            </svg>
            <p className="text-xs text-zinc-400">Pinch to zoom · drag to rotate</p>
            <div className="absolute top-3 right-3 bg-white/80 backdrop-blur-sm px-2 py-1 rounded-lg">
              <span className="text-[10px] font-mono text-zinc-500">three.js preview</span>
            </div>
          </div>
          {/* Validation overlay toggle */}
          <button className="mt-2 w-full h-9 rounded-xl border border-zinc-200 text-xs font-medium text-zinc-600 flex items-center justify-center gap-1.5 active:bg-zinc-50 transition-colors">
            Show contour vs. rim overlay
          </button>
        </div>

        {/* Parameters */}
        <div className="mb-5">
          <p className="section-label mb-1">Parameters</p>
          <div className="card px-4 divide-y divide-zinc-100">
            <Slider label="Bridge width" value={bridgeWidth} min={12} max={30} step={0.5} unit="mm" onChange={setBridgeWidth} />
            <Slider label="Frame depth" value={frameDepth} min={3} max={8} step={0.5} unit="mm" onChange={setFrameDepth} />
            <Slider label="Rim offset" value={rimOffset} min={0.5} max={3} step={0.1} unit="mm" onChange={setRimOffset} />
            <Slider label="Clip clearance" value={clipClearance} min={0.1} max={0.3} step={0.05} unit="mm" onChange={setClipClearance} />
          </div>
        </div>

        {/* Frame summary */}
        <div className="card divide-y divide-zinc-100 mb-4">
          <div className="px-4 py-3.5 flex items-center justify-between">
            <span className="text-sm text-zinc-500">Left rim</span>
            <span className="text-sm font-semibold text-zinc-900">44.2 × 36.8 mm</span>
          </div>
          <div className="px-4 py-3.5 flex items-center justify-between">
            <span className="text-sm text-zinc-500">Right rim</span>
            <span className="text-sm font-semibold text-zinc-900">51.0 × 38.1 mm</span>
          </div>
          <div className="px-4 py-3.5 flex items-center justify-between">
            <span className="text-sm text-zinc-500">Bridge</span>
            <span className="text-sm font-semibold text-zinc-900 font-mono">{bridgeWidth} mm</span>
          </div>
          <div className="px-4 py-3.5 flex items-center justify-between">
            <span className="text-sm text-zinc-500">Clip groove</span>
            <span className="text-xs font-semibold text-zinc-900">Undercut · {clipClearance} mm gap</span>
          </div>
        </div>

        {/* Printability warning (conditionally shown) */}
        <div className="px-4 py-3.5 bg-amber-50 border border-amber-200 rounded-xl flex gap-3">
          <AlertTriangle size={16} className="text-amber-600 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-amber-700">
            Printability check will run after the model is generated. No excessive overhangs detected with current settings.
          </p>
        </div>
      </div>

      <BottomBar label="Continue to Export" to="/export" />
    </div>
  )
}
