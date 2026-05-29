import csv
import io
import re
from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from sqlalchemy import text

from app.api.deps import require_auth
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
