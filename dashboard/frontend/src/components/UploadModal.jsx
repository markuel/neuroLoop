import { useState, useRef, useId, useEffect } from 'react'
import { getUploadUrl, startPredict } from '../utils/api'
import useStore from '../stores/useStore'

export default function UploadModal({ mode, onClose }) {
  const titleId = useId()
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState(null)
  const [text, setText] = useState('')
  const dialogRef = useRef()
  const fileRef = useRef()
  const textRef = useRef()
  const setJob = useStore((s) => s.setJob)
  const setInput = useStore((s) => s.setInput)
  const reset = useStore((s) => s.reset)

  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key === 'Escape') onClose()
      if (e.key !== 'Tab') return

      const focusable = Array.from(
        dialogRef.current?.querySelectorAll(
          'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((el) => el.offsetParent !== null)
      if (focusable.length === 0) return

      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  useEffect(() => {
    const firstControl = mode === 'file' ? fileRef.current : textRef.current
    firstControl?.focus()
  }, [mode])

  async function handleFileUpload() {
    const file = fileRef.current?.files?.[0]
    if (!file) {
      setError('Choose a video or audio file first.')
      return
    }
    if (!file.type.startsWith('video/') && !file.type.startsWith('audio/')) {
      setError('Unsupported file type. Choose a video or audio file.')
      return
    }
    setUploading(true)
    setError(null)
    try {
      reset()
      const { upload_url, s3_key } = await getUploadUrl(file.name, file.type)
      const putRes = await fetch(upload_url, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } })
      if (!putRes.ok) {
        const body = await putRes.text()
        console.error('S3 PUT failed', putRes.status, body)
        throw new Error(`S3 upload failed (${putRes.status}): ${body.slice(0, 500)}`)
      }
      const inputType = file.type.startsWith('audio') ? 'audio' : 'video'
      setInput(inputType, URL.createObjectURL(file), null)
      const { job_id } = await startPredict(s3_key, inputType)
      setJob({ jobId: job_id, jobStatus: 'processing', jobProgress: 0 })
      onClose()
    } catch (e) {
      setError(e.message)
    } finally {
      setUploading(false)
    }
  }

  async function handleTextSubmit() {
    if (!text.trim()) return
    setUploading(true)
    setError(null)
    try {
      reset()
      const blob = new Blob([text], { type: 'text/plain' })
      const filename = 'input.txt'
      const { upload_url, s3_key } = await getUploadUrl(filename, 'text/plain')
      const putRes = await fetch(upload_url, { method: 'PUT', body: blob, headers: { 'Content-Type': 'text/plain' } })
      if (!putRes.ok) {
        const body = await putRes.text()
        console.error('S3 PUT failed', putRes.status, body)
        throw new Error(`S3 upload failed (${putRes.status}): ${body.slice(0, 500)}`)
      }
      setInput('text', null, text)
      const { job_id } = await startPredict(s3_key, 'text')
      setJob({ jobId: job_id, jobStatus: 'processing', jobProgress: 0 })
      onClose()
    } catch (e) {
      setError(e.message)
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div
        ref={dialogRef}
        className="bg-gray-900 rounded-xl p-6 w-full max-w-md border border-gray-700"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id={titleId} className="text-lg font-semibold mb-4">
          {mode === 'file' ? 'Upload Video or Audio' : 'Paste Text'}
        </h2>

        {mode === 'file' ? (
          <input
            ref={fileRef}
            type="file"
            accept="video/*,audio/*"
            aria-label="Video or audio file"
            className="w-full text-sm text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:bg-gray-700 file:text-white hover:file:bg-gray-600"
          />
        ) : (
          <textarea
            ref={textRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Enter text to analyze..."
            aria-label="Text to analyze"
            rows={6}
            className="w-full bg-gray-800 rounded-lg p-3 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-red-500"
          />
        )}

        {error && <p className="text-red-400 text-sm mt-2" role="alert">{error}</p>}

        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-400 hover:text-white transition">
            Cancel
          </button>
          <button
            onClick={mode === 'file' ? handleFileUpload : handleTextSubmit}
            disabled={uploading}
            className="px-4 py-2 text-sm bg-red-600 hover:bg-red-500 rounded-md transition disabled:opacity-50"
          >
            {uploading ? 'Processing...' : 'Analyze'}
          </button>
        </div>
      </div>
    </div>
  )
}
