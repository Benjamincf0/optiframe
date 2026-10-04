import { useRef, useState, useCallback, useEffect } from 'react'
import type { FaceLandmarker, NormalizedLandmark } from '@mediapipe/tasks-vision'

const WASM_PATH = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/wasm'
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'

// Iris landmark indices (require refineLandmarks: true)
export const IRIS_LEFT = 468   // left iris center (MediaPipe convention)
export const IRIS_RIGHT = 473  // right iris center
export const IRIS_LEFT_BOUNDARY = 469  // one boundary point of left iris
export const IRIS_RIGHT_BOUNDARY = 474

export interface FaceMetrics {
  landmarks: NormalizedLandmark[]
  pdMm: number
  bridgeMm: number
  irisRadiusPx: number
  pxPerMm: number
  videoWidth: number
  videoHeight: number
}

interface UseFaceMeshReturn {
  isReady: boolean
  isLoading: boolean
  error: string | null
  metrics: FaceMetrics | null
  startDetection: (video: HTMLVideoElement) => void
  stopDetection: () => void
  computeMetrics: (video: HTMLVideoElement, leftAMm: number, rightAMm: number) => FaceMetrics | null
}

const IRIS_DIAMETER_MM = 11.7 // average adult corneal diameter

export function useFaceMesh(): UseFaceMeshReturn {
  const landmarkerRef = useRef<FaceLandmarker | null>(null)
  const rafRef = useRef<number | null>(null)
  const [isReady, setIsReady] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [metrics, setMetrics] = useState<FaceMetrics | null>(null)

  // Lazy-load MediaPipe (large WASM, load once)
  const ensureLoaded = useCallback(async () => {
    if (landmarkerRef.current) return
    setIsLoading(true)
    setError(null)
    try {
      const { FilesetResolver, FaceLandmarker } = await import('@mediapipe/tasks-vision')
      const vision = await FilesetResolver.forVisionTasks(WASM_PATH)
      const lm = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
        runningMode: 'VIDEO',
        numFaces: 1,
        outputFaceBlendshapes: false,
        outputFacialTransformationMatrixes: false,
      })
      landmarkerRef.current = lm
      setIsReady(true)
    } catch {
      setError('Could not load face detection model. Check your connection and try again.')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    ensureLoaded()
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [ensureLoaded])

  function extractMetrics(
    landmarks: NormalizedLandmark[],
    video: HTMLVideoElement,
    leftAMm: number,
    rightAMm: number,
  ): FaceMetrics {
    const W = video.videoWidth || 640
    const H = video.videoHeight || 480

    const leftCenter = landmarks[IRIS_LEFT]
    const rightCenter = landmarks[IRIS_RIGHT]
    const leftBoundary = landmarks[IRIS_LEFT_BOUNDARY]

    // Pixel coords (front camera is mirrored — flip X for user perspective)
    const toPx = (lm: NormalizedLandmark) => ({
      x: (1 - lm.x) * W,
      y: lm.y * H,
    })

    const lPx = toPx(leftCenter)
    const rPx = toPx(rightCenter)
    const lBPx = toPx(leftBoundary)

    const irisRadiusPx = Math.hypot(lPx.x - lBPx.x, lPx.y - lBPx.y)
    const pxPerMm = (2 * irisRadiusPx) / IRIS_DIAMETER_MM

    const pdPx = Math.hypot(lPx.x - rPx.x, lPx.y - rPx.y)
    const pdMm = pdPx / pxPerMm

    // PD = bridge_mm + A_left/2 + A_right/2  →  bridge = PD - (A_left + A_right)/2
    const bridgeMm = Math.max(12, Math.min(30, pdMm - (leftAMm + rightAMm) / 2))

    return { landmarks, pdMm, bridgeMm, irisRadiusPx, pxPerMm, videoWidth: W, videoHeight: H }
  }

  const computeMetrics = useCallback(
    (video: HTMLVideoElement, leftAMm: number, rightAMm: number): FaceMetrics | null => {
      const lm = landmarkerRef.current
      if (!lm) return null
      const results = lm.detectForVideo(video, performance.now())
      if (!results.faceLandmarks.length) return null
      return extractMetrics(results.faceLandmarks[0], video, leftAMm, rightAMm)
    },
    [],
  )

  const startDetection = useCallback(
    (video: HTMLVideoElement) => {
      if (!landmarkerRef.current) return

      const detect = () => {
        if (!landmarkerRef.current || video.paused || video.ended) return
        const results = landmarkerRef.current.detectForVideo(video, performance.now())
        if (results.faceLandmarks.length) {
          const m = extractMetrics(results.faceLandmarks[0], video, 0, 0)
          setMetrics(m)
        } else {
          setMetrics(null)
        }
        rafRef.current = requestAnimationFrame(detect)
      }
      rafRef.current = requestAnimationFrame(detect)
    },
    [],
  )

  const stopDetection = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    setMetrics(null)
  }, [])

  return { isReady, isLoading, error, metrics, startDetection, stopDetection, computeMetrics }
}
