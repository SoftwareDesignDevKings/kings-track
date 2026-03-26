"""
Tests for GET /api/courses/{id}/edstem-matrix.
"""
import pytest
from datetime import datetime, timezone
from tests.conftest import seed, cleanup

COURSE_ID = 77100
EDSTEM_COURSE_ID = 28666
USER_ID_1 = 88100
USER_ID_2 = 88101
ENROLLMENT_ID_1 = 78100
ENROLLMENT_ID_2 = 78101
LESSON_ID_1 = 93100
LESSON_ID_2 = 93101
MODULE_NAME = "Intro Module"


@pytest.fixture(autouse=True)
def edstem_matrix_data():
    now = datetime.now(timezone.utc).isoformat()
    seed(
        "INSERT INTO courses (id, name, course_code, workflow_state, synced_at, total_students) "
        "VALUES (:id, 'SE Course', 'SE2026', 'available', :now, 2) ON CONFLICT (id) DO NOTHING",
        {"id": COURSE_ID, "now": now},
    )
    seed(
        "INSERT INTO users (id, name, sortable_name) VALUES (:id, 'Alice Smith', 'Smith, Alice') ON CONFLICT (id) DO NOTHING",
        {"id": USER_ID_1},
    )
    seed(
        "INSERT INTO users (id, name, sortable_name) VALUES (:id, 'Bob Jones', 'Jones, Bob') ON CONFLICT (id) DO NOTHING",
        {"id": USER_ID_2},
    )
    seed(
        "INSERT INTO enrollments (id, course_id, user_id, role, enrollment_state) "
        "VALUES (:id, :cid, :uid, 'StudentEnrollment', 'active') ON CONFLICT (id) DO NOTHING",
        {"id": ENROLLMENT_ID_1, "cid": COURSE_ID, "uid": USER_ID_1},
    )
    seed(
        "INSERT INTO enrollments (id, course_id, user_id, role, enrollment_state) "
        "VALUES (:id, :cid, :uid, 'StudentEnrollment', 'active') ON CONFLICT (id) DO NOTHING",
        {"id": ENROLLMENT_ID_2, "cid": COURSE_ID, "uid": USER_ID_2},
    )
    yield
    cleanup("DELETE FROM edstem_lesson_progress WHERE edstem_course_id = :id", {"id": EDSTEM_COURSE_ID})
    cleanup("DELETE FROM edstem_lessons WHERE edstem_course_id = :id", {"id": EDSTEM_COURSE_ID})
    cleanup("DELETE FROM edstem_course_mappings WHERE canvas_course_id = :id", {"id": COURSE_ID})
    cleanup("DELETE FROM enrollments WHERE course_id = :id", {"id": COURSE_ID})
    cleanup("DELETE FROM users WHERE id = :id", {"id": USER_ID_1})
    cleanup("DELETE FROM users WHERE id = :id", {"id": USER_ID_2})
    cleanup("DELETE FROM courses WHERE id = :id", {"id": COURSE_ID})


def _seed_mapping():
    seed(
        "INSERT INTO edstem_course_mappings (canvas_course_id, edstem_course_id, edstem_course_name) "
        "VALUES (:cid, :eid, 'SE2026 EdStem') ON CONFLICT (canvas_course_id) DO NOTHING",
        {"cid": COURSE_ID, "eid": EDSTEM_COURSE_ID},
    )


def _seed_lessons():
    seed(
        "INSERT INTO edstem_lessons (id, edstem_course_id, title, module_name, is_interactive, position) "
        "VALUES (:id, :eid, 'SQL Basics', :mod, false, 1) ON CONFLICT (id) DO NOTHING",
        {"id": LESSON_ID_1, "eid": EDSTEM_COURSE_ID, "mod": MODULE_NAME},
    )
    seed(
        "INSERT INTO edstem_lessons (id, edstem_course_id, title, module_name, is_interactive, position) "
        "VALUES (:id, :eid, 'Flask Intro', :mod, true, 2) ON CONFLICT (id) DO NOTHING",
        {"id": LESSON_ID_2, "eid": EDSTEM_COURSE_ID, "mod": MODULE_NAME},
    )


def test_edstem_matrix_course_not_found(app_client):
    resp = app_client.get("/api/courses/88888/edstem-matrix")
    assert resp.status_code == 404


def test_not_mapped_returns_mapped_false(app_client):
    """No mapping → returns {"mapped": false}."""
    resp = app_client.get(f"/api/courses/{COURSE_ID}/edstem-matrix")
    assert resp.status_code == 200
    data = resp.json()
    assert data["mapped"] is False


def test_matrix_shape(app_client):
    """Correct modules/lessons/students structure in response."""
    _seed_mapping()
    _seed_lessons()
    resp = app_client.get(f"/api/courses/{COURSE_ID}/edstem-matrix")
    assert resp.status_code == 200
    data = resp.json()
    assert data["mapped"] is True
    assert data["edstem_course_id"] == EDSTEM_COURSE_ID
    assert len(data["modules"]) == 1
    assert data["modules"][0]["name"] == MODULE_NAME
    assert len(data["modules"][0]["lessons"]) == 2
    assert len(data["students"]) == 2


def test_completion_rate_calculated(app_client):
    """completion_rate = completed lessons / total lessons."""
    _seed_mapping()
    _seed_lessons()
    now = datetime.now(timezone.utc).isoformat()
    # Alice completes 1 of 2 lessons
    seed(
        "INSERT INTO edstem_lesson_progress (edstem_course_id, edstem_lesson_id, user_id, status, synced_at) "
        "VALUES (:eid, :lid, :uid, 'completed', :now) ON CONFLICT (edstem_lesson_id, user_id) DO NOTHING",
        {"eid": EDSTEM_COURSE_ID, "lid": LESSON_ID_1, "uid": USER_ID_1, "now": now},
    )
    resp = app_client.get(f"/api/courses/{COURSE_ID}/edstem-matrix")
    data = resp.json()
    alice = next(s for s in data["students"] if s["id"] == USER_ID_1)
    assert alice["completion_rate"] == pytest.approx(0.5)


def test_all_statuses_present(app_client):
    """completed, viewed, not_started all represented correctly."""
    _seed_mapping()
    _seed_lessons()
    now = datetime.now(timezone.utc).isoformat()
    seed(
        "INSERT INTO edstem_lesson_progress (edstem_course_id, edstem_lesson_id, user_id, status, synced_at) "
        "VALUES (:eid, :lid, :uid, 'completed', :now) ON CONFLICT (edstem_lesson_id, user_id) DO NOTHING",
        {"eid": EDSTEM_COURSE_ID, "lid": LESSON_ID_1, "uid": USER_ID_1, "now": now},
    )
    seed(
        "INSERT INTO edstem_lesson_progress (edstem_course_id, edstem_lesson_id, user_id, status, synced_at) "
        "VALUES (:eid, :lid, :uid, 'viewed', :now) ON CONFLICT (edstem_lesson_id, user_id) DO NOTHING",
        {"eid": EDSTEM_COURSE_ID, "lid": LESSON_ID_2, "uid": USER_ID_1, "now": now},
    )

    resp = app_client.get(f"/api/courses/{COURSE_ID}/edstem-matrix")
    data = resp.json()
    alice = next(s for s in data["students"] if s["id"] == USER_ID_1)
    assert alice["progress"][str(LESSON_ID_1)]["status"] == "completed"
    assert alice["progress"][str(LESSON_ID_2)]["status"] == "viewed"

    # Bob has no progress → defaults to not_started
    bob = next(s for s in data["students"] if s["id"] == USER_ID_2)
    assert bob["progress"][str(LESSON_ID_1)]["status"] == "not_started"


def test_students_sorted_by_name(app_client):
    """Students ordered by sortable_name."""
    _seed_mapping()
    _seed_lessons()
    resp = app_client.get(f"/api/courses/{COURSE_ID}/edstem-matrix")
    data = resp.json()
    names = [s["sortable_name"] for s in data["students"]]
    assert names == sorted(names)
