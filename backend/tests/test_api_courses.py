"""
Tests for GET /api/courses and GET /api/courses/{id}.
"""
import pytest
from datetime import datetime, timedelta, timezone
from app.api.routes.courses import _predicted_band, _topic_confidence
from tests.conftest import seed, cleanup


@pytest.fixture(autouse=True)
def clean_courses():
    """Remove test courses after each test."""
    yield
    cleanup("DELETE FROM submissions WHERE course_id = 5001")
    cleanup("DELETE FROM enrollments WHERE course_id = 5001")
    cleanup("DELETE FROM assignments WHERE course_id = 5001")
    cleanup("DELETE FROM users WHERE id IN (500101, 500102)")
    cleanup("DELETE FROM course_whitelist WHERE course_id = 5001")
    cleanup("DELETE FROM course_whitelist WHERE course_id IN (6001, 6002)")
    for course_id in [1001, 2001, 2002, 3001, 4001, 4002, 5001, 6001, 6002]:
        cleanup("DELETE FROM courses WHERE id = :id", {"id": course_id})


def _insert_course(course_id: int, name: str = "Test Course"):
    now = datetime.now(timezone.utc).isoformat()
    seed(
        "INSERT INTO courses (id, name, course_code, workflow_state, synced_at, total_students) "
        "VALUES (:id, :name, :code, 'available', :synced_at, 0) ON CONFLICT (id) DO NOTHING",
        {"id": course_id, "name": name, "code": f"CODE{course_id}", "synced_at": now},
    )


def test_gradeo_topic_band_threshold_helpers():
    assert _predicted_band(0.9) == 6
    assert _predicted_band(0.8) == 5
    assert _predicted_band(0.7) == 4
    assert _predicted_band(0.6) == 3
    assert _predicted_band(0.5) == 2
    assert _predicted_band(0.49) == 1

    assert _topic_confidence(25, 3) == "high"
    assert _topic_confidence(10, 1) == "medium"
    assert _topic_confidence(5, 2) == "medium"
    assert _topic_confidence(5, 1) == "low"


def test_get_course_not_found(app_client):
    resp = app_client.get("/api/courses/99999")
    assert resp.status_code == 404


def test_list_courses_returns_seeded_course(app_client):
    _insert_course(1001, "Software Engineering 2026")
    seed("INSERT INTO course_whitelist (course_id) VALUES (:id) ON CONFLICT DO NOTHING", {"id": 1001})
    resp = app_client.get("/api/courses")
    cleanup("DELETE FROM course_whitelist WHERE course_id = 1001")
    assert resp.status_code == 200
    courses = resp.json()
    ids = [c["id"] for c in courses]
    assert 1001 in ids
    course = next(c for c in courses if c["id"] == 1001)
    assert course["name"] == "Software Engineering 2026"
    assert course["course_code"] == "CODE1001"


def test_list_courses_returns_empty_when_no_whitelist(app_client):
    _insert_course(2001, "Course A")
    _insert_course(2002, "Course B")
    resp = app_client.get("/api/courses")
    assert resp.status_code == 200
    assert resp.json() == []


def test_get_course_found(app_client):
    _insert_course(3001, "Detail Course")
    resp = app_client.get("/api/courses/3001")
    assert resp.status_code == 200
    data = resp.json()
    assert data["id"] == 3001
    assert data["name"] == "Detail Course"
    assert "student_count" in data
    assert "assignment_count" in data


def test_list_courses_filters_by_whitelist(app_client):
    """When DB whitelist is active, only whitelisted courses appear."""
    _insert_course(4001, "Whitelisted Course")
    _insert_course(4002, "Excluded Course")
    seed("INSERT INTO course_whitelist (course_id) VALUES (:id) ON CONFLICT DO NOTHING", {"id": 4001})
    resp = app_client.get("/api/courses")
    cleanup("DELETE FROM course_whitelist WHERE course_id IN (4001, 4002)")
    assert resp.status_code == 200
    ids = [c["id"] for c in resp.json()]
    assert 4001 in ids
    assert 4002 not in ids


def test_list_courses_marks_archived_from_term_end(app_client):
    now = datetime.now(timezone.utc)
    active_end = (now + timedelta(days=30)).isoformat()
    archived_end = (now - timedelta(days=30)).isoformat()

    seed(
        """
        INSERT INTO courses (id, name, course_code, workflow_state, synced_at, term_end_at, total_students)
        VALUES (6001, 'Current Course', 'CUR6001', 'available', :now, :active_end, 0)
        ON CONFLICT (id) DO NOTHING
        """,
        {"now": now.isoformat(), "active_end": active_end},
    )
    seed(
        """
        INSERT INTO courses (id, name, course_code, workflow_state, synced_at, term_end_at, total_students)
        VALUES (6002, 'Archived Course', 'ARC6002', 'available', :now, :archived_end, 0)
        ON CONFLICT (id) DO NOTHING
        """,
        {"now": now.isoformat(), "archived_end": archived_end},
    )
    seed("INSERT INTO course_whitelist (course_id) VALUES (6001), (6002) ON CONFLICT DO NOTHING")

    resp = app_client.get("/api/courses")

    cleanup("DELETE FROM course_whitelist WHERE course_id IN (6001, 6002)")
    assert resp.status_code == 200
    courses = {course["id"]: course for course in resp.json()}
    assert courses[6001]["is_archived"] is False
    assert courses[6002]["is_archived"] is True
    assert courses[6002]["term_end_at"] is not None


def test_list_courses_uses_due_now_average_completion(app_client):
    now = datetime.now(timezone.utc)
    tomorrow = now.replace(hour=9, minute=0, second=0, microsecond=0) + timedelta(days=1)

    _insert_course(5001, "Due Now Summary")
    seed("INSERT INTO course_whitelist (course_id) VALUES (:id) ON CONFLICT DO NOTHING", {"id": 5001})
    seed(
        "INSERT INTO users (id, name, sortable_name, sis_id) VALUES (500101, 'Alice', 'Alice', 'alice') ON CONFLICT (id) DO NOTHING"
    )
    seed(
        "INSERT INTO users (id, name, sortable_name, sis_id) VALUES (500102, 'Bob', 'Bob', 'bob') ON CONFLICT (id) DO NOTHING"
    )
    seed(
        "INSERT INTO enrollments (id, course_id, user_id, role, enrollment_state) VALUES (500111, 5001, 500101, 'StudentEnrollment', 'active') ON CONFLICT (id) DO NOTHING"
    )
    seed(
        "INSERT INTO enrollments (id, course_id, user_id, role, enrollment_state) VALUES (500112, 5001, 500102, 'StudentEnrollment', 'active') ON CONFLICT (id) DO NOTHING"
    )
    seed(
        "INSERT INTO assignments (id, course_id, name, workflow_state, due_at) VALUES (500121, 5001, 'Past Task', 'published', :due_at) ON CONFLICT (id) DO NOTHING",
        {"due_at": now.isoformat()},
    )
    seed(
        "INSERT INTO assignments (id, course_id, name, workflow_state, due_at) VALUES (500122, 5001, 'Future Task', 'published', :due_at) ON CONFLICT (id) DO NOTHING",
        {"due_at": tomorrow.isoformat()},
    )
    seed(
        "INSERT INTO submissions (id, assignment_id, user_id, course_id, workflow_state, late, missing) VALUES (500131, 500121, 500101, 5001, 'graded', false, false) ON CONFLICT (assignment_id, user_id) DO NOTHING"
    )
    seed(
        "INSERT INTO submissions (id, assignment_id, user_id, course_id, workflow_state, late, missing) VALUES (500132, 500122, 500102, 5001, 'graded', false, false) ON CONFLICT (assignment_id, user_id) DO NOTHING"
    )

    resp = app_client.get("/api/courses")

    assert resp.status_code == 200
    course = next(c for c in resp.json() if c["id"] == 5001)
    assert course["avg_completion_rate"] == 0.5
