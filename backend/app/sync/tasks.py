"""
Per-entity sync tasks. Each function fetches data from Canvas and upserts
it into the local database page-by-page to keep memory usage low.
"""
import logging
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.canvas.client import CanvasClient
from app.config import settings

logger = logging.getLogger(__name__)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _parse_dt(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except (ValueError, AttributeError):
        return None


async def sync_courses(canvas: CanvasClient, db: AsyncSession) -> int:
    """Fetch and upsert courses. If a whitelist is configured, only those IDs are stored."""
    courses = await canvas.list_courses()
    whitelist = settings.course_whitelist
    if whitelist:
        all_count = len(courses)
        courses = [c for c in courses if c["id"] in whitelist]
        logger.info("Whitelist active — syncing %d of %d available courses", len(courses), all_count)
    now = _now()

    for course in courses:
        await db.execute(
            text("""
                INSERT INTO courses (id, name, course_code, workflow_state, account_id, term_id, total_students, synced_at)
                VALUES (:id, :name, :course_code, :workflow_state, :account_id, :term_id, :total_students, :synced_at)
                ON CONFLICT (id) DO UPDATE SET
                    name = EXCLUDED.name,
                    course_code = EXCLUDED.course_code,
                    workflow_state = EXCLUDED.workflow_state,
                    account_id = EXCLUDED.account_id,
                    term_id = EXCLUDED.term_id,
                    total_students = EXCLUDED.total_students,
                    synced_at = EXCLUDED.synced_at
            """),
            {
                "id": course["id"],
                "name": course.get("name", ""),
                "course_code": course.get("course_code"),
                "workflow_state": course.get("workflow_state"),
                "account_id": course.get("account_id"),
                "term_id": course.get("enrollment_term_id"),
                "total_students": course.get("total_students", 0) or 0,
                "synced_at": now,
            },
        )

    await db.commit()
    return len(courses)


async def sync_enrollments(canvas: CanvasClient, db: AsyncSession, course_id: int) -> int:
    """Fetch and upsert active student enrollments for a course."""
    count = 0
    now = _now()

    async for enrollment in canvas.list_enrollments(course_id):
        user = enrollment.get("user", {})
        grades = enrollment.get("grades", {})

        # Upsert user first
        await db.execute(
            text("""
                INSERT INTO users (id, name, sortable_name, email, sis_id)
                VALUES (:id, :name, :sortable_name, :email, :sis_id)
                ON CONFLICT (id) DO UPDATE SET
                    name = EXCLUDED.name,
                    sortable_name = EXCLUDED.sortable_name,
                    email = EXCLUDED.email,
                    sis_id = EXCLUDED.sis_id
            """),
            {
                "id": user.get("id"),
                "name": user.get("name", "Unknown"),
                "sortable_name": user.get("sortable_name"),
                "email": user.get("email"),
                "sis_id": user.get("sis_user_id") or str(user.get("id", "")),
            },
        )

        # Upsert enrollment
        await db.execute(
            text("""
                INSERT INTO enrollments (id, course_id, user_id, role, enrollment_state, last_activity_at,
                    current_score, current_grade, final_score, final_grade)
                VALUES (:id, :course_id, :user_id, :role, :enrollment_state, :last_activity_at,
                    :current_score, :current_grade, :final_score, :final_grade)
                ON CONFLICT (id) DO UPDATE SET
                    enrollment_state = EXCLUDED.enrollment_state,
                    last_activity_at = EXCLUDED.last_activity_at,
                    current_score = EXCLUDED.current_score,
                    current_grade = EXCLUDED.current_grade,
                    final_score = EXCLUDED.final_score,
                    final_grade = EXCLUDED.final_grade
            """),
            {
                "id": enrollment["id"],
                "course_id": course_id,
                "user_id": user.get("id"),
                "role": enrollment.get("type"),
                "enrollment_state": enrollment.get("enrollment_state"),
                "last_activity_at": _parse_dt(enrollment.get("last_activity_at")),
                "current_score": grades.get("current_score"),
                "current_grade": grades.get("current_grade"),
                "final_score": grades.get("final_score"),
                "final_grade": grades.get("final_grade"),
            },
        )

        count += 1
        if count % 50 == 0:
            await db.commit()  # Commit in batches

    await db.commit()
    return count


async def sync_assignments(
    canvas: CanvasClient,
    db: AsyncSession,
    course_id: int,
) -> int:
    """Fetch and upsert assignments, resolving group names."""
    # First get group name map
    groups = await canvas.list_assignment_groups(course_id)
    group_name_map: dict[int, str] = {g["id"]: g["name"] for g in groups}

    count = 0
    now = _now()

    async for assignment in canvas.list_assignments(course_id):
        group_id = assignment.get("assignment_group_id")
        group_name = group_name_map.get(group_id) if group_id else None

        # Flatten submission_types list to comma-joined string
        sub_types = assignment.get("submission_types", [])
        submission_types_str = ",".join(sub_types) if isinstance(sub_types, list) else str(sub_types)

        await db.execute(
            text("""
                INSERT INTO assignments (id, course_id, name, assignment_group_name, assignment_group_id,
                    points_possible, due_at, unlock_at, position, workflow_state, submission_types, synced_at)
                VALUES (:id, :course_id, :name, :assignment_group_name, :assignment_group_id,
                    :points_possible, :due_at, :unlock_at, :position, :workflow_state, :submission_types, :synced_at)
                ON CONFLICT (id) DO UPDATE SET
                    name = EXCLUDED.name,
                    assignment_group_name = EXCLUDED.assignment_group_name,
                    assignment_group_id = EXCLUDED.assignment_group_id,
                    points_possible = EXCLUDED.points_possible,
                    due_at = EXCLUDED.due_at,
                    unlock_at = EXCLUDED.unlock_at,
                    position = EXCLUDED.position,
                    workflow_state = EXCLUDED.workflow_state,
                    submission_types = EXCLUDED.submission_types,
                    synced_at = EXCLUDED.synced_at
            """),
            {
                "id": assignment["id"],
                "course_id": course_id,
                "name": assignment.get("name", ""),
                "assignment_group_name": group_name,
                "assignment_group_id": group_id,
                "points_possible": assignment.get("points_possible"),
                "due_at": _parse_dt(assignment.get("due_at")),
                "unlock_at": _parse_dt(assignment.get("unlock_at")),
                "position": assignment.get("position"),
                "workflow_state": assignment.get("workflow_state"),
                "submission_types": submission_types_str,
                "synced_at": now,
            },
        )

        count += 1
        if count % 50 == 0:
            await db.commit()

    await db.commit()
    return count


async def sync_submissions(
    canvas: CanvasClient,
    db: AsyncSession,
    course_id: int,
) -> int:
    """
    Fetch and upsert submissions page-by-page.
    Processes each page immediately to keep memory usage low (~5MB peak).
    """
    count = 0
    now = _now()

    # Load enrolled student IDs to skip submissions for users not in our DB
    result = await db.execute(
        text("SELECT user_id FROM enrollments WHERE course_id = :course_id AND role = 'StudentEnrollment'"),
        {"course_id": course_id},
    )
    enrolled_user_ids = {row[0] for row in result}

    async for submission in canvas.list_submissions(course_id):
        user_id = submission.get("user_id")
        assignment_id = submission.get("assignment_id")

        if not user_id or not assignment_id or user_id not in enrolled_user_ids:
            continue

        await db.execute(
            text("""
                INSERT INTO submissions (id, assignment_id, user_id, course_id, score, grade,
                    workflow_state, submitted_at, graded_at, late, missing, excused, attempt, synced_at)
                VALUES (:id, :assignment_id, :user_id, :course_id, :score, :grade,
                    :workflow_state, :submitted_at, :graded_at, :late, :missing, :excused, :attempt, :synced_at)
                ON CONFLICT (assignment_id, user_id) DO UPDATE SET
                    score = EXCLUDED.score,
                    grade = EXCLUDED.grade,
                    workflow_state = EXCLUDED.workflow_state,
                    submitted_at = EXCLUDED.submitted_at,
                    graded_at = EXCLUDED.graded_at,
                    late = EXCLUDED.late,
                    missing = EXCLUDED.missing,
                    excused = EXCLUDED.excused,
                    attempt = EXCLUDED.attempt,
                    synced_at = EXCLUDED.synced_at
            """),
            {
                "id": submission.get("id"),
                "assignment_id": assignment_id,
                "user_id": user_id,
                "course_id": course_id,
                "score": submission.get("score"),
                "grade": submission.get("grade"),
                "workflow_state": submission.get("workflow_state"),
                "submitted_at": _parse_dt(submission.get("submitted_at")),
                "graded_at": _parse_dt(submission.get("graded_at")),
                "late": bool(submission.get("late", False)),
                "missing": bool(submission.get("missing", False)),
                "excused": submission.get("excused"),
                "attempt": submission.get("attempt"),
                "synced_at": now,
            },
        )

        count += 1
        if count % 100 == 0:
            await db.commit()  # Commit each page's worth of records

    await db.commit()
    return count


async def compute_metrics(db: AsyncSession, course_id: int) -> int:
    """
    Compute per-student metrics for a course using DB aggregation.
    Pure SQL — no API calls, minimal memory usage.
    """
    now = _now()

    # Upsert metrics for all active students in the course
    await db.execute(
        text("""
            INSERT INTO student_metrics (course_id, user_id, completion_rate, on_time_rate,
                current_score, current_grade, computed_at)
            SELECT
                e.course_id,
                e.user_id,
                -- completion_rate: % of published assignments with any submission
                COALESCE(
                    COUNT(s.id) FILTER (WHERE s.workflow_state != 'unsubmitted')::float /
                    NULLIF(COUNT(a.id), 0),
                    0
                ) AS completion_rate,
                -- on_time_rate: % of submitted assignments that were not late
                COALESCE(
                    COUNT(s.id) FILTER (WHERE s.workflow_state != 'unsubmitted' AND s.late = false)::float /
                    NULLIF(COUNT(s.id) FILTER (WHERE s.workflow_state != 'unsubmitted'), 0),
                    0
                ) AS on_time_rate,
                e.current_score,
                e.current_grade,
                :computed_at
            FROM enrollments e
            JOIN assignments a ON a.course_id = e.course_id AND a.workflow_state = 'published'
            LEFT JOIN submissions s ON s.assignment_id = a.id AND s.user_id = e.user_id
            WHERE e.course_id = :course_id AND e.role = 'StudentEnrollment'
            GROUP BY e.course_id, e.user_id, e.current_score, e.current_grade
            ON CONFLICT (course_id, user_id) DO UPDATE SET
                completion_rate = EXCLUDED.completion_rate,
                on_time_rate = EXCLUDED.on_time_rate,
                current_score = EXCLUDED.current_score,
                current_grade = EXCLUDED.current_grade,
                computed_at = EXCLUDED.computed_at
        """),
        {"course_id": course_id, "computed_at": now},
    )

    result = await db.execute(
        text("SELECT COUNT(*) FROM student_metrics WHERE course_id = :course_id"),
        {"course_id": course_id},
    )
    count = result.scalar() or 0

    await db.commit()
    return count
