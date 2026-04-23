import { useState, useEffect, useRef } from 'react'
import {
  getConfig, startAgentSession, getAgentSession,
  getAgentSessions, stopAgentSession, agentVideoUrl,
} from '../utils/api'

const STEP_LABELS = {
  starting: 'Starting…',
  planning: 'Planning prompts',
  generating_keyframes: 'Generating keyframes',
  generating_video: 'Generating video segments',
  stitching: 'Stitching video',
  scoring: 'Scoring with TRIBE v2',
  iteration_complete: 'Analysing results',
}

const STATUS_COLORS = {
  keep: 'text-green-400',
  discard: 'text-red-400',
  surgical: 'text-yellow-400',
}

function ScoreBar({ score, target }) {
  const pct = Math.round((score / (target || 1)) * 100)
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{
            width: `${Math.min(pct, 100)}%`,
            background: score >= target
              ? 'linear-gradient(90deg,#22c55e,#16a34a)'
              : 'linear-gradient(90deg,#e94560,#533483)',
          }}
        />
      </div>
      <span className="text-xs text-gray-400 w-10 text-right">{score.toFixed(2)}</span>
    </div>
  )
}

function ConfigForm({ config, onStart }) {
  const [form, setForm] = useState({
    target_description: '',
    duration: 30,
    max_iterations: 20,
    target_score: 0.85,
  })
  const [starting, setStarting] = useState(false)

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.target_description.trim()) return
    setStarting(true)
    try {
      await onStart(form)
    } finally {
      setStarting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5 max-w-xl">
      <div>
        <label className="block text-xs text-gray-400 mb-1.5">Target brain state</label>
        <textarea
          className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-gray-600 resize-none focus:outline-none focus:border-red-500 transition"
          rows={3}
          placeholder="Describe the feeling or experience you want the video to evoke — e.g. 'deep calm with a sense of spatial exploration through a vast natural environment'"
          value={form.target_description}
          onChange={e => set('target_description', e.target.value)}
          required
        />
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div>
          <label className="block text-xs text-gray-400 mb-1.5">Duration</label>
          <select
            className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-red-500"
            value={form.duration}
            onChange={e => set('duration', Number(e.target.value))}
          >
            <option value={30}>30 seconds</option>
            <option value={45}>45 seconds</option>
            <option value={60}>60 seconds</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1.5">Max iterations</label>
          <input
            type="number" min={1} max={50}
            className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-red-500"
            value={form.max_iterations}
            onChange={e => set('max_iterations', Number(e.target.value))}
          />
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1.5">Target score</label>
          <input
            type="number" min={0} max={1} step={0.05}
            className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-red-500"
            value={form.target_score}
            onChange={e => set('target_score', Number(e.target.value))}
          />
        </div>
      </div>

      {config && (
        <div className="flex gap-4 text-xs text-gray-500">
          <span>Image model: <span className="text-gray-300">{config.image_model}</span></span>
          <span>Video model: <span className="text-gray-300">{config.video_model}</span></span>
        </div>
      )}

      <button
        type="submit"
        disabled={starting || !form.target_description.trim()}
        className="self-start px-5 py-2 rounded-lg text-sm font-medium bg-red-600 hover:bg-red-500 disabled:opacity-40 disabled:cursor-not-allowed transition"
      >
        {starting ? 'Starting…' : 'Start agent loop'}
      </button>
    </form>
  )
}

function LiveSession({ session, onStop, selectedIteration, onSelectIteration }) {
  const params = session.params || {}
  const isRunning = session.is_running

  return (
    <div className="flex flex-col gap-4">
      {/* Status header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {isRunning && (
            <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
          )}
          <span className="text-sm font-medium text-white">
            {isRunning
              ? (STEP_LABELS[session.step] || session.step)
              : 'Session complete'}
          </span>
          {session.current_iteration > 0 && (
            <span className="text-xs text-gray-500">
              iteration {session.current_iteration} / {params.max_iterations ?? '?'}
            </span>
          )}
        </div>
        {isRunning && (
          <button
            onClick={onStop}
            className="px-3 py-1 text-xs rounded-md bg-gray-800 hover:bg-gray-700 text-gray-300 transition"
          >
            Stop
          </button>
        )}
      </div>

      {/* Target + best score */}
      {params.target_description && (
        <p className="text-xs text-gray-500 italic">"{params.target_description}"</p>
      )}
      {session.best_score > 0 && (
        <div>
          <div className="flex justify-between text-xs text-gray-400 mb-1">
            <span>Best score</span>
            <span>Target: {params.target_score ?? 0.85}</span>
          </div>
          <ScoreBar score={session.best_score} target={params.target_score ?? 0.85} />
        </div>
      )}
    </div>
  )
}

function IterationTable({ iterations, sessionId, selectedIteration, onSelect }) {
  if (!iterations.length) {
    return <p className="text-xs text-gray-600 mt-2">No completed iterations yet.</p>
  }

  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-left text-gray-500 border-b border-gray-800">
          <th className="pb-2 pr-4 font-medium">#</th>
          <th className="pb-2 pr-4 font-medium">Score</th>
          <th className="pb-2 pr-4 font-medium">Result</th>
          <th className="pb-2 font-medium">Notes</th>
        </tr>
      </thead>
      <tbody>
        {[...iterations].reverse().map(it => (
          <tr
            key={it.iteration}
            onClick={() => onSelect(it.iteration)}
            className={`border-b border-gray-800/50 cursor-pointer hover:bg-gray-800/40 transition ${
              selectedIteration === it.iteration ? 'bg-gray-800/60' : ''
            }`}
          >
            <td className="py-2 pr-4 text-gray-400">{it.iteration}</td>
            <td className="py-2 pr-4 font-mono text-white">{it.score.toFixed(3)}</td>
            <td className={`py-2 pr-4 ${STATUS_COLORS[it.status] ?? 'text-gray-400'}`}>
              {it.status}
            </td>
            <td className="py-2 text-gray-500 truncate max-w-xs">{it.notes}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export default function AgentTab() {
  const [config, setConfig] = useState(null)
  const [pastSessions, setPastSessions] = useState([])
  const [activeSessionId, setActiveSessionId] = useState(null)
  const [sessionData, setSessionData] = useState(null)
  const [selectedIteration, setSelectedIteration] = useState(null)
  const pollRef = useRef(null)

  // Load config + past sessions on mount
  useEffect(() => {
    getConfig().then(setConfig).catch(() => {})
    getAgentSessions()
      .then(r => setPastSessions(r.sessions ?? []))
      .catch(() => {})
  }, [])

  // Poll active session
  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current)
    if (!activeSessionId) return

    const poll = async () => {
      try {
        const data = await getAgentSession(activeSessionId)
        setSessionData(data)
        if (!data.is_running) clearInterval(pollRef.current)
      } catch {}
    }

    poll()
    pollRef.current = setInterval(poll, 3000)
    return () => clearInterval(pollRef.current)
  }, [activeSessionId])

  // Auto-select latest video when iteration changes
  useEffect(() => {
    if (!sessionData) return
    const last = sessionData.iterations.at(-1)
    if (last) setSelectedIteration(last.iteration)
  }, [sessionData?.iterations?.length])

  const handleStart = async (form) => {
    const { session_id } = await startAgentSession(form)
    setActiveSessionId(session_id)
    setSessionData(null)
    setSelectedIteration(null)
  }

  const handleStop = async () => {
    if (activeSessionId) await stopAgentSession(activeSessionId)
  }

  const handleSelectPast = (session) => {
    setActiveSessionId(session.session_id)
    setSessionData(session)
  }

  const videoSid = activeSessionId
  const showVideo = videoSid && selectedIteration != null

  return (
    <div className="flex-1 flex min-h-0 overflow-hidden">

      {/* Left panel */}
      <div className="w-96 flex-shrink-0 border-r border-gray-800 flex flex-col overflow-y-auto">

        {/* Configure / live status */}
        <div className="p-5 border-b border-gray-800">
          {activeSessionId && sessionData ? (
            <LiveSession
              session={sessionData}
              onStop={handleStop}
              selectedIteration={selectedIteration}
              onSelectIteration={setSelectedIteration}
            />
          ) : (
            <ConfigForm config={config} onStart={handleStart} />
          )}

          {activeSessionId && (
            <button
              onClick={() => { setActiveSessionId(null); setSessionData(null) }}
              className="mt-4 text-xs text-gray-600 hover:text-gray-400 transition"
            >
              ← New session
            </button>
          )}
        </div>

        {/* Past sessions */}
        {pastSessions.length > 0 && (
          <div className="p-5">
            <p className="text-xs text-gray-500 mb-3 uppercase tracking-wider">Past sessions</p>
            <div className="flex flex-col gap-2">
              {pastSessions.slice(0, 10).map(s => (
                <button
                  key={s.session_id}
                  onClick={() => handleSelectPast(s)}
                  className={`text-left px-3 py-2 rounded-lg text-xs transition border ${
                    activeSessionId === s.session_id
                      ? 'border-red-500/50 bg-red-500/10 text-white'
                      : 'border-gray-800 hover:border-gray-700 text-gray-400'
                  }`}
                >
                  <div className="font-medium truncate">
                    {s.params?.target_description ?? s.session_id}
                  </div>
                  <div className="text-gray-600 mt-0.5">
                    {s.iterations?.length ?? 0} iterations
                    {s.best_score > 0 && ` · best ${s.best_score.toFixed(3)}`}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Right panel — iteration log + video */}
      <div className="flex-1 flex flex-col min-h-0">

        {/* Video preview */}
        <div className="flex-1 min-h-0 bg-black flex items-center justify-center">
          {showVideo ? (
            <video
              key={`${videoSid}-${selectedIteration}`}
              src={agentVideoUrl(videoSid, selectedIteration)}
              controls
              autoPlay
              loop
              className="max-h-full max-w-full"
            />
          ) : (
            <div className="text-gray-700 text-sm">
              {activeSessionId ? 'Waiting for first video…' : 'Start a session to see videos here'}
            </div>
          )}
        </div>

        {/* Iteration log */}
        {sessionData?.iterations?.length > 0 && (
          <div className="border-t border-gray-800 p-4 max-h-56 overflow-y-auto">
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-3">Iteration log</p>
            <IterationTable
              iterations={sessionData.iterations}
              sessionId={activeSessionId}
              selectedIteration={selectedIteration}
              onSelect={setSelectedIteration}
            />
          </div>
        )}
      </div>
    </div>
  )
}
