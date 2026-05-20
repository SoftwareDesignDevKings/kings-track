from datetime import datetime

from sqlalchemy import BigInteger, DateTime, Integer, String, Text, text
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class GradeoImportRun(Base):
    __tablename__ = "gradeo_import_runs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    run_type: Mapped[str] = mapped_column(String, nullable=False, index=True)
    status: Mapped[str] = mapped_column(String, nullable=False, index=True)
    canvas_course_id: Mapped[int | None] = mapped_column(BigInteger, index=True)
    gradeo_class_id: Mapped[str | None] = mapped_column(String, index=True)
    gradeo_class_name: Mapped[str | None] = mapped_column(String)
    triggered_by: Mapped[str | None] = mapped_column(String)
    source_type: Mapped[str | None] = mapped_column(String)
    extension_version: Mapped[str | None] = mapped_column(String)
    processed_students: Mapped[int] = mapped_column(Integer, default=0, server_default=text("0"), nullable=False)
    matched_students: Mapped[int] = mapped_column(Integer, default=0, server_default=text("0"), nullable=False)
    imported_exams: Mapped[int] = mapped_column(Integer, default=0, server_default=text("0"), nullable=False)
    imported_question_results: Mapped[int] = mapped_column(Integer, default=0, server_default=text("0"), nullable=False)
    unmatched_students: Mapped[int] = mapped_column(Integer, default=0, server_default=text("0"), nullable=False)
    skipped_students: Mapped[int] = mapped_column(Integer, default=0, server_default=text("0"), nullable=False)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    error_message: Mapped[str | None] = mapped_column(Text)
