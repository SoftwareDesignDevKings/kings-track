from sqlalchemy import BigInteger, Integer, String, Boolean, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from datetime import datetime

from app.db import Base


class EdStemLessonProgress(Base):
    __tablename__ = "edstem_lesson_progress"

    __table_args__ = (
        UniqueConstraint("edstem_lesson_id", "user_id", name="uq_edstem_lesson_progress"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    edstem_course_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    edstem_lesson_id: Mapped[int] = mapped_column(Integer, ForeignKey("edstem_lessons.id"), nullable=False)
    user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String, nullable=False)  # completed / viewed / not_started
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
