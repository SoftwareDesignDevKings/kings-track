from sqlalchemy import BigInteger, Integer, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from datetime import datetime

from app.db import Base


class CanvasEngagement(Base):
    __tablename__ = "canvas_engagement"
    __table_args__ = (UniqueConstraint("course_id", "user_id", name="uq_canvas_engagement"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    course_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("courses.id"), index=True)
    user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"), index=True)

    page_views: Mapped[int | None] = mapped_column(Integer)
    page_views_level: Mapped[int | None] = mapped_column(Integer)  # 0–3 Canvas bucket
    max_page_views: Mapped[int | None] = mapped_column(Integer)    # course max for relative display
    participations: Mapped[int | None] = mapped_column(Integer)
    participations_level: Mapped[int | None] = mapped_column(Integer)  # 0–3 Canvas bucket
    max_participations: Mapped[int | None] = mapped_column(Integer)

    # From tardiness_breakdown on student_summaries
    tardiness_on_time: Mapped[int | None] = mapped_column(Integer)
    tardiness_late: Mapped[int | None] = mapped_column(Integer)
    tardiness_missing: Mapped[int | None] = mapped_column(Integer)

    # From per-student activity endpoint
    last_page_view_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_participation_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
