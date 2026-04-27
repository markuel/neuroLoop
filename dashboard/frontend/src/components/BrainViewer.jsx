import { useRef, useMemo } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, GizmoHelper, GizmoViewcube } from '@react-three/drei'
import * as THREE from 'three'
import useStore from '../stores/useStore'
import { activationsToColors, BRAIN_GRAY_R, BRAIN_GRAY_G, BRAIN_GRAY_B } from '../utils/colorscale'

function BrainMesh() {
  const mesh = useStore((s) => s.mesh)
  const meshRef = useRef(null)
  const lerpBufRef = useRef(null)

  const material = useMemo(() => new THREE.MeshStandardMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
    roughness: 0.9,
    metalness: 0,
    toneMapped: false,
  }), [])

  const geometry = useMemo(() => {
    if (!mesh) return null
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(mesh.vertices, 3))
    geo.setIndex(new THREE.BufferAttribute(mesh.faces, 1))
    geo.computeVertexNormals()
    // Preallocate color buffer once — reused every frame
    const colors = new Float32Array(mesh.nVertices * 3)
    for (let i = 0; i < mesh.nVertices; i++) {
      colors[i * 3] = BRAIN_GRAY_R
      colors[i * 3 + 1] = BRAIN_GRAY_G
      colors[i * 3 + 2] = BRAIN_GRAY_B
    }
    const colorAttr = new THREE.BufferAttribute(colors, 3)
    colorAttr.setUsage(THREE.DynamicDrawUsage)
    geo.setAttribute('color', colorAttr)
    return geo
  }, [mesh])

  // Update colors in the render loop — reads ALL state from store to avoid stale closures
  useFrame(() => {
    const geo = meshRef.current?.geometry
    const colorAttr = geo?.attributes.color
    if (!geo || !colorAttr) return
    const colors = colorAttr.array
    if (!lerpBufRef.current || lerpBufRef.current.length !== colors.length / 3) {
      lerpBufRef.current = new Float32Array(colors.length / 3)
    }
    const lerpBuf = lerpBufRef.current
    const { preds, timestep, timestepFrac, globalVmin, globalVmax, selectedRegion, regionVertices } = useStore.getState()
    if (!preds) return
    const frameA = preds[timestep]
    if (!frameA) return

    const frameB = preds[timestep + 1]

    // Interpolate between adjacent timesteps for smooth transitions
    if (timestepFrac > 0 && frameB) {
      const invFrac = 1 - timestepFrac
      for (let i = 0, n = frameA.length; i < n; i++) {
        lerpBuf[i] = frameA[i] * invFrac + frameB[i] * timestepFrac
      }
      activationsToColors(lerpBuf, globalVmin, globalVmax, colors)
    } else {
      activationsToColors(frameA, globalVmin, globalVmax, colors)
    }

    // Highlight selected region: make its vertices bright cyan
    if (selectedRegion && regionVertices && regionVertices[selectedRegion]) {
      const idxList = regionVertices[selectedRegion]
      for (const idx of idxList) {
        colors[idx * 3] = 0.3       // R
        colors[idx * 3 + 1] = 0.9   // G
        colors[idx * 3 + 2] = 1.0   // B (cyan)
      }
    }

    colorAttr.needsUpdate = true
  })

  if (!geometry) return null

  return (
    <mesh ref={meshRef} geometry={geometry} material={material} />
  )
}

function useActivationDiagnostics() {
  const preds = useStore((s) => s.preds)
  const timestep = useStore((s) => s.timestep)
  const timestepFrac = useStore((s) => s.timestepFrac)
  const globalVmin = useStore((s) => s.globalVmin)
  const globalVmax = useStore((s) => s.globalVmax)

  return useMemo(() => {
    if (!preds?.length) return null
    const frameA = preds[timestep]
    if (!frameA) return null
    const frameB = preds[timestep + 1]
    const frac = frameB ? timestepFrac : 0
    const invFrac = 1 - frac
    const range = globalVmax - globalVmin || 1
    let lit = 0
    let min = Infinity
    let max = -Infinity

    for (let i = 0, n = frameA.length; i < n; i++) {
      const value = frameB ? frameA[i] * invFrac + frameB[i] * frac : frameA[i]
      if (value < min) min = value
      if (value > max) max = value
      if ((value - globalVmin) / range >= 0.3) lit += 1
    }

    return {
      litPct: (lit / frameA.length) * 100,
      min,
      max,
    }
  }, [preds, timestep, timestepFrac, globalVmin, globalVmax])
}

const CAMERA_DISTANCE = 200 // how far from the centroid the camera orbits

function CameraFocus({ controlsRef }) {
  const mesh = useStore((s) => s.mesh)
  const selectedRegion = useStore((s) => s.selectedRegion)
  const regionVertices = useStore((s) => s.regionVertices)
  const focusKeyRef = useRef(null)
  const animRef = useRef(null)
  const { camera } = useThree()

  function beginFocusAnimation() {
    const idxList = selectedRegion && regionVertices?.[selectedRegion]
    if (!selectedRegion || !mesh || !idxList?.length) {
      animRef.current = {
        start: performance.now(),
        fromTarget: null,
        fromPos: null,
        toTarget: new THREE.Vector3(0, 0, 0),
        toPos: new THREE.Vector3(-180, -30, 100),
      }
      return
    }

    const verts = mesh.vertices
    const nPerHemi = mesh.nVertices / 2 // fsaverage5: 10242 per hemisphere

    // Split vertices into left (0..nPerHemi-1) and right (nPerHemi..end) groups
    const leftIdxs = []
    const rightIdxs = []
    for (const idx of idxList) {
      if (idx < nPerHemi) leftIdxs.push(idx)
      else rightIdxs.push(idx)
    }

    // Compute centroid for each hemisphere group
    function centroidOf(idxs) {
      let cx = 0, cy = 0, cz = 0
      for (const idx of idxs) {
        cx += verts[idx * 3]
        cy += verts[idx * 3 + 1]
        cz += verts[idx * 3 + 2]
      }
      return new THREE.Vector3(cx / idxs.length, cy / idxs.length, cz / idxs.length)
    }

    let centroid
    if (leftIdxs.length > 0 && rightIdxs.length > 0) {
      // Bilateral region — pick the hemisphere closer to the current camera
      const leftC = centroidOf(leftIdxs)
      const rightC = centroidOf(rightIdxs)
      const camPos = camera.position
      centroid = camPos.distanceToSquared(leftC) < camPos.distanceToSquared(rightC)
        ? leftC : rightC
    } else if (leftIdxs.length > 0) {
      centroid = centroidOf(leftIdxs)
    } else {
      centroid = centroidOf(rightIdxs)
    }

    // Point camera from outside the brain looking inward at the region.
    // Use the centroid's direction from brain origin as the outward normal —
    // this works for both hemispheres (left regions point left, right point right).
    const outward = centroid.clone().normalize()
    const camPos = centroid.clone().addScaledVector(outward, CAMERA_DISTANCE)

    animRef.current = {
      start: performance.now(),
      fromTarget: null,
      fromPos: null,
      toTarget: centroid,
      toPos: camPos,
    }
  }

  // Smoothly animate both camera position and orbit target
  useFrame(() => {
    const focusKey = selectedRegion && mesh && regionVertices?.[selectedRegion]?.length
      ? `${selectedRegion}:${mesh.nVertices}`
      : '__default__'

    if (focusKeyRef.current !== focusKey) {
      focusKeyRef.current = focusKey
      beginFocusAnimation()
    }

    const anim = animRef.current
    if (!anim || !controlsRef.current) return
    if (!anim.fromTarget) {
      anim.fromTarget = controlsRef.current.target.clone()
      anim.fromPos = camera.position.clone()
    }
    const elapsed = performance.now() - anim.start
    const t = Math.min(1, elapsed / 800) // 800ms ease
    const eased = 1 - Math.pow(1 - t, 3) // ease-out-cubic
    controlsRef.current.target.lerpVectors(anim.fromTarget, anim.toTarget, eased)
    camera.position.lerpVectors(anim.fromPos, anim.toPos, eased)
    controlsRef.current.update()
    if (t >= 1) {
      animRef.current = null
    }
  })

  return null
}

export default function BrainViewer() {
  const controlsRef = useRef()
  const preds = useStore((s) => s.preds)
  const timestep = useStore((s) => s.timestep)
  const timestepFrac = useStore((s) => s.timestepFrac)
  const globalVmin = useStore((s) => s.globalVmin)
  const globalVmax = useStore((s) => s.globalVmax)
  const smoothFrame = preds ? Math.min(preds.length - 1, timestep + timestepFrac) : 0
  const activationDiagnostics = useActivationDiagnostics()

  return (
    <div className="w-full h-full bg-gray-900 rounded-lg overflow-hidden relative">
      <div className="absolute top-3 left-3 z-10 bg-gray-950/70 backdrop-blur-sm rounded-md px-3 py-2 text-[10px] text-gray-400 font-mono leading-relaxed pointer-events-none">
        <div><span className="text-red-400 font-semibold">R</span>ight / <span className="text-red-400 font-semibold">L</span>eft</div>
        <div><span className="text-red-400 font-semibold">A</span>nterior / <span className="text-red-400 font-semibold">P</span>osterior</div>
        <div><span className="text-red-400 font-semibold">S</span>uperior / <span className="text-red-400 font-semibold">I</span>nferior</div>
      </div>
      {preds && (
        <div className="absolute bottom-4 left-4 z-10 w-56 rounded-md border border-gray-800 bg-gray-950/80 px-3 py-2 text-xs text-gray-300 backdrop-blur-sm pointer-events-none">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[10px] uppercase tracking-wider text-gray-500">Activation</span>
            <span className="font-mono text-[10px] text-gray-400">Frame {smoothFrame.toFixed(2)}</span>
          </div>
          <div
            className="mt-2 h-2 rounded-full border border-gray-700"
            style={{
              background: 'linear-gradient(90deg, rgb(107,107,107) 0%, rgb(107,107,107) 28%, rgb(209,45,32) 48%, rgb(240,122,25) 72%, rgb(255,204,51) 100%)',
            }}
          />
          <div className="mt-1 flex justify-between font-mono text-[10px] text-gray-500">
            <span>{globalVmin.toFixed(2)}</span>
            <span>{globalVmax.toFixed(2)}</span>
          </div>
          {activationDiagnostics && (
            <div className="mt-1 font-mono text-[10px] text-gray-500">
              {activationDiagnostics.litPct.toFixed(1)}% lit | {activationDiagnostics.min.toFixed(2)}..{activationDiagnostics.max.toFixed(2)}
            </div>
          )}
        </div>
      )}
      <Canvas
        camera={{
          position: [-180, -30, 100],
          fov: 40,
          near: 1,
          far: 2000,
          up: [0, 0, 1], // brain's anatomical up is Z in fsaverage coords
        }}
        onCreated={({ camera }) => {
          camera.up.set(0, 0, 1)
          camera.lookAt(0, 0, 0)
        }}
      >
        <ambientLight intensity={0.7} />
        <directionalLight position={[100, -100, 150]} intensity={0.6} />
        <directionalLight position={[-100, 100, -100]} intensity={0.3} />
        <BrainMesh />
        <CameraFocus controlsRef={controlsRef} />
        <OrbitControls
          ref={controlsRef}
          enableDamping
          dampingFactor={0.12}
          rotateSpeed={0.6}
          zoomSpeed={0.7}
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
        <GizmoHelper alignment="bottom-right" margin={[70, 70]}>
          <GizmoViewcube
            faces={['R', 'L', 'A', 'P', 'S', 'I']}
            color="#533483"
            opacity={0.95}
            strokeColor="#e94560"
            textColor="#ffffff"
            hoverColor="#e94560"
          />
        </GizmoHelper>
      </Canvas>
    </div>
  )
}
