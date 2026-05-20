from datetime import datetime

from sqlalchemy import BigInteger, DateTime, Float, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class GradeoAssignmentResult(Base):
    __tablename__ = "gradeo_assignment_results"
    __table_args__ = (
        UniqueConstraint("gradeo_class_exam_assignment_id", "gradeo_student_id", name="uq_gradeo_assignment_result"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    gradeo_class_exam_assignment_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("gradeo_class_exam_assignments.id"),
        index=True,
    )
    gradeo_student_id: Mapped[str] = mapped_column(String, ForeignKey("gradeo_students.gradeo_student_id"), index=True)
    canvas_course_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("courses.id"), index=True)
    user_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("users.id"), index=True)
    student_name: Mapped[str] = mapped_column(String, nullable=False)
    status: Mapped[str] = mapped_column(String, nullable=False)
    exam_mark: Mapped[float | None] = mapped_column(Float)
    marks_available: Mapped[float | None] = mapped_column(Float)
    class_average: Mapped[float | None] = mapped_column(Float)
    answer_submitted_count: Mapped[int] = mapped_column(Integer, default=0)
    unmarked_question_count: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_imported_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
