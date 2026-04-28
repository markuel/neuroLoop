"""Agent session management: spawn, track, archive, and stop Claude Code loops."""

from __future__ import annotations

import json
import logging
import os
import re
import subprocess
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from . import agent_archive

logger = logging.getLogger(__name__)

SESSIONS_DIR = Path(__file__).resolve().parents[3] / "agent" / "sessions"
SESSION_ID_PATTERN = re.compile(r"^session_\d{8}_\d{6}_[0-9a-f]{4}$")

_sessions: dict[str, dict] = {}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _build_initial_message(session_id: str, params: dict, references: list[str]) -> str:
    brief = params.get("creative_brief", "").strip()
    ref_block = ""
    if references:
        rels = "\n".join(f"  - agent/sessions/{session_id}/references/{r}" for r in references)
        ref_block = f"REFERENCE_IMAGES:\n{rels}\n"
    return (
        f"SESSION_ID: {session_id}\n"
        f"TARGET_DESCRIPTION: {params['target_description']}\n"
        f"CREATIVE_BRIEF: {brief or '(none - agent has full creative control)'}\n"
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


def session_dir(session_id: str) -> Path:
    if not SESSION_ID_PATTERN.fullmatch(session_id):
        raise ValueError(f"Invalid session_id: {session_id}")
    return SESSIONS_DIR / session_id


def _session_meta_path(session_path: Path) -> Path:
    return session_path / "session.json"


def _write_session_meta(session_path: Path, data: dict) -> None:
    session_path.mkdir(parents=True, exist_ok=True)
    _session_meta_path(session_path).write_text(
        json.dumps(data, indent=2, sort_keys=True),
        encoding="utf-8",
    )


def _read_session_meta(session_path: Path) -> dict:
    path = _session_meta_path(session_path)
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}


def _hook_handler() -> dict:
    return {
        "type": "http",
        "url": os.environ.get("NEUROLOOP_CLAUDE_HOOK_URL", "http://127.0.0.1:8000/api/agent/hooks/claude"),
        "timeout": 5,
        "headers": {"X-NeuroLoop-Session": "$NEUROLOOP_SESSION_ID"},
        "allowedEnvVars": ["NEUROLOOP_SESSION_ID"],
    }


def _write_claude_settings(session_path: Path) -> Path:
    hook = _hook_handler()

    def matched(matcher: str = "*") -> list[dict]:
        return [{"matcher": matcher, "hooks": [hook]}]

    def unmatched() -> list[dict]:
        return [{"hooks": [hook]}]

    settings = {
        "hooks": {
            "PreToolUse": matched("*"),
            "PostToolUse": matched("*"),
            "PostToolUseFailure": matched("*"),
            "PostToolBatch": unmatched(),
            "PermissionDenied": matched("*"),
            "Notification": matched("*"),
            "SubagentStart": matched("*"),
            "SubagentStop": matched("*"),
            "TaskCreated": unmatched(),
            "TaskCompleted": unmatched(),
            "Stop": unmatched(),
            "StopFailure": matched("*"),
            "SessionEnd": matched("*"),
        }
    }
    path = session_path / "claude_settings.json"
    path.write_text(json.dumps(settings, indent=2), encoding="utf-8")
    return path


def _claude_command(message: str, settings_path: Path) -> list[str]:
    return [
        "claude",
        "-p",
        message,
        "--output-format",
        "stream-json",
        "--verbose",
        "--include-hook-events",
        "--settings",
        str(settings_path),
    ]


def create_draft_session() -> str:
    """Create an empty session directory so the UI can upload references before start."""
    session_id = _new_session_id()
    session_path = session_dir(session_id)
    (session_path / "references").mkdir(parents=True, exist_ok=True)
    _write_session_meta(session_path, {
        "session_id": session_id,
        "status": "draft",
        "created_at": _now_iso(),
    })
    agent_archive.init_session(session_id, session_path, status="draft")
    agent_archive.append_event(
        session_id,
        session_path,
        "session.created",
        "Draft session created",
        source="backend",
    )
    return session_id


def list_references(session_id: str) -> list[str]:
    ref_dir = session_dir(session_id) / "references"
    if not ref_dir.exists():
        return []
    return sorted(p.name for p in ref_dir.iterdir() if p.is_file())


def start_session(params: dict, session_id: str | None = None) -> str:
    if session_id is None:
        session_id = _new_session_id()

    session_path = session_dir(session_id)
    session_path.mkdir(parents=True, exist_ok=True)
    (session_path / "references").mkdir(parents=True, exist_ok=True)

    references = list_references(session_id)
    repo_root = Path(__file__).resolve().parents[3]
    message = _build_initial_message(session_id, params, references)
    settings_path = _write_claude_settings(session_path)
    started_at = _now_iso()

    _write_session_meta(session_path, {
        "session_id": session_id,
        "status": "running",
        "params": params,
        "started_at": started_at,
        "created_at": _read_session_meta(session_path).get("created_at", started_at),
    })
    agent_archive.init_session(session_id, session_path, params=params, status="running")
    agent_archive.append_journal(
        session_id,
        session_path,
        f"# neuroLoop session {session_id}\n\nStarted: {started_at}\n\nTarget: {params['target_description']}",
    )
    agent_archive.append_event(
        session_id,
        session_path,
        "session.started",
        "Claude Code session started",
        source="backend",
        data={"image_model": params.get("image_model"), "video_model": params.get("video_model")},
    )

    env = os.environ.copy()
    env["NEUROLOOP_SESSION_ID"] = session_id

    try:
        proc = subprocess.Popen(
            _claude_command(message, settings_path),
            cwd=str(repo_root),
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
            bufsize=1,
            env=env,
        )
    except OSError:
        agent_archive.append_event(
            session_id,
            session_path,
            "session.failed",
            "Claude Code runtime is unavailable",
            level="error",
            source="backend",
        )
        agent_archive.update_session_state(session_id, session_path, status="failed", error="Claude Code runtime unavailable")
        raise

    _sessions[session_id] = {
        "session_id": session_id,
        "params": params,
        "pid": proc.pid,
        "process": proc,
        "started_at": started_at,
        "returncode": None,
    }

    threading.Thread(
        target=_read_claude_stream,
        args=(session_id, session_path, proc),
        daemon=True,
    ).start()
    threading.Thread(
        target=_archive_monitor,
        args=(session_id, session_path, proc, params),
        daemon=True,
    ).start()

    return session_id


def _read_claude_stream(session_id: str, session_path: Path, proc: subprocess.Popen) -> None:
    raw_path = session_path / "claude_stream.jsonl"
    log_path = session_path / "claude_output.log"
    raw_path.parent.mkdir(parents=True, exist_ok=True)

    with raw_path.open("w", encoding="utf-8") as raw, log_path.open("w", encoding="utf-8") as log:
        if proc.stdout is not None:
            for line in proc.stdout:
                raw.write(line)
                raw.flush()
                for event in _events_from_claude_line(line):
                    log.write(event["message"] + "\n")
                    log.flush()
                    agent_archive.append_event(
                        session_id,
                        session_path,
                        event["event"],
                        event["message"],
                        level=event.get("level", "info"),
                        source="claude",
                        data=event.get("data"),
                    )
                if not line.strip().startswith("{"):
                    log.write(line)
                    log.flush()
        returncode = proc.wait()

    mem = _sessions.get(session_id)
    if mem is not None:
        mem["returncode"] = returncode

    level = "info" if returncode == 0 else "error"
    agent_archive.append_event(
        session_id,
        session_path,
        "claude.exited",
        f"Claude Code exited with status {returncode}",
        level=level,
        source="backend",
        data={"returncode": returncode},
    )
    agent_archive.sync_file(session_id, session_path, "claude_stream.jsonl", kind="claude_stream")
    agent_archive.sync_file(session_id, session_path, "claude_output.log", kind="log")


def _events_from_claude_line(line: str) -> list[dict]:
    try:
        payload = json.loads(line)
    except json.JSONDecodeError:
        text = line.strip()
        return [{"event": "claude.output", "message": text[:1000], "data": {"raw": text[:2000]}}] if text else []
    return _events_from_claude_payload(payload)


def _events_from_claude_payload(payload: dict) -> list[dict]:
    events: list[dict] = []
    hook_name = payload.get("hook_event_name")
    if hook_name:
        events.append(_hook_payload_to_event(payload))
        return events

    ptype = payload.get("type")
    if ptype == "system":
        subtype = payload.get("subtype", "event")
        if subtype == "api_retry":
            events.append({
                "event": "claude.api_retry",
                "level": "warning",
                "message": f"Claude API retry {payload.get('attempt')}/{payload.get('max_retries')}",
                "data": _compact(payload),
            })
        elif subtype in {"init", "plugin_install"}:
            events.append({
                "event": f"claude.system.{subtype}",
                "message": f"Claude system event: {subtype}",
                "data": _compact(payload),
            })
        return events

    if ptype == "assistant":
        message = payload.get("message", {})
        for block in message.get("content", []) if isinstance(message, dict) else []:
            if block.get("type") == "tool_use":
                name = block.get("name", "tool")
                events.append({
                    "event": "claude.tool.requested",
                    "message": f"Claude requested tool: {name}",
                    "data": _compact({"tool": name, "input": block.get("input")}),
                })
            elif block.get("type") == "text":
                text = " ".join(block.get("text", "").split())
                if text:
                    events.append({
                        "event": "claude.message",
                        "message": text[:500],
                        "data": {"text": text[:2000]},
                    })
        return events

    if ptype == "stream_event":
        event = payload.get("event", {})
        if event.get("type") == "content_block_start":
            block = event.get("content_block", {})
            if block.get("type") == "tool_use":
                events.append({
                    "event": "claude.tool.started",
                    "message": f"Claude started tool: {block.get('name', 'tool')}",
                    "data": _compact(block),
                })
        return events

    if ptype == "result":
        subtype = payload.get("subtype", "result")
        stop_reason = payload.get("stop_reason")
        level = "error" if payload.get("is_error") else "info"
        events.append({
            "event": f"claude.result.{subtype}",
            "level": level,
            "message": f"Claude result: {subtype}" + (f" ({stop_reason})" if stop_reason else ""),
            "data": _compact(payload),
        })
        return events

    return []


def _hook_payload_to_event(payload: dict) -> dict:
    hook = payload.get("hook_event_name", "Hook")
    tool = payload.get("tool_name")
    event_name = f"claude.hook.{_snake(hook)}"
    if tool:
        message = f"{hook}: {tool}"
    elif payload.get("file_path"):
        message = f"{hook}: {payload.get('file_path')}"
    else:
        message = hook
    level = "error" if hook in {"PostToolUseFailure", "StopFailure", "PermissionDenied"} else "info"
    return {
        "event": event_name,
        "message": message,
        "level": level,
        "data": _compact(payload),
    }


def _snake(value: str) -> str:
    return re.sub(r"(?<!^)(?=[A-Z])", "_", value).lower()


def _compact(value: Any, *, max_str: int = 1000, max_items: int = 30) -> Any:
    if isinstance(value, str):
        return value if len(value) <= max_str else value[:max_str] + "...[truncated]"
    if isinstance(value, list):
        return [_compact(v, max_str=max_str, max_items=max_items) for v in value[:max_items]]
    if isinstance(value, dict):
        out = {}
        for i, (key, item) in enumerate(value.items()):
            if i >= max_items:
                out["truncated_keys"] = len(value) - max_items
                break
            out[key] = _compact(item, max_str=max_str, max_items=max_items)
        return out
    return value


def _archive_monitor(session_id: str, session_path: Path, proc: subprocess.Popen, params: dict) -> None:
    while proc.poll() is None:
        _sync_session_archive(session_id, session_path)
        time.sleep(1.0)

    returncode = proc.wait()
    _sync_session_archive(session_id, session_path)
    step, _current_iteration = _infer_step(session_path)
    status = _final_status(session_path, returncode)
    meta = _read_session_meta(session_path)
    meta.update({
        "status": status,
        "step": step,
        "finished_at": _now_iso(),
        "returncode": returncode,
    })
    _write_session_meta(session_path, meta)
    agent_archive.update_session_state(
        session_id,
        session_path,
        status=status,
        step=step,
        params=params,
        finished_at=meta["finished_at"],
        error=meta.get("error"),
    )
    _sync_session_archive(session_id, session_path)


def _final_status(session_path: Path, returncode: int | None) -> str:
    step, _ = _infer_step(session_path)
    if step == "iteration_complete":
        return "complete"
    if returncode == 0:
        return "partial"
    if returncode in {-15, -9, 143}:
        return "stopped"
    return "failed"


def _sync_session_archive(session_id: str, session_path: Path) -> None:
    agent_archive.sync_files(session_id, session_path, scan_session_files(session_id), emit_events=True)


def _infer_step(session_path: Path) -> tuple[str, int]:
    """Return (current_step_label, current_iteration_number) from file presence."""
    iterations_dir = session_path / "iterations"
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


def _read_iteration_log(session_path: Path) -> list[dict]:
    log_path = session_path / "iteration_log.tsv"
    if not log_path.exists():
        return []
    rows = []
    for line in log_path.read_text(encoding="utf-8", errors="replace").strip().splitlines()[1:]:
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


def _artifact_counts_from_scan(artifacts: list[dict]) -> dict:
    return agent_archive.artifact_counts(artifacts)


def get_session(session_id: str) -> dict | None:
    try:
        session_path = session_dir(session_id)
    except ValueError:
        return None
    if not session_path.exists():
        return agent_archive.get_archived_session(session_id)

    mem = _sessions.get(session_id, {})
    proc = mem.get("process")

    is_running = proc is not None and proc.poll() is None
    returncode = None if proc is None else proc.poll()
    if returncode is None:
        returncode = mem.get("returncode")

    step, current_iteration = _infer_step(session_path)
    iterations = _read_iteration_log(session_path)
    best_score = max((it["score"] for it in iterations), default=0.0)
    references = list_references(session_id)
    meta = _read_session_meta(session_path)
    params = mem.get("params") or meta.get("params", {})
    artifacts = scan_artifacts(session_id)
    log_artifacts = [
        {"kind": kind}
        for name, kind in (
            ("claude_output.log", "log"),
            ("claude_stream.jsonl", "claude_stream"),
            ("claude_transcript.jsonl", "claude_transcript"),
            ("events.jsonl", "events"),
            ("journal.md", "journal"),
        )
        if (session_path / name).exists()
    ]
    status = "running" if is_running else meta.get("status") or _final_status(session_path, returncode)

    return {
        "session_id": session_id,
        "params": params,
        "started_at": mem.get("started_at") or meta.get("started_at"),
        "finished_at": meta.get("finished_at"),
        "is_running": is_running,
        "status": status,
        "status_detail": _status_detail(status, step, returncode),
        "step": step,
        "current_iteration": current_iteration,
        "best_score": round(best_score, 4),
        "iterations": iterations,
        "references": references,
        "has_started": (session_path / "claude_output.log").exists() or status == "running",
        "returncode": returncode,
        "artifact_counts": _artifact_counts_from_scan(artifacts + log_artifacts),
        "archive_prefix": agent_archive.archive_prefix(session_id),
    }


def _status_detail(status: str, step: str, returncode: int | None) -> str:
    if status == "running":
        return f"Running: {step}"
    if status == "complete":
        return "Completed with a scored iteration"
    if status == "stopped":
        return "Stopped before the current iteration finished"
    if status == "failed":
        return f"Claude Code exited with status {returncode}"
    if status == "partial":
        return "Exited before producing a scored iteration"
    return status


def stop_session(session_id: str) -> bool:
    mem = _sessions.get(session_id)
    if not mem:
        return False
    proc = mem.get("process")
    if proc and proc.poll() is None:
        proc.terminate()
        try:
            session_path = session_dir(session_id)
            agent_archive.append_event(
                session_id,
                session_path,
                "session.stop_requested",
                "Stop requested by user",
                source="backend",
            )
        except ValueError:
            pass
        return True
    return False


def tail_log(session_id: str, offset: int = 0):
    """Yield new human-readable log text starting from offset."""
    try:
        log_path = session_dir(session_id) / "claude_output.log"
    except ValueError:
        return "", offset
    if not log_path.exists():
        return "", offset
    with open(log_path, "r", encoding="utf-8", errors="replace") as f:
        f.seek(offset)
        chunk = f.read()
        new_offset = f.tell()
    return chunk, new_offset


def tail_events(session_id: str, offset: int = 0):
    try:
        session_path = session_dir(session_id)
    except ValueError:
        return [], offset
    return agent_archive.tail_events(session_id, session_path, offset)


# ----------------------------------------------------------------------
# Artifact scanning
# ----------------------------------------------------------------------

_ARTIFACT_TYPES = (
    "keyframes.json",
    "segments.json",
    "final.mp4",
    "score.json",
)

_ROOT_ARCHIVE_FILES = (
    "target_state.json",
    "iteration_log.tsv",
    "user_notes.md",
    "session.json",
    "claude_settings.json",
    "claude_output.log",
    "claude_stream.jsonl",
    "claude_transcript.jsonl",
    "events.jsonl",
    "journal.md",
)


def scan_artifacts(session_id: str) -> list[dict]:
    """Return UI-visible artifacts for this session."""
    try:
        iterations_dir = session_dir(session_id) / "iterations"
    except ValueError:
        return []
    out: list[dict] = []
    if not iterations_dir.exists():
        return agent_archive.list_archived_artifacts(session_id)

    for d in sorted(iterations_dir.iterdir()):
        if not d.is_dir() or not d.name.isdigit():
            continue
        n = int(d.name)

        for kind in _ARTIFACT_TYPES:
            p = d / kind
            if p.exists():
                out.append({
                    "iteration": n,
                    "kind": kind,
                    "path": f"iterations/{n}/{kind}",
                    "mtime": p.stat().st_mtime,
                })

        kf_dir = d / "keyframes"
        if kf_dir.exists():
            for p in sorted(kf_dir.glob("frame_*.jpg")):
                out.append({
                    "iteration": n,
                    "kind": "keyframe",
                    "path": f"iterations/{n}/keyframes/{p.name}",
                    "mtime": p.stat().st_mtime,
                })

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


def scan_session_files(session_id: str) -> list[dict]:
    """Return every file that should be archived for the session."""
    try:
        root = session_dir(session_id)
    except ValueError:
        return []
    out: list[dict] = []
    if not root.exists():
        return out

    for name in _ROOT_ARCHIVE_FILES:
        p = root / name
        if p.exists() and p.is_file():
            out.append({"path": name})

    ref_dir = root / "references"
    if ref_dir.exists():
        for p in sorted(ref_dir.iterdir()):
            if p.is_file():
                out.append({"path": f"references/{p.name}", "kind": "reference"})

    iterations_dir = root / "iterations"
    if iterations_dir.exists():
        for p in sorted(iterations_dir.rglob("*")):
            if not p.is_file():
                continue
            rel = p.relative_to(root).as_posix()
            if rel.endswith(LOCAL_SKIP_SUFFIXES):
                continue
            out.append({"path": rel})

    return out


LOCAL_SKIP_SUFFIXES = (".tmp",)


def append_user_note(session_id: str, note: str) -> None:
    """Append a timestamped note for the agent and archive it."""
    session_path = session_dir(session_id)
    session_path.mkdir(parents=True, exist_ok=True)
    path = session_path / "user_notes.md"
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
    with open(path, "a", encoding="utf-8") as f:
        f.write(f"## {ts}\n{note.strip()}\n\n")
    agent_archive.sync_file(session_id, session_path, "user_notes.md", kind="user_notes", event=True)
    agent_archive.append_event(
        session_id,
        session_path,
        "user.note_added",
        "User steering note added",
        source="backend",
    )


def record_claude_hook_event(session_id: str, payload: dict) -> None:
    session_path = session_dir(session_id)
    event = _hook_payload_to_event(payload)
    agent_archive.append_event(
        session_id,
        session_path,
        event["event"],
        event["message"],
        level=event.get("level", "info"),
        source="claude_hook",
        data=event.get("data"),
    )
    hook = payload.get("hook_event_name")
    if hook in {"Stop", "StopFailure", "SessionEnd"}:
        agent_archive.sync_transcript_from_payload(session_id, session_path, payload)


def list_sessions() -> list[dict]:
    seen = set()
    result = []

    for sid in reversed(list(_sessions.keys())):
        s = get_session(sid)
        if s:
            result.append(s)
            seen.add(sid)

    if SESSIONS_DIR.exists():
        for d in sorted(SESSIONS_DIR.iterdir(), reverse=True):
            if d.is_dir() and d.name not in seen:
                s = get_session(d.name)
                if s and s.get("has_started"):
                    result.append(s)
                    seen.add(d.name)

    for archived in agent_archive.list_archived_sessions():
        sid = archived.get("session_id")
        if sid and sid not in seen:
            s = agent_archive.get_archived_session(sid)
            if s:
                result.append(s)
                seen.add(sid)

    return result
