from __future__ import annotations

from typing import Protocol
from urllib.parse import urlparse

from app.gradeo.normalizer import parse_bool, parse_optional_float, split_multi_value
from app.gradeo.types import GradeoExamSummaryRow, GradeoImportBatch, GradeoQuestionRow, GradeoStudentImport


class GradeoSourceAdapter(Protocol):
    source_name: str

    def to_import_batch(self, gradeo_class_id: str, gradeo_class_name: str, extension_version: str | None, students: list[dict]) -> GradeoImportBatch:
        ...


class ExtensionGradeoSourceAdapter:
    source_name = "extension"

    @staticmethod
    def _coerce_text(value: object | None) -> str | None:
        text = str(value or "").strip()
        return text or None

    @classmethod
    def _infer_marking_session_id(cls, row: dict) -> str | None:
        explicit = cls._coerce_text(row.get("gradeo_marking_session_id"))
        if explicit:
            return explicit
        link = cls._coerce_text(row.get("marking_session_link"))
        if not link:
            return None
        parsed = urlparse(link)
        parts = [part for part in parsed.path.split("/") if part]
        return parts[-1] if parts else None

    def to_import_batch(
        self,
        gradeo_class_id: str,
        gradeo_class_name: str,
        extension_version: str | None,
        students: list[dict],
    ) -> GradeoImportBatch:
        return GradeoImportBatch(
            gradeo_class_id=gradeo_class_id,
            gradeo_class_name=gradeo_class_name,
            source_type=self.source_name,
            extension_version=extension_version,
            students=[
                GradeoStudentImport(
                    gradeo_student_id=item["gradeo_student_id"],
                    student_name=item["student_name"],
                    rows=[
                        GradeoQuestionRow(
                            exam_name=row["exam_name"],
                            gradeo_exam_id=row["gradeo_exam_id"],
                            gradeo_exam_session_id=self._coerce_text(row.get("gradeo_exam_session_id")),
                            gradeo_marking_session_id=self._infer_marking_session_id(row),
                            gradeo_class_id=self._coerce_text(row.get("gradeo_class_id")) or gradeo_class_id,
                            class_name=row.get("class_name"),
                            class_average=parse_optional_float(row.get("class_average")),
                            syllabus_id=self._coerce_text(row.get("syllabus_id")),
                            question=row.get("question"),
                            gradeo_question_id=row.get("gradeo_question_id"),
                            question_part=row.get("question_part"),
                            gradeo_question_part_id=row["gradeo_question_part_id"],
                            question_link=row.get("question_link"),
                            mark=parse_optional_float(row.get("mark")),
                            marks_available=parse_optional_float(row.get("marks_available")),
                            answer_submitted=parse_bool(row.get("answer_submitted")),
                            feedback=row.get("feedback"),
                            marker_name=row.get("marker_name"),
                            marker_id=row.get("marker_id"),
                            marking_session_link=row.get("marking_session_link"),
                            exam_mark=parse_optional_float(row.get("exam_mark")),
                            syllabus_title=row.get("syllabus_title"),
                            syllabus_grade=row.get("syllabus_grade"),
                            bands=split_multi_value(row.get("bands")),
                            outcomes=split_multi_value(row.get("outcomes")),
                            topics=split_multi_value(row.get("topics")),
                            copyright_notice=row.get("copyright_notice"),
                        )
                        for row in item.get("rows", [])
                    ],
                    exam_rows=[
                        GradeoExamSummaryRow(
                            exam_name=row["exam_name"],
                            gradeo_exam_id=row["gradeo_exam_id"],
                            gradeo_exam_session_id=self._coerce_text(row.get("gradeo_exam_session_id")),
                            gradeo_marking_session_id=self._coerce_text(row.get("gradeo_marking_session_id")),
                            gradeo_class_id=self._coerce_text(row.get("gradeo_class_id")) or gradeo_class_id,
                            class_name=row.get("class_name"),
                            class_average=parse_optional_float(row.get("class_average")),
                            exam_mark=parse_optional_float(row.get("exam_mark")),
                            marks_available=parse_optional_float(row.get("marks_available")),
                            status=str(row.get("status") or "not_submitted").strip() or "not_submitted",
                            answer_submitted=parse_bool(row.get("answer_submitted")),
                            syllabus_id=self._coerce_text(row.get("syllabus_id")),
                            syllabus_title=row.get("syllabus_title"),
                            syllabus_grade=row.get("syllabus_grade"),
                            bands=split_multi_value(row.get("bands")),
                            outcomes=split_multi_value(row.get("outcomes")),
                            topics=split_multi_value(row.get("topics")),
                            marking_session_id=row.get("marking_session_id"),
                            exam_answer_sheet_id=row.get("exam_answer_sheet_id"),
                            exam_session_start_date=row.get("exam_session_start_date"),
                            exam_session_max_time_seconds=parse_optional_float(row.get("exam_session_max_time_seconds")),
                            student_group_mark_average=parse_optional_float(row.get("student_group_mark_average")),
                        )
                        for row in item.get("exam_rows", [])
                    ],
                )
                for item in students
            ],
        )


extension_source_adapter = ExtensionGradeoSourceAdapter()
