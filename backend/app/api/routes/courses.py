import re
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy import bindparam, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.api.deps import require_auth
from app.whitelist import get_effective_whitelist

router = APIRouter(prefix="/courses", tags=["courses"], dependencies=[Depends(require_auth)])


def _natural_sort_key(s: str) -> list:
    """Split string into alternating text and integer parts for human-friendly sorting."""
    return [int(part) if part.isdigit() else part.lower() for part in re.split(r'(\d+)', s)]


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


def _start_of_tomorrow_utc(now: datetime) -> datetime:
    return (now + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)


def _split_csv_list(value: str | None) -> list[str]:
    if not value:
        return []
    return [item.strip() for item in value.split(",") if item.strip()]


def _unmarked_submitted_gradeo_questions(questions: list[dict]) -> list[dict]:
    return [
        question
        for question in questions
        if question.get("answer_submitted")
        and question.get("mark") is None
        and (question.get("marks_available") is None or question.get("marks_available") > 0)
    ]


def _effective_gradeo_result(result_data: dict, questions: list[dict]) -> dict:
    status = result_data["status"]
    exam_mark = result_data["exam_mark"]
    marks_available = result_data["marks_available"]
    submitted_questions = [question for question in questions if question.get("answer_submitted")]

    if (
        status == "awaiting_marking"
        and exam_mark is None
        and submitted_questions
        and not _unmarked_submitted_gradeo_questions(questions)
    ):
        status = "scored"
        exam_mark = sum(question.get("mark") or 0 for question in submitted_questions)
        if marks_available is None:
            marks_available = sum(question.get("marks_available") or 0 for question in questions) or None

    return {
        "status": status,
        "exam_mark": exam_mark,
        "marks_available": marks_available,
        "class_average": result_data["class_average"],
        "questions": questions,
    }


def _predicted_band(score_pct: float) -> int:
    if score_pct >= 0.9:
        return 6
    if score_pct >= 0.8:
        return 5
    if score_pct >= 0.7:
        return 4
    if score_pct >= 0.6:
        return 3
    if score_pct >= 0.5:
        return 2
    return 1


def _topic_confidence(available_marks: float, exam_count: int) -> str:
    if available_marks >= 25 and exam_count >= 3:
        return "high"
    if available_marks >= 10 or exam_count >= 2:
        return "medium"
    return "low"


@router.get("")
async def list_courses(db: AsyncSession = Depends(get_db)):
    """List synced courses with summary stats. Respects DB whitelist, falls back to env var."""
    whitelist = await get_effective_whitelist(db)
    due_now_cutoff = _start_of_tomorrow_utc(datetime.now(timezone.utc))
    base_query = """
        SELECT
            c.id,
            c.name,
            c.course_code,
            c.workflow_state,
            c.synced_at,
            COUNT(DISTINCT e.user_id) AS student_count,
            ROUND(CAST(AVG(due_now_metrics.completion_rate) AS numeric), 3) AS avg_completion_rate,
            ROUND(CAST(AVG(sm.on_time_rate) AS numeric), 3) AS avg_on_time_rate,
            ROUND(CAST(AVG(sm.current_score) AS numeric), 1) AS avg_current_score
        FROM courses c
        LEFT JOIN enrollments e ON e.course_id = c.id AND e.role = 'StudentEnrollment'
        LEFT JOIN student_metrics sm ON sm.course_id = c.id AND sm.user_id = e.user_id
        LEFT JOIN LATERAL (
            SELECT
                CASE
                    WHEN e.user_id IS NULL OR COUNT(a.id) = 0 THEN NULL
                    ELSE 1.0 * SUM(
                        CASE
                            WHEN s.excused = true OR s.workflow_state IN ('graded', 'submitted', 'pending_review') THEN 1
                            ELSE 0
                        END
                    ) / COUNT(a.id)
                END AS completion_rate
            FROM assignments a
            LEFT JOIN submissions s ON s.assignment_id = a.id AND s.user_id = e.user_id
            WHERE a.course_id = c.id
              AND a.workflow_state = 'published'
              AND a.due_at IS NOT NULL
              AND a.due_at < :due_now_cutoff
        ) AS due_now_metrics ON true
    """
    if not whitelist:
        return []

    statement = text(
        base_query
        + """
            WHERE c.id IN :ids
            GROUP BY c.id, c.name, c.course_code, c.workflow_state, c.synced_at
            ORDER BY c.name
        """
    ).bindparams(bindparam("ids", expanding=True))
    result = await db.execute(statement, {"ids": whitelist, "due_now_cutoff": due_now_cutoff})
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
            SELECT id, name, assignment_group_name, assignment_group_id, assignment_group_position, points_possible, due_at, position
            FROM assignments
            WHERE course_id = :course_id AND workflow_state = 'published'
            ORDER BY assignment_group_position IS NULL,
                     assignment_group_position,
                     assignment_group_id IS NULL,
                     assignment_group_id,
                     position IS NULL,
                     position,
                     id
        """),
        {"course_id": course_id},
    )
    assignments_raw = assignment_result.fetchall()

    # Build assignment groups structure
    group_order: list[str] = []
    seen_groups: set = set()
    group_assignments: dict[str, list] = {}

    for a_row in assignments_raw:
        a_id, a_name, ag_name, ag_id, ag_position, points, due_at, position = a_row
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


@router.get("/{course_id}/edstem-matrix")
async def get_edstem_matrix(course_id: int, db: AsyncSession = Depends(get_db)):
    """
    Return the EdStem lesson completion matrix for a course.
    Rows = students, columns = lessons grouped by module.
    Returns {"mapped": false} if no EdStem mapping exists for this course.
    """
    # Verify course exists
    course_result = await db.execute(
        text("SELECT id FROM courses WHERE id = :id"),
        {"id": course_id},
    )
    if not course_result.fetchone():
        raise HTTPException(status_code=404, detail="Course not found")

    # Check for EdStem mapping
    mapping_result = await db.execute(
        text("SELECT edstem_course_id, edstem_course_name FROM edstem_course_mappings WHERE canvas_course_id = :cid"),
        {"cid": course_id},
    )
    mapping_row = mapping_result.fetchone()
    if not mapping_row:
        return {"mapped": False}

    edstem_course_id, edstem_course_name = mapping_row

    # Fetch lessons ordered by module_name, position
    lessons_result = await db.execute(
        text("""
            SELECT id, title, module_id, module_name, is_interactive, position
            FROM edstem_lessons
            WHERE edstem_course_id = :edstem_course_id
            ORDER BY module_name IS NULL, module_name, position IS NULL, position, id
        """),
        {"edstem_course_id": edstem_course_id},
    )
    lessons_raw = lessons_result.fetchall()

    # Build modules structure (like assignment_groups)
    module_order: list[str] = []
    seen_modules: set = set()
    module_lessons: dict[str, list] = {}
    all_lesson_ids: list[int] = []

    for row in lessons_raw:
        l_id, l_title, l_module_id, l_module_name, l_interactive, l_position = row
        module_key = l_module_name or "Uncategorised"
        if module_key not in seen_modules:
            module_order.append(module_key)
            seen_modules.add(module_key)
            module_lessons[module_key] = []
        module_lessons[module_key].append({
            "id": l_id,
            "title": l_title,
            "is_interactive": bool(l_interactive),
        })
        all_lesson_ids.append(l_id)

    modules = [{"name": m, "lessons": module_lessons[m]} for m in module_order]

    # Fetch enrolled students
    students_result = await db.execute(
        text("""
            SELECT u.id, u.name, u.sortable_name
            FROM enrollments e
            JOIN users u ON u.id = e.user_id
            WHERE e.course_id = :course_id AND e.role = 'StudentEnrollment'
            ORDER BY u.sortable_name IS NULL, u.sortable_name
        """),
        {"course_id": course_id},
    )
    students_raw = students_result.fetchall()

    # Fetch all progress records for this EdStem course in one query
    if all_lesson_ids:
        progress_result = await db.execute(
            text("""
                SELECT user_id, edstem_lesson_id, status, completed_at
                FROM edstem_lesson_progress
                WHERE edstem_course_id = :edstem_course_id
            """),
            {"edstem_course_id": edstem_course_id},
        )
        progress_raw = progress_result.fetchall()
    else:
        progress_raw = []

    # Build progress lookup: {user_id: {lesson_id: {status, completed_at}}}
    progress_lookup: dict[int, dict[int, dict]] = {}
    for p_row in progress_raw:
        uid, lid, p_status, p_completed_at = p_row
        if uid not in progress_lookup:
            progress_lookup[uid] = {}
        progress_lookup[uid][lid] = {
            "status": p_status,
            "completed_at": _to_iso(p_completed_at),
        }

    # Build student rows
    students = []
    for s_row in students_raw:
        uid, name, sortable_name = s_row
        user_progress = progress_lookup.get(uid, {})

        progress = {}
        completed_count = 0
        for lid in all_lesson_ids:
            if lid in user_progress:
                p = user_progress[lid]
                progress[str(lid)] = p
                if p["status"] == "completed":
                    completed_count += 1
            else:
                progress[str(lid)] = {"status": "not_started", "completed_at": None}

        completion_rate = (completed_count / len(all_lesson_ids)) if all_lesson_ids else None

        students.append({
            "id": uid,
            "name": name,
            "sortable_name": sortable_name,
            "completion_rate": completion_rate,
            "progress": progress,
        })

    return {
        "mapped": True,
        "edstem_course_id": edstem_course_id,
        "edstem_course_name": edstem_course_name,
        "modules": modules,
        "students": students,
    }


@router.get("/{course_id}/gradeo/topic-bands")
async def get_gradeo_topic_bands(course_id: int, db: AsyncSession = Depends(get_db)):
    mapping_result = await db.execute(
        text(
            """
            SELECT gradeo_class_id, gradeo_class_name
            FROM gradeo_class_mappings
            WHERE canvas_course_id = :course_id
            """
        ),
        {"course_id": course_id},
    )
    mapping_row = mapping_result.fetchone()
    if not mapping_row:
        return {"mapped": False}

    gradeo_class_id, gradeo_class_name = mapping_row

    students_result = await db.execute(
        text(
            """
            SELECT u.id, u.name, u.sortable_name
            FROM enrollments e
            JOIN users u ON u.id = e.user_id
            WHERE e.course_id = :course_id AND e.role = 'StudentEnrollment'
            ORDER BY u.sortable_name IS NULL, u.sortable_name
            """
        ),
        {"course_id": course_id},
    )
    students_raw = students_result.fetchall()
    student_aggregates: dict[int, dict[str, dict]] = {row[0]: {} for row in students_raw}

    evidence_result = await db.execute(
        text(
            """
            SELECT
                gar.user_id,
                gcea.gradeo_marking_session_id,
                gaqr.mark,
                gaqr.marks_available,
                gaqr.topics
            FROM gradeo_assignment_question_results gaqr
            JOIN gradeo_assignment_results gar
              ON gar.gradeo_class_exam_assignment_id = gaqr.gradeo_class_exam_assignment_id
             AND gar.gradeo_student_id = gaqr.gradeo_student_id
            JOIN gradeo_class_exam_assignments gcea
              ON gcea.id = gaqr.gradeo_class_exam_assignment_id
            WHERE gar.canvas_course_id = :course_id
              AND gcea.gradeo_class_id = :gradeo_class_id
              AND gaqr.mark IS NOT NULL
              AND gaqr.marks_available IS NOT NULL
              AND gaqr.marks_available > 0
              AND gaqr.topics IS NOT NULL
              AND gaqr.topics <> ''
            """
        ),
        {"course_id": course_id, "gradeo_class_id": gradeo_class_id},
    )

    topic_student_scores: dict[str, list[float]] = {}
    for row in evidence_result.fetchall():
        user_id, marking_session_id, mark, marks_available, topics_raw = row
        topics = _split_csv_list(topics_raw)
        if not topics:
            continue
        share_count = len(topics)
        earned_share = float(mark) / share_count
        available_share = float(marks_available) / share_count
        for topic in topics:
            topic_data = student_aggregates.setdefault(user_id, {}).setdefault(
                topic,
                {
                    "earned_marks": 0.0,
                    "available_marks": 0.0,
                    "exam_ids": set(),
                    "part_count": 0,
                },
            )
            topic_data["earned_marks"] += earned_share
            topic_data["available_marks"] += available_share
            topic_data["exam_ids"].add(marking_session_id)
            topic_data["part_count"] += 1

    students = []
    for row in students_raw:
        user_id, name, sortable_name = row
        topics = {}
        for topic_name, aggregate in sorted(
            student_aggregates.get(user_id, {}).items(), key=lambda item: _natural_sort_key(item[0])
        ):
            available_marks = aggregate["available_marks"]
            if available_marks <= 0:
                continue
            score_pct = aggregate["earned_marks"] / available_marks
            exam_count = len(aggregate["exam_ids"])
            topics[topic_name] = {
                "score_pct": score_pct,
                "predicted_band": _predicted_band(score_pct),
                "confidence": _topic_confidence(available_marks, exam_count),
                "earned_marks": aggregate["earned_marks"],
                "available_marks": available_marks,
                "exam_count": exam_count,
                "part_count": aggregate["part_count"],
            }
            topic_student_scores.setdefault(topic_name, []).append(score_pct)

        students.append(
            {
                "id": user_id,
                "name": name,
                "sortable_name": sortable_name,
                "topics": topics,
            }
        )

    topics_summary = [
        {
            "name": topic_name,
            "student_count": len(scores),
            "average_score_pct": sum(scores) / len(scores),
        }
        for topic_name, scores in sorted(topic_student_scores.items(), key=lambda item: _natural_sort_key(item[0]))
        if scores
    ]

    return {
        "mapped": True,
        "gradeo_class_id": gradeo_class_id,
        "gradeo_class_name": gradeo_class_name,
        "topics": topics_summary,
        "students": students,
    }


@router.get("/{course_id}/gradeo")
async def get_gradeo_report(course_id: int, db: AsyncSession = Depends(get_db)):
    course_result = await db.execute(
        text("SELECT id, name, course_code FROM courses WHERE id = :id"),
        {"id": course_id},
    )
    course_row = course_result.fetchone()
    if not course_row:
        raise HTTPException(status_code=404, detail="Course not found")

    mapping_result = await db.execute(
        text(
            """
            SELECT gradeo_class_id, gradeo_class_name
            FROM gradeo_class_mappings
            WHERE canvas_course_id = :course_id
            ORDER BY created_at NULLS LAST, id
            """
        ),
        {"course_id": course_id},
    )
    mapping_rows = mapping_result.fetchall()
    if not mapping_rows:
        return {"mapped": False}

    gradeo_classes = [
        {
            "gradeo_class_id": row[0],
            "gradeo_class_name": row[1],
        }
        for row in mapping_rows
    ]
    gradeo_class_ids = [item["gradeo_class_id"] for item in gradeo_classes]
    gradeo_class_id = gradeo_classes[0]["gradeo_class_id"]
    gradeo_class_name = gradeo_classes[0]["gradeo_class_name"]

    latest_run_result = await db.execute(
        text(
            """
            SELECT completed_at, unmatched_students
            FROM (
                SELECT DISTINCT ON (gradeo_class_id)
                    gradeo_class_id,
                    completed_at,
                    unmatched_students
                FROM gradeo_import_runs
                WHERE run_type = 'class_import'
                  AND status = 'completed'
                  AND gradeo_class_id IN :gradeo_class_ids
                ORDER BY gradeo_class_id, id DESC
            ) latest_runs
            """
        ).bindparams(bindparam("gradeo_class_ids", expanding=True)),
        {"gradeo_class_ids": gradeo_class_ids},
    )
    latest_run_rows = latest_run_result.fetchall()
    last_imported_at = max((row[0] for row in latest_run_rows if row[0] is not None), default=None)
    unmatched_students_count = sum(row[1] or 0 for row in latest_run_rows)

    exams_result = await db.execute(
        text(
            """
            SELECT
                id,
                gradeo_marking_session_id,
                exam_name,
                class_average,
                syllabus_title,
                syllabus_grade,
                bands,
                outcomes,
                topics,
                updated_at
            FROM gradeo_class_exam_assignments
            WHERE gradeo_class_id IN :gradeo_class_ids
            ORDER BY exam_name, gradeo_marking_session_id, id
            """
        ).bindparams(bindparam("gradeo_class_ids", expanding=True)),
        {"gradeo_class_ids": gradeo_class_ids},
    )
    exams_raw = exams_result.fetchall()
    exams_by_marking_session: dict[str, dict] = {}
    exam_sort_keys: dict[str, tuple[str, str]] = {}
    exam_tiebreakers: dict[str, tuple[bool, object, int]] = {}
    for row in exams_raw:
        (
            assignment_id,
            gradeo_marking_session_id,
            exam_name,
            class_average,
            syllabus_title,
            syllabus_grade,
            bands,
            outcomes,
            topics,
            updated_at,
        ) = row
        candidate_tiebreaker = (updated_at is not None, updated_at, -assignment_id)
        if (
            gradeo_marking_session_id not in exams_by_marking_session
            or candidate_tiebreaker > exam_tiebreakers[gradeo_marking_session_id]
        ):
            exams_by_marking_session[gradeo_marking_session_id] = {
                "id": gradeo_marking_session_id,
                "name": exam_name,
                "class_average": float(class_average) if class_average is not None else None,
                "syllabus_title": syllabus_title,
                "syllabus_grade": syllabus_grade,
                "bands": _split_csv_list(bands),
                "outcomes": _split_csv_list(outcomes),
                "topics": _split_csv_list(topics),
            }
            exam_tiebreakers[gradeo_marking_session_id] = candidate_tiebreaker
        exam_sort_keys.setdefault(gradeo_marking_session_id, (exam_name, gradeo_marking_session_id))
    exams = [
        exams_by_marking_session[gradeo_marking_session_id]
        for gradeo_marking_session_id in sorted(
            exams_by_marking_session,
            key=lambda key: (_natural_sort_key(exam_sort_keys[key][0]), exam_sort_keys[key][1]),
        )
    ]

    students_result = await db.execute(
        text(
            """
            SELECT u.id, u.name, u.sortable_name
            FROM enrollments e
            JOIN users u ON u.id = e.user_id
            WHERE e.course_id = :course_id AND e.role = 'StudentEnrollment'
            ORDER BY u.sortable_name IS NULL, u.sortable_name
            """
        ),
        {"course_id": course_id},
    )
    students_raw = students_result.fetchall()

    results_result = await db.execute(
        text(
            """
            SELECT
                gar.user_id,
                gcea.gradeo_marking_session_id,
                gar.status,
                gar.exam_mark,
                gar.marks_available,
                gar.class_average,
                gar.gradeo_student_id,
                gar.gradeo_class_exam_assignment_id,
                gar.last_imported_at
            FROM gradeo_assignment_results gar
            JOIN gradeo_class_exam_assignments gcea ON gcea.id = gar.gradeo_class_exam_assignment_id
            WHERE gar.canvas_course_id = :course_id
              AND gcea.gradeo_class_id IN :gradeo_class_ids
            """
        ).bindparams(bindparam("gradeo_class_ids", expanding=True)),
        {"course_id": course_id, "gradeo_class_ids": gradeo_class_ids},
    )
    results_lookup: dict[int, dict[str, dict]] = {}
    question_results_by_key: dict[tuple[int, str], list[dict]] = {}
    assignment_ids: set[int] = set()
    gradeo_student_ids: set[str] = set()
    status_priority = {"not_submitted": 0, "awaiting_marking": 1, "scored": 2}
    for row in results_result.fetchall():
        (
            user_id,
            gradeo_marking_session_id,
            status,
            exam_mark,
            marks_available,
            class_average,
            gradeo_student_id,
            assignment_id,
            last_imported_at,
        ) = row
        gradeo_student_ids.add(gradeo_student_id)
        assignment_ids.add(assignment_id)
        candidate_result = {
            "status": status,
            "exam_mark": float(exam_mark) if exam_mark is not None else None,
            "marks_available": float(marks_available) if marks_available is not None else None,
            "class_average": float(class_average) if class_average is not None else None,
            "gradeo_student_id": gradeo_student_id,
            "assignment_id": assignment_id,
            "last_imported_at": last_imported_at,
        }
        user_results = results_lookup.setdefault(user_id, {})
        existing_result = user_results.get(gradeo_marking_session_id)
        # TODO: Prefer Gradeo's latest student submission/attempt timestamp here once
        # we import it. last_imported_at is only our best available freshness proxy.
        candidate_tiebreaker = (
            last_imported_at is not None,
            last_imported_at,
            status_priority.get(status, 0),
            -assignment_id,
        )
        existing_tiebreaker = (
            existing_result["last_imported_at"] is not None,
            existing_result["last_imported_at"],
            status_priority.get(existing_result["status"], 0),
            -existing_result["assignment_id"],
        ) if existing_result else None
        if existing_tiebreaker is None or candidate_tiebreaker > existing_tiebreaker:
            user_results[gradeo_marking_session_id] = candidate_result

    if gradeo_student_ids and assignment_ids:
        question_result_rows = await db.execute(
            text(
                """
                SELECT
                    gradeo_class_exam_assignment_id,
                    gradeo_student_id,
                    gradeo_question_part_id,
                    question,
                    question_part,
                    mark,
                    marks_available,
                    answer_submitted,
                    feedback,
                    marker_name,
                    question_link,
                    marking_session_link
                FROM gradeo_assignment_question_results
                WHERE gradeo_student_id IN :gradeo_student_ids
                  AND gradeo_class_exam_assignment_id IN :assignment_ids
                ORDER BY gradeo_class_exam_assignment_id, gradeo_question_part_id
                """
            ).bindparams(
                bindparam("gradeo_student_ids", expanding=True),
                bindparam("assignment_ids", expanding=True),
            ),
            {
                "gradeo_student_ids": list(gradeo_student_ids),
                "assignment_ids": list(assignment_ids),
            },
        )
        for row in question_result_rows.fetchall():
            question_results_by_key.setdefault((row[0], row[1]), []).append(
                {
                    "gradeo_question_part_id": row[2],
                    "question": row[3],
                    "question_part": row[4],
                    "mark": float(row[5]) if row[5] is not None else None,
                    "marks_available": float(row[6]) if row[6] is not None else None,
                    "answer_submitted": bool(row[7]),
                    "feedback": row[8],
                    "marker_name": row[9],
                    "question_link": row[10],
                    "marking_session_link": row[11],
                }
            )

    students = []
    hidden_students = []
    for row in students_raw:
        user_id, name, sortable_name = row
        user_results = results_lookup.get(user_id, {})
        results = {}
        completed = 0
        assigned = 0
        for exam in exams:
            result_data = user_results.get(exam["id"])
            if result_data:
                questions = question_results_by_key.get(
                    (result_data["assignment_id"], result_data["gradeo_student_id"]),
                    [],
                )
                effective_result = _effective_gradeo_result(result_data, questions)
                assigned += 1
                if effective_result["status"] != "not_submitted":
                    completed += 1
                results[exam["id"]] = effective_result
            else:
                results[exam["id"]] = None

        if exams and not any(v is not None for v in results.values()):
            hidden_students.append({"id": user_id, "name": name})
            continue

        completion_rate = (completed / assigned) if assigned else None
        students.append(
            {
                "id": user_id,
                "name": name,
                "sortable_name": sortable_name,
                "completion_rate": completion_rate,
                "results": results,
            }
        )

    return {
        "mapped": True,
        "gradeo_class_id": gradeo_class_id,
        "gradeo_class_name": gradeo_class_name,
        "gradeo_classes": gradeo_classes,
        "last_imported_at": _to_iso(last_imported_at),
        "unmatched_students_count": unmatched_students_count,
        "exams": exams,
        "students": students,
        "hidden_students": hidden_students,
    }
