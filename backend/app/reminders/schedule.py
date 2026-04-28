from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo


REMINDER_SEND_TIME = time(hour=23, minute=59)


def get_timezone(timezone_name: str) -> ZoneInfo:
    return ZoneInfo(timezone_name)


def ensure_aware_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def to_local(value: datetime, timezone_name: str) -> datetime:
    return ensure_aware_utc(value).astimezone(get_timezone(timezone_name))


def build_local_datetime(day: date, clock_time: time, timezone_name: str) -> datetime:
    return datetime.combine(day, clock_time, tzinfo=get_timezone(timezone_name))


def reminder_slot_for_due_at(due_at: datetime, timezone_name: str) -> datetime:
    due_local = to_local(due_at, timezone_name)
    week_start = due_local.date() - timedelta(days=due_local.weekday())
    first_send_date = week_start + timedelta(days=13)
    return build_local_datetime(first_send_date, REMINDER_SEND_TIME, timezone_name).astimezone(timezone.utc)


def is_due_for_reminder(due_at: datetime, scheduled_for: datetime, timezone_name: str) -> bool:
    scheduled_local = to_local(scheduled_for, timezone_name)
    first_local = to_local(reminder_slot_for_due_at(due_at, timezone_name), timezone_name)

    if scheduled_local < first_local:
        return False
    if scheduled_local.timetz().replace(tzinfo=None) != REMINDER_SEND_TIME:
        return False

    delta_days = (scheduled_local.date() - first_local.date()).days
    return delta_days % 14 == 0


def start_of_tomorrow_utc(reference_time: datetime, timezone_name: str) -> datetime:
    reference_local = to_local(reference_time, timezone_name)
    tomorrow_local = build_local_datetime(reference_local.date() + timedelta(days=1), time.min, timezone_name)
    return tomorrow_local.astimezone(timezone.utc)


def most_recent_sunday_slot(reference_time: datetime, timezone_name: str) -> datetime:
    reference_local = to_local(reference_time, timezone_name)
    days_since_sunday = (reference_local.weekday() - 6) % 7
    slot_date = reference_local.date() - timedelta(days=days_since_sunday)
    slot_local = build_local_datetime(slot_date, REMINDER_SEND_TIME, timezone_name)
    if reference_local < slot_local:
        slot_local = build_local_datetime(slot_date - timedelta(days=7), REMINDER_SEND_TIME, timezone_name)
    return slot_local.astimezone(timezone.utc)


def list_due_windows(start_exclusive: datetime, end_inclusive: datetime, timezone_name: str) -> list[datetime]:
    start_local = to_local(start_exclusive, timezone_name)
    end_local = to_local(end_inclusive, timezone_name)

    if end_local <= start_local:
        return []

    cursor = start_local.date()
    windows: list[datetime] = []
    while cursor <= end_local.date():
        if cursor.weekday() == 6:
            slot_local = build_local_datetime(cursor, REMINDER_SEND_TIME, timezone_name)
            if start_local < slot_local <= end_local:
                windows.append(slot_local.astimezone(timezone.utc))
        cursor += timedelta(days=1)

    return windows
