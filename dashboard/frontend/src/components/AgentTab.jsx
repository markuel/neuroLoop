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
  starting: 'Starting...',
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

function StatusPill({ label, value, tone = 'muted' }) {
  const tones = {
    live: 'border-green-500/30 bg-green-500/10 text-green-300',
    ready: 'border-blue-500/30 bg-blue-500/10 text-blue-300',
    done: 'border-gray-700 bg-gray-900 text-gray-300',
    muted: 'border-gray-800 bg-gray-900 text-gray-500',
  }

  return (
    <div className={`rounded-md border px-2.5 py-1.5 ${tones[tone]}`}>
      <span className="text-[10px] uppercase tracking-wider opacity-70">{label}</span>
      <span className="ml-2 text-xs font-medium">{value}</span>
    </div>
  )
}

function GenerateStatusStrip({ sessionId, session }) {
  const params = session?.params || {}
  const isRunning = session?.is_running
  const hasSession = Boolean(sessionId)
  const maxIterations = params.max_iterations ?? '?'
  const currentIteration = session?.current_iteration ?? 0
  const step = session?.step ? (STEP_LABELS[session.step] || session.step) : 'Ready'

  return (
    <div className="h-12 border-b border-gray-800 bg-gray-950/95 px-4 flex items-center gap-2 overflow-x-auto">
      <StatusPill
        label="Mode"
        value={!hasSession ? 'Setup' : isRunning ? 'Running' : 'Review'}
        tone={!hasSession ? 'ready' : isRunning ? 'live' : 'done'}
      />
      <StatusPill label="Step" value={step} tone={isRunning ? 'live' : hasSession ? 'done' : 'muted'} />
      <StatusPill
        label="Iteration"
        value={hasSession ? `${currentIteration}/${maxIterations}` : '--'}
        tone={hasSession ? 'done' : 'muted'}
      />
      <StatusPill
        label="Best Score"
        value={session?.best_score > 0 ? session.best_score.toFixed(3) : '--'}
        tone={session?.best_score > 0 ? 'done' : 'muted'}
      />
      <StatusPill
        label="Target"
        value={params.target_score != null ? params.target_score.toFixed(2) : '--'}
        tone={params.target_score != null ? 'done' : 'muted'}
      />
      <StatusPill
        label="Session"
        value={sessionId ? sessionId.slice(0, 8) : 'Not started'}
        tone={sessionId ? 'done' : 'muted'}
      />
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
  const [loadError, setLoadError] = useState(null)
  const pollRef = useRef(null)

  useEffect(() => {
    getConfig()
      .then(setConfig)
      .catch((err) => {
        console.warn('Failed to load agent config:', err)
        setLoadError('Agent configuration could not be loaded.')
      })
    getAgentSessions()
      .then(r => setPastSessions(r.sessions ?? []))
      .catch((err) => {
        console.warn('Failed to load agent sessions:', err)
        setLoadError('Past agent sessions could not be loaded.')
      })
  }, [])

  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current)
    if (!activeSessionId) return
    const poll = async () => {
      try {
        const data = await getAgentSession(activeSessionId)
        setSessionData(data)
        setLoadError(null)
        if (!data.is_running) clearInterval(pollRef.current)
      } catch (err) {
        console.warn('Failed to refresh agent session:', err)
        setLoadError('Live agent session status could not be refreshed.')
      }
    }
    poll()
    pollRef.current = setInterval(poll, 3000)
    return () => clearInterval(pollRef.current)
  }, [activeSessionId])

  const handleStart = async (form) => {
    const { session_id } = await startAgentSession(form)
    setLoadError(null)
    setActiveSessionId(session_id)
    setSessionData(null)
    setSelectedIteration(null)
  }

  const handleStop = async () => {
    if (!activeSessionId) return
    try {
      await stopAgentSession(activeSessionId)
      setLoadError(null)
    } catch (err) {
      console.warn('Failed to stop agent session:', err)
      setLoadError(err.message || 'Agent session could not be stopped.')
    }
  }

  const handleSelectPast = (session) => {
    setActiveSessionId(session.session_id)
    setSessionData(session)
    setLoadError(null)
    setSelectedIteration(null)
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      <GenerateStatusStrip sessionId={activeSessionId} session={sessionData} />

      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* Left rail - config or live status + past sessions */}
        <div className="w-72 flex-shrink-0 border-r border-gray-800 flex flex-col overflow-y-auto">
          <div className="p-4 border-b border-gray-800">
            {loadError && (
              <p className="mb-3 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200" role="alert">
                {loadError}
              </p>
            )}
            {activeSessionId && sessionData ? (
              <>
                <LiveSessionHeader session={sessionData} onStop={handleStop} />
                <button
                  onClick={() => { setActiveSessionId(null); setSessionData(null); setSelectedIteration(null) }}
                  className="mt-4 text-xs text-gray-600 hover:text-gray-400 transition"
                >
                  Back to new session
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
                      {s.best_score > 0 && ` - best ${s.best_score.toFixed(3)}`}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Center - live artifact canvas */}
        <div className="flex-1 flex flex-col min-h-0 border-r border-gray-800">
          <ArtifactCanvas
            sessionId={activeSessionId}
            iteration={selectedIteration}
            setIteration={setSelectedIteration}
            sessionData={sessionData}
          />
        </div>

        {/* Right rail - user notes (top) + log feed (bottom) */}
        <div className="w-80 flex-shrink-0 flex flex-col min-h-0 bg-gray-950">
          {activeSessionId && (
            <UserNotes sessionId={activeSessionId} disabled={!sessionData?.is_running} />
          )}
          <LogFeed key={activeSessionId || 'no-session'} sessionId={activeSessionId} isRunning={sessionData?.is_running ?? false} />
        </div>
      </div>
    </div>
  )
}
