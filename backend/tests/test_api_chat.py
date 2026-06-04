"""Tests for the AI chat assistant — /api/chat and the tool-calling agent.

Gemini is mocked at the HTTP layer with respx so no real API key is needed.
"""
import re

import httpx
import pytest
import respx
from datetime import datetime, timezone
from unittest.mock import patch

from tests.conftest import seed, cleanup

COURSE_ID = 93001
USER_ID = 94101
ASSIGNMENT_ID = 95101
ENROLLMENT_ID = 96011

GEMINI_URL = re.compile(r"https://generativelanguage\.googleapis\.com/.*")


def _fn_call_response(name: str, args: dict):
    return httpx.Response(
        200,
        json={"candidates": [{"content": {"role": "model", "parts": [{"functionCall": {"name": name, "args": args}}]}}]},
    )


def _text_response(text: str):
    return httpx.Response(
        200,
        json={"candidates": [{"content": {"role": "model", "parts": [{"text": text}]}}]},
    )


@pytest.fixture(autouse=True)
def chat_data():
    now = datetime.now(timezone.utc).isoformat()
    seed("INSERT INTO courses (id, name, course_code, workflow_state, synced_at, total_students) VALUES (:id, 'Software Engineering', '11SEN', 'available', :now, 0) ON CONFLICT (id) DO NOTHING", {"id": COURSE_ID, "now": now})
    seed("INSERT INTO users (id, name, sortable_name, email, sis_id) VALUES (:id, 'Alice Smith', 'Smith, Alice', 'alice@example.com', 'alice') ON CONFLICT (id) DO NOTHING", {"id": USER_ID})
    seed("INSERT INTO enrollments (id, course_id, user_id, role, enrollment_state) VALUES (:id, :cid, :uid, 'StudentEnrollment', 'active') ON CONFLICT (id) DO NOTHING", {"id": ENROLLMENT_ID, "cid": COURSE_ID, "uid": USER_ID})
    seed("INSERT INTO assignments (id, course_id, name, assignment_group_name, assignment_group_id, workflow_state, position) VALUES (:id, :cid, 'Final Project', 'Unit 1', 10, 'published', 1) ON CONFLICT (id) DO NOTHING", {"id": ASSIGNMENT_ID, "cid": COURSE_ID})
    yield
    cleanup("DELETE FROM submissions WHERE course_id = :id", {"id": COURSE_ID})
    cleanup("DELETE FROM enrollments WHERE course_id = :id", {"id": COURSE_ID})
    cleanup("DELETE FROM assignments WHERE course_id = :id", {"id": COURSE_ID})
    cleanup("DELETE FROM users WHERE id = :id", {"id": USER_ID})
    cleanup("DELETE FROM courses WHERE id = :id", {"id": COURSE_ID})


# ---------------------------------------------------------------------------
# Configuration / gating
# ---------------------------------------------------------------------------

def test_status_disabled_when_unconfigured(app_client):
    with patch("app.config.settings.gemini_api_key", ""):
        resp = app_client.get("/api/chat/status")
    assert resp.status_code == 200
    assert resp.json()["enabled"] is False


def test_chat_returns_503_when_unconfigured(app_client):
    with patch("app.config.settings.gemini_api_key", ""):
        resp = app_client.post("/api/chat", json={"messages": [{"role": "user", "content": "hi"}]})
    assert resp.status_code == 503


def test_chat_rejects_empty_messages(app_client):
    with patch("app.config.settings.gemini_api_key", "test-key"):
        resp = app_client.post("/api/chat", json={"messages": []})
    assert resp.status_code == 422


# ---------------------------------------------------------------------------
# Agent / tool-calling
# ---------------------------------------------------------------------------

@respx.mock
def test_chat_plain_answer_no_tools(app_client):
    respx.post(GEMINI_URL).mock(return_value=_text_response("Hello! How can I help?"))
    with patch("app.config.settings.gemini_api_key", "test-key"):
        resp = app_client.post("/api/chat", json={"messages": [{"role": "user", "content": "hi"}]})
    assert resp.status_code == 200
    body = resp.json()
    assert body["reply"] == "Hello! How can I help?"
    assert body["tool_calls"] == []


@respx.mock
def test_chat_runs_find_students_tool(app_client):
    # First call: model asks to call find_students. Second: model answers.
    respx.post(GEMINI_URL).mock(
        side_effect=[
            _fn_call_response("find_students", {"query": "Alice"}),
            _text_response("Alice Smith is enrolled in Software Engineering."),
        ]
    )
    with patch("app.config.settings.gemini_api_key", "test-key"):
        resp = app_client.post(
            "/api/chat",
            json={"messages": [{"role": "user", "content": "How is Alice going?"}]},
        )
    assert resp.status_code == 200
    body = resp.json()
    assert "Alice Smith" in body["reply"]
    assert "find_students" in body["tool_calls"]


@respx.mock
def test_chat_task_completion_tool(app_client):
    seed(
        "INSERT INTO submissions (id, assignment_id, user_id, course_id, workflow_state, score, late, missing) "
        "VALUES (:id, :aid, :uid, :cid, 'graded', 90.0, false, false) ON CONFLICT (assignment_id, user_id) DO NOTHING",
        {"id": 970101, "aid": ASSIGNMENT_ID, "uid": USER_ID, "cid": COURSE_ID},
    )
    captured = {}

    def _side_effect(request):
        # Second call carries the functionResponse — assert the tool ran correctly.
        body = request.content.decode()
        if "functionResponse" in body:
            captured["saw_response"] = True
            return _text_response("Alice Smith has completed the Final Project.")
        return _fn_call_response(
            "get_task_completion",
            {"course_name": "Software Engineering", "task_name": "Final Project"},
        )

    respx.post(GEMINI_URL).mock(side_effect=_side_effect)
    with patch("app.config.settings.gemini_api_key", "test-key"):
        resp = app_client.post(
            "/api/chat",
            json={"messages": [{"role": "user", "content": "Who completed the Final Project?"}]},
        )
    assert resp.status_code == 200
    assert captured.get("saw_response") is True
    assert "get_task_completion" in resp.json()["tool_calls"]


@respx.mock
def test_chat_surfaces_gemini_error_as_502(app_client):
    respx.post(GEMINI_URL).mock(return_value=httpx.Response(500, text="boom"))
    with patch("app.config.settings.gemini_api_key", "test-key"):
        resp = app_client.post(
            "/api/chat",
            json={"messages": [{"role": "user", "content": "hi"}]},
        )
    assert resp.status_code == 502
