from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone

from app.config import settings
from app.reminders.schedule import list_due_windows
from app.reminders.service import ReminderService

logger = logging.getLogger(__name__)


class ReminderEngine:
    def __init__(self):
        self._task: asyncio.Task | None = None
        self._last_checked_at: datetime | None = None
        self._service = ReminderService()

    async def preview(self, reference_time: datetime | None = None) -> dict:
        return await self._service.preview(reference_time=reference_time)

    async def run_for_reference(self, reference_time: datetime | None = None, triggered_by: str = "manual") -> dict:
        return await self._service.run_for_reference(reference_time=reference_time, triggered_by=triggered_by)

    async def list_runs(self, limit: int = 20) -> list[dict]:
        return await self._service.list_runs(limit=limit)

    def start_scheduler(self, interval_seconds: int = 60):
        async def _loop():
            logger.info("Reminder scheduler started — polling every %ds", interval_seconds)
            while True:
                now = datetime.now(timezone.utc)
                try:
                    last_scheduled_for = await self._service.get_latest_scheduled_for()
                    baseline = self._last_checked_at or last_scheduled_for or (now - timedelta(seconds=interval_seconds))
                    windows = list_due_windows(baseline, now, settings.reminder_timezone)
                    for scheduled_for in windows:
                        logger.info("Running reminder window scheduled_for=%s", scheduled_for.isoformat())
                        await self._service.run_scheduled_window(scheduled_for, triggered_by="scheduler")
                except Exception as exc:
                    logger.exception("Reminder scheduler failed: %s", exc)
                finally:
                    self._last_checked_at = now

                await asyncio.sleep(interval_seconds)

        self._task = asyncio.create_task(_loop())
        return self._task

    def stop_scheduler(self):
        if self._task:
            self._task.cancel()
            self._task = None


reminder_engine = ReminderEngine()
