"""
Tests for GET /api/courses/{id}/matrix — the most critical endpoint.
"""
import pytest
from datetime import datetime, timezone
from tests.conftest import seed, cleanup

COURSE_ID = 9001
USER_ID = 10101
ASSIGNMENT_1_ID = 50101
ASSIGNMENT_2_ID = 50102
ENROLLMENT_ID = 99011
GROUP_NAME = "Classwork - Unit 1"


@pytest.fixture(autouse=True)
def matrix_data():
    """Seed and tear down all test data around each test."""
    now = datetime.now(timezone.utc).isoformat()
    seed("INSERT INTO courses (id, name, course_code, workflow_state, synced_at) VALUES (:id, 'SE 2026', '11SENX', 'available', :now) ON CONFLICT (id) DO NOTHING", {"id": COURSE_ID, "now": now})
    seed("INSERT INTO users (id, name, sortable_name, sis_id) VALUES (:id, 'Alice Smith', 'Smith, Alice', 'alice') ON CONFLICT (id) DO NOTHING", {"id": USER_ID})
    seed("INSERT INTO enrollments (id, course_id, user_id, role, enrollment_state) VALUES (:id, :cid, :uid, 'StudentEnrollment', 'active') ON CONFLICT (id) DO NOTHING", {"id": ENROLLMENT_ID, "cid": COURSE_ID, "uid": USER_ID})
    seed("INSERT INTO assignments (id, course_id, name, assignment_group_name, assignment_group_id, workflow_state, position) VALUES (:id, :cid, 'Task 1', :group, 10, 'published', 1) ON CONFLICT (id) DO NOTHING", {"id": ASSIGNMENT_1_ID, "cid": COURSE_ID, "group": GROUP_NAME})
    seed("INSERT INTO assignments (id, course_id, name, assignment_group_name, assignment_group_id, workflow_state, position) VALUES (:id, :cid, 'Task 2', :group, 10, 'published', 2) ON CONFLICT (id) DO NOTHING", {"id": ASSIGNMENT_2_ID, "cid": COURSE_ID, "group": GROUP_NAME})
    yield
    cleanup("DELETE FROM submissions WHERE course_id = :id", {"id": COURSE_ID})
    cleanup("DELETE FROM student_metrics WHERE course_id = :id", {"id": COURSE_ID})
    cleanup("DELETE FROM enrollments WHERE course_id = :id", {"id": COURSE_ID})
    cleanup("DELETE FROM assignments WHERE course_id = :id", {"id": COURSE_ID})
    cleanup("DELETE FROM users WHERE id = :id", {"id": USER_ID})
    cleanup("DELETE FROM courses WHERE id = :id", {"id": COURSE_ID})


def test_matrix_course_not_found(app_client):
    resp = app_client.get("/api/courses/88888/matrix")
    assert resp.status_code == 404


def test_matrix_response_structure(app_client):
    resp = app_client.get(f"/api/courses/{COURSE_ID}/matrix")
    assert resp.status_code == 200
    data = resp.json()
    assert data["course_id"] == COURSE_ID
    assert "assignment_groups" in data
    assert "students" in data


def test_matrix_assignment_groups(app_client):
    resp = app_client.get(f"/api/courses/{COURSE_ID}/matrix")
    data = resp.json()
    groups = data["assignment_groups"]
    assert len(groups) == 1
    assert groups[0]["name"] == GROUP_NAME
    assignment_ids = [a["id"] for a in groups[0]["assignments"]]
    assert ASSIGNMENT_1_ID in assignment_ids
    assert ASSIGNMENT_2_ID in assignment_ids


def test_matrix_graded_submission_shows_completed(app_client):
    seed(
        "INSERT INTO submissions (id, assignment_id, user_id, course_id, workflow_state, score, late, missing) "
        "VALUES (:id, :aid, :uid, :cid, 'graded', 8.0, false, false) ON CONFLICT (assignment_id, user_id) DO NOTHING",
        {"id": 800101, "aid": ASSIGNMENT_1_ID, "uid": USER_ID, "cid": COURSE_ID},
    )
    resp = app_client.get(f"/api/courses/{COURSE_ID}/matrix")
    data = resp.json()
    student = data["students"][0]
    assert student["submissions"][str(ASSIGNMENT_1_ID)]["status"] == "completed"
    assert student["submissions"][str(ASSIGNMENT_1_ID)]["score"] == 8.0


def test_matrix_missing_submission_defaults_to_not_started(app_client):
    resp = app_client.get(f"/api/courses/{COURSE_ID}/matrix")
    data = resp.json()
    student = data["students"][0]
    assert student["submissions"][str(ASSIGNMENT_2_ID)]["status"] == "not_started"


def test_matrix_excused_submission(app_client):
    seed(
        "INSERT INTO submissions (id, assignment_id, user_id, course_id, workflow_state, excused, late, missing) "
        "VALUES (:id, :aid, :uid, :cid, 'graded', true, false, false) ON CONFLICT (assignment_id, user_id) DO NOTHING",
        {"id": 800102, "aid": ASSIGNMENT_2_ID, "uid": USER_ID, "cid": COURSE_ID},
    )
    resp = app_client.get(f"/api/courses/{COURSE_ID}/matrix")
    data = resp.json()
    student = data["students"][0]
    assert student["submissions"][str(ASSIGNMENT_2_ID)]["status"] == "excused"
