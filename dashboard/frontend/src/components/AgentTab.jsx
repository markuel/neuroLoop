import { useState, useEffect, useRef } from 'react'
import {
  getConfig, startAgentSession, getAgentSession,
  getAgentSessions, stopAgentSession,
} from '../utils/api'
import ConfigForm from './agent/ConfigForm'
import ArtifactCanvas from './agent/ArtifactCanvas'
import LogFeed from './agent/LogFeed'
import UserNotes from './agent/UserNotes'

const STEP_LABELS = {
  starting: 'Starting…',
  planning: 'Planning prompts',
  generating_keyframes: 'Generating keyframes',
  generating_video: 'Generating video segments',
  stitching: 'Stitching video',
  scoring: 'Scoring with TRIBE v2',
  iteration_complete: 'Analysing results',
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

function LiveSessionHeader({ session, onStop }) {
  const params = session.params || {}
  const isRunning = session.is_running
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          {isRunning && <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse flex-shrink-0" />}
          <span className="text-sm font-medium text-white truncate">
            {isRunning ? (STEP_LABELS[session.step] || session.step) : 'Session complete'}
          </span>
          {session.current_iteration > 0 && (
            <span className="text-xs text-gray-500 flex-shrink-0">
              {session.current_iteration}/{params.max_iterations ?? '?'}
            </span>
          )}
        </div>
        {isRunning && (
          <button
            onClick={onStop}
            className="px-2.5 py-1 text-xs rounded-md bg-gray-800 hover:bg-gray-700 text-gray-300 transition"
          >
            Stop
          </button>
        )}
      </div>
      {params.target_description && (
        <div>
          <div className="text-[10px] text-gray-600 uppercase tracking-wider mb-0.5">Target state</div>
          <p className="text-xs text-gray-400 italic line-clamp-3">{params.target_description}</p>
        </div>
      )}
      {params.creative_brief && (
        <div>
          <div className="text-[10px] text-gray-600 uppercase tracking-wider mb-0.5">Creative brief</div>
          <p className="text-xs text-gray-400 italic line-clamp-3">{params.creative_brief}</p>
        </div>
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

export default function AgentTab() {
  const [config, setConfig] = useState(null)
  const [pastSessions, setPastSessions] = useState([])
  const [activeSessionId, setActiveSessionId] = useState(null)
  const [sessionData, setSessionData] = useState(null)
  const [selectedIteration, setSelectedIteration] = useState(null)
  const pollRef = useRef(null)

  useEffect(() => {
    getConfig().then(setConfig).catch(() => {})
    getAgentSessions()
      .then(r => setPastSessions(r.sessions ?? []))
      .catch(() => {})
  }, [])

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
    setSelectedIteration(null)
  }

  return (
    <div className="flex-1 flex min-h-0 overflow-hidden">

      {/* Left rail — config or live status + past sessions */}
      <div className="w-72 flex-shrink-0 border-r border-gray-800 flex flex-col overflow-y-auto">
        <div className="p-4 border-b border-gray-800">
          {activeSessionId && sessionData ? (
            <>
              <LiveSessionHeader session={sessionData} onStop={handleStop} />
              <button
                onClick={() => { setActiveSessionId(null); setSessionData(null); setSelectedIteration(null) }}
                className="mt-4 text-xs text-gray-600 hover:text-gray-400 transition"
              >
                ← New session
              </button>
            </>
          ) : (
            <ConfigForm config={config} onStart={handleStart} />
          )}
        </div>

        {pastSessions.length > 0 && (
          <div className="p-4">
            <p className="text-xs text-gray-500 mb-2 uppercase tracking-wider">Past sessions</p>
            <div className="flex flex-col gap-1.5">
              {pastSessions.slice(0, 10).map(s => (
                <button
                  key={s.session_id}
                  onClick={() => handleSelectPast(s)}
                  className={`text-left px-2.5 py-2 rounded-md text-xs transition border ${
                    activeSessionId === s.session_id
                      ? 'border-red-500/50 bg-red-500/10 text-white'
                      : 'border-gray-800 hover:border-gray-700 text-gray-400'
                  }`}
                >
                  <div className="font-medium truncate">
                    {s.params?.creative_brief || s.params?.target_description || s.session_id}
                  </div>
                  <div className="text-gray-600 mt-0.5">
                    {s.iterations?.length ?? 0} iter
                    {s.best_score > 0 && ` · best ${s.best_score.toFixed(3)}`}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Center — live artifact canvas */}
      <div className="flex-1 flex flex-col min-h-0 border-r border-gray-800">
        <ArtifactCanvas
          sessionId={activeSessionId}
          iteration={selectedIteration}
          setIteration={setSelectedIteration}
          sessionData={sessionData}
        />
      </div>

      {/* Right rail — user notes (top) + log feed (bottom) */}
      <div className="w-80 flex-shrink-0 flex flex-col min-h-0 bg-gray-950">
        {activeSessionId && (
          <UserNotes sessionId={activeSessionId} disabled={!sessionData?.is_running} />
        )}
        <LogFeed sessionId={activeSessionId} isRunning={sessionData?.is_running ?? false} />
      </div>
    </div>
  )
}
