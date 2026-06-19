from copy import deepcopy
from datetime import datetime, timezone

import psycopg2
import pytest

from app.config import settings as app_settings
from tests.conftest import cleanup, seed

COURSE_ID = 66100
SECOND_COURSE_ID = 66101
USER_ID = 66110
OUT_OF_SCOPE_USER_ID = 66111
ENROLLMENT_ID = 66120
SECOND_ENROLLMENT_ID = 66121
THIRD_ENROLLMENT_ID = 66122
GRADEO_CLASS_ID = "bd073dae-d4e8-4748-9fda-b0691456e190"
SECOND_GRADEO_CLASS_ID = "95b7788f-76e7-4826-972a-f66d53a348cf"
GRADEO_STUDENT_ID = "215e30a9-2da4-4bef-b008-b3ceb8b520df"
SECOND_GRADEO_STUDENT_ID = "6de5cf0a-4329-430c-bce8-c03f4e882957"
GRADEO_EXAM_ID = "1c806b50-953f-49f2-a2ef-44c2ae4b4852"
GRADEO_EXAM_SESSION_ID = "exam-session-1"
GRADEO_MARKING_SESSION_ID = "marking-session-1"
GRADEO_SYLLABUS_ID = "7bf9e34f-89e6-4d35-b643-9604544dc759"


def _now():
    return datetime.now(timezone.utc).isoformat()


def _dsn() -> str:
    return (
        app_settings.database_url
        .replace("postgresql+asyncpg://", "postgresql://")
        .replace("postgresql+psycopg2://", "postgresql://")
    )


def _scalar(sql: str, params: dict | None = None):
    conn = psycopg2.connect(_dsn())
    conn.autocommit = True
    try:
        with conn.cursor() as cur:
            cur.execute(sql, params or {})
            row = cur.fetchone()
            return row[0] if row else None
    finally:
        conn.close()


@pytest.fixture(autouse=True)
def gradeo_admin_data():
    now = _now()
    seed(
        "INSERT INTO courses (id, name, course_code, workflow_state, synced_at, total_students) "
        "VALUES (:id, '12 Enterprise Computing', '12ENCX-2026', 'available', :now, 0) ON CONFLICT (id) DO NOTHING",
        {"id": COURSE_ID, "now": now},
    )
    seed(
        "INSERT INTO courses (id, name, course_code, workflow_state, synced_at, total_students) "
        "VALUES (:id, '12 ENCX 2026 Duplicate', '12ENCX2026', 'available', :now, 0) ON CONFLICT (id) DO NOTHING",
        {"id": SECOND_COURSE_ID, "now": now},
    )
    seed(
        "INSERT INTO users (id, name, sortable_name, email, sis_id) "
        "VALUES (:id, 'Eamon Wong', 'Wong, Eamon', 'eamon@kings.edu.au', 'eamon') ON CONFLICT (id) DO NOTHING",
        {"id": USER_ID},
    )
    seed(
        "INSERT INTO users (id, name, sortable_name, email, sis_id) "
        "VALUES (:id, 'Other Student', 'Student, Other', 'other@kings.edu.au', 'other') ON CONFLICT (id) DO NOTHING",
        {"id": OUT_OF_SCOPE_USER_ID},
    )
    seed(
        "INSERT INTO enrollments (id, course_id, user_id, role, enrollment_state) "
        "VALUES (:id, :course_id, :user_id, 'StudentEnrollment', 'active') ON CONFLICT (id) DO NOTHING",
        {"id": ENROLLMENT_ID, "course_id": COURSE_ID, "user_id": USER_ID},
    )
    seed(
        "INSERT INTO users (id, name, sortable_name, email, sis_id) "
        "VALUES (:id, 'Noah Ould', 'Ould, Noah', 'noah@kings.edu.au', 'noah') ON CONFLICT (id) DO NOTHING",
        {"id": OUT_OF_SCOPE_USER_ID + 1},
    )
    seed(
        "INSERT INTO enrollments (id, course_id, user_id, role, enrollment_state) "
        "VALUES (:id, :course_id, :user_id, 'StudentEnrollment', 'active') ON CONFLICT (id) DO NOTHING",
        {"id": SECOND_ENROLLMENT_ID, "course_id": COURSE_ID, "user_id": OUT_OF_SCOPE_USER_ID + 1},
    )
    seed(
        "INSERT INTO enrollments (id, course_id, user_id, role, enrollment_state) "
        "VALUES (:id, :course_id, :user_id, 'StudentEnrollment', 'active') ON CONFLICT (id) DO NOTHING",
        {"id": THIRD_ENROLLMENT_ID, "course_id": SECOND_COURSE_ID, "user_id": USER_ID},
    )
    yield
    cleanup("DELETE FROM gradeo_assignment_question_results")
    cleanup("DELETE FROM gradeo_assignment_results")
    cleanup("DELETE FROM gradeo_class_exam_assignments")
    cleanup("DELETE FROM gradeo_exam_sessions")
    cleanup("DELETE FROM gradeo_exam_definitions")
    cleanup("DELETE FROM gradeo_class_syllabuses")
    cleanup("DELETE FROM gradeo_question_results")
    cleanup("DELETE FROM gradeo_exam_results")
    cleanup("DELETE FROM gradeo_exams")
    cleanup("DELETE FROM gradeo_import_runs")
    cleanup("DELETE FROM gradeo_class_mappings")
    cleanup("DELETE FROM gradeo_classes")
    cleanup("DELETE FROM gradeo_students")
    cleanup("DELETE FROM course_whitelist WHERE course_id IN (:a, :b)", {"a": COURSE_ID, "b": SECOND_COURSE_ID})
    cleanup(
        "DELETE FROM enrollments WHERE id IN (:a, :b, :c)",
        {"a": ENROLLMENT_ID, "b": SECOND_ENROLLMENT_ID, "c": THIRD_ENROLLMENT_ID},
    )
    cleanup("DELETE FROM users WHERE id IN (:a, :b, :c)", {"a": USER_ID, "b": OUT_OF_SCOPE_USER_ID, "c": OUT_OF_SCOPE_USER_ID + 1})
    cleanup("DELETE FROM courses WHERE id IN (:a, :b)", {"a": COURSE_ID, "b": SECOND_COURSE_ID})


def _whitelist(course_id: int, name: str, course_code: str):
    seed(
        "INSERT INTO course_whitelist (course_id, name, course_code, added_by) "
        "VALUES (:course_id, :name, :course_code, NULL) ON CONFLICT (course_id) DO UPDATE SET "
        "name = EXCLUDED.name, course_code = EXCLUDED.course_code",
        {"course_id": course_id, "name": name, "course_code": course_code},
    )


def _directory_payload():
    return {
        "extension_version": "0.1.0",
        "students": [
            {
                "gradeo_student_id": GRADEO_STUDENT_ID,
                "name": "Eamon Wong",
                "email": "eamon@kings.edu.au",
            },
            {
                "gradeo_student_id": "a4c19467-6af8-4de9-9b79-794f09065f11",
                "name": "Other Student",
                "email": "other@kings.edu.au",
            },
            {
                "gradeo_student_id": "5c69ee8e-ecff-4309-bcb8-43d1adcad04b",
                "name": "Missing Match",
                "email": "missing@kings.edu.au",
            },
        ],
    }


def _directory_payload_with_second_student():
    payload = _directory_payload()
    payload["students"].append(
        {
            "gradeo_student_id": SECOND_GRADEO_STUDENT_ID,
            "name": "Noah Ould",
            "email": "noah@kings.edu.au",
        }
    )
    return payload


def _import_payload():
    return {
        "gradeo_class_id": GRADEO_CLASS_ID,
        "gradeo_class_name": "12 encx_2026",
        "extension_version": "0.1.0",
        "students": [
            {
                "gradeo_student_id": GRADEO_STUDENT_ID,
                "student_name": "Eamon Wong",
                "rows": [
                    {
                        "exam_name": "12ENC_Cycle6",
                        "gradeo_exam_id": GRADEO_EXAM_ID,
                        "gradeo_exam_session_id": GRADEO_EXAM_SESSION_ID,
                        "gradeo_marking_session_id": GRADEO_MARKING_SESSION_ID,
                        "gradeo_class_id": GRADEO_CLASS_ID,
                        "class_name": "12 encx_2026",
                        "class_average": "1.6",
                        "syllabus_id": GRADEO_SYLLABUS_ID,
                        "question": "Spreadsheets (Prac, TKS 2025)",
                        "gradeo_question_id": "34bd0502-dad4-4eb2-a637-94a39cc38992",
                        "question_part": "Part A",
                        "gradeo_question_part_id": "5d4f989d-1f4a-4a5e-a245-6ac3881375b5",
                        "question_link": "https://platform.gradeo.com.au/question/34bd0502-dad4-4eb2-a637-94a39cc38992",
                        "mark": "2",
                        "marks_available": "2",
                        "answer_submitted": "Yes",
                        "feedback": "",
                        "marker_name": "TKS CST",
                        "marker_id": "4e096daa-d1c7-47e9-9c7b-c1adaf476532",
                        "marking_session_link": "https://platform.gradeo.com.au/script/89bfb001-b576-4d19-b7d0-ca48d13c0ef8",
                        "exam_mark": "9",
                        "syllabus_title": "Enterprise Computing",
                        "syllabus_grade": "12",
                        "bands": "3,4,5",
                        "outcomes": "EC-12-04,EC-12-08,EC-12-02",
                        "topics": "Data Science",
                        "copyright_notice": "NESA Activities",
                    },
                    {
                        "exam_name": "12ENC_Cycle6",
                        "gradeo_exam_id": GRADEO_EXAM_ID,
                        "gradeo_exam_session_id": GRADEO_EXAM_SESSION_ID,
                        "gradeo_marking_session_id": GRADEO_MARKING_SESSION_ID,
                        "gradeo_class_id": GRADEO_CLASS_ID,
                        "class_name": "12 encx_2026",
                        "class_average": "1.6",
                        "syllabus_id": GRADEO_SYLLABUS_ID,
                        "question": "Spreadsheet (TKS 2025)",
                        "gradeo_question_id": "f7aeaaec-0b5d-4d8c-ba46-8177392858a0",
                        "question_part": "Part A",
                        "gradeo_question_part_id": "e95b3cb9-2ad3-412f-8df4-3280eea33887",
                        "question_link": "https://platform.gradeo.com.au/question/f7aeaaec-0b5d-4d8c-ba46-8177392858a0",
                        "mark": "7",
                        "marks_available": "8",
                        "answer_submitted": "Yes",
                        "feedback": "Good reasoning",
                        "marker_name": "TKS CST",
                        "marker_id": "4e096daa-d1c7-47e9-9c7b-c1adaf476532",
                        "marking_session_link": "https://platform.gradeo.com.au/script/89bfb001-b576-4d19-b7d0-ca48d13c0ef8",
                        "exam_mark": "9",
                        "syllabus_title": "Enterprise Computing",
                        "syllabus_grade": "12",
                        "bands": "3,4",
                        "outcomes": "EC-12-05,EC-12-11",
                        "topics": "Data Science",
                        "copyright_notice": "TKS2025",
                    },
                ],
            }
        ],
    }


def _summary_import_payload():
    return {
        "gradeo_class_id": GRADEO_CLASS_ID,
        "gradeo_class_name": "12 encx_2026",
        "extension_version": "0.1.0",
        "students": [
            {
                "gradeo_student_id": GRADEO_STUDENT_ID,
                "student_name": "Eamon Wong",
                "rows": [],
                "exam_rows": [
                    {
                        "exam_name": "12ENC_Cycle6",
                        "gradeo_exam_id": GRADEO_EXAM_ID,
                        "gradeo_exam_session_id": GRADEO_EXAM_SESSION_ID,
                        "gradeo_marking_session_id": GRADEO_MARKING_SESSION_ID,
                        "gradeo_class_id": GRADEO_CLASS_ID,
                        "class_name": "12 encx_2026",
                        "class_average": "1.6",
                        "exam_mark": "9",
                        "marks_available": "10",
                        "status": "scored",
                        "answer_submitted": "Yes",
                        "marking_session_id": "89bfb001-b576-4d19-b7d0-ca48d13c0ef8",
                        "exam_answer_sheet_id": "answer-sheet-1",
                        "exam_session_start_date": "2026-03-01T21:07:28.591Z",
                        "exam_session_max_time_seconds": "7200",
                        "student_group_mark_average": "1.6",
                        "syllabus_id": GRADEO_SYLLABUS_ID,
                        "syllabus_title": "Enterprise Computing",
                        "syllabus_grade": "12",
                        "bands": "3,4,5",
                        "outcomes": "EC-12-04,EC-12-08,EC-12-02",
                        "topics": "Data Science",
                    }
                ],
            }
        ],
    }


def _summary_import_payload_for(
    *,
    gradeo_class_id: str = GRADEO_CLASS_ID,
    gradeo_class_name: str = "12 encx_2026",
    gradeo_student_id: str = GRADEO_STUDENT_ID,
    student_name: str = "Eamon Wong",
    marking_session_id: str = GRADEO_MARKING_SESSION_ID,
    exam_session_id: str = GRADEO_EXAM_SESSION_ID,
    status: str = "scored",
    exam_mark: str | None = "9",
):
    payload = _summary_import_payload()
    payload["gradeo_class_id"] = gradeo_class_id
    payload["gradeo_class_name"] = gradeo_class_name
    payload["students"][0]["gradeo_student_id"] = gradeo_student_id
    payload["students"][0]["student_name"] = student_name
    row = payload["students"][0]["exam_rows"][0]
    row["gradeo_class_id"] = gradeo_class_id
    row["class_name"] = gradeo_class_name
    row["gradeo_marking_session_id"] = marking_session_id
    row["marking_session_id"] = marking_session_id
    row["gradeo_exam_session_id"] = exam_session_id
    row["status"] = status
    row["exam_mark"] = exam_mark
    row["answer_submitted"] = "Yes" if status != "not_submitted" else "No"
    return payload


def _empty_import_payload():
    return {
        "gradeo_class_id": GRADEO_CLASS_ID,
        "gradeo_class_name": "12 encx_2026",
        "extension_version": "0.1.0",
        "students": [
            {
                "gradeo_student_id": GRADEO_STUDENT_ID,
                "student_name": "Eamon Wong",
                "rows": [],
                "exam_rows": [],
            }
        ],
    }


def _multi_session_summary_import_payload():
    payload = _summary_import_payload()
    payload["students"][0]["exam_rows"].append(
        {
            "exam_name": "12ENC_Cycle7",
            "gradeo_exam_id": GRADEO_EXAM_ID,
            "gradeo_exam_session_id": "exam-session-2",
            "gradeo_marking_session_id": "marking-session-2",
            "gradeo_class_id": GRADEO_CLASS_ID,
            "class_name": "12 encx_2026",
            "class_average": "1.8",
            "exam_mark": "8",
            "marks_available": "10",
            "status": "scored",
            "answer_submitted": "Yes",
            "marking_session_id": "marking-session-2",
            "exam_answer_sheet_id": "answer-sheet-2",
            "exam_session_start_date": "2026-03-08T21:07:28.591Z",
            "exam_session_max_time_seconds": "7200",
            "student_group_mark_average": "1.8",
            "syllabus_id": GRADEO_SYLLABUS_ID,
            "syllabus_title": "Enterprise Computing",
            "syllabus_grade": "12",
            "bands": "4,5",
            "outcomes": "EC-12-11",
            "topics": "Data Science",
        }
    )
    return payload


def test_student_directory_refresh_matches_only_whitelisted_students(app_client):
    _whitelist(COURSE_ID, "12 Enterprise Computing", "12ENCX-2026")

    resp = app_client.post("/api/admin/gradeo/student-directory", json=_directory_payload())
    assert resp.status_code == 201
    data = resp.json()
    assert data["processed_students"] == 3
    assert data["matched_students"] == 1
    assert data["unmatched_students"] == 2

    stored_count = _scalar("SELECT COUNT(*) FROM gradeo_students")
    assert stored_count == 1
    stored_id = _scalar("SELECT matched_user_id FROM gradeo_students WHERE gradeo_student_id = %s", (GRADEO_STUDENT_ID,))
    assert stored_id == USER_ID


def test_gradeo_class_directory_discovery_upserts_classes(app_client):
    resp = app_client.post(
        "/api/admin/gradeo/classes",
        json={
            "extension_version": "0.1.0",
            "classes": [
                {
                    "gradeo_class_id": GRADEO_CLASS_ID,
                    "name": "12 encx_2026",
                    "syllabus_title": "Enterprise Computing",
                    "syllabuses": [
                        {
                            "id": GRADEO_SYLLABUS_ID,
                            "title": "Enterprise Computing",
                            "description": "Enterprise Computing Stage 6 Syllabus 2022",
                            "grade": 12,
                        }
                    ],
                    "teacher_count": 2,
                    "student_count": 9,
                },
                {
                    "gradeo_class_id": GRADEO_CLASS_ID,
                    "name": "12 encx_2026",
                },
            ],
        },
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["processed_classes"] == 1
    assert data["discovered_classes"] == 1
    assert data["skipped_classes"] == 1

    class_count = _scalar("SELECT COUNT(*) FROM gradeo_classes")
    assert class_count == 1
    syllabus_count = _scalar("SELECT COUNT(*) FROM gradeo_class_syllabuses WHERE gradeo_class_id = %s", (GRADEO_CLASS_ID,))
    assert syllabus_count == 1


def test_gradeo_class_directory_discovery_skips_invalid_ids_and_cleans_old_bad_rows(app_client):
    seed(
        "INSERT INTO gradeo_classes (gradeo_class_id, name, normalized_name, discovered_at, last_seen_at) "
        "VALUES ('Select class', 'Select class', 'selectclass', NOW(), NOW())",
    )

    resp = app_client.post(
        "/api/admin/gradeo/classes",
        json={
            "extension_version": "0.1.0",
            "classes": [
                {
                    "gradeo_class_id": "Select class",
                    "name": "Select class",
                },
                {
                    "gradeo_class_id": GRADEO_CLASS_ID,
                    "name": "12 encx_2026",
                },
            ],
        },
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["processed_classes"] == 1
    assert data["skipped_classes"] == 1

    invalid_count = _scalar("SELECT COUNT(*) FROM gradeo_classes WHERE gradeo_class_id = 'Select class'")
    assert invalid_count == 0


def test_gradeo_auto_match_creates_unique_mapping_and_rejects_ambiguous(app_client):
    _whitelist(COURSE_ID, "12 Enterprise Computing", "12ENCX-2026")
    preflight = app_client.post(
        "/api/admin/gradeo/imports/preflight",
        json={"gradeo_class_id": GRADEO_CLASS_ID, "gradeo_class_name": "12 encx_2026"},
    )
    assert preflight.status_code == 200

    resp = app_client.post("/api/admin/gradeo/mappings/auto-match")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["matched"]) == 1
    assert data["matched"][0]["canvas_course_id"] == COURSE_ID

    cleanup("DELETE FROM gradeo_class_mappings")
    _whitelist(SECOND_COURSE_ID, "12 ENCX 2026 Duplicate", "12ENCX2026")

    ambiguous = app_client.post("/api/admin/gradeo/mappings/auto-match")
    assert ambiguous.status_code == 200
    ambiguous_data = ambiguous.json()
    assert ambiguous_data["matched"] == []
    assert ambiguous_data["unmatched"][0]["gradeo_class_id"] == GRADEO_CLASS_ID


def test_gradeo_import_aggregates_exam_rows_and_is_idempotent(app_client):
    _whitelist(COURSE_ID, "12 Enterprise Computing", "12ENCX-2026")
    app_client.post("/api/admin/gradeo/student-directory", json=_directory_payload())
    app_client.post(
        "/api/admin/gradeo/mappings",
        json={
            "canvas_course_id": COURSE_ID,
            "gradeo_class_id": GRADEO_CLASS_ID,
            "gradeo_class_name": "12 encx_2026",
        },
    )

    first = app_client.post("/api/admin/gradeo/imports", json=_import_payload())
    second = app_client.post("/api/admin/gradeo/imports", json=_import_payload())

    assert first.status_code == 201
    assert second.status_code == 201
    assert _scalar("SELECT COUNT(*) FROM gradeo_assignment_results") == 1
    assert _scalar("SELECT COUNT(*) FROM gradeo_assignment_question_results") == 2

    report = app_client.get(f"/api/courses/{COURSE_ID}/gradeo")
    assert report.status_code == 200
    data = report.json()
    assert data["mapped"] is True
    eamon = next(student for student in data["students"] if student["name"] == "Eamon Wong")
    assert eamon["results"][GRADEO_MARKING_SESSION_ID]["status"] == "scored"
    assert eamon["results"][GRADEO_MARKING_SESSION_ID]["exam_mark"] == 9.0
    assert len(eamon["results"][GRADEO_MARKING_SESSION_ID]["questions"]) == 2
    stored_topics = _scalar(
        """
        SELECT topics
        FROM gradeo_assignment_question_results
        WHERE gradeo_question_part_id = %s
        """,
        ("5d4f989d-1f4a-4a5e-a245-6ac3881375b5",),
    )
    stored_outcomes = _scalar(
        """
        SELECT outcomes
        FROM gradeo_assignment_question_results
        WHERE gradeo_question_part_id = %s
        """,
        ("5d4f989d-1f4a-4a5e-a245-6ac3881375b5",),
    )
    stored_bands = _scalar(
        """
        SELECT bands
        FROM gradeo_assignment_question_results
        WHERE gradeo_question_part_id = %s
        """,
        ("5d4f989d-1f4a-4a5e-a245-6ac3881375b5",),
    )
    assert stored_topics == "Data Science"
    assert stored_outcomes == "EC-12-04,EC-12-08,EC-12-02"
    assert stored_bands == "3,4,5"

    updated_payload = deepcopy(_import_payload())
    updated_payload["students"][0]["rows"][0]["topics"] = "Intelligent Systems"
    updated_payload["students"][0]["rows"][0]["outcomes"] = "EC-12-11"
    updated_payload["students"][0]["rows"][0]["bands"] = "4,5"
    updated = app_client.post("/api/admin/gradeo/imports", json=updated_payload)
    assert updated.status_code == 201
    assert _scalar(
        "SELECT topics FROM gradeo_assignment_question_results WHERE gradeo_question_part_id = %s",
        ("5d4f989d-1f4a-4a5e-a245-6ac3881375b5",),
    ) == "Intelligent Systems"
    assert _scalar(
        "SELECT outcomes FROM gradeo_assignment_question_results WHERE gradeo_question_part_id = %s",
        ("5d4f989d-1f4a-4a5e-a245-6ac3881375b5",),
    ) == "EC-12-11"
    assert _scalar(
        "SELECT bands FROM gradeo_assignment_question_results WHERE gradeo_question_part_id = %s",
        ("5d4f989d-1f4a-4a5e-a245-6ac3881375b5",),
    ) == "4,5"


def test_gradeo_import_prefers_fresh_summary_marks_over_stale_csv_rows(app_client):
    _whitelist(COURSE_ID, "12 Enterprise Computing", "12ENCX-2026")
    app_client.post("/api/admin/gradeo/student-directory", json=_directory_payload())
    app_client.post(
        "/api/admin/gradeo/mappings",
        json={
            "canvas_course_id": COURSE_ID,
            "gradeo_class_id": GRADEO_CLASS_ID,
            "gradeo_class_name": "12 encx_2026",
        },
    )

    payload = deepcopy(_import_payload())
    payload["students"][0]["exam_rows"] = deepcopy(_summary_import_payload()["students"][0]["exam_rows"])
    payload["students"][0]["exam_rows"][0]["exam_mark"] = "10"
    payload["students"][0]["exam_rows"][0]["marks_available"] = "10"
    payload["students"][0]["exam_rows"][0]["status"] = "scored"

    resp = app_client.post("/api/admin/gradeo/imports", json=payload)
    assert resp.status_code == 201

    report = app_client.get(f"/api/courses/{COURSE_ID}/gradeo")
    assert report.status_code == 200
    eamon = next(student for student in report.json()["students"] if student["name"] == "Eamon Wong")
    assert eamon["results"][GRADEO_MARKING_SESSION_ID]["status"] == "scored"
    assert eamon["results"][GRADEO_MARKING_SESSION_ID]["exam_mark"] == 10.0
    assert eamon["results"][GRADEO_MARKING_SESSION_ID]["marks_available"] == 10.0


def test_gradeo_import_summary_can_clear_stale_scored_mark(app_client):
    _whitelist(COURSE_ID, "12 Enterprise Computing", "12ENCX-2026")
    app_client.post("/api/admin/gradeo/student-directory", json=_directory_payload())
    app_client.post(
        "/api/admin/gradeo/mappings",
        json={
            "canvas_course_id": COURSE_ID,
            "gradeo_class_id": GRADEO_CLASS_ID,
            "gradeo_class_name": "12 encx_2026",
        },
    )

    first = app_client.post("/api/admin/gradeo/imports", json=_summary_import_payload())
    assert first.status_code == 201

    second_payload = _summary_import_payload()
    second_payload["students"][0]["exam_rows"][0]["status"] = "awaiting_marking"
    second_payload["students"][0]["exam_rows"][0]["exam_mark"] = None

    resp = app_client.post("/api/admin/gradeo/imports", json=second_payload)
    assert resp.status_code == 201

    report = app_client.get(f"/api/courses/{COURSE_ID}/gradeo")
    assert report.status_code == 200
    eamon = next(student for student in report.json()["students"] if student["name"] == "Eamon Wong")
    assert eamon["results"][GRADEO_MARKING_SESSION_ID]["status"] == "awaiting_marking"
    assert eamon["results"][GRADEO_MARKING_SESSION_ID]["exam_mark"] is None


def test_gradeo_import_keeps_marked_question_evidence_when_summary_lags(app_client):
    _whitelist(COURSE_ID, "12 Enterprise Computing", "12ENCX-2026")
    app_client.post("/api/admin/gradeo/student-directory", json=_directory_payload())
    app_client.post(
        "/api/admin/gradeo/mappings",
        json={
            "canvas_course_id": COURSE_ID,
            "gradeo_class_id": GRADEO_CLASS_ID,
            "gradeo_class_name": "12 encx_2026",
        },
    )

    payload = deepcopy(_import_payload())
    payload["students"][0]["exam_rows"] = deepcopy(_summary_import_payload()["students"][0]["exam_rows"])
    payload["students"][0]["exam_rows"][0]["status"] = "awaiting_marking"
    payload["students"][0]["exam_rows"][0]["exam_mark"] = None

    resp = app_client.post("/api/admin/gradeo/imports", json=payload)
    assert resp.status_code == 201

    report = app_client.get(f"/api/courses/{COURSE_ID}/gradeo")
    assert report.status_code == 200
    eamon = next(student for student in report.json()["students"] if student["name"] == "Eamon Wong")
    result = eamon["results"][GRADEO_MARKING_SESSION_ID]
    assert result["status"] == "scored"
    assert result["exam_mark"] == 9.0
    assert result["marks_available"] == 10.0
    assert len(result["questions"]) == 2


def test_gradeo_report_derives_scored_status_from_marked_question_rows(app_client):
    _whitelist(COURSE_ID, "12 Enterprise Computing", "12ENCX-2026")
    app_client.post("/api/admin/gradeo/student-directory", json=_directory_payload())
    app_client.post(
        "/api/admin/gradeo/mappings",
        json={
            "canvas_course_id": COURSE_ID,
            "gradeo_class_id": GRADEO_CLASS_ID,
            "gradeo_class_name": "12 encx_2026",
        },
    )

    resp = app_client.post("/api/admin/gradeo/imports", json=_import_payload())
    assert resp.status_code == 201
    seed(
        """
        UPDATE gradeo_assignment_results
        SET status = 'awaiting_marking', exam_mark = NULL
        WHERE gradeo_student_id = :gradeo_student_id
        """,
        {"gradeo_student_id": GRADEO_STUDENT_ID},
    )

    report = app_client.get(f"/api/courses/{COURSE_ID}/gradeo")
    assert report.status_code == 200
    eamon = next(student for student in report.json()["students"] if student["name"] == "Eamon Wong")
    result = eamon["results"][GRADEO_MARKING_SESSION_ID]
    assert result["status"] == "scored"
    assert result["exam_mark"] == 9.0
    assert result["marks_available"] == 10.0
    assert len(result["questions"]) == 2


def test_gradeo_report_keeps_true_unmarked_question_rows_awaiting(app_client):
    _whitelist(COURSE_ID, "12 Enterprise Computing", "12ENCX-2026")
    app_client.post("/api/admin/gradeo/student-directory", json=_directory_payload())
    app_client.post(
        "/api/admin/gradeo/mappings",
        json={
            "canvas_course_id": COURSE_ID,
            "gradeo_class_id": GRADEO_CLASS_ID,
            "gradeo_class_name": "12 encx_2026",
        },
    )

    payload = deepcopy(_import_payload())
    for row in payload["students"][0]["rows"]:
        row["exam_mark"] = None
    payload["students"][0]["rows"][1]["mark"] = None

    resp = app_client.post("/api/admin/gradeo/imports", json=payload)
    assert resp.status_code == 201

    report = app_client.get(f"/api/courses/{COURSE_ID}/gradeo")
    assert report.status_code == 200
    eamon = next(student for student in report.json()["students"] if student["name"] == "Eamon Wong")
    result = eamon["results"][GRADEO_MARKING_SESSION_ID]
    assert result["status"] == "awaiting_marking"
    assert result["exam_mark"] is None
    assert len(result["questions"]) == 2


def test_gradeo_report_scores_authoritative_marking_item_rows_with_zero_marks(app_client):
    _whitelist(COURSE_ID, "12 Enterprise Computing", "12ENCX-2026")
    app_client.post("/api/admin/gradeo/student-directory", json=_directory_payload())
    app_client.post(
        "/api/admin/gradeo/mappings",
        json={
            "canvas_course_id": COURSE_ID,
            "gradeo_class_id": GRADEO_CLASS_ID,
            "gradeo_class_name": "12 encx_2026",
        },
    )

    payload = deepcopy(_import_payload())
    payload["students"][0]["exam_rows"] = deepcopy(_summary_import_payload()["students"][0]["exam_rows"])
    payload["students"][0]["exam_rows"][0]["status"] = "awaiting_marking"
    payload["students"][0]["exam_rows"][0]["exam_mark"] = None
    payload["students"][0]["exam_rows"][0]["marks_available"] = "8"
    payload["students"][0]["rows"][0]["mark"] = "0"
    payload["students"][0]["rows"][0]["marks_available"] = "2"
    payload["students"][0]["rows"][0]["exam_mark"] = None
    payload["students"][0]["rows"][1]["mark"] = "1"
    payload["students"][0]["rows"][1]["marks_available"] = "3"
    payload["students"][0]["rows"][1]["exam_mark"] = None
    payload["students"][0]["rows"].append(
        {
            **deepcopy(payload["students"][0]["rows"][1]),
            "gradeo_question_id": "293087a4-d5fe-4ed7-b127-89ad9cdc571e",
            "gradeo_question_part_id": "df800c33-495d-44c7-804b-327c4c096d61",
            "question": "Level 0 DFD",
            "question_part": "Part A",
            "mark": "3",
            "marks_available": "3",
            "exam_mark": None,
            "feedback": "Good diagram",
        }
    )

    resp = app_client.post("/api/admin/gradeo/imports", json=payload)
    assert resp.status_code == 201

    report = app_client.get(f"/api/courses/{COURSE_ID}/gradeo")
    assert report.status_code == 200
    eamon = next(student for student in report.json()["students"] if student["name"] == "Eamon Wong")
    result = eamon["results"][GRADEO_MARKING_SESSION_ID]
    assert result["status"] == "scored"
    assert result["exam_mark"] == 4.0
    assert result["marks_available"] == 8.0
    assert len(result["questions"]) == 3


def test_gradeo_topic_band_endpoint_aggregates_question_rows(app_client):
    _whitelist(COURSE_ID, "12 Enterprise Computing", "12ENCX-2026")
    app_client.post("/api/admin/gradeo/student-directory", json=_directory_payload())
    app_client.post(
        "/api/admin/gradeo/mappings",
        json={
            "canvas_course_id": COURSE_ID,
            "gradeo_class_id": GRADEO_CLASS_ID,
            "gradeo_class_name": "12 encx_2026",
        },
    )
    payload = deepcopy(_import_payload())
    payload["students"][0]["rows"][0]["mark"] = "2"
    payload["students"][0]["rows"][0]["marks_available"] = "2"
    payload["students"][0]["rows"][0]["topics"] = "Data Science,Intelligent Systems"
    payload["students"][0]["rows"][1]["mark"] = "0"
    payload["students"][0]["rows"][1]["marks_available"] = "8"
    payload["students"][0]["rows"][1]["topics"] = "Intelligent Systems"
    payload["students"][0]["rows"].append(
        {
            **deepcopy(payload["students"][0]["rows"][1]),
            "gradeo_question_id": "ignored-question",
            "gradeo_question_part_id": "ignored-part",
            "question_part": "Part C",
            "mark": "",
            "marks_available": "4",
            "topics": "Data Science",
        }
    )
    payload["students"][0]["rows"].append(
        {
            **deepcopy(payload["students"][0]["rows"][1]),
            "gradeo_question_id": "no-topic-question",
            "gradeo_question_part_id": "no-topic-part",
            "question_part": "Part D",
            "mark": "3",
            "marks_available": "3",
            "topics": "",
        }
    )

    resp = app_client.post("/api/admin/gradeo/imports", json=payload)
    assert resp.status_code == 201

    topic_bands = app_client.get(f"/api/courses/{COURSE_ID}/gradeo/topic-bands")
    assert topic_bands.status_code == 200
    data = topic_bands.json()
    assert data["mapped"] is True
    assert data["gradeo_class_id"] == GRADEO_CLASS_ID

    eamon = next(student for student in data["students"] if student["name"] == "Eamon Wong")
    data_science = eamon["topics"]["Data Science"]
    intelligent_systems = eamon["topics"]["Intelligent Systems"]

    assert data_science["earned_marks"] == pytest.approx(1.0)
    assert data_science["available_marks"] == pytest.approx(1.0)
    assert data_science["score_pct"] == pytest.approx(1.0)
    assert data_science["predicted_band"] == 6
    assert data_science["confidence"] == "low"
    assert data_science["part_count"] == 1

    assert intelligent_systems["earned_marks"] == pytest.approx(1.0)
    assert intelligent_systems["available_marks"] == pytest.approx(9.0)
    assert intelligent_systems["score_pct"] == pytest.approx(1 / 9)
    assert intelligent_systems["predicted_band"] == 1
    assert intelligent_systems["confidence"] == "low"
    assert intelligent_systems["part_count"] == 2

    summary = {topic["name"]: topic for topic in data["topics"]}
    assert set(summary) == {"Data Science", "Intelligent Systems"}
    assert summary["Data Science"]["student_count"] == 1
    assert summary["Data Science"]["average_score_pct"] == pytest.approx(1.0)


def test_gradeo_topic_band_endpoint_handles_unmapped_course(app_client):
    resp = app_client.get(f"/api/courses/{COURSE_ID}/gradeo/topic-bands")
    assert resp.status_code == 200
    assert resp.json() == {"mapped": False}


def test_gradeo_import_accepts_exam_summaries_without_question_rows(app_client):
    _whitelist(COURSE_ID, "12 Enterprise Computing", "12ENCX-2026")
    app_client.post("/api/admin/gradeo/student-directory", json=_directory_payload())
    app_client.post(
        "/api/admin/gradeo/mappings",
        json={
            "canvas_course_id": COURSE_ID,
            "gradeo_class_id": GRADEO_CLASS_ID,
            "gradeo_class_name": "12 encx_2026",
        },
    )

    resp = app_client.post("/api/admin/gradeo/imports", json=_summary_import_payload())
    assert resp.status_code == 201
    data = resp.json()
    assert data["processed_students"] == 1
    assert data["matched_students"] == 1
    assert data["imported_exams"] == 1
    assert data["imported_question_results"] == 0

    assert _scalar("SELECT COUNT(*) FROM gradeo_assignment_results") == 1
    assert _scalar("SELECT COUNT(*) FROM gradeo_assignment_question_results") == 0

    report = app_client.get(f"/api/courses/{COURSE_ID}/gradeo")
    assert report.status_code == 200
    report_data = report.json()
    eamon = next(student for student in report_data["students"] if student["name"] == "Eamon Wong")
    result = eamon["results"][GRADEO_MARKING_SESSION_ID]
    assert result["status"] == "scored"
    assert result["exam_mark"] == 9.0
    assert result["questions"] == []


def test_gradeo_reimport_prunes_stale_assignments_and_question_rows(app_client):
    _whitelist(COURSE_ID, "12 Enterprise Computing", "12ENCX-2026")
    app_client.post("/api/admin/gradeo/student-directory", json=_directory_payload())
    app_client.post(
        "/api/admin/gradeo/mappings",
        json={
            "canvas_course_id": COURSE_ID,
            "gradeo_class_id": GRADEO_CLASS_ID,
            "gradeo_class_name": "12 encx_2026",
        },
    )

    first = app_client.post("/api/admin/gradeo/imports", json=_import_payload())
    assert first.status_code == 201
    assert _scalar("SELECT COUNT(*) FROM gradeo_assignment_results") == 1
    assert _scalar("SELECT COUNT(*) FROM gradeo_assignment_question_results") == 2

    second = app_client.post("/api/admin/gradeo/imports", json=_empty_import_payload())
    assert second.status_code == 201
    assert second.json()["imported_exams"] == 0

    assert _scalar("SELECT COUNT(*) FROM gradeo_assignment_results") == 0
    assert _scalar("SELECT COUNT(*) FROM gradeo_assignment_question_results") == 0
    assert _scalar("SELECT COUNT(*) FROM gradeo_class_exam_assignments") == 0

    report = app_client.get(f"/api/courses/{COURSE_ID}/gradeo")
    assert report.status_code == 200
    report_data = report.json()
    assert report_data["exams"] == []
    eamon = next(student for student in report_data["students"] if student["name"] == "Eamon Wong")
    assert eamon["completion_rate"] is None
    assert eamon["results"] == {}


def test_gradeo_scoped_task_import_updates_one_session_without_pruning_others(app_client):
    _whitelist(COURSE_ID, "12 Enterprise Computing", "12ENCX-2026")
    app_client.post("/api/admin/gradeo/student-directory", json=_directory_payload())
    app_client.post(
        "/api/admin/gradeo/mappings",
        json={
            "canvas_course_id": COURSE_ID,
            "gradeo_class_id": GRADEO_CLASS_ID,
            "gradeo_class_name": "12 encx_2026",
        },
    )

    first = app_client.post("/api/admin/gradeo/imports", json=_multi_session_summary_import_payload())
    assert first.status_code == 201
    assert _scalar("SELECT COUNT(*) FROM gradeo_class_exam_assignments") == 2

    scoped_payload = _summary_import_payload()
    scoped_payload["import_scope"] = "marking_sessions"
    scoped_payload["scope_marking_session_ids"] = [GRADEO_MARKING_SESSION_ID]
    scoped_payload["students"][0]["exam_rows"][0]["exam_mark"] = "6"
    scoped_payload["students"][0]["exam_rows"][0]["marks_available"] = "10"

    second = app_client.post("/api/admin/gradeo/imports", json=scoped_payload)
    assert second.status_code == 201

    assert _scalar("SELECT COUNT(*) FROM gradeo_class_exam_assignments") == 2
    report = app_client.get(f"/api/courses/{COURSE_ID}/gradeo")
    assert report.status_code == 200
    eamon = next(student for student in report.json()["students"] if student["name"] == "Eamon Wong")
    assert set(eamon["results"]) == {GRADEO_MARKING_SESSION_ID, "marking-session-2"}
    assert eamon["results"][GRADEO_MARKING_SESSION_ID]["exam_mark"] == 6.0
    assert eamon["results"]["marking-session-2"]["exam_mark"] == 8.0


def test_gradeo_scoped_task_import_prunes_only_requested_session(app_client):
    _whitelist(COURSE_ID, "12 Enterprise Computing", "12ENCX-2026")
    app_client.post("/api/admin/gradeo/student-directory", json=_directory_payload())
    app_client.post(
        "/api/admin/gradeo/mappings",
        json={
            "canvas_course_id": COURSE_ID,
            "gradeo_class_id": GRADEO_CLASS_ID,
            "gradeo_class_name": "12 encx_2026",
        },
    )

    first = app_client.post("/api/admin/gradeo/imports", json=_multi_session_summary_import_payload())
    assert first.status_code == 201

    scoped_payload = _empty_import_payload()
    scoped_payload["import_scope"] = "marking_sessions"
    scoped_payload["scope_marking_session_ids"] = [GRADEO_MARKING_SESSION_ID]

    second = app_client.post("/api/admin/gradeo/imports", json=scoped_payload)
    assert second.status_code == 201
    assert second.json()["imported_exams"] == 0

    assert _scalar("SELECT COUNT(*) FROM gradeo_class_exam_assignments") == 1
    remaining = _scalar("SELECT gradeo_marking_session_id FROM gradeo_class_exam_assignments")
    assert remaining == "marking-session-2"


def test_gradeo_scoped_task_import_rejects_out_of_scope_payload(app_client):
    _whitelist(COURSE_ID, "12 Enterprise Computing", "12ENCX-2026")
    app_client.post("/api/admin/gradeo/student-directory", json=_directory_payload())
    app_client.post(
        "/api/admin/gradeo/mappings",
        json={
            "canvas_course_id": COURSE_ID,
            "gradeo_class_id": GRADEO_CLASS_ID,
            "gradeo_class_name": "12 encx_2026",
        },
    )

    payload = _summary_import_payload()
    payload["import_scope"] = "marking_sessions"
    payload["scope_marking_session_ids"] = ["marking-session-2"]

    resp = app_client.post("/api/admin/gradeo/imports", json=payload)
    assert resp.status_code == 400
    assert "out-of-scope marking session" in resp.json()["detail"]


def test_gradeo_report_returns_null_for_unassigned_exam_cells(app_client):
    _whitelist(COURSE_ID, "12 Enterprise Computing", "12ENCX-2026")
    app_client.post("/api/admin/gradeo/student-directory", json=_directory_payload_with_second_student())
    app_client.post(
        "/api/admin/gradeo/mappings",
        json={
            "canvas_course_id": COURSE_ID,
            "gradeo_class_id": GRADEO_CLASS_ID,
            "gradeo_class_name": "12 encx_2026",
        },
    )

    resp = app_client.post("/api/admin/gradeo/imports", json=_summary_import_payload())
    assert resp.status_code == 201

    report = app_client.get(f"/api/courses/{COURSE_ID}/gradeo")
    assert report.status_code == 200
    report_data = report.json()

    eamon = next(student for student in report_data["students"] if student["name"] == "Eamon Wong")
    assert eamon["results"][GRADEO_MARKING_SESSION_ID]["status"] == "scored"
    assert eamon["completion_rate"] == 1.0
    assert report_data["hidden_students"] == [{"id": OUT_OF_SCOPE_USER_ID + 1, "name": "Noah Ould"}]


def test_gradeo_same_canonical_exam_can_exist_in_multiple_sessions_within_one_class(app_client):
    _whitelist(COURSE_ID, "12 Enterprise Computing", "12ENCX-2026")
    app_client.post("/api/admin/gradeo/student-directory", json=_directory_payload())
    app_client.post(
        "/api/admin/gradeo/mappings",
        json={
            "canvas_course_id": COURSE_ID,
            "gradeo_class_id": GRADEO_CLASS_ID,
            "gradeo_class_name": "12 encx_2026",
        },
    )

    resp = app_client.post("/api/admin/gradeo/imports", json=_multi_session_summary_import_payload())
    assert resp.status_code == 201
    assert resp.json()["imported_exams"] == 2

    report = app_client.get(f"/api/courses/{COURSE_ID}/gradeo")
    assert report.status_code == 200
    data = report.json()
    assert {exam["id"] for exam in data["exams"]} == {"marking-session-1", "marking-session-2"}

    eamon = next(student for student in data["students"] if student["name"] == "Eamon Wong")
    assert eamon["results"]["marking-session-1"]["exam_mark"] == 9.0
    assert eamon["results"]["marking-session-2"]["exam_mark"] == 8.0


def test_gradeo_report_dedupes_same_marking_session_across_mapped_classes(app_client):
    _whitelist(COURSE_ID, "12 Enterprise Computing", "12ENCX-2026")
    app_client.post("/api/admin/gradeo/student-directory", json=_directory_payload())
    app_client.post(
        "/api/admin/gradeo/mappings",
        json={
            "canvas_course_id": COURSE_ID,
            "gradeo_class_id": GRADEO_CLASS_ID,
            "gradeo_class_name": "12 encx_2026",
        },
    )
    app_client.post(
        "/api/admin/gradeo/mappings",
        json={
            "canvas_course_id": COURSE_ID,
            "gradeo_class_id": SECOND_GRADEO_CLASS_ID,
            "gradeo_class_name": "12 encx duplicate",
        },
    )

    first = app_client.post("/api/admin/gradeo/imports", json=_summary_import_payload())
    second = app_client.post(
        "/api/admin/gradeo/imports",
        json=_summary_import_payload_for(
            gradeo_class_id=SECOND_GRADEO_CLASS_ID,
            gradeo_class_name="12 encx duplicate",
        ),
    )
    assert first.status_code == 201
    assert second.status_code == 201
    assert _scalar("SELECT COUNT(*) FROM gradeo_class_exam_assignments") == 2

    report = app_client.get(f"/api/courses/{COURSE_ID}/gradeo")
    assert report.status_code == 200
    data = report.json()
    assert [exam["id"] for exam in data["exams"]] == [GRADEO_MARKING_SESSION_ID]
    assert {item["gradeo_class_id"] for item in data["gradeo_classes"]} == {GRADEO_CLASS_ID, SECOND_GRADEO_CLASS_ID}

    eamon = next(student for student in data["students"] if student["name"] == "Eamon Wong")
    assert set(eamon["results"]) == {GRADEO_MARKING_SESSION_ID}
    assert eamon["results"][GRADEO_MARKING_SESSION_ID]["status"] == "scored"


def test_gradeo_report_uses_newest_imported_duplicate_result_state(app_client):
    _whitelist(COURSE_ID, "12 Enterprise Computing", "12ENCX-2026")
    app_client.post("/api/admin/gradeo/student-directory", json=_directory_payload())
    app_client.post(
        "/api/admin/gradeo/mappings",
        json={
            "canvas_course_id": COURSE_ID,
            "gradeo_class_id": GRADEO_CLASS_ID,
            "gradeo_class_name": "12 encx_2026",
        },
    )
    app_client.post(
        "/api/admin/gradeo/mappings",
        json={
            "canvas_course_id": COURSE_ID,
            "gradeo_class_id": SECOND_GRADEO_CLASS_ID,
            "gradeo_class_name": "12 encx duplicate",
        },
    )

    scored = app_client.post("/api/admin/gradeo/imports", json=_summary_import_payload())
    awaiting = app_client.post(
        "/api/admin/gradeo/imports",
        json=_summary_import_payload_for(
            gradeo_class_id=SECOND_GRADEO_CLASS_ID,
            gradeo_class_name="12 encx duplicate",
            status="awaiting_marking",
            exam_mark=None,
        ),
    )
    assert scored.status_code == 201
    assert awaiting.status_code == 201
    seed(
        """
        UPDATE gradeo_assignment_results gar
        SET last_imported_at = '2026-01-01T00:00:00+00:00'
        FROM gradeo_class_exam_assignments gcea
        WHERE gar.gradeo_class_exam_assignment_id = gcea.id
          AND gcea.gradeo_class_id = :gradeo_class_id
        """,
        {"gradeo_class_id": GRADEO_CLASS_ID},
    )
    seed(
        """
        UPDATE gradeo_assignment_results gar
        SET last_imported_at = '2026-01-02T00:00:00+00:00'
        FROM gradeo_class_exam_assignments gcea
        WHERE gar.gradeo_class_exam_assignment_id = gcea.id
          AND gcea.gradeo_class_id = :gradeo_class_id
        """,
        {"gradeo_class_id": SECOND_GRADEO_CLASS_ID},
    )

    report = app_client.get(f"/api/courses/{COURSE_ID}/gradeo")
    assert report.status_code == 200
    data = report.json()
    eamon = next(student for student in data["students"] if student["name"] == "Eamon Wong")
    result = eamon["results"][GRADEO_MARKING_SESSION_ID]
    assert result["status"] == "awaiting_marking"
    assert result["exam_mark"] is None


def test_gradeo_report_includes_students_from_different_mapped_classes(app_client):
    _whitelist(COURSE_ID, "12 Enterprise Computing", "12ENCX-2026")
    app_client.post("/api/admin/gradeo/student-directory", json=_directory_payload_with_second_student())
    app_client.post(
        "/api/admin/gradeo/mappings",
        json={
            "canvas_course_id": COURSE_ID,
            "gradeo_class_id": GRADEO_CLASS_ID,
            "gradeo_class_name": "12 encx_2026",
        },
    )
    app_client.post(
        "/api/admin/gradeo/mappings",
        json={
            "canvas_course_id": COURSE_ID,
            "gradeo_class_id": SECOND_GRADEO_CLASS_ID,
            "gradeo_class_name": "12 encx duplicate",
        },
    )

    first = app_client.post("/api/admin/gradeo/imports", json=_summary_import_payload())
    second = app_client.post(
        "/api/admin/gradeo/imports",
        json=_summary_import_payload_for(
            gradeo_class_id=SECOND_GRADEO_CLASS_ID,
            gradeo_class_name="12 encx duplicate",
            gradeo_student_id=SECOND_GRADEO_STUDENT_ID,
            student_name="Noah Ould",
        ),
    )
    assert first.status_code == 201
    assert second.status_code == 201

    report = app_client.get(f"/api/courses/{COURSE_ID}/gradeo")
    assert report.status_code == 200
    data = report.json()
    students_by_name = {student["name"]: student for student in data["students"]}
    assert students_by_name["Eamon Wong"]["results"][GRADEO_MARKING_SESSION_ID]["status"] == "scored"
    assert students_by_name["Noah Ould"]["results"][GRADEO_MARKING_SESSION_ID]["status"] == "scored"


def test_gradeo_same_canonical_exam_can_exist_in_multiple_classes(app_client):
    _whitelist(COURSE_ID, "12 Enterprise Computing", "12ENCX-2026")
    _whitelist(SECOND_COURSE_ID, "12 ENCX 2026 Duplicate", "12ENCX2026")
    app_client.post("/api/admin/gradeo/student-directory", json=_directory_payload())
    app_client.post(
        "/api/admin/gradeo/mappings",
        json={
            "canvas_course_id": COURSE_ID,
            "gradeo_class_id": GRADEO_CLASS_ID,
            "gradeo_class_name": "12 encx_2026",
        },
    )
    app_client.post(
        "/api/admin/gradeo/mappings",
        json={
            "canvas_course_id": SECOND_COURSE_ID,
            "gradeo_class_id": SECOND_GRADEO_CLASS_ID,
            "gradeo_class_name": "11SENX2-2026",
        },
    )

    first = app_client.post("/api/admin/gradeo/imports", json=_summary_import_payload())
    assert first.status_code == 201

    second_payload = _summary_import_payload()
    second_payload["gradeo_class_id"] = SECOND_GRADEO_CLASS_ID
    second_payload["gradeo_class_name"] = "11SENX2-2026"
    second_payload["students"][0]["exam_rows"][0]["gradeo_class_id"] = SECOND_GRADEO_CLASS_ID
    second_payload["students"][0]["exam_rows"][0]["gradeo_marking_session_id"] = "marking-session-2"
    second_payload["students"][0]["exam_rows"][0]["gradeo_exam_session_id"] = "exam-session-2"
    second_payload["students"][0]["exam_rows"][0]["exam_name"] = "12ENC_Cycle6"
    second = app_client.post("/api/admin/gradeo/imports", json=second_payload)
    assert second.status_code == 201

    course_one = app_client.get(f"/api/courses/{COURSE_ID}/gradeo")
    course_two = app_client.get(f"/api/courses/{SECOND_COURSE_ID}/gradeo")
    assert course_one.status_code == 200
    assert course_two.status_code == 200

    report_one = course_one.json()
    report_two = course_two.json()
    eamon_one = next(student for student in report_one["students"] if student["name"] == "Eamon Wong")
    eamon_two = next(student for student in report_two["students"] if student["name"] == "Eamon Wong")

    assert "marking-session-1" in eamon_one["results"]
    assert eamon_one["results"]["marking-session-1"]["status"] == "scored"
    assert "marking-session-2" in eamon_two["results"]
    assert eamon_two["results"]["marking-session-2"]["status"] == "scored"


def test_gradeo_report_dedupes_different_class_prefix_same_cycle(app_client):
    """Two classes (12ENCX, 12ENCY) mapped to the same course, each with exams
    like '12ENCX_Cycle1' and '12ENCY_Cycle1'.  They represent the same logical
    cycle and should be merged into a single column named 'Cycle1', using the
    latest/best result."""
    _whitelist(COURSE_ID, "12 Enterprise Computing", "12ENCX-2026")
    app_client.post("/api/admin/gradeo/student-directory", json=_directory_payload())
    app_client.post(
        "/api/admin/gradeo/mappings",
        json={
            "canvas_course_id": COURSE_ID,
            "gradeo_class_id": GRADEO_CLASS_ID,
            "gradeo_class_name": "12ENCX",
        },
    )
    app_client.post(
        "/api/admin/gradeo/mappings",
        json={
            "canvas_course_id": COURSE_ID,
            "gradeo_class_id": SECOND_GRADEO_CLASS_ID,
            "gradeo_class_name": "12ENCY",
        },
    )

    # Import from first class: exam named "12ENCX_Cycle1" with score 7/10
    first_payload = _summary_import_payload_for(
        gradeo_class_id=GRADEO_CLASS_ID,
        gradeo_class_name="12ENCX",
        marking_session_id="ms-class-x",
        exam_session_id="es-class-x",
        exam_mark="7",
    )
    first_payload["students"][0]["exam_rows"][0]["exam_name"] = "12ENCX_Cycle1"
    first_payload["students"][0]["exam_rows"][0]["class_name"] = "12ENCX"
    first = app_client.post("/api/admin/gradeo/imports", json=first_payload)
    assert first.status_code == 201

    # Import from second class: exam named "12ENCY_Cycle1" with score 9/10
    second_payload = _summary_import_payload_for(
        gradeo_class_id=SECOND_GRADEO_CLASS_ID,
        gradeo_class_name="12ENCY",
        marking_session_id="ms-class-y",
        exam_session_id="es-class-y",
        exam_mark="9",
    )
    second_payload["students"][0]["exam_rows"][0]["exam_name"] = "12ENCY_Cycle1"
    second_payload["students"][0]["exam_rows"][0]["class_name"] = "12ENCY"
    second = app_client.post("/api/admin/gradeo/imports", json=second_payload)
    assert second.status_code == 201

    # There should be 2 DB rows but the report should show only 1 exam column
    assert _scalar("SELECT COUNT(*) FROM gradeo_class_exam_assignments") == 2

    report = app_client.get(f"/api/courses/{COURSE_ID}/gradeo")
    assert report.status_code == 200
    data = report.json()

    # Should have a single exam column with normalised name (no class prefix)
    assert len(data["exams"]) == 1
    assert data["exams"][0]["name"] == "Cycle1"

    # Student should have a single result (the latest/best one)
    eamon = next(s for s in data["students"] if s["name"] == "Eamon Wong")
    assert len([v for v in eamon["results"].values() if v is not None]) == 1


def test_gradeo_course_endpoint_returns_unmapped_false(app_client):
    resp = app_client.get(f"/api/courses/{COURSE_ID}/gradeo")
    assert resp.status_code == 200
    assert resp.json() == {"mapped": False}


def test_gradeo_admin_routes_reject_non_admin(teacher_client):
    resp = teacher_client.get("/api/admin/gradeo/mappings")
    assert resp.status_code == 403

    resp = teacher_client.post("/api/admin/gradeo/student-directory", json=_directory_payload())
    assert resp.status_code == 403
