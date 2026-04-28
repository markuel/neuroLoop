import { useState, useEffect, useRef } from 'react'
import { agentEventsStreamUrl, agentLogStreamUrl } from '../../utils/api'

function eventTone(event) {
  if (event.level === 'error') return 'border-red-500/30 bg-red-500/10 text-red-200'
  if (event.level === 'warning') return 'border-yellow-500/30 bg-yellow-500/10 text-yellow-200'
  if (event.event?.includes('artifact')) return 'border-green-500/30 bg-green-500/10 text-green-200'
  if (event.event?.includes('tool') || event.event?.includes('hook')) return 'border-blue-500/30 bg-blue-500/10 text-blue-200'
  return 'border-gray-800 bg-gray-900/70 text-gray-300'
}

function shortTime(ts) {
  if (!ts) return ''
  const date = new Date(ts)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function EventRow({ event }) {
  return (
    <div className={`rounded-md border px-2.5 py-2 ${eventTone(event)}`}>
      <div className="flex items-center justify-between gap-3">
        <span className="min-w-0 truncate text-[11px] font-medium">{event.message}</span>
        <span className="flex-shrink-0 font-mono text-[10px] opacity-60">{shortTime(event.ts)}</span>
      </div>
      <div className="mt-1 flex items-center gap-2 text-[10px] opacity-60">
        <span className="font-mono">{event.event}</span>
        {event.path && <span className="min-w-0 truncate font-mono">{event.path}</span>}
      </div>
    </div>
  )
}

function RawLogPanel({ sessionId }) {
  const [lines, setLines] = useState([])

  useEffect(() => {
    if (!sessionId) return
    const es = new EventSource(agentLogStreamUrl(sessionId))
    es.onmessage = (e) => {
      if (e.data.trim()) setLines(prev => [...prev.slice(-120), e.data])
    }
    es.addEventListener('done', () => es.close())
    return () => es.close()
  }, [sessionId])

  if (!lines.length) return null

  return (
    <details className="border-t border-gray-800">
      <summary className="cursor-pointer px-3 py-2 text-[10px] uppercase tracking-wider text-gray-600 hover:text-gray-400">
        Raw Claude log
      </summary>
      <div className="max-h-48 overflow-y-auto px-3 pb-3 font-mono text-[10px] leading-relaxed text-gray-500">
        {lines.map((line, i) => (
          <div key={i} className="whitespace-pre-wrap break-words">{line}</div>
        ))}
      </div>
    </details>
  )
}

export default function LogFeed({ sessionId, isRunning }) {
  const [events, setEvents] = useState([])
  const [autoScroll, setAutoScroll] = useState(true)
  const [errorState, setErrorState] = useState({ sessionId: null, message: null })
  const endRef = useRef(null)
  const containerRef = useRef(null)

  useEffect(() => {
    if (!sessionId) return

    const es = new EventSource(agentEventsStreamUrl(sessionId))
    es.onopen = () => setErrorState({ sessionId, message: null })
    es.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data)
        setEvents(prev => [...prev.slice(-300), event])
      } catch (err) {
        console.warn('Ignoring malformed agent event:', err)
      }
    }
    es.addEventListener('done', () => es.close())
    es.onerror = () => {
      setErrorState({ sessionId, message: 'Agent event stream disconnected. Reconnecting...' })
    }
    return () => es.close()
  }, [sessionId])

  useEffect(() => {
    if (autoScroll && endRef.current) endRef.current.scrollIntoView({ behavior: 'smooth' })
  }, [events, autoScroll])

  const handleScroll = () => {
    const el = containerRef.current
    if (!el) return
    setAutoScroll(el.scrollHeight - el.scrollTop - el.clientHeight < 60)
  }

  if (!sessionId) {
    return <div className="flex-1 flex items-center justify-center text-gray-700 text-xs">No session</div>
  }

  const streamError = errorState.sessionId === sessionId ? errorState.message : null
  const latest = events[events.length - 1]

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-800 flex-shrink-0">
        <div className="min-w-0">
          <span className="text-xs text-gray-500 uppercase tracking-wider">Agent activity</span>
          {latest && <div className="mt-0.5 truncate text-[11px] text-gray-400">{latest.message}</div>}
        </div>
        {isRunning && (
          <span className="flex items-center gap-1 text-[10px] text-green-400">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse inline-block" />
            live
          </span>
        )}
      </div>
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 space-y-2 overflow-y-auto px-3 py-2"
      >
        {events.length === 0 ? (
          <span className="text-xs text-gray-700">Waiting for structured agent events...</span>
        ) : (
          events.map(event => <EventRow key={event.id} event={event} />)
        )}
        {streamError && (
          <div className="mt-2 rounded border border-red-500/30 bg-red-500/10 px-2 py-1 text-xs text-red-200" role="alert">
            {streamError}
          </div>
        )}
        <div ref={endRef} />
      </div>
      <RawLogPanel sessionId={sessionId} />
    </div>
  )
}
