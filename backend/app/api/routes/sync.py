from fastapi import APIRouter, BackgroundTasks, Depends
from sqlalchemy import text

from app.db import AsyncSessionLocal
from app.sync.engine import sync_engine
from app.api.deps import require_auth

router = APIRouter(prefix="/sync", tags=["sync"], dependencies=[Depends(require_auth)])


def _to_iso(value):
    if value is None:
        return None
    return value.isoformat() if hasattr(value, "isoformat") else str(value)


async def _run_sync():
    await sync_engine.full_sync()


@router.post("/trigger")
async def trigger_sync(background_tasks: BackgroundTasks):
    """Manually trigger a full Canvas data sync."""
    if sync_engine.is_running:
        return {"status": "already_running", "message": "A sync is already in progress"}

    background_tasks.add_task(_run_sync)

    return {"status": "started", "message": "Sync triggered"}


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
        "logs": logs,
    }
