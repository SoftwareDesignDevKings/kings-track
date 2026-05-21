"""Attendance API routes — meetings, CSV import, watcher controls."""
import logging
from fastapi import APIRouter, Depends, UploadFile, File, Query, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.api.deps import require_auth
from app.attendance import csv_parser, service
from app.attendance.watcher import attendance_watcher
from app.config import settings
from app.teams.client import MSGraphClient, GraphAPIError

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
    result = attendance_watcher.start(
        watch_folder=settings.watch_folder,
        processed_folder=settings.processed_folder,
    )
    return result


@router.post("/watcher/stop")
async def watcher_stop():
    return attendance_watcher.stop()


@router.post("/watcher/scan")
async def watcher_scan():
    if not attendance_watcher.running and not settings.watch_folder:
        raise HTTPException(status_code=400, detail="Watcher not configured")
    # Ensure watcher has folder set even if not running
    if not attendance_watcher._watch_folder:
        attendance_watcher._watch_folder = attendance_watcher._resolve_folder(settings.watch_folder)
        attendance_watcher._processed_folder = attendance_watcher._resolve_folder(settings.processed_folder)
    return await attendance_watcher.scan()


# ---------------------------------------------------------------------------
# Microsoft Teams Graph API
# ---------------------------------------------------------------------------

@router.get("/teams-test")
async def teams_test():
    """Test Microsoft Graph API connectivity and available permissions."""
    if not settings.teams_configured:
        return {"status": "not_configured", "message": "Set TEAMS_TENANT_ID, TEAMS_CLIENT_ID, TEAMS_CLIENT_SECRET"}

    result: dict = {"status": "ok", "checks": {}}

    try:
        async with MSGraphClient(
            settings.teams_tenant_id,
            settings.teams_client_id,
            settings.teams_client_secret,
        ) as graph:
            result["checks"]["token"] = "ok"

            # Test user listing
            try:
                data = await graph.get("/users", params={"$top": "5", "$select": "displayName,mail,userPrincipalName"})
                users = data.get("value", [])
                result["checks"]["user_list"] = {
                    "status": "ok",
                    "sample_count": len(users),
                    "users": [
                        {"name": u.get("displayName"), "email": u.get("mail") or u.get("userPrincipalName")}
                        for u in users[:5]
                    ],
                }
            except GraphAPIError as exc:
                result["checks"]["user_list"] = {"status": "error", "message": str(exc)}

            # Test organizer calendar access
            organizers = settings.teams_organizer_list
            if organizers:
                organizer = organizers[0]
                try:
                    from datetime import datetime, timedelta
                    now = datetime.utcnow()
                    start = (now - timedelta(days=30)).strftime("%Y-%m-%dT00:00:00Z")
                    end = now.strftime("%Y-%m-%dT23:59:59Z")
                    events = await graph.get_calendar_events(organizer, start, end)
                    online_events = [e for e in events if e.get("isOnlineMeeting")]
                    result["checks"]["calendar"] = {
                        "status": "ok",
                        "organizer": organizer,
                        "total_events": len(events),
                        "online_meetings": len(online_events),
                        "sample": [
                            {"subject": e.get("subject"), "start": e.get("start", {}).get("dateTime")}
                            for e in online_events[:5]
                        ],
                    }
                except GraphAPIError as exc:
                    result["checks"]["calendar"] = {"status": "error", "organizer": organizer, "message": str(exc)}
            else:
                result["checks"]["calendar"] = {"status": "skipped", "message": "No TEAMS_ORGANIZER_EMAILS configured"}

    except GraphAPIError as exc:
        result["status"] = "error"
        result["checks"]["token"] = {"status": "error", "message": str(exc)}

    return result


@router.post("/sync-teams")
async def sync_teams(
    days: int = Query(30, ge=1, le=365),
    db: AsyncSession = Depends(get_db),
):
    """Sync attendance data from Microsoft Teams via Graph API."""
    if not settings.teams_configured:
        raise HTTPException(status_code=400, detail="Teams Graph API not configured")

    if not settings.teams_organizer_list:
        raise HTTPException(status_code=400, detail="No TEAMS_ORGANIZER_EMAILS configured")

    from app.teams.sync import sync_teams_attendance
    return await sync_teams_attendance(db, days=days)
