"""
Tests for admin routes:
  GET/POST/DELETE /api/admin/users
  GET/POST/DELETE /api/admin/whitelist
  GET             /api/admin/whitelist/available
"""
import pytest
from datetime import datetime, timezone
from tests.conftest import seed, cleanup

COURSE_ID_A = 88001
COURSE_ID_B = 88002
TEST_EMAIL = "newuser@example.com"


def _now():
    return datetime.now(timezone.utc).isoformat()


@pytest.fixture(autouse=True)
def clean_admin_data():
    yield
    cleanup("DELETE FROM edstem_course_mappings WHERE canvas_course_id IN (:a, :b)", {"a": COURSE_ID_A, "b": COURSE_ID_B})
    cleanup("DELETE FROM course_whitelist WHERE course_id IN (:a, :b)", {"a": COURSE_ID_A, "b": COURSE_ID_B})
    cleanup("DELETE FROM courses WHERE id IN (:a, :b)", {"a": COURSE_ID_A, "b": COURSE_ID_B})
    cleanup("DELETE FROM app_users WHERE email = :e", {"e": TEST_EMAIL})


def _insert_course(course_id: int, name: str):
    seed(
        "INSERT INTO courses (id, name, course_code, workflow_state, synced_at, total_students) "
        "VALUES (:id, :name, :code, 'available', :now, 0) ON CONFLICT (id) DO NOTHING",
        {"id": course_id, "name": name, "code": f"CODE{course_id}", "now": _now()},
    )


# ---------------------------------------------------------------------------
# Users
# ---------------------------------------------------------------------------

def test_list_users_returns_200(app_client):
    resp = app_client.get("/api/admin/users")
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)


def test_add_user_creates_user(app_client):
    resp = app_client.post("/api/admin/users", json={"email": TEST_EMAIL, "role": "teacher"})
    assert resp.status_code == 201
    assert resp.json()["email"] == TEST_EMAIL
    assert resp.json()["role"] == "teacher"

    users = app_client.get("/api/admin/users").json()
    assert any(u["email"] == TEST_EMAIL for u in users)


def test_add_user_rejects_invalid_role(app_client):
    resp = app_client.post("/api/admin/users", json={"email": TEST_EMAIL, "role": "superuser"})
    assert resp.status_code == 400


def test_add_user_duplicate_returns_409(app_client):
    app_client.post("/api/admin/users", json={"email": TEST_EMAIL, "role": "teacher"})
    resp = app_client.post("/api/admin/users", json={"email": TEST_EMAIL, "role": "teacher"})
    assert resp.status_code == 409


def test_remove_user_deletes_user(app_client):
    app_client.post("/api/admin/users", json={"email": TEST_EMAIL, "role": "teacher"})
    resp = app_client.delete(f"/api/admin/users/{TEST_EMAIL}")
    assert resp.status_code == 204

    users = app_client.get("/api/admin/users").json()
    assert not any(u["email"] == TEST_EMAIL for u in users)


# ---------------------------------------------------------------------------
# Whitelist — list & available
# ---------------------------------------------------------------------------

def test_list_whitelist_empty(app_client):
    resp = app_client.get("/api/admin/whitelist")
    assert resp.status_code == 200
    # May contain other rows from other tests; just check it's a list
    assert isinstance(resp.json(), list)


def test_list_whitelist_available_returns_courses_from_canvas(app_client):
    """Available courses come from Canvas API — should return a list of courses."""
    from unittest.mock import patch, AsyncMock, MagicMock
    mock_courses = [
        {"id": 1, "name": "Course A", "course_code": "CA101"},
        {"id": 2, "name": "Course B", "course_code": "CB202"},
    ]
    mock_canvas = AsyncMock()
    mock_canvas.list_courses = AsyncMock(return_value=mock_courses)
    mock_client = MagicMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_canvas)
    mock_client.__aexit__ = AsyncMock(return_value=False)

    with patch("app.api.routes.admin.settings") as mock_settings, \
         patch("app.api.routes.admin.CanvasClient", return_value=mock_client):
        mock_settings.canvas_configured = True
        mock_settings.canvas_api_url = "https://canvas.test"
        mock_settings.canvas_api_token = "token"
        resp = app_client.get("/api/admin/whitelist/available")

    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 2
    assert data[0]["name"] == "Course A"


# ---------------------------------------------------------------------------
# Whitelist — add & remove
# ---------------------------------------------------------------------------

def test_add_to_whitelist(app_client):
    _insert_course(COURSE_ID_A, "Course Alpha")
    resp = app_client.post("/api/admin/whitelist", json={"course_id": COURSE_ID_A})
    assert resp.status_code == 201
    data = resp.json()
    assert data["course_id"] == COURSE_ID_A
    assert "edstem_matched" in data  # field always present, None when no match

    whitelist = app_client.get("/api/admin/whitelist").json()
    assert any(w["course_id"] == COURSE_ID_A for w in whitelist)


def test_add_to_whitelist_duplicate_upserts(app_client):
    _insert_course(COURSE_ID_A, "Course Alpha")
    app_client.post("/api/admin/whitelist", json={"course_id": COURSE_ID_A, "name": "Course Alpha", "course_code": f"CODE{COURSE_ID_A}"})
    resp = app_client.post("/api/admin/whitelist", json={"course_id": COURSE_ID_A, "name": "Course Alpha Updated", "course_code": f"CODE{COURSE_ID_A}"})
    assert resp.status_code == 201
    whitelist = app_client.get("/api/admin/whitelist").json()
    entries = [w for w in whitelist if w["course_id"] == COURSE_ID_A]
    assert len(entries) == 1
    assert entries[0]["name"] == "Course Alpha Updated"


def test_remove_from_whitelist(app_client):
    _insert_course(COURSE_ID_A, "Course Alpha")
    app_client.post("/api/admin/whitelist", json={"course_id": COURSE_ID_A})

    resp = app_client.delete(f"/api/admin/whitelist/{COURSE_ID_A}")
    assert resp.status_code == 204

    whitelist = app_client.get("/api/admin/whitelist").json()
    assert not any(w["course_id"] == COURSE_ID_A for w in whitelist)


def test_whitelist_stores_course_name(app_client):
    _insert_course(COURSE_ID_A, "Course Alpha")
    app_client.post("/api/admin/whitelist", json={"course_id": COURSE_ID_A, "name": "Course Alpha", "course_code": f"CODE{COURSE_ID_A}"})

    whitelist = app_client.get("/api/admin/whitelist").json()
    entry = next(w for w in whitelist if w["course_id"] == COURSE_ID_A)
    assert entry["name"] == "Course Alpha"
    assert entry["course_code"] == f"CODE{COURSE_ID_A}"


def test_add_to_whitelist_auto_matches_edstem(app_client):
    """When EdStem is configured and a course_code matches, a mapping is created automatically."""
    from unittest.mock import patch, AsyncMock, MagicMock

    _insert_course(COURSE_ID_A, "Software Engineering 2026")

    mock_edstem_courses = [
        {"course": {"id": 99001, "code": f"CODE{COURSE_ID_A}", "name": "SE EdStem 2026"}, "role": {}},
        {"course": {"id": 99002, "code": "OTHER_COURSE", "name": "Other"}, "role": {}},
    ]
    mock_edstem = AsyncMock()
    mock_edstem.get_user_courses = AsyncMock(return_value=mock_edstem_courses)
    mock_client = MagicMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_edstem)
    mock_client.__aexit__ = AsyncMock(return_value=False)

    with patch("app.api.routes.admin.settings") as mock_settings, \
         patch("app.api.routes.admin.EdStemClient", return_value=mock_client):
        mock_settings.edstem_configured = True
        mock_settings.edstem_api_url = "https://edstem.org/api"
        mock_settings.edstem_api_token = "token"

        resp = app_client.post("/api/admin/whitelist", json={
            "course_id": COURSE_ID_A,
            "name": "Software Engineering 2026",
            "course_code": f"CODE{COURSE_ID_A}",
        })

    assert resp.status_code == 201
    data = resp.json()
    assert data["edstem_matched"] is not None
    assert data["edstem_matched"]["edstem_course_id"] == 99001
    assert data["edstem_matched"]["edstem_course_name"] == "SE EdStem 2026"

    # Mapping should be persisted
    mappings = app_client.get("/api/admin/edstem-mappings").json()
    assert any(m["canvas_course_id"] == COURSE_ID_A and m["edstem_course_id"] == 99001 for m in mappings)


def test_add_to_whitelist_no_edstem_match(app_client):
    """When course_code has no EdStem match, edstem_matched is None and whitelist add still succeeds."""
    from unittest.mock import patch, AsyncMock, MagicMock

    _insert_course(COURSE_ID_A, "Course Alpha")

    mock_edstem = AsyncMock()
    mock_edstem.get_user_courses = AsyncMock(return_value=[
        {"course": {"id": 99001, "code": "COMPLETELY_DIFFERENT", "name": "Other"}, "role": {}},
    ])
    mock_client = MagicMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_edstem)
    mock_client.__aexit__ = AsyncMock(return_value=False)

    with patch("app.api.routes.admin.settings") as mock_settings, \
         patch("app.api.routes.admin.EdStemClient", return_value=mock_client):
        mock_settings.edstem_configured = True
        mock_settings.edstem_api_url = "https://edstem.org/api"
        mock_settings.edstem_api_token = "token"

        resp = app_client.post("/api/admin/whitelist", json={
            "course_id": COURSE_ID_A,
            "name": "Course Alpha",
            "course_code": f"CODE{COURSE_ID_A}",
        })

    assert resp.status_code == 201
    assert resp.json()["edstem_matched"] is None


def test_list_courses_excludes_non_whitelisted_when_whitelist_active(app_client):
    """When whitelist has entries, /courses should only return whitelisted ones."""
    _insert_course(COURSE_ID_A, "Whitelisted")
    _insert_course(COURSE_ID_B, "Excluded")
    app_client.post("/api/admin/whitelist", json={"course_id": COURSE_ID_A})

    resp = app_client.get("/api/courses")
    assert resp.status_code == 200
    ids = [c["id"] for c in resp.json()]
    assert COURSE_ID_A in ids
    assert COURSE_ID_B not in ids
