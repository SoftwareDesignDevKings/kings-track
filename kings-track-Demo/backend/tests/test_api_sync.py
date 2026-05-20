"""
Tests for POST /api/sync/trigger and GET /api/sync/status.
"""
import pytest
from datetime import datetime, timezone
from unittest.mock import patch, AsyncMock
from tests.conftest import seed, cleanup


@pytest.fixture(autouse=True)
def clean_sync_log():
    yield
    cleanup("DELETE FROM sync_log WHERE entity_type = 'test_full_sync'")


def test_trigger_sync_returns_started(app_client):
    with patch("app.api.routes.sync.sync_engine.full_sync", new_callable=AsyncMock):
        resp = app_client.post("/api/sync/trigger")
    assert resp.status_code == 200
    assert resp.json()["status"] == "started"


def test_trigger_sync_when_already_running(app_client):
    with patch("app.api.routes.sync.sync_engine._running", new=True):
        resp = app_client.post("/api/sync/trigger")
    assert resp.status_code == 200
    assert resp.json()["status"] == "already_running"


def test_sync_status_has_expected_shape(app_client):
    resp = app_client.get("/api/sync/status")
    assert resp.status_code == 200
    data = resp.json()
    assert "is_running" in data
    assert "progress" in data
    assert "logs" in data
    assert isinstance(data["logs"], list)


def test_sync_status_returns_inserted_log(app_client):
    now = datetime.now(timezone.utc).isoformat()
    seed(
        "INSERT INTO sync_log (entity_type, course_id, status, records_synced, completed_at) "
        "VALUES ('test_full_sync', NULL, 'completed', 0, :completed_at)",
        {"completed_at": now},
    )
    resp = app_client.get("/api/sync/status")
    assert resp.status_code == 200
    logs = resp.json()["logs"]
    matching = [l for l in logs if l["entity_type"] == "test_full_sync"]
    assert len(matching) >= 1
    assert matching[0]["status"] == "completed"


def test_sync_status_returns_live_progress(app_client):
    progress = {
        "sync_type": "full",
        "started_at": "2026-03-25T09:55:00Z",
        "phase": "Syncing course 99999",
        "current_course_id": 99999,
        "current_step": "submissions",
        "total_courses": 2,
        "completed_courses": 1,
        "pending_course_ids": [99999],
        "completed_course_ids": [11111],
        "total_steps": 9,
        "completed_steps": 5,
        "includes_edstem": False,
    }
    with patch("app.api.routes.sync.sync_engine._progress", new=progress), \
         patch("app.api.routes.sync.sync_engine._running", new=True):
        resp = app_client.get("/api/sync/status")

    assert resp.status_code == 200
    data = resp.json()
    assert data["is_running"] is True
    assert data["progress"]["current_step"] == "submissions"
    assert data["progress"]["pending_course_ids"] == [99999]
