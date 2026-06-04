"""
Per-entity sync tasks. Each function fetches data from Canvas and upserts
it into the local database page-by-page to keep memory usage low.
"""
import logging
from datetime import datetime, timezone, date as date_type
from typing import Any

from sqlalchemy import text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.canvas.client import CanvasAPIError, CanvasClient
from app.models.submission import Submission

logger = logging.getLogger(__name__)
SUBMISSION_BATCH_SIZE = 500


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _parse_dt(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except (ValueError, AttributeError):
        return None


async def sync_courses(canvas: CanvasClient, db: AsyncSession, whitelist_ids: list[int] | None = None) -> int:
    """Fetch and upsert courses from Canvas, filtered to whitelist IDs."""
    courses = await canvas.list_courses()
    allowed_ids = set(whitelist_ids or [])
    now = _now()
    if allowed_ids:
        courses_by_id = {int(c["id"]): c for c in courses if int(c["id"]) in allowed_ids}
        missing_ids = allowed_ids - set(courses_by_id)
        archived_ids: set[int] = set()

        if missing_ids:
            result = await db.execute(
                text("""
                    SELECT id
                    FROM courses
                    WHERE id = ANY(:ids)
                      AND term_end_at IS NOT NULL
                      AND term_end_at < :now
                """),
                {"ids": list(missing_ids), "now": now},
            )
            archived_ids = {row[0] for row in result.fetchall()}

        for course_id in sorted(missing_ids - archived_ids):
            try:
                course = await canvas.get_course(course_id)
            except CanvasAPIError as exc:
                logger.warning("Could not fetch metadata for whitelisted course %s: %s", course_id, exc)
                continue
            courses_by_id[int(course["id"])] = course

        courses = list(courses_by_id.values())

    for course in courses:
        term = course.get("term") or {}
        await db.execute(
            text("""
                INSERT INTO courses (
                    id, name, course_code, workflow_state, account_id, term_id,
                    term_start_at, term_end_at, total_students, synced_at
                )
                VALUES (
                    :id, :name, :course_code, :workflow_state, :account_id, :term_id,
                    :term_start_at, :term_end_at, :total_students, :synced_at
                )
                ON CONFLICT (id) DO UPDATE SET
                    name = EXCLUDED.name,
                    course_code = EXCLUDED.course_code,
                    workflow_state = EXCLUDED.workflow_state,
                    account_id = EXCLUDED.account_id,
                    term_id = EXCLUDED.term_id,
                    term_start_at = COALESCE(EXCLUDED.term_start_at, courses.term_start_at),
                    term_end_at = COALESCE(EXCLUDED.term_end_at, courses.term_end_at),
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
                "term_start_at": _parse_dt(term.get("start_at")),
                "term_end_at": _parse_dt(term.get("end_at")),
                "total_students": course.get("total_students", 0) or 0,
                "synced_at": now,
            },
        )

    await db.commit()
    return len(courses)


async def sync_enrollments(canvas: CanvasClient, db: AsyncSession, course_id: int, since: str | None = None) -> int:
    """Fetch and upsert active student enrollments for a course, removing any that are no longer in Canvas."""
    count = 0
    now = _now()
    seen_enrollment_ids: list[int] = []

    async for enrollment in canvas.list_enrollments(course_id, since=since):
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

        # Upsert enrollment — use (course_id, user_id, role) for conflict resolution
        # because Canvas can return multiple enrollment records with different IDs
        # for the same student/course/role (e.g. re-enrollments).
        await db.execute(
            text("""
                INSERT INTO enrollments (id, course_id, user_id, role, enrollment_state, last_activity_at,
                    total_activity_time, current_score, current_grade, final_score, final_grade)
                VALUES (:id, :course_id, :user_id, :role, :enrollment_state, :last_activity_at,
                    :total_activity_time, :current_score, :current_grade, :final_score, :final_grade)
                ON CONFLICT (course_id, user_id, role) DO UPDATE SET
                    id = EXCLUDED.id,
                    enrollment_state = EXCLUDED.enrollment_state,
                    last_activity_at = EXCLUDED.last_activity_at,
                    total_activity_time = EXCLUDED.total_activity_time,
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
                "total_activity_time": enrollment.get("total_activity_time"),
                "current_score": grades.get("current_score"),
                "current_grade": grades.get("current_grade"),
                "final_score": grades.get("final_score"),
                "final_grade": grades.get("final_grade"),
            },
        )

        seen_enrollment_ids.append(enrollment["id"])
        count += 1
        if count % 50 == 0:
            await db.commit()  # Commit in batches

    # Remove enrollments that no longer exist in Canvas for this course
    # Only safe during full sync — incremental doesn't see all enrollments
    if not since:
        if seen_enrollment_ids:
            await db.execute(
                text("DELETE FROM enrollments WHERE course_id = :course_id AND id != ALL(:seen_ids)"),
                {"course_id": course_id, "seen_ids": seen_enrollment_ids},
            )
        else:
            await db.execute(
                text("DELETE FROM enrollments WHERE course_id = :course_id"),
                {"course_id": course_id},
            )

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
    group_map: dict[int, dict[str, int | str | None]] = {
        g["id"]: {
            "name": g.get("name"),
            "position": g.get("position"),
        }
        for g in groups
    }

    count = 0
    now = _now()

    async for assignment in canvas.list_assignments(course_id):
        group_id = assignment.get("assignment_group_id")
        group = group_map.get(group_id) if group_id else None
        group_name = group["name"] if group else None
        group_position = group["position"] if group else None

        # Flatten submission_types list to comma-joined string
        sub_types = assignment.get("submission_types", [])
        submission_types_str = ",".join(sub_types) if isinstance(sub_types, list) else str(sub_types)

        await db.execute(
            text("""
                INSERT INTO assignments (id, course_id, name, assignment_group_name, assignment_group_id, assignment_group_position,
                    points_possible, due_at, unlock_at, position, workflow_state, submission_types, synced_at)
                VALUES (:id, :course_id, :name, :assignment_group_name, :assignment_group_id, :assignment_group_position,
                    :points_possible, :due_at, :unlock_at, :position, :workflow_state, :submission_types, :synced_at)
                ON CONFLICT (id) DO UPDATE SET
                    name = EXCLUDED.name,
                    assignment_group_name = EXCLUDED.assignment_group_name,
                    assignment_group_id = EXCLUDED.assignment_group_id,
                    assignment_group_position = EXCLUDED.assignment_group_position,
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
                "assignment_group_position": group_position,
                "points_possible": assignment.get("points_possible"),
                "due_at": _parse_dt(assignment.get("due_at")),
                "unlock_at": _parse_dt(assignment.get("unlock_at")),
                "position": assignment.get("position"),
                "workflow_state": assignment.get("workflow_state"),
                "submission_types": submission_types_str,
                "synced_at": now,
            },
        )

        rubric = assignment.get("rubric", [])
        if rubric and isinstance(rubric, list):
            for idx, criterion in enumerate(rubric):
                crit_id = criterion.get("id")
                if not crit_id:
                    continue
                # Canvas rubric criterion ids are only unique within a rubric, and the same
                # rubric is reused across assignments/sections — so the raw id collides on our
                # global primary key. Namespace it per assignment to keep each assignment's
                # criteria distinct (see migration 0021).
                row_id = f"{assignment['id']}:{crit_id}"
                await db.execute(
                    text("""
                        INSERT INTO rubric_criteria (id, assignment_id, description, long_description, points, position, synced_at)
                        VALUES (:id, :assignment_id, :description, :long_description, :points, :position, :synced_at)
                        ON CONFLICT (id) DO UPDATE SET
                            assignment_id = EXCLUDED.assignment_id,
                            description = EXCLUDED.description,
                            long_description = EXCLUDED.long_description,
                            points = EXCLUDED.points,
                            position = EXCLUDED.position,
                            synced_at = EXCLUDED.synced_at
                    """),
                    {
                        "id": row_id,
                        "assignment_id": assignment["id"],
                        "description": criterion.get("description", ""),
                        "long_description": criterion.get("long_description"),
                        "points": criterion.get("points"),
                        "position": idx,
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
    since: str | None = None,
) -> int:
    """
    Fetch and upsert submissions page-by-page.
    Processes each page immediately to keep memory usage low (~5MB peak).
    """
    count = 0
    now = _now()
    batch: list[dict[str, Any]] = []

    # Load enrolled student IDs to skip submissions for users not in our DB
    result = await db.execute(
        text("SELECT user_id FROM enrollments WHERE course_id = :course_id AND role = 'StudentEnrollment'"),
        {"course_id": course_id},
    )
    enrolled_user_ids = {row[0] for row in result}

    async def flush_batch():
        nonlocal batch
        if not batch:
            return

        stmt = pg_insert(Submission).values(batch)
        stmt = stmt.on_conflict_do_update(
            index_elements=["assignment_id", "user_id"],
            set_={
                "id": stmt.excluded.id,
                "course_id": stmt.excluded.course_id,
                "score": stmt.excluded.score,
                "workflow_state": stmt.excluded.workflow_state,
                "late": stmt.excluded.late,
                "missing": stmt.excluded.missing,
                "excused": stmt.excluded.excused,
                "synced_at": stmt.excluded.synced_at,
            },
        )
        await db.execute(stmt)
        batch = []

    async for submission in canvas.list_submissions(course_id, since=since):
        user_id = submission.get("user_id")
        assignment_id = submission.get("assignment_id")

        if not user_id or not assignment_id or user_id not in enrolled_user_ids:
            continue

        batch.append({
            "id": submission.get("id"),
            "assignment_id": assignment_id,
            "user_id": user_id,
            "course_id": course_id,
            "score": submission.get("score"),
            "workflow_state": submission.get("workflow_state"),
            "late": bool(submission.get("late", False)),
            "missing": bool(submission.get("missing", False)),
            "excused": submission.get("excused"),
            "synced_at": now,
        })

        count += 1
        if len(batch) >= SUBMISSION_BATCH_SIZE:
            await flush_batch()
            await db.commit()

    await flush_batch()
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
                current_score, computed_at)
            SELECT
                e.course_id,
                e.user_id,
                -- completion_rate: % of published assignments with submitted or scored work
                COALESCE(
                    1.0 * SUM(CASE WHEN s.excused = true OR s.workflow_state IN ('submitted', 'pending_review') OR (s.workflow_state = 'graded' AND COALESCE(s.score, 0) > 0) THEN 1 ELSE 0 END) /
                    NULLIF(COUNT(a.id), 0),
                    0
                ) AS completion_rate,
                -- on_time_rate: % of submitted assignments that were not late
                COALESCE(
                    1.0 * SUM(CASE WHEN (s.excused = true OR s.workflow_state IN ('submitted', 'pending_review') OR (s.workflow_state = 'graded' AND COALESCE(s.score, 0) > 0)) AND s.late = false THEN 1 ELSE 0 END) /
                    NULLIF(SUM(CASE WHEN s.excused = true OR s.workflow_state IN ('submitted', 'pending_review') OR (s.workflow_state = 'graded' AND COALESCE(s.score, 0) > 0) THEN 1 ELSE 0 END), 0),
                    0
                ) AS on_time_rate,
                e.current_score,
                :computed_at
            FROM enrollments e
            LEFT JOIN assignments a ON a.course_id = e.course_id AND a.workflow_state = 'published'
            LEFT JOIN submissions s ON s.assignment_id = a.id AND s.user_id = e.user_id
            WHERE e.course_id = :course_id AND e.role = 'StudentEnrollment'
            GROUP BY e.course_id, e.user_id, e.current_score
            ON CONFLICT (course_id, user_id) DO UPDATE SET
                completion_rate = EXCLUDED.completion_rate,
                on_time_rate = EXCLUDED.on_time_rate,
                current_score = EXCLUDED.current_score,
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


async def sync_canvas_engagement(
    canvas: CanvasClient,
    db: AsyncSession,
    course_id: int,
) -> int:
    """
    Fetch and upsert per-student engagement summaries and course-wide daily activity.
    Overwrites the previous snapshot — no historical retention.
    """
    now = _now()
    count = 0

    # Only insert for users we already have in both the users and enrollments tables.
    # student_summaries can include concluded/inactive students not in our users table.
    result = await db.execute(
        text("""
            SELECT e.user_id FROM enrollments e
            JOIN users u ON u.id = e.user_id
            WHERE e.course_id = :course_id AND e.role = 'StudentEnrollment'
        """),
        {"course_id": course_id},
    )
    enrolled_user_ids = {row[0] for row in result}

    # --- Per-student summaries ---
    async for summary in canvas.list_student_summaries(course_id):
        user_id = summary.get("id")
        if not user_id or user_id not in enrolled_user_ids:
            continue

        tardiness = summary.get("tardiness_breakdown", {}) or {}

        await db.execute(
            text("""
                INSERT INTO canvas_engagement (
                    course_id, user_id,
                    page_views, page_views_level, max_page_views,
                    participations, participations_level, max_participations,
                    tardiness_on_time, tardiness_late, tardiness_missing,
                    synced_at
                )
                VALUES (
                    :course_id, :user_id,
                    :page_views, :page_views_level, :max_page_views,
                    :participations, :participations_level, :max_participations,
                    :tardiness_on_time, :tardiness_late, :tardiness_missing,
                    :synced_at
                )
                ON CONFLICT (course_id, user_id) DO UPDATE SET
                    page_views = EXCLUDED.page_views,
                    page_views_level = EXCLUDED.page_views_level,
                    max_page_views = EXCLUDED.max_page_views,
                    participations = EXCLUDED.participations,
                    participations_level = EXCLUDED.participations_level,
                    max_participations = EXCLUDED.max_participations,
                    tardiness_on_time = EXCLUDED.tardiness_on_time,
                    tardiness_late = EXCLUDED.tardiness_late,
                    tardiness_missing = EXCLUDED.tardiness_missing,
                    synced_at = EXCLUDED.synced_at
            """),
            {
                "course_id": course_id,
                "user_id": user_id,
                "page_views": summary.get("page_views"),
                "page_views_level": _to_int(summary.get("page_views_level")),
                "max_page_views": summary.get("max_page_views"),
                "participations": summary.get("participations"),
                "participations_level": _to_int(summary.get("participations_level")),
                "max_participations": summary.get("max_participations"),
                "tardiness_on_time": _to_int(tardiness.get("on_time")),
                "tardiness_late": _to_int(tardiness.get("late")),
                "tardiness_missing": _to_int(tardiness.get("missing")),
                "synced_at": now,
            },
        )
        count += 1
        if count % 50 == 0:
            await db.commit()

    await db.commit()

    # --- Per-student activity timestamps (last page view, last participation) ---
    for user_id in enrolled_user_ids:
        try:
            activity = await canvas.get_student_activity(course_id, user_id)
        except Exception:
            continue

        last_page_view_at = None
        last_participation_at = None

        page_views = activity.get("page_views") if isinstance(activity, dict) else None
        if isinstance(page_views, dict) and page_views:
            last_page_view_at = _parse_dt(max(page_views.keys()))

        participations_list = activity.get("participations") if isinstance(activity, dict) else None
        if isinstance(participations_list, list) and participations_list:
            last_ts = max(p.get("created_at", "") for p in participations_list if p.get("created_at"))
            if last_ts:
                last_participation_at = _parse_dt(last_ts)

        await db.execute(
            text("""
                UPDATE canvas_engagement
                SET last_page_view_at = :last_page_view_at,
                    last_participation_at = :last_participation_at
                WHERE course_id = :course_id AND user_id = :user_id
            """),
            {
                "course_id": course_id,
                "user_id": user_id,
                "last_page_view_at": last_page_view_at,
                "last_participation_at": last_participation_at,
            },
        )

    await db.commit()

    # --- Course-wide daily activity timeseries ---
    daily_rows = await canvas.get_course_activity(course_id)
    for row in daily_rows:
        raw_date = row.get("date")
        if not raw_date:
            continue
        try:
            parsed_date = date_type.fromisoformat(str(raw_date))
        except (ValueError, TypeError):
            continue
        await db.execute(
            text("""
                INSERT INTO canvas_course_activity (course_id, date, views, participations)
                VALUES (:course_id, :date, :views, :participations)
                ON CONFLICT (course_id, date) DO UPDATE SET
                    views = EXCLUDED.views,
                    participations = EXCLUDED.participations
            """),
            {
                "course_id": course_id,
                "date": parsed_date,
                "views": row.get("views"),
                "participations": row.get("participations"),
            },
        )

    await db.commit()
    return count


def _to_int(value: Any) -> int | None:
    """Coerce Canvas page_views_level / participations_level (may be str or int) to int."""
    if value is None:
        return None
    try:
        return int(value)
    except (ValueError, TypeError):
        return None
