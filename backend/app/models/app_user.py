from sqlalchemy import Integer, Text, DateTime, func
from sqlalchemy.orm import Mapped, mapped_column
from datetime import datetime

from app.db import Base


class AppUser(Base):
    __tablename__ = "app_users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    email: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    role: Mapped[str] = mapped_column(Text, nullable=False, server_default="teacher")
    created_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), server_default=func.now())
    extension_api_key_hash: Mapped[str | None] = mapped_column(Text, nullable=True)
    extension_api_key_hint: Mapped[str | None] = mapped_column(Text, nullable=True)
    extension_api_key_created_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    extension_api_key_last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
