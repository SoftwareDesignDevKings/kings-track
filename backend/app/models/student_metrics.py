from sqlalchemy import BigInteger, Float, String, DateTime, Integer, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from datetime import datetime

from app.db import Base


class StudentMetrics(Base):
    """
    Pre-computed per-student per-course metrics. Recalculated after each sync.
    Extendible for future phases: risk_score, engagement_tier, participation_index, etc.
    """
    __tablename__ = "student_metrics"
    __table_args__ = (UniqueConstraint("course_id", "user_id", name="uq_student_metrics"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    course_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("courses.id"), index=True)
    user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"), index=True)

    # Phase 1 metrics
    completion_rate: Mapped[float | None] = mapped_column(Float)   # submitted / total_assigned
    on_time_rate: Mapped[float | None] = mapped_column(Float)      # on-time / submitted
    current_score: Mapped[float | None] = mapped_column(Float)
    current_grade: Mapped[str | None] = mapped_column(String)
    computed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # Phase 2+ (reserved columns — add via migration when needed):
    # risk_score: float
    # engagement_tier: str  # low / medium / high
    # tardiness_rate: float
    # missing_rate: float
    # days_since_active: int
    # grade_trend: str  # improving / declining / stable
    # participation_index: float
