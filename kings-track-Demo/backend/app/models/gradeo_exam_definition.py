from datetime import datetime

from sqlalchemy import Boolean, DateTime, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class GradeoExamDefinition(Base):
    __tablename__ = "gradeo_exam_definitions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    gradeo_exam_id: Mapped[str] = mapped_column(String, unique=True, index=True)
    title: Mapped[str] = mapped_column(String, nullable=False)
    syllabus_id: Mapped[str | None] = mapped_column(String, index=True)
    syllabus_title: Mapped[str | None] = mapped_column(String)
    syllabus_grade: Mapped[str | None] = mapped_column(String)
    publish_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    is_published: Mapped[bool | None] = mapped_column(Boolean)
    discovered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
