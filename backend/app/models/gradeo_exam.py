from datetime import datetime

from sqlalchemy import DateTime, Float, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class GradeoExam(Base):
    __tablename__ = "gradeo_exams"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    gradeo_exam_id: Mapped[str] = mapped_column(String, unique=True, index=True)
    gradeo_class_id: Mapped[str] = mapped_column(String, index=True)
    exam_name: Mapped[str] = mapped_column(String, nullable=False)
    class_name: Mapped[str | None] = mapped_column(String)
    class_average: Mapped[float | None] = mapped_column(Float)
    syllabus_title: Mapped[str | None] = mapped_column(String)
    syllabus_grade: Mapped[str | None] = mapped_column(String)
    bands: Mapped[str | None] = mapped_column(String)
    outcomes: Mapped[str | None] = mapped_column(String)
    topics: Mapped[str | None] = mapped_column(String)
    discovered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
