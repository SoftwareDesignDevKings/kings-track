from fastapi import APIRouter
from sqlalchemy import text

from app.db import AsyncSessionLocal
from app.sync.engine import sync_engine

router = APIRouter(prefix="/sync", tags=["sync"])


@router.post("/trigger")
async def trigger_sync():
    """Manually trigger a full Canvas data sync."""
    if sync_engine.is_running:
        return {"status": "already_running", "message": "A sync is already in progress"}

    # Run sync in background so the request returns immediately
    import asyncio
    asyncio.create_task(sync_engine.full_sync())

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
            "started_at": row[4].isoformat() if row[4] else None,
            "completed_at": row[5].isoformat() if row[5] else None,
            "error_message": row[6],
        }
        for row in rows
    ]

    return {
        "is_running": sync_engine.is_running,
        "logs": logs,
    }
