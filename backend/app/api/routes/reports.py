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
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import (
    SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer, HRFlowable,
    PageBreak,
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
async def export_student_progress(format: str = Query("csv"), preview: int = Query(0), db: AsyncSession = Depends(get_db)):
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

    filename = f"student-progress-report-{date.today().isoformat()}"
    if format == "pdf" or preview:
        return _build_table_pdf_response(rows, headers, "Student Progress Report", f"{filename}.pdf", inline=bool(preview))
    return _csv_response(rows, headers, f"{filename}.csv")


# ---------------------------------------------------------------------------
# 2. Course Class Report
# ---------------------------------------------------------------------------

@router.get("/courses/{course_id}/class-report")
async def export_course_class_report(course_id: int, format: str = Query("csv"), preview: int = Query(0), db: AsyncSession = Depends(get_db)):
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
    filename = f"course-{code}-class-report-{date.today().isoformat()}"
    if format == "pdf" or preview:
        return _build_table_pdf_response(rows, headers, "Class Report", f"{filename}.pdf", inline=bool(preview))
    return _csv_response(rows, headers, f"{filename}.csv")


# ---------------------------------------------------------------------------
# 3. Gradeo Topic Bands Report
# ---------------------------------------------------------------------------

@router.get("/courses/{course_id}/gradeo-report")
async def export_gradeo_report(course_id: int, format: str = Query("csv"), preview: int = Query(0), db: AsyncSession = Depends(get_db)):
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
    filename = f"course-{code}-gradeo-report-{date.today().isoformat()}"
    if format == "pdf" or preview:
        return _build_table_pdf_response(rows, headers, "Gradeo Topic Bands Report", f"{filename}.pdf", inline=bool(preview))
    return _csv_response(rows, headers, f"{filename}.csv")


# ---------------------------------------------------------------------------
# 4. Class List
# ---------------------------------------------------------------------------

@router.get("/courses/{course_id}/class-list")
async def export_class_list(course_id: int, format: str = Query("csv"), preview: int = Query(0), db: AsyncSession = Depends(get_db)):
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
    filename = f"course-{code}-class-list-{date.today().isoformat()}"
    if format == "pdf" or preview:
        return _build_table_pdf_response(rows, headers, "Class List", f"{filename}.pdf", inline=bool(preview))
    return _csv_response(rows, headers, f"{filename}.csv")


# ---------------------------------------------------------------------------
# 5. At-Risk Students Report
# ---------------------------------------------------------------------------

@router.get("/at-risk-students")
async def export_at_risk_students(format: str = Query("csv"), preview: int = Query(0), db: AsyncSession = Depends(get_db)):
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

    filename = f"at-risk-students-{date.today().isoformat()}"
    if format == "pdf" or preview:
        return _build_table_pdf_response(rows, headers, "At-Risk Students Report", f"{filename}.pdf", inline=bool(preview))
    return _csv_response(rows, headers, f"{filename}.csv")


# ---------------------------------------------------------------------------
# 6. Attendance Summary Report
# ---------------------------------------------------------------------------

@router.get("/attendance-summary")
async def export_attendance_summary(format: str = Query("csv"), preview: int = Query(0), db: AsyncSession = Depends(get_db)):
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

    filename = f"attendance-summary-{date.today().isoformat()}"
    if format == "pdf" or preview:
        return _build_table_pdf_response(rows, headers, "Attendance Summary", f"{filename}.pdf", inline=bool(preview))
    return _csv_response(rows, headers, f"{filename}.csv")


# ---------------------------------------------------------------------------
# 7. Course Attendance Report
# ---------------------------------------------------------------------------

@router.get("/courses/{course_id}/attendance-report")
async def export_course_attendance(course_id: int, format: str = Query("csv"), preview: int = Query(0), db: AsyncSession = Depends(get_db)):
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
        filename = f"course-{code}-attendance-{date.today().isoformat()}"
        empty_headers = ["Student", "Email", "Attendance Rate (%)"]
        if format == "pdf" or preview:
            return _build_table_pdf_response([], empty_headers, "Course Attendance Report", f"{filename}.pdf", inline=bool(preview))
        return _csv_response([], empty_headers, f"{filename}.csv")

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
    filename = f"course-{code}-attendance-{date.today().isoformat()}"
    if format == "pdf" or preview:
        return _build_table_pdf_response(rows, headers, "Course Attendance Report", f"{filename}.pdf", inline=bool(preview))
    return _csv_response(rows, headers, f"{filename}.csv")


# ---------------------------------------------------------------------------
# 8. EdStem Progress Report
# ---------------------------------------------------------------------------

@router.get("/courses/{course_id}/edstem-report")
async def export_edstem_report(course_id: int, format: str = Query("csv"), preview: int = Query(0), db: AsyncSession = Depends(get_db)):
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
    filename = f"course-{code}-edstem-report-{date.today().isoformat()}"
    if format == "pdf" or preview:
        return _build_table_pdf_response(rows, headers, "EdStem Progress Report", f"{filename}.pdf", inline=bool(preview))
    return _csv_response(rows, headers, f"{filename}.csv")


# ---------------------------------------------------------------------------
# 9. Individual Student Report
# ---------------------------------------------------------------------------

@router.get("/students/{user_id}/report")
async def export_student_report(user_id: int, preview: int = Query(0), db: AsyncSession = Depends(get_db)):
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

    disposition = "inline" if preview else "attachment"
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'{disposition}; filename="{filename}"'},
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


def _build_pdf(elements: list, filename: str, inline: bool = False) -> StreamingResponse:
    """Render a list of platypus flowables into a PDF StreamingResponse."""
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=A4,
        leftMargin=15 * mm, rightMargin=15 * mm,
        topMargin=15 * mm, bottomMargin=15 * mm,
    )
    doc.build(elements)
    buf.seek(0)
    disposition = "inline" if inline else "attachment"
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="application/pdf",
        headers={"Content-Disposition": f'{disposition}; filename="{filename}"'},
    )


def _build_table_pdf_response(
    rows: list[list[str]],
    headers: list[str],
    title: str,
    filename: str,
    inline: bool = False,
) -> StreamingResponse:
    """Render tabular data as a styled PDF table."""
    styles = _pdf_styles()
    els: list = []

    els.append(Paragraph(title, styles["title"]))
    els.append(Paragraph(
        f"{date.today().strftime('%d %B %Y')} &nbsp;|&nbsp; {len(rows)} records",
        styles["subtitle"],
    ))
    els.append(HRFlowable(width="100%", thickness=1, color=_SLATE_200, spaceAfter=10))

    P = lambda t: _p(t, styles)
    PH = lambda t: _p(t, styles, header=True)

    if len(headers) > 20:
        raise HTTPException(
            422,
            "This report has too many columns for PDF. Please export as CSV instead.",
        )

    table_data = [[PH(h) for h in headers]]
    for row in rows:
        table_data.append([P(str(cell)) for cell in row])

    use_landscape = len(headers) > 6
    page = landscape(A4) if use_landscape else A4
    avail = page[0] - 30 * mm
    col_widths = [avail / len(headers)] * len(headers)

    t = Table(table_data, colWidths=col_widths, repeatRows=1)
    t.setStyle(TableStyle(_base_table_style()))
    els.append(t)

    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=page,
        leftMargin=15 * mm, rightMargin=15 * mm,
        topMargin=15 * mm, bottomMargin=15 * mm,
    )
    doc.build(els)
    buf.seek(0)
    disposition = "inline" if inline else "attachment"
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="application/pdf",
        headers={"Content-Disposition": f'{disposition}; filename="{filename}"'},
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

    # Fallback: if no Unit-prefixed groups, use all group names for matching
    if not unit_names:
        all_grp_result = await db.execute(
            text("""
                SELECT DISTINCT assignment_group_name
                FROM assignments
                WHERE course_id = :cid
                  AND assignment_group_name IS NOT NULL
                  AND workflow_state = 'published'
            """),
            {"cid": course_id},
        )
        unit_names = [r[0] for r in all_grp_result.fetchall()]

    result = []
    for cycle_num, term, sw, ew, topic in scheduled:
        matched_unit: str | None = None
        for uname in unit_names:
            # Try "Unit N: Topic" pattern first
            um = re.match(r"Unit\s+\d+[:\s\-]+(.+)", uname)
            if um:
                topic_part = um.group(1)
            else:
                # Fallback: strip leading number/prefix, use full name
                stripped = re.sub(r"^\d+[\.\)\s:\-]+\s*", "", uname).strip()
                topic_part = stripped if stripped else uname
            utopics = [
                t.strip()
                for t in re.split(r"\s*[–\-,&]\s*", topic_part)
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

async def _build_cycle_update_elements(
    db: AsyncSession,
    user_id: int,
    course_id: int,
    cycle_num: int | None,
) -> list:
    """Build the ReportLab elements for a single student's cycle update.

    Returns the flowable elements list.  Raises ``HTTPException`` on errors.
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

    # Fallback: if no Unit-prefixed groups, use all groups (e.g. ENC courses)
    if not groups:
        groups = dict(all_groups)
        group_order = list(all_group_order)

    if not groups:
        raise HTTPException(404, "No assignment groups found for this course")

    # ── Detect current unit ──
    now = datetime.utcnow()
    cycle_label: str | None = None

    if cycle_num is not None:
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

        best_group = group_order[-1]
        if target_topic:
            for gname in group_order:
                # Try "Unit N: Topic" pattern first
                um = re.match(r"Unit\s+\d+[:\s\-]+(.+)", gname)
                if um:
                    topic_part = um.group(1)
                else:
                    # Fallback: strip any leading number/prefix and use the
                    # full name for matching (handles non-Unit group names)
                    stripped = re.sub(r"^\d+[\.\)\s:\-]+\s*", "", gname).strip()
                    topic_part = stripped if stripped else gname
                utopics = [
                    t.strip()
                    for t in re.split(r"\s*[–\-,&]\s*", topic_part)
                    if t.strip()
                ]
                if any(
                    ut.lower() in target_topic.lower()
                    or target_topic.lower() in ut.lower()
                    for ut in utopics
                ):
                    best_group = gname
                    break

        if target_sw and target_ew:
            cycle_label = (
                f"Cycle {cycle_num} — Term {target_term}: "
                f"Weeks {target_sw}-{target_ew}"
            )
        else:
            cycle_label = f"Cycle {cycle_num}"
    else:
        best_group = group_order[-1]
        for gname in group_order:
            done = sum(
                1 for r in groups[gname]
                if r.workflow_state in ("submitted", "graded")
            )
            if done < len(groups[gname]):
                best_group = gname
                break

    # Use ALL assignments across every group (so quizzes in separate groups appear)
    all_unit_assignments = sorted(rows, key=_assignment_sort_key)

    two_weeks_ago = now.replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(days=14)
    end_of_today = now.replace(hour=23, minute=59, second=59, microsecond=999999)
    current_assignments = [
        a for a in all_unit_assignments
        if a.due_at is not None
        and two_weeks_ago <= (a.due_at.replace(tzinfo=None) if a.due_at.tzinfo else a.due_at) <= end_of_today
    ]

    # ── Look up Gradeo class mapping for this course ──
    gcm_result = await db.execute(
        text("SELECT gradeo_class_id FROM gradeo_class_mappings WHERE canvas_course_id = :cid"),
        {"cid": course_id},
    )
    gradeo_class_ids = [r[0] for r in gcm_result.fetchall()]

    # ── Fetch Gradeo results (deduplicate by exam name) ──
    # Filter by gradeo_class_id (not canvas_course_id) to match the course page
    # query and avoid picking stale rows. Prefer scored > awaiting > not_submitted.
    gradeo_result = await db.execute(
        text("""
            SELECT DISTINCT ON (gcea.exam_name)
                   gcea.exam_name, gcea.syllabus_title, gcea.topics,
                   gar.exam_mark, gar.marks_available, gar.class_average, gar.status
            FROM gradeo_assignment_results gar
            JOIN gradeo_class_exam_assignments gcea
                ON gcea.id = gar.gradeo_class_exam_assignment_id
            WHERE gar.user_id = :uid
              AND gcea.gradeo_class_id = ANY(:gcids)
            ORDER BY gcea.exam_name,
                     CASE gar.status WHEN 'scored' THEN 2 WHEN 'awaiting_marking' THEN 1 ELSE 0 END DESC,
                     gar.last_imported_at DESC NULLS LAST
        """),
        {"uid": user_id, "gcids": gradeo_class_ids or ["-1"]},
    )
    gradeo_exams = gradeo_result.fetchall()

    gradeo_by_cycle: dict[int, object] = {}
    for ge in gradeo_exams:
        m = re.search(r"Cycle\s*(\d+)", ge.exam_name, re.IGNORECASE)
        if m:
            gradeo_by_cycle[int(m.group(1))] = ge
    matched_gradeo_cycles: set[int] = set()

    # ── Build elements ──
    styles = _pdf_styles()
    els: list = []

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

    P = lambda t: _p(t, styles)
    PH = lambda t: _p(t, styles, header=True)
    has_gradeo = bool(gradeo_by_cycle)
    headers = [PH("Assignment"), PH("Due Date"), PH("Status"), PH("Score"), PH("Late")]
    if has_gradeo:
        headers.append(PH("Gradeo"))
    table_data = [headers]
    style_cmds = list(_base_table_style())

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

        if has_gradeo:
            cycle_m = re.match(r"Cycle\s*(\d+)", a.name, re.IGNORECASE)
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

        if status == "Missing":
            style_cmds.append(("BACKGROUND", (0, i), (-1, i), _RED_LIGHT))
        elif a.late:
            style_cmds.append(("BACKGROUND", (0, i), (-1, i), _AMBER_LIGHT))
        elif status == "Graded":
            style_cmds.append(("BACKGROUND", (0, i), (-1, i), _GREEN_LIGHT))

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
        cm = re.search(r"Cycle\s*(\d+)", ge.exam_name, re.IGNORECASE)
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

    # ── EdStem lesson completion (skip for ENC courses) ──
    is_enc = "ENC" in (course.course_code or "").upper()
    if not is_enc:
        edstem_total_result = await db.execute(
            text("""
                SELECT COUNT(*) FROM edstem_lessons el
                JOIN edstem_course_mappings ecm ON ecm.edstem_course_id = el.edstem_course_id
                WHERE ecm.canvas_course_id = :cid
            """),
            {"cid": course_id},
        )
        edstem_total = edstem_total_result.scalar() or 0
    else:
        edstem_total = 0

    if edstem_total > 0:
        edstem_completed_result = await db.execute(
            text("""
                SELECT COUNT(*) FROM edstem_lesson_progress elp
                JOIN edstem_lessons el ON el.id = elp.edstem_lesson_id
                JOIN edstem_course_mappings ecm ON ecm.edstem_course_id = el.edstem_course_id
                WHERE ecm.canvas_course_id = :cid
                  AND elp.user_id = :uid
                  AND elp.status = 'completed'
            """),
            {"cid": course_id, "uid": user_id},
        )
        edstem_completed = edstem_completed_result.scalar() or 0
        edstem_pct = round(edstem_completed / edstem_total * 100) if edstem_total else 0

        els.append(Paragraph("EdStem Lessons", styles["section"]))
        edstem_metrics = Table(
            [[
                _metric_box(f"{edstem_completed}/{edstem_total}", "Completed", styles),
                _metric_box(f"{edstem_pct}%", "Completion", styles),
            ]],
            hAlign="LEFT",
        )
        edstem_metrics.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP")]))
        els.append(edstem_metrics)
        els.append(Spacer(1, 6))

    # ── Missing Work (all past-due, unsubmitted/ungraded assignments across all groups) ──
    now_naive = now.replace(tzinfo=None)
    missing_assignments = [
        r for r in rows
        if r.due_at is not None
        and (r.due_at.replace(tzinfo=None) if r.due_at.tzinfo else r.due_at) <= now_naive
        and r.workflow_state not in ("submitted", "graded")
    ]
    if missing_assignments:
        els.append(Paragraph("Missing Work", styles["section"]))
        mw_data = [[PH("Assignment"), PH("Group"), PH("Due Date"), PH("Points"), PH("Status")]]
        mw_cmds = list(_base_table_style())
        for i, a in enumerate(missing_assignments, start=1):
            due_str = a.due_at.strftime("%d %b %Y") if a.due_at else "—"
            if a.points_possible:
                pts = str(int(a.points_possible) if a.points_possible == int(a.points_possible) else round(a.points_possible, 1))
            else:
                pts = "—"
            status = "Missing" if a.missing else "Not Submitted"
            mw_data.append([
                P(a.name),
                P(a.assignment_group_name or "—"),
                P(due_str),
                P(pts),
                P(status),
            ])
            mw_cmds.append(("BACKGROUND", (0, i), (-1, i), _RED_LIGHT))
        mw_widths = [avail * 0.36, avail * 0.22, avail * 0.16, avail * 0.10, avail * 0.16]
        mwt = Table(mw_data, colWidths=mw_widths, repeatRows=1)
        mwt.setStyle(TableStyle(mw_cmds))
        els.append(mwt)

    return els


@router.get("/students/{user_id}/cycle-update-pdf")
async def export_cycle_update_pdf(
    user_id: int,
    course_id: int = Query(..., description="Canvas course ID"),
    cycle_num: int | None = Query(None, description="Specific cycle number (omit for auto-detect)"),
    preview: int = Query(0, description="Set to 1 to return inline PDF for browser preview"),
    db: AsyncSession = Depends(get_db),
):
    """
    PDF report showing a student's progress in the current assignment-group
    cycle for a given course, plus any matched Gradeo quiz results.
    """
    els = await _build_cycle_update_elements(db, user_id, course_id, cycle_num)

    # Build filename
    stu_result = await db.execute(
        text("SELECT name FROM users WHERE id = :id"), {"id": user_id},
    )
    stu_row = stu_result.fetchone()
    name_slug = re.sub(r"[^a-z0-9]+", "-", (stu_row.name if stu_row else "student").lower()).strip("-")

    crs_result = await db.execute(
        text("SELECT course_code FROM courses WHERE id = :id"), {"id": course_id},
    )
    crs_row = crs_result.fetchone()
    code = ((crs_row.course_code if crs_row else None) or "").replace(" ", "-") or str(course_id)

    cycle_part = f"-cycle-{cycle_num}" if cycle_num is not None else ""
    filename = f"{name_slug}{cycle_part}-update-{code}-{date.today().isoformat()}.pdf"
    return _build_pdf(els, filename, inline=(preview == 1))


# ---------------------------------------------------------------------------
# 10c. Whole-Class Cycle Update PDF
# ---------------------------------------------------------------------------

@router.get("/courses/{course_id}/class-cycle-pdf")
async def export_class_cycle_pdf(
    course_id: int,
    cycle_num: int | None = Query(None, description="Specific cycle number (omit for auto-detect)"),
    preview: int = Query(0, description="Set to 1 to return inline PDF for browser preview"),
    db: AsyncSession = Depends(get_db),
):
    """
    Combined PDF with one cycle-update report per enrolled student,
    separated by page breaks.
    """
    # Fetch enrolled students
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
    if not students:
        raise HTTPException(404, "No students enrolled in this course")

    # Verify course has published assignments before looping
    unit_check = await db.execute(
        text("""
            SELECT COUNT(*) FROM assignments
            WHERE course_id = :course_id AND workflow_state = 'published'
        """),
        {"course_id": course_id},
    )
    if not (unit_check.scalar() or 0):
        raise HTTPException(404, "This course has no published assignments for cycle reports")

    all_elements: list = []
    styles = _pdf_styles()

    for idx, stu in enumerate(students):
        try:
            student_els = await _build_cycle_update_elements(
                db, stu.id, course_id, cycle_num,
            )
            if idx > 0:
                all_elements.append(PageBreak())
            all_elements.extend(student_els)
        except HTTPException:
            # Insert a placeholder page for students with no data
            if idx > 0:
                all_elements.append(PageBreak())
            all_elements.append(Paragraph("Cycle Update", styles["title"]))
            all_elements.append(Paragraph(
                f"{stu.name} — No cycle data available for this course.",
                styles["body"],
            ))

    code = await _get_course_code(db, course_id)
    cycle_part = f"-cycle-{cycle_num}" if cycle_num is not None else ""
    filename = f"class{cycle_part}-cycle-update-{code}-{date.today().isoformat()}.pdf"
    return _build_pdf(all_elements, filename, inline=(preview == 1))


# ---------------------------------------------------------------------------
# 11. Overall Missing Report PDF
# ---------------------------------------------------------------------------

@router.get("/students/{user_id}/missing-report-pdf")
async def export_missing_report_pdf(
    user_id: int,
    course_id: int | None = Query(None, description="Optional: filter to a single course"),
    preview: int = Query(0, description="Set to 1 to return inline PDF for browser preview"),
    db: AsyncSession = Depends(get_db),
):
    """
    PDF report listing all missing / incomplete work for a student
    across Canvas assignments, EdStem lessons, and Gradeo exams.
    When course_id is provided, only that course is included.
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

    # If course_id is specified, filter to just that course
    if course_id is not None:
        if course_id not in courses_map:
            raise HTTPException(404, "Student is not enrolled in this course")
        courses_map = {course_id: courses_map[course_id]}

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

    # ── EdStem: incomplete lessons (exclude ENC courses) ──
    enc_ids = [cid for cid, info in courses_map.items()
               if "ENC" in (info.get("code") or "").upper()]
    edstem_enrolled = [cid for cid in enrolled_ids if cid not in enc_ids]

    if edstem_enrolled:
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
            {"uid": user_id, "enrolled": edstem_enrolled},
        )
        missing_edstem = edstem_result.fetchall()
    else:
        missing_edstem = []

    # ── Gradeo: all results deduplicated by exam name per course ──
    # Show all Gradeo results (not just flagged) so the report gives a complete picture.
    # Deduplication prefers scored > awaiting > not_submitted.
    gradeo_result = await db.execute(
        text("""
            SELECT DISTINCT ON (gcm.canvas_course_id, gcea.exam_name)
                   gcm.canvas_course_id AS course_id,
                   gcea.exam_name, gcea.topics,
                   gar.exam_mark, gar.marks_available, gar.status
            FROM gradeo_assignment_results gar
            JOIN gradeo_class_exam_assignments gcea
                ON gcea.id = gar.gradeo_class_exam_assignment_id
            JOIN gradeo_class_mappings gcm
                ON gcm.gradeo_class_id = gcea.gradeo_class_id
            WHERE gar.user_id = :uid
              AND gcm.canvas_course_id = ANY(:enrolled)
            ORDER BY gcm.canvas_course_id, gcea.exam_name,
                     CASE gar.status WHEN 'scored' THEN 2 WHEN 'awaiting_marking' THEN 1 ELSE 0 END DESC,
                     gar.last_imported_at DESC NULLS LAST
        """),
        {"uid": user_id, "enrolled": enrolled_ids},
    )
    all_gradeo = gradeo_result.fetchall()
    gradeo_flagged = [
        r for r in all_gradeo
        if r.status == "awaiting_marking"
        or r.exam_mark is None
        or (r.marks_available and r.marks_available > 0 and r.exam_mark / r.marks_available < 0.5)
    ]

    # ── Assessment Tracking: assignments that have rubric criteria (show Canvas mark, not rubric scores) ──
    try:
        tracking_result = await db.execute(
            text("""
                SELECT DISTINCT a.course_id, a.name AS assignment_name, a.due_at,
                       a.points_possible,
                       s.score AS canvas_score, s.workflow_state
                FROM assignments a
                JOIN rubric_criteria rc ON rc.assignment_id = a.id
                LEFT JOIN submissions s ON s.assignment_id = a.id AND s.user_id = :uid
                WHERE a.course_id = ANY(:enrolled)
                  AND a.workflow_state = 'published'
                  AND (s.id IS NULL OR s.workflow_state NOT IN ('submitted', 'graded'))
                ORDER BY a.course_id, a.name
            """),
            {"uid": user_id, "enrolled": enrolled_ids},
        )
        tracking_rows = tracking_result.fetchall()
    except Exception:
        await db.rollback()
        tracking_rows = []

    tracking_count = len(tracking_rows)

    # ── Build PDF ──
    styles = _pdf_styles()
    els: list = []

    # Header
    els.append(Paragraph("Missing Work Report", styles["title"]))
    if course_id is not None:
        c_info = courses_map[course_id]
        c_label = c_info.get("code") or c_info.get("name") or str(course_id)
        els.append(Paragraph(
            f"{student.name} &nbsp;|&nbsp; {c_label} &nbsp;|&nbsp; {date.today().strftime('%d %B %Y')}",
            styles["subtitle"],
        ))
    else:
        els.append(Paragraph(
            f"{student.name} &nbsp;|&nbsp; {date.today().strftime('%d %B %Y')}",
            styles["subtitle"],
        ))
    els.append(HRFlowable(width="100%", thickness=1, color=_SLATE_200, spaceAfter=10))

    # Summary metrics
    metric_boxes = [
        _metric_box(str(len(missing_canvas)), "Canvas Missing", styles),
    ]
    if edstem_enrolled:
        metric_boxes.append(_metric_box(str(len(missing_edstem)), "EdStem Incomplete", styles))
    metric_boxes.extend([
        _metric_box(str(len(gradeo_flagged)), "Gradeo Flagged", styles),
        _metric_box(str(tracking_count), "Tracking Items", styles),
    ])
    summary = Table(
        [metric_boxes],
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

    # ── EdStem Incomplete Lessons (skip entirely for ENC-only reports) ──
    if edstem_enrolled:
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

    # ── Gradeo Results (all exams, flagged items highlighted) ──
    els.append(Paragraph("Gradeo — All Results", styles["section"]))
    if all_gradeo:
        g_data = [[PH("Course"), PH("Exam"), PH("Score"), PH("Status"), PH("Topics")]]
        g_cmds = list(_base_table_style())
        flagged_set = set(id(r) for r in gradeo_flagged)
        for i, r in enumerate(all_gradeo, start=1):
            c_info = courses_map.get(r.course_id, {})
            c_label = c_info.get("code") or c_info.get("name") or str(r.course_id or 0)
            mark = (
                f"{r.exam_mark}/{r.marks_available}"
                if r.exam_mark is not None else "—"
            )
            g_data.append([P(c_label), P(r.exam_name), P(mark), P(r.status or "—"), P(r.topics or "")])
            if id(r) in flagged_set:
                if r.status == "not_submitted" or r.exam_mark is None:
                    g_cmds.append(("BACKGROUND", (0, i), (-1, i), _RED_LIGHT))
                else:
                    g_cmds.append(("BACKGROUND", (0, i), (-1, i), _AMBER_LIGHT))
        g_widths = [avail * 0.14, avail * 0.25, avail * 0.14, avail * 0.18, avail * 0.29]
        gt = Table(g_data, colWidths=g_widths, repeatRows=1)
        gt.setStyle(TableStyle(g_cmds))
        els.append(gt)
    else:
        els.append(Paragraph(
            "No Gradeo results.",
            styles["body_small"],
        ))

    # ── Assessment Tracking — Current Tasks ──
    els.append(Paragraph("Assessment Tracking — Current Tasks", styles["section"]))
    if tracking_rows:
        t_data = [[PH("Course"), PH("Assignment"), PH("Due Date"), PH("Mark"), PH("Status")]]
        t_cmds = list(_base_table_style())
        for i, r in enumerate(tracking_rows, start=1):
            c_info = courses_map.get(r.course_id, {})
            c_label = c_info.get("code") or c_info.get("name") or str(r.course_id)
            due_str = r.due_at.strftime("%d %b %Y") if r.due_at else "—"
            if r.canvas_score is not None and r.points_possible:
                pp = int(r.points_possible) if r.points_possible == int(r.points_possible) else round(r.points_possible, 1)
                mark_str = f"{round(r.canvas_score, 1)}/{pp}"
            else:
                mark_str = "—"
            ws = r.workflow_state or ""
            status = "Graded" if ws == "graded" else ("Submitted" if ws == "submitted" else "Not Submitted")
            t_data.append([
                P(c_label),
                P(r.assignment_name),
                P(due_str),
                P(mark_str),
                P(status),
            ])
            if r.canvas_score is None:
                t_cmds.append(("BACKGROUND", (0, i), (-1, i), _RED_LIGHT))
        t_widths = [avail * 0.12, avail * 0.36, avail * 0.16, avail * 0.16, avail * 0.20]
        tt = Table(t_data, colWidths=t_widths, repeatRows=1)
        tt.setStyle(TableStyle(t_cmds))
        els.append(tt)
    else:
        els.append(Paragraph("No current assessment tracking items.", styles["body_small"]))

    # Build and return
    name_slug = re.sub(r"[^a-z0-9]+", "-", student.name.lower()).strip("-")
    filename = f"{name_slug}-missing-report-{date.today().isoformat()}.pdf"
    return _build_pdf(els, filename, inline=(preview == 1))


# ---------------------------------------------------------------------------
# 14. Complete Student Report PDF (single course)
# ---------------------------------------------------------------------------

@router.get("/students/{user_id}/student-report-pdf")
async def export_student_report_pdf(
    user_id: int,
    course_id: int = Query(..., description="Canvas course ID"),
    preview: int = Query(0, description="Set to 1 to return inline PDF for browser preview"),
    db: AsyncSession = Depends(get_db),
):
    """
    Comprehensive PDF for one student in one course at the current date.
    Sections: header, overview, assignment progress, assessment tracking,
    Gradeo results, EdStem progress, attendance.
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

    # ── Fetch course ──
    crs_result = await db.execute(
        text("SELECT id, name, course_code FROM courses WHERE id = :id"),
        {"id": course_id},
    )
    course = crs_result.fetchone()
    if not course:
        raise HTTPException(404, "Course not found")

    is_enc = "ENC" in (course.course_code or "").upper()

    # Look up Gradeo class mapping for this course
    gcm_result = await db.execute(
        text("SELECT gradeo_class_id FROM gradeo_class_mappings WHERE canvas_course_id = :cid"),
        {"cid": course_id},
    )
    gradeo_class_ids = [r[0] for r in gcm_result.fetchall()]

    styles = _pdf_styles()
    els: list = []

    P = lambda t: _p(t, styles)
    PH = lambda t: _p(t, styles, header=True)

    avail = A4[0] - 30 * mm

    # ── Section 1: Header ──
    els.append(Paragraph("Complete Student Report", styles["title"]))
    course_label = f"{course.course_code} — {course.name}" if course.course_code else course.name
    els.append(Paragraph(
        f"{student.name} &nbsp;|&nbsp; {course_label} &nbsp;|&nbsp; {date.today().strftime('%d %B %Y')}",
        styles["subtitle"],
    ))
    info_lines = []
    if student.email:
        info_lines.append(f"Email: {student.email}")
    if student.sis_id:
        info_lines.append(f"SIS ID: {student.sis_id}")
    if info_lines:
        els.append(Paragraph(" &nbsp;|&nbsp; ".join(info_lines), styles["body_small"]))
    els.append(HRFlowable(width="100%", thickness=1, color=_SLATE_200, spaceAfter=10))

    # ── Section 2: Overview Metrics ──
    metrics_result = await db.execute(
        text("""
            SELECT completion_rate, on_time_rate, current_score
            FROM student_metrics
            WHERE user_id = :uid AND course_id = :cid
        """),
        {"uid": user_id, "cid": course_id},
    )
    metrics_row = metrics_result.fetchone()

    att_rate_result = await db.execute(
        text("""
            SELECT COUNT(*) FILTER (WHERE ar.status IN ('present', 'late')) AS attended,
                   COUNT(*) AS total
            FROM attendance_records ar
            JOIN meetings m ON m.id = ar.meeting_id
            WHERE ar.user_id = :uid AND m.course_id = :cid
        """),
        {"uid": user_id, "cid": course_id},
    )
    att_row = att_rate_result.fetchone()
    att_rate = round(att_row.attended / att_row.total * 100) if att_row and att_row.total else 0

    completion = _fmt_pct(metrics_row.completion_rate) if metrics_row else "—"
    on_time = _fmt_pct(metrics_row.on_time_rate) if metrics_row else "—"
    score = _fmt_score(metrics_row.current_score) if metrics_row else "—"

    overview = Table(
        [[
            _metric_box(completion, "Completion", styles),
            _metric_box(on_time, "On-Time", styles),
            _metric_box(score, "Score", styles),
            _metric_box(f"{att_rate}%", "Attendance", styles),
        ]],
        hAlign="LEFT",
    )
    overview.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP")]))
    els.append(overview)
    els.append(Spacer(1, 8))

    # ── Section 3: Assignment Progress ──
    els.append(Paragraph("Assignment Progress", styles["section"]))
    asg_result = await db.execute(
        text("""
            SELECT a.assignment_group_name, a.name AS assignment_name,
                   a.points_possible, a.due_at,
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
    assignments = asg_result.fetchall()

    if assignments:
        a_data = [[PH("Group"), PH("Assignment"), PH("Due Date"), PH("Status"), PH("Score"), PH("Late")]]
        a_cmds = list(_base_table_style())
        for i, r in enumerate(assignments, start=1):
            due_str = r.due_at.strftime("%d %b %Y") if r.due_at else "—"
            status = _status_display(r.workflow_state) if r.workflow_state else "—"
            score_str = f"{r.score}/{r.points_possible}" if r.score is not None and r.points_possible else ("—" if r.score is None else str(r.score))
            late_str = "Yes" if r.late else ""
            a_data.append([
                P(r.assignment_group_name or "—"),
                P(r.assignment_name),
                P(due_str),
                P(status),
                P(score_str),
                P(late_str),
            ])
            if r.workflow_state == "graded":
                a_cmds.append(("BACKGROUND", (0, i), (-1, i), _GREEN_LIGHT))
            elif r.missing or (r.workflow_state and "submit" not in r.workflow_state and r.due_at and r.due_at < datetime.now(r.due_at.tzinfo)):
                a_cmds.append(("BACKGROUND", (0, i), (-1, i), _RED_LIGHT))
            elif r.late:
                a_cmds.append(("BACKGROUND", (0, i), (-1, i), _AMBER_LIGHT))
        a_widths = [avail * 0.15, avail * 0.33, avail * 0.12, avail * 0.14, avail * 0.14, avail * 0.07]
        at = Table(a_data, colWidths=a_widths, repeatRows=1)
        at.setStyle(TableStyle(a_cmds))
        els.append(at)
    else:
        els.append(Paragraph("No assignments found for this course.", styles["body_small"]))

    els.append(Spacer(1, 8))

    # ── Section 4: Assessment Tracking (Canvas marks, not rubric scores) ──
    els.append(Paragraph("Assessment Tracking", styles["section"]))
    try:
        tracking_result = await db.execute(
            text("""
                SELECT DISTINCT a.name AS assignment_name, a.due_at,
                       a.points_possible,
                       s.score AS canvas_score, s.workflow_state
                FROM assignments a
                JOIN rubric_criteria rc ON rc.assignment_id = a.id
                LEFT JOIN submissions s ON s.assignment_id = a.id AND s.user_id = :uid
                WHERE a.course_id = :cid
                  AND a.workflow_state = 'published'
                  AND (s.id IS NULL OR s.workflow_state NOT IN ('submitted', 'graded'))
                ORDER BY a.name
            """),
            {"uid": user_id, "cid": course_id},
        )
        tracking_rows = tracking_result.fetchall()
    except Exception:
        await db.rollback()
        tracking_rows = []

    if tracking_rows:
        tk_data = [[PH("Assignment"), PH("Due Date"), PH("Mark"), PH("Status")]]
        tk_cmds = list(_base_table_style())
        for i, r in enumerate(tracking_rows, start=1):
            due_str = r.due_at.strftime("%d %b %Y") if r.due_at else "—"
            if r.canvas_score is not None and r.points_possible:
                pp = int(r.points_possible) if r.points_possible == int(r.points_possible) else round(r.points_possible, 1)
                mark_str = f"{round(r.canvas_score, 1)}/{pp}"
            else:
                mark_str = "—"
            ws = r.workflow_state or ""
            status = "Graded" if ws == "graded" else ("Submitted" if ws == "submitted" else "Not Submitted")
            tk_data.append([
                P(r.assignment_name),
                P(due_str),
                P(mark_str),
                P(status),
            ])
            if r.canvas_score is None:
                tk_cmds.append(("BACKGROUND", (0, i), (-1, i), _RED_LIGHT))
        tk_widths = [avail * 0.40, avail * 0.20, avail * 0.20, avail * 0.20]
        tkt = Table(tk_data, colWidths=tk_widths, repeatRows=1)
        tkt.setStyle(TableStyle(tk_cmds))
        els.append(tkt)
    else:
        els.append(Paragraph("No current assessment tracking items.", styles["body_small"]))

    els.append(Spacer(1, 8))

    # ── Section 5: Gradeo Results (deduplicate by exam name, keep latest) ──
    els.append(Paragraph("Gradeo Results", styles["section"]))
    gradeo_result = await db.execute(
        text("""
            SELECT DISTINCT ON (gcea.exam_name)
                   gcea.exam_name, gar.exam_mark, gar.marks_available,
                   gcea.class_average, gcea.topics, gar.status
            FROM gradeo_assignment_results gar
            JOIN gradeo_class_exam_assignments gcea
                ON gcea.id = gar.gradeo_class_exam_assignment_id
            WHERE gar.user_id = :uid
              AND gcea.gradeo_class_id = ANY(:gcids)
            ORDER BY gcea.exam_name,
                     CASE gar.status WHEN 'scored' THEN 2 WHEN 'awaiting_marking' THEN 1 ELSE 0 END DESC,
                     gar.last_imported_at DESC NULLS LAST
        """),
        {"uid": user_id, "gcids": gradeo_class_ids or ["-1"]},
    )
    gradeo_rows = gradeo_result.fetchall()

    if gradeo_rows:
        gr_data = [[PH("Exam"), PH("Mark"), PH("Class Avg"), PH("Topics"), PH("Status")]]
        gr_cmds = list(_base_table_style())
        for r in gradeo_rows:
            mark = f"{r.exam_mark}/{r.marks_available}" if r.exam_mark is not None else "—"
            avg = f"{r.class_average}" if r.class_average is not None else "—"
            gr_data.append([P(r.exam_name), P(mark), P(avg), P(r.topics or ""), P(r.status or "—")])
        gr_widths = [avail * 0.25, avail * 0.12, avail * 0.12, avail * 0.33, avail * 0.18]
        grt = Table(gr_data, colWidths=gr_widths, repeatRows=1)
        grt.setStyle(TableStyle(gr_cmds))
        els.append(grt)
    else:
        els.append(Paragraph("No Gradeo results for this course.", styles["body_small"]))

    els.append(Spacer(1, 8))

    # ── Section 6: EdStem Progress (skip for ENC) ──
    if not is_enc:
        els.append(Paragraph("EdStem Progress", styles["section"]))
        edstem_result = await db.execute(
            text("""
                SELECT el.module_name, el.title AS lesson_title,
                       COALESCE(elp.status, 'not_started') AS status
                FROM edstem_lessons el
                JOIN edstem_course_mappings ecm ON ecm.edstem_course_id = el.edstem_course_id
                LEFT JOIN edstem_lesson_progress elp
                    ON elp.edstem_lesson_id = el.id AND elp.user_id = :uid
                WHERE ecm.canvas_course_id = :cid
                ORDER BY el.module_name, el.position
            """),
            {"uid": user_id, "cid": course_id},
        )
        edstem_rows = edstem_result.fetchall()

        if edstem_rows:
            ed_data = [[PH("Module"), PH("Lesson"), PH("Status")]]
            ed_cmds = list(_base_table_style())
            for i, r in enumerate(edstem_rows, start=1):
                ed_data.append([
                    P(r.module_name or "—"),
                    P(r.lesson_title),
                    P(_status_display(r.status)),
                ])
                if r.status == "completed":
                    ed_cmds.append(("BACKGROUND", (0, i), (-1, i), _GREEN_LIGHT))
                elif r.status == "not_started":
                    ed_cmds.append(("BACKGROUND", (0, i), (-1, i), _RED_LIGHT))
            ed_widths = [avail * 0.30, avail * 0.50, avail * 0.20]
            edt = Table(ed_data, colWidths=ed_widths, repeatRows=1)
            edt.setStyle(TableStyle(ed_cmds))
            els.append(edt)
        else:
            els.append(Paragraph("No EdStem lessons for this course.", styles["body_small"]))

        els.append(Spacer(1, 8))

    # ── Section 7: Attendance ──
    els.append(Paragraph("Attendance", styles["section"]))
    att_result = await db.execute(
        text("""
            SELECT m.start_time, m.title,
                   ar.status
            FROM meetings m
            LEFT JOIN attendance_records ar ON ar.meeting_id = m.id AND ar.user_id = :uid
            WHERE m.course_id = :cid
            ORDER BY m.start_time
        """),
        {"uid": user_id, "cid": course_id},
    )
    att_rows = att_result.fetchall()

    if att_rows:
        # Attendance summary counts
        present = sum(1 for r in att_rows if r.status == "present")
        late = sum(1 for r in att_rows if r.status == "late")
        partial = sum(1 for r in att_rows if r.status == "partial")
        absent = sum(1 for r in att_rows if r.status == "absent")
        total = len(att_rows)
        rate = round((present + late) / total * 100) if total else 0

        att_summary = Table(
            [[
                _metric_box(str(present), "Present", styles),
                _metric_box(str(late), "Late", styles),
                _metric_box(str(partial), "Partial", styles),
                _metric_box(str(absent), "Absent", styles),
                _metric_box(f"{rate}%", "Rate", styles),
            ]],
            hAlign="LEFT",
        )
        att_summary.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP")]))
        els.append(att_summary)
        els.append(Spacer(1, 6))

        at_data = [[PH("Date"), PH("Meeting"), PH("Status")]]
        at_cmds = list(_base_table_style())
        for i, r in enumerate(att_rows, start=1):
            date_str = r.start_time.strftime("%d %b %Y") if r.start_time else "—"
            status = _status_display(r.status) if r.status else "—"
            at_data.append([P(date_str), P(r.title or "—"), P(status)])
            if r.status == "present":
                at_cmds.append(("BACKGROUND", (0, i), (-1, i), _GREEN_LIGHT))
            elif r.status == "absent":
                at_cmds.append(("BACKGROUND", (0, i), (-1, i), _RED_LIGHT))
            elif r.status in ("late", "partial"):
                at_cmds.append(("BACKGROUND", (0, i), (-1, i), _AMBER_LIGHT))
        at_widths = [avail * 0.20, avail * 0.50, avail * 0.30]
        att_table = Table(at_data, colWidths=at_widths, repeatRows=1)
        att_table.setStyle(TableStyle(at_cmds))
        els.append(att_table)
    else:
        els.append(Paragraph("No attendance records for this course.", styles["body_small"]))

    # Build and return
    code = (course.course_code or "").replace(" ", "-") or str(course_id)
    name_slug = re.sub(r"[^a-z0-9]+", "-", student.name.lower()).strip("-")
    filename = f"{name_slug}-{code}-report-{date.today().isoformat()}.pdf"
    return _build_pdf(els, filename, inline=(preview == 1))
