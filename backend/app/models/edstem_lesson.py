from sqlalchemy import Integer, String, Boolean, DateTime
from sqlalchemy.orm import Mapped, mapped_column
from datetime import datetime

from app.db import Base


class EdStemLesson(Base):
    __tablename__ = "edstem_lessons"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)  # EdStem lesson ID, not autoincrement
    edstem_course_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    title: Mapped[str] = mapped_column(String, nullable=False)
    module_id: Mapped[int | None] = mapped_column(Integer)
    module_name: Mapped[str | None] = mapped_column(String)  # denormalized, like assignment_group_name
    lesson_type: Mapped[str | None] = mapped_column(String)  # python, postgres, html, etc.
    is_interactive: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    slide_count: Mapped[int | None] = mapped_column(Integer)
    position: Mapped[int | None] = mapped_column(Integer)  # ordering within module
    synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
