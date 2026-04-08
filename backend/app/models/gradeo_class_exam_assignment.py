from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class GradeoClassExamAssignment(Base):
    __tablename__ = "gradeo_class_exam_assignments"
    __table_args__ = (
        UniqueConstraint("gradeo_class_id", "gradeo_marking_session_id", name="uq_gradeo_class_exam_assignment"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    gradeo_class_id: Mapped[str] = mapped_column(String, ForeignKey("gradeo_classes.gradeo_class_id"), index=True)
    gradeo_marking_session_id: Mapped[str] = mapped_column(String, index=True)
    gradeo_exam_id: Mapped[str] = mapped_column(String, ForeignKey("gradeo_exam_definitions.gradeo_exam_id"), index=True)
    gradeo_exam_session_id: Mapped[str | None] = mapped_column(String, ForeignKey("gradeo_exam_sessions.gradeo_exam_session_id"), index=True)
    exam_name: Mapped[str] = mapped_column(String, nullable=False)
    class_name: Mapped[str | None] = mapped_column(String)
    class_average: Mapped[float | None] = mapped_column(Float)
    syllabus_id: Mapped[str | None] = mapped_column(String, index=True)
    syllabus_title: Mapped[str | None] = mapped_column(String)
    syllabus_grade: Mapped[str | None] = mapped_column(String)
    bands: Mapped[str | None] = mapped_column(String)
    outcomes: Mapped[str | None] = mapped_column(String)
    topics: Mapped[str | None] = mapped_column(String)
    discovered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
