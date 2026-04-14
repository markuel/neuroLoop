import { useRef, useEffect, useMemo } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import useStore from '../stores/useStore'
import { activationsToColors } from '../utils/colorscale'

function BrainMesh() {
  const meshRef = useRef()
  const mesh = useStore((s) => s.mesh)
  const preds = useStore((s) => s.preds)
  const timestep = useStore((s) => s.timestep)
  const globalVmin = useStore((s) => s.globalVmin)
  const globalVmax = useStore((s) => s.globalVmax)

  const geometry = useMemo(() => {
    if (!mesh) return null
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(mesh.vertices, 3))
    geo.setIndex(new THREE.BufferAttribute(mesh.faces, 1))
    geo.computeVertexNormals()
    // Initialize to gray brain surface color (matches sulcal background)
    const colors = new Float32Array(mesh.nVertices * 3)
    for (let i = 0; i < mesh.nVertices; i++) {
      colors[i * 3] = 0.42
      colors[i * 3 + 1] = 0.42
      colors[i * 3 + 2] = 0.42
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
    return geo
  }, [mesh])

  useEffect(() => {
    if (!geometry || !preds || !preds[timestep]) return
    const activations = preds[timestep]
    // Use global min/max (1st/99th percentile) for consistent colorscale across time
    const colors = activationsToColors(activations, globalVmin, globalVmax)
    geometry.attributes.color.array.set(colors)
    geometry.attributes.color.needsUpdate = true
  }, [geometry, preds, timestep, globalVmin, globalVmax])

  if (!geometry) return null

  return (
    <mesh ref={meshRef} geometry={geometry}>
      <meshStandardMaterial vertexColors side={THREE.DoubleSide} />
    </mesh>
  )
}

export default function BrainViewer() {
  return (
    <div className="w-full h-full bg-gray-900 rounded-lg overflow-hidden">
      <Canvas camera={{ position: [-180, 30, 120], fov: 40, near: 1, far: 2000 }}>
        <ambientLight intensity={0.7} />
        <directionalLight position={[100, 150, 100]} intensity={0.6} />
        <directionalLight position={[-100, -50, -100]} intensity={0.3} />
        <BrainMesh />
        <OrbitControls
          enableDamping
          dampingFactor={0.15}
          rotateSpeed={0.8}
          zoomSpeed={0.6}
          panSpeed={0.5}
          minDistance={100}
          maxDistance={600}
          target={[0, 0, 0]}
          mouseButtons={{
            LEFT: THREE.MOUSE.ROTATE,
            MIDDLE: THREE.MOUSE.DOLLY,
            RIGHT: THREE.MOUSE.PAN,
          }}
          touches={{
            ONE: THREE.TOUCH.ROTATE,
            TWO: THREE.TOUCH.DOLLY_PAN,
          }}
        />
      </Canvas>
    </div>
  )
}
