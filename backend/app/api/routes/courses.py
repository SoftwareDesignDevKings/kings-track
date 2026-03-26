from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy import bindparam, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.api.deps import require_auth

router = APIRouter(prefix="/courses", tags=["courses"], dependencies=[Depends(require_auth)])


def _to_iso(value):
    if value is None:
        return None
    return value.isoformat() if hasattr(value, "isoformat") else str(value)


def _submission_status(workflow_state: str | None, score, excused: bool | None) -> str:
    """Map Canvas submission workflow_state to UI display status."""
    if excused:
        return "excused"
    if workflow_state == "graded":
        return "completed"
    if workflow_state in ("submitted", "pending_review"):
        return "in_progress"
    return "not_started"


@router.get("")
async def list_courses(db: AsyncSession = Depends(get_db)):
    """List synced courses with summary stats. Respects DB whitelist, falls back to env var."""
    wl_rows = await db.execute(text("SELECT course_id FROM course_whitelist"))
    whitelist = [r[0] for r in wl_rows.fetchall()]
    base_query = """
        SELECT
            c.id,
            c.name,
            c.course_code,
            c.workflow_state,
            c.synced_at,
            COUNT(DISTINCT e.user_id) AS student_count,
            ROUND(CAST(AVG(sm.completion_rate) AS numeric), 3) AS avg_completion_rate,
            ROUND(CAST(AVG(sm.on_time_rate) AS numeric), 3) AS avg_on_time_rate,
            ROUND(CAST(AVG(sm.current_score) AS numeric), 1) AS avg_current_score
        FROM courses c
        LEFT JOIN enrollments e ON e.course_id = c.id AND e.role = 'StudentEnrollment'
        LEFT JOIN student_metrics sm ON sm.course_id = c.id AND sm.user_id = e.user_id
    """
    if whitelist:
        statement = text(
            base_query
            + """
                WHERE c.id IN :ids
                GROUP BY c.id, c.name, c.course_code, c.workflow_state, c.synced_at
                ORDER BY c.name
            """
        ).bindparams(bindparam("ids", expanding=True))
        result = await db.execute(statement, {"ids": whitelist})
    else:
        result = await db.execute(
            text(
                base_query
                + """
                    GROUP BY c.id, c.name, c.course_code, c.workflow_state, c.synced_at
                    ORDER BY c.name
                """
            )
        )
    rows = result.fetchall()

    return [
        {
            "id": row[0],
            "name": row[1],
            "course_code": row[2],
            "workflow_state": row[3],
            "last_synced": _to_iso(row[4]),
            "student_count": row[5] or 0,
            "avg_completion_rate": float(row[6]) if row[6] is not None else None,
            "avg_on_time_rate": float(row[7]) if row[7] is not None else None,
            "avg_current_score": float(row[8]) if row[8] is not None else None,
        }
        for row in rows
    ]


@router.get("/{course_id}")
async def get_course(course_id: int, db: AsyncSession = Depends(get_db)):
    """Get a single course with student and assignment counts."""
    result = await db.execute(
        text("""
            SELECT c.id, c.name, c.course_code, c.workflow_state, c.synced_at,
                   COUNT(DISTINCT e.user_id) AS student_count,
                   COUNT(DISTINCT a.id) AS assignment_count
            FROM courses c
            LEFT JOIN enrollments e ON e.course_id = c.id AND e.role = 'StudentEnrollment'
            LEFT JOIN assignments a ON a.course_id = c.id AND a.workflow_state = 'published'
            WHERE c.id = :course_id
            GROUP BY c.id, c.name, c.course_code, c.workflow_state, c.synced_at
        """),
        {"course_id": course_id},
    )
    row = result.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Course not found")

    return {
        "id": row[0],
        "name": row[1],
        "course_code": row[2],
        "workflow_state": row[3],
        "last_synced": _to_iso(row[4]),
        "student_count": row[5] or 0,
        "assignment_count": row[6] or 0,
    }


@router.get("/{course_id}/matrix")
async def get_course_matrix(course_id: int, db: AsyncSession = Depends(get_db)):
    """
    Return the activity completion matrix for a course.
    Rows = students, keyed by assignment ID with submission status.
    """
    # Verify course exists
    course_result = await db.execute(
        text("SELECT id, name, course_code FROM courses WHERE id = :id"),
        {"id": course_id},
    )
    course_row = course_result.fetchone()
    if not course_row:
        raise HTTPException(status_code=404, detail="Course not found")

    # Fetch assignments with group info (ordered)
    assignment_result = await db.execute(
        text("""
            SELECT id, name, assignment_group_name, assignment_group_id, points_possible, due_at, position
            FROM assignments
            WHERE course_id = :course_id AND workflow_state = 'published'
            ORDER BY assignment_group_id IS NULL, assignment_group_id, position IS NULL, position, id
        """),
        {"course_id": course_id},
    )
    assignments_raw = assignment_result.fetchall()

    # Build assignment groups structure
    group_order: list[str] = []
    seen_groups: set = set()
    group_assignments: dict[str, list] = {}

    for a_row in assignments_raw:
        a_id, a_name, ag_name, ag_id, points, due_at, position = a_row
        group_key = ag_name or "Uncategorised"
        if group_key not in seen_groups:
            group_order.append(group_key)
            seen_groups.add(group_key)
            group_assignments[group_key] = []
        group_assignments[group_key].append({
            "id": a_id,
            "name": a_name,
            "points_possible": points,
            "due_at": _to_iso(due_at),
        })

    assignment_groups = [
        {"name": g, "assignments": group_assignments[g]}
        for g in group_order
    ]

    # Fetch all students with their metrics
    students_result = await db.execute(
        text("""
            SELECT u.id, u.name, u.sortable_name,
                   sm.completion_rate, sm.on_time_rate, sm.current_score
            FROM enrollments e
            JOIN users u ON u.id = e.user_id
            LEFT JOIN student_metrics sm ON sm.user_id = e.user_id AND sm.course_id = e.course_id
            WHERE e.course_id = :course_id AND e.role = 'StudentEnrollment'
            ORDER BY u.sortable_name IS NULL, u.sortable_name
        """),
        {"course_id": course_id},
    )
    students_raw = students_result.fetchall()

    # Fetch all submissions for this course in one query
    submissions_result = await db.execute(
        text("""
            SELECT user_id, assignment_id, workflow_state, score, late, missing, excused
            FROM submissions
            WHERE course_id = :course_id
        """),
        {"course_id": course_id},
    )
    submissions_raw = submissions_result.fetchall()

    # Build submission lookup: {user_id: {assignment_id: {...}}}
    sub_lookup: dict[int, dict[int, dict]] = {}
    for s_row in submissions_raw:
        uid, aid, ws, score, late, missing, excused = s_row
        if uid not in sub_lookup:
            sub_lookup[uid] = {}
        sub_lookup[uid][aid] = {
            "status": _submission_status(ws, score, excused),
            "score": score,
            "late": bool(late),
            "missing": bool(missing),
        }

    # Build student rows
    all_assignment_ids = [a["id"] for g in assignment_groups for a in g["assignments"]]
    students = []
    for s_row in students_raw:
        uid, name, sortable_name, completion_rate, on_time_rate, current_score = s_row
        user_subs = sub_lookup.get(uid, {})

        submissions = {}
        for aid in all_assignment_ids:
            if aid in user_subs:
                submissions[str(aid)] = user_subs[aid]
            else:
                submissions[str(aid)] = {
                    "status": "not_started",
                    "score": None,
                    "late": False,
                    "missing": False,
                }

        students.append({
            "id": uid,
            "name": name,
            "sortable_name": sortable_name,
            "submissions": submissions,
            "metrics": {
                "completion_rate": float(completion_rate) if completion_rate is not None else None,
                "on_time_rate": float(on_time_rate) if on_time_rate is not None else None,
                "current_score": float(current_score) if current_score is not None else None,
            },
        })

    return {
        "course_id": course_id,
        "course_name": course_row[1],
        "course_code": course_row[2],
        "assignment_groups": assignment_groups,
        "students": students,
    }
