from datetime import datetime

from sqlalchemy import BigInteger, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class GradeoClassMapping(Base):
    __tablename__ = "gradeo_class_mappings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    canvas_course_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("courses.id"), unique=True, index=True)
    gradeo_class_id: Mapped[str] = mapped_column(String, ForeignKey("gradeo_classes.gradeo_class_id"), unique=True, index=True)
    gradeo_class_name: Mapped[str] = mapped_column(String, nullable=False)
    created_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
