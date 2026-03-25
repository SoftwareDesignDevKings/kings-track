"""
Sync engine — orchestrates full Canvas data sync into local database.
Processes one course at a time to keep memory usage within 256MB Fly.io limit.
"""
import asyncio
import logging
from datetime import datetime, timezone

from sqlalchemy import text

from app.canvas.client import CanvasClient, CanvasAPIError
from app.config import settings
from app.db import AsyncSessionLocal
from app.sync.tasks import (
    sync_courses,
    sync_enrollments,
    sync_assignments,
    sync_submissions,
    compute_metrics,
)

logger = logging.getLogger(__name__)


async def _log_sync(db, entity_type: str, course_id: int | None, status: str, records: int = 0, error: str | None = None) -> int:
    now = datetime.now(timezone.utc)
    result = await db.execute(
        text("""
            INSERT INTO sync_log (entity_type, course_id, status, records_synced, started_at, completed_at, error_message)
            VALUES (:entity_type, :course_id, :status, :records, :started_at, :completed_at, :error_message)
            RETURNING id
        """),
        {
            "entity_type": entity_type,
            "course_id": course_id,
            "status": status,
            "records": records,
            "started_at": now if status == "started" else None,
            "completed_at": now if status != "started" else None,
            "error_message": error,
        },
    )
    await db.commit()
    return result.scalar()


class SyncEngine:
    def __init__(self):
        self._running = False
        self._task: asyncio.Task | None = None

    @property
    def is_running(self) -> bool:
        return self._running

    async def full_sync(self) -> dict:
        """
        Execute a complete sync in dependency order:
        courses → (per course) enrollments → assignments → submissions → metrics

        Processes one course at a time to minimise memory usage.
        """
        if self._running:
            logger.info("Sync already in progress — skipping")
            return {"status": "already_running"}

        if not settings.canvas_configured:
            logger.warning("Canvas API not configured — skipping sync")
            return {"status": "not_configured", "message": "Set CANVAS_API_URL and CANVAS_API_TOKEN"}

        self._running = True
        started_at = datetime.now(timezone.utc)
        results = {}

        try:
            async with CanvasClient(settings.canvas_api_url, settings.canvas_api_token) as canvas:
                async with AsyncSessionLocal() as db:
                    # 1. Sync course list
                    logger.info("Syncing courses…")
                    try:
                        count = await sync_courses(canvas, db)
                        results["courses"] = {"status": "ok", "records": count}
                        logger.info("Synced %d courses", count)
                    except Exception as exc:
                        logger.error("Failed to sync courses: %s", exc)
                        results["courses"] = {"status": "error", "error": str(exc)}
                        return results  # Can't proceed without courses

                    # 2. Fetch course IDs from DB
                    rows = await db.execute(
                        text("SELECT id FROM courses WHERE workflow_state = 'available'")
                    )
                    course_ids = [row[0] for row in rows]

                # Process each course with its own session (frees memory between courses)
                for course_id in course_ids:
                    course_results = {}
                    logger.info("Processing course %d…", course_id)

                    async with AsyncSessionLocal() as db:
                        # Enrollments
                        try:
                            count = await sync_enrollments(canvas, db, course_id)
                            course_results["enrollments"] = count
                            logger.info("  Course %d: %d enrollments", course_id, count)
                        except Exception as exc:
                            logger.error("  Course %d enrollments failed: %s", course_id, exc)
                            course_results["enrollments_error"] = str(exc)

                        # Assignments
                        try:
                            count = await sync_assignments(canvas, db, course_id)
                            course_results["assignments"] = count
                            logger.info("  Course %d: %d assignments", course_id, count)
                        except Exception as exc:
                            logger.error("  Course %d assignments failed: %s", course_id, exc)
                            course_results["assignments_error"] = str(exc)

                        # Submissions (page-by-page streaming)
                        try:
                            count = await sync_submissions(canvas, db, course_id)
                            course_results["submissions"] = count
                            logger.info("  Course %d: %d submissions", course_id, count)
                        except Exception as exc:
                            logger.error("  Course %d submissions failed: %s", course_id, exc)
                            course_results["submissions_error"] = str(exc)

                        # Compute metrics (DB-only, no API calls)
                        try:
                            count = await compute_metrics(db, course_id)
                            course_results["metrics"] = count
                            logger.info("  Course %d: metrics computed for %d students", course_id, count)
                        except Exception as exc:
                            logger.error("  Course %d metrics failed: %s", course_id, exc)
                            course_results["metrics_error"] = str(exc)

                    results[str(course_id)] = course_results

        except CanvasAPIError as exc:
            logger.error("Canvas API error during sync: %s", exc)
            results["error"] = str(exc)
        except Exception as exc:
            logger.exception("Unexpected error during sync: %s", exc)
            results["error"] = str(exc)
        finally:
            self._running = False

        elapsed = (datetime.now(timezone.utc) - started_at).total_seconds()
        results["elapsed_seconds"] = round(elapsed, 1)
        logger.info("Sync completed in %.1fs", elapsed)
        return results

    def start_scheduler(self, interval_hours: int = 24):
        """Start the background sync scheduler."""
        async def _loop():
            logger.info("Sync scheduler started — interval: %dh", interval_hours)
            # Run an initial sync on startup
            await asyncio.sleep(5)  # Brief delay to let the app finish starting up
            while True:
                try:
                    await self.full_sync()
                except Exception as exc:
                    logger.error("Scheduled sync failed: %s", exc)
                await asyncio.sleep(interval_hours * 3600)

        self._task = asyncio.create_task(_loop())
        return self._task

    def stop_scheduler(self):
        if self._task:
            self._task.cancel()
            self._task = None


# Singleton — shared across the app
sync_engine = SyncEngine()
