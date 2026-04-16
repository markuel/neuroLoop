const BASE = '/api'

export async function fetchJSON(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
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
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
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
