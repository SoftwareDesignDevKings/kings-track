from sqlalchemy import BigInteger, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class TrackingScore(Base):
    __tablename__ = "tracking_scores"
    __table_args__ = (
        UniqueConstraint("snapshot_id", "user_id", "rubric_criterion_id", name="uq_score_per_cell"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    snapshot_id: Mapped[int] = mapped_column(Integer, ForeignKey("tracking_snapshots.id"), index=True)
    user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"))
    rubric_criterion_id: Mapped[str] = mapped_column(String, ForeignKey("rubric_criteria.id"))
    score: Mapped[int] = mapped_column(Integer, nullable=False)
