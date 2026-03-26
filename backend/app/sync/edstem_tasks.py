"""
EdStem sync task. Fetches lesson completion data from EdStem and upserts
it into the local database.
"""
import logging
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.edstem.client import EdStemClient

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


async def sync_edstem_lessons(client: EdStemClient, db: AsyncSession, canvas_course_id: int) -> int:
    """
    Sync EdStem lesson progress for a Canvas course.

    1. Look up the edstem_course_mapping for this canvas_course_id. If none, return 0.
    2. Fetch and upsert lesson metadata into edstem_lessons.
    3. Fetch per-student lesson_user_summaries and upsert into edstem_lesson_progress.

    Returns the number of progress records upserted.
    """
    # 1. Look up mapping
    result = await db.execute(
        text("SELECT edstem_course_id FROM edstem_course_mappings WHERE canvas_course_id = :cid"),
        {"cid": canvas_course_id},
    )
    row = result.fetchone()
    if not row:
        return 0

    edstem_course_id: int = row[0]
    now = _now()

    # 2. Fetch and upsert lessons
    lessons_data = await client.get_lessons(edstem_course_id)
    lessons: list[dict] = lessons_data.get("lessons", [])
    modules: list[dict] = lessons_data.get("modules", [])

    # Build module_id → name map
    module_names: dict[int, str] = {m["id"]: m.get("name", "") for m in modules}

    for lesson in lessons:
        await db.execute(
            text("""
                INSERT INTO edstem_lessons
                    (id, edstem_course_id, title, module_id, module_name, lesson_type,
                     is_interactive, slide_count, position, synced_at)
                VALUES
                    (:id, :edstem_course_id, :title, :module_id, :module_name, :lesson_type,
                     :is_interactive, :slide_count, :position, :synced_at)
                ON CONFLICT (id) DO UPDATE SET
                    edstem_course_id = EXCLUDED.edstem_course_id,
                    title = EXCLUDED.title,
                    module_id = EXCLUDED.module_id,
                    module_name = EXCLUDED.module_name,
                    lesson_type = EXCLUDED.lesson_type,
                    is_interactive = EXCLUDED.is_interactive,
                    slide_count = EXCLUDED.slide_count,
                    position = EXCLUDED.position,
                    synced_at = EXCLUDED.synced_at
            """),
            {
                "id": lesson["id"],
                "edstem_course_id": edstem_course_id,
                "title": lesson.get("title", ""),
                "module_id": lesson.get("module_id"),
                "module_name": module_names.get(lesson.get("module_id")) if lesson.get("module_id") else None,
                "lesson_type": lesson.get("type"),
                "is_interactive": False,  # will be updated below after we know interactive_lessons
                "slide_count": lesson.get("slide_count"),
                "position": lesson.get("index"),
                "synced_at": now,
            },
        )

    await db.commit()

    # 3. Fetch per-student summaries
    summaries = await client.get_lesson_user_summaries(edstem_course_id)
    edstem_users: list[dict] = summaries.get("users", [])
    interactive_lesson_ids: set[int] = set(summaries.get("interactive_lessons", []))

    # Mark interactive lessons
    if interactive_lesson_ids:
        await db.execute(
            text("""
                UPDATE edstem_lessons
                SET is_interactive = true
                WHERE id = ANY(:ids) AND edstem_course_id = :edstem_course_id
            """),
            {"ids": list(interactive_lesson_ids), "edstem_course_id": edstem_course_id},
        )
        await db.commit()

    # Build email → canvas user_id map for enrolled students in this course
    result = await db.execute(
        text("""
            SELECT u.email, u.id
            FROM users u
            JOIN enrollments e ON e.user_id = u.id
            WHERE e.course_id = :course_id
              AND e.role = 'StudentEnrollment'
              AND u.email IS NOT NULL
        """),
        {"course_id": canvas_course_id},
    )
    email_to_canvas_id: dict[str, int] = {
        row[0].lower(): row[1] for row in result.fetchall()
    }

    # Collect all lesson IDs for this course to determine not_started
    result = await db.execute(
        text("SELECT id FROM edstem_lessons WHERE edstem_course_id = :edstem_course_id"),
        {"edstem_course_id": edstem_course_id},
    )
    all_lesson_ids: set[int] = {row[0] for row in result.fetchall()}

    count = 0
    batch: list[dict] = []

    for edstem_user in edstem_users:
        if edstem_user.get("course_role") != "student":
            continue

        email = (edstem_user.get("email") or "").lower()
        canvas_user_id = email_to_canvas_id.get(email)
        if not canvas_user_id:
            continue  # no matching Canvas user — skip

        completed: dict[str, str] = edstem_user.get("completed", {}) or {}
        interactive_completed: dict[str, str] = edstem_user.get("interactive_completed", {}) or {}
        viewed: set[int] = set(edstem_user.get("viewed", []) or [])

        # Merge all completed lesson IDs (both regular and interactive)
        all_completed_map: dict[str, str] = {**completed, **interactive_completed}

        for lesson_id in all_lesson_ids:
            lesson_id_str = str(lesson_id)
            if lesson_id_str in all_completed_map:
                status = "completed"
                completed_at = _parse_dt(all_completed_map[lesson_id_str])
            elif lesson_id in viewed:
                status = "viewed"
                completed_at = None
            else:
                status = "not_started"
                completed_at = None

            batch.append({
                "edstem_course_id": edstem_course_id,
                "edstem_lesson_id": lesson_id,
                "user_id": canvas_user_id,
                "status": status,
                "completed_at": completed_at,
                "synced_at": now,
            })

        # Commit in batches of 100
        if len(batch) >= 100:
            await _upsert_progress_batch(db, batch)
            count += len(batch)
            batch = []

    if batch:
        await _upsert_progress_batch(db, batch)
        count += len(batch)

    return count


async def _upsert_progress_batch(db: AsyncSession, batch: list[dict]) -> None:
    for record in batch:
        await db.execute(
            text("""
                INSERT INTO edstem_lesson_progress
                    (edstem_course_id, edstem_lesson_id, user_id, status, completed_at, synced_at)
                VALUES
                    (:edstem_course_id, :edstem_lesson_id, :user_id, :status, :completed_at, :synced_at)
                ON CONFLICT (edstem_lesson_id, user_id) DO UPDATE SET
                    edstem_course_id = EXCLUDED.edstem_course_id,
                    status = EXCLUDED.status,
                    completed_at = EXCLUDED.completed_at,
                    synced_at = EXCLUDED.synced_at
            """),
            record,
        )
    await db.commit()
