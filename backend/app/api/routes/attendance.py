"""Attendance API routes — meetings, CSV import, watcher controls."""
import logging
from fastapi import APIRouter, Depends, UploadFile, File, Query, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.api.deps import require_auth
from app.attendance import csv_parser, service
from app.attendance.watcher import attendance_watcher
from app.config import settings

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/attendance",
    tags=["attendance"],
    dependencies=[Depends(require_auth)],
)


# ---------------------------------------------------------------------------
# Meetings
# ---------------------------------------------------------------------------

@router.get("/meetings")
async def list_meetings(
    class_code: str | None = None,
    course_id: int | None = None,
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
):
    return await service.get_meetings(db, class_code=class_code, course_id=course_id, limit=limit, offset=offset)


@router.get("/meetings/{meeting_id}")
async def get_meeting(meeting_id: int, db: AsyncSession = Depends(get_db)):
    result = await service.get_meeting_detail(db, meeting_id)
    if not result:
        raise HTTPException(status_code=404, detail="Meeting not found")
    return result


@router.get("/classes")
async def list_class_codes(db: AsyncSession = Depends(get_db)):
    return await service.get_class_codes(db)


@router.get("/stats")
async def dashboard_stats(db: AsyncSession = Depends(get_db)):
    return await service.get_dashboard_stats(db)


# ---------------------------------------------------------------------------
# CSV Import
# ---------------------------------------------------------------------------

@router.post("/import")
async def import_csv(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    if not file.filename or not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="Only CSV files are accepted")

    # Read and decode
    raw_bytes = await file.read()
    if len(raw_bytes) > 10 * 1024 * 1024:  # 10MB limit
        raise HTTPException(status_code=400, detail="File too large (max 10MB)")

    content = csv_parser.decode_teams_file(raw_bytes)
    result = await csv_parser.parse_and_import(db, content, file.filename)
    return result


# ---------------------------------------------------------------------------
# Folder Watcher
# ---------------------------------------------------------------------------

@router.get("/watcher/status")
async def watcher_status():
    return attendance_watcher.get_status()


@router.get("/watcher/history")
async def watcher_history(limit: int = Query(50, ge=1, le=200)):
    return attendance_watcher.get_history(limit)


@router.post("/watcher/start")
async def watcher_start():
    if not settings.watch_folder:
        raise HTTPException(status_code=400, detail="WATCH_FOLDER not configured")
    return attendance_watcher.start(
        watch_folder=settings.watch_folder,
        processed_folder=settings.processed_folder,
    )


@router.post("/watcher/stop")
async def watcher_stop():
    return attendance_watcher.stop()


@router.post("/watcher/scan")
async def watcher_scan():
    if not settings.watch_folder and not attendance_watcher.watch_folder:
        raise HTTPException(status_code=400, detail="Watcher not configured — set WATCH_FOLDER or start the watcher first")
    # Configure folders if the watcher hasn't been started yet
    if not attendance_watcher.watch_folder:
        attendance_watcher.configure(settings.watch_folder, settings.processed_folder)
    return await attendance_watcher.scan()
