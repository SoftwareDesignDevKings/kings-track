from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from unittest.mock import patch
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import text

from app.config import settings
from app.reminders.email import EmailSendRequest, SmtpEmailSender
from app.reminders.schedule import (
    is_due_for_reminder,
    reminder_slot_for_due_at,
    to_local,
)
from app.reminders.service import MissingTask, ReminderService
from app.reminders.templates import (
    render_guardian_html,
    render_school_html,
    render_student_html,
)
from tests.conftest import _TestSessionLocal, cleanup, seed

COURSE_ID = 9101
ALICE_ID = 91011
BOB_ID = 91012
ALICE_ENROLLMENT_ID = 91021
BOB_ENROLLMENT_ID = 91022
ASSIGNMENT_ID = 91031
SUBMITTED_ASSIGNMENT_ID = 91032
FUTURE_ASSIGNMENT_ID = 91033
SCHOOL_ID = 91041
GUARDIAN_ID = 91051
SCHOOL_CONTACT_ID = 91061
SYDNEY = ZoneInfo("Australia/Sydney")


def _iso_local(year: int, month: int, day: int, hour: int, minute: int = 0) -> str:
    return datetime(year, month, day, hour, minute, tzinfo=SYDNEY).astimezone(timezone.utc).isoformat()


def _scheduled_slot() -> datetime:
    due_at = datetime(2025, 4, 1, 10, 0, tzinfo=SYDNEY).astimezone(timezone.utc)
    return reminder_slot_for_due_at(due_at, "Australia/Sydney")


@dataclass
class FakeSendResult:
    status: str
    provider_response: str | None = None
    error_message: str | None = None


class FakeEmailSender:
    def __init__(self):
        self.requests: list[dict] = []

    async def send_email(self, request):
        self.requests.append(
            {
                "to_email": request.to_email,
                "subject": request.subject,
                "body": request.text_body,
                "text_body": request.text_body,
                "html_body": request.html_body,
            }
        )
        return FakeSendResult(status="sent", provider_response="queued")


def _task(
    *,
    student_name: str = "Alice Student",
    student_email: str | None = "alice@example.com",
    course_name: str = "Reminder Course",
    course_code: str | None = "RC101",
    assignment_name: str = "Essay Draft",
    due_at: datetime | None = None,
    points_possible: float | None = 10,
) -> MissingTask:
    return MissingTask(
        user_id=ALICE_ID,
        student_name=student_name,
        student_email=student_email,
        course_id=COURSE_ID,
        course_name=course_name,
        course_code=course_code,
        assignment_id=ASSIGNMENT_ID,
        assignment_name=assignment_name,
        due_at=due_at or datetime(2025, 4, 1, 10, 0, tzinfo=SYDNEY).astimezone(timezone.utc),
        points_possible=points_possible,
        school_id=SCHOOL_ID,
        school_name="Test School",
    )


@pytest.fixture(autouse=True)
def clean_reminder_data():
    yield
    cleanup(
        "DELETE FROM reminder_deliveries WHERE run_id IN (SELECT id FROM reminder_runs WHERE triggered_by IN ('test-suite', 'route-test@example.com', 'test@example.com'))"
    )
    cleanup("DELETE FROM reminder_deliveries WHERE user_id IN (:alice, :bob)", {"alice": ALICE_ID, "bob": BOB_ID})
    cleanup("DELETE FROM reminder_deliveries WHERE school_id = :school_id", {"school_id": SCHOOL_ID})
    cleanup("DELETE FROM reminder_runs WHERE triggered_by IN ('test-suite', 'route-test@example.com', 'test@example.com')", {})
    cleanup("DELETE FROM school_contacts WHERE school_id = :school_id", {"school_id": SCHOOL_ID})
    cleanup("DELETE FROM guardian_contacts WHERE user_id IN (:alice, :bob)", {"alice": ALICE_ID, "bob": BOB_ID})
    cleanup("DELETE FROM student_school_links WHERE user_id IN (:alice, :bob)", {"alice": ALICE_ID, "bob": BOB_ID})
    cleanup("DELETE FROM schools WHERE id = :school_id", {"school_id": SCHOOL_ID})
    cleanup("DELETE FROM submissions WHERE course_id = :course_id", {"course_id": COURSE_ID})
    cleanup("DELETE FROM enrollments WHERE course_id = :course_id", {"course_id": COURSE_ID})
    cleanup("DELETE FROM assignments WHERE course_id = :course_id", {"course_id": COURSE_ID})
    cleanup("DELETE FROM course_whitelist WHERE course_id = :course_id", {"course_id": COURSE_ID})
    cleanup("DELETE FROM users WHERE id IN (:alice, :bob)", {"alice": ALICE_ID, "bob": BOB_ID})
    cleanup("DELETE FROM courses WHERE id = :course_id", {"course_id": COURSE_ID})


@pytest.fixture(autouse=True)
def patch_reminder_session_factory():
    with patch("app.reminders.service.AsyncSessionLocal", _TestSessionLocal):
        yield


@pytest.fixture(autouse=True)
def disable_test_routing_override():
    with patch.object(settings, "reminder_test_mode_enabled", False), \
         patch.object(settings, "reminder_test_recipient_email", "liam22840@gmail.com"):
        yield


def _seed_base_course():
    now = datetime.now(timezone.utc).isoformat()
    seed(
        "INSERT INTO courses (id, name, course_code, workflow_state, synced_at, total_students) "
        "VALUES (:id, 'Reminder Course', 'RC101', 'available', :now, 2) "
        "ON CONFLICT (id) DO NOTHING",
        {"id": COURSE_ID, "now": now},
    )
    seed(
        "INSERT INTO course_whitelist (course_id, name, course_code) VALUES (:id, 'Reminder Course', 'RC101') "
        "ON CONFLICT (course_id) DO NOTHING",
        {"id": COURSE_ID},
    )
    seed(
        "INSERT INTO users (id, name, sortable_name, email, sis_id) VALUES "
        "(:alice, 'Alice Student', 'Student, Alice', 'alice@example.com', 'alice'), "
        "(:bob, 'Bob Student', 'Student, Bob', 'bob@example.com', 'bob') "
        "ON CONFLICT (id) DO NOTHING",
        {"alice": ALICE_ID, "bob": BOB_ID},
    )
    seed(
        "INSERT INTO enrollments (id, course_id, user_id, role, enrollment_state) VALUES "
        "(:alice_enrollment, :course_id, :alice, 'StudentEnrollment', 'active'), "
        "(:bob_enrollment, :course_id, :bob, 'StudentEnrollment', 'active') "
        "ON CONFLICT (id) DO NOTHING",
        {
            "alice_enrollment": ALICE_ENROLLMENT_ID,
            "bob_enrollment": BOB_ENROLLMENT_ID,
            "course_id": COURSE_ID,
            "alice": ALICE_ID,
            "bob": BOB_ID,
        },
    )
    seed(
        "INSERT INTO assignments (id, course_id, name, workflow_state, due_at, points_possible) VALUES "
        "(:assignment_id, :course_id, 'Essay Draft', 'published', :due_at, 10), "
        "(:submitted_assignment_id, :course_id, 'Weekly Quiz', 'published', :submitted_due_at, 5), "
        "(:future_assignment_id, :course_id, 'Future Task', 'published', :future_due_at, 8) "
        "ON CONFLICT (id) DO NOTHING",
        {
            "assignment_id": ASSIGNMENT_ID,
            "submitted_assignment_id": SUBMITTED_ASSIGNMENT_ID,
            "future_assignment_id": FUTURE_ASSIGNMENT_ID,
            "course_id": COURSE_ID,
            "due_at": _iso_local(2025, 4, 1, 10),
            "submitted_due_at": _iso_local(2025, 4, 2, 9),
            "future_due_at": _iso_local(2025, 4, 21, 9),
        },
    )


def test_reminder_schedule_uses_second_week_sunday():
    due_at = datetime(2025, 4, 1, 10, 0, tzinfo=SYDNEY).astimezone(timezone.utc)
    scheduled_for = reminder_slot_for_due_at(due_at, "Australia/Sydney")
    scheduled_local = to_local(scheduled_for, "Australia/Sydney")

    assert scheduled_local.date().isoformat() == "2025-04-13"
    assert scheduled_local.hour == 23
    assert scheduled_local.minute == 59


def test_reminder_schedule_repeats_every_fourteen_days_and_survives_dst():
    due_at = datetime(2025, 3, 31, 10, 0, tzinfo=SYDNEY).astimezone(timezone.utc)
    first = reminder_slot_for_due_at(due_at, "Australia/Sydney")
    second = first + timedelta(days=14)

    assert is_due_for_reminder(due_at, first, "Australia/Sydney") is True
    assert is_due_for_reminder(due_at, second, "Australia/Sydney") is True
    assert to_local(first, "Australia/Sydney").strftime("%H:%M") == "23:59"
    assert to_local(second, "Australia/Sydney").strftime("%H:%M") == "23:59"


async def test_run_scheduled_window_sends_students_with_missing_due_now_only(db):
    _seed_base_course()
    seed(
        "INSERT INTO submissions (id, assignment_id, user_id, course_id, workflow_state, late, missing) VALUES "
        "(92001, :submitted_assignment_id, :alice, :course_id, 'submitted', false, false), "
        "(92002, :assignment_id, :bob, :course_id, 'graded', false, false), "
        "(92003, :submitted_assignment_id, :bob, :course_id, 'graded', false, false) "
        "ON CONFLICT (assignment_id, user_id) DO NOTHING",
        {
            "submitted_assignment_id": SUBMITTED_ASSIGNMENT_ID,
            "assignment_id": ASSIGNMENT_ID,
            "alice": ALICE_ID,
            "bob": BOB_ID,
            "course_id": COURSE_ID,
        },
    )
    sender = FakeEmailSender()
    service = ReminderService()

    with patch("app.reminders.service.build_email_sender", return_value=sender):
        result = await service.run_scheduled_window(_scheduled_slot(), triggered_by="test-suite")

    assert result["status"] == "completed"
    assert result["student_recipient_count"] == 1
    assert result["guardian_recipient_count"] == 0
    assert result["school_recipient_count"] == 0
    assert result["sent_count"] == 1
    assert [request["to_email"] for request in sender.requests] == ["alice@example.com"]
    assert "you need to complete it as soon as possible" in sender.requests[0]["body"]
    assert "Essay Draft" in sender.requests[0]["body"]
    assert "Weekly Quiz" not in sender.requests[0]["body"]
    assert "Future Task" not in sender.requests[0]["body"]
    assert "Missing Work Reminder" in (sender.requests[0]["html_body"] or "")
    assert "background:linear-gradient(135deg, #2f4ac0 0%, #3b5bdb 100%)" in (sender.requests[0]["html_body"] or "")

    delivery_result = await db.execute(
        text(
            "SELECT status, item_count FROM reminder_deliveries "
            "WHERE recipient_type = 'student' AND recipient_id = :recipient_id"
        ),
        {"recipient_id": str(ALICE_ID)},
    )
    row = delivery_result.fetchone()
    assert row[0] == "sent"
    assert row[1] == 1


async def test_run_scheduled_window_is_idempotent_for_existing_sent_deliveries(db):
    _seed_base_course()
    sender = FakeEmailSender()
    service = ReminderService()
    slot = _scheduled_slot()

    with patch("app.reminders.service.build_email_sender", return_value=sender):
        first = await service.run_scheduled_window(slot, triggered_by="test-suite")
        second = await service.run_scheduled_window(slot, triggered_by="test-suite")

    assert first["sent_count"] == 2
    assert second["sent_count"] == 0
    assert second["skipped_count"] == 2
    assert len(sender.requests) == 2

    count_result = await db.execute(text("SELECT COUNT(*) FROM reminder_deliveries WHERE scheduled_for = :scheduled_for"), {"scheduled_for": slot})
    assert count_result.scalar() == 2


async def test_school_and_guardian_digests_are_extendable_but_filtered(db):
    _seed_base_course()
    seed("INSERT INTO schools (id, name) VALUES (:id, 'Test School') ON CONFLICT (id) DO NOTHING", {"id": SCHOOL_ID})
    seed(
        "INSERT INTO student_school_links (user_id, school_id) VALUES (:alice, :school_id), (:bob, :school_id) "
        "ON CONFLICT (user_id) DO UPDATE SET school_id = EXCLUDED.school_id",
        {"alice": ALICE_ID, "bob": BOB_ID, "school_id": SCHOOL_ID},
    )
    seed(
        "INSERT INTO guardian_contacts (id, user_id, name, email, relationship_label, active) VALUES "
        "(:guardian_id, :alice, 'Alice Parent', 'parent@example.com', 'Parent', true) "
        "ON CONFLICT (id) DO NOTHING",
        {"guardian_id": GUARDIAN_ID, "alice": ALICE_ID},
    )
    seed(
        "INSERT INTO school_contacts (id, school_id, name, email, role_label, active) VALUES "
        "(:school_contact_id, :school_id, 'School Rep', 'school@example.com', 'Representative', true) "
        "ON CONFLICT (id) DO NOTHING",
        {"school_contact_id": SCHOOL_CONTACT_ID, "school_id": SCHOOL_ID},
    )
    seed(
        "INSERT INTO submissions (id, assignment_id, user_id, course_id, workflow_state, late, missing) VALUES "
        "(93001, :assignment_id, :bob, :course_id, 'graded', false, false), "
        "(93002, :submitted_assignment_id, :bob, :course_id, 'graded', false, false) "
        "ON CONFLICT (assignment_id, user_id) DO NOTHING",
        {
            "assignment_id": ASSIGNMENT_ID,
            "submitted_assignment_id": SUBMITTED_ASSIGNMENT_ID,
            "bob": BOB_ID,
            "course_id": COURSE_ID,
        },
    )

    sender = FakeEmailSender()
    service = ReminderService()
    with patch("app.reminders.service.build_email_sender", return_value=sender):
        result = await service.run_scheduled_window(_scheduled_slot(), triggered_by="test-suite")

    assert result["student_recipient_count"] == 1
    assert result["guardian_recipient_count"] == 1
    assert result["school_recipient_count"] == 1
    assert sorted(request["to_email"] for request in sender.requests) == [
        "alice@example.com",
        "parent@example.com",
        "school@example.com",
    ]

    school_request = next(request for request in sender.requests if request["to_email"] == "school@example.com")
    assert school_request["body"].startswith("Dear School Rep,")
    assert "students in this course: Reminder Course (RC101)." in school_request["body"]
    assert "Alice Student" in school_request["body"]
    assert "Bob Student" not in school_request["body"]


async def test_test_routing_override_sends_three_messages_to_single_inbox():
    _seed_base_course()
    seed(
        "INSERT INTO submissions (id, assignment_id, user_id, course_id, workflow_state, late, missing) VALUES "
        "(94001, :submitted_assignment_id, :alice, :course_id, 'graded', false, false) "
        "ON CONFLICT (assignment_id, user_id) DO NOTHING",
        {
            "submitted_assignment_id": SUBMITTED_ASSIGNMENT_ID,
            "alice": ALICE_ID,
            "course_id": COURSE_ID,
        },
    )
    sender = FakeEmailSender()
    service = ReminderService()

    with patch.object(settings, "reminder_test_mode_enabled", True), \
         patch.object(settings, "reminder_test_recipient_email", "liam22840@gmail.com"), \
         patch("app.reminders.service.build_email_sender", return_value=sender):
        result = await service.run_scheduled_window(_scheduled_slot(), triggered_by="test-suite")

    assert result["student_recipient_count"] == 1
    assert result["guardian_recipient_count"] == 1
    assert result["school_recipient_count"] == 1
    assert result["delivery_count"] == 3
    assert sorted(request["to_email"] for request in sender.requests) == [
        "liam22840@gmail.com",
        "liam22840@gmail.com",
        "liam22840@gmail.com",
    ]
    assert sender.requests[0]["subject"].startswith("[TEST student]")
    assert sender.requests[1]["subject"].startswith("[TEST parent]")
    assert sender.requests[2]["subject"].startswith("[TEST school]")
    assert sender.requests[2]["body"].startswith("Dear School Contact,")
    assert "Alice Student" in sender.requests[2]["body"]
    assert "Bob Student" in sender.requests[2]["body"]
    assert "Missing Work Summary" in (sender.requests[2]["html_body"] or "")


def test_student_html_template_uses_brand_header_and_escapes_dynamic_content():
    scheduled_for = _scheduled_slot()
    html = render_student_html(
        "Alice <Student>",
        [
            _task(
                student_name="Alice <Student>",
                course_name="Reminder <Course>",
                assignment_name="Essay <Draft>",
            )
        ],
        scheduled_for,
        settings.reminder_email_from_name,
    )

    assert "Missing Work Reminder" in html
    assert "Kings Track" in html
    assert "Alice &lt;Student&gt;" in html
    assert "Reminder &lt;Course&gt; (RC101)" in html
    assert "Essay &lt;Draft&gt; | due" in html
    assert "Alice <Student>" not in html


def test_guardian_html_template_renders_intro_and_grouped_sections():
    scheduled_for = _scheduled_slot()
    html = render_guardian_html(
        "Alice Student",
        "Alice Parent",
        [
            _task(assignment_name="Essay Draft"),
            _task(assignment_name="Weekly Quiz"),
        ],
        scheduled_for,
        settings.reminder_email_from_name,
    )

    assert "Student Progress Update" in html
    assert "Hi Alice Parent," in html
    assert "fortnightly update that Alice Student has work due now" in html
    assert "Reminder Course (RC101)" in html
    assert "Essay Draft | due" in html
    assert "Weekly Quiz | due" in html


def test_school_html_template_renders_student_blocks():
    scheduled_for = _scheduled_slot()
    alice_task = _task(student_name="Alice Student", assignment_name="Essay Draft")
    bob_task = _task(student_name="Bob Student", assignment_name="Weekly Quiz")
    html = render_school_html(
        "School Rep",
        [
            (alice_task, [alice_task]),
            (bob_task, [bob_task]),
        ],
        scheduled_for,
        settings.reminder_email_from_name,
    )

    assert "Missing Work Summary" in html
    assert "Dear School Rep," in html
    assert "Alice Student" in html
    assert "Bob Student" in html
    assert "Students who have no missing due-now work are not included in this summary." in html


def test_smtp_sender_adds_plain_text_and_html_parts():
    sent_messages = []

    class FakeSMTP:
        def __init__(self, host, port, timeout):
            assert host == "smtp.example.com"
            assert port == 587
            assert timeout == 30

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def starttls(self):
            return None

        def login(self, username, password):
            assert username == "smtp-user"
            assert password == "smtp-pass"

        def send_message(self, message):
            sent_messages.append(message)
            return {}

    sender = SmtpEmailSender()
    with patch.object(settings, "reminder_email_from_address", "noreply@example.com"), \
         patch.object(settings, "reminder_email_from_name", "Kings Track"), \
         patch.object(settings, "reminder_smtp_host", "smtp.example.com"), \
         patch.object(settings, "reminder_smtp_port", 587), \
         patch.object(settings, "reminder_smtp_timeout_seconds", 30), \
         patch.object(settings, "reminder_smtp_starttls", True), \
         patch.object(settings, "reminder_smtp_use_ssl", False), \
         patch.object(settings, "reminder_smtp_username", "smtp-user"), \
         patch.object(settings, "reminder_smtp_password", "smtp-pass"), \
         patch("app.reminders.email.smtplib.SMTP", FakeSMTP):
        result = sender._send_sync(
            EmailSendRequest(
                to_email="alice@example.com",
                subject="Test subject",
                text_body="Plain text body",
                html_body="<html><body><p>HTML body</p></body></html>",
            )
        )

    assert result.status == "sent"
    assert len(sent_messages) == 1
    message = sent_messages[0]
    assert message.is_multipart() is True
    assert message.get_body(preferencelist=("plain",)).get_content().strip() == "Plain text body"
    assert "HTML body" in message.get_body(preferencelist=("html",)).get_content()


def test_preview_endpoint_and_run_history(app_client):
    _seed_base_course()
    slot = _scheduled_slot()
    sender = FakeEmailSender()

    with patch("app.api.routes.reminders_admin.reminder_engine.preview") as preview_mock:
        preview_mock.return_value = {
            "scheduled_for": slot.isoformat(),
            "student_recipient_count": 2,
            "guardian_recipient_count": 0,
            "school_recipient_count": 0,
            "delivery_count": 2,
            "deliveries": [],
        }
        preview_response = app_client.post(
            "/api/admin/reminders/run",
            json={"scheduled_for": slot.isoformat(), "preview_only": True},
        )

    assert preview_response.status_code == 200
    assert preview_response.json()["delivery_count"] == 2

    with patch("app.reminders.service.build_email_sender", return_value=sender):
        run_response = app_client.post(
            "/api/admin/reminders/run",
            json={"scheduled_for": slot.isoformat(), "preview_only": False},
        )

    assert run_response.status_code == 200
    assert run_response.json()["run_id"] >= 1

    runs_response = app_client.get("/api/admin/reminders/runs")
    assert runs_response.status_code == 200
    runs = runs_response.json()
    assert runs[0]["delivery_count"] == 2
    assert runs[0]["sent_count"] == 2
