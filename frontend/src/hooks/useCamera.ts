import { useRef, useState, useCallback } from 'react'

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

  const startCamera = useCallback(async (facingMode: FacingMode = 'environment') => {
    setError(null)
    try {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop())
      }
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode,
          width: { ideal: 3840 },
          height: { ideal: 2160 },
        },
        audio: false,
      })
      streamRef.current = mediaStream
      setStream(mediaStream)
      setIsActive(true)
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream
        await videoRef.current.play()
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Camera unavailable'
      if (msg.includes('denied') || msg.includes('NotAllowed')) {
        setError('Camera access denied. Please allow camera access and try again, or upload a photo.')
      } else {
        setError('Could not access camera. Try uploading a photo instead.')
      }
      setIsActive(false)
    }
  }, [])

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop())
      streamRef.current = null
      setStream(null)
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null
    }
    setIsActive(false)
  }, [])

  const captureFrame = useCallback((): File | null => {
    const video = videoRef.current
    if (!video || !streamRef.current) return null

    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(video, 0, 0)

    // Synchronous blob is not possible — return a File from dataURL
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
