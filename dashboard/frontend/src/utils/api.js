const BASE = '/api'

async function responseError(res) {
  const fallback = `${res.status} ${res.statusText}`
  const contentType = res.headers.get('Content-Type') || ''
  try {
    if (contentType.includes('application/json')) {
      const body = await res.json()
      if (typeof body?.detail === 'string') return new Error(body.detail)
      if (typeof body?.error === 'string') return new Error(body.error)
      return new Error(fallback)
    }
    const text = await res.text()
    return new Error(text || fallback)
  } catch {
    return new Error(fallback)
  }
}

export async function fetchJSON(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  })
  if (!res.ok) throw await responseError(res)
  return res.json()
}

export async function getUploadUrl(filename, contentType) {
  return fetchJSON('/upload', {
    method: 'POST',
    body: JSON.stringify({ filename, content_type: contentType }),
  })
}

export async function startPredict(s3Key, inputType) {
  return fetchJSON('/predict', {
    method: 'POST',
    body: JSON.stringify({ s3_key: s3Key, input_type: inputType }),
  })
}

export async function getResults(jobId) {
  return fetchJSON(`/results/${jobId}`)
}

export async function getMesh() {
  const res = await fetch(`${BASE}/mesh`)
  if (!res.ok) throw await responseError(res)
  const nVertices = parseInt(res.headers.get('X-N-Vertices'))
  const nFaces = parseInt(res.headers.get('X-N-Faces'))
  const buf = await res.arrayBuffer()
  const vertexBytes = nVertices * 3 * 4 // float32 × 3 components
  const vertices = new Float32Array(buf, 0, nVertices * 3)
  const faces = new Uint32Array(buf, vertexBytes, nFaces * 3)
  return { vertices, faces, nVertices }
}

export async function getAtlas() {
  return fetchJSON('/atlas')
}

export async function getRuns() {
  return fetchJSON('/runs')
}

export async function getConfig() {
  return fetchJSON('/config')
}

export async function startAgentSession(params) {
  return fetchJSON('/agent/start', {
    method: 'POST',
    body: JSON.stringify(params),
  })
}

export async function getAgentSession(sessionId) {
  return fetchJSON(`/agent/sessions/${sessionId}`)
}

export async function getAgentSessions() {
  return fetchJSON('/agent/sessions')
}

export async function stopAgentSession(sessionId) {
  return fetchJSON(`/agent/sessions/${sessionId}/stop`, { method: 'POST' })
}

export function agentVideoUrl(sessionId, iteration) {
  return `/api/agent/sessions/${sessionId}/video/${iteration}`
}

export function agentLogStreamUrl(sessionId) {
  return `/api/agent/sessions/${sessionId}/log-stream`
}

export function agentArtifactsStreamUrl(sessionId) {
  return `/api/agent/sessions/${sessionId}/artifacts-stream`
}

export function agentArtifactUrl(sessionId, path) {
  return `/api/agent/sessions/${sessionId}/artifact/${path}`
}

export async function createDraftSession() {
  return fetchJSON('/agent/sessions/draft', { method: 'POST' })
}

export async function uploadReference(sessionId, file) {
  const form = new FormData()
  form.append('file', file)
  const res = await fetch(`${BASE}/agent/sessions/${sessionId}/references`, {
    method: 'POST',
    body: form,
  })
  if (!res.ok) throw await responseError(res)
  return res.json()
}

export async function deleteReference(sessionId, name) {
  const res = await fetch(`${BASE}/agent/sessions/${sessionId}/references/${encodeURIComponent(name)}`, {
    method: 'DELETE',
  })
  if (!res.ok) throw await responseError(res)
  return res.json()
}

export async function addAgentNote(sessionId, note) {
  return fetchJSON(`/agent/sessions/${sessionId}/notes`, {
    method: 'POST',
    body: JSON.stringify({ note }),
  })
}
