import { useState } from 'react'
import { Camera, Upload, ChevronDown, CheckCircle2, Circle } from 'lucide-react'
import PageHeader from '../components/PageHeader'
import StepProgress from '../components/StepProgress'
import BottomBar from '../components/BottomBar'

type Eye = 'left' | 'right'
type RefObject = 'credit-card' | 'aruco' | 'a4' | 'custom'

const REF_OBJECTS: { id: RefObject; label: string; size: string }[] = [
  { id: 'credit-card', label: 'Credit card', size: '85.6 × 53.98 mm' },
  { id: 'aruco', label: 'ArUco marker', size: 'Custom size' },
  { id: 'a4', label: 'A4 sheet', size: '297 × 210 mm' },
  { id: 'custom', label: 'Custom object', size: 'Enter dimensions' },
]

export default function Capture() {
  const [activeEye, setActiveEye] = useState<Eye>('left')
  const [refObject, setRefObject] = useState<RefObject>('credit-card')
  const [showRefPicker, setShowRefPicker] = useState(false)
  const [captured, setCaptured] = useState<{ left: boolean; right: boolean }>({ left: false, right: false })

  const selectedRef = REF_OBJECTS.find(r => r.id === refObject)!
  const bothCaptured = captured.left && captured.right

  const handleCapture = () => {
    setCaptured(prev => ({ ...prev, [activeEye]: true }))
    if (activeEye === 'left') setActiveEye('right')
  }

  return (
    <div className="page-container">
      <PageHeader title="Capture" backTo="/" />
      <StepProgress current={1} />

      <div className="page-content">
        {/* Eye toggle */}
        <div className="flex gap-2 mb-5">
          {(['left', 'right'] as Eye[]).map(eye => (
            <button
              key={eye}
              onClick={() => setActiveEye(eye)}
              className={`flex-1 h-11 rounded-xl text-sm font-semibold transition-all flex items-center justify-center gap-2 ${
                activeEye === eye
                  ? 'bg-zinc-900 text-white'
                  : 'bg-zinc-100 text-zinc-500'
              }`}
            >
              {captured[eye]
                ? <CheckCircle2 size={14} className={activeEye === eye ? 'text-white' : 'text-zinc-400'} />
                : <Circle size={14} />
              }
              {eye.charAt(0).toUpperCase() + eye.slice(1)} lens
            </button>
          ))}
        </div>

        {/* Reference object selector */}
        <div className="mb-4">
          <p className="section-label mb-2">Reference object</p>
          <button
            onClick={() => setShowRefPicker(!showRefPicker)}
            className="w-full card px-4 py-3.5 flex items-center justify-between"
          >
            <div className="text-left">
              <p className="text-sm font-semibold text-zinc-900">{selectedRef.label}</p>
              <p className="text-xs text-zinc-400 mt-0.5">{selectedRef.size}</p>
            </div>
            <ChevronDown
              size={16}
              className={`text-zinc-400 transition-transform ${showRefPicker ? 'rotate-180' : ''}`}
            />
          </button>
          {showRefPicker && (
            <div className="card mt-1 overflow-hidden divide-y divide-zinc-100">
              {REF_OBJECTS.map(obj => (
                <button
                  key={obj.id}
                  onClick={() => { setRefObject(obj.id); setShowRefPicker(false) }}
                  className={`w-full px-4 py-3.5 flex items-center justify-between text-left transition-colors ${
                    refObject === obj.id ? 'bg-zinc-50' : 'bg-white active:bg-zinc-50'
                  }`}
                >
                  <div>
                    <p className="text-sm font-medium text-zinc-900">{obj.label}</p>
                    <p className="text-xs text-zinc-400 mt-0.5">{obj.size}</p>
                  </div>
                  {refObject === obj.id && (
                    <div className="w-2 h-2 rounded-full bg-zinc-900" />
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Viewfinder */}
        <div className="mb-5">
          <p className="section-label mb-2">
            {activeEye.charAt(0).toUpperCase() + activeEye.slice(1)} lens
          </p>
          <div className="aspect-[4/3] bg-zinc-100 rounded-2xl flex flex-col items-center justify-center gap-3 relative overflow-hidden border border-zinc-200">
            {/* Corner guides */}
            <div className="absolute top-4 left-4 w-8 h-8 border-t-2 border-l-2 border-zinc-400 rounded-tl-lg" />
            <div className="absolute top-4 right-4 w-8 h-8 border-t-2 border-r-2 border-zinc-400 rounded-tr-lg" />
            <div className="absolute bottom-4 left-4 w-8 h-8 border-b-2 border-l-2 border-zinc-400 rounded-bl-lg" />
            <div className="absolute bottom-4 right-4 w-8 h-8 border-b-2 border-r-2 border-zinc-400 rounded-br-lg" />

            {captured[activeEye] ? (
              <>
                <CheckCircle2 size={32} className="text-zinc-400" />
                <p className="text-sm font-medium text-zinc-500">
                  {activeEye.charAt(0).toUpperCase() + activeEye.slice(1)} lens captured
                </p>
                <button
                  onClick={() => setCaptured(prev => ({ ...prev, [activeEye]: false }))}
                  className="text-xs text-zinc-400 underline underline-offset-2"
                >
                  Retake
                </button>
              </>
            ) : (
              <>
                <Camera size={28} className="text-zinc-400" />
                <div className="text-center px-8">
                  <p className="text-sm font-medium text-zinc-600">Place the lens + {selectedRef.label}</p>
                  <p className="text-xs text-zinc-400 mt-1">Both must be fully visible in frame</p>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Capture actions */}
        {!captured[activeEye] && (
          <div className="flex gap-3">
            <button
              onClick={handleCapture}
              className="flex-1 h-12 rounded-xl bg-zinc-900 text-white text-sm font-semibold flex items-center justify-center gap-2 active:scale-[0.98] transition-all"
            >
              <Camera size={16} />
              Take photo
            </button>
            <button className="h-12 px-5 rounded-xl bg-zinc-100 text-zinc-700 text-sm font-semibold flex items-center justify-center gap-2">
              <Upload size={16} />
              Upload
            </button>
          </div>
        )}

        {/* Status summary */}
        <div className="mt-5 card divide-y divide-zinc-100">
          {(['left', 'right'] as Eye[]).map(eye => (
            <div key={eye} className="px-4 py-3.5 flex items-center justify-between">
              <span className="text-sm font-medium text-zinc-700">
                {eye.charAt(0).toUpperCase() + eye.slice(1)} lens
              </span>
              {captured[eye] ? (
                <span className="flex items-center gap-1.5 text-xs font-semibold text-zinc-900">
                  <CheckCircle2 size={14} /> Captured
                </span>
              ) : (
                <span className="text-xs text-zinc-400">Pending</span>
              )}
            </div>
          ))}
        </div>

        {/* Low-res warning placeholder */}
        <div className="mt-4 px-4 py-3.5 bg-amber-50 border border-amber-200 rounded-xl">
          <p className="text-xs font-semibold text-amber-800">Tip</p>
          <p className="text-xs text-amber-700 mt-0.5">
            Use your camera directly — WhatsApp or screenshot images are compressed and may affect accuracy.
          </p>
        </div>
      </div>

      <BottomBar
        label={bothCaptured ? 'Continue to Rectify' : 'Capture both lenses to continue'}
        to="/rectify"
        disabled={!bothCaptured}
      />
    </div>
  )
}
