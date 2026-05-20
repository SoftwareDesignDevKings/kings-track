from sqlalchemy import BigInteger, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)  # Canvas user ID
    name: Mapped[str] = mapped_column(String, nullable=False)
    sortable_name: Mapped[str | None] = mapped_column(String)
    email: Mapped[str | None] = mapped_column(String)
    sis_id: Mapped[str | None] = mapped_column(String, index=True)

    # Relationships
    enrollments: Mapped[list["Enrollment"]] = relationship(back_populates="user")
