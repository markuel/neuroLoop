"""Durable archive for neuroLoop agent sessions.

The running agent still writes to agent/sessions/{session_id}. This module
mirrors that working directory into storage under agent-sessions/{session_id}
and keeps a small JSONL event log that the UI can stream and replay.
"""

from __future__ import annotations

import json
import logging
import mimetypes
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from typing import Any

from . import storage

logger = logging.getLogger(__name__)

ARCHIVE_ROOT = "agent-sessions"
ARCHIVE_INDEX_KEY = f"{ARCHIVE_ROOT}/manifest.json"
EVENTS_FILENAME = "events.jsonl"
JOURNAL_FILENAME = "journal.md"
LOCAL_MANIFEST_FILENAME = "archive_manifest.json"

_archive_lock = threading.RLock()


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def archive_prefix(session_id: str) -> str:
    return f"{ARCHIVE_ROOT}/{session_id}"


def archive_key(session_id: str, rel_path: str) -> str:
    return f"{archive_prefix(session_id)}/{_safe_rel_path(rel_path)}"


def events_path(session_path: Path) -> Path:
    return session_path / EVENTS_FILENAME


def journal_path(session_path: Path) -> Path:
    return session_path / JOURNAL_FILENAME


def local_manifest_path(session_path: Path) -> Path:
    return session_path / LOCAL_MANIFEST_FILENAME


def _safe_rel_path(path: str) -> str:
    posix = PurePosixPath(path.replace("\\", "/"))
    if posix.is_absolute() or any(part in {"", ".", ".."} for part in posix.parts):
        raise ValueError(f"Invalid archive path: {path}")
    return posix.as_posix()


def _content_type(path: str) -> str:
    if path.endswith(".jsonl"):
        return "application/jsonl"
    guessed, _ = mimetypes.guess_type(path)
    return guessed or "application/octet-stream"


def _read_storage_json(key: str, fallback: Any) -> Any:
    try:
        return json.loads(storage.download_bytes(key).decode("utf-8"))
    except Exception:
        return fallback


def _write_json_file(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, sort_keys=True), encoding="utf-8")


def _read_local_manifest(session_path: Path, session_id: str) -> dict:
    path = local_manifest_path(session_path)
    if path.exists():
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            logger.warning("Ignoring corrupt archive manifest at %s", path)
    return {
        "schema_version": 1,
        "session_id": session_id,
        "archive_prefix": archive_prefix(session_id),
        "created_at": now_iso(),
        "updated_at": now_iso(),
        "status": "draft",
        "artifacts": [],
    }


def _write_local_manifest(session_path: Path, manifest: dict) -> None:
    manifest["updated_at"] = now_iso()
    _write_json_file(local_manifest_path(session_path), manifest)


def _artifact_index(manifest: dict) -> dict[str, dict]:
    return {item["path"]: item for item in manifest.get("artifacts", []) if item.get("path")}


def _upsert_index_entry(summary: dict) -> None:
    index = _read_storage_json(ARCHIVE_INDEX_KEY, [])
    by_id = {item.get("session_id"): item for item in index if item.get("session_id")}
    by_id[summary["session_id"]] = {**by_id.get(summary["session_id"], {}), **summary}
    ordered = sorted(by_id.values(), key=lambda item: item.get("updated_at") or "", reverse=True)
    storage.upload_bytes(
        json.dumps(ordered, indent=2).encode("utf-8"),
        ARCHIVE_INDEX_KEY,
        "application/json",
    )


def _session_summary(manifest: dict, params: dict | None = None) -> dict:
    score = 0.0
    current_iteration = 0
    for artifact in manifest.get("artifacts", []):
        iteration = artifact.get("iteration")
        if isinstance(iteration, int):
            current_iteration = max(current_iteration, iteration)
        if artifact.get("kind") == "score.json" and artifact.get("score") is not None:
            score = max(score, float(artifact["score"]))
    return {
        "session_id": manifest["session_id"],
        "archive_prefix": manifest.get("archive_prefix", archive_prefix(manifest["session_id"])),
        "started_at": manifest.get("started_at") or manifest.get("created_at"),
        "updated_at": manifest.get("updated_at"),
        "status": manifest.get("status", "archived"),
        "step": manifest.get("step", "archived"),
        "current_iteration": current_iteration,
        "best_score": round(score, 4),
        "params": params if params is not None else manifest.get("params", {}),
        "has_started": True,
        "is_archived": True,
    }


def init_session(session_id: str, session_path: Path, params: dict | None = None, status: str = "draft") -> dict:
    """Create local and storage manifests for a session."""
    with _archive_lock:
        session_path.mkdir(parents=True, exist_ok=True)
        manifest = _read_local_manifest(session_path, session_id)
        manifest["status"] = status
        manifest.setdefault("created_at", now_iso())
        if params is not None:
            manifest["params"] = params
        if status == "running":
            manifest["started_at"] = manifest.get("started_at") or now_iso()
        _write_local_manifest(session_path, manifest)
        _upload_manifest(session_id, session_path, manifest)
        return manifest


def update_session_state(
    session_id: str,
    session_path: Path,
    *,
    status: str | None = None,
    step: str | None = None,
    params: dict | None = None,
    finished_at: str | None = None,
    error: str | None = None,
) -> dict:
    with _archive_lock:
        manifest = _read_local_manifest(session_path, session_id)
        if status:
            manifest["status"] = status
        if step:
            manifest["step"] = step
        if params is not None:
            manifest["params"] = params
        if finished_at:
            manifest["finished_at"] = finished_at
        if error:
            manifest["error"] = error
        _write_local_manifest(session_path, manifest)
        _upload_manifest(session_id, session_path, manifest)
        return manifest


def _upload_manifest(session_id: str, session_path: Path, manifest: dict) -> None:
    manifest_key = archive_key(session_id, "manifest.json")
    try:
        storage.upload_bytes(
            json.dumps(manifest, indent=2, sort_keys=True).encode("utf-8"),
            manifest_key,
            "application/json",
        )
        _upsert_index_entry(_session_summary(manifest))
    except Exception as exc:
        logger.warning("Failed to upload agent archive manifest for %s: %s", session_id, exc)


def append_event(
    session_id: str,
    session_path: Path,
    event: str,
    message: str,
    *,
    level: str = "info",
    source: str = "backend",
    iteration: int | None = None,
    path: str | None = None,
    data: dict | None = None,
) -> dict:
    record = {
        "id": uuid.uuid4().hex,
        "ts": now_iso(),
        "session_id": session_id,
        "event": event,
        "level": level,
        "source": source,
        "message": message,
    }
    if iteration is not None:
        record["iteration"] = iteration
    if path:
        record["path"] = _safe_rel_path(path)
    if data:
        record["data"] = data

    with _archive_lock:
        session_path.mkdir(parents=True, exist_ok=True)
        with events_path(session_path).open("a", encoding="utf-8") as f:
            f.write(json.dumps(record, sort_keys=True) + "\n")
        sync_file(session_id, session_path, EVENTS_FILENAME, kind="events")
    return record


def append_journal(session_id: str, session_path: Path, text: str) -> None:
    with _archive_lock:
        with journal_path(session_path).open("a", encoding="utf-8") as f:
            f.write(text.rstrip() + "\n\n")
        sync_file(session_id, session_path, JOURNAL_FILENAME, kind="journal")


def read_events(session_id: str, session_path: Path | None = None) -> list[dict]:
    if session_path:
        path = events_path(session_path)
        if path.exists():
            return _parse_events(path.read_text(encoding="utf-8", errors="replace"))
    try:
        raw = storage.download_bytes(archive_key(session_id, EVENTS_FILENAME)).decode("utf-8", errors="replace")
    except Exception:
        return []
    return _parse_events(raw)


def _parse_events(raw: str) -> list[dict]:
    events: list[dict] = []
    for line in raw.splitlines():
        if not line.strip():
            continue
        try:
            events.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return events


def tail_events(session_id: str, session_path: Path, offset: int = 0) -> tuple[list[dict], int]:
    path = events_path(session_path)
    if not path.exists():
        return [], offset
    with path.open("r", encoding="utf-8", errors="replace") as f:
        f.seek(offset)
        chunk = f.read()
        new_offset = f.tell()
    return _parse_events(chunk), new_offset


def sync_file(
    session_id: str,
    session_path: Path,
    rel_path: str,
    *,
    kind: str | None = None,
    iteration: int | None = None,
    event: bool = False,
) -> dict | None:
    """Upload one local session file to storage if it changed."""
    rel_path = _safe_rel_path(rel_path)
    local_path = (session_path / rel_path).resolve()
    try:
        local_path.relative_to(session_path.resolve())
    except ValueError:
        raise ValueError(f"Invalid session file path: {rel_path}")
    if not local_path.exists() or not local_path.is_file():
        return None

    stat = local_path.stat()
    with _archive_lock:
        manifest = _read_local_manifest(session_path, session_id)
        artifacts_by_path = _artifact_index(manifest)
        existing = artifacts_by_path.get(rel_path)
        mtime_ns = stat.st_mtime_ns
        size = stat.st_size
        if existing and existing.get("mtime_ns") == mtime_ns and existing.get("size") == size:
            return existing

        key = archive_key(session_id, rel_path)
        try:
            storage.upload_file_from_path(local_path, key, _content_type(rel_path))
        except Exception as exc:
            logger.warning("Failed to upload %s for %s: %s", rel_path, session_id, exc)
            return None

        record = {
            "path": rel_path,
            "kind": kind or _kind_for_path(rel_path),
            "archive_key": key,
            "content_type": _content_type(rel_path),
            "size": size,
            "mtime": stat.st_mtime,
            "mtime_ns": mtime_ns,
            "uploaded_at": now_iso(),
        }
        iter_num = iteration if iteration is not None else _iteration_for_path(rel_path)
        if iter_num is not None:
            record["iteration"] = iter_num
        if record["kind"] == "score.json":
            score = _read_score(local_path)
            if score is not None:
                record["score"] = score

        artifacts_by_path[rel_path] = record
        manifest["artifacts"] = sorted(artifacts_by_path.values(), key=lambda item: item["path"])
        _write_local_manifest(session_path, manifest)
        _upload_manifest(session_id, session_path, manifest)

    if event and record["kind"] not in {"events"}:
        append_event(
            session_id,
            session_path,
            "artifact.ready",
            f"{record['kind']} saved",
            source="artifact",
            iteration=record.get("iteration"),
            path=rel_path,
            data={"archive_key": key, "size": size},
        )
    return record


def sync_files(session_id: str, session_path: Path, files: list[dict], *, emit_events: bool = True) -> list[dict]:
    synced = []
    for item in files:
        record = sync_file(
            session_id,
            session_path,
            item["path"],
            kind=item.get("kind"),
            iteration=item.get("iteration"),
            event=emit_events,
        )
        if record:
            synced.append(record)
    return synced


def sync_transcript_from_payload(session_id: str, session_path: Path, payload: dict) -> None:
    transcript = payload.get("transcript_path")
    if not transcript:
        return
    path = Path(transcript)
    if not path.exists() or not path.is_file():
        return
    dest = session_path / "claude_transcript.jsonl"
    try:
        dest.write_bytes(path.read_bytes())
        sync_file(session_id, session_path, "claude_transcript.jsonl", kind="claude_transcript")
    except Exception as exc:
        logger.warning("Failed to archive Claude transcript for %s: %s", session_id, exc)


def list_archived_sessions() -> list[dict]:
    index = _read_storage_json(ARCHIVE_INDEX_KEY, [])
    if not isinstance(index, list):
        return []
    return sorted(index, key=lambda item: item.get("updated_at") or "", reverse=True)


def get_archived_session(session_id: str) -> dict | None:
    try:
        manifest = _read_storage_json(archive_key(session_id, "manifest.json"), None)
    except ValueError:
        return None
    if not isinstance(manifest, dict):
        return None
    summary = _session_summary(manifest)
    summary["archive_manifest"] = manifest
    summary["artifact_counts"] = artifact_counts(manifest.get("artifacts", []))
    return summary


def list_archived_artifacts(session_id: str) -> list[dict]:
    session = get_archived_session(session_id)
    if not session:
        return []
    artifacts = session.get("archive_manifest", {}).get("artifacts", [])
    out = []
    for item in artifacts:
        if item.get("iteration") is None:
            continue
        if item.get("kind") in {"keyframe", "segment", "keyframes.json", "segments.json", "final.mp4", "score.json"}:
            out.append({
                "iteration": item["iteration"],
                "kind": item["kind"],
                "path": item["path"],
                "mtime": item.get("mtime", 0),
                "archive_key": item.get("archive_key"),
            })
    return sorted(out, key=lambda item: (item["iteration"], item["path"]))


def artifact_download_url(session_id: str, rel_path: str) -> str | None:
    rel_path = _safe_rel_path(rel_path)
    key = archive_key(session_id, rel_path)
    try:
        return storage.presigned_download_url(key)
    except Exception as exc:
        logger.warning("Failed to create artifact URL for %s/%s: %s", session_id, rel_path, exc)
        return None


def artifact_counts(artifacts: list[dict]) -> dict:
    counts = {
        "keyframes": 0,
        "segments": 0,
        "final_videos": 0,
        "scores": 0,
        "logs": 0,
        "references": 0,
    }
    for item in artifacts:
        kind = item.get("kind")
        if kind == "keyframe":
            counts["keyframes"] += 1
        elif kind == "segment":
            counts["segments"] += 1
        elif kind == "final.mp4":
            counts["final_videos"] += 1
        elif kind == "score.json":
            counts["scores"] += 1
        elif kind in {"log", "claude_stream", "claude_transcript", "events", "journal"}:
            counts["logs"] += 1
        elif kind == "reference":
            counts["references"] += 1
    return counts


def _kind_for_path(rel_path: str) -> str:
    name = rel_path.rsplit("/", 1)[-1]
    if rel_path.startswith("references/"):
        return "reference"
    if "/keyframes/frame_" in rel_path and rel_path.endswith(".jpg"):
        return "keyframe"
    if "/segments/seg_" in rel_path and rel_path.endswith(".mp4"):
        return "segment"
    if name in {"keyframes.json", "segments.json", "score.json", "final.mp4"}:
        return name
    if name == "claude_stream.jsonl":
        return "claude_stream"
    if name == "claude_output.log":
        return "log"
    if name == EVENTS_FILENAME:
        return "events"
    if name == JOURNAL_FILENAME:
        return "journal"
    return "file"


def _iteration_for_path(rel_path: str) -> int | None:
    parts = rel_path.split("/")
    if len(parts) >= 2 and parts[0] == "iterations" and parts[1].isdigit():
        return int(parts[1])
    return None


def _read_score(path: Path) -> float | None:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if "overall_score" in data:
            return float(data["overall_score"])
    except Exception:
        return None
    return None
