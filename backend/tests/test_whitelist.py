"""
Tests for get_effective_whitelist and its effect on the sync engine.
"""
import pytest
from sqlalchemy import text
from unittest.mock import patch, AsyncMock

from app.sync.engine import SyncEngine
from app.whitelist import get_effective_whitelist
from tests.conftest import seed, cleanup

COURSE_ID = 77001


@pytest.fixture(autouse=True)
def clean_whitelist():
    yield
    cleanup("DELETE FROM course_whitelist WHERE course_id = :id", {"id": COURSE_ID})
    cleanup("DELETE FROM courses WHERE id = :id", {"id": COURSE_ID})


# ---------------------------------------------------------------------------
# get_effective_whitelist
# ---------------------------------------------------------------------------

async def test_get_effective_whitelist_empty(db):
    result = await get_effective_whitelist(db)
    # Only checks that the function returns a list; other tests may have rows
    assert isinstance(result, list)


async def test_get_effective_whitelist_returns_seeded_ids(db):
    now = __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat()
    seed(
        "INSERT INTO courses (id, name, workflow_state, synced_at, total_students) "
        "VALUES (:id, 'WL Course', 'available', :now, 0) ON CONFLICT (id) DO NOTHING",
        {"id": COURSE_ID, "now": now},
    )
    seed(
        "INSERT INTO course_whitelist (course_id) VALUES (:id) ON CONFLICT DO NOTHING",
        {"id": COURSE_ID},
    )
    result = await get_effective_whitelist(db)
    assert COURSE_ID in result


# ---------------------------------------------------------------------------
# Sync engine — empty whitelist skips sync
# ---------------------------------------------------------------------------

async def test_full_sync_skips_when_whitelist_empty():
    engine = SyncEngine()

    with patch("app.sync.engine.settings") as mock_settings, \
         patch("app.sync.engine.CanvasClient") as mock_client_cls, \
         patch("app.sync.engine.AsyncSessionLocal") as mock_session_factory:

        mock_settings.canvas_configured = True
        mock_settings.canvas_api_url = "https://canvas.test"
        mock_settings.canvas_api_token = "token"

        mock_canvas = AsyncMock()
        mock_client_cls.return_value.__aenter__ = AsyncMock(return_value=mock_canvas)
        mock_client_cls.return_value.__aexit__ = AsyncMock(return_value=False)

        mock_db = AsyncMock()
        mock_result = AsyncMock()
        mock_result.fetchall = lambda: []
        mock_db.execute = AsyncMock(return_value=mock_result)
        mock_db.commit = AsyncMock()
        mock_db.__aenter__ = AsyncMock(return_value=mock_db)
        mock_db.__aexit__ = AsyncMock(return_value=False)
        mock_session_factory.return_value = mock_db

        result = await engine.full_sync()

    assert engine._running is False
    assert result.get("skipped") == "No courses in whitelist"
    # sync_courses should never have been called
    mock_canvas.list_courses.assert_not_called()


async def test_full_sync_only_syncs_whitelisted_courses():
    """sync_courses must be called with the whitelist IDs, not without."""
    engine = SyncEngine()

    with patch("app.sync.engine.settings") as mock_settings, \
         patch("app.sync.engine.CanvasClient") as mock_client_cls, \
         patch("app.sync.engine.sync_courses", new_callable=AsyncMock, return_value=1) as mock_sync_courses, \
         patch("app.sync.engine.sync_enrollments", new_callable=AsyncMock, return_value=0), \
         patch("app.sync.engine.sync_assignments", new_callable=AsyncMock, return_value=0), \
         patch("app.sync.engine.sync_submissions", new_callable=AsyncMock, return_value=0), \
         patch("app.sync.engine.compute_metrics", new_callable=AsyncMock, return_value=0), \
         patch("app.sync.engine.AsyncSessionLocal") as mock_session_factory:

        mock_settings.canvas_configured = True
        mock_settings.canvas_api_url = "https://canvas.test"
        mock_settings.canvas_api_token = "token"
        mock_settings.edstem_configured = False  # skip EdStem in this test

        mock_canvas = AsyncMock()
        mock_client_cls.return_value.__aenter__ = AsyncMock(return_value=mock_canvas)
        mock_client_cls.return_value.__aexit__ = AsyncMock(return_value=False)

        mock_db = AsyncMock()
        mock_db.commit = AsyncMock()
        mock_db.__aenter__ = AsyncMock(return_value=mock_db)
        mock_db.__aexit__ = AsyncMock(return_value=False)

        whitelist_result = AsyncMock()
        whitelist_result.fetchall = lambda: [(COURSE_ID,)]
        course_ids_result = AsyncMock()
        course_ids_result.fetchall = lambda: [(COURSE_ID,)]
        log_result = AsyncMock()
        log_result.scalar = lambda: 1
        mock_db.execute = AsyncMock(side_effect=[whitelist_result, course_ids_result, log_result, log_result])
        mock_session_factory.return_value = mock_db

        result = await engine.full_sync()

    assert engine._running is False
    assert "elapsed_seconds" in result
    # sync_courses must have been called with the whitelist IDs
    mock_sync_courses.assert_called_once()
    _, kwargs = mock_sync_courses.call_args
    assert kwargs.get("whitelist_ids") == [COURSE_ID]
