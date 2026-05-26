"""Add canvas_engagement, canvas_course_activity tables and enrollments.total_activity_time

Revision ID: 0017
Revises: 0016
Create Date: 2026-05-26
"""

from alembic import op
import sqlalchemy as sa


revision = "0017"
down_revision = "0016"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "canvas_engagement",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("course_id", sa.BigInteger, sa.ForeignKey("courses.id"), nullable=False, index=True),
        sa.Column("user_id", sa.BigInteger, sa.ForeignKey("users.id"), nullable=False, index=True),
        sa.Column("page_views", sa.Integer, nullable=True),
        sa.Column("page_views_level", sa.Integer, nullable=True),
        sa.Column("max_page_views", sa.Integer, nullable=True),
        sa.Column("participations", sa.Integer, nullable=True),
        sa.Column("participations_level", sa.Integer, nullable=True),
        sa.Column("max_participations", sa.Integer, nullable=True),
        sa.Column("tardiness_on_time", sa.Integer, nullable=True),
        sa.Column("tardiness_late", sa.Integer, nullable=True),
        sa.Column("tardiness_missing", sa.Integer, nullable=True),
        sa.Column("synced_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("course_id", "user_id", name="uq_canvas_engagement"),
    )

    op.create_table(
        "canvas_course_activity",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("course_id", sa.BigInteger, sa.ForeignKey("courses.id"), nullable=False, index=True),
        sa.Column("date", sa.Date, nullable=False),
        sa.Column("views", sa.Integer, nullable=True),
        sa.Column("participations", sa.Integer, nullable=True),
        sa.UniqueConstraint("course_id", "date", name="uq_canvas_course_activity"),
    )

    op.add_column("enrollments", sa.Column("total_activity_time", sa.Integer, nullable=True))


def downgrade() -> None:
    op.drop_column("enrollments", "total_activity_time")
    op.drop_table("canvas_course_activity")
    op.drop_table("canvas_engagement")
