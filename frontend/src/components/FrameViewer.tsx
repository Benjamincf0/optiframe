import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { RotateCcw } from 'lucide-react'
import type { FrameParams } from '../context/SessionContext'
import type { MeasureResponse, Pattern } from '../api/types'

type FrameViewerProps = {
  color: string
  colorLabel: string
  pattern: Pattern
  measurements: MeasureResponse | null
  frameParams: FrameParams
}

type Point = [number, number]

const disposeObject = (object: THREE.Object3D) => {
  object.traverse(child => {
    if (!(child instanceof THREE.Mesh)) return
    child.geometry.dispose()
    const materials = Array.isArray(child.material) ? child.material : [child.material]
    materials.forEach(material => material.dispose())
  })
}

function centreContour(points: Point[]) {
  const xs = points.map(([x]) => x)
  const ys = points.map(([, y]) => y)
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2
  return {
    points: points.filter((_, i) => i % Math.max(1, Math.ceil(points.length / 240)) === 0)
      .map(([x, y]) => [x - cx, y - cy] as Point),
    width: Math.max(...xs) - Math.min(...xs),
  }
}

function ringShape(points: Point[], cx: number, rim: number) {
  const outer = points.map(([x, y]) => {
    const length = Math.hypot(x, y) || 1
    return [x + (x / length) * rim + cx, y + (y / length) * rim] as Point
  })
  const shape = new THREE.Shape()
  shape.moveTo(outer[0][0], outer[0][1])
  outer.slice(1).forEach(([x, y]) => shape.lineTo(x, y))
  shape.closePath()
  const hole = new THREE.Path()
  hole.moveTo(points[0][0] + cx, points[0][1])
  points.slice(1).forEach(([x, y]) => hole.lineTo(x + cx, y))
  hole.closePath()
  shape.holes.push(hole)
  return shape
}

function patternTexture(pattern: Exclude<Pattern, 'none'>) {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 96
  const context = canvas.getContext('2d')!
  // MeshStandardMaterial tints its map with `color`; use a white base here so
  // the selected finish keeps its true colour instead of being multiplied by itself.
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, 96, 96)
  const ink = pattern === 'dots' ? 'rgba(45, 30, 18, .42)' : 'rgba(0, 0, 0, .24)'
  context.strokeStyle = ink
  context.fillStyle = ink
  context.lineWidth = 3

  if (pattern === 'dots') {
    for (let x = 12; x < 96; x += 24) for (let y = 12; y < 96; y += 24) {
      context.beginPath(); context.arc(x, y, 3, 0, Math.PI * 2); context.fill()
    }
  } else if (pattern === 'brushed') {
    for (let y = 8; y < 96; y += 12) { context.beginPath(); context.moveTo(0, y); context.lineTo(96, y - 8); context.stroke() }
  } else if (pattern === 'woven') {
    for (let i = 0; i < 96; i += 16) {
      context.beginPath(); context.moveTo(i, 0); context.lineTo(i, 96); context.stroke()
      context.beginPath(); context.moveTo(0, i); context.lineTo(96, i); context.stroke()
    }
  } else {
    for (let y = 10; y < 96; y += 18) for (let x = 10; x < 96; x += 20) {
      context.beginPath(); context.arc(x, y, 7, 0, Math.PI * 2); context.stroke()
    }
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  texture.repeat.set(0.08, 0.08)
  return texture
}

/** A contour-driven product preview. Its rims use the same measured lens outlines as the generated frame. */
export default function FrameViewer({ color, colorLabel, pattern, measurements, frameParams }: FrameViewerProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const resetCameraRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host || !measurements) return
    let frameId = 0
    const scene = new THREE.Scene()
    scene.background = new THREE.Color('#f4f4f5')
    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 1000)
    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.shadowMap.enabled = true
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    host.appendChild(renderer.domElement)
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.07
    controls.enablePan = false
    controls.minDistance = 45
    controls.maxDistance = 450
    scene.add(new THREE.HemisphereLight(0xffffff, 0xd4d4d8, 2.2))
    const key = new THREE.DirectionalLight(0xffffff, 3)
    key.position.set(30, 40, 60)
    key.castShadow = true
    scene.add(key)
    const rimLight = new THREE.DirectionalLight(0xffffff, 1.1)
    rimLight.position.set(-35, 15, -40)
    scene.add(rimLight)

    const finishMap = pattern === 'none' ? null : patternTexture(pattern)
    const material = new THREE.MeshStandardMaterial({ color, map: finishMap, roughness: 0.32, metalness: 0.04, transparent: color === '#d4d4d4', opacity: color === '#d4d4d4' ? 0.72 : 1 })
    const glasses = new THREE.Group()
    const right = centreContour(measurements.right.contour_mm)
    const left = centreContour(measurements.left.contour_mm)
    const rightX = -(frameParams.bridgeMm / 2 + right.width / 2)
    const leftX = frameParams.bridgeMm / 2 + left.width / 2
    const rim = 1.2 + frameParams.rimOffsetMm + frameParams.clipClearanceMm
    const depth = frameParams.depthMm
    for (const [contour, x] of [[right, rightX], [left, leftX]] as const) {
      const geometry = new THREE.ExtrudeGeometry(ringShape(contour.points, x, rim), { depth, bevelEnabled: true, bevelThickness: 0.22, bevelSize: 0.22, bevelSegments: 2 })
      const mesh = new THREE.Mesh(geometry, material)
      mesh.castShadow = true
      mesh.receiveShadow = true
      glasses.add(mesh)
    }

    // Match the generated front's bridge and tenons; include visual temples for the style view.
    const bridgeY = Math.min(measurements.right.B, measurements.left.B) * 0.15
    const bridge = new THREE.Mesh(new THREE.BoxGeometry(frameParams.bridgeMm + 3, 4, depth), material)
    bridge.position.set(0, bridgeY, depth / 2)
    glasses.add(bridge)
    const outerRight = rightX - right.width / 2 - rim
    const outerLeft = leftX + left.width / 2 + rim
    for (const [side, outerX] of [[-1, outerRight], [1, outerLeft]] as const) {
      const tenon = new THREE.Mesh(new THREE.BoxGeometry(11, 7, depth), material)
      tenon.position.set(outerX + side * 5.5, bridgeY, depth / 2)
      glasses.add(tenon)
      const path = new THREE.CatmullRomCurve3([
        new THREE.Vector3(outerX + side * 10, bridgeY, depth / 2),
        new THREE.Vector3(outerX + side * 13, bridgeY + 1, -8),
        new THREE.Vector3(outerX + side * 15, bridgeY - 2, -40),
        new THREE.Vector3(outerX + side * 10, bridgeY - 12, -63),
      ])
      const temple = new THREE.Mesh(new THREE.TubeGeometry(path, 24, 1.25, 8, false), material)
      temple.castShadow = true
      glasses.add(temple)
    }

    const bounds = new THREE.Box3().setFromObject(glasses)
    const centre = bounds.getCenter(new THREE.Vector3())
    glasses.position.sub(centre)
    scene.add(glasses)
    const size = bounds.getSize(new THREE.Vector3())
    const resetCamera = (width = host.clientWidth, height = host.clientHeight) => {
      const aspect = width / height || 1
      const verticalFov = THREE.MathUtils.degToRad(camera.fov)
      const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * aspect)
      // Frame against the current canvas ratio and account for the temples' depth.
      // This keeps the entire frame in view at the default angle.
      const frontDistance = Math.max(
        size.x / (2 * Math.tan(horizontalFov / 2)),
        size.y / (2 * Math.tan(verticalFov / 2)),
      ) * 1.18
      const distance = frontDistance + size.z / 2
      camera.position.set(distance * 0.06, distance * 0.08, distance)
      controls.target.set(0, 0, 0)
      controls.update()
    }
    resetCamera()
    resetCameraRef.current = resetCamera
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.ShadowMaterial({ color: 0x18181b, opacity: 0.12 }))
    floor.rotation.x = -Math.PI / 2
    floor.position.y = -size.y / 2 - 8
    floor.receiveShadow = true
    scene.add(floor)
    const resize = () => {
      const { width, height } = host.getBoundingClientRect()
      if (!width || !height) return
      camera.aspect = width / height
      camera.updateProjectionMatrix()
      renderer.setSize(width, height, false)
      resetCamera(width, height)
    }
    const observer = new ResizeObserver(resize)
    observer.observe(host)
    resize()
    const render = () => {
      frameId = requestAnimationFrame(render)
      controls.update()
      renderer.render(scene, camera)
    }
    render()
    return () => {
      cancelAnimationFrame(frameId)
      observer.disconnect()
      controls.dispose()
      disposeObject(glasses)
      finishMap?.dispose()
      floor.geometry.dispose()
      ;(floor.material as THREE.Material).dispose()
      renderer.dispose()
      renderer.domElement.remove()
      resetCameraRef.current = null
    }
  }, [color, frameParams, measurements, pattern])

  if (!measurements) return null
  return (
    <div className="relative h-52 overflow-hidden rounded-2xl border border-zinc-200 bg-zinc-100">
      <div ref={hostRef} className="absolute inset-0 touch-none" aria-label={`Interactive 3D preview of ${colorLabel} glasses`} />
      <p className="pointer-events-none absolute bottom-3 left-3 rounded-full bg-white/85 px-2.5 py-1 text-[10px] font-medium text-zinc-500 shadow-sm">Measured frame shape · Drag to rotate</p>
      <button type="button" onClick={() => resetCameraRef.current?.()} className="absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-full bg-white/90 text-zinc-600 shadow-sm transition hover:bg-white" aria-label="Reset 3D view">
        <RotateCcw size={15} />
      </button>
    </div>
  )
}
