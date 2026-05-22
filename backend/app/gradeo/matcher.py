from __future__ import annotations

from sqlalchemy import bindparam, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.gradeo.normalizer import normalize_match_key


async def get_whitelisted_courses(db: AsyncSession) -> list[dict]:
    result = await db.execute(
        text(
            """
            SELECT course_id, name, course_code
            FROM course_whitelist
            ORDER BY name
            """
        )
    )
    return [
        {
            "course_id": row[0],
            "name": row[1] or "",
            "course_code": row[2],
        }
        for row in result.fetchall()
    ]


def find_course_candidates(class_name: str, courses: list[dict]) -> list[dict]:
    class_key = normalize_match_key(class_name)
    if not class_key:
        return []

    matches: list[dict] = []
    for course in courses:
        code_key = normalize_match_key(course.get("course_code"))
        name_key = normalize_match_key(course.get("name"))
        if class_key and class_key in {code_key, name_key}:
            matches.append(course)
    return matches


def unique_course_candidate(class_name: str, courses: list[dict]) -> dict | None:
    candidates = find_course_candidates(class_name, courses)
    if len(candidates) == 1:
        return candidates[0]
    return None


async def get_whitelisted_users_by_email(db: AsyncSession, emails: list[str]) -> dict[str, dict]:
    if not emails:
        return {}

    statement = text(
        """
        SELECT DISTINCT lower(u.email) AS email, u.id, u.name
        FROM users u
        JOIN enrollments e ON e.user_id = u.id
        JOIN course_whitelist cw ON cw.course_id = e.course_id
        WHERE u.email IS NOT NULL
          AND lower(u.email) IN :emails
        """
    ).bindparams(bindparam("emails", expanding=True))
    result = await db.execute(statement, {"emails": emails})
    return {
        row[0]: {"user_id": row[1], "name": row[2]}
        for row in result.fetchall()
    }


async def get_course_student_ids(db: AsyncSession, course_id: int) -> set[int]:
    result = await db.execute(
        text(
            """
            SELECT DISTINCT user_id
            FROM enrollments
            WHERE course_id = :course_id AND role = 'StudentEnrollment'
            """
        ),
        {"course_id": course_id},
    )
    return {row[0] for row in result.fetchall()}


async def get_whitelisted_enrollments_for_users(
    db: AsyncSession, user_ids: list[int]
) -> dict[int, set[int]]:
    """Return {user_id: {course_id, ...}} for all whitelisted student enrollments."""
    if not user_ids:
        return {}

    result = await db.execute(
        text(
            """
            SELECT e.user_id, e.course_id
            FROM enrollments e
            JOIN course_whitelist cw ON cw.course_id = e.course_id
            WHERE e.user_id IN :user_ids AND e.role = 'StudentEnrollment'
            """
        ).bindparams(bindparam("user_ids", expanding=True)),
        {"user_ids": user_ids},
    )
    enrollments: dict[int, set[int]] = {}
    for row in result.fetchall():
        enrollments.setdefault(row[0], set()).add(row[1])
    return enrollments
