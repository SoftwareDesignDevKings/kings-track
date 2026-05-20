from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class GradeoQuestionResult(Base):
    __tablename__ = "gradeo_question_results"
    __table_args__ = (
        UniqueConstraint(
            "gradeo_exam_id",
            "gradeo_student_id",
            "gradeo_question_part_id",
            name="uq_gradeo_question_result",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    gradeo_exam_id: Mapped[str] = mapped_column(String, ForeignKey("gradeo_exams.gradeo_exam_id"), index=True)
    gradeo_student_id: Mapped[str] = mapped_column(String, ForeignKey("gradeo_students.gradeo_student_id"), index=True)
    gradeo_question_id: Mapped[str | None] = mapped_column(String)
    gradeo_question_part_id: Mapped[str] = mapped_column(String, index=True)
    copyright_notice: Mapped[str | None] = mapped_column(String)
    question: Mapped[str | None] = mapped_column(String)
    question_part: Mapped[str | None] = mapped_column(String)
    question_link: Mapped[str | None] = mapped_column(Text)
    mark: Mapped[float | None] = mapped_column(Float)
    marks_available: Mapped[float | None] = mapped_column(Float)
    answer_submitted: Mapped[bool] = mapped_column(Boolean, default=False)
    feedback: Mapped[str | None] = mapped_column(Text)
    marker_name: Mapped[str | None] = mapped_column(String)
    marker_id: Mapped[str | None] = mapped_column(String)
    marking_session_link: Mapped[str | None] = mapped_column(Text)
    last_imported_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
