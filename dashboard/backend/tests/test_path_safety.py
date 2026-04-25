from pathlib import Path

import pytest

from dashboard.backend.app import agent, storage


def test_local_storage_rejects_traversal(monkeypatch, tmp_path):
    monkeypatch.setattr(storage, "LOCAL_DATA_DIR", tmp_path)

    inside = storage.get_local_file_path("uploads/example.txt")
    assert inside == (tmp_path / "uploads" / "example.txt").resolve()

    with pytest.raises(ValueError):
        storage.get_local_file_path("../outside.txt")


def test_upload_keys_strip_untrusted_filename_paths(monkeypatch):
    monkeypatch.setattr(storage, "STORAGE_MODE", "local")

    upload = storage.presigned_upload_url(r"..\nested/../evil.txt", "text/plain")

    assert upload["s3_key"].startswith("uploads/")
    assert upload["s3_key"].endswith("/evil.txt")
    assert ".." not in upload["s3_key"]
    assert "\\" not in upload["s3_key"]


def test_upload_content_type_allowlist():
    assert storage.is_supported_upload_content_type("video/mp4") is True
    assert storage.is_supported_upload_content_type("audio/mpeg") is True
    assert storage.is_supported_upload_content_type("text/plain") is True
    assert storage.is_supported_upload_content_type("text/html") is False
    assert storage.is_supported_upload_content_type("application/octet-stream") is False


def test_agent_session_dir_rejects_untrusted_ids():
    valid = "session_20260425_120000_ab12"
    assert agent.session_dir(valid) == agent.SESSIONS_DIR / valid

    for session_id in ["../escape", "session_bad", "session_20260425_120000_zzzz"]:
        with pytest.raises(ValueError):
            agent.session_dir(session_id)


def test_agent_start_closes_log_when_process_spawn_fails(monkeypatch, tmp_path):
    session_id = "session_20260425_120000_ab12"
    monkeypatch.setattr(agent, "SESSIONS_DIR", tmp_path)
    agent._sessions.pop(session_id, None)

    class FakeLog:
        closed = False

        def close(self):
            self.closed = True

    fake_log = FakeLog()

    def fake_open(*args, **kwargs):
        return fake_log

    def fail_spawn(*args, **kwargs):
        raise OSError("claude not found")

    monkeypatch.setattr(agent, "open", fake_open, raising=False)
    monkeypatch.setattr(agent.subprocess, "Popen", fail_spawn)

    with pytest.raises(OSError):
        agent.start_session(
            {
                "target_description": "calm focus",
                "creative_brief": "",
                "duration": 30,
            },
            session_id=session_id,
        )

    assert fake_log.closed is True
    assert session_id not in agent._sessions


def test_get_session_closes_log_for_finished_process(monkeypatch, tmp_path):
    session_id = "session_20260425_120000_ab12"
    monkeypatch.setattr(agent, "SESSIONS_DIR", tmp_path)
    (tmp_path / session_id / "references").mkdir(parents=True)

    class FakeProcess:
        def poll(self):
            return 0

    class FakeLog:
        closed = False

        def close(self):
            self.closed = True

    fake_log = FakeLog()
    agent._sessions[session_id] = {
        "session_id": session_id,
        "params": {},
        "process": FakeProcess(),
        "log_file": fake_log,
    }

    try:
        assert agent.get_session(session_id) is not None
        assert fake_log.closed is True
    finally:
        agent._sessions.pop(session_id, None)
