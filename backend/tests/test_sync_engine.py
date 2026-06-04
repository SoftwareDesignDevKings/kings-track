"""
Tests for SyncEngine.full_sync() guards and edge cases.
"""
import pytest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch, AsyncMock

from app.sync.engine import SyncEngine, _get_active_course_ids
from tests.conftest import cleanup, seed


async def test_full_sync_returns_already_running_when_running():
    engine = SyncEngine()
    engine._running = True
    result = await engine.full_sync()
    assert result["status"] == "already_running"


async def test_full_sync_returns_not_configured_when_canvas_not_set():
    engine = SyncEngine()
    with patch("app.sync.engine.settings") as mock_settings:
        mock_settings.canvas_configured = False
        result = await engine.full_sync()
    assert result["status"] == "not_configured"


async def test_get_active_course_ids_excludes_term_ended_courses(db):
    active_id = 881001
    archived_id = 881002
    now = datetime.now(timezone.utc)
    cleanup("DELETE FROM courses WHERE id IN (:active_id, :archived_id)", {
        "active_id": active_id,
        "archived_id": archived_id,
    })
    seed(
        """
        INSERT INTO courses (id, name, workflow_state, synced_at, term_end_at, total_students)
        VALUES (:id, 'Active Course', 'available', :now, :term_end_at, 0)
        """,
        {"id": active_id, "now": now.isoformat(), "term_end_at": (now + timedelta(days=30)).isoformat()},
    )
    seed(
        """
        INSERT INTO courses (id, name, workflow_state, synced_at, term_end_at, total_students)
        VALUES (:id, 'Archived Course', 'available', :now, :term_end_at, 0)
        """,
        {"id": archived_id, "now": now.isoformat(), "term_end_at": (now - timedelta(days=30)).isoformat()},
    )

    try:
        course_ids = await _get_active_course_ids(db, [active_id, archived_id])
        assert course_ids == [active_id]
    finally:
        cleanup("DELETE FROM courses WHERE id IN (:active_id, :archived_id)", {
            "active_id": active_id,
            "archived_id": archived_id,
        })


async def test_full_sync_resets_running_flag_after_error():
    """_running must be False after sync even if an unexpected error occurs."""
    engine = SyncEngine()
    with patch("app.sync.engine.settings") as mock_settings, \
         patch("app.sync.engine.CanvasClient") as mock_client_cls:
        mock_settings.canvas_configured = True
        mock_settings.canvas_api_url = "https://canvas.test"
        mock_settings.canvas_api_token = "token"
        # Make the client raise immediately on __aenter__
        mock_client_cls.return_value.__aenter__ = AsyncMock(side_effect=Exception("boom"))
        mock_client_cls.return_value.__aexit__ = AsyncMock(return_value=False)

        result = await engine.full_sync()

    assert engine._running is False
    assert "error" in result


async def test_full_sync_skips_when_whitelist_empty():
    """full_sync should return early with a skipped message when whitelist is empty."""
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


async def test_full_sync_writes_sync_log_on_completion():
    """full_sync should include elapsed_seconds when it runs through to completion."""
    engine = SyncEngine()

    with patch("app.sync.engine.settings") as mock_settings, \
         patch("app.sync.engine.CanvasClient") as mock_client_cls, \
         patch("app.sync.engine.sync_courses", new_callable=AsyncMock, return_value=1), \
         patch("app.sync.engine.sync_enrollments", new_callable=AsyncMock, return_value=0), \
         patch("app.sync.engine.sync_assignments", new_callable=AsyncMock, return_value=0), \
         patch("app.sync.engine.sync_submissions", new_callable=AsyncMock, return_value=0), \
         patch("app.sync.engine.sync_canvas_engagement", new_callable=AsyncMock, return_value=0), \
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

        # Mock execute to return appropriate results based on call order
        # Each AsyncSessionLocal() call gets its own mock_db, so execute
        # is called multiple times across sessions
        whitelist_result = AsyncMock()
        whitelist_result.fetchall = lambda: [(99999,)]
        course_ids_result = AsyncMock()
        course_ids_result.fetchall = lambda: [(99999,)]
        log_result = AsyncMock()
        log_result.scalar = lambda: 1

        mock_db.execute = AsyncMock(side_effect=[
            whitelist_result, course_ids_result, log_result, log_result,
        ])
        mock_session_factory.return_value = mock_db

        result = await engine.full_sync()

    assert engine._running is False
    assert "elapsed_seconds" in result


async def test_incremental_sync_refreshes_course_metadata_before_course_sync():
    engine = SyncEngine()
    last_full_sync_at = datetime.now(timezone.utc) - timedelta(hours=1)

    with patch("app.sync.engine.settings") as mock_settings, \
         patch("app.sync.engine.CanvasClient") as mock_client_cls, \
         patch("app.sync.engine.get_effective_whitelist", new_callable=AsyncMock, return_value=[12345]), \
         patch.object(engine, "_get_last_full_sync_at", new_callable=AsyncMock, return_value=last_full_sync_at), \
         patch.object(engine, "_sync_courses", new_callable=AsyncMock, return_value=([12345], {"courses": {"status": "ok", "records": 1}})) as mock_sync_courses, \
         patch.object(engine, "_sync_course", new_callable=AsyncMock, return_value={"enrollments": 0}) as mock_sync_course, \
         patch("app.sync.engine.AsyncSessionLocal") as mock_session_factory:

        mock_settings.canvas_configured = True
        mock_settings.canvas_api_url = "https://canvas.test"
        mock_settings.canvas_api_token = "token"
        mock_settings.edstem_configured = False

        mock_canvas = AsyncMock()
        mock_client_cls.return_value.__aenter__ = AsyncMock(return_value=mock_canvas)
        mock_client_cls.return_value.__aexit__ = AsyncMock(return_value=False)

        log_result = AsyncMock()
        log_result.scalar = lambda: 1
        mock_db = AsyncMock()
        mock_db.execute = AsyncMock(return_value=log_result)
        mock_db.commit = AsyncMock()
        mock_db.__aenter__ = AsyncMock(return_value=mock_db)
        mock_db.__aexit__ = AsyncMock(return_value=False)
        mock_session_factory.return_value = mock_db

        result = await engine.incremental_sync()

    assert engine._running is False
    assert result["courses"] == {"status": "ok", "records": 1}
    mock_sync_courses.assert_awaited_once_with(mock_canvas, [12345])
    mock_sync_course.assert_awaited_once()


async def test_sync_course_calls_edstem_when_configured():
    """When edstem_configured=True, sync_edstem_lessons is called during _sync_course()."""
    engine = SyncEngine()
    mock_canvas = AsyncMock()

    with patch("app.sync.engine.settings") as mock_settings, \
         patch("app.sync.engine.sync_enrollments", new_callable=AsyncMock, return_value=0), \
         patch("app.sync.engine.sync_assignments", new_callable=AsyncMock, return_value=0), \
         patch("app.sync.engine.sync_submissions", new_callable=AsyncMock, return_value=5), \
         patch("app.sync.engine.compute_metrics", new_callable=AsyncMock, return_value=1), \
         patch("app.sync.engine.sync_edstem_lessons", new_callable=AsyncMock, return_value=10) as mock_edstem, \
         patch("app.sync.engine.EdStemClient") as mock_edstem_cls, \
         patch("app.sync.engine.AsyncSessionLocal") as mock_session_factory:

        mock_settings.edstem_configured = True
        mock_settings.edstem_api_url = "https://edstem.org/api"
        mock_settings.edstem_api_token = "edstem-token"

        mock_edstem_client = AsyncMock()
        mock_edstem_cls.return_value.__aenter__ = AsyncMock(return_value=mock_edstem_client)
        mock_edstem_cls.return_value.__aexit__ = AsyncMock(return_value=False)

        mock_db = AsyncMock()
        mock_db.commit = AsyncMock()
        mock_db.__aenter__ = AsyncMock(return_value=mock_db)
        mock_db.__aexit__ = AsyncMock(return_value=False)
        mock_db.execute = AsyncMock(return_value=AsyncMock(scalar=lambda: None, fetchall=lambda: []))
        mock_session_factory.return_value = mock_db

        result = await engine._sync_course(mock_canvas, 99999)

    mock_edstem.assert_awaited_once()
    assert result.get("edstem_lessons") == 10


async def test_sync_course_edstem_error_does_not_block_canvas():
    """An EdStem exception does not prevent synced_at from being stamped."""
    engine = SyncEngine()
    mock_canvas = AsyncMock()

    with patch("app.sync.engine.settings") as mock_settings, \
         patch("app.sync.engine.sync_enrollments", new_callable=AsyncMock, return_value=0), \
         patch("app.sync.engine.sync_assignments", new_callable=AsyncMock, return_value=0), \
         patch("app.sync.engine.sync_submissions", new_callable=AsyncMock, return_value=0), \
         patch("app.sync.engine.compute_metrics", new_callable=AsyncMock, return_value=0), \
         patch("app.sync.engine.EdStemClient") as mock_edstem_cls, \
         patch("app.sync.engine.AsyncSessionLocal") as mock_session_factory:

        mock_settings.edstem_configured = True
        mock_settings.edstem_api_url = "https://edstem.org/api"
        mock_settings.edstem_api_token = "edstem-token"

        # EdStem client raises on entry
        mock_edstem_cls.return_value.__aenter__ = AsyncMock(side_effect=Exception("EdStem down"))
        mock_edstem_cls.return_value.__aexit__ = AsyncMock(return_value=False)

        mock_db = AsyncMock()
        mock_db.commit = AsyncMock()
        mock_db.__aenter__ = AsyncMock(return_value=mock_db)
        mock_db.__aexit__ = AsyncMock(return_value=False)
        mock_db.execute = AsyncMock(return_value=AsyncMock(scalar=lambda: None, fetchall=lambda: []))
        mock_session_factory.return_value = mock_db

        result = await engine._sync_course(mock_canvas, 99999)

    # EdStem error captured but synced_at stamped (commit was called)
    assert "edstem_error" in result
    mock_db.commit.assert_awaited()


async def test_sync_course_skips_edstem_when_not_configured():
    """When edstem_configured=False, EdStemClient is never instantiated."""
    engine = SyncEngine()
    mock_canvas = AsyncMock()

    with patch("app.sync.engine.settings") as mock_settings, \
         patch("app.sync.engine.sync_enrollments", new_callable=AsyncMock, return_value=0), \
         patch("app.sync.engine.sync_assignments", new_callable=AsyncMock, return_value=0), \
         patch("app.sync.engine.sync_submissions", new_callable=AsyncMock, return_value=0), \
         patch("app.sync.engine.compute_metrics", new_callable=AsyncMock, return_value=0), \
         patch("app.sync.engine.EdStemClient") as mock_edstem_cls, \
         patch("app.sync.engine.AsyncSessionLocal") as mock_session_factory:

        mock_settings.edstem_configured = False

        mock_db = AsyncMock()
        mock_db.commit = AsyncMock()
        mock_db.__aenter__ = AsyncMock(return_value=mock_db)
        mock_db.__aexit__ = AsyncMock(return_value=False)
        mock_db.execute = AsyncMock(return_value=AsyncMock(scalar=lambda: None, fetchall=lambda: []))
        mock_session_factory.return_value = mock_db

        await engine._sync_course(mock_canvas, 99999)

    mock_edstem_cls.assert_not_called()
