from sqlalchemy import BigInteger, String, Float, DateTime, Boolean, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from datetime import datetime

from app.db import Base


class Submission(Base):
    __tablename__ = "submissions"
    __table_args__ = (UniqueConstraint("assignment_id", "user_id", name="uq_submission"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)  # Canvas submission ID
    assignment_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("assignments.id"), index=True)
    user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"), index=True)
    course_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("courses.id"), index=True)
    score: Mapped[float | None] = mapped_column(Float)
    grade: Mapped[str | None] = mapped_column(String)
    workflow_state: Mapped[str | None] = mapped_column(String)  # submitted, graded, unsubmitted, pending_review
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    graded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    late: Mapped[bool] = mapped_column(Boolean, default=False)
    missing: Mapped[bool] = mapped_column(Boolean, default=False)
    excused: Mapped[bool | None] = mapped_column(Boolean)
    attempt: Mapped[int | None] = mapped_column(BigInteger)
    synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
