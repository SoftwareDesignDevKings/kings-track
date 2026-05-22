"""Ensure attendance tables exist

Migration 0014 may have been skipped on production if alembic_version
was already stamped at 0014 from the (since-renumbered) edstem migration.
This migration creates the attendance tables if they don't already exist.

Revision ID: 0016
Revises: 0015
Create Date: 2026-05-22
"""

from alembic import op
from sqlalchemy import text
import sqlalchemy as sa


revision = "0016"
down_revision = "0015"
branch_labels = None
depends_on = None


def _table_exists(conn, table_name: str) -> bool:
    row = conn.execute(
        text(
            "SELECT EXISTS (SELECT 1 FROM information_schema.tables "
            "WHERE table_schema = 'public' AND table_name = :name)"
        ),
        {"name": table_name},
    ).fetchone()
    return bool(row[0])


def upgrade() -> None:
    conn = op.get_bind()

    if not _table_exists(conn, "meetings"):
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

    if not _table_exists(conn, "attendance_records"):
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
    # Don't drop tables on downgrade — they may have been created by 0014
    pass
