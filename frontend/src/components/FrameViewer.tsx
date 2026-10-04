import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { RotateCcw } from 'lucide-react'

type FrameViewerProps = {
  color: string
  colorLabel: string
}

/** A self-contained, responsive product viewer for the supplied glasses model. */
export default function FrameViewer({ color, colorLabel }: FrameViewerProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const materialRef = useRef<THREE.MeshStandardMaterial[]>([])
  const resetCameraRef = useRef<(() => void) | null>(null)
  const colorRef = useRef(color)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')

  colorRef.current = color

  useEffect(() => {
    const isCrystal = color === '#d4d4d4'
    for (const material of materialRef.current) {
      material.color.set(color)
      material.transparent = isCrystal
      material.opacity = isCrystal ? 0.72 : 1
      material.needsUpdate = true
    }
  }, [color])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    let disposed = false
    let frameId = 0
    const scene = new THREE.Scene()
    scene.background = new THREE.Color('#f4f4f5')

    const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 100)
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.05
    host.appendChild(renderer.domElement)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.07
    controls.enablePan = false
    controls.minDistance = 1.4
    controls.maxDistance = 5

    scene.add(new THREE.HemisphereLight(0xffffff, 0xd4d4d8, 2.3))
    const key = new THREE.DirectionalLight(0xffffff, 3)
    key.position.set(3, 4, 5)
    key.castShadow = true
    scene.add(key)
    const rim = new THREE.DirectionalLight(0xffffff, 1.4)
    rim.position.set(-4, 1, -3)
    scene.add(rim)

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(20, 20),
      new THREE.ShadowMaterial({ color: 0x18181b, opacity: 0.14 }),
    )
    floor.rotation.x = -Math.PI / 2
    floor.position.y = -0.63
    floor.receiveShadow = true
    scene.add(floor)

    const resize = () => {
      const { width, height } = host.getBoundingClientRect()
      if (!width || !height) return
      camera.aspect = width / height
      camera.updateProjectionMatrix()
      renderer.setSize(width, height, false)
    }
    const resizeObserver = new ResizeObserver(resize)
    resizeObserver.observe(host)
    resize()

    const resetCamera = () => {
      camera.position.set(0, 0.2, 3.1)
      controls.target.set(0, -0.05, 0)
      controls.update()
    }
    resetCamera()
    resetCameraRef.current = resetCamera

    new GLTFLoader().load(
      '/reading_glasses.glb',
      gltf => {
        if (disposed) return
        const model = gltf.scene
        const bounds = new THREE.Box3().setFromObject(model)
        const center = bounds.getCenter(new THREE.Vector3())
        const size = bounds.getSize(new THREE.Vector3())
        // Normalize asset units so it remains predictably framed whatever export scale was used.
        const scale = 2.4 / Math.max(size.x, size.y, size.z)
        model.scale.setScalar(scale)
        model.position.set(-center.x * scale, -center.y * scale, -center.z * scale)
        model.rotation.x = -0.08

        const materials: THREE.MeshStandardMaterial[] = []
        model.traverse(child => {
          if (!(child instanceof THREE.Mesh)) return
          child.castShadow = true
          child.receiveShadow = true
          const source = Array.isArray(child.material) ? child.material[0] : child.material
          const material = new THREE.MeshStandardMaterial({
            color: colorRef.current,
            roughness: 0.32,
            metalness: 0.04,
            transparent: colorRef.current === '#d4d4d4',
            opacity: colorRef.current === '#d4d4d4' ? 0.72 : 1,
          })
          if (source?.map) material.map = source.map
          child.material = material
          materials.push(material)
        })
        materialRef.current = materials
        scene.add(model)
        setStatus('ready')
      },
      undefined,
      () => !disposed && setStatus('error'),
    )

    const render = () => {
      frameId = requestAnimationFrame(render)
      controls.update()
      renderer.render(scene, camera)
    }
    render()

    return () => {
      disposed = true
      cancelAnimationFrame(frameId)
      resizeObserver.disconnect()
      controls.dispose()
      scene.traverse(object => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose()
          const materials = Array.isArray(object.material) ? object.material : [object.material]
          materials.forEach(material => material.dispose())
        }
      })
      renderer.dispose()
      renderer.domElement.remove()
      materialRef.current = []
      resetCameraRef.current = null
    }
  }, []) // The scene is created once; color is applied by the effect above.

  return (
    <div className="relative h-64 overflow-hidden rounded-2xl border border-zinc-200 bg-zinc-100">
      <div ref={hostRef} className="absolute inset-0 touch-none" aria-label={`Interactive 3D preview of ${colorLabel} glasses`} />
      {status === 'loading' && (
        <div className="absolute inset-0 grid place-items-center bg-zinc-100/80 text-xs font-medium text-zinc-500">Loading 3D preview…</div>
      )}
      {status === 'error' && (
        <div className="absolute inset-0 grid place-items-center bg-zinc-100 px-8 text-center text-xs text-zinc-500">The 3D frame preview could not be loaded.</div>
      )}
      {status === 'ready' && <p className="pointer-events-none absolute bottom-3 left-3 rounded-full bg-white/85 px-2.5 py-1 text-[10px] font-medium text-zinc-500 shadow-sm">Drag to rotate · scroll to zoom</p>}
      <button
        type="button"
        onClick={() => resetCameraRef.current?.()}
        className="absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-full bg-white/90 text-zinc-600 shadow-sm transition hover:bg-white"
        aria-label="Reset 3D view"
      >
        <RotateCcw size={15} />
      </button>
    </div>
  )
}
