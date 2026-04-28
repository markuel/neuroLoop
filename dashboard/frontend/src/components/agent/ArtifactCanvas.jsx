import { useState, useEffect, useRef, useMemo } from 'react'
import { agentArtifactsStreamUrl, agentArtifactUrl } from '../../utils/api'
import BrainHeatmap from './BrainHeatmap'

const STAGE_STYLES = {
  done: 'border-green-500/30 bg-green-500/10 text-green-300',
  active: 'border-blue-500/30 bg-blue-500/10 text-blue-300',
  waiting: 'border-gray-800 bg-gray-900/70 text-gray-500',
}

function statusFor(done, total, ready) {
  if (total > 0 && done >= total) return 'done'
  if (ready || done > 0) return 'active'
  return 'waiting'
}

function stageLabel(state) {
  if (state === 'done') return 'complete'
  if (state === 'active') return 'running'
  return 'waiting'
}

function compactPath(path) {
  if (!path) return ''
  const parts = path.split('/')
  return parts.slice(-3).join('/')
}

// ------------------------------------------------------------------
// Subscribe to the artifact SSE stream and build a per-iteration index.
// Shape: { [iterationNumber]: { keyframesJson, segmentsJson, scoreJson,
//                               finalMp4, keyframes: [path], segments: [path] } }
// ------------------------------------------------------------------
function useArtifacts(sessionId) {
  const [artifactState, setArtifactState] = useState({ sessionId: null, byIter: {} })
  const [errorState, setErrorState] = useState({ sessionId: null, message: null })

  useEffect(() => {
    if (!sessionId) return

    const es = new EventSource(agentArtifactsStreamUrl(sessionId))
    es.onopen = () => setErrorState({ sessionId, message: null })
    es.onmessage = (e) => {
      try {
        const a = JSON.parse(e.data)
        setArtifactState(prev => {
          const prevByIter = prev.sessionId === sessionId ? prev.byIter : {}
          const cur = prevByIter[a.iteration] || { keyframes: [], segments: [] }
          const next = { ...cur }
          if (a.kind === 'keyframe') {
            if (!next.keyframes.includes(a.path)) next.keyframes = [...next.keyframes, a.path].sort()
          } else if (a.kind === 'segment') {
            if (!next.segments.includes(a.path)) next.segments = [...next.segments, a.path].sort()
          } else if (a.kind === 'keyframes.json') next.keyframesJson = a.path
          else if (a.kind === 'segments.json') next.segmentsJson = a.path
          else if (a.kind === 'score.json') next.scoreJson = a.path
          else if (a.kind === 'final.mp4') next.finalMp4 = a.path
          return { sessionId, byIter: { ...prevByIter, [a.iteration]: next } }
        })
      } catch (err) {
        console.warn('Ignoring malformed artifact stream event:', err)
      }
    }
    es.addEventListener('done', () => es.close())
    es.onerror = () => {
      setErrorState({
        sessionId,
        message: 'Live artifact stream disconnected. Reconnecting...',
      })
    }
    return () => es.close()
  }, [sessionId])

  return {
    byIter: artifactState.sessionId === sessionId ? artifactState.byIter : {},
    error: errorState.sessionId === sessionId ? errorState.message : null,
  }
}

// ------------------------------------------------------------------
// Small helper: fetch a JSON file from the artifact endpoint.
// ------------------------------------------------------------------
function useJsonArtifact(sessionId, path) {
  const [result, setResult] = useState({ key: null, data: null })
  const key = sessionId && path ? `${sessionId}:${path}` : null

  useEffect(() => {
    if (!key) return
    fetch(agentArtifactUrl(sessionId, path))
      .then(r => r.ok ? r.json() : null)
      .then(data => setResult({ key, data }))
      .catch((err) => console.warn(`Failed to load artifact JSON ${path}:`, err))
  }, [sessionId, path, key])

  return result.key === key ? result.data : null
}

// ------------------------------------------------------------------
// Live progress board - converts artifacts on disk into visible state.
// ------------------------------------------------------------------
function BuildProgress({ sessionData, iterData, keyframesJson, segmentsJson, scoreJson }) {
  const plannedKeyframes = keyframesJson?.keyframes?.length ?? 0
  const plannedSegments = segmentsJson?.segments?.length ?? Math.max(plannedKeyframes - 1, 0)
  const keyframesDone = iterData?.keyframes?.length ?? 0
  const segmentsDone = iterData?.segments?.length ?? 0
  const hasKeyframePlan = Boolean(iterData?.keyframesJson)
  const hasSegmentPlan = Boolean(iterData?.segmentsJson)

  const stages = [
    {
      label: 'Prompt plan',
      state: hasKeyframePlan && hasSegmentPlan ? 'done' : sessionData?.is_running ? 'active' : 'waiting',
      detail: hasKeyframePlan || hasSegmentPlan
        ? `${hasKeyframePlan ? 'keyframes' : 'keyframes pending'} / ${hasSegmentPlan ? 'segments' : 'segments pending'}`
        : 'waiting for prompt JSON',
    },
    {
      label: 'Keyframe images',
      state: statusFor(keyframesDone, plannedKeyframes, hasKeyframePlan),
      detail: plannedKeyframes > 0 ? `${keyframesDone}/${plannedKeyframes} frames` : 'waiting for plan',
      percent: plannedKeyframes > 0 ? keyframesDone / plannedKeyframes : 0,
    },
    {
      label: 'Video segments',
      state: statusFor(segmentsDone, plannedSegments, hasSegmentPlan),
      detail: plannedSegments > 0 ? `${segmentsDone}/${plannedSegments} clips` : 'waiting for segment plan',
      percent: plannedSegments > 0 ? segmentsDone / plannedSegments : 0,
    },
    {
      label: 'Stitched video',
      state: iterData?.finalMp4 ? 'done' : segmentsDone > 0 ? 'active' : 'waiting',
      detail: iterData?.finalMp4 ? compactPath(iterData.finalMp4) : 'waiting for clips',
    },
    {
      label: 'TRIBE score',
      state: scoreJson ? 'done' : iterData?.finalMp4 ? 'active' : 'waiting',
      detail: scoreJson ? (scoreJson.overall_score ?? 0).toFixed(3) : 'waiting for final video',
    },
  ]

  return (
    <div className="grid grid-cols-1 gap-2 xl:grid-cols-5">
      {stages.map(stage => (
        <div
          key={stage.label}
          className={`rounded-lg border px-3 py-2.5 ${STAGE_STYLES[stage.state]}`}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] uppercase tracking-wider opacity-70">{stage.label}</span>
            <span className="text-[10px] font-mono">{stageLabel(stage.state)}</span>
          </div>
          <div className="mt-1 truncate text-xs font-medium">{stage.detail}</div>
          {typeof stage.percent === 'number' && (
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-black/30">
              <div
                className="h-full rounded-full bg-current transition-all duration-500"
                style={{ width: `${Math.min(100, Math.round(stage.percent * 100))}%` }}
              />
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

function ArtifactList({ iterData }) {
  if (!iterData) return null
  const files = [
    iterData.keyframesJson && { label: 'keyframes.json', path: iterData.keyframesJson },
    iterData.segmentsJson && { label: 'segments.json', path: iterData.segmentsJson },
    ...(iterData.keyframes || []).map(path => ({ label: 'image', path })),
    ...(iterData.segments || []).map(path => ({ label: 'segment', path })),
    iterData.finalMp4 && { label: 'final.mp4', path: iterData.finalMp4 },
    iterData.scoreJson && { label: 'score.json', path: iterData.scoreJson },
  ].filter(Boolean)

  if (!files.length) return null

  return (
    <div className="rounded-lg border border-gray-800 bg-gray-950/70 p-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h3 className="text-xs uppercase tracking-wider text-gray-500">Files produced</h3>
        <span className="font-mono text-[10px] text-gray-600">{files.length}</span>
      </div>
      <div className="grid grid-cols-1 gap-1.5 lg:grid-cols-2">
        {files.map(file => (
          <div key={file.path} className="min-w-0 rounded border border-gray-800/80 bg-gray-900/60 px-2 py-1.5">
            <div className="text-[10px] uppercase tracking-wider text-gray-500">{file.label}</div>
            <div className="truncate font-mono text-[11px] text-gray-300" title={file.path}>
              {compactPath(file.path)}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ------------------------------------------------------------------
// Keyframe + segment storyboard - prompt cards fill in as artifacts land.
// ------------------------------------------------------------------
function KeyframeSegmentStrip({ sessionId, iterData, keyframesJson, segmentsJson }) {
  if (!keyframesJson?.keyframes?.length) {
    return (
      <div className="rounded-lg border border-dashed border-gray-800 bg-gray-950/60 px-4 py-8 text-center">
        <div className="text-sm text-gray-500">Waiting for keyframe prompts</div>
        <div className="mt-2 text-xs text-gray-700">
          The storyboard will appear here as soon as the agent writes keyframes.json.
        </div>
      </div>
    )
  }

  const kfByIndex = new Map()
  for (const p of iterData.keyframes || []) {
    const m = p.match(/frame_(\d+)\.jpg$/)
    if (m) kfByIndex.set(parseInt(m[1]), p)
  }
  const segByIndex = new Map()
  for (const p of iterData.segments || []) {
    const m = p.match(/seg_(\d+)\.mp4$/)
    if (m) segByIndex.set(parseInt(m[1]), p)
  }

  return (
    <div className="grid grid-cols-1 gap-3">
      {keyframesJson.keyframes.map((kf, i) => {
        const imgPath = kfByIndex.get(kf.index ?? i)
        const segPath = segByIndex.get(kf.index ?? i) // segment i connects frame i to i+1
        const seg = segmentsJson?.segments?.[i]
        const isLastFrame = i === keyframesJson.keyframes.length - 1
        return (
          <article key={i} className="rounded-lg border border-gray-800 bg-gray-950/70 p-3">
            <div className="grid grid-cols-1 gap-3 xl:grid-cols-[190px_minmax(0,1fr)]">
              <div className="min-w-0">
                <div className="aspect-square overflow-hidden rounded-md border border-gray-800 bg-gray-900 relative">
                  {imgPath ? (
                    <img
                      src={agentArtifactUrl(sessionId, imgPath)}
                      alt={`frame ${kf.index ?? i}`}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-gray-600">
                      <div className="h-8 w-8 rounded-full border border-gray-700 border-t-gray-500 animate-spin" />
                      <span className="text-xs">image queued</span>
                    </div>
                  )}
                  <div className="absolute left-2 top-2 rounded bg-black/70 px-2 py-1 font-mono text-[10px] text-gray-200">
                    frame {kf.index ?? i}
                  </div>
                  <div className={`absolute bottom-2 right-2 rounded px-2 py-1 text-[10px] ${
                    imgPath ? 'bg-green-500/20 text-green-200' : 'bg-blue-500/20 text-blue-200'
                  }`}>
                    {imgPath ? 'image ready' : 'generating'}
                  </div>
                </div>
              </div>

              <div className="min-w-0 space-y-3">
                <div>
                  <div className="mb-1 flex items-center justify-between gap-3">
                    <h4 className="text-sm font-medium text-white">Keyframe prompt</h4>
                    {kf.mood && <span className="truncate text-xs italic text-purple-300">{kf.mood}</span>}
                  </div>
                  <p className="text-xs leading-relaxed text-gray-300">{kf.prompt}</p>
                  {kf.dominant_elements?.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {kf.dominant_elements.map(item => (
                        <span key={item} className="rounded border border-gray-800 bg-gray-900 px-2 py-1 text-[10px] text-gray-400">
                          {item}
                        </span>
                      ))}
                    </div>
                  )}
                  {kf.brain_targeting_notes && (
                    <p className="mt-2 rounded border border-gray-800 bg-gray-900/70 px-2.5 py-2 text-[11px] leading-relaxed text-gray-500">
                      {kf.brain_targeting_notes}
                    </p>
                  )}
                </div>

                {!isLastFrame && (
                  <div className="rounded-md border border-gray-800 bg-gray-900/50 p-3">
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <h5 className="text-xs uppercase tracking-wider text-blue-300">Segment {i}</h5>
                      <span className={`rounded px-2 py-0.5 text-[10px] ${
                        segPath ? 'bg-green-500/20 text-green-200' : 'bg-blue-500/20 text-blue-200'
                      }`}>
                        {segPath ? 'clip ready' : 'waiting for video'}
                      </span>
                    </div>
                    <div className="grid grid-cols-1 gap-3 lg:grid-cols-[180px_minmax(0,1fr)]">
                      {segPath ? (
                        <video
                          src={agentArtifactUrl(sessionId, segPath)}
                          className="aspect-video w-full rounded-md bg-black object-cover"
                          muted
                          loop
                          autoPlay
                          playsInline
                        />
                      ) : (
                        <div className="flex aspect-video w-full items-center justify-center rounded-md border border-dashed border-gray-700 bg-gray-950 text-xs text-gray-600">
                          video generation pending
                        </div>
                      )}
                      {seg ? (
                        <div className="min-w-0">
                          <p className="text-xs leading-relaxed text-blue-100">{seg.motion_prompt}</p>
                          {seg.camera_motion && (
                            <p className="mt-2 text-[11px] italic text-gray-500">{seg.camera_motion}</p>
                          )}
                          {seg.target_regions?.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {seg.target_regions.map(region => (
                                <span key={region} className="rounded border border-blue-500/20 bg-blue-500/10 px-2 py-1 font-mono text-[10px] text-blue-200">
                                  {region}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="text-xs text-gray-600">
                          Waiting for segments.json to describe the motion between this frame and the next.
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </article>
        )
      })}
    </div>
  )
}

// ------------------------------------------------------------------
// Score sparkline - tiny line chart of overall_score across iterations.
// ------------------------------------------------------------------
function ScoreSparkline({ iterations, target }) {
  if (!iterations?.length) return null
  const w = 160, h = 32, pad = 4
  const maxY = Math.max(target ?? 0.85, ...iterations.map(i => i.score))
  const minY = Math.min(0, ...iterations.map(i => i.score))
  const span = Math.max(0.01, maxY - minY)
  const xs = iterations.map((_, i) => pad + (i / Math.max(1, iterations.length - 1)) * (w - 2 * pad))
  const ys = iterations.map(it => h - pad - ((it.score - minY) / span) * (h - 2 * pad))
  const points = xs.map((x, i) => `${x.toFixed(1)},${ys[i].toFixed(1)}`).join(' ')
  const targetY = target ? h - pad - ((target - minY) / span) * (h - 2 * pad) : null
  const best = iterations.reduce((a, b) => b.score > a.score ? b : a, iterations[0])

  return (
    <div className="flex items-center gap-3 text-xs text-gray-500">
      <svg width={w} height={h} className="flex-shrink-0">
        {targetY != null && (
          <line x1={0} y1={targetY} x2={w} y2={targetY} stroke="#374151" strokeDasharray="2 3" />
        )}
        <polyline
          points={points}
          fill="none"
          stroke="url(#sparkGrad)"
          strokeWidth="1.5"
        />
        <defs>
          <linearGradient id="sparkGrad" x1="0" x2="1">
            <stop offset="0%" stopColor="#e94560" />
            <stop offset="100%" stopColor="#22c55e" />
          </linearGradient>
        </defs>
        {iterations.map((it, i) => (
          <circle
            key={i} cx={xs[i]} cy={ys[i]} r={2}
            fill={it.iteration === best.iteration ? '#22c55e' : '#9ca3af'}
          />
        ))}
      </svg>
      <span>best <span className="text-green-400 font-mono">{best.score.toFixed(3)}</span> @ iter {best.iteration}</span>
    </div>
  )
}

// ------------------------------------------------------------------
// Final video panel - video player + per-segment score bars under it.
// Clicking a bar seeks the video to that segment.
// ------------------------------------------------------------------
function FinalVideoPanel({ sessionId, finalPath, scoreJson, segmentsJson }) {
  const videoRef = useRef(null)

  if (!finalPath) return null

  const segDur = segmentsJson?.segments?.[0]?.duration_seconds || 5
  const scores = scoreJson?.segment_scores || []
  const scoreByIdx = new Map(scores.map(s => [s.index, s.score]))

  const seekTo = (segIdx) => {
    const v = videoRef.current
    if (!v) return
    v.currentTime = segIdx * segDur
    v.play().catch((err) => console.warn('segment preview playback failed', err))
  }

  return (
    <div className="flex flex-col gap-2">
      <video
        ref={videoRef}
        src={agentArtifactUrl(sessionId, finalPath)}
        controls
        loop
        className="w-full rounded-md bg-black max-h-80"
      />
      {scores.length > 0 && segmentsJson && (
        <div>
          <div className="flex gap-1">
            {segmentsJson.segments.map((seg, i) => {
              const score = scoreByIdx.get(i) ?? 0
              const hue = Math.round(score * 120) // red to green
              return (
                <button
                  key={i}
                  onClick={() => seekTo(i)}
                  aria-label={`Play segment ${i} with score ${score.toFixed(3)}`}
                  className="flex-1 h-8 rounded-sm relative group"
                  style={{ background: `hsl(${hue}, 70%, 35%)` }}
                  title={`segment ${i}: ${score.toFixed(3)}`}
                >
                  <span className="absolute inset-0 flex items-center justify-center text-[10px] font-mono text-white/80 group-hover:text-white">
                    {score.toFixed(2)}
                  </span>
                </button>
              )
            })}
          </div>
          <div className="flex gap-1 mt-1">
            {segmentsJson.segments.map((_, i) => (
              <div key={i} className="flex-1 text-[9px] text-gray-600 text-center">seg {i}</div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ------------------------------------------------------------------
// Main canvas
// ------------------------------------------------------------------
export default function ArtifactCanvas({ sessionId, iteration, setIteration, sessionData }) {
  const { byIter, error: artifactError } = useArtifacts(sessionId)

  const availableIters = useMemo(
    () => Object.keys(byIter).map(Number).sort((a, b) => a - b),
    [byIter],
  )

  // Default to the latest iteration with any artifacts
  useEffect(() => {
    if (iteration == null && availableIters.length > 0) {
      setIteration(availableIters[availableIters.length - 1])
    }
  }, [availableIters, iteration, setIteration])

  const cur = iteration != null ? byIter[iteration] : null
  const keyframesJson = useJsonArtifact(sessionId, cur?.keyframesJson)
  const segmentsJson = useJsonArtifact(sessionId, cur?.segmentsJson)
  const scoreJson = useJsonArtifact(sessionId, cur?.scoreJson)

  const iterations = sessionData?.iterations || []

  if (!sessionId) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-700 text-sm">
        Start a session to watch the agent work
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header - sparkline + iteration tabs */}
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-gray-800 flex-shrink-0">
        <ScoreSparkline iterations={iterations} target={sessionData?.params?.target_score ?? 0.85} />
        <div className="flex min-w-0 items-center gap-1 overflow-x-auto">
          {availableIters.map(n => {
            const logEntry = iterations.find(it => it.iteration === n)
            const isSel = n === iteration
            const statusColor = logEntry?.status === 'keep'
              ? 'bg-green-500/20 text-green-300'
              : logEntry?.status === 'surgical'
                ? 'bg-yellow-500/20 text-yellow-300'
                : logEntry?.status === 'discard'
                  ? 'bg-red-500/20 text-red-300'
                  : 'bg-gray-800 text-gray-400'
            return (
              <button
                key={n}
                onClick={() => setIteration(n)}
                className={`px-2.5 py-1 rounded text-xs font-mono transition ${
                  isSel ? 'ring-1 ring-red-500 ' + statusColor : statusColor + ' hover:brightness-125'
                }`}
                title={logEntry?.notes}
              >
                {n}
                {logEntry?.status ? ` ${logEntry.status}` : ''}
                {logEntry?.score ? ` ${logEntry.score.toFixed(2)}` : ''}
              </button>
            )
          })}
        </div>
      </div>
      {artifactError && (
        <p className="mx-4 mt-3 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200" role="alert">
          {artifactError}
        </p>
      )}

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-5 min-h-0">
        <section>
          <BuildProgress
            sessionData={sessionData}
            iterData={cur}
            keyframesJson={keyframesJson}
            segmentsJson={segmentsJson}
            scoreJson={scoreJson}
          />
        </section>
        {cur ? (
          <>
            <section>
              <h3 className="text-xs text-gray-500 uppercase tracking-wider mb-2">Iteration {iteration}: storyboard</h3>
              <KeyframeSegmentStrip
                sessionId={sessionId}
                iterData={cur}
                keyframesJson={keyframesJson}
                segmentsJson={segmentsJson}
              />
            </section>

            <ArtifactList iterData={cur} />

            {cur.finalMp4 && (
              <section>
                <h3 className="text-xs text-gray-500 uppercase tracking-wider mb-2">Final video</h3>
                <FinalVideoPanel
                  sessionId={sessionId}
                  finalPath={cur.finalMp4}
                  scoreJson={scoreJson}
                  segmentsJson={segmentsJson}
                />
              </section>
            )}

            {scoreJson && (
              <section>
                <h3 className="text-xs text-gray-500 uppercase tracking-wider mb-2">Score</h3>
                <ScoreDetails score={scoreJson} />
                <div className="grid grid-cols-3 gap-2 mt-3" style={{ height: 220 }}>
                  <BrainHeatmap activations={scoreJson.target_activations} title="Target" />
                  <BrainHeatmap activations={scoreJson.mean_activations} title="Actual" />
                  <BrainHeatmap activations={scoreJson.region_deltas} title="Delta (actual - target)" mode="delta" />
                </div>
              </section>
            )}
          </>
        ) : (
          <div className="rounded-lg border border-dashed border-gray-800 bg-gray-950/60 px-4 py-10 text-center">
            <div className="text-sm text-gray-500">Agent is preparing the first iteration</div>
            <div className="mt-2 text-xs text-gray-700">
              Prompt plans, files, images, clips, and scores will populate here as they are written.
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function ScoreDetails({ score }) {
  const deltas = score.region_deltas || {}
  const sorted = Object.entries(deltas).sort((a, b) => a[1] - b[1])
  const under = sorted.slice(0, 5)
  const over = [...sorted].reverse().slice(0, 5)

  return (
    <div className="grid grid-cols-3 gap-4 text-xs">
      <div>
        <div className="text-gray-500 mb-1">Overall</div>
        <div className="text-2xl font-mono text-white">
          {(score.overall_score ?? 0).toFixed(3)}
        </div>
      </div>
      <div>
        <div className="text-gray-500 mb-1">Most under-target</div>
        <ul className="space-y-0.5 font-mono">
          {under.map(([r, d]) => (
            <li key={r} className="flex justify-between">
              <span className="text-gray-300">{r}</span>
              <span className="text-red-400">{d.toFixed(3)}</span>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <div className="text-gray-500 mb-1">Most over-target</div>
        <ul className="space-y-0.5 font-mono">
          {over.map(([r, d]) => (
            <li key={r} className="flex justify-between">
              <span className="text-gray-300">{r}</span>
              <span className="text-green-400">+{d.toFixed(3)}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
