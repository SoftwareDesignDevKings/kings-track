"""
Sync engine — orchestrates full and incremental Canvas data sync into local database.
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
from app.whitelist import get_effective_whitelist

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
        self._last_full_sync_at: datetime | None = None

    @property
    def is_running(self) -> bool:
        return self._running

    async def _sync_courses(self, canvas: CanvasClient, whitelist: list[int]) -> tuple[list[int], dict]:
        """Sync courses and return list of available course IDs and results."""
        results = {}
        async with AsyncSessionLocal() as db:
            logger.info("Syncing %d whitelisted courses…", len(whitelist))
            try:
                count = await sync_courses(canvas, db, whitelist_ids=whitelist)
                results["courses"] = {"status": "ok", "records": count}
                logger.info("Synced %d courses", count)
            except Exception as exc:
                logger.error("Failed to sync courses: %s", exc)
                results["courses"] = {"status": "error", "error": str(exc)}
                return [], results

            result = await db.execute(
                text("SELECT id FROM courses WHERE workflow_state = 'available' AND id = ANY(:ids)"),
                {"ids": whitelist},
            )
            course_ids = [row[0] for row in result.fetchall()]

        return course_ids, results

    async def _sync_course(self, canvas: CanvasClient, course_id: int, since: str | None = None) -> dict:
        """Sync all entities for a single course. Returns per-entity results."""
        course_results = {}
        logger.info("Processing course %d…", course_id)

        async with AsyncSessionLocal() as db:
            # Enrollments
            try:
                count = await sync_enrollments(canvas, db, course_id, since=since)
                course_results["enrollments"] = count
                logger.info("  Course %d: %d enrollments", course_id, count)
            except Exception as exc:
                logger.error("  Course %d enrollments failed: %s", course_id, exc)
                course_results["enrollments_error"] = str(exc)

            # Assignments (no incremental support in Canvas API)
            try:
                count = await sync_assignments(canvas, db, course_id)
                course_results["assignments"] = count
                logger.info("  Course %d: %d assignments", course_id, count)
            except Exception as exc:
                logger.error("  Course %d assignments failed: %s", course_id, exc)
                course_results["assignments_error"] = str(exc)

            # Submissions
            try:
                count = await sync_submissions(canvas, db, course_id, since=since)
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

        return course_results

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
        results: dict = {"sync_type": "full"}

        try:
            async with CanvasClient(settings.canvas_api_url, settings.canvas_api_token) as canvas:
                async with AsyncSessionLocal() as db:
                    whitelist = await get_effective_whitelist(db)

                if not whitelist:
                    logger.info("Whitelist is empty — nothing to sync")
                    results["courses"] = {"status": "ok", "records": 0}
                    results["skipped"] = "No courses in whitelist"
                else:
                    course_ids, sync_results = await self._sync_courses(canvas, whitelist)
                    results.update(sync_results)

                    if course_ids:
                        for course_id in course_ids:
                            results[str(course_id)] = await self._sync_course(canvas, course_id)

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
        logger.info("Full sync completed in %.1fs", elapsed)

        has_course_errors = any(
            key.endswith("_error")
            for course_results in results.values()
            if isinstance(course_results, dict)
            for key in course_results
        )
        status = "error" if ("error" in results or has_course_errors) else "completed"
        error_msg = results.get("error") or ("one or more courses failed to sync" if has_course_errors else None)
        async with AsyncSessionLocal() as db:
            await _log_sync(db, "full_sync", None, status, error=error_msg)

        if status == "completed":
            self._last_full_sync_at = datetime.now(timezone.utc)

        return results

    async def incremental_sync(self) -> dict:
        """
        Execute an incremental sync — only fetch records updated since the last full sync.
        Skips course sync (rarely changes) and enrollment deletion (can't safely delete
        without seeing the full list).
        """
        if self._running:
            logger.info("Sync already in progress — skipping")
            return {"status": "already_running"}

        if not settings.canvas_configured:
            logger.warning("Canvas API not configured — skipping sync")
            return {"status": "not_configured"}

        if not self._last_full_sync_at:
            logger.info("No previous full sync — running full sync instead")
            return await self.full_sync()

        self._running = True
        started_at = datetime.now(timezone.utc)
        since = self._last_full_sync_at.strftime("%Y-%m-%dT%H:%M:%SZ")
        results: dict = {"sync_type": "incremental", "since": since}

        try:
            async with CanvasClient(settings.canvas_api_url, settings.canvas_api_token) as canvas:
                async with AsyncSessionLocal() as db:
                    whitelist = await get_effective_whitelist(db)

                if not whitelist:
                    results["skipped"] = "No courses in whitelist"
                else:
                    # Get available course IDs from DB (skip course sync)
                    async with AsyncSessionLocal() as db:
                        result = await db.execute(
                            text("SELECT id FROM courses WHERE workflow_state = 'available' AND id = ANY(:ids)"),
                            {"ids": whitelist},
                        )
                        course_ids = [row[0] for row in result.fetchall()]

                    for course_id in course_ids:
                        results[str(course_id)] = await self._sync_course(canvas, course_id, since=since)

        except CanvasAPIError as exc:
            logger.error("Canvas API error during incremental sync: %s", exc)
            results["error"] = str(exc)
        except Exception as exc:
            logger.exception("Unexpected error during incremental sync: %s", exc)
            results["error"] = str(exc)
        finally:
            self._running = False

        elapsed = (datetime.now(timezone.utc) - started_at).total_seconds()
        results["elapsed_seconds"] = round(elapsed, 1)
        logger.info("Incremental sync completed in %.1fs", elapsed)

        has_course_errors = any(
            key.endswith("_error")
            for course_results in results.values()
            if isinstance(course_results, dict)
            for key in course_results
        )
        status = "error" if ("error" in results or has_course_errors) else "completed"
        error_msg = results.get("error") or ("one or more courses failed to sync" if has_course_errors else None)
        async with AsyncSessionLocal() as db:
            await _log_sync(db, "full_sync", None, status, error=error_msg)

        return results

    def start_scheduler(self, interval_hours: int = 6, incremental_interval_minutes: int = 30):
        """Start the background sync scheduler with full and incremental syncs."""
        async def _loop():
            logger.info(
                "Sync scheduler started — full sync every %dh, incremental every %dm",
                interval_hours, incremental_interval_minutes,
            )
            # Run an initial full sync on startup
            await asyncio.sleep(5)
            try:
                await self.full_sync()
            except Exception as exc:
                logger.error("Initial full sync failed: %s", exc)

            # Alternate between incremental syncs, with periodic full syncs
            incremental_interval_s = incremental_interval_minutes * 60
            full_interval_s = interval_hours * 3600
            elapsed_since_full = 0

            while True:
                await asyncio.sleep(incremental_interval_s)
                elapsed_since_full += incremental_interval_s

                try:
                    if elapsed_since_full >= full_interval_s:
                        logger.info("Running scheduled full sync")
                        await self.full_sync()
                        elapsed_since_full = 0
                    else:
                        logger.info("Running scheduled incremental sync")
                        await self.incremental_sync()
                except Exception as exc:
                    logger.error("Scheduled sync failed: %s", exc)

        self._task = asyncio.create_task(_loop())
        return self._task

    def stop_scheduler(self):
        if self._task:
            self._task.cancel()
            self._task = None


# Singleton — shared across the app
sync_engine = SyncEngine()
