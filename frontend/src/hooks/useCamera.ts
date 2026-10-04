import { useRef, useState, useCallback, useEffect } from 'react'

export type FacingMode = 'environment' | 'user'

interface UseCameraReturn {
  videoRef: React.RefObject<HTMLVideoElement | null>
  stream: MediaStream | null
  error: string | null
  isActive: boolean
  startCamera: (facingMode?: FacingMode) => Promise<void>
  stopCamera: () => void
  captureFrame: () => File | null
}

export function useCamera(): UseCameraReturn {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isActive, setIsActive] = useState(false)

  // Whenever the stream changes, attach it to the video element.
  // This decouples stream acquisition (async) from DOM attachment, eliminating
  // the race condition where videoRef.current is null during the getUserMedia await.
  useEffect(() => {
    const video = videoRef.current
    if (!video || !stream) return
    if (video.srcObject === stream) return // already attached
    video.srcObject = stream
    video.play().catch(() => {
      // Autoplay may be blocked briefly on first interaction — safe to ignore.
      // The stream is still attached; user interaction will unblock it.
    })
  }, [stream])

  const startCamera = useCallback(async (facingMode: FacingMode = 'environment') => {
    setError(null)
    try {
      // Stop any existing stream first
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop())
        streamRef.current = null
      }

      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: facingMode },
          width: { ideal: 3840 },
          height: { ideal: 2160 },
        },
        audio: false,
      })

      streamRef.current = mediaStream
      // Setting state triggers the useEffect above to attach to the video element
      setStream(mediaStream)
      setIsActive(true)
    } catch (err) {
      const name = err instanceof Error ? (err as { name?: string }).name ?? '' : ''
      const msg  = err instanceof Error ? err.message : ''

      if (name === 'NotAllowedError' || msg.includes('denied') || msg.includes('Permission')) {
        setError('Camera access denied. Please allow camera access in your browser settings, or upload a photo instead.')
      } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
        setError('No camera found on this device. Please upload a photo instead.')
      } else {
        setError('Could not start the camera. Please upload a photo instead.')
      }
      setIsActive(false)
    }
  }, [])

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop())
      streamRef.current = null
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null
    }
    setStream(null)
    setIsActive(false)
  }, [])

  const captureFrame = useCallback((): File | null => {
    const video = videoRef.current
    if (!video || !streamRef.current) return null
    if (video.videoWidth === 0) return null // not yet playing

    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(video, 0, 0)

    const dataUrl = canvas.toDataURL('image/jpeg', 0.95)
    const arr = dataUrl.split(',')
    const mime = arr[0].match(/:(.*?);/)![1]
    const bstr = atob(arr[1])
    const u8arr = new Uint8Array(bstr.length)
    for (let i = 0; i < bstr.length; i++) u8arr[i] = bstr.charCodeAt(i)
    const blob = new Blob([u8arr], { type: mime })
    return new File([blob], `lens-capture-${Date.now()}.jpg`, { type: mime })
  }, [])

  return { videoRef, stream, error, isActive, startCamera, stopCamera, captureFrame }
}
