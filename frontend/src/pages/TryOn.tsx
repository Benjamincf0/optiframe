import { useEffect, useRef, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import * as THREE from 'three'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'
import { Download, Camera, Minus, Plus, ShoppingBag, AlertTriangle } from 'lucide-react'
import { useCamera } from '../hooks/useCamera'
import { useFaceMesh, IRIS_LEFT, IRIS_RIGHT, IRIS_LEFT_BOUNDARY } from '../hooks/useFaceMesh'
import { useSession } from '../context/SessionContext'
import type { NormalizedLandmark } from '@mediapipe/tasks-vision'

const IRIS_DIAMETER_MM = 11.7

const COLOR_MAP: Record<string, number> = {
  black: 0x1a1a1a,
  tortoise: 0x7c4a1e,
  crystal: 0xd4d4d4,
  navy: 0x1e3a5f,
  bone: 0xe8d8c0,
  olive: 0x6b7c3b,
}

export default function TryOn() {
  const navigate = useNavigate()
  const { state } = useSession()
  const { videoRef, isActive, startCamera, stopCamera } = useCamera()
  const { isReady, isLoading, metrics, startDetection, stopDetection } = useFaceMesh()

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const sceneRef = useRef<THREE.Scene | null>(null)
  const cameraRef = useRef<THREE.OrthographicCamera | null>(null)
  const meshRef = useRef<THREE.Mesh | null>(null)
  const rafRef = useRef<number | null>(null)
  const landmarksRef = useRef<NormalizedLandmark[] | null>(null)

  const [bridgeAdj, setBridgeAdj] = useState(0)
  const [vertAdj, setVertAdj] = useState(0)
  const [snapshot, setSnapshot] = useState<string | null>(null)
  const [stlError, setStlError] = useState<string | null>(null)

  const { stlBlob, stlHeaders, customize } = state
  const frameColor = COLOR_MAP[customize.color] ?? 0x1a1a1a

  // Sync face landmarks into ref for the three.js render loop
  useEffect(() => {
    if (metrics) landmarksRef.current = metrics.landmarks
    else landmarksRef.current = null
  }, [metrics])

  function initThree(canvas: HTMLCanvasElement, W: number, H: number) {
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true })
    renderer.setPixelRatio(window.devicePixelRatio)
    renderer.setSize(W, H)
    renderer.setClearColor(0x000000, 0)
    rendererRef.current = renderer

    const scene = new THREE.Scene()
    sceneRef.current = scene

    const cam = new THREE.OrthographicCamera(-W / 2, W / 2, H / 2, -H / 2, 0.1, 10000)
    cam.position.z = 1000
    cameraRef.current = cam

    scene.add(new THREE.AmbientLight(0xffffff, 0.7))
    const dir = new THREE.DirectionalLight(0xffffff, 0.8)
    dir.position.set(0, 100, 500)
    scene.add(dir)
    const fill = new THREE.DirectionalLight(0xffffff, 0.3)
    fill.position.set(0, -100, 200)
    scene.add(fill)
  }

  async function loadSTL(blob: Blob) {
    try {
      const buf = await blob.arrayBuffer()
      const loader = new STLLoader()
      const geo = loader.parse(buf)
      geo.computeVertexNormals()

      const mat = new THREE.MeshStandardMaterial({
        color: frameColor,
        roughness: 0.6,
        metalness: 0.05,
      })

      if (meshRef.current && sceneRef.current) {
        sceneRef.current.remove(meshRef.current)
        meshRef.current.geometry.dispose()
      }

      const mesh = new THREE.Mesh(geo, mat)
      // STL +z is outer face; flip to face camera
      mesh.rotation.x = Math.PI
      sceneRef.current?.add(mesh)
      meshRef.current = mesh
    } catch {
      setStlError('Could not load the 3D frame. Try regenerating.')
    }
  }

  const animate = useCallback(() => {
    rafRef.current = requestAnimationFrame(animate)
    const renderer = rendererRef.current
    const scene = sceneRef.current
    const camera = cameraRef.current
    const mesh = meshRef.current
    const video = videoRef.current

    if (!renderer || !scene || !camera) return
    if (!mesh || !video || !landmarksRef.current) {
      renderer.render(scene, camera)
      return
    }

    const lms = landmarksRef.current
    const W = video.videoWidth || 640
    const H = video.videoHeight || 480

    // Front camera: video is CSS scaleX(-1), so flip landmark X for scene
    const toScene = (lm: NormalizedLandmark) => ({
      x: (0.5 - lm.x) * W,
      y: (0.5 - lm.y) * H,
    })

    const lIris = toScene(lms[IRIS_LEFT])
    const rIris = toScene(lms[IRIS_RIGHT])
    const lBound = toScene(lms[IRIS_LEFT_BOUNDARY])

    const irisRadiusPx = Math.hypot(lIris.x - lBound.x, lIris.y - lBound.y)
    const pxPerMm = (2 * irisRadiusPx) / IRIS_DIAMETER_MM

    // Bridge center: midpoint of iris positions, shifted down ~3 mm below eye line
    const bx = (lIris.x + rIris.x) / 2 + bridgeAdj * pxPerMm
    const by = (lIris.y + rIris.y) / 2 - (3 + vertAdj) * pxPerMm

    const tilt = Math.atan2(rIris.y - lIris.y, rIris.x - lIris.x)

    mesh.position.set(bx, by, 0)
    mesh.rotation.z = -tilt
    mesh.scale.setScalar(pxPerMm)

    renderer.render(scene, camera)
  }, [bridgeAdj, vertAdj, videoRef])

  useEffect(() => {
    if (!stlBlob) { navigate('/customize'); return }

    async function boot() {
      await startCamera('user')
      const canvas = canvasRef.current
      if (canvas) {
        const W = canvas.parentElement?.clientWidth ?? window.innerWidth
        const H = Math.round(W * 4 / 3)
        canvas.width = W
        canvas.height = H
        initThree(canvas, W, H)
      }
      if (stlBlob) await loadSTL(stlBlob)
      rafRef.current = requestAnimationFrame(animate)
    }

    boot()

    return () => {
      stopCamera()
      stopDetection()
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      rendererRef.current?.dispose()
    }
  }, []) // eslint-disable-line

  useEffect(() => {
    if (isReady && isActive && videoRef.current) {
      startDetection(videoRef.current)
    }
  }, [isReady, isActive]) // eslint-disable-line

  // Restart render loop when adjustments change
  useEffect(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(animate)
  }, [animate])

  function takeSnapshot() {
    const canvas = canvasRef.current
    const video = videoRef.current
    if (!canvas || !video) return

    const tmp = document.createElement('canvas')
    tmp.width = canvas.width
    tmp.height = canvas.height
    const ctx = tmp.getContext('2d')!
    // Mirror video then overlay three.js canvas
    ctx.save()
    ctx.translate(tmp.width, 0)
    ctx.scale(-1, 1)
    ctx.drawImage(video, 0, 0, tmp.width, tmp.height)
    ctx.restore()
    ctx.drawImage(canvas, 0, 0)
    setSnapshot(tmp.toDataURL('image/jpeg', 0.9))
  }

  function downloadSTL() {
    if (!stlBlob) return
    const url = URL.createObjectURL(stlBlob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'monture.stl'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="page-container bg-zinc-900">
      {/* AR viewport */}
      <div className="relative w-full aspect-[3/4] bg-zinc-950 overflow-hidden flex-shrink-0">
        <video
          ref={videoRef}
          autoPlay playsInline muted
          className="absolute inset-0 w-full h-full object-cover"
          style={{ transform: 'scaleX(-1)' }}
        />
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full"
        />

        {/* Loading */}
        {(isLoading || !isReady) && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="bg-black/60 backdrop-blur-sm px-5 py-3 rounded-xl text-center">
              <div className="w-8 h-8 border-2 border-white/30 border-t-white rounded-full animate-spin mx-auto mb-2" />
              <p className="text-sm text-white">Loading face tracking…</p>
            </div>
          </div>
        )}

        {stlError && (
          <div className="absolute inset-0 flex items-center justify-center px-8">
            <div className="bg-black/70 backdrop-blur-sm px-5 py-4 rounded-xl text-center">
              <AlertTriangle size={24} className="text-red-400 mx-auto mb-2" />
              <p className="text-sm text-white">{stlError}</p>
            </div>
          </div>
        )}

        {/* Fine-tune controls */}
        <div className="absolute top-4 right-4 flex flex-col gap-2">
          {[
            { label: 'Bridge', get: bridgeAdj, set: setBridgeAdj },
            { label: 'Height', get: vertAdj, set: setVertAdj },
          ].map(({ label, get, set }) => (
            <div key={label} className="bg-white/90 backdrop-blur-sm rounded-xl p-2 flex flex-col items-center gap-1">
              <p className="text-[9px] font-semibold text-zinc-500 uppercase">{label}</p>
              <button onClick={() => set(v => v + 0.5)} className="w-8 h-8 rounded-lg bg-zinc-100 flex items-center justify-center active:bg-zinc-200"><Plus size={14} /></button>
              <span className="text-xs font-mono text-zinc-700">{get > 0 ? '+' : ''}{get.toFixed(1)}</span>
              <button onClick={() => set(v => v - 0.5)} className="w-8 h-8 rounded-lg bg-zinc-100 flex items-center justify-center active:bg-zinc-200"><Minus size={14} /></button>
            </div>
          ))}
        </div>

        {snapshot && (
          <div className="absolute bottom-4 left-4">
            <img src={snapshot} alt="Snapshot" className="w-16 h-20 rounded-xl object-cover border-2 border-white shadow-lg" />
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="bg-white flex-1 px-5 py-5 flex flex-col gap-3">
        {stlHeaders && (
          <div className="flex gap-4 justify-center text-center">
            <div>
              <p className="text-xs text-zinc-400">Volume</p>
              <p className="text-sm font-semibold text-zinc-900">{(stlHeaders.volumeMm3 / 1000).toFixed(1)} cm³</p>
            </div>
            <div className="w-px bg-zinc-200" />
            <div>
              <p className="text-xs text-zinc-400">Weight</p>
              <p className="text-sm font-semibold text-zinc-900">~{(stlHeaders.volumeMm3 * 1.24 / 1000).toFixed(1)} g</p>
            </div>
            <div className="w-px bg-zinc-200" />
            <div>
              <p className="text-xs text-zinc-400">Width</p>
              <p className="text-sm font-semibold text-zinc-900">{stlHeaders.frameWidthMm.toFixed(0)} mm</p>
            </div>
          </div>
        )}

        <div className="flex gap-3">
          <button onClick={takeSnapshot} className="flex-1 h-12 rounded-xl border border-zinc-200 text-sm font-medium text-zinc-700 flex items-center justify-center gap-2 active:bg-zinc-50">
            <Camera size={15} /> Snapshot
          </button>
          <button onClick={downloadSTL} className="flex-1 h-12 rounded-xl border border-zinc-200 text-sm font-medium text-zinc-700 flex items-center justify-center gap-2 active:bg-zinc-50">
            <Download size={15} /> Download STL
          </button>
        </div>

        <button
          onClick={() => navigate('/checkout')}
          className="w-full h-14 rounded-2xl bg-zinc-900 text-white text-base font-semibold flex items-center justify-center gap-2 active:scale-[0.98] transition-all"
        >
          <ShoppingBag size={18} /> Order these frames
        </button>

        <button onClick={() => navigate('/customize')} className="w-full text-sm text-zinc-400 py-1">
          Back to customize
        </button>
      </div>
    </div>
  )
}
