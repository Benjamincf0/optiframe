import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, RotateCcw } from 'lucide-react'
import { useSession } from '../context/SessionContext'
import { measureLenses, ApiClientError } from '../api/client'

const STATUS_STEPS = [
  'Detecting reference object…',
  'Correcting perspective…',
  'Tracing lens contour…',
  'Computing measurements…',
]

const ERROR_MESSAGES: Record<string, string> = {
  REF_NOT_FOUND: 'Reference object not found. Make sure it\'s fully visible and unobstructed.',
  LENS_NOT_FOUND: 'Lens not found. Place the lens on a plain background with nothing overlapping it.',
  IMAGE_TOO_BLURRY: 'Photo is too blurry. Hold the camera steady and retake.',
  ANGLE_TOO_STEEP: 'Camera angle is too steep. Shoot from directly above.',
  IMAGE_TOO_LARGE: 'Image file is too large. Please retake.',
  PROCESSING_TIMEOUT: 'Processing timed out. Check your connection and try again.',
}

export default function Processing() {
  const navigate = useNavigate()
  const { state, dispatch } = useSession()
  const [statusIdx, setStatusIdx] = useState(0)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!state.leftFile || !state.rightFile) {
      navigate('/capture')
      return
    }

    // Animate status text
    let idx = 0
    const interval = setInterval(() => {
      idx = Math.min(idx + 1, STATUS_STEPS.length - 1)
      setStatusIdx(idx)
    }, 2500)

    async function run() {
      try {
        const result = await measureLenses(state.leftFile!, state.rightFile!, state.reference)
        dispatch({ type: 'SET_MEASUREMENTS', measurements: result })
        navigate('/measurements')
      } catch (err) {
        let msg = 'Something went wrong. Please try again.'
        if (err instanceof ApiClientError) {
          msg = ERROR_MESSAGES[err.code] ?? err.message
        } else if (err instanceof TypeError) {
          msg = 'Could not reach the server. Check your connection.'
        }
        setError(msg)
      } finally {
        clearInterval(interval)
      }
    }

    run()
    return () => clearInterval(interval)
  }, []) // eslint-disable-line

  if (error) {
    return (
      <div className="page-container items-center justify-center min-h-screen px-8 text-center gap-6">
        <div className="w-16 h-16 rounded-full bg-red-50 flex items-center justify-center mx-auto">
          <AlertTriangle size={28} className="text-red-500" />
        </div>
        <div>
          <p className="text-base font-semibold text-zinc-900 mb-2">Analysis failed</p>
          <p className="text-sm text-zinc-500">{error}</p>
        </div>
        <button
          onClick={() => navigate('/capture')}
          className="mt-4 h-12 px-8 rounded-2xl bg-zinc-900 text-white text-sm font-semibold flex items-center gap-2 mx-auto active:scale-[0.98] transition-all"
        >
          <RotateCcw size={15} />
          Retake photos
        </button>
      </div>
    )
  }

  return (
    <div className="page-container items-center justify-center min-h-screen px-8 text-center gap-10">
      {/* Animated rings */}
      <div className="relative flex items-center justify-center">
        <div className="w-20 h-20 rounded-full border-2 border-zinc-200 animate-ping absolute opacity-30" />
        <div className="w-20 h-20 rounded-full border-2 border-t-zinc-900 border-zinc-200 animate-spin" />
        <div className="absolute w-10 h-10 rounded-full bg-zinc-900" />
      </div>

      <div>
        <p className="text-base font-semibold text-zinc-900 mb-2">Analysing lenses</p>
        <p className="text-sm text-zinc-400 transition-all duration-500">{STATUS_STEPS[statusIdx]}</p>
      </div>

      <p className="text-xs text-zinc-300 absolute bottom-12">
        Images processed securely — never stored on our servers
      </p>
    </div>
  )
}
