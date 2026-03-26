"""
Tests for sync_edstem_lessons() in app.sync.edstem_tasks.
"""
import pytest
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock

from tests.conftest import seed, cleanup
from app.sync.edstem_tasks import sync_edstem_lessons

COURSE_ID = 77001          # Canvas course ID
EDSTEM_COURSE_ID = 28555
USER_ID = 88001
ENROLLMENT_ID = 78001
LESSON_ID_1 = 93001
LESSON_ID_2 = 93002
USER_EMAIL = "test.student@student.kings.edu.au"
COMPLETED_AT = "2026-01-15T10:30:00.000000+11:00"


@pytest.fixture(autouse=True)
def base_data():
    """Seed a course + user + enrollment for all tests."""
    now = datetime.now(timezone.utc).isoformat()
    seed(
        "INSERT INTO courses (id, name, course_code, workflow_state, synced_at, total_students) "
        "VALUES (:id, 'Test Course', 'TC2026', 'available', :now, 1) ON CONFLICT (id) DO NOTHING",
        {"id": COURSE_ID, "now": now},
    )
    seed(
        "INSERT INTO users (id, name, sortable_name, email) "
        "VALUES (:id, 'Test Student', 'Student, Test', :email) ON CONFLICT (id) DO NOTHING",
        {"id": USER_ID, "email": USER_EMAIL},
    )
    seed(
        "INSERT INTO enrollments (id, course_id, user_id, role, enrollment_state) "
        "VALUES (:id, :cid, :uid, 'StudentEnrollment', 'active') ON CONFLICT (id) DO NOTHING",
        {"id": ENROLLMENT_ID, "cid": COURSE_ID, "uid": USER_ID},
    )
    yield
    cleanup("DELETE FROM edstem_lesson_progress WHERE edstem_course_id = :id", {"id": EDSTEM_COURSE_ID})
    cleanup("DELETE FROM edstem_lessons WHERE edstem_course_id = :id", {"id": EDSTEM_COURSE_ID})
    cleanup("DELETE FROM edstem_course_mappings WHERE canvas_course_id = :id", {"id": COURSE_ID})
    cleanup("DELETE FROM enrollments WHERE course_id = :id", {"id": COURSE_ID})
    cleanup("DELETE FROM users WHERE id = :id", {"id": USER_ID})
    cleanup("DELETE FROM courses WHERE id = :id", {"id": COURSE_ID})


def _make_client(lessons=None, modules=None, users=None, interactive_lessons=None):
    """Build a mock EdStemClient with the given response data."""
    client = AsyncMock()
    client.__aenter__ = AsyncMock(return_value=client)
    client.__aexit__ = AsyncMock(return_value=False)
    client.get_lessons = AsyncMock(return_value={
        "lessons": lessons or [],
        "modules": modules or [],
    })
    client.get_lesson_user_summaries = AsyncMock(return_value={
        "users": users or [],
        "interactive_lessons": interactive_lessons or [],
    })
    return client


def _make_lesson(lesson_id, module_id=1):
    return {"id": lesson_id, "title": f"Lesson {lesson_id}", "module_id": module_id, "type": "python", "slide_count": 5, "index": 1}


def _make_user(completed=None, interactive_completed=None, viewed=None):
    return {
        "user_id": 9999,
        "name": "Test Student",
        "email": USER_EMAIL,
        "course_role": "student",
        "completed": completed or {},
        "interactive_completed": interactive_completed or {},
        "viewed": viewed or [],
    }


async def test_no_mapping_returns_zero(db):
    """Returns 0 immediately when no edstem_course_mapping exists."""
    client = _make_client()
    result = await sync_edstem_lessons(client, db, COURSE_ID)
    assert result == 0
    client.get_lessons.assert_not_called()


async def test_sync_marks_completed(db):
    """Lesson in 'completed' dict → status='completed' with completed_at stored."""
    seed(
        "INSERT INTO edstem_course_mappings (canvas_course_id, edstem_course_id) VALUES (:cid, :eid) ON CONFLICT (canvas_course_id) DO NOTHING",
        {"cid": COURSE_ID, "eid": EDSTEM_COURSE_ID},
    )
    client = _make_client(
        lessons=[_make_lesson(LESSON_ID_1)],
        modules=[{"id": 1, "name": "Module 1"}],
        users=[_make_user(completed={str(LESSON_ID_1): COMPLETED_AT})],
    )
    count = await sync_edstem_lessons(client, db, COURSE_ID)
    assert count > 0

    from sqlalchemy import text
    result = await db.execute(
        text("SELECT status, completed_at FROM edstem_lesson_progress WHERE edstem_lesson_id = :lid AND user_id = :uid"),
        {"lid": LESSON_ID_1, "uid": USER_ID},
    )
    row = result.fetchone()
    assert row is not None
    assert row[0] == "completed"
    assert row[1] is not None


async def test_sync_marks_interactive_completed(db):
    """Lesson in 'interactive_completed' dict → status='completed'."""
    seed(
        "INSERT INTO edstem_course_mappings (canvas_course_id, edstem_course_id) VALUES (:cid, :eid) ON CONFLICT (canvas_course_id) DO NOTHING",
        {"cid": COURSE_ID, "eid": EDSTEM_COURSE_ID},
    )
    client = _make_client(
        lessons=[_make_lesson(LESSON_ID_1)],
        modules=[{"id": 1, "name": "Module 1"}],
        users=[_make_user(interactive_completed={str(LESSON_ID_1): COMPLETED_AT})],
        interactive_lessons=[LESSON_ID_1],
    )
    count = await sync_edstem_lessons(client, db, COURSE_ID)
    assert count > 0

    from sqlalchemy import text
    result = await db.execute(
        text("SELECT status FROM edstem_lesson_progress WHERE edstem_lesson_id = :lid AND user_id = :uid"),
        {"lid": LESSON_ID_1, "uid": USER_ID},
    )
    row = result.fetchone()
    assert row is not None
    assert row[0] == "completed"


async def test_sync_marks_viewed(db):
    """Lesson in 'viewed' list but not completed → status='viewed'."""
    seed(
        "INSERT INTO edstem_course_mappings (canvas_course_id, edstem_course_id) VALUES (:cid, :eid) ON CONFLICT (canvas_course_id) DO NOTHING",
        {"cid": COURSE_ID, "eid": EDSTEM_COURSE_ID},
    )
    client = _make_client(
        lessons=[_make_lesson(LESSON_ID_1)],
        modules=[{"id": 1, "name": "Module 1"}],
        users=[_make_user(viewed=[LESSON_ID_1])],
    )
    count = await sync_edstem_lessons(client, db, COURSE_ID)
    assert count > 0

    from sqlalchemy import text
    result = await db.execute(
        text("SELECT status, completed_at FROM edstem_lesson_progress WHERE edstem_lesson_id = :lid AND user_id = :uid"),
        {"lid": LESSON_ID_1, "uid": USER_ID},
    )
    row = result.fetchone()
    assert row is not None
    assert row[0] == "viewed"
    assert row[1] is None


async def test_sync_marks_not_started(db):
    """Lesson absent from all fields → status='not_started'."""
    seed(
        "INSERT INTO edstem_course_mappings (canvas_course_id, edstem_course_id) VALUES (:cid, :eid) ON CONFLICT (canvas_course_id) DO NOTHING",
        {"cid": COURSE_ID, "eid": EDSTEM_COURSE_ID},
    )
    client = _make_client(
        lessons=[_make_lesson(LESSON_ID_1)],
        modules=[{"id": 1, "name": "Module 1"}],
        users=[_make_user()],  # nothing completed or viewed
    )
    count = await sync_edstem_lessons(client, db, COURSE_ID)
    assert count > 0

    from sqlalchemy import text
    result = await db.execute(
        text("SELECT status FROM edstem_lesson_progress WHERE edstem_lesson_id = :lid AND user_id = :uid"),
        {"lid": LESSON_ID_1, "uid": USER_ID},
    )
    row = result.fetchone()
    assert row is not None
    assert row[0] == "not_started"


async def test_email_match_case_insensitive(db):
    """EdStem email matched to Canvas user case-insensitively."""
    seed(
        "INSERT INTO edstem_course_mappings (canvas_course_id, edstem_course_id) VALUES (:cid, :eid) ON CONFLICT (canvas_course_id) DO NOTHING",
        {"cid": COURSE_ID, "eid": EDSTEM_COURSE_ID},
    )
    # Use uppercase in EdStem user
    user = _make_user(completed={str(LESSON_ID_1): COMPLETED_AT})
    user["email"] = USER_EMAIL.upper()

    client = _make_client(
        lessons=[_make_lesson(LESSON_ID_1)],
        modules=[{"id": 1, "name": "Module 1"}],
        users=[user],
    )
    count = await sync_edstem_lessons(client, db, COURSE_ID)
    assert count > 0


async def test_unmatched_student_skipped(db):
    """EdStem user with no Canvas email match produces no progress records."""
    seed(
        "INSERT INTO edstem_course_mappings (canvas_course_id, edstem_course_id) VALUES (:cid, :eid) ON CONFLICT (canvas_course_id) DO NOTHING",
        {"cid": COURSE_ID, "eid": EDSTEM_COURSE_ID},
    )
    user = _make_user(completed={str(LESSON_ID_1): COMPLETED_AT})
    user["email"] = "nobody@unknown.com"

    client = _make_client(
        lessons=[_make_lesson(LESSON_ID_1)],
        modules=[{"id": 1, "name": "Module 1"}],
        users=[user],
    )
    count = await sync_edstem_lessons(client, db, COURSE_ID)
    assert count == 0


async def test_upsert_idempotent(db):
    """Running sync twice produces same result — no duplicate rows."""
    seed(
        "INSERT INTO edstem_course_mappings (canvas_course_id, edstem_course_id) VALUES (:cid, :eid) ON CONFLICT (canvas_course_id) DO NOTHING",
        {"cid": COURSE_ID, "eid": EDSTEM_COURSE_ID},
    )
    client = _make_client(
        lessons=[_make_lesson(LESSON_ID_1)],
        modules=[{"id": 1, "name": "Module 1"}],
        users=[_make_user(completed={str(LESSON_ID_1): COMPLETED_AT})],
    )

    count1 = await sync_edstem_lessons(client, db, COURSE_ID)
    count2 = await sync_edstem_lessons(client, db, COURSE_ID)
    assert count1 == count2

    from sqlalchemy import text
    result = await db.execute(
        text("SELECT COUNT(*) FROM edstem_lesson_progress WHERE edstem_lesson_id = :lid AND user_id = :uid"),
        {"lid": LESSON_ID_1, "uid": USER_ID},
    )
    assert result.scalar() == 1
