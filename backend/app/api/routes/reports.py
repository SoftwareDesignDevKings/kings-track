import csv
import io
import re
from datetime import date, datetime, timedelta

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from sqlalchemy import text

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import (
    SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer, HRFlowable,
)

from app.api.deps import require_auth
from app.config import settings
from app.db import get_db

router = APIRouter(
    prefix="/reports",
    tags=["reports"],
    dependencies=[Depends(require_auth)],
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _csv_response(rows: list[list[str]], headers: list[str], filename: str) -> StreamingResponse:
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(headers)
    writer.writerows(rows)
    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def _fmt_pct(value) -> str:
    """Format a 0-1 decimal as a percentage string (e.g. 0.73 -> '73%')."""
    if value is None:
        return ""
    return f"{round(value * 100)}%"


def _fmt_score(value) -> str:
    """Format a score already in the 0-100 range."""
    if value is None:
        return ""
    return f"{round(value)}%"


async def _get_course_code(db: AsyncSession, course_id: int) -> str:
    """Fetch a sanitised course code for filenames, falling back to the ID."""
    result = await db.execute(
        text("SELECT course_code FROM courses WHERE id = :id"),
        {"id": course_id},
    )
    row = result.fetchone()
    if row and row[0]:
        return row[0].replace(" ", "-")
    return str(course_id)


# ---------------------------------------------------------------------------
# 1. Student Progress Report
# ---------------------------------------------------------------------------

@router.get("/student-progress")
async def export_student_progress(db: AsyncSession = Depends(get_db)):
    """Export all students with aggregated metrics as CSV."""
    from app.attendance.service import get_all_students_with_stats

    students = await get_all_students_with_stats(db)

    headers = [
        "Name",
        "Email",
        "SIS ID",
        "Courses",
        "Avg Completion Rate (%)",
        "Avg On-Time Rate (%)",
        "Avg Score (%)",
        "Attendance Rate (%)",
        "Concern Level",
        "Concern Reasons",
    ]
    rows = []
    for s in students:
        concern = s.get("concern", {})
        rows.append([
            s["name"],
            s["email"],
            s.get("sis_id") or "",
            str(s["course_count"]),
            _fmt_pct(s.get("avg_completion_rate")),
            _fmt_pct(s.get("avg_on_time_rate")),
            _fmt_score(s.get("avg_score")),
            f"{s['attendance_rate']}%" if s.get("attendance_rate") is not None else "",
            concern.get("level", "none"),
            "; ".join(concern.get("reasons", [])),
        ])

    filename = f"student-progress-report-{date.today().isoformat()}.csv"
    return _csv_response(rows, headers, filename)


# ---------------------------------------------------------------------------
# 2. Course Class Report
# ---------------------------------------------------------------------------

@router.get("/courses/{course_id}/class-report")
async def export_course_class_report(course_id: int, db: AsyncSession = Depends(get_db)):
    """Export the activity completion matrix for a course as CSV."""
    from app.api.routes.courses import get_course_matrix

    matrix = await get_course_matrix(course_id, db)

    # Flatten all assignments in group order
    all_assignments = []
    for group in matrix["assignment_groups"]:
        for a in group["assignments"]:
            all_assignments.append(a)

    headers = ["Student", "Completion Rate (%)", "On-Time Rate (%)", "Current Score (%)"]
    for a in all_assignments:
        headers.append(a["name"])

    rows = []
    for student in matrix["students"]:
        metrics = student["metrics"]
        row = [
            student["name"],
            _fmt_pct(metrics.get("completion_rate")),
            _fmt_pct(metrics.get("on_time_rate")),
            _fmt_score(metrics.get("current_score")),
        ]
        for a in all_assignments:
            sub = student["submissions"].get(str(a["id"]))
            if sub and sub["score"] is not None:
                row.append(str(sub["score"]))
            elif sub:
                row.append(sub["status"])
            else:
                row.append("")
        rows.append(row)

    code = (matrix.get("course_code") or str(course_id)).replace(" ", "-")
    filename = f"course-{code}-class-report-{date.today().isoformat()}.csv"
    return _csv_response(rows, headers, filename)


# ---------------------------------------------------------------------------
# 3. Gradeo Topic Bands Report
# ---------------------------------------------------------------------------

@router.get("/courses/{course_id}/gradeo-report")
async def export_gradeo_report(course_id: int, db: AsyncSession = Depends(get_db)):
    """Export Gradeo topic band scores per student as CSV."""
    from app.api.routes.courses import get_gradeo_topic_bands

    data = await get_gradeo_topic_bands(course_id, db)

    if not data.get("mapped"):
        raise HTTPException(status_code=404, detail="No Gradeo data mapped for this course")

    topics = data.get("topics", [])
    students = data.get("students", [])

    headers = ["Student"]
    for t in topics:
        headers.append(t["name"])

    rows = []
    for student in students:
        row = [student["name"]]
        for t in topics:
            cell = student["topics"].get(t["name"])
            if cell:
                pct = round(cell["score_pct"] * 100)
                row.append(f"B{cell['predicted_band']} ({pct}%)")
            else:
                row.append("")
        rows.append(row)

    code = await _get_course_code(db, course_id)
    filename = f"course-{code}-gradeo-report-{date.today().isoformat()}.csv"
    return _csv_response(rows, headers, filename)


# ---------------------------------------------------------------------------
# 4. Class List
# ---------------------------------------------------------------------------

@router.get("/courses/{course_id}/class-list")
async def export_class_list(course_id: int, db: AsyncSession = Depends(get_db)):
    """Export the enrolled student roster for a course as CSV."""
    course_result = await db.execute(
        text("SELECT id, name, course_code FROM courses WHERE id = :id"),
        {"id": course_id},
    )
    course_row = course_result.fetchone()
    if not course_row:
        raise HTTPException(status_code=404, detail="Course not found")

    students_result = await db.execute(
        text("""
            SELECT u.name, u.sortable_name, u.email
            FROM enrollments e
            JOIN users u ON u.id = e.user_id
            WHERE e.course_id = :course_id AND e.role = 'StudentEnrollment'
            ORDER BY u.sortable_name IS NULL, u.sortable_name
        """),
        {"course_id": course_id},
    )

    headers = ["First Name", "Last Name", "Email"]
    rows = []
    for name, sortable_name, email in students_result.fetchall():
        if sortable_name and ", " in sortable_name:
            last, first = sortable_name.split(", ", 1)
        else:
            parts = (name or "").split(" ", 1)
            first = parts[0]
            last = parts[1] if len(parts) > 1 else ""
        rows.append([first, last, email or ""])

    code = (course_row[2] or str(course_id)).replace(" ", "-")
    filename = f"course-{code}-class-list-{date.today().isoformat()}.csv"
    return _csv_response(rows, headers, filename)


# ---------------------------------------------------------------------------
# 5. At-Risk Students Report
# ---------------------------------------------------------------------------

@router.get("/at-risk-students")
async def export_at_risk_students(db: AsyncSession = Depends(get_db)):
    """Export only students flagged as moderate or high concern."""
    from app.attendance.service import get_all_students_with_stats

    students = await get_all_students_with_stats(db)

    concern_students = [s for s in students if s.get("concern", {}).get("is_concern")]
    concern_students.sort(key=lambda s: (0 if s["concern"]["level"] == "high" else 1))

    headers = [
        "Name",
        "Email",
        "SIS ID",
        "Courses",
        "Avg Completion Rate (%)",
        "Avg On-Time Rate (%)",
        "Avg Score (%)",
        "Attendance Rate (%)",
        "Concern Level",
        "Concern Reasons",
    ]
    rows = []
    for s in concern_students:
        concern = s["concern"]
        rows.append([
            s["name"],
            s["email"],
            s.get("sis_id") or "",
            str(s["course_count"]),
            _fmt_pct(s.get("avg_completion_rate")),
            _fmt_pct(s.get("avg_on_time_rate")),
            _fmt_score(s.get("avg_score")),
            f"{s['attendance_rate']}%" if s.get("attendance_rate") is not None else "",
            concern.get("level", "none"),
            "; ".join(concern.get("reasons", [])),
        ])

    filename = f"at-risk-students-{date.today().isoformat()}.csv"
    return _csv_response(rows, headers, filename)


# ---------------------------------------------------------------------------
# 6. Attendance Summary Report
# ---------------------------------------------------------------------------

@router.get("/attendance-summary")
async def export_attendance_summary(db: AsyncSession = Depends(get_db)):
    """Export per-student attendance totals across all meetings."""
    from app.attendance.service import get_all_students_with_stats

    students = await get_all_students_with_stats(db)

    # Fetch per-student attendance breakdown (present/late/partial counts)
    att_result = await db.execute(
        text("""
            SELECT
                ar.user_id,
                COUNT(*) AS total,
                COUNT(*) FILTER (WHERE ar.status = 'present') AS present,
                COUNT(*) FILTER (WHERE ar.status = 'late') AS late,
                COUNT(*) FILTER (WHERE ar.status = 'partial') AS partial
            FROM attendance_records ar
            GROUP BY ar.user_id
        """)
    )
    att_map = {}
    for r in att_result.fetchall():
        attended = r.present + r.late
        att_map[r.user_id] = {
            "total": r.total,
            "present": r.present,
            "late": r.late,
            "partial": r.partial,
            "absent": r.total - attended - r.partial,
            "rate": round(attended / r.total * 100, 1) if r.total > 0 else None,
        }

    headers = [
        "Name",
        "Email",
        "SIS ID",
        "Total Meetings",
        "Present",
        "Late",
        "Partial",
        "Absent",
        "Attendance Rate (%)",
    ]
    rows = []
    for s in students:
        att = att_map.get(s["id"], {})
        rows.append([
            s["name"],
            s["email"],
            s.get("sis_id") or "",
            str(att.get("total", 0)),
            str(att.get("present", 0)),
            str(att.get("late", 0)),
            str(att.get("partial", 0)),
            str(att.get("absent", 0)),
            f"{att['rate']}%" if att.get("rate") is not None else "",
        ])

    filename = f"attendance-summary-{date.today().isoformat()}.csv"
    return _csv_response(rows, headers, filename)


# ---------------------------------------------------------------------------
# 7. Course Attendance Report
# ---------------------------------------------------------------------------

@router.get("/courses/{course_id}/attendance-report")
async def export_course_attendance(course_id: int, db: AsyncSession = Depends(get_db)):
    """Export per-student attendance for each meeting in a course."""
    # Get meetings for this course
    meetings_result = await db.execute(
        text("""
            SELECT id, title, start_time
            FROM meetings
            WHERE course_id = :course_id
            ORDER BY start_time
        """),
        {"course_id": course_id},
    )
    meetings = meetings_result.fetchall()

    # Get enrolled students
    students_result = await db.execute(
        text("""
            SELECT u.id, u.name
            FROM enrollments e
            JOIN users u ON u.id = e.user_id
            WHERE e.course_id = :course_id AND e.role = 'StudentEnrollment'
            ORDER BY u.sortable_name IS NULL, u.sortable_name
        """),
        {"course_id": course_id},
    )
    students = students_result.fetchall()

    if not meetings:
        code = await _get_course_code(db, course_id)
        filename = f"course-{code}-attendance-{date.today().isoformat()}.csv"
        return _csv_response([], ["Student", "Email", "Attendance Rate (%)"], filename)

    # Fetch all attendance records for these meetings
    meeting_ids = [m.id for m in meetings]
    att_result = await db.execute(
        text("""
            SELECT user_id, meeting_id, status
            FROM attendance_records
            WHERE meeting_id = ANY(:meeting_ids)
        """),
        {"meeting_ids": meeting_ids},
    )
    # Build lookup: {(user_id, meeting_id): status}
    att_lookup = {}
    for r in att_result.fetchall():
        att_lookup[(r.user_id, r.meeting_id)] = r.status

    # Build headers
    headers = ["Student", "Attendance Rate (%)"]
    for m in meetings:
        label = m.start_time.strftime("%d %b") if m.start_time else "?"
        title = m.title or ""
        headers.append(f"{label} - {title}" if title else label)

    rows = []
    for s in students:
        attended = 0
        statuses = []
        for m in meetings:
            status = att_lookup.get((s.id, m.id), "absent")
            statuses.append(status)
            if status in ("present", "late"):
                attended += 1
        rate = round(attended / len(meetings) * 100, 1)
        rows.append([s.name, f"{rate}%"] + statuses)

    code = await _get_course_code(db, course_id)
    filename = f"course-{code}-attendance-{date.today().isoformat()}.csv"
    return _csv_response(rows, headers, filename)


# ---------------------------------------------------------------------------
# 8. EdStem Progress Report
# ---------------------------------------------------------------------------

@router.get("/courses/{course_id}/edstem-report")
async def export_edstem_report(course_id: int, db: AsyncSession = Depends(get_db)):
    """Export EdStem lesson completion per student as CSV."""
    from app.api.routes.courses import get_edstem_matrix

    data = await get_edstem_matrix(course_id, db)

    if not data.get("mapped"):
        raise HTTPException(status_code=404, detail="No EdStem mapping for this course")

    # Build ordered list of lessons with display headers
    lessons: list[dict] = []
    for module in data.get("modules", []):
        for lesson in module["lessons"]:
            lessons.append({
                "id": str(lesson["id"]),
                "header": f"{module['name']} > {lesson['title']}",
            })

    headers = ["Student", "Completion Rate (%)"] + [l["header"] for l in lessons]

    rows = []
    for student in data.get("students", []):
        row = [
            student["name"],
            _fmt_pct(student.get("completion_rate")),
        ]
        progress = student.get("progress", {})
        for l in lessons:
            p = progress.get(l["id"])
            row.append(p["status"] if p else "not_started")
        rows.append(row)

    code = await _get_course_code(db, course_id)
    filename = f"course-{code}-edstem-report-{date.today().isoformat()}.csv"
    return _csv_response(rows, headers, filename)


# ---------------------------------------------------------------------------
# 9. Individual Student Report
# ---------------------------------------------------------------------------

@router.get("/students/{user_id}/report")
async def export_student_report(user_id: int, db: AsyncSession = Depends(get_db)):
    """Export a comprehensive single-student report as a multi-section CSV."""
    from app.attendance.service import get_student_profile

    profile = await get_student_profile(db, user_id)
    if not profile:
        raise HTTPException(status_code=404, detail="Student not found")

    output = io.StringIO()
    writer = csv.writer(output)
    student = profile["student"]

    # Section 1: Student Info
    writer.writerow(["Student Report"])
    writer.writerow(["Name", student["name"]])
    writer.writerow(["Email", student["email"]])
    writer.writerow(["SIS ID", student.get("sis_id") or ""])
    writer.writerow(["Report Date", date.today().isoformat()])
    writer.writerow([])

    # Section 2: Overview
    overview = profile["overview"]
    writer.writerow(["Overview"])
    writer.writerow(["Avg Completion", _fmt_pct(overview.get("avg_completion_rate"))])
    writer.writerow(["Avg On-Time", _fmt_pct(overview.get("avg_on_time_rate"))])
    writer.writerow(["Avg Score", _fmt_score(overview.get("avg_score"))])
    att_rate = overview.get("attendance_rate")
    writer.writerow(["Attendance Rate", f"{att_rate}%" if att_rate is not None else ""])
    writer.writerow([])

    # Section 3: Course Metrics
    writer.writerow(["Course Metrics"])
    writer.writerow(["Course", "Completion Rate (%)", "On-Time Rate (%)", "Score (%)", "Last Activity"])
    for c in profile["courses"]:
        writer.writerow([
            c["course_name"],
            _fmt_pct(c.get("completion_rate")),
            _fmt_pct(c.get("on_time_rate")),
            _fmt_score(c.get("current_score")),
            c.get("last_activity_at") or "",
        ])
    writer.writerow([])

    # Section 4: Submission Summary
    writer.writerow(["Submission Summary"])
    writer.writerow(["Course", "Total", "Submitted", "Graded", "Late", "Missing"])
    for c in profile["courses"]:
        stats = profile["submission_stats"].get(str(c["course_id"]), {})
        if stats:
            writer.writerow([
                c["course_name"],
                str(stats.get("total", 0)),
                str(stats.get("submitted", 0)),
                str(stats.get("graded", 0)),
                str(stats.get("late", 0)),
                str(stats.get("missing", 0)),
            ])
    writer.writerow([])

    # Section 5: Attendance Summary
    att = profile["attendance_summary"]
    writer.writerow(["Attendance Summary"])
    writer.writerow(["Total Meetings", "Present", "Late", "Partial", "Absent", "Attendance Rate (%)"])
    writer.writerow([
        str(att.get("total_meetings", 0)),
        str(att.get("present", 0)),
        str(att.get("late", 0)),
        str(att.get("partial", 0)),
        str(att.get("absent", 0)),
        f"{att['attendance_rate']}%" if att.get("attendance_rate") is not None else "",
    ])
    writer.writerow([])

    # Section 6: Recent Attendance
    if profile.get("recent_attendance"):
        writer.writerow(["Recent Attendance"])
        writer.writerow(["Date", "Meeting", "Class", "Duration (min)", "Status"])
        for r in profile["recent_attendance"]:
            writer.writerow([
                r.get("date") or "",
                r.get("meeting_title") or "",
                r.get("class_code") or "",
                str(r.get("duration_minutes") or ""),
                r.get("status") or "",
            ])
        writer.writerow([])

    # Section 7: Concern Status
    concern = profile["concern"]
    writer.writerow(["Concern Status"])
    writer.writerow(["Level", concern.get("level", "none")])
    reasons = concern.get("reasons", [])
    writer.writerow(["Reasons", "; ".join(reasons) if reasons else "None"])

    output.seek(0)
    name_slug = re.sub(r"[^a-z0-9]+", "-", student["name"].lower()).strip("-")
    filename = f"student-{name_slug}-report-{date.today().isoformat()}.csv"

    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ---------------------------------------------------------------------------
# Schedule-based divider helpers (for cycle update PDF red line)
# ---------------------------------------------------------------------------

def _parse_module_schedule(name: str):
    """Parse 'Cycle N (Term T: Weeks A-B) Topic' from a Canvas module name.

    Returns ``(cycle_num, term, start_week, end_week, topic)`` or ``None``.
    Handles the edge-case "Cycle N (Term X/Y)" (no week range) by returning
    ``None`` for the week fields.
    """
    m = re.match(
        r"Cycle\s+(\d+)\s+\(Term\s+(\d+):\s+Weeks?\s+(\d+)(?:-(\d+))?\)\s+(.+)",
        name,
    )
    if m:
        return (
            int(m.group(1)),
            int(m.group(2)),
            int(m.group(3)),
            int(m.group(4)) if m.group(4) else int(m.group(3)),
            m.group(5).strip(),
        )
    # "Cycle 13 (Term 2/3)" — no week range
    m2 = re.match(r"Cycle\s+(\d+)\s+\(Term\s+(\d+)", name)
    if m2:
        return (int(m2.group(1)), int(m2.group(2)), None, None, "")
    return None


def _parse_term_starts(config_str: str) -> dict[tuple[int, int], date]:
    """Parse ``'T4-2025:2025-10-13,T1-2026:2026-01-26,...'``
    into ``{(year, term): date}``."""
    result: dict[tuple[int, int], date] = {}
    if not config_str:
        return result
    for pair in config_str.split(","):
        pair = pair.strip()
        if ":" not in pair:
            continue
        key, val = pair.split(":", 1)
        m = re.match(r"T(\d+)-(\d{4})", key.strip())
        if m:
            try:
                result[(int(m.group(2)), int(m.group(1)))] = date.fromisoformat(
                    val.strip()
                )
            except ValueError:
                pass
    return result


def _current_term_week(
    term_starts: dict[tuple[int, int], date],
) -> tuple[int, int] | None:
    """Return ``(term_number, week_number)`` for today, or ``None``."""
    today = date.today()
    best: tuple[int, int] | None = None
    best_start: date | None = None
    for (_year, term), start_date in term_starts.items():
        if start_date <= today and (best_start is None or start_date > best_start):
            best_start = start_date
            best = (term, (today - start_date).days // 7 + 1)
    return best


async def _fetch_canvas_modules(course_id: int) -> list[dict] | None:
    """Fetch Canvas modules for a course.  Returns ``None`` on failure."""
    if not settings.canvas_api_url or not settings.canvas_api_token:
        return None
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(
                f"{settings.canvas_api_url}/api/v1/courses/{course_id}/modules",
                headers={"Authorization": f"Bearer {settings.canvas_api_token}"},
                params={"per_page": 50},
            )
            if resp.status_code != 200:
                return None
            return resp.json()
    except Exception:
        return None


def _parse_scheduled_cycles(
    modules: list[dict],
) -> list[tuple[int, int, int, int, str]]:
    """Return sorted list of ``(cycle, term, sw, ew, topic)`` from modules."""
    scheduled: list[tuple[int, int, int, int, str]] = []
    for mod in modules:
        parsed = _parse_module_schedule(mod["name"])
        if parsed and parsed[2] is not None:
            scheduled.append(parsed)
    scheduled.sort(key=lambda x: x[0])
    return scheduled


def _match_cycles_to_unit(
    unit_name: str,
    scheduled: list[tuple[int, int, int, int, str]],
) -> list[tuple[int, int, int, int, str]]:
    """Return the subset of *scheduled* cycles whose topic matches *unit_name*."""
    unit_topic_m = re.match(r"Unit\s+\d+[:\s\-]+(.+)", unit_name)
    if not unit_topic_m:
        return []
    unit_topics = [
        t.strip()
        for t in re.split(r"\s*[–\-,&]\s*", unit_topic_m.group(1))
        if t.strip()
    ]
    matched: list[tuple[int, int, int, int, str]] = []
    for entry in scheduled:
        _cn, _t, _sw, _ew, topic = entry
        for ut in unit_topics:
            if ut.lower() in topic.lower() or topic.lower() in ut.lower():
                matched.append(entry)
                break
    return matched


async def _compute_schedule_divider(
    course_id: int,
    unit_name: str,
    num_assignments: int,
) -> int | None:
    """Determine the red-line position from the Canvas module schedule.

    Uses the current term/week (from ``SCHOOL_TERM_STARTS``) to calculate how
    far through the unit's cycles the student should be.

    Returns the 1-based row index (row 0 = header, row 1 = first assignment)
    after which to draw the red line, or ``None`` when unable to determine.
    """
    term_starts = _parse_term_starts(settings.school_term_starts)
    if not term_starts:
        return None
    tw = _current_term_week(term_starts)
    if tw is None:
        return None
    current_term, current_week = tw

    modules = await _fetch_canvas_modules(course_id)
    if not modules:
        return None

    scheduled = _parse_scheduled_cycles(modules)
    if not scheduled:
        return None

    # Build term ordering (T4 before T1 when course starts in Term 4)
    term_order: dict[int, int] = {}
    for _, term, *_ in scheduled:
        if term not in term_order:
            term_order[term] = len(term_order)

    unit_cycles = _match_cycles_to_unit(unit_name, scheduled)
    if not unit_cycles:
        return None

    current_term_ord = term_order.get(current_term, 999)
    completed = sum(
        1
        for _, term, _, ew, _ in unit_cycles
        if (
            term_order.get(term, 999) < current_term_ord
            or (term_order.get(term, 999) == current_term_ord and ew < current_week)
        )
    )

    fraction = min(1.0, completed / len(unit_cycles))
    pos = round(fraction * num_assignments)
    return pos if pos > 0 else None


async def _compute_schedule_divider_for_cycle(
    course_id: int,
    assignments: list,
    target_cycle_num: int,
) -> int | None:
    """Position the red line after the last assignment due by the end of the
    target cycle's week range.

    Uses the cycle's term + end_week together with ``SCHOOL_TERM_STARTS``
    to compute a cutoff date, then finds the last assignment whose due date
    falls on or before that cutoff.
    """
    modules = await _fetch_canvas_modules(course_id)
    if not modules:
        return None

    scheduled = _parse_scheduled_cycles(modules)
    if not scheduled:
        return None

    # Find the target cycle's term & end_week
    target = next((s for s in scheduled if s[0] == target_cycle_num), None)
    if not target:
        return None
    _, term, _, ew, _ = target

    # Get the term start date from config
    term_starts = _parse_term_starts(settings.school_term_starts)
    if not term_starts:
        return None

    term_start_date = None
    for (_year, t), d in term_starts.items():
        if t == term:
            term_start_date = d
            break
    if not term_start_date:
        return None

    # End of cycle = end of day on the last day of end_week.
    # Week 1 starts on term_start_date (Monday).  End of week N is the
    # Sunday = term_start + N*7 - 1 days.
    cutoff_date = term_start_date + timedelta(weeks=ew) - timedelta(days=1)
    cutoff = datetime(
        cutoff_date.year, cutoff_date.month, cutoff_date.day, 23, 59, 59,
    )

    # Position after last assignment due on or before the cutoff
    pos = None
    for i, a in enumerate(assignments):
        if a.due_at:
            naive = a.due_at.replace(tzinfo=None) if a.due_at.tzinfo else a.due_at
            if naive <= cutoff:
                pos = i + 1
    return pos


# ---------------------------------------------------------------------------
# PDF Helpers
# ---------------------------------------------------------------------------

# Colour palette
_BRAND = colors.HexColor("#4f46e5")
_BRAND_LIGHT = colors.HexColor("#e0e7ff")
_GREEN = colors.HexColor("#059669")
_GREEN_LIGHT = colors.HexColor("#d1fae5")
_AMBER = colors.HexColor("#d97706")
_AMBER_LIGHT = colors.HexColor("#fef3c7")
_RED = colors.HexColor("#dc2626")
_RED_LIGHT = colors.HexColor("#fee2e2")
_SLATE_800 = colors.HexColor("#1e293b")
_SLATE_600 = colors.HexColor("#475569")
_SLATE_400 = colors.HexColor("#94a3b8")
_SLATE_200 = colors.HexColor("#e2e8f0")
_SLATE_50 = colors.HexColor("#f8fafc")
_WHITE = colors.white


def _pdf_styles():
    """Return a dict of reusable paragraph styles for PDF reports."""
    ss = getSampleStyleSheet()
    return {
        "title": ParagraphStyle(
            "PDFTitle", parent=ss["Heading1"],
            fontSize=18, textColor=_SLATE_800, spaceAfter=2,
        ),
        "subtitle": ParagraphStyle(
            "PDFSubtitle", parent=ss["Normal"],
            fontSize=10, textColor=_SLATE_600, spaceAfter=12,
        ),
        "section": ParagraphStyle(
            "PDFSection", parent=ss["Heading2"],
            fontSize=13, textColor=_BRAND, spaceBefore=16, spaceAfter=8,
        ),
        "body": ParagraphStyle(
            "PDFBody", parent=ss["Normal"],
            fontSize=9, textColor=_SLATE_800, leading=13,
        ),
        "body_small": ParagraphStyle(
            "PDFBodySmall", parent=ss["Normal"],
            fontSize=8, textColor=_SLATE_600, leading=11,
        ),
        "metric_value": ParagraphStyle(
            "PDFMetricVal", parent=ss["Normal"],
            fontSize=20, textColor=_SLATE_800, alignment=1,
        ),
        "metric_label": ParagraphStyle(
            "PDFMetricLabel", parent=ss["Normal"],
            fontSize=8, textColor=_SLATE_400, alignment=1,
        ),
        "cell": ParagraphStyle(
            "PDFCell", parent=ss["Normal"],
            fontSize=7.5, textColor=_SLATE_800, leading=10,
            wordWrap="CJK",
        ),
        "cell_header": ParagraphStyle(
            "PDFCellHeader", parent=ss["Normal"],
            fontSize=7.5, textColor=_WHITE, leading=10,
            fontName="Helvetica-Bold",
            wordWrap="CJK",
        ),
    }


def _p(text: str, styles: dict, header: bool = False) -> Paragraph:
    """Wrap a string in a Paragraph for table cells so text wraps properly."""
    from xml.sax.saxutils import escape
    style = styles["cell_header"] if header else styles["cell"]
    return Paragraph(escape(str(text)), style)


def _status_display(status: str) -> str:
    """Human-friendly status labels."""
    return {
        "graded": "Graded",
        "submitted": "Submitted",
        "missing": "Missing",
        "not_submitted": "Not Submitted",
        "upcoming": "Upcoming",
        "completed": "Completed",
        "viewed": "Viewed",
        "not_started": "Not Started",
    }.get(status, status.replace("_", " ").title())


def _base_table_style() -> list:
    """Common table style commands for all PDF tables."""
    return [
        ("BACKGROUND", (0, 0), (-1, 0), _BRAND),
        ("ALIGN", (0, 0), (-1, -1), "LEFT"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("BOTTOMPADDING", (0, 0), (-1, 0), 6),
        ("TOPPADDING", (0, 0), (-1, 0), 6),
        ("BOTTOMPADDING", (0, 1), (-1, -1), 4),
        ("TOPPADDING", (0, 1), (-1, -1), 4),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("GRID", (0, 0), (-1, -1), 0.5, _SLATE_200),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [_WHITE, _SLATE_50]),
    ]


def _build_pdf(elements: list, filename: str) -> StreamingResponse:
    """Render a list of platypus flowables into a PDF StreamingResponse."""
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=A4,
        leftMargin=15 * mm, rightMargin=15 * mm,
        topMargin=15 * mm, bottomMargin=15 * mm,
    )
    doc.build(elements)
    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def _metric_box(value: str, label: str, styles: dict) -> Table:
    """A small centred metric box (value on top, label below)."""
    t = Table(
        [[Paragraph(value, styles["metric_value"])],
         [Paragraph(label, styles["metric_label"])]],
        colWidths=[55 * mm],
    )
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), _SLATE_50),
        ("BOX", (0, 0), (-1, -1), 0.5, _SLATE_200),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    return t


_FAR_FUTURE = datetime(9999, 12, 31)


def _assignment_sort_key(a):
    """Sort by due date (items without a date go to the end), then by name."""
    has_due = a.due_at is not None
    due = (
        a.due_at.replace(tzinfo=None) if a.due_at and a.due_at.tzinfo
        else (a.due_at or _FAR_FUTURE)
    )
    return (not has_due, due, a.name)


# ---------------------------------------------------------------------------
# 10a. List available cycles for a course
# ---------------------------------------------------------------------------

@router.get("/courses/{course_id}/cycles")
async def list_course_cycles(
    course_id: int,
    db: AsyncSession = Depends(get_db),
):
    """Return the list of teaching cycles parsed from Canvas modules."""
    modules = await _fetch_canvas_modules(course_id)
    if not modules:
        return []

    scheduled = _parse_scheduled_cycles(modules)
    if not scheduled:
        return []

    # Fetch unit group names so we can match each cycle to its unit
    grp_result = await db.execute(
        text("""
            SELECT DISTINCT assignment_group_name
            FROM assignments
            WHERE course_id = :cid
              AND assignment_group_name IS NOT NULL
              AND LOWER(assignment_group_name) LIKE 'unit %%'
        """),
        {"cid": course_id},
    )
    unit_names = [r[0] for r in grp_result.fetchall()]

    result = []
    for cycle_num, term, sw, ew, topic in scheduled:
        matched_unit: str | None = None
        for uname in unit_names:
            um = re.match(r"Unit\s+\d+[:\s\-]+(.+)", uname)
            if not um:
                continue
            utopics = [
                t.strip()
                for t in re.split(r"\s*[–\-,&]\s*", um.group(1))
                if t.strip()
            ]
            for ut in utopics:
                if ut.lower() in topic.lower() or topic.lower() in ut.lower():
                    matched_unit = uname
                    break
            if matched_unit:
                break

        result.append({
            "cycle_num": cycle_num,
            "term": term,
            "start_week": sw,
            "end_week": ew,
            "topic": topic,
            "matched_unit": matched_unit,
        })

    return result


# ---------------------------------------------------------------------------
# 10b. Current Cycle Update PDF
# ---------------------------------------------------------------------------

@router.get("/students/{user_id}/cycle-update-pdf")
async def export_cycle_update_pdf(
    user_id: int,
    course_id: int = Query(..., description="Canvas course ID"),
    cycle_num: int | None = Query(None, description="Specific cycle number (omit for auto-detect)"),
    db: AsyncSession = Depends(get_db),
):
    """
    PDF report showing a student's progress in the current assignment-group
    cycle for a given course, plus any matched Gradeo quiz results.
    When *cycle_num* is provided the report targets that specific cycle;
    otherwise the first unit with incomplete work is auto-detected.
    """
    # ── Fetch student ──
    stu_result = await db.execute(
        text("SELECT id, name, email, sis_id FROM users WHERE id = :id"),
        {"id": user_id},
    )
    student = stu_result.fetchone()
    if not student:
        raise HTTPException(404, "Student not found")

    # ── Fetch course ──
    crs_result = await db.execute(
        text("SELECT id, name, course_code FROM courses WHERE id = :id"),
        {"id": course_id},
    )
    course = crs_result.fetchone()
    if not course:
        raise HTTPException(404, "Course not found")

    # ── Fetch assignments grouped by assignment_group ──
    asg_result = await db.execute(
        text("""
            SELECT a.id, a.name, a.assignment_group_name, a.assignment_group_position,
                   a.points_possible, a.due_at, a.position,
                   s.score, s.workflow_state, s.late, s.missing
            FROM assignments a
            LEFT JOIN submissions s ON s.assignment_id = a.id AND s.user_id = :uid
            WHERE a.course_id = :cid AND a.workflow_state = 'published'
            ORDER BY a.assignment_group_position NULLS LAST,
                     a.assignment_group_id NULLS LAST,
                     a.position NULLS LAST, a.due_at NULLS LAST
        """),
        {"uid": user_id, "cid": course_id},
    )
    rows = asg_result.fetchall()

    # Group by assignment_group_name, keeping only teaching-cycle groups
    # (those starting with "Unit "). Assessment tasks, classwork, homework,
    # archive, etc. are excluded — assessments will be in a separate report.
    all_groups: dict[str, list] = {}
    all_group_order: list[str] = []
    for r in rows:
        gname = r.assignment_group_name or "Ungrouped"
        if gname not in all_groups:
            all_groups[gname] = []
            all_group_order.append(gname)
        all_groups[gname].append(r)

    groups: dict[str, list] = {}
    group_order: list[str] = []
    for gname in all_group_order:
        if gname.lower().startswith("unit "):
            groups[gname] = all_groups[gname]
            group_order.append(gname)

    if not groups:
        raise HTTPException(404, "No teaching cycles (Unit groups) found for this course")

    # ── Detect current unit ──
    now = datetime.utcnow()
    cycle_label: str | None = None          # set when a specific cycle is chosen

    if cycle_num is not None:
        # Resolve the unit from the selected cycle's topic
        modules = await _fetch_canvas_modules(course_id)
        target_topic: str | None = None
        target_term: int | None = None
        target_sw: int | None = None
        target_ew: int | None = None
        if modules:
            for mod in modules:
                parsed = _parse_module_schedule(mod["name"])
                if parsed and parsed[0] == cycle_num:
                    target_topic = parsed[4]
                    target_term = parsed[1]
                    target_sw = parsed[2]
                    target_ew = parsed[3]
                    break

        best_group = group_order[-1]        # fallback
        if target_topic:
            for gname in group_order:
                um = re.match(r"Unit\s+\d+[:\s\-]+(.+)", gname)
                if not um:
                    continue
                utopics = [
                    t.strip()
                    for t in re.split(r"\s*[–\-,&]\s*", um.group(1))
                    if t.strip()
                ]
                if any(
                    ut.lower() in target_topic.lower()
                    or target_topic.lower() in ut.lower()
                    for ut in utopics
                ):
                    best_group = gname
                    break

        # Build a human-readable label for the PDF header
        if target_sw and target_ew:
            cycle_label = (
                f"Cycle {cycle_num} — Term {target_term}: "
                f"Weeks {target_sw}-{target_ew}"
            )
        else:
            cycle_label = f"Cycle {cycle_num}"
    else:
        # Auto-detect: first unit with incomplete work
        best_group = group_order[-1]
        for gname in group_order:
            done = sum(
                1 for r in groups[gname]
                if r.workflow_state in ("submitted", "graded")
            )
            if done < len(groups[gname]):
                best_group = gname
                break

    all_unit_assignments = sorted(groups[best_group], key=_assignment_sort_key)

    # Filter to only assignments due in the past 2 weeks
    two_weeks_ago = now.replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(days=14)
    end_of_today = now.replace(hour=23, minute=59, second=59, microsecond=999999)
    current_assignments = [
        a for a in all_unit_assignments
        if a.due_at is not None
        and two_weeks_ago <= (a.due_at.replace(tzinfo=None) if a.due_at.tzinfo else a.due_at) <= end_of_today
    ]

    # Compute cycle stats (based on filtered 2-week window)
    total = len(current_assignments)
    completed = sum(
        1 for a in current_assignments
        if a.workflow_state in ("submitted", "graded")
    )
    missing_count = sum(1 for a in current_assignments if a.missing)
    late_count = sum(1 for a in current_assignments if a.late)
    scores = [float(a.score) for a in current_assignments if a.score is not None]
    points = [float(a.points_possible) for a in current_assignments
              if a.points_possible and a.score is not None]
    avg_score_pct = (
        round(sum(scores) / sum(points) * 100) if points and sum(points) > 0 else None
    )

    # ── Fetch Gradeo results for this student + course ──
    gradeo_result = await db.execute(
        text("""
            SELECT gcea.exam_name, gcea.syllabus_title, gcea.topics,
                   gar.exam_mark, gar.marks_available, gar.class_average, gar.status
            FROM gradeo_assignment_results gar
            JOIN gradeo_class_exam_assignments gcea
                ON gcea.id = gar.gradeo_class_exam_assignment_id
            WHERE gar.user_id = :uid
              AND gar.canvas_course_id = :cid
            ORDER BY gcea.exam_name
        """),
        {"uid": user_id, "cid": course_id},
    )
    gradeo_exams = gradeo_result.fetchall()

    # Build lookup: cycle number → Gradeo exam result
    # Matches Canvas "Cycle N Spaced Repetition" to Gradeo exams containing "Cycle N"
    gradeo_by_cycle: dict[int, object] = {}
    for ge in gradeo_exams:
        m = re.search(r"Cycle\s+(\d+)", ge.exam_name, re.IGNORECASE)
        if m:
            gradeo_by_cycle[int(m.group(1))] = ge
    matched_gradeo_cycles: set[int] = set()

    # ── Build PDF ──
    styles = _pdf_styles()
    els: list = []

    # Header
    if cycle_label:
        els.append(Paragraph(f"{cycle_label} Update", styles["title"]))
    else:
        els.append(Paragraph("Current Cycle Update", styles["title"]))
    course_label = f"{course.course_code} — {course.name}" if course.course_code else course.name
    subtitle_parts = [
        student.name,
        course_label,
        date.today().strftime("%d %B %Y"),
    ]
    els.append(Paragraph(
        " &nbsp;|&nbsp; ".join(subtitle_parts),
        styles["subtitle"],
    ))
    els.append(HRFlowable(width="100%", thickness=1, color=_SLATE_200, spaceAfter=10))

    # Current unit heading
    els.append(Paragraph(f"Current Unit: {best_group}", styles["section"]))

    # Metrics row
    comp_pct = f"{round(completed / total * 100)}%" if total else "—"
    metrics = Table(
        [[
            _metric_box(f"{completed}/{total}", "Completed", styles),
            _metric_box(comp_pct, "Completion", styles),
            _metric_box(str(missing_count), "Missing", styles),
            _metric_box(f"{avg_score_pct}%" if avg_score_pct is not None else "—", "Avg Score", styles),
        ]],
        hAlign="LEFT",
    )
    metrics.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP")]))
    els.append(metrics)
    els.append(Spacer(1, 10))

    # Assignments table
    P = lambda t: _p(t, styles)
    PH = lambda t: _p(t, styles, header=True)
    has_gradeo = bool(gradeo_by_cycle)
    headers = [PH("Canvas Quiz"), PH("Due Date"), PH("Status"), PH("Score"), PH("Late")]
    if has_gradeo:
        headers.append(PH("Gradeo"))
    table_data = [headers]
    style_cmds = list(_base_table_style())

    # Determine "should be up to" boundary.
    # Always use today's date: the red line goes after the last assignment
    # whose due date is before the start of tomorrow.
    divider_row: int | None = None
    start_of_tomorrow = now.replace(
        hour=0, minute=0, second=0, microsecond=0
    ) + timedelta(days=1)
    has_due_dates = any(a.due_at for a in current_assignments)
    if has_due_dates:
        for i, a in enumerate(current_assignments):
            if a.due_at:
                naive = (
                    a.due_at.replace(tzinfo=None)
                    if a.due_at.tzinfo
                    else a.due_at
                )
                if naive < start_of_tomorrow:
                    divider_row = i + 1
    else:
        for i, a in enumerate(current_assignments):
                if a.workflow_state in ("submitted", "graded"):
                    divider_row = i + 1

    for i, a in enumerate(current_assignments, start=1):
        ws = a.workflow_state or ""
        if ws == "graded":
            status = "Graded"
        elif ws == "submitted":
            status = "Submitted"
        elif a.missing:
            status = "Missing"
        elif a.due_at and a.due_at.replace(tzinfo=None) <= now:
            status = "Not Submitted"
        else:
            status = "Upcoming"

        due_str = a.due_at.strftime("%d %b %Y") if a.due_at else "—"
        if a.score is not None:
            s = round(a.score, 1)
            pp = int(a.points_possible) if a.points_possible == int(a.points_possible) else round(a.points_possible, 1)
            score_str = f"{s}/{pp}"
        else:
            score_str = "—"
        late_str = "Yes" if a.late else ""

        row = [P(a.name), P(due_str), P(status), P(score_str), P(late_str)]

        # Match Gradeo results to "Cycle N" assignments
        if has_gradeo:
            cycle_m = re.match(r"Cycle\s+(\d+)", a.name, re.IGNORECASE)
            if cycle_m:
                cn = int(cycle_m.group(1))
                ge = gradeo_by_cycle.get(cn)
                if ge and ge.exam_mark is not None:
                    matched_gradeo_cycles.add(cn)
                    row.append(P(f"{ge.exam_mark}/{ge.marks_available}"))
                else:
                    row.append(P("—"))
            else:
                row.append(P(""))

        table_data.append(row)

        # Row colour coding
        if status == "Missing":
            style_cmds.append(("BACKGROUND", (0, i), (-1, i), _RED_LIGHT))
        elif a.late:
            style_cmds.append(("BACKGROUND", (0, i), (-1, i), _AMBER_LIGHT))
        elif status == "Graded":
            style_cmds.append(("BACKGROUND", (0, i), (-1, i), _GREEN_LIGHT))

    # "Should be up to" red divider line — only shown when the table
    # includes future items (i.e. the line isn't at the very bottom).
    # When the report only covers past-due items the line is redundant.
    if (divider_row is not None
            and 0 < divider_row < len(table_data) - 1):
        style_cmds.append(
            ("LINEBELOW", (0, divider_row), (-1, divider_row), 2.5, _RED)
        )

    avail = A4[0] - 30 * mm
    if has_gradeo:
        col_widths = [avail * 0.32, avail * 0.15, avail * 0.15, avail * 0.13, avail * 0.10, avail * 0.15]
    else:
        col_widths = [avail * 0.38, avail * 0.18, avail * 0.18, avail * 0.15, avail * 0.11]
    t = Table(table_data, colWidths=col_widths, repeatRows=1)
    t.setStyle(TableStyle(style_cmds))
    els.append(t)

    # ── Gradeo section (only unmatched exams) ──
    unmatched_gradeo = []
    for ge in gradeo_exams:
        cm = re.search(r"Cycle\s+(\d+)", ge.exam_name, re.IGNORECASE)
        if cm and int(cm.group(1)) in matched_gradeo_cycles:
            continue
        unmatched_gradeo.append(ge)
    if unmatched_gradeo:
        els.append(Paragraph("Gradeo Quiz Results", styles["section"]))
        g_data = [[PH("Exam"), PH("Score"), PH("Class Avg"), PH("Topics")]]
        g_cmds = list(_base_table_style())
        for ge in unmatched_gradeo:
            mark_str = (
                f"{ge.exam_mark}/{ge.marks_available}"
                if ge.exam_mark is not None else "—"
            )
            avg_str = str(round(ge.class_average, 1)) if ge.class_average is not None else "—"
            topics = ge.topics or ""
            g_data.append([P(ge.exam_name), P(mark_str), P(avg_str), P(topics)])
        g_widths = [avail * 0.30, avail * 0.18, avail * 0.18, avail * 0.34]
        gt = Table(g_data, colWidths=g_widths, repeatRows=1)
        gt.setStyle(TableStyle(g_cmds))
        els.append(gt)

    # ── Other units summary ──
    other_groups = [g for g in group_order if g != best_group]
    if other_groups:
        els.append(Paragraph("Other Units Overview", styles["section"]))
        oc_data = [[PH("Unit"), PH("Total"), PH("Completed"), PH("Completion %"), PH("Missing")]]
        oc_cmds = list(_base_table_style())
        for gname in other_groups:
            g_asgns = groups[gname]
            g_total = len(g_asgns)
            g_done = sum(1 for a in g_asgns if a.workflow_state in ("submitted", "graded"))
            g_miss = sum(1 for a in g_asgns if a.missing)
            g_pct = f"{round(g_done / g_total * 100)}%" if g_total else "—"
            oc_data.append([P(gname), P(str(g_total)), P(str(g_done)), P(g_pct), P(str(g_miss))])
        oc_widths = [avail * 0.38, avail * 0.14, avail * 0.16, avail * 0.18, avail * 0.14]
        ot = Table(oc_data, colWidths=oc_widths, repeatRows=1)
        ot.setStyle(TableStyle(oc_cmds))
        els.append(ot)

    # Build and return
    name_slug = re.sub(r"[^a-z0-9]+", "-", student.name.lower()).strip("-")
    code = (course.course_code or "").replace(" ", "-") or str(course_id)
    cycle_part = f"-cycle-{cycle_num}" if cycle_num is not None else ""
    filename = f"{name_slug}{cycle_part}-update-{code}-{date.today().isoformat()}.pdf"
    return _build_pdf(els, filename)


# ---------------------------------------------------------------------------
# 11. Overall Missing Report PDF
# ---------------------------------------------------------------------------

@router.get("/students/{user_id}/missing-report-pdf")
async def export_missing_report_pdf(
    user_id: int,
    db: AsyncSession = Depends(get_db),
):
    """
    PDF report listing all missing / incomplete work for a student
    across Canvas assignments, EdStem lessons, and Gradeo exams.
    """
    from app.whitelist import get_effective_whitelist

    # ── Fetch student ──
    stu_result = await db.execute(
        text("SELECT id, name, email, sis_id FROM users WHERE id = :id"),
        {"id": user_id},
    )
    student = stu_result.fetchone()
    if not student:
        raise HTTPException(404, "Student not found")

    whitelist = await get_effective_whitelist(db)

    # ── Enrolled courses ──
    enrolled_result = await db.execute(
        text("""
            SELECT e.course_id, c.name, c.course_code
            FROM enrollments e
            JOIN courses c ON c.id = e.course_id
            WHERE e.user_id = :uid AND e.role = 'StudentEnrollment'
              AND e.enrollment_state = 'active'
              AND (:no_wl OR e.course_id = ANY(:whitelist))
        """),
        {"uid": user_id, "no_wl": not whitelist, "whitelist": whitelist or []},
    )
    courses_map = {
        r.course_id: {"name": r.name, "code": r.course_code}
        for r in enrolled_result.fetchall()
    }
    if not courses_map:
        raise HTTPException(404, "Student has no active enrolments")

    enrolled_ids = list(courses_map.keys())

    # ── Canvas: missing / not-submitted assignments ──
    canvas_result = await db.execute(
        text("""
            SELECT a.course_id, a.assignment_group_name, a.name AS assignment_name,
                   a.points_possible, a.due_at,
                   s.workflow_state, s.missing, s.late, s.score
            FROM assignments a
            LEFT JOIN submissions s ON s.assignment_id = a.id AND s.user_id = :uid
            WHERE a.course_id = ANY(:enrolled)
              AND a.workflow_state = 'published'
              AND a.due_at IS NOT NULL AND a.due_at <= NOW()
              AND (s.id IS NULL OR s.workflow_state NOT IN ('submitted', 'graded'))
            ORDER BY a.course_id, a.assignment_group_name, a.due_at
        """),
        {"uid": user_id, "enrolled": enrolled_ids},
    )
    missing_canvas = canvas_result.fetchall()

    # ── EdStem: incomplete lessons ──
    edstem_result = await db.execute(
        text("""
            SELECT ecm.canvas_course_id AS course_id,
                   el.module_name, el.title AS lesson_title,
                   COALESCE(elp.status, 'not_started') AS status
            FROM edstem_course_mappings ecm
            JOIN edstem_lessons el ON el.edstem_course_id = ecm.edstem_course_id
            LEFT JOIN edstem_lesson_progress elp
                ON elp.edstem_lesson_id = el.id AND elp.user_id = :uid
            WHERE ecm.canvas_course_id = ANY(:enrolled)
              AND (elp.status IS NULL OR elp.status != 'completed')
            ORDER BY ecm.canvas_course_id, el.module_name, el.position
        """),
        {"uid": user_id, "enrolled": enrolled_ids},
    )
    missing_edstem = edstem_result.fetchall()

    # ── Gradeo: pending / low-score exams ──
    gradeo_result = await db.execute(
        text("""
            SELECT gar.canvas_course_id AS course_id,
                   gcea.exam_name, gcea.topics,
                   gar.exam_mark, gar.marks_available, gar.status
            FROM gradeo_assignment_results gar
            JOIN gradeo_class_exam_assignments gcea
                ON gcea.id = gar.gradeo_class_exam_assignment_id
            WHERE gar.user_id = :uid
              AND gar.canvas_course_id = ANY(:enrolled)
              AND (gar.status = 'awaiting_marking'
                   OR gar.exam_mark IS NULL
                   OR (gar.marks_available > 0
                       AND gar.exam_mark / gar.marks_available < 0.5))
            ORDER BY gar.canvas_course_id, gcea.exam_name
        """),
        {"uid": user_id, "enrolled": enrolled_ids},
    )
    missing_gradeo = gradeo_result.fetchall()

    # ── Build PDF ──
    styles = _pdf_styles()
    els: list = []

    # Header
    els.append(Paragraph("Missing Work Report", styles["title"]))
    els.append(Paragraph(
        f"{student.name} &nbsp;|&nbsp; {date.today().strftime('%d %B %Y')}",
        styles["subtitle"],
    ))
    els.append(HRFlowable(width="100%", thickness=1, color=_SLATE_200, spaceAfter=10))

    # Summary metrics
    summary = Table(
        [[
            _metric_box(str(len(missing_canvas)), "Canvas Missing", styles),
            _metric_box(str(len(missing_edstem)), "EdStem Incomplete", styles),
            _metric_box(str(len(missing_gradeo)), "Gradeo Flagged", styles),
        ]],
        hAlign="LEFT",
    )
    summary.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP")]))
    els.append(summary)
    els.append(Spacer(1, 6))

    avail = A4[0] - 30 * mm

    P = lambda t: _p(t, styles)
    PH = lambda t: _p(t, styles, header=True)

    # ── Canvas Missing Assignments ──
    els.append(Paragraph("Canvas — Missing Assignments", styles["section"]))
    if missing_canvas:
        c_data = [[PH("Course"), PH("Assignment Group"), PH("Assignment"), PH("Due Date"), PH("Points")]]
        c_cmds = list(_base_table_style())
        for r in missing_canvas:
            c_info = courses_map.get(r.course_id, {})
            c_label = c_info.get("code") or c_info.get("name") or str(r.course_id)
            due_str = r.due_at.strftime("%d %b %Y") if r.due_at else "—"
            pts = str(r.points_possible) if r.points_possible else "—"
            c_data.append([
                P(c_label),
                P(r.assignment_group_name or "—"),
                P(r.assignment_name),
                P(due_str),
                P(pts),
            ])
        c_widths = [avail * 0.12, avail * 0.18, avail * 0.36, avail * 0.15, avail * 0.09]
        ct = Table(c_data, colWidths=c_widths, repeatRows=1)
        ct.setStyle(TableStyle(c_cmds))
        els.append(ct)
    else:
        els.append(Paragraph("No missing Canvas assignments.", styles["body_small"]))

    # ── EdStem Incomplete Lessons ──
    els.append(Paragraph("EdStem — Incomplete Lessons", styles["section"]))
    if missing_edstem:
        e_data = [[PH("Course"), PH("Module"), PH("Lesson"), PH("Status")]]
        e_cmds = list(_base_table_style())
        for i, r in enumerate(missing_edstem, start=1):
            c_info = courses_map.get(r.course_id, {})
            c_label = c_info.get("code") or c_info.get("name") or str(r.course_id)
            e_data.append([
                P(c_label),
                P(r.module_name or "—"),
                P(r.lesson_title),
                P(_status_display(r.status)),
            ])
            if r.status == "not_started":
                e_cmds.append(("BACKGROUND", (0, i), (-1, i), _RED_LIGHT))
            elif r.status == "viewed":
                e_cmds.append(("BACKGROUND", (0, i), (-1, i), _AMBER_LIGHT))
        e_widths = [avail * 0.12, avail * 0.32, avail * 0.38, avail * 0.12]
        et = Table(e_data, colWidths=e_widths, repeatRows=1)
        et.setStyle(TableStyle(e_cmds))
        els.append(et)
    else:
        els.append(Paragraph("All EdStem lessons completed.", styles["body_small"]))

    # ── Gradeo Flagged Exams ──
    els.append(Paragraph("Gradeo — Flagged Assessments", styles["section"]))
    if missing_gradeo:
        g_data = [[PH("Course"), PH("Exam"), PH("Score"), PH("Status"), PH("Topics")]]
        g_cmds = list(_base_table_style())
        for r in missing_gradeo:
            c_info = courses_map.get(r.course_id, {})
            c_label = c_info.get("code") or c_info.get("name") or str(r.course_id or 0)
            mark = (
                f"{r.exam_mark}/{r.marks_available}"
                if r.exam_mark is not None else "—"
            )
            g_data.append([P(c_label), P(r.exam_name), P(mark), P(r.status or "—"), P(r.topics or "")])
        g_widths = [avail * 0.14, avail * 0.25, avail * 0.14, avail * 0.18, avail * 0.29]
        gt = Table(g_data, colWidths=g_widths, repeatRows=1)
        gt.setStyle(TableStyle(g_cmds))
        els.append(gt)
    else:
        els.append(Paragraph(
            "No flagged Gradeo assessments.",
            styles["body_small"],
        ))

    # Build and return
    name_slug = re.sub(r"[^a-z0-9]+", "-", student.name.lower()).strip("-")
    filename = f"{name_slug}-missing-report-{date.today().isoformat()}.pdf"
    return _build_pdf(els, filename)
