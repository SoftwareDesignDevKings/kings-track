"""Add attendance tables (meetings + attendance_records)

Revision ID: 0014
Revises: 0013
Create Date: 2026-05-20
"""

from alembic import op
import sqlalchemy as sa


revision = "0014"
down_revision = "0013"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "meetings",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("teams_meeting_id", sa.String(255), unique=True, nullable=False),
        sa.Column("title", sa.String(500), nullable=True),
        sa.Column("start_time", sa.DateTime(timezone=True), nullable=False, index=True),
        sa.Column("end_time", sa.DateTime(timezone=True), nullable=False),
        sa.Column("organizer_email", sa.String(255), nullable=True),
        sa.Column("class_code", sa.String(50), nullable=True, index=True),
        sa.Column("course_id", sa.BigInteger, sa.ForeignKey("courses.id"), nullable=True, index=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "attendance_records",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("meeting_id", sa.Integer, sa.ForeignKey("meetings.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("user_id", sa.BigInteger, sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("join_time", sa.DateTime(timezone=True), nullable=False),
        sa.Column("leave_time", sa.DateTime(timezone=True), nullable=True),
        sa.Column("duration_minutes", sa.Integer, nullable=True),
        sa.Column("status", sa.String(20), server_default="present", index=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("meeting_id", "user_id", "join_time", name="uq_attendance_record"),
    )


def downgrade() -> None:
    op.drop_table("attendance_records")
    op.drop_table("meetings")
