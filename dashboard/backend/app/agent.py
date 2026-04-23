"""Agent session management — spawn, track, and stop Claude Code agent loops."""

import os
import subprocess
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

SESSIONS_DIR = Path(__file__).resolve().parents[3] / "agent" / "sessions"

_sessions: dict[str, dict] = {}


def _build_initial_message(session_id: str, params: dict, references: list[str]) -> str:
    brief = params.get("creative_brief", "").strip()
    ref_block = ""
    if references:
        rels = "\n".join(f"  - {r}" for r in references)
        ref_block = f"REFERENCE_IMAGES:\n{rels}\n"
    return (
        f"SESSION_ID: {session_id}\n"
        f"TARGET_DESCRIPTION: {params['target_description']}\n"
        f"CREATIVE_BRIEF: {brief or '(none — agent has full creative control)'}\n"
        f"DURATION: {params['duration']}\n"
        f"IMAGE_MODEL: {params.get('image_model', os.environ.get('IMAGE_MODEL', 'openai'))}\n"
        f"VIDEO_MODEL: {params.get('video_model', os.environ.get('VIDEO_MODEL', 'veo'))}\n"
        f"MAX_ITERATIONS: {params.get('max_iterations', 20)}\n"
        f"TARGET_SCORE: {params.get('target_score', 0.85)}\n"
        f"{ref_block}\n"
        f"Begin the session now."
    )


def _new_session_id() -> str:
    ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    return f"session_{ts}_{uuid.uuid4().hex[:4]}"


def create_draft_session() -> str:
    """Create an empty session directory (references/) so the UI can upload files before start."""
    session_id = _new_session_id()
    session_dir = SESSIONS_DIR / session_id
    (session_dir / "references").mkdir(parents=True, exist_ok=True)
    return session_id


def list_references(session_id: str) -> list[str]:
    ref_dir = SESSIONS_DIR / session_id / "references"
    if not ref_dir.exists():
        return []
    return sorted(p.name for p in ref_dir.iterdir() if p.is_file())


def start_session(params: dict, session_id: str | None = None) -> str:
    if session_id is None:
        session_id = _new_session_id()

    session_dir = SESSIONS_DIR / session_id
    session_dir.mkdir(parents=True, exist_ok=True)
    (session_dir / "references").mkdir(parents=True, exist_ok=True)

    references = list_references(session_id)

    log_path = session_dir / "claude_output.log"
    log_file = open(log_path, "w")

    repo_root = Path(__file__).resolve().parents[3]
    message = _build_initial_message(session_id, params, references)

    proc = subprocess.Popen(
        ["claude", "-p", message],
        cwd=str(repo_root),
        stdout=log_file,
        stderr=subprocess.STDOUT,
    )

    _sessions[session_id] = {
        "session_id": session_id,
        "params": params,
        "pid": proc.pid,
        "process": proc,
        "log_file": log_file,
        "started_at": datetime.now(timezone.utc).isoformat(),
    }

    return session_id


def _infer_step(session_dir: Path) -> tuple[str, int]:
    """Return (current_step_label, current_iteration_number) from file presence."""
    iterations_dir = session_dir / "iterations"
    if not iterations_dir.exists():
        return "starting", 0

    iter_dirs = sorted(
        [d for d in iterations_dir.iterdir() if d.is_dir() and d.name.isdigit()],
        key=lambda d: int(d.name),
    )
    if not iter_dirs:
        return "starting", 0

    n = int(iter_dirs[-1].name)
    cur = iter_dirs[-1]

    if (cur / "score.json").exists():
        step = "iteration_complete"
    elif (cur / "final.mp4").exists():
        step = "scoring"
    elif (cur / "segments").exists() and any((cur / "segments").glob("*.mp4")):
        step = "stitching"
    elif (cur / "keyframes").exists() and any((cur / "keyframes").glob("*.jpg")):
        step = "generating_video"
    elif (cur / "keyframes.json").exists():
        step = "generating_keyframes"
    else:
        step = "planning"

    return step, n


def _read_iteration_log(session_dir: Path) -> list[dict]:
    log_path = session_dir / "iteration_log.tsv"
    if not log_path.exists():
        return []
    rows = []
    for line in log_path.read_text().strip().splitlines()[1:]:  # skip header
        parts = line.split("\t")
        if len(parts) >= 4:
            try:
                rows.append({
                    "iteration": int(parts[0]),
                    "score": float(parts[1]),
                    "status": parts[2],
                    "notes": parts[3],
                })
            except (ValueError, IndexError):
                continue
    return rows


def get_session(session_id: str) -> dict | None:
    session_dir = SESSIONS_DIR / session_id
    if not session_dir.exists():
        return None

    mem = _sessions.get(session_id, {})
    proc = mem.get("process")

    is_running = proc is not None and proc.poll() is None

    step, current_iteration = _infer_step(session_dir)
    iterations = _read_iteration_log(session_dir)
    best_score = max((it["score"] for it in iterations), default=0.0)
    references = list_references(session_id)

    return {
        "session_id": session_id,
        "params": mem.get("params", {}),
        "started_at": mem.get("started_at"),
        "is_running": is_running,
        "step": step,
        "current_iteration": current_iteration,
        "best_score": round(best_score, 4),
        "iterations": iterations,
        "references": references,
        "has_started": (session_dir / "claude_output.log").exists(),
    }


def stop_session(session_id: str) -> bool:
    mem = _sessions.get(session_id)
    if not mem:
        return False
    proc = mem.get("process")
    if proc and proc.poll() is None:
        proc.terminate()
        return True
    return False


def tail_log(session_id: str, offset: int = 0):
    """Yield new log bytes starting from `offset`. Returns (new_content, new_offset)."""
    session_dir = SESSIONS_DIR / session_id
    log_path = session_dir / "claude_output.log"
    if not log_path.exists():
        return "", offset
    with open(log_path, "r", errors="replace") as f:
        f.seek(offset)
        chunk = f.read()
        new_offset = f.tell()
    return chunk, new_offset


# ----------------------------------------------------------------------
# Artifact scanning — feeds the live artifact SSE stream
# ----------------------------------------------------------------------

_ARTIFACT_TYPES = (
    "keyframes.json",
    "segments.json",
    "final.mp4",
    "score.json",
)


def scan_artifacts(session_id: str) -> list[dict]:
    """Return every artifact currently on disk for this session.

    Each entry has: {iteration, kind, path, mtime}. The frontend diffs
    against its local set to detect new arrivals.
    """
    session_dir = SESSIONS_DIR / session_id
    iterations_dir = session_dir / "iterations"
    out: list[dict] = []
    if not iterations_dir.exists():
        return out

    for d in sorted(iterations_dir.iterdir()):
        if not d.is_dir() or not d.name.isdigit():
            continue
        n = int(d.name)

        # Single-file artifacts
        for kind in _ARTIFACT_TYPES:
            p = d / kind
            if p.exists():
                out.append({
                    "iteration": n,
                    "kind": kind,
                    "path": f"iterations/{n}/{kind}",
                    "mtime": p.stat().st_mtime,
                })

        # Keyframe images
        kf_dir = d / "keyframes"
        if kf_dir.exists():
            for p in sorted(kf_dir.glob("frame_*.jpg")):
                out.append({
                    "iteration": n,
                    "kind": "keyframe",
                    "path": f"iterations/{n}/keyframes/{p.name}",
                    "mtime": p.stat().st_mtime,
                })

        # Video segments
        seg_dir = d / "segments"
        if seg_dir.exists():
            for p in sorted(seg_dir.glob("seg_*.mp4")):
                out.append({
                    "iteration": n,
                    "kind": "segment",
                    "path": f"iterations/{n}/segments/{p.name}",
                    "mtime": p.stat().st_mtime,
                })

    return out


def append_user_note(session_id: str, note: str) -> None:
    """Append a timestamped note to sessions/{id}/user_notes.md.

    The agent is instructed to re-read this file at the start of every
    iteration's planning step so the user can steer the loop without
    restructuring it.
    """
    session_dir = SESSIONS_DIR / session_id
    session_dir.mkdir(parents=True, exist_ok=True)
    path = session_dir / "user_notes.md"
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
    with open(path, "a", encoding="utf-8") as f:
        f.write(f"## {ts}\n{note.strip()}\n\n")


def list_sessions() -> list[dict]:
    seen = set()
    result = []

    # In-memory first (most recent)
    for sid in reversed(list(_sessions.keys())):
        s = get_session(sid)
        if s:
            result.append(s)
            seen.add(sid)

    # Then any on-disk sessions from previous server runs
    if SESSIONS_DIR.exists():
        for d in sorted(SESSIONS_DIR.iterdir(), reverse=True):
            if d.is_dir() and d.name not in seen:
                s = get_session(d.name)
                if s and s.get("has_started"):
                    result.append(s)

    return result
