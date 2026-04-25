import { useRef, useMemo, useEffect } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import useStore from '../../stores/useStore'
import { activationsToColors, BRAIN_GRAY_R, BRAIN_GRAY_G, BRAIN_GRAY_B } from '../../utils/colorscale'

/**
 * Expand a region-level activation dict into a per-vertex Float32Array using
 * the region→vertices index from the atlas. Vertices not in any region stay 0.
 */
function expandToVertices(activations, regionVertices, nVertices) {
  const out = new Float32Array(nVertices)
  if (!activations || !regionVertices) return out
  for (const [region, value] of Object.entries(activations)) {
    const idxs = regionVertices[region]
    if (!idxs) continue
    for (const idx of idxs) out[idx] = value
  }
  return out
}

function HeatmapMesh({ activations, mode }) {
  const mesh = useStore(s => s.mesh)
  const regionVertices = useStore(s => s.regionVertices)
  const geoRef = useRef(null)
  const colorsRef = useRef(null)

  const geometryData = useMemo(() => {
    if (!mesh) return null
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(mesh.vertices, 3))
    geo.setIndex(new THREE.BufferAttribute(mesh.faces, 1))
    geo.computeVertexNormals()
    const colors = new Float32Array(mesh.nVertices * 3)
    for (let i = 0; i < mesh.nVertices; i++) {
      colors[i * 3] = BRAIN_GRAY_R
      colors[i * 3 + 1] = BRAIN_GRAY_G
      colors[i * 3 + 2] = BRAIN_GRAY_B
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
    return { geo, colors }
  }, [mesh])

  useEffect(() => {
    colorsRef.current = geometryData?.colors ?? null
    geoRef.current = geometryData?.geo ?? null
  }, [geometryData])

  useEffect(() => {
    if (!geoRef.current || !colorsRef.current || !mesh || !regionVertices || !activations) return
    const verts = expandToVertices(activations, regionVertices, mesh.nVertices)

    // For delta mode we center around 0 with symmetric bounds. For magnitude we
    // fit to [0, max]. Fire colorscale expects values that cross its threshold
    // to light up — so we normalize into the 0.6–1.0 lit range.
    let vmin, vmax
    if (mode === 'delta') {
      const absMax = Math.max(0.05, ...verts.map(Math.abs))
      vmin = -absMax
      vmax = absMax
      // Remap: negative → cool/gray, positive → fire. Since activationsToColors
      // treats one-sided, we shift so 0 maps to gray threshold.
      for (let i = 0; i < verts.length; i++) verts[i] = (verts[i] + absMax) / (2 * absMax)
      vmin = 0
      vmax = 1
    } else {
      vmin = 0
      vmax = Math.max(0.05, ...verts)
    }
    activationsToColors(verts, vmin, vmax, colorsRef.current)
    geoRef.current.attributes.color.needsUpdate = true
  }, [activations, regionVertices, mesh, mode, geometryData])

  if (!geometryData) return null
  return (
    <mesh geometry={geometryData.geo}>
      <meshStandardMaterial vertexColors side={THREE.DoubleSide} />
    </mesh>
  )
}

export default function BrainHeatmap({ activations, title = 'Activations', mode = 'magnitude' }) {
  const mesh = useStore(s => s.mesh)
  return (
    <div className="relative w-full h-full rounded-md overflow-hidden bg-gray-950 border border-gray-800">
      <div className="absolute top-2 left-3 z-10 text-[10px] text-gray-400 uppercase tracking-wider">
        {title}
      </div>
      {!mesh ? (
        <div className="w-full h-full flex items-center justify-center text-xs text-gray-600">
          Loading mesh…
        </div>
      ) : (
        <Canvas
          camera={{ position: [-180, -30, 100], fov: 40, near: 1, far: 2000, up: [0, 0, 1] }}
          onCreated={({ camera }) => { camera.up.set(0, 0, 1); camera.lookAt(0, 0, 0) }}
        >
          <ambientLight intensity={0.7} />
          <directionalLight position={[100, -100, 150]} intensity={0.6} />
          <directionalLight position={[-100, 100, -100]} intensity={0.3} />
          <HeatmapMesh activations={activations} mode={mode} />
          <OrbitControls
            enableDamping
            dampingFactor={0.12}
            rotateSpeed={0.6}
            zoomSpeed={0.7}
            panSpeed={0.5}
            minDistance={100}
            maxDistance={600}
          />
        </Canvas>
      )}
    </div>
  )
}
