"""Read-only data tools exposed to the Gemini assistant via function calling.

Each tool is an async function ``(db, **args) -> dict`` that returns a small,
JSON-serialisable summary of analytics data. They deliberately reuse the
existing service/route layer so the assistant sees exactly the same numbers as
the dashboard. Everything here is read-only — the assistant can never mutate
data.

``TOOL_DECLARATIONS`` is the list of Gemini ``FunctionDeclaration`` schemas and
``TOOL_IMPLEMENTATIONS`` maps tool name -> coroutine.
"""
from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.attendance.service import (
    get_all_students_with_stats,
    get_student_profile,
)
from app.api.routes.courses import list_courses, get_course_matrix, _submission_status
from app.whitelist import get_effective_whitelist


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _pct(value) -> str | None:
    """Format a 0-1 decimal as a percent string (0.73 -> '73%')."""
    if value is None:
        return None
    return f"{round(value * 100)}%"


def _score(value) -> str | None:
    """Format a 0-100 score as a percent string."""
    if value is None:
        return None
    return f"{round(value)}%"


async def _resolve_course_id(db: AsyncSession, course_id=None, course_name=None) -> int | None:
    """Resolve a course by explicit id or by a (partial, case-insensitive) name/code.

    Scoped to the effective whitelist so it only matches courses the dashboard
    actually shows — avoids matching stale/non-current sections that linger in
    the courses table but aren't enrolled or whitelisted.
    """
    if course_id is not None:
        return int(course_id)
    if not course_name:
        return None

    whitelist = await get_effective_whitelist(db)
    params: dict = {"q": f"%{course_name.strip().lower()}%"}
    sql = """
        SELECT id FROM courses
        WHERE (LOWER(name) LIKE :q OR LOWER(course_code) LIKE :q)
    """
    if whitelist:
        sql += " AND id = ANY(:wl)"
        params["wl"] = whitelist
    # Shortest matching name first → prefers the most specific/closest match.
    sql += " ORDER BY length(name), name LIMIT 1"

    result = await db.execute(text(sql), params)
    row = result.fetchone()
    return row[0] if row else None


# ---------------------------------------------------------------------------
# Tool implementations
# ---------------------------------------------------------------------------

async def tool_list_courses(db: AsyncSession) -> dict:
    """List all current courses with class-level summary metrics."""
    courses = await list_courses(db)
    return {
        "count": len(courses),
        "courses": [
            {
                "course_id": c["id"],
                "name": c["name"],
                "course_code": c["course_code"],
                "student_count": c["student_count"],
                "avg_completion_rate": _pct(c["avg_completion_rate"]),
                "avg_on_time_rate": _pct(c["avg_on_time_rate"]),
                "avg_score": _score(c["avg_current_score"]),
            }
            for c in courses
        ],
    }


async def tool_find_students(db: AsyncSession, query: str) -> dict:
    """Find students by (partial) name or email. Use this to resolve a name to a student_id."""
    q = (query or "").strip().lower()
    students = await get_all_students_with_stats(db)
    matches = [
        s
        for s in students
        if q in (s["name"] or "").lower() or q in (s["email"] or "").lower()
    ]
    return {
        "query": query,
        "match_count": len(matches),
        "students": [
            {
                "student_id": s["id"],
                "name": s["name"],
                "email": s["email"],
                "courses": [c["name"] for c in s.get("courses", [])],
                "concern_level": s.get("concern", {}).get("level", "none"),
            }
            for s in matches[:25]
        ],
    }


async def tool_get_student_summary(db: AsyncSession, student_id: int) -> dict:
    """Get a full progress summary for one student across all their courses."""
    profile = await get_student_profile(db, int(student_id))
    if not profile:
        return {"error": f"No student found with id {student_id}"}

    overview = profile["overview"]
    concern = profile["concern"]
    att = profile.get("attendance_summary", {})
    return {
        "student": profile["student"],
        "overview": {
            "courses_enrolled": overview["total_courses"],
            "avg_completion_rate": _pct(overview["avg_completion_rate"]),
            "avg_on_time_rate": _pct(overview["avg_on_time_rate"]),
            "avg_score": _score(overview["avg_score"]),
            "attendance_rate": (
                f"{overview['attendance_rate']}%"
                if overview.get("attendance_rate") is not None
                else None
            ),
        },
        "concern": {
            "level": concern.get("level", "none"),
            "reasons": concern.get("reasons", []),
        },
        "attendance": {
            "total_meetings": att.get("total_meetings"),
            "present": att.get("present"),
            "late": att.get("late"),
            "absent": att.get("absent"),
        },
        "per_course": [
            {
                "course_name": c["course_name"],
                "completion_rate": _pct(c["completion_rate"]),
                "on_time_rate": _pct(c["on_time_rate"]),
                "current_score": _score(c["current_score"]),
                "last_activity_at": c["last_activity_at"],
            }
            for c in profile["courses"]
        ],
    }


async def tool_get_class_summary(db: AsyncSession, course_id=None, course_name=None) -> dict:
    """Summarise how a whole class/course is doing, including students who are struggling."""
    resolved = await _resolve_course_id(db, course_id, course_name)
    if resolved is None:
        return {"error": "Could not find a course matching that name. Try list_courses first."}

    matrix = await get_course_matrix(resolved, db)
    students = matrix["students"]

    completions = [s["metrics"]["completion_rate"] for s in students if s["metrics"]["completion_rate"] is not None]
    on_times = [s["metrics"]["on_time_rate"] for s in students if s["metrics"]["on_time_rate"] is not None]
    scores = [s["metrics"]["current_score"] for s in students if s["metrics"]["current_score"] is not None]

    def avg(values):
        return sum(values) / len(values) if values else None

    # Students who appear to be struggling: low completion or low score.
    struggling = []
    for s in students:
        m = s["metrics"]
        cr = m["completion_rate"]
        sc = m["current_score"]
        if (cr is not None and cr < 0.6) or (sc is not None and sc < 50):
            struggling.append(
                {
                    "student_id": s["id"],
                    "name": s["name"],
                    "completion_rate": _pct(cr),
                    "current_score": _score(sc),
                }
            )

    assignments = [a["name"] for g in matrix["assignment_groups"] for a in g["assignments"]]

    return {
        "course_id": matrix["course_id"],
        "course_name": matrix["course_name"],
        "course_code": matrix["course_code"],
        "student_count": len(students),
        "assignment_count": len(assignments),
        "class_averages": {
            "completion_rate": _pct(avg(completions)),
            "on_time_rate": _pct(avg(on_times)),
            "score": _score(avg(scores)),
        },
        "struggling_students": struggling[:25],
        "assignments": assignments,
    }


async def tool_get_task_completion(db: AsyncSession, course_id=None, course_name=None, task_name: str = "") -> dict:
    """For a given assignment/task in a course, list who has and has not completed it."""
    resolved = await _resolve_course_id(db, course_id, course_name)
    if resolved is None:
        return {"error": "Could not find a course matching that name. Try list_courses first."}

    matrix = await get_course_matrix(resolved, db)

    # Find the assignment by (partial, case-insensitive) name.
    all_assignments = [a for g in matrix["assignment_groups"] for a in g["assignments"]]
    q = (task_name or "").strip().lower()
    target = None
    if q:
        for a in all_assignments:
            if q in (a["name"] or "").lower():
                target = a
                break
    if target is None:
        return {
            "error": f"Could not find a task matching '{task_name}' in this course.",
            "available_tasks": [a["name"] for a in all_assignments],
        }

    aid = str(target["id"])
    completed, submitted_not_graded, not_started = [], [], []
    for s in matrix["students"]:
        sub = s["submissions"].get(aid, {})
        status = sub.get("status", "not_started")
        entry = {"student_id": s["id"], "name": s["name"], "score": sub.get("score")}
        if status in ("completed", "excused"):
            completed.append(entry)
        elif status == "in_progress":
            submitted_not_graded.append(entry)
        else:
            not_started.append(entry)

    total = len(matrix["students"])
    done = len(completed) + len(submitted_not_graded)
    return {
        "course_name": matrix["course_name"],
        "task_name": target["name"],
        "due_at": target.get("due_at"),
        "summary": f"{done}/{total} students have submitted",
        "completed": completed,
        "submitted_not_graded": submitted_not_graded,
        "not_started": not_started,
    }


async def tool_list_students_needing_attention(db: AsyncSession, course_name: str | None = None) -> dict:
    """List students flagged as a concern (medium/high), optionally filtered to one course."""
    students = await get_all_students_with_stats(db)
    cn = (course_name or "").strip().lower()
    flagged = []
    for s in students:
        level = s.get("concern", {}).get("level", "none")
        if level not in ("medium", "high"):
            continue
        if cn and not any(cn in (c["name"] or "").lower() for c in s.get("courses", [])):
            continue
        flagged.append(
            {
                "student_id": s["id"],
                "name": s["name"],
                "concern_level": level,
                "reasons": s.get("concern", {}).get("reasons", []),
                "avg_completion_rate": _pct(s.get("avg_completion_rate")),
                "avg_score": _score(s.get("avg_score")),
                "attendance_rate": (
                    f"{s['attendance_rate']}%" if s.get("attendance_rate") is not None else None
                ),
            }
        )
    # Sort high concern first.
    flagged.sort(key=lambda x: 0 if x["concern_level"] == "high" else 1)
    return {"count": len(flagged), "students": flagged[:50]}


async def tool_get_student_tasks(
    db: AsyncSession,
    student_id: int,
    course_query: str | None = None,
    task_query: str | None = None,
    status: str | None = None,
) -> dict:
    """List one student's individual assignments/tasks and their completion status.

    Optionally filter to a course (by name or code, e.g. 'ENC'), to tasks whose
    name matches (e.g. 'cycle quiz'), and/or to a status. Answers questions like
    "which cycle quizzes has Holly not done?". Results are grouped by course.
    """
    whitelist = await get_effective_whitelist(db)
    params: dict = {"uid": int(student_id)}
    sql = """
        SELECT c.course_code, c.name AS course_name,
               a.name AS task_name, a.due_at,
               s.workflow_state, s.score, s.excused
        FROM enrollments e
        JOIN courses c ON c.id = e.course_id
        JOIN assignments a ON a.course_id = c.id AND a.workflow_state = 'published'
        LEFT JOIN submissions s ON s.assignment_id = a.id AND s.user_id = e.user_id
        WHERE e.user_id = :uid AND e.role = 'StudentEnrollment'
    """
    if whitelist:
        sql += " AND c.id = ANY(:wl)"
        params["wl"] = whitelist
    if course_query:
        sql += " AND (c.name ILIKE :cq OR c.course_code ILIKE :cq)"
        params["cq"] = f"%{course_query.strip()}%"
    if task_query:
        sql += " AND a.name ILIKE :tq"
        params["tq"] = f"%{task_query.strip()}%"
    sql += " ORDER BY c.name, a.due_at NULLS LAST, a.name"

    rows = (await db.execute(text(sql), params)).fetchall()

    want = (status or "").strip().lower()
    incomplete_aliases = {"incomplete", "not_done", "not done", "not_started", "not started", "missing", "outstanding"}
    complete_aliases = {"completed", "complete", "done", "submitted"}

    courses: dict[str, dict] = {}
    for r in rows:
        st = _submission_status(r.workflow_state, r.score, r.excused)
        if want in incomplete_aliases and st not in ("not_started",):
            continue
        if want in complete_aliases and st not in ("completed", "in_progress", "excused"):
            continue
        bucket = courses.setdefault(
            r.course_name,
            {"course_name": r.course_name, "course_code": r.course_code, "tasks": []},
        )
        bucket["tasks"].append({
            "task": r.task_name,
            "status": st,
            "score": r.score,
            "due_at": r.due_at.isoformat() if r.due_at else None,
        })

    result_courses = list(courses.values())
    total = sum(len(c["tasks"]) for c in result_courses)
    if total == 0:
        return {
            "student_id": int(student_id),
            "message": "No matching tasks found for that student with those filters.",
            "courses": [],
        }
    return {"student_id": int(student_id), "task_count": total, "courses": result_courses}


# ---------------------------------------------------------------------------
# Gemini function declarations (JSON schema for each tool)
# ---------------------------------------------------------------------------

TOOL_DECLARATIONS: list[dict] = [
    {
        "name": "list_courses",
        "description": (
            "List all current courses/classes with class-level summary metrics "
            "(student count, average completion rate, on-time rate and score). "
            "Use this to discover course names and ids."
        ),
        "parameters": {"type": "object", "properties": {}},
    },
    {
        "name": "find_students",
        "description": (
            "Find students by partial name or email. Use this first to turn a "
            "student's name into a student_id before calling get_student_summary."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Part of the student's name or email."}
            },
            "required": ["query"],
        },
    },
    {
        "name": "get_student_summary",
        "description": (
            "Get a full progress summary for one student across all of their "
            "courses: averages, per-course breakdown, attendance and concern flags."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "student_id": {"type": "integer", "description": "The student's numeric id."}
            },
            "required": ["student_id"],
        },
    },
    {
        "name": "get_class_summary",
        "description": (
            "Summarise how a whole class/course is doing: class averages, the list "
            "of assignments, and which students appear to be struggling. Provide "
            "either course_id or course_name."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "course_id": {"type": "integer", "description": "The course's numeric id (preferred)."},
                "course_name": {"type": "string", "description": "Part of the course name or code."},
            },
        },
    },
    {
        "name": "get_task_completion",
        "description": (
            "For a specific assignment/task in a course, list which students have "
            "completed it, which have submitted but are not yet graded, and which "
            "have not started. Provide course_id or course_name plus task_name."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "course_id": {"type": "integer", "description": "The course's numeric id (preferred)."},
                "course_name": {"type": "string", "description": "Part of the course name or code."},
                "task_name": {"type": "string", "description": "Part of the assignment/task name."},
            },
            "required": ["task_name"],
        },
    },
    {
        "name": "get_student_tasks",
        "description": (
            "List ONE student's individual assignments/tasks and their completion "
            "status (completed, in_progress, not_started, excused). Use this to "
            "answer questions about which specific tasks a student has or hasn't "
            "done, e.g. 'which cycle quizzes has Holly not done?'. First use "
            "find_students to get the student_id. Optionally filter by course "
            "(name or code), by task name, and by status. Results group by course."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "student_id": {"type": "integer", "description": "The student's numeric id."},
                "course_query": {"type": "string", "description": "Optional course name or code to filter to, e.g. 'ENC' or 'Enterprise Computing'."},
                "task_query": {"type": "string", "description": "Optional task-name filter, e.g. 'cycle quiz' or 'project'."},
                "status": {"type": "string", "description": "Optional status filter: 'incomplete' (not started), 'completed', or omit for all."},
            },
            "required": ["student_id"],
        },
    },
    {
        "name": "list_students_needing_attention",
        "description": (
            "List students flagged as a concern (medium or high) based on low "
            "completion, low scores or poor attendance. Optionally filter to one course."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "course_name": {"type": "string", "description": "Optional: part of a course name to filter by."}
            },
        },
    },
]


TOOL_IMPLEMENTATIONS = {
    "list_courses": tool_list_courses,
    "find_students": tool_find_students,
    "get_student_summary": tool_get_student_summary,
    "get_class_summary": tool_get_class_summary,
    "get_task_completion": tool_get_task_completion,
    "get_student_tasks": tool_get_student_tasks,
    "list_students_needing_attention": tool_list_students_needing_attention,
}
