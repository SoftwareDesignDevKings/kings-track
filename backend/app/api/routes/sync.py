import hmac

from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException
from sqlalchemy import text

from app.config import settings
from app.db import AsyncSessionLocal
from app.sync.engine import sync_engine
from app.api.deps import require_admin


def _to_iso(value):
    if value is None:
        return None
    return value.isoformat() if hasattr(value, "isoformat") else str(value)


async def _run_sync():
    await sync_engine.full_sync()


# ---------------------------------------------------------------------------
# Admin-only routes (manual sync control)
# ---------------------------------------------------------------------------

router = APIRouter(prefix="/sync", tags=["sync"], dependencies=[Depends(require_admin)])


@router.post("/trigger")
async def trigger_sync(background_tasks: BackgroundTasks):
    """Manually trigger a full Canvas data sync (admin only)."""
    if sync_engine.is_running:
        return {"status": "already_running", "message": "A sync is already in progress"}

    background_tasks.add_task(_run_sync)

    return {"status": "started", "message": "Sync triggered"}


@router.post("/force-unlock")
async def force_unlock_sync():
    """Force-release the sync lock if a previous sync died without cleaning up."""
    await sync_engine._release_lock()
    return {"status": "unlocked", "message": "Sync lock released"}


@router.get("/status")
async def sync_status():
    """Return the latest sync log entries."""
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            text("""
                SELECT entity_type, course_id, status, records_synced,
                       started_at, completed_at, error_message
                FROM sync_log
                ORDER BY id DESC
                LIMIT 20
            """)
        )
        rows = result.fetchall()

    logs = [
        {
            "entity_type": row[0],
            "course_id": row[1],
            "status": row[2],
            "records_synced": row[3],
            "started_at": _to_iso(row[4]),
            "completed_at": _to_iso(row[5]),
            "error_message": row[6],
        }
        for row in rows
    ]

    return {
        "is_running": sync_engine.is_running,
        "progress": sync_engine.progress,
        "logs": logs,
    }


# ---------------------------------------------------------------------------
# Cron-safe trigger (no user JWT required, uses CRON_SECRET)
# ---------------------------------------------------------------------------

cron_router = APIRouter(prefix="/sync", tags=["sync"])


@cron_router.get("/trigger")
async def sync_trigger(
    type: str = "incremental",
    x_cron_secret: str | None = Header(None),
):
    """Cron-safe sync trigger. Authenticates via CRON_SECRET header.

    On Vercel, called by Vercel Cron Jobs with the x-cron-secret header.
    On Azure/Docker, the background scheduler handles this automatically.
    In local dev (no CRON_SECRET set), the endpoint is open.
    """
    if settings.cron_secret:
        if not x_cron_secret or not hmac.compare_digest(x_cron_secret, settings.cron_secret):
            raise HTTPException(status_code=401, detail="Invalid or missing x-cron-secret header")

    if type == "full":
        return await sync_engine.full_sync()
    return await sync_engine.incremental_sync()
