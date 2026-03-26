from sqlalchemy import BigInteger, Integer, String, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func
from datetime import datetime

from app.db import Base


class EdStemCourseMapping(Base):
    __tablename__ = "edstem_course_mappings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    canvas_course_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("courses.id"), unique=True, nullable=False)
    edstem_course_id: Mapped[int] = mapped_column(Integer, nullable=False)
    edstem_course_name: Mapped[str | None] = mapped_column(String)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
