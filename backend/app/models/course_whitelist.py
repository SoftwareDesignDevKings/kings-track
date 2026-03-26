from sqlalchemy import BigInteger, Integer, DateTime, ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column
from datetime import datetime

from app.db import Base


class CourseWhitelist(Base):
    __tablename__ = "course_whitelist"

    course_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("courses.id"), primary_key=True)
    added_by: Mapped[int | None] = mapped_column(Integer, ForeignKey("app_users.id"), nullable=True)
    added_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), server_default=func.now())
