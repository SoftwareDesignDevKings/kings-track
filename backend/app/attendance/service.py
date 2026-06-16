"""
Attendance query service — provides aggregated attendance data for
the dashboard, meetings list, and student profile endpoints.
"""
import re
import logging
from datetime import datetime

from sqlalchemy import select, func, case, distinct, and_, or_, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.meeting import Meeting
from app.models.attendance_record import AttendanceRecord
from app.models.user import User
from app.models.enrollment import Enrollment
from app.models.course import Course
from app.models.student_metrics import StudentMetrics
from app.models.submission import Submission
from app.models.assignment import Assignment
from app.whitelist import get_effective_whitelist

logger = logging.getLogger(__name__)


def _get_base_class_code(class_code: str) -> str:
    """Strip trailing digit after X for amalgamation: '11SENX2' -> '11SENX'."""
    m = re.match(r"^(\d{1,2}[A-Z]+X)\d?$", class_code)
    return m.group(1) if m else class_code


# ---------------------------------------------------------------------------
# Meetings
# ---------------------------------------------------------------------------

async def get_meetings(
    db: AsyncSession,
    class_code: str | None = None,
    course_id: int | None = None,
    limit: int = 100,
    offset: int = 0,
) -> list[dict]:
    """List meetings with attendance summary counts."""
    base = select(
        Meeting.id,
        Meeting.title,
        Meeting.start_time,
        Meeting.end_time,
        Meeting.class_code,
        Meeting.course_id,
        func.count(AttendanceRecord.id).label("total_records"),
        func.count(case((AttendanceRecord.status == "present", 1))).label("present"),
        func.count(case((AttendanceRecord.status == "late", 1))).label("late"),
        func.count(case((AttendanceRecord.status == "partial", 1))).label("partial"),
    ).outerjoin(AttendanceRecord, AttendanceRecord.meeting_id == Meeting.id).group_by(
        Meeting.id
    )

    if class_code:
        base_code = _get_base_class_code(class_code)
        base = base.where(Meeting.class_code.ilike(f"{base_code}%"))
    if course_id:
        base = base.where(Meeting.course_id == course_id)

    base = base.order_by(Meeting.start_time.desc()).limit(limit).offset(offset)
    rows = await db.execute(base)
    return [
        {
            "id": r.id,
            "title": r.title,
            "start_time": r.start_time.isoformat() if r.start_time else None,
            "end_time": r.end_time.isoformat() if r.end_time else None,
            "class_code": r.class_code,
            "course_id": r.course_id,
            "present": r.present,
            "late": r.late,
            "partial": r.partial,
            "total_records": r.total_records,
        }
        for r in rows.all()
    ]


async def get_meeting_detail(db: AsyncSession, meeting_id: int) -> dict | None:
    """Get a single meeting with full attendance records + absence detection."""
    meeting = await db.get(Meeting, meeting_id)
    if not meeting:
        return None

    # Fetch attendance records with user info
    stmt = (
        select(
            AttendanceRecord.id,
            AttendanceRecord.user_id,
            User.name,
            User.email,
            AttendanceRecord.join_time,
            AttendanceRecord.leave_time,
            AttendanceRecord.duration_minutes,
            AttendanceRecord.status,
        )
        .join(User, User.id == AttendanceRecord.user_id)
        .where(AttendanceRecord.meeting_id == meeting_id)
        .order_by(User.name)
    )
    rows = await db.execute(stmt)
    attendance = [
        {
            "id": r.id,
            "user_id": r.user_id,
            "name": r.name,
            "email": r.email,
            "join_time": r.join_time.isoformat() if r.join_time else None,
            "leave_time": r.leave_time.isoformat() if r.leave_time else None,
            "duration_minutes": r.duration_minutes,
            "status": r.status,
        }
        for r in rows.all()
    ]

    # Detect absences from Canvas roster if class_code exists
    absent = []
    if meeting.class_code:
        attended_ids = {a["user_id"] for a in attendance}
        roster = await _get_class_roster(db, meeting.class_code)
        absent = [
            {"user_id": s["id"], "name": s["name"], "email": s["email"], "status": "absent"}
            for s in roster
            if s["id"] not in attended_ids
        ]

    return {
        "id": meeting.id,
        "title": meeting.title,
        "start_time": meeting.start_time.isoformat() if meeting.start_time else None,
        "end_time": meeting.end_time.isoformat() if meeting.end_time else None,
        "class_code": meeting.class_code,
        "course_id": meeting.course_id,
        "attendance": attendance,
        "absent": absent,
        "summary": {
            "present": sum(1 for a in attendance if a["status"] == "present"),
            "late": sum(1 for a in attendance if a["status"] == "late"),
            "partial": sum(1 for a in attendance if a["status"] == "partial"),
            "absent": len(absent),
            "total": len(attendance) + len(absent),
        },
    }


async def get_class_codes(db: AsyncSession) -> list[dict]:
    """Get distinct class codes with meeting and student counts."""
    stmt = (
        select(
            Meeting.class_code,
            func.count(distinct(Meeting.id)).label("meeting_count"),
            func.count(distinct(AttendanceRecord.user_id)).label("student_count"),
        )
        .outerjoin(AttendanceRecord, AttendanceRecord.meeting_id == Meeting.id)
        .where(Meeting.class_code.isnot(None))
        .group_by(Meeting.class_code)
        .order_by(Meeting.class_code)
    )
    rows = await db.execute(stmt)
    return [
        {"class_code": r.class_code, "meeting_count": r.meeting_count, "student_count": r.student_count}
        for r in rows.all()
    ]


# ---------------------------------------------------------------------------
# Student attendance
# ---------------------------------------------------------------------------

async def get_student_attendance_summary(db: AsyncSession, user_id: int) -> dict:
    """Cross-course attendance summary for a single student."""
    stmt = (
        select(
            func.count(AttendanceRecord.id).label("total"),
            func.count(case((AttendanceRecord.status == "present", 1))).label("present"),
            func.count(case((AttendanceRecord.status == "late", 1))).label("late"),
            func.count(case((AttendanceRecord.status == "partial", 1))).label("partial"),
        )
        .where(AttendanceRecord.user_id == user_id)
    )
    row = await db.execute(stmt)
    r = row.one()
    total = r.total or 0
    present = r.present or 0
    late = r.late or 0

    return {
        "total_meetings": total,
        "present": present,
        "late": late,
        "partial": r.partial or 0,
        "absent": 0,  # Computed separately if needed
        "attendance_rate": round((present + late) / total * 100, 1) if total > 0 else None,
    }


async def get_student_attendance_by_class(db: AsyncSession, user_id: int) -> list[dict]:
    """Attendance breakdown per class code for a student."""
    stmt = (
        select(
            Meeting.class_code,
            func.count(AttendanceRecord.id).label("total"),
            func.count(case((AttendanceRecord.status == "present", 1))).label("present"),
            func.count(case((AttendanceRecord.status == "late", 1))).label("late"),
            func.count(case((AttendanceRecord.status == "partial", 1))).label("partial"),
        )
        .join(Meeting, Meeting.id == AttendanceRecord.meeting_id)
        .where(AttendanceRecord.user_id == user_id)
        .where(Meeting.class_code.isnot(None))
        .group_by(Meeting.class_code)
        .order_by(Meeting.class_code)
    )
    rows = await db.execute(stmt)
    results = []
    for r in rows.all():
        total = r.total or 0
        present = r.present or 0
        late = r.late or 0
        results.append({
            "class_code": r.class_code,
            "total": total,
            "present": present,
            "late": late,
            "partial": r.partial or 0,
            "rate": round((present + late) / total * 100, 1) if total > 0 else None,
        })
    return results


async def get_student_recent_attendance(
    db: AsyncSession, user_id: int, limit: int = 20
) -> list[dict]:
    """Recent attendance records for a student."""
    stmt = (
        select(
            AttendanceRecord.id,
            Meeting.id.label("meeting_id"),
            Meeting.title.label("meeting_title"),
            Meeting.start_time.label("meeting_date"),
            Meeting.class_code,
            AttendanceRecord.join_time,
            AttendanceRecord.leave_time,
            AttendanceRecord.duration_minutes,
            AttendanceRecord.status,
        )
        .join(Meeting, Meeting.id == AttendanceRecord.meeting_id)
        .where(AttendanceRecord.user_id == user_id)
        .order_by(Meeting.start_time.desc())
        .limit(limit)
    )
    rows = await db.execute(stmt)
    return [
        {
            "meeting_id": r.meeting_id,
            "meeting_title": r.meeting_title,
            "date": r.meeting_date.isoformat() if r.meeting_date else None,
            "class_code": r.class_code,
            "join_time": r.join_time.isoformat() if r.join_time else None,
            "leave_time": r.leave_time.isoformat() if r.leave_time else None,
            "duration_minutes": r.duration_minutes,
            "status": r.status,
        }
        for r in rows.all()
    ]


# ---------------------------------------------------------------------------
# Dashboard aggregation
# ---------------------------------------------------------------------------

async def get_dashboard_stats(db: AsyncSession) -> dict:
    """Aggregated stats for the main dashboard."""
    whitelist = await get_effective_whitelist(db)

    # Total meetings (only for whitelisted courses)
    meetings_stmt = select(Meeting.id, Meeting.class_code, Meeting.course_id)
    if whitelist:
        meetings_stmt = meetings_stmt.where(Meeting.course_id.in_(whitelist))
    meetings_rows = (await db.execute(meetings_stmt)).all()
    total_meetings = len(meetings_rows)

    # Total unique students with attendance (whitelisted meetings only)
    students_stmt = (
        select(func.count(distinct(AttendanceRecord.user_id)))
        .join(Meeting, Meeting.id == AttendanceRecord.meeting_id)
    )
    if whitelist:
        students_stmt = students_stmt.where(Meeting.course_id.in_(whitelist))
    total_students = await db.scalar(students_stmt) or 0

    # Overall attendance distribution (whitelisted meetings only)
    dist_stmt = (
        select(
            func.count(case((AttendanceRecord.status == "present", 1))).label("present"),
            func.count(case((AttendanceRecord.status == "late", 1))).label("late"),
            func.count(case((AttendanceRecord.status == "partial", 1))).label("partial"),
            func.count(AttendanceRecord.id).label("total"),
        )
        .join(Meeting, Meeting.id == AttendanceRecord.meeting_id)
    )
    if whitelist:
        dist_stmt = dist_stmt.where(Meeting.course_id.in_(whitelist))
    dist = (await db.execute(dist_stmt)).one()

    # Compute absent count: for each meeting, count enrolled students
    # in related courses who have no attendance record for that meeting.
    total_absent = 0
    for meeting in meetings_rows:
        class_code = meeting.class_code or ""
        base_code = _get_base_class_code(class_code) if class_code else None

        if base_code:
            # Find all whitelisted courses sharing the same base class code
            related_stmt = (
                select(func.count(distinct(Enrollment.user_id)))
                .join(Course, Course.id == Enrollment.course_id)
                .where(Enrollment.role == "StudentEnrollment")
                .where(Course.course_code.ilike(f"{base_code}%"))
            )
            if whitelist:
                related_stmt = related_stmt.where(Enrollment.course_id.in_(whitelist))
            enrolled_count = await db.scalar(related_stmt) or 0
        elif meeting.course_id:
            enrolled_count = await db.scalar(
                select(func.count(Enrollment.user_id))
                .where(Enrollment.course_id == meeting.course_id)
                .where(Enrollment.role == "StudentEnrollment")
            ) or 0
        else:
            enrolled_count = 0

        attended_count = await db.scalar(
            select(func.count(distinct(AttendanceRecord.user_id)))
            .where(AttendanceRecord.meeting_id == meeting.id)
        ) or 0

        absent = max(enrolled_count - attended_count, 0)
        total_absent += absent

    # Recent meetings
    recent = await get_meetings(db, limit=5)

    total_with_absent = (dist.total or 0) + total_absent

    return {
        "total_meetings": total_meetings or 0,
        "total_students": total_students or 0,
        "attendance_distribution": {
            "present": dist.present or 0,
            "late": dist.late or 0,
            "partial": dist.partial or 0,
            "absent": total_absent,
            "total": total_with_absent,
        },
        "recent_meetings": recent,
    }


# ---------------------------------------------------------------------------
# Student profile — full cross-course aggregation
# ---------------------------------------------------------------------------

async def get_student_profile(db: AsyncSession, user_id: int) -> dict | None:
    """
    Build a comprehensive cross-course student profile combining:
    - Student info
    - Per-course academic metrics
    - Cross-course attendance summary
    - Recent attendance records
    - Concern flagging
    """
    # Fetch user
    user = await db.get(User, user_id)
    if not user:
        return None

    # Enrollments + course info + metrics (filtered to whitelisted courses)
    whitelist = await get_effective_whitelist(db)
    courses_stmt = (
        select(
            Course.id.label("course_id"),
            Course.name.label("course_name"),
            Course.course_code,
            Enrollment.current_score,
            Enrollment.final_score,
            Enrollment.last_activity_at,
            StudentMetrics.completion_rate,
            StudentMetrics.on_time_rate,
            StudentMetrics.current_score.label("metrics_score"),
        )
        .join(Course, Course.id == Enrollment.course_id)
        .outerjoin(
            StudentMetrics,
            and_(
                StudentMetrics.course_id == Enrollment.course_id,
                StudentMetrics.user_id == Enrollment.user_id,
            ),
        )
        .where(Enrollment.user_id == user_id)
        .where(Enrollment.role == "StudentEnrollment")
    )
    if whitelist:
        courses_stmt = courses_stmt.where(Enrollment.course_id.in_(whitelist))
    courses_stmt = courses_stmt.order_by(Course.name)
    courses_rows = await db.execute(courses_stmt)
    courses = []
    total_completion = []
    total_on_time = []
    total_scores = []

    for r in courses_rows.all():
        cr = r.completion_rate
        otr = r.on_time_rate
        sc = r.metrics_score if r.metrics_score is not None else r.current_score

        courses.append({
            "course_id": r.course_id,
            "course_name": r.course_name,
            "course_code": r.course_code,
            "completion_rate": cr,
            "on_time_rate": otr,
            "current_score": sc,
            "last_activity_at": r.last_activity_at.isoformat() if r.last_activity_at else None,
        })
        if cr is not None:
            total_completion.append(cr)
        if otr is not None:
            total_on_time.append(otr)
        if sc is not None:
            total_scores.append(sc)

    # Attendance
    attendance_summary = await get_student_attendance_summary(db, user_id)
    attendance_by_class = await get_student_attendance_by_class(db, user_id)
    recent_attendance = await get_student_recent_attendance(db, user_id, limit=20)

    # Submission stats per course (for academic breakdown)
    submission_stats_stmt = (
        select(
            Submission.course_id,
            func.count(Submission.id).label("total_submissions"),
            func.count(case((Submission.workflow_state == "submitted", 1))).label("submitted"),
            func.count(case((Submission.workflow_state == "graded", 1))).label("graded"),
            func.count(case((Submission.late == True, 1))).label("late_count"),
            func.count(case((Submission.missing == True, 1))).label("missing_count"),
        )
        .where(Submission.user_id == user_id)
        .group_by(Submission.course_id)
    )
    sub_rows = await db.execute(submission_stats_stmt)
    submission_stats = {r.course_id: {
        "total": r.total_submissions,
        "submitted": r.submitted,
        "graded": r.graded,
        "late": r.late_count,
        "missing": r.missing_count,
    } for r in sub_rows.all()}

    # Compute averages (completion/on_time are 0-1 decimals)
    avg_completion = round(sum(total_completion) / len(total_completion), 3) if total_completion else None
    avg_on_time = round(sum(total_on_time) / len(total_on_time), 3) if total_on_time else None
    avg_score = round(sum(total_scores) / len(total_scores), 1) if total_scores else None
    attendance_rate = attendance_summary.get("attendance_rate")

    # Concern flagging — _evaluate_concern expects percentages
    concern = _evaluate_concern(
        round(avg_completion * 100, 1) if avg_completion is not None else None,
        round(avg_on_time * 100, 1) if avg_on_time is not None else None,
        attendance_rate,
        submission_stats,
    )

    return {
        "student": {
            "id": user.id,
            "name": user.name,
            "email": user.email,
            "sis_id": user.sis_id,
            "sortable_name": user.sortable_name,
        },
        "overview": {
            "avg_completion_rate": avg_completion,
            "avg_on_time_rate": avg_on_time,
            "avg_score": avg_score,
            "attendance_rate": attendance_rate,
            "total_courses": len(courses),
        },
        "concern": concern,
        "courses": courses,
        "submission_stats": submission_stats,
        "attendance_summary": attendance_summary,
        "attendance_by_class": attendance_by_class,
        "recent_attendance": recent_attendance,
    }


def _evaluate_concern(
    avg_completion: float | None,
    avg_on_time: float | None,
    attendance_rate: float | None,
    submission_stats: dict,
) -> dict:
    """
    Evaluate whether a student is a 'Student of Concern'.

    Criteria:
    - Low attendance (<75%) AND/OR
    - Low academic completion (<50%) AND/OR
    - High missing assignments (>30% missing across all courses)

    Returns a concern level and contributing reasons.
    """
    reasons = []
    level = "none"  # none, moderate, high

    # Attendance check
    if attendance_rate is not None and attendance_rate < 75:
        reasons.append(f"Low attendance rate ({attendance_rate}%)")
        level = "high" if attendance_rate < 50 else "moderate"

    # Completion check
    if avg_completion is not None and avg_completion < 50:
        reasons.append(f"Low assignment completion ({avg_completion}%)")
        level = "high" if avg_completion < 30 else max(level, "moderate")

    # On-time check
    if avg_on_time is not None and avg_on_time < 50:
        reasons.append(f"Low on-time submission rate ({avg_on_time}%)")
        if level == "none":
            level = "moderate"

    # Missing assignments check
    total_subs = sum(s.get("total", 0) for s in submission_stats.values())
    total_missing = sum(s.get("missing", 0) for s in submission_stats.values())
    if total_subs > 0:
        missing_rate = round(total_missing / total_subs * 100, 1)
        if missing_rate > 30:
            reasons.append(f"High missing assignment rate ({missing_rate}%)")
            level = "high" if missing_rate > 50 else max(level, "moderate")

    # Combined check: both attendance AND academic are poor
    if (attendance_rate is not None and attendance_rate < 75 and
            avg_completion is not None and avg_completion < 60):
        level = "high"
        if "Low attendance and academic engagement" not in reasons:
            reasons.append("Low attendance and academic engagement combined")

    return {
        "is_concern": level != "none",
        "level": level,
        "reasons": reasons,
    }


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def _get_class_roster(db: AsyncSession, class_code: str) -> list[dict]:
    """Get deduplicated student roster for a class code (with amalgamation)."""
    base_code = _get_base_class_code(class_code)
    stmt = (
        select(distinct(User.id).label("id"), User.name, User.email)
        .join(Enrollment, Enrollment.user_id == User.id)
        .join(Course, Course.id == Enrollment.course_id)
        .where(Enrollment.role == "StudentEnrollment")
        .where(Course.course_code.ilike(f"{base_code}%"))
        .order_by(User.name)
    )
    rows = await db.execute(stmt)
    return [{"id": r.id, "name": r.name, "email": r.email} for r in rows.all()]


async def get_all_students_with_stats(db: AsyncSession) -> list[dict]:
    """List all students (enrolled) with aggregated metrics for the Students tab.

    Only includes students enrolled in whitelisted courses so that
    removed / non-current-year courses are excluded from the dashboard.
    """
    whitelist = await get_effective_whitelist(db)

    stmt = (
        select(
            User.id,
            User.name,
            User.email,
            User.sis_id,
            func.count(distinct(Enrollment.course_id)).label("course_count"),
            func.avg(StudentMetrics.completion_rate).label("avg_completion"),
            func.avg(StudentMetrics.on_time_rate).label("avg_on_time"),
            func.avg(StudentMetrics.current_score).label("avg_score"),
        )
        .join(Enrollment, Enrollment.user_id == User.id)
        .outerjoin(
            StudentMetrics,
            and_(
                StudentMetrics.user_id == User.id,
                StudentMetrics.course_id == Enrollment.course_id,
            ),
        )
        .where(Enrollment.role == "StudentEnrollment")
    )
    # Filter to whitelisted courses if whitelist is non-empty
    if whitelist:
        stmt = stmt.where(Enrollment.course_id.in_(whitelist))
    stmt = stmt.group_by(User.id).order_by(User.name)

    rows = await db.execute(stmt)

    # Also fetch attendance rates — only for meetings linked to whitelisted courses
    att_stmt = (
        select(
            AttendanceRecord.user_id,
            func.count(AttendanceRecord.id).label("total"),
            func.count(case((AttendanceRecord.status.in_(["present", "late"]), 1))).label("attended"),
        )
        .join(Meeting, Meeting.id == AttendanceRecord.meeting_id)
    )
    if whitelist:
        att_stmt = att_stmt.where(Meeting.course_id.in_(whitelist))
    att_stmt = att_stmt.group_by(AttendanceRecord.user_id)

    att_rows = await db.execute(att_stmt)
    att_map = {}
    for ar in att_rows.all():
        att_map[ar.user_id] = round(ar.attended / ar.total * 100, 1) if ar.total > 0 else None

    # Fetch enrolled course names per student for filtering
    course_stmt = (
        select(
            Enrollment.user_id,
            Enrollment.course_id,
            Course.name.label("course_name"),
            Course.course_code.label("course_code"),
        )
        .join(Course, Course.id == Enrollment.course_id)
        .where(Enrollment.role == "StudentEnrollment")
    )
    if whitelist:
        course_stmt = course_stmt.where(Enrollment.course_id.in_(whitelist))
    course_rows = await db.execute(course_stmt)
    course_map: dict[int, list[dict]] = {}
    for cr in course_rows.all():
        course_map.setdefault(cr.user_id, []).append(
            {"id": cr.course_id, "name": cr.course_name, "course_code": cr.course_code}
        )

    results = []
    for r in rows.all():
        avg_comp = round(r.avg_completion, 3) if r.avg_completion is not None else None
        avg_ot = round(r.avg_on_time, 3) if r.avg_on_time is not None else None
        avg_sc = round(r.avg_score, 1) if r.avg_score is not None else None
        att_rate = att_map.get(r.id)

        # _evaluate_concern expects percentages; completion/on_time are 0-1 decimals
        concern = _evaluate_concern(
            round(avg_comp * 100, 1) if avg_comp is not None else None,
            round(avg_ot * 100, 1) if avg_ot is not None else None,
            att_rate,
            {},
        )

        results.append({
            "id": r.id,
            "name": r.name,
            "email": r.email,
            "sis_id": r.sis_id,
            "course_count": r.course_count,
            "courses": course_map.get(r.id, []),
            "avg_completion_rate": avg_comp,
            "avg_on_time_rate": avg_ot,
            "avg_score": avg_sc,
            "attendance_rate": att_rate,
            "concern": concern,
        })

    return results


# ---------------------------------------------------------------------------
# Student learning overview — per-platform breakdowns
# ---------------------------------------------------------------------------

async def get_student_learning_overview(db: AsyncSession, user_id: int) -> dict:
    """
    Build per-platform learning data for a student:
    - Canvas assignment group breakdown
    - EdStem module completion breakdown
    - Gradeo exam results with topics/syllabus
    - Computed struggling areas
    """
    whitelist = await get_effective_whitelist(db)
    if not whitelist:
        return {"canvas": {}, "edstem": {}, "gradeo": {}, "struggling_areas": []}

    # Only include courses where the student is actually enrolled
    enrolled_result = await db.execute(
        text("""SELECT course_id FROM enrollments
                WHERE user_id = :uid AND role = 'StudentEnrollment'
                  AND enrollment_state = 'active'
                  AND course_id = ANY(:whitelist)"""),
        {"uid": user_id, "whitelist": whitelist},
    )
    enrolled_ids = [r[0] for r in enrolled_result.fetchall()]
    if not enrolled_ids:
        return {"canvas": {}, "edstem": {}, "gradeo": {}, "struggling_areas": []}

    # ── Canvas: assignment group breakdown ──
    # due_count = assignments already due (used for struggling-areas only)
    canvas_sql = text("""
        SELECT a.course_id, c.name AS course_name, c.course_code,
               a.assignment_group_name,
               COUNT(*) AS total,
               COUNT(*) FILTER (WHERE a.due_at IS NOT NULL AND a.due_at <= NOW()) AS due_count,
               COUNT(*) FILTER (WHERE s.workflow_state IN ('submitted','graded')) AS submitted,
               COUNT(*) FILTER (WHERE s.workflow_state = 'graded') AS graded,
               COUNT(*) FILTER (WHERE s.late = true) AS late,
               COUNT(*) FILTER (WHERE s.missing = true) AS missing,
               ROUND(AVG(s.score) FILTER (WHERE s.score IS NOT NULL)::numeric, 1) AS avg_score,
               ROUND(AVG(a.points_possible) FILTER (WHERE a.points_possible IS NOT NULL)::numeric, 1) AS avg_points_possible
        FROM assignments a
        LEFT JOIN submissions s ON s.assignment_id = a.id AND s.user_id = :user_id
        JOIN courses c ON c.id = a.course_id
        WHERE a.course_id = ANY(:enrolled)
          AND a.workflow_state = 'published'
        GROUP BY a.course_id, c.name, c.course_code, a.assignment_group_name
        ORDER BY a.course_id, a.assignment_group_name
    """)
    canvas_rows = await db.execute(canvas_sql, {"user_id": user_id, "enrolled": enrolled_ids})
    canvas = {}
    canvas_groups_for_struggling = []
    for r in canvas_rows.mappings().all():
        cid = str(r["course_id"])
        if cid not in canvas:
            canvas[cid] = {
                "course_name": r["course_name"],
                "course_code": r["course_code"],
                "groups": [],
            }
        group = {
            "group_name": r["assignment_group_name"] or "Ungrouped",
            "total": r["total"],
            "submitted": r["submitted"],
            "graded": r["graded"],
            "late": r["late"],
            "missing": r["missing"],
            "avg_score": float(r["avg_score"]) if r["avg_score"] is not None else None,
            "avg_points_possible": float(r["avg_points_possible"]) if r["avg_points_possible"] is not None else None,
        }
        canvas[cid]["groups"].append(group)
        canvas_groups_for_struggling.append({
            **group,
            "due_count": r["due_count"],
            "course_name": r["course_name"],
        })

    # ── EdStem: module completion breakdown ──
    edstem_sql = text("""
        SELECT ecm.canvas_course_id AS course_id, c.name AS course_name, c.course_code,
               el.module_name,
               COUNT(*) AS total_lessons,
               COUNT(*) FILTER (WHERE elp.status = 'completed') AS completed,
               COUNT(*) FILTER (WHERE elp.status = 'viewed') AS viewed,
               COUNT(*) FILTER (WHERE elp.status IS NULL OR elp.status = 'not_started') AS not_started
        FROM edstem_course_mappings ecm
        JOIN courses c ON c.id = ecm.canvas_course_id
        JOIN edstem_lessons el ON el.edstem_course_id = ecm.edstem_course_id
        LEFT JOIN edstem_lesson_progress elp ON elp.edstem_lesson_id = el.id AND elp.user_id = :user_id
        WHERE ecm.canvas_course_id = ANY(:enrolled)
        GROUP BY ecm.canvas_course_id, c.name, c.course_code, el.module_name
        ORDER BY ecm.canvas_course_id, el.module_name
    """)
    edstem_rows = await db.execute(edstem_sql, {"user_id": user_id, "enrolled": enrolled_ids})
    edstem = {}
    edstem_modules_for_struggling = []
    for r in edstem_rows.mappings().all():
        cid = str(r["course_id"])
        if cid not in edstem:
            edstem[cid] = {
                "course_name": r["course_name"],
                "course_code": r["course_code"],
                "modules": [],
            }
        mod = {
            "module_name": r["module_name"] or "Uncategorized",
            "total_lessons": r["total_lessons"],
            "completed": r["completed"],
            "viewed": r["viewed"],
            "not_started": r["not_started"],
        }
        edstem[cid]["modules"].append(mod)
        edstem_modules_for_struggling.append({
            **mod,
            "course_name": r["course_name"],
        })

    # ── Gradeo: exam results with topics ──
    gradeo_sql = text("""
        SELECT COALESCE(gar.canvas_course_id, 0) AS course_id,
               COALESCE(c.name, gcea.class_name, 'Gradeo') AS course_name,
               COALESCE(c.course_code, '') AS course_code,
               gcea.exam_name, gcea.syllabus_title, gcea.topics,
               gar.status, gar.exam_mark, gar.marks_available, gar.class_average
        FROM gradeo_assignment_results gar
        JOIN gradeo_class_exam_assignments gcea ON gcea.id = gar.gradeo_class_exam_assignment_id
        LEFT JOIN courses c ON c.id = gar.canvas_course_id
        WHERE gar.user_id = :user_id
          AND (gar.canvas_course_id = ANY(:enrolled) OR gar.canvas_course_id IS NULL)
        ORDER BY COALESCE(gar.canvas_course_id, 0), gcea.exam_name
    """)
    gradeo_rows = await db.execute(gradeo_sql, {"user_id": user_id, "enrolled": enrolled_ids})
    gradeo = {}
    gradeo_exams_for_struggling = []
    for r in gradeo_rows.mappings().all():
        cid = str(r["course_id"])
        if cid not in gradeo:
            gradeo[cid] = {
                "course_name": r["course_name"],
                "course_code": r["course_code"],
                "exams": [],
            }
        topics_raw = r["topics"] or ""
        topics_list = [t.strip() for t in topics_raw.split(",") if t.strip()] if topics_raw else []
        exam = {
            "exam_name": r["exam_name"],
            "syllabus_title": r["syllabus_title"],
            "topics": topics_list,
            "status": r["status"],
            "exam_mark": float(r["exam_mark"]) if r["exam_mark"] is not None else None,
            "marks_available": float(r["marks_available"]) if r["marks_available"] is not None else None,
            "class_average": float(r["class_average"]) if r["class_average"] is not None else None,
        }
        gradeo[cid]["exams"].append(exam)
        gradeo_exams_for_struggling.append({
            **exam,
            "course_name": r["course_name"],
        })

    # ── Compute struggling areas ──
    struggling = []

    # Canvas: groups where submission rate < 50% or score rate < 50%
    # Only consider assignments that are already due (due_count), not future ones
    for g in canvas_groups_for_struggling:
        due = g["due_count"]
        if due == 0:
            continue
        submission_pct = round(g["submitted"] / due * 100)
        score_pct = None
        if g["avg_score"] is not None and g["avg_points_possible"] and g["avg_points_possible"] > 0:
            score_pct = round(g["avg_score"] / g["avg_points_possible"] * 100)

        if submission_pct < 50:
            struggling.append({
                "area": g["group_name"],
                "source": "canvas",
                "course_name": g["course_name"],
                "detail": f"{g['submitted']}/{due} submitted",
                "score_pct": submission_pct,
            })
        elif score_pct is not None and score_pct < 50:
            struggling.append({
                "area": g["group_name"],
                "source": "canvas",
                "course_name": g["course_name"],
                "detail": f"Avg {g['avg_score']}/{g['avg_points_possible']} pts",
                "score_pct": score_pct,
            })

    # EdStem: modules where completion rate < 50%
    for m in edstem_modules_for_struggling:
        if m["total_lessons"] == 0:
            continue
        comp_pct = round(m["completed"] / m["total_lessons"] * 100)
        if comp_pct < 50:
            struggling.append({
                "area": m["module_name"],
                "source": "edstem",
                "course_name": m["course_name"],
                "detail": f"{m['completed']}/{m['total_lessons']} completed",
                "score_pct": comp_pct,
            })

    # Gradeo: exams where mark < 50% of available
    for e in gradeo_exams_for_struggling:
        if e["exam_mark"] is None or e["marks_available"] is None or e["marks_available"] == 0:
            continue
        pct = round(e["exam_mark"] / e["marks_available"] * 100)
        if pct < 50:
            detail = f"{e['exam_mark']}/{e['marks_available']} marks"
            if e["class_average"] is not None:
                detail += f" (class avg {e['class_average']})"
            struggling.append({
                "area": e["exam_name"],
                "source": "gradeo",
                "course_name": e["course_name"],
                "detail": detail,
                "score_pct": pct,
            })

    struggling.sort(key=lambda x: x["score_pct"])

    return {
        "canvas": canvas,
        "edstem": edstem,
        "gradeo": gradeo,
        "struggling_areas": struggling,
    }


# ---------------------------------------------------------------------------
# Student academic breakdown — per-assignment detail by syllabus unit
# ---------------------------------------------------------------------------

async def get_student_academic_breakdown(db: AsyncSession, user_id: int) -> dict:
    """
    Detailed academic progression for a student, grouped by syllabus unit.
    Returns per-assignment status within each Canvas assignment group,
    matched EdStem module progress, and Gradeo exam results.
    """
    whitelist = await get_effective_whitelist(db)
    if not whitelist:
        return {"courses": []}

    # Only enrolled courses
    enrolled_result = await db.execute(
        text("""SELECT course_id FROM enrollments
                WHERE user_id = :uid AND role = 'StudentEnrollment'
                  AND enrollment_state = 'active'
                  AND course_id = ANY(:whitelist)"""),
        {"uid": user_id, "whitelist": whitelist},
    )
    enrolled_ids = [r[0] for r in enrolled_result.fetchall()]
    if not enrolled_ids:
        return {"courses": []}

    # ── Canvas: per-assignment detail ──
    assignments_sql = text("""
        SELECT a.id AS assignment_id, a.course_id, c.name AS course_name, c.course_code,
               a.name AS assignment_name, a.assignment_group_name,
               a.points_possible, a.due_at, a.position,
               s.score, s.workflow_state, s.submitted_at, s.graded_at,
               s.late, s.missing
        FROM assignments a
        LEFT JOIN submissions s ON s.assignment_id = a.id AND s.user_id = :user_id
        JOIN courses c ON c.id = a.course_id
        WHERE a.course_id = ANY(:enrolled)
          AND a.workflow_state = 'published'
        ORDER BY a.course_id, a.assignment_group_name, a.position, a.due_at
    """)
    rows = await db.execute(assignments_sql, {"user_id": user_id, "enrolled": enrolled_ids})

    # Group by course, then by assignment_group_name (syllabus unit)
    courses_map: dict = {}
    for r in rows.mappings().all():
        cid = str(r["course_id"])
        if cid not in courses_map:
            courses_map[cid] = {
                "course_id": r["course_id"],
                "course_name": r["course_name"],
                "course_code": r["course_code"],
                "units": {},
            }
        group = r["assignment_group_name"] or "Ungrouped"
        if group not in courses_map[cid]["units"]:
            courses_map[cid]["units"][group] = {
                "unit_name": group,
                "assignments": [],
                "total": 0,
                "completed": 0,
                "score_sum": 0.0,
                "score_count": 0,
                "points_possible_sum": 0.0,
            }
        unit = courses_map[cid]["units"][group]

        # Determine status
        ws = r["workflow_state"] or ""
        is_due = r["due_at"] is not None and r["due_at"] <= datetime.now(r["due_at"].tzinfo) if r["due_at"] else False
        if ws == "graded":
            status = "graded"
        elif ws == "submitted":
            status = "submitted"
        elif r["missing"]:
            status = "missing"
        elif is_due:
            status = "not_submitted"
        else:
            status = "upcoming"

        assignment = {
            "name": r["assignment_name"],
            "points_possible": r["points_possible"],
            "due_at": r["due_at"].isoformat() if r["due_at"] else None,
            "score": float(r["score"]) if r["score"] is not None else None,
            "status": status,
            "late": bool(r["late"]),
            "submitted_at": r["submitted_at"].isoformat() if r["submitted_at"] else None,
        }
        unit["assignments"].append(assignment)
        unit["total"] += 1
        if status in ("graded", "submitted"):
            unit["completed"] += 1
        if r["score"] is not None:
            unit["score_sum"] += float(r["score"])
            unit["score_count"] += 1
        if r["points_possible"] is not None:
            unit["points_possible_sum"] += float(r["points_possible"])

    # ── EdStem: module progress (same enrolled filter) ──
    edstem_sql = text("""
        SELECT ecm.canvas_course_id AS course_id,
               el.module_name, el.title AS lesson_title,
               elp.status
        FROM edstem_course_mappings ecm
        JOIN edstem_lessons el ON el.edstem_course_id = ecm.edstem_course_id
        LEFT JOIN edstem_lesson_progress elp ON elp.edstem_lesson_id = el.id AND elp.user_id = :user_id
        WHERE ecm.canvas_course_id = ANY(:enrolled)
        ORDER BY ecm.canvas_course_id, el.module_name, el.id
    """)
    edstem_rows = await db.execute(edstem_sql, {"user_id": user_id, "enrolled": enrolled_ids})
    edstem_by_course: dict = {}
    for r in edstem_rows.mappings().all():
        cid = str(r["course_id"])
        if cid not in edstem_by_course:
            edstem_by_course[cid] = {}
        mod_name = r["module_name"] or "Uncategorized"
        if mod_name not in edstem_by_course[cid]:
            edstem_by_course[cid][mod_name] = {
                "module_name": mod_name,
                "lessons": [],
                "total": 0,
                "completed": 0,
                "viewed": 0,
            }
        mod = edstem_by_course[cid][mod_name]
        lesson_status = r["status"] or "not_started"
        mod["lessons"].append({
            "title": r["lesson_title"],
            "status": lesson_status,
        })
        mod["total"] += 1
        if lesson_status == "completed":
            mod["completed"] += 1
        elif lesson_status == "viewed":
            mod["viewed"] += 1

    # ── Gradeo: exam results (same enrolled filter) ──
    gradeo_sql = text("""
        SELECT COALESCE(gar.canvas_course_id, 0) AS course_id,
               gcea.exam_name, gcea.syllabus_title, gcea.topics,
               gar.status, gar.exam_mark, gar.marks_available, gar.class_average
        FROM gradeo_assignment_results gar
        JOIN gradeo_class_exam_assignments gcea ON gcea.id = gar.gradeo_class_exam_assignment_id
        LEFT JOIN courses c ON c.id = gar.canvas_course_id
        WHERE gar.user_id = :user_id
          AND (gar.canvas_course_id = ANY(:enrolled) OR gar.canvas_course_id IS NULL)
        ORDER BY COALESCE(gar.canvas_course_id, 0), gcea.exam_name
    """)
    gradeo_rows = await db.execute(gradeo_sql, {"user_id": user_id, "enrolled": enrolled_ids})
    gradeo_by_course: dict = {}
    for r in gradeo_rows.mappings().all():
        cid = str(r["course_id"])
        if cid not in gradeo_by_course:
            gradeo_by_course[cid] = []
        topics_raw = r["topics"] or ""
        gradeo_by_course[cid].append({
            "exam_name": r["exam_name"],
            "syllabus_title": r["syllabus_title"],
            "topics": [t.strip() for t in topics_raw.split(",") if t.strip()] if topics_raw else [],
            "status": r["status"],
            "exam_mark": float(r["exam_mark"]) if r["exam_mark"] is not None else None,
            "marks_available": float(r["marks_available"]) if r["marks_available"] is not None else None,
            "class_average": float(r["class_average"]) if r["class_average"] is not None else None,
        })

    # ── Assemble final response ──
    courses_list = []
    for cid, cdata in courses_map.items():
        units = []
        for unit in cdata["units"].values():
            avg_score = round(unit["score_sum"] / unit["score_count"], 1) if unit["score_count"] > 0 else None
            avg_possible = round(unit["points_possible_sum"] / unit["total"], 1) if unit["total"] > 0 else None
            units.append({
                "unit_name": unit["unit_name"],
                "assignments": unit["assignments"],
                "total": unit["total"],
                "completed": unit["completed"],
                "avg_score": avg_score,
                "avg_possible": avg_possible,
            })

        courses_list.append({
            "course_id": cdata["course_id"],
            "course_name": cdata["course_name"],
            "course_code": cdata["course_code"],
            "units": units,
            "edstem_modules": list(edstem_by_course.get(cid, {}).values()),
            "gradeo_exams": gradeo_by_course.get(cid, []),
        })

    return {"courses": courses_list}
