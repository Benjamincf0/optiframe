import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Camera, Upload, ChevronDown, CheckCircle2, Circle, RotateCcw, AlertTriangle } from 'lucide-react'
import PageHeader from '../components/PageHeader'
import StepProgress from '../components/StepProgress'
import BottomBar from '../components/BottomBar'
import { useCamera } from '../hooks/useCamera'
import { useSession } from '../context/SessionContext'
import type { ReferenceSpec, ReferenceType } from '../api/types'

type Eye = 'left' | 'right'

const REF_OPTIONS: { id: ReferenceType; label: string; desc: string }[] = [
  { id: 'credit_card', label: 'Credit card', desc: '85.6 × 53.98 mm' },
  { id: 'a4', label: 'A4 sheet', desc: '297 × 210 mm' },
  { id: 'aruco', label: 'ArUco marker', desc: 'Custom dictionary' },
  { id: 'custom', label: 'Custom object', desc: 'Enter dimensions' },
]

export default function Capture() {
  const navigate = useNavigate()
  const { dispatch } = useSession()
  const { videoRef, error: cameraError, isActive, startCamera, stopCamera, captureFrame } = useCamera()

  const [activeEye, setActiveEye] = useState<Eye>('left')
  const [refType, setRefType] = useState<ReferenceType>('credit_card')
  const [showRefPicker, setShowRefPicker] = useState(false)
  const [customW, setCustomW] = useState('85.6')
  const [customH, setCustomH] = useState('53.98')
  const [captured, setCaptured] = useState<{ left: File | null; right: File | null }>({
    left: null,
    right: null,
  })
  const [previews, setPreviews] = useState<{ left: string | null; right: string | null }>({
    left: null,
    right: null,
  })
  const [showUpload, setShowUpload] = useState(false)
  const [lowRes, setLowRes] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const bothCaptured = !!captured.left && !!captured.right
  const selectedRef = REF_OPTIONS.find(r => r.id === refType)!

  useEffect(() => {
    if (!showUpload) startCamera('environment')
    return () => stopCamera()
  }, [showUpload]) // eslint-disable-line

  function handleCapture() {
    const file = captureFrame()
    if (!file) return
    storeCapture(file)
  }

  function storeCapture(file: File) {
    // Warn if image seems compressed / small
    setLowRes(file.size < 200_000)
    const url = URL.createObjectURL(file)
    setCaptured(prev => ({ ...prev, [activeEye]: file }))
    setPreviews(prev => ({ ...prev, [activeEye]: url }))
    if (activeEye === 'left') setActiveEye('right')
  }

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    storeCapture(file)
    if (e.target) e.target.value = ''
  }

  function retake(eye: Eye) {
    if (previews[eye]) URL.revokeObjectURL(previews[eye]!)
    setCaptured(prev => ({ ...prev, [eye]: null }))
    setPreviews(prev => ({ ...prev, [eye]: null }))
    setActiveEye(eye)
  }

  function buildReference(): ReferenceSpec {
    if (refType === 'credit_card') return { type: 'credit_card' }
    if (refType === 'a4') return { type: 'a4' }
    if (refType === 'custom') return { type: 'custom', width_mm: parseFloat(customW), height_mm: parseFloat(customH) }
    return { type: 'aruco', dictionary: 'DICT_4X4_50', marker_size_mm: 40 }
  }

  function proceed() {
    if (!captured.left || !captured.right) return
    dispatch({ type: 'SET_CAPTURES', left: captured.left, right: captured.right, reference: buildReference() })
    navigate('/processing')
  }

  const preview = previews[activeEye]

  return (
    <div className="page-container">
      <PageHeader title="Capture lenses" backTo="/" />
      <StepProgress current={1} />

      <div className="page-content">
        <p className="text-sm text-zinc-500 mb-4">
          Photograph each lens flat on a plain surface with a reference object visible in the frame.
        </p>

        {/* Eye toggle */}
        <div className="flex gap-2 mb-4">
          {(['left', 'right'] as Eye[]).map(eye => (
            <button
              key={eye}
              onClick={() => setActiveEye(eye)}
              className={`flex-1 h-11 rounded-xl text-sm font-semibold transition-all flex items-center justify-center gap-2 ${
                activeEye === eye ? 'bg-zinc-900 text-white' : 'bg-zinc-100 text-zinc-500'
              }`}
            >
              {captured[eye] ? (
                <CheckCircle2 size={14} />
              ) : (
                <Circle size={14} />
              )}
              {eye.charAt(0).toUpperCase() + eye.slice(1)} lens
            </button>
          ))}
        </div>

        {/* Reference picker */}
        <div className="mb-4">
          <p className="section-label mb-2">Reference object</p>
          <button
            onClick={() => setShowRefPicker(v => !v)}
            className="w-full card px-4 py-3.5 flex items-center justify-between"
          >
            <div className="text-left">
              <p className="text-sm font-semibold text-zinc-900">{selectedRef.label}</p>
              <p className="text-xs text-zinc-400 mt-0.5">{selectedRef.desc}</p>
            </div>
            <ChevronDown size={16} className={`text-zinc-400 transition-transform ${showRefPicker ? 'rotate-180' : ''}`} />
          </button>

          {showRefPicker && (
            <div className="card mt-1 overflow-hidden divide-y divide-zinc-100">
              {REF_OPTIONS.map(opt => (
                <button
                  key={opt.id}
                  onClick={() => { setRefType(opt.id); setShowRefPicker(false) }}
                  className={`w-full px-4 py-3.5 flex items-center justify-between text-left transition-colors ${
                    refType === opt.id ? 'bg-zinc-50' : 'active:bg-zinc-50'
                  }`}
                >
                  <div>
                    <p className="text-sm font-medium text-zinc-900">{opt.label}</p>
                    <p className="text-xs text-zinc-400 mt-0.5">{opt.desc}</p>
                  </div>
                  {refType === opt.id && <div className="w-2 h-2 rounded-full bg-zinc-900" />}
                </button>
              ))}
            </div>
          )}

          {refType === 'custom' && (
            <div className="card mt-2 px-4 py-3 flex items-center gap-3">
              <div className="flex-1">
                <p className="text-xs text-zinc-400 mb-1">Width (mm)</p>
                <input
                  type="number"
                  value={customW}
                  onChange={e => setCustomW(e.target.value)}
                  className="w-full h-9 px-3 border border-zinc-200 rounded-lg text-sm outline-none focus:border-zinc-900"
                />
              </div>
              <span className="text-zinc-300 mt-4">×</span>
              <div className="flex-1">
                <p className="text-xs text-zinc-400 mb-1">Height (mm)</p>
                <input
                  type="number"
                  value={customH}
                  onChange={e => setCustomH(e.target.value)}
                  className="w-full h-9 px-3 border border-zinc-200 rounded-lg text-sm outline-none focus:border-zinc-900"
                />
              </div>
            </div>
          )}
        </div>

        {/* Viewfinder / preview */}
        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <p className="section-label">
              {activeEye.charAt(0).toUpperCase() + activeEye.slice(1)} lens
            </p>
            <button
              onClick={() => setShowUpload(v => !v)}
              className="text-xs text-zinc-400 underline underline-offset-2"
            >
              {showUpload ? 'Use camera' : 'Upload file'}
            </button>
          </div>

          <div className="aspect-[4/3] rounded-2xl overflow-hidden bg-zinc-100 border border-zinc-200 relative">
            {/* Camera preview */}
            {!showUpload && !preview && (
              <>
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="absolute inset-0 w-full h-full object-cover"
                />
                {/* Corner guides */}
                {['top-left', 'top-right', 'bottom-left', 'bottom-right'].map(pos => (
                  <div
                    key={pos}
                    className={`absolute w-8 h-8 ${
                      pos.includes('top') ? 'top-4' : 'bottom-4'
                    } ${pos.includes('left') ? 'left-4' : 'right-4'} ${
                      pos === 'top-left' ? 'border-t-2 border-l-2 rounded-tl-lg' :
                      pos === 'top-right' ? 'border-t-2 border-r-2 rounded-tr-lg' :
                      pos === 'bottom-left' ? 'border-b-2 border-l-2 rounded-bl-lg' :
                      'border-b-2 border-r-2 rounded-br-lg'
                    } border-white/70`}
                  />
                ))}
                {cameraError && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center bg-zinc-100 px-6 text-center gap-2">
                    <AlertTriangle size={24} className="text-amber-500" />
                    <p className="text-sm text-zinc-600">{cameraError}</p>
                    <button
                      onClick={() => setShowUpload(true)}
                      className="mt-1 text-sm font-semibold text-zinc-900 underline underline-offset-2"
                    >
                      Upload a photo instead
                    </button>
                  </div>
                )}
              </>
            )}

            {/* Photo preview after capture */}
            {preview && (
              <img src={preview} alt="Captured lens" className="absolute inset-0 w-full h-full object-cover" />
            )}

            {/* Upload state */}
            {showUpload && !preview && (
              <button
                onClick={() => fileInputRef.current?.click()}
                className="absolute inset-0 flex flex-col items-center justify-center gap-3"
              >
                <Upload size={32} className="text-zinc-400" />
                <p className="text-sm font-medium text-zinc-500">Tap to choose a photo</p>
                <p className="text-xs text-zinc-400">JPEG, PNG, or WEBP</p>
              </button>
            )}

            {/* Captured overlay */}
            {preview && (
              <button
                onClick={() => retake(activeEye)}
                className="absolute top-3 right-3 bg-white/90 backdrop-blur-sm px-3 py-1.5 rounded-xl text-xs font-semibold text-zinc-700 flex items-center gap-1.5"
              >
                <RotateCcw size={12} />
                Retake
              </button>
            )}
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={handleFileUpload}
          />
        </div>

        {/* Capture button */}
        {!showUpload && !preview && isActive && (
          <button
            onClick={handleCapture}
            className="w-full h-14 rounded-2xl bg-zinc-900 text-white text-base font-semibold flex items-center justify-center gap-2 active:scale-[0.98] transition-all mb-4"
          >
            <Camera size={18} />
            Capture {activeEye} lens
          </button>
        )}

        {showUpload && !preview && (
          <button
            onClick={() => fileInputRef.current?.click()}
            className="w-full h-14 rounded-2xl bg-zinc-900 text-white text-base font-semibold flex items-center justify-center gap-2 active:scale-[0.98] transition-all mb-4"
          >
            <Upload size={18} />
            Choose photo
          </button>
        )}

        {/* Status */}
        <div className="card divide-y divide-zinc-100 mb-4">
          {(['left', 'right'] as Eye[]).map(eye => (
            <div key={eye} className="px-4 py-3.5 flex items-center justify-between">
              <span className="text-sm font-medium text-zinc-700">
                {eye.charAt(0).toUpperCase() + eye.slice(1)} lens
              </span>
              {captured[eye] ? (
                <span className="flex items-center gap-1.5 text-xs font-semibold text-zinc-900">
                  <CheckCircle2 size={13} /> Ready
                </span>
              ) : (
                <span className="text-xs text-zinc-400">Not captured</span>
              )}
            </div>
          ))}
        </div>

        {/* Low-res warning */}
        {lowRes && (
          <div className="px-4 py-3.5 bg-amber-50 border border-amber-200 rounded-xl flex gap-3 mb-2">
            <AlertTriangle size={15} className="text-amber-600 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-amber-700">
              This image may be too compressed for accurate measurement. Use the camera directly, or use the original file — not a WhatsApp/screenshot copy.
            </p>
          </div>
        )}
      </div>

      <BottomBar
        label={bothCaptured ? 'Analyse lenses' : 'Capture both lenses to continue'}
        onClick={bothCaptured ? proceed : undefined}
        disabled={!bothCaptured}
      />
    </div>
  )
}
