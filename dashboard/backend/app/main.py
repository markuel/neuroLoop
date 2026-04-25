# dashboard/backend/app/main.py
import asyncio
import json
import os
import uuid
from contextlib import asynccontextmanager
from typing import Literal
from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI, UploadFile, File, Request, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response, StreamingResponse
from pydantic import BaseModel, Field

from .storage import (
    STORAGE_MODE,
    presigned_upload_url,
    presigned_download_url,
    get_local_file_path,
    is_supported_upload_content_type,
    LOCAL_DATA_DIR,
)
from .mesh import get_fsaverage5_mesh_binary
from .predict import start_prediction, get_job, list_jobs, get_atlas_data, load_manifest
from .agent import (
    start_session,
    get_session,
    stop_session,
    list_sessions,
    tail_log,
    scan_artifacts,
    create_draft_session,
    append_user_note,
    SESSIONS_DIR,
    session_dir,
)

MAX_REFERENCE_BYTES = 20 * 1024 * 1024


def _safe_reference_name(name: str) -> str:
    safe = name.replace("/", "_").replace("\\", "_")
    if not safe or safe in {".", ".."}:
        raise HTTPException(status_code=400, detail="Invalid reference name")
    return safe


def _start_warmup():
    """Pre-load heavy resources in a background thread so first request is fast."""
    import threading

    def _load():
        from .predict import _get_model, _get_atlas, get_atlas_data
        from .mesh import get_fsaverage5_mesh_binary
        get_fsaverage5_mesh_binary()
        get_atlas_data()
        _get_model()

    load_manifest()
    threading.Thread(target=_load, daemon=True).start()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    _start_warmup()
    yield


app = FastAPI(title="neuroLoop API", lifespan=lifespan)


def _cors_origins() -> list[str]:
    raw = os.getenv("CORS_ORIGINS")
    if raw:
        return [origin.strip() for origin in raw.split(",") if origin.strip()]
    return [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:5174",
        "http://127.0.0.1:5174",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ]


app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins(),
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["Content-Type"],
    expose_headers=["X-N-Vertices", "X-N-Faces"],
)


# ------------------------------------------------------------------
# Upload
# ------------------------------------------------------------------

class UploadRequest(BaseModel):
    filename: str
    content_type: str

@app.post("/api/upload")
def upload(req: UploadRequest):
    if not is_supported_upload_content_type(req.content_type):
        raise HTTPException(status_code=415, detail="Uploads must be video, audio, or text/plain")
    return presigned_upload_url(req.filename, req.content_type)


@app.put("/api/upload/file/{key:path}")
async def upload_file_local(key: str, request: Request):
    """Direct file upload for local storage mode."""
    body = await request.body()
    try:
        dest = get_local_file_path(key)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid storage key")
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(body)
    return {"status": "ok", "key": key}


# ------------------------------------------------------------------
# Local file serving (only used in local storage mode)
# ------------------------------------------------------------------

@app.get("/api/files/{key:path}")
def serve_file(key: str):
    """Serve a locally stored file. Only active in local mode."""
    try:
        path = get_local_file_path(key)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid storage key")
    if not path.exists():
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(str(path))


# ------------------------------------------------------------------
# Download results as zip (local mode convenience)
# ------------------------------------------------------------------

@app.get("/api/download/{job_id}")
def download_results(job_id: str):
    """Zip and serve all results for a job. Works in both modes."""
    import tempfile, zipfile, io
    from .storage import download_file, list_prefix

    prefix = f"results/{job_id}"
    keys = list_prefix(prefix)
    if not keys:
        raise HTTPException(status_code=404, detail="No results found")

    if STORAGE_MODE == "local":
        # Zip directly from local files
        zip_buf = io.BytesIO()
        with zipfile.ZipFile(zip_buf, "w", zipfile.ZIP_DEFLATED) as zf:
            for key in keys:
                path = get_local_file_path(key)
                arcname = key.split("/", 2)[-1] if "/" in key else key
                zf.write(str(path), arcname)
        zip_buf.seek(0)

        # Write to temp file for FileResponse
        tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".zip")
        tmp.write(zip_buf.getvalue())
        tmp.close()
        return FileResponse(
            tmp.name,
            media_type="application/zip",
            filename=f"neuroloop-{job_id}.zip",
        )
    else:
        # S3 mode — download to temp, zip, serve
        zip_buf = io.BytesIO()
        with zipfile.ZipFile(zip_buf, "w", zipfile.ZIP_DEFLATED) as zf:
            for key in keys:
                with tempfile.NamedTemporaryFile() as tmp:
                    download_file(key, tmp.name)
                    arcname = key.split("/", 2)[-1] if "/" in key else key
                    zf.write(tmp.name, arcname)
        zip_buf.seek(0)

        tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".zip")
        tmp.write(zip_buf.getvalue())
        tmp.close()
        return FileResponse(
            tmp.name,
            media_type="application/zip",
            filename=f"neuroloop-{job_id}.zip",
        )


# ------------------------------------------------------------------
# Other endpoints
# ------------------------------------------------------------------

@app.get("/api/health")
def health():
    return {"status": "ok", "storage_mode": STORAGE_MODE}

@app.get("/api/mesh")
def mesh():
    buf, n_vertices, n_faces = get_fsaverage5_mesh_binary()
    return Response(
        content=buf,
        media_type="application/octet-stream",
        headers={
            "X-N-Vertices": str(n_vertices),
            "X-N-Faces": str(n_faces),
        },
    )


@app.get("/api/atlas")
def atlas():
    """Static region data (vertex indices, group lookups). Cached client-side."""
    return get_atlas_data()


class PredictRequest(BaseModel):
    s3_key: str
    input_type: Literal["video", "audio", "text"]

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
        "preds_url": presigned_download_url(f"{prefix}/preds.bin"),
        "regions_url": presigned_download_url(f"{prefix}/regions.json"),
        "meta_url": presigned_download_url(f"{prefix}/meta.json"),
        "meta": job.get("meta_cache", {}),
    }

@app.get("/api/runs")
def runs():
    return {"runs": list_jobs()}


# ------------------------------------------------------------------
# Config
# ------------------------------------------------------------------

@app.get("/api/config")
def config():
    import os
    return {
        "image_model": os.environ.get("IMAGE_MODEL", "openai"),
        "video_model": os.environ.get("VIDEO_MODEL", "veo"),
    }


# ------------------------------------------------------------------
# Agent sessions
# ------------------------------------------------------------------

class AgentStartRequest(BaseModel):
    target_description: str = Field(min_length=1, max_length=2000)
    creative_brief: str = Field(default="", max_length=4000)
    duration: int = Field(default=30, ge=1, le=300)
    max_iterations: int = Field(default=20, ge=1, le=50)
    target_score: float = Field(default=0.85, ge=0, le=1)
    session_id: str | None = None  # if provided, reuses a draft session (with uploaded refs)

@app.post("/api/agent/start")
def agent_start(req: AgentStartRequest):
    data = req.model_dump()
    draft_id = data.pop("session_id", None)
    try:
        session_id = start_session(data, session_id=draft_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid session ID")
    except OSError:
        raise HTTPException(status_code=503, detail="Agent runtime is unavailable")
    return {"session_id": session_id}


@app.post("/api/agent/sessions/draft")
def agent_create_draft():
    """Create an empty session directory so the UI can upload reference images before starting."""
    return {"session_id": create_draft_session()}


@app.post("/api/agent/sessions/{session_id}/references")
async def agent_upload_reference(session_id: str, file: UploadFile = File(...)):
    if not (file.content_type or "").startswith("image/"):
        raise HTTPException(status_code=415, detail="Reference uploads must be images")
    try:
        session_path = session_dir(session_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid session ID")
    ref_dir = session_path / "references"
    if not ref_dir.parent.exists():
        raise HTTPException(status_code=404, detail="Session not found")
    ref_dir.mkdir(parents=True, exist_ok=True)
    # Preserve original name but avoid path traversal
    safe_name = _safe_reference_name(file.filename) if file.filename else f"ref_{uuid.uuid4().hex[:8]}.bin"
    dest = ref_dir / safe_name
    data = await file.read(MAX_REFERENCE_BYTES + 1)
    if len(data) > MAX_REFERENCE_BYTES:
        raise HTTPException(status_code=413, detail="Reference image is too large")
    dest.write_bytes(data)
    return {"name": safe_name}


@app.delete("/api/agent/sessions/{session_id}/references/{name}")
def agent_delete_reference(session_id: str, name: str):
    try:
        p = session_dir(session_id) / "references" / _safe_reference_name(name)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid session ID")
    if p.exists():
        p.unlink()
    return {"ok": True}


class NoteRequest(BaseModel):
    note: str

@app.post("/api/agent/sessions/{session_id}/notes")
def agent_add_note(session_id: str, req: NoteRequest):
    if not req.note.strip():
        return {"ok": False}
    try:
        append_user_note(session_id, req.note)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid session ID")
    return {"ok": True}


@app.get("/api/agent/sessions/{session_id}/artifact/{path:path}")
def agent_artifact(session_id: str, path: str):
    """Serve any file from inside the session directory (thumbnails, JSON, segment clips)."""
    try:
        base = session_dir(session_id).resolve()
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid session ID")
    target = (base / path).resolve()
    try:
        target.relative_to(base)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid path")
    if not target.exists() or not target.is_file():
        raise HTTPException(status_code=404, detail="Not found")
    return FileResponse(str(target))


@app.get("/api/agent/sessions/{session_id}/artifacts-stream")
async def agent_artifacts_stream(session_id: str):
    """SSE stream that emits every artifact currently on disk, then any new arrivals."""
    try:
        session_dir(session_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid session ID")
    if get_session(session_id) is None:
        raise HTTPException(status_code=404, detail="Session not found")

    async def event_generator():
        seen: set[str] = set()
        while True:
            artifacts = scan_artifacts(session_id)
            new_items = [a for a in artifacts if a["path"] not in seen]
            for a in new_items:
                seen.add(a["path"])
                yield f"data: {json.dumps(a)}\n\n"
            s = get_session(session_id)
            if s and not s["is_running"]:
                # One final pass after the process exits to catch anything flushed late
                artifacts = scan_artifacts(session_id)
                for a in artifacts:
                    if a["path"] not in seen:
                        seen.add(a["path"])
                        yield f"data: {json.dumps(a)}\n\n"
                yield "event: done\ndata: \n\n"
                break
            await asyncio.sleep(1.0)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )

@app.get("/api/agent/sessions")
def agent_sessions():
    return {"sessions": list_sessions()}

@app.get("/api/agent/sessions/{session_id}")
def agent_session(session_id: str):
    s = get_session(session_id)
    if s is None:
        raise HTTPException(status_code=404, detail="Session not found")
    return s

@app.post("/api/agent/sessions/{session_id}/stop")
def agent_stop(session_id: str):
    try:
        session_dir(session_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid session ID")
    ok = stop_session(session_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Running session not found")
    return {"stopped": ok}

@app.get("/api/agent/sessions/{session_id}/video/{iteration}")
def agent_video(session_id: str, iteration: int):
    try:
        video_path = session_dir(session_id) / "iterations" / str(iteration) / "final.mp4"
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid session ID")
    if not video_path.exists():
        raise HTTPException(status_code=404, detail="Video not found")
    return FileResponse(str(video_path), media_type="video/mp4")


@app.get("/api/agent/sessions/{session_id}/log-stream")
async def agent_log_stream(session_id: str):
    """SSE stream of the agent's raw Claude output log."""
    try:
        session_dir(session_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid session ID")
    if get_session(session_id) is None:
        raise HTTPException(status_code=404, detail="Session not found")

    async def event_generator():
        offset = 0
        while True:
            chunk, offset = tail_log(session_id, offset)
            if chunk:
                # Split into lines and emit each as an SSE data event
                for line in chunk.splitlines(keepends=True):
                    safe = line.replace("\n", " ").replace("\r", "")
                    yield f"data: {safe}\n\n"
            # Check if session has finished
            s = get_session(session_id)
            if s and not s["is_running"] and not chunk:
                yield "event: done\ndata: \n\n"
                break
            await asyncio.sleep(0.5)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
