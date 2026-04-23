import { useState, useRef } from 'react'
import {
  createDraftSession, uploadReference, deleteReference, agentArtifactUrl,
} from '../../utils/api'

export default function ConfigForm({ config, onStart }) {
  const [form, setForm] = useState({
    target_description: '',
    creative_brief: '',
    duration: 30,
    max_iterations: 20,
    target_score: 0.85,
  })
  const [draftId, setDraftId] = useState(null)
  const [refs, setRefs] = useState([]) // [{name}]
  const [starting, setStarting] = useState(false)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef(null)

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const ensureDraft = async () => {
    if (draftId) return draftId
    const { session_id } = await createDraftSession()
    setDraftId(session_id)
    return session_id
  }

  const handleFiles = async (files) => {
    if (!files?.length) return
    setUploading(true)
    try {
      const id = await ensureDraft()
      const uploaded = []
      for (const file of files) {
        const { name } = await uploadReference(id, file)
        uploaded.push({ name })
      }
      setRefs(r => [...r, ...uploaded])
    } catch (err) {
      console.error('upload failed', err)
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const handleRemove = async (name) => {
    if (!draftId) return
    await deleteReference(draftId, name)
    setRefs(r => r.filter(x => x.name !== name))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.target_description.trim()) return
    setStarting(true)
    try {
      await onStart({ ...form, session_id: draftId })
    } finally {
      setStarting(false)
    }
  }

  const handleDrop = (e) => {
    e.preventDefault()
    handleFiles(Array.from(e.dataTransfer.files))
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      <div>
        <label className="block text-xs text-gray-400 mb-1.5">Target brain state</label>
        <textarea
          className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-gray-600 resize-none focus:outline-none focus:border-red-500 transition"
          rows={3}
          placeholder="e.g. 'deep calm with spatial exploration, engaging motion and place regions'"
          value={form.target_description}
          onChange={e => set('target_description', e.target.value)}
          required
        />
      </div>

      <div>
        <label className="block text-xs text-gray-400 mb-1.5">
          Creative brief <span className="text-gray-600">(optional)</span>
        </label>
        <textarea
          className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-gray-600 resize-none focus:outline-none focus:border-red-500 transition"
          rows={3}
          placeholder="What the video should actually be — e.g. 'action chase through a neon city starring the character in the reference photo, holding the product'"
          value={form.creative_brief}
          onChange={e => set('creative_brief', e.target.value)}
        />
      </div>

      <div>
        <label className="block text-xs text-gray-400 mb-1.5">
          Reference images <span className="text-gray-600">(optional)</span>
        </label>
        <div
          onDrop={handleDrop}
          onDragOver={e => e.preventDefault()}
          onClick={() => fileRef.current?.click()}
          className="border border-dashed border-gray-700 rounded-lg px-3 py-4 text-xs text-gray-500 text-center cursor-pointer hover:border-gray-600 hover:text-gray-400 transition"
        >
          {uploading
            ? 'Uploading…'
            : refs.length
              ? `${refs.length} reference image${refs.length === 1 ? '' : 's'} — drop or click to add more`
              : 'Drop images here (product photos, character refs, style refs)'}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={e => handleFiles(Array.from(e.target.files))}
        />
        {refs.length > 0 && (
          <div className="mt-3 grid grid-cols-4 gap-2">
            {refs.map(r => (
              <div key={r.name} className="relative group aspect-square rounded-md overflow-hidden border border-gray-800">
                <img
                  src={agentArtifactUrl(draftId, `references/${r.name}`)}
                  alt={r.name}
                  className="w-full h-full object-cover"
                />
                <button
                  type="button"
                  onClick={() => handleRemove(r.name)}
                  className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/70 text-gray-300 text-xs opacity-0 group-hover:opacity-100 transition"
                  aria-label={`Remove ${r.name}`}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="block text-xs text-gray-400 mb-1.5">Duration</label>
          <select
            className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-red-500"
            value={form.duration}
            onChange={e => set('duration', Number(e.target.value))}
          >
            <option value={30}>30s</option>
            <option value={45}>45s</option>
            <option value={60}>60s</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1.5">Max iter.</label>
          <input
            type="number" min={1} max={50}
            className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-red-500"
            value={form.max_iterations}
            onChange={e => set('max_iterations', Number(e.target.value))}
          />
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1.5">Target</label>
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
          <span>Image: <span className="text-gray-300">{config.image_model}</span></span>
          <span>Video: <span className="text-gray-300">{config.video_model}</span></span>
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
