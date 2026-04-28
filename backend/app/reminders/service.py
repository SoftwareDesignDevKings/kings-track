from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy import text
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.config import settings
from app.db import AsyncSessionLocal
from app.models.reminder_delivery import ReminderDelivery
from app.models.reminder_run import ReminderRun
from app.reminders.email import EmailSendRequest, build_email_sender
from app.reminders.schedule import (
    ensure_aware_utc,
    is_due_for_reminder,
    most_recent_sunday_slot,
    start_of_tomorrow_utc,
    to_local,
)
from app.reminders.templates import (
    render_guardian_html,
    render_guardian_text,
    render_school_html,
    render_school_text,
    render_student_html,
    render_student_text,
)

logger = logging.getLogger(__name__)

COMPLETED_WORKFLOW_STATES = ("graded", "submitted", "pending_review")


@dataclass(slots=True)
class MissingTask:
    user_id: int
    student_name: str
    student_email: str | None
    course_id: int
    course_name: str
    course_code: str | None
    assignment_id: int
    assignment_name: str
    due_at: datetime
    points_possible: float | None
    school_id: int | None
    school_name: str | None


@dataclass(slots=True)
class RecipientPayload:
    recipient_type: str
    recipient_id: str
    email: str | None
    subject: str
    text_body: str
    html_body: str | None
    item_count: int
    user_id: int | None = None
    school_id: int | None = None


def _to_iso(value: datetime | None) -> str | None:
    if value is None:
        return None
    return ensure_aware_utc(value).isoformat()


def _build_test_recipient_payloads(tasks: list[MissingTask], scheduled_for: datetime) -> list[RecipientPayload]:
    if not tasks:
        return []

    ordered_tasks = sorted(tasks, key=lambda item: (item.student_name.lower(), item.course_name.lower(), item.due_at, item.assignment_name.lower()))
    anchor = ordered_tasks[0]
    student_tasks = [task for task in ordered_tasks if task.user_id == anchor.user_id and task.course_id == anchor.course_id]
    course_tasks = [task for task in ordered_tasks if task.course_id == anchor.course_id]
    scheduled_label = to_local(scheduled_for, settings.reminder_timezone).strftime("%d %b %Y")
    school_name = anchor.school_name or anchor.course_name or "School"
    recipient_email = settings.reminder_test_recipient_email
    school_student_blocks: list[tuple[MissingTask, list[MissingTask]]] = []
    course_tasks_by_student: dict[int, list[MissingTask]] = {}

    for task in course_tasks:
        course_tasks_by_student.setdefault(task.user_id, []).append(task)

    for grouped_student_tasks in sorted(course_tasks_by_student.values(), key=lambda item: item[0].student_name.lower()):
        school_student_blocks.append((grouped_student_tasks[0], grouped_student_tasks))

    brand_name = settings.reminder_email_from_name or "Kings Track"
    return [
        RecipientPayload(
            recipient_type="student",
            recipient_id=f"test-student-{anchor.user_id}",
            email=recipient_email,
            subject=f"[TEST student] Missing work due now - {len(student_tasks)} item(s) - {scheduled_label}",
            text_body=render_student_text(anchor.student_name, student_tasks, scheduled_for),
            html_body=render_student_html(anchor.student_name, student_tasks, scheduled_for, brand_name),
            item_count=len(student_tasks),
            user_id=anchor.user_id,
        ),
        RecipientPayload(
            recipient_type="guardian",
            recipient_id=f"test-guardian-{anchor.user_id}",
            email=recipient_email,
            subject=f"[TEST parent] Update on {anchor.student_name}'s missing work - {scheduled_label}",
            text_body=render_guardian_text(anchor.student_name, "Parent/Guardian", student_tasks, scheduled_for),
            html_body=render_guardian_html(anchor.student_name, "Parent/Guardian", student_tasks, scheduled_for, brand_name),
            item_count=len(student_tasks),
            user_id=anchor.user_id,
        ),
        RecipientPayload(
            recipient_type="school",
            recipient_id=f"test-school-{anchor.course_id}",
            email=recipient_email,
            subject=f"[TEST school] Missing work summary for {school_name} - {scheduled_label}",
            text_body=render_school_text("School Contact", school_student_blocks, scheduled_for),
            html_body=render_school_html("School Contact", school_student_blocks, scheduled_for, brand_name),
            item_count=sum(len(tasks) for _, tasks in school_student_blocks),
            school_id=anchor.school_id,
        ),
    ]


async def _fetch_missing_tasks_for_window(scheduled_for: datetime) -> list[MissingTask]:
    due_now_cutoff = start_of_tomorrow_utc(scheduled_for, settings.reminder_timezone)
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            text(
                """
                SELECT
                    u.id,
                    u.name,
                    u.email,
                    c.id,
                    c.name,
                    c.course_code,
                    a.id,
                    a.name,
                    a.due_at,
                    a.points_possible,
                    ssl.school_id,
                    s.name
                FROM course_whitelist cw
                JOIN courses c ON c.id = cw.course_id
                JOIN assignments a ON a.course_id = c.id
                JOIN enrollments e ON e.course_id = c.id AND e.role = 'StudentEnrollment'
                JOIN users u ON u.id = e.user_id
                LEFT JOIN submissions sub ON sub.assignment_id = a.id AND sub.user_id = u.id
                LEFT JOIN student_school_links ssl ON ssl.user_id = u.id
                LEFT JOIN schools s ON s.id = ssl.school_id
                WHERE c.workflow_state = 'available'
                  AND a.workflow_state = 'published'
                  AND a.due_at IS NOT NULL
                  AND a.due_at < :due_now_cutoff
                  AND COALESCE(sub.excused, false) = false
                  AND (
                    sub.id IS NULL
                    OR sub.workflow_state IS NULL
                    OR sub.workflow_state NOT IN ('graded', 'submitted', 'pending_review')
                  )
                ORDER BY u.name, c.name, a.due_at, a.name
                """
            ),
            {"due_now_cutoff": due_now_cutoff},
        )
        rows = result.fetchall()

    tasks = [
        MissingTask(
            user_id=row[0],
            student_name=row[1],
            student_email=row[2],
            course_id=row[3],
            course_name=row[4],
            course_code=row[5],
            assignment_id=row[6],
            assignment_name=row[7],
            due_at=ensure_aware_utc(row[8]),
            points_possible=row[9],
            school_id=row[10],
            school_name=row[11],
        )
        for row in rows
    ]
    return [
        task
        for task in tasks
        if is_due_for_reminder(task.due_at, scheduled_for, settings.reminder_timezone)
    ]


async def _fetch_guardian_contacts(user_ids: list[int]) -> dict[int, list[dict]]:
    if not user_ids:
        return {}
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            text(
                """
                SELECT id, user_id, name, email, relationship_label
                FROM guardian_contacts
                WHERE active = true
                  AND user_id = ANY(:user_ids)
                ORDER BY user_id, id
                """
            ),
            {"user_ids": user_ids},
        )
        rows = result.fetchall()

    contacts: dict[int, list[dict]] = {}
    for row in rows:
        contacts.setdefault(row[1], []).append(
            {
                "id": row[0],
                "user_id": row[1],
                "name": row[2],
                "email": row[3],
                "relationship_label": row[4],
            }
        )
    return contacts


async def _fetch_school_contacts(school_ids: list[int]) -> dict[int, list[dict]]:
    if not school_ids:
        return {}
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            text(
                """
                SELECT id, school_id, name, email, role_label
                FROM school_contacts
                WHERE active = true
                  AND school_id = ANY(:school_ids)
                ORDER BY school_id, id
                """
            ),
            {"school_ids": school_ids},
        )
        rows = result.fetchall()

    contacts: dict[int, list[dict]] = {}
    for row in rows:
        contacts.setdefault(row[1], []).append(
            {
                "id": row[0],
                "school_id": row[1],
                "name": row[2],
                "email": row[3],
                "role_label": row[4],
            }
        )
    return contacts


async def _build_recipient_payloads(scheduled_for: datetime) -> list[RecipientPayload]:
    tasks = await _fetch_missing_tasks_for_window(scheduled_for)
    if settings.reminder_test_mode_enabled:
        return _build_test_recipient_payloads(tasks, scheduled_for)

    by_student: dict[int, list[MissingTask]] = {}
    for task in tasks:
        by_student.setdefault(task.user_id, []).append(task)

    guardian_contacts = await _fetch_guardian_contacts(list(by_student))
    school_contacts = await _fetch_school_contacts(
        sorted({task.school_id for task in tasks if task.school_id is not None})
    )

    payloads: list[RecipientPayload] = []
    scheduled_label = to_local(scheduled_for, settings.reminder_timezone).strftime("%d %b %Y")
    brand_name = settings.reminder_email_from_name or "Kings Track"

    for user_id, student_tasks in sorted(by_student.items(), key=lambda item: item[1][0].student_name.lower()):
        anchor = student_tasks[0]
        subject = f"Missing work due now - {len(student_tasks)} item(s) - {scheduled_label}"
        payloads.append(
            RecipientPayload(
                recipient_type="student",
                recipient_id=str(user_id),
                email=anchor.student_email,
                subject=subject,
                text_body=render_student_text(anchor.student_name, student_tasks, scheduled_for),
                html_body=render_student_html(anchor.student_name, student_tasks, scheduled_for, brand_name),
                item_count=len(student_tasks),
                user_id=user_id,
            )
        )

        for guardian in guardian_contacts.get(user_id, []):
            payloads.append(
                RecipientPayload(
                    recipient_type="guardian",
                    recipient_id=str(guardian["id"]),
                    email=guardian["email"],
                    subject=f"Update on {anchor.student_name}'s missing work - {scheduled_label}",
                    text_body=render_guardian_text(anchor.student_name, guardian["name"], student_tasks, scheduled_for),
                    html_body=render_guardian_html(anchor.student_name, guardian["name"], student_tasks, scheduled_for, brand_name),
                    item_count=len(student_tasks),
                    user_id=user_id,
                )
            )

    students_by_school: dict[int, dict[int, list[MissingTask]]] = {}
    for user_id, student_tasks in by_student.items():
        school_id = student_tasks[0].school_id
        if school_id is None:
            continue
        students_by_school.setdefault(school_id, {})[user_id] = student_tasks

    for school_id, student_groups in sorted(students_by_school.items()):
        school_name = next(
            (
                group[0].school_name
                for group in student_groups.values()
                if group and group[0].school_name
            ),
            "School",
        )
        student_blocks = [
            (group[0], group)
            for group in sorted(student_groups.values(), key=lambda item: item[0].student_name.lower())
        ]
        for contact in school_contacts.get(school_id, []):
            payloads.append(
                RecipientPayload(
                    recipient_type="school",
                    recipient_id=str(contact["id"]),
                    email=contact["email"],
                    subject=f"Missing work summary for {school_name} - {scheduled_label}",
                    text_body=render_school_text(contact["name"], student_blocks, scheduled_for),
                    html_body=render_school_html(contact["name"], student_blocks, scheduled_for, brand_name),
                    item_count=sum(len(group) for group in student_groups.values()),
                    school_id=school_id,
                )
            )

    return payloads


def _status_rank(status: str) -> int:
    return {"failed": 2, "sent": 1, "skipped": 0}.get(status, 0)


class ReminderService:
    async def preview(self, reference_time: datetime | None = None) -> dict:
        scheduled_for = most_recent_sunday_slot(reference_time or datetime.now(timezone.utc), settings.reminder_timezone)
        payloads = await _build_recipient_payloads(scheduled_for)
        return {
            "scheduled_for": _to_iso(scheduled_for),
            "student_recipient_count": sum(1 for payload in payloads if payload.recipient_type == "student"),
            "guardian_recipient_count": sum(1 for payload in payloads if payload.recipient_type == "guardian"),
            "school_recipient_count": sum(1 for payload in payloads if payload.recipient_type == "school"),
            "delivery_count": len(payloads),
            "deliveries": [
                {
                    "recipient_type": payload.recipient_type,
                    "recipient_id": payload.recipient_id,
                    "email": payload.email,
                    "subject": payload.subject,
                    "item_count": payload.item_count,
                }
                for payload in payloads
            ],
        }

    async def get_latest_scheduled_for(self) -> datetime | None:
        async with AsyncSessionLocal() as db:
            result = await db.execute(text("SELECT MAX(scheduled_for) FROM reminder_runs"))
            value = result.scalar()
        return ensure_aware_utc(value) if value else None

    async def list_runs(self, limit: int = 20) -> list[dict]:
        async with AsyncSessionLocal() as db:
            result = await db.execute(
                text(
                    """
                    SELECT
                        rr.id,
                        rr.scheduled_for,
                        rr.triggered_by,
                        rr.status,
                        rr.student_recipient_count,
                        rr.guardian_recipient_count,
                        rr.school_recipient_count,
                        rr.delivery_count,
                        rr.started_at,
                        rr.completed_at,
                        rr.error_message,
                        COALESCE(SUM(CASE WHEN rd.status = 'sent' THEN 1 ELSE 0 END), 0) AS sent_count,
                        COALESCE(SUM(CASE WHEN rd.status = 'failed' THEN 1 ELSE 0 END), 0) AS failed_count,
                        COALESCE(SUM(CASE WHEN rd.status = 'skipped' THEN 1 ELSE 0 END), 0) AS skipped_count
                    FROM reminder_runs rr
                    LEFT JOIN reminder_deliveries rd ON rd.run_id = rr.id
                    GROUP BY rr.id
                    ORDER BY rr.id DESC
                    LIMIT :limit
                    """
                ),
                {"limit": limit},
            )
            rows = result.fetchall()

        return [
            {
                "id": row[0],
                "scheduled_for": _to_iso(row[1]),
                "triggered_by": row[2],
                "status": row[3],
                "student_recipient_count": row[4],
                "guardian_recipient_count": row[5],
                "school_recipient_count": row[6],
                "delivery_count": row[7],
                "started_at": _to_iso(row[8]),
                "completed_at": _to_iso(row[9]),
                "error_message": row[10],
                "sent_count": row[11],
                "failed_count": row[12],
                "skipped_count": row[13],
            }
            for row in rows
        ]

    async def run_for_reference(
        self,
        reference_time: datetime | None = None,
        triggered_by: str = "manual",
    ) -> dict:
        scheduled_for = most_recent_sunday_slot(reference_time or datetime.now(timezone.utc), settings.reminder_timezone)
        return await self.run_scheduled_window(scheduled_for, triggered_by=triggered_by)

    async def run_scheduled_window(self, scheduled_for: datetime, triggered_by: str = "scheduler") -> dict:
        scheduled_for = ensure_aware_utc(scheduled_for)
        payloads = await _build_recipient_payloads(scheduled_for)
        now = datetime.now(timezone.utc)

        async with AsyncSessionLocal() as db:
            run_result = await db.execute(
                text(
                    """
                    INSERT INTO reminder_runs (
                        scheduled_for,
                        triggered_by,
                        status,
                        student_recipient_count,
                        guardian_recipient_count,
                        school_recipient_count,
                        delivery_count,
                        started_at
                    )
                    VALUES (
                        :scheduled_for,
                        :triggered_by,
                        'started',
                        :student_recipient_count,
                        :guardian_recipient_count,
                        :school_recipient_count,
                        :delivery_count,
                        :started_at
                    )
                    RETURNING id
                    """
                ),
                {
                    "scheduled_for": scheduled_for,
                    "triggered_by": triggered_by,
                    "student_recipient_count": sum(1 for payload in payloads if payload.recipient_type == "student"),
                    "guardian_recipient_count": sum(1 for payload in payloads if payload.recipient_type == "guardian"),
                    "school_recipient_count": sum(1 for payload in payloads if payload.recipient_type == "school"),
                    "delivery_count": len(payloads),
                    "started_at": now,
                },
            )
            run_id = int(run_result.scalar())
            await db.commit()

        email_sender = build_email_sender()
        status_totals = {"sent": 0, "failed": 0, "skipped": 0}

        try:
            for payload in payloads:
                async with AsyncSessionLocal() as db:
                    existing_result = await db.execute(
                        text(
                            """
                            SELECT id, status
                            FROM reminder_deliveries
                            WHERE recipient_type = :recipient_type
                              AND recipient_id = :recipient_id
                              AND scheduled_for = :scheduled_for
                            """
                        ),
                        {
                            "recipient_type": payload.recipient_type,
                            "recipient_id": payload.recipient_id,
                            "scheduled_for": scheduled_for,
                        },
                    )
                    existing_row = existing_result.fetchone()

                if existing_row and existing_row[1] == "sent":
                    status_totals["skipped"] += 1
                    async with AsyncSessionLocal() as db:
                        stmt = pg_insert(ReminderDelivery).values(
                            run_id=run_id,
                            scheduled_for=scheduled_for,
                            recipient_type=payload.recipient_type,
                            recipient_id=payload.recipient_id,
                            user_id=payload.user_id,
                            school_id=payload.school_id,
                            email=payload.email,
                            status="sent",
                            subject=payload.subject,
                            body=payload.text_body,
                            item_count=payload.item_count,
                            attempted_at=now,
                            sent_at=now,
                            provider_response="already_sent_for_window",
                            error_message=None,
                        )
                        stmt = stmt.on_conflict_do_update(
                            index_elements=["recipient_type", "recipient_id", "scheduled_for"],
                            set_={
                                "run_id": run_id,
                                "subject": stmt.excluded.subject,
                                "body": stmt.excluded.body,
                                "item_count": stmt.excluded.item_count,
                                "provider_response": stmt.excluded.provider_response,
                                "attempted_at": stmt.excluded.attempted_at,
                            },
                        )
                        await db.execute(stmt)
                        await db.commit()
                    continue

                if not payload.email:
                    send_result = type("Result", (), {"status": "skipped", "provider_response": None, "error_message": "Recipient has no email address"})()
                else:
                    send_result = await email_sender.send_email(
                        EmailSendRequest(
                            to_email=payload.email,
                            subject=payload.subject,
                            text_body=payload.text_body,
                            html_body=payload.html_body,
                        )
                    )

                status_totals[send_result.status] += 1
                attempted_at = datetime.now(timezone.utc)
                sent_at = attempted_at if send_result.status == "sent" else None

                async with AsyncSessionLocal() as db:
                    stmt = pg_insert(ReminderDelivery).values(
                        run_id=run_id,
                        scheduled_for=scheduled_for,
                        recipient_type=payload.recipient_type,
                        recipient_id=payload.recipient_id,
                        user_id=payload.user_id,
                        school_id=payload.school_id,
                        email=payload.email,
                        status=send_result.status,
                        subject=payload.subject,
                        body=payload.text_body,
                        item_count=payload.item_count,
                        attempted_at=attempted_at,
                        sent_at=sent_at,
                        provider_response=send_result.provider_response,
                        error_message=send_result.error_message,
                    )
                    stmt = stmt.on_conflict_do_update(
                        index_elements=["recipient_type", "recipient_id", "scheduled_for"],
                        set_={
                            "run_id": stmt.excluded.run_id,
                            "email": stmt.excluded.email,
                            "status": stmt.excluded.status,
                            "subject": stmt.excluded.subject,
                            "body": stmt.excluded.body,
                            "item_count": stmt.excluded.item_count,
                            "attempted_at": stmt.excluded.attempted_at,
                            "sent_at": stmt.excluded.sent_at,
                            "provider_response": stmt.excluded.provider_response,
                            "error_message": stmt.excluded.error_message,
                        },
                    )
                    await db.execute(stmt)
                    await db.commit()

            run_status = "completed_with_errors" if status_totals["failed"] else "completed"
            async with AsyncSessionLocal() as db:
                await db.execute(
                    text(
                        """
                        UPDATE reminder_runs
                        SET status = :status,
                            completed_at = :completed_at
                        WHERE id = :run_id
                        """
                    ),
                    {
                        "status": run_status,
                        "completed_at": datetime.now(timezone.utc),
                        "run_id": run_id,
                    },
                )
                await db.commit()

        except Exception as exc:
            logger.exception("reminder_run_failed scheduled_for=%s triggered_by=%s", scheduled_for.isoformat(), triggered_by)
            async with AsyncSessionLocal() as db:
                await db.execute(
                    text(
                        """
                        UPDATE reminder_runs
                        SET status = 'failed',
                            completed_at = :completed_at,
                            error_message = :error_message
                        WHERE id = :run_id
                        """
                    ),
                    {
                        "completed_at": datetime.now(timezone.utc),
                        "error_message": str(exc),
                        "run_id": run_id,
                    },
                )
                await db.commit()
            raise

        return {
            "run_id": run_id,
            "scheduled_for": _to_iso(scheduled_for),
            "status": run_status,
            "student_recipient_count": sum(1 for payload in payloads if payload.recipient_type == "student"),
            "guardian_recipient_count": sum(1 for payload in payloads if payload.recipient_type == "guardian"),
            "school_recipient_count": sum(1 for payload in payloads if payload.recipient_type == "school"),
            "delivery_count": len(payloads),
            "sent_count": status_totals["sent"],
            "failed_count": status_totals["failed"],
            "skipped_count": status_totals["skipped"],
        }
