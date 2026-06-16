from datetime import datetime

from sqlalchemy import BigInteger, DateTime, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class TrackingScoreEvent(Base):
    __tablename__ = "tracking_score_events"
    __table_args__ = (
        Index(
            "ix_tracking_score_events_assignment_user_criterion_changed",
            "assignment_id",
            "user_id",
            "rubric_criterion_id",
            "changed_at",
        ),
        Index(
            "ix_tracking_score_events_assignment_user_changed",
            "assignment_id",
            "user_id",
            "changed_at",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    assignment_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("assignments.id"), nullable=False)
    snapshot_id: Mapped[int] = mapped_column(Integer, ForeignKey("tracking_snapshots.id"), nullable=False)
    user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"), nullable=False)
    rubric_criterion_id: Mapped[str] = mapped_column(String, ForeignKey("rubric_criteria.id"), nullable=False)
    previous_score: Mapped[int | None] = mapped_column(Integer, nullable=True)
    previous_comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    new_score: Mapped[int | None] = mapped_column(Integer, nullable=True)
    new_comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    changed_by_email: Mapped[str] = mapped_column(String, nullable=False)
    changed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
