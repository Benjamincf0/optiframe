import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Shield, ScanFace, ChevronRight, Minus, Plus } from 'lucide-react'
import PageHeader from '../components/PageHeader'
import StepProgress from '../components/StepProgress'
import BottomBar from '../components/BottomBar'
import { useCamera } from '../hooks/useCamera'
import { useFaceMesh } from '../hooks/useFaceMesh'
import { useSession } from '../context/SessionContext'

export default function FaceScan() {
  const navigate = useNavigate()
  const { state, dispatch } = useSession()
  const { videoRef, isActive, error: camError, startCamera, stopCamera } = useCamera()
  const { isReady, isLoading, error: meshError, metrics, startDetection, stopDetection } =
    useFaceMesh()

  const [skipped, setSkipped] = useState(false)
  const [manualBridge, setManualBridge] = useState(state.customize.frameParams.bridgeMm)
  const [locked, setLocked] = useState(false)
  const [lockedMetrics, setLockedMetrics] = useState<typeof metrics>(null)

  // Start camera and detection
  useEffect(() => {
    if (skipped) return
    startCamera('user')
    return () => {
      stopCamera()
      stopDetection()
    }
  }, [skipped]) // eslint-disable-line

  useEffect(() => {
    if (isReady && isActive && videoRef.current && !skipped) {
      startDetection(videoRef.current)
    }
  }, [isReady, isActive, skipped]) // eslint-disable-line

  const lockPD = useCallback(() => {
    if (!metrics) return
    setLockedMetrics(metrics)
    setLocked(true)
    stopDetection()
    stopCamera()
    dispatch({
      type: 'SET_PD',
      pdMm: metrics.pdMm,
      bridgeMm: Math.round(metrics.bridgeMm * 2) / 2, // round to 0.5 mm
    })
  }, [metrics, dispatch, stopDetection, stopCamera])

  function handleSkip() {
    setSkipped(true)
    stopCamera()
    stopDetection()
    dispatch({ type: 'SET_CUSTOMIZE', customize: { frameParams: { ...state.customize.frameParams, bridgeMm: 18 } } })
  }

  function handleManualConfirm() {
    dispatch({ type: 'SET_PD', pdMm: 0, bridgeMm: manualBridge })
    navigate('/customize')
  }

  // If locked or skipped, show summary
  const confirmed = locked || skipped

  return (
    <div className="page-container">
      <PageHeader title="Face scan" backTo="/measurements" />
      <StepProgress current={3} />

      <div className="page-content">
        {/* Privacy notice */}
        <div className="px-4 py-3.5 bg-zinc-50 border border-zinc-200 rounded-xl flex gap-3 mb-5">
          <Shield size={15} className="text-zinc-500 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-zinc-500">
            Your face is never uploaded. All processing happens on this device using MediaPipe.
          </p>
        </div>

        {!confirmed && !skipped && (
          <>
            {/* Loading state */}
            {(isLoading || !isReady) && (
              <div className="aspect-[3/4] bg-zinc-100 rounded-2xl border border-zinc-200 flex flex-col items-center justify-center gap-4 mb-4">
                <div className="w-10 h-10 border-2 border-zinc-300 border-t-zinc-900 rounded-full animate-spin" />
                <p className="text-sm text-zinc-500">Loading face detection…</p>
              </div>
            )}

            {/* Camera + face mesh */}
            {isReady && (
              <div className="mb-4">
                <p className="section-label mb-2">Look straight at the camera</p>
                <div className="relative aspect-[3/4] rounded-2xl overflow-hidden bg-zinc-900">
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    className="absolute inset-0 w-full h-full object-cover"
                    style={{ transform: 'scaleX(-1)' }}
                  />

                  {/* Face detection overlay */}
                  {metrics ? (
                    <div className="absolute inset-0 flex flex-col items-center justify-end p-4 gap-3">
                      {/* Landmark dots */}
                      <div
                        className="absolute w-3 h-3 rounded-full bg-green-400 border-2 border-white shadow"
                        style={{
                          left: `${(1 - metrics.landmarks[468].x) * 100}%`,
                          top: `${metrics.landmarks[468].y * 100}%`,
                          transform: 'translate(-50%, -50%)',
                        }}
                      />
                      <div
                        className="absolute w-3 h-3 rounded-full bg-green-400 border-2 border-white shadow"
                        style={{
                          left: `${(1 - metrics.landmarks[473].x) * 100}%`,
                          top: `${metrics.landmarks[473].y * 100}%`,
                          transform: 'translate(-50%, -50%)',
                        }}
                      />

                      {/* PD pill */}
                      <div className="bg-white/90 backdrop-blur-sm px-4 py-2 rounded-xl text-center">
                        <p className="text-xs text-zinc-500">Pupillary distance</p>
                        <p className="text-xl font-bold text-zinc-900">{metrics.pdMm.toFixed(1)} mm</p>
                        <p className="text-xs text-zinc-500">Bridge → {metrics.bridgeMm.toFixed(1)} mm</p>
                      </div>
                    </div>
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="bg-black/50 backdrop-blur-sm px-5 py-3 rounded-xl text-center">
                        <ScanFace size={24} className="text-white mx-auto mb-1" />
                        <p className="text-sm text-white">Position your face in frame</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Error */}
            {(camError || meshError) && (
              <div className="px-4 py-3.5 bg-red-50 border border-red-200 rounded-xl mb-4">
                <p className="text-xs text-red-700">{camError || meshError}</p>
              </div>
            )}

            {/* Lock + skip */}
            <button
              onClick={lockPD}
              disabled={!metrics}
              className={`w-full h-14 rounded-2xl text-base font-semibold transition-all mb-3 ${
                metrics ? 'bg-zinc-900 text-white active:scale-[0.98]' : 'bg-zinc-100 text-zinc-400'
              }`}
            >
              Lock measurement
            </button>
            <button
              onClick={handleSkip}
              className="w-full h-11 rounded-xl text-sm font-medium text-zinc-500 flex items-center justify-center gap-1.5"
            >
              Skip — enter bridge width manually
              <ChevronRight size={14} />
            </button>
          </>
        )}

        {/* Manual entry (skip mode) */}
        {skipped && (
          <>
            <p className="section-label mb-2">Bridge width</p>
            <div className="card px-4 py-4 flex items-center justify-between mb-4">
              <button
                onClick={() => setManualBridge(v => Math.max(12, v - 0.5))}
                className="w-10 h-10 rounded-xl bg-zinc-100 flex items-center justify-center active:bg-zinc-200"
              >
                <Minus size={16} />
              </button>
              <div className="text-center">
                <span className="text-3xl font-bold text-zinc-900">{manualBridge.toFixed(1)}</span>
                <span className="text-base text-zinc-400 ml-1">mm</span>
              </div>
              <button
                onClick={() => setManualBridge(v => Math.min(30, v + 0.5))}
                className="w-10 h-10 rounded-xl bg-zinc-100 flex items-center justify-center active:bg-zinc-200"
              >
                <Plus size={16} />
              </button>
            </div>
            <p className="text-xs text-zinc-400 text-center mb-6">
              Typical adult range: 14–22 mm. Default is 18 mm.
            </p>
            <button
              onClick={handleManualConfirm}
              className="w-full h-14 rounded-2xl bg-zinc-900 text-white text-base font-semibold active:scale-[0.98] transition-all"
            >
              Continue with {manualBridge.toFixed(1)} mm
            </button>
          </>
        )}

        {/* Locked state */}
        {locked && lockedMetrics && (
          <>
            <div className="card divide-y divide-zinc-100 mb-5">
              <div className="px-4 py-4 flex items-center justify-between">
                <span className="text-sm text-zinc-500">Pupillary distance</span>
                <span className="text-xl font-bold text-zinc-900">{lockedMetrics.pdMm.toFixed(1)} mm</span>
              </div>
              <div className="px-4 py-4 flex items-center justify-between">
                <span className="text-sm text-zinc-500">Bridge width</span>
                <span className="text-xl font-bold text-zinc-900">{lockedMetrics.bridgeMm.toFixed(1)} mm</span>
              </div>
              <div className="px-4 py-3.5 flex items-center justify-between">
                <span className="text-sm text-zinc-500">Based on</span>
                <span className="text-xs text-zinc-500">Iris diameter (11.7 mm reference)</span>
              </div>
            </div>
            <p className="text-xs text-zinc-400 text-center mb-2">
              You can fine-tune the bridge width on the next screen.
            </p>
          </>
        )}
      </div>

      <BottomBar
        label="Continue to customize"
        to="/customize"
        disabled={!confirmed}
      />
    </div>
  )
}
