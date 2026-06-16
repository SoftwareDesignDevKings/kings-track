import re

import psycopg2
import pytest

from app.config import settings as app_settings
from tests.conftest import cleanup, seed


COURSE_ID = 910001
ASSIGNMENT_ID = 910101
USER_ID = 910201
ENROLLMENT_ID = 910301
CRITERION_ID = f"{ASSIGNMENT_ID}:criterion-1"


def _sync_db_url() -> str:
    return (
        app_settings.database_url
        .replace("postgresql+asyncpg://", "postgresql://")
        .replace("postgresql+psycopg2://", "postgresql://")
    )


def _fetchall(sql: str, params: dict | None = None) -> list[dict]:
    psycopg2_sql = re.sub(r":([a-zA-Z_][a-zA-Z0-9_]*)", r"%(\1)s", sql)
    conn = psycopg2.connect(_sync_db_url())
    try:
        with conn.cursor() as cur:
            cur.execute(psycopg2_sql, params or {})
            columns = [desc[0] for desc in cur.description]
            return [dict(zip(columns, row)) for row in cur.fetchall()]
    finally:
        conn.close()


@pytest.fixture(autouse=True)
def tracking_history_data():
    seed(
        "INSERT INTO courses (id, name, workflow_state, total_students) VALUES (:id, 'Tracking Course', 'available', 1)",
        {"id": COURSE_ID},
    )
    seed(
        "INSERT INTO users (id, name, sortable_name, email, sis_id) VALUES (:id, 'Alice Student', 'Student, Alice', 'alice@example.com', 'alice')",
        {"id": USER_ID},
    )
    seed(
        """
        INSERT INTO enrollments (id, course_id, user_id, role, enrollment_state)
        VALUES (:id, :course_id, :user_id, 'StudentEnrollment', 'active')
        """,
        {"id": ENROLLMENT_ID, "course_id": COURSE_ID, "user_id": USER_ID},
    )
    seed(
        """
        INSERT INTO assignments (id, course_id, name, workflow_state)
        VALUES (:id, :course_id, 'Tracking Assignment', 'published')
        """,
        {"id": ASSIGNMENT_ID, "course_id": COURSE_ID},
    )
    seed(
        """
        INSERT INTO rubric_criteria (id, assignment_id, description, position)
        VALUES (:id, :assignment_id, 'Criterion 1', 1)
        """,
        {"id": CRITERION_ID, "assignment_id": ASSIGNMENT_ID},
    )

    yield

    cleanup("DELETE FROM tracking_score_events WHERE assignment_id = :assignment_id", {"assignment_id": ASSIGNMENT_ID})
    cleanup(
        """
        DELETE FROM tracking_scores
        WHERE snapshot_id IN (SELECT id FROM tracking_snapshots WHERE assignment_id = :assignment_id)
        """,
        {"assignment_id": ASSIGNMENT_ID},
    )
    cleanup("DELETE FROM tracking_snapshots WHERE assignment_id = :assignment_id", {"assignment_id": ASSIGNMENT_ID})
    cleanup("DELETE FROM rubric_criteria WHERE assignment_id = :assignment_id", {"assignment_id": ASSIGNMENT_ID})
    cleanup("DELETE FROM enrollments WHERE course_id = :course_id", {"course_id": COURSE_ID})
    cleanup("DELETE FROM assignments WHERE id = :assignment_id", {"assignment_id": ASSIGNMENT_ID})
    cleanup("DELETE FROM users WHERE id = :user_id", {"user_id": USER_ID})
    cleanup("DELETE FROM courses WHERE id = :course_id", {"course_id": COURSE_ID})


def _save_score(app_client, *, score: int | None, comment: str | None = None):
    return app_client.post(
        f"/api/courses/{COURSE_ID}/tracking/{ASSIGNMENT_ID}/scores",
        json={
            "scores": [
                {
                    "user_id": USER_ID,
                    "criterion_id": CRITERION_ID,
                    "score": score,
                    "comment": comment,
                }
            ]
        },
    )


def _events() -> list[dict]:
    return _fetchall(
        """
        SELECT
            assignment_id,
            snapshot_id,
            user_id,
            rubric_criterion_id,
            previous_score,
            previous_comment,
            new_score,
            new_comment,
            changed_by_email,
            changed_at
        FROM tracking_score_events
        WHERE assignment_id = :assignment_id
        ORDER BY id
        """,
        {"assignment_id": ASSIGNMENT_ID},
    )


def _draft_snapshot_id() -> int:
    rows = _fetchall(
        "SELECT id FROM tracking_snapshots WHERE assignment_id = :assignment_id AND committed_at IS NULL",
        {"assignment_id": ASSIGNMENT_ID},
    )
    assert len(rows) == 1
    return rows[0]["id"]


def _current_score_rows() -> list[dict]:
    return _fetchall(
        """
        SELECT score, comment
        FROM tracking_scores
        WHERE user_id = :user_id AND rubric_criterion_id = :criterion_id
        """,
        {"user_id": USER_ID, "criterion_id": CRITERION_ID},
    )


def test_first_score_insert_creates_tracking_event(app_client):
    response = _save_score(app_client, score=2, comment="Ready")

    assert response.status_code == 200
    events = _events()
    assert len(events) == 1
    event = events[0]
    assert event["assignment_id"] == ASSIGNMENT_ID
    assert event["snapshot_id"] == response.json()["snapshot_id"]
    assert event["user_id"] == USER_ID
    assert event["rubric_criterion_id"] == CRITERION_ID
    assert event["previous_score"] is None
    assert event["previous_comment"] is None
    assert event["new_score"] == 2
    assert event["new_comment"] == "Ready"
    assert event["changed_by_email"] == "test@example.com"
    assert event["changed_at"] is not None


def test_score_change_records_previous_and_new_values(app_client):
    _save_score(app_client, score=1, comment="Started")

    response = _save_score(app_client, score=3, comment="Started")

    assert response.status_code == 200
    events = _events()
    assert len(events) == 2
    assert events[1]["previous_score"] == 1
    assert events[1]["previous_comment"] == "Started"
    assert events[1]["new_score"] == 3
    assert events[1]["new_comment"] == "Started"


def test_comment_only_change_records_tracking_event(app_client):
    _save_score(app_client, score=2, comment="Draft")

    response = _save_score(app_client, score=2, comment="Rechecked work")

    assert response.status_code == 200
    events = _events()
    assert len(events) == 2
    assert events[1]["previous_score"] == 2
    assert events[1]["previous_comment"] == "Draft"
    assert events[1]["new_score"] == 2
    assert events[1]["new_comment"] == "Rechecked work"


def test_clearing_cell_records_event_and_deletes_current_score(app_client):
    _save_score(app_client, score=2, comment="Needs revision")

    response = _save_score(app_client, score=None, comment=None)

    assert response.status_code == 200
    events = _events()
    assert len(events) == 2
    assert events[1]["previous_score"] == 2
    assert events[1]["previous_comment"] == "Needs revision"
    assert events[1]["new_score"] is None
    assert events[1]["new_comment"] is None
    assert _current_score_rows() == []


def test_unchanged_autosave_does_not_duplicate_tracking_event(app_client):
    _save_score(app_client, score=2, comment="Same")

    response = _save_score(app_client, score=2, comment="Same")

    assert response.status_code == 200
    assert len(_events()) == 1


def test_committing_snapshot_does_not_create_tracking_events(app_client):
    _save_score(app_client, score=2, comment="Ready")

    response = app_client.post(
        f"/api/courses/{COURSE_ID}/tracking/{ASSIGNMENT_ID}/commit",
        json={"label": "Week 1"},
    )

    assert response.status_code == 200
    assert len(_events()) == 1


def test_edits_after_commit_are_tied_to_new_draft_snapshot(app_client):
    first_save = _save_score(app_client, score=2, comment="Ready")
    first_snapshot_id = first_save.json()["snapshot_id"]
    commit_response = app_client.post(
        f"/api/courses/{COURSE_ID}/tracking/{ASSIGNMENT_ID}/commit",
        json={"label": "Week 1"},
    )
    assert commit_response.status_code == 200
    new_draft_id = _draft_snapshot_id()
    assert new_draft_id != first_snapshot_id

    response = _save_score(app_client, score=3, comment="Ready")

    assert response.status_code == 200
    events = _events()
    assert len(events) == 2
    assert events[1]["snapshot_id"] == new_draft_id
    assert events[1]["previous_score"] == 2
    assert events[1]["new_score"] == 3
