from __future__ import annotations

import re
from collections import OrderedDict

from app.gradeo.types import GradeoExamAggregate, GradeoExamSummaryRow, GradeoQuestionRow


def gradeo_assignment_key(*, gradeo_marking_session_id: str | None, gradeo_exam_session_id: str | None, gradeo_exam_id: str) -> str:
    return gradeo_marking_session_id or gradeo_exam_session_id or gradeo_exam_id


def parse_optional_float(value) -> float | None:
    if value in (None, "", "-", "—"):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value).strip().replace("%", "")
    if not text:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def parse_bool(value) -> bool:
    if isinstance(value, bool):
        return value
    text = str(value or "").strip().lower()
    return text in {"yes", "true", "1", "submitted"}


def split_multi_value(value) -> list[str]:
    if value in (None, ""):
        return []
    if isinstance(value, list):
        items = value
    else:
        items = re.split(r"\s*,\s*", str(value))
    seen: OrderedDict[str, None] = OrderedDict()
    for item in items:
        cleaned = str(item).strip()
        if cleaned:
            seen[cleaned] = None
    return list(seen.keys())


def normalize_match_key(value: str | None) -> str:
    return re.sub(r"[^a-z0-9]+", "", (value or "").strip().lower())


def aggregate_exam_rows(rows: list[GradeoQuestionRow]) -> list[GradeoExamAggregate]:
    grouped: OrderedDict[str, list[GradeoQuestionRow]] = OrderedDict()
    for row in rows:
        grouped.setdefault(
            gradeo_assignment_key(
                gradeo_marking_session_id=row.gradeo_marking_session_id,
                gradeo_exam_session_id=row.gradeo_exam_session_id,
                gradeo_exam_id=row.gradeo_exam_id,
            ),
            [],
        ).append(row)

    aggregates: list[GradeoExamAggregate] = []
    for exam_rows in grouped.values():
        first = exam_rows[0]
        submitted_rows = [row for row in exam_rows if row.answer_submitted]
        unmarked_rows = [
            row for row in exam_rows
            if row.answer_submitted and row.mark is None and (row.marks_available is None or row.marks_available > 0)
        ]
        if not submitted_rows:
            status = "not_submitted"
        elif unmarked_rows:
            status = "awaiting_marking"
        else:
            status = "scored"

        marks_available = sum(row.marks_available or 0 for row in exam_rows) or None
        exam_mark = first_non_null(row.exam_mark for row in exam_rows)
        if exam_mark is None and status == "scored":
            exam_mark = sum(row.mark or 0 for row in exam_rows)

        aggregates.append(
            GradeoExamAggregate(
                gradeo_exam_id=first.gradeo_exam_id,
                gradeo_exam_session_id=first.gradeo_exam_session_id,
                gradeo_marking_session_id=first.gradeo_marking_session_id,
                gradeo_class_id=first.gradeo_class_id,
                exam_name=first.exam_name,
                class_name=first.class_name,
                class_average=first_non_null(row.class_average for row in exam_rows),
                exam_mark=exam_mark,
                marks_available=marks_available,
                syllabus_id=first_non_empty(row.syllabus_id for row in exam_rows),
                syllabus_title=first_non_empty(row.syllabus_title for row in exam_rows),
                syllabus_grade=first_non_empty(row.syllabus_grade for row in exam_rows),
                bands=merge_multi_values(row.bands for row in exam_rows),
                outcomes=merge_multi_values(row.outcomes for row in exam_rows),
                topics=merge_multi_values(row.topics for row in exam_rows),
                status=status,
                answer_submitted_count=len(submitted_rows),
                unmarked_question_count=len(unmarked_rows),
                question_rows=exam_rows,
            )
        )

    return aggregates


def aggregate_exam_summaries(rows: list[GradeoExamSummaryRow]) -> list[GradeoExamAggregate]:
    aggregates: list[GradeoExamAggregate] = []
    for row in rows:
        aggregates.append(
            GradeoExamAggregate(
                gradeo_exam_id=row.gradeo_exam_id,
                gradeo_exam_session_id=row.gradeo_exam_session_id,
                gradeo_marking_session_id=row.gradeo_marking_session_id,
                gradeo_class_id=row.gradeo_class_id,
                exam_name=row.exam_name,
                class_name=row.class_name,
                class_average=row.class_average,
                exam_mark=row.exam_mark,
                marks_available=row.marks_available,
                syllabus_id=row.syllabus_id,
                syllabus_title=row.syllabus_title,
                syllabus_grade=row.syllabus_grade,
                bands=row.bands,
                outcomes=row.outcomes,
                topics=row.topics,
                status=row.status,
                answer_submitted_count=1 if row.answer_submitted else 0,
                unmarked_question_count=1 if row.status == "awaiting_marking" else 0,
                question_rows=[],
            )
        )

    return aggregates


def first_non_null(values) -> float | None:
    for value in values:
        if value is not None:
            return value
    return None


def first_non_empty(values) -> str | None:
    for value in values:
        if value:
            return value
    return None


def merge_multi_values(sequences) -> list[str]:
    merged: OrderedDict[str, None] = OrderedDict()
    for seq in sequences:
        for item in seq:
            merged[item] = None
    return list(merged.keys())
