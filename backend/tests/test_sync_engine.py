"""
Tests for SyncEngine.full_sync() guards and edge cases.
"""
import pytest
from unittest.mock import patch, AsyncMock

from app.sync.engine import SyncEngine


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
         patch("app.sync.engine.compute_metrics", new_callable=AsyncMock, return_value=0), \
         patch("app.sync.engine.AsyncSessionLocal") as mock_session_factory:

        mock_settings.canvas_configured = True
        mock_settings.canvas_api_url = "https://canvas.test"
        mock_settings.canvas_api_token = "token"

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
