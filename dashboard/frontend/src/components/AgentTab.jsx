import { useState, useEffect, useRef } from 'react'
import {
  getConfig, startAgentSession, getAgentSession,
  getAgentSessions, stopAgentSession,
} from '../utils/api'
import ConfigForm from './agent/ConfigForm'
import ArtifactCanvas from './agent/ArtifactCanvas'
import AgentTranscript from './agent/AgentTranscript'

const STEP_LABELS = {
  starting: 'Starting',
  planning: 'Planning prompts',
  generating_keyframes: 'Generating keyframes',
  generating_video: 'Generating video clips',
  stitching: 'Stitching video',
  scoring: 'Scoring with TRIBE',
  iteration_complete: 'Reviewing iteration',
}

function phaseLabel(session) {
  if (!session) return 'Starting agent session'
  if (session.is_running !== true && session.status !== 'running') return 'Session history'
  return STEP_LABELS[session.step] || session.status_detail || session.status || 'Working'
}

function RunHeader({ sessionId, session, onStop, onNewSession }) {
  const params = session?.params || {}
  const isRunning = session?.is_running
  const iteration = session?.current_iteration ?? 0
  const maxIterations = params.max_iterations ?? '?'
  const bestScore = session?.best_score > 0 ? session.best_score.toFixed(3) : '--'

  return (
    <header className="flex flex-shrink-0 items-center justify-between gap-4 border-b border-gray-800 bg-gray-950/95 px-5 py-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          {isRunning && <span className="h-2 w-2 rounded-full bg-green-400 animate-pulse" />}
          <h1 className="truncate text-base font-semibold text-white">{phaseLabel(session)}</h1>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
          <span>Iteration <span className="font-mono text-gray-300">{iteration}/{maxIterations}</span></span>
          <span>Best score <span className="font-mono text-gray-300">{bestScore}</span></span>
          <span className="max-w-[28rem] truncate">Session <span className="font-mono text-gray-400">{sessionId}</span></span>
        </div>
      </div>
      <div className="flex flex-shrink-0 items-center gap-2">
        {isRunning && (
          <button
            type="button"
            onClick={onStop}
            className="rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-300 transition hover:border-red-500/50 hover:text-red-200"
          >
            Stop
          </button>
        )}
        <button
          type="button"
          onClick={onNewSession}
          className="rounded-lg bg-gray-100 px-3 py-2 text-sm font-medium text-gray-950 transition hover:bg-white"
        >
          New prompt
        </button>
      </div>
    </header>
  )
}

function RecentSessions({ sessions, activeSessionId, onSelect }) {
  if (!sessions.length) return null

  return (
    <section className="mx-auto mt-8 w-full max-w-5xl">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-xs uppercase tracking-[0.2em] text-gray-600">Recent sessions</h2>
        <span className="text-xs text-gray-700">Open one to review previous work</span>
      </div>
      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {sessions.slice(0, 6).map(session => (
          <button
            key={session.session_id}
            type="button"
            onClick={() => onSelect(session)}
            className={`min-w-0 rounded-xl border p-3 text-left transition ${
              activeSessionId === session.session_id
                ? 'border-red-500/60 bg-red-500/10'
                : 'border-gray-800 bg-gray-950/70 hover:border-gray-700'
            }`}
          >
            <div className="truncate text-sm font-medium text-gray-100">
              {session.params?.creative_brief || session.params?.target_description || session.session_id}
            </div>
            <div className="mt-2 flex items-center justify-between gap-3 text-xs text-gray-600">
              <span>{session.current_iteration ?? 0} iterations</span>
              <span>{session.best_score > 0 ? `best ${session.best_score.toFixed(3)}` : session.status}</span>
            </div>
          </button>
        ))}
      </div>
    </section>
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

  const refreshSessions = () => {
    getAgentSessions()
      .then(result => setPastSessions(result.sessions ?? []))
      .catch((err) => {
        console.warn('Failed to load agent sessions:', err)
        setLoadError('Past agent sessions could not be loaded.')
      })
  }

  useEffect(() => {
    getConfig()
      .then(setConfig)
      .catch((err) => {
        console.warn('Failed to load agent config:', err)
        setLoadError('Agent configuration could not be loaded.')
      })
    refreshSessions()
  }, [])

  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current)
    if (!activeSessionId) return
    const isLiveSession = !sessionData || sessionData.is_running === true || sessionData.status === 'running'
    if (!isLiveSession) return

    const poll = async () => {
      try {
        const data = await getAgentSession(activeSessionId)
        setSessionData(data)
        setLoadError(null)
        if (!data.is_running) {
          clearInterval(pollRef.current)
          refreshSessions()
        }
      } catch (err) {
        console.warn('Failed to refresh agent session:', err)
        setLoadError('Live agent session status could not be refreshed.')
      }
    }

    poll()
    pollRef.current = setInterval(poll, 3000)
    return () => clearInterval(pollRef.current)
  }, [activeSessionId, sessionData?.is_running, sessionData?.status])

  const handleStart = async (form) => {
    const { session_id } = await startAgentSession(form)
    setLoadError(null)
    setActiveSessionId(session_id)
    setSessionData({ session_id, params: form, status: 'running', is_running: true })
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

  const handleNewSession = () => {
    setActiveSessionId(null)
    setSessionData(null)
    setSelectedIteration(null)
    refreshSessions()
  }

  if (!activeSessionId) {
    return (
      <div className="flex-1 overflow-y-auto bg-gray-950 px-5 py-8">
        {loadError && (
          <p className="mx-auto mb-5 max-w-5xl rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200" role="alert">
            {loadError}
          </p>
        )}
        <ConfigForm config={config} onStart={handleStart} />
        <RecentSessions
          sessions={pastSessions}
          activeSessionId={activeSessionId}
          onSelect={handleSelectPast}
        />
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-gray-950">
      <RunHeader
        sessionId={activeSessionId}
        session={sessionData}
        onStop={handleStop}
        onNewSession={handleNewSession}
      />
      {loadError && (
        <p className="mx-5 mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200" role="alert">
          {loadError}
        </p>
      )}
      <div className="grid flex-1 min-h-0 gap-4 overflow-hidden p-4 lg:grid-cols-[minmax(360px,0.9fr)_minmax(520px,1.3fr)]">
        <AgentTranscript
          sessionId={activeSessionId}
          sessionData={sessionData}
          onStop={handleStop}
          live={sessionData?.is_running === true}
        />
        <ArtifactCanvas
          sessionId={activeSessionId}
          iteration={selectedIteration}
          setIteration={setSelectedIteration}
          sessionData={sessionData}
          live={sessionData?.is_running === true}
        />
      </div>
    </div>
  )
}
