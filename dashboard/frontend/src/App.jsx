import { lazy, Suspense, useState, useEffect, useRef, useCallback } from 'react'
import TopBar from './components/TopBar'
import VideoPlayer from './components/VideoPlayer'
import TextDisplay from './components/TextDisplay'
import Timeline from './components/Timeline'
import RegionPanel from './components/RegionPanel'
import useStore from './stores/useStore'
import { getMesh, getAtlas, getResults } from './utils/api'

const AgentTab = lazy(() => import('./components/AgentTab'))
const BrainViewer = lazy(() => import('./components/BrainViewer'))

export default function App() {
  const [activeTab, setActiveTab] = useState('analyze')
  const mesh = useStore((s) => s.mesh)
  const setMesh = useStore((s) => s.setMesh)
  const inputType = useStore((s) => s.inputType)
  const jobId = useStore((s) => s.jobId)
  const jobStatus = useStore((s) => s.jobStatus)
  const jobProgress = useStore((s) => s.jobProgress)
  const jobError = useStore((s) => s.jobError)
  const setJob = useStore((s) => s.setJob)
  const setPredictions = useStore((s) => s.setPredictions)
  const setDuration = useStore((s) => s.setDuration)
  const setInput = useStore((s) => s.setInput)
  const reset = useStore((s) => s.reset)
  const isPlaying = useStore((s) => s.isPlaying)
  const atlasRef = useRef(null)

  const setStoreAtlas = useStore((s) => s.setAtlas)

  // Load mesh + atlas on mount (binary mesh, JSON atlas — both cached)
  useEffect(() => {
    if (mesh) return
    Promise.all([getMesh(), getAtlas()])
      .then(([meshData, atlasData]) => {
        setMesh({
          vertices: meshData.vertices,
          faces: meshData.faces,
          nVertices: meshData.nVertices,
        })
        atlasRef.current = atlasData
        // Make regionVertices globally available so the agent tab's brain
        // heatmap can paint without waiting for a prediction job.
        setStoreAtlas?.(atlasData)
      })
      .catch((err) => console.error('Failed to load mesh/atlas:', err))
  }, [mesh, setMesh, setStoreAtlas])

  // Shared: fetch + parse + apply a completed job's results into the viewer
  const applyJobResults = useCallback(async (res, jobId) => {
    const [predsResp, metaResp, regionsResp] = await Promise.all([
      fetch(res.preds_url).then((r) => r.arrayBuffer()),
      fetch(res.meta_url).then((r) => r.json()),
      fetch(res.regions_url).then((r) => r.json()),
    ])

    const nTimesteps = metaResp.n_timesteps
    const nVerts = metaResp.n_vertices
    const predsRaw = new Float32Array(predsResp)
    const preds = []
    for (let t = 0; t < nTimesteps; t++) {
      preds.push(predsRaw.subarray(t * nVerts, (t + 1) * nVerts))
    }

    const atlas = atlasRef.current || {}

    setInput(metaResp.input_type, null, null)
    setPredictions({
      preds,
      regions: regionsResp.regions,
      fineGroups: atlas.fine_groups ?? null,
      coarseGroups: atlas.coarse_groups ?? null,
      regionVertices: atlas.region_vertices ?? null,
      globalVmin: metaResp.global_vmin,
      globalVmax: metaResp.global_vmax,
      segmentTimes: metaResp.segment_times,
      hemodynamicLag: metaResp.hemodynamic_lag,
    })
    setDuration(metaResp.duration_seconds)
    setJob({ jobId, jobStatus: 'done', jobProgress: 1, jobError: null })
  }, [setInput, setPredictions, setDuration, setJob])

  // Load a past job from history into the viewer
  const loadJob = useCallback(async (jobId) => {
    try {
      const res = await getResults(jobId)
      if (res.status !== 'done') return
      reset()
      await applyJobResults(res, jobId)
    } catch (err) {
      console.error('Failed to load job:', err)
    }
  }, [reset, applyJobResults])

  // Poll job status
  useEffect(() => {
    if (!jobId || jobStatus !== 'processing') return
    const interval = setInterval(async () => {
      try {
        const res = await getResults(jobId)
        if (res.status === 'done') {
          try {
            await applyJobResults(res, jobId)
          } catch (err) {
            console.error('Failed to load job results:', err)
            setJob({
              jobStatus: 'error',
              jobError: `Prediction finished, but the result files could not be loaded. ${err.message}`,
            })
          }
          clearInterval(interval)
        } else if (res.status === 'error') {
          setJob({
            jobStatus: 'error',
            jobError: res.error || 'Prediction failed before results were produced.',
          })
          clearInterval(interval)
        } else if (res.status === 'processing') {
          setJob({ jobProgress: res.progress ?? useStore.getState().jobProgress })
        } else {
          setJob({
            jobStatus: 'error',
            jobError: `Unexpected job status: ${res.status || 'unknown'}.`,
          })
          clearInterval(interval)
        }
      } catch (err) {
        console.error('Poll error:', err)
        setJob({
          jobStatus: 'error',
          jobError: `Could not check prediction status. ${err.message}`,
        })
        clearInterval(interval)
      }
    }, 2000)
    return () => clearInterval(interval)
  }, [jobId, jobStatus, setJob, applyJobResults])

  // Play loop for text-only mode using rAF (video element drives time for video/audio)
  useEffect(() => {
    if (!isPlaying) return
    if (inputType === 'video' || inputType === 'audio') return
    let rafId
    let last = performance.now()
    function tick(now) {
      const dt = (now - last) / 1000
      last = now
      const { currentTime, duration, isPlaying } = useStore.getState()
      if (!isPlaying) return
      if (currentTime >= duration) {
        useStore.getState().setPlaying(false)
        return
      }
      useStore.getState().setCurrentTime(currentTime + dt)
      rafId = requestAnimationFrame(tick)
    }
    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
  }, [inputType, isPlaying])

  return (
    <div className="h-screen flex flex-col bg-gray-950 text-white">
      <TopBar activeTab={activeTab} onTabChange={setActiveTab} onLoadJob={loadJob} />
      {activeTab === 'agent' && (
        <Suspense
          fallback={
            <div className="flex-1 flex items-center justify-center text-gray-600 text-sm">
              Loading agent workspace...
            </div>
          }
        >
          <AgentTab />
        </Suspense>
      )}

      <div className={`flex-1 flex flex-col min-h-0 ${activeTab === 'agent' ? 'hidden' : ''}`}>
      <div className="flex-1 flex min-h-0 relative">
        {/* Processing overlay */}
        {jobStatus === 'processing' && (
          <div
            className="absolute inset-0 z-10 bg-gray-950/80 flex flex-col items-center justify-center gap-6"
            aria-live="polite"
          >
            <div className="relative w-24 h-24">
              <div className="absolute inset-0 rounded-full border-2 border-gray-700" />
              <div
                className="absolute inset-0 rounded-full border-2 border-transparent animate-spin"
                style={{ borderTopColor: '#e94560', borderRightColor: '#533483' }}
              />
              <div className="absolute inset-0 flex items-center justify-center text-2xl">
                {'\u{1F9E0}'}
              </div>
            </div>
            <div className="text-center">
              <p className="text-sm font-medium text-gray-200">
                {jobProgress < 0.2 ? 'Downloading media...' :
                 jobProgress < 0.4 ? 'Loading TRIBE v2 model...' :
                 jobProgress < 0.6 ? 'Extracting features...' :
                 jobProgress < 0.8 ? 'Running brain prediction...' :
                 'Computing region analysis...'}
              </p>
              <p className="text-xs text-gray-500 mt-1">{Math.round(jobProgress * 100)}%</p>
            </div>
            <div className="w-64 h-1.5 bg-gray-800 rounded-full overflow-hidden">
              <div
                role="progressbar"
                aria-label="Prediction progress"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(jobProgress * 100)}
                className="h-full rounded-full transition-all duration-700 ease-out"
                style={{
                  width: `${jobProgress * 100}%`,
                  background: 'linear-gradient(90deg, #e94560, #533483)',
                }}
              />
            </div>
          </div>
        )}

        {jobStatus === 'error' && (
          <div className="absolute inset-0 z-10 bg-gray-950/85 flex items-center justify-center px-6" role="alert">
            <div className="w-full max-w-md border border-red-500/30 bg-gray-900 rounded-lg p-5 shadow-2xl">
              <p className="text-sm font-semibold text-red-300">Prediction stopped</p>
              <p className="mt-2 text-sm text-gray-300 leading-6">
                {jobError || 'Something went wrong while processing this input.'}
              </p>
              {jobId && (
                <p className="mt-3 text-xs text-gray-600 font-mono break-all">
                  Job {jobId}
                </p>
              )}
              <div className="mt-5 flex justify-end">
                <button
                  onClick={reset}
                  className="px-3 py-1.5 text-sm bg-gray-800 hover:bg-gray-700 rounded-md transition"
                >
                  Dismiss
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="w-1/2 border-r border-gray-800">
          {inputType === 'text' ? <TextDisplay /> : <VideoPlayer />}
        </div>
        <div className="w-1/2">
          <Suspense
            fallback={
              <div className="w-full h-full bg-gray-900 flex items-center justify-center text-gray-600 text-sm">
                Loading brain viewer...
              </div>
            }
          >
            <BrainViewer />
          </Suspense>
        </div>
      </div>

      <Timeline />

      <div className="h-72 border-t border-gray-800">
        <RegionPanel />
      </div>
      </div>
    </div>
  )
}
