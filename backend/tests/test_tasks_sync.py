"""
Tests for sync tasks: sync_courses, sync_enrollments, sync_assignments,
compute_metrics. All use a mocked CanvasClient + real DB via the `db` fixture.
"""
import pytest
from datetime import datetime, timezone
from unittest.mock import MagicMock
from sqlalchemy import text

from app.sync.tasks import sync_courses, sync_enrollments, sync_assignments, compute_metrics
from tests.conftest import seed, cleanup

COURSE_ID = 44400
USER_ID = 44410
ENROLLMENT_ID = 44420


async def _async_gen(items):
    for item in items:
        yield item


def _make_course(course_id=COURSE_ID):
    return {
        "id": course_id,
        "name": "Test Course",
        "course_code": "TC101",
        "workflow_state": "available",
        "account_id": 1,
        "enrollment_term_id": 1,
        "total_students": 5,
    }


def _make_enrollment(user_id=USER_ID):
    return {
        "id": ENROLLMENT_ID,
        "type": "StudentEnrollment",
        "enrollment_state": "active",
        "last_activity_at": None,
        "user": {
            "id": user_id,
            "name": "Test Student",
            "sortable_name": "Student, Test",
            "email": "test@example.com",
            "sis_user_id": "sis123",
        },
        "grades": {
            "current_score": 85.0,
            "current_grade": "B",
            "final_score": 82.0,
            "final_grade": "B-",
        },
    }


def _make_assignment(assignment_id=55500):
    return {
        "id": assignment_id,
        "name": "Task 1",
        "assignment_group_id": 10,
        "points_possible": 10.0,
        "due_at": None,
        "unlock_at": None,
        "position": 1,
        "workflow_state": "published",
        "submission_types": ["online_text_entry"],
    }


@pytest.fixture(autouse=True)
def cleanup_tasks_data():
    yield
    cleanup("DELETE FROM student_metrics WHERE course_id = :id", {"id": COURSE_ID})
    cleanup("DELETE FROM submissions WHERE course_id = :id", {"id": COURSE_ID})
    cleanup("DELETE FROM enrollments WHERE course_id = :id", {"id": COURSE_ID})
    cleanup("DELETE FROM assignments WHERE course_id = :id", {"id": COURSE_ID})
    cleanup("DELETE FROM users WHERE id = :id", {"id": USER_ID})
    cleanup("DELETE FROM courses WHERE id = :id", {"id": COURSE_ID})


# ---------------------------------------------------------------------------
# sync_courses
# ---------------------------------------------------------------------------

async def test_sync_courses_inserts_course(db):
    mock_canvas = MagicMock()
    mock_canvas.list_courses = MagicMock(return_value=None)

    import asyncio
    async def _courses():
        return [_make_course()]

    mock_canvas.list_courses = _courses

    with __import__('unittest.mock', fromlist=['patch']).patch(
        'app.sync.tasks.settings'
    ) as mock_settings:
        mock_settings.course_whitelist = []
        count = await sync_courses(mock_canvas, db)

    assert count == 1
    result = await db.execute(text("SELECT name FROM courses WHERE id = :id"), {"id": COURSE_ID})
    assert result.scalar() == "Test Course"


async def test_sync_courses_applies_whitelist(db):
    """When whitelist is set, courses not in it are excluded."""
    async def _courses():
        return [_make_course(COURSE_ID), _make_course(99999)]

    mock_canvas = MagicMock()
    mock_canvas.list_courses = _courses

    with __import__('unittest.mock', fromlist=['patch']).patch(
        'app.sync.tasks.settings'
    ) as mock_settings:
        mock_settings.course_whitelist = [COURSE_ID]
        count = await sync_courses(mock_canvas, db)

    assert count == 1
    result = await db.execute(text("SELECT COUNT(*) FROM courses WHERE id IN (:a, :b)"), {"a": COURSE_ID, "b": 99999})
    assert result.scalar() == 1


# ---------------------------------------------------------------------------
# sync_enrollments
# ---------------------------------------------------------------------------

async def test_sync_enrollments_inserts_user_and_enrollment(db):
    now = datetime.now(timezone.utc).isoformat()
    seed(
        "INSERT INTO courses (id, name, workflow_state, synced_at, total_students) VALUES (:id, 'C', 'available', :now, 0) ON CONFLICT (id) DO NOTHING",
        {"id": COURSE_ID, "now": now},
    )

    mock_canvas = MagicMock()
    mock_canvas.list_enrollments.return_value = _async_gen([_make_enrollment()])

    count = await sync_enrollments(mock_canvas, db, COURSE_ID)

    assert count == 1
    result = await db.execute(text("SELECT name FROM users WHERE id = :id"), {"id": USER_ID})
    assert result.scalar() == "Test Student"

    result = await db.execute(
        text("SELECT enrollment_state FROM enrollments WHERE id = :id"), {"id": ENROLLMENT_ID}
    )
    assert result.scalar() == "active"


async def test_sync_enrollments_stores_grades(db):
    now = datetime.now(timezone.utc).isoformat()
    seed(
        "INSERT INTO courses (id, name, workflow_state, synced_at, total_students) VALUES (:id, 'C', 'available', :now, 0) ON CONFLICT (id) DO NOTHING",
        {"id": COURSE_ID, "now": now},
    )

    mock_canvas = MagicMock()
    mock_canvas.list_enrollments.return_value = _async_gen([_make_enrollment()])

    await sync_enrollments(mock_canvas, db, COURSE_ID)

    result = await db.execute(
        text("SELECT current_score FROM enrollments WHERE id = :id"), {"id": ENROLLMENT_ID}
    )
    assert result.scalar() == 85.0


# ---------------------------------------------------------------------------
# sync_assignments
# ---------------------------------------------------------------------------

async def test_sync_assignments_inserts_assignment(db):
    now = datetime.now(timezone.utc).isoformat()
    seed(
        "INSERT INTO courses (id, name, workflow_state, synced_at, total_students) VALUES (:id, 'C', 'available', :now, 0) ON CONFLICT (id) DO NOTHING",
        {"id": COURSE_ID, "now": now},
    )

    mock_canvas = MagicMock()
    async def _groups(_course_id):
        return [{"id": 10, "name": "Classwork"}]

    mock_canvas.list_assignment_groups = _groups
    mock_canvas.list_assignments.return_value = _async_gen([_make_assignment(55500)])

    count = await sync_assignments(mock_canvas, db, COURSE_ID)

    assert count == 1
    result = await db.execute(
        text("SELECT assignment_group_name FROM assignments WHERE id = 55500")
    )
    assert result.scalar() == "Classwork"


# ---------------------------------------------------------------------------
# compute_metrics
# ---------------------------------------------------------------------------

async def test_compute_metrics_writes_completion_rate(db):
    now = datetime.now(timezone.utc).isoformat()
    seed(
        "INSERT INTO courses (id, name, workflow_state, synced_at, total_students) VALUES (:id, 'C', 'available', :now, 0) ON CONFLICT (id) DO NOTHING",
        {"id": COURSE_ID, "now": now},
    )
    seed(
        "INSERT INTO users (id, name, sis_id) VALUES (:id, 'S', :sis) ON CONFLICT (id) DO NOTHING",
        {"id": USER_ID, "sis": str(USER_ID)},
    )
    seed(
        "INSERT INTO enrollments (id, course_id, user_id, role, enrollment_state) VALUES (:id, :cid, :uid, 'StudentEnrollment', 'active') ON CONFLICT (id) DO NOTHING",
        {"id": ENROLLMENT_ID, "cid": COURSE_ID, "uid": USER_ID},
    )
    seed(
        "INSERT INTO assignments (id, course_id, name, workflow_state) VALUES (55501, :cid, 'A1', 'published') ON CONFLICT (id) DO NOTHING",
        {"cid": COURSE_ID},
    )
    seed(
        "INSERT INTO submissions (id, assignment_id, user_id, course_id, workflow_state, late, missing) VALUES (66601, 55501, :uid, :cid, 'graded', false, false) ON CONFLICT (assignment_id, user_id) DO NOTHING",
        {"uid": USER_ID, "cid": COURSE_ID},
    )

    count = await compute_metrics(db, COURSE_ID)

    assert count == 1
    result = await db.execute(
        text("SELECT completion_rate FROM student_metrics WHERE course_id = :cid AND user_id = :uid"),
        {"cid": COURSE_ID, "uid": USER_ID},
    )
    rate = result.scalar()
    assert rate == 1.0  # 1 graded / 1 assignment = 100%

    # Cleanup in FK-safe order (submissions before assignments)
    cleanup("DELETE FROM submissions WHERE id = 66601")
    cleanup("DELETE FROM assignments WHERE id = 55501")
