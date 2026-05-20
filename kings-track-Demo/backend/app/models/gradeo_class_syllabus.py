from sqlalchemy import ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class GradeoClassSyllabus(Base):
    __tablename__ = "gradeo_class_syllabuses"
    __table_args__ = (UniqueConstraint("gradeo_class_id", "syllabus_id", name="uq_gradeo_class_syllabus"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    gradeo_class_id: Mapped[str] = mapped_column(String, ForeignKey("gradeo_classes.gradeo_class_id"), index=True)
    syllabus_id: Mapped[str] = mapped_column(String, index=True)
    title: Mapped[str | None] = mapped_column(String)
    description: Mapped[str | None] = mapped_column(String)
    grade: Mapped[int | None] = mapped_column(Integer)
