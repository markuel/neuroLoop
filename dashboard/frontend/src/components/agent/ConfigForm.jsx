import { useState, useRef, useId } from 'react'
import {
  createDraftSession, uploadReference, deleteReference, agentArtifactUrl,
} from '../../utils/api'

export default function ConfigForm({ config, onStart }) {
  const formId = useId()
  const targetId = `${formId}-target`
  const briefId = `${formId}-brief`
  const durationId = `${formId}-duration`
  const maxIterationsId = `${formId}-max-iterations`
  const targetScoreId = `${formId}-target-score`
  const [form, setForm] = useState({
    target_description: '',
    creative_brief: '',
    duration: 30,
    max_iterations: 20,
    target_score: 0.85,
  })
  const [draftId, setDraftId] = useState(null)
  const [refs, setRefs] = useState([])
  const [starting, setStarting] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [referenceError, setReferenceError] = useState(null)
  const [startError, setStartError] = useState(null)
  const fileRef = useRef(null)

  const set = (key, value) => setForm(prev => ({ ...prev, [key]: value }))

  const ensureDraft = async () => {
    if (draftId) return draftId
    const { session_id } = await createDraftSession()
    setDraftId(session_id)
    return session_id
  }

  const handleFiles = async (files) => {
    if (!files?.length) return
    setUploading(true)
    setReferenceError(null)
    try {
      const id = await ensureDraft()
      const uploaded = []
      for (const file of files) {
        const { name } = await uploadReference(id, file)
        uploaded.push({ name })
      }
      setRefs(prev => [...prev, ...uploaded])
    } catch (err) {
      console.error('Reference upload failed:', err)
      setReferenceError(err.message || 'Reference upload failed.')
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const handleRemove = async (name) => {
    if (!draftId) return
    setReferenceError(null)
    try {
      await deleteReference(draftId, name)
      setRefs(prev => prev.filter(item => item.name !== name))
    } catch (err) {
      console.error('Reference delete failed:', err)
      setReferenceError(err.message || 'Reference could not be removed.')
    }
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (!form.target_description.trim()) return
    setStarting(true)
    setStartError(null)
    try {
      await onStart({ ...form, session_id: draftId })
    } catch (err) {
      console.error('Agent start failed:', err)
      setStartError(err.message || 'Agent loop could not be started.')
    } finally {
      setStarting(false)
    }
  }

  const handleDrop = (event) => {
    event.preventDefault()
    handleFiles(Array.from(event.dataTransfer.files))
  }

  return (
    <form onSubmit={handleSubmit} className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <div className="space-y-2">
        <div className="text-xs uppercase tracking-[0.24em] text-gray-600">Generate Video</div>
        <h1 className="text-3xl font-semibold text-white md:text-4xl">Tell the agent what brain state to chase.</h1>
        <p className="max-w-2xl text-sm leading-relaxed text-gray-400">
          Start with the desired viewer state, then give the creative direction. The agent will plan frames,
          generate clips, score them with TRIBE, and iterate.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="rounded-xl border border-gray-800 bg-gray-950/80 p-4 shadow-2xl shadow-black/30">
          <label htmlFor={targetId} className="mb-2 block text-sm font-medium text-gray-200">
            Target brain state
          </label>
          <textarea
            id={targetId}
            className="min-h-36 w-full resize-none rounded-lg border border-gray-700 bg-black/40 px-4 py-3 text-base leading-relaxed text-white placeholder-gray-600 outline-none transition focus:border-red-500"
            placeholder="e.g. highly engaged viewer with social reflection, suspense, and strong scene-understanding activation"
            value={form.target_description}
            onChange={event => set('target_description', event.target.value)}
            required
          />

          <label htmlFor={briefId} className="mb-2 mt-5 block text-sm font-medium text-gray-200">
            Creative brief
          </label>
          <textarea
            id={briefId}
            className="min-h-48 w-full resize-none rounded-lg border border-gray-700 bg-black/40 px-4 py-3 text-base leading-relaxed text-white placeholder-gray-600 outline-none transition focus:border-red-500"
            placeholder="Describe the video itself: genre, setting, characters, mood, product, narration, references, constraints..."
            value={form.creative_brief}
            onChange={event => set('creative_brief', event.target.value)}
          />
        </div>

        <aside className="flex flex-col gap-4">
          <div
            onDrop={handleDrop}
            onDragOver={event => event.preventDefault()}
            className="rounded-xl border border-dashed border-gray-700 bg-gray-950/70 p-4"
          >
            <div className="mb-3">
              <div className="text-sm font-medium text-gray-200">Reference images</div>
              <p className="mt-1 text-xs leading-relaxed text-gray-500">
                Product photos, character references, or style frames.
              </p>
            </div>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="flex aspect-[4/3] w-full flex-col items-center justify-center rounded-lg border border-gray-800 bg-black/30 px-4 text-center text-sm text-gray-500 transition hover:border-gray-600 hover:text-gray-300 focus:border-red-500 focus:outline-none"
            >
              <span className="text-lg text-gray-300">{uploading ? 'Uploading...' : 'Drop or click'}</span>
              <span className="mt-1 text-xs text-gray-600">Images are saved with this draft session.</span>
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={event => handleFiles(Array.from(event.target.files))}
            />
            {referenceError && (
              <p className="mt-2 text-xs text-red-300" role="alert">
                {referenceError}
              </p>
            )}
            {refs.length > 0 && (
              <div className="mt-3 grid grid-cols-4 gap-2">
                {refs.map(ref => (
                  <div key={ref.name} className="group relative aspect-square overflow-hidden rounded-md border border-gray-800">
                    <img
                      src={agentArtifactUrl(draftId, `references/${ref.name}`)}
                      alt={ref.name}
                      className="h-full w-full object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => handleRemove(ref.name)}
                      className="absolute right-1 top-1 h-5 w-5 rounded-full bg-black/70 text-xs text-gray-300 opacity-0 transition group-hover:opacity-100"
                      aria-label={`Remove ${ref.name}`}
                    >
                      x
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <details className="rounded-xl border border-gray-800 bg-gray-950/70 p-4" open>
            <summary className="cursor-pointer text-sm font-medium text-gray-200">Run settings</summary>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div>
                <label htmlFor={durationId} className="mb-1.5 block text-xs text-gray-400">Duration</label>
                <select
                  id={durationId}
                  className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white outline-none focus:border-red-500"
                  value={form.duration}
                  onChange={event => set('duration', Number(event.target.value))}
                >
                  <option value={30}>30s</option>
                  <option value={45}>45s</option>
                  <option value={60}>60s</option>
                </select>
              </div>
              <div>
                <label htmlFor={maxIterationsId} className="mb-1.5 block text-xs text-gray-400">Max iterations</label>
                <input
                  id={maxIterationsId}
                  type="number"
                  min={1}
                  max={50}
                  className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white outline-none focus:border-red-500"
                  value={form.max_iterations}
                  onChange={event => set('max_iterations', Number(event.target.value))}
                />
              </div>
            </div>

            <div className="mt-4">
              <div className="mb-1.5 flex items-center justify-between gap-3">
                <label htmlFor={targetScoreId} className="text-xs text-gray-400">Target score</label>
                <span className="font-mono text-xs text-gray-300">{form.target_score.toFixed(2)}</span>
              </div>
              <input
                id={targetScoreId}
                type="range"
                min={0.5}
                max={1}
                step={0.01}
                className="w-full accent-red-500"
                value={form.target_score}
                onChange={event => set('target_score', Number(event.target.value))}
              />
              <div className="mt-1 flex justify-between font-mono text-[10px] text-gray-600">
                <span>0.50</span>
                <span>1.00</span>
              </div>
            </div>

            {config && (
              <div className="mt-4 rounded-lg border border-gray-800 bg-black/25 px-3 py-2 text-xs text-gray-500">
                <div>Image model: <span className="text-gray-300">{config.image_model}</span></div>
                <div className="mt-1">Video model: <span className="text-gray-300">{config.video_model}</span></div>
              </div>
            )}
          </details>

          {startError && (
            <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200" role="alert">
              {startError}
            </p>
          )}

          <button
            type="submit"
            disabled={starting || !form.target_description.trim()}
            className="rounded-xl bg-red-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {starting ? 'Starting agent...' : 'Start generation'}
          </button>
        </aside>
      </div>
    </form>
  )
}
