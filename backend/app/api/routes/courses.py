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


def _get_course_group_code(course_code: str | None) -> str:
    """Derive course group from code: '11SENX_2026' → '11SEN', '11ENCD1_2026' → '11ENC'."""
    if not course_code:
        return course_code or ""
    code = course_code.strip().upper()
    # Strip optional year suffix (e.g. _2026)
    code = re.sub(r'_\d{4}$', '', code)
    # Extract year prefix + 3-letter subject code, if there's a section suffix
    m = re.match(r'^(\d{1,2}[A-Z]{3})', code)
    if m and len(code) > len(m.group(1)):
        return m.group(1)
    return code



def _to_iso(value):
    if value is None:
        return None
    return value.isoformat() if hasattr(value, "isoformat") else str(value)


def _submission_status(workflow_state: str | None, score, excused: bool | None) -> str:
    """Map Canvas submission workflow_state to UI display status."""
    if excused:
        return "excused"
    if workflow_state == "graded":
        if score == 0:
            return "not_started"
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


async def _get_course_list(db: AsyncSession) -> list[dict]:
    """Shared helper: fetch all whitelisted courses with summary stats."""
    whitelist = await get_effective_whitelist(db)
    if not whitelist:
        return []
    now = datetime.now(timezone.utc)
    due_now_cutoff = _start_of_tomorrow_utc(now)
    base_query = """
        SELECT
            c.id,
            c.name,
            c.course_code,
            c.workflow_state,
            c.synced_at,
            c.term_start_at,
            c.term_end_at,
            CASE
                WHEN c.term_end_at IS NOT NULL AND c.term_end_at < :now THEN true
                ELSE false
            END AS is_archived,
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
                            WHEN s.excused = true OR s.workflow_state IN ('submitted', 'pending_review', 'graded') THEN 1
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
        WHERE c.id IN :ids
        GROUP BY c.id, c.name, c.course_code, c.workflow_state, c.synced_at, c.term_start_at, c.term_end_at
        ORDER BY c.name
    """
    statement = text(base_query).bindparams(bindparam("ids", expanding=True))
    result = await db.execute(statement, {"ids": whitelist, "due_now_cutoff": due_now_cutoff, "now": now})
    return [
        {
            "id": row[0],
            "name": row[1],
            "course_code": row[2],
            "workflow_state": row[3],
            "last_synced": _to_iso(row[4]),
            "term_start_at": _to_iso(row[5]),
            "term_end_at": _to_iso(row[6]),
            "is_archived": bool(row[7]),
            "student_count": row[8] or 0,
            "avg_completion_rate": float(row[9]) if row[9] is not None else None,
            "avg_on_time_rate": float(row[10]) if row[10] is not None else None,
            "avg_current_score": float(row[11]) if row[11] is not None else None,
        }
        for row in result.fetchall()
    ]


@router.get("")
async def list_courses(db: AsyncSession = Depends(get_db)):
    """List synced courses with summary stats. Respects DB whitelist, falls back to env var."""
    return await _get_course_list(db)


@router.get("/groups")
async def list_course_groups(db: AsyncSession = Depends(get_db)):
    """List courses grouped by course group code with aggregate metrics."""
    courses = await _get_course_list(db)

    groups: dict[str, list[dict]] = {}
    for c in courses:
        group_code = _get_course_group_code(c["course_code"])
        groups.setdefault(group_code, []).append(c)

    result = []
    for group_code, classes in sorted(groups.items(), key=lambda x: _natural_sort_key(x[0])):
        total_students = sum(c["student_count"] for c in classes)

        # Student-count-weighted averages
        def _weighted_avg(key: str) -> float | None:
            pairs = [(c[key], c["student_count"]) for c in classes if c[key] is not None]
            if not pairs:
                return None
            total_weight = sum(w for _, w in pairs)
            if total_weight == 0:
                return None
            return round(sum(v * w for v, w in pairs) / total_weight, 3)

        # Display name: strip course code prefix from each name and pick most common description
        descriptions: list[str] = []
        for c in classes:
            parts = c["name"].split(None, 1)
            descriptions.append(parts[1] if len(parts) > 1 else c["name"])
        if len(descriptions) == 1:
            display_name = descriptions[0]
        else:
            desc_freq: dict[str, int] = {}
            for desc in descriptions:
                desc_freq[desc] = desc_freq.get(desc, 0) + 1
            display_name = max(desc_freq, key=lambda d: (desc_freq[d], len(d)))

        is_archived = all(c["is_archived"] for c in classes)
        synced_dates = [c["last_synced"] for c in classes if c["last_synced"]]
        last_synced = max(synced_dates) if synced_dates else None

        sorted_classes = sorted(classes, key=lambda c: _natural_sort_key(c["course_code"] or ""))

        result.append({
            "group_code": group_code,
            "display_name": display_name,
            "is_archived": is_archived,
            "class_count": len(classes),
            "total_students": total_students,
            "avg_completion_rate": _weighted_avg("avg_completion_rate"),
            "avg_on_time_rate": _weighted_avg("avg_on_time_rate"),
            "avg_current_score": _weighted_avg("avg_current_score"),
            "last_synced": last_synced,
            "classes": [
                {
                    "id": c["id"],
                    "name": c["name"],
                    "course_code": c["course_code"],
                    "student_count": c["student_count"],
                    "avg_completion_rate": c["avg_completion_rate"],
                    "avg_on_time_rate": c["avg_on_time_rate"],
                    "avg_current_score": c["avg_current_score"],
                    "is_archived": c["is_archived"],
                    "last_synced": c["last_synced"],
                }
                for c in sorted_classes
            ],
        })

    return result


async def _resolve_course_group(group_code: str, db: AsyncSession) -> tuple[list[int], str]:
    """Resolve group_code to (course_ids, display_name). Raises 404 if not found."""
    courses = await _get_course_list(db)
    group_courses = [
        c for c in courses
        if _get_course_group_code(c["course_code"]) == group_code.upper()
    ]
    if not group_courses:
        raise HTTPException(status_code=404, detail="Course group not found")
    course_ids = [c["id"] for c in group_courses]
    descriptions: list[str] = []
    for c in group_courses:
        parts = c["name"].split(None, 1)
        descriptions.append(parts[1] if len(parts) > 1 else c["name"])
    if len(descriptions) == 1:
        display_name = descriptions[0]
    else:
        desc_freq: dict[str, int] = {}
        for desc in descriptions:
            desc_freq[desc] = desc_freq.get(desc, 0) + 1
        display_name = max(desc_freq, key=lambda d: (desc_freq[d], len(d)))
    return course_ids, display_name


@router.get("/group/{group_code}/matrix")
async def get_course_group_matrix(group_code: str, db: AsyncSession = Depends(get_db)):
    """Return a combined activity matrix for all classes in a course group."""
    course_ids, display_name = await _resolve_course_group(group_code, db)

    # ── Assignments from ALL courses ──────────────────────────────────────
    assignment_result = await db.execute(
        text("""
            SELECT a.id, a.name, a.assignment_group_name, a.assignment_group_id,
                   a.assignment_group_position, a.points_possible, a.due_at, a.position,
                   a.course_id
            FROM assignments a
            WHERE a.course_id IN :course_ids AND a.workflow_state = 'published'
            ORDER BY a.assignment_group_position IS NULL,
                     a.assignment_group_position,
                     a.assignment_group_id IS NULL,
                     a.assignment_group_id,
                     a.position IS NULL,
                     a.position,
                     a.id
        """).bindparams(bindparam("course_ids", expanding=True)),
        {"course_ids": course_ids},
    )
    assignments_raw = assignment_result.fetchall()

    # Deduplicate assignments by (group_name, name) across classes.
    # Sections of the same course share assignment names but have different IDs.
    canonical_key_to_id: dict[tuple[str, str], int] = {}
    original_to_canonical: dict[int, int] = {}
    canonical_assignments: dict[int, dict] = {}

    group_order: list[str] = []
    seen_groups: set[str] = set()
    group_assignments: dict[str, list[int]] = {}

    for a_row in assignments_raw:
        a_id, a_name, ag_name, ag_id, ag_pos, points, due_at, pos, cid = a_row
        group_key = ag_name or "Uncategorised"
        canon_key = (group_key, a_name)

        if canon_key not in canonical_key_to_id:
            canonical_key_to_id[canon_key] = a_id
            canonical_assignments[a_id] = {
                "id": a_id,
                "name": a_name,
                "points_possible": points,
                "due_at": _to_iso(due_at),
            }
            if group_key not in seen_groups:
                group_order.append(group_key)
                seen_groups.add(group_key)
                group_assignments[group_key] = []
            group_assignments[group_key].append(a_id)

        original_to_canonical[a_id] = canonical_key_to_id[canon_key]

    assignment_groups = [
        {"name": g, "assignments": [canonical_assignments[aid] for aid in group_assignments[g]]}
        for g in group_order
    ]
    all_canonical_ids = [aid for g in group_order for aid in group_assignments[g]]

    # ── Students from ALL courses ─────────────────────────────────────────
    students_result = await db.execute(
        text("""
            SELECT u.id, u.name, u.sortable_name,
                   sm.completion_rate, sm.on_time_rate, sm.current_score,
                   e.course_id, c.course_code
            FROM enrollments e
            JOIN users u ON u.id = e.user_id
            JOIN courses c ON c.id = e.course_id
            LEFT JOIN student_metrics sm ON sm.user_id = e.user_id AND sm.course_id = e.course_id
            WHERE e.course_id IN :course_ids AND e.role = 'StudentEnrollment'
            ORDER BY u.sortable_name IS NULL, u.sortable_name
        """).bindparams(bindparam("course_ids", expanding=True)),
        {"course_ids": course_ids},
    )
    students_raw = students_result.fetchall()

    # ── Submissions from ALL courses, remapped to canonical assignment IDs ─
    submissions_result = await db.execute(
        text("""
            SELECT user_id, assignment_id, workflow_state, score, late, missing, excused
            FROM submissions
            WHERE course_id IN :course_ids
        """).bindparams(bindparam("course_ids", expanding=True)),
        {"course_ids": course_ids},
    )

    sub_lookup: dict[int, dict[int, dict]] = {}
    for s_row in submissions_result.fetchall():
        uid, aid, ws, score, late, missing, excused = s_row
        canonical_aid = original_to_canonical.get(aid)
        if canonical_aid is None:
            continue
        sub_lookup.setdefault(uid, {})[canonical_aid] = {
            "status": _submission_status(ws, score, excused),
            "score": score,
            "late": bool(late),
            "missing": bool(missing),
        }

    # ── Build student rows ────────────────────────────────────────────────
    seen_students: set[int] = set()
    students = []
    for s_row in students_raw:
        uid, name, sortable_name, completion_rate, on_time_rate, current_score, cid, ccode = s_row
        if uid in seen_students:
            continue
        seen_students.add(uid)

        user_subs = sub_lookup.get(uid, {})
        submissions = {}
        for aid in all_canonical_ids:
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
            "class_code": ccode,
            "class_id": cid,
            "submissions": submissions,
            "metrics": {
                "completion_rate": float(completion_rate) if completion_rate is not None else None,
                "on_time_rate": float(on_time_rate) if on_time_rate is not None else None,
                "current_score": float(current_score) if current_score is not None else None,
            },
        })

    return {
        "course_id": 0,
        "course_name": display_name,
        "course_code": group_code.upper(),
        "assignment_groups": assignment_groups,
        "students": students,
    }


@router.get("/group/{group_code}/engagement")
async def get_course_group_engagement(group_code: str, db: AsyncSession = Depends(get_db)):
    """Return combined engagement data for all classes in a course group."""
    course_ids, display_name = await _resolve_course_group(group_code, db)

    student_result = await db.execute(
        text("""
            SELECT
                u.id, u.name, u.sortable_name,
                SUM(ce.page_views) AS page_views,
                MAX(ce.page_views_level) AS page_views_level,
                MAX(ce.max_page_views) AS max_page_views,
                SUM(ce.participations) AS participations,
                MAX(ce.participations_level) AS participations_level,
                MAX(ce.max_participations) AS max_participations,
                SUM(ce.tardiness_on_time) AS tardiness_on_time,
                SUM(ce.tardiness_late) AS tardiness_late,
                SUM(ce.tardiness_missing) AS tardiness_missing,
                MAX(ce.synced_at) AS synced_at,
                SUM(e.total_activity_time) AS total_activity_time,
                MAX(e.last_activity_at) AS last_activity_at,
                MAX(ce.last_page_view_at) AS last_page_view_at,
                MAX(ce.last_participation_at) AS last_participation_at
            FROM canvas_engagement ce
            JOIN users u ON u.id = ce.user_id
            JOIN enrollments e ON e.course_id = ce.course_id AND e.user_id = ce.user_id
                AND e.role = 'StudentEnrollment'
            WHERE ce.course_id IN :course_ids
            GROUP BY u.id, u.name, u.sortable_name
            ORDER BY u.sortable_name
        """).bindparams(bindparam("course_ids", expanding=True)),
        {"course_ids": course_ids},
    )
    student_rows = student_result.fetchall()

    activity_result = await db.execute(
        text("""
            SELECT date, SUM(views), SUM(participations)
            FROM canvas_course_activity
            WHERE course_id IN :course_ids
            GROUP BY date
            ORDER BY date
        """).bindparams(bindparam("course_ids", expanding=True)),
        {"course_ids": course_ids},
    )
    activity_rows = activity_result.fetchall()

    synced_at = student_rows[0][12] if student_rows else None

    return {
        "course_id": 0,
        "course_name": display_name,
        "synced_at": _to_iso(synced_at),
        "students": [
            {
                "id": row[0],
                "name": row[1],
                "sortable_name": row[2],
                "page_views": row[3],
                "page_views_level": row[4],
                "max_page_views": row[5],
                "participations": row[6],
                "participations_level": row[7],
                "max_participations": row[8],
                "tardiness_on_time": row[9],
                "tardiness_late": row[10],
                "tardiness_missing": row[11],
                "total_activity_time_seconds": row[13],
                "last_activity_at": _to_iso(row[14]),
                "last_page_view_at": _to_iso(row[15]),
                "last_participation_at": _to_iso(row[16]),
            }
            for row in student_rows
        ],
        "course_activity": [
            {"date": str(row[0]), "views": row[1], "participations": row[2]}
            for row in activity_rows
        ],
    }


@router.get("/group/{group_code}/edstem-matrix")
async def get_course_group_edstem_matrix(group_code: str, db: AsyncSession = Depends(get_db)):
    """Return combined EdStem lesson matrix for all classes in a course group."""
    course_ids, display_name = await _resolve_course_group(group_code, db)

    mapping_result = await db.execute(
        text("""
            SELECT edstem_course_id, edstem_course_name
            FROM edstem_course_mappings
            WHERE canvas_course_id IN :course_ids
        """).bindparams(bindparam("course_ids", expanding=True)),
        {"course_ids": course_ids},
    )
    mapping_rows = mapping_result.fetchall()
    if not mapping_rows:
        return {"mapped": False}

    edstem_course_ids = list(set(row[0] for row in mapping_rows))
    edstem_course_id = mapping_rows[0][0]
    edstem_course_name = mapping_rows[0][1]

    lessons_result = await db.execute(
        text("""
            SELECT id, title, module_id, module_name, is_interactive, position
            FROM edstem_lessons
            WHERE edstem_course_id = ANY(:edstem_course_ids)
            ORDER BY module_name IS NULL, module_name, position IS NULL, position, id
        """),
        {"edstem_course_ids": edstem_course_ids},
    )
    lessons_raw = lessons_result.fetchall()

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
            "id": l_id, "title": l_title, "is_interactive": bool(l_interactive),
        })
        all_lesson_ids.append(l_id)

    modules = [{"name": m, "lessons": module_lessons[m]} for m in module_order]

    students_result = await db.execute(
        text("""
            SELECT DISTINCT ON (u.id) u.id, u.name, u.sortable_name
            FROM enrollments e
            JOIN users u ON u.id = e.user_id
            WHERE e.course_id IN :course_ids AND e.role = 'StudentEnrollment'
            ORDER BY u.id, u.sortable_name IS NULL, u.sortable_name
        """).bindparams(bindparam("course_ids", expanding=True)),
        {"course_ids": course_ids},
    )
    students_raw = students_result.fetchall()

    if all_lesson_ids:
        progress_result = await db.execute(
            text("""
                SELECT user_id, edstem_lesson_id, status, completed_at
                FROM edstem_lesson_progress
                WHERE edstem_course_id = ANY(:edstem_course_ids)
            """),
            {"edstem_course_ids": edstem_course_ids},
        )
        progress_raw = progress_result.fetchall()
    else:
        progress_raw = []

    progress_lookup: dict[int, dict[int, dict]] = {}
    for p_row in progress_raw:
        uid, lid, p_status, p_completed_at = p_row
        progress_lookup.setdefault(uid, {})[lid] = {
            "status": p_status, "completed_at": _to_iso(p_completed_at),
        }

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
            "id": uid, "name": name, "sortable_name": sortable_name,
            "completion_rate": completion_rate, "progress": progress,
        })

    # Sort by sortable_name after DISTINCT ON dedup
    students.sort(key=lambda s: (s["sortable_name"] or "", s["name"]))

    return {
        "mapped": True,
        "edstem_course_id": edstem_course_id,
        "edstem_course_name": edstem_course_name,
        "modules": modules,
        "students": students,
    }


@router.get("/group/{group_code}/gradeo")
async def get_course_group_gradeo(group_code: str, db: AsyncSession = Depends(get_db)):
    """Return combined Gradeo report for all classes in a course group."""
    course_ids, display_name = await _resolve_course_group(group_code, db)

    mapping_result = await db.execute(
        text("""
            SELECT gradeo_class_id, gradeo_class_name
            FROM gradeo_class_mappings
            WHERE canvas_course_id IN :course_ids
            ORDER BY created_at NULLS LAST, id
        """).bindparams(bindparam("course_ids", expanding=True)),
        {"course_ids": course_ids},
    )
    mapping_rows = mapping_result.fetchall()
    if not mapping_rows:
        fallback_result = await db.execute(
            text("""
                SELECT DISTINCT gcea.gradeo_class_id, gcea.class_name
                FROM gradeo_assignment_results gar
                JOIN gradeo_class_exam_assignments gcea ON gcea.id = gar.gradeo_class_exam_assignment_id
                WHERE gar.canvas_course_id IN :course_ids
            """).bindparams(bindparam("course_ids", expanding=True)),
            {"course_ids": course_ids},
        )
        mapping_rows = fallback_result.fetchall()
        if not mapping_rows:
            return {"mapped": False}

    seen_class_ids: set = set()
    gradeo_classes = []
    for row in mapping_rows:
        if row[0] not in seen_class_ids:
            seen_class_ids.add(row[0])
            gradeo_classes.append({"gradeo_class_id": row[0], "gradeo_class_name": row[1]})
    gradeo_class_ids = list(seen_class_ids)
    gradeo_class_id = gradeo_classes[0]["gradeo_class_id"]
    gradeo_class_name = gradeo_classes[0]["gradeo_class_name"]

    latest_run_result = await db.execute(
        text("""
            SELECT completed_at, unmatched_students
            FROM (
                SELECT DISTINCT ON (gradeo_class_id)
                    gradeo_class_id, completed_at, unmatched_students
                FROM gradeo_import_runs
                WHERE run_type = 'class_import' AND status = 'completed'
                  AND gradeo_class_id IN :gradeo_class_ids
                ORDER BY gradeo_class_id, id DESC
            ) latest_runs
        """).bindparams(bindparam("gradeo_class_ids", expanding=True)),
        {"gradeo_class_ids": gradeo_class_ids},
    )
    latest_run_rows = latest_run_result.fetchall()
    last_imported_at = max((row[0] for row in latest_run_rows if row[0] is not None), default=None)
    unmatched_students_count = sum(row[1] or 0 for row in latest_run_rows)

    exams_result = await db.execute(
        text("""
            SELECT id, gradeo_marking_session_id, exam_name, class_average,
                   syllabus_title, syllabus_grade, bands, outcomes, topics, updated_at
            FROM gradeo_class_exam_assignments
            WHERE gradeo_class_id IN :gradeo_class_ids
            ORDER BY exam_name, gradeo_marking_session_id, id
        """).bindparams(bindparam("gradeo_class_ids", expanding=True)),
        {"gradeo_class_ids": gradeo_class_ids},
    )
    exams_raw = exams_result.fetchall()
    exams_by_marking_session: dict[str, dict] = {}
    exam_sort_keys: dict[str, tuple[str, str]] = {}
    exam_tiebreakers: dict[str, tuple[bool, object, int]] = {}
    for row in exams_raw:
        (assignment_id, gradeo_marking_session_id, exam_name, class_average,
         syllabus_title, syllabus_grade, bands, outcomes, topics, updated_at) = row
        candidate_tiebreaker = (updated_at is not None, updated_at, -assignment_id)
        if (gradeo_marking_session_id not in exams_by_marking_session
                or candidate_tiebreaker > exam_tiebreakers[gradeo_marking_session_id]):
            exams_by_marking_session[gradeo_marking_session_id] = {
                "id": gradeo_marking_session_id, "name": exam_name,
                "class_average": float(class_average) if class_average is not None else None,
                "syllabus_title": syllabus_title, "syllabus_grade": syllabus_grade,
                "bands": _split_csv_list(bands), "outcomes": _split_csv_list(outcomes),
                "topics": _split_csv_list(topics),
            }
            exam_tiebreakers[gradeo_marking_session_id] = candidate_tiebreaker
        exam_sort_keys.setdefault(gradeo_marking_session_id, (exam_name, gradeo_marking_session_id))
    exams = [
        exams_by_marking_session[ms_id]
        for ms_id in sorted(exams_by_marking_session,
                            key=lambda k: (_natural_sort_key(exam_sort_keys[k][0]), exam_sort_keys[k][1]))
    ]

    students_result = await db.execute(
        text("""
            SELECT DISTINCT ON (u.id) u.id, u.name, u.sortable_name
            FROM enrollments e
            JOIN users u ON u.id = e.user_id
            WHERE e.course_id IN :course_ids AND e.role = 'StudentEnrollment'
            ORDER BY u.id, u.sortable_name IS NULL, u.sortable_name
        """).bindparams(bindparam("course_ids", expanding=True)),
        {"course_ids": course_ids},
    )
    students_raw = students_result.fetchall()

    results_result = await db.execute(
        text("""
            SELECT gar.user_id, gcea.gradeo_marking_session_id, gar.status,
                   gar.exam_mark, gar.marks_available, gar.class_average,
                   gar.gradeo_student_id, gar.gradeo_class_exam_assignment_id, gar.last_imported_at
            FROM gradeo_assignment_results gar
            JOIN gradeo_class_exam_assignments gcea ON gcea.id = gar.gradeo_class_exam_assignment_id
            WHERE (gar.canvas_course_id IN :course_ids OR gar.canvas_course_id IS NULL)
              AND gcea.gradeo_class_id IN :gradeo_class_ids
        """).bindparams(
            bindparam("course_ids", expanding=True),
            bindparam("gradeo_class_ids", expanding=True),
        ),
        {"course_ids": course_ids, "gradeo_class_ids": gradeo_class_ids},
    )
    results_lookup: dict[int, dict[str, dict]] = {}
    question_results_by_key: dict[tuple[int, str], list[dict]] = {}
    assignment_ids: set[int] = set()
    gradeo_student_ids: set[str] = set()
    status_priority = {"not_submitted": 0, "awaiting_marking": 1, "scored": 2}
    for row in results_result.fetchall():
        (user_id, gradeo_marking_session_id, status, exam_mark, marks_available,
         class_average, gradeo_student_id, assignment_id, last_imported_at) = row
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
        candidate_tiebreaker = (
            last_imported_at is not None, last_imported_at,
            status_priority.get(status, 0), -assignment_id,
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
            text("""
                SELECT gradeo_class_exam_assignment_id, gradeo_student_id,
                       gradeo_question_part_id, question, question_part,
                       mark, marks_available, answer_submitted, feedback,
                       marker_name, question_link, marking_session_link
                FROM gradeo_assignment_question_results
                WHERE gradeo_student_id IN :gradeo_student_ids
                  AND gradeo_class_exam_assignment_id IN :assignment_ids
                ORDER BY gradeo_class_exam_assignment_id, gradeo_question_part_id
            """).bindparams(
                bindparam("gradeo_student_ids", expanding=True),
                bindparam("assignment_ids", expanding=True),
            ),
            {"gradeo_student_ids": list(gradeo_student_ids), "assignment_ids": list(assignment_ids)},
        )
        for row in question_result_rows.fetchall():
            question_results_by_key.setdefault((row[0], row[1]), []).append({
                "gradeo_question_part_id": row[2], "question": row[3], "question_part": row[4],
                "mark": float(row[5]) if row[5] is not None else None,
                "marks_available": float(row[6]) if row[6] is not None else None,
                "answer_submitted": bool(row[7]), "feedback": row[8],
                "marker_name": row[9], "question_link": row[10], "marking_session_link": row[11],
            })

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
                    (result_data["assignment_id"], result_data["gradeo_student_id"]), [])
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
        students.append({
            "id": user_id, "name": name, "sortable_name": sortable_name,
            "completion_rate": completion_rate, "results": results,
        })

    # Sort by sortable_name after DISTINCT ON dedup
    students.sort(key=lambda s: (s["sortable_name"] or "", s["name"]))

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


@router.get("/group/{group_code}/gradeo/topic-bands")
async def get_course_group_gradeo_topic_bands(group_code: str, db: AsyncSession = Depends(get_db)):
    """Return combined Gradeo topic bands for all classes in a course group."""
    course_ids, display_name = await _resolve_course_group(group_code, db)

    mapping_result = await db.execute(
        text("""
            SELECT gradeo_class_id, gradeo_class_name
            FROM gradeo_class_mappings
            WHERE canvas_course_id IN :course_ids
        """).bindparams(bindparam("course_ids", expanding=True)),
        {"course_ids": course_ids},
    )
    mapping_rows = mapping_result.fetchall()
    if not mapping_rows:
        fallback_result = await db.execute(
            text("""
                SELECT DISTINCT gcea.gradeo_class_id, gcea.class_name
                FROM gradeo_assignment_results gar
                JOIN gradeo_class_exam_assignments gcea ON gcea.id = gar.gradeo_class_exam_assignment_id
                WHERE gar.canvas_course_id IN :course_ids
            """).bindparams(bindparam("course_ids", expanding=True)),
            {"course_ids": course_ids},
        )
        mapping_rows = fallback_result.fetchall()
        if not mapping_rows:
            return {"mapped": False}

    gradeo_class_ids = list(set(row[0] for row in mapping_rows))
    gradeo_class_id = mapping_rows[0][0]
    gradeo_class_name = mapping_rows[0][1]

    students_result = await db.execute(
        text("""
            SELECT DISTINCT ON (u.id) u.id, u.name, u.sortable_name
            FROM enrollments e
            JOIN users u ON u.id = e.user_id
            WHERE e.course_id IN :course_ids AND e.role = 'StudentEnrollment'
            ORDER BY u.id, u.sortable_name IS NULL, u.sortable_name
        """).bindparams(bindparam("course_ids", expanding=True)),
        {"course_ids": course_ids},
    )
    students_raw = students_result.fetchall()
    student_aggregates: dict[int, dict[str, dict]] = {row[0]: {} for row in students_raw}

    evidence_result = await db.execute(
        text("""
            SELECT DISTINCT ON (gar.user_id, gaqr.gradeo_question_part_id)
                gar.user_id, gcea.gradeo_marking_session_id,
                gaqr.mark, gaqr.marks_available, gaqr.topics
            FROM gradeo_assignment_question_results gaqr
            JOIN gradeo_assignment_results gar
              ON gar.gradeo_class_exam_assignment_id = gaqr.gradeo_class_exam_assignment_id
             AND gar.gradeo_student_id = gaqr.gradeo_student_id
            JOIN gradeo_class_exam_assignments gcea
              ON gcea.id = gaqr.gradeo_class_exam_assignment_id
            WHERE (gar.canvas_course_id IN :course_ids OR gar.canvas_course_id IS NULL)
              AND gcea.gradeo_class_id IN :gradeo_class_ids
              AND gaqr.mark IS NOT NULL
              AND gaqr.marks_available IS NOT NULL AND gaqr.marks_available > 0
              AND gaqr.topics IS NOT NULL AND gaqr.topics <> ''
            ORDER BY gar.user_id, gaqr.gradeo_question_part_id, gaqr.last_imported_at DESC NULLS LAST
        """).bindparams(
            bindparam("course_ids", expanding=True),
            bindparam("gradeo_class_ids", expanding=True),
        ),
        {"course_ids": course_ids, "gradeo_class_ids": gradeo_class_ids},
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
                topic, {"earned_marks": 0.0, "available_marks": 0.0, "exam_ids": set(), "part_count": 0})
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
                "score_pct": score_pct, "predicted_band": _predicted_band(score_pct),
                "confidence": _topic_confidence(available_marks, exam_count),
                "earned_marks": aggregate["earned_marks"], "available_marks": available_marks,
                "exam_count": exam_count, "part_count": aggregate["part_count"],
            }
            topic_student_scores.setdefault(topic_name, []).append(score_pct)
        students.append({"id": user_id, "name": name, "sortable_name": sortable_name, "topics": topics})

    # Sort by sortable_name after DISTINCT ON dedup
    students.sort(key=lambda s: (s["sortable_name"] or "", s["name"]))

    topics_summary = [
        {"name": tn, "student_count": len(scores), "average_score_pct": sum(scores) / len(scores)}
        for tn, scores in sorted(topic_student_scores.items(), key=lambda item: _natural_sort_key(item[0]))
        if scores
    ]

    return {
        "mapped": True,
        "gradeo_class_id": gradeo_class_id,
        "gradeo_class_name": gradeo_class_name,
        "topics": topics_summary,
        "students": students,
    }


@router.get("/group/{group_code}/tracking/assignments")
async def list_group_trackable_assignments(group_code: str, db: AsyncSession = Depends(get_db)):
    """Return trackable assignments from all classes in a course group."""
    course_ids, _ = await _resolve_course_group(group_code, db)

    result = await db.execute(
        text("""
            SELECT a.id, a.name, COUNT(rc.id) AS criteria_count, a.course_id
            FROM assignments a
            JOIN rubric_criteria rc ON rc.assignment_id = a.id
            WHERE a.course_id IN :course_ids AND a.workflow_state = 'published'
            GROUP BY a.id, a.name, a.course_id
            ORDER BY a.name
        """).bindparams(bindparam("course_ids", expanding=True)),
        {"course_ids": course_ids},
    )
    return [
        {"id": row[0], "name": row[1], "criteria_count": row[2], "course_id": row[3]}
        for row in result.fetchall()
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


@router.get("/{course_id}/engagement")
async def get_course_engagement(course_id: int, db: AsyncSession = Depends(get_db)):
    """
    Return per-student Canvas engagement data (page views, participations, total activity time,
    last seen) and a course-wide daily activity timeseries for the Engagement tab.
    """
    course_result = await db.execute(
        text("SELECT id, name FROM courses WHERE id = :id"),
        {"id": course_id},
    )
    course_row = course_result.fetchone()
    if not course_row:
        raise HTTPException(status_code=404, detail="Course not found")

    # Per-student rows: join engagement snapshot with enrollment (for last_activity_at,
    # total_activity_time) and users (for display name, sorted name).
    student_result = await db.execute(
        text("""
            SELECT
                u.id,
                u.name,
                u.sortable_name,
                ce.page_views,
                ce.page_views_level,
                ce.max_page_views,
                ce.participations,
                ce.participations_level,
                ce.max_participations,
                ce.tardiness_on_time,
                ce.tardiness_late,
                ce.tardiness_missing,
                ce.synced_at,
                e.total_activity_time,
                e.last_activity_at,
                ce.last_page_view_at,
                ce.last_participation_at
            FROM canvas_engagement ce
            JOIN users u ON u.id = ce.user_id
            JOIN enrollments e ON e.course_id = ce.course_id AND e.user_id = ce.user_id
                AND e.role = 'StudentEnrollment'
            WHERE ce.course_id = :course_id
            ORDER BY u.sortable_name
        """),
        {"course_id": course_id},
    )
    student_rows = student_result.fetchall()

    # Course-wide daily activity timeseries
    activity_result = await db.execute(
        text("""
            SELECT date, views, participations
            FROM canvas_course_activity
            WHERE course_id = :course_id
            ORDER BY date
        """),
        {"course_id": course_id},
    )
    activity_rows = activity_result.fetchall()

    synced_at = student_rows[0][12] if student_rows else None

    return {
        "course_id": course_row[0],
        "course_name": course_row[1],
        "synced_at": _to_iso(synced_at),
        "students": [
            {
                "id": row[0],
                "name": row[1],
                "sortable_name": row[2],
                "page_views": row[3],
                "page_views_level": row[4],
                "max_page_views": row[5],
                "participations": row[6],
                "participations_level": row[7],
                "max_participations": row[8],
                "tardiness_on_time": row[9],
                "tardiness_late": row[10],
                "tardiness_missing": row[11],
                "total_activity_time_seconds": row[13],
                "last_activity_at": _to_iso(row[14]),
                "last_page_view_at": _to_iso(row[15]),
                "last_participation_at": _to_iso(row[16]),
            }
            for row in student_rows
        ],
        "course_activity": [
            {
                "date": str(row[0]),
                "views": row[1],
                "participations": row[2],
            }
            for row in activity_rows
        ],
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

    # Check for EdStem mappings (may be multiple per canvas course)
    mapping_result = await db.execute(
        text("SELECT edstem_course_id, edstem_course_name FROM edstem_course_mappings WHERE canvas_course_id = :cid"),
        {"cid": course_id},
    )
    mapping_rows = mapping_result.fetchall()
    if not mapping_rows:
        return {"mapped": False}

    edstem_course_ids = [row[0] for row in mapping_rows]
    edstem_course_id = mapping_rows[0][0]
    edstem_course_name = mapping_rows[0][1]

    # Fetch lessons from all mapped EdStem courses
    lessons_result = await db.execute(
        text("""
            SELECT id, title, module_id, module_name, is_interactive, position
            FROM edstem_lessons
            WHERE edstem_course_id = ANY(:edstem_course_ids)
            ORDER BY module_name IS NULL, module_name, position IS NULL, position, id
        """),
        {"edstem_course_ids": edstem_course_ids},
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

    # Fetch all progress records for mapped EdStem courses in one query
    if all_lesson_ids:
        progress_result = await db.execute(
            text("""
                SELECT user_id, edstem_lesson_id, status, completed_at
                FROM edstem_lesson_progress
                WHERE edstem_course_id = ANY(:edstem_course_ids)
            """),
            {"edstem_course_ids": edstem_course_ids},
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
        # Fallback: discover Gradeo classes via student enrollment links
        fallback_result = await db.execute(
            text(
                """
                SELECT DISTINCT gcea.gradeo_class_id, gcea.class_name
                FROM gradeo_assignment_results gar
                JOIN gradeo_class_exam_assignments gcea ON gcea.id = gar.gradeo_class_exam_assignment_id
                WHERE gar.canvas_course_id = :course_id
                """
            ),
            {"course_id": course_id},
        )
        mapping_row = fallback_result.fetchone()
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
            SELECT DISTINCT ON (gar.user_id, gaqr.gradeo_question_part_id)
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
            WHERE (gar.canvas_course_id = :course_id OR gar.canvas_course_id IS NULL)
              AND gcea.gradeo_class_id = :gradeo_class_id
              AND gaqr.mark IS NOT NULL
              AND gaqr.marks_available IS NOT NULL
              AND gaqr.marks_available > 0
              AND gaqr.topics IS NOT NULL
              AND gaqr.topics <> ''
            ORDER BY gar.user_id, gaqr.gradeo_question_part_id, gaqr.last_imported_at DESC NULLS LAST
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
        # Fallback: discover Gradeo classes via student enrollment links
        fallback_result = await db.execute(
            text(
                """
                SELECT DISTINCT gcea.gradeo_class_id, gcea.class_name
                FROM gradeo_assignment_results gar
                JOIN gradeo_class_exam_assignments gcea ON gcea.id = gar.gradeo_class_exam_assignment_id
                WHERE gar.canvas_course_id = :course_id
                """
            ),
            {"course_id": course_id},
        )
        mapping_rows = fallback_result.fetchall()
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
            WHERE (gar.canvas_course_id = :course_id OR gar.canvas_course_id IS NULL)
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
