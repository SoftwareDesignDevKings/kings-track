from sqlalchemy import BigInteger, String, Integer, DateTime
from sqlalchemy.orm import Mapped, mapped_column, relationship
from datetime import datetime

from app.db import Base


class Course(Base):
    __tablename__ = "courses"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)  # Canvas course ID
    name: Mapped[str] = mapped_column(String, nullable=False)
    course_code: Mapped[str | None] = mapped_column(String)
    workflow_state: Mapped[str | None] = mapped_column(String)  # available, completed, etc.
    account_id: Mapped[int | None] = mapped_column(BigInteger)
    term_id: Mapped[int | None] = mapped_column(BigInteger)
    total_students: Mapped[int] = mapped_column(Integer, default=0)
    synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # Relationships (for future use)
    enrollments: Mapped[list["Enrollment"]] = relationship(back_populates="course")
    assignments: Mapped[list["Assignment"]] = relationship(back_populates="course")
