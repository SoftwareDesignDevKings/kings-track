"""
Teams attendance sync — discovers meetings from organizer calendars
and upserts attendance data into meetings + attendance_records tables.
"""
import logging
import re
from datetime import datetime, timedelta, timezone

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.teams.client import MSGraphClient, GraphAPIError

logger = logging.getLogger(__name__)

# Regex to extract class codes like "11SENX", "12SENX2", "11SENE1" from meeting titles
CLASS_CODE_RE = re.compile(r"\b(\d{2}[A-Z]{3,}[A-Z0-9]*)\b")


def _extract_class_code(title: str) -> str | None:
    """Extract a class code from a meeting title."""
    if not title:
        return None
    match = CLASS_CODE_RE.search(title)
    return match.group(1) if match else None


def _parse_graph_dt(value: str | None) -> datetime | None:
    """Parse a Graph API datetime string to a timezone-aware datetime."""
    if not value:
        return None
    try:
        value = value.rstrip("Z").split(".")[0]
        return datetime.fromisoformat(value).replace(tzinfo=timezone.utc)
    except (ValueError, AttributeError):
        return None


def _determine_status(
    join_time: datetime | None,
    meeting_start: datetime | None,
    duration_minutes: int | None,
) -> str:
    """Determine attendance status based on join time and duration."""
    if not join_time or not meeting_start:
        return "present"

    late_threshold = settings.attendance_late_threshold_minutes
    partial_threshold = settings.attendance_partial_threshold_minutes

    minutes_late = (join_time - meeting_start).total_seconds() / 60

    if duration_minutes is not None and duration_minutes < partial_threshold:
        return "partial"
    if minutes_late > late_threshold:
        return "late"
    return "present"


async def sync_teams_attendance(db: AsyncSession, days: int = 30) -> dict:
    """
    Sync attendance data from Microsoft Teams via the Graph API.

    Flow:
    1. For each configured organizer email, get their calendar events
    2. Filter for online meetings (Teams meetings)
    3. For each meeting, look up the online meeting ID
    4. Fetch attendance reports and records
    5. Match attendees to Canvas users by email
    6. Upsert into meetings + attendance_records tables

    Returns a summary dict with counts and any errors.
    """
    if not settings.teams_configured:
        return {"status": "not_configured"}

    organizers = settings.teams_organizer_list
    if not organizers:
        return {"status": "error", "message": "No TEAMS_ORGANIZER_EMAILS configured"}

    now = datetime.now(timezone.utc)
    start_dt = (now - timedelta(days=days)).strftime("%Y-%m-%dT00:00:00Z")
    end_dt = now.strftime("%Y-%m-%dT23:59:59Z")

    # Build email → user_id map for all enrolled students
    result = await db.execute(
        text("SELECT LOWER(email), id FROM users WHERE email IS NOT NULL")
    )
    email_to_user_id: dict[str, int] = {row[0]: row[1] for row in result.fetchall()}

    summary: dict = {
        "status": "completed",
        "organizers_processed": 0,
        "events_found": 0,
        "online_meetings": 0,
        "meetings_synced": 0,
        "attendance_records": 0,
        "errors": [],
    }

    try:
        async with MSGraphClient(
            settings.teams_tenant_id,
            settings.teams_client_id,
            settings.teams_client_secret,
        ) as graph:
            for organizer_email in organizers:
                try:
                    org_result = await _sync_organizer(
                        graph, db, organizer_email, start_dt, end_dt, email_to_user_id,
                    )
                    summary["organizers_processed"] += 1
                    summary["events_found"] += org_result.get("events_found", 0)
                    summary["online_meetings"] += org_result.get("online_meetings", 0)
                    summary["meetings_synced"] += org_result.get("meetings_synced", 0)
                    summary["attendance_records"] += org_result.get("attendance_records", 0)
                except Exception as exc:
                    logger.error("Failed to sync organizer %s: %s", organizer_email, exc)
                    summary["errors"].append({"organizer": organizer_email, "error": str(exc)})

    except GraphAPIError as exc:
        summary["status"] = "error"
        summary["errors"].append({"message": str(exc)})

    if summary["errors"]:
        summary["status"] = "completed_with_errors"

    return summary


async def _sync_organizer(
    graph: MSGraphClient,
    db: AsyncSession,
    organizer_email: str,
    start_dt: str,
    end_dt: str,
    email_to_user_id: dict[str, int],
) -> dict:
    """Sync meetings and attendance for a single organizer."""
    result = {"events_found": 0, "online_meetings": 0, "meetings_synced": 0, "attendance_records": 0}

    # Get calendar events
    events = await graph.get_calendar_events(organizer_email, start_dt, end_dt)
    result["events_found"] = len(events)

    # Filter for online meetings
    online_events = [e for e in events if e.get("isOnlineMeeting")]
    result["online_meetings"] = len(online_events)

    logger.info(
        "Organizer %s: %d events, %d online meetings",
        organizer_email, len(events), len(online_events),
    )

    for event in online_events:
        try:
            records = await _sync_single_meeting(
                graph, db, organizer_email, event, email_to_user_id,
            )
            if records is not None:
                result["meetings_synced"] += 1
                result["attendance_records"] += records
        except Exception as exc:
            logger.warning("Failed to sync event '%s': %s", event.get("subject"), exc)

    return result


async def _sync_single_meeting(
    graph: MSGraphClient,
    db: AsyncSession,
    organizer_email: str,
    event: dict,
    email_to_user_id: dict[str, int],
) -> int | None:
    """Sync a single meeting and its attendance records. Returns record count or None if skipped."""
    title = event.get("subject", "")
    start_info = event.get("start", {})
    end_info = event.get("end", {})

    start_time = _parse_graph_dt(start_info.get("dateTime"))
    end_time = _parse_graph_dt(end_info.get("dateTime"))

    if not start_time or not end_time:
        return None

    # Use the event iCalUId as the unique meeting identifier
    teams_meeting_id = event.get("iCalUId") or event.get("id", "")
    if not teams_meeting_id:
        return None

    class_code = _extract_class_code(title)

    # Look up course_id from class_code
    course_id = None
    if class_code:
        row = await db.execute(
            text("SELECT id FROM courses WHERE course_code LIKE :pattern LIMIT 1"),
            {"pattern": f"%{class_code}%"},
        )
        course_row = row.fetchone()
        if course_row:
            course_id = course_row[0]

    # Upsert meeting
    await db.execute(
        text("""
            INSERT INTO meetings (teams_meeting_id, title, start_time, end_time, organizer_email, class_code, course_id)
            VALUES (:teams_meeting_id, :title, :start_time, :end_time, :organizer_email, :class_code, :course_id)
            ON CONFLICT (teams_meeting_id) DO UPDATE SET
                title = EXCLUDED.title,
                start_time = EXCLUDED.start_time,
                end_time = EXCLUDED.end_time,
                organizer_email = EXCLUDED.organizer_email,
                class_code = EXCLUDED.class_code,
                course_id = EXCLUDED.course_id
        """),
        {
            "teams_meeting_id": teams_meeting_id[:255],
            "title": title[:500] if title else None,
            "start_time": start_time,
            "end_time": end_time,
            "organizer_email": organizer_email,
            "class_code": class_code,
            "course_id": course_id,
        },
    )
    await db.commit()

    # Get the meeting's local ID
    row = await db.execute(
        text("SELECT id FROM meetings WHERE teams_meeting_id = :tid"),
        {"tid": teams_meeting_id[:255]},
    )
    meeting_row = row.fetchone()
    if not meeting_row:
        return None
    meeting_id = meeting_row[0]

    # Try to get attendance reports via Graph API
    join_url = event.get("onlineMeeting", {}).get("joinUrl")
    if not join_url:
        logger.debug("No joinUrl for event '%s' — skipping attendance records", title)
        return 0

    # Resolve the online meeting ID
    online_meeting = await graph.get_online_meeting_by_join_url(organizer_email, join_url)
    if not online_meeting:
        logger.debug("Could not resolve online meeting for '%s'", title)
        return 0

    graph_meeting_id = online_meeting.get("id")
    if not graph_meeting_id:
        return 0

    # Get attendance reports
    reports = await graph.get_attendance_reports(organizer_email, graph_meeting_id)
    if not reports:
        return 0

    record_count = 0
    for report in reports:
        report_id = report.get("id")
        if not report_id:
            continue

        records = await graph.get_attendance_records(organizer_email, graph_meeting_id, report_id)

        for record in records:
            email = (record.get("emailAddress") or "").lower()
            if not email:
                continue

            user_id = email_to_user_id.get(email)
            if not user_id:
                continue

            # Skip organizers/presenters — only track attendees (students)
            role = record.get("role", "")
            if role in ("Organizer", "Presenter"):
                continue

            total_seconds = record.get("totalAttendanceInSeconds", 0)
            duration_minutes = total_seconds // 60 if total_seconds else None

            # Use the first attendance interval for join/leave times
            intervals = record.get("attendanceIntervals", [])
            if intervals:
                first_join = _parse_graph_dt(intervals[0].get("joinDateTime"))
                last_leave = _parse_graph_dt(intervals[-1].get("leaveDateTime"))
            else:
                first_join = start_time
                last_leave = end_time

            status = _determine_status(first_join, start_time, duration_minutes)

            await db.execute(
                text("""
                    INSERT INTO attendance_records
                        (meeting_id, user_id, join_time, leave_time, duration_minutes, status)
                    VALUES
                        (:meeting_id, :user_id, :join_time, :leave_time, :duration_minutes, :status)
                    ON CONFLICT ON CONSTRAINT uq_attendance_record DO UPDATE SET
                        leave_time = EXCLUDED.leave_time,
                        duration_minutes = EXCLUDED.duration_minutes,
                        status = EXCLUDED.status
                """),
                {
                    "meeting_id": meeting_id,
                    "user_id": user_id,
                    "join_time": first_join or start_time,
                    "leave_time": last_leave,
                    "duration_minutes": duration_minutes,
                    "status": status,
                },
            )
            record_count += 1

    await db.commit()
    if record_count:
        logger.info("  Meeting '%s': %d attendance records", title, record_count)

    return record_count
