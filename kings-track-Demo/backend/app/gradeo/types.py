from dataclasses import dataclass


@dataclass(slots=True)
class GradeoQuestionRow:
    exam_name: str
    gradeo_exam_id: str
    gradeo_exam_session_id: str | None
    gradeo_marking_session_id: str | None
    gradeo_class_id: str | None
    class_name: str | None
    class_average: float | None
    syllabus_id: str | None
    question: str | None
    gradeo_question_id: str | None
    question_part: str | None
    gradeo_question_part_id: str
    question_link: str | None
    mark: float | None
    marks_available: float | None
    answer_submitted: bool
    feedback: str | None
    marker_name: str | None
    marker_id: str | None
    marking_session_link: str | None
    exam_mark: float | None
    syllabus_title: str | None
    syllabus_grade: str | None
    bands: list[str]
    outcomes: list[str]
    topics: list[str]
    copyright_notice: str | None


@dataclass(slots=True)
class GradeoExamSummaryRow:
    exam_name: str
    gradeo_exam_id: str
    gradeo_exam_session_id: str | None
    gradeo_marking_session_id: str | None
    gradeo_class_id: str | None
    class_name: str | None
    class_average: float | None
    exam_mark: float | None
    marks_available: float | None
    status: str
    answer_submitted: bool
    syllabus_id: str | None
    syllabus_title: str | None
    syllabus_grade: str | None
    bands: list[str]
    outcomes: list[str]
    topics: list[str]
    marking_session_id: str | None = None
    exam_answer_sheet_id: str | None = None
    exam_session_start_date: str | None = None
    exam_session_max_time_seconds: float | None = None
    student_group_mark_average: float | None = None


@dataclass(slots=True)
class GradeoStudentImport:
    gradeo_student_id: str
    student_name: str
    rows: list[GradeoQuestionRow]
    exam_rows: list[GradeoExamSummaryRow]


@dataclass(slots=True)
class GradeoImportBatch:
    gradeo_class_id: str
    gradeo_class_name: str
    source_type: str
    extension_version: str | None
    students: list[GradeoStudentImport]


@dataclass(slots=True)
class GradeoExamAggregate:
    gradeo_exam_id: str
    gradeo_exam_session_id: str | None
    gradeo_marking_session_id: str | None
    gradeo_class_id: str | None
    exam_name: str
    class_name: str | None
    class_average: float | None
    exam_mark: float | None
    marks_available: float | None
    syllabus_id: str | None
    syllabus_title: str | None
    syllabus_grade: str | None
    bands: list[str]
    outcomes: list[str]
    topics: list[str]
    status: str
    answer_submitted_count: int
    unmarked_question_count: int
    question_rows: list[GradeoQuestionRow]
