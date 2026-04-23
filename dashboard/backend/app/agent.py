"""Agent session management — spawn, track, and stop Claude Code agent loops."""

import os
import subprocess
import uuid
from datetime import datetime, timezone
from pathlib import Path

SESSIONS_DIR = Path(__file__).resolve().parents[3] / "agent" / "sessions"

_sessions: dict[str, dict] = {}


def _build_initial_message(session_id: str, params: dict) -> str:
    return (
        f"SESSION_ID: {session_id}\n"
        f"TARGET_DESCRIPTION: {params['target_description']}\n"
        f"DURATION: {params['duration']}\n"
        f"IMAGE_MODEL: {params.get('image_model', os.environ.get('IMAGE_MODEL', 'openai'))}\n"
        f"VIDEO_MODEL: {params.get('video_model', os.environ.get('VIDEO_MODEL', 'veo'))}\n"
        f"MAX_ITERATIONS: {params.get('max_iterations', 20)}\n"
        f"TARGET_SCORE: {params.get('target_score', 0.85)}\n\n"
        f"Read agent/system_prompt.md in full, then begin the session immediately."
    )


def start_session(params: dict) -> str:
    ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    session_id = f"session_{ts}_{uuid.uuid4().hex[:4]}"

    session_dir = SESSIONS_DIR / session_id
    session_dir.mkdir(parents=True, exist_ok=True)

    log_path = session_dir / "claude_output.log"
    log_file = open(log_path, "w")

    repo_root = Path(__file__).resolve().parents[3]
    message = _build_initial_message(session_id, params)

    proc = subprocess.Popen(
        ["claude", "-p", message],
        cwd=str(repo_root),
        env={**os.environ},
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

    return {
        "session_id": session_id,
        "params": mem.get("params", {}),
        "started_at": mem.get("started_at"),
        "is_running": is_running,
        "step": step,
        "current_iteration": current_iteration,
        "best_score": round(best_score, 4),
        "iterations": iterations,
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
                if s:
                    result.append(s)

    return result
