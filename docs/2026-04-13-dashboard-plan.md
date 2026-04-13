# neuroLoop Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a browser dashboard that uploads media, runs TRIBE v2 on a Lambda Cloud GPU, and displays synchronized 3D brain + video + region scores.

**Architecture:** FastAPI backend on the GPU instance handles inference and S3 storage. React + Three.js frontend renders the 3D brain mesh with per-vertex activation coloring, synced to video playback via a shared timeline. Zustand manages client-side state.

**Tech Stack:** React 19, Vite, Three.js (react-three-fiber), Tailwind CSS, Zustand, FastAPI, boto3, tribev2, neuroLoop

---

## File Structure

```
dashboard/
├── backend/
│   ├── app/
│   │   ├── main.py           FastAPI app, CORS, endpoint routing
│   │   ├── s3.py             S3 presigned URLs, upload, download
│   │   ├── mesh.py           fsaverage5 mesh extraction + caching
│   │   └── predict.py        TRIBE v2 inference + neuroLoop region extraction
│   └── requirements.txt
│
└── frontend/
    ├── src/
    │   ├── main.jsx           React entry point
    │   ├── App.jsx            Top-level layout (3 panels + topbar)
    │   ├── stores/
    │   │   └── useStore.js    Zustand store: timeline, preds, regions, jobs
    │   ├── utils/
    │   │   ├── colorscale.js  Activation float → RGB color
    │   │   └── api.js         Fetch wrappers for all backend endpoints
    │   └── components/
    │       ├── TopBar.jsx     Logo + upload/text buttons
    │       ├── UploadModal.jsx  File upload + text paste modal
    │       ├── VideoPlayer.jsx  HTML5 <video> synced to store
    │       ├── TextDisplay.jsx  Scrolling text display for text input
    │       ├── BrainViewer.jsx  Three.js brain mesh + vertex coloring
    │       ├── Timeline.jsx     Play/pause + scrubber bar
    │       └── RegionPanel.jsx  Ranked activation list
    ├── index.html
    ├── package.json
    ├── vite.config.js
    └── tailwind.config.js
```

---

### Task 1: Backend — Project scaffold and S3 helpers

**Files:**
- Create: `dashboard/backend/app/__init__.py`
- Create: `dashboard/backend/app/s3.py`
- Create: `dashboard/backend/app/main.py`
- Create: `dashboard/backend/requirements.txt`

- [ ] **Step 1: Create requirements.txt**

```
fastapi>=0.115
uvicorn>=0.34
boto3>=1.35
python-multipart>=0.0.18
nilearn>=0.11
numpy>=2.0
```

- [ ] **Step 2: Create S3 helper module**

```python
# dashboard/backend/app/s3.py
import uuid
import boto3
from functools import lru_cache

BUCKET = "neuroloop-data"  # configure via env var in production

@lru_cache
def _client():
    return boto3.client("s3")

def presigned_upload_url(filename: str, content_type: str) -> dict:
    key = f"uploads/{uuid.uuid4().hex[:12]}/{filename}"
    url = _client().generate_presigned_url(
        "put_object",
        Params={"Bucket": BUCKET, "Key": key, "ContentType": content_type},
        ExpiresIn=3600,
    )
    return {"upload_url": url, "s3_key": key}

def presigned_download_url(key: str) -> str:
    return _client().generate_presigned_url(
        "get_object",
        Params={"Bucket": BUCKET, "Key": key},
        ExpiresIn=3600,
    )

def download_file(key: str, local_path: str) -> str:
    _client().download_file(BUCKET, key, local_path)
    return local_path

def upload_file(local_path: str, key: str) -> None:
    _client().upload_file(local_path, BUCKET, key)

def upload_bytes(data: bytes, key: str, content_type: str = "application/octet-stream") -> None:
    _client().put_object(Bucket=BUCKET, Key=key, Body=data, ContentType=content_type)

def list_prefix(prefix: str) -> list[str]:
    resp = _client().list_objects_v2(Bucket=BUCKET, Prefix=prefix)
    return [obj["Key"] for obj in resp.get("Contents", [])]
```

- [ ] **Step 3: Create minimal FastAPI app with upload endpoint**

```python
# dashboard/backend/app/main.py
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from .s3 import presigned_upload_url

app = FastAPI(title="neuroLoop API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

class UploadRequest(BaseModel):
    filename: str
    content_type: str

@app.post("/api/upload")
def upload(req: UploadRequest):
    return presigned_upload_url(req.filename, req.content_type)

@app.get("/api/health")
def health():
    return {"status": "ok"}
```

- [ ] **Step 4: Create empty __init__.py**

```python
# dashboard/backend/app/__init__.py
```

- [ ] **Step 5: Verify server starts**

Run: `cd dashboard/backend && uvicorn app.main:app --reload --port 8000`
Open: `http://localhost:8000/api/health`
Expected: `{"status":"ok"}`

- [ ] **Step 6: Commit**

```bash
git add dashboard/backend/
git commit -m "feat(backend): scaffold FastAPI app with S3 helpers and upload endpoint"
```

---

### Task 2: Backend — Mesh endpoint

**Files:**
- Create: `dashboard/backend/app/mesh.py`
- Modify: `dashboard/backend/app/main.py`

- [ ] **Step 1: Create mesh extraction module**

```python
# dashboard/backend/app/mesh.py
import numpy as np
import nibabel as nib
from functools import lru_cache
from nilearn.datasets import fetch_surf_fsaverage

@lru_cache
def get_fsaverage5_mesh() -> dict:
    """Load fsaverage5 mesh geometry. Cached after first call."""
    fs = fetch_surf_fsaverage("fsaverage5")

    vertices_list = []
    faces_list = []
    offset = 0
    for hemi in ("left", "right"):
        coords, faces_arr = nib.load(fs[f"pial_{hemi}"]).darrays
        coords = coords.data
        faces_arr = faces_arr.data
        vertices_list.append(coords)
        faces_list.append(faces_arr + offset)
        offset += len(coords)

    vertices = np.concatenate(vertices_list, axis=0)
    faces = np.concatenate(faces_list, axis=0)
    return {
        "vertices": vertices.tolist(),
        "faces": faces.tolist(),
        "n_vertices": len(vertices),
    }
```

- [ ] **Step 2: Add mesh endpoint to main.py**

Add to `dashboard/backend/app/main.py` after the upload endpoint:

```python
from .mesh import get_fsaverage5_mesh

@app.get("/api/mesh")
def mesh():
    return get_fsaverage5_mesh()
```

- [ ] **Step 3: Test the endpoint**

Run: `cd dashboard/backend && uvicorn app.main:app --reload --port 8000`
Open: `http://localhost:8000/api/mesh`
Expected: JSON with `vertices` (20484 entries of [x,y,z]), `faces`, `n_vertices: 20484`

- [ ] **Step 4: Commit**

```bash
git add dashboard/backend/app/mesh.py dashboard/backend/app/main.py
git commit -m "feat(backend): add /api/mesh endpoint for fsaverage5 geometry"
```

---

### Task 3: Backend — Predict endpoint with job tracking

**Files:**
- Create: `dashboard/backend/app/predict.py`
- Modify: `dashboard/backend/app/main.py`

- [ ] **Step 1: Create prediction module**

```python
# dashboard/backend/app/predict.py
import json
import tempfile
import uuid
from pathlib import Path
from datetime import datetime, timezone

import numpy as np

from . import s3

# Global job store (in-memory, single instance)
_jobs: dict[str, dict] = {}

def get_job(job_id: str) -> dict | None:
    return _jobs.get(job_id)

def list_jobs() -> list[dict]:
    return [
        {
            "job_id": j["job_id"],
            "filename": j["filename"],
            "timestamp": j["timestamp"],
            "status": j["status"],
            "n_timesteps": j.get("n_timesteps"),
        }
        for j in sorted(_jobs.values(), key=lambda x: x["timestamp"], reverse=True)
    ]

def start_prediction(s3_key: str, input_type: str) -> str:
    """Start a prediction job in background. Returns job_id."""
    import threading

    job_id = f"job_{uuid.uuid4().hex[:8]}"
    filename = s3_key.split("/")[-1]
    _jobs[job_id] = {
        "job_id": job_id,
        "s3_key": s3_key,
        "input_type": input_type,
        "filename": filename,
        "status": "processing",
        "progress": 0.0,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    thread = threading.Thread(target=_run_prediction, args=(job_id,), daemon=True)
    thread.start()
    return job_id

def _run_prediction(job_id: str) -> None:
    job = _jobs[job_id]
    try:
        job["progress"] = 0.1

        # Download media from S3
        with tempfile.TemporaryDirectory() as tmpdir:
            local_path = str(Path(tmpdir) / job["filename"])
            s3.download_file(job["s3_key"], local_path)
            job["progress"] = 0.2

            # Load model (lazy — first call is slow)
            from tribev2 import TribeModel
            model = _get_model()
            job["progress"] = 0.4

            # Build events and predict
            input_type = job["input_type"]
            if input_type == "video":
                events = model.get_events_dataframe(video_path=local_path)
            elif input_type == "audio":
                events = model.get_events_dataframe(audio_path=local_path)
            elif input_type == "text":
                events = model.get_events_dataframe(text_path=local_path)
            else:
                raise ValueError(f"Unknown input_type: {input_type}")

            job["progress"] = 0.6
            preds, segments = model.predict(events=events, verbose=False)
            job["progress"] = 0.8

            # Run neuroLoop region analysis
            from neuroLoop import BrainAtlas
            atlas = BrainAtlas()
            region_df = atlas.all_region_timeseries(preds)
            regions_dict = {col: region_df[col].tolist() for col in region_df.columns}

            # Build group lookup for frontend (region_name -> fine group name)
            from neuroLoop.regions import FINE_GROUPS, COARSE_GROUPS
            region_to_fine = {}
            for group, members in FINE_GROUPS.items():
                for r in members:
                    region_to_fine[r] = group
            region_to_coarse = {}
            for group, members in COARSE_GROUPS.items():
                for r in members:
                    region_to_coarse[r] = group

            # Save results to S3
            prefix = f"results/{job_id}"

            # preds as .npy bytes
            import io
            buf = io.BytesIO()
            np.save(buf, preds)
            s3.upload_bytes(buf.getvalue(), f"{prefix}/preds.npy")

            # regions + group lookup as JSON
            regions_payload = {
                "regions": regions_dict,
                "fine_groups": region_to_fine,
                "coarse_groups": region_to_coarse,
            }
            s3.upload_bytes(
                json.dumps(regions_payload).encode(),
                f"{prefix}/regions.json",
                content_type="application/json",
            )

            # metadata
            meta = {
                "job_id": job_id,
                "filename": job["filename"],
                "input_type": input_type,
                "n_timesteps": int(preds.shape[0]),
                "n_vertices": int(preds.shape[1]),
                "timestamp": job["timestamp"],
            }
            s3.upload_bytes(
                json.dumps(meta).encode(),
                f"{prefix}/meta.json",
                content_type="application/json",
            )

            job["n_timesteps"] = meta["n_timesteps"]
            job["status"] = "done"
            job["progress"] = 1.0
            job["results_prefix"] = prefix

    except Exception as e:
        job["status"] = "error"
        job["error"] = str(e)


_model_cache = None

def _get_model():
    global _model_cache
    if _model_cache is None:
        from tribev2 import TribeModel
        _model_cache = TribeModel.from_pretrained("facebook/tribev2", cache_folder="./cache")
    return _model_cache
```

- [ ] **Step 2: Add predict, results, and runs endpoints to main.py**

Add to `dashboard/backend/app/main.py`:

```python
from .predict import start_prediction, get_job, list_jobs
from .s3 import presigned_download_url

class PredictRequest(BaseModel):
    s3_key: str
    input_type: str  # "video", "audio", "text"

@app.post("/api/predict")
def predict(req: PredictRequest):
    job_id = start_prediction(req.s3_key, req.input_type)
    return {"job_id": job_id}

@app.get("/api/results/{job_id}")
def results(job_id: str):
    job = get_job(job_id)
    if job is None:
        return {"status": "not_found"}
    if job["status"] == "processing":
        return {"status": "processing", "progress": job["progress"]}
    if job["status"] == "error":
        return {"status": "error", "error": job.get("error", "unknown")}
    # done
    prefix = job["results_prefix"]
    return {
        "status": "done",
        "preds_url": presigned_download_url(f"{prefix}/preds.npy"),
        "regions_url": presigned_download_url(f"{prefix}/regions.json"),
        "meta": {
            "job_id": job["job_id"],
            "filename": job["filename"],
            "n_timesteps": job["n_timesteps"],
            "timestamp": job["timestamp"],
        },
    }

@app.get("/api/runs")
def runs():
    return {"runs": list_jobs()}
```

- [ ] **Step 3: Test endpoints with curl**

```bash
# Start server
cd dashboard/backend && uvicorn app.main:app --reload --port 8000

# Test predict (will fail on S3/model, but should return job_id)
curl -X POST http://localhost:8000/api/predict \
  -H "Content-Type: application/json" \
  -d '{"s3_key":"test/clip.mp4","input_type":"video"}'
# Expected: {"job_id":"job_..."}

# Test runs
curl http://localhost:8000/api/runs
# Expected: {"runs":[{"job_id":"job_...","filename":"clip.mp4",...}]}
```

- [ ] **Step 4: Commit**

```bash
git add dashboard/backend/app/predict.py dashboard/backend/app/main.py
git commit -m "feat(backend): add predict, results, and runs endpoints"
```

---

### Task 4: Frontend — Project scaffold with Vite + React + Tailwind

**Files:**
- Create: `dashboard/frontend/` (scaffold via Vite)

- [ ] **Step 1: Scaffold Vite React project**

```bash
cd dashboard
npm create vite@latest frontend -- --template react
cd frontend
npm install
```

- [ ] **Step 2: Install dependencies**

```bash
cd dashboard/frontend
npm install three @react-three/fiber @react-three/drei zustand
npm install -D tailwindcss @tailwindcss/vite
```

- [ ] **Step 3: Configure Tailwind in vite.config.js**

Replace `dashboard/frontend/vite.config.js`:

```js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': 'http://localhost:8000',
    },
  },
})
```

- [ ] **Step 4: Add Tailwind import to CSS**

Replace `dashboard/frontend/src/index.css`:

```css
@import "tailwindcss";
```

- [ ] **Step 5: Clean up default App and verify**

Replace `dashboard/frontend/src/App.jsx`:

```jsx
export default function App() {
  return (
    <div className="min-h-screen bg-gray-950 text-white flex items-center justify-center">
      <h1 className="text-2xl font-bold">neuroLoop</h1>
    </div>
  )
}
```

- [ ] **Step 6: Verify dev server**

Run: `cd dashboard/frontend && npm run dev`
Open: `http://localhost:5173`
Expected: Dark page with "neuroLoop" centered.

- [ ] **Step 7: Commit**

```bash
git add dashboard/frontend/
git commit -m "feat(frontend): scaffold Vite + React + Tailwind project"
```

---

### Task 5: Frontend — Zustand store and API helpers

**Files:**
- Create: `dashboard/frontend/src/stores/useStore.js`
- Create: `dashboard/frontend/src/utils/api.js`
- Create: `dashboard/frontend/src/utils/colorscale.js`

- [ ] **Step 1: Create API helper**

```js
// dashboard/frontend/src/utils/api.js
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
  return fetchJSON('/mesh')
}

export async function getRuns() {
  return fetchJSON('/runs')
}
```

- [ ] **Step 2: Create colorscale utility**

```js
// dashboard/frontend/src/utils/colorscale.js

/**
 * Map a normalized value (0–1) to an RGB color array [r, g, b] (each 0–1).
 * Uses a hot colorscale: black → red → yellow → white.
 */
export function hotColor(t) {
  t = Math.max(0, Math.min(1, t))
  const r = Math.min(1, t * 2.5)
  const g = Math.max(0, Math.min(1, (t - 0.4) * 2.5))
  const b = Math.max(0, Math.min(1, (t - 0.7) * 3.33))
  return [r, g, b]
}

/**
 * Build a Float32Array of RGB colors for all vertices at one timestep.
 * @param {Float32Array} activations - length n_vertices
 * @param {number} vmin - minimum activation (maps to 0)
 * @param {number} vmax - maximum activation (maps to 1)
 * @returns {Float32Array} - length n_vertices * 3 (r,g,b interleaved)
 */
export function activationsToColors(activations, vmin, vmax) {
  const n = activations.length
  const colors = new Float32Array(n * 3)
  const range = vmax - vmin || 1
  for (let i = 0; i < n; i++) {
    const t = (activations[i] - vmin) / range
    const [r, g, b] = hotColor(t)
    colors[i * 3] = r
    colors[i * 3 + 1] = g
    colors[i * 3 + 2] = b
  }
  return colors
}
```

- [ ] **Step 3: Create Zustand store**

```js
// dashboard/frontend/src/stores/useStore.js
import { create } from 'zustand'

const useStore = create((set, get) => ({
  // Timeline
  currentTime: 0,        // seconds (float)
  duration: 0,           // total duration in seconds
  isPlaying: false,
  timestep: 0,           // integer index into predictions

  setCurrentTime: (t) => {
    const { duration, preds } = get()
    const clamped = Math.max(0, Math.min(t, duration))
    const step = preds ? Math.min(Math.floor(clamped), preds.length - 1) : 0
    set({ currentTime: clamped, timestep: Math.max(0, step) })
  },
  setDuration: (d) => set({ duration: d }),
  setPlaying: (p) => set({ isPlaying: p }),
  togglePlaying: () => set((s) => ({ isPlaying: !s.isPlaying })),

  // Mesh (loaded once)
  mesh: null,            // { vertices: Float32Array, faces: Uint32Array, nVertices }
  setMesh: (m) => set({ mesh: m }),

  // Predictions
  preds: null,           // Array of Float32Array, one per timestep
  regions: null,         // { regionName: [value_per_timestep] }
  fineGroups: null,      // { regionName: "Fine Group Name" }
  coarseGroups: null,    // { regionName: "Coarse Group Name" }
  setPredictions: ({ preds, regions, fineGroups, coarseGroups }) =>
    set({ preds, regions, fineGroups, coarseGroups }),

  // Job tracking
  jobId: null,
  jobStatus: null,       // "processing" | "done" | "error"
  jobProgress: 0,
  setJob: (j) => set(j),

  // Input
  inputType: null,       // "video" | "audio" | "text"
  mediaUrl: null,        // presigned S3 URL for playback, or text content
  setInput: (inputType, mediaUrl) => set({ inputType, mediaUrl }),

  // Reset for new prediction
  reset: () => set({
    currentTime: 0, duration: 0, isPlaying: false, timestep: 0,
    preds: null, regions: null, fineGroups: null, coarseGroups: null,
    jobId: null, jobStatus: null, jobProgress: 0,
    inputType: null, mediaUrl: null,
  }),
}))

export default useStore
```

- [ ] **Step 4: Commit**

```bash
git add dashboard/frontend/src/stores/ dashboard/frontend/src/utils/
git commit -m "feat(frontend): add Zustand store, API helpers, and colorscale util"
```

---

### Task 6: Frontend — TopBar and UploadModal

**Files:**
- Create: `dashboard/frontend/src/components/TopBar.jsx`
- Create: `dashboard/frontend/src/components/UploadModal.jsx`
- Modify: `dashboard/frontend/src/App.jsx`

- [ ] **Step 1: Create TopBar**

```jsx
// dashboard/frontend/src/components/TopBar.jsx
import { useState } from 'react'
import UploadModal from './UploadModal'

export default function TopBar() {
  const [modalOpen, setModalOpen] = useState(false)
  const [modalMode, setModalMode] = useState('file') // 'file' | 'text'

  return (
    <>
      <div className="h-12 bg-gray-950 border-b border-gray-800 flex items-center justify-between px-4">
        <span className="text-lg font-bold text-red-500">neuroLoop</span>
        <div className="flex gap-2">
          <button
            onClick={() => { setModalMode('file'); setModalOpen(true) }}
            className="px-3 py-1.5 text-sm bg-gray-800 hover:bg-gray-700 rounded-md transition"
          >
            Upload Video
          </button>
          <button
            onClick={() => { setModalMode('text'); setModalOpen(true) }}
            className="px-3 py-1.5 text-sm bg-gray-800 hover:bg-gray-700 rounded-md transition"
          >
            Paste Text
          </button>
        </div>
      </div>
      {modalOpen && (
        <UploadModal mode={modalMode} onClose={() => setModalOpen(false)} />
      )}
    </>
  )
}
```

- [ ] **Step 2: Create UploadModal**

```jsx
// dashboard/frontend/src/components/UploadModal.jsx
import { useState, useRef } from 'react'
import { getUploadUrl, startPredict } from '../utils/api'
import useStore from '../stores/useStore'

export default function UploadModal({ mode, onClose }) {
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState(null)
  const [text, setText] = useState('')
  const fileRef = useRef()
  const setJob = useStore((s) => s.setJob)
  const setInput = useStore((s) => s.setInput)
  const reset = useStore((s) => s.reset)

  async function handleFileUpload() {
    const file = fileRef.current?.files?.[0]
    if (!file) return
    setUploading(true)
    setError(null)
    try {
      reset()
      const { upload_url, s3_key } = await getUploadUrl(file.name, file.type)
      await fetch(upload_url, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } })
      const inputType = file.type.startsWith('audio') ? 'audio' : 'video'
      setInput(inputType, URL.createObjectURL(file))
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
      await fetch(upload_url, { method: 'PUT', body: blob, headers: { 'Content-Type': 'text/plain' } })
      setInput('text', text)
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
      <div className="bg-gray-900 rounded-xl p-6 w-full max-w-md border border-gray-700" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold mb-4">
          {mode === 'file' ? 'Upload Video or Audio' : 'Paste Text'}
        </h2>

        {mode === 'file' ? (
          <input
            ref={fileRef}
            type="file"
            accept="video/*,audio/*"
            className="w-full text-sm text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:bg-gray-700 file:text-white hover:file:bg-gray-600"
          />
        ) : (
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Enter text to analyze..."
            rows={6}
            className="w-full bg-gray-800 rounded-lg p-3 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-red-500"
          />
        )}

        {error && <p className="text-red-400 text-sm mt-2">{error}</p>}

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
```

- [ ] **Step 3: Wire TopBar into App.jsx**

Replace `dashboard/frontend/src/App.jsx`:

```jsx
import TopBar from './components/TopBar'

export default function App() {
  return (
    <div className="h-screen flex flex-col bg-gray-950 text-white">
      <TopBar />
      <div className="flex-1 flex items-center justify-center text-gray-600">
        Upload a video or paste text to get started
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Verify in browser**

Run: `cd dashboard/frontend && npm run dev`
Expected: Dark page with TopBar showing "neuroLoop" + buttons. Clicking "Upload Video" opens the modal.

- [ ] **Step 5: Commit**

```bash
git add dashboard/frontend/src/
git commit -m "feat(frontend): add TopBar and UploadModal components"
```

---

### Task 7: Frontend — BrainViewer (Three.js)

**Files:**
- Create: `dashboard/frontend/src/components/BrainViewer.jsx`

- [ ] **Step 1: Create BrainViewer**

```jsx
// dashboard/frontend/src/components/BrainViewer.jsx
import { useRef, useEffect, useMemo } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import useStore from '../stores/useStore'
import { activationsToColors } from '../utils/colorscale'

function BrainMesh() {
  const meshRef = useRef()
  const mesh = useStore((s) => s.mesh)
  const preds = useStore((s) => s.preds)
  const timestep = useStore((s) => s.timestep)

  const geometry = useMemo(() => {
    if (!mesh) return null
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(mesh.vertices, 3))
    geo.setIndex(new THREE.BufferAttribute(mesh.faces, 1))
    geo.computeVertexNormals()
    // Initialize colors to gray
    const colors = new Float32Array(mesh.nVertices * 3).fill(0.3)
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
    return geo
  }, [mesh])

  useEffect(() => {
    if (!geometry || !preds || !preds[timestep]) return
    const activations = preds[timestep]
    // Compute min/max across this timestep for normalization
    let vmin = Infinity, vmax = -Infinity
    for (let i = 0; i < activations.length; i++) {
      if (activations[i] < vmin) vmin = activations[i]
      if (activations[i] > vmax) vmax = activations[i]
    }
    const colors = activationsToColors(activations, vmin, vmax)
    geometry.attributes.color.array.set(colors)
    geometry.attributes.color.needsUpdate = true
  }, [geometry, preds, timestep])

  if (!geometry) return null

  return (
    <mesh ref={meshRef} geometry={geometry}>
      <meshStandardMaterial vertexColors side={THREE.DoubleSide} />
    </mesh>
  )
}

export default function BrainViewer() {
  return (
    <div className="w-full h-full bg-gray-900 rounded-lg overflow-hidden">
      <Canvas camera={{ position: [0, 0, 250], fov: 45 }}>
        <ambientLight intensity={0.6} />
        <directionalLight position={[100, 100, 100]} intensity={0.8} />
        <BrainMesh />
        <OrbitControls enableDamping dampingFactor={0.1} />
      </Canvas>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add dashboard/frontend/src/components/BrainViewer.jsx
git commit -m "feat(frontend): add Three.js BrainViewer with vertex coloring"
```

---

### Task 8: Frontend — VideoPlayer and TextDisplay

**Files:**
- Create: `dashboard/frontend/src/components/VideoPlayer.jsx`
- Create: `dashboard/frontend/src/components/TextDisplay.jsx`

- [ ] **Step 1: Create VideoPlayer**

```jsx
// dashboard/frontend/src/components/VideoPlayer.jsx
import { useRef, useEffect } from 'react'
import useStore from '../stores/useStore'

export default function VideoPlayer() {
  const videoRef = useRef()
  const mediaUrl = useStore((s) => s.mediaUrl)
  const isPlaying = useStore((s) => s.isPlaying)
  const currentTime = useStore((s) => s.currentTime)
  const setDuration = useStore((s) => s.setDuration)
  const setCurrentTime = useStore((s) => s.setCurrentTime)

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    if (isPlaying) {
      video.play().catch(() => {})
    } else {
      video.pause()
    }
  }, [isPlaying])

  // Sync video position when user scrubs timeline
  useEffect(() => {
    const video = videoRef.current
    if (!video || isPlaying) return
    if (Math.abs(video.currentTime - currentTime) > 0.3) {
      video.currentTime = currentTime
    }
  }, [currentTime, isPlaying])

  function handleTimeUpdate() {
    const video = videoRef.current
    if (!video || !isPlaying) return
    setCurrentTime(video.currentTime)
  }

  function handleLoadedMetadata() {
    const video = videoRef.current
    if (video) setDuration(video.duration)
  }

  if (!mediaUrl) {
    return (
      <div className="w-full h-full bg-gray-900 rounded-lg flex items-center justify-center text-gray-600 text-sm">
        No media loaded
      </div>
    )
  }

  return (
    <div className="w-full h-full bg-black rounded-lg overflow-hidden flex items-center justify-center">
      <video
        ref={videoRef}
        src={mediaUrl}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        className="max-w-full max-h-full"
        muted
      />
    </div>
  )
}
```

- [ ] **Step 2: Create TextDisplay**

```jsx
// dashboard/frontend/src/components/TextDisplay.jsx
import useStore from '../stores/useStore'

export default function TextDisplay() {
  const mediaUrl = useStore((s) => s.mediaUrl) // for text, this is the text content

  if (!mediaUrl) {
    return (
      <div className="w-full h-full bg-gray-900 rounded-lg flex items-center justify-center text-gray-600 text-sm">
        No text loaded
      </div>
    )
  }

  return (
    <div className="w-full h-full bg-gray-900 rounded-lg p-4 overflow-y-auto">
      <p className="text-sm text-gray-300 leading-relaxed whitespace-pre-wrap">{mediaUrl}</p>
    </div>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add dashboard/frontend/src/components/VideoPlayer.jsx dashboard/frontend/src/components/TextDisplay.jsx
git commit -m "feat(frontend): add VideoPlayer and TextDisplay components"
```

---

### Task 9: Frontend — Timeline scrubber

**Files:**
- Create: `dashboard/frontend/src/components/Timeline.jsx`

- [ ] **Step 1: Create Timeline**

```jsx
// dashboard/frontend/src/components/Timeline.jsx
import useStore from '../stores/useStore'

function formatTime(seconds) {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

export default function Timeline() {
  const currentTime = useStore((s) => s.currentTime)
  const duration = useStore((s) => s.duration)
  const isPlaying = useStore((s) => s.isPlaying)
  const togglePlaying = useStore((s) => s.togglePlaying)
  const setCurrentTime = useStore((s) => s.setCurrentTime)

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0

  function handleScrub(e) {
    const rect = e.currentTarget.getBoundingClientRect()
    const x = (e.clientX - rect.left) / rect.width
    setCurrentTime(x * duration)
  }

  return (
    <div className="h-10 bg-gray-950 border-t border-b border-gray-800 flex items-center gap-3 px-4">
      <button
        onClick={togglePlaying}
        className="text-white hover:text-red-400 transition text-sm w-6"
      >
        {isPlaying ? '⏸' : '▶'}
      </button>
      <span className="text-xs text-gray-500 w-10 text-right">{formatTime(currentTime)}</span>
      <div
        className="flex-1 h-1 bg-gray-800 rounded cursor-pointer relative"
        onClick={handleScrub}
      >
        <div
          className="h-full rounded"
          style={{
            width: `${progress}%`,
            background: 'linear-gradient(90deg, #e94560, #533483)',
          }}
        />
      </div>
      <span className="text-xs text-gray-500 w-10">{formatTime(duration)}</span>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add dashboard/frontend/src/components/Timeline.jsx
git commit -m "feat(frontend): add Timeline scrubber component"
```

---

### Task 10: Frontend — RegionPanel

**Files:**
- Create: `dashboard/frontend/src/components/RegionPanel.jsx`

- [ ] **Step 1: Create RegionPanel**

```jsx
// dashboard/frontend/src/components/RegionPanel.jsx
import useStore from '../stores/useStore'

const COARSE_COLORS = {
  'Visual': '#e94560',
  'Somatomotor': '#3b82f6',
  'Dorsal Attention': '#10b981',
  'Ventral Attention': '#f59e0b',
  'Limbic': '#8b5cf6',
  'Frontoparietal': '#ec4899',
  'Default': '#6b7280',
}

export default function RegionPanel() {
  const regions = useStore((s) => s.regions)
  const fineGroups = useStore((s) => s.fineGroups)
  const coarseGroups = useStore((s) => s.coarseGroups)
  const timestep = useStore((s) => s.timestep)

  if (!regions) {
    return (
      <div className="h-full bg-gray-950 p-4 flex items-center justify-center text-gray-600 text-sm">
        Run a prediction to see region scores
      </div>
    )
  }

  // Build sorted list for current timestep
  const entries = Object.entries(regions)
    .map(([name, values]) => ({ name, value: values[timestep] ?? 0 }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 10)

  const maxVal = entries[0]?.value || 1

  return (
    <div className="h-full bg-gray-950 p-4 overflow-y-auto">
      <div className="text-xs text-gray-500 font-semibold mb-2">
        TOP ACTIVATED REGIONS <span className="text-gray-600 font-normal">@ t={timestep}s</span>
      </div>
      <div className="flex flex-col gap-1.5">
        {entries.map(({ name, value }) => {
          const coarse = coarseGroups?.[name] || ''
          const fine = fineGroups?.[name] || ''
          const color = COARSE_COLORS[coarse] || '#6b7280'
          const pct = maxVal > 0 ? (value / maxVal) * 100 : 0

          return (
            <div key={name} className="flex items-center gap-2">
              <span className="text-xs text-gray-300 w-28 truncate" title={`${name} — ${fine}`}>
                {name}
                <span className="text-gray-600 ml-1 text-[10px]">({fine})</span>
              </span>
              <div className="flex-1 h-1.5 bg-gray-800 rounded">
                <div
                  className="h-full rounded"
                  style={{ width: `${pct}%`, backgroundColor: color }}
                />
              </div>
              <span className="text-[10px] text-gray-500 w-8 text-right">{value.toFixed(2)}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add dashboard/frontend/src/components/RegionPanel.jsx
git commit -m "feat(frontend): add RegionPanel with ranked activation scores"
```

---

### Task 11: Frontend — App layout and job polling

**Files:**
- Modify: `dashboard/frontend/src/App.jsx`

- [ ] **Step 1: Wire everything together in App.jsx**

Replace `dashboard/frontend/src/App.jsx`:

```jsx
import { useEffect } from 'react'
import TopBar from './components/TopBar'
import VideoPlayer from './components/VideoPlayer'
import TextDisplay from './components/TextDisplay'
import BrainViewer from './components/BrainViewer'
import Timeline from './components/Timeline'
import RegionPanel from './components/RegionPanel'
import useStore from './stores/useStore'
import { getMesh, getResults } from './utils/api'

export default function App() {
  const mesh = useStore((s) => s.mesh)
  const setMesh = useStore((s) => s.setMesh)
  const inputType = useStore((s) => s.inputType)
  const jobId = useStore((s) => s.jobId)
  const jobStatus = useStore((s) => s.jobStatus)
  const jobProgress = useStore((s) => s.jobProgress)
  const setJob = useStore((s) => s.setJob)
  const setPredictions = useStore((s) => s.setPredictions)
  const setDuration = useStore((s) => s.setDuration)

  // Load mesh on mount
  useEffect(() => {
    if (mesh) return
    getMesh().then((data) => {
      setMesh({
        vertices: new Float32Array(data.vertices.flat()),
        faces: new Uint32Array(data.faces.flat()),
        nVertices: data.n_vertices,
      })
    }).catch((err) => console.error('Failed to load mesh:', err))
  }, [mesh, setMesh])

  // Poll job status
  useEffect(() => {
    if (!jobId || jobStatus !== 'processing') return
    const interval = setInterval(async () => {
      try {
        const res = await getResults(jobId)
        if (res.status === 'done') {
          setJob({ jobStatus: 'done', jobProgress: 1 })
          // Fetch prediction data
          const [predsResp, regionsResp] = await Promise.all([
            fetch(res.preds_url).then((r) => r.arrayBuffer()),
            fetch(res.regions_url).then((r) => r.json()),
          ])
          // Parse .npy — skip 128-byte header, read float64
          const predsRaw = new Float64Array(predsResp, 128)
          const nTimesteps = res.meta.n_timesteps
          const nVerts = 20484
          const preds = []
          for (let t = 0; t < nTimesteps; t++) {
            preds.push(new Float32Array(predsRaw.slice(t * nVerts, (t + 1) * nVerts)))
          }
          setPredictions({
            preds,
            regions: regionsResp.regions,
            fineGroups: regionsResp.fine_groups,
            coarseGroups: regionsResp.coarse_groups,
          })
          if (inputType === 'text') {
            setDuration(nTimesteps)
          }
          clearInterval(interval)
        } else if (res.status === 'error') {
          setJob({ jobStatus: 'error' })
          clearInterval(interval)
        } else {
          setJob({ jobProgress: res.progress })
        }
      } catch (err) {
        console.error('Poll error:', err)
      }
    }, 2000)
    return () => clearInterval(interval)
  }, [jobId, jobStatus, inputType, setJob, setPredictions, setDuration])

  const hasResults = useStore((s) => !!s.preds)

  return (
    <div className="h-screen flex flex-col bg-gray-950 text-white">
      <TopBar />

      {/* Processing indicator */}
      {jobStatus === 'processing' && (
        <div className="h-1 bg-gray-800">
          <div
            className="h-full transition-all duration-500"
            style={{
              width: `${jobProgress * 100}%`,
              background: 'linear-gradient(90deg, #e94560, #533483)',
            }}
          />
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 flex min-h-0">
        {/* Left: Video/Text */}
        <div className="w-1/2 border-r border-gray-800">
          {inputType === 'text' ? <TextDisplay /> : <VideoPlayer />}
        </div>
        {/* Right: Brain */}
        <div className="w-1/2">
          <BrainViewer />
        </div>
      </div>

      {/* Timeline */}
      <Timeline />

      {/* Region panel */}
      <div className="h-48 border-t border-gray-800">
        <RegionPanel />
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify full layout in browser**

Run: `cd dashboard/frontend && npm run dev`
Expected: Full layout visible — TopBar, two panels (video left, brain right), timeline scrubber, region panel at bottom. All panels show placeholder content.

- [ ] **Step 3: Commit**

```bash
git add dashboard/frontend/src/App.jsx
git commit -m "feat(frontend): wire full dashboard layout with job polling"
```

---

### Task 12: Integration — Play loop and time sync

**Files:**
- Modify: `dashboard/frontend/src/App.jsx`

- [ ] **Step 1: Add play loop to App.jsx**

Add this `useEffect` inside `App` after the existing ones:

```jsx
  // Play loop — advance time when playing (for text input or as fallback)
  useEffect(() => {
    if (!useStore.getState().isPlaying) return
    if (inputType === 'video' || inputType === 'audio') return // video element drives time
    const interval = setInterval(() => {
      const { currentTime, duration, isPlaying } = useStore.getState()
      if (!isPlaying) return
      if (currentTime >= duration) {
        useStore.getState().setPlaying(false)
        return
      }
      useStore.getState().setCurrentTime(currentTime + 0.1)
    }, 100)
    return () => clearInterval(interval)
  }, [inputType, useStore((s) => s.isPlaying)])
```

- [ ] **Step 2: Commit**

```bash
git add dashboard/frontend/src/App.jsx
git commit -m "feat(frontend): add play loop for text-only mode time sync"
```

---

### Task 13: End-to-end test

**Files:** None (manual testing)

- [ ] **Step 1: Start backend**

```bash
cd dashboard/backend
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

- [ ] **Step 2: Start frontend**

```bash
cd dashboard/frontend
npm run dev
```

- [ ] **Step 3: Test mesh loading**

Open `http://localhost:5173`. The brain viewer panel should show a gray brain mesh (from `/api/mesh`). You should be able to rotate it with the mouse.

- [ ] **Step 4: Test upload flow (requires S3 + GPU)**

On the Lambda Cloud instance with S3 configured:
1. Click "Upload Video" → select a short video
2. Progress bar should appear and advance
3. When done, video plays on the left, brain colors on the right, region scores at the bottom
4. Scrubbing the timeline updates both brain colors and region scores

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat: complete neuroLoop dashboard — upload, predict, visualize"
```

---

## Self-Review Checklist

**Spec coverage:**
- ✅ Upload media (video/audio/text) → Task 6 (UploadModal)
- ✅ Run TRIBE v2 inference → Task 3 (predict endpoint)
- ✅ S3 storage (upload, results, mesh) → Tasks 1, 3
- ✅ 3D brain viewer with vertex coloring → Task 7 (BrainViewer)
- ✅ Video playback synced to timeline → Task 8 (VideoPlayer)
- ✅ Text display → Task 8 (TextDisplay)
- ✅ Timeline scrubber → Task 9
- ✅ Region scores ranked list → Task 10 (RegionPanel)
- ✅ Fine group labels + coarse color coding → Task 10
- ✅ Job polling with progress → Task 11 (App.jsx)
- ✅ Past runs listing → Task 3 (GET /api/runs)
- ✅ Mesh endpoint → Task 2
- ✅ Presigned upload URLs → Task 1
- ✅ Side-by-side + bottom panel layout → Task 11

**No placeholders found.** All code is complete in every step.

**Type consistency verified:** `useStore` shape, API response shapes, and component props are consistent across all tasks.
