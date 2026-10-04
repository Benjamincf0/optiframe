import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'

type STLThumbnailProps = { blob: Blob; color: string }

/** A compact, static render of the exact STL that will be sent to production. */
export default function STLThumbnail({ blob, color }: STLThumbnailProps) {
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let disposed = false
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    host.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 1000)
    camera.position.set(0, 0, 180)
    scene.add(new THREE.HemisphereLight(0xffffff, 0xd4d4d8, 2.3))
    const key = new THREE.DirectionalLight(0xffffff, 2.4)
    key.position.set(35, 45, 90)
    scene.add(key)

    let mesh: THREE.Mesh | null = null
    const material = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.36,
      metalness: 0.04,
      transparent: color === '#d4d4d4',
      opacity: color === '#d4d4d4' ? 0.72 : 1,
    })
    const render = () => renderer.render(scene, camera)
    const resize = () => {
      const { width, height } = host.getBoundingClientRect()
      if (!width || !height) return
      renderer.setSize(width, height, false)
      camera.aspect = width / height
      camera.updateProjectionMatrix()
      render()
    }
    const observer = new ResizeObserver(resize)
    observer.observe(host)

    blob.arrayBuffer().then(buffer => {
      if (disposed) return
      const geometry = new STLLoader().parse(buffer)
      geometry.computeVertexNormals()
      mesh = new THREE.Mesh(geometry, material)
      // Generated STLs are front-facing along +z; this presents that same front.
      mesh.rotation.x = Math.PI
      const bounds = new THREE.Box3().setFromObject(mesh)
      const centre = bounds.getCenter(new THREE.Vector3())
      mesh.position.sub(centre)
      const size = bounds.getSize(new THREE.Vector3())
      const distance = Math.max(size.x / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect), size.y / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)))) * 1.25 + size.z / 2
      camera.position.set(0, size.y * 0.04, distance)
      scene.add(mesh)
      resize()
    }).catch(() => undefined)

    resize()
    return () => {
      disposed = true
      observer.disconnect()
      if (mesh) mesh.geometry.dispose()
      material.dispose()
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [blob, color])

  return <div ref={hostRef} className="h-full w-full" aria-label="Preview of your generated frame" />
}
