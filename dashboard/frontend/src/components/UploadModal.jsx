import { useState, useRef, useId, useEffect } from 'react'
import { getUploadUrl, startPredict } from '../utils/api'
import useStore from '../stores/useStore'

export default function UploadModal({ mode, onClose }) {
  const titleId = useId()
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState(null)
  const [text, setText] = useState('')
  const [selectedFile, setSelectedFile] = useState(null)
  const [isDragging, setIsDragging] = useState(false)
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
    const firstControl = mode === 'file' ? dialogRef.current : textRef.current
    firstControl?.focus()
  }, [mode])

  function acceptFile(file) {
    if (!file) {
      return
    }
    if (!file.type.startsWith('video/') && !file.type.startsWith('audio/')) {
      setError('Unsupported file type. Choose a video or audio file.')
      return
    }
    setSelectedFile(file)
    setError(null)
  }

  function handleDrop(e) {
    e.preventDefault()
    setIsDragging(false)
    acceptFile(e.dataTransfer.files?.[0])
  }

  async function handleFileUpload() {
    const file = selectedFile
    if (!file) {
      setError('Choose a video or audio file first.')
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
        className="bg-gray-900 rounded-xl p-6 w-full max-w-lg border border-gray-700 shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h2 id={titleId} className="text-xl font-semibold text-white">
              {mode === 'file' ? 'Upload video or audio' : 'Paste text'}
            </h2>
            <p className="mt-1 text-sm text-gray-500">
              {mode === 'file' ? 'Drop a stimulus file here or choose one from disk.' : 'Analyze plain text as a stimulus.'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-md px-2 py-1 text-sm text-gray-500 hover:bg-gray-800 hover:text-white transition"
            aria-label="Close upload dialog"
          >
            Esc
          </button>
        </div>

        {mode === 'file' ? (
          <>
            <input
              ref={fileRef}
              type="file"
              accept="video/*,audio/*"
              className="sr-only"
              onChange={(e) => acceptFile(e.target.files?.[0])}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              onDragEnter={(e) => {
                e.preventDefault()
                setIsDragging(true)
              }}
              onDragOver={(e) => {
                e.preventDefault()
                setIsDragging(true)
              }}
              onDragLeave={(e) => {
                e.preventDefault()
                if (!e.currentTarget.contains(e.relatedTarget)) {
                  setIsDragging(false)
                }
              }}
              onDrop={handleDrop}
              className={`group flex min-h-56 w-full flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 text-center transition ${
                isDragging
                  ? 'border-red-400 bg-red-500/10'
                  : selectedFile
                    ? 'border-emerald-400/60 bg-emerald-500/10'
                    : 'border-gray-700 bg-gray-950/70 hover:border-gray-500 hover:bg-gray-950'
              }`}
              aria-label="Choose or drop a video or audio file"
            >
              <span
                className={`mb-4 flex h-14 w-14 items-center justify-center rounded-xl border text-2xl transition ${
                  selectedFile
                    ? 'border-emerald-400/40 bg-emerald-400/10 text-emerald-300'
                    : 'border-gray-700 bg-gray-900 text-gray-300 group-hover:border-gray-500'
                }`}
                aria-hidden="true"
              >
                {selectedFile ? '✓' : '↑'}
              </span>
              <span className="text-base font-semibold text-gray-100">
                {selectedFile ? selectedFile.name : 'Drop media here'}
              </span>
              <span className="mt-2 max-w-sm text-sm leading-6 text-gray-500">
                {selectedFile
                  ? `${(selectedFile.size / 1024 / 1024).toFixed(1)} MB · ${selectedFile.type || 'media file'}`
                  : 'Click to browse, or drag in a video/audio file.'}
              </span>
            </button>
          </>
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
