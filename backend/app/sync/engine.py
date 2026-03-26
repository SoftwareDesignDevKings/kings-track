"""
Sync engine — orchestrates full and incremental Canvas data sync into local database.
Processes one course at a time to keep memory usage within 256MB Fly.io limit.
"""
import asyncio
import inspect
import logging
from datetime import datetime, timezone

from sqlalchemy import text

from app.canvas.client import CanvasClient, CanvasAPIError
from app.config import settings
from app.db import AsyncSessionLocal
from app.edstem.client import EdStemClient
from app.sync.tasks import (
    sync_courses,
    sync_enrollments,
    sync_assignments,
    sync_submissions,
    compute_metrics,
)
from app.sync.edstem_tasks import sync_edstem_lessons
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
    scalar = result.scalar()
    if inspect.isawaitable(scalar):
        scalar = await scalar
    return scalar


class SyncEngine:
    def __init__(self):
        self._running = False
        self._task: asyncio.Task | None = None
        self._last_full_sync_at: datetime | None = None
        self._progress: dict | None = None

    @property
    def is_running(self) -> bool:
        return self._running

    @property
    def progress(self) -> dict | None:
        if self._progress is None:
            return None
        return dict(self._progress)

    def _reset_progress(self):
        self._progress = None

    def _begin_progress(self, sync_type: str, started_at: datetime, total_courses: int, includes_edstem: bool):
        self._progress = {
            "sync_type": sync_type,
            "started_at": started_at.isoformat(),
            "phase": "Preparing sync",
            "current_course_id": None,
            "current_step": None,
            "total_courses": total_courses,
            "completed_courses": 0,
            "pending_course_ids": [],
            "completed_course_ids": [],
            "total_steps": None,
            "completed_steps": 0,
            "includes_edstem": includes_edstem,
        }

    def _set_course_plan(self, course_ids: list[int]):
        if self._progress is None:
            return
        per_course_steps = 5 if self._progress["includes_edstem"] else 4
        self._progress["pending_course_ids"] = list(course_ids)
        self._progress["completed_course_ids"] = []
        self._progress["total_courses"] = len(course_ids)
        self._progress["completed_courses"] = 0
        self._progress["total_steps"] = 1 + (len(course_ids) * per_course_steps)
        self._progress["phase"] = "Syncing courses"
        self._progress["current_step"] = "courses"

    def _mark_step_started(self, step: str, course_id: int | None = None):
        if self._progress is None:
            return
        self._progress["current_step"] = step
        self._progress["current_course_id"] = course_id
        self._progress["phase"] = "Syncing courses" if course_id is None else f"Syncing course {course_id}"

    def _mark_step_completed(self):
        if self._progress is None:
            return
        self._progress["completed_steps"] += 1

    def _mark_course_complete(self, course_id: int):
        if self._progress is None:
            return
        self._mark_step_started("course_complete", course_id)
        if course_id in self._progress["pending_course_ids"]:
            self._progress["pending_course_ids"] = [cid for cid in self._progress["pending_course_ids"] if cid != course_id]
        if course_id not in self._progress["completed_course_ids"]:
            self._progress["completed_course_ids"] = [*self._progress["completed_course_ids"], course_id]
        self._progress["completed_courses"] = len(self._progress["completed_course_ids"])

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
                self._mark_step_started("enrollments", course_id)
                count = await sync_enrollments(canvas, db, course_id, since=since)
                course_results["enrollments"] = count
                self._mark_step_completed()
                logger.info("  Course %d: %d enrollments", course_id, count)
            except Exception as exc:
                logger.error("  Course %d enrollments failed: %s", course_id, exc)
                course_results["enrollments_error"] = str(exc)
                self._mark_step_completed()

            # Assignments (no incremental support in Canvas API)
            try:
                self._mark_step_started("assignments", course_id)
                count = await sync_assignments(canvas, db, course_id)
                course_results["assignments"] = count
                self._mark_step_completed()
                logger.info("  Course %d: %d assignments", course_id, count)
            except Exception as exc:
                logger.error("  Course %d assignments failed: %s", course_id, exc)
                course_results["assignments_error"] = str(exc)
                self._mark_step_completed()

            # Submissions
            try:
                self._mark_step_started("submissions", course_id)
                count = await sync_submissions(canvas, db, course_id, since=since)
                course_results["submissions"] = count
                self._mark_step_completed()
                logger.info("  Course %d: %d submissions", course_id, count)
            except Exception as exc:
                logger.error("  Course %d submissions failed: %s", course_id, exc)
                course_results["submissions_error"] = str(exc)
                self._mark_step_completed()

            # Compute metrics (DB-only, no API calls)
            try:
                self._mark_step_started("metrics", course_id)
                count = await compute_metrics(db, course_id)
                course_results["metrics"] = count
                self._mark_step_completed()
                logger.info("  Course %d: metrics computed for %d students", course_id, count)
            except Exception as exc:
                logger.error("  Course %d metrics failed: %s", course_id, exc)
                course_results["metrics_error"] = str(exc)
                self._mark_step_completed()


            # EdStem lesson progress (optional — only runs if token is configured)
            if settings.edstem_configured:
                try:
                    self._mark_step_started("edstem_lessons", course_id)
                    async with EdStemClient(settings.edstem_api_url, settings.edstem_api_token) as edstem:
                        count = await sync_edstem_lessons(edstem, db, course_id)
                        course_results["edstem_lessons"] = count
                        self._mark_step_completed()
                        if count:
                            logger.info("  Course %d: %d edstem progress records", course_id, count)
                except Exception as exc:
                    logger.error("  Course %d edstem failed: %s", course_id, exc)
                    course_results["edstem_error"] = str(exc)
                    self._mark_step_completed()


            # Stamp synced_at now that all data for this course is complete
            await db.execute(
                text("UPDATE courses SET synced_at = NOW() WHERE id = :id"),
                {"id": course_id},
            )
            await db.commit()
            self._mark_course_complete(course_id)

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
        self._begin_progress("full", started_at, total_courses=0, includes_edstem=settings.edstem_configured)

        try:
            async with CanvasClient(settings.canvas_api_url, settings.canvas_api_token) as canvas:
                async with AsyncSessionLocal() as db:
                    whitelist = await get_effective_whitelist(db)
                self._begin_progress("full", started_at, total_courses=len(whitelist), includes_edstem=settings.edstem_configured)

                if not whitelist:
                    logger.info("Whitelist is empty — nothing to sync")
                    results["courses"] = {"status": "ok", "records": 0}
                    results["skipped"] = "No courses in whitelist"
                else:
                    self._mark_step_started("courses")
                    course_ids, sync_results = await self._sync_courses(canvas, whitelist)
                    results.update(sync_results)
                    self._set_course_plan(course_ids)
                    self._mark_step_completed()

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

        self._reset_progress()

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
        self._begin_progress("incremental", started_at, total_courses=0, includes_edstem=settings.edstem_configured)

        try:
            async with CanvasClient(settings.canvas_api_url, settings.canvas_api_token) as canvas:
                async with AsyncSessionLocal() as db:
                    whitelist = await get_effective_whitelist(db)
                self._begin_progress("incremental", started_at, total_courses=len(whitelist), includes_edstem=settings.edstem_configured)

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
                    self._set_course_plan(course_ids)
                    self._mark_step_started("courses")
                    self._mark_step_completed()

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

        self._reset_progress()

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
