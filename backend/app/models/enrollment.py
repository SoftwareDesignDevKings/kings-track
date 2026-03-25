from sqlalchemy import BigInteger, String, Float, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from datetime import datetime

from app.db import Base


class Enrollment(Base):
    __tablename__ = "enrollments"
    __table_args__ = (UniqueConstraint("course_id", "user_id", "role", name="uq_enrollment"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)  # Canvas enrollment ID
    course_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("courses.id"), index=True)
    user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"), index=True)
    role: Mapped[str | None] = mapped_column(String)  # StudentEnrollment, TeacherEnrollment
    enrollment_state: Mapped[str | None] = mapped_column(String)  # active, invited, completed
    last_activity_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    current_score: Mapped[float | None] = mapped_column(Float)
    current_grade: Mapped[str | None] = mapped_column(String)
    final_score: Mapped[float | None] = mapped_column(Float)
    final_grade: Mapped[str | None] = mapped_column(String)

    # Relationships
    course: Mapped["Course"] = relationship(back_populates="enrollments")
    user: Mapped["User"] = relationship(back_populates="enrollments")
