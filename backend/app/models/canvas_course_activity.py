from sqlalchemy import BigInteger, Integer, Date, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from datetime import date

from app.db import Base


class CanvasCourseActivity(Base):
    __tablename__ = "canvas_course_activity"
    __table_args__ = (UniqueConstraint("course_id", "date", name="uq_canvas_course_activity"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    course_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("courses.id"), index=True)
    date: Mapped[date] = mapped_column(Date, nullable=False)
    views: Mapped[int | None] = mapped_column(Integer)
    participations: Mapped[int | None] = mapped_column(Integer)
