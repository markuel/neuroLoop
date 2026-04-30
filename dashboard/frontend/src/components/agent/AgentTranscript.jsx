import { useEffect, useMemo, useRef, useState } from 'react'
import { addAgentNote, agentEventsStreamUrl, agentLogStreamUrl } from '../../utils/api'

function shortTime(ts) {
  if (!ts) return ''
  const date = new Date(ts)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function prettyJson(value) {
  if (!value || typeof value !== 'object') return ''
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return ''
  }
}

function toolName(event) {
  if (event.data?.tool) return event.data.tool
  const message = event.message || ''
  const parts = message.split(':')
  return parts.length > 1 ? parts.slice(1).join(':').trim() : 'tool'
}

function eventKind(event) {
  if (event.event === 'claude.message') return 'assistant'
  if (event.event?.includes('tool') || event.event?.includes('hook')) return 'tool'
  if (event.event?.includes('artifact')) return 'artifact'
  if (event.level === 'error') return 'error'
  if (event.level === 'warning' || event.event?.includes('retry')) return 'warning'
  return 'system'
}

function eventLabel(event) {
  const kind = eventKind(event)
  if (kind === 'tool') return toolName(event)
  if (kind === 'artifact') return event.path ? event.path.split('/').slice(-2).join('/') : 'artifact'
  if (kind === 'warning') return 'warning'
  if (kind === 'error') return 'error'
  return event.event?.replace(/^claude\./, '') || 'event'
}

function useAgentEvents(sessionId, live) {
  const [events, setEvents] = useState([])
  const [error, setError] = useState(null)

  useEffect(() => {
    setEvents([])
    setError(null)
    if (!sessionId) return

    const es = new EventSource(agentEventsStreamUrl(sessionId))
    es.onopen = () => setError(null)
    es.onmessage = (message) => {
      try {
        const event = JSON.parse(message.data)
        setEvents(prev => [...prev.slice(-500), event])
      } catch (err) {
        console.warn('Ignoring malformed agent event:', err)
      }
    }
    es.addEventListener('done', () => es.close())
    es.onerror = () => {
      if (!live) {
        es.close()
        return
      }
      setError('Agent event stream disconnected. Reconnecting...')
    }
    return () => es.close()
  }, [sessionId, live])

  return { events, error }
}

function useRawLog(sessionId) {
  const [lines, setLines] = useState([])

  useEffect(() => {
    setLines([])
    if (!sessionId) return
    const es = new EventSource(agentLogStreamUrl(sessionId))
    es.onmessage = (event) => {
      if (event.data.trim()) setLines(prev => [...prev.slice(-160), event.data])
    }
    es.addEventListener('done', () => es.close())
    return () => es.close()
  }, [sessionId])

  return lines
}

function UserPromptBubble({ session }) {
  const params = session?.params || {}
  return (
    <div className="flex justify-end">
      <div className="max-w-[88%] rounded-2xl rounded-tr-sm border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-50">
        <div className="text-[10px] uppercase tracking-wider text-red-200/70">User prompt</div>
        <div className="mt-2 space-y-2 leading-relaxed">
          {params.target_description && (
            <p><span className="text-red-200/70">Target:</span> {params.target_description}</p>
          )}
          {params.creative_brief && (
            <p><span className="text-red-200/70">Brief:</span> {params.creative_brief}</p>
          )}
        </div>
      </div>
    </div>
  )
}

function AssistantBubble({ event }) {
  return (
    <div className="flex justify-start">
      <div className="max-w-[92%] rounded-2xl rounded-tl-sm border border-gray-800 bg-gray-900/80 px-4 py-3 text-sm text-gray-100">
        <div className="mb-1 flex items-center gap-2 text-[10px] uppercase tracking-wider text-gray-500">
          <span>Claude</span>
          <span className="font-mono">{shortTime(event.ts)}</span>
        </div>
        <p className="whitespace-pre-wrap leading-relaxed">{event.message}</p>
      </div>
    </div>
  )
}

function ToolEvent({ event }) {
  const kind = eventKind(event)
  const json = prettyJson(event.data)
  const tone = kind === 'error'
    ? 'border-red-500/30 bg-red-500/10 text-red-100'
    : kind === 'warning'
      ? 'border-yellow-500/30 bg-yellow-500/10 text-yellow-100'
      : kind === 'artifact'
        ? 'border-green-500/30 bg-green-500/10 text-green-100'
        : 'border-blue-500/20 bg-blue-500/10 text-blue-100'

  return (
    <details className={`group rounded-xl border ${tone}`}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{eventLabel(event)}</div>
          <div className="mt-0.5 truncate text-[11px] opacity-70">{event.message}</div>
        </div>
        <div className="flex flex-shrink-0 items-center gap-2 text-[10px] uppercase tracking-wider opacity-60">
          <span>{kind}</span>
          <span className="font-mono">{shortTime(event.ts)}</span>
        </div>
      </summary>
      {(json || event.path) && (
        <div className="border-t border-current/10 px-3 py-2">
          {event.path && <div className="mb-2 truncate font-mono text-[11px] opacity-80">{event.path}</div>}
          {json && (
            <pre className="max-h-56 overflow-auto rounded-lg bg-black/30 p-3 text-[11px] leading-relaxed text-gray-300">
              {json}
            </pre>
          )}
        </div>
      )}
    </details>
  )
}

function LocalNoteBubble({ note }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[88%] rounded-2xl rounded-tr-sm border border-purple-500/30 bg-purple-500/10 px-4 py-3 text-sm text-purple-50">
        <div className="text-[10px] uppercase tracking-wider text-purple-200/70">Guidance sent</div>
        <p className="mt-1 whitespace-pre-wrap leading-relaxed">{note.text}</p>
      </div>
    </div>
  )
}

function RawLog({ sessionId }) {
  const lines = useRawLog(sessionId)
  if (!lines.length) return null

  return (
    <details className="border-t border-gray-800">
      <summary className="cursor-pointer px-4 py-2 text-[10px] uppercase tracking-wider text-gray-600 hover:text-gray-400">
        Raw Claude log
      </summary>
      <div className="max-h-52 overflow-y-auto px-4 pb-4 font-mono text-[10px] leading-relaxed text-gray-500">
        {lines.map((line, index) => (
          <div key={`${index}-${line.slice(0, 12)}`} className="whitespace-pre-wrap break-words">{line}</div>
        ))}
      </div>
    </details>
  )
}

export default function AgentTranscript({ sessionId, sessionData, onStop, live }) {
  const { events, error } = useAgentEvents(sessionId, live)
  const [draft, setDraft] = useState('')
  const [notes, setNotes] = useState([])
  const [sending, setSending] = useState(false)
  const endRef = useRef(null)

  useEffect(() => {
    setNotes([])
  }, [sessionId])

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [events, notes])

  const visibleEvents = useMemo(
    () => events.filter(event => eventKind(event) !== 'system' || event.message),
    [events],
  )

  const handleSubmit = async (event) => {
    event.preventDefault()
    const text = draft.trim()
    if (!text || !sessionId) return
    setSending(true)
    try {
      await addAgentNote(sessionId, text)
      setNotes(prev => [...prev, { text, ts: new Date().toISOString() }])
      setDraft('')
    } catch (err) {
      setNotes(prev => [...prev, { text: `Could not send guidance: ${err.message}`, ts: new Date().toISOString(), error: true }])
    } finally {
      setSending(false)
    }
  }

  const isRunning = sessionData?.is_running
  const statusText = sessionData?.status_detail || (isRunning ? 'Working' : 'Session loaded')

  return (
    <section className="flex min-h-0 flex-col rounded-xl border border-gray-800 bg-gray-950/90">
      <div className="flex items-center justify-between gap-3 border-b border-gray-800 px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {isRunning && <span className="h-2 w-2 rounded-full bg-green-400 animate-pulse" />}
            <h2 className="text-sm font-semibold text-white">Claude agent</h2>
          </div>
          <div className="mt-0.5 truncate text-xs text-gray-500">{statusText}</div>
        </div>
        {isRunning && (
          <button
            type="button"
            onClick={onStop}
            className="rounded-lg border border-gray-700 bg-gray-900 px-3 py-1.5 text-xs text-gray-300 transition hover:border-red-500/50 hover:text-red-200"
          >
            Stop
          </button>
        )}
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        <UserPromptBubble session={sessionData} />
        {visibleEvents.length === 0 && (
          <div className="rounded-xl border border-dashed border-gray-800 px-4 py-8 text-center text-sm text-gray-600">
            Waiting for Claude to start talking and using tools.
          </div>
        )}
        {visibleEvents.map((event, index) => (
          eventKind(event) === 'assistant'
            ? <AssistantBubble key={event.id || `${event.ts}-${index}`} event={event} />
            : <ToolEvent key={event.id || `${event.ts}-${index}`} event={event} />
        ))}
        {notes.map((note, index) => (
          <LocalNoteBubble key={`${note.ts}-${index}`} note={note} />
        ))}
        {error && (
          <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-100">
            {error}
          </div>
        )}
        <div ref={endRef} />
      </div>

      <form onSubmit={handleSubmit} className="border-t border-gray-800 p-3">
        <div className="flex gap-2">
          <input
            value={draft}
            onChange={event => setDraft(event.target.value)}
            disabled={!sessionId || !isRunning || sending}
            placeholder={isRunning ? 'Send guidance to the running agent...' : 'Session is not running'}
            className="min-w-0 flex-1 rounded-lg border border-gray-800 bg-black/30 px-3 py-2 text-sm text-white outline-none transition placeholder:text-gray-600 focus:border-red-500 disabled:cursor-not-allowed disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={!draft.trim() || !isRunning || sending}
            className="rounded-lg bg-gray-100 px-3 py-2 text-sm font-medium text-gray-950 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            Send
          </button>
        </div>
      </form>

      <RawLog sessionId={sessionId} />
    </section>
  )
}
