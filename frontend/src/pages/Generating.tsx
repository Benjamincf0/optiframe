import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, RotateCcw } from 'lucide-react'
import PageHeader from '../components/PageHeader'
import StepProgress from '../components/StepProgress'
import { useSession } from '../context/SessionContext'
import { generateSTL, ApiClientError } from '../api/client'
import type { GenerateRequest } from '../api/types'

const STATUS_STEPS = [
  'Building rim profiles…',
  'Adding bridge…',
  'Applying surface pattern…',
  'Engraving text…',
  'Finalizing mesh…',
]

const ERROR_MESSAGES: Record<string, string> = {
  INVALID_CONTOUR: 'The lens contour data is invalid. Please retake the photos.',
  ENGRAVING_INVALID: 'Engraving text contains unsupported characters. Go back and adjust it.',
  GEOMETRY_FAILED: 'Frame geometry could not be generated with these parameters. Try adjusting the rim offset or bridge width.',
  MESH_INVALID: 'The generated mesh has errors. Please try again.',
  PROCESSING_TIMEOUT: 'Generation timed out. Check your connection and try again.',
}

export default function Generating() {
  const navigate = useNavigate()
  const { state, dispatch } = useSession()
  const [statusIdx, setStatusIdx] = useState(0)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const m = state.measurements
    if (!m) { navigate('/capture'); return }

    let idx = 0
    const interval = setInterval(() => {
      idx = Math.min(idx + 1, STATUS_STEPS.length - 1)
      setStatusIdx(idx)
    }, 3000)

    async function run() {
      const c = state.customize
      const req: GenerateRequest = {
        left_contour_mm: state.measurements!.left.contour_mm,
        right_contour_mm: state.measurements!.right.contour_mm,
        bridge_mm: c.frameParams.bridgeMm,
        depth_mm: c.frameParams.depthMm,
        rim_offset_mm: c.frameParams.rimOffsetMm,
        clip_clearance_mm: c.frameParams.clipClearanceMm,
        pattern: c.pattern,
        engraving_text: c.engravingText,
      }

      try {
        const { blob, headers } = await generateSTL(req)
        dispatch({ type: 'SET_STL', blob, headers })
        navigate('/try-on')
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
      <div className="page-container">
        <PageHeader title="Creating frame" backTo="/customize" />
        <StepProgress current={5} />
        <main className="flex-1 flex flex-col items-center justify-center px-8 text-center gap-6">
          <div className="w-16 h-16 rounded-full bg-red-50 flex items-center justify-center mx-auto">
            <AlertTriangle size={28} className="text-red-500" />
          </div>
          <div>
            <p className="text-base font-semibold text-zinc-900 mb-2">Generation failed</p>
            <p className="text-sm text-zinc-500">{error}</p>
          </div>
          <button
            onClick={() => navigate('/customize')}
            className="mt-4 h-12 px-8 rounded-2xl bg-zinc-900 text-white text-sm font-semibold flex items-center gap-2 mx-auto active:scale-[0.98] transition-all"
          >
            <RotateCcw size={15} />
            Back to customize
          </button>
        </main>
      </div>
    )
  }

  return (
    <div className="page-container">
      <PageHeader title="Creating frame" backTo="/customize" />
      <StepProgress current={5} />
      <main className="flex-1 flex flex-col items-center justify-center px-8 text-center gap-10">
        {/* 3D spinning frame wireframe */}
        <div className="relative flex items-center justify-center">
          <div className="w-24 h-24 rounded-full border-2 border-zinc-200 animate-ping absolute opacity-20" />
          <div className="w-20 h-20 rounded-full border-2 border-t-zinc-900 border-zinc-200 animate-spin" />
          <div className="absolute">
            <svg width="36" height="20" viewBox="0 0 200 90" fill="none">
              <ellipse cx="58" cy="45" rx="42" ry="35" stroke="#18181b" strokeWidth="6" />
              <ellipse cx="142" cy="45" rx="42" ry="35" stroke="#18181b" strokeWidth="6" />
              <line x1="100" y1="38" x2="100" y2="52" stroke="#18181b" strokeWidth="6" />
            </svg>
          </div>
        </div>

        <div>
          <p className="text-base font-semibold text-zinc-900 mb-2">Generating your frame</p>
          <p className="text-sm text-zinc-400 transition-all duration-500">{STATUS_STEPS[statusIdx]}</p>
        </div>

        <p className="text-xs text-zinc-300">Building a custom STL fitted to your exact lens shapes</p>
      </main>
    </div>
  )
}
