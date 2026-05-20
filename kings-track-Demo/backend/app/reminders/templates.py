from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from html import escape
from typing import Protocol, Sequence

from app.config import settings
from app.reminders.schedule import to_local


class ReminderTaskLike(Protocol):
    course_id: int
    course_name: str
    course_code: str | None
    assignment_name: str
    due_at: datetime
    points_possible: float | None
    student_name: str


@dataclass(slots=True)
class ReminderCourseSection:
    title: str
    items: list[str]


def _format_due_label(value: datetime) -> str:
    local_value = to_local(value, settings.reminder_timezone)
    return local_value.strftime("%a %d %b %Y %I:%M %p")


def _format_course_heading(task: ReminderTaskLike) -> str:
    if task.course_code:
        return f"{task.course_name} ({task.course_code})"
    return task.course_name


def _format_task_line(task: ReminderTaskLike) -> str:
    due_label = _format_due_label(task.due_at)
    if task.points_possible is None:
        return f"{task.assignment_name} | due {due_label}"
    return f"{task.assignment_name} | due {due_label} | {task.points_possible:g} pts"


def _group_tasks_by_course(tasks: Sequence[ReminderTaskLike]) -> list[ReminderCourseSection]:
    grouped: dict[tuple[int, str, str | None], list[ReminderTaskLike]] = {}
    order: list[tuple[int, str, str | None]] = []
    for task in sorted(tasks, key=lambda item: (item.course_name.lower(), item.due_at, item.assignment_name.lower())):
        key = (task.course_id, task.course_name, task.course_code)
        if key not in grouped:
            grouped[key] = []
            order.append(key)
        grouped[key].append(task)

    sections: list[ReminderCourseSection] = []
    for key in order:
        course_tasks = grouped[key]
        sections.append(
            ReminderCourseSection(
                title=_format_course_heading(course_tasks[0]),
                items=[_format_task_line(task) for task in course_tasks],
            )
        )
    return sections


def render_student_text(student_name: str, tasks: Sequence[ReminderTaskLike], scheduled_for: datetime) -> str:
    scheduled_label = to_local(scheduled_for, settings.reminder_timezone).strftime("%a %d %b %Y")
    lines = [
        f"Hi {student_name},",
        "",
        f"You have missing work due now as of {scheduled_label}, and you need to complete it as soon as possible.",
        "",
    ]
    for section in _group_tasks_by_course(tasks):
        lines.append(section.title)
        lines.extend(f"- {item}" for item in section.items)
        lines.append("")
    if lines[-1] == "":
        lines.pop()
    lines.extend([
        "",
        "Complete these tasks in Canvas now. They will stop appearing in future reminders once they are done.",
    ])
    return "\n".join(lines)


def render_guardian_text(
    student_name: str,
    guardian_name: str | None,
    tasks: Sequence[ReminderTaskLike],
    scheduled_for: datetime,
) -> str:
    scheduled_label = to_local(scheduled_for, settings.reminder_timezone).strftime("%a %d %b %Y")
    greeting_name = guardian_name or "Parent/Guardian"
    lines = [
        f"Hi {greeting_name},",
        "",
        f"This is a fortnightly update that {student_name} has work due now that is still incomplete as of {scheduled_label}.",
        "",
    ]
    for section in _group_tasks_by_course(tasks):
        lines.append(section.title)
        lines.extend(f"- {item}" for item in section.items)
        lines.append("")
    if lines[-1] == "":
        lines.pop()
    lines.extend([
        "",
        "These items will drop out of future reminders once they are completed in Canvas.",
    ])
    return "\n".join(lines)


def render_school_text(
    contact_name: str | None,
    student_tasks: Sequence[tuple[ReminderTaskLike, Sequence[ReminderTaskLike]]],
    scheduled_for: datetime,
) -> str:
    scheduled_label = to_local(scheduled_for, settings.reminder_timezone).strftime("%a %d %b %Y")
    course_labels: list[str] = []
    for _, tasks in student_tasks:
        for task in tasks:
            course_label = _format_course_heading(task)
            if course_label not in course_labels:
                course_labels.append(course_label)

    if len(course_labels) == 1:
        course_summary = f"Here is the fortnightly summary of missing work due now for students in this course: {course_labels[0]}."
    else:
        course_summary = (
            "Here is the fortnightly summary of missing work due now for students in these courses: "
            + "; ".join(course_labels)
            + "."
        )

    lines = [
        f"Dear {contact_name or 'School Contact'},",
        "",
        f"As of {scheduled_label}, {course_summary}",
        "",
    ]

    for anchor_task, tasks in student_tasks:
        lines.append(anchor_task.student_name)
        for section in _group_tasks_by_course(tasks):
            lines.append(section.title)
            lines.extend(f"- {item}" for item in section.items)
            lines.append("")
        if lines[-1] == "":
            lines.pop()
        lines.append("")

    if lines[-1] == "":
        lines.pop()
    lines.extend([
        "",
        "Students who have no missing due-now work are not included in this summary.",
    ])
    return "\n".join(lines)


def _render_section_card_html(section: ReminderCourseSection) -> str:
    rows = "".join(
        f"""
          <tr>
            <td style="padding:0 0 10px 0;font-size:14px;line-height:21px;color:#334155;">
              {escape(item)}
            </td>
          </tr>
        """
        for item in section.items
    )
    return f"""
      <tr>
        <td style="padding:0 0 16px 0;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #e2e8f0;border-radius:14px;background-color:#ffffff;">
            <tr>
              <td style="padding:16px 18px 8px 18px;font-size:13px;font-weight:700;line-height:20px;color:#0f172a;border-bottom:1px solid #e2e8f0;background-color:#f8fafc;">
                {escape(section.title)}
              </td>
            </tr>
            <tr>
              <td style="padding:14px 18px 6px 18px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                  {rows}
                </table>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    """


def _render_student_block_html(student_name: str, tasks: Sequence[ReminderTaskLike]) -> str:
    sections_html = "".join(_render_section_card_html(section) for section in _group_tasks_by_course(tasks))
    return f"""
      <tr>
        <td style="padding:0 0 20px 0;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #cbd5e1;border-radius:16px;background-color:#ffffff;">
            <tr>
              <td style="padding:16px 18px;font-size:15px;font-weight:700;line-height:22px;color:#0f172a;border-bottom:1px solid #e2e8f0;background-color:#f8fafc;">
                {escape(student_name)}
              </td>
            </tr>
            <tr>
              <td style="padding:16px 18px 0 18px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                  {sections_html}
                </table>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    """


def _render_email_shell_html(
    *,
    brand_name: str,
    title: str,
    subtitle: str,
    greeting: str,
    intro: str,
    body_html: str,
    footer_note: str,
) -> str:
    return f"""\
<!DOCTYPE html>
<html lang="en">
  <body style="margin:0;padding:0;background-color:#e2e8f0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#e2e8f0;padding:24px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:680px;background-color:#ffffff;border-radius:20px;overflow:hidden;border:1px solid #cbd5e1;">
            <tr>
              <td style="padding:24px 28px;background:linear-gradient(135deg, #2f4ac0 0%, #3b5bdb 100%);">
                <div style="font-size:12px;line-height:18px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#dbeafe;">
                  {escape(brand_name)}
                </div>
                <div style="padding-top:8px;font-size:28px;line-height:34px;font-weight:700;color:#ffffff;">
                  {escape(title)}
                </div>
                <div style="padding-top:8px;font-size:14px;line-height:21px;color:#e0e7ff;">
                  {escape(subtitle)}
                </div>
              </td>
            </tr>
            <tr>
              <td style="padding:28px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td style="padding:0 0 12px 0;font-size:20px;line-height:28px;font-weight:700;color:#0f172a;">
                      {escape(greeting)}
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:0 0 22px 0;font-size:15px;line-height:24px;color:#475569;">
                      {escape(intro)}
                    </td>
                  </tr>
                  {body_html}
                  <tr>
                    <td style="padding:4px 0 0 0;">
                      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-radius:14px;background-color:#eff6ff;border:1px solid #bfdbfe;">
                        <tr>
                          <td style="padding:14px 16px;font-size:13px;line-height:20px;color:#1e3a8a;">
                            {escape(footer_note)}
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
"""


def render_student_html(
    student_name: str,
    tasks: Sequence[ReminderTaskLike],
    scheduled_for: datetime,
    brand_name: str,
) -> str:
    scheduled_label = to_local(scheduled_for, settings.reminder_timezone).strftime("%a %d %b %Y")
    sections_html = "".join(_render_section_card_html(section) for section in _group_tasks_by_course(tasks))
    return _render_email_shell_html(
        brand_name=brand_name,
        title="Missing Work Reminder",
        subtitle=f"As of {scheduled_label}",
        greeting=f"Hi {student_name},",
        intro=f"You have missing work due now as of {scheduled_label}, and you need to complete it as soon as possible.",
        body_html=sections_html,
        footer_note="Complete these tasks in Canvas now. They will stop appearing in future reminders once they are done.",
    )


def render_guardian_html(
    student_name: str,
    guardian_name: str | None,
    tasks: Sequence[ReminderTaskLike],
    scheduled_for: datetime,
    brand_name: str,
) -> str:
    scheduled_label = to_local(scheduled_for, settings.reminder_timezone).strftime("%a %d %b %Y")
    greeting_name = guardian_name or "Parent/Guardian"
    sections_html = "".join(_render_section_card_html(section) for section in _group_tasks_by_course(tasks))
    return _render_email_shell_html(
        brand_name=brand_name,
        title="Student Progress Update",
        subtitle=f"As of {scheduled_label}",
        greeting=f"Hi {greeting_name},",
        intro=f"This is a fortnightly update that {student_name} has work due now that is still incomplete as of {scheduled_label}.",
        body_html=sections_html,
        footer_note="These items will drop out of future reminders once they are completed in Canvas.",
    )


def render_school_html(
    contact_name: str | None,
    student_tasks: Sequence[tuple[ReminderTaskLike, Sequence[ReminderTaskLike]]],
    scheduled_for: datetime,
    brand_name: str,
) -> str:
    scheduled_label = to_local(scheduled_for, settings.reminder_timezone).strftime("%a %d %b %Y")
    course_labels: list[str] = []
    for _, tasks in student_tasks:
        for task in tasks:
            course_label = _format_course_heading(task)
            if course_label not in course_labels:
                course_labels.append(course_label)

    if len(course_labels) == 1:
        intro = f"As of {scheduled_label}, here is the fortnightly summary of missing work due now for students in this course: {course_labels[0]}."
    else:
        intro = (
            f"As of {scheduled_label}, here is the fortnightly summary of missing work due now for students in these courses: "
            + "; ".join(course_labels)
            + "."
        )

    student_blocks_html = "".join(
        _render_student_block_html(anchor_task.student_name, tasks)
        for anchor_task, tasks in student_tasks
    )
    return _render_email_shell_html(
        brand_name=brand_name,
        title="Missing Work Summary",
        subtitle=f"As of {scheduled_label}",
        greeting=f"Dear {contact_name or 'School Contact'},",
        intro=intro,
        body_html=student_blocks_html,
        footer_note="Students who have no missing due-now work are not included in this summary.",
    )
