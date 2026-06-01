from datetime import datetime

from sqlalchemy import BigInteger, DateTime, Float, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class RubricCriterion(Base):
    __tablename__ = "rubric_criteria"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    assignment_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("assignments.id"), index=True)
    description: Mapped[str] = mapped_column(String, nullable=False)
    long_description: Mapped[str | None] = mapped_column(String)
    points: Mapped[float | None] = mapped_column(Float)
    position: Mapped[int] = mapped_column(Integer, default=0)
    synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
