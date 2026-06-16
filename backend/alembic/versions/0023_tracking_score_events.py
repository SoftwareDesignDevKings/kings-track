"""Add tracking score event history

Revision ID: 0023
Revises: 0022
Create Date: 2026-06-16
"""

from alembic import op
import sqlalchemy as sa


revision = "0023"
down_revision = "0022"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "tracking_score_events",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("assignment_id", sa.BigInteger(), sa.ForeignKey("assignments.id"), nullable=False),
        sa.Column("snapshot_id", sa.Integer(), sa.ForeignKey("tracking_snapshots.id"), nullable=False),
        sa.Column("user_id", sa.BigInteger(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("rubric_criterion_id", sa.String(), sa.ForeignKey("rubric_criteria.id"), nullable=False),
        sa.Column("previous_score", sa.Integer(), nullable=True),
        sa.Column("previous_comment", sa.Text(), nullable=True),
        sa.Column("new_score", sa.Integer(), nullable=True),
        sa.Column("new_comment", sa.Text(), nullable=True),
        sa.Column("changed_by_email", sa.String(), nullable=False),
        sa.Column("changed_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "ix_tracking_score_events_assignment_user_criterion_changed",
        "tracking_score_events",
        ["assignment_id", "user_id", "rubric_criterion_id", "changed_at"],
    )
    op.create_index(
        "ix_tracking_score_events_assignment_user_changed",
        "tracking_score_events",
        ["assignment_id", "user_id", "changed_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_tracking_score_events_assignment_user_changed", table_name="tracking_score_events")
    op.drop_index("ix_tracking_score_events_assignment_user_criterion_changed", table_name="tracking_score_events")
    op.drop_table("tracking_score_events")
