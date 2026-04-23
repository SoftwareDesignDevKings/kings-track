from sqlalchemy import BigInteger, String, Float, DateTime, Integer, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from datetime import datetime

from app.db import Base


class Assignment(Base):
    __tablename__ = "assignments"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)  # Canvas assignment ID
    course_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("courses.id"), index=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    assignment_group_name: Mapped[str | None] = mapped_column(String)  # e.g. "Classwork - Unit 1"
    assignment_group_id: Mapped[int | None] = mapped_column(BigInteger)
    assignment_group_position: Mapped[int | None] = mapped_column(Integer)
    points_possible: Mapped[float | None] = mapped_column(Float)
    due_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    unlock_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    position: Mapped[int | None] = mapped_column(Integer)  # for ordering within group
    workflow_state: Mapped[str | None] = mapped_column(String)  # published, unpublished
    submission_types: Mapped[str | None] = mapped_column(String)  # comma-joined list
    synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # Relationships
    course: Mapped["Course"] = relationship(back_populates="assignments")
