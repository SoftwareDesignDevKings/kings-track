from datetime import datetime

from sqlalchemy import DateTime, Integer, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class ReminderRun(Base):
    __tablename__ = "reminder_runs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    scheduled_for: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    triggered_by: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(Text, nullable=False)
    student_recipient_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    guardian_recipient_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    school_recipient_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    delivery_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
