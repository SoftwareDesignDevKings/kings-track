import csv
import io
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

    code = str(course_id)
    result = await db.execute(
        text("SELECT course_code FROM courses WHERE id = :id"),
        {"id": course_id},
    )
    course_row = result.fetchone()
    if course_row and course_row[0]:
        code = course_row[0].replace(" ", "-")

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
