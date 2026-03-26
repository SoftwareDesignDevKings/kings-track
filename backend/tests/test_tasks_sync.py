"""
Tests for sync tasks: sync_courses, sync_enrollments, sync_assignments,
compute_metrics. All use a mocked CanvasClient + real DB via the `db` fixture.
"""
import pytest
from datetime import datetime, timezone
from unittest.mock import MagicMock
from sqlalchemy import text

from app.sync.tasks import sync_courses, sync_enrollments, sync_assignments, sync_submissions, compute_metrics
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


def _make_submission(submission_id=66600, assignment_id=55500, user_id=USER_ID):
    return {
        "id": submission_id,
        "assignment_id": assignment_id,
        "user_id": user_id,
        "score": 8.0,
        "grade": "B",
        "workflow_state": "graded",
        "submitted_at": "2026-01-01T10:00:00Z",
        "graded_at": "2026-01-01T11:00:00Z",
        "late": False,
        "missing": False,
        "excused": False,
        "attempt": 2,
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

    count = await sync_courses(mock_canvas, db)

    assert count == 1
    result = await db.execute(text("SELECT name FROM courses WHERE id = :id"), {"id": COURSE_ID})
    assert result.scalar() == "Test Course"




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
# sync_submissions
# ---------------------------------------------------------------------------

async def test_sync_submissions_inserts_batch_and_skips_unused_fields(db):
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
        "INSERT INTO assignments (id, course_id, name, workflow_state) VALUES (55500, :cid, 'A0', 'published') ON CONFLICT (id) DO NOTHING",
        {"cid": COURSE_ID},
    )
    seed(
        "INSERT INTO assignments (id, course_id, name, workflow_state) VALUES (55501, :cid, 'A1', 'published') ON CONFLICT (id) DO NOTHING",
        {"cid": COURSE_ID},
    )

    mock_canvas = MagicMock()
    mock_canvas.list_submissions.return_value = _async_gen([
        _make_submission(66600, 55500),
        _make_submission(66601, 55501),
    ])

    count = await sync_submissions(mock_canvas, db, COURSE_ID)

    assert count == 2
    result = await db.execute(
        text("""
            SELECT score, workflow_state, late, missing, excused, grade, submitted_at, graded_at, attempt
            FROM submissions
            WHERE assignment_id = 55500 AND user_id = :uid
        """),
        {"uid": USER_ID},
    )
    row = result.fetchone()
    assert row is not None
    assert row[0] == 8.0
    assert row[1] == "graded"
    assert row[2] is False
    assert row[3] is False
    assert row[4] is False
    assert row[5] is None
    assert row[6] is None
    assert row[7] is None
    assert row[8] is None


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
