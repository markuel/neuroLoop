import { useState } from 'react'
import { addAgentNote } from '../../utils/api'

export default function UserNotes({ sessionId, disabled }) {
  const [note, setNote] = useState('')
  const [sent, setSent] = useState([])
  const [sending, setSending] = useState(false)

  const submit = async () => {
    if (!note.trim() || !sessionId) return
    setSending(true)
    try {
      await addAgentNote(sessionId, note)
      setSent(s => [...s, { text: note, at: new Date() }])
      setNote('')
    } catch (err) {
      console.error('note failed', err)
    } finally {
      setSending(false)
    }
  }

  const handleKey = (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') submit()
  }

  return (
    <div className="p-4 border-b border-gray-800 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-500 uppercase tracking-wider">Note to agent</span>
        <span className="text-[10px] text-gray-600">read at start of each iteration</span>
      </div>
      <textarea
        value={note}
        onChange={e => setNote(e.target.value)}
        onKeyDown={handleKey}
        disabled={disabled}
        rows={2}
        placeholder="Steer the loop: 'try more motion', 'keep the character', 'stop with the landscapes'..."
        className="w-full bg-gray-900 border border-gray-800 rounded-md px-2.5 py-2 text-xs text-white placeholder-gray-600 resize-none focus:outline-none focus:border-gray-600 disabled:opacity-40"
      />
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-gray-600">Cmd/Ctrl + Enter</span>
        <button
          type="button"
          onClick={submit}
          disabled={sending || !note.trim() || disabled}
          className="px-3 py-1 rounded-md text-xs bg-gray-800 hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed text-gray-200"
        >
          {sending ? 'Sending...' : 'Send'}
        </button>
      </div>
      {sent.length > 0 && (
        <ul className="mt-1 space-y-1 max-h-24 overflow-y-auto">
          {sent.slice().reverse().map((n, i) => (
            <li key={i} className="text-[10px] text-gray-500 truncate" title={n.text}>
              note: {n.text}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
