"""
Teams CSV Parser — ported from teams-attendance-tracker TypeScript implementation.

Parses Microsoft Teams attendance report CSVs (native multi-section TSV format
and flat CSV fallback) and imports meetings + attendance records into the database.
"""
import re
import logging
from dataclasses import dataclass, field
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.meeting import Meeting
from app.models.attendance_record import AttendanceRecord
from app.models.user import User
from app.models.course import Course

logger = logging.getLogger(__name__)

CLASS_CODE_RE = re.compile(r"\b(\d{1,2}[A-Z]{2,}\d?)\b")

SLASH_DATE_RE = re.compile(
    r"^(\d{1,2})/(\d{1,2})/(\d{2,4})[,\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$",
    re.IGNORECASE,
)

HMS_RE = re.compile(r"(?:(\d+)h)?\s*(?:(\d+)m)?\s*(?:(\d+)s)?")

LATE_THRESHOLD_MINUTES = 10
PARTIAL_THRESHOLD_MINUTES = 30


@dataclass
class ParsedMeetingInfo:
    meeting_id: str
    title: str
    start_time: datetime
    end_time: datetime


@dataclass
class ParsedParticipant:
    full_name: str
    first_join: datetime
    last_leave: datetime
    duration_minutes: int
    email: str
    role: str


@dataclass
class CSVImportResult:
    success: bool = False
    meeting_title: str = ""
    meetings_created: int = 0
    students_matched: int = 0
    attendance_records_created: int = 0
    skipped: int = 0
    errors: list[str] = field(default_factory=list)
    file_name: str = ""


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

async def parse_and_import(
    db: AsyncSession, file_content: str, file_name: str
) -> CSVImportResult:
    """Parse a Teams attendance CSV and persist meetings + attendance records."""
    result = CSVImportResult(file_name=file_name)

    try:
        is_teams = _is_teams_native_format(file_content)

        if is_teams:
            logger.info("Parsing Teams native format: %s", file_name)
            meeting_info = _parse_summary_section(file_content, file_name)
            participants = _parse_participants_section(file_content)
        else:
            logger.info("Parsing flat CSV format: %s", file_name)
            meeting_info, participants = _parse_flat_csv(file_content, file_name)

        result.meeting_title = meeting_info.title

        if not participants:
            result.errors.append("No participant data found in file")
            return result

        # Extract class code from meeting title
        class_code = extract_class_code(meeting_info.title)
        if class_code:
            logger.info('Extracted class code "%s" from "%s"', class_code, meeting_info.title)

        # Match class code to a course
        course_id = None
        if class_code:
            course_id = await _match_course(db, class_code)

        # Upsert meeting
        meeting = await _upsert_meeting(db, meeting_info, class_code, course_id)
        if meeting.id is None:
            await db.flush()
        result.meetings_created = 1

        # Process participants
        for p in participants:
            try:
                if not p.email or not p.email.strip():
                    result.skipped += 1
                    continue

                # Find user by email in existing Canvas users table
                user = await _find_user_by_email(db, p.email)
                if not user:
                    result.skipped += 1
                    continue

                result.students_matched += 1
                status = _determine_status(
                    p.first_join, meeting_info.start_time, p.duration_minutes
                )

                created = await _upsert_attendance(
                    db, meeting.id, user.id, p, status
                )
                if created:
                    result.attendance_records_created += 1
                else:
                    result.skipped += 1

            except Exception as e:
                result.errors.append(f"Error processing {p.full_name}: {e}")
                logger.error("Error processing participant %s: %s", p.full_name, e)

        await db.commit()
        result.success = True
        logger.info(
            'Import complete for "%s": %d records, %d skipped',
            meeting_info.title,
            result.attendance_records_created,
            result.skipped,
        )
    except Exception as e:
        await db.rollback()
        result.errors.append(f"Parse error: {e}")
        logger.error("Failed to parse Teams CSV %s: %s", file_name, e)

    return result


# ---------------------------------------------------------------------------
# Format detection
# ---------------------------------------------------------------------------

def _is_teams_native_format(content: str) -> bool:
    return (
        "1. Summary" in content
        or "2. Participants" in content
        or "Meeting Title\t" in content
    )


# ---------------------------------------------------------------------------
# Summary section parsing
# ---------------------------------------------------------------------------

def _parse_summary_section(content: str, file_name: str) -> ParsedMeetingInfo:
    lines = content.splitlines()

    title = ""
    start_time_str = ""
    end_time_str = ""
    meeting_id = ""

    in_summary = False
    for line in lines:
        if re.match(r"^1\.\s*Summary", line, re.IGNORECASE) or re.match(
            r"^Summary$", line, re.IGNORECASE
        ):
            in_summary = True
            continue
        if re.match(r"^2\.\s*Participants", line, re.IGNORECASE) or re.match(
            r"^Participants$", line, re.IGNORECASE
        ):
            break

        if in_summary and line.strip():
            parts = line.split("\t")
            key = (parts[0] or "").strip().lower()
            value = (parts[1] if len(parts) > 1 else "").strip()

            if key in ("meeting title", "title"):
                title = value
            elif key == "start time":
                start_time_str = value
            elif key == "end time":
                end_time_str = value
            elif key in ("meeting id", "id"):
                meeting_id = value

    if not meeting_id:
        raw = f"teams_{title}_{start_time_str}"
        meeting_id = re.sub(r"[^a-zA-Z0-9]", "_", raw)[:100]

    if not title:
        title = (
            re.sub(r"meetingAttendanceReport", "", file_name.removesuffix(".csv"), flags=re.IGNORECASE).strip()
            or "Unknown Meeting"
        )

    parsed_start = parse_teams_datetime(start_time_str)
    parsed_end = parse_teams_datetime(end_time_str)

    if not parsed_start or not parsed_end:
        raise ValueError(
            f'Could not parse meeting times: start="{start_time_str}", end="{end_time_str}"'
        )

    return ParsedMeetingInfo(
        meeting_id=meeting_id,
        title=title,
        start_time=parsed_start,
        end_time=parsed_end,
    )


# ---------------------------------------------------------------------------
# Participants section parsing
# ---------------------------------------------------------------------------

def _parse_participants_section(content: str) -> list[ParsedParticipant]:
    lines = content.splitlines()
    participants: list[ParsedParticipant] = []

    in_participants = False
    header_parsed = False
    column_map: dict[str, int] = {}

    for line in lines:
        if re.match(r"^2\.\s*Participants", line, re.IGNORECASE) or re.match(
            r"^Participants$", line, re.IGNORECASE
        ):
            in_participants = True
            continue

        if in_participants and re.match(r"^\d+\.\s+", line):
            break

        if not in_participants or not line.strip():
            continue

        columns = line.split("\t")

        if not header_parsed:
            column_map = _build_column_map(columns)
            header_parsed = True
            continue

        p = _parse_participant_row(columns, column_map)
        if p:
            participants.append(p)

    return participants


def _build_column_map(headers: list[str]) -> dict[str, int]:
    cmap: dict[str, int] = {}
    for i, h in enumerate(headers):
        n = h.strip().lower()
        if "full name" in n or n == "name" or "participant" in n:
            cmap["name"] = i
        elif "first join" in n or "join time" in n:
            cmap["firstJoin"] = i
        elif "last leave" in n or "leave time" in n:
            cmap["lastLeave"] = i
        elif "duration" in n or "in-meeting duration" in n:
            cmap["duration"] = i
        elif "email" in n or "upn" in n:
            cmap["email"] = i
        elif "role" in n:
            cmap["role"] = i
        elif "participant id" in n:
            if "email" not in cmap:
                cmap["email"] = i
    return cmap


def _parse_participant_row(
    columns: list[str], cmap: dict[str, int]
) -> ParsedParticipant | None:
    try:
        name = _col(columns, cmap, "name")
        first_join_str = _col(columns, cmap, "firstJoin")
        last_leave_str = _col(columns, cmap, "lastLeave") or first_join_str
        duration_str = _col(columns, cmap, "duration") or ""
        email = _col(columns, cmap, "email") or ""
        role = _col(columns, cmap, "role") or "Attendee"

        if not name or not first_join_str:
            return None

        first_join = parse_teams_datetime(first_join_str)
        last_leave = parse_teams_datetime(last_leave_str or first_join_str)
        duration_minutes = parse_duration(duration_str)

        if not first_join or not last_leave:
            return None

        return ParsedParticipant(
            full_name=name,
            first_join=first_join,
            last_leave=last_leave,
            duration_minutes=duration_minutes,
            email=email,
            role=role,
        )
    except Exception:
        return None


def _col(columns: list[str], cmap: dict[str, int], key: str) -> str | None:
    idx = cmap.get(key)
    if idx is None or idx >= len(columns):
        return None
    return columns[idx].strip() or None


# ---------------------------------------------------------------------------
# Flat CSV fallback
# ---------------------------------------------------------------------------

def _parse_flat_csv(
    content: str, file_name: str
) -> tuple[ParsedMeetingInfo, list[ParsedParticipant]]:
    lines = [l for l in content.splitlines() if l.strip()]
    if len(lines) < 2:
        raise ValueError("CSV file is empty or has no data rows")

    sep = "\t" if "\t" in lines[0] else ","
    headers = [h.strip().lower() for h in lines[0].split(sep)]

    col: dict[str, int] = {}
    for i, h in enumerate(headers):
        if "name" in h or "participant" in h:
            col["name"] = i
        if "join" in h and "leave" not in h:
            col["firstJoin"] = i
        if "leave" in h:
            col["lastLeave"] = i
        if "duration" in h:
            col["duration"] = i
        if "email" in h or "upn" in h:
            col["email"] = i
        if "role" in h:
            col["role"] = i
        if "meeting" in h and "title" in h:
            col["meetingTitle"] = i
        if "meeting" in h and "start" in h:
            col["meetingStart"] = i
        if "meeting" in h and "end" in h:
            col["meetingEnd"] = i
        if "meeting" in h and "id" in h:
            col["meetingId"] = i

    participants: list[ParsedParticipant] = []
    meeting_title = file_name.removesuffix(".csv")
    meeting_start: datetime | None = None
    meeting_end: datetime | None = None
    meeting_id = ""

    for idx, line in enumerate(lines[1:], start=1):
        cols = [c.strip() for c in line.split(sep)]
        if len(cols) < 2:
            continue

        if idx == 1:
            if "meetingTitle" in col:
                meeting_title = cols[col["meetingTitle"]] or meeting_title
            if "meetingStart" in col:
                meeting_start = parse_teams_datetime(cols[col["meetingStart"]])
            if "meetingEnd" in col:
                meeting_end = parse_teams_datetime(cols[col["meetingEnd"]])
            if "meetingId" in col:
                meeting_id = cols[col["meetingId"]] or ""

        name = cols[col["name"]] if "name" in col and col["name"] < len(cols) else None
        join_str = cols[col["firstJoin"]] if "firstJoin" in col and col["firstJoin"] < len(cols) else None
        if not name or not join_str:
            continue

        first_join = parse_teams_datetime(join_str)
        last_leave = (
            parse_teams_datetime(cols[col["lastLeave"]])
            if "lastLeave" in col and col["lastLeave"] < len(cols)
            else first_join
        )
        dur_str = cols[col["duration"]] if "duration" in col and col["duration"] < len(cols) else ""
        email = cols[col["email"]] if "email" in col and col["email"] < len(cols) else ""
        role = cols[col["role"]] if "role" in col and col["role"] < len(cols) else "Attendee"

        if not first_join or not last_leave:
            continue

        dur = (
            parse_duration(dur_str)
            if dur_str
            else round((last_leave.timestamp() - first_join.timestamp()) / 60)
        )
        participants.append(
            ParsedParticipant(name, first_join, last_leave, dur, email, role)
        )

    if not meeting_start and participants:
        meeting_start = min(p.first_join for p in participants)
    if not meeting_end and participants:
        meeting_end = max(p.last_leave for p in participants)

    if not meeting_id:
        raw = f"teams_{meeting_title}_{meeting_start.isoformat() if meeting_start else ''}"
        meeting_id = re.sub(r"[^a-zA-Z0-9]", "_", raw)[:100]

    return (
        ParsedMeetingInfo(
            meeting_id=meeting_id,
            title=meeting_title,
            start_time=meeting_start or datetime.utcnow(),
            end_time=meeting_end or datetime.utcnow(),
        ),
        participants,
    )


# ---------------------------------------------------------------------------
# Date/time + duration helpers
# ---------------------------------------------------------------------------

def parse_teams_datetime(date_str: str | None) -> datetime | None:
    """Parse Teams datetime strings across multiple locale formats."""
    if not date_str or not date_str.strip():
        return None

    trimmed = date_str.strip()

    # ISO format
    if "T" in trimmed:
        try:
            return datetime.fromisoformat(trimmed.replace("Z", "+00:00"))
        except ValueError:
            pass

    m = SLASH_DATE_RE.match(trimmed)
    if m:
        part1, part2, year_str, hours, minutes, seconds, ampm = m.groups()
        year = int(year_str)
        if year < 100:
            year += 2000

        p1, p2 = int(part1), int(part2)
        if p2 > 12:
            month, day = p1, p2
        elif p1 > 12:
            day, month = p1, p2
        else:
            day, month = p1, p2  # default Australian D/M/Y

        h = int(hours)
        if ampm and ampm.upper() == "PM" and h < 12:
            h += 12
        if ampm and ampm.upper() == "AM" and h == 12:
            h = 0

        return datetime(year, month, day, h, int(minutes), int(seconds or 0))

    # Last resort
    try:
        from dateutil.parser import parse as dateutil_parse
        return dateutil_parse(trimmed)
    except Exception:
        pass

    return None


def parse_duration(duration_str: str) -> int:
    """Parse Teams duration strings like '0h 48m 0s', '48', '2700'."""
    if not duration_str:
        return 0
    trimmed = duration_str.strip()

    hms = HMS_RE.match(trimmed)
    if hms and any(hms.groups()):
        hours = int(hms.group(1) or 0)
        minutes = int(hms.group(2) or 0)
        seconds = int(hms.group(3) or 0)
        return hours * 60 + minutes + round(seconds / 60)

    try:
        num = int(trimmed)
        return round(num / 60) if num > 300 else num
    except ValueError:
        return 0


def extract_class_code(title: str | None) -> str | None:
    """Extract class code (e.g. '11SENX', '12SENX2') from meeting title."""
    if not title:
        return None
    m = CLASS_CODE_RE.search(title)
    return m.group(1) if m else None


def decode_teams_file(raw_bytes: bytes) -> str:
    """Decode Teams CSV file handling UTF-16 LE/BE BOM encoding."""
    if raw_bytes[:2] in (b"\xff\xfe", b"\xfe\xff"):
        return raw_bytes.decode("utf-16")
    if raw_bytes[:3] == b"\xef\xbb\xbf":
        return raw_bytes[3:].decode("utf-8")
    return raw_bytes.decode("utf-8")


# ---------------------------------------------------------------------------
# Status determination
# ---------------------------------------------------------------------------

def _determine_status(
    join_time: datetime, meeting_start: datetime, duration_minutes: int | None
) -> str:
    diff = (join_time - meeting_start).total_seconds() / 60
    if diff > LATE_THRESHOLD_MINUTES:
        return "late"
    if duration_minutes is not None and duration_minutes < PARTIAL_THRESHOLD_MINUTES:
        return "partial"
    return "present"


# ---------------------------------------------------------------------------
# DB helpers
# ---------------------------------------------------------------------------

async def _find_user_by_email(db: AsyncSession, email: str) -> User | None:
    email_lower = email.strip().lower()
    stmt = select(User).where(User.email.ilike(email_lower))
    row = await db.execute(stmt)
    return row.scalar_one_or_none()


async def _match_course(db: AsyncSession, class_code: str) -> int | None:
    """Match a class code to a course. Prefer exact code match, then most recent."""
    # Try exact match first (e.g. "11SENX" matches course_code "11SENX_2026")
    stmt = (
        select(Course.id)
        .where(Course.course_code.ilike(f"{class_code}_%"))
        .order_by(Course.id.desc())
        .limit(1)
    )
    row = await db.execute(stmt)
    result = row.scalar_one_or_none()
    if result:
        return result
    # Fallback: broader prefix match
    stmt = (
        select(Course.id)
        .where(Course.course_code.ilike(f"{class_code}%"))
        .order_by(Course.id.desc())
        .limit(1)
    )
    row = await db.execute(stmt)
    return row.scalar_one_or_none()


async def _upsert_meeting(
    db: AsyncSession,
    info: ParsedMeetingInfo,
    class_code: str | None,
    course_id: int | None,
) -> Meeting:
    """Insert or update a meeting record."""
    existing = await db.execute(
        select(Meeting).where(Meeting.teams_meeting_id == info.meeting_id)
    )
    meeting = existing.scalar_one_or_none()

    if meeting:
        if class_code and not meeting.class_code:
            meeting.class_code = class_code
        if course_id and not meeting.course_id:
            meeting.course_id = course_id
        return meeting

    meeting = Meeting(
        teams_meeting_id=info.meeting_id,
        title=info.title,
        start_time=info.start_time,
        end_time=info.end_time,
        class_code=class_code,
        course_id=course_id,
    )
    db.add(meeting)
    await db.flush()
    return meeting


async def _upsert_attendance(
    db: AsyncSession,
    meeting_id: int,
    user_id: int,
    p: ParsedParticipant,
    status: str,
) -> bool:
    """Insert attendance record, skip on conflict (duplicate)."""
    stmt = (
        pg_insert(AttendanceRecord)
        .values(
            meeting_id=meeting_id,
            user_id=user_id,
            join_time=p.first_join,
            leave_time=p.last_leave,
            duration_minutes=p.duration_minutes,
            status=status,
        )
        .on_conflict_do_nothing(constraint="uq_attendance_record")
    )
    result = await db.execute(stmt)
    return result.rowcount > 0
