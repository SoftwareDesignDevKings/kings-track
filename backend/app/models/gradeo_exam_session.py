from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class GradeoExamSession(Base):
    __tablename__ = "gradeo_exam_sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    gradeo_exam_session_id: Mapped[str] = mapped_column(String, unique=True, index=True)
    gradeo_exam_id: Mapped[str] = mapped_column(String, ForeignKey("gradeo_exam_definitions.gradeo_exam_id"), index=True)
    start_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    end_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    discovered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
