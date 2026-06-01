from datetime import datetime

from sqlalchemy import BigInteger, DateTime, ForeignKey, Index, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class TrackingSnapshot(Base):
    __tablename__ = "tracking_snapshots"
    __table_args__ = (
        Index(
            "uq_one_draft_per_assignment",
            "assignment_id",
            unique=True,
            postgresql_where="committed_at IS NULL",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    assignment_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("assignments.id"), index=True)
    created_by_email: Mapped[str] = mapped_column(String, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    committed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    label: Mapped[str | None] = mapped_column(String)
