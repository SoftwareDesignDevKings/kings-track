"""
Tests for sync_submissions FK-guard logic.
"""
import pytest
from datetime import datetime, timezone
from unittest.mock import MagicMock
from sqlalchemy import text

from app.sync.tasks import sync_submissions
from tests.conftest import seed, cleanup

COURSE_ID = 77770
ENROLLED_USER_ID = 20100
UNENROLLED_USER_ID = 99900
ASSIGNMENT_ID = 30100


async def _async_gen(items):
    for item in items:
        yield item


def _make_submission(user_id: int, assignment_id: int = ASSIGNMENT_ID) -> dict:
    return {
        "id": user_id * 100 + assignment_id,
        "user_id": user_id,
        "assignment_id": assignment_id,
        "workflow_state": "submitted",
        "score": None,
        "grade": None,
        "submitted_at": None,
        "graded_at": None,
        "late": False,
        "missing": False,
        "excused": None,
        "attempt": 1,
    }


@pytest.fixture(autouse=True)
def setup_course():
    now = datetime.now(timezone.utc).isoformat()
    seed("INSERT INTO courses (id, name, workflow_state, synced_at, total_students) VALUES (:id, 'Test', 'available', :now, 0) ON CONFLICT (id) DO NOTHING", {"id": COURSE_ID, "now": now})
    seed("INSERT INTO users (id, name, sis_id) VALUES (:id, 'Enrolled', :sis) ON CONFLICT (id) DO NOTHING", {"id": ENROLLED_USER_ID, "sis": str(ENROLLED_USER_ID)})
    seed("INSERT INTO enrollments (id, course_id, user_id, role, enrollment_state) VALUES (:id, :cid, :uid, 'StudentEnrollment', 'active') ON CONFLICT (id) DO NOTHING", {"id": 50010, "cid": COURSE_ID, "uid": ENROLLED_USER_ID})
    seed("INSERT INTO assignments (id, course_id, name, workflow_state) VALUES (:id, :cid, 'A1', 'published') ON CONFLICT (id) DO NOTHING", {"id": ASSIGNMENT_ID, "cid": COURSE_ID})
    yield
    cleanup("DELETE FROM submissions WHERE course_id = :id", {"id": COURSE_ID})
    cleanup("DELETE FROM enrollments WHERE course_id = :id", {"id": COURSE_ID})
    cleanup("DELETE FROM assignments WHERE course_id = :id", {"id": COURSE_ID})
    cleanup("DELETE FROM users WHERE id = :id", {"id": ENROLLED_USER_ID})
    cleanup("DELETE FROM courses WHERE id = :id", {"id": COURSE_ID})


async def test_skips_submission_for_unenrolled_user(db):
    mock_canvas = MagicMock()
    mock_canvas.list_submissions.return_value = _async_gen([_make_submission(UNENROLLED_USER_ID)])

    await sync_submissions(mock_canvas, db, COURSE_ID)

    result = await db.execute(
        text("SELECT COUNT(*) FROM submissions WHERE course_id = :cid"), {"cid": COURSE_ID}
    )
    assert result.scalar() == 0


async def test_inserts_submission_for_enrolled_user(db):
    mock_canvas = MagicMock()
    mock_canvas.list_submissions.return_value = _async_gen([_make_submission(ENROLLED_USER_ID)])

    count = await sync_submissions(mock_canvas, db, COURSE_ID)
    assert count == 1

    result = await db.execute(
        text("SELECT COUNT(*) FROM submissions WHERE course_id = :cid AND user_id = :uid"),
        {"cid": COURSE_ID, "uid": ENROLLED_USER_ID},
    )
    assert result.scalar() == 1


async def test_skips_submission_missing_user_id(db):
    mock_canvas = MagicMock()
    mock_canvas.list_submissions.return_value = _async_gen([
        {"id": 9999, "user_id": None, "assignment_id": ASSIGNMENT_ID,
         "workflow_state": "submitted", "score": None, "grade": None,
         "submitted_at": None, "graded_at": None, "late": False,
         "missing": False, "excused": None, "attempt": 1},
    ])

    count = await sync_submissions(mock_canvas, db, COURSE_ID)
    assert count == 0
