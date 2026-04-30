import { useEffect, useMemo, useState } from 'react'
import { agentArtifactsStreamUrl, agentArtifactUrl } from '../../utils/api'
import BrainHeatmap from './BrainHeatmap'

const STEPS = [
  ['planning', 'Plan'],
  ['keyframes', 'Images'],
  ['segments', 'Clips'],
  ['final', 'Stitch'],
  ['score', 'Score'],
]

function useArtifacts(sessionId) {
  const [artifactState, setArtifactState] = useState({ sessionId: null, byIter: {} })
  const [errorState, setErrorState] = useState({ sessionId: null, message: null })

  useEffect(() => {
    if (!sessionId) return

    const es = new EventSource(agentArtifactsStreamUrl(sessionId))
    es.onopen = () => setErrorState({ sessionId, message: null })
    es.onmessage = (message) => {
      try {
        const artifact = JSON.parse(message.data)
        setArtifactState(prev => {
          const prevByIter = prev.sessionId === sessionId ? prev.byIter : {}
          const cur = prevByIter[artifact.iteration] || { keyframes: [], segments: [] }
          const next = { ...cur }

          if (artifact.kind === 'keyframe') {
            if (!next.keyframes.includes(artifact.path)) next.keyframes = [...next.keyframes, artifact.path].sort()
          } else if (artifact.kind === 'segment') {
            if (!next.segments.includes(artifact.path)) next.segments = [...next.segments, artifact.path].sort()
          } else if (artifact.kind === 'keyframes.json') next.keyframesJson = artifact.path
          else if (artifact.kind === 'segments.json') next.segmentsJson = artifact.path
          else if (artifact.kind === 'score.json') next.scoreJson = artifact.path
          else if (artifact.kind === 'final.mp4') next.finalMp4 = artifact.path

          return { sessionId, byIter: { ...prevByIter, [artifact.iteration]: next } }
        })
      } catch (err) {
        console.warn('Ignoring malformed artifact stream event:', err)
      }
    }
    es.addEventListener('done', () => es.close())
    es.onerror = () => {
      setErrorState({ sessionId, message: 'Live artifact stream disconnected. Reconnecting...' })
    }
    return () => es.close()
  }, [sessionId])

  return {
    byIter: artifactState.sessionId === sessionId ? artifactState.byIter : {},
    error: errorState.sessionId === sessionId ? errorState.message : null,
  }
}

function useJsonArtifact(sessionId, path) {
  const [result, setResult] = useState({ key: null, data: null })
  const key = sessionId && path ? `${sessionId}:${path}` : null

  useEffect(() => {
    if (!key) return
    fetch(agentArtifactUrl(sessionId, path))
      .then(res => res.ok ? res.json() : null)
      .then(data => setResult({ key, data }))
      .catch((err) => console.warn(`Failed to load artifact JSON ${path}:`, err))
  }, [sessionId, path, key])

  return result.key === key ? result.data : null
}

function artifactName(path) {
  if (!path) return ''
  return path.split('/').slice(-2).join('/')
}

function scoreForSegment(scoreJson, index) {
  return scoreJson?.segment_scores?.find(item => item.index === index)?.score
}

function frameMap(paths = []) {
  const out = new Map()
  for (const path of paths) {
    const match = path.match(/frame_(\d+)\.jpg$/)
    if (match) out.set(Number(match[1]), path)
  }
  return out
}

function segmentMap(paths = []) {
  const out = new Map()
  for (const path of paths) {
    const match = path.match(/seg_(\d+)\.mp4$/)
    if (match) out.set(Number(match[1]), path)
  }
  return out
}

function buildCards(iterData, keyframesJson, segmentsJson, scoreJson) {
  const frames = frameMap(iterData?.keyframes)
  const segments = segmentMap(iterData?.segments)
  const cards = []
  const keyframesByIndex = new Map()
  const segmentsByIndex = new Map()

  for (const [fallbackIndex, keyframe] of (keyframesJson?.keyframes || []).entries()) {
    keyframesByIndex.set(keyframe.index ?? fallbackIndex, keyframe)
  }
  for (const [fallbackIndex, segment] of (segmentsJson?.segments || []).entries()) {
    segmentsByIndex.set(segment.index ?? fallbackIndex, segment)
  }

  const frameIndices = new Set([...keyframesByIndex.keys(), ...frames.keys()])
  const segmentIndices = new Set([...segmentsByIndex.keys(), ...segments.keys()])

  if (!frameIndices.size && segmentIndices.size) {
    for (const index of segmentIndices) {
      frameIndices.add(index)
      frameIndices.add(index + 1)
    }
  }

  for (const index of [...frameIndices].sort((a, b) => a - b)) {
    const keyframe = keyframesByIndex.get(index)
    cards.push({
      id: `frame-${index}`,
      type: 'keyframe',
      index,
      title: `Frame ${index}`,
      subtitle: frames.has(index) ? 'Image ready' : 'Image pending',
      path: frames.get(index),
      data: keyframe,
    })

    if (segmentIndices.has(index)) {
      const segment = segmentsByIndex.get(index)
      const score = scoreForSegment(scoreJson, index)
      cards.push({
        id: `segment-${index}`,
        type: 'segment',
        index,
        title: `Clip ${index}`,
        subtitle: segments.has(index) ? score != null ? `Score ${score.toFixed(2)}` : 'Clip ready' : 'Clip pending',
        path: segments.get(index),
        data: segment,
        score,
      })
    }
  }

  if (!cards.length) {
    for (const index of [...segmentIndices].sort((a, b) => a - b)) {
      const segment = segmentsByIndex.get(index)
      const score = scoreForSegment(scoreJson, index)
      cards.push({
        id: `segment-${index}`,
        type: 'segment',
        index,
        title: `Clip ${index}`,
        subtitle: segments.has(index) ? score != null ? `Score ${score.toFixed(2)}` : 'Clip ready' : 'Clip pending',
        path: segments.get(index),
        data: segment,
        score,
      })
    }
  }

  if (iterData?.finalMp4) {
    cards.push({
      id: 'final-video',
      type: 'final',
      title: 'Final video',
      subtitle: scoreJson?.overall_score != null ? `Score ${scoreJson.overall_score.toFixed(3)}` : 'Ready',
      path: iterData.finalMp4,
      data: scoreJson,
    })
  }

  return cards
}

function StageTracker({ iterData, keyframesJson, segmentsJson, scoreJson }) {
  const plannedFrames = keyframesJson?.keyframes?.length ?? 0
  const plannedSegments = segmentsJson?.segments?.length ?? Math.max(plannedFrames - 1, 0)
  const doneFrames = iterData?.keyframes?.length ?? 0
  const doneSegments = iterData?.segments?.length ?? 0

  const states = {
    planning: iterData?.keyframesJson || iterData?.segmentsJson ? 'done' : 'active',
    keyframes: plannedFrames > 0 && doneFrames >= plannedFrames ? 'done' : doneFrames > 0 || iterData?.keyframesJson ? 'active' : 'waiting',
    segments: plannedSegments > 0 && doneSegments >= plannedSegments ? 'done' : doneSegments > 0 || iterData?.segmentsJson ? 'active' : 'waiting',
    final: iterData?.finalMp4 ? 'done' : doneSegments > 0 ? 'active' : 'waiting',
    score: scoreJson ? 'done' : iterData?.finalMp4 ? 'active' : 'waiting',
  }

  return (
    <div className="grid grid-cols-5 gap-2">
      {STEPS.map(([key, label]) => {
        const state = states[key]
        return (
          <div key={key} className="min-w-0">
            <div className={`h-1.5 rounded-full ${
              state === 'done' ? 'bg-green-400' : state === 'active' ? 'bg-blue-400' : 'bg-gray-800'
            }`} />
            <div className={`mt-1 truncate text-[10px] uppercase tracking-wider ${
              state === 'waiting' ? 'text-gray-600' : 'text-gray-300'
            }`}>
              {label}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function IterationTabs({ availableIters, iteration, setIteration, sessionData }) {
  const iterationLog = sessionData?.iterations || []
  if (!availableIters.length) return null

  return (
    <div className="flex items-center gap-1 overflow-x-auto">
      {availableIters.map(number => {
        const entry = iterationLog.find(item => item.iteration === number)
        const selected = number === iteration
        return (
          <button
            key={number}
            type="button"
            onClick={() => setIteration(number)}
            className={`flex-shrink-0 rounded-lg border px-3 py-1.5 text-xs transition ${
              selected
                ? 'border-red-500/60 bg-red-500/10 text-white'
                : 'border-gray-800 bg-gray-900/70 text-gray-500 hover:border-gray-700 hover:text-gray-300'
            }`}
            title={entry?.notes}
          >
            <span className="font-mono">Iter {number}</span>
            {entry?.score != null && <span className="ml-2 text-gray-400">{entry.score.toFixed(2)}</span>}
          </button>
        )
      })}
    </div>
  )
}

function MediaThumb({ sessionId, card }) {
  if (!card.path) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-gray-950 text-xs text-gray-600">
        pending
      </div>
    )
  }

  if (card.type === 'segment' || card.type === 'final') {
    return (
      <video
        src={agentArtifactUrl(sessionId, card.path)}
        className="h-full w-full object-cover"
        muted
        playsInline
        preload="metadata"
      />
    )
  }

  return (
    <img
      src={agentArtifactUrl(sessionId, card.path)}
      alt={card.title}
      className="h-full w-full object-cover"
    />
  )
}

function ArtifactCard({ sessionId, card, selected, onSelect }) {
  return (
    <button
      type="button"
      onClick={() => onSelect(card.id)}
      className={`group min-w-0 overflow-hidden rounded-xl border text-left transition ${
        selected
          ? 'border-red-500/60 bg-red-500/10'
          : 'border-gray-800 bg-gray-950/70 hover:border-gray-700'
      }`}
    >
      <div className="aspect-video overflow-hidden bg-gray-950">
        <MediaThumb sessionId={sessionId} card={card} />
      </div>
      <div className="p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="truncate text-sm font-medium text-white">{card.title}</div>
          <span className={`flex-shrink-0 rounded px-2 py-0.5 text-[10px] uppercase tracking-wider ${
            card.path ? 'bg-green-500/15 text-green-300' : 'bg-blue-500/15 text-blue-300'
          }`}>
            {card.type}
          </span>
        </div>
        <div className="mt-1 truncate text-xs text-gray-500">{card.subtitle}</div>
      </div>
    </button>
  )
}

function ArtifactGrid({ sessionId, cards, selectedId, setSelectedId }) {
  if (!cards.length) {
    return (
      <div className="rounded-xl border border-dashed border-gray-800 bg-gray-950/70 px-4 py-10 text-center">
        <div className="text-sm text-gray-500">Waiting for the first storyboard artifacts</div>
        <div className="mt-2 text-xs text-gray-700">Frames, clips, and final videos will appear here.</div>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-1 2xl:grid-cols-2">
      {cards.map(card => (
        <ArtifactCard
          key={card.id}
          sessionId={sessionId}
          card={card}
          selected={card.id === selectedId}
          onSelect={setSelectedId}
        />
      ))}
    </div>
  )
}

function DetailMedia({ sessionId, card }) {
  if (!card?.path) {
    return (
      <div className="flex aspect-video items-center justify-center rounded-lg border border-dashed border-gray-800 bg-gray-950 text-sm text-gray-600">
        Artifact not generated yet
      </div>
    )
  }

  if (card.type === 'segment' || card.type === 'final') {
    return (
      <video
        src={agentArtifactUrl(sessionId, card.path)}
        className="max-h-[420px] w-full rounded-lg bg-black object-contain"
        controls
        playsInline
      />
    )
  }

  return (
    <img
      src={agentArtifactUrl(sessionId, card.path)}
      alt={card.title}
      className="max-h-[420px] w-full rounded-lg bg-black object-contain"
    />
  )
}

function PromptDetails({ card }) {
  if (!card) return null
  if (card.type === 'final') return null

  const prompt = card.type === 'keyframe' ? card.data?.prompt : card.data?.motion_prompt
  const notes = card.type === 'keyframe' ? card.data?.brain_targeting_notes : card.data?.brain_targeting_notes
  const tags = card.type === 'keyframe' ? card.data?.dominant_elements : card.data?.target_regions

  return (
    <div className="space-y-3">
      {prompt && (
        <div>
          <div className="mb-1 text-[10px] uppercase tracking-wider text-gray-600">Prompt</div>
          <p className="rounded-lg border border-gray-800 bg-black/25 p-3 text-sm leading-relaxed text-gray-200">
            {prompt}
          </p>
        </div>
      )}
      {card.data?.camera_motion && (
        <div>
          <div className="mb-1 text-[10px] uppercase tracking-wider text-gray-600">Camera motion</div>
          <p className="text-sm italic text-gray-400">{card.data.camera_motion}</p>
        </div>
      )}
      {notes && (
        <div>
          <div className="mb-1 text-[10px] uppercase tracking-wider text-gray-600">Brain targeting</div>
          <p className="text-sm leading-relaxed text-gray-400">{notes}</p>
        </div>
      )}
      {tags?.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {tags.map(tag => (
            <span key={tag} className="rounded border border-gray-800 bg-gray-900 px-2 py-1 text-[11px] text-gray-400">
              {tag}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

function ScoreSummary({ scoreJson }) {
  if (!scoreJson) return null
  const deltas = Object.entries(scoreJson.region_deltas || {}).sort((a, b) => a[1] - b[1])
  const under = deltas.slice(0, 4)
  const over = [...deltas].reverse().slice(0, 4)

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-950/80 p-3">
      <div className="flex items-end justify-between gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-gray-600">Overall score</div>
          <div className="mt-1 font-mono text-3xl text-white">{(scoreJson.overall_score ?? 0).toFixed(3)}</div>
        </div>
        {scoreJson.segment_scores?.length > 0 && (
          <div className="flex flex-1 items-end gap-1">
            {scoreJson.segment_scores.map(segment => (
              <div key={segment.index} className="flex flex-1 flex-col items-center gap-1">
                <div
                  className="w-full rounded-t bg-red-500"
                  style={{
                    height: `${Math.max(8, Math.round((segment.score ?? 0) * 46))}px`,
                    background: `hsl(${Math.round((segment.score ?? 0) * 120)}, 70%, 45%)`,
                  }}
                  title={`Segment ${segment.index}: ${segment.score.toFixed(3)}`}
                />
                <span className="font-mono text-[9px] text-gray-600">{segment.index}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <details className="mt-3">
        <summary className="cursor-pointer text-xs text-gray-500 hover:text-gray-300">Region deltas</summary>
        <div className="mt-3 grid gap-3 text-xs md:grid-cols-2">
          <div>
            <div className="mb-1 text-gray-500">Most under target</div>
            <ul className="space-y-1 font-mono">
              {under.map(([region, value]) => (
                <li key={region} className="flex justify-between gap-3">
                  <span className="truncate text-gray-300">{region}</span>
                  <span className="text-red-300">{value.toFixed(3)}</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <div className="mb-1 text-gray-500">Most over target</div>
            <ul className="space-y-1 font-mono">
              {over.map(([region, value]) => (
                <li key={region} className="flex justify-between gap-3">
                  <span className="truncate text-gray-300">{region}</span>
                  <span className="text-green-300">+{value.toFixed(3)}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </details>
    </div>
  )
}

function ArtifactDetail({ sessionId, card, scoreJson }) {
  if (!card) {
    return (
      <div className="rounded-xl border border-gray-800 bg-gray-950/80 p-6 text-center text-sm text-gray-600">
        Select an image, clip, or final video.
      </div>
    )
  }

  return (
    <div className="space-y-4 rounded-xl border border-gray-800 bg-gray-950/80 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-lg font-semibold text-white">{card.title}</h3>
          <div className="mt-1 truncate font-mono text-xs text-gray-600">
            {card.path ? artifactName(card.path) : card.subtitle}
          </div>
        </div>
        {card.score != null && (
          <div className="rounded-lg border border-gray-700 px-2 py-1 text-right">
            <div className="text-[10px] uppercase tracking-wider text-gray-600">Score</div>
            <div className="font-mono text-sm text-white">{card.score.toFixed(3)}</div>
          </div>
        )}
      </div>

      <DetailMedia sessionId={sessionId} card={card} />
      <PromptDetails card={card} />
      {card.type === 'final' && <ScoreSummary scoreJson={scoreJson} />}
    </div>
  )
}

function DebugFiles({ iterData }) {
  if (!iterData) return null
  const files = [
    iterData.keyframesJson,
    iterData.segmentsJson,
    ...(iterData.keyframes || []),
    ...(iterData.segments || []),
    iterData.finalMp4,
    iterData.scoreJson,
  ].filter(Boolean)

  if (!files.length) return null

  return (
    <details className="rounded-xl border border-gray-800 bg-gray-950/80">
      <summary className="cursor-pointer px-4 py-3 text-xs uppercase tracking-wider text-gray-600 hover:text-gray-400">
        Debug files
      </summary>
      <div className="space-y-1 border-t border-gray-800 p-3">
        {files.map(path => (
          <div key={path} className="truncate rounded bg-black/25 px-2 py-1 font-mono text-[11px] text-gray-500" title={path}>
            {path}
          </div>
        ))}
      </div>
    </details>
  )
}

export default function ArtifactCanvas({ sessionId, iteration, setIteration, sessionData }) {
  const { byIter, error: artifactError } = useArtifacts(sessionId)
  const [selectedId, setSelectedId] = useState(null)

  const availableIters = useMemo(
    () => Object.keys(byIter).map(Number).sort((a, b) => a - b),
    [byIter],
  )

  useEffect(() => {
    if (iteration == null && availableIters.length > 0) {
      setIteration(availableIters[availableIters.length - 1])
    }
  }, [availableIters, iteration, setIteration])

  const cur = iteration != null ? byIter[iteration] : null
  const keyframesJson = useJsonArtifact(sessionId, cur?.keyframesJson)
  const segmentsJson = useJsonArtifact(sessionId, cur?.segmentsJson)
  const scoreJson = useJsonArtifact(sessionId, cur?.scoreJson)
  const cards = useMemo(
    () => buildCards(cur, keyframesJson, segmentsJson, scoreJson),
    [cur, keyframesJson, segmentsJson, scoreJson],
  )

  useEffect(() => {
    if (!cards.length) {
      setSelectedId(null)
      return
    }
    if (!cards.some(card => card.id === selectedId)) setSelectedId(cards[0].id)
  }, [cards, selectedId])

  const selected = cards.find(card => card.id === selectedId)

  return (
    <section className="flex min-h-0 flex-col rounded-xl border border-gray-800 bg-gray-950/90">
      <div className="space-y-3 border-b border-gray-800 px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-white">Production workbench</h2>
            <p className="mt-0.5 truncate text-xs text-gray-500">
              Images, clips, final videos, prompts, and score evidence.
            </p>
          </div>
          <IterationTabs
            availableIters={availableIters}
            iteration={iteration}
            setIteration={setIteration}
            sessionData={sessionData}
          />
        </div>
        <StageTracker
          iterData={cur}
          keyframesJson={keyframesJson}
          segmentsJson={segmentsJson}
          scoreJson={scoreJson}
        />
      </div>

      {artifactError && (
        <p className="mx-4 mt-3 rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-100" role="alert">
          {artifactError}
        </p>
      )}

      <div className="flex-1 overflow-y-auto p-4">
        <div className="grid gap-4 xl:grid-cols-[minmax(260px,0.82fr)_minmax(360px,1.18fr)]">
          <div className="space-y-4">
            <ArtifactGrid
              sessionId={sessionId}
              cards={cards}
              selectedId={selectedId}
              setSelectedId={setSelectedId}
            />
            <DebugFiles iterData={cur} />
          </div>
          <div className="space-y-4">
            <ArtifactDetail sessionId={sessionId} card={selected} scoreJson={scoreJson} />
            {scoreJson && (
              <details className="rounded-xl border border-gray-800 bg-gray-950/80">
                <summary className="cursor-pointer px-4 py-3 text-xs uppercase tracking-wider text-gray-600 hover:text-gray-400">
                  Brain heatmaps
                </summary>
                <div className="grid gap-2 border-t border-gray-800 p-3 lg:grid-cols-3" style={{ minHeight: 220 }}>
                  <BrainHeatmap activations={scoreJson.target_activations} title="Target" />
                  <BrainHeatmap activations={scoreJson.mean_activations} title="Actual" />
                  <BrainHeatmap activations={scoreJson.region_deltas} title="Delta" mode="delta" />
                </div>
              </details>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
