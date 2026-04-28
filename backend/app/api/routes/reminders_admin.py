from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from app.api.deps import require_admin
from app.reminders.engine import reminder_engine

router = APIRouter(prefix="/admin/reminders", tags=["reminders-admin"], dependencies=[Depends(require_admin)])


class ReminderRunIn(BaseModel):
    scheduled_for: datetime | None = None
    preview_only: bool = False


@router.post("/run")
async def trigger_reminder_run(
    body: ReminderRunIn,
    user: dict = Depends(require_admin),
):
    if body.preview_only:
        return await reminder_engine.preview(reference_time=body.scheduled_for)
    return await reminder_engine.run_for_reference(
        reference_time=body.scheduled_for,
        triggered_by=user["email"],
    )


@router.get("/runs")
async def list_reminder_runs(limit: int = Query(default=20, ge=1, le=100)):
    return await reminder_engine.list_runs(limit=limit)
