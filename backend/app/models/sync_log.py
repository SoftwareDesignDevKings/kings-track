from sqlalchemy import BigInteger, String, Integer, DateTime, Text
from sqlalchemy.orm import Mapped, mapped_column
from datetime import datetime

from app.db import Base


class SyncLog(Base):
    __tablename__ = "sync_log"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    entity_type: Mapped[str] = mapped_column(String)   # courses | enrollments | assignments | submissions | metrics
    course_id: Mapped[int | None] = mapped_column(BigInteger)
    status: Mapped[str] = mapped_column(String)         # started | completed | failed
    records_synced: Mapped[int] = mapped_column(Integer, default=0)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    error_message: Mapped[str | None] = mapped_column(Text)
