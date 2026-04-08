from __future__ import annotations

from datetime import datetime, timedelta, timezone
import logging
import re
from time import perf_counter

from sqlalchemy import bindparam, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.gradeo.matcher import get_course_student_ids, get_whitelisted_courses, get_whitelisted_users_by_email, unique_course_candidate
from app.gradeo.normalizer import aggregate_exam_rows, aggregate_exam_summaries, gradeo_assignment_key, normalize_match_key
from app.gradeo.types import GradeoExamAggregate, GradeoImportBatch

STUDENT_DIRECTORY_MAX_AGE = timedelta(hours=24)
GRADEO_CLASS_ID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.IGNORECASE)
logger = logging.getLogger("app.gradeo.importer")
STATUS_PRIORITY = {"not_submitted": 0, "awaiting_marking": 1, "scored": 2}


def is_valid_gradeo_class_id(value: str | None) -> bool:
    return bool(GRADEO_CLASS_ID_RE.match(str(value or "").strip()))


async def cleanup_invalid_gradeo_classes(db: AsyncSession) -> int:
    result = await db.execute(
        text(
            """
            DELETE FROM gradeo_classes
            WHERE gradeo_class_id !~* :uuid_pattern
            """
        ),
        {"uuid_pattern": r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"},
    )
    return result.rowcount or 0


async def upsert_gradeo_class(db: AsyncSession, gradeo_class_id: str, class_name: str) -> None:
    if not is_valid_gradeo_class_id(gradeo_class_id):
        raise ValueError(f"Invalid Gradeo class id: {gradeo_class_id}")

    now = datetime.now(timezone.utc)
    await db.execute(
        text(
            """
            INSERT INTO gradeo_classes (gradeo_class_id, name, normalized_name, discovered_at, last_seen_at)
            VALUES (:gradeo_class_id, :name, :normalized_name, :now, :now)
            ON CONFLICT (gradeo_class_id) DO UPDATE SET
                name = EXCLUDED.name,
                normalized_name = EXCLUDED.normalized_name,
                last_seen_at = EXCLUDED.last_seen_at
            """
        ),
        {
            "gradeo_class_id": gradeo_class_id,
            "name": class_name,
            "normalized_name": normalize_match_key(class_name),
            "now": now,
        },
    )


async def replace_gradeo_class_syllabuses(db: AsyncSession, gradeo_class_id: str, syllabuses: list[dict]) -> None:
    await db.execute(
        text("DELETE FROM gradeo_class_syllabuses WHERE gradeo_class_id = :gradeo_class_id"),
        {"gradeo_class_id": gradeo_class_id},
    )
    seen: set[str] = set()
    for syllabus in syllabuses:
        syllabus_id = str(syllabus.get("id", "")).strip()
        if not syllabus_id or syllabus_id in seen:
            continue
        seen.add(syllabus_id)
        await db.execute(
            text(
                """
                INSERT INTO gradeo_class_syllabuses (
                    gradeo_class_id, syllabus_id, title, description, grade
                )
                VALUES (
                    :gradeo_class_id, :syllabus_id, :title, :description, :grade
                )
                """
            ),
            {
                "gradeo_class_id": gradeo_class_id,
                "syllabus_id": syllabus_id,
                "title": str(syllabus.get("title", "")).strip() or None,
                "description": str(syllabus.get("description", "")).strip() or None,
                "grade": syllabus.get("grade"),
            },
        )


async def get_gradeo_class_syllabus_ids(db: AsyncSession, gradeo_class_id: str) -> set[str]:
    result = await db.execute(
        text("SELECT syllabus_id FROM gradeo_class_syllabuses WHERE gradeo_class_id = :gradeo_class_id"),
        {"gradeo_class_id": gradeo_class_id},
    )
    return {row[0] for row in result.fetchall() if row[0]}


def _value_conflicts(existing: str | None, incoming: str | None) -> bool:
    return bool(existing and incoming and existing != incoming)


def merge_exam_aggregate(existing: GradeoExamAggregate, incoming: GradeoExamAggregate) -> GradeoExamAggregate:
    for field_name in ("gradeo_exam_id", "gradeo_exam_session_id", "gradeo_marking_session_id", "gradeo_class_id", "syllabus_id"):
        existing_value = getattr(existing, field_name)
        incoming_value = getattr(incoming, field_name)
        if _value_conflicts(existing_value, incoming_value):
            raise ValueError(f"Conflicting Gradeo aggregate field {field_name}: {existing_value} vs {incoming_value}")
        if existing_value is None and incoming_value is not None:
            setattr(existing, field_name, incoming_value)

    if not existing.exam_name and incoming.exam_name:
        existing.exam_name = incoming.exam_name
    if existing.class_name is None and incoming.class_name is not None:
        existing.class_name = incoming.class_name
    if existing.class_average is None and incoming.class_average is not None:
        existing.class_average = incoming.class_average
    if existing.exam_mark is None and incoming.exam_mark is not None:
        existing.exam_mark = incoming.exam_mark
    if existing.marks_available is None and incoming.marks_available is not None:
        existing.marks_available = incoming.marks_available
    if existing.syllabus_title is None and incoming.syllabus_title is not None:
        existing.syllabus_title = incoming.syllabus_title
    if existing.syllabus_grade is None and incoming.syllabus_grade is not None:
        existing.syllabus_grade = incoming.syllabus_grade
    if incoming.bands:
        existing.bands = list(dict.fromkeys([*existing.bands, *incoming.bands]))
    if incoming.outcomes:
        existing.outcomes = list(dict.fromkeys([*existing.outcomes, *incoming.outcomes]))
    if incoming.topics:
        existing.topics = list(dict.fromkeys([*existing.topics, *incoming.topics]))
    if STATUS_PRIORITY.get(incoming.status, 0) > STATUS_PRIORITY.get(existing.status, 0):
        existing.status = incoming.status
    existing.answer_submitted_count = max(existing.answer_submitted_count, incoming.answer_submitted_count)
    existing.unmarked_question_count = max(existing.unmarked_question_count, incoming.unmarked_question_count)
    if incoming.question_rows:
        existing.question_rows.extend(incoming.question_rows)
    return existing


def merge_assignment_metadata(existing: GradeoExamAggregate, incoming: GradeoExamAggregate) -> GradeoExamAggregate:
    if existing.class_name is None and incoming.class_name is not None:
        existing.class_name = incoming.class_name
    if existing.class_average is None and incoming.class_average is not None:
        existing.class_average = incoming.class_average
    if existing.syllabus_id is None and incoming.syllabus_id is not None:
        existing.syllabus_id = incoming.syllabus_id
    if existing.syllabus_title is None and incoming.syllabus_title is not None:
        existing.syllabus_title = incoming.syllabus_title
    if existing.syllabus_grade is None and incoming.syllabus_grade is not None:
        existing.syllabus_grade = incoming.syllabus_grade
    if incoming.bands:
        existing.bands = list(dict.fromkeys([*existing.bands, *incoming.bands]))
    if incoming.outcomes:
        existing.outcomes = list(dict.fromkeys([*existing.outcomes, *incoming.outcomes]))
    if incoming.topics:
        existing.topics = list(dict.fromkeys([*existing.topics, *incoming.topics]))
    return existing


async def upsert_gradeo_exam_definition(db: AsyncSession, aggregate: GradeoExamAggregate, now: datetime) -> None:
    await db.execute(
        text(
            """
            INSERT INTO gradeo_exam_definitions (
                gradeo_exam_id, title, syllabus_id, syllabus_title, syllabus_grade,
                publish_date, is_published, discovered_at, updated_at
            )
            VALUES (
                :gradeo_exam_id, :title, :syllabus_id, :syllabus_title, :syllabus_grade,
                NULL, NULL, :discovered_at, :updated_at
            )
            ON CONFLICT (gradeo_exam_id) DO UPDATE SET
                title = EXCLUDED.title,
                syllabus_id = COALESCE(gradeo_exam_definitions.syllabus_id, EXCLUDED.syllabus_id),
                syllabus_title = COALESCE(EXCLUDED.syllabus_title, gradeo_exam_definitions.syllabus_title),
                syllabus_grade = COALESCE(EXCLUDED.syllabus_grade, gradeo_exam_definitions.syllabus_grade),
                updated_at = EXCLUDED.updated_at
            """
        ),
        {
            "gradeo_exam_id": aggregate.gradeo_exam_id,
            "title": aggregate.exam_name,
            "syllabus_id": aggregate.syllabus_id,
            "syllabus_title": aggregate.syllabus_title,
            "syllabus_grade": aggregate.syllabus_grade,
            "discovered_at": now,
            "updated_at": now,
        },
    )


async def upsert_gradeo_exam_session(db: AsyncSession, aggregate: GradeoExamAggregate, now: datetime) -> None:
    if not aggregate.gradeo_exam_session_id:
        return

    await db.execute(
        text(
            """
            INSERT INTO gradeo_exam_sessions (
                gradeo_exam_session_id, gradeo_exam_id, start_date, end_date, discovered_at, updated_at
            )
            VALUES (
                :gradeo_exam_session_id, :gradeo_exam_id, NULL, NULL, :discovered_at, :updated_at
            )
            ON CONFLICT (gradeo_exam_session_id) DO UPDATE SET
                gradeo_exam_id = EXCLUDED.gradeo_exam_id,
                updated_at = EXCLUDED.updated_at
            """
        ),
        {
            "gradeo_exam_session_id": aggregate.gradeo_exam_session_id,
            "gradeo_exam_id": aggregate.gradeo_exam_id,
            "discovered_at": now,
            "updated_at": now,
        },
    )


async def upsert_gradeo_class_exam_assignment(
    db: AsyncSession,
    *,
    batch: GradeoImportBatch,
    aggregate: GradeoExamAggregate,
    now: datetime,
) -> int:
    if not aggregate.gradeo_marking_session_id:
        raise ValueError(f"Missing Gradeo marking session id for {aggregate.exam_name}")
    if aggregate.gradeo_class_id and aggregate.gradeo_class_id != batch.gradeo_class_id:
        raise ValueError(
            f"Gradeo class mismatch for marking session {aggregate.gradeo_marking_session_id}: {aggregate.gradeo_class_id} vs {batch.gradeo_class_id}"
        )

    result = await db.execute(
        text(
            """
            INSERT INTO gradeo_class_exam_assignments (
                gradeo_class_id, gradeo_marking_session_id, gradeo_exam_id, gradeo_exam_session_id,
                exam_name, class_name, class_average, syllabus_id, syllabus_title, syllabus_grade,
                bands, outcomes, topics, discovered_at, updated_at
            )
            VALUES (
                :gradeo_class_id, :gradeo_marking_session_id, :gradeo_exam_id, :gradeo_exam_session_id,
                :exam_name, :class_name, :class_average, :syllabus_id, :syllabus_title, :syllabus_grade,
                :bands, :outcomes, :topics, :discovered_at, :updated_at
            )
            ON CONFLICT (gradeo_class_id, gradeo_marking_session_id) DO UPDATE SET
                gradeo_exam_id = EXCLUDED.gradeo_exam_id,
                gradeo_exam_session_id = COALESCE(EXCLUDED.gradeo_exam_session_id, gradeo_class_exam_assignments.gradeo_exam_session_id),
                exam_name = EXCLUDED.exam_name,
                class_name = EXCLUDED.class_name,
                class_average = EXCLUDED.class_average,
                syllabus_id = COALESCE(gradeo_class_exam_assignments.syllabus_id, EXCLUDED.syllabus_id),
                syllabus_title = COALESCE(EXCLUDED.syllabus_title, gradeo_class_exam_assignments.syllabus_title),
                syllabus_grade = COALESCE(EXCLUDED.syllabus_grade, gradeo_class_exam_assignments.syllabus_grade),
                bands = EXCLUDED.bands,
                outcomes = EXCLUDED.outcomes,
                topics = EXCLUDED.topics,
                updated_at = EXCLUDED.updated_at
            RETURNING id
            """
        ),
        {
            "gradeo_class_id": batch.gradeo_class_id,
            "gradeo_marking_session_id": aggregate.gradeo_marking_session_id,
            "gradeo_exam_id": aggregate.gradeo_exam_id,
            "gradeo_exam_session_id": aggregate.gradeo_exam_session_id,
            "exam_name": aggregate.exam_name,
            "class_name": aggregate.class_name or batch.gradeo_class_name,
            "class_average": aggregate.class_average,
            "syllabus_id": aggregate.syllabus_id,
            "syllabus_title": aggregate.syllabus_title,
            "syllabus_grade": aggregate.syllabus_grade,
            "bands": ",".join(aggregate.bands) or None,
            "outcomes": ",".join(aggregate.outcomes) or None,
            "topics": ",".join(aggregate.topics) or None,
            "discovered_at": now,
            "updated_at": now,
        },
    )
    return result.scalar_one()


async def start_import_run(
    db: AsyncSession,
    *,
    run_type: str,
    status: str = "running",
    canvas_course_id: int | None = None,
    gradeo_class_id: str | None = None,
    gradeo_class_name: str | None = None,
    triggered_by: str | None = None,
    source_type: str | None = None,
    extension_version: str | None = None,
) -> int:
    started_at = datetime.now(timezone.utc)
    result = await db.execute(
        text(
            """
            INSERT INTO gradeo_import_runs (
                run_type, status, canvas_course_id, gradeo_class_id, gradeo_class_name,
                triggered_by, source_type, extension_version,
                processed_students, matched_students, imported_exams,
                imported_question_results, unmatched_students, skipped_students,
                started_at
            )
            VALUES (
                :run_type, :status, :canvas_course_id, :gradeo_class_id, :gradeo_class_name,
                :triggered_by, :source_type, :extension_version,
                :processed_students, :matched_students, :imported_exams,
                :imported_question_results, :unmatched_students, :skipped_students,
                :started_at
            )
            RETURNING id
            """
        ),
        {
            "run_type": run_type,
            "status": status,
            "canvas_course_id": canvas_course_id,
            "gradeo_class_id": gradeo_class_id,
            "gradeo_class_name": gradeo_class_name,
            "triggered_by": triggered_by,
            "source_type": source_type,
            "extension_version": extension_version,
            "processed_students": 0,
            "matched_students": 0,
            "imported_exams": 0,
            "imported_question_results": 0,
            "unmatched_students": 0,
            "skipped_students": 0,
            "started_at": started_at,
        },
    )
    return result.scalar_one()


async def finish_import_run(db: AsyncSession, run_id: int, **fields) -> None:
    values = {
        "run_id": run_id,
        "status": fields.get("status", "completed"),
        "processed_students": fields.get("processed_students", 0),
        "matched_students": fields.get("matched_students", 0),
        "imported_exams": fields.get("imported_exams", 0),
        "imported_question_results": fields.get("imported_question_results", 0),
        "unmatched_students": fields.get("unmatched_students", 0),
        "skipped_students": fields.get("skipped_students", 0),
        "error_message": fields.get("error_message"),
        "completed_at": datetime.now(timezone.utc),
    }
    await db.execute(
        text(
            """
            UPDATE gradeo_import_runs
            SET status = :status,
                processed_students = :processed_students,
                matched_students = :matched_students,
                imported_exams = :imported_exams,
                imported_question_results = :imported_question_results,
                unmatched_students = :unmatched_students,
                skipped_students = :skipped_students,
                error_message = :error_message,
                completed_at = :completed_at
            WHERE id = :run_id
            """
        ),
        values,
    )


async def prune_class_import_state(
    db: AsyncSession,
    *,
    gradeo_class_id: str,
    imported_assignment_ids: set[int],
    imported_result_keys: set[tuple[int, str]],
    imported_question_keys: set[tuple[int, str, str]],
) -> None:
    assignment_rows = await db.execute(
        text(
            """
            SELECT id
            FROM gradeo_class_exam_assignments
            WHERE gradeo_class_id = :gradeo_class_id
            """
        ),
        {"gradeo_class_id": gradeo_class_id},
    )
    existing_assignment_ids = {row[0] for row in assignment_rows.fetchall()}
    if not existing_assignment_ids:
        return

    result_rows = await db.execute(
        text(
            """
            SELECT gradeo_class_exam_assignment_id, gradeo_student_id
            FROM gradeo_assignment_results
            WHERE gradeo_class_exam_assignment_id IN :assignment_ids
            """
        ).bindparams(bindparam("assignment_ids", expanding=True)),
        {"assignment_ids": list(existing_assignment_ids)},
    )
    stale_result_keys = [
        (row[0], row[1])
        for row in result_rows.fetchall()
        if (row[0], row[1]) not in imported_result_keys
    ]
    for assignment_id, gradeo_student_id in stale_result_keys:
        await db.execute(
            text(
                """
                DELETE FROM gradeo_assignment_results
                WHERE gradeo_class_exam_assignment_id = :assignment_id
                  AND gradeo_student_id = :gradeo_student_id
                """
            ),
            {
                "assignment_id": assignment_id,
                "gradeo_student_id": gradeo_student_id,
            },
        )

    question_rows = await db.execute(
        text(
            """
            SELECT gradeo_class_exam_assignment_id, gradeo_student_id, gradeo_question_part_id
            FROM gradeo_assignment_question_results
            WHERE gradeo_class_exam_assignment_id IN :assignment_ids
            """
        ).bindparams(bindparam("assignment_ids", expanding=True)),
        {"assignment_ids": list(existing_assignment_ids)},
    )
    stale_question_keys = [
        (row[0], row[1], row[2])
        for row in question_rows.fetchall()
        if (row[0], row[1], row[2]) not in imported_question_keys
    ]
    for assignment_id, gradeo_student_id, question_part_id in stale_question_keys:
        await db.execute(
            text(
                """
                DELETE FROM gradeo_assignment_question_results
                WHERE gradeo_class_exam_assignment_id = :assignment_id
                  AND gradeo_student_id = :gradeo_student_id
                  AND gradeo_question_part_id = :question_part_id
                """
            ),
            {
                "assignment_id": assignment_id,
                "gradeo_student_id": gradeo_student_id,
                "question_part_id": question_part_id,
            },
        )

    stale_assignment_ids = existing_assignment_ids - imported_assignment_ids
    if stale_assignment_ids:
        stale_assignment_id_list = list(stale_assignment_ids)
        await db.execute(
            text(
                """
                DELETE FROM gradeo_assignment_question_results
                WHERE gradeo_class_exam_assignment_id IN :assignment_ids
                """
            ).bindparams(bindparam("assignment_ids", expanding=True)),
            {"assignment_ids": stale_assignment_id_list},
        )
        await db.execute(
            text(
                """
                DELETE FROM gradeo_assignment_results
                WHERE gradeo_class_exam_assignment_id IN :assignment_ids
                """
            ).bindparams(bindparam("assignment_ids", expanding=True)),
            {"assignment_ids": stale_assignment_id_list},
        )
        await db.execute(
            text(
                """
                DELETE FROM gradeo_class_exam_assignments
                WHERE id IN :assignment_ids
                """
            ).bindparams(bindparam("assignment_ids", expanding=True)),
            {"assignment_ids": stale_assignment_id_list},
        )


async def get_student_directory_status(db: AsyncSession) -> dict:
    last_sync_result = await db.execute(
        text(
            """
            SELECT MAX(completed_at)
            FROM gradeo_import_runs
            WHERE run_type = 'student_directory' AND status = 'completed'
            """
        )
    )
    last_synced_at = last_sync_result.scalar_one()

    count_result = await db.execute(text("SELECT COUNT(*) FROM gradeo_students"))
    matched_students = count_result.scalar_one()

    return {
        "last_synced_at": last_synced_at,
        "matched_students": matched_students,
        "stale": last_synced_at is None or last_synced_at < datetime.now(timezone.utc) - STUDENT_DIRECTORY_MAX_AGE,
    }


async def refresh_student_directory(
    db: AsyncSession,
    *,
    students: list[dict],
    triggered_by: str | None,
    extension_version: str | None,
) -> dict:
    run_id = await start_import_run(
        db,
        run_type="student_directory",
        gradeo_class_name="School student directory",
        triggered_by=triggered_by,
        source_type="extension",
        extension_version=extension_version,
    )

    now = datetime.now(timezone.utc)
    lower_emails = [str(student.get("email", "")).strip().lower() for student in students if student.get("email")]
    matches_by_email = await get_whitelisted_users_by_email(db, lower_emails)

    matched = 0
    unmatched = 0
    for student in students:
        email = str(student.get("email", "")).strip().lower()
        match = matches_by_email.get(email)
        if not email or not match:
            unmatched += 1
            continue

        matched += 1
        await db.execute(
            text(
                """
                INSERT INTO gradeo_students (
                    gradeo_student_id, name, email, matched_user_id, directory_synced_at, last_seen_at
                )
                VALUES (
                    :gradeo_student_id, :name, :email, :matched_user_id, :directory_synced_at, :last_seen_at
                )
                ON CONFLICT (gradeo_student_id) DO UPDATE SET
                    name = EXCLUDED.name,
                    email = EXCLUDED.email,
                    matched_user_id = EXCLUDED.matched_user_id,
                    directory_synced_at = EXCLUDED.directory_synced_at,
                    last_seen_at = EXCLUDED.last_seen_at
                """
            ),
            {
                "gradeo_student_id": student["gradeo_student_id"],
                "name": student["name"],
                "email": email,
                "matched_user_id": match["user_id"],
                "directory_synced_at": now,
                "last_seen_at": now,
            },
        )

    await finish_import_run(
        db,
        run_id,
        processed_students=len(students),
        matched_students=matched,
        unmatched_students=unmatched,
        skipped_students=0,
    )

    return {
        "processed_students": len(students),
        "matched_students": matched,
        "unmatched_students": unmatched,
        "last_synced_at": now,
    }


async def refresh_discovered_classes(
    db: AsyncSession,
    *,
    classes: list[dict],
    triggered_by: str | None,
    extension_version: str | None,
) -> dict:
    await cleanup_invalid_gradeo_classes(db)

    run_id = await start_import_run(
        db,
        run_type="class_discovery",
        gradeo_class_name="Gradeo classes directory",
        triggered_by=triggered_by,
        source_type="extension",
        extension_version=extension_version,
    )

    seen = set()
    discovered = 0
    skipped = 0

    for gradeo_class in classes:
        gradeo_class_id = str(gradeo_class.get("gradeo_class_id", "")).strip()
        gradeo_class_name = str(gradeo_class.get("name", "")).strip()
        if (
            not gradeo_class_id or
            not gradeo_class_name or
            not is_valid_gradeo_class_id(gradeo_class_id) or
            gradeo_class_id in seen
        ):
            skipped += 1
            continue

        seen.add(gradeo_class_id)
        await upsert_gradeo_class(db, gradeo_class_id, gradeo_class_name)
        await replace_gradeo_class_syllabuses(db, gradeo_class_id, list(gradeo_class.get("syllabuses") or []))
        discovered += 1

    await finish_import_run(
        db,
        run_id,
        processed_students=discovered,
        matched_students=discovered,
        unmatched_students=0,
        skipped_students=skipped,
    )

    return {
        "processed_classes": discovered,
        "discovered_classes": discovered,
        "skipped_classes": skipped,
        "last_synced_at": datetime.now(timezone.utc),
    }


async def preflight_class_import(
    db: AsyncSession,
    *,
    gradeo_class_id: str,
    gradeo_class_name: str,
) -> dict:
    started_at = perf_counter()
    if not is_valid_gradeo_class_id(gradeo_class_id):
        raise ValueError(f"Invalid Gradeo class id: {gradeo_class_id}")

    step_started_at = perf_counter()
    await cleanup_invalid_gradeo_classes(db)
    logger.info(
        "gradeo_preflight_step class_id=%s step=cleanup_invalid_gradeo_classes duration_ms=%s",
        gradeo_class_id,
        round((perf_counter() - step_started_at) * 1000, 1),
    )

    step_started_at = perf_counter()
    await upsert_gradeo_class(db, gradeo_class_id, gradeo_class_name)
    logger.info(
        "gradeo_preflight_step class_id=%s step=upsert_gradeo_class duration_ms=%s",
        gradeo_class_id,
        round((perf_counter() - step_started_at) * 1000, 1),
    )

    step_started_at = perf_counter()
    status = await get_student_directory_status(db)
    logger.info(
        "gradeo_preflight_step class_id=%s step=get_student_directory_status duration_ms=%s stale=%s matched_students=%s last_synced_at=%s",
        gradeo_class_id,
        round((perf_counter() - step_started_at) * 1000, 1),
        status["stale"],
        status["matched_students"],
        status["last_synced_at"],
    )

    step_started_at = perf_counter()
    courses = await get_whitelisted_courses(db)
    logger.info(
        "gradeo_preflight_step class_id=%s step=get_whitelisted_courses duration_ms=%s course_count=%s",
        gradeo_class_id,
        round((perf_counter() - step_started_at) * 1000, 1),
        len(courses),
    )
    candidates = [
        {
            "course_id": course["course_id"],
            "name": course["name"],
            "course_code": course["course_code"],
        }
        for course in courses
        if normalize_match_key(gradeo_class_name) in {
            normalize_match_key(course.get("name")),
            normalize_match_key(course.get("course_code")),
        }
    ]
    unique_candidate = unique_course_candidate(gradeo_class_name, courses)

    step_started_at = perf_counter()
    mapping_result = await db.execute(
        text(
            """
            SELECT gcm.canvas_course_id, gcm.gradeo_class_name, cw.name, cw.course_code
            FROM gradeo_class_mappings gcm
            LEFT JOIN course_whitelist cw ON cw.course_id = gcm.canvas_course_id
            WHERE gcm.gradeo_class_id = :gradeo_class_id
            """
        ),
        {"gradeo_class_id": gradeo_class_id},
    )
    mapping_row = mapping_result.fetchone()
    logger.info(
        "gradeo_preflight_step class_id=%s step=lookup_mapping duration_ms=%s mapping_found=%s",
        gradeo_class_id,
        round((perf_counter() - step_started_at) * 1000, 1),
        bool(mapping_row),
    )

    if mapping_row:
        reason = None if not status["stale"] else "student_directory_stale"
        ready = not status["stale"]
        mapping = {
            "canvas_course_id": mapping_row[0],
            "gradeo_class_name": mapping_row[1],
            "canvas_course_name": mapping_row[2],
            "canvas_course_code": mapping_row[3],
        }
    else:
        ready = False
        reason = "mapping_required"
        mapping = None

    result = {
        "ready": ready,
        "reason": reason,
        "student_directory_last_synced_at": status["last_synced_at"],
        "student_directory_stale": status["stale"],
        "mapping": mapping,
        "candidate_courses": candidates,
        "suggested_course": unique_candidate,
    }
    logger.info(
        "gradeo_preflight_complete class_id=%s class_name=%s ready=%s reason=%s candidate_count=%s mapping=%s total_duration_ms=%s",
        gradeo_class_id,
        gradeo_class_name,
        ready,
        reason,
        len(candidates),
        mapping["canvas_course_id"] if mapping else None,
        round((perf_counter() - started_at) * 1000, 1),
    )
    return result


async def import_class_batch(
    db: AsyncSession,
    *,
    batch: GradeoImportBatch,
    triggered_by: str | None,
) -> dict:
    started_at = perf_counter()
    logger.info(
        "gradeo_import_started class_id=%s class_name=%s students=%s source_type=%s extension_version=%s triggered_by=%s",
        batch.gradeo_class_id,
        batch.gradeo_class_name,
        len(batch.students),
        batch.source_type,
        batch.extension_version,
        triggered_by,
    )
    preflight = await preflight_class_import(
        db,
        gradeo_class_id=batch.gradeo_class_id,
        gradeo_class_name=batch.gradeo_class_name,
    )
    if not preflight["mapping"]:
        raise ValueError("Gradeo class is not mapped to a whitelisted course")
    if preflight["student_directory_stale"]:
        raise ValueError("Gradeo student directory is stale. Refresh it from the extension first.")

    canvas_course_id = preflight["mapping"]["canvas_course_id"]
    run_id = await start_import_run(
        db,
        run_type="class_import",
        canvas_course_id=canvas_course_id,
        gradeo_class_id=batch.gradeo_class_id,
        gradeo_class_name=batch.gradeo_class_name,
        triggered_by=triggered_by,
        source_type=batch.source_type,
        extension_version=batch.extension_version,
    )

    now = datetime.now(timezone.utc)
    processed_students = len(batch.students)
    matched_count = 0
    unmatched_count = 0
    skipped_count = 0
    imported_exam_results = 0
    imported_question_results = 0
    imported_assignment_ids: set[int] = set()
    imported_result_keys: set[tuple[int, str]] = set()
    imported_question_keys: set[tuple[int, str, str]] = set()
    class_syllabus_ids = await get_gradeo_class_syllabus_ids(db, batch.gradeo_class_id)

    try:
        enrolled_student_ids = await get_course_student_ids(db, canvas_course_id)
        logger.info(
            "gradeo_import_step class_id=%s step=get_course_student_ids enrolled_count=%s",
            batch.gradeo_class_id,
            len(enrolled_student_ids),
        )
        student_ids = [student.gradeo_student_id for student in batch.students]
        statement = text(
            """
            SELECT gradeo_student_id, matched_user_id
            FROM gradeo_students
            WHERE gradeo_student_id IN :student_ids
            """
        ).bindparams(bindparam("student_ids", expanding=True))
        result = await db.execute(statement, {"student_ids": student_ids or ["__none__"]})
        matched_students = {row[0]: row[1] for row in result.fetchall()}
        logger.info(
            "gradeo_import_step class_id=%s step=load_gradeo_student_matches requested_students=%s matched_directory_students=%s",
            batch.gradeo_class_id,
            len(student_ids),
            len(matched_students),
        )

        matched_student_updates: list[dict] = []
        assignment_templates: dict[str, GradeoExamAggregate] = {}
        assignment_rows: list[dict] = []

        for student in batch.students:
            matched_user_id = matched_students.get(student.gradeo_student_id)
            if not matched_user_id or matched_user_id not in enrolled_student_ids:
                unmatched_count += 1
                continue

            matched_count += 1
            matched_student_updates.append(
                {
                    "gradeo_student_id": student.gradeo_student_id,
                    "name": student.student_name,
                    "last_seen_at": now,
                }
            )

            question_aggregates = aggregate_exam_rows(student.rows)
            summary_aggregates = aggregate_exam_summaries(student.exam_rows)
            aggregates_by_assignment: dict[str, GradeoExamAggregate] = {}
            for aggregate in [*question_aggregates, *summary_aggregates]:
                key = gradeo_assignment_key(
                    gradeo_marking_session_id=aggregate.gradeo_marking_session_id,
                    gradeo_exam_session_id=aggregate.gradeo_exam_session_id,
                    gradeo_exam_id=aggregate.gradeo_exam_id,
                )
                if key in aggregates_by_assignment:
                    aggregates_by_assignment[key] = merge_exam_aggregate(aggregates_by_assignment[key], aggregate)
                else:
                    aggregates_by_assignment[key] = aggregate

            for assignment_key, aggregate in aggregates_by_assignment.items():
                if aggregate.syllabus_id and class_syllabus_ids and aggregate.syllabus_id not in class_syllabus_ids:
                    raise ValueError(
                        f"Gradeo syllabus mismatch for class {batch.gradeo_class_id} and marking session {aggregate.gradeo_marking_session_id}: {aggregate.syllabus_id}"
                    )
                if assignment_key in assignment_templates:
                    assignment_templates[assignment_key] = merge_assignment_metadata(
                        assignment_templates[assignment_key],
                        aggregate,
                    )
                else:
                    assignment_templates[assignment_key] = aggregate
                assignment_rows.append(
                    {
                        "assignment_key": assignment_key,
                        "student": student,
                        "matched_user_id": matched_user_id,
                        "aggregate": aggregate,
                    }
                )

        if matched_student_updates:
            await db.execute(
                text(
                    """
                    UPDATE gradeo_students
                    SET name = :name, last_seen_at = :last_seen_at
                    WHERE gradeo_student_id = :gradeo_student_id
                    """
                ),
                matched_student_updates,
            )

        logger.info(
            "gradeo_import_step class_id=%s step=prepare_assignment_rows matched_students=%s unique_assignments=%s assignment_rows=%s",
            batch.gradeo_class_id,
            matched_count,
            len(assignment_templates),
            len(assignment_rows),
        )

        assignment_ids_by_key: dict[str, int] = {}
        for assignment_key, aggregate in assignment_templates.items():
            await upsert_gradeo_exam_definition(db, aggregate, now)
            await upsert_gradeo_exam_session(db, aggregate, now)
            assignment_id = await upsert_gradeo_class_exam_assignment(
                db,
                batch=batch,
                aggregate=aggregate,
                now=now,
            )
            assignment_ids_by_key[assignment_key] = assignment_id
            imported_assignment_ids.add(assignment_id)

        assignment_result_params: list[dict] = []
        question_result_params: list[dict] = []
        for item in assignment_rows:
            assignment_id = assignment_ids_by_key[item["assignment_key"]]
            student = item["student"]
            aggregate = item["aggregate"]
            matched_user_id = item["matched_user_id"]

            assignment_result_params.append(
                {
                    "gradeo_class_exam_assignment_id": assignment_id,
                    "gradeo_student_id": student.gradeo_student_id,
                    "canvas_course_id": canvas_course_id,
                    "user_id": matched_user_id,
                    "student_name": student.student_name,
                    "status": aggregate.status,
                    "exam_mark": aggregate.exam_mark,
                    "marks_available": aggregate.marks_available,
                    "class_average": aggregate.class_average,
                    "answer_submitted_count": aggregate.answer_submitted_count,
                    "unmarked_question_count": aggregate.unmarked_question_count,
                    "created_at": now,
                    "last_imported_at": now,
                }
            )
            imported_result_keys.add((assignment_id, student.gradeo_student_id))

            for question_row in aggregate.question_rows:
                question_result_params.append(
                    {
                        "gradeo_class_exam_assignment_id": assignment_id,
                        "gradeo_student_id": student.gradeo_student_id,
                        "gradeo_question_id": question_row.gradeo_question_id,
                        "gradeo_question_part_id": question_row.gradeo_question_part_id,
                        "copyright_notice": question_row.copyright_notice,
                        "question": question_row.question,
                        "question_part": question_row.question_part,
                        "question_link": question_row.question_link,
                        "mark": question_row.mark,
                        "marks_available": question_row.marks_available,
                        "answer_submitted": question_row.answer_submitted,
                        "feedback": question_row.feedback,
                        "marker_name": question_row.marker_name,
                        "marker_id": question_row.marker_id,
                        "marking_session_link": question_row.marking_session_link,
                        "last_imported_at": now,
                    }
                )
                imported_question_keys.add(
                    (assignment_id, student.gradeo_student_id, question_row.gradeo_question_part_id)
                )

        if assignment_result_params:
            await db.execute(
                text(
                    """
                    INSERT INTO gradeo_assignment_results (
                        gradeo_class_exam_assignment_id, gradeo_student_id, canvas_course_id, user_id, student_name,
                        status, exam_mark, marks_available, class_average, answer_submitted_count,
                        unmarked_question_count, created_at, last_imported_at
                    )
                    VALUES (
                        :gradeo_class_exam_assignment_id, :gradeo_student_id, :canvas_course_id, :user_id, :student_name,
                        :status, :exam_mark, :marks_available, :class_average, :answer_submitted_count,
                        :unmarked_question_count, :created_at, :last_imported_at
                    )
                    ON CONFLICT (gradeo_class_exam_assignment_id, gradeo_student_id) DO UPDATE SET
                        canvas_course_id = EXCLUDED.canvas_course_id,
                        user_id = EXCLUDED.user_id,
                        student_name = EXCLUDED.student_name,
                        status = EXCLUDED.status,
                        exam_mark = EXCLUDED.exam_mark,
                        marks_available = EXCLUDED.marks_available,
                        class_average = EXCLUDED.class_average,
                        answer_submitted_count = EXCLUDED.answer_submitted_count,
                        unmarked_question_count = EXCLUDED.unmarked_question_count,
                        last_imported_at = EXCLUDED.last_imported_at
                    """
                ),
                assignment_result_params,
            )

        if question_result_params:
            await db.execute(
                text(
                    """
                    INSERT INTO gradeo_assignment_question_results (
                        gradeo_class_exam_assignment_id, gradeo_student_id, gradeo_question_id, gradeo_question_part_id,
                        copyright_notice, question, question_part, question_link, mark,
                        marks_available, answer_submitted, feedback, marker_name, marker_id,
                        marking_session_link, last_imported_at
                    )
                    VALUES (
                        :gradeo_class_exam_assignment_id, :gradeo_student_id, :gradeo_question_id, :gradeo_question_part_id,
                        :copyright_notice, :question, :question_part, :question_link, :mark,
                        :marks_available, :answer_submitted, :feedback, :marker_name, :marker_id,
                        :marking_session_link, :last_imported_at
                    )
                    ON CONFLICT (gradeo_class_exam_assignment_id, gradeo_student_id, gradeo_question_part_id) DO UPDATE SET
                        gradeo_question_id = EXCLUDED.gradeo_question_id,
                        copyright_notice = EXCLUDED.copyright_notice,
                        question = EXCLUDED.question,
                        question_part = EXCLUDED.question_part,
                        question_link = EXCLUDED.question_link,
                        mark = EXCLUDED.mark,
                        marks_available = EXCLUDED.marks_available,
                        answer_submitted = EXCLUDED.answer_submitted,
                        feedback = EXCLUDED.feedback,
                        marker_name = EXCLUDED.marker_name,
                        marker_id = EXCLUDED.marker_id,
                        marking_session_link = EXCLUDED.marking_session_link,
                        last_imported_at = EXCLUDED.last_imported_at
                    """
                ),
                question_result_params,
            )

        imported_exam_results = len(assignment_result_params)
        imported_question_results = len(question_result_params)
        logger.info(
            "gradeo_import_step class_id=%s step=bulk_write_results assignment_results=%s question_results=%s",
            batch.gradeo_class_id,
            imported_exam_results,
            imported_question_results,
        )

        await prune_class_import_state(
            db,
            gradeo_class_id=batch.gradeo_class_id,
            imported_assignment_ids=imported_assignment_ids,
            imported_result_keys=imported_result_keys,
            imported_question_keys=imported_question_keys,
        )
    except Exception as exc:
        await finish_import_run(
            db,
            run_id,
            status="error",
            processed_students=processed_students,
            matched_students=matched_count,
            imported_exams=imported_exam_results,
            imported_question_results=imported_question_results,
            unmatched_students=unmatched_count,
            skipped_students=skipped_count,
            error_message=str(exc),
        )
        raise

    await finish_import_run(
        db,
        run_id,
        processed_students=processed_students,
        matched_students=matched_count,
        imported_exams=imported_exam_results,
        imported_question_results=imported_question_results,
        unmatched_students=unmatched_count,
        skipped_students=skipped_count,
    )

    logger.info(
        "gradeo_import_complete run_id=%s class_id=%s class_name=%s canvas_course_id=%s processed_students=%s matched_students=%s imported_exams=%s imported_question_results=%s unmatched_students=%s skipped_students=%s",
        run_id,
        batch.gradeo_class_id,
        batch.gradeo_class_name,
        canvas_course_id,
        processed_students,
        matched_count,
        imported_exam_results,
        imported_question_results,
        unmatched_count,
        skipped_count,
    )
    logger.info(
        "gradeo_import_complete_timing run_id=%s class_id=%s total_duration_ms=%s",
        run_id,
        batch.gradeo_class_id,
        round((perf_counter() - started_at) * 1000, 1),
    )

    return {
        "run_id": run_id,
        "canvas_course_id": canvas_course_id,
        "processed_students": processed_students,
        "matched_students": matched_count,
        "imported_exams": imported_exam_results,
        "imported_question_results": imported_question_results,
        "unmatched_students": unmatched_count,
        "skipped_students": skipped_count,
    }
