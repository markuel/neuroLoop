import { useState, useEffect, useRef } from 'react'
import { agentLogStreamUrl } from '../../utils/api'

function lineColor(text) {
  const t = text.toLowerCase()
  if (t.startsWith('error') || t.includes('traceback') || t.includes('exception')) return 'text-red-400'
  if (t.startsWith('warning') || t.startsWith('warn')) return 'text-yellow-400'
  if (t.includes('score') || t.includes('iteration') || t.includes('keep') || t.includes('discard')) return 'text-green-400'
  if (t.startsWith('>') || t.startsWith('$') || t.includes('running') || t.includes('generating')) return 'text-blue-400'
  if (t.startsWith('#') || t.startsWith('---') || t.startsWith('===')) return 'text-purple-400'
  return 'text-gray-300'
}

export default function LogFeed({ sessionId, isRunning }) {
  const [lines, setLines] = useState([])
  const [autoScroll, setAutoScroll] = useState(true)
  const [errorState, setErrorState] = useState({ sessionId: null, message: null })
  const endRef = useRef(null)
  const containerRef = useRef(null)

  useEffect(() => {
    if (!sessionId) return

    const es = new EventSource(agentLogStreamUrl(sessionId))
    es.onopen = () => setErrorState({ sessionId, message: null })
    es.onmessage = (e) => {
      const text = e.data
      if (text.trim()) setLines(prev => [...prev, text])
    }
    es.addEventListener('done', () => es.close())
    es.onerror = () => {
      setErrorState({ sessionId, message: 'Agent log stream disconnected. Reconnecting...' })
    }
    return () => es.close()
  }, [sessionId])

  useEffect(() => {
    if (autoScroll && endRef.current) endRef.current.scrollIntoView({ behavior: 'smooth' })
  }, [lines, autoScroll])

  const handleScroll = () => {
    const el = containerRef.current
    if (!el) return
    setAutoScroll(el.scrollHeight - el.scrollTop - el.clientHeight < 60)
  }

  if (!sessionId) {
    return <div className="flex-1 flex items-center justify-center text-gray-700 text-xs">No session</div>
  }

  const streamError = errorState.sessionId === sessionId ? errorState.message : null

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-800 flex-shrink-0">
        <span className="text-xs text-gray-500 uppercase tracking-wider">Agent log</span>
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
        className="flex-1 overflow-y-auto px-3 py-2 font-mono text-[10px] leading-tight"
      >
        {lines.length === 0 ? (
          <span className="text-gray-700">Waiting for output...</span>
        ) : (
          lines.map((line, i) => (
            <div key={i} className={`whitespace-pre-wrap break-all ${lineColor(line)}`}>
              {line}
            </div>
          ))
        )}
        {streamError && (
          <div className="mt-2 rounded border border-red-500/30 bg-red-500/10 px-2 py-1 text-red-200" role="alert">
            {streamError}
          </div>
        )}
        <div ref={endRef} />
      </div>
    </div>
  )
}
